# 「중력을 뒤집으면」 효과 모듈

`audio.js`, `haptics.js`, `type.js`, `card.js`는 외부 패키지 없이 동작하는 ES 모듈이다. D1에서 정한 실제 충돌 충격량을 소리와 행동 기록에 쓰고, 행동 기록으로 결과 카드를 만든다. [결정 기록](../../DECISION.md)

## 뒤집힌 장면의 연결 규칙

스토리 v3의 뒤집힌 S4는 아래층에서 듣는 자리다. 관객이 할 수 있는 동작은 방향을 바꾸거나 재생을 제어하는 조작에 한정한다. 소리·진동·파동과 조명의 흔들림은 장면에 준비된 충돌을 전달한다. S6 결과 카드에는 S0·S1의 7층 행동, S2에서 직접 고른 다시 듣기, 이후 S5를 진행했으면 매트 비교 결과를 사용한다. S4에서 받는 충돌과 자동 재생은 이 지표에 합산하지 않는다. 카드와 공유 문구는 체험에서 관객 자신을 이야기한다. [대법원 2023도10313과 체험 적용 사항](../../research/factcheck-c11.md) · [스토리 v3 장면과 유형](../../concepts/FINAL-STORY.md)

## 효과음과 진동

| API | 동작 |
| --- | --- |
| `createAudioEffects({ referenceImpulse = 400 } = {})` | 페이지에서 공유할 효과음 인스턴스를 만든다. 초기 `muted`는 `true`다. |
| `await audio.toggle()` | `[data-action="sound"]`의 클릭 핸들러에서 직접 호출한다. 첫 활성화에서만 Web Audio 컨텍스트를 만든다. 활성 제스처가 없거나 재개에 실패하면 음소거 상태를 유지한다. 두 번째 클릭은 재개 대기 중에도 취소한다. 반환값은 소리가 켜졌는지 나타낸다. |
| `audio.playImpact(event, { downstairs, cushioned }?)` | 엔진 사건의 `index`로 소리 크기와 길이를 정한다. `type === "scrape"`는 드르륵, `action === "tap"`은 툭, 그 밖의 낙하는 저주파 쿵이다. 같은 사건을 아래층에서 듣는 쪽은 더 크고 낮은 음, 매트 위 충돌은 더 작고 짧은 음을 낸다. 기본 매트 표지는 엔진의 `event.mat`다. |
| `audio.mute()` | 즉시 출력과 진행 중인 효과음을 끈다. |
| `supportsImpactVibration()` | Android에서 진동 API를 쓸 수 있으면 `true`다. |
| `vibrateImpact(index, { scene, receiverRoom, listening, reduced, paused, enabled })` | Android에서는 기본으로 켜져 있다. S2 `listen`의 6층, S3 `relay`의 5층, S4 `flip`의 뒤집힌 듣기 상태에서 7층이 받은 사건에만 15~80ms의 단일 진동을 보낸다. `listening`에는 실제 뒤집힌 듣기 상태인 `building.listening`을 넣는다. iOS, 미지원 환경, 일시정지, 움직임 줄이기, `enabled: false`에서는 건너뛴다. |
| `stopImpactVibration()` | Android에서 진행 중인 진동을 취소한다. 듣기 중 일시정지·줄이기 전환과 듣는 장면 이탈에 연결한다. |

음원과 진동은 기준 지수 200에서 각각의 상한에 닿는다. 같은 기록을 재생할 때도 `index`와 `mat`를 보존하고 관객이 듣는 층을 다시 확인한다. 첫 진동은 `vibrateImpact()`가 처음 `true`를 반환한 시점에 U-08로 안내한다. [조율 결정 D2](../../DECISION.md) · [장면과 토글 훅](../../site/HOOKS.md)

