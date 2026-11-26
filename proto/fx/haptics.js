export function vibrate(pattern, device = globalThis.navigator) {
  try {
    return device?.vibrate?.(pattern) === true;
  } catch {
    return false;
  }
}

export function supportsImpactVibration(device = globalThis.navigator) {
  return typeof device?.vibrate === "function" && (device?.userAgentData?.platform === "Android"
    || /\bAndroid\b/i.test(device?.userAgent ?? ""));
}

export function vibrateImpact(index, { scene, receiverRoom, listening = false, enabled = true, reduced = false, paused = false } = {}, device = globalThis.navigator) {
  if (!enabled || reduced || paused || !Number.isFinite(index) || index <= 0 || !supportsImpactVibration(device)) return false;
  const isListener = (scene === "listen" && receiverRoom === 6)
    || (scene === "relay" && receiverRoom === 5)
    || (scene === "flip" && listening && receiverRoom === 7);
  if (!isListener) return false;
  const duration = Math.round(15 + 65 * Math.min(1, index / 200));
  return vibrate([duration], device);
}

export function stopImpactVibration(device = globalThis.navigator) {
  return supportsImpactVibration(device) && vibrate(0, device);
}
