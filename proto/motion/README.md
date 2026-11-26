# 스크롤 모션 프로토타입

`demo.html`을 브라우저에서 파일로 열면 두 장면을 확인할 수 있다. 첫 장면은 한글 문장, SVG 경로 그리기, 도형 모프를 보여 준다. 둘째 장면은 숫자를 0에서 100으로 바꾸고 진행률 60%에서 물리 연결을 예시하는 표식을 추가한다. 그 지점 위로 돌아가면 표식이 사라진다. `JS 대체 사용` 버튼은 같은 페이지에서 두 경로의 비교에 쓴다.

파일로 열 때는 외부 의존성과 네트워크 요청 없이 동작한다. 데모의 HTML, CSS, SVG, 스크립트는 이 프로토타입에서 작성했다. 데모에는 시스템 글꼴을 쓴다.

## 중력을 뒤집으면

`demo-building.html`을 로컬 파일로 열고, 첫 화면에서 슬래브를 탭하거나 `바닥 톡`·`바닥 쿵` 버튼을 누른다. 7층 충격은 6층에 도착할 때 같은 값과 가로 위치에서 다시 나타난다. 5층을 지나면 세 층 단면이 나오고, 계속 스크롤하거나 `중력 뒤집기` 버튼으로 S4를 실행할 수 있다. `움직임 일시정지`와 OS의 움직임 감소는 층 이동과 파동을 정지 프레임으로, S4 회전을 크로스페이드로 전환한다.

파일 데모는 질량·중력·높이·반발계수로 단일 수직 충돌의 충격량을 계산한다. 작업 공간의 기존 정적 미리보기에서 열면 `../physics/engine.js`의 `World.onImpact()`를 연결해 실제 슬래브 접촉의 `normalImpulse`를 사용한다. `쿵 지수(상대값)`는 이 입력을 `fullImpulse`로 정규화한 0~100의 값이다.

### v0.3 S1과 S5 통합

- S1에 `.lt-building-intro-extension`을 적용하면 80svh가 확보된다. `sampleIntroExtension(progress, { reduced })`에 S1 구간의 정규화 진행률을 전달하면 `{ active, floor: 7, reveal }`이 나온다. `reveal`은 안내 카피의 불투명도다. 줄이기에서는 진입 즉시 1이다. S0에 붙여 한 패널을 쓸 때는 문서에 80svh를 더하고 그 구간까지 층 하강 진행률을 0으로 둔다. 데모가 이 배치를 쓴다.
- S5는 `.lt-building-cushion`에 `.lt-building-stage`를 직계 자식으로 둔다. 130svh 섹션 안에서 100svh 패널이 고정된다. `createCushionTimeline({ eventTarget, reduced, drop, heightSource })` 생성 후 S5가 보일 때 `setActive(true)`, 떠날 때 `setActive(false)`를 호출한다. `advance(seconds)`에 경과 시간을 넘기면 0.6초 동안 5F→6F→7F와 `floorOpacity`가 진행된다. 줄이기는 7F 정지 상태로 표시한다.
- `cushionchange.detail`의 `matTest`와 `action`은 HOOKS의 `[data-mat-test]` 및 `mat-before`, `mat-lay`, `mat-after`에 대응한다. `beginDrop("bare")` → `record(id, measurement)` → `layMat()` → `beginDrop("mat")` → `record(id, measurement)` 순서다. 두 시험에 같은 `trial.command` 객체가 전달된다. 기본 명령은 `{type: "matDrop"}`이다. 어댑터가 두 낙하에 같은 위치와 높이를 적용하고 두 번째에만 매트를 켠다. 실패 시 `cancelDrop(id)`로 다시 시도할 수 있다.
- `measurement`에 기록한 `{index, lampAngle, force?}`를 전달한다. `lampAngle`은 그 낙하 동안 6층 진자의 절댓값이 가장 컸던 순간의 각도(라디안)다. `comparison`은 쿵 지수 `before`·`after`, 감소율 `reduction`(`1 - after / before`, 기준 0이면 `null`), `lampReduction`·`lampContrast`와 두 측정의 `frames`를 담는다. 줄이기는 동일한 두 프레임과 결말을 즉시 표시한다.
- `arrivalCue`(S5-01) 뒤에 `heightCue`를 표시한다. 기본 높이는 S5-08b이며 실제로 최고 쿵 높이를 쓰는 경우만 `heightSource: "peak"`로 생성해 S5-08을 쓴다. 매트를 깐 뒤 `matCue`(S5-02)를 표시한다. 두 번째 낙하가 끝나면 `resultCue`(S5-04), 조건부 `lampCue`(S5-05), `conclusionCue`(S5-06), `provenanceCue`(S5-07) 순서로 배치한다. S5-07은 결과가 있는 동안 함께 표시한다.
- S5-05는 진폭이 15% **넘게** 줄었을 때만 표시한다. 이때 `compare` 0.45초 다음 `pendulums` 0.55초 동안 `pendulumProgress`를 받아 대비를 그리고 결말로 넘어간다. 진폭 조건에 해당하지 않으면 측정 결과 다음 결말을 바로 보여 준다. 결말 후의 매트 낙하는 완료 시 `matDrops`만 늘려 처음 비교값을 보존한다.

