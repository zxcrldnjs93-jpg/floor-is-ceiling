# 랜딩톤 통합 구조와 배포

## 3b 통합 구조

`site/modules/hooks.js`가 시각 레이어의 HTML 훅과 `LandingArt`를 받는다. 최종 구성은 S0 → S2 → S3 → S4 → S6 → S7이다.

`site/modules/scenes.js`는 현재 장면, 충격 기록, 재생 여부와 S4 모션 상태를 관리한다. `createBuilding()`의 고정 스텝에서 `createClimaxTimeline()`을 전진시키고 `climaxchange.detail.progress`를 `building.setProgress()`에 전달한다. S2는 마지막 15초 범위의 사건을 최대 12개까지 좌표·번호·지수 그대로 재생한다. 기록이 비어 있으면 엔진의 기준 낙하를 쓴다. S3에서 들린 6층 의자 사건을 S4의 180° 듣기에서 7층으로 재생한다. 듣기와 반전 중에는 방 입력을 장면 처리와 엔진 양쪽에서 확인하며, 재생 및 아래층 관찰값은 유형 판정에서 제외한다. 움직임 줄이기에서는 정지 결과와 교차 전환을 쓰고, 일시정지 설정은 현재 기기에 보관한다. 체험 기록은 메모리에서만 유지한다.

`site/modules/adapters.js`가 물리·모션·FX를 묶는다. 화면 카드와 PNG 모두 7층에서 발생한 사건, 최대 쿵 순간의 방 배치, 위층 유형을 받는다. v0.2는 1차 유형 5종에 `proto/fx/type.js`의 기본 판정표를 적용한다. 결과가 바뀌면 `LandingArt.drawCard()`로 그린 PNG를 미리 준비하고, 공유 버튼에서 FX의 `shareCard()`를 호출한다. 완충재, 센서, 소리·진동은 v2의 1.1 범위다. [스토리 v2](../concepts/FINAL-STORY.md) · [시각 훅 계약](../site/HOOKS.md) · [물리 API](../proto/physics/README.md) · [모션 API](../proto/motion/README.md) · [FX API](../proto/fx/README.md)

### 3b 빌드와 검증

기본 빌드는 물리·모션·FX를 포함한다. `--without-prototypes`는 시각 리소스 미리보기용이다. 일반 모드는 HTML, 모듈, 디자인 CSS·JS·글꼴과 아트를 포함한다. 단일 HTML은 로컬 디자인 파일과 글꼴도 HTML에 넣는다. 토큰을 이미 포함했으므로 디자인 CSS의 개발용 `../tokens.css` import는 산출물에서 제거한다. JS가 정적 QA 예산을 넘으면 Node.js 22에 내장된 Acorn으로 원본과 같은 구문 트리가 나오는 경우에만 산출물의 공백과 주석을 줄인다. 디자인 원본의 S7 외부 출처는 배포 파일에서 문구와 출처 주소 속성을 가진 텍스트가 된다. 페이지의 외부 이동 링크는 S6 투표 안내 한 개다.

배포용 JS는 데모용 물리 브라우저 조작·재현 도구와 모션의 범용 스크롤 트랙·텍스트 분할·패스·카운터·층 표시를 제외한다. 실제 페이지는 장면 상태 기계에서 스크롤과 크기 변경을 측정하고, `LandingBuilding`의 절정 타임라인을 구동한다. 층 표시는 디자인 HUD가 처리한다. 데모는 `proto/`의 전체 API로 실행한다.

```sh
python3 -B arch/build.py
python3 -B arch/build.py --single-file
python3 -B arch/check_one_page.py site/dist
python3 -B arch/check_one_page.py --single-file site/dist-single
qa/run.sh --c11 --static-only site/dist
qa/run.sh --c11 --static-only site/dist-single
node --experimental-vm-modules arch/verify-scenes.mjs
```

모의 DOM 검사는 두 배포 형식에서 7층 충격과 6층 재생의 위치·번호·지수, 6층에서 5층으로 전달되는 의자 사건, 실제 중력 반전과 돌아오기, 듣기 전용 입력 차단, 일시정지 중 스텝 고정, 움직임 줄이기의 교차 표시, 기준 낙하, 유형 판정과 처음부터 다시를 확인한다. 실브라우저 QA는 이 작업 환경의 Chrome 소켓 권한에서 시작이 차단됐다.

### v0.3 연결과 예산

