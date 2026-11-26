import argparse
import base64
import fcntl
import html
import json
import os
import posixpath
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from check_one_page import CSS_URL, JS_IMPORT, JS_LITERAL, PAGES_FILES, Page, check, mask_js


ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
BUILD_MARKER = "<!-- landingthon:build -->"
JS_COMPACT_THRESHOLD = 200 * 1024
JS_BUDGET = 232 * 1024
ESBUILD_VERSION = "0.27.7"
ASSET_MARKER = re.compile(r"\{\{asset:((?:assets|art)/[\w./-]+)\}\}", re.ASCII)
ASSET_TYPES = {
    ".avif": "image/avif", ".gif": "image/gif", ".ico": "image/x-icon",
    ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png",
    ".svg": "image/svg+xml", ".webp": "image/webp",
    ".otf": "font/otf", ".ttf": "font/ttf", ".woff": "font/woff", ".woff2": "font/woff2",
    ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
    ".mp4": "video/mp4", ".webm": "video/webm", ".vtt": "text/vtt", ".txt": "text/plain",
    ".css": "text/css", ".js": "text/javascript",
}
BUILD_MODULES = {
    "physics": {"building.js", "engine.js", "browser.js", "replay.js"},
    "motion": {"engine.js", "building.js"},
    "fx": {"type.js", "card.js", "card-design.js", "audio.js", "haptics.js", "engine-view.js"},
}
STYLESHEET = re.compile(r"<link\b(?=[^>]*\brel\s*=\s*['\"]stylesheet['\"])[^>]*\bhref\s*=\s*(['\"])([^'\"]+)\1[^>]*>", re.I)
FONT_PRELOAD = re.compile(r"<link\b(?=[^>]*\brel\s*=\s*['\"]preload['\"])(?=[^>]*\bas\s*=\s*['\"]font['\"])[^>]*\bhref\s*=\s*(['\"])([^'\"]+)\1[^>]*>", re.I)
INLINE_STYLE = re.compile(r"(<style\b[^>]*>)(.*?)(</style>)", re.I | re.S)
TOKEN_IMPORT = re.compile(r"^[ \t]*@import\s+(?:url\(\s*)?(['\"])\.\./tokens\.css\1\s*\)?\s*;[ \t]*(?:\r?\n)?", re.I | re.M)
EXTERNAL_SCRIPT = re.compile(r"<script\b([^>]*?)\bsrc\s*=\s*(['\"])([^'\"]+)\2([^>]*)>\s*</script>", re.I)
MEDIA_TAG = re.compile(r"<(?:img|source|audio|video|track|image|use)\b[^>]*>", re.I)
MEDIA_ATTRIBUTE = re.compile(r"\b(src|srcset|poster|href|xlink:href)\s*=\s*(['\"])([^'\"]+)\2", re.I)
END_CREDITS = re.compile(r"(<section\b[^>]*\bdata-scene\s*=\s*(['\"])s7\2[^>]*>)(.*?)(</section>)", re.I | re.S)
EXTERNAL_CITATION = re.compile(r"<a\b[^>]*\bhref\s*=\s*(['\"])(https?://[^'\"]+)\1[^>]*>(.*?)</a>", re.I | re.S)


def source_files(folder, suffixes):
    if folder.is_symlink():
        raise ValueError(f"리소스 폴더가 심볼릭 링크입니다 ({folder})")
    for path in sorted(folder.rglob("*")):
        relative = path.relative_to(folder)
        if any(part.startswith(".") for part in relative.parts):
            continue
        if path.is_symlink():
            raise ValueError(f"심볼릭 링크 대신 작업 폴더에 파일을 둡니다 ({relative})")
        if path.is_file() and path.suffix.lower() in suffixes:
            if not re.fullmatch(r"[a-zA-Z0-9_./-]+", relative.as_posix()):
                raise ValueError(f"리소스 경로에 영문·숫자·기호 _.- 를 사용합니다 ({relative})")
            yield path.relative_to(SITE).as_posix(), path


def data_url(mime_type, data):
    return f"data:{mime_type};base64,{base64.b64encode(data).decode('ascii')}"


def public_url(value):
    if value is None:
        return None
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username is not None
            or parsed.query or parsed.fragment or re.search(r"[\s\\]", value)):
        raise ValueError("공개 주소는 HTTPS 배포 경로를 사용합니다.")
    if not parsed.path:
        return value + "/"
    if not parsed.path.endswith(("/", "/index.html")):
        raise ValueError("공개 주소의 경로는 / 또는 /index.html로 끝나야 합니다.")
    return value