정적 미리보기의 건물 데모는 `matDrop`과 `onReceive`로 기준 높이의 두 충격을 구하고 실제 진자의 각도 대비를 그린다.

### S4 절정 통합

`LandingBuilding.createClimaxTimeline({ eventTarget, reduced })`는 스크롤과 버튼에 공통으로 쓰는 진행률을 만든다. 기본 `eventTarget`은 독립 `EventTarget`이고, S4 섹션을 전달하면 그 섹션에서 `climaxchange`가 버블링한다.

| 진행률 | `phase` | 표시와 동작 |
|---|---|---|
| 0–0.15 | `zoom` | 세 층 단면까지 줌아웃. `zoom`은 0→1 |
| 0.15–0.25 | `ready` | 정지. `중력 뒤집기` 버튼 표시 |
| 0.25–0.55 | `invert` | 0°→180°. 정방향·역회전 모두 최대 225°/초 |
| 0.55–0.75 | `listen` | 180° 정지, 듣기 전용 |
| 0.75–0.95 | `return` | 180°→360°. 같은 각속도 상한 사용 |
| 0.95–1 | `settle` | 원래 방향에 정착 |

- `scrub(progress)`에 `createMotion().addScene()`의 진행률을 전달한다. `followReducedProgress: true`를 켜면 움직임 감소일 때도 스크롤로 세 정지 포즈를 넘길 수 있다. `advance(seconds)`를 기존 프레임 또는 물리 고정 스텝에서 한 번씩 구동한다. `timeline.state.moving`은 타임라인에 다음 스텝이 필요한 동안 참이다.
- `activate("invert")`는 `ready`에서 0.25→0.75를 2.4초 재생하고 멈춘다. 180°에 1.44초에 도달하고 나머지 시간은 듣기 자세에 머문다. 스크럽으로 이미 회전 중이면 현재 각도부터 남은 구간을 재생한다. 되감는 중에 누르면 `state.queued`가 참이 되고, 진행률 0.2에서 0°에 도착하는 즉시 한 번 실행한다. 스크롤이 장면의 양 끝에 닿거나 `skip()`이 호출되면 예약을 해제한다.
- `activate("return")`은 듣는 상태에서 0.75→0.95를 1.0초 재생하고, 복귀 회전 중에는 남은 구간만 재생한다. 버튼 회전은 양끝 15%에서 각속도를 부드럽게 붙였다 놓는다. 최고 각속도는 반전 약 147.06°/초, 복귀 약 211.76°/초이며 스크럽은 기존 225°/초 상한을 사용한다. 요청을 실행하거나 예약했으면 `true`, 처리할 수 없으면 `false`를 돌려준다. 인수를 생략하면 `state.button`을 쓴다.
- 버튼 재생 중 `scrub(progress)`는 최신 스크롤 위치만 기억한다. 초점 이동이나 위치 보정 직후에도 재생을 완료하고, 멈춘 180°에서 스크롤을 계속하면 복귀한다. 제스처로 의도적인 인계를 연결할 때는 `scrub(progress, { interruptPlayback: true })`를 쓴다. 장면을 건너뛰면 `skip()`으로 정착 목표를 전달한다. 물리 입력은 `canInput`으로 제한한다.
- `climaxchange.detail`과 `timeline.state`의 `progress`는 실제 각도에 대응하는 진행률이다. 물리의 `building.setProgress(detail.progress)`로 전달한다. `angle`은 라디안, `angleDegrees`는 CSS용 도 단위다. `listening`은 실제 180° 듣기 상태이며 `holding`은 버튼 재생이 끝나 멈춘 상태다. 물리 재생은 `detail.listening`과 `building.listening`을 함께 확인한다.
- `LandingBuilding.climaxRotationScale(angle, stageAspect)`는 실제 회전각(라디안)과 회전 전 무대의 가로/세로 비율을 받아 배율을 반환한다. 1440×900 비율에서 120°는 약 0.82배, 243°는 약 0.81배다. 세로·정사각형 무대와 0°·180°·360° 자세는 1배다. 무대 비율은 리사이즈 때 갱신하고, 이 값을 기존 줌아웃 배율과 곱한다.
- `setReduced(true)`는 이벤트의 `reduced`를 갱신한다. 이 값을 받은 렌더러는 카메라 줌과 물리 스텝을 멈추고, 반전 정지 포즈에 `blend`를, 바로 선 포즈나 복귀 정지 포즈에 `1 - blend`를 적용한다. 핵심 카피와 버튼은 회전 레이어 바깥에 둔다. 데모는 재생 중 버튼에 있던 초점을 유지하며 Enter·Space 클릭 경로를 동일하게 처리한다.
- 장면 하단까지 화면 밖으로 지나친 경우 `skip()`을 호출해 360° 정착 이벤트를 한 번 내보낸다. 초기 복원 위치가 `scrub(1)`이어도 같은 상태로 진입한다. 그 뒤 위로 스크롤하면 일반 각속도 상한으로 돌아간다.

