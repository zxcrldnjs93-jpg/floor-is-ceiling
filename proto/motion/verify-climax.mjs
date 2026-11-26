import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { angleForProgress, createBuilding, MAX_ANGULAR_SPEED } from "../physics/building.js";

const engine = vm.createContext({ window: {}, EventTarget, CustomEvent });
for (const file of ["engine.js", "building.js"]) {
  vm.runInContext(readFileSync(new URL(file, import.meta.url), "utf8"), engine);
}
const {
  createClimaxTimeline, climaxRotationScale, climaxDesktopFrame, createSlabWave, connectClimaxPhysics, createClimaxReturnPose,
  climaxListeningFrame, createClimaxView, createPageFlip, createCushionTimeline, sampleIntroExtension,
  projectClimaxPoint, climaxSlabLabels, climaxSlabLabelFrames, showClimaxQuestion, createClimaxScrollMap, visibleClimaxCue,
  sceneHint, gestureHintDelayMs, climaxImpactMarker,
} = engine.window.LandingBuilding;
const close = (actual, expected, tolerance = 1e-8) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);
};

test("스크럽 구간의 경계, 버튼, 줌아웃, 듣기 전용", () => {
  const timeline = createClimaxTimeline();
  const checkpoints = [
    [0, "zoom", 0, null], [0.075, "zoom", 0, null], [0.15, "ready", 0, "invert"],
    [0.25, "invert", 0, "invert"], [0.40, "invert", 90, "invert"],
    [0.55, "listen", 180, "return"], [0.75, "listen", 180, "return"],
    [0.85, "return", 270, "return"], [0.95, "settle", 360, null], [1, "settle", 360, null],
  ];
  for (const [progress, phase, angle, button] of checkpoints) {
    timeline.scrub(progress);
    timeline.advance(2);
    assert.equal(timeline.state.progress, progress);
    assert.equal(timeline.state.phase, phase);
    assert.equal(timeline.state.button, button);
    assert.equal(timeline.state.listening, phase === "listen");
    assert.equal(timeline.state.canInput, progress < 0.25 || progress >= 0.95);
    close(timeline.state.angleDegrees, angle);
    close(timeline.state.zoom, Math.min(1, progress / 0.15));
  }
});

test("350svh S4는 모바일 주소창 변화에도 반 화면과 한 화면 스크롤이 듣기 구간을 건너뛰지 않는다", () => {
  for (const [panelHeight, viewportHeight] of [[900, 900], [844, 844], [390, 390], [760, 844], [600, 900]]) {
    const travel = 2.5 * panelHeight;
    const map = createClimaxScrollMap({ travel, panelHeight, viewportHeight });
    assert.ok(map.listenEnd - map.listenStart >= viewportHeight);
    if (viewportHeight === panelHeight) close(map.listenEnd - map.listenStart, 1.22 * panelHeight);
    assert.equal(map.progressAt(map.listenStart), 0.55);
    assert.equal(map.progressAt(map.listenEnd), 0.75);
    assert.equal(map.progressAt(-20), 0);
    assert.equal(map.progressAt(travel + 20), 1);
    for (const progress of [0, 0.15, 0.2, 0.25, 0.55, 0.65, 0.7, 0.75, 0.8, 0.95, 1]) {
      close(map.progressAt(map.offsetAt(progress)), progress);
    }
    for (const stride of [viewportHeight / 2, viewportHeight]) {
      for (let start = 0; start < stride; start++) {
        const firstStop = start + Math.ceil((map.listenStart - start) / stride) * stride;
        const progress = map.progressAt(firstStop);
        assert.ok(progress >= 0.55 && progress <= 0.75);
      }
    }
  }
  assert.equal(createClimaxScrollMap({ travel: 0, panelHeight: 900 }), null);
});

test("R2 반 화면 수동 스크롤의 첫 듣기 정류장에서 두 모션 모드 모두 0.6초 뒤 E5를 한 번 재생한다", () => {
  const height = 900;
  const map = createClimaxScrollMap({ travel: 2.5 * height, panelHeight: height });
  const previousStop = 750;
  const nextStop = previousStop + height / 2;
  assert.ok(previousStop < 0.55 * 1.6 * height); // Under the old linear mapping, this grid misses listening.
  assert.ok(nextStop > 0.75 * 1.6 * height);

  for (const reduced of [false, true]) {
    const timeline = createClimaxTimeline({ reduced, holdButtonToListenEnd: true });
    const building = createBuilding();
    const stop = connectClimaxPhysics(timeline, building);
    const events = [];
    const off = building.onReceive((event) => { if (event.cue === "s4-chair") events.push(event); });
    timeline.scrub(map.progressAt(previousStop));
    for (let i = 0; i < 360; i++) {
      timeline.advance(building.dt);
      building.step();
    }

    timeline.scrub(map.progressAt(nextStop));
    if (reduced) {
      timeline.advance(4);
      for (let i = 0; i < 120 && !building.listening; i++) building.step();
      assert.equal(building.listening, true);
    }
    const resumedAt = building.world.time;
    let enteredAt;
    for (let i = 0; i < 360; i++) {
      timeline.advance(building.dt);
      building.step();
      const cue = visibleClimaxCue(timeline.state.phase, building.angle, { listening: building.listening });
      if (enteredAt === undefined && cue === "listen") {
        enteredAt = building.world.time;
        assert.equal(building.replayChairCue(), true);
      }
    }
    assert.ok(enteredAt !== undefined);
    assert.equal(events.length, 1);
    assert.deepEqual([events[0].sourceRoom, events[0].receiverRoom], [6, 7]);
    close(events[0].time - enteredAt, 0.6);
    assert.ok(events[0].time - resumedAt < 2.5);
    timeline.scrub(map.progressAt(map.listenEnd + 90));
    timeline.advance(2);
    assert.ok(timeline.state.angle > Math.PI);
    timeline.scrub(map.progressAt(nextStop));
    timeline.advance(2);
    assert.equal(timeline.state.angle, Math.PI);
    assert.equal(timeline.state.listening, true);
    off();
    stop();
  }
});

test("Enter·Space와 같은 버튼 호출 뒤 한 화면 내려도 듣는 중이고 명시적 복귀는 즉시 시작한다", () => {
  const height = 900;
  const map = createClimaxScrollMap({ travel: 2.5 * height, panelHeight: height });
  for (const reduced of [false, true]) {
    const timeline = createClimaxTimeline({ reduced, holdButtonToListenEnd: true });
    const readyOffset = map.offsetAt(0.2);
    timeline.scrub(map.progressAt(readyOffset));
    assert.equal(timeline.activate(), true);
    timeline.advance(0.1);
    timeline.scrub(map.progressAt(readyOffset + 30));
    assert.equal(timeline.state.playing, "invert");
    timeline.advance(2.3);
    timeline.scrub(map.progressAt(readyOffset + height));
    assert.equal(timeline.state.holding, true);
    assert.equal(timeline.state.button, "return");
    timeline.scrub(map.progressAt(map.listenEnd));
    assert.equal(timeline.state.angleDegrees, 180);
    assert.equal(timeline.state.holding, true);
    timeline.scrub(map.progressAt(map.listenEnd + 1));
    timeline.advance(0.1);
    assert.equal(timeline.state.holding, false);
    assert.ok(timeline.state.angleDegrees > 180);
    timeline.scrub(map.progressAt(map.listenEnd - 1));
    timeline.advance(0.1);
    assert.equal(timeline.state.angleDegrees, 180);
    assert.equal(timeline.activate(), true);
    assert.equal(timeline.state.playing, "return");
    timeline.advance(1);
    assert.equal(timeline.state.angleDegrees, 360);
    timeline.skip();
    assert.equal(timeline.state.skipped, true);
  }
});

