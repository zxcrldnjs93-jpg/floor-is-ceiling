const CARD_FILENAME = "중력을-뒤집으면-카드.png";

async function prototypeModule(name, imports) {
  const specifier = `@landing/engines/${name}.js`;
  if (!Object.hasOwn(imports, specifier)) return null;
  return import(specifier);
}

export async function loadAdapters() {
  const imports = JSON.parse(document.querySelector('script[type="importmap"]').textContent).imports;
  const load = (name) => prototypeModule(name, imports);
  const [physics, motion, type, card, audio, haptics, engineView] = await Promise.all([
    load("physics-building"), load("motion"), load("fx-type"), load("fx-card"), load("fx-audio"), load("fx-haptics"), load("fx-engine-view"),
  ]);
  if (motion) await load("motion-building");
  return { physics, buildingMotion: window.LandingBuilding, type, card, audio, haptics, engineView };
}

export function startBuildingAction(building, action, x, y) {
  if (action === "nudge") return building.input({ type: "nudgeChair" });
  if (action === "tap") return building.input({ type: "tap", x });
  return building.input({ type: "dropBall", x, y });
}

export function previewDropColumn(building, clearDropColumn, x, height) {
  const room = building.rooms.get(7);
  const { ball } = room.props;
  const { radius } = ball.shape;
  const requested = room.top + height * (room.bottom - room.top);
  const y = Math.max(room.top + radius, Math.min(room.bottom - radius - 5.5, requested));
  const column = clearDropColumn(room, ball, x * building.width, y, building.width);
  return column === undefined ? undefined : column / building.width;
}

export function connectStage(motion, hooks, onFadeRest) {
  const waves = new Map();
  const stage = hooks.stage;
  const desktopPointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  let view, fade, labelState, lastLabels, timelinePhase;
  let chairWaveLayer;
  let fadeProgress = 0;
  let still = false;

  function showSlabLabels(progress) {
    const returned = fadeProgress > 0 && progress === 0;
    fadeProgress = progress;
    if (returned && labelState?.reduced) {
      const phase = motion.visibleClimaxCue(timelinePhase, labelState.frame.angle, { invertedOpacity: 0 });
      if (phase === "return" || phase === "settle") {
        labelState = { ...labelState, phase, inverted: false };
        onFadeRest?.(phase);
      }
    }
    const draw = window.LandingArt?.climaxFrame;
    if (!draw) return;
    const { frame: { angle, scale, offsetY, width, height }, phase, inverted, sensor, reduced } = labelState;
    const signature = [angle, scale, offsetY, width, height, phase, inverted, sensor, reduced, progress].join();
    if (signature === lastLabels) return;
    lastLabels = signature;
    draw({ ...labelState, progress });
  }

  return {
    get invertedOpacity() { return fade ? fadeProgress : 0; },
    reset(angle) {
      view = motion.createClimaxView(angle);
    },
    record(angle, snap = false) { view.record(angle, { snap }); },
    sample({ alpha, zoom, paused, reduced, sensor }) {
      const width = stage?.clientWidth || window.innerWidth;
      const height = stage?.clientHeight || window.innerHeight;
      return { ...view.sample({ alpha, zoom: sensor ? 1 : zoom, width, height,
        paused, reduced, sensor, desktop: desktopPointer.matches }), width, height };
    },
    render({ building, tick, frame, phase, timelinePhase: rawPhase, paused, reduced, animate, sensor, listening }) {
      if (!stage) return;
      stage.dataset.gravityX = String(building.world.gx);
      stage.dataset.gravityY = String(building.world.gy);
      stage.dataset.motionTick = String(tick);
      const angle = frame.angle * 180 / Math.PI;
      const inverted = listening || (!sensor && phase === "returning");
      timelinePhase = rawPhase;
      labelState = { frame, phase, inverted, sensor, reduced };
      const turnedCopy = stage.querySelectorAll("[data-building-upright]");
      if (sensor) {
        fade?.destroy();
        fade = null;
        stage.style.transform = "rotate(0deg)";
        stage.style.scale = stage.style.translate = "";
        for (const node of turnedCopy) node.style.rotate = "";
      } else if (reduced && motion.createPageFlip) {
        for (const node of turnedCopy) node.style.rotate = "";
        if (!fade) {
          stage.style.scale = stage.style.translate = "";
          fade = motion.createPageFlip(stage, { reduced: true, onFrame: showSlabLabels });
        }
        fade.setListeningFrame(motion.climaxListeningFrame(Math.PI, { width: frame.width, height: frame.height }));
        fade.setPaused(paused);
        if (animate && !paused) fade.setFlipped(listening);
        else if (fade.flipped !== listening) fade.seek(Number(listening));
      } else {
        fade?.destroy();
        fade = null;
        stage.style.transform = `rotate(${angle}deg)`;
        stage.style.scale = String(frame.scale);
        stage.style.translate = `0 ${frame.offsetY}px`;
        for (const node of turnedCopy) node.style.rotate = `${-angle}deg`;
      }
      showSlabLabels(fade ? fadeProgress : Number(inverted));
      const staticFrame = paused || reduced;
      if (still !== staticFrame) {
        still = staticFrame;
        for (const wave of waves.values()) wave.setReduced(still);
      }
    },
    pulse(key, event, building, x = event.point.x / building.width) {
      const layer = hooks.waveLayer ? hooks.waveLayer(key, event) : hooks.scenes[key]?.wave;
      if (!layer || !motion) return;
      if (key === "flip") chairWaveLayer = layer;
      if (!waves.has(layer)) waves.set(layer, motion.createSlabWave(layer, { fullImpulse: Math.log1p(100), reduced: still }));
      const slab = building.slabs.find((slab) => slab.id === event.slab);
      waves.get(layer).pulse({
        impulse: Math.log1p(event.index), x,
        direction: slab?.above === event.receiverRoom ? -1 : 1,
      });
    },
    clearChairWave() {
      waves.get(chairWaveLayer)?.destroy();
      waves.delete(chairWaveLayer);
      chairWaveLayer = undefined;
    },
    destroy() {
      fade?.destroy();
      fade = null;
      lastLabels = undefined;
      for (const wave of waves.values()) wave.destroy();
      waves.clear();
      chairWaveLayer = undefined;
    },
  };
}