```js
const timeline = LandingBuilding.createClimaxTimeline({ eventTarget: section });
const disconnectPhysics = LandingBuilding.connectClimaxPhysics(timeline, building);
const returnPose = LandingBuilding.createClimaxReturnPose(building);
motion.addScene(section, {
  followReducedProgress: true,
  onProgress: (progress) => timeline.scrub(progress),
});
flipButton.addEventListener("click", () => timeline.activate("invert"));
returnButton.addEventListener("click", () => timeline.activate("return"));

// 기존 물리 고정 스텝에서 호출한다. 화면은 이 상태를 프레임당 한 번 그린다.
function stepClimax(dt) {
  timeline.advance(dt);
  if (!timeline.state.reduced) {
    building.step(dt);
    if (returnPose.update(timeline.state)) renderSettledPose();
  }
}

// stageAspect는 회전하기 전 레이아웃 너비 / 높이
const scale = LandingBuilding.climaxRotationScale(building.angle, stageAspect);
```

`createClimaxReturnPose(building)`의 `update(state)`는 실제 360°와 아래 방향 중력이 확인될 때 물리 팀의 `wakeRoom`·`settleReturnedRooms`·`resetCopyBlocks`에 연결한다. 이미 물리에서 정리한 방은 바로 사용한다. `true`가 된 뒤 카드와 다음 장면에 자세를 전달한다. 감소 모드에서 고정 스텝으로 결과 자세를 미리 계산할 때도 각 스텝 뒤에 같은 `update`를 호출한다. 장면을 해제할 때 `disconnectPhysics()`를 호출한다.

#### 센서 어댑터 연결 (스토리 v3)

| 어댑터 신호 | 모션 호출과 결과 |
|---|---|
| 첫 유효한 표본과 `tilting` | 스크롤 진행률 0.15 이상 0.25 미만에서 `startSensor()`를 호출한다. 화면 좌표로 변환한 중력은 `setSensorGravity({x,y})`로 전달한다. `stageAngleDegrees`는 센서 모드 내내 0°이며 `canInput`은 거짓이다. |
| `inverted` 또는 `returned` 확정 | `setSensorPhase("inverted" \| "returned")`를 호출한다. 듣기 상태는 기존 `listening`과 같다. `returned` 다음 `stopSensor()`로 닫으면 360° 정착 목표가 이어진다. 센서로 듣는 동안 기기 기준 핵심 카피만 180° 보정할 수 있다. |
| 화면이 함께 돌아감 | `stopSensor("screen-rotated")` 즉시 판정·중력 입력을 멈춘다. 무대가 0°에서 대기하고 1.2초 후 `sensorCue === "S4-17"`이 된다. 안내의 버튼에서 `activate("invert")`를 호출한다. |
| 스크롤 진행률 `> 0.7` | `scrub()`가 일반 타임라인으로 강제 전환하고 `sensorCue`에 S4-18을 1.2초 내보낸다. 어댑터도 센서 구독을 해제한다. |
| 센서로 뒤집힌 뒤 S4-06 표시 | `showSensorListeningCopy()`를 한 번 호출한다. 2초 뒤 `sensorCue`는 S4-19다. 듣기 상태가 끝나면 안내도 닫힌다. |

권한 요청, 표본 유효성, 화면 방향 변경 및 v3 반전·복귀 확정은 `site/modules/sensor.js`의 어댑터가 맡는다. `connectClimaxPhysics`는 모드에 맞춰 `building.setSensorGravity`, `clearSensorGravity` 및 일반 진행률을 적용한다. 모드가 바뀌는 프레임에는 센서 중력으로 멈춰 있던 솔버 각도를 인계 각도에 맞춘다. 권한 실패 시 버튼을 시작한 뒤 일반 `scrub(progress)`를 계속 전달할 수 있다. 센서 중력은 `climaxchange.detail.sensorGravity`를 통해 해당 장면에서만 전달한다.

#### v0.3.4 데스크톱·노트북 첫 회전 프레이밍

`climaxDesktopFrame(angle, { width, height, desktop, reduced, sensor })`의 `scale`은 `climaxRotationScale`이 구한 무대 축척에 곱할 비율이다. `offsetY`는 화면 좌표계의 세로 이동량이며 단위는 CSS px다. 가로세로 비가 1.6을 넘거나 높이가 900px보다 작으면 축소 폭을 늘린다. 낮은 무대에서는 위로 옮기는 비율을 줄이고 5층 진자가 머리띠에 가까워지는 각도에 맞춰 중심 이동을 일찍 푼다. 전체 축척의 회복 속도는 3°당 3% 이내로 제한하고 180°에서 원래 크기와 중심으로 돌아온다.

정밀 포인터가 있는 일반 모션 경로에서 `desktop: true`로 선택하고 회전 전 무대 크기를 전달한다. 최소 크기는 1280×720이다. 높이 960px까지 가로세로 비 1.5–1.8에 적용하고, 그보다 높은 무대에서는 기존 1.5–1.7 범위를 사용한다. `desktop` 기본값은 `false`이며 `reduced` 또는 `sensor`에서는 중립값 `{ scale: 1, offsetY: 0 }`을 돌려준다.