test("복귀 카드는 실제 330°부터 보이고 줄이기는 뒤집힌 면이 사라질 때까지 기다린다", () => {
  const cueAt = (phase, degrees, options) => visibleClimaxCue(phase, degrees * Math.PI / 180, options);
  assert.equal(cueAt("ready", 0), "ready");
  assert.equal(cueAt("invert", 120), "invert");
  assert.equal(cueAt("listen", 179), "invert");
  assert.equal(cueAt("listen", 180, { listening: true }), "listen");
  for (const degrees of [180, 270, 329.9]) assert.equal(cueAt("return", degrees), "returning");
  for (const degrees of [330, 350, 360]) assert.equal(cueAt("return", degrees), "return");
  assert.equal(cueAt("settle", 290), "returning");
  assert.equal(cueAt("settle", 350), "return");
  assert.equal(cueAt("settle", 360), "settle");
  assert.equal(cueAt("settle", 360, { invertedOpacity: 0.001 }), "returning");
  assert.equal(cueAt("settle", 360, { invertedOpacity: 0 }), "settle");
  assert.equal(cueAt("return", 329.9), "returning"); // Rewind through the same boundary.
  assert.equal(cueAt("settle", 0, { invertedOpacity: 0.5 }), "returning");
});

test("S1 터치 안내는 3초 쉬었을 때만 열리고 S2 소리 안내는 테이프 완료 뒤 한 번에 하나씩 열린다", () => {
  assert.equal(gestureHintDelayMs, 3000);
  assert.equal(sceneHint("gesture", { touch: true, idleMs: 2999 }), null);
  assert.equal(sceneHint("gesture", { touch: false, idleMs: 3000 }), null);
  assert.equal(sceneHint("gesture", { touch: true, idleMs: 3000 }), "gesture");
  assert.equal(sceneHint("gesture", { touch: true, idleMs: 3000, gestureUsed: true }), null);
  assert.equal(sceneHint("flip", { touch: true, idleMs: 4500, vibrationHint: true }), null);
  assert.equal(sceneHint("listen", { soundMuted: true }), null);
  assert.equal(sceneHint("listen", { soundMuted: true, replaying: true, replayFinished: true }), null);
  assert.equal(sceneHint("listen", { soundMuted: true, replayFinished: true }), "sound");
  assert.equal(sceneHint("listen", { soundMuted: false, replayFinished: true }), null);
  assert.equal(sceneHint("listen", { soundMuted: true, replayFinished: true, vibrationHint: true }), "vibration");
});

test("S4는 듣기 중 E5 6→7만 같은 층 좌표의 표지로 바꾼다", () => {
  const event = { kind: "replay", cue: "s4-chair", label: "6층 의자", sourceRoom: 6, receiverRoom: 7,
    slab: "6/7", point: { x: 420, y: 90 }, index: 141 };
  const slow = climaxImpactMarker({ ...event, time: 8.6 }, 480, true);
  const fast = climaxImpactMarker({ ...event, time: 1.4 }, 480, true);
  assert.deepEqual(slow, fast);
  assert.equal(slow.x, 0.875);
  assert.equal(slow.slab, "6-7");
  assert.equal(slow.label, "6층 의자");
  assert.equal(slow.value, 141);
  assert.equal(climaxImpactMarker({ ...event, kind: "live" }, 480, true), null);
  assert.equal(climaxImpactMarker({ ...event, receiverRoom: 5 }, 480, true), null);
  assert.equal(climaxImpactMarker(event, 480, false), null);
});

test("빠른·느린 실제 회전에서 물건이 접촉해도 보이는 첫 S4 표지는 듣기 0.6초 뒤 한 건이다", () => {
  let sameMarker;
  for (const turnSeconds of [0.8, 1.44, 2, 8]) {
    const building = createBuilding();
    const total = Math.round(turnSeconds / building.dt);
    const presented = [];
    let contacts = 0;
    building.onContact(() => { contacts += 1; });
    building.onReceive((event) => {
      const mark = climaxImpactMarker(event, building.width, building.listening);
      if (mark) presented.push({ mark, time: event.time, chairX: building.rooms.get(6).props.chair.x / building.width });
    });
    for (let step = 1; step <= total; step++) {
      building.setProgress(0.25 + 0.3 * step / total);
      building.step();
    }
    assert.ok(contacts > 0);
    assert.equal(presented.length, 0);

    building.setProgress(0.65);
    const shownAt = building.world.time;
    assert.equal(building.replayChairCue(), true);
    for (let step = 0; step < 150; step++) building.step();
    assert.equal(presented.length, 1);
    assert.equal(presented[0].mark.slab, "6-7");
    close(presented[0].time - shownAt, 0.6);
    close(presented[0].mark.x, presented[0].chairX);
    sameMarker ??= presented[0].mark;
    assert.deepEqual(presented[0].mark, sameMarker);
    assert.equal(building.replayChairCue(), false);
  }
});

test("버튼은 2.4초에 180°에 멈추고 복귀 버튼이 이어서 재생된다", () => {
  const timeline = createClimaxTimeline();
  timeline.scrub(0.2);
  assert.equal(timeline.activate(), true);
  assert.equal(timeline.activate(), false);
  assert.equal(timeline.state.progress, 0.25);
  timeline.advance(1.44);
  close(timeline.state.angleDegrees, 180);
  assert.equal(timeline.state.listening, true);
  timeline.scrub(0.2);
  timeline.advance(0.95);
  assert.equal(timeline.state.playing, "invert");
  timeline.advance(0.01);
  assert.equal(timeline.state.progress, 0.75);
  assert.equal(timeline.state.holding, true);
  assert.equal(timeline.state.moving, false);
  timeline.advance(5);
  assert.equal(timeline.state.progress, 0.75);

  assert.equal(timeline.activate(), true);
  assert.equal(timeline.activate(), false);
  timeline.advance(0.5);
  close(timeline.state.angleDegrees, 270);
  timeline.advance(0.5);
  assert.equal(timeline.state.progress, 0.95);
  assert.equal(timeline.state.angleDegrees, 360);
  assert.equal(timeline.state.button, null);
});

test("버튼 양끝의 속도를 완화하고 120Hz 물리 및 듣기 재생 계약을 유지한다", () => {
  const timeline = createClimaxTimeline();
  const building = createBuilding();
  const stop = connectClimaxPhysics(timeline, building);
  const cues = [];
  const off = building.onReceive((event) => { if (event.cue === "s4-chair") cues.push(event); });
  let heardAt;
  function drive(steps) {
    const speeds = [];
    for (let i = 0; i < steps; i++) {
      const previous = timeline.state.angleDegrees;
      timeline.advance(building.dt);
      building.step();
      close(building.angle, timeline.state.angle);
      const speed = (timeline.state.angleDegrees - previous) / building.dt;
      assert.ok(speed >= -1e-7 && speed <= 225);
      speeds.push(speed);
      if (building.listening && heardAt === undefined) {
        heardAt = building.world.time;
        assert.equal(building.replayChairCue(), true);
      }
    }
    return speeds;
  }

  timeline.scrub(0.2);
  timeline.activate();
  const turn = drive(173);
  close(timeline.state.angleDegrees, 180);
  assert.ok(turn[0] < 1 && turn.at(-1) < 1);
  close(Math.max(...turn), 125 / 0.85);
  drive(115);
  assert.equal(timeline.state.holding, true);
  assert.equal(cues.length, 1);
  assert.deepEqual([cues[0].sourceRoom, cues[0].receiverRoom], [6, 7]);
  close(cues[0].time - heardAt, 0.6);

  assert.equal(timeline.activate("return"), true);
  const back = drive(120);
  close(timeline.state.angleDegrees, 360);
  assert.ok(back[0] < 1 && back.at(-1) < 1);
  close(Math.max(...back), 180 / 0.85);
  off();
  stop();
});

