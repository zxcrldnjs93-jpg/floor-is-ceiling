import assert from "node:assert/strict";
import test from "node:test";
import { createAudioEffects, impulseToGain } from "./audio.js";
import { CARD_WIDTH, CARD_HEIGHT, downloadCardPng, exportCardPng, formatShareText, renderCard, shareCard } from "./card.js";
import { stopImpactVibration, supportsImpactVibration, vibrate, vibrateImpact } from "./haptics.js";
import { classifyBehavior, summarizeBehavior } from "./type.js";

function audioParam() {
  const events = [];
  return {
    events,
    setValueAtTime: (...args) => events.push(["set", ...args]),
    linearRampToValueAtTime: (...args) => events.push(["linear", ...args]),
    exponentialRampToValueAtTime: (...args) => events.push(["exponential", ...args]),
  };
}

function audioContext() {
  const sources = [];
  const gains = [];
  const filters = [];
  function source(kind) {
    const voice = {
      kind,
      frequency: audioParam(),
      stops: [],
      connect() {},
      disconnect() { this.disconnected = true; },
      start(time) { this.started = time; },
      stop(time) { this.stops.push(time); },
    };
    sources.push(voice);
    return voice;
  }
  return {
    sources,
    gains,
    filters,
    state: "suspended",
    currentTime: 0,
    sampleRate: 8000,
    destination: {},
    async resume() { this.state = "running"; },
    createGain() {
      const node = { gain: audioParam(), connect() {}, disconnect() { this.disconnected = true; } };
      gains.push(node);
      return node;
    },
    createOscillator() { return source("oscillator"); },
    createBufferSource() { return source("noise"); },
    createBuffer(channels, length, rate) {
      const data = new Float32Array(length);
      return { channels, rate, getChannelData: () => data };
    },
    createBiquadFilter() {
      const filter = { frequency: {}, Q: {}, connect() {}, disconnect() { this.disconnected = true; } };
      filters.push(filter);
      return filter;
    },
  };
}

test("audio maps positive impulses monotonically to bounded gain", () => {
  for (const impulse of [0, -10, Infinity, NaN, "10", undefined]) assert.equal(impulseToGain(impulse), 0);
  assert.ok(impulseToGain(10) < impulseToGain(100));
  assert.equal(impulseToGain(100, 400), 0.5);
  assert.equal(impulseToGain(1600), 1);
  assert.equal(impulseToGain(100, 0), 0.5);
});

test("audio stays muted until enabled and synthesizes low thump, short tap, and filtered chair", async () => {
  const context = audioContext();
  let created = 0;
  const audio = createAudioEffects({ createContext: () => { created++; return context; } });
  assert.equal(audio.muted, true);
  assert.equal(audio.play("thump", 400), false);
  assert.equal(created, 0);
  assert.equal(await audio.enable(), true);
  assert.equal(audio.muted, false);
  assert.equal(created, 1);
  assert.equal(audio.play("valueOf", 400), false);
  assert.equal(audio.play("thump", 0), false);
  assert.equal(audio.play("thump", 100), true);
  assert.equal(audio.play("thump", 400), false);
  assert.equal(audio.play("tap", 400), true);
  assert.equal(audio.play("chair", 400), true);
  const [thump, tap, chair] = context.sources;
  assert.equal(thump.type, "sine");
  assert.ok(thump.frequency.events[0][1] < 100);
  assert.ok(thump.frequency.events[1][1] < thump.frequency.events[0][1]);
  assert.equal(tap.type, "triangle");
  assert.ok(tap.stops[0] < thump.stops[0]);
  assert.equal(chair.kind, "noise");
  assert.equal(context.filters[0].type, "bandpass");
  assert.ok(chair.buffer.getChannelData(0).some(sample => sample !== 0));
  assert.ok(context.gains[3].gain.events.length > context.gains[2].gain.events.length);

  context.currentTime = 0.1;
  assert.equal(audio.play("thump", 400), true);
  assert.equal(context.gains[4].gain.events[1][1], context.gains[1].gain.events[1][1] * 2);
  audio.mute();
  assert.equal(audio.muted, true);
  assert.deepEqual(context.gains[0].gain.events.at(-1), ["set", 0, 0.1]);
  assert.equal(context.sources[0].stops.at(-1), 0.1);
  assert.equal(audio.play("tap", 400), false);
  chair.onended();
  assert.equal(chair.disconnected, true);
  assert.equal(context.filters[0].disconnected, true);
  assert.equal(await audio.enable(), true);
  assert.equal(created, 1);
});

