const HOLD_MS = 300;

export function bindRoomGestures(stage, { building, allowed, advanced, accepted, chairStarted, started, signal }) {
  if (!stage) return;
  const ring = stage.querySelector("[data-grab-ring]");
  const ball = stage.querySelector('[data-physics-gesture="throw-ball"]');
  if (ball) ball.style.touchAction = "none";
  let pointer, hold;

  function position(event) {
    const { left, top, width, height } = stage.getBoundingClientRect();
    const geo = window.LandingArt?.geometry?.("s1");
    const room = building().rooms.get(7);
    const px = event.clientX - left, py = event.clientY - top;
    const x = px * building().width / width;
    const y = room.top + ((py * (geo?.h ?? height) / height - (geo?.ceilings?.[7] ?? 0)) /
      ((geo?.floors?.[7] ?? height) - (geo?.ceilings?.[7] ?? 0))) * (room.bottom - room.top);
    return { px, py, x, y, time: event.timeStamp };
  }

  function start(command) {
    const engine = building();
    const actionId = engine.nextActionId;
    const acceptedAtMs = performance.now();
    if (!engine.input(command)) return false;
    accepted?.(actionId, acceptedAtMs);
    return true;
  }

  function grab(timeMs) {
    if (!pointer || !allowed(pointer.chair ? "grabChair" : "throwBall")) return cancel();
    if (pointer.chair) {
      if (!start({ type: "grabChair", x: pointer.start.x, timeMs })) return cancel();
      chairStarted();
    }
    pointer.grabbed = true;
    pointer.node.classList.add("is-grabbed");
    pointer.node.setPointerCapture?.(pointer.id);
    if (ring) ring.hidden = true;
    if (pointer.chair) advanced();
  }

  function finish(timeMs) {
    if (!pointer) return;
    const { chair, grabbed, node, id } = pointer;
    pointer = undefined;
    clearTimeout(hold);
    if (ring) ring.hidden = true;
    node.style.translate = "";
    node.classList.remove("is-grabbed");
    if (node.hasPointerCapture?.(id)) node.releasePointerCapture(id);
    if (chair && grabbed) {
      building().input({ type: "releaseChair", timeMs });
      advanced();
    }
  }

  function cancel() { finish(); }

  function steerChair(event) {
    const samples = event.getCoalescedEvents?.() ?? [];
    let moved = false;
    for (const sample of samples.length ? samples : [event]) {
      const next = position(sample);
      if (Number.isFinite(next.x + next.time)) moved = building().pushPointerSample(next.time, next.x) || moved;
    }
    return moved;
  }

  stage.addEventListener("pointerdown", (event) => {
    const node = event.target.closest("[data-physics-gesture]");
    const chair = node?.dataset.physicsGesture === "drag-chair";
    if (pointer || !node || event.button !== 0 || !allowed(chair ? "grabChair" : "throwBall")) return;
    const start = position(event);
    if (!Number.isFinite(start.x + start.y)) return;
    started?.();
    pointer = { id: event.pointerId, node, chair, start, samples: [start], grabbed: false };
    if (chair && event.pointerType === "touch") {
      if (ring) {
        ring.style.left = `${start.px}px`;
        ring.style.top = `${start.py}px`;
        ring.hidden = false;
      }
      const started = performance.now();
      hold = setTimeout(() => grab(start.time + performance.now() - started), HOLD_MS);
    } else grab(start.time);
  }, { signal });

  stage.addEventListener("pointermove", (event) => {
    if (pointer?.id !== event.pointerId) return;
    if (!pointer.grabbed) {
      const next = position(event);
      if (Math.hypot(next.px - pointer.start.px, next.py - pointer.start.py) > 12) cancel();
    } else if (pointer.chair) {
      if (steerChair(event)) advanced();
    } else {
      const next = position(event);
      pointer.samples = pointer.samples.filter((sample) => next.time - sample.time <= 120);
      pointer.samples.push(next);
      pointer.node.style.translate = `${next.px - pointer.start.px}px ${next.py - pointer.start.py}px`;
    }
  }, { signal });

  stage.addEventListener("touchmove", (event) => {
    if (pointer?.grabbed && pointer.chair && event.cancelable) event.preventDefault();
  }, { passive: false, signal });

  stage.addEventListener("pointerup", (event) => {
    if (pointer?.id !== event.pointerId) return;
    if (pointer.grabbed && pointer.chair) steerChair(event);
    if (pointer.grabbed && !pointer.chair && allowed("throwBall")) {
      const end = position(event);
      const from = pointer.samples.find((sample) => end.time - sample.time <= 120) ?? end;
      const seconds = Math.max(0.016, (end.time - from.time) / 1000);
      if (start({ type: "throwBall", x: end.x, y: end.y, vx: (end.x - from.x) / seconds, vy: (end.y - from.y) / seconds })) advanced();
    }
    finish(event.timeStamp);
  }, { signal });
  for (const type of ["pointercancel", "lostpointercapture", "pointerleave"]) stage.addEventListener(type, (event) => {
    if (pointer?.id === event.pointerId && (type !== "pointerleave" || !pointer.grabbed)) cancel();
  }, { signal });
  signal.addEventListener("abort", cancel, { once: true });
  return { cancel, get dragging() { return Boolean(pointer?.chair && pointer.grabbed); } };
}

export function bindMatRoll(section, lay, signal) {
  const roll = section?.querySelector("[data-mat-roll]");
  const stage = section?.querySelector('[data-stage="s5"]');
  if (!roll || !stage) return;
  let drag, movedPointer;
  roll.style.touchAction = "none";
  roll.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag || roll.getAttribute("aria-disabled") === "true") return;
    movedPointer = false;
    drag = { id: event.pointerId, x: event.clientX };
    roll.setPointerCapture?.(drag.id);
  }, { signal });
  roll.addEventListener("pointermove", (event) => {
    if (drag?.id === event.pointerId) roll.style.translate = `${Math.max(0, event.clientX - drag.x)}px 0`;
  }, { signal });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) roll.addEventListener(type, (event) => {
    if (drag?.id !== event.pointerId) return;
    const moved = event.clientX - drag.x > 10;
    drag = undefined;
    roll.style.translate = "";
    if (type !== "pointerup" || !moved) return;
    movedPointer = true;
    const bounds = stage.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const mat = window.LandingArt?.geometry?.("s5")?.mat;
    if (mat && x >= mat.x0 && x <= mat.x1) lay();
  }, { signal });
  roll.addEventListener("click", (event) => {
    if (movedPointer) event.stopPropagation();
    movedPointer = false;
  }, { signal });
}
