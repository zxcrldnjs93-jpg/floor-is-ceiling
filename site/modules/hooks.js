const ACTIONS = "[data-action]";
const ACTIVE_ACTIONS = new Set(["tap", "drop", "drop-high", "drag-chair", "throw-ball", "replay", "nudge", "flip", "reset-flip", "flip-revisit", "cushion-revisit", "s4-next",
  "sensor-enable", "sensor-use-button", "mat-before", "mat-lay", "mat-after", "intro-revisit", "save", "share", "restart"]);
const SVG = "http://www.w3.org/2000/svg";
const PENDULUM_LIMIT = 0.6;
const FLOOR_COPY = { intro: "7층, 당신의 집입니다.", listen: "6층에 도착했습니다.", relay: "5층에 도착했습니다.",
  down: "건물이 뒤집혔습니다. 이제 7층이 맨 아래이고, 7층 바닥이던 선이 7층 천장입니다.",
  up: "건물이 원래대로 돌아왔습니다." };
const degrees = (radians) => radians * 180 / Math.PI;
const setText = (node, value) => { if (node && node.textContent !== value) node.textContent = value; };

function scene(section) {
  const find = (selector) => section?.querySelector(selector);
  return {
    section,
    panel: find("[data-motion-sticky]"),
    wave: find("[data-wave-layer]"),
    reading: find("[data-kung-reading], [data-impact-reading], [data-thump-index]"),
    feedback: find("[data-fx]"),
    records: find("[data-record-strip]"),
    cursor: find("[data-replay-cursor]"),
    reaction: find("[data-reaction], [data-react]"),
  };
}

