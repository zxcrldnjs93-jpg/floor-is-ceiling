import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

for (const mode of ["dist", "dist-single"]) {
  const directory = join(process.argv[2] ?? "site", mode);
  const html = readFileSync(join(directory, "index.html"), "utf8");
  const imports = JSON.parse(html.match(/<script type="importmap">([^\n]+)<\/script>/)[1]).imports;
  let time = 0, nextFrame = 0;
  const frames = new Map();
  const timers = new Map();
  function setTimer(callback, delay) {
    timers.set(++nextFrame, { callback, delay, at: time + delay });
    return nextFrame;
  }
  let layoutObserver;
  class ResizeObserver {
    targets = [];
    constructor(callback) { this.callback = callback; layoutObserver = this; }
    observe(target) { this.targets.push(target); }
    disconnect() { this.disconnected = true; }
  }
  function runFrames(count, milliseconds = 1000 / 60) {
    for (let frame = 0; frame < count; frame += 1) {
      time += milliseconds;
      for (const [id, callback] of [...frames]) {
        if (frames.delete(id)) callback(time);
      }
      for (const [id, { callback, at }] of [...timers]) if (time >= at && timers.delete(id)) callback();
    }
  }

  class Element extends EventTarget {
    dataset = {};
    style = {
      setProperty: (name, value) => this.style[name] = value,
      removeProperty: (name) => delete this.style[name],
      getPropertyValue: (name) => this.style[name] ?? "",
      getPropertyPriority: () => "",
    };
    attrs = new Map();
    classList = { add() {}, remove() {}, toggle() {} };
    children = [];
    isConnected = true;
    querySelectorAll() { return []; }
    querySelector() { return null; }
    cloneNode() { return new Element(); }
    after(element) { this.mirror = element; }
    append(...elements) { this.children.push(...elements); }
    remove() { this.removed = true; }
    setAttribute(name, value) { this.attrs.set(name, value); }
    getAttribute(name) { return this.attrs.get(name); }
    removeAttribute(name) { this.attrs.delete(name); }
    toggleAttribute(name, enabled) { if (enabled) this.setAttribute(name, ""); else this.removeAttribute(name); }
    getBoundingClientRect() {
      return { top: this.top - window.scrollY, height: this.height, bottom: this.top - window.scrollY + this.height };
    }
  }

  const window = new EventTarget();
  window.innerHeight = 800;
  window.innerWidth = 1280;
  window.scrollY = 0;
  window.scrollTo = ({ top }) => { window.scrollY = top; };
  window.location = { search: mode === "dist" ? "?debug" : "", protocol: "https:", origin: "https://qa.invalid", pathname: "/landingthon/" };
  window.setTimeout = setTimer;
  window.clearTimeout = (id) => timers.delete(id);
  window.isSecureContext = true;
  window.self = window.top = window;
  window.screen = { orientation: Object.assign(new EventTarget(), { angle: 0 }) };
  const vibration = [];
  window.navigator = { userAgent: "Android Chrome", maxTouchPoints: 0, vibrate(pattern) { vibration.push(pattern); return true; } };
  const preference = new EventTarget();
  preference.matches = false;
  window.matchMedia = (query) => {
    if (query === "(pointer: coarse)") return { get matches() { return window.navigator.maxTouchPoints > 0; } };
    if (query === "(hover: hover) and (pointer: fine)") return { get matches() { return window.navigator.maxTouchPoints === 0; } };
    return preference;
  };
  let drawnCard, lastShare, inviteVisible, introFocuses = 0, fades = 0;
  let sensorUi, soundHint, vibrationHints = 0, soundStarts = 0;
  const suppliedSounds = [], handedPoses = [];
  const layoutCalls = [];
  const geo = { w: 1877, h: 961, floors: { 7: 650 }, ceilings: { 7: 200 } };
  window.LandingArt = {
    async drawCard(_canvas, data) { drawnCard = data; },
    geometry(scene) {
      if (scene === "s3") return { ...geo, floors: { 6: 460, 5: 910 }, ceilings: { 6: 100, 5: 500 } };
      if (scene === "s4") return { ...geo, floors: { 7: 280, 6: 560, 5: 840 }, ceilings: { 7: 30, 6: 310, 5: 590 } };
      if (scene === "s5") return { ...geo, drop: { x: 0.5, y: 425 } };
      return geo;
    },
    physicsLayout(engine) {
      const { ball, cup } = engine.rooms.get(7).props;
      layoutCalls.push({ engine, ballVx: ball.vx, cupX: cup.x });
    },
  };
  const document = new EventTarget();
  window.document = document;
  document.documentElement = new Element();
  const demoUrl = "https://qa.invalid/landingthon/";
  document.querySelector = (selector) => selector === 'link[rel="canonical"]' && mode === "dist" ? { href: demoUrl } : null;
  document.createElement = () => new Element();
  document.createElementNS = (_namespace, tagName) => Object.assign(new Element(), { tagName });
  document.hidden = false;
  const storage = new Map();
  const recordsByScene = [];
  const cuePhases = [];
  const figures = [];
  const replaySummaries = [];
  const blueprint = {
    intro: [0, 1000], listen: [1000, 1280], relay: [2280, 1120], flip: [3400, 2400], result: [5800, 800],
    footer: [6600, 520], gesture: [7500, 900], cushion: [9000, 1400],
  };
  const scenes = Object.fromEntries(Object.entries(blueprint).map(([id, [top, height]]) => {
    const section = new Element();
    section.top = top;
    section.height = height;
    const panel = new Element();
    panel.parentElement = section;
    panel.top = top;
    panel.height = 800;
    return [id, { section, panel }];
  }));
  const stage = new Element(), root = new Element(), pause = new Element();
  const gestureStage = new Element(), gestureChair = new Element(), gestureBall = new Element(), holdRing = new Element();
  gestureChair.dataset.physicsGesture = "drag-chair";
  gestureBall.dataset.physicsGesture = "throw-ball";
  gestureChair.closest = () => gestureChair;
  gestureBall.closest = () => gestureBall;
  gestureStage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 480, height: 460 });
  gestureStage.querySelector = (selector) => ({ '[data-grab-ring]': holdRing, '[data-physics-gesture="throw-ball"]': gestureBall })[selector];
  scenes.gesture.section.querySelector = () => gestureStage;
  const sound = new Element(), mat = new Element(), matResult = new Element(), cushionStage = new Element();
  mat.hidden = matResult.hidden = true;
  const matControls = ["mat-before", "mat-lay", "mat-after"].map((action) => Object.assign(new Element(), { dataset: { action } }));
  const matBefore = new Element(), matAfter = new Element(), matReduction = new Element(), lampCue = new Element();
  const matFeedback = new Element();
  const ownHeightCue = new Element(), referenceHeightCue = new Element(), cushionFocus = [];
  lampCue.hidden = ownHeightCue.hidden = referenceHeightCue.hidden = true;
  scenes.cushion.section.querySelectorAll = () => matControls;
  scenes.cushion.section.querySelector = (selector) => ({
    '[data-stage="s5"]': cushionStage, '[data-mat]': mat, '[data-mat-result]': matResult,
    '[data-impact-before]': matBefore, '[data-impact-after]': matAfter,
    '[data-impact-reduction]': matReduction, '[data-cue="s5-05"]': lampCue,
    '[data-cue="s5-08"]': ownHeightCue, '[data-cue="s5-08b"]': referenceHeightCue,
    '[data-fx="mat-feedback"]': matFeedback,
  })[selector];
  const canvas = new Element(), engineButton = new Element();
  let engineFrames = 0;
  const engineScrolls = [];
  canvas.scrollIntoView = (options) => engineScrolls.push(options);
  canvas.getContext = () => new Proxy({}, { get: (_, key) => key === "clearRect" ? () => { engineFrames += 1; } : () => {} });
  const [introStage, relayStage, flipStage] = ["s0", "s3", "s4"].map((scene) => {
    const element = new Element();
    element.dataset.stage = scene;
    return element;
  });
  const lamp = new Element();
  Object.assign(lamp.dataset, { ax: "310", ay: "190", len: "50" });
  lamp.style.setProperty("--lamp-angle", `${Math.PI / 2}rad`);
  introStage.querySelector = (selector) => selector === '[data-physics-lamp="6"]' ? lamp : null;
  relayStage.querySelector = (selector) => selector === '[data-physics-lamp="5"]' ? lamp : null;
  flipStage.querySelector = (selector) => selector === '[data-physics-body="copy:1"]' ? new Element() : null;
  const artStages = [introStage, relayStage, flipStage];
  root.querySelectorAll = (selector) => selector === "[data-stage]" ? artStages : [];
  const controls = [];
  const reports = [];
  const recapComparisons = [];
  let gestureHint = false, vibrationHintTimer;
  const nativePhases = new Set();
  scenes.flip.section.addEventListener("climaxchange", ({ detail }) => nativePhases.add(detail.phase));
  const hooks = {
    scenes, root, stage, pauseButton: pause, soundButton: sound,
    enabled(value) { assert(value); },
    renderRecords(events) { recordsByScene.push([...events]); },
    showReplaySummary(peak) { replaySummaries.push(peak); },
    renderThump(scene, event, _width, _still, highlight, marker) {
      const chairX = event.cue === "s4-chair" ? layoutCalls.at(-1).engine.rooms.get(6).props.chair.x : undefined;
      figures.push({ scene, ...event, observedAt: time, chairX, highlight, marker });
    },
    showCue(cue) { cuePhases.push({ cue, angle: Number(stage.style.transform?.slice(7, -4)), observedAt: time }); },
    showClimaxWipe(visible) { root.toggleAttribute("data-climax-wipe", visible); },
    showControls(state) { controls.push(state); },
    showResult(result) { hooks.result = result; },
    showMatSummary(comparison) { recapComparisons.push(comparison); },
    showFlipInvite(visible) { inviteVisible = visible; },
    focusIntro() { introFocuses += 1; return true; },
    focusCushion() {
      const next = matControls.find((control) => control.getAttribute("aria-disabled") === "false");
      if (next) cushionFocus.push(next.dataset.action);
      return Boolean(next);
    },
    fadeCopy() { fades += 1; },
    syncCardPose(pose) { handedPoses.push({ pose: structuredClone(pose), engine: layoutCalls.at(-1).engine }); },
    showSensor(state) { sensorUi = state; },
    showGestureCue(visible) { gestureHint = visible; },
    showSoundHint(visible) { soundHint = visible; },
    showVibrationHint(onClose) {
      vibrationHints += 1;
      vibrationHintTimer = setTimer(() => { vibrationHintTimer = undefined; onClose?.(); }, 3_000);
    },
    hideVibrationHint() { timers.delete(vibrationHintTimer); vibrationHintTimer = undefined; },
    vibrationHintVisible() { return vibrationHintTimer !== undefined; },
    createEnginePanel() { return { button: engineButton, canvas, destroy() {} }; },
    report(...args) { reports.push(args); },
    resetStory() { window.scrollY = 0; },
    actionFor(target) { return target; },
  };
  const context = vm.createContext({
    window, document, EventTarget, CustomEvent, AbortController, structuredClone, URLSearchParams, console,
    ResizeObserver: mode === "dist" ? ResizeObserver : undefined,
    CSS: { supports: () => false }, matchMedia: window.matchMedia,
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    performance: { now: () => time },
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout: setTimer,
    clearTimeout(id) { timers.delete(id); },
  });

  const source = (url) => url.startsWith("data:")
    ? Buffer.from(url.split(",")[1], "base64").toString("utf8") : readFileSync(join(directory, url), "utf8");
  const modules = new Map(Object.entries(imports).map(([key, url]) => [
    key, new vm.SourceTextModule(source(url), { context, identifier: key }),
  ]));
  const resolve = (name) => { assert(modules.has(name), name); return modules.get(name); };
  for (const module of modules.values()) if (module.status === "unlinked") await module.link(resolve);
  for (const key of ["engines/motion.js", "engines/motion-building.js", "engines/physics-building.js", "engines/fx-type.js",
    "engines/fx-engine-view.js", "engines/fx-haptics.js", "scenes.js"]) {
    await resolve("@landing/" + key).evaluate();
  }

  const framingLayer = new Element();
  framingLayer.clientWidth = 1440;
  framingLayer.clientHeight = 900;
  const framingStage = resolve("@landing/adapters.js").namespace.connectStage(window.LandingBuilding, { stage: framingLayer });
  const framingBuilding = { angle: 2 * Math.PI / 3, world: { gx: 0, gy: 920 } };
  framingStage.reset(framingBuilding.angle);
  const originalScale = window.LandingBuilding.climaxRotationScale(framingBuilding.angle, 1440 / 900);
  const renderFrame = (settings = {}) => {
    const frame = framingStage.sample({ ...settings });
    framingStage.render({ building: framingBuilding, tick: 0, frame, ...settings });
  };
  for (const [width, height, scale, lift] of [
    [1280, 720, 0.620, 82], [1366, 768, 0.623, 90], [1536, 864, 0.630, 106],
    [1512, 982, 0.687, 118], [1440, 900, 0.672, 108],
  ]) {
    framingLayer.clientWidth = width;
    framingLayer.clientHeight = height;
    renderFrame();
    const [, top] = framingLayer.style.translate.split(" ");
    assert(Math.abs(Number(framingLayer.style.scale) - scale) < 0.001, `desktop scale at ${width}×${height}`);
    assert(top.endsWith("px") && Math.abs(Number.parseFloat(top) + lift) <= 0.5, `desktop lift at ${width}×${height}`);
  }
  renderFrame({ zoom: 0.5 });
  assert.equal(framingLayer.style.translate, "0 -144px");
  window.navigator.maxTouchPoints = 5;
  renderFrame();
  assert.equal(Number(framingLayer.style.scale), originalScale, "a wide touch-first display keeps the original scale");
  assert.equal(framingLayer.style.translate, "0 0px");
  window.navigator.maxTouchPoints = 0;
  for (const [width, height] of [[1279, 720], [1280, 719], [1728, 961], [390, 844]]) {
    framingLayer.clientWidth = width;
    framingLayer.clientHeight = height;
    renderFrame();
    assert.equal(Number(framingLayer.style.scale), window.LandingBuilding.climaxRotationScale(framingBuilding.angle, width / height));
    assert.equal(framingLayer.style.translate, "0 0px", `the layer at ${width}×${height} stays out of the framing range`);
  }
  framingLayer.clientWidth = 1440;
  framingLayer.clientHeight = 900;
  renderFrame({ sensor: true });
  assert.equal(framingLayer.style.transform, "rotate(0deg)");
  assert.equal(framingLayer.style.scale, "");
  assert.equal(framingLayer.style.translate, "");
  renderFrame();
  const camera = [framingLayer.style.transform, framingLayer.style.scale, framingLayer.style.translate];
  renderFrame({ paused: true });
  assert.deepEqual([framingLayer.style.transform, framingLayer.style.scale, framingLayer.style.translate], camera);
  framingBuilding.angle = Math.PI;
  framingStage.record(Math.PI, true);
  renderFrame({ listening: true });
  assert.equal(Number(framingLayer.style.scale), 1);
  assert.equal(framingLayer.style.translate, "0 0px");
  window.navigator.maxTouchPoints = 5;
  for (const [width, height] of [[390, 844], [844, 390]]) {
    framingLayer.clientWidth = width;
    framingLayer.clientHeight = height;
    renderFrame({ listening: true });
    const { scale, offsetY } = window.LandingBuilding.climaxListeningFrame(Math.PI, { width, height });
    assert(scale < 1);
    assert.equal(Number(framingLayer.style.scale), scale);
    assert.equal(framingLayer.style.translate, `0 ${offsetY}px`);
    renderFrame({ reduced: true, listening: true });
    assert.equal(Number(framingLayer.style.scale), scale);
    assert.equal(framingLayer.style.translate, offsetY ? `0 ${offsetY}px` : "");
  }
  window.navigator.maxTouchPoints = 0;
  framingStage.destroy();

  const reaction = new Element();
  reaction.hidden = true;
  const clickStage = new Element(), clickScene = new Element(), clickRoot = new Element();
  const clickRelay = new Element(), clickFlip = new Element(), clickResult = new Element(), notice = new Element();
  const replayScene = new Element(), replayCue = new Element(), referenceCue = new Element(), replayFeedback = new Element();
  Object.assign(clickScene.dataset, { floor: "7" });
  Object.assign(replayScene.dataset, { floor: "6" });
  Object.assign(clickRelay.dataset, { floor: "5" });
  Object.assign(clickFlip.dataset, { floor: "7 6 5" });
  const firstImpact = new Element(), firstBand = new Element();
  const firstLive = new Element(), readingOutput = new Element(), floorLive = new Element(), flipLive = new Element();
  const chairExplanation = new Element();
  const recap = Object.fromEntries(["kung", "listen", "mat"].map((key) => {
    const row = new Element(), from = new Element(), to = new Element(), sr = new Element(), reduction = new Element();
    row.querySelector = (selector) => ({
      "[data-recap-from]": from, "[data-recap-to]": to, "[data-recap-sr]": sr,
      "[data-recap-reduction]": key === "mat" ? reduction : null,
    })[selector];
    return [key, { row, from, to, sr, reduction }];
  }));
  const hookPause = new Element(), hookFlip = new Element(), flipControls = new Element(), s4Next = new Element();
  const hookStage = new Element(), fixedQuestion = new Element(), movingQuestion = new Element();
  const button = new Element(), chairButton = new Element(), dropPreview = new Element(), peakSlot = new Element();
  const ruler = new Element(), rulerLabel = new Element(), rulerValue = new Element();
  ruler.querySelector = (selector) => ({ "[data-ruler-mine-label]": rulerLabel, "[data-ruler-mine-value]": rulerValue })[selector];
  const matRecap = new Element(), matLink = new Element();
  const clickFooter = new Element(), creditFooter = new Element(), engineCredit = new Element(), engineSlot = new Element();
  const footerActions = new Element();
  s4Next.hidden = false;
  fixedQuestion.hidden = true;
  notice.hidden = replayCue.hidden = referenceCue.hidden = true;
  firstImpact.hidden = firstBand.hidden = true;
  replayCue.textContent = "같은 ‘쿵’, 듣는 자리가 다릅니다.";
  replayCue.replaceChildren = (...children) => {
    replayCue.children = children;
    replayCue.textContent = children.map((child) => child.textContent ?? child).join("");
  };
  const replayAnnouncements = [];
  replayFeedback.replaceChildren = (...children) => {
    replayFeedback.textContent = children.join("");
    if (children.length) replayAnnouncements.push(replayFeedback.textContent);
  };
  chairButton.dataset.action = "nudge";
  chairButton.closest = () => clickRelay;
  button.dataset.action = "drop";
  button.closest = (selector) => selector === "[data-scene]" ? clickScene : selector === "[data-action]" ? button : null;
  matLink.dataset.action = "cushion-revisit";
  matLink.closest = (selector) => ({ section: matRecap, "[data-scene]": clickResult, "[data-action]": matLink })[selector] ?? null;
  clickStage.getBoundingClientRect = () => ({ left: 50, top: 20, width: 400, height: geo.h });
  clickStage.closest = (selector) => selector === "[data-scene]" ? clickScene : selector.includes("data-stage") ? clickStage : null;
  clickStage.querySelector = (selector) => selector === ".drop-preview" ? dropPreview : null;
  clickScene.querySelector = (selector) => ({
    "[data-stage]": clickStage, "[data-fx]": firstLive, "[data-reaction], [data-react]": reaction,
    "[data-kung-reading], [data-impact-reading], [data-thump-index]": readingOutput,
  })[selector] ?? null;
  clickScene.querySelectorAll = (selector) => selector === '[data-cue="s0-after"], [data-cue="s0-band"]' ? [firstImpact, firstBand] : [];
  clickScene.scrollIntoView = clickScene.focus = () => {};
  clickScene.hasAttribute = (name) => clickScene.attrs.has(name);
  replayScene.querySelector = (selector) => ({ '[data-cue="s2-after"]': replayCue,
    '[data-cue="s2-empty"]': referenceCue, "[data-fx]": replayFeedback })[selector] ?? null;
  clickResult.querySelector = (selector) => ({
    "[data-flip-missed]": notice, "[data-result-peak]": peakSlot, "[data-ruler-mine]": ruler,
    '[data-recap="kung"]': recap.kung.row, '[data-recap="listen"]': recap.listen.row, '[data-recap="mat"]': recap.mat.row,
  })[selector] ?? null;
  clickFlip.querySelector = (selector) => ({ "[data-action=flip]": hookFlip, "[data-fx]": flipLive,
    '[data-place="s4-controls"]': flipControls, '[data-action="s4-next"]': s4Next,
    "[data-flip-layer]": hookStage, "[data-s4-question]": fixedQuestion,
    '[data-cue="s4-06"], .s406': chairExplanation })[selector] ?? null;
  hookStage.querySelector = (selector) => selector === '[data-physics-body="copy:0"]' ? movingQuestion : null;
  clickFooter.querySelector = (selector) => ({ footer: creditFooter, ".coda-end": footerActions })[selector] ?? null;
  creditFooter.querySelector = (selector) => selector === "dl > dd" ? engineCredit : engineSlot;
  engineCredit.contains = (node) => engineCredit.children.includes(node);
  clickRoot.querySelector = (selector) => ({ '[data-scene="s0"]': clickScene, '[data-scene="s2"]': replayScene,
    '[data-scene="s3"]': clickRelay, '[data-scene="s4"]': clickFlip, '[data-scene="s6"]': clickResult, '[data-scene="s7"]': clickFooter })[selector];
  clickRoot.querySelectorAll = (selector) => selector === "[data-action]" ? [button] : [button, chairButton];
  clickRoot.contains = () => true;
  button.matches = chairButton.matches = () => false;
  const realHooks = resolve("@landing/hooks.js").namespace.bindHooks({
    documentElement: new Element(),
    createElement: () => new Element(),
    querySelector: (selector) => ({ "[data-page-stage], main": clickRoot, "#motion-pause, [data-action=pause]": hookPause,
      "[data-floor-live]": floorLive })[selector] ?? null,
  });
  assert.equal(readingOutput.getAttribute("aria-live"), "off");
  assert.equal(readingOutput.getAttribute("aria-hidden"), "true");
  const footerStatus = footerActions.children[0];
  assert.equal(footerStatus.dataset.fx, "footer-feedback");
  assert.equal(footerStatus.getAttribute("role"), "status");
  realHooks.report("footer", "카드 저장을 시작했습니다.");
  assert.equal(footerStatus.textContent, "카드 저장을 시작했습니다.");
  const creditPanel = realHooks.createEnginePanel();
  assert.equal(engineCredit.children[0], engineSlot);
  assert.deepEqual(engineSlot.children, [creditPanel.button, creditPanel.canvas]);
  realHooks.announceFloor("relay", false, "ready");
  assert.equal(floorLive.textContent, "5층에 도착했습니다.");
  assert.equal(realHooks.actionFor(matLink, { detail: 0 })?.owner, "result", "a link inside the recap section belongs to S6");
  assert.equal(realHooks.actionFor(matLink, { detail: 1 })?.action, "cushion-revisit");
  realHooks.showResult({ peak: 200, peakX: 0.25 }, null);
  assert.equal(peakSlot.textContent, "200");
  assert.equal(peakSlot.dataset.peakX, "0.25");
  assert.equal(ruler.hidden, false);
  assert.equal(ruler.dataset.rulerKind, "thump");
  assert.equal(ruler.style.getPropertyValue("--ruler-position"), "100%");
  assert.equal(rulerLabel.textContent, "내 최대 쿵");
  assert.equal(rulerValue.textContent, peakSlot.textContent);
  realHooks.showResult({ peak: 140, upperEvent: { label: "드르륵", sequence: 1 } }, null);
  assert.equal(ruler.dataset.rulerKind, "scrape");
  assert.equal(ruler.dataset.rulerValue, "140");
  assert.equal(ruler.style.getPropertyValue("--ruler-position"), "70%");
  assert.equal(rulerLabel.textContent, "내 최대 드르륵");
  assert.equal(rulerValue.textContent, peakSlot.textContent);
  realHooks.showResult({ peak: 30 }, null);
  assert.equal(ruler.style.getPropertyValue("--ruler-position"), "15%");
  realHooks.showResult({ peak: 0 }, null);
  assert.equal(ruler.hidden, true);
  assert.equal(ruler.dataset.rulerValue, undefined);
  assert.equal(ruler.style.getPropertyValue("--ruler-position"), "");
  assert.equal(clickResult.dataset.resultState, "empty");
  assert.deepEqual(Object.values(recap).map(({ row }) => row.dataset.state), ["empty", "empty", "empty"]);
  assert.deepEqual([recap.kung.from.textContent, recap.kung.to.textContent], ["7층 바닥", "6층 천장"]);
  assert.deepEqual([recap.listen.from.textContent, recap.listen.to.textContent], ["6층 바닥", "7층 천장"]);
  realHooks.showResult({ peak: 200, resultState: "done", upperEvent: { sequence: 2 }, chairIndex: 141 }, null);
  assert.equal(recap.listen.row.dataset.state, "empty", "the S3 nudge alone cannot fill the S4 result");
  realHooks.showMatSummary({ before: 100, after: 56 });
  assert.equal(recap.mat.row.dataset.state, "done");
  assert.equal(recap.mat.reduction.hidden, false);
  assert.equal(recap.mat.reduction.textContent, "44");
  assert.equal(recap.listen.row.dataset.state, "empty", "early mat values cannot fill the skipped S4 row");
  realHooks.showResult({ peak: 200, resultState: "done", upperEvent: { sequence: 2 }, heardChairIndex: 141,
    stats: { matComparison: { before: 100, after: 56, reduction: 0.44 } } }, null);
  assert.equal(clickResult.dataset.resultState, "done");
  assert.deepEqual(Object.values(recap).map(({ row }) => row.dataset.state), ["done", "done", "done"]);
  assert.equal(recap.kung.from.textContent, "쿵 #2 · 200");
  assert.equal(recap.listen.from.textContent, "6층 의자 · 141");
  assert.deepEqual([recap.mat.from.textContent, recap.mat.to.textContent], ["쿵 100", "56"]);
  assert.equal(recap.mat.reduction.textContent, "44");
  assert.equal(recap.mat.sr.textContent, "같은 높이에서 맨바닥 쿵 100, 매트 위 쿵 56. 쿵 지수가 44% 줄었습니다.");
  for (const [active, listening, floor, view] of [
    ["intro", false, "7", "upper"], ["listen", false, "6", "lower"], ["relay", false, "5", "lower"],
    ["flip", false, "7 6 5", "all"], ["flip", true, "7", "lower"], ["flip", false, "7 6 5", "all"],
    ["result", true, "7", "upper"],
  ]) {
    realHooks.showControls({ active, listening });
    assert.deepEqual([clickRoot.dataset.currentFloor, clickRoot.dataset.currentView], [floor, view]);
  }
  const markers = [];
  const markerLabels = [];
  window.LandingArt.record = ({ n, label, tagLabel }) => { markers.push(n); markerLabels.push([label, tagLabel]); };
  window.LandingArt.clearRecords = () => { markers.length = 0; };
  const tape = (...sequences) => sequences.map((sequence) => ({ sequence, point: { x: 50 }, index: 100 }));
  const initialTape = tape(1, 2, 3);
  initialTape[1].label = "드르륵";
  realHooks.renderRecords(initialTape, 480);
  assert.deepEqual(markerLabels, [["쿵", "쿵 #1"], ["드르륵", "드르륵 #2"], ["쿵", "쿵 #3"]]);
  realHooks.renderRecords(tape(1, 3, 4), 480);
  assert.deepEqual(markers, [1, 3, 4], "the rendered tape updates when its pinned first entry is unchanged");
  assert.deepEqual(markerLabels.slice(-3), [["쿵", "쿵 #1"], ["쿵", "쿵 #3"], ["쿵", "쿵 #4"]]);
  assert.equal(chairExplanation.hidden, true);
  const chairEvent = { index: 141, point: { x: 176 }, cue: "s4-chair", kind: "replay", label: "6층 의자", sourceRoom: 6, receiverRoom: 7 };
  const chairMarker = window.LandingBuilding.climaxImpactMarker(chairEvent, 480, true);
  realHooks.renderThump("flip", chairEvent, 480, true, true, chairMarker);
  assert.equal(chairExplanation.hidden, false);
  assert.equal(flipLive.textContent, "6층 의자 · 141, 7층 천장에 닿았습니다.");
  realHooks.renderThump("flip", { index: 1 }, 480, true);
  assert.equal(flipLive.textContent, "6층 의자 · 141, 7층 천장에 닿았습니다.");
  assert.deepEqual(markers, [1, 3, 4, 0]);
  delete window.LandingArt.record;
  delete window.LandingArt.clearRecords;
  const roomClick = realHooks.actionFor(clickStage, { detail: 1, clientX: 250, clientY: 445 });
  assert.equal(roomClick.action, "drop");
  assert.equal(roomClick.position, 0.5);
  assert.equal(roomClick.height, 0.5);
  assert.equal(realHooks.actionFor(clickStage, { detail: 1, clientX: 250, clientY: 880 }), null);
  assert.equal(realHooks.actionFor(button, { detail: 0 }).height, undefined);
  button.dataset.action = "drop-high";
  button.hidden = true;
  realHooks.enabled(true, true);
  assert.equal(button.hidden, false, "the design's high-drop button becomes available after mount");
  const highButton = realHooks.actionFor(button, { detail: 0 });
  assert.equal(highButton.action, "drop");
  assert.equal(highButton.height, 0);
  hookPause.setAttribute("aria-pressed", "true");
  realHooks.showControls({ inputAllowed: false, chairAllowed: true, paused: false, flipped: false });
  assert.equal(hookPause.dataset.pressed, "false");
  assert.equal(hookPause.attrs.has("aria-pressed"), false);
  assert.equal(hookFlip.getAttribute("aria-pressed"), "false");
  assert.equal(button.attrs.get("aria-disabled"), "true");
  assert.equal(chairButton.attrs.get("aria-disabled"), "false");
  assert.equal(clickStage.dataset.dropPreview, "off");
  assert.equal(dropPreview.style.display, "none");
  realHooks.showControls({ inputAllowed: true, chairAllowed: true, paused: false, flipped: false });
  assert.equal(hookFlip.textContent, "중력 뒤집기");
  assert.equal(s4Next.hidden, true);
  realHooks.showControls({ inputAllowed: true, chairAllowed: true, paused: false, flipped: false, flipSeen: true });
  assert.equal(hookFlip.textContent, "한 번 더 뒤집기");
  assert.equal(clickFlip.dataset.flipSeen, "true");
  assert.equal(flipControls.attrs.has("data-flip-again"), true);
  assert.equal(s4Next.hidden, false);
  realHooks.showClimaxQuestion(true);
  assert.equal(fixedQuestion.hidden, false);
  assert.equal(movingQuestion.style.visibility, "hidden");
  realHooks.showClimaxQuestion(false);
  assert.equal(fixedQuestion.hidden, true);
  assert.equal(movingQuestion.style.visibility, "");
  assert.equal(clickStage.dataset.dropPreview, undefined);
  realHooks.showControls({ inputAllowed: true, chairAllowed: true, paused: true, flipped: true });
  assert.equal(hookPause.dataset.pressed, "true");
  assert.equal(hookPause.attrs.has("aria-pressed"), false);
  assert.equal(hookFlip.getAttribute("aria-pressed"), "true");
  assert.equal(clickStage.dataset.dropPreview, "off", "pause hides the preview even while manual input is available");
  realHooks.showFlipInvite(true);
  assert.equal(notice.hidden, false);
  realHooks.showFlipInvite(false);
  assert.equal(notice.hidden, true);
  realHooks.renderThump("intro", { index: 100, sequence: 1, point: { x: 240 } }, 480, true);
  assert.equal(firstLive.textContent, "쿵 #1 · 100, 6층 천장에 닿았습니다.");
  assert.equal(firstImpact.hidden, false);
  assert.equal(firstBand.hidden, false);
  realHooks.renderThump("intro", { index: 41, sequence: 2, followUp: true, point: { x: 240 } }, 480, true);
  assert.equal(firstLive.textContent, "쿵 #1 · 100, 6층 천장에 닿았습니다.");
  assert.equal(reaction.hidden, false);
  assert.equal(reaction.style.animation, "none");
  assert.equal(timers.size, 1);
  const timer = timers.values().next().value;
  assert.equal(timer.delay, 1600);
  timer.callback();
  timers.clear();
  assert.equal(reaction.hidden, true);

  const replayUpdates = [];
  window.LandingArt.setCurrent = (sequence) => replayUpdates.push(sequence);
  window.LandingArt.cursor = (scene, x) => replayUpdates.push([scene, x]);
  const sample = { sequence: 3, label: "드르륵", index: 65, point: { x: 72 } };
  realHooks.renderThump("gesture", sample, 480, true);
  assert.deepEqual(replayUpdates, [], "an upstairs event does not masquerade as a downstairs replay");
  realHooks.showReplaySummary(sample);
  assert.deepEqual(replayAnnouncements, ["같은 드르륵 #3 · 65, 듣는 자리만 다릅니다."]);
  realHooks.renderThump("listen", { ...sample, kind: "replay" }, 480, true);
  assert.deepEqual(replayUpdates, [3, ["s2", 0.15]]);
  assert.equal(replayFeedback.textContent, "같은 드르륵 #3 · 65, 듣는 자리만 다릅니다.");
  assert.equal(replayCue.textContent, "같은 드르륵 #3 · 65, 듣는 자리만 다릅니다.");
  const replayLabel = replayCue.children[1];
  assert.equal(replayLabel.className, "nowrap");
  assert.equal(replayCue.hidden, false);
  assert.equal(referenceCue.hidden, true);
  realHooks.renderThump("listen", { sequence: 4, kind: "replay", index: 23, point: { x: 260 } }, 480, true, false);
  assert.equal(replayFeedback.textContent, "같은 드르륵 #3 · 65, 듣는 자리만 다릅니다.");
  assert.equal(replayCue.textContent, "같은 드르륵 #3 · 65, 듣는 자리만 다릅니다.");
  assert.deepEqual(replayUpdates, [3, ["s2", 0.15]]);
  assert.equal(replayAnnouncements.length, 1, "a tape announces once, before its representative can be interrupted");
  realHooks.showReplaySummary();
  realHooks.renderThump("listen", { kind: "replay", index: 100, point: { x: 240 } }, 480, true);
  assert.deepEqual(replayUpdates.slice(-2), [null, ["s2", 0.5]], "the reference does not retain a numbered marker");
  assert.equal(replayFeedback.textContent, "기준 낙하 · 100");
  assert.equal(replayCue.textContent, "같은 ‘쿵’, 듣는 자리가 다릅니다.");
  assert.equal(replayCue.hidden, true);
  assert.equal(referenceCue.hidden, false);
  realHooks.showReplaySummary(sample);
  realHooks.renderThump("listen", { ...sample, kind: "replay" }, 480, true);
  assert.equal(replayCue.textContent, "같은 드르륵 #3 · 65, 듣는 자리만 다릅니다.");
  realHooks.resetStory();
  assert.equal(firstImpact.hidden, true);
  assert.equal(firstBand.hidden, true);
  assert.equal(replayCue.textContent, "같은 ‘쿵’, 듣는 자리가 다릅니다.");
  delete window.LandingArt.setCurrent;
  delete window.LandingArt.cursor;

  const swingLamp = new Element(), lampStage = new Element();
  lampStage.dataset.stage = "s2";
  swingLamp.dataset.physicsLamp = "6";
  swingLamp.closest = () => lampStage;
  swingLamp.classList = { toggle() {} };
  let bobX = 10;
  const showLamp = resolve("@landing/hooks.js").namespace.bindPhysicsPose({
    root: { querySelectorAll: (selector) => selector === "[data-physics-lamp]" ? [swingLamp] : [] },
  }, {
    rooms: new Map([[6, { props: {}, lamp: { pose: () => ({ x: bobX, y: -10 }) } }]]),
    copyBlocks: [], lampWorld: { linkAnchor: () => ({ x: 0, y: 0 }) },
  });
  showLamp(1);
  assert.equal(parseFloat(swingLamp.style["--lamp-angle"]), -0.6);
  bobX = -10;
  showLamp(1);
  assert.equal(parseFloat(swingLamp.style["--lamp-angle"]), 0.6);

  const type = resolve("@landing/engines/fx-type.js").namespace;
  const physics = resolve("@landing/engines/physics-building.js").namespace;
  let limitAngle = false;
  let expandedListening = false;
  let scrubDuringPlayback = 0;
  let settledChairInputs = 0;
  const savedCards = [];
  const api = {
    buildingMotion: { ...window.LandingBuilding, createClimaxScrollMap(options) {
      return expandedListening ? window.LandingBuilding.createClimaxScrollMap(options) : null;
    }, createClimaxTimeline(options) {
      const timeline = window.LandingBuilding.createClimaxTimeline({ ...options,
        holdButtonToListenEnd: expandedListening && options.holdButtonToListenEnd });
      const scrub = timeline.scrub;
      timeline.scrub = (...args) => {
        if (timeline.state.playing) scrubDuringPlayback += 1;
        return scrub(...args);
      };
      return timeline;
    } },
    physics: {
      ...physics,
      createBuilding(options) {
        assert.equal(options.dt, 1 / 120);
        const engine = physics.createBuilding(options);
        const setProgress = engine.setProgress.bind(engine);
        engine.setProgress = (progress) => setProgress(limitAngle ? Math.min(progress, 0.475) : progress);
        const settleChairDrag = engine.settleChairDrag.bind(engine);
        engine.settleChairDrag = (advance) => {
          settledChairInputs += 1;
          return settleChairDrag(advance);
        };
        return engine;
      },
    },
    card: {
      async exportCardPng() { return { type: "image/png" }; },
      downloadCardPng(blob, filename) { savedCards.push({ blob, filename }); return true; },
      async shareCard(options) { lastShare = options; return { status: "shared" }; },
    },
    engineView: resolve("@landing/engines/fx-engine-view.js").namespace,
    haptics: resolve("@landing/engines/fx-haptics.js").namespace,
    audio: { createAudioEffects() {
      soundStarts += 1;
      return { muted: true, enable() { this.muted = false; return true; }, mute() { this.muted = true; },
        playImpact(event, options) { if (!this.muted) suppliedSounds.push({ event, ...options }); } };
    } },
    type: {
      displayedPeak: type.displayedPeak,
      classifyBehavior(record, options) {
        assert.equal(options.enableV11, true);
        assert.equal(options.quietPeak, undefined);
        return type.classifyBehavior(record, options);
      },
    },
  };
  function action(action, owner, position, height) {
    const event = new Event("click", { cancelable: true });
    Object.defineProperty(event, "target", { value: { action, owner, position, height, control: { hidden: false } } });
    root.dispatchEvent(event);
    return event;
  }
  function scroll(position) {
    window.scrollY = position;
    window.dispatchEvent(new Event("scroll"));
    runFrames(2);
  }
  const lifecycle = new AbortController();
  resolve("@landing/scenes.js").namespace.mountScenes(hooks, api, lifecycle.signal);
  assert.equal(soundStarts, 0);
  assert.equal(hooks.result.resultState, "empty");
  assert.equal(hooks.result.peak, 0);
  assert.equal(engineButton.getAttribute("aria-pressed"), String(mode === "dist"));
  if (layoutObserver) {
    assert.deepEqual(layoutObserver.targets, [document.documentElement, scenes.flip.section, scenes.flip.panel]);
    layoutObserver.callback();
  }
  assert.equal(layoutCalls.length, 1);
  assert.equal(layoutCalls[0].ballVx, 0, "hand layout the resting building before kicking the ball");
  const { engine, cupX } = layoutCalls[0];
  const { previewDropColumn } = resolve("@landing/adapters.js").namespace;
  const highDropColumns = [700, 928, 1006].map((pixel) => [pixel / 1440, 0, true]);
  for (const [x, height, clear] of [...highDropColumns, [0.64, 0.18], [0.64, 0.50], [0.99, 0]]) {
    const separateEngine = physics.createBuilding({ dt: 1 / 120 });
    const room = separateEngine.rooms.get(7);
    const y = room.top + height * (room.bottom - room.top);
    const preview = previewDropColumn(separateEngine, physics.dropColumnForPreview, x, height);
    assert(Number.isFinite(preview));
    if (clear) assert(Math.abs(preview - x) < 1e-9, "a hidden copy block cannot shift a high drop in a clear column");
    assert(separateEngine.input({ type: "dropBall", x: preview * separateEngine.width, y }));
    assert.equal(room.props.ball.x / separateEngine.width, preview, "the shown column can take the real drop");
  }
  assert.equal(window.LandingArt.dropColumn(0.64, 0.18), previewDropColumn(engine, physics.dropColumnForPreview, 0.64, 0.18));
  runFrames(120);
  assert.equal(stage.dataset.gravityY, "920");
  if (mode === "dist") {
    const debug = window.__lt.dump();
    assert(debug.world.time > 1 && debug.framePending);
    assert.equal(debug.records, 0);
    for (const key of ["x", "y", "vx", "vy"]) assert(Number.isFinite(debug.bodies7.ball[key]));
    assert.equal(typeof debug.bodies7.ball.sleeping, "boolean");
    assert.equal(debug.bodies7.ball.static, false);
    const overlay = introStage.children[0];
    assert.equal(overlay.attrs.get("aria-hidden"), "true");
    assert(overlay.children.some((item) => item.tagName === "circle"));
    assert(overlay.children.some((item) => item.tagName === "polygon"));
    const cup = overlay.children.findIndex((item) => item.textContent?.startsWith(`7:cup ${cupX.toFixed(1)}, `));
    assert(cup > 0);
    const outlineX = Number(overlay.children[cup - 1].attrs.get("transform").match(/^translate\((\S+)/)[1]);
    assert.equal(outlineX, cupX * (geo.w / engine.width));
    assert(overlay.children.some((item) => item.textContent === "6:lamp 260.0, 190.0 px"));
    assert(!overlay.children.some((item) => item.textContent?.startsWith("7:copy ")));
    const relayLabels = relayStage.children[0].children.map((item) => item.textContent ?? "");
    assert(relayLabels.some((label) => label.startsWith("6:chair ")), "show body even without its design element");
    assert(relayLabels.some((label) => label.startsWith("5:lamp ")));
    assert(!relayLabels.some((label) => label.startsWith("6:lamp ") || label.startsWith("5:copy ")));
    const flipLabels = flipStage.children[0].children.map((item) => item.textContent ?? "");
    assert(flipLabels.some((label) => label.startsWith("7:copy ")));
    assert(!flipLabels.some((label) => label.startsWith("5:copy ")));

    Object.assign(lamp.dataset, { ax: "131", ay: "79", len: "40" });
    lamp.style.setProperty("--lamp-angle", "0rad");
    runFrames(1);
    assert(overlay.children.some((item) => item.textContent === "6:lamp 131.0, 119.0 px"));
  } else {
    assert.equal(window.__lt, undefined);
    assert(artStages.every((element) => !element.children.length));
  }

  const cupPosition = cupX / engine.width;
  action("drop", "intro", cupPosition);
  runFrames(16, 1000 / 17);
  const upper = recordsByScene.at(-1)[0];
  assert.equal(upper?.index, 100, "drop above the cup should hit the slab within one second at 17fps");
  assert.equal(upper.sequence, 1);
  assert.equal(upper.receiverRoom, 6);
  runFrames(24);
  const bounce = recordsByScene.at(-1).find(({ actionId, sequence }) => actionId === upper.actionId && sequence > upper.sequence);
  assert(bounce?.followUp, "the first ball's rebound stays in the tape and is marked as a follow-up");
  const beforeTap = recordsByScene.at(-1).length;
  action("tap", "intro", cupPosition);
  runFrames(16, 1000 / 17);
  assert(recordsByScene.at(-1).slice(beforeTap).some((event) => event.index === 43), "tap above the cup should hit the slab");

  scroll(1110);
  runFrames(75);
  const repeated = figures.find((item) => item.scene === "listen");
  assert(repeated, "S2 should replay on the 0.2 threshold");
  assert.equal(repeated.index, upper.index);
  assert.equal(repeated.sequence, upper.sequence);
  assert.equal(repeated.point.x, upper.point.x);
  assert.equal(vibrationHints, 1, "unpaused Android displays U-08 on the first downstairs pulse");
  assert(vibration.some((pattern) => Array.isArray(pattern) && pattern[0] > 0));
  assert.equal(soundHint, false, "U-08 has priority over the sound hint");
  runFrames(190);
  assert.equal(soundHint, true, "the sound hint appears after the tape and the vibration notice finish");
  action("replay", "listen");
  assert.equal(soundHint, false, "an explicit replay immediately hides the sound hint");
  runFrames(75);
  action("replay", "listen");
  runFrames(75);

  scroll(2460);
  runFrames(140);
  assert.equal(controls.at(-1).chairAllowed, true, "S3 waits for the full 2.5-second dwell");
  runFrames(50);
  assert(figures.some((item) => item.scene === "relay" && item.receiverRoom === 5 && item.sourceRoom === 6));
  scroll(3808);
  runFrames(8);
  const focus = new Event("focusin");
  Object.defineProperty(focus, "target", { value: { matches: () => true } });
  root.dispatchEvent(focus);
  assert.equal(window.scrollY, 3720, "keyboard focus positions the stage at progress 0.2");
  const turnCueStart = cuePhases.length, turnFigureStart = figures.length;
  action("flip", "flip");
  assert(controls.at(-1).flipDisabled, "queued invert exposes its disabled state");
  runFrames(35);
  assert(Number(stage.dataset.gravityX) !== 0, "turn should continuously update actual gravity");
  const poseBeforePause = [stage.style.transform, stage.style.scale, stage.style.translate];
  pause.dispatchEvent(new Event("click"));
  const held = stage.dataset.motionTick;
  runFrames(30);
  assert.equal(stage.dataset.motionTick, held, "pause must hold the world tick");
  assert.deepEqual([stage.style.transform, stage.style.scale, stage.style.translate], poseBeforePause);
  pause.dispatchEvent(new Event("click"));
  runFrames(140);
  assert.equal(stage.dataset.gravityY, "-920");
  assert(controls.at(-1).listening);
  const listeningAt = cuePhases.slice(turnCueStart).find(({ cue }) => cue === "listen")?.observedAt;
  const beats = figures.slice(turnFigureStart).filter(({ cue }) => cue === "s4-chair");
  assert.equal(beats.length, 1);
  const [beat] = beats;
  assert.equal(beat.label, "6층 의자");
  assert.equal(beat.sourceRoom, 6);
  assert.equal(beat.receiverRoom, 7);
  assert.equal(beat.slab, "6/7");
  assert.equal(beat.point.x, beat.chairX, "E5 uses the chair's live position at delivery");
  assert.equal(beat.marker.x, beat.point.x / engine.width);
  assert.deepEqual(figures.slice(turnFigureStart).filter(({ scene }) => scene === "flip").map(({ cue }) => cue), ["s4-chair"]);
  assert(beat.observedAt >= listeningAt + 300 && beat.observedAt <= listeningAt + 1_500,
    "the chair beat arrives after the visible listening cue");
  const recordCount = recordsByScene.at(-1).length;
  action("drop", "intro");
  runFrames(65);
  assert.equal(recordsByScene.at(-1).length, recordCount);

  preference.matches = true;
  preference.dispatchEvent(new Event("change"));
  runFrames(4);
  const stopped = stage.dataset.motionTick;
  runFrames(70);
  assert.equal(stage.dataset.motionTick, stopped, "reduced-motion pose must be stationary");
  action("reset-flip", "flip");
  runFrames(4);
  assert.equal(stage.dataset.gravityY, "920");
  assert(Number(stage.style.opacity) > 0 && Number(stage.style.opacity) < 1, "reduced motion should crossfade");
  assert.equal(stage.style.transform, "rotate(0deg)");
  runFrames(18);
  assert.equal(stage.style.opacity, 1);
  preference.matches = false;
  preference.dispatchEvent(new Event("change"));
  scroll(5850);
  runFrames(45);
  assert.equal(hooks.result.resultState, "done");
  assert(nativePhases.has("invert") && nativePhases.has("listen") && nativePhases.has("settle"));
  assert.equal(hooks.result.id, "rewind");
  assert.equal(hooks.result.stats.flipMode, "button");
  assert.equal(hooks.result.stats.replays, 2);
  assert.equal(hooks.result.stats.peak, upper.index);
  await new Promise((resolve) => setImmediate(resolve));
  action("share", "result");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drawnCard.title, hooks.result.title);
  assert.equal(lastShare.result.id, "rewind");
  assert.equal(drawnCard.url, demoUrl);
  assert.equal(lastShare.demoUrl, demoUrl);
  assert.equal(lastShare.png.type, "image/png");
  assert.equal(lastShare.filename, "중력을-뒤집으면-카드.png");
  scroll(6600);
  assert.equal(action("save", "footer").defaultPrevented, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(savedCards.at(-1).filename, lastShare.filename);
  assert.equal(savedCards.at(-1).blob.type, "image/png");
  assert.deepEqual(reports.at(-1), ["footer", "카드 저장을 시작했습니다."]);
  assert.equal(hooks.result.heardChairIndex, beat.index);

  assert.equal(action("restart", "footer").defaultPrevented, true);
  runFrames(3);
  assert.equal(layoutCalls.length, 2);
  assert.notEqual(layoutCalls[1].engine, engine);
  assert.equal(recordsByScene.at(-1).length, 0);
  assert.equal(hooks.result.stats.n, 0);
  scroll(6600);
  assert.equal(stage.dataset.gravityY, "920");
  assert.equal(stage.style.transform, "rotate(360deg)");
  scroll(0);
  assert.equal(stage.style.transform, "rotate(0deg)");
  assert.equal(controls.at(-1).inputAllowed, true, "End → Home restores input immediately");
  const newRun = figures.length;
  scroll(1110);
  runFrames(70);
  assert(figures.slice(newRun).some((item) => item.track === "upper" && item.index === 100 && !item.sequence));

  scroll(3400 + 1600 * 0.65);
  runFrames(195);
  scroll(5850);
  assert.equal(hooks.result.resultState, "empty");
  assert.equal(hooks.result.stats.flipMode, "scroll");
  const returnToIntro = action("intro-revisit", "result");
  assert.equal(returnToIntro.defaultPrevented, true);
  runFrames(4);
  assert.equal(window.scrollY, scenes.intro.section.top);
  assert.equal(introFocuses, 1);
  assert.equal(recordsByScene.at(-1).length, 0);
  const personalReplayStart = figures.length;
  action("drop", "intro", 0.2);
  scroll(1110);
  runFrames(210);
  const personalReplays = () => figures.slice(personalReplayStart).filter((item) => item.track === "upper");
  assert(personalReplays().some(({ sequence, index }) => sequence === 1 && index === 100), "new personal knocks replay after the reference visit");
  const personalReplayCount = personalReplays().length;
  scroll(0);
  scroll(1110);
  runFrames(100);
  assert.equal(personalReplays().length, personalReplayCount, "without new records, revisiting S2 does not restart a finished tape");
  scroll(5850);
  assert.equal(hooks.result.stats.flipMode, "scroll", "the return link preserves the completed turn");

  action("restart", "result");
  scroll(6600);
  assert.equal(window.__lt?.dump().framePending ?? false, false);
  action("drop", "intro", cupPosition);
  if (window.__lt) assert.equal(window.__lt.dump().framePending, true);
  runFrames(16, 1000 / 17);
  assert.equal(recordsByScene.at(-1)[0]?.index, 100, "accepted action should advance outside a visible scene");
  runFrames(30, 1000 / 17);
  assert.equal(frames.size, 0, "offscreen physics should stop after the action window");

  action("restart", "result");
  runFrames(3);
  frames.clear();
  time += 700;
  const beforeFreeze = Number(stage.dataset.motionTick);
  scroll(0);
  runFrames(6);
  assert(Number(stage.dataset.motionTick) > beforeFreeze, "stale drawing frame is recovered after a measurement");

  action(highButton.action, "intro", 0.20, highButton.height);
  action("drop", "intro", 0.40, 0.89);
  scroll(1110);
  runFrames(120);
  const variableHits = recordsByScene.at(-1);
  assert(variableHits.some(({ index }) => index === 200));
  assert(variableHits.some(({ index }) => index >= 25 && index <= 60));
  assert.equal(new Set(variableHits.map(({ actionId }) => actionId)).size, 2);
  const selectedStart = figures.length;
  action("replay", "listen");
  runFrames(2);
  scroll(2460);
  const slowExit = figures.length;
  runFrames(65);
  assert(!figures.slice(slowExit).some((item) => item.track === "upper"), "a normal S2 visit pauses replay on exit");
  scroll(1110);
  runFrames(65);
  assert(figures.slice(slowExit).some((item) => item.track === "upper" && item.sequence === variableHits.at(-1).sequence),
    "a paused replay can resume in S2");
  const selected = figures.slice(selectedStart).filter((item) => item.track === "upper");
  assert(selected.some(({ index, highlight }) => index < 100 && !highlight));
  assert.deepEqual(selected.filter(({ highlight }) => highlight).map(({ index }) => index), [200]);
  const pinnedDuringReplay = replaySummaries.at(-1);
  assert.equal(pinnedDuringReplay.index, 200);
  pause.dispatchEvent(new Event("click"));
  const pulsesBefore = vibration.filter(Array.isArray).length;
  const pausedTake = figures.length;
  action("replay", "listen");
  assert.equal(replaySummaries.at(-1), pinnedDuringReplay, "a manual replay pins the same event while paused");
  assert.deepEqual(figures.slice(pausedTake).filter(({ highlight }) => highlight).map(({ sequence }) => sequence), [pinnedDuringReplay.sequence]);
  assert.equal(vibration.filter(Array.isArray).length, pulsesBefore, "the paused manual replay cannot vibrate");
  pause.dispatchEvent(new Event("click"));

  action("restart", "result");
  action("tap", "intro", 0.20);
  runFrames(60);
  action("tap", "intro", 0.40);
  runFrames(110);
  const rapidExit = figures.length;
  scroll(1110);
  runFrames(3);
  scroll(2390);
  assert.equal(controls.at(-1).inputAllowed, false, "the upper-floor input stays blocked during its replay");
  assert.equal(controls.at(-1).chairAllowed, true);
  action("nudge", "relay");
  runFrames(75);
  assert(figures.slice(rapidExit).some((item) => item.track === "upper" && item.sequence === 2),
    "a fast passage through S2 lets replay finish offscreen");
  assert(figures.slice(rapidExit).some((item) => item.scene === "relay" && item.receiverRoom === 5),
    "the chair records while the upper track was replaying");
  assert.equal(controls.at(-1).chairAllowed, false, "the played chair becomes disabled");

  scroll(5850);
  assert.equal(inviteVisible, true, "skipping the climax leaves the invitation visible");
  assert(action("flip-revisit", "result").defaultPrevented);
  assert.equal(window.scrollY, 3720);
  runFrames(2);
  scroll(3660);
  root.dispatchEvent(new Event("lt:art-layout"));
  runFrames(258);
  assert(controls.at(-1).listening && !inviteVisible);
  assert.equal(stage.style.transform, "rotate(180deg)");
  action("reset-flip", "flip");
  runFrames(145);
  assert(fades > 0, "copy fades back after the return settles");
  const latestBuilding = layoutCalls.at(-1).engine;
  assert(latestBuilding.copyBlocks.every((body, i) => body.sleeping && body.x === latestBuilding.copyHomes[i].x));
  assert.equal(stage.style.transform, "rotate(360deg)");
  window.innerWidth = 390;
  window.innerHeight = 844;
  action("flip", "flip");
  runFrames(2);
  scroll(3660);
  root.dispatchEvent(new Event("lt:art-layout"));
  runFrames(178);
  assert(controls.at(-1).listening, "a second button flip after settling starts a fresh timeline without scrolling away");
  assert.equal(stage.style.transform, "rotate(180deg)");
  assert.equal(scrubDuringPlayback, 0);
  window.innerWidth = 1280;
  window.innerHeight = 800;

  action("restart", "result");
  nativePhases.clear();
  limitAngle = true;
  scroll(3300);
  runFrames(12, 1000 / 17);
  scroll(3400 + 1600 * 0.9);
  runFrames(27, 1000 / 17);
  assert(nativePhases.has("return"));
  assert.equal(Math.round(cuePhases.at(-1).angle), 135);
  assert(Number(stage.style.scale) < 0.9, "wide stage shrinks during rotation");
  assert.equal(cuePhases.at(-1).cue, "invert", "return copy should stay hidden at 135° when the physics pose lags");
  limitAngle = false;
  scroll(3400 + 1600 * 0.92);
  runFrames(25, 1000 / 17);
  assert.equal(cuePhases.at(-1).cue, "return");
  assert(cuePhases.at(-1).angle >= 330);

  action("restart", "result");
  for (let position = 0; position <= 20; position += 1) {
    scroll(3400 + position * 80);
    runFrames(19);
  }
  scroll(5850);
  assert.equal(stage.style.transform, "rotate(360deg)");
  assert.equal(hooks.result.stats.flipMode, "scroll", "the full scroll path records how the climax was seen");
  assert.equal(inviteVisible, false);

  action("restart", "result");
  const beforeCrossing = controls.length;
  scroll(4120);
  runFrames(40);
  scroll(4760);
  runFrames(65);
  assert(!controls.slice(beforeCrossing).some(({ listening }) => listening), "this scroll passes through 180° without a listening hold");
  scroll(5000);
  runFrames(45);
  scroll(5850);
  assert.equal(stage.style.transform, "rotate(360deg)");
  assert.equal(hooks.result.stats.flipMode, "scroll", "crossing 180° in the visible stage counts without a hold");
  assert.equal(inviteVisible, false);
  if (window.__lt) assert.equal(window.__lt.dump().flip.mode, "scroll");

  action("restart", "result");
  scroll(4120);
  runFrames(40);
  scroll(5850);
  assert.equal(stage.style.transform, "rotate(360deg)");
  assert.equal(hooks.result.stats.flipMode, null, "offscreen settlement must not count as seeing the inversion");
  assert.equal(inviteVisible, true);

  action("restart", "result");
  preference.matches = true;
  preference.dispatchEvent(new Event("change"));
  scroll(4120);
  scroll(4760);
  scroll(5850);
  assert.equal(hooks.result.stats.flipMode, null, "hidden simulation steps in reduced motion do not count");
  assert.equal(inviteVisible, true);

  preference.matches = false;
  preference.dispatchEvent(new Event("change"));
  action("restart", "result");
  vibration.length = 0;
  vibrationHints = 0;
  window.navigator.maxTouchPoints = 5;
  scroll(7650);
  runFrames(160);
  assert.equal(gestureHint, false, "the touch hint stays hidden until after three idle seconds");
  runFrames(30);
  assert.equal(gestureHint, true);
  action("drag-chair", "gesture");
  assert.equal(gestureHint, false, "a keyboard action dismisses the touch hint");
  runFrames(115);
  const scrapes = recordsByScene.at(-1).filter(({ action }) => action === "dragChair");
  assert.equal(scrapes.length, 1, "one S1 chair command produces one scrape record");
  assert.equal(scrapes[0].label, "드르륵");
  assert(scrapes[0].dragDistance > 0);
  scroll(5850);
  assert.deepEqual({ ...hooks.result.upperEvent }, { label: "드르륵", sequence: scrapes[0].sequence });
  assert.equal(hooks.result.peak, scrapes[0].index, "the result summary and the S1 marker use the same scrape peak");
  assert.equal(drawnCard.peak, String(scrapes[0].index));
  scroll(7650);
  action("throw-ball", "gesture");
  runFrames(140);
  assert(recordsByScene.at(-1).some(({ action }) => action === "throwBall"));
  function pointer(type, target, clientX, clientY, pointerType = "touch", coalesced) {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, Object.fromEntries(Object.entries({ target, clientX, clientY, pointerType, timeStamp: time, pointerId: 4, button: 0 })
      .map(([name, value]) => [name, { value }])));
    if (coalesced) event.getCoalescedEvents = () => coalesced;
    gestureStage.dispatchEvent(event);
  }
  const gestureEngine = layoutCalls.at(-1).engine;
  const chairX = gestureEngine.rooms.get(7).props.chair.x;
  const samples = [];
  const pushSample = gestureEngine.pushPointerSample.bind(gestureEngine);
  gestureEngine.pushPointerSample = (timeMs, x) => {
    samples.push({ timeMs, x });
    return pushSample(timeMs, x);
  };
  pointer("pointerdown", gestureChair, chairX, 250);
  runFrames(12);
  assert.equal(holdRing.hidden, false);
  runFrames(8);
  assert.equal(holdRing.hidden, true);
  pointer("pointermove", gestureChair, chairX - 36, 250, "touch", [
    { clientX: chairX - 12, clientY: 250, timeStamp: time - 4 },
    { clientX: chairX - 36, clientY: 250, timeStamp: time },
  ]);
  assert.deepEqual(samples, [{ timeMs: time - 4, x: chairX - 12 }, { timeMs: time, x: chairX - 36 }]);
  runFrames(40);
  pointer("pointerup", gestureChair, chairX - 36, 250);
  runFrames(40);
  assert.equal(recordsByScene.at(-1).filter(({ action }) => action === "dragChair").length, 2);
  pointer("pointerdown", gestureBall, 206, 140);
  runFrames(3);
  pointer("pointermove", gestureBall, 208, 153);
  assert.equal(gestureBall.style.translate, "2px 13px");
  runFrames(3);
  pointer("pointerup", gestureBall, 220, 175);
  assert.equal(gestureBall.style.translate, "");
  runFrames(115);
  const throws = recordsByScene.at(-1).filter(({ action }) => action === "throwBall");
  assert.equal(new Set(throws.map(({ actionId }) => actionId)).size, 2);
  assert.equal(vibration.filter(Array.isArray).length, 0, "live S1 cannot vibrate");
  window.navigator.maxTouchPoints = 0;
  scroll(1110);
  assert.equal(soundHint, false, "the sound hint stays out of a new tape");
  runFrames(300);
  assert(figures.some((entry) => entry.track === "upper" && entry.label === "드르륵" && entry.sequence === scrapes[0].sequence));
  assert.equal(soundHint, true);
  assert.equal(vibrationHints, 0, "the first vibration hint is a page-wide once-only cue");
  assert(vibration.filter(Array.isArray).every(([duration]) => duration > 0 && duration <= 80));
  const beforeSound = suppliedSounds.length;
  sound.dispatchEvent(new Event("click"));
  await Promise.resolve();
  assert.equal(soundStarts, 1);
  assert.equal(sound.dataset.pressed, "true");
  assert.equal(sound.attrs.has("aria-pressed"), false);
  action("replay", "listen");
  runFrames(150);
  assert.equal(soundHint, false);
  assert(suppliedSounds.slice(beforeSound).some(({ downstairs }) => downstairs));
  const beforePausedReplay = vibration.filter(Array.isArray).length;
  pause.dispatchEvent(new Event("click"));
  action("replay", "listen");
  runFrames(3);
  assert.equal(vibration.filter(Array.isArray).length, beforePausedReplay);
  pause.dispatchEvent(new Event("click"));

  const storyRecords = recordsByScene.at(-1).length;
  const audibleStoryRecords = recordsByScene.at(-1).filter(({ index }) => index >= 10).length;
  const matTrials = new Map();
  let currentComparison;
  scenes.cushion.section.addEventListener("cushionchange", ({ detail }) => {
    if (detail.pending) matTrials.set(detail.pending.id, detail.pending);
    currentComparison = detail.comparison;
  });
  scroll(9050);
  runFrames(45);
  const matEngine = layoutCalls.at(-1).engine;
  assert.equal(matEngine.rooms.get(7).props.ball.x, matEngine.width / 2);
  assert.equal(scenes.cushion.section.dataset.matTest, "ready");
  assert.equal(matControls[1].getAttribute("aria-disabled"), "true");
  action("mat-before", "cushion");
  runFrames(145);
  assert.equal(scenes.cushion.section.dataset.matTest, "before");
  assert.equal(matBefore.textContent, "100");
  assert.equal(matFeedback.textContent, "맨바닥 쿵 100.");
  action("mat-lay", "cushion");
  assert.equal(mat.hidden, false);
  assert(matEngine.mat);
  const comparisonText = "같은 높이에서 맨바닥 쿵 100, 매트 위 쿵 56. 쿵 지수가 44% 줄었습니다.";
  const beforeRecapComparisons = recapComparisons.length;
  for (let drop = 0; drop < 3; drop += 1) {
    action("mat-after", "cushion");
    if (drop === 0) {
      for (let frame = 0; frame < 195 && scenes.cushion.section.dataset.matTest !== "done"; frame += 1) runFrames(1);
      assert.equal(lampCue.hidden, true, "the optional lamp cue is still waiting");
      assert.equal(matFeedback.textContent, comparisonText, "the comparison is live as soon as the numbers are ready");
      assert.equal(window.scrollY, 9050);
      assert.equal(recapComparisons.length, beforeRecapComparisons + 1);
      assert.equal(recapComparisons.at(-1).before, 100);
      assert.equal(recapComparisons.at(-1).after, 56, "S6 recap publishes from S5 before the scroll and card settle");
      scroll(5850);
      assert.equal(matFeedback.textContent, comparisonText, "tabbing out immediately preserves the published comparison");
      scroll(9050);
    }
    runFrames(195);
    assert.equal(matFeedback.textContent, drop ? "매트 위 쿵 56." : comparisonText);
  }
  assert.equal(matAfter.textContent, "56");
  assert.equal(matReduction.textContent, "44");
  assert.equal(recapComparisons.length, beforeRecapComparisons + 1, "repeated mat drops do not rewrite the first comparison");
  assert.equal(matResult.hidden, false);
  assert.equal(lampCue.hidden, false);
  assert.deepEqual([...matTrials.values()].map(({ surface }) => surface), ["bare", "mat", "mat", "mat"]);
  const trialHeights = [...matTrials.values()].map(({ command }) => command.y);
  assert(trialHeights.every((height) => height === trialHeights[0]), "S5 uses the same physical height on both surfaces and on repeats");
  assert.equal(recordsByScene.at(-1).length, storyRecords);
  scroll(5850);
  assert.equal(hooks.result.id, "cushioned");
  assert.equal(hooks.result.stats.matDrops, 3);
  assert.equal(hooks.result.stats.n, audibleStoryRecords);
  assert.equal(drawnCard.mat.before, 100);
  assert.equal(drawnCard.mat.after, 56);
  assert(drawnCard.detail.startsWith(`쿵 ${audibleStoryRecords}번 · 끌기 `));
  assert(handedPoses.at(-1).engine.returnPoseReady);
  scroll(6600);
  const previousFrames = engineFrames;
  engineButton.dispatchEvent(new Event("click"));
  assert.equal(engineScrolls.length, 0, "the canvas is not scrolled during click dispatch");
  runFrames(1);
  assert.equal(canvas.hidden, mode === "dist");
  if (mode === "dist") {
    assert.equal(engineScrolls.length, 0, "closing the view does not scroll");
    engineButton.dispatchEvent(new Event("click"));
    runFrames(1);
  }
  assert(engineFrames > previousFrames);
  assert.equal(engineScrolls.length, 1);
  assert.equal(engineScrolls[0].behavior, "smooth");

  window.innerWidth = 390;
  window.innerHeight = 844;
  window.navigator.maxTouchPoints = 5;
  let sensorPermission = "denied", permissionCalls = 0;
  window.DeviceOrientationEvent = { requestPermission() { permissionCalls += 1; return Promise.resolve(sensorPermission); } };
  const orient = (beta, gamma = 0) => window.dispatchEvent(Object.assign(new Event("deviceorientation"), { beta, gamma }));
  action("restart", "result");
  scroll(3720);
  assert.equal(sensorUi.offer, true);
  assert.equal(permissionCalls, 0);
  action("sensor-enable", "flip");
  assert.equal(permissionCalls, 1);
  await new Promise(setImmediate);
  assert.equal(sensorUi.mode, "fallback");
  assert.match(sensorUi.message, /센서를 쓸 수 없어서/);
  sensorPermission = "granted";
  action("sensor-enable", "flip");
  await new Promise(setImmediate);
  orient(25, 60);
  runFrames(2);
  assert.equal(sensorUi.mode, "tilting");
  assert(Number(stage.dataset.gravityX) > 40);
  assert.equal(stage.style.transform, "rotate(0deg)");
  orient(-86);
  runFrames(23);
  assert.equal(sensorUi.mode, "inverted");
  assert(controls.at(-1).listening);
  assert.equal(stage.style.transform, "rotate(0deg)");
  assert.equal(controls.at(-1).inputAllowed, false);
  runFrames(128);
  assert.equal(sensorUi.cue, "S4-19");
  orient(85);
  runFrames(27);
  assert.equal(sensorUi.mode, "returned");
  assert.equal(stage.style.transform, "rotate(360deg)");
  scroll(5850);
  assert.equal(hooks.result.stats.flipMode, "sensor");
  assert.equal(drawnCard.badge, "휴대폰으로 직접 뒤집음");

  action("restart", "result");
  scroll(3720);
  action("sensor-enable", "flip");
  await new Promise(setImmediate);
  orient(25, 60);
  window.screen.orientation.angle = 180;
  window.screen.orientation.dispatchEvent(new Event("change"));
  runFrames(78);
  assert.equal(sensorUi.mode, "fallback");
  assert.equal(sensorUi.message, "");
  assert.equal(sensorUi.cue, "S4-17", "screen-rotation guidance has one cue and no duplicate status");
  assert.equal(stage.style.transform, "rotate(0deg)");
  action("flip", "flip");
  runFrames(167);
  assert.equal(stage.style.transform, "rotate(180deg)");
  window.screen.orientation.angle = 0;

  action("restart", "result");
  scroll(3720);
  action("sensor-enable", "flip");
  await new Promise(setImmediate);
  orient(25, 60);
  scroll(3400 + 1600 * 0.69);
  assert.equal(sensorUi.mode, "tilting");
  assert.equal(stage.style.transform, "rotate(0deg)");
  scroll(3400 + 1600 * 0.72);
  assert.equal(sensorUi.mode, "idle");
  assert.equal(sensorUi.cue, "S4-18");
  runFrames(130);
  assert.equal(stage.style.transform, "rotate(180deg)");

  action("restart", "result");
  preference.matches = true;
  preference.dispatchEvent(new Event("change"));
  scroll(9050);
  const beforeReducedMat = vibration.filter(Array.isArray).length;
  action("mat-before", "cushion");
  assert.equal(scenes.cushion.section.dataset.matTest, "before");
  action("mat-lay", "cushion");
  action("mat-after", "cushion");
  assert.equal(scenes.cushion.section.dataset.matTest, "done");
  assert.equal(matBefore.textContent, "100");
  assert.equal(matAfter.textContent, "56");
  assert.equal(vibration.filter(Array.isArray).length, beforeReducedMat);
  scroll(5850);
  assert.equal(hooks.result.stats.n, 0);
  assert.equal(hooks.result.resultState, "empty", "mat-only sessions have no upstairs records");
  assert.equal(hooks.result.peak, 100, "a mat-only session displays its bare floor peak");
  assert.equal(drawnCard.peak, "100");
  assert.equal(drawnCard.peakX, 0.5);
  assert.equal(hooks.result.detail, "매트 100→56");
  assert.equal(drawnCard.detail, hooks.result.detail);

  action("restart", "result");
  action("drop", "intro", 0.2, 0.4);
  runFrames(105);
  scroll(9050);
  assert.equal(ownHeightCue.hidden, false);
  assert.equal(Number(cushionStage.dataset.dropHeight), 0.4);
  scroll(7650);
  action("drag-chair", "gesture");
  assert(recordsByScene.at(-1).some(({ action, index }) => action === "dragChair" && index > 100));
  scroll(9050);
  assert.equal(ownHeightCue.hidden, true);
  assert.equal(referenceHeightCue.hidden, false);
  assert.equal(Number(cushionStage.dataset.dropHeight), 0.5);
  action("mat-before", "cushion");
  assert.equal(matBefore.textContent, "100");
  scroll(0);
  action("drop", "intro", 0.2, 0);
  runFrames(105);
  scroll(9050);
  assert.equal(Number(cushionStage.dataset.dropHeight), 0.5, "a new session peak cannot change an accepted mat comparison");
  action("mat-lay", "cushion");
  action("mat-after", "cushion");
  assert.equal(matAfter.textContent, "56");

  action("restart", "result");
  action("drop", "intro", 0.2, 0);
  runFrames(105);
  scroll(9050);
  assert.equal(ownHeightCue.hidden, false);
  action("mat-before", "cushion");
  assert.equal(matBefore.textContent, "200");
  action("mat-lay", "cushion");
  action("mat-after", "cushion");
  assert.equal(matAfter.textContent, "114");
  assert.equal(matReduction.textContent, "43");
  scroll(5850);
  assert.equal(hooks.result.peak, 200);

  action("restart", "result");
  action("drop", "intro", 0.2, 1);
  runFrames(105);
  const smallPeak = Math.max(...recordsByScene.at(-1).map(({ index }) => index));
  assert(smallPeak > 0 && smallPeak < 100);
  scroll(9050);
  assert.equal(ownHeightCue.hidden, true);
  assert.equal(referenceHeightCue.hidden, false);
  assert.equal(Number(cushionStage.dataset.dropHeight), 0.5);
  action("mat-before", "cushion");
  action("mat-lay", "cushion");
  action("mat-after", "cushion");
  assert.equal(matBefore.textContent, "100");
  assert.equal(matAfter.textContent, "56");
  assert.equal(matResult.hidden, false);
  const [bareLamp, matLamp] = currentComparison.frames.map(({ lampAngle }) => lampAngle);
  assert(bareLamp > matLamp + 0.1, "the contrast uses the measured peak swing, not the resting pose");
  assert.equal(lampCue.hidden, false);
  scroll(5850);
  assert.equal(hooks.result.peak, smallPeak, "the reference comparison cannot replace a personal peak");
  assert.equal(hooks.result.matHeightSource, "reference");
  assert.equal(drawnCard.mat.heightSource, "reference");
  assert.equal(drawnCard.mat.labelPrefix, "방 절반 높이 · 매트 위에선 쿵 ");

  action("restart", "result");
  scroll(5850);
  assert.equal(inviteVisible, true);
  assert.equal(hooks.result.stats.matComparison, null);
  const revisit = action("cushion-revisit", "result");
  assert.equal(revisit.defaultPrevented, true, "S6 can link to the mat trial before the turn has been seen");
  runFrames(5);
  assert.equal(window.scrollY, scenes.cushion.section.top);
  assert.deepEqual(cushionFocus, ["mat-before"]);
  action("mat-before", "cushion");
  scroll(5850);
  assert.equal(hooks.result.stats.matComparison, null, "a single trial still offers the comparison link");
  // A long smooth scroll may reach a visible S5 slightly off its requested top.
  preference.matches = false;
  preference.dispatchEvent(new Event("change"));
  const previousScrollTo = window.scrollTo;
  let requestedTop;
  const origin = window.scrollY;
  window.scrollTo = ({ top, behavior }) => {
    assert.equal(behavior, "smooth");
    requestedTop = top;
  };
  action("cushion-revisit", "result");
  for (const progress of [0.2, 0.4, 0.6, 0.8, 1]) {
    window.scrollY = origin + (requestedTop - 14 - origin) * progress;
    window.dispatchEvent(new Event("scroll"));
    runFrames(1, 1_100);
    assert.deepEqual(cushionFocus, ["mat-before"], "focus waits while the page is still moving");
  }
  document.dispatchEvent(new Event("scrollend"));
  runFrames(2);
  window.scrollTo = previousScrollTo;
  assert.equal(scenes.cushion.section.getBoundingClientRect().top, 14);
  assert.deepEqual(cushionFocus, ["mat-before", "mat-lay"]);
  preference.matches = true;
  preference.dispatchEvent(new Event("change"));
  action("mat-lay", "cushion");
  action("mat-after", "cushion");
  scroll(5850);
  assert.equal(hooks.result.stats.matComparison.after, 56);
  assert.equal(drawnCard.mat.before, 100);
  action("restart", "result");
  assert.equal(hooks.result.stats.matComparison, null);

  action("restart", "result");
  action("drop", "intro", 0.2, 0);
  runFrames(105);
  const firstPeak = recordsByScene.at(-1)[0];
  assert.equal(firstPeak.index, 200);
  for (let hit = 0; hit < 5; hit += 1) {
    action("tap", "intro", 0.33);
    runFrames(9);
  }
  runFrames(105);
  const upstairs = recordsByScene.at(-1).map(({ sequence }) => sequence);
  scroll(7650);
  const previousSettlements = settledChairInputs;
  action("drag-chair", "gesture");
  assert.equal(settledChairInputs, previousSettlements + 1, "reduced-motion button uses the physics settlement API");
  const reducedScrape = recordsByScene.at(-1).filter(({ action }) => action === "dragChair");
  assert.equal(reducedScrape.length, 1);
  assert(reducedScrape[0].index > 0 && reducedScrape[0].index <= 200);
  action("throw-ball", "gesture");
  assert(upstairs.every((sequence) => recordsByScene.at(-1).some((event) => event.sequence === sequence)),
    "a reduced throw preserves recent S0 events despite synthetic physical time");
  const arrivingAtReplay = figures.length;
  scroll(1110);
  runFrames(130);
  const initialReplayCount = figures.filter(({ track }) => track === "upper").length;
  assert(figures.slice(arrivingAtReplay).some(({ track, sequence, index }) => track === "upper" && sequence === firstPeak.sequence && index === 200));
  scroll(7650);
  action("throw-ball", "gesture");
  assert.equal(figures.filter(({ track }) => track === "upper").length, initialReplayCount, "throwing does not restart S2 playback");

  time += 15_100;
  scroll(0);
  for (let hit = 0; hit < 13; hit += 1) {
    action("tap", "intro", 0.33);
    runFrames(9);
  }
  runFrames(105);
  const pinned = recordsByScene.at(-1);
  assert.equal(pinned.length, 12);
  assert.equal(pinned.filter(({ sequence }) => sequence === firstPeak.sequence).length, 1);
  scroll(1110);
  const replayStart = figures.length;
  action("replay", "listen");
  assert.equal(figures.length, replayStart, "a reduced S2 tape does not settle inside the click");
  runFrames(1);
  assert(figures.length > replayStart && figures.length - replayStart < 12, "one static batch processes only part of the tape");
  runFrames(24);
  const replay = figures.slice(replayStart).filter(({ track }) => track === "upper");
  assert.equal(replay.length, 12);
  assert.equal(replay.filter(({ sequence, index }) => sequence === firstPeak.sequence && index === 200).length, 1);
  scroll(5850);
  assert.equal(hooks.result.peak, 200);
  assert.equal(drawnCard.peak, "200");
  assert(drawnCard.events.every(([, index]) => index < 200), "the card peak is independent from the last 12 PNG events");
  assert.equal(drawnCard.peakX, firstPeak.point.x / layoutCalls.at(-1).engine.width);

  function compareInputModes(reduced) {
    preference.matches = reduced;
    preference.dispatchEvent(new Event("change"));
    action("restart", "result");
    scroll(0);
    for (let hit = 0; hit < 6; hit += 1) {
      action("tap", "intro", 0.33);
      runFrames(9);
    }
    runFrames(105);
    scroll(5850);
    const { id, stats: { n, burst } } = hooks.result;
    action("restart", "result");
    scroll(0);
    const engine = layoutCalls.at(-1).engine;
    const firstId = engine.nextActionId;
    for (let hit = 0; hit < 12; hit += 1) {
      action("drop", "intro", 0.2, 0);
      runFrames(6);
    }
    return { id, n, burst, accepted: engine.nextActionId - firstId };
  }
  const ordinaryInput = compareInputModes(false);
  assert.equal(ordinaryInput.n, 6);
  assert.equal(ordinaryInput.burst, 6);
  assert.equal(ordinaryInput.id, "drummer");
  assert(ordinaryInput.accepted < 12, "the real-time drop queue is bounded");
  assert.deepEqual(compareInputModes(true), ordinaryInput, "motion preference keeps the same burst type and queue limit");
  const droppingEngine = layoutCalls.at(-1).engine;
  const outstanding = [...droppingEngine.pendingDrops.keys()];
  const cancelled = [];
  droppingEngine.onInputCancelled((event) => cancelled.push(event));
  assert(outstanding.length > 0);
  scroll(3400 + 1600 * 0.65);
  assert.deepEqual(cancelled.map(({ actionId }) => actionId), outstanding);
  assert(cancelled.every(({ reason }) => reason === "rotation"));
  assert(recordsByScene.at(-1).every(({ actionId }) => !outstanding.includes(actionId)));

  // The published S3 is one viewport high, with progress measured as it enters view.
  preference.matches = false;
  preference.dispatchEvent(new Event("change"));
  window.innerHeight = 800;
  const relay = scenes.relay.section;
  relay.height = scenes.relay.panel.height;
  const relayRecords = (start) => figures.slice(start).filter(({ scene, receiverRoom }) => scene === "relay" && receiverRoom === 5);
  action("restart", "result");
  const automaticStart = figures.length;
  scroll(relay.top - window.innerHeight * 0.17);
  runFrames(15);
  assert.equal(controls.at(-1).chairAllowed, true, "S3 remains interactive before progress 0.8");
  scroll(relay.top - window.innerHeight * 0.15);
  assert.equal(controls.at(-1).chairAllowed, false, "progress 0.8 triggers without waiting for the dwell");
  runFrames(60);
  assert.equal(relayRecords(automaticStart).length, 1, "the 6F → 5F beat lands within the ordinary scroll deadline");
  runFrames(115);
  assert.equal(relayRecords(automaticStart).length, 1, "the earlier progress trigger cancels the dwell timer");

  action("restart", "result");
  const manualStart = figures.length;
  scroll(relay.top - window.innerHeight * 0.17);
  action("nudge", "relay");
  scroll(relay.top);
  runFrames(175);
  assert.equal(relayRecords(manualStart).length, 1, "a manual nudge takes precedence over both automatic triggers");

  action("restart", "result");
  preference.matches = true;
  preference.dispatchEvent(new Event("change"));
  const reducedBeatStart = figures.length;
  const reducedBeats = () => figures.slice(reducedBeatStart).filter(({ cue }) => cue === "s4-chair");
  scroll(3400 + 1600 * 0.65);
  assert(controls.at(-1).listening);
  assert.equal(root.getAttribute("data-climax-wipe"), undefined, "reduced listening never starts a wipe");
  runFrames(15);
  assert.equal(reducedBeats().length, 0, "reduced motion shows the explanation before the impact");
  runFrames(25);
  assert.equal(reducedBeats().length, 1);
  runFrames(45);
  assert.equal(reducedBeats().length, 1);

  action("restart", "result");
  const interruptedBeatStart = figures.length;
  scroll(3400 + 1600 * 0.65);
  runFrames(15);
  scroll(5850);
  runFrames(45);
  assert(!figures.slice(interruptedBeatStart).some(({ cue }) => cue === "s4-chair"),
    "leaving the listening scene cancels an unheard chair cue");

  expandedListening = true;
  preference.matches = false;
  preference.dispatchEvent(new Event("change"));
  action("restart", "result");
  const flipSection = scenes.flip.section;
  const panelHeight = scenes.flip.panel.height;
  const scrollMap = window.LandingBuilding.createClimaxScrollMap({
    travel: flipSection.height - panelHeight, panelHeight, viewportHeight: window.innerHeight,
  });
  assert(scrollMap.listenEnd - scrollMap.listenStart >= window.innerHeight - 0.001);
  let slabFrame;
  window.LandingArt.climaxFrame = (frame) => { slabFrame = frame; };
  const scrollBeatStart = figures.length;
  scroll(flipSection.top + scrollMap.listenStart + window.innerHeight / 2);
  for (let frame = 0; frame < 90 && !controls.at(-1).listening; frame += 1) runFrames(1);
  assert.equal(controls.at(-1).listening, true);
  assert.equal(controls.at(-1).flipDisabled, false, "scroll-based listening can return before the chair beat");
  assert.equal(figures.slice(scrollBeatStart).filter(({ cue }) => cue === "s4-chair").length, 0);
  runFrames(195);
  assert.equal(stage.style.transform, "rotate(180deg)");
  assert.equal(figures.slice(scrollBeatStart).filter(({ cue }) => cue === "s4-chair").length, 1);
  for (const angle of [323.75, 329.9, 330, 336.25, 323.75, 360, 323.75]) {
    const progress = angle === 360 ? 0.97 : 0.75 + 0.2 * (angle / 180 - 1);
    scroll(flipSection.top + scrollMap.offsetAt(progress));
    runFrames(72);
    const inverted = angle < 330;
    const expectedCue = inverted ? "returning" : angle === 360 ? "settle" : "return";
    assert(Math.abs(slabFrame.frame.angle * 180 / Math.PI - angle) < 0.001);
    assert.equal(slabFrame.phase, expectedCue);
    assert.equal(slabFrame.inverted, inverted, "rewinding below 330° restores the inverted names");
    const stableStart = cuePhases.length;
    runFrames(12);
    assert.equal(cuePhases.length - stableStart, 12);
    assert.deepEqual([...new Set(cuePhases.slice(stableStart).map(({ cue }) => cue))], [expectedCue]);
  }
  action("restart", "result");
  scroll(flipSection.top + scrollMap.offsetAt(0.23));
  root.dispatchEvent(focus);
  assert.equal(window.scrollY, flipSection.top + scrollMap.offsetAt(0.2));
  const buttonBeatStart = figures.length;
  action("flip", "flip");
  runFrames(100);
  assert.equal(controls.at(-1).listening, true);
  assert.equal(controls.at(-1).flipDisabled, true, "the button is locked until the inversion playback releases it");
  runFrames(140);
  assert.equal(controls.at(-1).flipDisabled, false);
  scroll(flipSection.top + (scrollMap.listenStart + scrollMap.listenEnd) / 2);
  runFrames(90);
  assert.equal(stage.style.transform, "rotate(180deg)");
  assert.equal(figures.slice(buttonBeatStart).filter(({ cue }) => cue === "s4-chair").length, 1);
  scroll(flipSection.top + scrollMap.offsetAt(0.95));
  runFrames(120);
  assert.equal(stage.style.transform, "rotate(360deg)");
  assert.equal(controls.at(-1).flipSeen, true);
  const focusBeforeS4Next = cushionFocus.length;
  assert.equal(action("s4-next", "flip").defaultPrevented, true);
  runFrames(10);
  assert.equal(window.scrollY, scenes.cushion.section.top);
  runFrames(120);
  assert.deepEqual(cushionFocus.slice(focusBeforeS4Next), ["mat-before"]);

  action("restart", "result");
  scroll(0);
  action("drop", "intro", 0.2);
  runFrames(75);
  action("drop", "intro", 0.4, 0);
  runFrames(115);
  const recordedTape = recordsByScene.at(-1);
  const laterPeak = recordedTape.find(({ index }) => index === 200);
  assert.equal(recordedTape[0]?.index, 100);
  assert(laterPeak.sequence > recordedTape[0].sequence);
  scroll(1110);
  runFrames(270);
  assert.equal(replaySummaries.at(-1), laterPeak, "the later, louder drop owns the automatic replay summary");
  const secondTake = figures.length;
  action("replay", "listen");
  runFrames(270);
  assert.equal(replaySummaries.at(-1), laterPeak);
  assert.deepEqual(figures.slice(secondTake).filter(({ track, highlight }) => track === "upper" && highlight)
    .map(({ sequence }) => sequence), [laterPeak.sequence]);

  const readyScroll = flipSection.top + scrollMap.offsetAt(0.2);
  const listenScroll = flipSection.top + scrollMap.offsetAt(0.62);
  scroll(readyScroll);
  scroll(listenScroll);
  runFrames(125);
  assert.equal(stage.style.transform, "rotate(180deg)");
  assert.equal(root.getAttribute("data-climax-wipe"), "", "entering listen with motion starts a wipe");
  pause.dispatchEvent(new Event("click"));
  const listeningTick = stage.dataset.motionTick;
  runFrames(30);
  assert.equal(stage.dataset.motionTick, listeningTick);
  assert.equal(cuePhases.at(-1).cue, "listen", "pausing at 180° keeps the listening title");
  assert.equal(root.getAttribute("data-climax-wipe"), undefined);
  pause.dispatchEvent(new Event("click"));
  runFrames(35);
  assert.equal(cuePhases.at(-1).cue, "listen");
  assert.equal(root.getAttribute("data-climax-wipe"), undefined, "resuming in the same listening phase does not start another wipe");
  scroll(readyScroll);
  runFrames(125);
  scroll(listenScroll);
  runFrames(125);
  assert.equal(root.getAttribute("data-climax-wipe"), "", "a new listening entry can wipe again");

  action("restart", "footer");
  scroll(readyScroll);
  pause.dispatchEvent(new Event("click"));
  scroll(listenScroll);
  runFrames(30);
  assert.equal(stage.style.transform, "rotate(0deg)", "scroll alone does not rotate a paused stage");
  action("flip", "flip");
  assert.equal(stage.style.transform, "rotate(180deg)", "the explicit button works while paused");
  assert.equal(cuePhases.at(-1).cue, "listen");
  assert.equal(root.getAttribute("data-climax-wipe"), undefined);

  pause.dispatchEvent(new Event("click"));
  action("restart", "footer");
  window.innerWidth = 320;
  window.innerHeight = 568;
  const relayOnlyFigures = figures.length;
  scroll(2350);
  action("nudge", "relay");
  runFrames(150);
  assert(figures.slice(relayOnlyFigures).some(({ scene, index }) => scene === "relay" && index === 141));
  scroll(9050);
  runFrames(50);
  action("mat-before", "cushion");
  runFrames(145);
  action("mat-lay", "cushion");
  const relayOnlyComparisons = recapComparisons.length;
  action("mat-after", "cushion");
  for (let frame = 0; frame < 195 && recapComparisons.length === relayOnlyComparisons; frame += 1) runFrames(1);
  assert.deepEqual([recapComparisons.at(-1).before, recapComparisons.at(-1).after], [100, 56]);
  assert.equal(recapComparisons.length, relayOnlyComparisons + 1);
  scroll(5850);
  runFrames(75);
  assert.equal(hooks.result.resultState, "empty");
  assert.equal(hooks.result.heardChairIndex, undefined);
  assert.equal(hooks.result.stats.matComparison.reduction, 0.44);

  lifecycle.abort();
  assert.equal(frames.size, 0);
  if (layoutObserver) assert.equal(layoutObserver.disconnected, true);
  assert.equal(window.__lt, undefined);
  assert(artStages.every((stage) => stage.children.every((element) => element.removed)));
  console.log(mode, "S0 낙하·탭, S1 끌기·던지기, S2 재진입·재생·소리·진동, S4 반전·의자 재생·센서, S5 기준 높이·반복, S6 복귀·요약·카드, 엔진 보기 검증");
}