test("180° 정지 후 계속 내리면 복귀하고 거꾸로 내린 만큼 역회전한다", () => {
  const timeline = createClimaxTimeline();
  timeline.scrub(0.2);
  timeline.activate();
  timeline.advance(2.4);
  timeline.scrub(0.36);
  assert.equal(timeline.state.phase, "return");
  assert.equal(timeline.state.listening, false);
  timeline.advance(0.4);
  close(timeline.state.progress, 0.8);
  close(timeline.state.angleDegrees, 225);

  timeline.scrub(0.12);
  timeline.advance(0.1);
  close(timeline.state.angleDegrees, 202.5);
  timeline.advance(1);
  close(timeline.state.progress, 0.45);
  close(timeline.state.angleDegrees, 120);
  timeline.scrub(0);
  timeline.advance(1);
  assert.equal(timeline.state.angleDegrees, 0);
  assert.equal(timeline.state.phase, "zoom");
});

test("버튼 재생 중 명시적인 스크롤 인계만 현재 각도에서 제어를 가져온다", () => {
  const timeline = createClimaxTimeline();
  timeline.scrub(0.2);
  timeline.activate();
  timeline.advance(0.5);
  const before = timeline.state.angle;
  timeline.scrub(0.21, { interruptPlayback: true });
  assert.equal(timeline.state.playing, null);
  assert.equal(timeline.state.angle, before);
  timeline.advance(3);
  assert.ok(timeline.state.angle > before);
  assert.ok(timeline.state.progress < 0.55);
  assert.equal(timeline.state.holding, false);
});

test("버튼 재생 초기에 초점·스크롤 측정이 재생을 끊지 않는다", () => {
  const timeline = createClimaxTimeline();
  timeline.scrub(0.2);
  timeline.activate("invert");
  timeline.advance(0.016);
  const before = timeline.state.angleDegrees;
  assert.ok(before > 0 && before < 2);
  timeline.scrub(0.11);
  assert.equal(timeline.state.playing, "invert");
  close(timeline.state.angleDegrees, before);
  timeline.advance(1);
  timeline.scrub(0.4);
  timeline.advance(1.384);
  assert.equal(timeline.state.holding, true);
  assert.equal(timeline.state.angleDegrees, 180);
  timeline.scrub(0.4);
  assert.equal(timeline.state.holding, true);
  timeline.scrub(0.42);
  timeline.advance(0.1);
  assert.ok(timeline.state.angleDegrees > 180);
});

test("빠른 스크럽과 역회전에서 물리 엔진과 각도 및 225°/초 상한이 일치한다", () => {
  const target = new EventTarget();
  const timeline = createClimaxTimeline({ eventTarget: target });
  const building = createBuilding();
  let events = 0;
  target.addEventListener("climaxchange", ({ detail }) => {
    events += 1;
    close(angleForProgress(detail.progress), detail.angle);
    building.setProgress(detail.progress);
  });
  timeline.scrub(0);
  for (const position of [1, 0.27, 0.62, 0.98, 0]) {
    timeline.scrub(position);
    let steps = 0;
    while (timeline.state.moving && steps++ < 200) {
      const old = timeline.state.angle;
      timeline.advance(building.dt);
      building.step();
      assert.ok(Math.abs(timeline.state.angle - old) <= MAX_ANGULAR_SPEED * building.dt + 1e-9);
      close(building.angle, timeline.state.angle);
    }
    assert.equal(timeline.state.progress, position);
    assert.equal(building.listening, timeline.state.listening);
    assert.equal(building.canInput, timeline.state.canInput);
  }
  assert.ok(events > 300);
});

test("움직임 감소는 재생을 중복 시작하지 않고 세 정지 포즈의 교차 값을 제공한다", () => {
  const timeline = createClimaxTimeline();
  timeline.scrub(0.2);
  timeline.activate();
  timeline.advance(0.72);
  const before = timeline.state.angle;
  timeline.setReduced(true);
  assert.equal(timeline.state.angle, before);
  assert.equal(timeline.state.playing, "invert");
  close(timeline.state.blend, 0.5);
  timeline.advance(1.68);
  assert.equal(timeline.state.blend, 1);
  assert.equal(timeline.state.reduced, true);
  timeline.activate();
  timeline.advance(0.5);
  close(timeline.state.blend, 0.5);
  timeline.advance(0.5);
  assert.equal(timeline.state.blend, 0);
  assert.equal(timeline.state.phase, "settle");
});

test("End·복원 건너뛰기는 정착 상태를 한 번 내보내고 다시 돌아올 수 있다", () => {
  const timeline = createClimaxTimeline();
  const settled = [];
  timeline.events.addEventListener("climaxchange", ({ detail }) => { if (detail.skipped) settled.push(detail); });
  timeline.scrub(1);
  timeline.skip();
  assert.equal(settled.length, 1);
  assert.equal(settled[0].angleDegrees, 360);
  assert.equal(settled[0].phase, "settle");
  timeline.scrub(0.85);
  timeline.advance(0.4);
  assert.equal(timeline.state.skipped, false);
  close(timeline.state.angleDegrees, 270);
});

test("초점 이동으로 시작된 스크럽을 버튼이 현재 각도에서 넘겨받는다", () => {
  const timeline = createClimaxTimeline();
  timeline.scrub(0.2);
  timeline.scrub(0.252);
  timeline.advance(0.01);
  const { angle, progress } = timeline.state;
  assert.ok(angle > 0);
  assert.equal(timeline.activate("invert"), true);
  assert.equal(timeline.activate(), false);
  assert.equal(timeline.state.progress, progress);
  assert.equal(timeline.state.angle, angle);
  timeline.advance((0.75 - progress) * 4.8);
  assert.equal(timeline.state.progress, 0.75);
  assert.equal(timeline.state.holding, true);
});

test("복귀 중 버튼은 남은 각도만 재생한다", () => {
  const timeline = createClimaxTimeline();
  timeline.scrub(0.85);
  timeline.advance(2);
  assert.equal(timeline.activate("return"), true);
  close(timeline.state.angleDegrees, 270);
  timeline.advance(0.25);
  close(timeline.state.angleDegrees, 315);
  timeline.advance(0.25);
  assert.equal(timeline.state.angleDegrees, 360);
  assert.equal(timeline.state.playing, null);
});

test("되감기 중 첫 요청을 보관하고 0°에서 한 번 실행한다", () => {
  const timeline = createClimaxTimeline();
  timeline.scrub(0.95);
  timeline.advance(2);
  timeline.scrub(0.4);
  assert.equal(timeline.state.button, "invert");
  assert.equal(timeline.activate(), true);
  assert.equal(timeline.activate(), false);
  assert.equal(timeline.state.queued, true);
  assert.equal(timeline.state.playing, null);
  timeline.advance(0.5);
  close(timeline.state.angleDegrees, 247.5);
  timeline.scrub(0.3);
  assert.equal(timeline.state.queued, true);
  timeline.advance(1.1);
  close(timeline.state.angleDegrees, 0);
  assert.equal(timeline.state.queued, false);
  assert.equal(timeline.state.playing, "invert");
  timeline.advance(2.4);
  assert.equal(timeline.state.holding, true);
  timeline.scrub(0.45);
  timeline.advance(0.4);
  assert.ok(timeline.state.angleDegrees > 180);
});

test("되감기와 재생을 한 스텝에서 마치거나 장면을 떠나면 예약을 해제한다", () => {
  for (const exit of [null, 0, 1]) {
    const timeline = createClimaxTimeline();
    timeline.scrub(0.95);
    timeline.advance(2);
    timeline.scrub(0.21);
    assert.equal(timeline.activate("invert"), true);
    if (exit !== null) timeline.scrub(exit);
    timeline.advance(4);
    assert.equal(timeline.state.queued, false);
    assert.equal(timeline.state.playing, null);
    assert.equal(timeline.state.angleDegrees, exit === null ? 180 : 360 * exit);
  }
});