```js
import { createAudioEffects } from "./audio.js";
import { vibrateImpact } from "./haptics.js";

const audio = createAudioEffects();
soundButton.addEventListener("click", async () => {
  await audio.toggle();
  soundButton.setAttribute("aria-pressed", String(!audio.muted));
});

function playRecordedImpact(event, { scene, listening, listeningRoom, reduced, paused }) {
  if (paused) return;
  const downstairs = Number.isInteger(listeningRoom) && event.receiverRoom === listeningRoom;
  audio.playImpact(event, { downstairs });
  vibrateImpact(event.index, { scene, receiverRoom: event.receiverRoom, listening, reduced, paused });
}
```

## 행동 기록과 유형 판정

`classifyBehavior(record, options?)`는 `{ id, title, copy, cardVariant, headline, detail, matLine, badge, stats }`를 돌려준다. `summarizeBehavior(record)`로 집계만 얻을 수 있다. 7층 S0·S1에서 실제로 받은 사용자 충격을 `events: [{ index, actionId, acceptedAtMs }, …]`로 넘긴다. 쿵 지수 10 이상인 충격의 건수가 `n`, 최대 지수가 `peak`다. `burst`는 그 충격을 낸 서로 다른 `actionId`가 수락된 시각을 기준으로, 2초 창에 가장 많이 들어간 조작 수다. 한 낙하에서 나온 재충돌은 쿵 횟수에는 각각 들어가고 연타에는 한 번 들어간다. 집계를 이미 구한 경우 `events` 없이 `n`, `peak`, `burst`를 전달한다.

`acceptedAtMs`는 모든 조작이 공유하는 브라우저 시계의 밀리초 값이다. 포인터·버튼·키보드에서 `input()` 호출 시 조작 시각을 잡고, 수락된 경우에만 해당 `actionId`에 보관한다. `onInputCancelled`에서 그 ID를 정리하고, 수신된 충격에 같은 `acceptedAtMs`를 넘긴다. 같은 입력 내 재충돌에서도 이 시각을 재사용한다. 엔진의 `inputTime`·`peakTime`은 물리·재생용으로 사용한다. 이전 형식의 `events: [{ index, timeMs }, …]`도 지원한다. [R9-4 재현](../../discussion/lt-sol-physics-v06R-완료.md) · [수락·취소 API](../../discussion/lt-sol-physics-v06F1-연결.md)

`replays`는 S2에서 직접 누른 다시 듣기 횟수다. `flipMode`는 `scroll`, `button`, `sensor` 중 하나다. v0.3 통합은 `classifyBehavior(record, { enableV11: true })`로 여섯 유형, 매트 줄, 의자 이동 거리와 센서 배지를 켠다. 기본 호출은 다섯 유형 모드다. `drag`는 방 너비를 1로 둔 이동 거리다.

S5에서 맨바닥과 첫 매트 낙하를 마치면 `matTest: true`와 `matComparison: { before, after }`를 기록한다. `matDrops`는 비교의 첫 매트 낙하부터 센다. 엔진의 서로 다른 매트 낙하 `actionId`마다 한 번 더한다. 비교를 마치고 매트 위에 세 번 이상 떨어뜨렸을 때 완충재 수집가형을 우선 적용한다. 첫 두 쿵 지수의 `reduction`은 화면과 공유 문구에 사용한다. 제품의 실측 소음과 관계없는 엔진 지수이며, 카드 큰 숫자는 항상 `최대 쿵 {peak}`다. 실행 기준은 `TYPE_RULES`에 모아 둔다. [판정 순서와 카피](../../concepts/FINAL-STORY.md)