```js
const framing = LandingBuilding.climaxDesktopFrame(building.angle, {
  width: stageWidth, height: stageHeight, desktop, reduced: staticFrame, sensor,
});
stage.style.scale = String(baseScale * framing.scale);
stage.style.translate = `0 ${baseOffsetY + framing.offsetY}px`;
```

실빌드 S4 소스의 배치·물리 바인딩을 Node에서 불러와 3° 단위 스크럽과 125°/초·225°/초 회전으로 좌표를 검사했다. 입력은 초기 자세, 공 두드리기, 좌우 낙하와 의자 이동 네 가지다. 7층 글 상자는 Hahmlet 720 굵기의 글자 폭과 CSS 줄 높이로 계산했다. 표는 머리띠 아래에 상자 전체가 들어온 프레임 수다.

| 무대 | 120° 전체 축척 · 세로 이동 | 가구·진자 8개 105–135° (228개) | 7층 글 블록 117–150° (244개) |
|---|---:|---:|---:|
| 1280×720 | 0.620배 · −82px | 0 → 228 | 6 → 242 |
| 1366×768 | 0.623배 · −90px | 0 → 228 | 4 → 242 |
| 1536×864 | 0.630배 · −106px | 0 → 228 | 2 → 244 |
| 1512×982 | 0.687배 · −118px | 227 → 228 | 156 → 244 |
| 1440×900 | 0.672배 · −108px | 227 → 228 | 148 → 244 |

전체 축척 변화는 정·역방향 모두 3°당 최대 2.98%였다. 낮은 두 무대의 150° 스크럽 표본에서는 글 상자가 최대 7px 화면 아래로 나갔다. 138–156° 구간의 일부 넓은 노트북 표본에서는 5층 진자 상자가 머리띠에 최대 5px 걸렸다. 실브라우저 화면은 실빌드의 `angles` 검사에서 확인할 항목이다.

#### v0.5 6층 의자 듣기 프레이밍

`climaxListeningFrame(angle, { width, height, reduced, sensor })`는 135–225°에서 부드럽게 들어오고 풀리는 별도 보정이다. 물리 각도를 라디안으로 받고 180° 동안 고정된 축척·세로 이동을 반환한다. 좁은 무대에는 좌우 여백을 만들고, 낮은 가로 화면에서는 6층 의자와 6→7 슬래브를 듣기 설명 아래로 내린다. 버튼·스크롤·역스크롤 모두 같은 각도를 사용한다. 정지 모드와 센서 모드는 `{ scale: 1, offsetY: 0 }`을 받는다.

```js
const listenFrame = LandingBuilding.climaxListeningFrame(building.angle, {
  width: stageWidth, height: stageHeight, reduced: staticFrame, sensor,
});
stage.style.scale = String(baseScale * framing.scale * listenFrame.scale);
stage.style.translate = `0 ${baseOffsetY + framing.offsetY + listenFrame.offsetY}px`;
```

실빌드 S4 배치·물리 바인딩을 사용한 Node 좌표 검사로 세 초기 입력과 버튼 속도·최대 스크럽 속도·3°씩 멈추는 스크럽에서 듣기 시작 뒤 2초를 확인했다. 표에서 왼쪽·위는 각 표본의 최소값이다.

| 무대 | 의자 상자 왼쪽 전 → 후 | 의자 상자 위 전 → 후 | 화면 안 표본 전 → 후 |
|---|---:|---:|---:|
| 390×844 | −12.15 → 13.35px | 333.70 → 344.56px | 126 → 189 |
| 844×390 | 30.82 → 93.41px | 11.75 → 200.97px | 182 → 189 |
| 1280×720 | 58.47px | 284.90px | 189 → 189 |
| 1440×900 | 56.76px | 358.40px | 189 → 189 |

기본 재생의 6→7 접촉점은 듣기 상태에 들어간 뒤 0.6초에 390×844에서 (240, 473), 844×390에서 (515, 279)로 투영됐다. 위 수치는 뷰포트와 머리띠 경계를 기준으로 한 상자 검사다. 실빌드 브라우저에서 듣기 설명·의자·이름표·파동의 겹침을 함께 확인한다. 특히 넓은 두 화면은 듣기 설명이 가운데 쪽 의자를 가릴 수 있다.

#### v0.6 F1 무대 표본과 정지 자세

`createClimaxView(initialAngle)`을 물리 건물과 함께 만들고, 고정 스텝마다 `view.record(building.angle)`을 호출한다. `sample({ alpha, zoom, width, height, desktop, paused, reduced, sensor })`에 물리 누적 시간을 스텝 길이로 나눈 `alpha`와 회전 전 무대 치수를 전달한다. 반환값의 `poseAlpha`를 가구에, 라디안 `angle`·배율 `scale`·화면 Y 이동 `offsetY`(CSS px)를 무대에 사용한다. 일시정지에서는 직전 값으로 잠그고 첫 새 물리 스텝 이후에 다시 계산한다. 센서 인계나 일괄 정착으로 물리 자세를 즉시 바꿨으면 `view.record(angle, { snap: true })`로 이전 표본도 맞춘다.

