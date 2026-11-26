# 중력을 뒤집으면 — 내 ‘쿵’을 아래층에서 들어 보기

내 바닥은 누군가의 천장입니다. 7층에서 공을 높이 떨어뜨릴수록 커지는 ‘쿵’을, 직접 만든 물리엔진이 6층 천장에서 그대로 다시 울립니다. 중력을 뒤집으면 이번엔 당신이 아래층이 됩니다.

- 데모: https://floor-is-ceiling.pages.dev/
- Parallax 해커톤 「제1회 해커톤: 랜딩톤」 출품작입니다. 한국환경공단과 관련이 없습니다.

## 폴더

| 폴더 | 내용 |
|---|---|
| `site/` | 페이지 마크업(`index.html`), 장면 연결(`modules/`), 화면 층(`ui/`, `styles/`, `tokens.css`), 글꼴 서브셋, 공유 이미지 |
| `proto/physics/` | 직접 만든 2D 물리엔진(`engine.js`), 건물·층간 전달(`building.js`), 충돌 기록 재생(`replay.js`)과 검증 |
| `proto/motion/` | 스크롤 장면 엔진과 건물 회전 |
| `proto/fx/` | Web Audio 합성음, 진동, 끝 카드, 물리엔진 보기 |
| `arch/` | 빌드(`build.py`), 한 장 규칙 검사, 글꼴 서브셋·공유 이미지 생성 |
| `qa/` | 헤드리스 Chrome 장면 검증, 접근성·대비·글꼴 검사, 영상 녹화 도구 |

외부 런타임 라이브러리는 없습니다. 페이지는 빌드 산출물 하나로 동작합니다.

## 빌드

Python 3과 Node.js가 필요합니다. JS 예산 압축에 esbuild 0.27.7 실행 파일을 씁니다.

```bash
LT_ESBUILD_BIN=/path/to/esbuild python3 -B arch/build.py
LT_ESBUILD_BIN=/path/to/esbuild python3 -B arch/build.py --single-file
```

- `site/dist/`: 배포용(Cloudflare Pages Direct Upload)
- `site/dist-single/index.html`: 글꼴까지 넣은 단일 HTML

이 저장소에서 빌드한 `site/dist/`는 공개 데모와 파일 단위로 같습니다(목록 해시 `a5a71c17`, v1.0g).

## 검증

```bash
node proto/physics/verify.mjs
node --experimental-vm-modules arch/verify-scenes.mjs
```

- 물리 검증: 바로 선 건물에서는 6층 → 5층, 뒤집힌 뒤에는 6층 → 7층으로 충격이 전달됩니다. 천장으로 가는 전달은 0건이고, 기준 낙하는 쿵 100입니다.
- 장면 검증: 두 빌드 형식에서 낙하·끌기·던지기·재생·반전·매트·끝 카드·엔진 보기를 확인합니다. 단일 HTML 빌드가 먼저 있어야 합니다.
- `qa/run.sh`와 `qa/record.mjs`는 설치된 Chrome으로 실제 화면을 검사합니다.

## 쿵 지수

‘쿵 지수’는 바닥(슬래브)이 받은 충격의 세기를 견주는 값입니다. 방 절반 높이에서 떨어진 공이 100입니다. 실제 소음(dB)이 아니고, 200이 두 배로 시끄럽다는 뜻도 아닙니다.

## 만든 방식

Claude·Codex 에이전트와 함께 설계·제작했고, 사람이 검수했습니다.

## 라이선스

- 글꼴: Hahmlet 서브셋, SIL Open Font License 1.1(`site/fonts/OFL.txt`, `site/LICENSES.md`)
- 그 밖의 코드와 그림은 따로 라이선스를 정하지 않았습니다.
