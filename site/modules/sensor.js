const INVERT_HOLD_MS = 300;
const RETURN_HOLD_MS = 400;
const FIRST_SAMPLE_MS = 1_000;
const HINT_MS = 8_000;
const RAD = Math.PI / 180;
const DOWN = Math.cos(45 * RAD);
const EPS = 1e-9;
const IN_APP = /KAKAOTALK|NAVER\(inapp|Instagram|;\s*wv\)/i;

function screenAngle(source) {
  return source.screen?.orientation?.angle ?? source.orientation ?? 0;
}

function screenGravity(beta, gamma, angle) {
  const right = Math.sin(gamma * RAD) * Math.cos(beta * RAD);
  const down = Math.sin(beta * RAD);
  const cos = Math.cos(angle * RAD), sin = Math.sin(angle * RAD);
  return { x: right * cos + down * sin, y: down * cos - right * sin };
}

export function createClimaxSensor(source, { onState = () => {}, onGravity = () => {}, strength = 920 } = {}) {
  let scope, firstTimer, hintTimer, holdTimer, baseAngle, baseLandscape;
  let active = false, blocked = false, progress = 0;
  let mode = "idle";

  function publish(next, reason = null) {
    mode = next;
    onState({ mode, reason });
  }

  function supportsSensor() {
    return Boolean(source.isSecureContext && source.self === source.top
      && source.DeviceOrientationEvent && source.navigator?.maxTouchPoints > 0
      && !IN_APP.test(source.navigator.userAgent ?? "")
      && source.matchMedia?.("(pointer: coarse)").matches);
  }

  function clearHold() {
    source.clearTimeout(holdTimer);
    holdTimer = undefined;
  }

  function release() {
    scope?.abort();
    scope = undefined;
    source.clearTimeout(firstTimer);
    source.clearTimeout(hintTimer);
    clearHold();
  }

  function stop(reason = "button") {
    release();
    if (mode !== "idle") publish("idle", reason);
  }

  function fallback(reason) {
    release();
    publish("fallback", reason);
  }

  function inverted() {
    clearHold();
    source.clearTimeout(hintTimer);
    onGravity({ x: 0, y: -strength });
    publish("inverted");
  }

  function returned() {
    release();
    onGravity({ x: 0, y: strength });
    publish("returned");
  }

  function changedScreen() {
    const sameAngle = (screenAngle(source) - baseAngle) % 360 === 0;
    const landscape = source.innerWidth > source.innerHeight;
    if (sameAngle && landscape === baseLandscape) return false;
    fallback("screen-rotated");
    return true;
  }

  function sample({ beta, gamma }) {
    if (!Number.isFinite(beta) || !Number.isFinite(gamma)) {
      clearHold();
      return;
    }
    if (mode === "requesting") {
      if (beta === 0 && gamma === 0) return;
      source.clearTimeout(firstTimer);
      publish("tilting");
      if (!scope) return;
      hintTimer = source.setTimeout(() => publish("tilting", "try-button"), HINT_MS);
    }
    if (!scope || changedScreen()) return;

    const { x, y } = screenGravity(beta, gamma, screenAngle(source));
    const listening = mode === "inverted";
    if (!listening) onGravity({ x: x * strength, y: y * strength });
    const reachedThreshold = listening ? y >= DOWN - EPS : y < -0.6;
    if (!reachedThreshold) clearHold();
    else if (holdTimer === undefined) {
      holdTimer = source.setTimeout(() => {
        if (!changedScreen()) {
          if (listening) returned();
          else inverted();
        }
      }, listening ? RETURN_HOLD_MS : INVERT_HOLD_MS);
    }
  }

  function offer() {
    return active && !blocked && !source.document?.hidden && progress >= 0.15 && progress < 0.25 && supportsSensor();
  }

  async function start() {
    if (scope || !offer()) return false;
    const controller = new AbortController();
    scope = controller;
    baseAngle = screenAngle(source);
    baseLandscape = source.innerWidth > source.innerHeight;
    publish("requesting");
    if (controller.signal.aborted) return false;
    const options = { signal: controller.signal };
    source.document?.addEventListener("visibilitychange", () => {
      if (source.document.hidden) stop("hidden");
    }, options);
    source.addEventListener("pagehide", () => stop("pagehide"), options);
    const orientation = source.DeviceOrientationEvent;
    const permission = typeof orientation.requestPermission === "function" ? orientation : source.DeviceMotionEvent;
    try {
      // Call the permission API synchronously inside the caller's click handler.
      if (typeof permission?.requestPermission === "function" && await permission.requestPermission() !== "granted") {
        if (!controller.signal.aborted) fallback("denied");
        return false;
      }
    } catch {
      if (!controller.signal.aborted) fallback("denied");
      return false;
    }
    if (controller.signal.aborted || changedScreen()) return false;

    source.addEventListener("deviceorientation", sample, options);
    source.addEventListener("orientationchange", changedScreen, options);
    source.addEventListener("resize", changedScreen, options);
    source.screen?.orientation?.addEventListener?.("change", changedScreen, options);
    firstTimer = source.setTimeout(() => fallback("no-sample"), FIRST_SAMPLE_MS);
    return true;
  }

  function sync(scene) {
    active = scene.active;
    progress = scene.progress;
    blocked = Boolean(scene.paused || scene.reduced);
    if (!active || blocked || progress > 0.7) stop(progress > 0.7 ? "scroll" : "inactive");
  }

  return { get available() { return supportsSensor(); }, offer, start, sync, stop };
}
