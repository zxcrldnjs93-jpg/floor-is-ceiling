import assert from "node:assert/strict";
import test from "node:test";
import { createClimaxSensor } from "../site/modules/sensor.js";
import { bindSoundToggle } from "../site/modules/sound.js";

function sensorFixture() {
  const source = new EventTarget();
  const screen = new EventTarget();
  screen.angle = 0;
  Object.assign(source, {
    self: source, top: source, isSecureContext: true, document: new EventTarget(),
    screen: { orientation: screen }, navigator: { userAgent: "iPhone", maxTouchPoints: 5 }, innerWidth: 390, innerHeight: 844,
    DeviceOrientationEvent: {}, matchMedia: () => ({ matches: true }),
  });
  const timers = new Map();
  let clock = 0, id = 0;
  source.setTimeout = (callback, delay) => {
    timers.set(++id, { callback, at: clock + delay });
    return id;
  };
  source.clearTimeout = (timer) => timers.delete(timer);
  function tick(milliseconds) {
    const end = clock + milliseconds;
    while (timers.size) {
      const [timer, { callback, at }] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (at > end) break;
      timers.delete(timer);
      clock = at;
      callback();
    }
    clock = end;
  }
  function orientation(beta, gamma) {
    source.dispatchEvent(Object.assign(new Event("deviceorientation"), { beta, gamma }));
  }
  function rotate(angle) {
    screen.angle = angle;
    screen.dispatchEvent(new Event("change"));
  }
  const states = [], gravity = [];
  const sensor = createClimaxSensor(source, { onState: (state) => states.push(state), onGravity: (vector) => gravity.push(vector) });
  sensor.sync({ active: true, progress: 0.2 });
  return { source, sensor, tick, orientation, rotate, states, gravity, timers };
}

test("센서는 S4 준비 구간의 지원 모바일에서만 제안한다", () => {
  const { sensor } = sensorFixture();
  assert(sensor.offer());
  sensor.sync({ active: true, progress: 0.3 });
  assert(!sensor.offer());
  sensor.sync({ active: true, progress: 0.2, reduced: true });
  assert(!sensor.offer());

  const excluded = [
    { DeviceOrientationEvent: undefined }, { isSecureContext: false }, { top: new EventTarget() },
    { matchMedia: () => ({ matches: false }) }, { navigator: { maxTouchPoints: 0 } },
    ...["KAKAOTALK", "NAVER(inapp; search)", "Instagram", "Android; wv)"].map((userAgent) => ({ navigator: { userAgent, maxTouchPoints: 5 } })),
  ];
  for (const settings of excluded) {
    const fixture = sensorFixture();
    Object.assign(fixture.source, settings);
    assert(!fixture.sensor.offer());
  }
});

test("권한을 사용자 호출 안에서 요청하고 거부와 예외는 버튼 경로로 넘긴다", async () => {
  for (const permission of [() => Promise.resolve("denied"), () => { throw new Error("denied"); }]) {
    const { source, sensor, states, timers } = sensorFixture();
    let calls = 0;
    source.DeviceOrientationEvent.requestPermission = () => { calls += 1; return permission(); };
    const request = sensor.start();
    assert.equal(calls, 1);
    assert.equal(await request, false);
    assert.deepEqual(states.at(-1), { mode: "fallback", reason: "denied" });
    assert.equal(timers.size, 0);
  }
  const { source, sensor } = sensorFixture();
  let motionRequests = 0;
  source.DeviceMotionEvent = { requestPermission: () => { motionRequests++; return Promise.resolve("granted"); } };
  const request = sensor.start();
  assert.equal(motionRequests, 1);
  assert(await request);
  sensor.stop();
});

test("0과 null만 들어오면 1초에 구독을 끝낸다", async () => {
  const { sensor, tick, orientation, states, gravity } = sensorFixture();
  assert(await sensor.start());
  orientation(0, 0);
  orientation(null, null);
  tick(999);
  assert.equal(states.at(-1).mode, "requesting");
  tick(1);
  assert.equal(states.at(-1).reason, "no-sample");
  orientation(90, 0);
  assert.equal(gravity.length, 0);
});

