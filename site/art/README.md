# site/art — 정적 그림 (lt-opus-design)

화면의 단면도와 물건은 `site/ui/*.js`가 코드로 그린다. 이 폴더에는 공유용 정적 그림만 둔다.

| 파일 | 크기 | 쓰임 | 원본 |
|---|---|---|---|
| `og-1200x630.png` | 1200×630 PNG | 링크 미리보기(카카오톡·SNS). 빌드(`arch/build.py`)가 이 파일을 찾아 og 메타를 쓴다 | **v1.0d:** `design/final/og-v10/og.html` → `node design/final/og-v10/render.mjs`(이 파일을 바꿔 쓴다). 이전 판(`design/final/export-og.html`, '쿵 #1 84')은 `design/final/og-v10/src/og-old.png`에 남겼다 |

모두 이 프로젝트에서 직접 그렸다(외부 이미지·아이콘 없음). 글꼴은 Hahmlet(OFL-1.1).