export function bindHooks(doc) {
  const root = doc.querySelector("[data-page-stage], main");
  const get = (n) => root.querySelector(`[data-scene="s${n}"]`);
  const scenes = {
    intro: scene(get(0)), gesture: scene(get(1)), listen: scene(get(2)), relay: scene(get(3)),
    flip: scene(get(4)), cushion: scene(get(5)), result: scene(get(6)), footer: scene(get(7)),
  };
  const footerActions = scenes.footer.section?.querySelector(".coda-end");
  if (footerActions && !scenes.footer.feedback) {
    const status = doc.createElement("p");
    status.className = "sr";
    status.dataset.fx = "footer-feedback";
    status.setAttribute("role", "status");
    footerActions.append(status);
    scenes.footer.feedback = status;
  }
  const flip = scenes.flip.section;
  const stage = flip?.querySelector("[data-flip-layer]");
  const pauseButton = doc.querySelector("#motion-pause, [data-action=pause]");
  const result = scenes.result.section;
  const rulerMine = result?.querySelector("[data-ruler-mine]");
  const rulerLabel = rulerMine?.querySelector("[data-ruler-mine-label]");
  const rulerValue = rulerMine?.querySelector("[data-ruler-mine-value]");
  const floorLive = doc.querySelector("[data-floor-live]");
  scenes.intro.reading?.setAttribute("aria-hidden", "true");
  scenes.intro.reading?.setAttribute("aria-live", "off");
  const flipInvite = result?.querySelector("[data-flip-missed]");
  const chairExplanation = flip?.querySelector('[data-cue="s4-06"], .s406');
  const fixedQuestion = flip?.querySelector("[data-s4-question]");
  const movingQuestion = stage?.querySelector('[data-physics-body="copy:0"]');
  if (chairExplanation) chairExplanation.hidden = true;
  const perspective = flip?.querySelector("[data-perspective-label]");
  if (perspective && floorLive) perspective.setAttribute("aria-live", "off");
  const cues = [...(flip?.querySelectorAll("[data-flip-cue]") ?? [])];
  const flipButton = flip?.querySelector("[data-action=flip]");
  const flipLabel = flipButton?.querySelector("[data-flip-label]")
    ?? [...(flipButton?.childNodes ?? [])].find((node) => node.nodeType === 3 && node.textContent.trim()) ?? flipButton;
  const initialFlipLabel = flipLabel?.textContent?.trim() || "중력 뒤집기";
  const flipControls = flip?.querySelector('[data-place="s4-controls"]');
  const nextCushion = flip?.querySelector('[data-action="s4-next"]');
  const flipHint = flipControls?.querySelector('.hint');
  const explicitReturn = flip?.querySelector("[data-action=reset-flip]");
  const roomControls = [...root.querySelectorAll('[data-action="tap"], [data-action="drop"], [data-action="drop-high"], [data-action="nudge"], [data-action="drag-chair"], [data-action="throw-ball"]')];
  const gestureStage = scenes.gesture.section?.querySelector('[data-stage="s1"]');
  const gestureCue = scenes.gesture.section?.querySelector('[data-cue="s1-03"]');
  const soundButton = doc.querySelector('#sound-toggle, [data-action="sound"]');
  const soundHint = scenes.listen.section?.querySelector('[data-cue="s2-06"]');
  const vibrationHint = doc.querySelector('[data-cue="u-08"]');
  const sensorOffer = flip?.querySelector("[data-sensor-offer]");
  const sensorButton = flip?.querySelector('[data-action="sensor-enable"]');
  const sensorStatus = flip?.querySelector("[data-sensor-status]");
  const sensorCues = [17, 18, 19].map((n) => [n, flip?.querySelector(`[data-cue="s4-${n}"]`)]);
  const listenCue = scenes.listen.section?.querySelector('[data-cue="s2-after"]');
  const originalListenCue = listenCue?.textContent ?? "";
  const emptyCue = scenes.listen.section?.querySelector('[data-cue="s2-empty"]');
  const introCues = scenes.intro.section?.querySelectorAll('[data-cue="s0-after"], [data-cue="s0-band"]') ?? [];
  const introStage = scenes.intro.section?.querySelector("[data-stage]");
  const relay = scenes.relay.section?.querySelector("[data-stage]");
  let latestRecords = [];
  let latestChair;
  let replayLabel;
  let vibrationTimer;
  const reactionTimers = new Map();

  function actionFor(target, event) {
    const surface = target.closest("[data-physics-space], [data-stage], [data-physics]");
    const explicit = target.closest(ACTIONS);
    const roomClick = !explicit && surface && surface === introStage && event.detail > 0;
    const control = roomClick ? introStage : explicit;
    if (!control || !root.contains(control)) return null;
    const owningSection = control.closest("[data-scene]");
    const owner = Object.keys(scenes).find((key) => scenes[key].section === owningSection);
    let action = roomClick ? "drop" : control.dataset.action;
    if (!owner || !ACTIVE_ACTIONS.has(action)) return null;
    const highDrop = action === "drop-high";
    if (highDrop) action = "drop";
    if ((["tap", "drop"].includes(action) && owner !== "intro") || (action === "nudge" && owner !== "relay")) return null;
    let position, height = highDrop ? 0 : undefined;
    if (surface && event.detail > 0) {
      const bounds = surface.getBoundingClientRect();
      if (bounds.width) position = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      if (action === "drop" && !highDrop && owner === "intro") {
        const geo = window.LandingArt?.geometry?.("s0");
        const top = geo?.ceilings?.[7], bottom = geo?.floors?.[7];
        const y = (event.clientY - bounds.top) * (geo?.h ?? bounds.height) / bounds.height;
        if (roomClick && !(y >= (geo?.lines?.ceilings?.[7] ?? top) && y <= bottom)) return null;
        if (bottom > top && Number.isFinite(y)) height = Math.max(0, Math.min(1, (y - top) / (bottom - top)));
      }
    }
    if (owner === "intro" && position === undefined && (action === "tap" || action === "drop") && introStage?.clientWidth) {
      const ball = introStage.querySelector('[data-physics-body="7:ball"]');
      const center = Number(ball?.dataset.cx);
      if (Number.isFinite(center)) position = center / introStage.clientWidth;
    }
    return { action, owner, control, position, height };
  }

  function enabled(storyReady, cardReady) {
    floorLive?.toggleAttribute("data-floor-live-engine", storyReady);
    for (const control of root.querySelectorAll(ACTIONS)) {
      const hit = actionFor(control, { detail: 0 });
      if (!hit) continue;
      const { action } = hit;
      if (action === "reset-flip" || action === "s4-next") continue;
      control.hidden = action === "save" || action === "share" ? !cardReady : !storyReady;
    }
    for (const key of ["gesture", "cushion"]) {
      const section = scenes[key].section;
      if (section) section.hidden = !storyReady;
    }
    if (pauseButton) pauseButton.hidden = !storyReady;
  }

  function showControls({ active, paused, inputAllowed, chairAllowed, tapAllowed = inputAllowed, dragAllowed = inputAllowed,
      throwAllowed = inputAllowed, listening, flipped, flipDisabled, flipSeen = false, sensorHint = false }) {
    const focused = doc.activeElement;
    doc.documentElement.toggleAttribute("data-motion-paused", paused);
    root.dataset.perspective = listening ? "downstairs" : "upstairs";
    root.toggleAttribute("data-listening", listening);
    const floor = active === "flip" && listening ? "7" : scenes[active]?.section?.dataset.floor ?? "7";
    const view = floor === "7 6 5" ? "all" : floor !== "7" || active === "flip" && listening ? "lower" : "upper";
    if (root.dataset.currentFloor !== floor) root.dataset.currentFloor = floor;
    if (root.dataset.currentView !== view) root.dataset.currentView = view;
    if (pauseButton) {
      pauseButton.dataset.pressed = String(paused);
      pauseButton.removeAttribute("aria-pressed");
    }
    if (introStage) {
      if (paused || !inputAllowed) {
        introStage.dataset.dropPreview = "off";
        const preview = introStage.querySelector(".drop-preview");
        if (preview) preview.style.display = "none";
      } else delete introStage.dataset.dropPreview;
    }
    const available = { tap: tapAllowed, nudge: chairAllowed, "drag-chair": dragAllowed, "throw-ball": throwAllowed };
    for (const control of roomControls) {
      const blocked = !(available[control.dataset.action] ?? inputAllowed);
      control.setAttribute("aria-disabled", String(blocked));
      if (control.matches('[aria-hidden="true"]')) control.style.cursor = blocked ? "default" : "";
    }
    gestureStage?.setAttribute("aria-disabled", String(!dragAllowed && !throwAllowed));
    if (flipButton) {
      const seen = String(flipSeen);
      if (flip.dataset.flipSeen !== seen) flip.dataset.flipSeen = seen;
      if (flipButton.dataset.flipSeen !== seen) flipButton.dataset.flipSeen = seen;
      flipControls?.toggleAttribute("data-flip-again", flipSeen);
      if (nextCushion && nextCushion.hidden === flipSeen) nextCushion.hidden = !flipSeen;
      if (flipHint && flipHint.hidden !== (flipSeen || sensorHint)) flipHint.hidden = flipSeen || sensorHint;
      flipButton.setAttribute("aria-pressed", String(flipped));
      flipButton.setAttribute("aria-disabled", String(flipDisabled));
      setText(flipLabel, !explicitReturn && flipped ? "원래대로 돌리기"
        : flipSeen ? "한 번 더 뒤집기" : initialFlipLabel);
      if (explicitReturn) flipButton.hidden = listening;
    }
    if (explicitReturn) {
      explicitReturn.setAttribute("aria-disabled", String(flipDisabled));
      explicitReturn.hidden = !listening;
      if (listening && focused === flipButton) explicitReturn.focus({ preventScroll: true });
      if (!flipped && focused === explicitReturn) flipButton?.focus({ preventScroll: true });
    }
    if (listening) setText(perspective, FLOOR_COPY.down);
  }

  function announceFloor(active, listening, phase) {
    if (!floorLive) return;
    const focus = doc.activeElement;
    if (focus?.matches?.(":focus-visible")) {
      const bounds = focus.getBoundingClientRect();
      if (bounds.bottom > 0 && bounds.top < window.innerHeight) {
        const section = focus.closest("[data-scene]");
        active = Object.keys(scenes).find((key) => scenes[key].section === section) ?? active;
      }
    }
    if (active === "flip") {
      if (listening) setText(floorLive, FLOOR_COPY.down);
      else if (phase === "settle" && floorLive.textContent === FLOOR_COPY.down) setText(floorLive, FLOOR_COPY.up);
    } else if (active === "gesture" || active === "cushion" || active === "result") {
      setText(floorLive, FLOOR_COPY.intro);
    } else if (FLOOR_COPY[active]) setText(floorLive, FLOOR_COPY[active]);
  }

  function clearReactions() {
    for (const [node, timer] of reactionTimers) {
      clearTimeout(timer);
      node.hidden = true;
    }
    reactionTimers.clear();
  }

  function showReplaySummary(event) {
    const label = event?.sequence ? `${event.label ?? "쿵"} #${event.sequence} · ${event.index}` : "";
    const numbered = Boolean(label);
    if (listenCue && label) {
      if (replayLabel?.textContent !== label) {
        replayLabel ??= doc.createElement("span");
        replayLabel.className = "nowrap";
        replayLabel.textContent = label;
        listenCue.replaceChildren("같은 ", replayLabel, ", 듣는 자리만 다릅니다.");
      }
    } else if (replayLabel) {
      replayLabel = undefined;
      setText(listenCue, originalListenCue);
    }
    if (listenCue && listenCue.hidden === numbered) listenCue.hidden = !numbered;
    if (emptyCue && emptyCue.hidden !== numbered) emptyCue.hidden = numbered;
    // A fresh live node also lets an explicit replay announce an identical summary once.
    scenes.listen.feedback?.replaceChildren(...(label ? [`같은 ${label}, 듣는 자리만 다릅니다.`] : []));
    window.LandingArt?.setCurrent?.(event?.sequence ?? null);
  }

  function renderThump(key, event, width, staticFrame, highlight = true, marker) {
    const current = scenes[key];
    if (!current || !highlight) return;
    setText(current.reading, String(event.index));
    const chairCue = key === "flip" && event.cue === "s4-chair";
    const label = chairCue ? `${event.label} · ${event.index}` : event.sequence ? `${event.label ?? "쿵"} #${event.sequence} · ${event.index}`
      : key === "listen" ? `기준 낙하 · ${event.index}` : `쿵 지수 ${event.index}`;
    if (chairCue) setText(current.feedback, `${label}, 7층 천장에 닿았습니다.`);
    else if (key === "intro" || key === "gesture") {
      if (!event.followUp) setText(current.feedback, event.sequence === 1 ? `${label}, 6층 천장에 닿았습니다.` : label);
    } else if (key === "listen") {
      if (!event.sequence) setText(current.feedback, label);
    } else if (key !== "flip" && key !== "cushion") {
      setText(current.feedback, `${event.kind === "replay" ? "재생 · " : ""}${label}`);
    }
    if (current.reaction && event.index >= 80) {
      const node = current.reaction;
      node.style.animation = staticFrame ? "none" : "";
      node.hidden = false;
      clearTimeout(reactionTimers.get(node));
      reactionTimers.set(node, setTimeout(() => {
        node.hidden = true;
        reactionTimers.delete(node);
      }, 1_600));
    }
    if (key === "intro") for (const cue of introCues) cue.hidden = false;
    const art = window.LandingArt;
    if (chairCue) {
      if (chairExplanation) chairExplanation.hidden = false;
      if (marker) art?.record?.(marker);
    }
    if (art?.record && key === "relay" && !latestChair) {
      latestChair = { n: 0, x: event.point.x / width, value: event.index, slab: "6-5", label: "6층 의자" };
      art.record(latestChair);
    }
    if (art?.cursor && key === "listen") art.cursor("s2", event.point.x / width);
    else if (current.cursor) {
      current.cursor.style.setProperty("--record-x", `${100 * event.point.x / width}%`);
      current.cursor.dataset.recordSequence = String(event.sequence ?? "");
    }
    if (!art?.record && current.records && event.sequence) {
      for (const marker of current.records.children) {
        marker.toggleAttribute("data-current", Number(marker.dataset.sequence) === event.sequence);
      }
    }
  }

  function renderRecords(records, width) {
    const art = window.LandingArt;
    if (art?.record) {
      const startsOver = !records.length || latestRecords.some((sequence, i) => records[i]?.sequence !== sequence);
      if (startsOver) {
        latestRecords = [];
        art.clearRecords();
        if (records.length && latestChair) art.record(latestChair);
      }
      for (const event of records.slice(latestRecords.length)) {
        const n = event.sequence;
        const label = event.label ?? "쿵";
        art.record({ n, x: event.point.x / width, value: event.index, slab: "7-6", label, tagLabel: `${label} #${n}` });
      }
      latestRecords = records.map((event) => event.sequence);
      return;
    }
    for (const { records: strip } of [scenes.intro, scenes.listen]) {
      if (!strip) continue;
      strip.replaceChildren(...records.map((event) => {
        const item = doc.createElement("span");
        item.dataset.sequence = event.sequence;
        item.style.setProperty("--record-x", `${100 * event.point.x / width}%`);
        item.textContent = `#${event.sequence} · ${event.index}`;
        return item;
      }));
    }
  }

  function writeRecap(key, done, from, to, announcement) {
    const row = result?.querySelector(`[data-recap="${key}"]`);
    if (!row) return;
    const state = done ? "done" : "empty";
    if (row.dataset.state !== state) row.dataset.state = state;
    setText(row.querySelector("[data-recap-from]"), from);
    setText(row.querySelector("[data-recap-to]"), to);
    setText(row.querySelector("[data-recap-sr]"), announcement);
    return row;
  }

  function showSummary(upperEvent, peak, chairIndex, heardChairIndex) {
    const upper = upperEvent ? `${upperEvent.label ?? "쿵"} #${upperEvent.sequence} · ${peak}` : "";
    const listeningRow = result.querySelector('[data-recap="listen"]');
    const index = listeningRow ? heardChairIndex : chairIndex;
    const chair = Number.isFinite(index) ? `6층 의자 · ${index}` : "";
    const receiver = listeningRow ? "7층 천장" : "5층 천장";
    writeRecap("kung", Boolean(upper), upper || "7층 바닥", "6층 천장",
      upper ? `내 ${upper}, 6층 천장에 그대로 닿았습니다.` : "7층 바닥의 쿵은 6층 천장에 닿습니다.");
    writeRecap(listeningRow ? "listen" : "relay", Boolean(chair), chair || "6층 바닥", receiver,
      chair ? `${chair}, ${receiver}에 닿았습니다.`
        : `${listeningRow ? "건물을 뒤집으면, " : ""}6층 바닥의 소리는 ${receiver}에 닿습니다.`);
  }

  function showMatSummary(comparison) {
    const before = comparison && Math.round(comparison.before);
    const after = comparison && Math.round(comparison.after);
    const reduction = before > 0 ? Math.round(100 * (before - after) / before) : 0;
    const row = writeRecap("mat", Boolean(comparison), comparison ? `쿵 ${before}` : "쿵", comparison ? String(after) : "",
      comparison ? `같은 높이에서 맨바닥 쿵 ${before}, 매트 위 쿵 ${after}.${reduction > 0 ? ` 쿵 지수가 ${reduction}% 줄었습니다.` : ""}`
        : "아직 매트로 재 보지 않았어요.");
    const measure = row?.querySelector("[data-recap-reduction]");
    if (measure) {
      measure.hidden = reduction <= 0;
      setText(measure, reduction > 0 ? String(reduction) : "");
    }
  }

  function showRulerMark(peak, event) {
    if (!rulerMine) return;
    rulerMine.hidden = !(peak > 0);
    if (rulerMine.hidden) {
      delete rulerMine.dataset.rulerValue;
      delete rulerMine.dataset.rulerKind;
      rulerMine.style.removeProperty("--ruler-position");
      return;
    }
    const scrape = event?.label === "드르륵";
    rulerMine.dataset.rulerValue = String(peak);
    rulerMine.dataset.rulerKind = scrape ? "scrape" : "thump";
    rulerMine.style.setProperty("--ruler-position", `${Math.min(peak, 200) / 2}%`);
    setText(rulerLabel, scrape ? "내 최대 드르륵" : "내 최대 쿵");
    setText(rulerValue, String(peak));
  }

  function showResult({ title, copy, detail, peak, peakX, stats, matLine, matHeightSource, matLabelPrefix, badge, resultState = "empty",
      matEmpty = "none", upperEvent, chairIndex, heardChairIndex }, pageUrl) {
    if (!result) return;
    const focused = doc.activeElement;
    const moveFocus = resultState === "done" && result.dataset.resultState === "empty"
      && focused?.matches?.('[data-action="intro-revisit"]');
    if (result.dataset.resultState !== resultState) result.dataset.resultState = resultState;
    if (result.dataset.resultEmpty !== matEmpty) result.dataset.resultEmpty = matEmpty;
    if (moveFocus) result.querySelector('[data-action="save"]:not([hidden])')?.focus({ preventScroll: true });
    for (const [key, value] of Object.entries({ title, copy, detail })) {
      setText(result.querySelector(`[data-result-${key}]`), value);
    }
    const peakNode = result.querySelector("[data-result-peak]");
    if (peakNode && Number.isFinite(peakX)) peakNode.dataset.peakX = String(peakX);
    setText(peakNode, String(peak));
    showRulerMark(peak, upperEvent);
    setText(result.querySelector("[data-result-url]"), pageUrl ?? "");
    setText(result.querySelector("[data-result-label]"), "최대 쿵");
    const mat = result.querySelector("[data-result-mat]");
    const sensor = result.querySelector("[data-result-sensor]");
    if (mat) {
      mat.hidden = !matLine;
      if (matLine && matHeightSource) mat.dataset.matHeightSource = matHeightSource;
      else delete mat.dataset.matHeightSource;
      const matLabel = mat.querySelector("[data-result-mat-label]") ?? (mat.firstChild?.nodeType === 3 ? mat.firstChild : null);
      if (matLine && matLabelPrefix) setText(matLabel, matLabelPrefix);
    }
    if (sensor) sensor.hidden = !badge;
    if (matLine) for (const key of ["before", "after"]) {
      setText(result.querySelector(`[data-result-mat-${key}]`), String(Math.round(stats.matComparison[key])));
    }
    showSummary(upperEvent, peak, chairIndex, heardChairIndex);
    showMatSummary(stats?.matComparison);
  }

  function showShareUrl(url) {
    const field = result?.querySelector("[data-share-url]");
    if (!field) return;
    field.hidden = false;
    if (field.matches("input, textarea")) field.value = url;
    else setText(field, url);
  }

  function syncCardPose(pose) {
    const art = window.LandingArt;
    if (!art?.redrawCard || !pose || pose.length < 3) return;
    const [ball, chair, cup] = pose;
    const x = (point) => 60 + point.x * 760;
    art.cardLayout = {
      ball: [x(ball), 130 * (ball.y - 0.91), degrees(ball.angle)],
      chair: [x(chair), degrees(chair.angle)],
      cup: [x(cup), degrees(cup.angle)],
    };
    art.redrawCard();
  }

  function showCue(name) {
    if (!stage) return;
    if (stage.dataset.climaxPhase !== name) {
      const shown = name === "settle" ? "return" : name;
      for (const cue of cues) cue.hidden = cue.dataset.flipCue !== shown;
      if (chairExplanation) chairExplanation.hidden = true;
      if (shown !== "listen") {
        setText(scenes.flip.feedback, "");
        clearFlipReaction();
      }
      root.toggleAttribute("data-flip-returned", shown === "return");
      if (name === "settle") setText(perspective, "건물이 원래대로 돌아왔습니다.");
      stage.dataset.climaxPhase = name;
    }
  }

  function clearFlipReaction() {
    const node = scenes.flip.reaction;
    if (!node) return;
    clearTimeout(reactionTimers.get(node));
    reactionTimers.delete(node);
    node.hidden = true;
  }

  function resetStory() {
    clearReactions();
    latestChair = undefined;
    latestRecords = [];
    replayLabel = undefined;
    setText(listenCue, originalListenCue);
    window.LandingArt?.clearRecords?.();
    window.LandingArt?.cursor?.("s2", null);
    for (const cue of [...introCues, listenCue, emptyCue, gestureCue, soundHint, vibrationHint]) if (cue) cue.hidden = true;
    clearTimeout(vibrationTimer);
    for (const current of Object.values(scenes)) {
      setText(current.reading, "—");
      setText(current.feedback, "");
      if (current.reaction) current.reaction.hidden = true;
    }
    const start = scenes.intro.section;
    if (start) {
      try { window.history.replaceState(null, "", "#s0"); } catch { /* Local file previews can still scroll to the start. */ }
      start.scrollIntoView({ behavior: "instant" });
      const entry = start.querySelector("h1") ?? start;
      if (!entry.hasAttribute("tabindex")) entry.setAttribute("tabindex", "-1");
      entry.focus({ preventScroll: true });
    }
  }

  return { root, scenes, stage, pauseButton, actionFor, enabled, soundButton, soundStatus: doc.querySelector("[data-sound-status]"),
    showControls, announceFloor, renderThump, renderRecords, showReplaySummary, showResult, showShareUrl, syncCardPose, showCue,
    showGestureCue(visible) { if (gestureCue && gestureCue.hidden === visible) gestureCue.hidden = !visible; },
    showSoundHint(visible) { if (soundHint && soundHint.hidden === visible) soundHint.hidden = !visible; },
    showClimaxQuestion(visible) {
      if (!fixedQuestion || fixedQuestion.hidden === !visible) return;
      fixedQuestion.hidden = !visible;
      if (movingQuestion) movingQuestion.style.visibility = visible ? "hidden" : "";
    },
    vibrationHintVisible() { return Boolean(vibrationHint && !vibrationHint.hidden); },
    hideVibrationHint() {
      clearTimeout(vibrationTimer);
      if (vibrationHint) vibrationHint.hidden = true;
    },
    showVibrationHint(onClose) {
      if (!vibrationHint) return;
      vibrationHint.hidden = false;
      vibrationTimer = setTimeout(() => { vibrationHint.hidden = true; onClose?.(); }, 3000);
    },
    showSensor({ mode, offer, message, cue }) {
      if (flip && flip.dataset.sensorState !== mode) flip.dataset.sensorState = mode;
      if (sensorOffer) sensorOffer.hidden = !offer;
      if (sensorButton) sensorButton.setAttribute("aria-disabled", String(mode !== "idle" && mode !== "fallback"));
      setText(sensorStatus, message);
      for (const [n, node] of sensorCues) if (node) {
        node.setAttribute("role", "status");
        node.hidden = cue !== `S4-${n}`;
      }
    },
    createEnginePanel() {
      const footer = scenes.footer.section?.querySelector("footer");
      if (!footer) return;
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "btn btn-ghost btn-sm";
      button.textContent = "물리엔진 보기";
      button.dataset.action = "engine-view";
      button.setAttribute("aria-controls", "physics-engine-view");
      const canvas = doc.createElement("canvas");
      canvas.id = "physics-engine-view";
      canvas.style.maxWidth = "100%";
      canvas.style.height = "auto";
      canvas.hidden = true;
      const slot = footer.querySelector("[data-engine-slot], [data-engine-credit]");
      const credit = footer.querySelector("dl > dd");
      if (slot && credit && !credit.contains(slot)) credit.append(slot);
      (slot ?? credit ?? footer).append(button, canvas);
      return { button, canvas, destroy() { button.remove(); canvas.remove(); } };
    },
    clearReactions, clearFlipReaction, showMatSummary,
    showClimaxWipe: (visible) => root.toggleAttribute("data-climax-wipe", visible),
    showFlipInvite(visible) {
      if (flipInvite && flipInvite.hidden === visible) flipInvite.hidden = !visible;
    },
    focusIntro() {
      const drop = scenes.intro.section?.querySelector('button[data-action="drop"]:not([hidden], [aria-disabled="true"])');
      drop?.focus({ preventScroll: true });
      return Boolean(drop);
    },
    focusCushion() {
      const next = scenes.cushion.section?.querySelector('button[data-action^="mat-"]:not([hidden], [aria-disabled="true"])');
      const bounds = next?.getBoundingClientRect();
      if (!bounds?.height || bounds.top < 0 || bounds.bottom > window.innerHeight) return false;
      next.focus({ preventScroll: true });
      return doc.activeElement === next;
    },
    focusFlip() { flipButton?.focus({ preventScroll: true }); },
    fadeCopy() {
      for (const copy of stage?.querySelectorAll('[data-physics-body^="copy:"]') ?? []) {
        copy.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 240 });
      }
    },
    meetingEnded(ended) {
      if (!relay) return;
      if (ended) relay.dataset.meeting = "over";
      else delete relay.dataset.meeting;
    },
    waveLayer(key, event) {
      const scene = scenes[key];
      return scene?.section?.querySelector(`[data-wave-layer="${event.sourceRoom}-${event.receiverRoom}"]`)
        ?? scene?.section?.querySelector('[data-wave-layer=""]');
    },
    report: (key, message) => setText(scenes[key]?.feedback, message), resetStory };
}