- `createClimaxSensor()`의 권한과 방향 상태는 S4의 `createClimaxTimeline()`에 전달하고, 타임라인이 `connectClimaxPhysics()`를 통해 중력을 전달한다. 센서 중 무대는 0°에 머문다. 화면이 돌아가면 1.2초 뒤 S4-17, 진행률 0.7을 넘으면 S4-18을 해당 cue에서 표시한다. [훅](../site/HOOKS.md#93-s4-센서-선택)
- S1의 포인터·키보드 경로는 같은 120Hz 물리 입력에 연결한다. 긁힘의 번호와 라벨을 S2 재생에 보존한다. S5는 같은 공·높이에서 두 면의 첫 수신값과 6층 진자의 최대 각도를 비교한다. S5는 위층 쿵 테이프와 별도로 집계한다.
- `bindSoundToggle()`은 첫 켜기 클릭에서 FX 인스턴스와 소리 활성화를 시작한다. D2에 따라 진동은 지원 Android에서 기본 켬이며, 화면에 보이는 아래층 수신 사건에만 최대 80ms 적용한다. 일시정지·움직임 줄이기에서는 끈다.
- 배포 사이트의 PNG는 `LandingArt.drawCard()`에서 그린다. FX의 PNG 인코딩·공유는 유지하고, 빌드에서는 별도의 프로토타입 카드 렌더러 사본을 제외한다. S7 엔진 보기는 기본 접힘이며 `?debug`에서 열린다.
- **v0.3 JS 상한은 232 KiB(237,568B)**로 올린다. `build.py`는 200 KiB부터 기존 압축을 적용하고 압축 뒤 모듈과 UI의 합을 232 KiB로 제한한다. 한 장·전체 파일 1.5 MiB 검사는 유지한다. v0.2.2 고정본은 JS 원본 197,924B, 파일별 gzip 합 70,340B, 전체 원본 540,680B였다. 조율의 실크롬 LCP는 84~124ms였다. 32 KiB 원본 증가를 같은 압축률로 환산하면 gzip 약 11.4 KiB다. v0.3의 실제 전송량과 LCP는 통합 뒤 같은 조건에서 다시 측정한다.
- **QA 인계:** v0.3 검사에는 `SCRIPT_BUDGET=237_568`, v0.2.2 고정본에는 `204_800`을 적용한다. 단일 HTML은 import map의 내장 JS도 디코딩해서 같은 예산에 넣는다. 전달 기준은 압축 후 원본 JS 크기다.
- Acorn 공백 압축 뒤에도 232 KiB를 넘으면 esbuild 0.27.7로 산출물의 지역 식별자·공백·구문을 압축한다. `--keep-names`를 유지한다. 빌드는 `PATH`에서 찾거나 `LT_ESBUILD_BIN`으로 지정된 실행 파일의 버전을 확인한다. 일반·단일 빌드는 같은 압축을 적용하며 런타임 의존성은 없다.
- 바닥글의 `<!-- build:js-bytes -->`는 최종 산출물의 디코딩 JS 바이트를 1000으로 나눈 값의 소수 한 자리를 싣는다. `<!-- build:source-count -->`에는 출처 목록 `ul.src`의 항목 수를 싣는다. [시각·동작 훅](../site/HOOKS.md)

## 작업 경계

`site/index.html` 한 문서에 첫 화면, 체험 장면, 결말, 제작과 출처를 순서대로 둔다. 장면 사이에는 `#id` 링크와 실제 문서 스크롤을 쓴다. 작은 추가 안내는 같은 문서의 `<details>`나 `<dialog>`에 넣는다. 체험 장면과 크레딧은 HTML로 먼저 전달하고 JS가 켜진 브라우저에서 상호작용을 보강한다.

- `site/tokens.css`에 디자인 리드가 확정한 글꼴·색·간격·모션 값을 넣는다. 초기 CSS는 시스템 글꼴과 브라우저 색을 사용한다. 핵심 CSS와 토큰은 빌드에서 `<head>`의 `<style>`에 합친다.
- `site/index.html`은 `id`와 `data-scene`이 같은 S0~S7 장면을 순서대로 담는다. `site/modules/scenes.js`가 HTML에서 장면을 등록하고 `data-action` 버튼을 연결한다. 페이지가 파싱된 뒤 실행되는 진입점은 `type="module"`의 기본 지연 실행을 쓴다.
- 각 장면에는 `data-physics`, `data-motion`, `data-fx` 슬롯이 있다. 모듈은 `site/modules/adapters.js`에서 연결한다. `MediaQueryList`로 움직임 줄이기 설정이 실행 중에 바뀌는 경우를 처리하고, 페이지 종료 신호로 리스너와 실행 중인 재생을 정리한다. 스크롤과 키보드 탐색은 문서의 기본 동작을 사용한다.
- 각 `.js`의 경로가 모듈 이름이다. 예를 들어 `site/modules/scenes.js`는 `@landing/scenes.js`로 가져온다. 브라우저 import map이 일반 빌드에서 상대 URL을, 단일 파일 빌드에서 내장된 모듈을 가리킨다. 진입점은 `site/modules/main.js`다. 엔진을 합칠 때도 의존 모듈을 이 이름으로 가져오면 두 빌드에서 같은 소스를 사용한다.

### 3a 장면과 엔진 접점

`--with-prototypes`를 더하면 `proto/`의 물리·모션, 문서가 준비된 FX 모듈과 모션 CSS를 빌드에 포함한다. 원본의 상대 import는 빌드에서 대상 모듈 별칭으로 연결한다. 일반·단일 파일 빌드의 모듈 주소가 달라도 `proto/`의 원본을 함께 사용할 수 있다. 모션의 고전 스크립트는 부수효과 import로 실행한다.

| 장면 | 물리 슬롯 | 모션 슬롯 | FX 슬롯 |
|---|---|---|---|
| S0 7층 | `slab`, 탭으로 기록 | `slab-intro`, 충격량을 파동으로 전달 | `first-impact`, 피드백 |
| S1 쿵 행동 | `record-impact`, 걷기·의자·떨어뜨리기 | `action-impact`, 행동 변화 | `record-feedback`, 상대 쿵 지수 |
| S2 6층 | `replay-pendulum`, S0·S1 기록 재생과 진자 자리 | `replay-cue`, 진행률 60% 또는 재생 버튼 | `replay-feedback`, 기록된 값 |
| S3 5층 | `transmit-impact`, 이어지는 층의 충격 자리 | `floor-continuation`, 하강 모션 자리 | `floor-echo`, 층 전달 효과 자리 |
| S4 숫자 | `building-overview`, 건물 단면 자리 | `counter`, 확인된 수치와 카운터 자리 | `statistic-feedback`, 시각 보조 자리 |
| S5 완충재 | `material`, 같은 행동으로 매트 비교 | `material-comparison`, 재질 변화 자리 | `material-feedback`, 상대값 비교 |
| S6 뒤집기 | `reverse-gravity`, 중력 방향 변경과 위층 기록 재생 | `flip-stage`, 국소 회전 프리뷰와 페이지 레이어 접점 | `perspective-feedback`, 아래층에서 듣는 자리 |
| S7 결과 | `result-record`, 행동·충격 표본 | `result-reveal`, 결과 등장 자리 | `share-feedback`, 유형 판정·저장·공유 |

물리 연결은 `createRoom()`·`roomInput()`·`recordImpacts()`로 장면에 전달할 실제 충돌 표본을 얻고, `playImpactTrack()`으로 표본 시각과 순서를 재사용한다. S5는 같은 직전 행동을 매트 적용 전후로 실행한다. S6 버튼은 `World.gravity()`로 방향을 바꾸고 `data-perspective`를 갱신한다. `data-flip-layer`에는 엔진에서 읽은 중력 벡터를 반영한다. 화면 안의 실제 바디를 구동하는 3b에서 진행 틱도 연동한다. 진자 렌더링의 접점은 S2의 물리 슬롯과 재생 콜백이다. [물리 README](../proto/physics/README.md)

모션은 `LandingMotion.createMotion()`과 `addScene()`을 쓰고, `LandingBuilding`이 포함되면 `createSlabWave()`와 `createPageFlip()`으로 S0·S2 파동과 S6의 장면 레이어를 작동시킨다. S6의 전체 화면 대상은 3b 디자인에 맞춰 `data-page-stage` 아래에서 정한다. 카피는 국소 회전 레이어 밖에 있다. 일시정지는 스크롤 타임라인과 진행 중인 재생을 중단하고 파동·회전을 정적 결과로 표시한다. 토글 해제 시 타임라인이 재등록된다. OS의 움직임 줄이기에서는 정지 프레임과 축소 모션 경로를 사용한다. [모션 README](../proto/motion/README.md)

FX가 포함되면 `classifyBehavior(record)`의 결과를 S7 HTML에 표시하고 `renderCard()`·`exportCardPng()`·`downloadCardPng()`로 저장한다. 링크 공유는 canonical을 사용한다. S0~S6의 사운드와 진동은 UX가 확정되면 `createAudioEffects()`·`vibrate()`를 사용자 조작에 연결할 자리다. [FX README](../proto/fx/README.md)

3b에서 스토리와 시각 자리표시를 교체한다. 투표 링크는 공개 전 Parallax 랜딩톤 주소를 쓰고, 제출 후 확정된 작품 주소로 바꾼다. OG 이미지 위치는 `site/assets/og.png`다.

### 과제 진행 중 반영한 사실 확인

S4는 2025년 아파트 거주 가구 54.5%, 2020년부터 해마다 3만 건 이상인 상담 **접수**와 2025년 32,662건, 직접충격 소음 1분 등가소음도 기준 주간 39 dB(A)·야간 34 dB(A)를 사용한다. 일부 공동주택의 보정 규정은 별표를 따른다고 안내한다. 바닥글에 출처와 이웃사이센터 연락처 1661-2642를 표시한다. [사실 확인 기록](../research/factcheck-c11.md) · [국가데이터처 브리핑](https://www.korea.kr/briefing/policyBriefingView.do?newsId=156772432) · [이웃사이센터 통계](https://floor.noiseinfo.or.kr/floornoise/home/statistics/all.do) · [층간소음 규칙 별표](https://www.law.go.kr/LSW/lsBylInfoPLinkR.do?bylSeq=15201651&lsiSeq=247421&viewerPopYn=Y)

S6 반전은 아래층에서 기존 기록을 받는 흐름이다. 반전 상태에서 앞 장면으로 스크롤해도 충격 입력은 기록되지 않는다. 유형 판정은 7층에서 한 행동만 읽는다. 이후 시안과 효과에도 적용할 범위다. [사실 확인 기록 4.1절](../research/factcheck-c11.md) · [대법원 2023도10313](https://law.go.kr/LSW/precInfoP.do?precSeq=238929)

## 로컬 빌드

Linux와 Python 3.11 이상에서 프로젝트 루트 기준으로 실행한다. 일반 빌드와 단일 파일 빌드는 Python 표준 라이브러리를 사용한다.

```sh
python3 -B arch/build.py
python3 -B arch/build.py --single-file
python3 -B arch/build.py --with-prototypes
python3 -B arch/build.py --single-file --with-prototypes
python3 -B arch/check_one_page.py site/dist
python3 -B arch/check_one_page.py --single-file site/dist-single
```

| 모드 | 출력 | 사용 |
|---|---|---|
| 일반 | `site/dist/index.html`, `modules/`, 자산, `_headers`, `404.html` | 정적 호스팅에 올리는 기본 모드. 일반 빌드의 JS 모듈을 로컬에서도 보려면 정적 HTTP로 제공한다. |
| 단일 파일 | `site/dist-single/index.html` | 오프라인 전달, 단일 HTML 요구 시 사용. import map을 지원하는 브라우저에서 파일을 열 수 있다. |

빌드는 산출물을 검사한 뒤 기존 빌드를 교체한다. 신규 구성으로 검사에 실패하면 이전 성공 빌드가 유지된다. 일반 빌드의 재료는 `site/`에서 가져오며 원본 HTML의 자리표시자는 빌드 시 채워진다. 폴더형 JS·이미지·글꼴은 상대 주소를 써서 GitHub Pages 하위 경로에서도 동작한다.

두 모드에 같은 리소스를 적용하려면 HTML이나 인라인될 CSS에서 `{{asset:assets/파일경로}}`를 사용한다. 실제 파일 경로는 영문·숫자와 `_.-`를 쓴다. 예를 들어 `<img src="{{asset:assets/hero.webp}}" width="1440" height="900" alt="…">`는 일반 빌드에서 `./assets/hero.webp`로, 단일 파일에서 데이터 URL로 바뀐다. JS에서 리소스가 필요하면 HTML의 `data-*`에 동일 토큰을 두고 읽는다. 원격 리소스를 읽는 SVG나 JS가 추가될 때는 오프라인 실행도 확인한다. 단일 파일은 데이터 URL의 크기 증가와 자산별 브라우저 캐시 손실이 있으므로 공개 제출에는 일반 모드를 우선한다.

### 한 장 규칙 검사

빌드와 별도로 `check_one_page.py`를 실행할 수 있다. 추가 HTML 파일, 앵커 대상 누락, 상대 경로와 공개 주소 기준의 같은 호스트 내부 링크, 폼 이동, `meta refresh`, 일반적인 JS의 `history.pushState`·`location`·라우터 패키지 사용과 대표 호스팅 리다이렉트 설정을 검사한다. 같은 문서의 `#id`는 통과한다. 크레딧 등 직접 클릭하는 외부 출처 링크는 허용한다. 일반 빌드의 루트 `404.html`은 `arch/pages/404.html`과 내용이 같을 때만 통과한다. 이 문서는 `noindex`와 해시를 유지하는 `/` 귀환을 제공한다. 단일 파일 모드에서는 일반 HTML·CSS 리소스 URL과 모듈 주소도 검사한다.

공개 URL을 지정한 빌드에서는 canonical의 호스트와 하위 경로로 절대 링크를 판단한다. 프리뷰 빌드는 상대 경로를 검사할 수 있다. 계산된 URL이나 동적 DOM, 호스팅 대시보드 규칙은 수동 검증 대상이다. 브라우저에서 각 장면과 CTA를 키보드·터치로 실행하고, 처음 주소와 마지막 주소가 같은 문서를 가리키는지 확인한다.

## 글꼴 자체 호스팅

디자인 확정 전 프리뷰에서는 시스템 글꼴을 쓴다. 확정 후 라이선스와 함께 배포 가능한 글꼴을 `site/assets/fonts/`에 두고 `site/tokens.css`에서 연결한다. 첫 화면에 필요한 글꼴만 초기 로드 대상으로 검토한다. `font-display: swap`을 기본으로 하고, 한글의 표시 폭이 바뀌어 레이아웃이 밀리는지 모바일에서 확인한다.

```css
@font-face {
  font-family: "Landing Display";
  src: url("{{asset:assets/fonts/display.woff2}}") format("woff2");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}
:root { --font-display: "Landing Display", system-ui; }
```

1. 최종 본문, 버튼, 오류·상태 카피, CSS와 JS에서 추가하는 화면 문자열을 NFC UTF-8 목록으로 모은다. 고정 문구는 이 목록으로 서브셋하고 방문자 입력 등 범위가 열린 문자열에는 충분히 넓은 폰트 또는 시스템 글꼴을 쓴다.
2. `fc-match -f '%{file}\n%{index}\n' 'Noto Sans CJK KR'`로 실제 파일과 TTC face 번호를 확인한다. 이 환경에서는 `/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc`의 `1`이다. `pyftsubset` 실행 파일은 있지만 `fontTools` 모듈이 없어 실행되지 않는다.
3. 네트워크 없이 설치된 `libharfbuzz`와 `libharfbuzz-subset`을 사용하는 아래 명령으로 OTF를 만들 수 있다. OTF를 사용할 때 CSS의 확장자는 `.otf`, `format()`은 `opentype`으로 바꾼다. TrueType 입력이면 `.ttf`와 `truetype`을 쓴다.
4. `fc-scan --format '%{family}\n%{charset}\n'`으로 결과를 확인하고 화면의 한글·숫자·기호와 줄바꿈을 확인한다. 새 문구를 넣으면 서브셋을 다시 만든다. 원본 OFL 고지, 수정 내역, 배포 이름은 [출처 원장](../site/LICENSES.md)에 맞춰 기록한다.

```sh
python3 -B arch/subset_font.py \
  --font /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc \
  --font-index 1 --text-file site/font-copy.txt \
  --output site/assets/fonts/display.otf
```

WOFF2가 필요한 경우 권리 확인을 마친 기존 서브셋 WOFF2를 함께 전달받거나 `woff2_compress`가 있는 환경에서 서브셋 OTF/TTF를 변환한다. 이 환경에는 `hb-subset`, `woff2_compress`, FontForge CLI가 없고, HarfBuzz 공유 라이브러리로 OTF까지 생성할 수 있다. `fontTools`와 Brotli가 준비된 환경에서는 `pyftsubset 원본.ttc --font-number=1 --text-file=site/font-copy.txt --flavor=woff2 --output-file=site/assets/fonts/display.woff2`를 사용할 수 있다. 글꼴 출처와 라이선스는 로컬 패키지에서 확인했다. [Noto CJK](https://github.com/notofonts/noto-cjk)

## 공유 카드와 공개 빌드

디자인 시안의 한 문장과 핵심 오브젝트로 1200×630 카드를 내보내 `site/assets/og.png`에 둔다. 이미지 가운데에 제목과 핵심 오브젝트를 놓아 작은 미리보기에서도 읽히게 한다. 아래 Pillow 명령은 글자 위주의 임시 카드 생성 예시다. 최종 제목, 카드 설명과 색은 시안에 맞춰 입력한다.

```sh
python3 -B arch/make_og.py \
  --title '공유 카드 제목' --subtitle '작품의 한 문장' \
  --font /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc --font-index 1 \
  --background '#ffffff' --foreground '#111111'
python3 -B arch/build.py
```

공개 시 `site/metadata.json`에 `"url": "https://example.test/landingthon/"`처럼 실제 HTTPS 주소를 넣는다. 다음 빌드가 canonical, `og:url`, 절대 `og:image`를 채운다. 주소가 비어 있으면 일반 빌드는 상대 이미지 경로를 쓰고 정적 QA에 공개 주소 검토가 남는다. 단일 HTML의 로컬 미리보기에는 이미지를 포함한다. 공개 시에는 배포 폴더의 1200×630 OG PNG도 함께 제공한다.

`description`은 검색용 `meta name="description"`에 쓴다. `shareDescription`을 넣으면 `og:description`과 `twitter:description`은 이 짧은 문장을 쓴다. `shareDescription`을 생략하면 세 태그 모두 `description`으로 채운다.

공개 후 로그인하지 않은 브라우저에서 작품과 PNG가 열리는지 확인한다. 보기 URL을 바꾸지 않고 카드만 수정할 때는 공유 서비스의 캐시 갱신 여부를 확인한다. 사용한 자산의 출처와 라이선스는 [출처 원장](../site/LICENSES.md)과 같은 문서의 `#credits`에 기록한다.

## 호스팅 비교

아래는 일반적인 정적 호스팅 동작과 기본 공개 주소 형식이다. 이 작업 환경에서는 한국 회선의 지연 시간이나 배포 계정 상태를 측정할 수 없었다. 공개 후보는 같은 산출물을 기준으로 한국 모바일 회선과 데스크톱에서 첫 HTML, 주요 자산, 공유 카드의 응답을 확인한다.

| 서비스 | 속도와 한국 접속에서 확인할 점 | 기본 공개 URL | 배포·방문 계정 |
|---|---|---|---|
| GitHub Pages | 정적 CDN 서빙. 첫 HTML·폰트의 캐시 응답과 프로젝트 하위 경로를 확인 | `https://user.github.io/repo/` | GitHub 계정과 저장소 권한 필요. 공개 페이지 방문자는 계정 불필요 |
| Cloudflare Pages | Cloudflare 엣지에서 정적 파일 서빙. 한국 모바일의 엣지 응답과 캐시 적중 여부를 확인 | `https://project.pages.dev/` | Cloudflare 계정 필요. Direct Upload는 Git 연동 없이 가능. 공개 페이지 방문자는 계정 불필요 |
| Netlify | 정적 CDN 서빙. 기본 도메인과 업로드 직후 최신 산출물의 응답을 확인 | `https://project.netlify.app/` | Netlify 계정 필요. 수동 배포도 가능. 공개 페이지 방문자는 계정 불필요 |
| Vercel | 정적 CDN 서빙. 프로젝트의 공개 프로덕션 주소에서 파일 캐시와 미리보기 보호 여부를 확인 | `https://project.vercel.app/` | Vercel 계정과 프로젝트 권한 필요. 공개 프로덕션 방문자는 계정 불필요 |
| Neocities | 파일을 직접 올리는 정적 호스팅. 한국에서 첫 HTML과 큰 자산의 응답을 별도 확인 | `https://name.neocities.org/` | Neocities 계정 필요. 공개 페이지 방문자는 계정 불필요 |

공식 확인 경로는 아래와 같다. 현재 계정 조건과 배포 설정은 실제 게시 시 확인한다.

- [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages)
- [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Netlify 수동 배포](https://docs.netlify.com/deploy/create-deploys/)
- [Vercel 배포](https://vercel.com/docs/deployments/overview)
- [Neocities](https://neocities.org/)

첫 게시 후보는 Cloudflare Pages Direct Upload다. `site/dist/`를 올리는 방식이 현재 빌드와 바로 맞는다. 기존에 사용 가능하고 공개된 다른 호스팅 계정이 있다면 그쪽에서 먼저 검증하는 편이 빠를 수 있다. GitHub Pages를 고르면 별도 공개 저장소의 프로젝트 경로 또는 Pages 작업에 `site/dist/` 산출물만 전달한다.

## 이른 1차 제출

BRIEF 기준 마감은 **12월 4일 24:00 KST**다. 동점 시 제출순이 적용되므로 핵심 장면과 공개 URL이 확인되는 첫 버전을 조율자가 이르게 제출하고, 동일한 공개 URL에서 나머지 개선을 이어간다.

| 목표 시점 KST | 준비물 및 통과 조건 |
|---|---|
| 11/25~11/26 | 컨셉·카피·시각 방향 확정, 같은 주소에서 작동하는 핵심 체험 한 개, 모바일과 키보드 조작, 출처 원장 초안 |
| 가능한 첫날, 11/27 목표 | 1200×630 공유 카드와 데스크톱·모바일 스크린샷, 한 장 검사, 로그인 없이 열리는 프로덕션 URL, 브라우저 오류 및 핵심 경로 확인. 조율자가 제출 후 접수 시각·공개 URL·수정 화면을 기록 |
| 11/28~12/2 | 조율된 디자인과 모션 완성, QA에서 저사양·작은 화면·움직임 줄이기 확인. 같은 URL에 개선본을 올리고 필요 시 제출 스크린샷과 카드 갱신 |
| 12/3~12/4 20:00 | 제출 링크와 PNG 요청, 최종 스크린샷, 크레딧, 롤백용 이전 산출물 확인. 심사에 쓰일 공개 주소와 최종 버전을 조율자가 확인 |

이번 작업에서는 로컬 산출물만 생성한다. 공개 게시와 해커톤 제출은 조율자가 맡는다.

## 3a 로컬 검증 결과

- 프로토타입 포함·미포함으로 일반 빌드와 단일 HTML 빌드를 각각 실행했다. 두 출력의 C11 정적 검사는 실패 0건, 허용 투표 링크 1개였다. `og:image`, `og:url`, 색 대비는 최종 이미지·공개 URL·시안으로 확인한다.
- S0~S7의 순서와 장면별 슬롯 24개를 확인했다. Node 모의 DOM에서 실제 충격 기록·재생, 같은 물건을 떨어뜨린 예시의 매트 전후 상대값 50→37, 180° 장면 레이어, 실제 중력 `920 → -920 → 920`, 일시정지, 움직임 줄이기, 반전 상태의 신규 입력 차단과 7층 복귀 후 조작, 링크 복사를 확인했다.
- 전체 화면 회전 레이어와 실제 바디·진자 렌더링, 최종 카피·디자인, 실브라우저와 모바일 검증은 3b에서 이어간다.

## 1단계 로컬 검증 이력

- 일반과 단일 파일 빌드에서 프로토타입 포함·미포함 경로가 각각 통과했다. 하위 경로 공개 설정으로 canonical과 OG 절대 URL, PNG와 글꼴 인라인, 위반 빌드 실패 시 이전 결과 보존을 확인했다.
- 정상 앵커와 외부 출처를 통과시켰다. 내부 링크·라우팅·추가 HTML·단일 파일 외부 참조 등 위반 19개 유형을 탐지했다.
- Node 모의 DOM에서 두 모드의 진입 모듈과 장면 토글, 페이지 캐시 복귀, 모션 60% 경계의 물리 바디 생성, 역행·움직임 줄이기 시의 해제를 확인했다. 두 엔진 파일 읽기와 모션 CSS 포함도 확인했다.
- 로컬 Noto Sans CJK KR로 예시 문구의 22,520바이트 OTF 샘플을 만들고 `fc-scan`으로 한글 범위를 확인했다. Pillow 출력은 1200×630 PNG였다. 시안이 정해지면 실제 글꼴·카드를 같은 절차로 다시 만든다.
- 실행 환경의 소켓 제한으로 헤드리스 Chrome 시작이 차단됐다. 실제 브라우저 렌더링, CSS 네이티브 모션 경로, 모바일 입력 및 한국 접속 성능은 후속 확인 대상이다.
