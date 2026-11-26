# 시각 층 훅 계약 (lt-opus-design → lt-sol-arch)

작성 2026-11-24 (3b). 기준: `concepts/FINAL-STORY.md` v2(장면 번호·카피 덱 10절·1차 범위 11절), `discussion/lt-sol-arch-조율.md`의 요청.
시각 층 파일: `site/index.html`(마크업), `site/tokens.css`, `site/styles/site.css`, `site/ui/{section,stage,hud,card}.js`, `site/fonts/`, `site/art/`.
`site/modules/`, `arch/`는 건드리지 않았다. **현재 `modules/scenes.js`는 v1 구조(s1·s5 필수, s6=뒤집기, s7=결과)를 가정하고 있어 이 마크업과 맞지 않는다. 5절 목록대로 연결을 바꿔 주세요.**

미리 보는 법(빌드 없이): `site/index.html`을 그대로 연다. 엔진 상태는 `?scene=s4&preview=flipped`처럼 확인한다(7절).

---

## 1. 장면 (v2 번호, 1차 범위)

| v2 | `section` | `data-floor` | 직계 패널 | 무대 `[data-stage]` · `data-physics` | 비고 |
|---|---|---|---|---|---|
| S0 7층 | `#s0[data-scene=s0]` | `7` | `data-motion="slab-intro"` `data-motion-sticky` | `s0` · `slab` | 섹션 100svh |
| S2 6층 | `#s2[data-scene=s2]` | `6` | `replay-cue` · sticky | `s2` · `replay-pendulum` | 140svh. 진행률 0.2(스토리)·0.6(현 어댑터) 재생 시작 |
| S3 5층 | `#s3[data-scene=s3]` | `5` | `floor-continuation` · sticky | `s3` · `transmit-impact` | 100svh |
| S4 절정 | `#s4[data-scene=s4]` | `7 6 5` (세 칸 모두 켬) | `flip-stage` · sticky | `s4` · `reverse-gravity` | 260svh. `[data-flip-layer]`는 무대 안 |
| S6 끝 화면 | `#s6[data-scene=s6]` | `7` | `result-reveal` (**sticky 아님**, 일반 흐름) | `s6` · `result-record` | 엘리베이터 안 |
| S7 바닥글 | `#s7[data-scene=s7]` | — | — | 없음 | 안에 `<footer id="credits">`, `#sources` 유지 |

- **S1·S5([1.1])는 1차 마크업에 없다.** 1.1에서 같은 규칙으로 추가한다.
- 섹션 길이는 `styles/site.css`의 `.scene[data-scene=…]{min-height}`, 패널은 `position:sticky; top:0; height:100svh`.

## 2. 버튼·누름 영역 `data-action`

| 동작 | 요소 | 장면 | 초기 상태 |
|---|---|---|---|
| `tap` | 버튼 "바닥 톡"(S0-03), 바닥 누름 영역 `[data-hit="7"]` | S0 | 버튼 `hidden`(JS가 켬). 누름 영역은 보임(`aria-hidden`) |
| `drop` | 버튼 "공 떨어뜨리기"(S0-03), 공 바디 `[data-physics-body="7:ball"]` | S0 | 버튼 `hidden` |
| `drop-high` (v0.2.2) | 버튼 "높은 데서 떨어뜨리기"(S0-03 선택 버튼, [공 떨어뜨리기] 옆) — **키보드로도 높이 낙하를 할 수 있게**(C1 동등성). lt-sol-arch가 `ACTIVE_ACTIONS`에 넣고 **최고 높이(height 0) 낙하**로 연결한다. 연결 전에는 `enabled()`가 모르는 동작이라 숨은 채로 남는다 | S0 | `hidden` |
| `replay` | 버튼 "다시 듣기"(S2-04) | S2 | `hidden` |
| `nudge` | 버튼 "6층 의자 밀기"(S3-02), 의자 바디 `[data-physics-body="6:chair"]`(S3), `[data-hit="6"]` | S3 | 버튼 `hidden` |
| `flip` | 버튼 "중력 뒤집기"(S4-03, 아이콘은 SVG) `aria-pressed` | S4 | `hidden` |
| `reset-flip` | 버튼 "원래대로 돌리기"(S4-09), 듣기 큐 안 | S4 | `hidden` |
| `save` · `share` · `restart` | "카드 저장" · "공유하기" · "처음부터 다시"(S6-02) | S6 | `hidden` |

- `#motion-pause`(U-04)는 머리띠에 있다. 초기 상태는 `hidden`, `data-pressed="false"`다. `scenes.js`가 누르는 동작을, `hooks.js`가 상태를 관리한다. `ui/hud.js`는 `data-pressed`를 읽어 `[data-pause-label]`을 "움직임 일시정지" ↔ "움직임 다시 켜기"로 바꾼다. 버튼의 접근 이름이 할 동작을 설명한다.
- 소리 토글(U-05)은 9.2절을 따른다.
- **뒤집힌 동안(듣기 전용)** S4 안의 방 누름 영역은 없다. 다른 장면의 `tap`·`drop`·`nudge`를 막는 일은 scenes.js 담당이다(FINAL-STORY 1.1, 대법원 2023도10313).

## 3. 무대 요소 (위치·모양은 `ui/stage.js`가 놓는다)

### 3.1 물리 바디 `[data-physics-body="층:이름"]`

| 장면 | 바디 |
|---|---|
| S0 | `7:ball`(`data-action=drop`), `7:chair`, `7:cup` (모든 폭에서 보임 — 숨긴 바디가 물리에서 부딪히는 일이 없게, v0.1.1 B5) |
| S2 | `6:chair`, `6:mug`(엔진처럼 **바닥** 위) |
| S3 | `6:chair`(`data-action=nudge`), `6:mug`(v0.1.1 추가), `5:plant` |
| S4 | `7:ball`, `7:chair`, `7:cup`, `6:chair`, `6:mug`, `5:plant`, 글 블록 `copy:1`(S4-01, 엔진의 7층 블록) · `copy:0`(S4-02, 엔진의 5층 블록) — v0.1.1에서 번호를 엔진 방에 맞춰 바꿈 |