test("missing, blocked, and still-pending audio activation remain muted", async () => {
  assert.equal(await createAudioEffects({ createContext: () => null }).enable(), false);
  const context = audioContext();
  context.resume = async () => { throw new Error("blocked"); };
  const audio = createAudioEffects({ createContext: () => context });
  assert.equal(await audio.enable(), false);
  assert.equal(audio.muted, true);
  let finishResume;
  context.resume = () => new Promise(resolve => { finishResume = resolve; });
  const enabling = audio.enable();
  audio.mute();
  context.state = "running";
  finishResume();
  assert.equal(await enabling, false);
  assert.equal(audio.muted, true);
});

test("sound toggle creates Web Audio only on activation and a second click cancels pending sound", async t => {
  const userActivation = { isActive: false };
  stubGlobal(t, "navigator", { userActivation });
  const context = audioContext();
  let created = 0;
  let finishResume;
  context.resume = () => new Promise(resolve => { finishResume = resolve; });
  const audio = createAudioEffects({ createContext: () => { created++; return context; } });
  assert.equal(audio.playImpact({ index: 200 }, { downstairs: true }), false);
  assert.equal(await audio.toggle(), false);
  assert.equal(created, 0);
  userActivation.isActive = true;
  const enabling = audio.toggle();
  assert.equal(created, 1);
  assert.equal(await audio.toggle(), false);
  context.state = "running";
  finishResume();
  assert.equal(await enabling, false);
  assert.equal(audio.muted, true);
  assert.equal(await audio.toggle(), true);
  assert.equal(created, 1);
});

test("impact index increases duration and gain, downstairs sounds duller and mat sounds shorter", async () => {
  const context = audioContext();
  const audio = createAudioEffects({ createContext: () => context });
  assert.equal(await audio.enable(), true);
  function measure(event, options) {
    context.currentTime += 1;
    assert.equal(audio.playImpact(event, options), true);
    const source = context.sources.at(-1);
    return {
      duration: source.stops[0] - source.started,
      frequency: source.frequency.events[0][1],
      gain: context.gains.at(-1).gain.events[1][1],
    };
  }
  const light = measure({ index: 43 });
  const upstairs = measure({ index: 100 });
  const downstairs = measure({ index: 100 }, { downstairs: true });
  const mat = measure({ index: 100, mat: true }, { downstairs: true });
  assert.ok(upstairs.gain > light.gain && upstairs.duration > light.duration);
  assert.ok(downstairs.gain > upstairs.gain && downstairs.frequency < upstairs.frequency);
  assert.ok(mat.gain < downstairs.gain && mat.duration < downstairs.duration);
  assert.equal(audio.playImpact({ index: NaN }), false);
  assert.equal(audio.playImpact({ index: 0 }), false);
});

test("vibration preserves method receiver and tolerates missing or throwing support", () => {
  const device = {
    vibrate(pattern) { this.pattern = pattern; return true; },
  };
  assert.equal(vibrate([15, 25, 20], device), true);
  assert.deepEqual(device.pattern, [15, 25, 20]);
  assert.equal(vibrate(0, device), true);
  assert.equal(device.pattern, 0);
  assert.equal(vibrate(20, null), false);
  assert.equal(vibrate(20, {}), false);
  assert.equal(vibrate(20, { vibrate: () => false }), false);
  assert.equal(vibrate(20, { vibrate() { throw new Error("unavailable"); } }), false);
});

