import { connectStage, createCardEffects, previewDropColumn, startBuildingAction } from "@landing/adapters.js";
import { createCushion } from "@landing/cushion.js";
import { bindPhysicsDebug } from "@landing/debug.js";
import { bindMatRoll, bindRoomGestures } from "@landing/gestures.js";
import { bindPhysicsPose } from "@landing/hooks.js";
import { createClimaxSensor } from "@landing/sensor.js";
import { bindSoundToggle } from "@landing/sound.js";

const PAUSE_KEY = "landingthon:motion-paused";
const ACTION_SECONDS = 1.6;
const ANGLE_EPSILON = 1e-6;
const FRAME_STALE_MS = 500;
const FAST_S2_MS = 300;
const RELAY_DWELL_MS = 2500;
const RELAY_NUDGE_PROGRESS = 0.8;
const REPLAY_BATCH_STEPS = 96;
const REPLAY_BATCH_MS = 8;
const CHAIR_CUE_SECONDS = 0.6;
const RECORD_WINDOW_MS = 15_000;
const RECORD_LIMIT = 12;
const READY_PROGRESS = 0.2;
const REVISIT_STABLE_FRAMES = 3;
const INPUT_TYPES = { drop: "dropBall", tap: "tap", nudge: "nudgeChair", "throw-ball": "throwBall", "drag-chair": "dragChair" };
const clamp = (value) => Math.max(0, Math.min(1, value));
const stationaryProgress = (progress) => progress < 0.55 ? 0 : progress <= 0.75 ? 0.65 : 0.95;
const duringTurn = (progress) => progress >= 0.25 && progress < 0.95;
const holding = (progress) => progress >= 0.55 && progress <= 0.75;

function readPause() {
  try { return localStorage.getItem(PAUSE_KEY) === "1"; } catch { return false; }
}

function viewport(scenes, motion) {
  const height = window.innerHeight;
  let active;
  const progress = {};
  for (const [name, { section, panel }] of Object.entries(scenes)) {
    if (!section || section.hidden) continue;
    const rect = section.getBoundingClientRect();
    if (rect.top <= height * 0.64 && rect.bottom > height * 0.16) active = name;
    const panelHeight = panel?.getBoundingClientRect().height ?? height;
    const travel = rect.height - panelHeight;
    const scrollMap = name === "flip" ? motion?.createClimaxScrollMap({ travel, panelHeight, viewportHeight: height }) : null;
    progress[name] = scrollMap?.progressAt(-rect.top)
      ?? (travel > height * 0.1 ? clamp(-rect.top / travel) : clamp((height * 0.6 - rect.top) / (height * 0.55)));
  }
  return { active, progress };
}