export function createCardEffects(card, type, hooks) {
  let png;
  let current;
  let pending;

  function pageUrl() {
    const canonical = document.querySelector('link[rel="canonical"]')?.href;
    const { origin, pathname, protocol } = window.location;
    return canonical || (/^https?:$/.test(protocol) ? origin + pathname : null);
  }

  async function exportPng(result, record, demoUrl) {
    const canvas = document.createElement("canvas");
    const events = record.events.slice(-12);
    const art = window.LandingArt;
    if (!art?.drawCard) return null;
    await art.drawCard(canvas, {
      title: result.title, copy: result.copy, peak: String(result.peak), peakX: result.peakX,
      label: "최대 쿵", detail: result.detail, url: demoUrl ?? "",
      events: events.map(({ x, index }) => [x, index]),
      mat: result.matLine ? { ...result.stats.matComparison, heightSource: result.matHeightSource, labelPrefix: result.matLabelPrefix } : undefined,
      badge: result.badge,
    });
    return card.exportCardPng(canvas);
  }

  function show(record, pose) {
    if (!type) return;
    const classification = type.classifyBehavior(record, { enableV11: true });
    const { n, drag, peak: sessionPeak } = classification.stats;
    const peak = type.displayedPeak(sessionPeak);
    const peakX = record.peakX ?? 0.5;
    const mat = classification.stats.matComparison;
    let detail = `쿵 ${n}번${drag > 0 ? ` · 끌기 ${Math.round(drag * 10) / 10}칸` : ""}`;
    if (!record.events.length && Number.isFinite(record.matBefore ?? mat?.before)) {
      detail = mat ? `매트 ${type.displayedPeak(mat.before)}→${type.displayedPeak(mat.after)}` : `맨바닥 ${peak}`;
    }
    const resultState = record.events.length ? "done" : "empty";
    const matEmpty = resultState === "empty" && record.matBefore != null ? "mat" : "none";
    const matHeightSource = record.matHeightSource;
    const matLabelPrefix = matHeightSource === "reference" ? "방 절반 높이 · 매트 위에선 쿵 " : "매트 위에선 쿵 ";
    const result = { ...classification, detail, peak, peakX, resultState, matEmpty, matHeightSource, matLabelPrefix,
      upperEvent: record.upperEvent, chairIndex: record.chairIndex, heardChairIndex: record.heardChairIndex };
    const demoUrl = pageUrl();
    hooks.showResult(result, demoUrl);
    hooks.syncCardPose?.(pose);
    if (!card) return;
    current = result;
    png = null;
    pending = exportPng(result, record, demoUrl).then((blob) => {
      if (current === result) png = blob;
      return blob;
    }).catch(() => null);
  }

  return {
    show,
    async save() {
      const blob = png ?? await pending;
      return blob && card.downloadCardPng(blob, CARD_FILENAME) ? "카드 저장을 시작했습니다." : "카드를 저장할 수 없습니다.";
    },
    async share() {
      const url = pageUrl();
      if (!url) return "공개 주소가 준비되면 링크를 공유할 수 있습니다.";
      if (card) {
        const outcome = await card.shareCard({ png, result: current, demoUrl: url, title: document.title, filename: CARD_FILENAME });
        if (outcome.status === "shared") return "공유를 열었습니다.";
        if (outcome.status === "cancelled") return "공유를 취소했습니다.";
        if (outcome.copied) return "링크를 복사했습니다.";
      }
      hooks.showShareUrl(url);
      return "공유할 주소를 표시했습니다.";
    },
  };
}