test("D2 vibration defaults on for Android and fires only in the three listening rooms", () => {
  const calls = [];
  const android = { userAgentData: { platform: "Android" }, vibrate: pattern => { calls.push(pattern); return true; } };
  const ios = { userAgent: "Mozilla iPhone", vibrate: android.vibrate };
  assert.equal(supportsImpactVibration(android), true);
  assert.equal(supportsImpactVibration(ios), false);
  assert.equal(supportsImpactVibration({ userAgent: "Android" }), false);
  const listen = { scene: "listen", receiverRoom: 6 };
  const relay = { scene: "relay", receiverRoom: 5 };
  const flipped = { scene: "flip", receiverRoom: 7, listening: true };
  for (const scene of ["intro", "s1", "s5", undefined]) {
    assert.equal(vibrateImpact(100, { ...listen, scene }, android), false);
  }
  assert.equal(vibrateImpact(100, { ...listen, receiverRoom: 7 }, android), false);
  assert.equal(vibrateImpact(100, { ...relay, receiverRoom: 6 }, android), false);
  assert.equal(vibrateImpact(100, { ...flipped, receiverRoom: 5 }, android), false);
  assert.equal(vibrateImpact(100, { ...flipped, listening: false }, android), false);
  assert.equal(vibrateImpact(100, { ...listen, enabled: false }, android), false);
  assert.equal(vibrateImpact(100, { ...listen, reduced: true }, android), false);
  assert.equal(vibrateImpact(100, { ...listen, paused: true }, android), false);
  assert.equal(vibrateImpact(100, listen, ios), false);
  assert.equal(vibrateImpact(0, listen, android), false);
  assert.equal(vibrateImpact(43, listen, android), true);
  assert.equal(vibrateImpact(100, relay, android), true);
  assert.equal(vibrateImpact(400, flipped, android), true);
  assert.equal(stopImpactVibration(ios), false);
  assert.equal(stopImpactVibration(android), true);
  assert.deepEqual(calls, [[29], [48], [80], 0]);
});

test("behavior summarizes actual samples, accepts aggregates, and leaves its input intact", () => {
  const impulses = Object.freeze([120, 60, 0, -10, NaN, Infinity, "5"]);
  const summary = summarizeBehavior(Object.freeze({
    tapCount: 4,
    impulses,
    averageImpulse: 900,
    maxImpulse: 900,
    chairDrags: 1,
    cushionUses: 2,
    timeOfDay: "night",
  }));
  assert.deepEqual(summary, {
    tapCount: 4, averageImpulse: 60, maxImpulse: 120, chairDrags: 1, cushionUses: 2, timeOfDay: "night",
    n: 2, peak: 38, burst: 0, replays: 0, flipMode: null, drag: 0, matTest: false, matDrops: 0, matComparison: null, reduction: null,
  });
  assert.deepEqual(summarizeBehavior({ tapCount: -3, impulses: [NaN], averageImpulse: 50, maxImpulse: 140, timeOfDay: "unknown" }), {
    tapCount: 0, averageImpulse: 50, maxImpulse: 140, chairDrags: 0, cushionUses: 0, timeOfDay: null,
    n: 0, peak: 0, burst: 0, replays: 0, flipMode: null, drag: 0, matTest: false, matDrops: 0, matComparison: null, reduction: null,
  });
});

test("story types honor thresholds and priority from cushion to regular upstairs", () => {
  const allCriteria = { matTest: true, matDrops: 3, reduction: 0.01, n: 15, peak: 200, replays: 2 };
  assert.equal(classifyBehavior(allCriteria).id, "drummer");
  const cushioned = classifyBehavior(allCriteria, { enableV11: true });
  assert.equal(cushioned.id, "cushioned");
  assert.equal(cushioned.title, "완충재 수집가형");
  assert.equal(cushioned.copy, "매트 위에 몇 번이고 다시 떨어뜨려 봤습니다. 이제 아래층보다 당신이 조용함에 더 집착합니다.");
  assert.equal(classifyBehavior({ ...allCriteria, matDrops: 2, reduction: 0.99 }, { enableV11: true }).id, "drummer");
  assert.equal(classifyBehavior({ ...allCriteria, matTest: false }, { enableV11: true }).id, "drummer");
  assert.equal(classifyBehavior({ n: 6, burst: 6, peak: 180, replays: 2 }).id, "drummer");
  assert.equal(classifyBehavior({ n: 6, burst: 5, peak: 180, replays: 2 }).id, "giant");
  const rewind = classifyBehavior({ n: 7, peak: 180, replays: 2 });
  assert.equal(rewind.id, "rewind");
  assert.equal(rewind.copy, "자기 쿵을 몇 번이고 다시 들었습니다. 귀는 이미 아래층인데, 발뒤꿈치는 아직 위층입니다.");
  assert.equal(classifyBehavior({ n: 3, peak: 59, replays: 1 }).id, "quiet");
  assert.equal(classifyBehavior({ n: 3, peak: 60 }).id, "regular");
  assert.equal(classifyBehavior({ n: 4, peak: 59 }).id, "regular");
  assert.equal(classifyBehavior({ n: 3, peak: 60 }, { quietPeak: 61 }).id, "quiet");
  assert.equal(classifyBehavior({ timeOfDay: "night", cushionUses: 3, chairDrags: 5 }).id, "quiet");
  assert.equal(classifyBehavior().title, "사뿐 고양이형");
});

