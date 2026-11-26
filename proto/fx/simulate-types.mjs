import assert from "node:assert/strict";
import { compareMatDrop, createBuilding } from "../physics/building.js";
import { classifyBehavior, TYPE_RULES } from "./type.js";

function randomFrom(seed) {
  let state = seed;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function advance(building, seconds) {
  const frames = Math.ceil(seconds / building.dt);
  for (let frame = 0; frame < frames; frame++) building.step();
}

function typeEvent(hit) {
  return { index: hit.index, actionId: hit.actionId, timeMs: hit.inputTime * 1000 };
}

function trackInputTimes(building) {
  const accepted = new Map();
  const cancelled = [];
  building.onInputCancelled(event => {
    assert.ok(accepted.delete(event.actionId), "only accepted inputs can be cancelled");
    cancelled.push(event);
  });
  return {
    cancelled,
    input(command, timeMs) {
      const actionId = building.nextActionId;
      if (!building.input(command)) return false;
      accepted.set(actionId, timeMs);
      return true;
    },
    events() {
      const hits = building.recording("upper").filter(hit => hit.actionId !== undefined);
      assert.deepEqual(new Set(hits.map(hit => hit.actionId)), new Set(accepted.keys()),
        "each accepted and uncancelled action must have a record");
      return hits.map(hit => ({ ...typeEvent(hit), acceptedAtMs: accepted.get(hit.actionId) }));
    },
  };
}

function finishDrops(building) {
  for (let step = 0; step < 1200 && building.hasPendingDrop; step++) building.step();
  assert.equal(building.hasPendingDrop, false, "all accepted drops must finish or be cancelled");
  advance(building, 0.7);
}

function measuredMatTrial(maxDrops) {
  const building = createBuilding();
  const trials = [];
  building.onReceive(event => {
    if (event.action === "matDrop" && event.sourceRoom === 7 && event.receiverRoom === 6) trials.push(event);
  });
  assert.ok(building.input({ type: "matDrop" }));
  advance(building, 1.8);
  assert.ok(building.input({ type: "mat", enabled: true }));
  for (let drop = 0; drop < maxDrops; drop++) {
    assert.ok(building.input({ type: "matDrop" }));
    advance(building, 1.8);
  }

  const paddedHits = trials.filter(event => event.mat);
  const paddedActions = new Set(paddedHits.map(event => event.actionId));
  assert.equal(paddedActions.size, maxDrops);
  assert.equal(new Set(trials.map(event => event.actionId)).size, maxDrops + 1);
  const before = Math.max(...trials.filter(event => !event.mat).map(event => event.index));
  const firstPaddedAction = paddedHits[0].actionId;
  const after = Math.max(...paddedHits.filter(event => event.actionId === firstPaddedAction).map(event => event.index));
  const { bare, padded } = compareMatDrop();
  assert.deepEqual([before, after], [bare.index, padded.index]);
  assert.equal(building.recording("upper").length, 0, "S5 drops must stay out of upstairs history");
  return { matComparison: { before, after }, maxDrops: paddedActions.size };
}

function playChairDrag(building, random, inputs, timeMs) {
  const mode = random();
  if (mode < 1 / 3) {
    const start = building.rooms.get(7).props.chair.x;
    const distance = 10 + 70 * random();
    assert.ok(inputs.input({ type: "grabChair", x: start, timeMs }, timeMs));
    for (let move = 1; move <= 10; move++) {
      advance(building, 0.05);
      assert.ok(building.pushPointerSample(timeMs + 50 * move, start - distance * move / 10));
    }
    advance(building, 0.15);
    assert.ok(building.input({ type: "releaseChair", timeMs: timeMs + 650 }));
    advance(building, 0.05);
  } else {
    assert.ok(inputs.input({ type: "dragChair", distance: -55 }, timeMs));
    if (mode < 2 / 3) assert.ok(building.settleChairDrag());
    else advance(building, 0.65);
  }
}

function session(random, scrapeRandom) {
  const building = createBuilding();
  const inputs = trackInputTimes(building);
  const room = building.rooms.get(7);
  const radius = room.props.ball.shape.radius;
  const highestY = room.top + radius;
  const lowestY = room.bottom - radius - 5.5;
  const count = Math.floor(17 * random() ** 1.55);
  const quickTaps = random() < 0.2;
  let timeMs = 0;
  let accepted = 0;
  for (let action = 0; action < count; action++) {
    if (action > 0) {
      const gap = quickTaps ? 0.15 + random() * 0.25 : 0.9 + random() * 1.2;
      advance(building, gap);
      timeMs += gap * 1000;
    }
    const choice = random();
    const x = building.width * (0.1 + 0.8 * random());
    const input = choice < 0.6
      ? { type: "dropBall", x, y: highestY + (lowestY - highestY) * random() }
      : { type: choice < 0.85 ? "dropBall" : "tap", x };
    accepted += Number(inputs.input(input, timeMs));
  }

  if (count) {
    const start = building.world.time;
    finishDrops(building);
    timeMs += (building.world.time - start) * 1000;
  }
  const useChair = scrapeRandom() < 0.3;
  if (useChair) playChairDrag(building, scrapeRandom, inputs, timeMs);
  const scrapes = building.recording("upper").filter(hit => hit.action === "dragChair" && hit.type === "scrape");
  assert.equal(scrapes.length, Number(useChair));
  for (const { index } of scrapes) assert.ok(index >= 0 && index <= 200, `engine scrape index ${index} outside 0–200`);
  const events = inputs.events();
  const replayChoice = random();
  const record = {
    events,
    sessionPeak: events.length ? Math.max(...events.map(event => event.index)) : undefined,
    replays: replayChoice < 0.62 ? 0 : replayChoice < 0.84 ? 1 : 2 + Math.floor(random() * 2),
    flipMode: random() < 0.72 ? "scroll" : "button",
  };
  return { record, scrapeIndex: scrapes[0]?.index, attempts: count, accepted, cancelled: inputs.cancelled.length };
}

const baselineOptions = { enableV11: true };
const options = { ...baselineOptions };
for (const argument of process.argv.slice(2)) {
  const [key, text] = argument.split("=");
  if (!Object.hasOwn(TYPE_RULES, key) || !text || !Number.isFinite(Number(text))) {
    throw new Error(`지원하는 수치 재정의 형식은 TYPE_RULES 키=값입니다 (${argument}).`);
  }
  options[key] = Number(text);
}

const sampleSize = 1000;
const random = randomFrom(20261124);
const matRandom = randomFrom(20261125);
const repeatRandom = randomFrom(20261126);
const scrapeRandom = randomFrom(20261127);
const { matComparison, maxDrops } = measuredMatTrial(5);
let matTrials = 0;
let matOnlyTrials = 0;
let dropAttempts = 0;
let acceptedDrops = 0;
let cancelledDrops = 0;
const matDropCounts = new Array(maxDrops).fill(0);
const scrapeIndices = [];
const counts = new Map();
for (let index = 0; index < sampleSize; index++) {
  const { record, scrapeIndex, attempts, accepted, cancelled } = session(random, scrapeRandom);
  dropAttempts += attempts;
  acceptedDrops += accepted;
  cancelledDrops += cancelled;
  if (scrapeIndex !== undefined) scrapeIndices.push(scrapeIndex);
  if (matRandom() < 0.25) {
    record.matTest = true;
    record.matDrops = 1;
    while (record.matDrops < maxDrops && repeatRandom() < 0.55) record.matDrops++;
    record.matBefore = matComparison.before;
    record.matComparison = matComparison;
    matDropCounts[record.matDrops - 1]++;
    matTrials++;
    if (!record.events.length) matOnlyTrials++;
  }
  const { title, stats } = classifyBehavior(record, options);
  if (!record.events.length && record.matTest) {
    assert.deepEqual([stats.peak, stats.n, stats.burst], [matComparison.before, 0, 0]);
  }
  counts.set(title, (counts.get(title) ?? 0) + 1);
}

for (const [title, count] of [...counts].sort((a, b) => b[1] - a[1])) {
  console.log(`${title}\t${count}\t${(100 * count / sampleSize).toFixed(1)}%`);
}
if (process.argv.length === 2) {
  assert.equal(counts.size, 6, "all six v0.3 types must occur");
  assert.ok(Math.max(...counts.values()) <= 0.4 * sampleSize, "no type may exceed 40% of this sample");
}
const cushioned = classifyBehavior({ matTest: true, matDrops: 3, matComparison }, baselineOptions);
assert.equal(cushioned.id, "cushioned");
assert.ok(matOnlyTrials > 0 && scrapeIndices.length > 0);
console.log(`S0 공 입력 ${dropAttempts}회\t수락 ${acceptedDrops} · 거부 ${dropAttempts - acceptedDrops} · 수락 후 취소 ${cancelledDrops}`);
console.log(`S1 의자 끌기 ${scrapeIndices.length}건\t드르륵 ${Math.min(...scrapeIndices)}~${Math.max(...scrapeIndices)}`);
console.log(`S5 완료 ${matTrials}건 (S5만 ${matOnlyTrials}건)\t매트 낙하 1~${maxDrops}회: ${matDropCounts.join(" · ")}건`);
console.log(`물리 확인\t${cushioned.matLine} · 매트 낙하 3회 → ${cushioned.title}`);

function measuredHits(input, track = "upper") {
  const building = createBuilding();
  assert.ok(building.input(input));
  advance(building, 1);
  return building.recording(track);
}

const highDrop = measuredHits({ type: "dropBall", x: 120, y: 26 });
const giant = classifyBehavior({ events: highDrop.map(typeEvent) }, baselineOptions);
assert.ok(giant.stats.peak >= 180);
assert.equal(giant.id, "giant");
const button = measuredHits({ type: "dropBall", x: 120 });
const heel = measuredHits({ type: "tap", x: 120 });
const [chair] = measuredHits({ type: "nudgeChair" }, "chair");
assert.deepEqual([button[0].index, heel[0].index, chair.index], [100, 43, 141]);
assert.equal(classifyBehavior({ events: button.map(typeEvent) }, baselineOptions).id, "regular");
assert.equal(classifyBehavior({ events: button.map(typeEvent), replays: 2 }, baselineOptions).id, "rewind");
assert.equal(classifyBehavior({ events: heel.map(typeEvent) }, baselineOptions).id, "quiet");

function heelBurst(reduced) {
  const building = createBuilding();
  const inputs = trackInputTimes(building);
  for (let action = 0; action < 6; action++) {
    assert.ok(inputs.input({ type: "tap", x: 120 }, action * 150));
    // The reduced-motion path settles synchronously between the same 150 ms user inputs.
    advance(building, reduced ? 1.6 : 0.15);
  }
  finishDrops(building);
  return inputs.events();
}

const normal = heelBurst(false);
const reduced = heelBurst(true);
assert.ok(reduced.at(-1).timeMs - reduced[0].timeMs > 2000);
for (const events of [normal, reduced]) {
  const { id, stats } = classifyBehavior({ events }, baselineOptions);
  assert.deepEqual([id, stats.n, stats.burst], ["drummer", 6, 6]);
}

function overloadedBurst({ turn = false, physicsSecondsPerPress = 0.1 } = {}) {
  const building = createBuilding();
  const inputs = trackInputTimes(building);
  const attempts = 12;
  let accepted = 0;
  for (let action = 0; action < attempts; action++) {
    accepted += Number(inputs.input({ type: "dropBall", x: 120, y: 26 }, action * 100));
    assert.ok(building.dropQueue.length <= 1);
    if (action + 1 < attempts) advance(building, physicsSecondsPerPress);
  }
  if (turn) building.setProgress(0.65);
  finishDrops(building);
  const events = inputs.events();
  const completed = new Set(events.map(event => event.actionId)).size;
  const { stats } = classifyBehavior({ events }, baselineOptions);
  assert.equal(stats.burst, completed);
  assert.equal(accepted, completed + inputs.cancelled.length);
  assert.ok(inputs.cancelled.every(event => event.reason === "rotation"));
  return [accepted, attempts - accepted, completed, inputs.cancelled.length];
}

const limited = overloadedBurst();
const turned = overloadedBurst({ turn: true });
const synchronous = overloadedBurst({ physicsSecondsPerPress: 1.6 });
assert.deepEqual(limited, [4, 8, 4, 0]);
assert.deepEqual(turned, [4, 8, 1, 3]);
console.log(`한도 확인\t최고 낙하 10Hz 12회 중 ${limited[0]}회 수락 · 즉시 반전 시 ${turned[2]}회 기록, ${turned[3]}회 취소`);
console.log(`통합 확인 사항\t각 조작 뒤 물리를 1.6초 즉시 진행하면 동일한 12회 중 ${synchronous[0]}회 수락`);
console.log("R9-4\t0.15초 간격 발뒤꿈치 6회 → 일반·움직임 줄이기 모두 드러머 (쿵 6번, 연타 6)");
console.log(`물리 확인\t높은 낙하 ${giant.stats.peak} → ${giant.title} · 버튼 ${button[0].index} · 발뒤꿈치 ${heel[0].index} · 6층 의자 ${chair.index}(유형 집계 제외)`);
console.log("재현 행동\t버튼 1회 → 보통 · 버튼 1회 뒤 다시 듣기 2회 → 되감기 · 발뒤꿈치 1회 → 고양이");