결정 D3에 따라 v0.3 모드의 유형과 카드가 같은 `stats.peak`를 쓴다. 사이트가 제공하는 S0·S1 `sessionPeak`를 우선 쓰며, S0·S1 기록이 비어 있으면 S5 맨바닥 지수 `matBefore`를 쓴다. 완료된 비교만 받은 경우에는 `matComparison.before`에서도 같은 값을 읽을 수 있다. `n`과 `burst`는 S0·S1에서 집계한다. 예를 들어 S5만 해서 100→56을 얻으면 카드에 최대 쿵 100과 쿵 0번이 전달된다. 매트 낙하 한 번은 보통의 위층형, 세 번은 완충재 수집가형이다. [결정 D3](../../DECISION.md#d3--v031-카드-숫자-2026-11-25)

기존 사이트가 보내는 `{tapCount, impulses, chairDrags, cushionUses}`도 처리한다. `events`나 정규화된 집계가 오기 전에는 기존 사이트와 같은 0~100 척도로 사건 수와 최대를 표시한다. 원시 충격량 평균·최대나 `timeOfDay`는 진단용 집계로 남긴다. `burst`와 완충재 감소율은 시간과 비교 측정값이 들어온 상태에서 적용된다. [판정 순서와 카피](../../concepts/FINAL-STORY.md)

```js
import { classifyBehavior } from "./type.js";

const result = classifyBehavior({
  events: [
    { index: 85, actionId: 1, acceptedAtMs: 120 },
    { index: 130, actionId: 2, acceptedAtMs: 950 },
    { index: 200, actionId: 3, acceptedAtMs: 2010 },
  ],
  replays: 1,
  flipMode: "button",
  matTest: true,
  matDrops: 3,
  matComparison: { before: 100, after: 56 },
}, { enableV11: true });
```

## v0.2 물리로 다시 돌린 행동 1,000건

고정 시드 `20261124`로 만든 세션 1,000개를 각각 물리 v0.2에서 돌렸다. 세션당 0~16회 입력을 만들고 무작위 방 높이 낙하 60%, 기준 낙하 버튼 25%, 발뒤꿈치 15% 확률로 섞었다. 세션의 20% 확률로 0.15~0.40초 간격의 연타를, 나머지에는 0.90~2.10초 간격을 사용했다. 다시 듣기 0~3회와 뒤집기 방식도 뽑았다. 방문 행동은 이 가정으로 생성했고, 쿵 값과 대기열·재충돌은 엔진에서 계산했다. [레드팀 5절 1번](../../judging/redteam-v012.md) · [물리 v0.2 측정값](../physics/README.md)

사이트와 같은 입력 시각으로 2초 창을 계산한다. 7층에서 기록된 충돌을 넣고, 재충돌이 지수 10 이상이면 사건으로 센다. 시뮬레이션에서 모든 수락 입력에 `actionId` 기록이 있는지 검사한다. 6층 의자의 긁힘 141은 재현용으로 확인하고 유형 집계에는 넣지 않는다.

| 1차 유형 | 보정 전 | v0.2 보정 후 |
| --- | ---: | ---: |
| 쿵쿵 드러머형 | 368건 · 36.8% | 344건 · 34.4% |
| 한 방 거인형 | 28건 · 2.8% | 33건 · 3.3% |
| 되감기 반성형 | 121건 · 12.1% | 124건 · 12.4% |
| 사뿐 고양이형 | 153건 · 15.3% | 153건 · 15.3% |
| 보통의 위층형 | 330건 · 33.0% | 346건 · 34.6% |

`TYPE_RULES.drummerBurst` 한 항목을 **5에서 6**으로 올렸다. 연타와 재충돌이 모두 기록되는 v0.2에서 짧은 연속 입력을 드러머형으로 판정하는 문턱을 높이자, 이 표본의 최다 비율은 **34.6%**로 낮아졌다. 2초 창, 전체 사건 수 15회 기준, 한 방 거인형의 `peak ≥ 180` 기준을 적용한다.

빈 건물에서 `x=120, y=26`으로 공을 한 번 놓으면 실제 **쿵 200**으로 한 방 거인형이 나온다. 0.15초 간격 발뒤꿈치 입력 6회는 드러머형, 기준 낙하 버튼 한 번은 보통의 위층형, 그 뒤 다시 듣기 2회는 되감기 반성형, 발뒤꿈치 한 번은 사뿐 고양이형을 재현한다.

## v0.3b 스토리 v3로 다시 돌린 행동 1,000건

같은 무작위 행동 모형에서 S5 완료 확률은 25%다(독립 시드 `20261125`). 완료 뒤 매트 낙하를 한 번 더 할 확률은 매회 55%로 가정했다(독립 시드 `20261126`, 첫 비교 낙하를 포함해 최대 5회). 엔진에서 쿵 **100 → 44**를 측정했고, 매트 위 낙하 5개가 각기 다른 행동으로 기록되는 것도 확인했다. 모의 S5 완료 232건 중 낙하 1~5회는 각각 102·50·39·19·22건이다. 실제 방문자의 완료·반복 비율은 통합 후 확인한다.

| 유형 | 건수 | 비율 |
| --- | ---: | ---: |
| 보통의 위층형 | 316 | 31.6% |
| 쿵쿵 드러머형 | 315 | 31.5% |
| 사뿐 고양이형 | 144 | 14.4% |
| 되감기 반성형 | 118 | 11.8% |
| 완충재 수집가형 | 80 | 8.0% |
| 한 방 거인형 | 27 | 2.7% |

여섯 유형을 모두 재현했고 최다 비율은 31.6%였다.

## v0.3.1 드르륵 정규화 후 행동 1,000건

v0.3b 표본 모형에 S1 의자 끌기를 추가했다. 독립 시드 `20261127`로 세션의 30%에서 한 번 끌도록 하고, 포인터 10~80px, 버튼·키보드용 55px, 움직임 줄이기의 55px 즉시 정산 경로를 같은 확률로 골랐다. S5 완료·반복 확률은 위 표본 모형을 사용했다. 엔진이 출력한 지수를 그대로 판정에 사용했다. [레드팀 6절 1·3번](../../judging/redteam-v03.md) · [물리 입력 경로와 검증](../../discussion/lt-sol-physics-v031-완료.md)

| 유형 | 건수 | 비율 |
| --- | ---: | ---: |
| 보통의 위층형 | 324 | 32.4% |
| 쿵쿵 드러머형 | 323 | 32.3% |
| 되감기 반성형 | 109 | 10.9% |
| 사뿐 고양이형 | 92 | 9.2% |
| 완충재 수집가형 | 80 | 8.0% |
| 한 방 거인형 | 72 | 7.2% |

기존 `TYPE_RULES`로 여섯 유형이 모두 나왔고, 최다는 32.4%였다. 의자 끌기 294건의 드르륵 지수는 76~200이었다. S5 완료 232건 중 S5만 한 22건에서 맨바닥 지수 100과 S0·S1 쿵 0번을 확인했다. 별도로 최고 높이 낙하 한 번의 쿵 200에서 한 방 거인형이 재현됐다. 기본 실행은 여섯 유형 도달과 최다 40% 이하를 검사한다.

## v0.6 F2 수락 한도 반영 후 행동 1,000건

v0.3.1과 같은 시드·행동 모형에 F1 물리를 적용했다. 공 입력은 시뮬레이션의 조작 시간표에 맞춰 시도하고, 엔진이 수락한 입력만 그 시각을 남긴다. 포인터 의자 끌기는 F1의 타임스탬프 API로 실행한다. 공 입력 5,998회 중 5,839회가 수락·기록되고 159회가 거부됐다. 의자 끌기 294건의 드르륵은 49~140이었다. S5 기준 낙하는 **100→56**, 완료 232건 중 S5만 한 22건의 카드 최대는 100이었다. [F1 물리 실측](../../discussion/lt-sol-physics-v06F1-완료.md)

| 유형 | 건수 | 비율 |
| --- | ---: | ---: |
| 보통의 위층형 | 371 | 37.1% |
| 쿵쿵 드러머형 | 309 | 30.9% |
| 되감기 반성형 | 119 | 11.9% |
| 사뿐 고양이형 | 92 | 9.2% |
| 완충재 수집가형 | 80 | 8.0% |
| 한 방 거인형 | 29 | 2.9% |

기존 임계값으로 6종에 모두 도달했다. 별도 과부하 재현에서 최고 낙하를 10Hz로 12회 시도하면 4회 수락·8회 거부이며, 직후 반전하면 수락 건 가운데 1회가 기록되고 3회는 취소된다. 발뒤꿈치를 150ms 간격으로 6회 누른 R9-4 재현에서 일반과 줄이기의 쿵 횟수와 연타는 각각 6이고 둘 다 드러머형이다. 줄이기 경로에서 물리 시간이 앞서도 `acceptedAtMs`가 같은 입력 간격을 보존한다. 과부하에서도 같은 수락 집합을 만들려면 사이트에서 두 경로의 대기를 같은 속도의 물리 틱으로 정산해야 한다. [사이트 통합 인계](../../discussion/lt-sol-ideas-v06F2-완료.md)

```sh
node proto/fx/simulate-types.mjs
```

## 결과 카드와 공유

`renderCard(canvas, result, { demoUrl, events }?)`는 `classifyBehavior()` 결과를 디자인팀의 렌더러에 넘긴다. `events`는 띠에 새길 `{ x, index }` 목록이며 `x`는 방 너비에 대한 0~1 비율이다. 완료한 S5의 `result.matLine`은 S6-10 `매트 위에선 쿵 {a} → {b}`다. 화면의 `[data-result-mat]`는 값이 있을 때 표시하고, `LandingArt.drawCard(canvas, data)`의 `data.mat`에 같은 `result.stats.matComparison`의 `before`, `after`를 넣는다. FX 내보내기 대체 경로는 큰 숫자와 횟수를 유지하고 좁은 표제란에 `매트 {a} → {b}`를 한 줄 추가한다. [카드 v2 훅](../../site/HOOKS.md#94-카드-v2)

`card-design.js`는 디자인의 `card.js`·`card.css`와 `section.js`·`tokens.css`·`base.css`에서 생성한 모듈이다. 현재 빌드가 일반 배포와 단일 HTML 배포 모두에 이를 포함한다. 디자인 변경 뒤 프로젝트 루트에서 `node proto/fx/sync-card-design.mjs`로 갱신하고 `--check`로 원본과 대조한다. 글꼴은 디자인 CSS의 로컬 폴백 목록을 따른다. [디자인 렌더러](../../design/final/card.js) · [카드 CSS](../../design/final/card.css)

결과가 확정될 때 PNG를 미리 만든다. 공유 버튼의 클릭 핸들러에서 `shareCard({ png, result, demoUrl })`를 바로 호출한다. 완료한 S5의 비교값으로 S6-04b를 만들고, 비교 기록이 없거나 쿵이 증가한 경우는 기본 S6-04를 쓴다. 첫 시도는 PNG와 문구를 함께 보내고, 파일 공유가 어려우면 같은 문구를 텍스트로 보낸다. 문구에는 데모 주소가 한 번 들어간다. 시스템 공유가 어려운 환경에서는 PNG 다운로드와 데모 링크 복사를 시도한다. 직접 취소하면 `cancelled`를 반환한다. [끝 화면과 공유 문구](../../concepts/FINAL-STORY.md)

```js
import { renderCard, exportCardPng, shareCard } from "./card.js";

renderCard(cardCanvas, result, { demoUrl: publicPageUrl, events: upstairsEvents });
const png = await exportCardPng(cardCanvas).catch(() => null);

shareButton.addEventListener("click", async () => {
  const outcome = await shareCard({ png, result, demoUrl: publicPageUrl });
  if (outcome.status === "fallback" && !outcome.copied) {
    shareLinkField.value = outcome.url ?? "";
    shareLinkField.hidden = false;
  }
});
```

사이트 장면 어댑터는 `shareCard({ png, result: current, demoUrl: url })`로 연결한다. 장면이 먼저 그린 최종 물건 위치 표시는 PNG에서 디자인 선화 앞에 유지된다. SVG 내 HTML을 PNG에 그릴 수 없는 브라우저에서 인코딩이 실패하면 텍스트 공유나 링크 복사가 이어진다. [사이트 연결](../../site/modules/adapters.js)

## 물리엔진 보기

`engine-view.js`는 실제 월드의 원·볼록 다각형 외곽선과 접촉점을 캔버스 한 장에 표시한다. 초록은 깨어 있는 바디, 보라와 `Z`는 수면, 회색은 고정 바디다. 주황 화살표는 슬래브가 물체에 가한 법선 방향을 쓰며 길이는 쿵 지수에 비례한다. 파랑 화살표는 엔진이 실제 수신을 보고한 윗면 사건만 방 번호로 가리킨다. 아랫면·옆면 또는 수신 방이 없는 사건에는 `전달 0`이 표시된다. 회전한 무대의 윗면은 엔진의 중력 기준 판정을 따른다. [건물 물리 이벤트](../physics/README.md)

```js
import { createEngineView } from "./engine-view.js";

const view = createEngineView(canvas, building, { button: s7EngineViewButton });
view.setStill(paused);
view.render(alpha);
```

S7 버튼 이름은 `물리엔진 보기`다. `?debug`가 있으면 처음부터 켜고, 쓰지 않을 때는 두 충돌 구독을 해제한다. 호출자가 같은 장면의 물리 프레임과 함께 `render(alpha, { x, y, width, height })`를 부른다. `x`, `y`는 표시할 엔진 좌표 영역의 왼쪽 위다. 이 인수를 생략하면 건물 전체를 그린다. S4에서는 장면과 같은 회전 레이어에 캔버스를 둔다. 카메라를 직접 관리할 때는 기존 장면 루프에서 캔버스의 크기를 맞추고 `setEnabled()`와 `render()`를 호출할 수 있다. 마지막에는 `destroy()`로 토글과 구독을 해제한다.

움직임 줄이기나 `setStill(true)` 상태는 첫 장면을 그린 뒤 정지한다. 완료된 사용자 조작의 정지 결과가 준비되면 `render(1, camera, true)`로 한 번 교체한다. 반복 프레임과 물리 진행은 장면 루프가 맡는다. 데모는 프로젝트 루트의 로컬 정적 미리보기에서 `proto/fx/demo-engine-view.html` 또는 `proto/fx/demo-engine-view.html?debug`로 연다. [한 장 데모](demo-engine-view.html)

## Node 검사

프로젝트 루트에서 Node 22로 실행한다.

```sh
node proto/fx/verify.mjs
node proto/fx/verify-engine-view.mjs
node proto/fx/sync-card-design.mjs --check
```

Web Audio와 Canvas, 브라우저의 파일 공유·다운로드·클립보드를 모의한다. 기본 음소거, 진동 미지원, 유형별 판정, 듣기 재생 정보와 유형 점수의 독립성, PNG 인코딩 요청, 파일 공유 성공과 실패 후의 다운로드·링크 복사를 확인한다. 실제 음색, 기기 진동 및 OS 공유 패널은 기기에서 확인할 항목이다.

엔진 보기 검사는 실제 물리 월드와 모의 Canvas를 연결한다. 쿵 100·200의 벡터 길이, 천장 전달 0, 뒤집힌 뒤 7층 재생, 수면 표시, 정지 프레임, 비활성 구독 해제와 5KB 원본 한도를 확인한다.

## 본문과 바닥글에 인계할 수치

- 국가데이터처 2025년 인구주택총조사 기준 아파트 거주 가구 비율은 **54.5%**다.
- 층간소음 이웃사이센터에는 **2020년부터 해마다 3만 건 이상**의 상담이 접수됐다. **2025년은 32,662건**이며 콜센터와 온라인 접수의 합계다.
- 직접충격 소음 **1분 등가소음도**의 별표 기준은 **주간 39dB(A)·야간 34dB(A)**다. 체험 카드의 ‘쿵 지수’는 실제 충격량을 바탕으로 한 상대값으로 쓴다.
- 한국환경공단 층간소음 이웃사이센터 연락처는 **1661-2642**다.

[수치 원문과 출처](../../research/factcheck-c11.md)