test("normalized upstairs events use the largest sliding two-second burst", () => {
  const events = Object.freeze([
    { index: 55, timeMs: 2000 }, { index: 10, timeMs: 0 }, { index: 61, timeMs: 1500 },
    { index: 32, timeMs: 500 }, { index: 76, timeMs: 900 }, { index: 9, timeMs: 4800 },
    { index: 180, timeMs: 1000 }, { index: NaN, timeMs: 1500 },
  ]);
  const result = classifyBehavior({ events, impulses: [800], n: 99, peak: 999, burst: 99 });
  assert.deepEqual([result.stats.n, result.stats.peak, result.stats.burst], [6, 180, 6]);
  assert.equal(result.id, "drummer");
  assert.equal(classifyBehavior({ events }, { burstWindowMs: 1999 }).id, "giant");
  assert.equal(events[0].timeMs, 2000);
  assert.equal(classifyBehavior({ events: [], impulses: [800] }).headline, "최대 쿵 0");
});

test("R9-4 uses accepted action time even if reduced motion advances the physics clock", () => {
  const events = Array.from({ length: 6 }, (_, index) => ({
    actionId: index + 1, index: 43, acceptedAtMs: index * 150, timeMs: index * 1608,
  }));
  const { id, stats } = classifyBehavior({ events }, { enableV11: true });
  assert.deepEqual([id, stats.n, stats.burst], ["drummer", 6, 6]);
});

test("rebounds contribute to the thump count and peak but not to the accepted action burst", () => {
  const events = Array.from({ length: 6 }, (_, index) => ({
    actionId: index < 4 ? 1 : 2, index: 100 + index, acceptedAtMs: 0,
  }));
  const { id, stats } = classifyBehavior({ events }, { enableV11: true });
  assert.deepEqual([id, stats.n, stats.peak, stats.burst], ["regular", 6, 105, 2]);
});

test("score headline and sensor badge are derived from the story metrics", () => {
  const record = { n: 12, peak: 184, reduction: 0.63, drag: 0.8, flipMode: "sensor" };
  const first = classifyBehavior(record);
  assert.equal(first.headline, "최대 쿵 184");
  assert.equal(first.detail, "쿵 12번 · 최대 184");
  assert.equal(first.badge, "");
  assert.equal(first.cardVariant, "peak");
  const result = classifyBehavior(record, { enableV11: true });
  assert.equal(result.headline, "최대 쿵 184");
  assert.equal(result.detail, "쿵 12번 · 최대 184 · 의자 끌기 0.8칸");
  assert.equal(result.badge, "휴대폰으로 직접 뒤집음");
  assert.equal(result.cardVariant, "peak");
  assert.equal(classifyBehavior({ reduction: -0.2 }, { enableV11: true }).headline, "최대 쿵 0");
  assert.equal(classifyBehavior({ n: 1, peak: 1643, flipMode: "button" }).headline, "최대 쿵 999");
  assert.equal(classifyBehavior({ impulses: [320] }).headline, "최대 쿵 100");
});

test("a completed S5 shows the comparison line regardless of its type", () => {
  const mat = { before: 100, after: 43 };
  const record = { n: 17, peak: 200, matTest: true, matDrops: 1, matComparison: mat };
  const result = classifyBehavior(record, { enableV11: true });
  assert.equal(result.id, "drummer");
  assert.equal(result.stats.reduction, 0.57);
  assert.equal(result.matLine, "매트 위에선 쿵 100 → 43");
  assert.equal(result.headline, "최대 쿵 200");
  assert.equal(classifyBehavior(record).matLine, "");
  assert.equal(classifyBehavior({ ...record, matTest: false }, { enableV11: true }).matLine, "");
  const incomplete = classifyBehavior({ ...record, matTest: false, matComparison: { before: 100 }, reduction: 1 }, { enableV11: true });
  assert.equal(incomplete.id, "drummer");
  assert.equal(incomplete.matLine, "");
  const noDecrease = classifyBehavior({ matTest: true, matDrops: 1, matComparison: { before: 100, after: 100 } }, { enableV11: true });
  assert.equal(noDecrease.id, "regular");
  assert.equal(noDecrease.matLine, "매트 위에선 쿵 100 → 100");
  assert.equal(noDecrease.cardVariant, "peak");
});