test("가로 무대만 120°·243° 회전 중 약 0.8배이고 정착하면 원래 크기다", () => {
  const viewportAspect = 1440 / 900;
  for (const angle of [0, Math.PI, Math.PI * 2]) close(climaxRotationScale(angle, viewportAspect), 1);
  for (const degrees of [120, 243]) {
    const angle = degrees * Math.PI / 180;
    const scale = climaxRotationScale(angle, viewportAspect);
    assert.ok(scale >= 0.8 && scale < 0.83);
    close(climaxRotationScale(-angle, viewportAspect), scale);
    close(climaxRotationScale(angle, 390 / 844), 1);
  }
  close(climaxRotationScale(Math.PI / 2, 1.3), 0.88);
  close(climaxRotationScale(Math.PI / 2, Number.NaN), 1);
});

test("데스크톱 보정이 S4 배치 표본의 물건과 7층 글 블록을 머리띠 아래에 남긴다", () => {
  // 225°/초 물리 자세와 S4 배치에서 얻은 [물건, x, y, 너비, 높이, 각도(rad)].
  const frames = [
    [1440, 900, 120, [
      ["7:ball", 1103.8, 322, 32.1, 32.1, 2.61136], ["7:chair", 1255.1, 301.8, 40.3, 73.7, -0.0103],
      ["7:cup", 1418.5, 328.5, 27.3, 20.8, 0], ["6:chair", 619.1, 545.2, 39.6, 72, 0],
      ["6:mug", 1223.3, 570.5, 26.6, 20.7, 0], ["5:plant", 1103.3, 796.1, 46.1, 55.4, 0],
    ]],
    [1440, 900, 105, [
      ["7:ball", 298.7, 323.8, 32.1, 32.1, 2.07694], ["7:chair", 1206.4, 302.8, 40.3, 73.7, 0],
      ["7:cup", 1398.2, 329.3, 27.3, 20.8, 0], ["6:chair", 653.3, 546.8, 39.6, 72, -0.00017],
      ["6:mug", 1176.2, 572.1, 26.6, 20.7, 0], ["5:plant", 1056.2, 797.7, 46.1, 55.4, 0],
    ]],
    [1280, 720, 135, [
      ["7:ball", 372.2, 265.3, 21.6, 21.6, 3.14648], ["7:chair", 1169.1, 252.8, 27.1, 49.4, -0.037874],
      ["7:cup", 1261.5, 271.2, 18.1, 13.9, 0], ["6:chair", 675.4, 434.8, 26.4, 48, -0.000175],
      ["6:mug", 1138.4, 451.8, 18, 14, 0], ["5:plant", 1031.7, 623, 30.7, 37.1, 0],
      ["6:lamp", 637, 423.9, 240, 158.4, 0.0385], ["5:lamp", 628.5, 606, 240, 158.4, 0.1451],
    ]],
    [1440, 900, 150, [
      // Hahmlet 720 굵기, 글자 폭과 CSS 줄 높이로 구한 글 상자.
      ["copy:1", 1168.8, 269.3, 437, 41, -0.75311],
    ]],
  ];

  for (const [width, height, degrees, bodies] of frames) {
    const angle = degrees * Math.PI / 180;
    const baseline = climaxRotationScale(angle, width / height);
    const { scale, offsetY } = climaxDesktopFrame(angle, { width, height, desktop: true });
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    let baselineClipped = false;
    for (const [id, x, y, bodyWidth, bodyHeight, rotation] of bodies) {
      const relativeX = (x - width / 2) * cos - (y - height / 2) * sin;
      const relativeY = (x - width / 2) * sin + (y - height / 2) * cos;
      const localCos = Math.abs(Math.cos(angle + rotation));
      const localSin = Math.abs(Math.sin(angle + rotation));
      const radiusX = (bodyWidth * localCos + bodyHeight * localSin) / 2;
      const radiusY = (bodyWidth * localSin + bodyHeight * localCos) / 2;
      const adjusted = baseline * scale;
      const centerX = width / 2 + relativeX * adjusted;
      const centerY = height / 2 + relativeY * adjusted + offsetY;
      const label = `${width}×${height} ${degrees}° ${id}`;
      assert.ok(centerX - radiusX * adjusted >= 0 && centerX + radiusX * adjusted <= width, label);
      assert.ok(centerY - radiusY * adjusted >= 64 && centerY + radiusY * adjusted <= height, label);
      if (height / 2 + (relativeY + radiusY) * baseline > height) baselineClipped = true;
    }
    assert.equal(baselineClipped, true);
  }
});

test("데스크톱 보정은 일반 첫 회전에만 적용되고 듣기·복귀 자세는 그대로다", () => {
  const options = { width: 1440, height: 900, desktop: true };
  const turn = 120 * Math.PI / 180;
  const neutral = (angle, input) => {
    const { scale, offsetY } = climaxDesktopFrame(angle, input);
    assert.equal(scale, 1);
    assert.equal(offsetY, 0);
  };
  for (const degrees of [0, 35, 180, 243, 360]) neutral(degrees * Math.PI / 180, options);
  for (const variant of [
    { desktop: false }, { reduced: true }, { sensor: true }, { width: 390, height: 844 },
    { width: 844, height: 390 }, { width: 1920, height: 1080 }, { width: 1440, height: 1440 },
    { width: 1279, height: 720 }, { width: 1280, height: 719 }, { width: 1680, height: 900 },
    { width: Infinity },
  ]) neutral(turn, { ...options, ...variant });
  neutral(turn, { width: 1440, height: 900 });
  const { scale, offsetY } = climaxDesktopFrame(turn, options);
  close(scale, 0.82);
  close(offsetY, -108);
});

test("노트북 크기에 맞춰 보정하고 3°당 전체 축척 변화는 양방향 3% 이하다", () => {
  const viewports = [[1280, 720], [1366, 768], [1536, 864], [1512, 982], [1440, 900]];
  const angle = 120 * Math.PI / 180;
  const frame = (width, height) => climaxDesktopFrame(angle, { width, height, desktop: true });
  assert.ok(frame(1280, 720).scale < frame(1536, 864).scale);
  assert.ok(frame(1536, 864).scale < frame(1440, 900).scale);

  for (const [width, height] of viewports) {
    const viewport = `${width}×${height}`;
    const { scale, offsetY } = frame(width, height);
    assert.ok(scale < 1 && offsetY < 0, viewport);

    const combinedScale = (degrees) => {
      const radians = degrees * Math.PI / 180;
      const correction = climaxDesktopFrame(radians, { width, height, desktop: true });
      return climaxRotationScale(radians, width / height) * correction.scale;
    };
    for (let degrees = 0; degrees <= 177; degrees += 0.25) {
      const ratio = combinedScale(degrees + 3) / combinedScale(degrees);
      assert.ok(Math.max(ratio, 1 / ratio) <= 1.03, `${viewport} ${degrees}°`);
    }
  }
});

test("듣기 프레임에서 6층 의자 상자가 화면 안에 들어온다", () => {
  // S4 DOM 배치와 180° 물리 자세로 얻은 의자의 화면 좌표 범위 [왼쪽, 오른쪽, 위, 아래].
  const frames = [
    [1280, 720, 64, [58.47, 500.3, 284.9, 379.5]],
    [1440, 900, 64, [56.76, 567.8, 358.4, 499.65]],
    [390, 844, 56, [-12.15, 168.95, 333.7, 480.86]],
    [844, 390, 192, [30.82, 334.05, 11.75, 104.64]], // 듣기 설명 아래 여유분 포함
  ];
  for (const [width, height, minTop, [left, right, top, bottom]] of frames) {
    const { scale, offsetY } = climaxListeningFrame(Math.PI, { width, height });
    const x = (value) => width / 2 + (value - width / 2) * scale;
    const y = (value) => height / 2 + (value - height / 2) * scale + offsetY;
    const viewport = `${width}×${height}`;
    assert.ok(x(left) >= 12 && x(right) <= width - 12, viewport);
    assert.ok(y(top) >= minTop && y(bottom) <= height, viewport);
  }
});

