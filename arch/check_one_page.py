import argparse
import base64
import json
import posixpath
import re
import sys
import tomllib
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit


PREVIEW_URL = "https://preview.invalid/"
PAGES_FILES = Path(__file__).resolve().parent / "pages"
CSS_URL = re.compile(r"url\(\s*(['\"]?)(.*?)\1\s*\)", re.I | re.S)
JS_LITERAL = re.compile(r"//[^\n]*|/\*.*?\*/|(['\"`])(?:\\.|(?!\1).)*\1", re.S)
JS_CALL = re.compile(
    r"\b(?:(?P<history>history\s*\.\s*(?:pushState|replaceState))"
    r"|location\s*\.\s*(?:assign|replace)|window\s*\.\s*open)\s*\("
)
JS_LOCATION = re.compile(
    r"(?<![\w.])(?:(?:window|document|self|top|parent)\s*\.\s*)?"
    r"location\s*(?:\.\s*(?:href|pathname|search|host|hostname|protocol|port)\s*)?"
    r"=(?!=|>)\s*([^;\n})]+)"
)
JS_IMPORT = re.compile(r"\b(?:import|from|require)\s*\(?\s*(__lt_string_\d+__)")
ROUTER_NAMES = ("react-router", "vue-router", "@angular/router", "next/router", "next/navigation")


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.anchors = set()
        self.navigation = []
        self.assets = []
        self.css = []
        self.scripts = []
        self.import_maps = []
        self.canonical = None
        self.raw_tag = None
        self.raw_attrs = {}

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        line = self.getpos()[0]
        if attrs.get("id"):
            self.anchors.add(attrs["id"])
        if tag == "a" and attrs.get("name"):
            self.anchors.add(attrs["name"])
        href = attrs.get("href", attrs.get("xlink:href"))
        if tag in {"a", "area"} and href is not None and "download" not in attrs:
            self.navigation.append((line, tag, href))
        if tag == "form" and (attrs.get("method") or "get").lower() != "dialog":
            self.navigation.append((line, "form", attrs.get("action") or ""))
        if "formaction" in attrs:
            self.navigation.append((line, "formaction", attrs["formaction"] or ""))
        if tag == "base" and "href" in attrs:
            self.navigation.append((line, "base", attrs["href"] or ""))
        if tag == "meta" and (attrs.get("http-equiv") or "").lower() == "refresh":
            refresh = re.search(r";\s*(?:url\s*=\s*)?(.*)", attrs.get("content") or "", re.I)
            if refresh:
                self.navigation.append((line, "meta refresh", refresh[1].strip(" \"'")))
        if tag == "link":
            relations = (attrs.get("rel") or "").lower().split()
            if "canonical" in relations:
                self.canonical = attrs.get("href")
            if set(relations) & {"stylesheet", "icon", "preload", "modulepreload", "manifest"}:
                self.assets.append((line, attrs.get("href") or ""))
        for attr in ("src", "poster", "data" if tag == "object" else "srcset"):
            if attrs.get(attr):
                value = attrs[attr]
                if attr == "srcset":
                    value = re.sub(r"data:[\w./+-]+;base64,[\w+/=]+", "data:", value)
                    self.assets.extend((line, item.split()[0]) for item in value.split(",") if item.strip())
                else:
                    self.assets.append((line, value))
        if tag in {"image", "use"} and (attrs.get("href") or attrs.get("xlink:href")):
            self.assets.append((line, attrs.get("href") or attrs["xlink:href"]))
        if attrs.get("style"):
            self.css.append((line, attrs["style"]))
        if tag in {"script", "style"}:
            self.raw_tag, self.raw_attrs = tag, attrs
        for name, value in attributes:
            if name.startswith("on") and value:
                self.scripts.append((line, value))

    def handle_data(self, data):
        line = self.getpos()[0]
        if self.raw_tag == "style":
            self.css.append((line, data))
        elif self.raw_tag == "script":
            kind = (self.raw_attrs.get("type") or "").lower()
            if kind == "importmap":
                self.import_maps.append((line, data))
            elif kind in {"", "module", "text/javascript", "application/javascript"}:
                self.scripts.append((line, data))

    def handle_endtag(self, tag):
        if tag == self.raw_tag:
            self.raw_tag = None


def normalized_page(path):
    path = posixpath.normpath(unquote(path) or "/").rstrip("/")
    return path.removesuffix("/index.html")


def destination_issue(kind, value, page_url, anchors):
    value = value.strip()
    if value.lower().startswith(("javascript:", "data:", "blob:")):
        return f"{kind} 실행형 주소 확인 필요 ({value[:50]})"
    target = urlsplit(urljoin(page_url, re.sub(r"[\t\r\n]", "", value).replace("\\", "/")))
    page = urlsplit(page_url)
    if target.scheme not in {"https", "http"} or target.hostname != page.hostname:
        return f"{kind} 외부 주소 이동 ({value})" if kind in {"base", "meta refresh"} else None
    if (kind in {"form", "formaction"} or normalized_page(target.path) != normalized_page(page.path)
            or target.query != page.query or target.port != page.port):
        return f"{kind} 내부 페이지 이동 ({value or page_url})"
    if target.fragment and unquote(target.fragment) not in anchors and not target.fragment.startswith(":~:text="):
        return f"{kind} 앵커 대상 없음 ({value})"
    return None


def call_arguments(code, start):
    commas = []
    depth = 0
    for match in re.finditer(r"[\[\]{}(),]", code[start:]):
        position = start + match.start()
        char = match[0]
        if char == ")" and depth == 0:
            bounds = [start - 1, *commas, position]
            return [code[a + 1:b].strip() for a, b in zip(bounds, bounds[1:])]
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        elif depth == 0:
            commas.append(position)
    return []