test("D3 uses the S5 bare floor peak for both the type and the card when S0 and S1 are empty", () => {
  const options = { enableV11: true };
  const record = { events: [], matBefore: 100, matTest: true, matDrops: 1, matComparison: { before: 100, after: 44 } };
  const result = classifyBehavior(record, options);
  assert.equal(result.id, "regular");
  assert.deepEqual([result.stats.n, result.stats.peak, result.stats.burst], [0, 100, 0]);
  assert.equal(result.headline, "최대 쿵 100");
  assert.equal(result.detail, "쿵 0번 · 최대 100");
  assert.match(formatShareText(result, pageUrl), /내 최대 쿵은 100\. 매트를 깔았더니 쿵 지수가 56% 줄었다\./);
  assert.equal(classifyBehavior({ ...record, matDrops: 3 }, options).id, "cushioned");

  const bareOnly = classifyBehavior({ events: [], matBefore: 184 }, options);
  assert.equal(bareOnly.id, "giant");
  assert.equal(bareOnly.headline, "최대 쿵 184");
  assert.equal(bareOnly.matLine, "");
  assert.equal(classifyBehavior({ events: [] }, options).headline, "최대 쿵 0");
});

test("D3 keeps the S0 and S1 session peak ahead of any S5 bare floor value", () => {
  const options = { enableV11: true };
  const record = { events: [{ index: 43, timeMs: 1000 }], matBefore: 184 };
  const result = classifyBehavior(record, options);
  assert.equal(result.id, "quiet");
  assert.equal(result.headline, "최대 쿵 43");
  assert.deepEqual([result.stats.n, result.stats.peak, result.stats.burst], [1, 43, 1]);
  assert.equal(classifyBehavior({ ...record, sessionPeak: 55 }, options).headline, "최대 쿵 55");
});

test("listener playback metadata leaves the recorded upstairs result intact", () => {
  const upstairs = Object.freeze({ n: 2, peak: 42, burst: 1, replays: 0 });
  const captured = classifyBehavior(upstairs);
  const withPlayback = classifyBehavior({
    ...upstairs,
    listenerReplay: { n: 3, peak: 400, burst: 3, replays: 3 },
  });
  assert.equal(captured.id, "quiet");
  assert.deepEqual(withPlayback, captured);
  assert.equal(classifyBehavior({ ...upstairs, replays: 2 }).id, "rewind");
});

function cardNode() {
  return {
    attributes: {},
    children: [],
    setAttribute(key, value) { this.attributes[key] = String(value); },
    appendChild(child) { this.children.push(child); },
  };
}

test("mat PNG keeps the peak and event count while adding one comparison line", () => {
  const root = cardNode();
  const mini = cardNode();
  const entry = cardNode();
  root.classList = { add: name => root.setAttribute("class", name) };
  root.querySelector = name => name === "svg.mini" ? mini : name === ".tb > div:nth-child(2)" ? entry : null;
  const canvas = { ownerDocument: { createElement: tag => tag === "div" ? root : cardNode(), createElementNS: cardNode } };
  const record = { n: 12, peak: 184, matTest: true, matDrops: 3, matComparison: { before: 100, after: 40 } };
  renderCard(canvas, classifyBehavior(record, { enableV11: true }));
  assert.match(root.innerHTML, /최대 쿵/);
  assert.match(root.innerHTML, /class="num big">184/);
  assert.match(root.innerHTML, /쿵 12번/);
  assert.doesNotMatch(root.innerHTML, /60%|412|153/);
  assert.deepEqual(entry.children.map(child => child.textContent), ["매트 100 → 40"]);
});