export function bindPhysicsPose(hooks, building, cushionPlan = () => undefined) {
  const bodies = new Map();
  for (const [id, room] of building.rooms) {
    for (const [name, body] of Object.entries(room.props)) bodies.set(`${id}:${name}`, { body, room: id });
  }
  for (const [index, body] of building.copyBlocks.entries()) bodies.set(`copy:${index}`, { body, room: index === 0 ? 5 : 7 });
  bodies.set("6:mug", bodies.get("6:cup"));
  const bound = [...hooks.root.querySelectorAll("[data-physics-body]")]
    .filter((node) => !node.closest("[data-building-mirror]"))
    .map((node) => {
      const name = node.dataset.physicsBody;
      const bind = bodies.get(name);
      return bind && { node, stage: node.closest("[data-stage]"), ...bind, name, x0: bind.body.x, y0: bind.body.y, copy: name.startsWith("copy:") };
    }).filter(Boolean);
  const lamps = [...hooks.root.querySelectorAll("[data-physics-lamp]")]
    .map((node) => [node, building.rooms.get(Number(node.dataset.physicsLamp))])
    .filter(([, room]) => room?.lamp);

  return (alpha) => {
    for (const { node, stage, body, room, name, x0, y0, copy } of bound) {
      if (node.hidden) continue;
      const { x, y, angle } = body.pose(alpha);
      const rotation = degrees(angle).toFixed(2);
      if (node.namespaceURI === SVG) node.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rotation})`);
      else if (stage) {
        const geo = window.LandingArt?.geometry?.(stage.dataset.stage);
        if (!geo || !Number.isFinite(Number(node.dataset.cx)) || !Number.isFinite(Number(node.dataset.cy))) continue;
        if (!stage.hasAttribute("data-physics-live")) stage.setAttribute("data-physics-live", "");
        const [left, right] = geo.walls ?? [0, geo.w];
        const physicsRoom = building.rooms.get(room);
        const top = geo.ceilings?.[room] ?? 0;
        const bottom = geo.floors?.[room] ?? geo.h;
        const width = Number(node.dataset.w) || 0;
        const height = Number(node.dataset.h) || 0;
        const drop = stage.dataset.stage === "s5" && name === "7:ball" && geo.drop ? cushionPlan() : undefined;
        const cx = drop ? geo.drop.x * geo.w : Number(node.dataset.cx);
        const cy = drop ? geo.drop.y : Number(node.dataset.cy);
        const alignedX = cx + (x - (drop?.x ?? x0)) * (right - left) / building.width;
        const px = Math.max(left + width / 2, Math.min(right - width / 2, alignedX));
        const dy = (y - (drop?.y ?? y0)) * (bottom - top) / (physicsRoom.bottom - physicsRoom.top);
        const minY = copy ? height / 2 : top + height / 2;
        const maxY = (copy ? geo.h : bottom) - height / 2;
        const py = Math.max(minY, Math.min(maxY, cy + dy));
        node.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) rotate(${rotation}deg) translate(-50%, -50%)`;
      }
      else {
        node.style.left = `${100 * x / building.width}%`;
        node.style.top = `${100 * y / building.height}%`;
        node.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
      }
    }
    for (const [node, room] of lamps) {
      const position = room.lamp.pose(alpha);
      const anchor = building.lampWorld.linkAnchor(room.cable);
      const angle = Math.max(-PENDULUM_LIMIT, Math.min(PENDULUM_LIMIT,
        Math.atan2(anchor.x - position.x, position.y - anchor.y)));
      const stage = node.closest("[data-stage]");
      if (stage) {
        const fallen = stage.dataset.stage === "s4" && building.listening;
        node.classList.toggle("is-fallen", fallen);
        node.style.setProperty("--lamp-angle", `${fallen ? (room.id === 6 ? 1.45 : -1.45) : angle.toFixed(4)}rad`);
      } else node.style.rotate = `${degrees(angle).toFixed(2)}deg`;
    }
  };
}