test("듣기 프레임은 양쪽 회전에서 매끄럽게 붙고 일반 모션에만 적용된다", () => {
  const options = { width: 844, height: 390 };
  const frame = (degrees, settings = options) => climaxListeningFrame(degrees * Math.PI / 180, settings);
  const neutral = ({ scale, offsetY }) => { close(scale, 1); close(offsetY, 0); };
  for (const degrees of [0, 120, 135, 225, 243, 360]) neutral(frame(degrees));
  for (const mode of [{ reduced: true }, { sensor: true }, { width: 0 }, { height: NaN }]) {
    neutral(frame(180, { ...options, ...mode }));
  }
  close(frame(180).scale, 0.84);
  close(frame(180).offsetY, 159.9);
  for (let distance = 0; distance <= 45; distance++) {
    close(frame(180 - distance).scale, frame(180 + distance).scale);
    close(frame(180 - distance).offsetY, frame(180 + distance).offsetY);
  }
  for (let degrees = 135; degrees <= 222; degrees += 0.25) {
    assert.ok(Math.abs(frame(degrees + 3).offsetY - frame(degrees).offsetY) <= 16);
  }
});

test("60Hz·144Hz에서 같은 시각의 물리 자세와 무대 각도를 그린다", () => {
  const options = { width: 1280, height: 720, desktop: true };
  for (const hz of [60, 144]) {
    const timeline = createClimaxTimeline();
    const building = createBuilding();
    const stop = connectClimaxPhysics(timeline, building);
    const view = createClimaxView(building.angle);
    timeline.scrub(0);
    timeline.scrub(0.55);
    const samples = [];
    let steps = 0;
    for (let number = 1; number <= Math.floor(0.8 * hz); number++) {
      const time = number / hz;
      const tick = Math.floor(time / building.dt + 1e-9);
      while (steps < tick) {
        timeline.advance(building.dt);
        building.step();
        view.record(building.angle);
        steps++;
      }
      const alpha = Math.max(0, time / building.dt - tick);
      const shown = view.sample({ ...options, alpha });
      close(shown.poseAlpha, alpha);
      close(shown.angle, MAX_ANGULAR_SPEED * Math.max(0, time - building.dt));
      const camera = climaxDesktopFrame(shown.angle, options);
      close(shown.scale, camera.scale * climaxRotationScale(shown.angle, options.width / options.height));
      close(shown.offsetY, camera.offsetY);
      if (time >= building.dt) samples.push(shown.angle);
    }
    for (let i = 1; i < samples.length; i++) close(samples[i] - samples[i - 1], MAX_ANGULAR_SPEED / hz);
    stop();
  }
});

test("일시정지는 120° 카메라와 가구 보간을 첫 새 스텝까지 유지한다", () => {
  const view = createClimaxView(119 * Math.PI / 180);
  const options = { width: 1280, height: 720, desktop: true };
  view.record(121 * Math.PI / 180);
  const before = view.sample({ ...options, alpha: 0.5 });
  close(before.angle, 120 * Math.PI / 180);
  close(before.scale, 0.61992);
  close(before.offsetY, -81.6);
  close(before.poseAlpha, 0.5);
  assert.equal(view.sample({ ...options, alpha: 1, paused: true }), before);
  assert.equal(view.sample({ ...options, alpha: 0 }), before);

  view.record(123 * Math.PI / 180);
  close(view.sample({ ...options, alpha: 0 }).angle, 121 * Math.PI / 180);
  view.record(Math.PI, { snap: true });
  const still = view.sample({ ...options, reduced: true, alpha: 0 });
  close(still.angle, Math.PI);
  close(still.scale, 1);
  close(still.poseAlpha, 1);
  close(view.sample({ ...options, sensor: true }).angle, 0);
});

test("줄이기 교차 페이드는 180° 면에만 고정 프레이밍을 적용하고 멈출 수 있다", () => {
  class Layer {
    attrs = new Set();
    style = {
      getPropertyValue(name) { return this[name] ?? ""; },
      getPropertyPriority() { return ""; },
      setProperty(name, value) { this[name] = value; },
    };
    querySelectorAll() { return []; }
    cloneNode() { return new Layer(); }
    setAttribute(name) { this.attrs.add(name); }
    removeAttribute(name) { this.attrs.delete(name); }
    after(mirror) { this.mirror = mirror; }
    remove() { this.removed = true; }
  }
  let now = 0;
  let nextFrame = 0;
  const pending = new Map();
  engine.performance = { now: () => now };
  engine.requestAnimationFrame = (callback) => { pending.set(++nextFrame, callback); return nextFrame; };
  engine.cancelAnimationFrame = (id) => { pending.delete(id); };
  function tick(ms) {
    now += ms;
    for (const [id, callback] of [...pending]) if (pending.delete(id)) callback(now);
  }

  const stage = new Layer();
  stage.style.scale = "0.9";
  stage.style.translate = "0 -11px";
  const blends = [];
  const returnCues = [];
  let returning = false;
  const flip = createPageFlip(stage, { reduced: true, onFrame(progress) {
    blends.push(progress);
    if (returning) returnCues.push(visibleClimaxCue("settle", 2 * Math.PI, { invertedOpacity: progress }));
  } });
  assert.deepEqual(blends, [0]);
  const mirror = stage.mirror;
  flip.setListeningFrame(climaxListeningFrame(Math.PI, { width: 844, height: 390 }));
  assert.ok(mirror.attrs.has("inert") && mirror.attrs.has("aria-hidden"));
  assert.equal(stage.style.scale, "");
  close(Number(mirror.style.scale), 0.84);
  close(parseFloat(mirror.style.translate.slice(2)), 159.9);
  flip.setFlipped(true);
  tick(105);
  assert.equal(stage.style.transform, "rotate(0deg)");
  assert.equal(stage.style.scale, "");
  assert.equal(mirror.style.transform, "rotate(180deg)");
  const opacity = mirror.style.opacity;
  assert.ok(opacity > 0 && opacity < 1);
  close(blends.at(-1), opacity);
  flip.setPaused(true);
  tick(500);
  close(mirror.style.opacity, opacity);
  flip.setPaused(false);
  tick(210);
  assert.equal(stage.style.transform, "rotate(180deg)");
  close(Number(stage.style.scale), 0.84);
  close(parseFloat(stage.style.translate.slice(2)), 159.9);
  close(mirror.style.opacity, 0);
  close(blends.at(-1), 1);

  returning = true;
  flip.setFlipped(false);
  tick(105);
  assert.deepEqual(returnCues, ["returning"]);
  tick(105);
  assert.deepEqual(returnCues, ["returning", "settle"]);
  flip.seek(0);
  assert.equal(stage.style.scale, "");
  assert.equal(stage.style.translate, "");
  flip.destroy();
  assert.equal(stage.style.scale, "0.9");
  assert.equal(stage.style.translate, "0 -11px");
  assert.equal(mirror.removed, true);
});

test("6/7 슬래브의 같은 점을 투영하되 판독 방향과 층 역할을 따로 유지한다", () => {
  const options = { width: 1440, height: 900, slabY: 360, anchorX: 420, labelWidth: 84, labelHeight: 22 };
  const frame = { angle: Math.PI / 2, scale: 0.8, offsetY: -30 };
  const point = projectClimaxPoint({ x: 420, y: 360 }, { ...options, ...frame });
  close(point.x, 792);
  close(point.y, 180);

  const onTurn = climaxSlabLabels({ ...options, frame });
  assert.deepEqual(onTurn.anchor, point);
  assert.equal(onTurn.floor.room, 7);
  assert.equal(onTurn.ceiling.room, 6);
  assert.equal(onTurn.textAngle, 0);
  assert.ok(onTurn.floor.x - onTurn.ceiling.x >= 84 + 16);

  const half = { ...frame, angle: Math.PI };
  const before = climaxSlabLabels({ ...options, frame: half });
  const after = climaxSlabLabels({ ...options, frame: half, inverted: true });
  assert.deepEqual(before.anchor, after.anchor);
  assert.deepEqual(before.floor, after.ceiling);
  assert.deepEqual(before.ceiling, after.floor);
  assert.ok(after.floor.y < after.anchor.y && after.ceiling.y > after.anchor.y);

  const sensor = climaxSlabLabels({ ...options, inverted: true, sensor: true });
  close(sensor.anchor.x, 420);
  close(sensor.anchor.y, 360);
  close(sensor.textAngle, Math.PI);
  assert.ok(sensor.floor.y > sensor.anchor.y && sensor.ceiling.y < sensor.anchor.y);
});