test("PNG rasterization uses the design card markup at 1080×1350", async t => {
  const root = cardNode();
  const mini = cardNode();
  root.classList = { add: name => root.setAttribute("class", name) };
  root.querySelector = name => name === "svg.mini" ? mini : null;
  const document = { createElement: () => root, createElementNS: cardNode };
  const drawn = [];
  const context = {
    save() {},
    restore() {},
    drawImage() { drawn.push(this.globalCompositeOperation); },
    getImageData: () => ({ data: [245, 246, 243, 255] }),
  };
  const canvas = { ownerDocument: document, getContext: () => context, toBlob: callback => callback(image) };
  const result = classifyBehavior({ n: 1, peak: 23 });
  assert.equal(renderCard(canvas, { ...result, copy: "공 < 의자 & 컵" }, {
    demoUrl: pageUrl, events: [{ index: 23, x: 0.2 }, { index: 2, x: 0.6 }],
  }), canvas);
  assert.deepEqual([canvas.width, canvas.height], [CARD_WIDTH, CARD_HEIGHT]);
  assert.equal(root.attributes.class, "card");
  assert.match(root.innerHTML, /class="num big">23/);
  assert.match(root.innerHTML, /공 &lt; 의자 &amp; 컵/);
  assert.match(root.innerHTML, /사뿐 고양이형/);
  assert.match(root.innerHTML, /landing\.example/);
  assert.ok(mini.children.length > 2);

  let svg;
  stubGlobal(t, "Image", class {
    set src(value) {
      svg = decodeURIComponent(value.split(",").slice(1).join(","));
      this.onload();
    }
  });
  stubGlobal(t, "XMLSerializer", class {
    serializeToString(node) {
      assert.equal(node, root);
      return `<div class="card">${node.innerHTML}</div>`;
    }
  });
  assert.equal(await exportCardPng(canvas), image);
  assert.match(svg, /width="1080" height="1350"/);
  assert.match(svg, /<foreignObject/);
  assert.match(svg, /\.card \.hero-side/);
  assert.match(svg, /사뿐 고양이형/);
  assert.deepEqual(drawn, ["destination-over"]);

  context.getImageData = () => ({ data: [0, 0, 0, 0] });
  await assert.rejects(exportCardPng(canvas), /도면을 PNG에/);
});

const image = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
const pageUrl = "https://landing.example/";

test("PNG export requests image/png and reports an empty or failed encoding", async () => {
  assert.equal(await exportCardPng({ toBlob(callback, mime) {
    assert.equal(mime, "image/png");
    callback(image);
  } }), image);
  await assert.rejects(exportCardPng({ toBlob: callback => callback(null) }), /PNG/);
  await assert.rejects(exportCardPng({ toBlob() { throw new Error("tainted"); } }), /tainted/);
});

function stubGlobal(t, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  });
}

test("S6-04 uses first-person wording and only the demo address", () => {
  const result = classifyBehavior({ peak: 184, n: 4 });
  assert.equal(formatShareText(result, `${pageUrl}?vote=https://contest.example/#s6`),
    "나는 오늘 한 방 거인형 위층이었다. 내 최대 쿵은 184. 아래층에서 들어 보니 이렇더라 → https://landing.example/");
  assert.equal(formatShareText(result, "javascript:alert(1)"), "");
});

test("S6-04b shares the measured decrease after completing S5, including a single mat drop", () => {
  const record = { n: 1, peak: 184, matTest: true, matDrops: 1, matComparison: { before: 100, after: 56 } };
  const options = { enableV11: true };
  const expected = "나는 오늘 한 방 거인형 위층이었다. 내 최대 쿵은 184. 매트를 깔았더니 쿵 지수가 44% 줄었다. 아래층에서 들어 보니 이렇더라 → https://landing.example/";
  assert.equal(formatShareText(classifyBehavior(record, options), pageUrl), expected);
  assert.doesNotMatch(formatShareText(classifyBehavior({ ...record, matTest: false }, options), pageUrl), /매트/);
  assert.doesNotMatch(formatShareText(classifyBehavior(record), pageUrl), /매트/);
  const increased = classifyBehavior({ ...record, matComparison: { before: 100, after: 110 } }, options);
  assert.doesNotMatch(formatShareText(increased, pageUrl), /줄었다/);
});

test("file sharing sends PNG and the S6-04 text once", async t => {
  let shared;
  stubGlobal(t, "navigator", {
    canShare(data) {
      assert.deepEqual(Object.keys(data), ["files"]);
      assert.equal(data.files[0].type, "image/png");
      return true;
    },
    async share(data) { shared = data; },
    clipboard: { writeText() { assert.fail("fallback copied on success"); } },
  });
  const result = classifyBehavior({ peak: 184, n: 4 });
  assert.deepEqual(await shareCard({ png: image, result, demoUrl: pageUrl, filename: "card.png" }), {
    status: "shared", downloaded: false, copied: false, url: pageUrl,
  });
  assert.equal(shared.files[0].name, "card.png");
  assert.equal(await shared.files[0].text(), await image.text());
  assert.equal(shared.text, formatShareText(result, pageUrl));
  assert.equal(shared.url, undefined);
});