test("기울기는 화면 좌표를 따르고 300ms 뒤집힘 이후 값은 듣기 동안 고정된다", async () => {
  const { sensor, tick, orientation, states, gravity, timers } = sensorFixture();
  assert(await sensor.start());
  orientation(0, 90);
  assert.deepEqual(gravity.at(-1), { x: 920, y: 0 });
  orientation(-30, 0);
  tick(400);
  assert.equal(states.at(-1).mode, "tilting");
  orientation(-90, 0);
  tick(299);
  assert.equal(states.at(-1).mode, "tilting");
  orientation(90, 0);
  tick(1);
  assert.equal(states.at(-1).mode, "tilting");
  orientation(-90, 0);
  tick(300);
  assert.deepEqual(states.at(-1), { mode: "inverted", reason: null });
  assert.deepEqual(gravity.at(-1), { x: 0, y: -920 });
  const count = gravity.length;
  orientation(0, 90);
  assert.equal(gravity.length, count);
  orientation(45, 0);
  tick(400);
  assert.equal(states.at(-1).mode, "returned");
  assert.deepEqual(gravity.at(-1), { x: 0, y: 920 });
  assert.equal(timers.size, 0);
});

test("화면 회전과 가로 리사이즈는 진행 중인 판정을 취소하고 버튼 경로로 넘긴다", async () => {
  for (const rotate of [
    (fixture) => fixture.rotate(180),
    (fixture) => {
      fixture.source.innerWidth = 844;
      fixture.source.innerHeight = 390;
      fixture.source.dispatchEvent(new Event("resize"));
    },
  ]) {
    const fixture = sensorFixture();
    assert(await fixture.sensor.start());
    fixture.orientation(-90, 0);
    fixture.tick(299);
    rotate(fixture);
    fixture.tick(400);
    assert.deepEqual(fixture.states.at(-1), { mode: "fallback", reason: "screen-rotated" });
    assert.equal(fixture.timers.size, 0);
  }
});

test("8초 안내, 0.7 초과 스크롤 이관, 탭 숨김 중 권한 응답 취소", async () => {
  const fixture = sensorFixture();
  assert(await fixture.sensor.start());
  fixture.orientation(90, 0);
  fixture.tick(8_000);
  assert.equal(fixture.states.at(-1).reason, "try-button");
  fixture.sensor.sync({ active: true, progress: 0.7 });
  assert.equal(fixture.states.at(-1).mode, "tilting");
  fixture.sensor.sync({ active: true, progress: 0.71 });
  assert.equal(fixture.states.at(-1).reason, "scroll");
  assert.equal(fixture.timers.size, 0);

  const pending = sensorFixture();
  let grant;
  pending.source.DeviceOrientationEvent.requestPermission = () => new Promise((resolve) => { grant = resolve; });
  const request = pending.sensor.start();
  pending.source.document.hidden = true;
  pending.source.document.dispatchEvent(new Event("visibilitychange"));
  grant("granted");
  assert.equal(await request, false);
  assert.equal(pending.states.at(-1).reason, "hidden");
  pending.orientation(90, 0);
  assert.equal(pending.gravity.length, 0);
});

test("소리 토글은 생성 전 기본 음소거 상태이고 사용자 동작에서만 엔진을 열고 닫는다", async () => {
  const button = new EventTarget(), label = {}, attributes = new Map([["aria-pressed", "true"]]);
  const controller = new AbortController();
  button.dataset = {};
  button.querySelector = () => label;
  button.setAttribute = (name, value) => attributes.set(name, value);
  button.removeAttribute = (name) => attributes.delete(name);
  let factories = 0;
  const audio = {
    muted: true,
    async enable() { this.muted = false; return true; },
    mute() { this.muted = true; },
  };
  const bound = bindSoundToggle(button, () => { factories += 1; return audio; }, { signal: controller.signal });
  assert.equal(factories, 0);
  assert.equal(button.dataset.pressed, "false");
  assert.equal(attributes.has("aria-pressed"), false);
  assert.equal(label.textContent, "소리 켜기");
  button.dispatchEvent(new Event("click"));
  assert.equal(factories, 1);
  assert.equal(bound.audio, audio);
  assert.equal(attributes.get("aria-busy"), "true");
  await Promise.resolve();
  assert.equal(button.dataset.pressed, "true");
  assert.equal(attributes.has("aria-pressed"), false);
  assert.equal(attributes.get("aria-busy"), "false");
  assert.equal(label.textContent, "소리 끄기");
  button.dispatchEvent(new Event("click"));
  assert.equal(button.dataset.pressed, "false");
  assert.equal(attributes.has("aria-pressed"), false);
  assert.equal(label.textContent, "소리 켜기");
  controller.abort();
  assert(audio.muted);
});
