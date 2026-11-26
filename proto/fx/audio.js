const sounds = Object.freeze({
  thump: { duration: 0.32, cooldown: 0.09, level: 0.28, from: 93, to: 39, wave: "sine" },
  tap: { duration: 0.095, cooldown: 0.045, level: 0.16, from: 330, to: 128, wave: "triangle" },
  chair: { duration: 0.25, cooldown: 0.16, level: 0.15 },
});

export function impulseToGain(impulse, referenceImpulse = 400) {
  if (!Number.isFinite(impulse) || impulse <= 0) return 0;
  const reference = Number.isFinite(referenceImpulse) && referenceImpulse > 0 ? referenceImpulse : 400;
  return Math.sqrt(Math.min(1, impulse / reference));
}

function createBrowserAudioContext() {
  const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  return AudioContext ? new AudioContext() : null;
}

function createNoise(context, duration) {
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  let state = 12345;
  for (let index = 0; index < samples.length; index++) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    samples[index] = state / 2 ** 31 - 1;
  }
  return buffer;
}

export function createAudioEffects({ referenceImpulse = 400, createContext = createBrowserAudioContext } = {}) {
  let context;
  let output;
  let noise;
  let muted = true;
  let requested = false;
  let enableVersion = 0;
  const nextPlay = new Map();
  const playing = new Set();

  async function enable() {
    const version = ++enableVersion;
    requested = true;
    try {
      if (!context) {
        if (globalThis.navigator?.userActivation?.isActive === false) return false;
        const nextContext = createContext();
        if (!nextContext) return false;
        const nextOutput = nextContext.createGain();
        nextOutput.gain.value = 0;
        nextOutput.connect(nextContext.destination);
        context = nextContext;
        output = nextOutput;
      }
      if (context.state !== "running") await context.resume();
      if (version !== enableVersion || context.state !== "running") return false;
      output.gain.setValueAtTime(1, context.currentTime);
      muted = false;
      return true;
    } catch {
      return false;
    } finally {
      if (version === enableVersion && muted) requested = false;
    }
  }

  function mute() {
    enableVersion++;
    muted = true;
    requested = false;
    if (!context) return;
    output.gain.setValueAtTime(0, context.currentTime);
    nextPlay.clear();
    for (const source of playing) source.stop(context.currentTime);
  }

  async function toggle() {
    if (!requested) return enable();
    mute();
    return false;
  }

  function playVoice(kind, strength, { durationScale = 1, levelScale = 1, pitch = 1, attack = 0.008 } = {}) {
    if (muted || context.state !== "running" || !Object.hasOwn(sounds, kind)) return false;
    const peak = strength * sounds[kind].level * levelScale;
    const now = context.currentTime;
    if (peak <= 0 || now < (nextPlay.get(kind) ?? 0)) return false;

    const { duration: baseDuration, cooldown, from, to, wave } = sounds[kind];
    const duration = baseDuration * durationScale;
    const end = now + duration;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.connect(output);
    let source;
    let filter;

    if (kind === "chair") {
      noise ??= createNoise(context, 0.4);
      source = context.createBufferSource();
      source.buffer = noise;
      filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 520 * pitch;
      filter.Q.value = 0.9;
      source.connect(filter);
      filter.connect(envelope);
      // Successive scrapes give one dragged chair its uneven rhythm.
      for (const [fraction, level] of [[0.12, 0.7], [0.25, 0.2], [0.39, 1], [0.53, 0.25], [0.7, 0.65], [0.84, 0.18]]) {
        envelope.gain.linearRampToValueAtTime(peak * level, now + duration * fraction);
      }
    } else {
      source = context.createOscillator();
      source.type = wave;
      source.frequency.setValueAtTime(from * pitch, now);
      source.frequency.exponentialRampToValueAtTime(to * pitch, now + duration * 0.7);
      source.connect(envelope);
      envelope.gain.linearRampToValueAtTime(peak, now + Math.min(attack, duration * 0.24));
      envelope.gain.linearRampToValueAtTime(peak * 0.25, now + duration * 0.45);
    }

    envelope.gain.linearRampToValueAtTime(0, end);
    source.onended = () => {
      playing.delete(source);
      source.disconnect();
      filter?.disconnect();
      envelope.disconnect();
    };
    source.start(now);
    source.stop(end);
    playing.add(source);
    nextPlay.set(kind, now + cooldown);
    return true;
  }

  function play(kind, impulse) {
    return playVoice(kind, impulseToGain(impulse, referenceImpulse));
  }

  function playImpact(event, { downstairs = false, cushioned = event?.mat === true || event?.cushioned === true } = {}) {
    const index = event?.index;
    if (!Number.isFinite(index) || index <= 0) return false;
    const scale = Math.min(1, index / 200);
    const kind = event.type === "scrape" ? "chair" : event.action === "tap" ? "tap" : "thump";
    return playVoice(kind, Math.sqrt(scale), {
      durationScale: (0.55 + 0.7 * scale) * (downstairs ? 1.1 : 1) * (cushioned ? 0.64 : 1),
      levelScale: (downstairs ? 1.25 : 0.82) * (cushioned ? 0.56 : 1),
      pitch: downstairs ? 0.8 : 1,
      attack: downstairs ? 0.017 : 0.008,
    });
  }

  return {
    get muted() { return muted; },
    enable,
    mute,
    toggle,
    play,
    playImpact,
  };
}
