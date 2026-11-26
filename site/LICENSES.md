# 출처 및 라이선스 원장

| 대상 | 작성자·권리 | 출처·라이선스 | 배포 위치·크레딧 | 상태 |
|---|---|---|---|---|
| 초기 HTML·CSS·장면 모듈·빌드 스크립트 | 랜딩톤 프로젝트 | 이 작업에서 작성 | `site/`, `arch/`, 본문 하단 `#credits` | 작성 완료 |
| 초기 화면의 시스템 글꼴 | 방문자의 운영체제 | 브라우저의 `system-ui`, 글꼴 파일 재배포 없음 | 브라우저에서 선택 | 사용 중 |
| 물리·모션 프로토타입 | lt-sol-physics, lt-sol-motion | 이 프로젝트에서 작성. [물리 README](../proto/physics/README.md) · [모션 README](../proto/motion/README.md) | `--with-prototypes`일 때 엔진 및 모션 스타일 포함. 실제 장면에 연결할 때 `#credits`에 담당 반영 | 선택 빌드에서 사용 |
| 판정·카드 및 효과 프로토타입 | lt-sol-ideas | 이 프로젝트에서 작성한 코드·합성음·캔버스 도형. [FX README](../proto/fx/README.md) | `--with-prototypes`에서 판정·카드 저장·링크 복사에 연결 | 선택 빌드에서 사용 |
| **Hahmlet 가변(wght 100–900) 서브셋** `site/fonts/hahmlet-subset.woff2` | Copyright 2020 The Hahmlet Project Authors (https://github.com/hyper-type/hahmlet) — Hypertype(함민주, Mark Frömberg) | **SIL Open Font License 1.1**. 원문 전문 `site/fonts/OFL.txt`(google/fonts 저장소 `ofl/hahmlet/OFL.txt`에서 받음). 예약 글꼴 이름 없음(저작권 줄에 "with Reserved Font Name" 없음). 수정 내역: 화면 문구 674자(한글 562음절, v0.4)만 남긴 서브셋, 가변 축 유지, Google Fonts CSS2 API `text=`로 생성. 재현: `node site/fonts/fetch-hahmlet.mjs` → `subset-info.json`·`font-copy.txt` | `site/tokens.css`의 `@font-face`. 크레딧: 본문 S7 `#credits` "글꼴 Hahmlet — SIL Open Font License 1.1" + `<details>` 글꼴 라이선스 | 사용 중 (lt-opus-design) |
| 단면도 선화·카드·공유 이미지 | 랜딩톤 프로젝트(lt-opus-design) | 이 작업에서 코드로 직접 그림(`site/ui/*.js`, `design/final/`). 외부 이미지·아이콘 없음 | 화면 전체, `design/final/export/*.png`, `site/art/` | 사용 중 |
| Noto Sans CJK KR Regular 후보 | Google 및 Noto CJK 기여자 | SIL Open Font License 1.1. 로컬 패키지 `/usr/share/doc/fonts-noto-cjk/copyright` 확인. [Noto CJK](https://github.com/notofonts/noto-cjk) | 자체 호스팅으로 확정하면 파일·고지·변경 내역 추가 | 로컬 도구 검증에 사용 |

이미지·글꼴·음원·영상·코드와 AI 생성물을 채택하면 작성자나 도구, 원본 URL 또는 생성 근거, 이용·수정·재배포 조건, 사용 파일 및 고지 위치를 한 줄씩 적는다. 줄이 생길 때마다 `index.html`의 `#credits`에도 필요한 고지를 반영한다. AI 생성물은 사용 모델과 당시 이용 조건, 참조 자산의 권리도 확인한다.

폰트 서브셋을 배포할 때는 원본 저작권과 OFL 전문을 함께 제공하고, 수정과 이름에 적용되는 원본 조건을 확인한다. 공개 HTML에서 직접 고지가 필요하면 `#credits` 안의 `<details>`에 넣는다. 단일 파일로 전달할 때도 함께 읽을 수 있어야 한다.