test("320px 이름표는 상하로 붙고 큰 설명을 피할 때도 서로 겹치지 않는다", () => {
  const options = { width: 320, height: 568, slabY: 247.2, anchorX: 108, labelWidth: 78, labelHeight: 24,
    insets: { top: 320, right: 12, bottom: 12, left: 12 } };
  const view = createClimaxView();
  for (let degrees = 0; degrees <= 360; degrees += 3) {
    view.record(degrees * Math.PI / 180, { snap: true });
    const frame = view.sample(options);
    const labels = climaxSlabLabels({ ...options, frame, inverted: degrees >= 180 && degrees < 360 });
    assert.equal(labels.stacked, true);
    assert.equal(labels.textAngle, 0);
    close(labels.floor.x, labels.ceiling.x);
    assert.ok(labels.floor.y - 12 >= 320);
    assert.ok(labels.ceiling.y + 12 <= 556);
    assert.ok(labels.ceiling.y - labels.floor.y >= 24 + 16);
    for (const label of [labels.floor, labels.ceiling]) assert.ok(label.x - 39 >= 12 && label.x + 39 <= 308);
  }
  assert.equal(climaxSlabLabels({ ...options, insets: { top: 540 } }), null);
});

test("S4의 다섯 무대 크기에서 같은 선과 이름표가 화면에 남는다", () => {
  // S4 배치의 7층 바닥과 6층 천장 사이 중앙선.
  const stages = [[320, 568, 248.8], [390, 844, 340.8], [844, 390, 262.8], [1280, 720, 310.4], [1440, 900, 370.4]];
  for (const [width, height, slabY] of stages) {
    const desktop = width >= 1280;
    const top = height < 560 ? 56 : width <= 720 ? 64 : 72;
    const view = createClimaxView();
    for (let degrees = 0; degrees <= 360; degrees += 3) {
      view.record(degrees * Math.PI / 180, { snap: true });
      const frame = view.sample({ width, height, desktop });
      const { anchor, floor, ceiling } = climaxSlabLabels({ width, height, slabY, frame,
        anchorX: width * (desktop ? 0.28 : 0.5), inverted: degrees >= 180 && degrees < 360, insets: { top } });
      const label = `${width}×${height} ${degrees}°`;
      assert.ok(anchor.x > 0 && anchor.x < width && anchor.y > top && anchor.y < height, label);
      for (const { x, y } of [floor, ceiling]) {
        assert.ok(x - 39 >= 8 && x + 39 <= width - 8 && y - 12 >= top && y + 12 <= height - 8, label);
      }
      assert.ok(Math.abs(floor.x - ceiling.x) >= 78 || Math.abs(floor.y - ceiling.y) >= 24, label);
    }
  }
});

test("줄이기 두 컷을 F1의 정지 면과 같은 점에 놓고 각각의 설명 여백을 쓴다", () => {
  const options = { width: 844, height: 390, slabY: 270, anchorX: 405,
    insets: { top: 56 }, invertedInsets: { top: 284 } };
  const { upright, inverted } = climaxSlabLabelFrames(options);
  const frame = { angle: Math.PI, ...climaxListeningFrame(Math.PI, options) };
  assert.deepEqual(inverted.anchor, projectClimaxPoint({ x: 405, y: 270 }, { ...options, ...frame }));
  close(upright.anchor.x, 405);
  close(upright.anchor.y, 270);
  assert.deepEqual([upright.floor.room, upright.ceiling.room], [7, 6]);
  assert.deepEqual([inverted.floor.room, inverted.ceiling.room], [6, 7]);
  assert.ok(upright.floor.y < 284);
  assert.ok(inverted.floor.y - 12 >= 284);
});

test("390px 질문은 준비와 회전 중 고정 레이어에 있고 듣기 전에 별도 타이머를 쓰지 않는다", () => {
  const timeline = createClimaxTimeline();
  for (const [progress, expected] of [[0.05, false], [0.2, true], [0.45, true], [0.65, false], [0.85, false], [1, false]]) {
    timeline.scrub(progress);
    timeline.advance(2);
    assert.equal(showClimaxQuestion(timeline.state.phase, 390), expected, String(progress));
  }
  assert.equal(showClimaxQuestion("invert", 320), true);
  assert.equal(showClimaxQuestion("invert", 480), true);
  assert.equal(showClimaxQuestion("invert", 481), false);
  assert.equal(showClimaxQuestion("invert", 844), false);
  assert.equal(showClimaxQuestion("ready", 0), false);
});

test("파동 진폭·호 두께·시간이 화면 폭에 비례하며 정지 포즈도 현재 폭에 맞는다", () => {
  const animations = [];
  class Element {
    children = [];
    style = { setProperty(name, value) { this[name] = value; } };
    setAttribute() {}
    append(child) { this.children.push(child); }
    animate(frames, timing) {
      animations.push({ frames, timing });
      return { cancel() {} };
    }
  }
  const root = { clientWidth: 390 };
  engine.document = { documentElement: root, createElement: () => new Element() };
  const layer = new Element();
  const wave = createSlabWave(layer, { fullImpulse: 100 });
  assert.equal(wave.pulse({ impulse: 0 }), null);
  const weak = wave.pulse({ impulse: 20 });
  const mobile = wave.pulse({ impulse: 100 });
  assert.ok(weak.amplitude < mobile.amplitude && weak.brightness < mobile.brightness);
  root.clientWidth = 1440;
  const desktop = wave.pulse({ impulse: 100, direction: -1 });
  for (const key of ["amplitude", "thickness", "duration"]) close(desktop[key] / mobile[key], 1440 / 390);
  close(animations[6].timing.duration, desktop.duration);
  close(animations[7].timing.delay / animations[4].timing.delay, 1440 / 390);
  assert.match(animations[6].frames[2].transform, /scaleY\(-1\) translateY\(168px\)/);
  close(parseFloat(layer.children[2].style["--lt-slab-wave-thickness"]), desktop.thickness);
  root.clientWidth = 320;
  wave.setReduced(true);
  assert.equal(animations.length, 9);
  close(parseFloat(layer.children[3].style["--lt-slab-wave-thickness"]), desktop.thickness * 320 / 1440);
});

test("S4 센서 중 무대를 고정하고 0.7 초과 시 스크롤 경로에 인계한다", () => {
  const timeline = createClimaxTimeline();
  timeline.scrub(0.2);
  assert.equal(timeline.startSensor(), true);
  assert.equal(timeline.startSensor(), false);
  assert.equal(timeline.setSensorGravity(null), false);
  assert.equal(timeline.setSensorGravity({ x: 920, y: 0 }), true);
  timeline.advance(0.5);
  assert.equal(timeline.state.sensorPhase, "tilting");
  assert.equal(timeline.state.stageAngle, 0);
  assert.equal(timeline.state.canInput, false);
  timeline.scrub(0.7);
  assert.equal(timeline.state.mode, "sensor");
  timeline.scrub(0.701);
  assert.equal(timeline.state.mode, "timeline");
  assert.equal(timeline.state.sensorGravity, null);
  assert.equal(timeline.state.sensorCue, "S4-18");
  assert.equal(timeline.setSensorGravity({ x: 0, y: -920 }), false);
  timeline.advance(0.2);
  close(timeline.state.stageAngleDegrees, 45);
  timeline.advance(1);
  assert.equal(timeline.state.listening, true);
  assert.equal(timeline.state.progress, 0.701);
  assert.equal(timeline.state.stageAngleDegrees, 180);
  assert.equal(timeline.state.sensorCue, null);
});

