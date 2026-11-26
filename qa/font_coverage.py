from pathlib import Path
from subprocess import run
from tempfile import NamedTemporaryFile
import json
import re
import sys
import unicodedata


def story_copy():
    story = Path(__file__).resolve().parent.parent / "concepts" / "FINAL-STORY.md"
    document = story.read_text(encoding="utf-8")
    sections = re.split(r"^## ", document, flags=re.M)
    section = next((part for part in sections if part.startswith("10. ")), "")
    rows = re.findall(r"^\|\s*(?:S\d+|U)-\d+[a-z]?\s*\|[^|]*\|([^|]*)\|([^\n]*)", section, flags=re.M)
    if not rows:
        raise ValueError("FINAL-STORY.md의 카피 덱을 읽을 수 없습니다.")
    types = re.search(r"^### 6\.3[^\n]*\n(.*?)^### 6\.4", document, flags=re.M | re.S)
    type_rows = re.findall(r'^\|\s*([^|]+)\|\s*"([^"]+)"\s*\|', types[1], flags=re.M) if types else []
    return "".join(copy for copy, notes in rows if "확정 전" not in notes) + "".join(name + copy for name, copy in type_rows)


def missing_glyphs(font, copy=""):
    # 괄호 자리표시자와 아이콘은 글꼴로 그리는 카피에서 제외한다.
    copy = unicodedata.normalize("NFC", re.sub(r"\{[^}]*\}", "", story_copy()) + copy)
    required = {ord(char) for char in copy if (char.isprintable() and not char.isspace()
                                             and char not in "`⟲↔")}
    with NamedTemporaryFile(suffix=".woff2") as handle:
        handle.write(font)
        handle.flush()
        # A variable font can produce several faces. Separate the last range of
        # one face from the first range of the next.
        result = run(["fc-query", r"--format=%{charset}\n", handle.name], capture_output=True, text=True)
    if result.returncode or not result.stdout.strip():
        raise ValueError("Hahmlet 서브셋의 글리프 목록을 읽을 수 없습니다.")
    covered = set()
    for entry in result.stdout.split():
        first, _, last = entry.partition("-")
        covered.update(range(int(first, 16), int(last or first, 16) + 1))
    return "".join(chr(code) for code in sorted(required - covered))


if __name__ == "__main__":
    try:
        print(json.dumps({"missing": missing_glyphs(sys.stdin.buffer.read())}, ensure_ascii=False))
    except (OSError, ValueError) as error:
        print(error, file=sys.stderr)
        raise SystemExit(2)