- **보이는 가구·소품 = 물리 바디 요소 자체(B5).** 책상·노트북·소파·창·콘센트는 물리에 없는 배경이라 바디와 겹치지 않는 자리에만 그린다(`ui/stage.js`의 `clear`·`freeSpan`). 캐비닛과 S2의 그림 공(7층)은 지웠다.
- **자리는 엔진에서 온다.** `ui/stage.js`의 `PHYS` 표(= `proto/physics/building.js`의 `furnish` 값: 방 480×158, 7층 공 82·의자 178·컵 380, 6층 의자 163·컵 366, 5층 화분 326, 글 블록 5층 127·7층 290)를 화면 방으로 옮겨 놓는다. **엔진이 `LandingArt.physicsLayout(building)`을 한 번 부르면 실제 값으로 바꿔 다시 배치한다**(값이 바뀌어도 그림이 따라감).
- **좌표**: 무대(`[data-stage]`, S4는 `[data-flip-layer]`) 왼쪽 위 원점, CSS px, y 아래로 +.
- **엔진 ↔ 화면 대응(모든 경로 같은 식)**: `px = x · geo.w / building.width`(무대 전체 폭. `geo.walls = [0, W]`라 `hooks.js`의 바인딩·공 정렬·클릭 위치·파동·쿵 기록·`?debug`가 모두 같은 값), `py = geo.ceilings[층] + (y − room.top) · (geo.floors[층] − geo.ceilings[층]) / (room.bottom − room.top)`. 옆벽 그림은 무대 가장자리(물리 벽)에 안쪽 면을 맞췄다.
- **요소 규칙은 `bindDOM`과 같다**: `position:absolute; left:0; top:0; transform-origin:0 0; transform: translate(cx px, cy px) rotate(a rad) translate(-50%,-50%)`. 크기는 `style.width/height`. **요소 높이 = 물리 상자 높이**(바닥에 닿는다), 폭 = 그림 폭, 그림은 상자 바닥 가운데(공은 한가운데). 컵·머그는 물리 상자가 커서 그림을 상자 높이의 70%로 그린다.
- **데이터**: `data-cx` · `data-cy`(정지 자세 중심 = 물리 중심), `data-w` · `data-h`, `data-angle`(도, 0), `data-shape`(`circle`|`box`|`hull`), S4만 `data-pose-flipped="cx,cy,deg"`(엔진이 안 잡을 때의 뒤집힌 결과 포즈: 같은 x에서 그 방 천장 위. 빈 문자열이면 그 상태에서 숨김).
- **엔진이 바디를 잡으면 `[data-stage]`에 `data-physics-live`를 붙여 주세요.** 그 뒤 `stage.js`는 transform을 건드리지 않는다. 놓으면 속성을 지우고 `LandingArt.applyPose(scene,'rest'|'flipped')`를 부른다.
- 시각 크기는 그림 테두리 상자다. 의자는 볼록 껍질(64×118×배율)로 충돌시키는 것을 권한다(`design/final/materials.json`).

### 3.2 기하 `data-geometry`

`[data-stage]`에 JSON 문자열로 두고, 같은 값을 `lt:art-layout` 이벤트(`bubbles`, `detail`)와 `LandingArt.geometry(scene)`로도 준다. 리사이즈·글꼴 로드 뒤 다시 낸다.

```json
{ "scene":"s0","w":1440,"h":900,"mobile":false,"walls":[0,1440],
  "floors":{"7":612},"ceilings":{"7":188},
  "lines":{"ceilings":{"7":188,"6":688}},
  "slabs":{"7-6":{"top":612,"bottom":677,"band":657,"bandHeight":14}} }
```

- `walls`는 **물리 벽**(무대 가장자리, v0.1.1부터 `[0, W]`).
- `floors[N]`·`ceilings[N]`은 **물리 방**이다. 바디가 있는 층만 낸다(S0: 7 · S2: 6 · S3: 6·5 · S4: 7·6·5). `floors[N]`은 바닥 마감선(바디가 놓이는 면). `ceilings[N]`은 보통 그린 천장판 아랫면인데, 방이 가로 배율로 잰 높이(158 × w/480)보다 높으면 바닥에서 그 높이만큼 올라간 선이다(가로·세로 배율이 같아 바디가 찌그러지지 않는다. S0 모바일, S2·S3). S4는 뒤집히면 바디가 그린 천장에 닿아야 하므로 항상 그린 천장이다.
- `lines.ceilings[N]`은 그린 천장선(같은 사건 표지 자리). `slabs["A-B"]`는 A층 바닥부터 B층 천장 위까지다. `surfaces`(책상 윗면)는 물리에 책상이 없어 뺐다.
- S4: `rotate:"center"`(무대 중앙 기준 180°). 뒤집힌 뒤 바디는 `ceilings`로 떨어진다. `short:true`면 낮은 뷰포트(높이 < 560).

### 3.3 진자 `[data-physics-lamp="6"|"5"]`

- `data-ax` · `data-ay`(고정점), `data-len`(전구까지).
- 흔들 때는 **CSS 변수 `--lamp-angle`(rad)**만 바꾼다. 요소 transform은 `rotate(var(--lamp-angle))`이고 회전 중심은 고정점이다.
- 뒤집힌 결과 프레임: `.is-fallen` 클래스(빛 원뿔 숨김)와 `±1.45rad`. `applyPose`가 처리한다.
- 자리(v0.1.1): 엔진 진자는 방 가운데(x=240), 방 윗면에서 56 단위다. 줄·갓이 글과 겹치지 않으면 그 자리에 맞춘다(S2·S3 데스크톱, S4 전부). 겹치면 디자인 자리를 쓴다(S0, S2·S3 모바일). 진자는 바디와 다른 물리 세계(`lampWorld`)라 부딪히지 않고 각도만 쓰므로 자리가 달라도 동작은 같다. **`?debug` 윤곽은 이 요소의 `data-ax/ay/len` 기준으로 그려 달라**(조율 문서 B5-2).

### 3.4 파동 층 `[data-wave-layer="A-B"]` (`.lt-slab-wave-layer`)

- 윗변 = 맞은 면, 폭 = 무대 폭이다. `createSlabWave(layer)`의 `x`(0~1)를 그대로 쓴다.
- S0·S2 `7-6`, S3 `6-5`, S4 `7-6`·`6-5`(위층 바닥에서 아래로)와 `6-7`·`5-6`(뒤집힌 뒤 층 좌표에서 위로 → `direction:-1`).
- 엔진의 `.lt-slab-wave-arc`는 `styles/site.css`에서 쿵 색·2.5px·반타원 크기로 다시 칠했다.

### 3.5 파형 띠 `[data-record-strip="7-6"|"6-5"]`와 같은 사건 표지

슬래브 콘크리트 한가운데의 띠다. 그림은 `ui/stage.js`가 그린다.