```js
const view = LandingBuilding.createClimaxView(building.angle);
// 각 물리 스텝 직후
view.record(building.angle);
// 화면 갱신마다
const frame = view.sample({ alpha, zoom, width, height, desktop, paused, reduced, sensor });
pose(frame.poseAlpha);
```

일반 모션의 회전 레이어에 `frame`의 카메라 값과 각도를 쓴다. 움직임 줄이기는 `createPageFlip(layer, { reduced: true })`에서 `fade.setListeningFrame(climaxListeningFrame(Math.PI, { width, height }))`를 호출한다. 180° 정지 면은 같은 줌·이동을 유지한 채 교차 페이드하고 정방향 면은 기준 위치에 남는다. 움직임 줄이기 경로가 켜진 상태에서 일시정지 버튼을 누르면 `fade.setPaused(paused)`로 진행과 불투명도를 멈춘다. 844×390의 뒤집힌 정지 면은 0.84배, 아래로 159.9px다. 390×844는 약 0.877배다. [통합 연결](../../discussion/lt-sol-motion-v06F1-연결.md)

#### v0.6 F2 6/7 슬래브 이름표와 모바일 질문

`climaxSlabLabels({ width, height, slabY, anchorX, frame, inverted, sensor, labelWidth, labelHeight, insets })`는 회전 전 단면의 슬래브 점 `(anchorX, slabY)`를 회전 레이어 바깥의 CSS 좌표로 옮긴다. `frame`에는 무대와 같은 `angle`(라디안), `scale`, `offsetY`(CSS px)를 사용한다. 반환값 `anchor`는 선을 잇는 점이고, `floor`·`ceiling`은 `{ room, x, y }` 형태의 이름표 중심이다. `inverted` 전환으로 `7층 바닥 / 6층 천장`이 `6층 바닥 / 7층 천장`이 된다. `textAngle`은 일반 회전 중 0°, 센서 반전 시 기기 기준 180°다. 360px 이하의 화면은 두 이름을 위아래에 놓고, 안전 여백에 두 상자가 들어갈 수 없으면 `null`을 돌려준다.

`climaxSlabLabelFrames({ ...options, invertedInsets })`는 바로 선 면과 뒤집힌 면의 고정 좌표를 반환한다. `invertedInsets`로 듣기 설명만 피할 수 있다. 줄이기는 `createPageFlip`의 `onFrame(progress)`와 같은 비율로 둘을 교차 표시한다. E5 접촉점처럼 선 위 다른 점은 `projectClimaxPoint({ x, y }, { width, height, ...frame })`로 같은 화면에 투영한다.

`showClimaxQuestion(visiblePhase, width)`는 480px 이하의 준비·반전에서 기존 질문을 화면에 고정한다. 표시하는 동안 원래 물리 복제본은 `visibility`로 가린다. 390px의 120°에서도 질문을 읽을 수 있고 180°의 듣기 설명이 이어진다. [통합 연결과 80px 설명 여백](../../discussion/lt-sol-motion-v06F2-연결.md)

정적 미리보기의 데모는 실제 `createBuilding()` 인스턴스를 이 이벤트에 연결하고, 6층 의자를 한 번 움직여 만든 기록을 듣기 구간에서 재생한다. 파일 데모에서는 같은 흐름을 정지 도형으로 시연한다.

#### v0.6 F2b 듣기 고정 구간과 복귀 카드

S4 섹션을 `350svh`, 고정 패널을 `100svh`로 둔다. `createClimaxScrollMap({ travel, panelHeight, viewportHeight })`은 CSS px 단위로 재는 고정 이동 거리에서 듣기 시작·끝인 `listenStart`·`listenEnd`를 정한다. `progressAt(offset)`을 스크럽에, `offsetAt(progress)`를 버튼이나 키보드 초점이 S4의 준비 위치로 이동할 때 쓴다. 1440×900의 듣기 구간은 고정 시작점부터 792–1890px이며 길이는 1098px(1.22화면)이다. 390×844는 약 1030px이다. 작은 뷰포트 단위로 고정한 패널과 실제 화면 높이가 다르면 `viewportHeight`로 가용 구간을 조정한다. 측정값이 0 이하이면 `null`을 받아 기존 진행률을 쓸 수 있다.

```js
const timeline = LandingBuilding.createClimaxTimeline({ eventTarget: section, holdButtonToListenEnd: true });
const bounds = section.getBoundingClientRect();
const panelHeight = panel.getBoundingClientRect().height;
const map = LandingBuilding.createClimaxScrollMap({
  travel: bounds.height - panelHeight, panelHeight, viewportHeight: window.innerHeight,
});
timeline.scrub(map ? map.progressAt(-bounds.top) : fallbackProgress);
```