function mockDownload(t, calls) {
  t.mock.method(URL, "createObjectURL", blob => {
    assert.equal(blob, image);
    return "blob:card";
  });
  t.mock.method(URL, "revokeObjectURL", url => calls.push(["revoke", url]));
  const releases = [];
  t.mock.method(globalThis, "setTimeout", callback => { releases.push(callback); });
  stubGlobal(t, "document", {
    body: { append: () => calls.push(["append"]) },
    createElement(tag) {
      assert.equal(tag, "a");
      return {
        click() { calls.push(["download", this.href, this.download]); },
        remove: () => calls.push(["remove"]),
      };
    },
  });
  return releases;
}

test("an unavailable file share still sends the S6-04 text through the share sheet", async t => {
  const calls = [];
  stubGlobal(t, "navigator", { canShare: () => false, async share(data) { calls.push(data); } });
  const result = classifyBehavior({ peak: 55, n: 2 });
  assert.deepEqual(await shareCard({ png: image, result, demoUrl: pageUrl }), {
    status: "shared", downloaded: false, copied: false, url: pageUrl,
  });
  assert.deepEqual(calls, [{ title: "중력을 뒤집으면", text: formatShareText(result, pageUrl) }]);
});

test("desktop fallback downloads PNG and copies the page link", async t => {
  const calls = [];
  const releases = mockDownload(t, calls);
  stubGlobal(t, "navigator", {
    clipboard: { async writeText(text) { calls.push(["copy", text]); } },
  });
  assert.deepEqual(await shareCard({ png: image, url: pageUrl }), {
    status: "fallback", downloaded: true, copied: true, url: pageUrl,
  });
  assert.ok(calls.some(([name, url, filename]) => name === "download" && url === "blob:card" && filename === "upstairs-type.png"));
  assert.ok(calls.some(([name, url]) => name === "copy" && url === pageUrl));
  assert.equal(releases.length, 1);
  releases[0]();
  assert.deepEqual(calls.at(-1), ["revoke", "blob:card"]);
});

test("failed file and text sharing still try both download and link copy", async t => {
  const calls = [];
  mockDownload(t, calls);
  stubGlobal(t, "navigator", {
    async share(data) { calls.push(["share", Boolean(data.files)]); throw new Error("share unavailable"); },
    clipboard: { async writeText() { throw new Error("clipboard blocked"); } },
  });
  assert.deepEqual(await shareCard({ png: image, url: pageUrl }), {
    status: "fallback", downloaded: true, copied: false, url: pageUrl,
  });
  assert.ok(calls.some(([name]) => name === "download"));
  assert.deepEqual(calls.filter(([name]) => name === "share"), [["share", true], ["share", false]]);
});

test("cancelling the native share does not write to the clipboard", async t => {
  let clipboardCalls = 0;
  stubGlobal(t, "navigator", {
    async share() { throw new DOMException("cancel", "AbortError"); },
    clipboard: { async writeText() { clipboardCalls++; } },
  });
  assert.deepEqual(await shareCard({ png: image, demoUrl: pageUrl }), {
    status: "cancelled", downloaded: false, copied: false, url: pageUrl,
  });
  assert.equal(clipboardCalls, 0);
});

test("link fallback can copy selected text and restore focus without a PNG", async t => {
  const calls = [];
  stubGlobal(t, "navigator", { clipboard: { writeText() { throw new Error("disabled"); } } });
  stubGlobal(t, "document", {
    activeElement: { isConnected: true, focus: () => calls.push("focus") },
    body: { append: field => calls.push(field.value) },
    createElement(tag) {
      assert.equal(tag, "textarea");
      return { style: {}, select() {}, setSelectionRange() {}, remove: () => calls.push("remove") };
    },
    execCommand: command => command === "copy",
  });
  assert.deepEqual(await shareCard({ url: pageUrl }), {
    status: "fallback", downloaded: false, copied: true, url: pageUrl,
  });
  assert.deepEqual(calls, [pageUrl, "remove", "focus"]);
  assert.equal(downloadCardPng(null), false);
});
