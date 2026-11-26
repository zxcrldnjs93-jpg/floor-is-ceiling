import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createBuilding } from "../physics/building.js";
import { createEngineView } from "./engine-view.js";

const colors = { hit: "#c45115", sent: "#106cb0", asleep: "#7a368d" };

function fixture(search = "?debug", reduced = false) {
  const building = createBuilding();
  const draws = [], transforms = [], positions = [], text = [];
  let path, frames = 0;
  const context = {
    setTransform(...args) { transforms.push(args); },
    clearRect() { frames++; },
    save() {}, restore() {}, rotate() {}, closePath() {}, fill() {}, strokeText() {},
    translate(...args) { positions.push(args); },
    beginPath() { path = []; },
    moveTo(...args) { path.push(args); },
    lineTo(...args) { path.push(args); },
    arc(...args) { path.push(args); },
    stroke() { draws.push({ color: this.strokeStyle, path }); },
    fillText(value) { text.push(value); },
  };
  const attrs = new Map();
  const button = new EventTarget();
  const canvas = { width: 960, height: 1044, style: {}, getContext: () => context, setAttribute: (key, val) => attrs.set(key, val) };
  button.setAttribute = (key, val) => attrs.set(key, val);
  const motion = { matches: reduced };
  const view = createEngineView(canvas, building, { search, button, motion });
  return { building, view, canvas, button, attrs, draws, transforms, positions, text, motion, frames: () => frames };
}

function advance(building, frames = 120) {
  for (let index = 0; index < frames; index++) building.step();
}

function shaft(figure) {
  const [from, to] = figure.path;
  return { from, dy: to[1] - from[1] };
}

test("engine view starts off, binds the toggle and detaches when closed", () => {
  const sample = fixture("");
  const { building, view, canvas, button, attrs } = sample;
  assert.equal(view.enabled, false);
  view.render();
  assert.equal(sample.frames(), 0);
  assert.equal(building.listeners.thump.size, 0);
  assert.equal(canvas.hidden, true);
  assert.equal(attrs.get("aria-pressed"), "false");

  button.dispatchEvent(new Event("click"));
  assert.equal(view.enabled, true);
  assert.equal(canvas.hidden, false);
  assert.equal(canvas.style.pointerEvents, "none");
  assert.equal(attrs.get("aria-pressed"), "true");
  assert.equal(attrs.get("aria-hidden"), "true");
  assert.equal(building.listeners.thump.size, 1);
  assert.equal(building.listeners.receive.size, 1);

  button.dispatchEvent(new Event("click"));
  assert.equal(building.listeners.thump.size, 0);
  view.setEnabled(true);
  view.destroy();
  button.dispatchEvent(new Event("click"));
  assert.equal(view.enabled, false);
  assert.equal(building.listeners.receive.size, 0);
});

test("?debug draws real interpolated bodies and sleep without advancing the engine", () => {
  const { building, view, transforms, positions, text, draws } = fixture();
  const ball = building.rooms.get(7).props.ball;
  const chair = building.rooms.get(7).props.chair;
  assert.equal(view.enabled, true);
  const first = chair.shape.points[0];
  view.render();
  assert.ok(draws.some(draw => draw.color === colors.asleep && draw.path[0][0] === first.x && draw.path[0][1] === first.y));
  assert.ok(text.includes("Z"));
  transforms.length = positions.length = 0;
  assert.ok(building.input({ type: "dropBall", x: 120, y: 26 }));
  advance(building, 2);
  const before = building.world.bodies.map(body => [body.pose(), body.sleeping, body.vx, body.vy]);
  const time = building.world.time;
  view.render(0.4, { x: 20, y: 10, width: 480, height: 522 });
  assert.deepEqual(transforms[1], [2, 0, 0, 2, -40, -20]);
  const { x, y } = ball.pose(0.4);
  assert.ok(positions.some(point => point[0] === x && point[1] === y));
  assert.ok(draws.some(draw => draw.path.some(point => point[2] === ball.shape.radius)));
  assert.equal(building.world.time, time);
  assert.deepEqual(building.world.bodies.map(body => [body.pose(), body.sleeping, body.vx, body.vy]), before);
  view.destroy();
});

test("real impact vectors scale with the index and cross the slab toward 6F", () => {
  for (const height of [undefined, 26]) {
    const { building, view, draws, text } = fixture();
    const hits = [];
    building.onReceive(event => hits.push(event));
    assert.ok(building.input({ type: "dropBall", x: 120, y: height }));
    advance(building, height === undefined ? 88 : 105);
    const hit = hits.find(event => event.receiverRoom === 6);
    assert.equal(hit.index, height === undefined ? 100 : 200);
    view.render();
    const normal = shaft(draws.find(draw => draw.color === colors.hit));
    const delivered = shaft(draws.find(draw => draw.color === colors.sent));
    assert.deepEqual(normal.from, [hit.point.x, hit.point.y]);
    assert.ok(Math.abs(normal.dy + hit.index * 0.24) < 1e-9);
    assert.ok(delivered.dy > 0);
    assert.ok(text.includes("→ 6층"));
    view.destroy();
  }
});

test("a real underside collision shows zero transfer and no blue arrow", () => {
  const { building, view, draws, text } = fixture();
  const room = building.rooms.get(6);
  const cup = room.props.cup;
  const reports = [], delivered = [];
  building.onThump(event => reports.push(event));
  building.onReceive(event => delivered.push(event));
  building.world.move(cup, 120, room.top + 24, 0);
  building.world.kick(cup, 0, -450);
  advance(building, 47);
  assert.ok(reports.some(event => event.slab === "6/7" && event.face === "bottom" && event.index > 0));
  assert.ok(!delivered.some(event => event.slab === "6/7"));
  view.render();
  assert.ok(text.some(text => text.endsWith("전달 0")));
  assert.ok(draws.some(draw => draw.color === colors.hit));
  assert.ok(!draws.some(draw => draw.color === colors.sent));
  view.destroy();
});

test("the inverted replay shows the real path toward 7F", () => {
  const { building, view, draws, text } = fixture("");
  assert.ok(building.input({ type: "nudgeChair" }));
  advance(building);
  building.setProgress(0.65);
  advance(building, 265);
  assert.equal(building.listening, true);
  view.setEnabled(true);
  assert.ok(building.replay("chair"));
  advance(building, 12);
  view.render();
  assert.ok(text.includes("재생 → 7층"));
  assert.ok(shaft(draws.find(draw => draw.color === colors.sent)).dy < 0);
  view.destroy();
});

test("reduced motion keeps the frame until a new capture or resize", () => {
  const sample = fixture("?debug", true);
  const { building, view, canvas, text, motion } = sample;
  view.render();
  assert.equal(sample.frames(), 1);
  assert.ok(building.input({ type: "dropBall", y: 26 }));
  advance(building);
  view.render();
  assert.equal(sample.frames(), 1);
  view.render(1, undefined, true);
  assert.equal(sample.frames(), 2);
  assert.ok(text.includes("쿵 200"));
  canvas.width++;
  view.render();
  assert.equal(sample.frames(), 3);
  motion.matches = false;
  view.render();
  view.render();
  assert.equal(sample.frames(), 5);
  view.setStill(true);
  view.render();
  view.setStill(true);
  view.render();
  assert.equal(sample.frames(), 6);
  view.destroy();
});

test("engine view stays under the 5 KB source budget", () => {
  const bytes = readFileSync(new URL("./engine-view.js", import.meta.url)).length;
  assert.ok(bytes <= 5000, `${bytes} bytes`);
});
