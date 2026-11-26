#!/usr/bin/env python3
"""Compare the published F3 footer size with the generic QA byte count."""

import argparse
import re
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from static import LandingPage, V03_SCRIPT_BUDGET, is_hidden


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("build", type=Path)
    args = parser.parse_args()
    html = (args.build / "index.html").read_text(encoding="utf-8")
    page = LandingPage()
    page.feed(html)
    page.close()
    size = page.script_bytes + sum(
        path.stat().st_size
        for path in args.build.rglob("*")
        if path.is_file() and path.suffix.lower() in {".js", ".mjs", ".cjs"}
        and not is_hidden(path.relative_to(args.build))
    )
    expected = (Decimal(size) / 1000).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    text = re.sub(r"\s+", " ", " ".join(page.body_text))
    label = re.search(r"외부 라이브러리\s*0\s*·\s*JS\s*([\d.]+)\s*KB\s*·\s*출처\s*(\d+)\s*개", text)
    actual = label.group(1) if label else None
    ok = bool(label and actual == str(expected) and label.group(2) == "7" and size <= V03_SCRIPT_BUDGET)
    print(f"F3 상태 줄 {'PASS' if ok else 'FAIL'} · JS {size:,}B · 표기 {actual or '없음'}KB / 기대 {expected}KB")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
