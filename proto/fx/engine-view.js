const colors = { fixed: "#617784", awake: "#00816d", asleep: "#7a368d", hit: "#c45115", sent: "#106cb0" };

function label(ctx, text, x, y) {
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

function outline(ctx, body, alpha) {
  const { x, y, angle } = body.pose(alpha);
  const { radius, points } = body.shape;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = !body.inv ? colors.fixed : body.sleeping ? colors.asleep : colors.awake;
  ctx.beginPath();
  if (radius) ctx.arc(0, 0, radius, 0, Math.PI * 2);
  else {
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.closePath();
  }
  ctx.stroke();
  ctx.restore();
  if (body.inv && body.sleeping) label(ctx, "Z", x + 4, y - 4);
}

function dot(ctx, x, y, radius) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fill();
}

function arrow(ctx, x, y, dx, dy, color) {
  const angle = Math.atan2(dy, dx);
  const length = Math.min(6, Math.hypot(dx, dy) * 0.4);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + dx, y + dy);
  for (const spread of [-0.5, 0.5]) {
    ctx.moveTo(x + dx, y + dy);
    ctx.lineTo(x + dx - length * Math.cos(angle + spread), y + dy - length * Math.sin(angle + spread));
  }
  ctx.stroke();
}

export function createEngineView(canvas, building, {
  button, search = globalThis.location?.search ?? "",
  motion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)"),
} = {}) {
  const ctx = canvas.getContext("2d");
  const worldView = { x: 0, y: 0, width: building.width, height: building.height };
  const flashes = new Map();
  let enabled, off = [];
  let still = false, frameKey;

  function remember(event, received) {
    if (received && (event.face !== "top" || event.receiverRoom == null)) return;
    flashes.set(`${received}:${event.slab}:${event.side}`, { event, received });
  }

  function setEnabled(value) {
    if (enabled === Boolean(value)) return;
    enabled = Boolean(value);
    canvas.hidden = !enabled;
    button?.setAttribute("aria-pressed", String(enabled));
    frameKey = undefined;
    if (enabled) off = [building.onThump(event => remember(event, false)), building.onReceive(event => remember(event, true))];
    else {
      for (const stop of off) stop();
      off = [];
      flashes.clear();
    }
  }

  function render(alpha = 1, view = worldView, capture = false) {
    if (!enabled || !ctx || !canvas.width || !canvas.height || !(view.width > 0 && view.height > 0)) return;
    const frozen = still || motion?.matches;
    const key = frozen ? `${canvas.width}:${canvas.height}:${view.x}:${view.y}:${view.width}:${view.height}` : undefined;
    if (frozen && !capture && frameKey === key) return;
    frameKey = key;
    const sx = canvas.width / view.width, sy = canvas.height / view.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(sx, 0, 0, sy, -view.x * sx, -view.y * sy);
    ctx.font = "bold 12px system-ui";
    ctx.fillStyle = "#17232b";
    for (const world of [building.world, building.lampWorld]) {
      if (!world) continue;
      for (const body of world.bodies) outline(ctx, body, frozen ? 1 : alpha);
      for (const { points } of world.contacts.values()) {
        for (const point of points) dot(ctx, point.x, point.y, 1.8);
      }
    }
    for (const [id, { event, received }] of flashes) {
      if (!frozen && building.world.time - event.time > 1.1) {
        flashes.delete(id);
        continue;
      }
      const { x, y } = event.point;
      if (received) {
        const direction = event.side === "above" ? 1 : -1;
        arrow(ctx, x, y, 0, direction * (20 + event.index * 0.08), colors.sent);
        label(ctx, `${event.kind === "replay" ? "재생 " : ""}→ ${event.receiverRoom}층`, x + 6, y + direction * 20);
      } else {
        dot(ctx, x, y, 3.5);
        const normal = event.side === "above" ? -1 : event.side === "below" ? 1 : 0;
        if (normal && event.index > 0 && event.normalImpulse > 0) arrow(ctx, x, y, 0, normal * event.index * 0.24, colors.hit);
        const blocked = event.face !== "top" || event.receiverRoom == null;
        label(ctx, `쿵 ${event.index}${blocked ? " · 전달 0" : ""}`, x + 6, y - 7);
      }
    }
  }

  const toggle = () => { setEnabled(!enabled); render(); };
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.pointerEvents = "none";
  button?.addEventListener("click", toggle);
  setEnabled(new URLSearchParams(search).has("debug"));
  return {
    get enabled() { return enabled; }, setEnabled, render,
    setStill(value) { if (still !== Boolean(value)) frameKey = undefined; still = Boolean(value); },
    destroy() {
      setEnabled(false);
      button?.removeEventListener("click", toggle);
    },
  };
}
