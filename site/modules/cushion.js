const HOME_X = 0.5;
const LAMP_SAMPLE_SECONDS = 0.9;
const REFERENCE_IMPACT = 100;

export function createCushion(section, building, physics, motion, sessionPeak) {
  if (!section || !motion.createCushionTimeline) return;
  const stage = section.querySelector('[data-stage="s5"]');
  const ballRoom = building.rooms.get(7);
  const { ball } = ballRoom.props;
  const { lamp, cable } = building.rooms.get(6);
  const { width, height } = physics.MAT_PRESET;
  const controls = [...section.querySelectorAll('[data-action^="mat-"]')];
  const mat = section.querySelector("[data-mat]");
  const result = section.querySelector("[data-mat-result]");
  const feedback = section.querySelector('[data-fx="mat-feedback"]');
  const values = ["before", "after", "reduction"].map((key) => section.querySelector(`[data-impact-${key}]`));
  const cues = ["s5-08", "s5-08b", "s5-05", "s5-after", "s5-07"].map((key) => section.querySelector(`[data-cue="${key}"]`));
  const art = window.LandingArt;
  let timeline, plan, pending, parked, heightSource, locked = false;
  let active = false, reduced = false, placed = false, last = null, lastAction;
  let announcedBare, announcedDrops = 0, lastMatIndex;

  function planDrop() {
    const best = building.bestDrop;
    const peak = best && best.index >= Math.max(REFERENCE_IMPACT, sessionPeak()) ? best.y : undefined;
    const source = peak === undefined ? "reference" : "peak";
    const y = Math.min(ballRoom.bottom - ball.shape.radius - 5.5, peak ?? (ballRoom.top + ballRoom.bottom) / 2);
    if (plan?.y === y && heightSource === source) return;
    heightSource = source;
    plan = { x: HOME_X * building.width, y };
    timeline = motion.createCushionTimeline({ reduced, eventTarget: section, drop: { type: "matDrop", y }, heightSource });
    if (stage) stage.dataset.dropHeight = String((y - ballRoom.top) / (ballRoom.bottom - ballRoom.top));
    art?.matLayout?.({ x: HOME_X, width, thickness: height });
  }

  function alignBall() {
    if (!active || placed || !plan || pending || !building.canInputFor("matDrop") || building.hasPendingDrop) return;
    const geo = art?.geometry?.("s5");
    plan.x = (geo?.drop?.x ?? HOME_X) * building.width;
    parked = { x: ball.x, y: ball.y, angle: ball.angle, vx: ball.vx, vy: ball.vy, spin: ball.spin, sleeping: ball.sleeping };
    building.world.move(ball, plan.x, plan.y, 0);
    building.world.sleepBody(ball);
    placed = true;
  }

  function sync(visible, still) {
    reduced = still;
    if (!visible && parked && building.canInputFor("matDrop")) {
      const { x, y, angle, vx, vy, spin, sleeping } = parked;
      building.world.move(ball, x, y, angle);
      Object.assign(ball, { vx, vy, spin });
      if (sleeping) building.world.sleepBody(ball);
    }
    if (!visible) parked = undefined;
    if (visible !== active) placed = false;
    if (visible && !active && !locked) planDrop();
    active = visible;
    timeline?.setReduced(reduced);
    timeline?.setActive(active);
    alignBall();
  }

  function act(action) {
    if (!active || timeline?.state.action !== action || building.hasPendingDrop) return false;
    if (action === "mat-lay") return building.input({ type: "mat", enabled: true }) && timeline.layMat();
    const surface = action === "mat-before" ? "bare" : "mat";
    if (Boolean(building.mat) !== (surface === "mat") && !building.input({ type: "mat", enabled: surface === "mat" })) return false;
    const trial = timeline.beginDrop(surface);
    const actionId = building.nextActionId;
    if (!building.input(trial.command)) {
      timeline.cancelDrop(trial.id);
      return false;
    }
    locked = true;
    const anchor = building.lampWorld.linkAnchor(cable);
    building.lampWorld.move(lamp, anchor.x, anchor.y + cable.length, 0);
    building.lampWorld.sleepBody(lamp);
    building.rooms.get(6).lampPulse = undefined;
    pending = { trial, actionId, started: building.world.time, lampAngle: 0 };
    if (feedback) feedback.textContent = "";
    parked = undefined;
    placed = true;
    return true;
  }

  function receive(event) {
    if (event.kind !== "live" || event.action !== "matDrop") return false;
    if (pending && !pending.hit && event.actionId === pending.actionId && event.receiverRoom === 6
        && Boolean(event.mat) === (pending.trial.surface === "mat")) pending.hit = event;
    return true;
  }

  function cancelInput({ actionId }) {
    if (!pending || actionId !== pending.actionId || pending.hit) return;
    timeline.cancelDrop(pending.trial.id);
    pending = undefined;
  }

  function step(dt) {
    timeline?.advance(dt);
    alignBall();
    if (!pending) {
      if (!active && building.mat) building.input({ type: "mat", enabled: false });
      return;
    }
    const { trial, hit, started } = pending;
    if (hit) {
      const anchor = building.lampWorld.linkAnchor(cable);
      const angle = Math.abs(Math.atan2(lamp.x - anchor.x, lamp.y - anchor.y));
      pending.lampAngle = Math.max(pending.lampAngle, angle);
      if (building.world.time - hit.time < LAMP_SAMPLE_SECONDS) return;
      const recorded = timeline.record(trial.id, { index: hit.index, lampAngle: pending.lampAngle, force: hit.force });
      if (recorded && trial.surface === "mat") lastMatIndex = hit.index;
      pending = undefined;
      return recorded;
    } else if (!building.hasPendingDrop || building.world.time - started > 2.5) {
      timeline.cancelDrop(trial.id);
      pending = undefined;
    }
  }

  function render(allowed) {
    const state = timeline?.state;
    const action = allowed && !building.hasPendingDrop ? state?.action ?? null : null;
    if (action !== lastAction) for (const control of controls) control.setAttribute("aria-disabled", String(control.dataset.action !== action));
    lastAction = action;
    if (last === state) return;
    const { before, comparison, laid, matTest, heightCue, lampCue, conclusionCue, matDrops } = state ?? {};
    section.dataset.matTest = matTest ?? "ready";
    if (mat && mat.hidden === Boolean(laid)) mat.hidden = !laid;
    if (result && result.hidden === Boolean(comparison)) result.hidden = !comparison;
    [heightCue !== "S5-08", heightCue !== "S5-08b", !lampCue, !conclusionCue, !comparison].forEach((hidden, index) => {
      if (cues[index] && cues[index].hidden !== hidden) cues[index].hidden = hidden;
    });
    const reduction = comparison?.reduction;
    const readings = [before?.index, comparison?.after, reduction == null ? undefined : Math.round(reduction * 100)];
    values.forEach((node, index) => {
      const text = String(readings[index] ?? "—");
      if (node && node.textContent !== text) node.textContent = text;
    });
    if (before !== last?.before || comparison !== last?.comparison) art?.matResult?.(before && { before: before.index, after: comparison?.after });
    if (lampCue !== last?.lampCue || comparison !== last?.comparison) art?.matLamp?.(comparison && {
      before: comparison.frames[0].lampAngle, after: comparison.frames[1].lampAngle,
    });
    if (active && feedback && before && before !== announcedBare) {
      feedback.textContent = `맨바닥 쿵 ${before.index}.`;
      announcedBare = before;
    }
    // A visitor can leave as soon as the numbers appear, before the lamp cue opens.
    if (feedback && comparison && matDrops > announcedDrops) {
      feedback.textContent = matDrops === 1
        ? `같은 높이에서 맨바닥 쿵 ${comparison.before}, 매트 위 쿵 ${comparison.after}. 쿵 지수가 ${readings[2]}% 줄었습니다.${lampCue ? " 6층 조명이 덜 흔들립니다." : ""}`
        : `매트 위 쿵 ${lastMatIndex}.`;
      announcedDrops = matDrops;
    }
    last = state;
  }

  art?.matResult?.(null);
  art?.matLamp?.(null);
  if (stage) delete stage.dataset.dropHeight;
  return { sync, act, receive, cancelInput, step, render, get plan() { return plan; }, get pending() { return Boolean(pending); },
    get bareIndex() { return timeline?.state.before?.index; }, get heightSource() { return heightSource; },
    get comparison() { return timeline?.state.comparison; }, get matDrops() { return timeline?.state.matDrops ?? 0; } };
}
