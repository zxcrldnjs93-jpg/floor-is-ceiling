#!/usr/bin/env python3
import argparse
import base64
import json
import os
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit

from font_coverage import missing_glyphs


TOTAL_BUDGET = 1536 * 1024
SCRIPT_BUDGET = 200 * 1024
V03_SCRIPT_BUDGET = 232 * 1024
CONTRAST_MIN = {"text": 4.5, "large": 3, "ui": 3}


def is_hidden(path):
    return any(part.startswith(".") and part not in (".", "..") for part in path.parts)


class LandingPage(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tags = []
        self.title = ""
        self.in_title = False
        self.inline_js = 0
        self.in_inline_js = False
        self.importmap = None
        self.embedded_scripts = set()
        self.body_text = []
        self.in_body = False
        self.in_code = False

    def handle_starttag(self, tag, attrs):
        attrs = {key: value or "" for key, value in attrs}
        self.tags.append((tag, attrs, self.getpos()[0]))
        if tag == "title":
            self.in_title = True
        if tag == "body":
            self.in_body = True
        if tag in ("script", "style"):
            self.in_code = True
        if self.in_body:
            self.body_text.extend(attrs[name] for name in ("alt", "aria-label") if name in attrs)
        if tag == "script" and "src" not in attrs:
            script_type = attrs.get("type", "").lower().split(";", 1)[0].strip()
            self.in_inline_js = script_type in ("", "module", "text/javascript", "application/javascript")
            if script_type == "importmap":
                self.importmap = []

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag == "body":
            self.in_body = False
        if tag in ("script", "style"):
            self.in_code = False
        if tag == "script":
            self.in_inline_js = False
            if self.importmap is not None:
                mapping = json.loads("".join(self.importmap))
                if not isinstance(mapping, dict) or not isinstance(mapping.get("imports", {}), dict):
                    raise ValueError("import map의 imports는 JSON 객체여야 합니다.")
                for address in mapping.get("imports", {}).values():
                    if isinstance(address, str) and address.startswith("data:text/javascript;base64,"):
                        self.embedded_scripts.add(address)
                self.importmap = None

    def handle_data(self, text):
        if self.in_title:
            self.title += text
        if self.in_inline_js:
            self.inline_js += len(text.encode("utf-8"))
        if self.importmap is not None:
            self.importmap.append(text)
        if self.in_body and not self.in_code:
            self.body_text.append(text)

    @property
    def script_bytes(self):
        return self.inline_js + sum(len(base64.b64decode(address.split(",", 1)[1], validate=True))
                                    for address in self.embedded_scripts)


def http_origin(url):
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    return parts.scheme, parts.hostname, parts.port or (443 if parts.scheme == "https" else 80)


def link_address(url):
    parts = urlsplit(url)
    return http_origin(url), parts.path or "/", parts.query, parts.fragment


def linear_luminance(color):
    if not isinstance(color, str) or not re.fullmatch(r"#(?:[\da-f]{3}|[\da-f]{6})", color, re.I | re.ASCII):
        raise ValueError("대비 색상은 불투명한 #RGB 또는 #RRGGBB여야 합니다.")
    digits = color[1:]
    if len(digits) == 3:
        digits = "".join(channel * 2 for channel in digits)
    srgb = [int(digits[index:index + 2], 16) / 255 for index in (0, 2, 4)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return sum(c * weight for c, weight in zip(linear, (0.2126, 0.7152, 0.0722)))


def check_contrast(path, errors, warnings):
    if path is None:
        warnings.append("색 대비 미측정. 실제 색 쌍을 --contrast 인수로 지정하세요.")
        return
    if is_hidden(path) or is_hidden(path.resolve()):
        raise ValueError("대비 파일은 일반 JSON 경로로 지정하세요.")
    pairs = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(pairs, list) or not pairs:
        raise ValueError("대비 파일에는 색 쌍을 하나 이상 담은 배열이 필요합니다.")
    for pair in pairs:
        if not isinstance(pair, dict) or not {"label", "fg", "bg", "type"} <= pair.keys():
            raise ValueError("대비 색 쌍마다 label, fg, bg, type이 필요합니다.")
        if not isinstance(pair["label"], str) or not pair["label"].strip():
            raise ValueError("대비 색 쌍의 label은 비어 있지 않은 문자열이어야 합니다.")
        if not isinstance(pair["type"], str) or pair["type"] not in CONTRAST_MIN:
            raise ValueError("대비 type은 text, large, ui 중 하나여야 합니다.")
        light, dark = sorted((linear_luminance(pair["fg"]), linear_luminance(pair["bg"])), reverse=True)
        ratio = (light + 0.05) / (dark + 0.05)
        minimum = CONTRAST_MIN[pair["type"]]
        print(f"대비 {pair['label']} {ratio:.3f}:1 (기준 {minimum}:1)")
        if ratio < minimum:
            errors.append(f"대비 부족 · {pair['label']}")


def check_assets(root, inline_js, errors, c11, script_budget):
    total = file_count = 0
    script = inline_js
    for directory, subdirs, filenames in os.walk(root):
        subdirs[:] = [name for name in subdirs if not name.startswith(".")]
        for name in subdirs + sorted(filenames):
            if name.startswith("."):
                continue
            path = Path(directory, name)
            if path.is_symlink():
                errors.append(f"배포 폴더에 심볼릭 링크가 있습니다 · {path.relative_to(root)}")
            elif path.is_file():
                size = path.stat().st_size
                total += size
                file_count += 1
                if path.suffix.lower() in (".js", ".mjs", ".cjs"):
                    script += size
                if c11 and path.suffix.lower() in (".html", ".htm", ".xhtml") and path not in (root / "index.html", root / "404.html"):
                    errors.append(f"C11 추가 HTML 문서 · {path.relative_to(root)}")
    print(f"배포 파일 {file_count}개 · 원본 {total:,} B / {TOTAL_BUDGET:,} B · JS {script:,} B / {script_budget:,} B")
    if total > TOTAL_BUDGET:
        errors.append("배포 파일 원본 총량이 1.5 MiB를 넘습니다.")
    if script > script_budget:
        errors.append(f"JS 총량이 {script_budget // 1024} KiB를 넘습니다.")


def check_markup(page, page_url, errors, warnings, vote_url=None):
    canonical = next((attrs.get("href", "") for tag, attrs, _ in page.tags
                      if tag == "link" and "canonical" in attrs.get("rel", "").lower().split()), "")
    document = page_url or (canonical if http_origin(canonical) else "https://qa.invalid/")
    origin = http_origin(document)
    doc_parts = urlsplit(document)
    base = next((attrs["href"] for tag, attrs, _ in page.tags if tag == "base" and "href" in attrs), "")
    base = urljoin(document, base)
    doc_path = unquote(doc_parts.path or "/")
    page_paths = {doc_path}
    if doc_path.endswith("/"):
        page_paths.add(doc_path + "index.html")
    elif doc_path.endswith("/index.html"):
        page_paths.add(doc_path.removesuffix("index.html"))
    anchors = {attrs["id"] for _, attrs, _ in page.tags if attrs.get("id")}
    anchors.update(attrs["name"] for tag, attrs, _ in page.tags if tag == "a" and attrs.get("name"))
    vote_count = 0
    phone_count = 0
    if vote_url and http_origin(base) != origin:
        errors.append("C11 <base href>가 외부 주소를 가리킵니다.")
    if vote_url and page_url and canonical:
        canonical_url = urlsplit(urljoin(document, canonical))
        if (http_origin(canonical_url.geturl()) != origin or unquote(canonical_url.path or "/") not in page_paths
                or canonical_url.query or canonical_url.fragment):
            errors.append("C11 canonical이 작품 주소를 가리키지 않습니다.")

    for tag, attrs, line in page.tags:
        needs_alt = tag == "img" or (tag == "input" and attrs.get("type", "").lower() == "image")
        if needs_alt and "alt" not in attrs:
            errors.append(f"index.html:{line} · <{tag}>에 alt 속성이 없습니다.")

        target = None
        if tag in ("a", "area") and (vote_url or "download" not in attrs):
            target = attrs.get("href", attrs.get("xlink:href") if vote_url else None)
        elif tag == "form" and attrs.get("method", "").lower() != "dialog":
            target = attrs.get("action")
        elif tag in ("button", "input") and attrs.get("formmethod", "").lower() != "dialog":
            target = attrs.get("formaction")
        elif tag == "meta" and attrs.get("http-equiv", "").lower() == "refresh":
            refresh = re.search(r";\s*url\s*=\s*(.+)", attrs.get("content", ""), flags=re.I)
            if refresh:
                target = refresh[1].strip().strip("\"'")
                warnings.append(f"index.html:{line} · 자동 이동의 목적지를 브라우저에서 확인하세요.")
        if target is None:
            continue

        url = urljoin(base, target.strip().replace("\\", "/"))
        parts = urlsplit(url)
        if vote_url:
            download = tag in ("a", "area") and "download" in attrs
            if tag == "a" and not download and url == "tel:16612642":
                phone_count += 1
                if phone_count > 1:
                    errors.append(f"index.html:{line} · C11 이웃사이센터 전화 링크 1개 초과")
                continue
            if http_origin(url) == origin and unquote(parts.path).endswith("/404.html"):
                errors.append(f"index.html:{line} · C11 404.html로 향하는 링크")
                continue
            if download and (parts.scheme in ("blob", "data") or http_origin(url) == origin):
                continue
            if http_origin(url) != origin or parts.username is not None:
                if (tag in ("a", "area") and not download and parts.username is None
                        and link_address(url) == link_address(vote_url)):
                    vote_count += 1
                else:
                    errors.append(f"index.html:{line} · C11 허용 목록 밖의 <{tag}> 이동 주소")
                continue
        if parts.scheme == "javascript":
            warnings.append(f"index.html:{line} · 스크립트 링크의 실제 동작을 확인하세요.")
        if http_origin(url) != origin:
            continue
        if unquote(parts.path or "/") not in page_paths:
            errors.append(f"index.html:{line} · <{tag}>가 다른 내부 경로로 이동합니다 · {parts.path}")
        elif parts.query != doc_parts.query:
            if vote_url:
                errors.append(f"index.html:{line} · <{tag}>가 문서 쿼리를 변경합니다.")
            else:
                warnings.append(f"index.html:{line} · 쿼리 변경 후 같은 콘텐츠인지 확인하세요.")
        if (tag in ("a", "area") and unquote(parts.path or "/") in page_paths
                and parts.fragment and parts.fragment.split(":~:", 1)[0]):
            anchor = unquote(parts.fragment.split(":~:", 1)[0])
            if anchor not in anchors and anchor.lower() != "top":
                errors.append(f"index.html:{line} · <{tag}>의 페이지 내 앵커 대상이 없습니다.")

    if vote_url:
        print(f"C11 허용 투표 링크 · {vote_count}/1")
        if vote_count > 1:
            errors.append("C11 외부 투표 링크가 1개를 넘습니다.")

    meta = {key: attrs.get("content", "").strip() for tag, attrs, _ in page.tags if tag == "meta"
            for key in (attrs.get("name", "").lower(), attrs.get("property", "").lower()) if key}
    for key in ("viewport", "description", "og:title", "og:description", "og:image", "og:url"):
        if not meta.get(key):
            warnings.append(f"메타데이터 확인 필요 · {key}")
    if not page.title.strip():
        warnings.append("페이지 제목 <title>이 비어 있습니다.")
    if not any(tag == "html" and attrs.get("lang", "").strip() for tag, attrs, _ in page.tags):
        warnings.append("<html lang>에 문서 언어를 지정하세요.")


def check_not_found(root, errors):
    path = root / "404.html"
    if not path.is_file() or path.is_symlink():
        return
    page = LandingPage()
    page.feed(path.read_text(encoding="utf-8"))
    page.close()
    links = [attrs.get("href") for tag, attrs, _ in page.tags if tag in ("a", "area")]
    if links != ["/"] or any(tag in ("base", "form") for tag, _, _ in page.tags):
        errors.append("C11 404.html에는 작품 루트 /로 돌아가는 링크가 하나 있어야 합니다.")


def font_report(root, html, page):
    font_file = root / "fonts" / "hahmlet-subset.woff2"
    embedded = re.search(r"data:font/woff2;base64,([A-Za-z0-9+/=]+)", html)
    if embedded:
        data = base64.b64decode(embedded[1], validate=True)
    elif font_file.is_file() and not font_file.is_symlink():
        data = font_file.read_bytes()
    else:
        raise ValueError("Hahmlet WOFF2 서브셋이 없습니다.")
    return {"missing": missing_glyphs(data, "".join(page.body_text))}


def check_font(root, html, page, errors):
    try:
        missing = font_report(root, html, page)["missing"]
        print(f"글꼴 서브셋 · 누락 {len(missing)}자")
        if missing:
            errors.append(f"v0.3 Hahmlet 서브셋 글리프 누락 · {missing}")
    except (OSError, ValueError) as error:
        errors.append(f"글꼴 검사 오류 · {error}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("build", type=Path)
    parser.add_argument("--contrast", type=Path)
    parser.add_argument("--page-url")
    parser.add_argument("--vote-url", help="C11 검사에 허용할 외부 HTTPS 주소")
    parser.add_argument("--v03", action="store_true", help="v0.3 JS 예산 적용")
    parser.add_argument("--font-only", action="store_true", help="글꼴 검사 결과만 JSON으로 출력")
    args = parser.parse_args()
    errors, warnings = [], []
    try:
        if args.vote_url:
            vote = urlsplit(args.vote_url)
            if not http_origin(args.vote_url) or vote.scheme != "https" or vote.username is not None:
                raise ValueError("--vote-url에는 공개 HTTPS 주소 한 개를 지정하세요.")
        root = args.build.resolve()
        entry = root / "index.html"
        if is_hidden(args.build) or is_hidden(root) or entry.is_symlink() or not entry.is_file():
            raise ValueError("배포 폴더에 일반 파일 index.html이 필요합니다.")
        if args.page_url:
            parts = urlsplit(args.page_url)
            if (not http_origin(args.page_url) or parts.username is not None
                    or parts.query or parts.fragment or not (parts.path or "/").endswith(("/", "/index.html"))):
                raise ValueError("--page-url은 배포 폴더 또는 index.html의 공개 HTTP(S) URL이어야 합니다.")
        page = LandingPage()
        html = entry.read_text(encoding="utf-8")
        page.feed(html)
        page.close()
        if args.font_only:
            print(json.dumps(font_report(root, html, page), ensure_ascii=False))
            return 0
        script_budget = V03_SCRIPT_BUDGET if args.v03 else SCRIPT_BUDGET
        check_assets(root, page.script_bytes, errors, bool(args.vote_url), script_budget)
        check_markup(page, args.page_url, errors, warnings, args.vote_url)
        if args.vote_url:
            check_not_found(root, errors)
        if args.v03:
            check_font(root, html, page, errors)
        check_contrast(args.contrast, errors, warnings)
    except (ValueError, OSError) as error:
        print(f"정적 검사 입력 오류 · {error}")
        return 2

    for message in warnings:
        print(f"검토 · {message}")
    for message in errors:
        print(f"실패 · {message}")
    print(f"정적 검사 {'FAIL' if errors else 'PASS'} · 실패 {len(errors)}건 · 검토 {len(warnings)}건")
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())