export function mountScenes(hooks, apis, signal) {
  const effects = createCardEffects(apis.card, apis.type, hooks);
  const storyReady = Boolean(apis.physics && apis.buildingMotion?.createClimaxTimeline);
  hooks.enabled(storyReady, Boolean(storyReady && apis.card && apis.type));
  if (!storyReady) return;

  const stage = connectStage(apis.buildingMotion, hooks, (cue) => {
    visibleCue = cue;
    hooks.showCue(cue);
    hooks.announceFloor?.(active, false, cue);
    scheduleMeasure();
  });
  const motion = apis.buildingMotion;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const touch = window.matchMedia("(pointer: coarse)");
  const debug = new URLSearchParams(window.location?.search).has("debug");
  const climaxEvents = hooks.scenes.flip.section ?? new EventTarget();
  const physicsEvents = new EventTarget();
  const enginePanel = apis.engineView && hooks.createEnginePanel?.();
  const sound = bindSoundToggle(hooks.soundButton, apis.audio?.createAudioEffects, { status: hooks.soundStatus, signal, changed: scheduleMeasure });
  let paused = readPause();
  let building, pose, debugOverlay, offReceive, offContact, offCancellation, climax;
  let cushion, engineView, returnPose, disconnectPhysics;
  let records, events, chairRecord, chairUsed, heardChairIndex, replays, flipMode, nextSequence;
  let drag, scuffStart, sensorSeen, sensorMode, sensorMessage, inspected, lastSensorUi, engineReading, lastReading, vibrationShown;
  let resultDirty, peakCard, s2ReplaySequence, s2AutoEligible, s2Finished, soundHintDismissed, s4Played;
  let chairCuePending = false, chairCueTimer;
  const contactPoses = new Map();
  const acceptedActions = new Map();
  let dragPeak, dragStep;
  let active, target = 0, returning, copyMoved;
  let visibleCue;
  let drawingFrame, measuringFrame, drawingSince, measuringSince;
  let reducedReplay, reducedReplayFrame, engineScrollFrame;
  let lastTime, accumulator = 0, motionTick = 0, lastControls;
  let renderedAlpha = 1;
  let actionUntil, reduceAnimation;
  let autoReplayRequested, upperReplay, listenEnteredAt, carryUpper;
  let upperReplayPeak;
  let relayEnteredAt, relayTimer, relayReachedProgress;
  let gestureHintTimer, gestureTried;
  let revisit, revisitFrame;
  let settling = false;
  let gesture;

  const sensor = createClimaxSensor(window, { onState: sensorChanged, onGravity: (gravity) => climax.setSensorGravity?.(gravity) });
  const art = window.LandingArt;
  const dropColumn = (x, height) => previewDropColumn(building, apis.physics.dropColumnForPreview, x, height);
  if (art && apis.physics.dropColumnForPreview) art.dropColumn = dropColumn;

  function newClimaxTimeline() {
    return motion.createClimaxTimeline({ eventTarget: climaxEvents, reduced: still(), holdButtonToListenEnd: true });
  }

  function resetState() {
    cancelReducedReplay();
    cancelChairCue();
    sensor.stop();
    gesture?.cancel();
    offReceive?.();
    offContact?.();
    offCancellation?.();
    disconnectPhysics?.();
    contactPoses.clear();
    acceptedActions.clear();
    dragPeak = dragStep = undefined;
    resetRelayDwell();
    clearGestureHint();
    gestureTried = false;
    debugOverlay?.destroy();
    inspected = engineView?.enabled ?? debug;
    engineView?.destroy();
    building = apis.physics.createBuilding({ dt: 1 / 120 });
    stage.reset(building.angle);
    renderedAlpha = 1;
    window.LandingArt?.physicsLayout?.(building);
    if (!still()) building.world.kick(building.rooms.get(7).props.ball, 24, 0);
    cushion = createCushion(hooks.scenes.cushion?.section, building, apis.physics, motion, () => peakCard?.entry.index ?? 0);
    pose = bindPhysicsPose(hooks, building, () => cushion?.plan);
    if (debug) debugOverlay = bindPhysicsDebug(hooks, building);
    if (enginePanel) {
      enginePanel.canvas.width = building.width;
      enginePanel.canvas.height = building.height;
      engineView = apis.engineView.createEngineView(enginePanel.canvas, building, { button: enginePanel.button, motion: reduced });
      engineView.setEnabled(inspected);
    }
    offReceive = building.onReceive(receive);
    offContact = building.onContact?.(captureContactPose);
    offCancellation = building.onInputCancelled(cancelInput);
    records = [];
    events = [];
    chairRecord = null;
    chairUsed = false;
    heardChairIndex = undefined;
    replays = 0;
    flipMode = null;
    drag = 0;
    scuffStart = undefined;
    sensorSeen = false;
    sensorMode = "idle";
    sensorMessage = "";
    lastSensorUi = lastReading = engineReading = undefined;
    nextSequence = 1;
    resultDirty = true;
    peakCard = null;
    s2ReplaySequence = undefined;
    s2AutoEligible = s2Finished = soundHintDismissed = false;
    s4Played = false;
    active = undefined;
    visibleCue = undefined;
    target = actionUntil = 0;
    autoReplayRequested = false;
    upperReplay = null;
    upperReplayPeak = undefined;
    carryUpper = false;
    cancelRevisit();
    lastControls = undefined;
    returning = undefined;
    copyMoved = false;
    climax = newClimaxTimeline();
    disconnectPhysics = motion.connectClimaxPhysics?.({ events: physicsEvents, state: climax.state }, building);
    returnPose = motion.createClimaxReturnPose?.(building);
    hooks.renderRecords(records, building.width);
  }

  function cardPose(alignFurniture = false) {
    const room = building.rooms.get(7);
    return ["ball", "chair", "cup"].map((name) => {
      let { x, y, angle } = room.props[name];
      if (alignFurniture && name !== "ball") {
        const wrapped = Math.atan2(Math.sin(angle), Math.cos(angle));
        const rightAngle = Math.PI / 2;
        angle = Math.max(-1, Math.min(1, Math.round(wrapped / rightAngle))) * rightAngle;
      }
      return { x: x / building.width, y: clamp((y - room.top) / (room.bottom - room.top)), angle };
    });
  }

  function captureContactPose({ sourceRoom, receiverRoom, body, action, actionId, time, scrape, slipSpeed, tangentImpulse }) {
    if (sourceRoom !== 7 || receiverRoom !== 6 || actionId === undefined || duringTurn(target) || building.sensor) return;
    if (action === "dragChair") {
      if (!scrape || slipSpeed < 6 || !tangentImpulse) return;
      if (dragPeak?.id !== actionId) dragPeak = undefined;
      if (dragStep?.time !== time) dragStep = { id: actionId, time, weight: 0, pose: cardPose() };
      dragStep.weight += Math.abs(tangentImpulse);
      if (!dragPeak || dragStep.weight > dragPeak.weight) dragPeak = dragStep;
      return;
    }
    if (action === "matDrop" || body !== building.rooms.get(7).props.ball || contactPoses.has(time)) return;
    // The receive event is delivered after its impact window closes, with the original peak time.
    const cutoff = time - (apis.physics.THUMP_WINDOW ?? 0.25) - building.dt;
    for (const previous of contactPoses.keys()) {
      if (previous >= cutoff) break;
      contactPoses.delete(previous);
    }
    contactPoses.set(time, cardPose());
  }

  function receive(event) {
    if (cushion?.receive(event)) {
      if (active === "cushion") feedback("cushion", event);
      resultDirty = true;
      return;
    }
    if (event.kind === "replay") {
      const key = event.track === "upper" ? "listen" : "flip";
      const highlight = key !== "listen" || event.sequence === upperReplayPeak?.sequence;
      let marker;
      if (key === "flip") {
        chairCuePending = false;
        marker = motion.climaxImpactMarker(event, building.width, active === "flip" && building.listening && visibleCue === "listen");
        if (!marker) return;
        heardChairIndex = marker.value;
        resultDirty = true;
      }
      if (event.track === "upper" && upperReplay) {
        upperReplay.shift();
        if (!upperReplay.length) {
          upperReplay = null;
          if (active === "listen") s2Finished = true;
        }
      }
      feedback(key, event, highlight, marker);
      return;
    }
    const { ball, chair: upperChair } = building.rooms.get(7).props;
    const scrape = event.action === "dragChair" && event.bodyId === upperChair.id;
    if (event.sourceRoom === 7 && event.receiverRoom === 6 && (event.bodyId === ball.id || scrape)
        && event.actionId !== undefined && !duringTurn(target) && !building.sensor) {
      const timeMs = event.peakTime * 1000;
      const input = acceptedActions.get(event.actionId);
      const entry = { ...event, timeMs, receivedAt: performance.now(), sequence: nextSequence++, followUp: input?.received };
      if (input) input.received = true;
      records.push(entry);
      // Synchronous reduced-motion steps can advance physics by seconds during one user action.
      records = records.filter((previous) => entry.receivedAt - previous.receivedAt <= RECORD_WINDOW_MS).slice(-RECORD_LIMIT);
      events.push({ index: entry.index, actionId: entry.actionId, acceptedAtMs: input?.atMs,
        timeMs: entry.inputTime * 1000, x: entry.point.x / building.width });
      if (scrape) {
        drag += event.dragDistance / building.width;
        if (scuffStart !== undefined) window.LandingArt?.scuff?.("s1", scuffStart, upperChair.x / building.width);
        scuffStart = undefined;
      }
      const peak = peakCard?.entry;
      if (!peak || entry.index > peak.index || (entry.index === peak.index && entry.force > peak.force)) {
        const captured = scrape ? (dragPeak?.time === event.peakTime ? dragPeak.pose : undefined) : contactPoses.get(entry.peakTime);
        peakCard = { entry, pose: captured };
      }
      actionUntil = Math.max(actionUntil, event.time + 0.45);
      resultDirty = true;
      hooks.renderRecords(replayTape(), building.width);
      feedback(scrape || event.action === "throwBall" ? "gesture" : "intro", entry);
    }
    const chair = building.rooms.get(6).props.chair;
    if (event.bodyId === chair.id && event.receiverRoom === 5 && chairUsed && !chairRecord && !duringTurn(target)) {
      chairRecord = event;
      resultDirty = true;
      feedback("relay", chairRecord);
    }
  }

  function acceptInput(actionId, acceptedAtMs) {
    acceptedActions.set(actionId, { atMs: acceptedAtMs, received: false });
  }

  function cancelInput(event) {
    acceptedActions.delete(event.actionId);
    cushion?.cancelInput(event);
    if (!building.hasPendingDrop) actionUntil = building.world.time;
  }

  function feedback(key, event, highlight = true, marker) {
    hooks.renderThump(key, event, building.width, still(), highlight, marker);
    stage.pulse(key, event, building, marker?.x);
    lastReading = event;
    if (!highlight || active !== key || document.hidden) return;
    const listening = building.listening;
    const room = key === "listen" ? 6 : key === "relay" ? 5 : key === "flip" && listening ? 7 : null;
    if (!paused) sound?.audio?.playImpact(event, { downstairs: room === event.receiverRoom });
    if (apis.haptics?.vibrateImpact(event.index, { scene: key, receiverRoom: event.receiverRoom, listening, reduced: reduced.matches, paused }, window.navigator)
        && !vibrationShown && key !== "flip") {
      vibrationShown = true;
      hooks.showVibrationHint?.(scheduleMeasure);
    }
  }

  function stopVibration() { apis.haptics?.stopImpactVibration(window.navigator); }

  function sensorChanged({ mode, reason }) {
    if (!climax || signal.aborted) return;
    sensorMode = mode;
    sensorMessage = reason === "try-button" ? "조금 더 거꾸로요. 아니면 버튼으로." :
      mode === "fallback" && reason !== "screen-rotated" ? "센서를 쓸 수 없어서, 버튼으로 뒤집을게요." : "";
    if (mode === "tilting" && !reason && !climax.startSensor()) {
      sensor.stop("inactive");
      return;
    }
    if (mode === "inverted" && climax.setSensorPhase("inverted")) {
      sensorSeen = true;
      flipMode = "sensor";
      resultDirty = true;
      climax.showSensorListeningCopy();
    } else if (mode === "returned") {
      climax.setSensorPhase("returned");
      climax.stopSensor();
    } else if (mode === "fallback" || mode === "idle") {
      if (reason !== "scroll" || climax.state.mode === "sensor") climax.stopSensor?.(reason);
      if (mode === "fallback" && reason !== "screen-rotated") hooks.focusFlip?.();
    }
    stage.record(building.angle, true);
    render();
    requestFrame();
  }

  function still() { return paused || reduced.matches; }

  function updateCard(force = false) {
    if (!resultDirty || returning || duringTurn(target) || building.sensor || (!force && active !== "result" && active !== "footer")) return;
    resultDirty = false;
    const matComparison = cushion?.comparison;
    const peak = peakCard?.entry;
    effects.show({ events, replays, flipMode: sensorSeen ? "sensor" : flipMode, drag,
      sessionPeak: peak?.index, peakX: peak && peak.point.x / building.width,
      upperEvent: peak && { label: peak.label, sequence: peak.sequence }, chairIndex: chairRecord?.index, heardChairIndex,
      matBefore: cushion?.bareIndex, matHeightSource: cushion?.heightSource, matComparison,
      matTest: Boolean(matComparison), matDrops: cushion?.matDrops ?? 0 }, peakCard?.pose ?? cardPose(true));
  }

  function inputAllowed(action = "drop") {
    if (duringTurn(target) || climax.state.playing || building.sensor || sensorMode === "requesting" || cushion?.pending) return false;
    return (action !== "nudge" || !chairUsed) && building.canInputFor(INPUT_TYPES[action] ?? action);
  }

  function render(alpha = renderedAlpha) {
    renderedAlpha = alpha;
    const sensorDriven = climax.state.mode === "sensor";
    const flipped = holding(target) || climax.state.playing === "invert";
    const { phase, zoom } = climax.state;
    const frame = stage.sample({ alpha, zoom, paused, reduced: reduced.matches, sensor: sensorDriven });
    const listening = building.listening && (sensorDriven || Math.abs(frame.angle - Math.PI) <= ANGLE_EPSILON);
    const cueAngle = sensorDriven && climax.state.sensorPhase === "returned" ? 2 * Math.PI : frame.angle;
    const cue = () => motion.visibleClimaxCue(phase, cueAngle, { listening, invertedOpacity: stage.invertedOpacity });
    const measuringInput = reduced.matches && (building.hasPendingDrop || building.chairDrag?.link);
    if (!measuringInput && (!reducedReplay || active !== "listen")) pose(frame.poseAlpha);
    debugOverlay?.render(frame.poseAlpha);
    const initialCue = cue();
    hooks.showCue(initialCue);
    stage.render({ building, tick: motionTick, frame, phase: initialCue, timelinePhase: phase, paused, reduced: reduced.matches,
      animate: reduceAnimation, sensor: sensorDriven, listening });
    reduceAnimation = false;
    const shownCue = cue();
    if (visibleCue === "listen" && shownCue !== "listen") stage.clearChairWave();
    if (shownCue !== "listen" || still()) hooks.showClimaxWipe?.(false);
    else if (visibleCue !== "listen") hooks.showClimaxWipe?.(true);
    visibleCue = shownCue;
    if (shownCue !== initialCue) hooks.showCue(shownCue);
    hooks.showClimaxQuestion?.(!sensorDriven && motion.showClimaxQuestion?.(shownCue, frame.width));
    const flipDisabled = Boolean(climax.state.playing || climax.state.queued || sensorMode === "requesting");
    const flipSeen = Boolean(flipMode && !flipped && !sensorDriven
      && (frame.angle <= ANGLE_EPSILON || frame.angle >= 2 * Math.PI - ANGLE_EPSILON));
    const offer = active === "flip" && (sensorHasOffer() || sensorDriven || sensorMode === "requesting");
    const controlState = { active, paused, inputAllowed: inputAllowed(), chairAllowed: inputAllowed("nudge"),
      tapAllowed: inputAllowed("tap"), dragAllowed: inputAllowed("drag-chair"), throwAllowed: inputAllowed("throw-ball"),
      listening, flipped, flipDisabled, flipSeen, sensorHint: offer && shownCue === "ready" };
    const controls = JSON.stringify(controlState);
    if (controls !== lastControls) {
      hooks.showControls(controlState);
      lastControls = controls;
    }
    hooks.announceFloor?.(active, listening, shownCue);
    const sensorUi = { mode: sensorMode, offer, message: active === "flip" ? sensorMessage : "", cue: active === "flip" ? climax.state.sensorCue : null };
    const sensorSignature = JSON.stringify(sensorUi);
    if (sensorSignature !== lastSensorUi) {
      hooks.showSensor?.(sensorUi);
      lastSensorUi = sensorSignature;
    }
    if (sound?.audio?.muted === false) soundHintDismissed = true;
    hooks.showSoundHint?.(motion.sceneHint(active, { replayFinished: s2Finished, replaying: Boolean(upperReplay),
      soundMuted: !soundHintDismissed, vibrationHint: hooks.vibrationHintVisible?.() }) === "sound");
    cushion?.render(!duringTurn(target) && building.canInputFor("matDrop"));
    if (engineView?.enabled && (active === "footer" || debug)) {
      engineView.setStill(still());
      engineView.render(alpha, undefined, engineReading !== lastReading);
      engineReading = lastReading;
    }
    hooks.showFlipInvite?.(active === "result" && !flipMode);
    if (revisit?.settled && revisit.scrollY === window.scrollY && active === revisit.scene
        && (active !== "intro" || Math.abs(hooks.scenes.intro.section.getBoundingClientRect().top) < 2)
        && revisit.focus?.()) cancelRevisit();
    if (listening || !building.listening) syncChairCue(listening);
    updateCard();
  }

  function cancelChairCue() {
    clearChairCueTimer();
    if (chairCuePending) {
      building.stopReplay();
      chairCuePending = s4Played = false;
    }
  }

  function clearChairCueTimer() {
    if (chairCueTimer === undefined) return;
    clearTimeout(chairCueTimer);
    chairCueTimer = undefined;
  }

  function syncChairCue(listening) {
    if (!listening || active !== "flip") {
      cancelChairCue();
      if (!listening) s4Played = false;
      return;
    }
    if (paused || document.hidden) return;
    if (!s4Played && building.replayChairCue?.(chairRecord ?? undefined)) chairCuePending = s4Played = true;
    if (!chairCuePending || !reduced.matches || chairCueTimer !== undefined) return;
    chairCueTimer = setTimeout(() => {
      chairCueTimer = undefined;
      if (paused || document.hidden || !reduced.matches || !chairCuePending || active !== "flip" || !building.listening) return;
      settle(CHAIR_CUE_SECONDS + building.dt);
      render();
    }, CHAIR_CUE_SECONDS * 1_000);
  }

  function restoreCopy() {
    if (!copyMoved || !building.resetCopyBlocks()) return;
    copyMoved = false;
    if (active === "flip" && !still()) hooks.fadeCopy?.();
  }

  function step() {
    if (!still() && climax.state.moving) climax.advance(building.dt);
    const previousAngle = building.angle;
    building.step();
    stage.record(building.angle);
    const previousComparison = cushion?.comparison;
    if (cushion?.step(building.dt)) {
      resultDirty = true;
      const comparison = cushion.comparison;
      if (comparison !== previousComparison) hooks.showMatSummary?.(comparison);
    }
    motionTick += 1;
    if (building.angle > ANGLE_EPSILON && building.angle < 2 * Math.PI - ANGLE_EPSILON) copyMoved = true;
    if (target <= 0.25 && building.angle <= ANGLE_EPSILON) restoreCopy();
    if (!settling && autoReplayRequested && (active === "listen" || carryUpper) && !building.hasPendingDrop && building.world.time >= actionUntil) {
      autoReplayRequested = false;
      if (needsUpperReplay()) playUpper();
      else if (upperReplay && !building.player) playUpper(false, true);
    }
    const listening = building.listening;
    const crossedHalfTurn = !still() && previousAngle < Math.PI && building.angle >= Math.PI;
    if (!flipMode && active === "flip" && !climax.state.skipped && (listening || crossedHalfTurn)) {
      flipMode = climax.state.holding || climax.state.playing === "invert" ? "button" : "scroll";
      resultDirty = true;
    }
    if (returning && building.angle >= Math.PI * 2 - ANGLE_EPSILON
        && (returnPose?.update(climax.state) || (!returnPose && (building.settleReturnedRooms?.() ?? (building.world.time >= returning))))) {
      returning = undefined;
      resultDirty = true;
      restoreCopy();
    }
  }

  function settle(seconds, chair = false) {
    if (settling) return;
    settling = true;
    try {
      if (chair) building.settleChairDrag(step);
      else for (let elapsed = 0; elapsed < seconds; elapsed += building.dt) step();
    } finally {
      settling = false;
      stage.record(building.angle, true);
      renderedAlpha = 1;
    }
  }

  function settleInput(action) {
    settle(ACTION_SECONDS, action === "drag-chair");
    actionUntil = building.world.time;
  }

  function applyProgress(progress, direct = true) {
    if (progress === target) return;
    const previous = target;
    target = progress;
    if (progress <= 0.75) returning = undefined;
    if (progress > 0.75 && previous <= 0.75) {
      returning = building.world.time + 1.55;
      returnPose = motion.createClimaxReturnPose?.(building);
    }
    if (direct) building.setProgress(progress);
  }

  function stationaryTurn(progress, animate) {
    const next = stationaryProgress(progress);
    if (next !== target || Math.abs(building.angle - apis.physics.angleForProgress(next)) > 1e-6) {
      applyProgress(next);
      settle(next === 0.65 ? 2.7 : 3.25);
      reduceAnimation = animate;
    }
  }

  function shouldAdvance() {
    const visibleScene = active && active !== "footer";
    const finishingReturn = returning && target >= 0.95;
    const simulating = cushion?.pending || building.hasPendingDrop || building.world.time < actionUntil || gesture?.dragging || finishingReturn;
    return !paused && !document.hidden && (simulating
      || !reduced.matches && (visibleScene || carryUpper && (autoReplayRequested || upperReplay && building.player)));
  }

  function requestFrame() {
    if (!shouldAdvance()) return;
    const now = performance.now();
    if (drawingFrame && now - drawingSince > FRAME_STALE_MS) stopFrames();
    if (!drawingFrame) {
      lastTime ??= now;
      drawingSince = now;
      drawingFrame = requestAnimationFrame(frame);
    }
  }

  function frame(now) {
    drawingFrame = 0;
    const elapsed = lastTime === undefined ? 0 : Math.max(0, Math.min(0.08, (now - lastTime) / 1000));
    lastTime = now;
    accumulator += elapsed;
    for (let count = 0; accumulator >= building.dt - 1e-9 && count < 8; count += 1) {
      step();
      accumulator = Math.max(0, accumulator - building.dt);
    }
    autoNudge(now);
    render(clamp(accumulator / building.dt));
    if (shouldAdvance()) requestFrame();
    else stopFrames();
  }

  function stopFrames() {
    cancelAnimationFrame(drawingFrame);
    drawingFrame = 0;
    lastTime = undefined;
    accumulator = 0;
  }

  function replayTape() {
    const peak = peakCard?.entry;
    if (!peak || records.includes(peak)) return records;
    return [peak, ...records.slice(-(RECORD_LIMIT - 1))];
  }

  function needsUpperReplay() {
    return s2ReplaySequence === undefined || nextSequence - 1 > s2ReplaySequence;
  }

  function cancelReducedReplay() {
    cancelAnimationFrame(reducedReplayFrame);
    reducedReplay = reducedReplayFrame = undefined;
  }

  function scheduleReducedReplay() {
    if (reducedReplay && !reducedReplayFrame && !document.hidden && !paused) {
      reducedReplayFrame = requestAnimationFrame(runReducedReplay);
    }
  }

  function runReducedReplay() {
    reducedReplayFrame = undefined;
    if (!reducedReplay || paused || document.hidden) return;
    if (!reduced.matches || (active !== "listen" && !carryUpper)) {
      cancelReducedReplay();
      return;
    }
    const task = reducedReplay;
    if (building.player !== task.player) {
      // The live replay can be stopped or replaced by a scene transition.
      cancelReducedReplay();
      return;
    }
    const deadline = performance.now() + REPLAY_BATCH_MS;
    settling = true;
    try {
      for (let count = 0; count < REPLAY_BATCH_STEPS && task.remaining > 0; count += 1) {
        step();
        task.remaining -= 1;
        if (performance.now() >= deadline) break;
      }
    } finally {
      settling = false;
    }
    task.player = building.player;
    if (task.remaining > 0) scheduleReducedReplay();
    else {
      reducedReplay = undefined;
      render();
    }
  }

  function playUpper(explicit = false, resume = false) {
    if (duringTurn(target)) return;
    const tape = resume ? upperReplay?.filter(Boolean) : replayTape();
    if (!tape || !building.replay("upper", tape)) return;
    autoReplayRequested = false;
    upperReplay = tape.length ? [...tape] : [null];
    if (explicit) replays += 1;
    if (!resume) {
      s2ReplaySequence = tape.at(-1)?.sequence ?? 0;
      upperReplayPeak = tape.reduce((peak, event) => !peak || event.index > peak.index ? event : peak, undefined);
      hooks.showReplaySummary?.(upperReplayPeak);
    }
    s2AutoEligible = false;
    resultDirty = true;
    cancelReducedReplay();
    const seconds = Math.max(1, tape.length * 1.2);
    if (reduced.matches && !paused) {
      reducedReplay = { player: building.player, remaining: Math.ceil(seconds / building.dt) };
      scheduleReducedReplay();
    } else if (paused) settle(seconds);
  }

  function act(action, position, height) {
    if (!inputAllowed(action)) return;
    const room = building.rooms.get(7);
    const x = position === undefined ? undefined : position * building.width;
    const y = height === undefined ? undefined : room.top + height * (room.bottom - room.top);
    const actionId = building.nextActionId;
    const acceptedAtMs = performance.now();
    const started = action === "drag-chair" ? building.input({ type: "dragChair", distance: -55 })
      : action === "throw-ball" ? building.input({ type: "throwBall", x: building.width * 0.42, y: room.top + 36, vx: -290, vy: 285 })
      : startBuildingAction(building, action, x, y);
    if (!started) return;
    if (action === "drag-chair" || action === "throw-ball") dismissGestureHint();
    if (action !== "nudge") acceptInput(actionId, acceptedAtMs);
    if (action === "drag-chair") rememberChair();
    actionUntil = building.world.time + ACTION_SECONDS;
    if (action === "nudge") {
      chairUsed = true;
      resetRelayDwell();
    }
    if (paused || (reduced.matches && !building.hasPendingDrop && (action === "nudge" || action === "drag-chair"))) settleInput(action);
    else requestFrame();
  }

  function rememberChair() { scuffStart = building.rooms.get(7).props.chair.x / building.width; }

  function sensorHasOffer() {
    return climax.state.phase === "ready" && !climax.state.queued && !climax.state.playing && sensor.offer();
  }

  function resetRelayDwell() {
    clearTimeout(relayTimer);
    relayTimer = relayEnteredAt = undefined;
    relayReachedProgress = false;
  }

  function clearGestureHint() {
    clearTimeout(gestureHintTimer);
    gestureHintTimer = undefined;
    hooks.showGestureCue?.(false);
  }

  function dismissGestureHint() {
    gestureTried = true;
    clearGestureHint();
  }

  function autoNudge(now, measured) {
    if (relayEnteredAt === undefined || paused || document.hidden) return;
    if (!relayReachedProgress && now - relayEnteredAt < RELAY_DWELL_MS) return;
    if (!inputAllowed("nudge") || (measured ?? viewport(hooks.scenes)).active !== "relay") return;
    act("nudge");
  }

  function measure() {
    measuringFrame = 0;
    const before = active;
    const next = viewport(hooks.scenes, motion);
    active = next.active;
    const scrubbing = next.progress.flip ?? 0;
    if (active !== before) {
      if (before === "flip") {
        cancelChairCue();
        stage.clearChairWave();
        hooks.clearFlipReaction?.();
      }
      if (before === "gesture") gesture?.cancel();
      if (active === "gesture") gestureTried = false;
      if (active === "flip") hooks.hideVibrationHint?.();
      if (before === "listen" || before === "relay" || before === "flip") stopVibration();
      if (active === "listen") {
        listenEnteredAt = performance.now();
        carryUpper = false;
        s2AutoEligible = true;
      } else if (before === "listen") {
        carryUpper = next.progress.listen === 1 && performance.now() - listenEnteredAt <= FAST_S2_MS;
        if (!carryUpper && upperReplay) building.stopReplay();
      }
      if (active === "intro" || active === "gesture") {
        if (carryUpper && upperReplay) building.stopReplay();
        carryUpper = false;
        autoReplayRequested = false;
      }
      if (active !== "listen" && !carryUpper) cancelReducedReplay();
    }
    const buttonPlaying = Boolean(climax.state.playing);
    if (!buttonPlaying && ["intro", "gesture", "listen", "relay"].includes(active) && scrubbing === 0
        && (climax.state.progress > READY_PROGRESS || building.angle > ANGLE_EPSILON)) {
      // Restore input immediately when a jump takes the rotating stage offscreen.
      climax.scrub(0);
      climax.advance(4);
      stationaryTurn(0, false);
    } else if (!buttonPlaying && (active === "flip" || before === "flip") && !paused) {
      climax.scrub(scrubbing);
      if (reduced.matches) {
        climax.advance(4);
        stationaryTurn(climax.state.progress, active === "flip");
      }
    }
    if ((active === "cushion" || active === "result" || active === "footer") && before !== active && !paused && target < 0.95 && scrubbing >= 0.95) {
      climax.skip();
      stationaryTurn(0.95, false);
    }
    sensor.sync({ active: active === "flip", progress: scrubbing, paused, reduced: reduced.matches });
    cushion?.sync(active === "cushion", still());
    if (active !== "gesture" || document.hidden || gestureTried || !touch.matches) clearGestureHint();
    else if (gestureHintTimer === undefined) {
      gestureHintTimer = setTimeout(() => {
        hooks.showGestureCue?.(motion.sceneHint(active, { touch: touch.matches, idleMs: motion.gestureHintDelayMs,
          gestureUsed: gestureTried }) === "gesture");
      }, motion.gestureHintDelayMs);
    }
    if (active === "listen" && next.progress.listen >= 0.2 && !paused) {
      if (s2AutoEligible) {
        s2AutoEligible = false;
        if (needsUpperReplay() || building.hasPendingDrop) {
          if (building.hasPendingDrop || building.world.time < actionUntil) autoReplayRequested = true;
          else playUpper();
        }
      }
      if (!autoReplayRequested && upperReplay && !building.player) playUpper(false, true);
    }
    if (active === "relay" && !paused) {
      hooks.meetingEnded?.(next.progress.relay >= 0.3);
    }
    if (active !== "relay" || paused || document.hidden || chairUsed) resetRelayDwell();
    else {
      const now = performance.now();
      relayReachedProgress ||= next.progress.relay >= RELAY_NUDGE_PROGRESS;
      if (relayEnteredAt === undefined) {
        relayEnteredAt = now;
        relayTimer = setTimeout(() => {
          autoNudge(performance.now());
          render();
        }, RELAY_DWELL_MS);
      }
      autoNudge(now, next);
    }
    if (!shouldAdvance()) stopFrames();
    render();
    requestFrame();
    scheduleReducedReplay();
  }

  function scheduleMeasure() {
    const now = performance.now();
    if (measuringFrame && now - measuringSince <= FRAME_STALE_MS) return;
    if (measuringFrame) cancelAnimationFrame(measuringFrame);
    measuringSince = now;
    measuringFrame = requestAnimationFrame(measure);
  }

  function positionClimax() {
    const { section, panel } = hooks.scenes.flip;
    if (!section || climax.state.playing || climax.state.queued) return;
    const bounds = section.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const panelHeight = panel?.getBoundingClientRect().height ?? viewportHeight;
    const travel = bounds.height - panelHeight;
    const scrollMap = motion.createClimaxScrollMap({ travel, panelHeight, viewportHeight });
    const offset = scrollMap?.offsetAt(READY_PROGRESS) ?? Math.max(0, travel) * READY_PROGRESS;
    window.scrollTo({ top: window.scrollY + bounds.top + offset, behavior: "instant" });
    active = "flip";
    climax.scrub(READY_PROGRESS);
    scheduleMeasure();
  }

  function flipByButton(forceReturn = false) {
    if (climax.state.playing || climax.state.queued) return;
    if (sensorMode !== "idle") sensor.stop();
    if (!forceReturn && climax.state.phase === "settle") {
      climax = newClimaxTimeline();
      stationaryTurn(0, false);
    }
    const action = forceReturn ? "return" : climax.state.button ?? "invert";
    if (!forceReturn && climax.state.phase === "zoom") positionClimax();
    if (!climax.activate(action)) return;
    if (still()) {
      climax.advance(5);
      stationaryTurn(climax.state.progress, !paused);
    }
  }

  function cancelRevisit() {
    cancelAnimationFrame(revisitFrame);
    revisit = revisitFrame = undefined;
  }

  function finishRevisitScroll() {
    if (!revisit) return;
    cancelAnimationFrame(revisitFrame);
    revisitFrame = undefined;
    revisit.scrollY = window.scrollY;
    revisit.settled = true;
    scheduleMeasure();
  }

  function checkRevisitPosition() {
    revisitFrame = undefined;
    if (!revisit) return;
    const scrollY = window.scrollY;
    if (revisit.scrollY !== scrollY) {
      revisit.scrollY = scrollY;
      revisit.stableFrames = 0;
    }
    if (++revisit.stableFrames >= REVISIT_STABLE_FRAMES) finishRevisitScroll();
    else scheduleRevisitCheck();
  }

  function scheduleRevisitCheck() {
    if (!revisitFrame) revisitFrame = requestAnimationFrame(checkRevisitPosition);
  }

  function pageScrolled() {
    if (revisit && revisit.scrollY !== window.scrollY) {
      revisit.settled = false;
      scheduleRevisitCheck();
    }
    scheduleMeasure();
  }

  function revisitScene(scene, focus) {
    const section = hooks.scenes[scene].section;
    if (!section) return;
    cancelRevisit();
    revisit = { scene, focus, scrollY: window.scrollY, stableFrames: 0, settled: false };
    window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top, behavior: still() ? "instant" : "smooth" });
    scheduleMeasure();
    scheduleRevisitCheck();
  }

  async function activate(event) {
    const hit = hooks.actionFor(event.target, event);
    if (!hit || hit.control.hidden || hit.control.getAttribute?.("aria-disabled") === "true") return;
    const { action, position, height } = hit;
    if (["tap", "drop", "nudge", "drag-chair", "throw-ball"].includes(action)) act(action, position, height);
    else if (action === "sensor-enable" && sensorHasOffer()) void sensor.start();
    else if (action === "sensor-use-button") {
      sensor.stop();
      hooks.focusFlip?.();
    } else if (action.startsWith("mat-")) {
      if (cushion?.act(action) && still()) settle(3);
    }
    else if (action === "replay") playUpper(true);
    else if (action === "flip" || action === "reset-flip") flipByButton(action === "reset-flip");
    else if (action === "flip-revisit" && !flipMode) {
      event.preventDefault();
      positionClimax();
      hooks.focusFlip?.();
      flipByButton();
    }
    else if (action === "intro-revisit") {
      event.preventDefault();
      revisitScene("intro", hooks.focusIntro);
    }
    else if (cushion && (action === "s4-next" || action === "cushion-revisit" && !cushion.comparison)) {
      event.preventDefault();
      revisitScene("cushion", hooks.focusCushion);
    }
    else if (action === "restart") {
      event.preventDefault();
      stopFrames();
      resetState();
      hooks.resetStory();
      hooks.meetingEnded?.(false);
      stage.destroy();
      updateCard(true);
      scheduleMeasure();
    } else if (action === "save" || action === "share") {
      event.preventDefault();
      updateCard(true);
      hooks.report(hit.owner === "footer" ? "footer" : "result", await effects[action]());
    }
    render();
    requestFrame();
  }

  hooks.root.addEventListener("click", (event) => {
    activate(event).catch((error) => {
      console.error("장면 조작 오류", error);
      hooks.report("result", "동작을 마치지 못했습니다. 다시 시도해 주세요.");
    });
  }, { signal });
  hooks.root.addEventListener("focusin", ({ target: node }) => {
    if (node.matches('[data-action="flip"]:focus-visible') && !building.sensor && flipMode !== "sensor") positionClimax();
    scheduleMeasure();
  }, { signal });
  hooks.pauseButton?.addEventListener("click", () => {
    paused = !paused;
    climax.setReduced(still());
    if (paused) {
      stopFrames();
      resetRelayDwell();
      stopVibration();
      clearChairCueTimer();
      cancelRevisit();
      gesture?.cancel();
      sensor.stop("inactive");
    }
    try { localStorage.setItem(PAUSE_KEY, paused ? "1" : "0"); } catch { /* The current page still retains the setting. */ }
    render();
    scheduleMeasure();
  }, { signal });
  reduced.addEventListener("change", () => {
    if (!reduced.matches) {
      cancelReducedReplay();
      clearChairCueTimer();
    }
    climax.setReduced(still());
    cushion?.sync(active === "cushion", still());
    if (still()) {
      stopFrames();
      stopVibration();
      sensor.stop("inactive");
      if (cushion?.pending && !paused) settle(3);
      if (active === "flip") {
        climax.advance(4);
        stationaryTurn(climax.state.progress, true);
      }
    }
    scheduleMeasure();
  }, { signal });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopFrames();
      resetRelayDwell();
      stopVibration();
      clearChairCueTimer();
      cancelRevisit();
      gesture?.cancel();
      clearGestureHint();
    }
    else scheduleMeasure();
  }, { signal });
  climaxEvents.addEventListener("climaxchange", ({ detail }) => {
    if (!still() || building.sensor) {
      applyProgress(detail.progress, !disconnectPhysics);
      physicsEvents.dispatchEvent(new CustomEvent("climaxchange", { detail }));
    }
  }, { signal });
  hooks.root.addEventListener("lt:art-layout", scheduleMeasure, { signal });
  const { section, panel } = hooks.scenes.flip;
  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleMeasure) : null;
  resizeObserver?.observe(document.documentElement);
  if (section) resizeObserver?.observe(section);
  if (panel) resizeObserver?.observe(panel);
  for (const event of ["resize", "pageshow"]) window.addEventListener(event, scheduleMeasure, { passive: true, signal });
  window.addEventListener("scroll", pageScrolled, { passive: true, signal });
  document.addEventListener("scrollend", finishRevisitScroll, { signal });
  // A new gesture or key press owns the focus instead of a previously requested scroll.
  for (const event of ["pointerdown", "wheel", "keydown"]) window.addEventListener(event, cancelRevisit, { passive: true, signal });
  // Wait for both click listeners and the canvas visibility change before scrolling.
  enginePanel?.button.addEventListener("click", () => {
    cancelAnimationFrame(engineScrollFrame);
    engineScrollFrame = requestAnimationFrame(() => {
      engineScrollFrame = undefined;
      if (!signal.aborted && engineView?.enabled) enginePanel.canvas.scrollIntoView?.({ block: "nearest", behavior: still() ? "instant" : "smooth" });
    });
  }, { signal });
  signal.addEventListener("abort", () => {
    stopFrames();
    cancelAnimationFrame(measuringFrame);
    cancelAnimationFrame(engineScrollFrame);
    cancelReducedReplay();
    cancelChairCue();
    cancelRevisit();
    offReceive?.();
    offContact?.();
    offCancellation?.();
    disconnectPhysics?.();
    sensor.stop("inactive");
    stopVibration();
    engineView?.destroy();
    enginePanel?.destroy();
    resetRelayDwell();
    clearGestureHint();
    hooks.hideVibrationHint?.();
    hooks.clearReactions?.();
    hooks.showClimaxWipe?.(false);
    if (art?.dropColumn === dropColumn) delete art.dropColumn;
    debugOverlay?.destroy();
    resizeObserver?.disconnect();
    stage.destroy();
  }, { once: true });

  resetState();
  gesture = bindRoomGestures(hooks.scenes.gesture?.section?.querySelector('[data-stage="s1"]'), {
    building: () => building, allowed: (action) => active === "gesture" && inputAllowed(action), signal,
    chairStarted: rememberChair, started: dismissGestureHint, accepted: acceptInput,
    advanced() {
      if (signal.aborted) return;
      actionUntil = building.world.time + ACTION_SECONDS;
      if (paused) { settleInput(); render(); }
      else requestFrame();
    },
  });
  bindMatRoll(hooks.scenes.cushion?.section, () => { if (cushion?.act("mat-lay")) render(); }, signal);
  if (debug) {
    const diagnostics = Object.freeze({
      dump() {
        const { time, gx, gy } = building.world;
        const bodies7 = Object.fromEntries(Object.entries(building.rooms.get(7).props).map(([name, body]) => [name, {
          x: body.x, y: body.y, vx: body.vx, vy: body.vy, sleeping: body.sleeping, static: body.inv === 0,
        }]));
        const { phase } = climax.state;
        return {
          world: { time, gx, gy }, bodies7, records: replayTape().length,
          scene: active ?? null, framePending: Boolean(drawingFrame), paused, reduced: reduced.matches,
          actionUntil, pendingDrop: building.hasPendingDrop, inputAllowed: inputAllowed(),
          mat: { test: Boolean(cushion?.comparison), drops: cushion?.matDrops ?? 0 },
          flip: { angleDegrees: building.angle * 180 / Math.PI, phase, mode: flipMode, cue: hooks.stage?.dataset.climaxPhase },
        };
      },
    });
    window.__lt = diagnostics;
    signal.addEventListener("abort", () => {
      if (window.__lt === diagnostics) delete window.__lt;
    }, { once: true });
  }
  updateCard(true);
  measure();
}