def mask_js(source):
    literals = {}

    def mask(match):
        if not match[1]:
            return "\n" * match[0].count("\n") + " "
        token = f"__lt_string_{len(literals)}__"
        literals[token] = match[0][1:-1]
        return token + "\n" * match[0].count("\n")

    return JS_LITERAL.sub(mask, source), literals


def script_issues(source, label, start_line, page_url, anchors, inline_imports):
    code, literals = mask_js(source)
    for match in JS_IMPORT.finditer(code):
        name = literals.get(match[1], "")
        if any(name == router or name.startswith(router + "/") for router in ROUTER_NAMES):
            yield f"{label}:{start_line + code.count(chr(10), 0, match.start())} 라우터 가져오기 ({name})"
        if inline_imports is not None and name not in inline_imports:
            yield f"{label}:{start_line + code.count(chr(10), 0, match.start())} 단일 파일 외부 모듈 ({name})"

    destinations = [(match, match[1].strip()) for match in JS_LOCATION.finditer(code)
                    if not re.search(r"\b(?:const|let|var)\s*$", code[:match.start()])]
    for match in JS_CALL.finditer(code):
        arguments = call_arguments(code, match.end())
        index = 2 if match["history"] else 0
        if len(arguments) > index and arguments[index] not in {"", "null", "undefined"}:
            destinations.append((match, arguments[index]))
    for match, argument in destinations:
        value = literals.get(argument)
        if value is None or "${" in value or "\\" in value:
            issue = "자바스크립트 이동 주소 확인 필요"
        else:
            issue = destination_issue("자바스크립트", value, page_url, anchors)
        if issue:
            yield f"{label}:{start_line + code.count(chr(10), 0, match.start())} {issue}"


def check(directory, single_file=False):
    index = directory / "index.html"
    if index.is_symlink() or not index.is_file():
        return ["index.html이 없습니다."]
    issues = []
    files = []
    for path in sorted(directory.rglob("*")):
        relative = path.relative_to(directory)
        if any(part.startswith(".") for part in relative.parts):
            continue
        if path.is_symlink():
            issues.append(f"심볼릭 링크 대상 확인 필요 ({relative})")
        elif path.is_file():
            files.append(path)
    if single_file and files != [index]:
        issues.append("단일 파일 모드의 결과물에는 index.html만 있어야 합니다.")
    for path in files:
        if path.suffix.lower() in {".htm", ".html", ".xhtml"} and path != index:
            is_pages_fallback = (not single_file and path == directory / "404.html"
                                 and path.read_bytes() == (PAGES_FILES / "404.html").read_bytes())
            if not is_pages_fallback:
                issues.append(f"추가 HTML 문서 ({path.relative_to(directory)})")
        if path.name == "_redirects" and any(line.strip() and not line.lstrip().startswith("#")
                                             for line in path.read_text().splitlines()):
            issues.append(f"호스팅 이동 규칙 ({path.relative_to(directory)})")
        if path.name in {"vercel.json", "netlify.toml"}:
            parser = json if path.suffix == ".json" else tomllib
            settings = parser.loads(path.read_text())
            if any(settings.get(key) for key in ("redirects", "rewrites", "routes")):
                issues.append(f"호스팅 이동 규칙 ({path.relative_to(directory)})")

    page = Page()
    page.feed(index.read_text(encoding="utf-8"))
    page.close()
    page_url = page.canonical or PREVIEW_URL
    for line, kind, value in page.navigation:
        issue = destination_issue(kind, value, page_url, page.anchors)
        if issue:
            issues.append(f"index.html:{line} {issue}")

    scripts = [("index.html", line, source) for line, source in page.scripts]
    scripts.extend((str(path.relative_to(directory)), 1, path.read_text(encoding="utf-8"))
                   for path in files if path.suffix.lower() in {".js", ".mjs", ".cjs"})
    inline_imports = set() if single_file else None
    for line, data in page.import_maps:
        for name, value in json.loads(data).get("imports", {}).items():
            if value.startswith("data:text/javascript;base64,"):
                if inline_imports is not None:
                    inline_imports.add(name)
                source = base64.b64decode(value.split(",", 1)[1], validate=True).decode("utf-8")
                scripts.append((name, 1, source))
            elif single_file:
                issues.append(f"index.html:{line} 단일 파일 외부 모듈 ({name})")
    for label, line, source in scripts:
        issues.extend(script_issues(source, label, line, page_url, page.anchors, inline_imports))

    if single_file:
        assets = list(page.assets)
        for line, css in page.css:
            css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
            assets.extend((line, match[2]) for match in CSS_URL.finditer(css))
            if re.search(r"@import\b", css, re.I):
                issues.append(f"index.html:{line} 단일 파일 CSS @import 확인 필요")
        for line, value in assets:
            if not value.strip().startswith(("data:", "#")):
                issues.append(f"index.html:{line} 단일 파일 외부 리소스 ({value})")
    return issues


def main():
    parser = argparse.ArgumentParser(description="원페이지 배포 결과를 검사합니다.")
    parser.add_argument("directory", type=Path)
    parser.add_argument("--single-file", action="store_true")
    args = parser.parse_args()
    try:
        issues = check(args.directory, args.single_file)
    except (OSError, ValueError) as error:
        issues = [str(error)]
    if issues:
        print("\n".join(issues), file=sys.stderr)
        return 1
    print(f"한 장 검사 통과 ({args.directory})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