test("센서 경로의 정착 각도·듣기 상태가 버튼 및 스크롤 경로와 같다", () => {
  const sensor = createClimaxTimeline();
  const button = createClimaxTimeline();
  const scroll = createClimaxTimeline();
  sensor.scrub(0.2);
  button.scrub(0.2);
  scroll.scrub(0.2);
  sensor.startSensor();
  assert.equal(sensor.setSensorPhase("returned"), false);
  sensor.setSensorGravity({ x: 0, y: -920 });
  assert.equal(sensor.state.listening, false);
  assert.equal(sensor.setSensorPhase("inverted"), true);
  assert.equal(sensor.setSensorPhase("inverted"), false);
  assert.equal(sensor.state.sensorPhase, "inverted");
  assert.equal(sensor.state.stageAngleDegrees, 0);

  button.activate();
  button.advance(2.4);
  scroll.scrub(0.65);
  scroll.advance(1);
  for (const path of [sensor, button, scroll]) {
    assert.equal(path.state.listening, true);
    assert.equal(path.state.angleDegrees, 180);
    assert.equal(path.state.canInput, false);
  }

  sensor.setSensorGravity({ x: 0, y: 920 });
  assert.equal(sensor.setSensorPhase("returned"), true);
  assert.equal(sensor.state.sensorPhase, "returned");
  assert.equal(sensor.state.stageAngleDegrees, 0);
  sensor.scrub(0.701);
  assert.equal(sensor.state.mode, "timeline");
  assert.equal(sensor.state.sensorCue, "S4-18");
  assert.equal(sensor.state.angleDegrees, 360);
  sensor.scrub(1);
  button.activate();
  button.advance(1);
  scroll.scrub(1);
  scroll.advance(1);
  for (const path of [sensor, button, scroll]) {
    assert.equal(path.state.phase, "settle");
    assert.equal(path.state.angleDegrees, 360);
    assert.equal(path.state.listening, false);
    assert.equal(path.state.canInput, true);
  }
});

test("센서 반전에서 인계할 때 듣기 결과를 유지하고 버튼·감소·건너뛰기로도 정리한다", () => {
  const timeline = createClimaxTimeline();
  timeline.scrub(0.1);
  assert.equal(timeline.startSensor(), false);
  timeline.scrub(0.2);
  timeline.startSensor();
  timeline.setSensorGravity({ x: 0, y: -920 });
  timeline.setSensorPhase("inverted");
  timeline.scrub(0.72);
  assert.equal(timeline.state.mode, "timeline");
  assert.equal(timeline.state.listening, true);
  assert.equal(timeline.state.sensorCue, "S4-18");
  assert.equal(timeline.state.stageAngleDegrees, 180);

  const fallback = createClimaxTimeline();
  fallback.scrub(0.2);
  fallback.startSensor();
  assert.equal(fallback.activate("invert"), true);
  assert.equal(fallback.state.mode, "timeline");
  fallback.advance(2.4);
  assert.equal(fallback.state.holding, true);

  for (const exit of [(scene) => scene.setReduced(true), (scene) => scene.skip(), (scene) => scene.scrub(0)]) {
    const scene = createClimaxTimeline();
    scene.scrub(0.2);
    scene.startSensor();
    scene.setSensorGravity({ x: 34, y: -920 });
    exit(scene);
    assert.equal(scene.state.sensorGravity, null);
    assert.equal(scene.state.mode, "timeline");
  }
});

test("S4-17 화면 회전 취소는 무대를 멈추고 1.2초 뒤 버튼을 안내한다", () => {
  const timeline = createClimaxTimeline();
  timeline.scrub(0.2);
  timeline.startSensor();
  timeline.scrub(0.6);
  timeline.setSensorGravity({ x: 0, y: -920 });
  assert.equal(timeline.stopSensor("screen-rotated"), true);
  assert.equal(timeline.state.mode, "timeline");
  assert.equal(timeline.state.phase, "ready");
  assert.equal(timeline.state.sensorGravity, null);
  assert.equal(timeline.state.stageAngleDegrees, 0);
  assert.equal(timeline.setSensorPhase("inverted"), false);
  timeline.advance(1.19);
  assert.equal(timeline.state.sensorCue, null);
  timeline.advance(0.01);
  assert.equal(timeline.state.sensorCue, "S4-17");
  assert.equal(timeline.state.stageAngleDegrees, 0);
  assert.equal(timeline.activate("invert"), true);
  assert.equal(timeline.state.sensorCue, null);
  timeline.advance(0.016);
  timeline.scrub(0.12);
  timeline.advance(2.384);
  assert.equal(timeline.state.angleDegrees, 180);

  const requesting = createClimaxTimeline();
  requesting.scrub(0.2);
  assert.equal(requesting.stopSensor("screen-rotated"), true);
  assert.equal(requesting.stopSensor("screen-rotated"), false);
  requesting.advance(1.2);
  assert.equal(requesting.state.sensorCue, "S4-17");
});

test("복귀가 끝나면 공중에 잠든 물체를 세 층에서 깨우고 바닥 자세를 한 번만 확정한다", () => {
  const timeline = createClimaxTimeline();
  const building = createBuilding();
  const returnPose = createClimaxReturnPose(building);
  connectClimaxPhysics(timeline, building);
  timeline.scrub(0.2);
  timeline.scrub(0.95);
  timeline.advance(2);
  assert.equal(returnPose.update(timeline.state), false);
  for (let i = 0; i < 200; i += 1) building.step();
  const room = building.rooms.get(7);
  const cup = room.props.cup;
  building.world.move(cup, cup.x, (room.top + room.bottom) / 2);
  building.world.sleepBody(cup);
  building.returnPoseReady = false;
  const awakened = [];
  const wake = building.wakeRoom.bind(building);
  building.wakeRoom = (id) => { awakened.push(id); wake(id); };
  assert.equal(returnPose.update(timeline.state), true);
  assert.deepEqual(awakened, [7, 6, 5]);
  close(cup.bottom, room.bottom, 0.01);
  for (const floor of [6, 5]) {
    const lower = building.rooms.get(floor);
    for (const [name, body] of Object.entries(lower.props)) if (name !== "copy") close(body.bottom, lower.bottom, 0.01);
  }
  const position = cup.x - 2;
  building.world.move(cup, position, cup.y);
  assert.equal(returnPose.update(timeline.state), true);
  assert.equal(cup.x, position);
});

test("S4-19는 의자 카피를 표시한 2초 뒤에 한 번 나타난다", () => {
  const timeline = createClimaxTimeline();
  timeline.scrub(0.2);
  timeline.startSensor();
  assert.equal(timeline.showSensorListeningCopy(), false);
  timeline.setSensorGravity({ x: 0, y: -920 });
  timeline.setSensorPhase("inverted");
  timeline.advance(3);
  assert.equal(timeline.state.sensorCue, null);
  assert.equal(timeline.showSensorListeningCopy(), true);
  assert.equal(timeline.showSensorListeningCopy(), false);
  timeline.advance(1.99);
  assert.equal(timeline.state.sensorCue, null);
  timeline.advance(0.01);
  assert.equal(timeline.state.sensorCue, "S4-19");
  timeline.setSensorPhase("returned");
  assert.equal(timeline.state.sensorCue, null);
});