| 호출 | 하는 일 |
|---|---|
| `LandingArt.record({n, x, value, slab:'7-6', label?})` | 띠에 쿵 새김. 표지는 **x 차이 3% 이내를 한 묶음**("쿵 #4–#6 · 최대 100")으로 보이고, 이름표는 한 묶음에만 단다(v0.2 #9). S0·S3: 가장 최근 쿵의 묶음. S2: `setCurrent`로 재생 중인 쿵의 묶음(재생 전·후엔 가장 최근). 나머지 묶음은 점. 끝 화면 카드 미니 띠에도 반영. S3 6층 의자는 `slab:'6-5', label:'6층 의자'` |
| `LandingArt.setCurrent(n)` | S2가 받은 실제 재생의 번호로 표지·띠 강조. 기준 낙하는 `null` |
| `LandingArt.cursor('s2', t)` | `[data-replay-cursor]` 위치(0~1). `null`이면 숨김 |
| `LandingArt.clearRecords()` | `restart` 때 |
| `LandingArt.records()` | 지금 기록 사본 |

### 3.6 기척·상태

| 훅 | 뜻 | 켜는 쪽 |
|---|---|---|
| `[data-react="6"]` (S0), `[data-react="laptop"]` (S2 노트북 화면), `[data-react="5"]` (S3) | '…?'(S0-04). 쿵 ≥ 80일 때 `hidden` 해제 | scenes.js |
| `[data-react="7"]` (S4, `data-building-upright`) | 뒤집힌 뒤 내 방 '…?' | CSS(`#main[data-perspective=downstairs]`) |
| `[data-laptop="6"]` (S2·S3 SVG 안) | S3-01 회의 끝: S3의 `[data-stage]`에 `data-meeting="over"` → 화면 꺼짐 | scenes.js |
| `[data-cue="s0-after"]` S0-05 · `[data-cue="s0-band"]` S0-07 · `[data-cue="s2-after"]` S2-03 · `[data-cue="s2-empty"]` S2-05 | 조건부 카피. 모두 `hidden` | scenes.js |
| `[data-kung-reading]` (S0, `output.sr`) | 지금 쿵 지수 숫자(스크린리더). 화면 값은 `record()` 표지가 보여 준다 | scenes.js |
| `[data-fx]` | 장면별 상태 알림. S0 `first-impact`, S2 `replay-feedback`, S3 `floor-echo`, S4 `perspective-feedback`은 `.sr role=status`. S6 `share-feedback`은 **화면에 보이는** 알림(S6-05 "링크를 복사했어요.") | scenes.js |
| `[data-floor-live]` (머리띠) | U-03 층 도착 문장 | `ui/hud.js`가 씀 |

### 3.7 S6 한 줄 — 건너뛴 체험으로 돌아가기

v0.5에서는 S6 진입에서 절정 안내 띠가 열려도 카드·요약·행동 영역의 자리를 유지하도록 시각층이 띠를 배치한다. 좁은 한 단에서는 E3 다음과 투표 안내 사이에 두고, 넓은 화면에서는 카드 옆 격자 칸을 사용한다.

| 훅 | 뜻 | 하는 쪽 |
|---|---|---|
| `[data-flip-missed]` (S6 `p.missed`, 처음 `hidden`) | "건물을 아직 뒤집어 보지 않았어요" + 버튼. S6가 활성일 때 `flipMode`가 없으면(절정을 한 번도 안 봤으면) `hidden`을 푼다. 절정을 보면 다시 `hidden` | scenes.js |
| `a[data-action="flip-revisit"][href="#s4"]` "중력 뒤집기 보기 ↑"(화살표는 SVG) | 누르면 S4 진행률 0.2 지점으로 옮기고 버튼 재생(`flip`)을 시작한다. 엔진이 이 동작을 모르면 기본 동작대로 `#s4`로 이동만 한다(무 JS 대체) | scenes.js(`ACTIVE_ACTIONS`에 추가하고 `preventDefault`) |

미리 보기: `?scene=s6&preview=missed`.

### 3.8 높이 낙하 미리보기 (v0.2.2 #3, 데스크톱 마우스, 그림은 `ui/stage.js`)

포인터가 S0의 7층 방 안(그린 천장 `geo.lines.ceilings[7]` ~ 바닥 `geo.floors[7]`)에 있으면, 그 높이에서 떨어질 공을 그린다. 그림은 그림자 공(점선), 공 아래 치수선, 바닥 그림자다. 높이 식은 `hooks.js` `actionFor`와 같다(`(y − ceilings[7]) / (floors[7] − ceilings[7])`). 버튼·공·바닥 띠(톡) 위, 터치·펜 포인터, `(hover: hover) and (pointer: fine)`가 아닌 기기에서는 그리지 않는다.

| 훅 | 뜻 | 하는 쪽 |
|---|---|---|
| `[data-stage="s0"][data-drop-preview="off"]` | 미리보기를 끈다. 입력을 받지 않는 동안(뒤집힘·재생 차단·일시정지 등) 붙이고, 받을 수 있으면 뗀다 | scenes.js |
| `LandingArt.dropColumn = (x, height) => x` (선택) | 엔진이 실제로 고를 낙하 열(빈 열, `clearDropColumn`)을 0~1로 돌려주면 그림자 공이 그 x에 선다. 없으면 포인터 x | scenes.js / building.js |

미리 보기: `?scene=s0&preview=drop`(방 위쪽 30% 지점에 포인터가 있는 모양).

## 4. S4 절정과 S6 결과

- **`[data-flip-layer]`**(`.flip-layer.lt-building-flip-layer`)는 무대만 감싼다. 안: 단면 SVG, 띠, 파동 층, 진자, 바디, 글 블록, `[data-react="7"]`. 밖: 머리띠, `[data-place="s4-controls"]`(버튼·S4-04), 큐 상자, `[data-perspective-label]`.
- **큐**: `[data-flip-cue="listen"]`(S4-05·06 + `reset-flip`)는 `#main[data-perspective="downstairs"]`일 때 CSS가 보인다. `[data-flip-cue="return"]`(S4-07·08)은 `#main[data-perspective="upstairs"][data-flip-returned]`일 때 보인다. `data-flip-returned`는 downstairs→upstairs 전환 때 `stage.js`가 붙인다(scenes.js가 직접 붙여도 된다).
- `[data-perspective-label]`(`.sr role=status`)은 남겼다. **현재 scenes.js가 넣는 문구("이제 6층에서 같은 쿵을 듣는 자리입니다")는 v2와 다르다.** U-03c "건물이 뒤집혔습니다. 이제 7층이 맨 아래입니다." / U-03d "건물이 원래대로 돌아왔습니다."로 바꿔 주세요(머리띠 `[data-floor-live]`도 같은 문장을 쓴다).
- **S6 결과 칸**(현 `[data-result]` 한 칸 대체):

| 훅 | 내용 | 초기값(아무것도 안 했을 때, v2 6.2 규칙 5) |
|---|---|---|
| `[data-result-headline]` | S6-01 | "오늘 이 페이지에서, 당신은 이런 위층이었습니다." |
| `[data-result-title]` | 유형 이름(6.3) | 사뿐 고양이형 |
| `[data-result-copy]` | 유형 한 줄(6.3) | 발소리가 너무 작아서, … 택배 기사님도요. |
| `[data-result-peak]` | 주인공 숫자(최대 쿵, [1.1] "−63%"). 줄바꿈 없음, 세 자리면 `ui/card.js`가 `.is-3`(150px)을 붙인다(PNG도 같은 크기) | 0 |
| `[data-result-label]` | "최대 쿵" / [1.1] "매트 깔고 줄인 쿵" | 최대 쿵 |
| `[data-result-detail]` | 표제란 기록 "쿵 {n}번" | 쿵 0번 |
| `[data-result-canvas]` | 화면 카드(`<article class="card">`, 1080×1350을 줄여 보임). 칸이 바뀌면 `ui/card.js`가 미니 단면을 다시 그린다 | — |
| `[data-result-url]` | 카드 주소 칸. `link[rel=canonical]`에서 자동, 없으면 칸 숨김 | — |
| `[data-share-url]` | 공유 실패 때 주소를 보여 줄 칸(`hidden`) | — |

- **공유 PNG는 `await LandingArt.drawCard(canvas, data?)`로 그려 주세요**(`fx-card.renderCard` 대신). 위 칸과 `record()` 기록을 읽어 시안과 같은 카드(LED 숫자, 미니 단면, 표제란)를 1080×1350으로 그린다. 미니 단면의 공·의자·컵은 화면 카드와 같은 `LandingArt.cardLayout`을 쓰고, '최대 N' 표지는 물건 윗면보다 위에 놓아 물건과 겹치지 않는다(v0.2 #4). **drawCard 뒤에 `paintCardPose`(옛 빈 상자)를 부르지 마세요.** 판정 면책(S6-03)은 이미지에 넣지 않는다. 예시 출력: `design/final/export/card-*.png`.
- `fx-type`의 `TYPE_COPY`는 아직 자리표시("유형 제목 01")다. FINAL-STORY 6.2 판정 규칙·6.3 카피로 바꿔야 한다(lt-sol-ideas·arch).

## 5. 현 `modules/scenes.js`·`adapters.js`에서 바꿀 곳 (수정은 lt-sol-arch)

1. `scenes.get("s5")`(완충재 비교)와 `[data-impact-before/after]` 조회 → 1차에 S5가 없으므로 지우거나 존재할 때만.
2. 뒤집기 장면을 `s6` → **`s4`**로. 초기 `adapters.physics.reverse(scenes.get("s6"), false)`도 s4로.
3. 결과 장면을 `s7` → **`s6`**로. `[data-result]` 한 칸 대신 4절 칸에 따로 쓴다. 저장 버튼 조회도 s6.
4. 동작 이름: `walk`·`chair`·`cushion`·`repeat`(1.1) 대신 **`tap`·`drop`·`nudge`·`reset-flip`·`restart`** 추가. `reset-flip`은 flip 해제와 같다.
5. 반전 시 문구 → 4절 U-03c·U-03d.
6. 어댑터의 파동·회전 대상: 장면마다 `[data-wave-layer="A-B"]`를 골라 쓰고, 회전은 S4의 `[data-flip-layer]`.
7. 첫 쿵 뒤 `[data-cue="s0-after"]`·`[data-cue="s0-band"]` 해제, `LandingArt.record(...)` 호출. 재생할 때는 `setCurrent`·`cursor`·`[data-react]`.

## 6. 빌드 요청 (`arch/build.py`)

현재 빌드는 `tokens.css` 인라인과 `assets/`·`modules/` 복사만 한다. 시각 층을 실으려면 아래가 필요하다.

| 파일 | 요청 |
|---|---|
| `styles/site.css` | `tokens` 뒤에 인라인하거나 `dist/styles/`로 복사. 첫 줄 `@import url("../tokens.css")`는 개발 미리보기용이다. 인라인하면 무시되고, 복사하면 지우거나 `tokens.css`도 함께 복사 |
| `ui/section.js` → `stage.js` → `hud.js` → `card.js` | 이 순서의 고전 스크립트(`defer`)로 복사 또는 인라인. 전역 `window.LandingArt`를 만든다. 모듈 진입점보다 먼저 실행되면 좋다(모듈은 원래 지연 실행이라 순서가 맞다) |
| `fonts/hahmlet-subset.woff2` | `dist/fonts/`로 복사(tokens의 `url("fonts/…")`는 문서 기준). 단일 파일 빌드는 data URL로. `assets/fonts/`와 `{{asset:}}`를 쓰려면 tokens.css의 url만 바꾸면 된다 |
| `fonts/OFL.txt` | 글꼴과 함께 배포(OFL 조건) |
| `art/og-1200x630.png` | `assets/og.png`로 복사(빌드가 요구하는 자리) |
| `index.html` | 자리표시자 3개(`build:metadata`·`build:tokens`·`build:modules`)는 그대로 하나씩 있다. `<link rel=preload>`와 `<link rel=stylesheet>`·`<script defer>` 주소는 빌드 산출 경로에 맞춰 조정 |
| `metadata.json` | description을 FINAL-STORY 8.2 1차용(121자)으로(arch 파일) |

## 7. 시각 점검용 매개변수 (개발용, 배포 무해)

`?scene=sN`은 그 장면만 띄운다. `?preview=impact`는 S0·S2·S3에 쿵 기록·표지·정지 파동·'…?'·큐를 보인다. `?preview=flipped`는 S4 뒤집힌 결과 프레임이고, `?preview=returned`는 S4 복귀 큐다. `?preview=result`는 S6 예시 카드(쿵쿵 드러머형 184)다. `?preview=physics`는 엔진 없이 물리 정지 윤곽(엔진 표 `PHYS`, `modules/debug.js`와 같은 대응식)을 그림 위에 겹친다(v0.1.1). 실제 흐름에서는 엔진이 같은 함수·속성을 쓴다. 스크린샷은 `design/final/shots/3b/`에 있다.
- 낮은 뷰포트(높이 < 560, 가로모드 휴대폰 844×390 등)는 `ui/stage.js`의 `isShort`와 `styles/site.css`의 `@media (max-height: 559px)`가 같은 기준으로 배치·글자 크기를 줄인다(v0.1.1 B2).

## 8. 요청과 다르게 정한 것

| 요청 | 정한 것 | 이유 |
|---|---|---|
| 현재 쿵 지수 훅 | 화면 값은 `LandingArt.record()` 표지(U-07)로 보이고, 숫자 훅 `[data-kung-reading]`은 스크린리더용 `output` | 같은 사건이 S0 바닥·S2 천장·카드 띠에 같이 보여야 해서 그리기를 한 곳에 모았다 |
| `data-physics-body`의 논리 좌표 | 무대 CSS px + `data-geometry`. 정지 자세는 엔진 가구 배치를 3.1의 대응식으로 옮긴 값 | 레이아웃이 반응형이라 매 레이아웃의 실제 px를 준다. 바뀌면 `lt:art-layout` |
| `data-wave-layer` 하나 | 슬래브·방향마다 `"A-B"` 이름의 층 | S4에서 같은 슬래브의 윗면(바로 선 건물)과 아랫면(뒤집힌 건물)을 맞는 면에서 정확히 시작시키기 위해 |
| S6 sticky | S6은 일반 흐름(`data-motion-sticky` 없음) | v2 4.0 "S6 끝 화면 100svh 일반" |
| S7 `section` | `section#s7 > footer#credits` | `#credits`·`#sources` 앵커 유지 |
| "⟲ 중력 뒤집기" | 아이콘은 SVG, 글자는 "중력 뒤집기" | ⟲ 글리프가 Hahmlet에 없어 대체 글꼴로 섞이는 것을 피함 |
| 바닥글 크레딧 | "소리"(1.1) 제외, "만든 사람"·"AI 도구 표기"는 HTML 주석 자리 | 1차 범위, 조율 확인 대기(FINAL-STORY 13절) |

## 9. v0.3 훅 — S1·S5·소리·센서·카드

### 9.1 장면과 조작

| 장면 | 배치 | 훅 |
|---|---|---|
| S1 쿵 기록 확장 | `#s1[data-scene="s1"][data-floor="7"]`, S0 다음, 기본 80svh | `[data-stage="s1"]`, 기존 `[data-physics-body="7:chair"]`·`[data-physics-body="7:ball"]`·`[data-wave-layer="7-6"]`. 바디에 `data-physics-gesture="drag-chair"` 또는 `"throw-ball"`. 대체 `button[data-action="drag-chair"]`·`button[data-action="throw-ball"]`은 각각 일정한 거리·속도로 같은 동작을 실행 |
| S5 완충재 | `#s5[data-scene="s5"][data-floor="7"]`, S4 다음, sticky 130svh | `[data-motion-sticky]`, `[data-stage="s5"]`, `[data-physics-body="7:ball"]`·`[data-physics-lamp="6"]`·`[data-wave-layer="7-6"]`, `[data-mat]`는 처음 `hidden` |
| S5 시험 | S5에서만 | `button[data-action="mat-before"]` → `button[data-action="mat-lay"]` → `button[data-action="mat-after"]`. `[data-mat-test]`에 `ready`, `dropping-before`, `before`, `laid`, `dropping-after`, `done` 중 하나. 실행할 수 없는 버튼은 `aria-disabled="true"` |
| S5 결과 | 처음 `hidden` | `[data-mat-result]` 안 `[data-impact-before]`, `[data-impact-after]`, `[data-impact-reduction]`. 각각 맨바닥 쿵, 매트 위 쿵, 비교 비율의 정수. 진자 대비는 `[data-cue="s5-05"]`, 결말은 `[data-cue="s5-after"]` |

- 새 장면·버튼은 해당 모듈 준비 전 `hidden`으로 둔다. `S0 → S1 → S2 → S3 → S4 → S5 → S6 → S7` 순서이며 S1 생략 시 S0→S2로 잇는다. 뒤집힌 동안 S0·S1·S3·S5 입력을 모두 막는다.
- S1의 접촉은 기존 7→6 테이프에 넣는다. S5는 같은 공과 높이를 두 번 쓰는 독립 시험이다. S5 쿵을 S0·S1의 재생 테이프와 유형 횟수에 합치지 않는다. S5를 지나쳐도 시험을 강제로 시작하지 않는다.
- S5 줄이기 모드는 같은 두 측정에서 나온 정지 프레임을 사용한다. 찰나의 애니메이션이나 s5 진자 기울기만으로 결과를 전달하지 않는다.
- 세션 기록은 `matTest: false`, `matDrops: 0`으로 시작한다. 맨바닥과 매트 위 첫 낙하의 결과가 모두 있으면 `matTest`를 `true`로 바꾼다. 매트 위 첫 비교 낙하와 이어지는 추가 낙하마다 `matDrops`를 한 번씩 올린다. 재충돌과 차단된 조작은 세지 않는다. `matTest && matDrops >= 3`을 완충재 수집가형 판정에 넘긴다. `[data-mat-test]`는 위 표의 화면 진행 상태를 담는다.
- 매트 첫 비교값과 `reduction`은 결과·카드·공유용으로 유지한다. 추가 낙하는 `matDrops`를 올리며 첫 비교값을 덮지 않는다. 높이를 아는 7층 최대 공 낙하 기록이 있으면 그 높이를 두 낙하에 재사용하고, 기록이 없으면 방 높이 절반을 쓴다.

### 9.2 머리띠 소리·진동

- `button[data-action="sound"]`에 `type="button"`, `data-pressed="false"`, 초기 `hidden`. `[data-sound-label]`에 “소리 켜기 / 소리 끄기”. 기존 움직임 토글 바로 옆이다. 사용자가 켜기 전에는 오디오 컨텍스트를 만들지 않는다. 활성화 중에는 `aria-busy`를 갱신하고, 실패는 `[data-sound-status][role="status"]`에 전달한다.
- D2에 따라 Android의 진동은 기본 켬이다. 화면에 실제로 보이는 듣는 쪽 방(S2의 6층, S3의 5층, 뒤집힌 S4의 7층)에 같은 사건이 도달할 때만 쿵당 한 번, 최대 80ms 울린다. 다른 장면에서 이어지는 재생, 일시정지·움직임 줄이기·숨겨진 탭에서는 울리지 않는다. 첫 실제 진동 때 U-08을 표시한다. 소리 토글은 음향을 제어한다. [D2](../DECISION.md#d2--v03-소리진동-기본값-2026-11-25)

### 9.3 S4 센서 선택

| 훅 | 장면 렌더링 |
|---|---|
| `[data-sensor-offer][hidden]` | S4의 0.15 이상 0.25 미만에서 지원 모바일에만 보여 주는 카드. 데스크톱, 터치가 없는 환경, 카카오톡·네이버·인스타그램 인앱, 방향 센서 API가 없거나 접근할 수 없는 환경에서는 카드 전체를 숨긴다. `[data-action="sensor-enable"]` 버튼의 클릭 안에서 권한을 요청한다. |
| `[data-action="sensor-use-button"]` | S4-12 “버튼으로 볼게요”. 권한 대기나 센서 사용 중 언제든 일반 `[data-action="flip"]` 조작으로 돌아간다. |
| `[data-sensor-status][role="status"]` | 초대 후 권한을 거부하거나 유효한 첫 이벤트가 1초 안에 오지 않으면 S4-13. 뒤집힘 미확정 8초는 S4-14. S4-17·S4-18·S4-19는 각 cue 요소를 직접 표시한다. |
| `[data-sensor-state]` | S4 상태 `idle`, `requesting`, `tilting`, `inverted`, `returned`, `fallback`을 반영한다. `tilting`은 무대 CSS를 회전시키지 않는다. 화면 방향이 바뀌면 판정을 취소하고 버튼 경로로 이관한다. 센서로 뒤집힌 동안은 듣기 전용이다. |

- 센서 값은 S4에서만 메모리로 처리한다. 저장소·주소·디버그 덤프·카드에 원시 값을 넣지 않는다. 장면 이탈·일시정지·탭 숨김·페이지 종료 시 구독을 끊는다. 움직임 줄이기 및 키보드에서는 일반 버튼 경로를 쓸 수 있다.

### 9.4 카드 v2

- S6에 `[data-result-mat][hidden]`과 `[data-result-sensor][hidden]`을 둔다. S5를 완료한 카드에 “쿵 {before} → {after}”, 센서 반전을 실제로 완료한 카드에 “휴대폰으로 직접 뒤집음”을 전달한다. 기존 판정·저장·공유 훅은 그대로 쓴다.
- `LandingArt.drawCard(canvas, data)`는 기존 값에 선택 `mat: { before, after }` 및 `badge` 문자열을 받는다. 화면과 PNG의 비교값은 같다. [스토리 장면과 카드](../concepts/FINAL-STORY.md)
- v0.3.1에서 `[data-result-peak]`와 `drawCard()`의 `peak`는 세션 최대 쿵 하나를 공유한다. 최대 쿵의 가로 열은 `[data-result-peak][data-peak-x]`와 `drawCard()`의 `peakX`에서 0~1로 읽는다. S0·S1 기록 없이 S5 맨바닥을 측정했으면 그 쿵과 대표 열 0.5를 사용한다. 위층 쿵 횟수에는 S5를 더하지 않는다.

### 9.5 스토리 v3 카피 슬롯

| 카피 ID | 슬롯 | 표시 시점 |
|---|---|---|
| S1-03 | `[data-cue="s1-03"]` | S1 첫 진입 시 한 번 |
| S2-06 | `[data-cue="s2-06"]` | 음소거 상태에서 S2 첫 재생 뒤 한 번. 소리를 켜면 숨김 |
| U-07 | `[data-cue="u-07"]` · `LandingArt.record({ …, label: "드르륵" })` | 끌기 한 번의 표지 “드르륵 #{n} · {값}”. 같은 라벨을 재생 기록에 유지 |
| U-08 | `[data-cue="u-08"]` | 첫 실제 진동 후 한 번. 움직임 일시정지로 끄는 방법을 안내 |
| S4-16 | `[data-cue="s4-16"]` | 센서 카드 안 회전 잠금 안내 |
| S4-17 | `[data-cue="s4-17"]` | OS 화면 회전 감지로 센서 판정을 중지한 뒤 1.2초 후 일반 뒤집기 버튼과 함께 표시 |
| S4-18 | `[data-cue="s4-18"]` | 센서 사용 중 진행률이 0.7을 넘으면 일반 스크롤로 이관했다는 알림 |
| S4-19 | `[data-cue="s4-19"]` | 센서로 반전한 뒤 S4-06 표시 2초 후 복귀 안내 |
| S4-20 | `[data-cue="s4-20"]` | 인앱의 ‘외부 브라우저로 열기’를 채택한 경우에만 사용 |
| S5-07 | `[data-cue="s5-07"]` | S5-04 아래에 두되 결과를 기다리는 동안에도 보이는 물리엔진 값 설명 |
| S5-08 | `[data-cue="s5-08"]` | 내 최대 공 낙하 높이를 재사용할 때 맨바닥 낙하 전에 표시 |
| S5-08b | `[data-cue="s5-08b"]` | 기준 높이인 방 높이의 절반을 쓸 때 S5-08 대신 표시 |
| S6-10 | `[data-result-mat]` | `matTest`가 참일 때 “매트 위에선 쿵 {a} → {b}”. 카드 큰 숫자는 S0·S1의 최대 쿵 |

### 9.6 디자인 확정 훅

| 훅 | 연결 |
|---|---|
| `section#s5[data-mat-test]` | 시험 순서, 현재 단계 강조, 매트 안내와 반복 버튼 반영 |
| `[data-stage="s5"][data-drop-height]` | 7층 윗면부터 바닥까지 0~1. 기준은 0.5 |
| `[data-mat][hidden]` | `mat-lay` 성공 시 노출, 배치는 `stage.js` |
| `[data-mat-roll][data-action="mat-lay"]` | 말린 매트를 누르거나 `geo.mat`의 범위로 끌어 설치. 같은 동작을 키보드 버튼으로 제공 |
| `[data-cue="s5-05"]` | 진폭이 15% 넘게 줄었을 때만 펜던트 대비와 문장 노출 |
| `[data-cue="s5-after"]` | S5-06 결말 카피 |
| `LandingArt.matLamp({before, after})` | 각 낙하의 6층 펜던트 최대 절댓값(rad) |
| `LandingArt.matLayout({x, width, thickness})` | 무대상 낙하 열 0~1, 매트 폭과 두께는 물리 단위 |
| `LandingArt.matResult({before, after})` | 막대에 실제 맨바닥·매트 쿵 표시 |
| `geo.drop`·`geo.mat` | 무대 기하에서 낙하 열, 높이와 매트 영역 읽기. S5의 `7:ball`은 진입 시 이 낙하 위치와 정렬 |
| `[data-result-mat-before]`·`[data-result-mat-after]` | 카드의 매트 전후 쿵 지수 |
| `section#s4[data-sensor-state]` | 센서 상태와 센서에 따른 레이아웃 갱신 |
| `[data-cue="s4-19"]` | 센서 반전 듣기 2초 뒤 복귀 안내 |
| `[data-physics-gesture].is-grabbed` | 공·의자를 잡은 동안 표시 |
| `[data-grab-ring][hidden]` | 터치의 최초 누른 점에서 300ms 동안 표시 |
| `LandingArt.scuff('s1', x0, x1)` | 의자 끌기 시작·끝 위치를 방 너비 0~1로 전달 |
| `LandingArt.record({…, label:'드르륵'})` | S1 긁힘의 순번과 라벨을 S2 재생에 유지 |
| `#sound-toggle[data-action="sound"]` | 음소거 초기값, 클릭에서 첫 소리 활성화 |

S7의 `button[data-action="engine-view"]`와 `#physics-engine-view`는 동작 모듈이 추가한다. 토글의 `aria-pressed`로 상태를 표시하고 `?debug`에서 처음부터 연다.

## 10. v0.4 첫 조작·같은 사건·매트 비교

| 장면 | 동작과 시각 사이의 계약 |
|---|---|
| S0 첫 조작 | 실제 방 입력과 `button[data-action="drop"]`, `drop-high`, `tap`을 이용한다. 버튼 낙하 높이는 각각 방 높이의 절반과 최상단이고, `tap`은 바닥에서 시작한다. 첫 안내 그림은 `.drop-invite.is-invite .inv-drop`과 `.inv-tap`이다. `[data-stage="s0"][data-drop-preview="off"]`에서는 입력 미리보기를 멈춘다. 첫 물리 충격을 받은 뒤 `[data-cue="s0-after"]`와 `[data-cue="s0-band"]`가 열리며, 다시 시작하면 초기 상태로 돌아간다. |
| S2 같은 사건 | 원본 `LandingArt.record({n, x, value, slab, label})`과 실제 재생 도착 시 `setCurrent(n)`·`cursor('s2', x)`가 같은 사건을 가리킨다. 위층 출처 `.src-ghost`는 `data-source-n`과 `data-source-x`를 가진다. `p[data-fx="replay-feedback"]`는 `재생 · 쿵 #n · 값` 또는 `재생 · 드르륵 #n · 값`을 알린다. `[data-cue="s2-after"]`에도 같은 라벨을 쓰며 번호와 값은 `.nowrap` 안에 둔다. 번호 없는 기준 낙하는 `setCurrent(null)`을 보내고 `[data-cue="s2-empty"]`와 `재생 · 기준 낙하 · 100`을 표시한다. |
| S5 비교 | `[data-mat-test]`와 기존 버튼의 `aria-disabled`가 다음 동작을 표시한다. 세션 최대가 실제 공 낙하일 때는 `[data-cue="s5-08"]`과 그 높이를 쓴다. 그 외에는 `[data-cue="s5-08b"]`와 방 높이 절반을 쓴다. ①이 접수되면 높이를 고정해 `cushionchange.detail.pending`의 시도 ID마다 같은 `command.y`를 쓴다. 맨바닥과 첫 매트 위가 모두 측정됐을 때 `data-impact-*` 결과와 `LandingArt.matLamp({before, after})`를 채운다. 반복 낙하에서도 처음 비교값을 유지한다. |

- S0 `svg.drop-invite[data-mode]`의 값은 `invite`, `drop`, `drop-high`, `tap`이다. `.inv-drop[data-drop-height]`는 초대 높이(0~1)다. `LandingArt.dropColumn(x, height)`는 현재 방의 실제 낙하 열을 계산한다. 미리보기와 방을 누른 뒤 낙하가 같은 열을 사용한다.
- S2 `.src-ghost.is-hit`는 실제 재생 박자에 붙고, 기준 낙하의 `data-source-n`은 빈 문자열이다. S5 `.mat-tag.is-before`·`.mat-tag.is-after`는 같은 조건의 두 측정을 가리킨다.

### 10.1 v0.4.1 시각 훅

| 훅 | 연결 |
|---|---|
| `[data-stage="s2"] .tag[data-mark-n][data-mark-value][data-mark-x]` | 6층 천장 표지의 번호·쿵 지수·무대 너비 대비 x(0~1). 재생 중에는 현재 사건 하나의 값을 쓴다. 묶음 표기는 `data-mark-n="1-2"` 형식이다. |
| `.copy.is-laid` | `stage.js`가 자리 글을 배치할 때 붙인다. `[data-place]`의 초기 숨김은 배치가 되거나 8초가 지나면 풀린다. |
| `.copy.is-fit`, `.copy.is-tight` | S2의 화면 높이와 가구 위치에 맞춘 배치 단계다. `.is-fit`으로 문구가 들어가지 않으면 `.is-tight`까지 적용한다. |

### 10.2 v0.5 끝 화면·듣기 재생·매트 기준

| 훅 | 연결 |
|---|---|
| `#s6[data-result-state="empty|done"]` · `[data-result-empty]` | 사용자 7층 기록이 없으면 `empty`. 6층 의자와 S5만 체험해도 이 상태를 유지한다. 안내와 버튼은 PNG 카드 밖에 있다. |
| `a[data-action="intro-revisit"][href="#s0"]` | 세션을 유지한 채 S0 시작점으로 이동한 뒤 기본 낙하 버튼에 초점을 준다. 돌아가 새 쿵을 만들면 S2 재진입에 개인 테이프를 자동 재생한다. 새 기록이 없으면 완료한 테이프를 자동으로 반복하지 않는다. |
| `[data-recap="kung|relay|mat"][data-state="empty|done"]` | 각각 7층 최대 사건과 순번, 6층 의자와 5층 천장, 같은 높이의 매트 전후 값을 받는다. 시각 값은 `[data-recap-from]`·`[data-recap-to]`, 낭독 문장은 `[data-recap-sr]`에서 갱신한다. |
| `a[data-action="cushion-revisit"][href="#s5"]` | S6 요약 안의 링크에서 S5 시작점으로 이동한다. 스크롤 종료 이벤트나 연속 프레임의 위치 안정이 확인되면 화면 안의 다음 시험 버튼에 초점을 준다. 두 이동은 줄이기·일시정지 상태에서 즉시 이동하며, 무 JS에서는 해시 앵커로 동작한다. |
| `.s4-chair-mark[data-mark-label][data-mark-value][data-mark-x]` | 6→7 시각 표지의 라벨·지수·회전 전 무대 너비 대비 충격 x(0~1). 시각층은 같은 사건의 값을 이름표·지시선에 쓴다. |
| `.callout.is-wide` | 낮은 화면에서 S4 듣기 설명의 넓은 상자. 시각층이 듣기 문장과 버튼에 맞춰 배치한다. |
| `.hud-note[data-cue="u-08"].is-away` | 진동 안내는 엔진이 `hidden`으로 여닫는다. 휴대폰에서 S2를 벗어나면 시각층은 `.is-away`로 화면에서 걷는다. |
| `a[href="tel:16612642"]` | S6의 아래층 상담 행동이다. 전화 URI를 사용하며 본문의 대회 안내용 외부 웹 링크는 한 개다. |

- S4 듣기 설명이 나타난 뒤 `building.replayChairCue(chairRecord)`를 호출한다. 물리의 `kind: "replay"`, `cue: "s4-chair"` 이벤트에서 6→7 파동과 `[data-fx="perspective-feedback"]`을 갱신하고, `[data-cue="s4-06"]`(또는 `.s406`)을 표시한 뒤 `LandingArt.record({ n: 0, slab: "6-7", label: "6층 의자", x, value })`를 호출한다. 듣기 장면을 떠날 때 아직 울리지 않은 재생은 취소한다. [물리 재생 계약](../proto/physics/README.md)
- `LandingBuilding.climaxListeningFrame()`의 배율과 세로 이동량을 회전 무대에 합성한다. 6층 의자·6→7 파동·레이블은 같은 좌표계를 쓴다. [모션 계약](../proto/motion/README.md)
- S5의 실제 공 낙하는 세션 최대이며 쿵 지수가 100 이상일 때 해당 높이를 비교에 쓴다. 나머지 세션은 `[data-cue="s5-08b"]`와 기준 높이 0.5를 사용한다. 매트 비교값과 별도로 카드의 세션 최대는 사용자 기록을 유지한다.

### 10.3 v0.6 F2 입력·낭독·회전 무대

| 훅 | 연결 |
|---|---|
| `[data-physics-gesture="drag-chair"]` | 포인터 시각과 좌표를 120Hz 물리 틱에 전달한다. 묶여 도착한 이동 샘플은 순서대로 입력한다. 중단은 즉시 정리하고 손을 뗀 시각은 마지막 틱으로 예약한다. |
| S0·S1 버튼의 `aria-disabled` | `building.canInputFor()`에서 공·의자 동작의 가능 여부를 각각 읽는다. 공은 추가 한 건까지 대기한다. 카드의 연타는 수락한 브라우저 시각과 `actionId`로 집계한다. 일반·줄이기의 대기 시간은 같은 120Hz 시계를 사용한다. |
| `[data-floor-live][data-floor-live-engine]` | 장면 엔진이 쓰는 층 도착·관점 낭독이다. 머리띠의 층 표시와 버튼 라벨은 계속 시각층이 쓴다. |
| S0 `[data-kung-reading]` · S0·S1 `[data-fx]` | 숫자 출력은 보조기기에 숨기며 각 조작의 첫 기록만 사건 상태 한 곳에서 낭독한다. 첫 조작은 수신층도 말한다. 반동은 테이프에 보존한다. |
| S4 `[data-fx="perspective-feedback"]` | 실제 `s4-chair` 재생에서 의자 값과 7층 수신을 읽는다. `LandingArt.record`와 파동의 x도 그 이벤트에서 읽는다. |
| S4 `button[data-action="reset-flip"]` | 화면이 180° 듣기 자세에 닿으면 보인다. 버튼으로 반전하는 경우 `.75`에서 반전 재생이 끝나야 `aria-disabled="false"`가 된다. 준비 위치에서 시작하면 총 2.4초 중 마지막 약 0.96초가 듣기 구간이다. 스크롤로 도달하면 버튼 재생 대기 없이 사용할 수 있다. |
| `LandingArt.climaxFrame({ frame, phase, inverted, sensor, reduced, progress })` | 표시한 각도·배율·세로 위치와 단계, 줄이기 교차 페이드 진행률을 넘긴다. 시각층은 선 이름표와 회전 중 고정 질문을 같은 프레임에 배치한다. |
| S5 `[data-fx="mat-feedback"]` | 맨바닥, 첫 전후 비교, 추가 낙하에 각각 실제 값을 발표한다. 전후값은 계산된 프레임에 바로 낭독한다. 대표값은 100→56·44%, 200→114·43%다. |
| `#s6[data-result-empty="none|mat"]` | 7층 개인 기록이 없는 세션을 두 경우로 표시한다. `mat`은 매트 시험용 맨바닥 측정값이 있을 때다. |
| S7 `[data-engine-slot]` | 엔진이 크레딧 '물리엔진·장면 엔진' 설명에 [물리엔진 보기] 버튼과 캔버스를 붙인다. `[data-engine-credit]`가 있으면 해당 설명에 연결한다. |
| S2 `[data-cue="s2-after"]` | 재생 테이프의 최대 사건 번호·지수를 고정해 보여 주고 재생 시작에 한 번 낭독한다. 나머지 충격은 파동에 표시하고 기록은 보존한다. |
| S4 `[data-flip-seen]` · `[data-flip-label]` · `a[data-action="s4-next"]` | 아래층을 체험한 뒤 직립할 때 S4와 버튼에 `data-flip-seen="true"`, 조작부에 `data-flip-again`을 쓴다. 버튼은 “한 번 더 뒤집기”가 되고 “다시 7층으로” 링크는 S5의 현재 버튼에 초점을 준다. |
| S4 스크롤 치수와 `[data-flip-cue="return"]` | `350svh` 섹션과 `100svh` 패널로 `createClimaxScrollMap`의 두 방향을 계산한다. 일반 회전은 표시 각도 330°에서 복귀 문장과 원래 이름표를 연다. 되감아 330° 아래로 내려오면 문장을 닫고 뒤집힌 이름표를 복원한다. 줄이기는 직립 페이드가 끝날 때 복귀 문장을 연다. |
| `[data-result-mat][data-mat-height-source]` · `[data-result-mat-label]` | S5 비교가 `reference` 기준 높이인지 `peak` 개인 낙하 높이인지 표시한다. PNG 그리기에서도 `mat.heightSource`와 `mat.labelPrefix`로 같은 구분을 받는다. |

### 10.4 v0.7 F3 첫 안내·결과·바닥글

| 훅 | 연결 |
|---|---|
| S0 `[data-cue="s0-after"]` · `[data-cue="s0-band"]` | 첫 S0 충격에서 6층 천장 전달 안내와 기준 높이 쿵 지수 100을 보여 준다. 기존 `[data-fx="first-impact"]`가 사건·수신층을 한 번 낭독한다. |
| S6 `[data-recap="listen"]` · `[data-recap-reduction]` | ②칸은 듣기 자세에서 실제로 재생된 `s4-chair`의 값만 받는다. 듣기 전에 떠나면 `data-state="empty"`로 6층 바닥→7층 천장 규칙을 보여 준다. S5 비교가 확정되면 카드 자세·PNG 준비와 별도로 ③칸에 전후값과 퍼센트를 쓴다. 퍼센트는 보이는 두 정수에서 계산한다. |
| S6·S7 `[data-action="save"]`, S7 `[data-fx="footer-feedback"]` | 같은 현재 카드 PNG를 `중력을-뒤집으면-카드.png`로 저장한다. S7 결과는 바닥글의 상태 영역에 낭독한다. |
| `[data-action="restart"][href="#s0"]` · S6 `[data-action="intro-revisit"]` | 처음부터 다시 링크는 기록을 초기화한 뒤 S0 제목에 초점을 준다. 빈 카드의 [집으로]는 현재 기록을 유지한 채 S0 공 버튼으로 초점을 준다. 바닥글 투표 바로가기는 S6 외부 앵커의 `id`를 가리킨다. |
| `<!-- build:js-bytes -->` · `<!-- build:source-count -->` | JS는 실제 디코딩 바이트를 십진 KB 소수 한 자리로, 출처는 `ul.src` 항목 수로 채운다. 브라우저에서 별도 요청이나 계산을 하지 않는다. |
| `[data-cue="s1-03"]` · `[data-cue="s2-06"]` | S1은 터치 장면에서 조작 없이 3초가 지난 방문에만 안내를 연다. 유효 입력·이탈·탭 숨김에서 닫는다. S2는 음소거 상태에서 테이프가 끝난 뒤 소리 안내를 보여 주며 U-08이 열린 동안은 진동 안내를 우선한다. |
| S4 `s4-chair` | 화면이 듣기 상태일 때의 6→7 재생 한 건을 `climaxImpactMarker`로 정규화한다. 같은 좌표를 파동과 표지에 쓰고 같은 값으로 E2 ②칸을 채운다. 듣기 전 실제 물리 접촉은 계속 계산된다. |
| S4 `html[data-motion-paused]` | 일시정지 중 스크롤은 마지막 각도를 유지한다. 듣는 중에 일시정지하면 듣기 제목은 그대로 보이고 CSS 닦임은 멈춘다. 일시정지 중 뒤집기 버튼을 누르면 정지 듣기 자세로 바로 이동한다. |
| S4 `#main[data-climax-wipe]` | 일반 모션에서 새 듣기 자세에 들어갈 때 CSS `cue-wipe`를 한 번 연다. 듣기 이탈·일시정지·줄이기에서 속성을 뗀다. 같은 듣기 자세에서 재개하면 속성을 다시 붙이지 않는다. |

### 10.5 v0.8 쿵 지수 눈금·층 표시

| 훅 | 연결 |
|---|---|
| S6 `[data-ruler-mine]`, `[data-ruler-mine-label]`, `[data-ruler-mine-value]` | 카드와 같은 최대 지수와 그 사건의 쿵·드르륵 종류를 넣는다. `data-ruler-value`에 지수, `data-ruler-kind`에 `thump` 또는 `scrape`, `--ruler-position`에 0~200을 0~100%로 넣는다. 0이면 숨긴다. 매트만 한 세션은 카드의 맨바닥 시험 지수를 사용한다. |
| `LandingArt.record({ slab: "7-6", label, tagLabel })` | 7층 개인 기록 `label`에는 공 충격 `쿵` 또는 의자 끌기 `드르륵`을 넣고, 기존 공 기록의 빈 라벨도 `쿵`으로 채운다. S0·S2 단일 표지의 `tagLabel`에는 같은 종류와 번호를 함께 넣는다. 예를 들어 `쿵 #1`이다. |
| `#main[data-current-floor][data-current-view]` | U-02b와 엘리베이터 접근 이름에 쓸 상태다. S2는 `6`/`lower`, S3는 `5`/`lower`, S4 준비·회전·복귀는 `7 6 5`/`all`, S4 듣기는 `7`/`lower`다. 나머지는 `7`/`upper`다. U-03 라이브는 기존 `[data-floor-live]`가 맡는다. |