일반 모션과 줄이기는 같은 스크롤 매핑과 기존 .55–.75 듣기 구간을 쓴다. 버튼 반전은 `holdButtonToListenEnd: true`일 때 완료 위치에서 .75까지 그대로 머물고, 이어 내리면 남은 스크롤을 .75–1에 대응시킨다. `activate("return")`은 해당 위치에서도 즉시 시작된다. 별도 시간 잠금 없이 네이티브 스크롤, 되감기, 직접 건너뛰기를 지원한다. 의자 재생은 듣기 상태가 실제로 표시된 다음 `building.replayChairCue()`로 예약해 0.6초에 한 번 전달한다.

`visibleClimaxCue(phase, angle, { listening, invertedOpacity })`에는 실제 렌더 각도를 라디안으로 넘긴다. `return`·`settle`만 S4 복귀 카드를 표시하며 330° 전의 `returning`에는 카드를 숨긴다. 줄이기에서는 `createPageFlip`의 `onFrame(progress)`에서 뒤집힌 면의 불투명도를 넘기면 바로 선 면에 완전히 닿았을 때 카드가 열린다. [arch 통합 연결](../../discussion/lt-sol-motion-v06F2b-연결.md)

#### v0.7 F3 보조 안내와 S4 충격 표시

`sceneHint(scene, options)`은 보조 안내 ID 하나 또는 `null`을 돌려준다. S1(`gesture`)에서는 `touch`, `idleMs`, `gestureUsed`로 무조작 3초를 판정한다. S2(`listen`)에서는 U-08 표시 중에는 `vibration`, 테이프 완료 뒤 음소거면 `sound`다. 재생 중·장면 이탈 시 소리 안내를 닫는다. 각 안내의 노출 주기와 시작·완료·취소 신호는 사이트 어댑터가 가진다.

`climaxImpactMarker(event, width, listening)`은 실제 듣기 중에 받은 6→7의 `s4-chair` 재생에서 `{ n, slab, label, x, value }`를 만든다. `x`는 무대 회전 전 건물 좌표의 0–1 정규화 위치다. 표지와 파동은 이 값을 공유한다. 라이브 접촉은 물리 모델 안에서 계속 일어난다. E5의 표시와 0.6초 박자는 듣기 카피를 연 뒤 기존 물리 재생으로 받는다. [F3 동작층 연결](../../discussion/lt-sol-motion-v07F3-연결.md)

Node 검사 실행

```sh
node proto/motion/verify-climax.mjs
```

구간 경계, 2.4초 반전과 1.0초 복귀, 버튼 중 초점·측정 간섭, 역회전·각속도 상한, 실제 물리의 E5 재생과 바닥 정착, 센서 인계, S5 비교와 S1 80svh를 검사한다. 60Hz·144Hz 무대 샘플, 일시정지 프레임 보존, 줄이기 교차 페이드, S4 이름표·질문·듣기 스크롤·복귀 카드, 가로·세로 축소와 화면 폭별 파동도 포함한다.

### 기존 건물 보조 API

`motion.css`, `building.css`, `engine.js`, `building.js`를 불러오면 `window.LandingBuilding`으로 아래 API를 쓸 수 있다. `motion.css`의 `:lang(ko)`가 `word-break: keep-all`을 적용하며 한 줄보다 긴 낱말에는 넘침 방지용 줄바꿈을 허용한다.

| API | 사용 방식 |
|---|---|
| `createFloorDescent(stack, { floors, onFloorChange })` | 높이가 고정 화면과 같은 방 세 개를 `lt-building-stack`의 직계 자식으로 쌓는다. `addScene`의 `onProgress`에 반환된 `(progress, { reduced })`를 호출한다. 기본 7·6·5층의 LED는 장면 진행률 `0.25`, `0.75`에서 바뀐다. 감소 모드는 이동을 생략하고 해당 층의 정지 프레임을 표시한다. |
| `createFloorDisplay(element, status?)` | `renderFloor(7)`처럼 한 자리 층을 전달한다. SVG 7세그먼트와 `F`를 표시한다. 화면상의 LED에는 `aria-hidden="true"`를, 선택적인 `status`에는 `role="status"`를 지정한다. |
| `createSlabWave(layer, { fullImpulse, reduced })` | `layer`를 슬래브 높이에 배치한다. `pulse({ impulse, x, direction })`에서 `x`는 왼쪽부터 `0`–`1`, `direction`은 아래 `1`·위 `-1`이다. 반환값은 `{ strength, amplitude, brightness, thickness, duration }`이고 0 이하의 충격은 건너뛴다. 진폭과 호 두께는 px, 호의 지속시간은 ms다. 세 값과 호 사이 지연을 타격 시점의 화면 폭에 비례해 적용한다. 호의 선은 `.lt-slab-wave-arc::before`에 그리며 색은 `currentColor`를 쓴다. 슬롯 네 개를 재사용해 연속 타격에도 파동 DOM 수를 유지한다. `setReduced(true)`는 현재 폭에 맞춘 마지막 파동의 정지 포즈를 적용한다. `destroy()`에서 애니메이션과 효과 요소를 해제한다. |
| `createPageFlip(layer, { reduced, onChange })` | 전체 화면 크기의 `lt-building-viewport` 안에 `lt-building-flip-layer`를 둔다. `toggle()`·`setFlipped(boolean)`으로 전환하고, 스크롤로 연결하려면 `seek(0..1)`을 사용한다. `onChange`는 불리언 중력 상태를 받는다. 핵심 카피에는 `data-building-upright`를 달아 반대 각도로 회전시킨다. 버튼은 회전 레이어 바깥에 둔다. |