test("실제 물리 모델에서 센서 동안 무대 각도와 중력을 분리하고 인계 후 같은 각도로 수렴한다", () => {
  for (const returned of [false, true]) {
    const timeline = createClimaxTimeline();
    const building = createBuilding();
    const disconnect = connectClimaxPhysics(timeline, building);
    timeline.scrub(0.2);
    timeline.startSensor();
    timeline.setSensorGravity({ x: 610, y: 0 });
    building.step();
    assert.equal(building.angle, 0);
    assert.equal(building.world.gx, 610);
    assert.equal(building.world.gy, 0);
    assert.equal(building.canInput, false);
    timeline.setSensorGravity({ x: 0, y: -920 });
    timeline.setSensorPhase("inverted");
    building.step();
    assert.equal(building.listening, true);
    assert.equal(building.angle, 0);
    assert.equal(building.world.gy, -920);
    if (returned) {
      timeline.setSensorGravity({ x: 0, y: 920 });
      timeline.setSensorPhase("returned");
    }
    timeline.scrub(0.71);
    assert.equal(building.angle, timeline.state.angle);
    assert.equal(building.world.gy, returned ? 920 : -920);
    timeline.scrub(1);
    for (let i = 0; i < 120; i += 1) {
      timeline.advance(building.dt);
      building.step();
      close(building.angle, timeline.state.angle);
    }
    assert.equal(building.world.gy, 920);
    assert.equal(building.canInput, true);
    disconnect();
  }
});

function measureTrial(trial) {
  const building = createBuilding();
  assert.equal(building.input({ type: "mat", enabled: trial.surface === "mat" }), true);
  assert.equal(building.input(trial.command), true);
  let peak;
  let lampAngle = 0;
  building.onReceive((impact) => {
    if (impact.action === trial.command.type && impact.receiverRoom === 6 && (!peak || impact.force > peak.force)) peak = impact;
  });
  const { lamp, cable } = building.rooms.get(6);
  for (let frame = 0; frame < 240; frame += 1) {
    building.step();
    const angle = Math.atan2(lamp.x - cable.anchorB.x, lamp.y - cable.anchorB.y);
    if (Math.abs(angle) > Math.abs(lampAngle)) lampAngle = angle;
  }
  return { index: peak.index, lampAngle, force: peak.force };
}

test("S5 0.6초 도착, 같은 공의 쿵 두 번, 실제 진자 대비, 결말 순서", () => {
  const timeline = createCushionTimeline({ drop: { type: "matDrop", x: 240 } });
  assert.equal(timeline.beginDrop("bare"), null);
  timeline.setActive(true);
  assert.equal(timeline.state.floor, 5);
  timeline.advance(0.2);
  assert.equal(timeline.state.floor, 6);
  timeline.advance(0.2);
  assert.equal(timeline.state.floor, 7);
  assert.equal(timeline.state.phase, "arrival");
  assert.equal(timeline.state.action, null);
  timeline.advance(0.2);
  assert.equal(timeline.state.action, "mat-before");
  const bare = timeline.beginDrop("bare");
  assert.equal(timeline.state.matTest, "dropping-before");
  assert.equal(timeline.layMat(), false);
  assert.equal(timeline.beginDrop("bare"), null);
  const first = measureTrial(bare);
  assert.deepEqual(measureTrial(bare), first);
  assert.equal(timeline.record(bare.id, first), true);
  assert.equal(timeline.state.action, "mat-lay");
  assert.equal(timeline.layMat(), true);
  const mat = timeline.beginDrop("mat");
  assert.equal(mat.command, bare.command);
  const second = measureTrial(mat);
  assert.equal(timeline.record(mat.id, second), true);
  assert.equal(timeline.state.phase, "compare");
  const comparison = timeline.state.comparison;
  assert.equal(comparison.before, first.index);
  assert.equal(comparison.after, second.index);
  close(comparison.reduction, 1 - second.index / first.index);
  assert.ok(second.index < first.index);
  assert.ok(Math.abs(second.lampAngle) < Math.abs(first.lampAngle));
  assert.equal(timeline.state.lampCue, null);
  assert.equal(timeline.state.resultCue, "S5-04");
  assert.equal(timeline.state.provenanceCue, "S5-07");
  timeline.advance(0.45);
  assert.equal(timeline.state.phase, "pendulums");
  assert.equal(timeline.state.lampCue, "S5-05");
  timeline.advance(0.55);
  assert.equal(timeline.state.phase, "conclusion");
  assert.equal(timeline.state.conclusionCue, "S5-06");
  assert.equal(timeline.state.moving, false);
});

test("S5 v3 카피 순서와 진폭 15% 초과 조건, 원래 비교값을 유지하는 추가 매트 낙하", () => {
  for (const angle of [0.35, 0.34, 0.33]) {
    const timeline = createCushionTimeline({ heightSource: "peak", drop: { type: "matDrop", x: 240 } });
    timeline.setActive(true);
    assert.equal(timeline.state.arrivalCue, null);
    timeline.advance(0.6);
    assert.equal(timeline.state.arrivalCue, "S5-01");
    assert.equal(timeline.state.heightCue, "S5-08");
    const before = timeline.beginDrop("bare");
    timeline.record(before.id, { index: 100, lampAngle: -0.4 });
    assert.equal(timeline.state.matCue, null);
    timeline.layMat();
    assert.equal(timeline.state.heightCue, null);
    assert.equal(timeline.state.matCue, "S5-02");
    const after = timeline.beginDrop("mat");
    timeline.record(after.id, { index: 43, lampAngle: angle });
    assert.equal(timeline.state.matCue, null);
    const contrast = angle < 0.34;
    assert.equal(timeline.state.comparison.lampContrast, contrast);
    assert.equal(timeline.state.phase, contrast ? "compare" : "conclusion");
    timeline.advance(1);
    assert.equal(timeline.state.lampCue, contrast ? "S5-05" : null);
    assert.equal(timeline.state.conclusionCue, "S5-06");
    assert.equal(timeline.state.matDrops, 1);
    const fixed = timeline.state.comparison;
    const repeat = timeline.beginDrop("mat");
    timeline.record(repeat.id, { index: 44, lampAngle: angle });
    assert.equal(timeline.state.matDrops, 2);
    assert.equal(timeline.state.comparison, fixed);
  }
});

test("S5 감소 모드는 측정한 정지 프레임 두 장을 보여 주며 실패한 시험의 늦은 결과를 거른다", () => {
  const timeline = createCushionTimeline({ reduced: true });
  timeline.setActive(true);
  assert.equal(timeline.state.floor, 7);
  assert.equal(timeline.state.moving, false);
  const cancelled = timeline.beginDrop("bare");
  assert.equal(timeline.cancelDrop(cancelled.id), true);
  const before = timeline.beginDrop("bare");
  assert.equal(timeline.record(cancelled.id, { index: 100, lampAngle: 0.2 }), false);
  assert.equal(timeline.record(before.id, { index: 100, lampAngle: NaN }), false);
  assert.equal(timeline.record(before.id, { index: 0, lampAngle: 0 }), true);
  timeline.layMat();
  const after = timeline.beginDrop("mat");
  timeline.setActive(false);
  assert.equal(timeline.record(after.id, { index: 0, lampAngle: -0.02 }), true);
  timeline.setActive(true);
  assert.equal(timeline.state.phase, "conclusion");
  assert.equal(timeline.state.comparison.reduction, null);
  assert.equal(timeline.state.comparison.frames.length, 2);
  assert.equal(timeline.state.comparison.frames[0].surface, "bare");
  assert.equal(timeline.state.comparison.frames[1].lampAngle, -0.02);
  assert.equal(timeline.state.moving, false);
});

test("S1은 7층을 유지하고 80svh 연장과 S5 130svh 고정 구간을 제공한다", () => {
  const css = readFileSync(new URL("./building.css", import.meta.url), "utf8");
  assert.match(css, /\.lt-building-intro-extension\s*\{\s*min-block-size: 80svh/);
  assert.match(css, /\.lt-building-cushion\s*\{\s*min-block-size: 130svh/);
  assert.equal(sampleIntroExtension(0).active, false);
  const start = sampleIntroExtension(0.05);
  assert.equal(start.active, true);
  assert.equal(start.floor, 7);
  assert.ok(start.reveal > 0 && start.reveal < 1);
  assert.equal(sampleIntroExtension(0.05, { reduced: true }).reveal, 1);
  assert.equal(sampleIntroExtension(1).reveal, 1);
});