def read_metadata():
    meta = json.loads((SITE / "metadata.json").read_text(encoding="utf-8"))
    if not isinstance(meta, dict):
        raise ValueError("metadata.json에 JSON 객체를 입력합니다.")
    for key in ("title", "description", "imageAlt"):
        if not isinstance(meta.get(key), str) or not meta[key].strip():
            raise ValueError(f"metadata.json의 {key} 값을 입력합니다.")
    if "shareDescription" in meta and (not isinstance(meta["shareDescription"], str) or not meta["shareDescription"].strip()):
        raise ValueError("metadata.json의 shareDescription은 비어 있지 않은 문자열이어야 합니다.")
    if not isinstance(meta.get("url", ""), str):
        raise ValueError("metadata.json의 url은 문자열이어야 합니다.")
    return meta


def metadata_html(url, assets, single_file):
    meta = read_metadata()
    title, description, image_alt = (html.escape(meta[key]) for key in ("title", "description", "imageAlt"))
    share_description = html.escape(meta.get("shareDescription", meta["description"]))
    icon = data_url("image/svg+xml", (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
        '<rect width="32" height="32" rx="6" fill="#f5f6f3"/>'
        '<path d="M5 14h22v4H5zM6 23h20v2H6z" fill="#1b2128"/>'
        '<circle cx="19" cy="9" r="3" fill="#ad4828"/></svg>'
    ).encode("utf-8"))
    tags = [
        f"<title>{title}</title>",
        f'<meta name="description" content="{description}">',
        '<meta property="og:type" content="website">',
        '<meta property="og:locale" content="ko_KR">',
        f'<meta property="og:title" content="{title}">',
        f'<meta property="og:description" content="{share_description}">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{title}">',
        f'<meta name="twitter:description" content="{share_description}">',
        f'<link rel="icon" type="image/svg+xml" href="{icon}">',
    ]
    image = next((name for name in ("assets/og.png", "art/og.png", "art/og-1200x630.png") if name in assets), None)
    if image is None:
        raise ValueError("1200×630 OG 공유 이미지가 필요합니다.")
    with assets[image].open("rb") as file:
        header = file.read(24)
    if (not header.startswith(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR") or len(header) != 24
            or struct.unpack(">II", header[16:24]) != (1200, 630)):
        raise ValueError("공유 이미지의 규격은 1200×630 PNG입니다.")
    if url:
        canonical = html.escape(url)
        image_url = html.escape(urljoin(url, image))
        tags.extend([
            f'<link rel="canonical" href="{canonical}">',
            f'<meta property="og:url" content="{canonical}">',
        ])
    else:
        image_url = data_url("image/png", assets[image].read_bytes()) if single_file else f"./{image}"
    tags.extend([
        f'<meta property="og:image" content="{image_url}">',
        '<meta property="og:image:type" content="image/png">',
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        f'<meta property="og:image:alt" content="{image_alt}">',
        f'<meta name="twitter:image" content="{image_url}">',
        f'<meta name="twitter:image:alt" content="{image_alt}">',
    ])
    return "\n  ".join(tags)


def module_alias(name):
    return "@landing/" + name.removeprefix("modules/")


def module_sources(modules):
    names_by_path = {path.resolve(): name for name, path in modules.items()}
    aliases = {module_alias(name) for name in modules if name != "modules/main.js"}
    sources = {}
    for name, path in modules.items():
        source = path.read_text(encoding="utf-8")
        if name == "modules/engines/physics-building.js":
            # Preview the same column search as the release, using the live room bodies.
            source += "\nexport { clearDropColumn as dropColumnForPreview };\n"
        code, literals = mask_js(source)
        spans = [match.span() for match in JS_LITERAL.finditer(source) if match[1]]
        replacements = []
        for match in JS_IMPORT.finditer(code):
            specifier = literals.get(match[1], "")
            if specifier in aliases:
                continue
            if specifier.startswith(("./", "../")):
                dependency = names_by_path.get((path.parent / specifier).resolve())
                if dependency and module_alias(dependency) in aliases:
                    literal_index = int(match[1].removeprefix("__lt_string_").removesuffix("__"))
                    start, end = spans[literal_index]
                    replacements.append((start, end, json.dumps(module_alias(dependency))))
                    continue
            raise ValueError(f"{name}에서 등록되지 않은 모듈을 가져옵니다 ({specifier})")
        for start, end, replacement in sorted(replacements, reverse=True):
            source = source[:start] + replacement + source[end:]
        sources[name] = source
    return sources


def modules_html(sources, single_file):
    entry = "modules/main.js"
    if entry not in sources:
        raise ValueError(f"진입 모듈이 없습니다 ({entry})")

    imports = {
        module_alias(name): data_url("text/javascript", source.encode("utf-8")) if single_file else f"./{name}"
        for name, source in sources.items() if name != entry
    }
    rendered = f'<script type="importmap">{json.dumps({"imports": imports}, ensure_ascii=False)}</script>'
    if single_file:
        if re.search(r"</script\b", sources[entry], re.I):
            raise ValueError(f"{entry}에 HTML script 종료 구분자가 있습니다.")
        return rendered + f'\n  <script type="module">\n{sources[entry]}</script>'
    return rendered + f'\n  <script type="module" src="./{entry}"></script>'


def local_reference(value, parent=""):
    parts = urlsplit(html.unescape(value))
    if parts.scheme or parts.netloc or not parts.path:
        return None
    return posixpath.normpath(posixpath.join(parent, parts.path))


def c11_footer_citations(document):
    def text_citation(match):
        source = html.escape(html.unescape(match[2]), quote=True)
        return f'<span data-source-url="{source}">{match[3]}</span>'

    return END_CREDITS.sub(
        lambda match: match[1] + EXTERNAL_CITATION.sub(text_citation, match[3]) + match[4], document,
    )


def fill_build_facts(document, file_js_bytes):
    js_marker = "<!-- build:js-bytes -->"
    if js_marker in document:
        page = Page()
        page.feed(document)
        addresses = {
            address for _, source in page.import_maps for address in json.loads(source)["imports"].values()
            if address.startswith("data:text/javascript;base64,")
        }
        inline_bytes = sum(len(source.encode("utf-8")) for _, source in page.scripts)
        embedded_bytes = sum(len(base64.b64decode(address.split(",", 1)[1])) for address in addresses)
        total = file_js_bytes + inline_bytes + embedded_bytes
        if total > JS_BUDGET:
            raise ValueError(f"배포 JS가 예산을 넘습니다 ({total:,} B / {JS_BUDGET:,} B).")
        kb = (Decimal(total) / 1000).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
        document = document.replace(js_marker, str(kb))

    source_marker = "<!-- build:source-count -->"
    if source_marker in document:
        lists = re.finditer(r'<ul\b[^>]*\bclass=([\'\"])(.*?)\1[^>]*>(.*?)</ul>', document, re.I | re.S)
        source_list = next((match[3] for match in lists if "src" in match[2].split()), None)
        if source_list is None:
            raise ValueError("출처 수를 표시하려면 ul.src 목록이 필요합니다.")
        document = document.replace(source_marker, str(len(re.findall(r"<li(?:\s|>)", source_list, re.I))))
    return document


def inline_design_files(document, assets, style_sources, ui_sources):
    def embedded(name):
        path = assets[name]
        return data_url(ASSET_TYPES[path.suffix.lower()], path.read_bytes())

    def css_source(source, parent=""):
        def css_asset(url):
            path = local_reference(url[2], parent)
            if path not in assets:
                return url[0]
            return f'url("{embedded(path)}")'

        return CSS_URL.sub(css_asset, source)

    def stylesheet(match):
        name = local_reference(match[2])
        if name not in style_sources:
            return match[0]
        source = style_sources[name]
        return f"<style>\n{css_source(source, posixpath.dirname(name))}\n</style>"

    def ui_script(match):
        name = local_reference(match[3])
        if name not in ui_sources:
            return match[0]
        source = ui_sources[name]
        if re.search(r"</script\b", source, re.I):
            raise ValueError(f"{name}에 HTML script 종료 구분자가 있습니다.")
        attrs = match[1] + match[4]
        if re.search(r"\bdefer\b", attrs, re.I) or re.search(r"\btype\s*=\s*['\"]module['\"]", attrs, re.I):
            return f'<script type="module">\n{source}\n</script>'
        return f'<script>\n{source}\n</script>'

    def media_tag(match):
        def source(attr):
            kind, quote, value = attr.groups()
            if kind.lower() == "srcset" and not value.startswith("data:"):
                candidates = []
                for candidate in value.split(","):
                    parts = candidate.strip().split(maxsplit=1)
                    if not parts:
                        continue
                    name = local_reference(parts[0])
                    if name in assets:
                        parts[0] = embedded(name)
                    candidates.append(" ".join(parts))
                value = ", ".join(candidates)
            else:
                name = local_reference(value)
                if name in assets:
                    fragment = urlsplit(html.unescape(value)).fragment
                    value = embedded(name) + (f"#{fragment}" if fragment else "")
            return f"{kind}={quote}{value}{quote}"

        return MEDIA_ATTRIBUTE.sub(source, match[0])

    document = FONT_PRELOAD.sub(lambda match: "" if local_reference(match[2]) in assets else match[0], document)
    document = INLINE_STYLE.sub(lambda match: match[1] + css_source(match[2]) + match[3], document)
    document = STYLESHEET.sub(stylesheet, document)
    document = EXTERNAL_SCRIPT.sub(ui_script, document)
    return MEDIA_TAG.sub(media_tag, document)


def script_size(scripts):
    return sum(len(source.encode("utf-8")) for source in scripts.values())


def compact_javascript(sources, ui_sources):
    scripts = sources | ui_sources
    if script_size(scripts) <= JS_COMPACT_THRESHOLD:
        return sources, ui_sources
    result = subprocess.run(
        ["node", str(ROOT / "arch/compact-js.cjs")], input=json.dumps(scripts),
        capture_output=True, text=True, encoding="utf-8",
    )
    if result.returncode:
        raise ValueError(f"배포 JS 압축 중 오류가 발생했습니다.\n{result.stderr.strip()}")
    compact = json.loads(result.stdout)
    if script_size(compact) > JS_BUDGET:
        compact = minify_javascript(compact)
    return (
        {name: value for name, value in compact.items() if name in sources},
        {name: compact[name] for name in ui_sources},
    )


def minify_javascript(scripts):
    executable = os.environ.get("LT_ESBUILD_BIN") or shutil.which("esbuild")
    if not executable:
        raise ValueError(f"현재 JS는 {script_size(scripts):,}B입니다. 예산 압축에는 esbuild {ESBUILD_VERSION} 경로를 LT_ESBUILD_BIN으로 지정합니다.")
    version = subprocess.run([executable, "--version"], capture_output=True, text=True, encoding="utf-8")
    if version.returncode or version.stdout.strip() != ESBUILD_VERSION:
        raise ValueError(f"배포 JS 압축에는 esbuild {ESBUILD_VERSION}이 필요합니다.")
    output = {}
    for name, source in scripts.items():
        result = subprocess.run([
            executable, "--loader=js", "--charset=utf8", "--minify-identifiers", "--minify-whitespace",
            "--minify-syntax", "--keep-names", "--legal-comments=inline", f"--sourcefile={name}",
        ], input=source, capture_output=True, text=True, encoding="utf-8")
        if result.returncode:
            raise ValueError(f"{name} 배포 JS 압축에 실패했습니다.\n{result.stderr.strip()}")
        output[name] = result.stdout
    return output


def render(directory, single_file, url, with_prototypes):
    assets = dict(source_files(SITE / "assets", ASSET_TYPES))
    for folder, suffixes in (("art", ASSET_TYPES), ("styles", {".css"}), ("ui", {".js"})):
        assets.update(source_files(SITE / folder, suffixes))
    fonts = dict(source_files(SITE / "fonts", {".otf", ".ttf", ".woff", ".woff2", ".txt"}))
    assets.update({name: path for name, path in fonts.items() if not name.endswith(".txt") or "ofl" in path.stem.lower()})
    modules = dict(source_files(SITE / "modules", {".js"}))
    styles = (SITE / "tokens.css").read_text(encoding="utf-8").rstrip()
    if with_prototypes:
        for engine, filenames in BUILD_MODULES.items():
            folder = ROOT / "proto" / engine
            if engine == "fx" and not (folder / "README.md").is_file():
                continue
            if folder.is_symlink():
                raise ValueError(f"프로토 폴더가 심볼릭 링크입니다 ({folder})")
            for source in sorted(folder.glob("*.js")):
                if source.name not in filenames:
                    continue
                if source.is_symlink():
                    raise ValueError(f"프로토 모듈이 심볼릭 링크입니다 ({source})")
                suffix = "" if source.stem == "engine" else f"-{source.stem}"
                modules[f"modules/engines/{engine}{suffix}.js"] = source
            if engine != "fx" and f"modules/engines/{engine}.js" not in modules:
                raise ValueError(f"프로토 엔진 파일을 확인합니다 ({folder / 'engine.js'})")
        for name in ("motion.css", "building.css"):
            motion_css = ROOT / "proto/motion" / name
            if motion_css.is_symlink():
                raise ValueError(f"모션 CSS 경로가 심볼릭 링크입니다 ({motion_css})")
            if name == "motion.css" or motion_css.is_file():
                styles += "\n\n" + motion_css.read_text(encoding="utf-8").rstrip()
    ui_sources = {name: path.read_text(encoding="utf-8") for name, path in assets.items() if name.startswith("ui/")}
    style_sources = {
        name: TOKEN_IMPORT.sub("", path.read_text(encoding="utf-8"))
        for name, path in assets.items() if name.startswith("styles/")
    }
    sources, ui_sources = compact_javascript(module_sources(modules), ui_sources)

    document = (SITE / "index.html").read_text(encoding="utf-8")
    size = script_size(sources | ui_sources)
    if size > JS_BUDGET:
        raise ValueError(f"압축 후 배포 JS가 예산을 넘습니다 ({size:,} B / {JS_BUDGET:,} B).")

    def asset_reference(match):
        name = match[1]
        if name not in assets:
            raise ValueError(f"리소스 파일이 없습니다 ({name})")
        path = assets[name]
        return data_url(ASSET_TYPES[path.suffix.lower()], path.read_bytes()) if single_file else f"./{name}"

    replacements = {
        "/* build:tokens */": styles,
        "<!-- build:metadata -->": metadata_html(url, assets, single_file),
        "<!-- build:modules -->": modules_html(sources, single_file),
    }
    for marker, content in replacements.items():
        if document.count(marker) != 1:
            raise ValueError(f"index.html에 빌드 자리표시자 1개가 필요합니다 ({marker})")
        document = document.replace(marker, content)
    document = c11_footer_citations(ASSET_MARKER.sub(asset_reference, document))
    if single_file:
        document = inline_design_files(document, assets, style_sources, ui_sources)
    document = fill_build_facts(document, 0 if single_file else size)
    if "{{asset:" in document:
        raise ValueError("인식되지 않은 {{asset:...}} 자리표시자가 있습니다.")
    (directory / "index.html").write_text(f"{BUILD_MARKER}\n{document}", encoding="utf-8")
    if not single_file:
        for name in ("_headers", "404.html"):
            shutil.copyfile(PAGES_FILES / name, directory / name)
        for name, source in assets.items():
            if name in ui_sources or name in style_sources:
                continue
            target = directory / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        for name, source in (sources | style_sources | ui_sources).items():
            target = directory / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(source, encoding="utf-8")


def build(single_file, url, with_prototypes=True):
    output = SITE / ("dist-single" if single_file else "dist")
    with tempfile.TemporaryDirectory(prefix=".build-", dir=SITE) as temporary:
        pending = Path(temporary) / "output"
        pending.mkdir()
        render(pending, single_file, url, with_prototypes)
        issues = check(pending, single_file)
        if issues:
            raise ValueError("\n".join(issues))

        with (SITE / ".build.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            previous = Path(temporary) / "previous"
            if output.is_symlink():
                raise ValueError(f"빌드 경로가 심볼릭 링크입니다 ({output})")
            if output.exists():
                index = output / "index.html"
                if (not index.is_file() or index.is_symlink()
                        or not index.read_text(encoding="utf-8").startswith(BUILD_MARKER)):
                    raise ValueError(f"기존 폴더의 빌드 소유권을 확인할 수 없습니다 ({output})")
                output.rename(previous)
            try:
                pending.rename(output)
            except OSError:
                if previous.exists():
                    previous.rename(output)
                raise
    return output


def main():
    parser = argparse.ArgumentParser(description="랜딩톤 정적 배포 폴더를 빌드합니다.")
    parser.add_argument("--single-file", action="store_true", help="리소스를 index.html에 포함합니다.")
    parser.add_argument("--url", help="공개 HTTPS 주소. 지정 시 1200×630 공유 이미지가 필요합니다.")
    prototypes = parser.add_mutually_exclusive_group()
    prototypes.add_argument("--with-prototypes", action="store_true", default=True, help="물리·모션·FX를 포함합니다 (기본 동작).")
    prototypes.add_argument("--without-prototypes", dest="with_prototypes", action="store_false", help="HTML과 시각 리소스만 확인합니다.")
    args = parser.parse_args()
    try:
        configured = read_metadata().get("url", "").strip()
        url = public_url(args.url if args.url is not None else configured or None)
        output = build(args.single_file, url, args.with_prototypes)
    except (OSError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1
    print(f"빌드 및 한 장 검사 통과 ({output})")
    if args.single_file and url:
        print("공유 이미지 파일은 HTML의 og:image 주소에서 별도로 제공해야 합니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