`createPageFlip`은 원본 레이어를 같은 자리에 둔 채 화면 내부의 변형만 갱신한다. `setReduced(true)`에서는 정방향과 180° 정지 포즈를 약 210ms 동안 교차 표시한다. 교차용 레이어는 스크린리더와 포커스 순서에서 제외되고, 전환이 끝나면 원본 DOM이 화면에 남는다. 복제될 장식은 클래스 기반으로 스타일링한다. `destroy()`는 교차용 레이어를 제거하고 원래 인라인 스타일을 복원한다.

```js
// 방 좌표계에서 왼쪽 벽이 x=0이고 너비가 roomWidth인 경우
const wave = LandingBuilding.createSlabWave(waveLayer, { fullImpulse: 320 });
const stopImpacts = world.onImpact(({ a, b, point, normalImpulse, closingSpeed }) => {
  if ((a === slabBody || b === slabBody) && closingSpeed >= 12) {
    wave.pulse({ impulse: normalImpulse, x: point.x / roomWidth });
  }
});

const flip = LandingBuilding.createPageFlip(pageLayer, {
  onChange(flipped) {
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    world.gravityTo({ x: 0, y: flipped ? -960 : 960 }, reducedMotion ? 0 : 720);
  },
});
// 장면 해제 시 stopImpacts(), wave.destroy(), flip.destroy() 호출
```

## 장면 등록

`<head>`에서 `motion.css`, `engine.js`, 장면 등록 스크립트를 순서대로 불러온다. 스크립트 태그에는 `defer`를 쓴다. 고전 스크립트로 제공해 로컬 파일로 열 수 있으며 API는 `window.LandingMotion`에서 사용한다.

```html
<section id="chapter" class="lt-motion-scene">
  <div class="lt-motion-sticky" data-motion-sticky>
    <h2 id="chapter-title">장면의 원문</h2>
  </div>
</section>
```

```js
const { createMotion, easing } = window.LandingMotion;
const motion = createMotion();
const scene = motion.addScene(document.getElementById("chapter"), {
  tracks: [{
    element: document.getElementById("chapter-title"),
    from: { y: 16, opacity: 0.45 },
    to: { y: 0, opacity: 1 },
    start: 0.15,
    end: 0.65,
    ease: easing.easeInOut,
  }],
  events: [{ at: 0.6, enter: addBody, leave: removeBody }],
});
```

`addBody`와 `removeBody`를 사이트의 물리 어댑터에서 연결한다. 각 콜백은 `{ scene, reduced }`를 받는다. 데모의 연결부는 표식 DOM의 생성·제거에 이 API를 사용한다.

- `createMotion({ driver: "auto" })`는 문서 루트의 CSS `scroll-timeline`과 픽셀 `animation-range`를 사용할 수 있으면 CSS를 선택한다. 미지원 환경과 `{ driver: "js" }`는 중앙 `requestAnimationFrame`에서 JS로 갱신한다. `motion.driver`로 `"css"` 또는 `"js"`를 확인할 수 있다. JS 경로는 둘 다에서 장면 진행률, 임계점 이벤트, SVG, 카운터를 맡는다.
- `addScene(section, { panel, tracks, events, onProgress })`의 기본 `panel`은 섹션의 직계 자식 `[data-motion-sticky]`다. 일반 세로 문서 스크롤과 상단 오프셋 `0`을 사용한다. 장면 진입은 섹션 상단이 화면 상단에 닿을 때, 종료는 섹션 하단이 패널 하단에 닿을 때다. `scene.progress`는 이 구간을 `0`에서 `1`로 나타낸다. `ResizeObserver`와 창 리사이즈로 경계를 갱신하며, 섹션 위치만 변경하는 외부 레이아웃 작업 뒤에는 `motion.refresh()`를 호출할 수 있다.
- 기본 섹션은 `180svh`, 고정 패널은 `100svh`를 최소 높이로 사용한다. 주소창이 나타나거나 사라져도 타임라인 길이는 패널의 안정된 높이에서 계산된다. 문서 끝에 있는 장면은 가장 큰 뷰포트에서도 종료 지점까지 스크롤할 수 있도록 후행 공간을 둔다. 데모는 `100lvh`와 `100svh`의 차이를 푸터 최소 높이에 반영한다.
- 트랙은 패널 안에서 요소마다 하나씩 등록한다. `x`, `y`는 px, `rotate`는 도, `scale`, `opacity`는 단위 없는 숫자다. 트랙의 `start`, `end`는 장면 진행률 기준이며 기본값은 `0`, `1`이다. 트랙용 요소의 기존 CSS 애니메이션·변형은 바깥 래퍼에 둘 수 있다.
- `onProgress(progress, { scene, reduced })`는 장면 진행률이 바뀌면 호출된다. `events`는 진행률이 `at` 이상이 될 때 `enter`, 미만이 될 때 `leave`를 한 번씩 호출한다. 한 프레임에 여러 지점을 건너뛰면 `enter`는 낮은 지점부터, `leave`는 높은 지점부터 호출한다. 복원된 스크롤에서 시작하면 이미 지난 임계점도 활성화된다. `scene.remove()`와 `motion.destroy()`는 활성 임계점의 `leave`를 호출하고 트랙을 정리한다.
- `prefers-reduced-motion`을 사용하면 기본 고정 레이아웃을 일반 흐름으로 바꾸고 트랙 및 `onProgress`에는 완성 상태를 적용한다. 활성 임계점은 `leave`로 정리한다. `followReducedProgress: true`인 장면의 `onProgress`에는 현재 진행률이 전달되므로 건물처럼 층을 정지 화면으로 바꿔 표시할 수 있다. 이 옵션을 사용해도 트랙은 완성 상태를 유지하고 임계점 이벤트는 중지된다.

## 보조 API

| API | 사용 방식 |
|---|---|
| `tween(from, to, { start, end, ease })` | 수치 보간 함수가 반환된다. `easing.linear`, `easing.easeInOut`, `easing.easeOut`, `cubicBezier(x1, y1, x2, y2)`를 CSS와 JS에서 공통으로 쓴다. |
| `splitText(element)` | 평문을 자소군별 `span` 배열로 돌려준다. 한글 조합형 자모, 결합 문자, 이모지 시퀀스가 같은 단위에 남는다. 원문은 호스트의 `aria-label`과 스크린리더용 텍스트에 보존한다. `Intl.Segmenter`가 없으면 기존 평문을 유지하고 빈 배열을 반환한다. |
| `drawPath(path, { steps = 30 })` | SVG `path`를 처음부터 끝까지 드러내는 진행률 함수가 반환된다. 원본은 끝 상태다. 같은 스타일을 복제 경로에도 적용하도록 클래스나 SVG 그룹을 사용한다. |
| `morphPath(path, destination, { steps = 24 })` | 기하 형태를 보간하는 진행률 함수가 반환된다. 시작과 끝은 같은 순서의 절대 `M`, `L`, `Q`, `C`, `Z` 명령을 사용하며 명령 문자를 매번 명시한다. SVG의 상위 요소에 접근 가능한 이름을 붙인다. |
| `counter(element, { from = 0, to, start, end, ease, label })` | 음이 아닌 정수 카운터의 진행률 함수가 반환된다. 화면의 자릿수는 `transform`으로 바뀐다. 보조 기술에는 `label`로 완성 값이나 수치의 뜻을 한 번 전달한다. |

## 프레임 예산과 검증

일반 스크롤 프레임에 엔진과 보조 API가 쓰는 시각 속성은 `transform`과 `opacity`다. SVG는 설치 때 벡터 중간 상태를 만들고, 스크롤 중에는 인접한 상태로 전환한다. 그리기·모프 모두 설정 가능한 2~60개 구간으로 나뉜다. 프레임마다 `d`나 `stroke-dashoffset`을 재계산하는 비용과 연속 보간 사이에서 단계 수를 조절할 수 있다. 콜백에 연결한 물리 엔진의 작업량 및 브라우저의 SVG 합성 비용은 따로 측정해야 한다.

60fps의 프레임 예산은 약 16.7ms다. 레이아웃 측정은 리사이즈 또는 `refresh()` 후 한 번 묶어서 실행한다. JS는 바뀐 트랙·자릿수·벡터 상태만 갱신한다. `onProgress`에서도 레이아웃 읽기와 DOM 추가·제거를 피하고, 바디 생성 같은 상태 변경은 `events`에 연결한다.

로컬 Node에서 스크립트 구문과 모의 DOM 동작을 검증했다. Chrome과 Firefox의 헤드리스 프로세스는 이 작업 환경의 제약으로 시작하지 못해 실제 CSS 타임라인, 화면 배치, 모바일 주소창 동작 및 프레임 시간은 측정하지 못했다.

건물 데모는 Node에서 7F→6F→5F와 역순 경계, 회전·역회전과 카피 각도, 크로스페이드 중간값, 스크롤 값 보존을 점검했다. 실제 `World.onImpact()`를 모의 DOM에 연결해 약한·강한 충격의 지수(44·82)와 6층에서 같은 파동이 재생되는 것도 확인했다. 건물 데모의 화면 배치는 헤드리스 Chrome 시작이 차단돼 검증하지 못했다.

통합 브라우저에서 `demo.html`을 열어 같은 스크롤 위치에서 두 경로의 이동·투명도를 비교하고, 둘째 장면을 앞뒤로 지나며 표식이 한 번씩 생성·제거되는지 확인한다. 390×844 및 844×390에서 첫 장면을 점검하고, 실제 모바일에서 주소창이 바뀔 때 고정 장면이 흔들리지 않는지 확인한다. 개발자 도구의 움직임 감소 에뮬레이션으로 완성 상태와 고정 해제를 확인한 뒤 성능 탭에서 스크롤 중 프레임 시간을 측정한다.
