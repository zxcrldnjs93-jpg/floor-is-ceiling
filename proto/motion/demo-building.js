(function () {
  "use strict";

  const { createMotion } = window.LandingMotion;
  const {
    createFloorDisplay, createFloorDescent, createSlabWave, createClimaxTimeline, climaxRotationScale,
    createClimaxScrollMap, visibleClimaxCue, climaxImpactMarker, connectClimaxPhysics, createClimaxReturnPose, createCushionTimeline, sampleIntroExtension,
  } = window.LandingBuilding;
  const building = document.getElementById("descent");
  const viewport = document.getElementById("descent-viewport");
  const status = document.getElementById("floor-status");
  const floorCopy = document.getElementById("floor-copy");
  const impactLevel = document.getElementById("impact-level");
  const impactControls = document.getElementById("impact-controls");
  const introExtension = document.getElementById("intro-extension");
  const pauseButtons = ["pause-motion", "pause-flip", "pause-cushion"].map((id) => document.getElementById(id));
  const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
  const displayFloor = createFloorDisplay(document.getElementById("floor-led"), status);
  const waves = new Map([...building.querySelectorAll("[data-wave]")].map((layer) =>
    [layer.dataset.wave, createSlabWave(layer, { fullImpulse: 320 })]));
  const copy = {
    7: "여기는 7층, 당신의 집입니다. 바닥을 톡 눌러 보세요.",
    6: "6층에서는, 같은 충돌이 천장에서 시작됩니다.",
    5: "5층에 내려오면, 6층도 누군가의 위층입니다.",
  };

  let currentFloor = 7;
  let paused = false;
  let lastTopImpact;
  const pauseKey = "landingthon-building-demo-paused";
  try { paused = localStorage.getItem(pauseKey) === "true"; } catch {}

  const descent = createFloorDescent(document.getElementById("vertical-stack"), {
    onFloorChange(floor, { previousFloor }) {
      currentFloor = floor;
      displayFloor(floor);
      floorCopy.textContent = copy[floor];
      if (floor === 6 && previousFloor === 7 && lastTopImpact) waves.get("replay").pulse(lastTopImpact);
    },
  });

  const motion = createMotion();
  const climax = mountClimax(motion);
  const cushion = mountCushion();
  const extensionShare = 80 / (80 + 195);
  function renderDescent(progress, reduced) {
    const extension = sampleIntroExtension(progress / extensionShare, { reduced });
    introExtension.hidden = !extension.active || progress > extensionShare;
    introExtension.style.opacity = extension.reveal;
    descent(Math.max(0, (progress - extensionShare) / (1 - extensionShare)), { reduced });
  }
  const scene = motion.addScene(building, {
    followReducedProgress: true,
    onProgress(progress, { reduced }) { renderDescent(progress, reduced || paused); },
  });

  function onImpact({ impulse, x, source }) {
    const impact = { impulse, x };
    const wave = waves.get(String(currentFloor)).pulse(impact);
    if (wave) {
      impactLevel.textContent = `쿵 지수(상대값) ${Math.round(wave.strength * 100)}`;
      impactLevel.dataset.impactSource = source;
      if (currentFloor === 7) lastTopImpact = impact;
    }
  }

  function fileImpact(height, x) {
    // A single vertical collision in the file demo: J = m(1 + e)√(2gh).
    const mass = 0.7;
    const gravity = 960;
    const restitution = 0.2;
    onImpact({ impulse: mass * (1 + restitution) * Math.sqrt(2 * gravity * height), x, source: "analytic" });
  }

  let resolveImpact = fileImpact;

  function usePhysics(World) {
    if (typeof World.prototype.onImpact !== "function") return;
    const width = 480;
    const world = new World({ gy: 960 });
    const slab = world.add({ x: width / 2, y: 88, width, height: 12, fixed: true, restitution: 0.2 });
    const ball = world.add({ x: width / 2, y: 50, radius: 6, mass: 0.7, restitution: 0.2 });
    let measured = false;
    world.onImpact(({ a, b, point, normalImpulse, closingSpeed }) => {
      if (!measured && (a === slab || b === slab) && closingSpeed >= 12) {
        measured = true;
        onImpact({ impulse: normalImpulse, x: point.x / width, source: "physics" });
      }
    });
    resolveImpact = (height, x) => {
      measured = false;
      ball.vx = ball.vy = ball.spin = 0;
      world.move(ball, Math.max(6, Math.min(width - 6, x * width)), 76 - height, 0);
      for (let step = 0; step < 60 && !measured; step += 1) world.step(1 / 120);
      if (!measured) fileImpact(height, x);
    };
  }

  if (location.protocol === "http:" || location.protocol === "https:") {
    import("../physics/engine.js").then(({ World }) => usePhysics(World)).catch(() => {});
    import("../physics/building.js").then(({ createBuilding }) => {
      climax.attachPhysics(createBuilding());
      cushion.attachPhysics(createBuilding);
    }).catch(() => {});
  }

  function syncMotion() {
    const reduced = motionPreference.matches || paused;
    for (const wave of waves.values()) wave.setReduced(reduced);
    climax.setReduced(reduced);
    cushion.setReduced(reduced);
    renderDescent(scene.progress, reduced);
    for (const button of pauseButtons) {
      button.setAttribute("aria-pressed", reduced);
      button.disabled = motionPreference.matches;
    }
  }

  for (const button of impactControls.querySelectorAll("[data-drop]")) {
    button.addEventListener("click", () => resolveImpact(Number(button.dataset.drop), 0.53));
  }
  viewport.addEventListener("click", (event) => {
    if (!event.target.matches(".slab")) return;
    const bounds = viewport.getBoundingClientRect();
    resolveImpact(14, (event.clientX - bounds.left) / bounds.width);
  });
  for (const button of pauseButtons) {
    button.addEventListener("click", () => {
      paused = !paused;
      try { localStorage.setItem(pauseKey, String(paused)); } catch {}
      syncMotion();
    });
  }
  motionPreference.addEventListener("change", syncMotion);
  syncMotion();

  impactControls.hidden = false;
  for (const button of pauseButtons) button.hidden = false;

  function mountClimax(controller) {
    const byId = (id) => document.getElementById(id);
    const section = byId("climax");
    const panel = section.querySelector("[data-motion-sticky]");
    const button = byId("flip-gravity");
    const caption = byId("flip-status");
    const camera = byId("climax-camera");
    const live = byId("climax-live");
    const upright = byId("climax-upright");
    const inverted = byId("climax-inverted");
    const settled = byId("climax-settled");
    const marker = byId("climax-chair-marker");
    const markerText = marker.querySelector("text");
    const timeline = createClimaxTimeline({ eventTarget: section, holdButtonToListenEnd: true });
    const captions = {
      zoom: "세 집이 한 줄로 쌓여 있습니다.",
      ready: "계속 내리면 건물이 돕니다.",
      invert: "",
      listen: "이제 당신이 아래층입니다.",
      returning: "",
      return: "중력이 돌아오면 —",
      settle: "우리는 모두 누군가의 위층이고, 누군가의 아래층입니다.",
    };

    let frame = 0;
    let previousTime;
    let carry = 0;
    let visible = typeof IntersectionObserver !== "function";
    let physics;
    let returnPose;
    let needsPose = true;
    let heardChair = false;
    let chairMarker;
    let bodies = [];
    let stageAspect = panel.clientWidth / panel.clientHeight;

    function render() {
      const { phase, zoom, reduced, blend, angle, stageAngle, stageAngleDegrees, listening } = timeline.state;
      const action = timeline.state.button;
      button.hidden = !action && document.activeElement !== button;
      button.setAttribute("aria-disabled", !action);
      const label = action === "return" ? "원래대로 돌리기" : "중력 뒤집기";
      if (action && button.textContent !== label) button.textContent = label;
      const cue = visibleClimaxCue(phase, stageAngle, { listening, invertedOpacity: reduced ? blend : 0 });
      const showMarker = cue === "listen" && Boolean(chairMarker);
      const text = showMarker
        ? "이제 당신이 아래층입니다. 6층의 의자 소리입니다."
        : captions[cue];
      if (caption.textContent !== text) caption.textContent = text;
      marker.toggleAttribute("hidden", !showMarker);

      camera.style.transform = `scale(${reduced ? 1 : 3 - 2 * zoom})`;
      live.style.opacity = reduced ? 0 : 1;
      live.style.transform = reduced ? "" : `rotate(${stageAngleDegrees}deg)`;
      live.style.scale = reduced ? "" : String(climaxRotationScale(stageAngle, stageAspect));
      upright.style.opacity = reduced && angle <= Math.PI ? 1 - blend : 0;
      inverted.style.opacity = reduced ? blend : 0;
      settled.style.opacity = reduced && angle > Math.PI ? 1 - blend : 0;
      if (!reduced) {
        for (const { body, element } of bodies) {
          const { x, y, angle: rotation } = body.pose();
          element.setAttribute("transform", `translate(${x} ${y}) rotate(${rotation * 180 / Math.PI})`);
        }
      }
    }

    function needsStaticChair() {
      return physics && visible && !paused && timeline.state.reduced && timeline.state.listening && !chairMarker;
    }

    function schedule() {
      if (frame || document.hidden) return;
      if (timeline.state.moving || needsStaticChair() || (physics && visible && !timeline.state.reduced)) {
        previousTime ??= performance.now();
        frame = requestAnimationFrame(tick);
      } else {
        previousTime = undefined;
        carry = 0;
      }
    }

    function alignPhysics() {
      if (!physics || !visible || !needsPose) return;
      // Align once before revealing physics after a static or offscreen pose.
      const targetAngle = timeline.state.angle;
      let previousAngle;
      while (Math.abs(physics.angle - targetAngle) > 1e-9 && physics.angle !== previousAngle) {
        previousAngle = physics.angle;
        physics.step();
      }
      needsPose = false;
    }

    function startChairCue() {
      if (timeline.state.listening && physics.listening && !heardChair) heardChair = physics.replayChairCue();
    }

    function tick(now) {
      frame = 0;
      const seconds = Math.max(0, (now - (previousTime ?? now)) / 1000);
      previousTime = now;
      if (physics && visible && !timeline.state.reduced) {
        alignPhysics();
        carry += seconds;
        while (carry >= physics.dt) {
          timeline.advance(physics.dt);
          physics.step();
          returnPose.update(timeline.state);
          startChairCue();
          carry -= physics.dt;
        }
      } else {
        const wasListening = timeline.state.listening;
        timeline.advance(seconds);
        if (needsStaticChair()) {
          alignPhysics();
          startChairCue();
          carry = wasListening ? carry + seconds : 0;
          while (carry >= physics.dt && !chairMarker) {
            physics.step();
            carry -= physics.dt;
          }
        }
      }
      render();
      schedule();
    }

    section.addEventListener("climaxchange", ({ detail }) => {
      if (!detail.listening) {
        heardChair = false;
        chairMarker = undefined;
      }
      if (detail.reduced || detail.skipped) needsPose = true;
    });

    function syncProgress() {
      const bounds = section.getBoundingClientRect();
      const panelHeight = panel.getBoundingClientRect().height;
      const map = createClimaxScrollMap({ travel: bounds.height - panelHeight, panelHeight, viewportHeight: window.innerHeight });
      if (bounds.bottom <= 0) timeline.skip();
      else timeline.scrub(map?.progressAt(-bounds.top) ?? scene.progress);
      render();
      schedule();
    }

    const scene = controller.addScene(section, {
      followReducedProgress: true,
      onProgress: syncProgress,
    });

    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(([{ contentRect }]) => {
        stageAspect = contentRect.width / contentRect.height;
        syncProgress();
      });
      observer.observe(panel);
    }
    window.addEventListener("resize", () => {
      stageAspect = panel.clientWidth / panel.clientHeight;
      syncProgress();
    });

    if (typeof IntersectionObserver === "function") {
      const observer = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (!visible && entry.boundingClientRect.bottom <= 0 && scene.progress === 1) {
          timeline.skip();
          render();
        }
        if (visible) needsPose = true;
        schedule();
      });
      observer.observe(section);
    }

    button.addEventListener("click", () => {
      if (!timeline.activate()) return;
      previousTime = performance.now();
      carry = 0;
      render();
      schedule();
    });
    button.addEventListener("blur", () => { if (!timeline.state.button) button.hidden = true; });
    document.addEventListener("visibilitychange", () => { previousTime = undefined; carry = 0; schedule(); });

    return {
      setReduced(reduced) {
        timeline.setReduced(reduced);
        carry = 0;
        if (!reduced) alignPhysics();
        render();
        schedule();
      },
      attachPhysics(building) {
        physics = building;
        building.onReceive((event) => {
          const mark = climaxImpactMarker(event, building.width, timeline.state.listening);
          if (!mark) return;
          chairMarker = mark;
          const { width, height } = camera.viewBox.baseVal;
          // Both listening poses are at 180°, so use the same projected slab point.
          marker.setAttribute("transform", `translate(${width * (1 - mark.x)} ${height - event.point.y})`);
          markerText.setAttribute("x", mark.x < 0.5 ? "-9" : "9");
          markerText.setAttribute("text-anchor", mark.x < 0.5 ? "end" : "start");
          markerText.textContent = `${mark.label} ${mark.value}`;
        });
        returnPose = createClimaxReturnPose(building);
        building.input({ type: "nudgeChair" });
        for (let step = 0; step < 144; step += 1) building.step();
        connectClimaxPhysics(timeline, building);
        needsPose = true;
        const group = byId("climax-props");
        const props = [...building.rooms.values()].flatMap((room) => Object.values(room.props));
        bodies = props.map((body) => {
          const circle = Boolean(body.shape.radius);
          const element = document.createElementNS("http://www.w3.org/2000/svg", circle ? "circle" : "polygon");
          if (circle) element.setAttribute("r", body.shape.radius);
          else element.setAttribute("points", body.shape.points.map(({ x, y }) => `${x},${y}`).join(" "));
          return { body, element };
        });
        group.replaceChildren(...bodies.map(({ element }) => element));
        if (!timeline.state.reduced) alignPhysics();
        render();
        schedule();
      },
    };
  }

  function mountCushion() {
    const byId = (id) => document.getElementById(id);
    const section = byId("cushion-demo");
    const panel = section.querySelector("[data-motion-sticky]");
    const led = byId("cushion-led");
    const floor = createFloorDisplay(led);
    const controls = byId("cushion-controls");
    const buttons = [...controls.querySelectorAll("button")];
    const afterButton = buttons.find((button) => button.dataset.action === "mat-after");
    const feedback = byId("cushion-status");
    const summary = byId("cushion-comparison");
    const frames = byId("cushion-frames");
    const mat = byId("cushion-mat");
    const heightCopy = byId("cushion-height");
    const matCopy = byId("cushion-mat-copy");
    const lampCopy = byId("cushion-lamp-copy");
    const conclusion = byId("cushion-conclusion");
    const provenance = byId("cushion-provenance");
    const lamps = [byId("cushion-before-lamp"), byId("cushion-after-lamp")];
    const bars = [byId("cushion-before-bar"), byId("cushion-after-bar")];
    const timeline = createCushionTimeline({ eventTarget: section });
    let createBuilding;
    let frame = 0;
    let previousTime;

    function render() {
      const {
        phase, action, laid, comparison, reduced, floorOpacity, pendulumProgress,
        heightCue, matCue, lampCue, conclusionCue, provenanceCue,
      } = timeline.state;
      floor(timeline.state.floor);
      led.style.opacity = floorOpacity;
      for (const button of buttons) button.setAttribute("aria-disabled", action !== button.dataset.action);
      if (comparison && afterButton.textContent !== "매트 위에 다시 떨어뜨리기") afterButton.textContent = "매트 위에 다시 떨어뜨리기";
      mat.hidden = !laid;
      heightCopy.hidden = !heightCue;
      matCopy.hidden = !matCue;
      summary.hidden = !comparison;
      frames.hidden = !comparison;
      lampCopy.hidden = !lampCue;
      conclusion.hidden = !conclusionCue;
      provenance.hidden = !provenanceCue;
      if (!comparison) return;
      const { before, after, reduction } = comparison;
      const change = reduction === null ? "" : reduction >= 0
        ? ` · ${Math.round(reduction * 100)}% 줄었습니다.` : ` · ${Math.round(-reduction * 100)}% 늘었습니다.`;
      const text = `쿵 ${before} → ${after}${change}`;
      if (summary.textContent !== text) summary.textContent = text;
      const max = Math.max(before, after, 1);
      comparison.frames.forEach(({ index, lampAngle }, offset) => {
        const swing = reduced || phase === "conclusion" ? 1 : Math.cos(2 * Math.PI * pendulumProgress) * (1 - pendulumProgress);
        lamps[offset].style.transform = `rotate(${-lampAngle * swing}rad)`;
        lamps[offset].style.opacity = phase === "compare" ? 0 : 1;
        bars[offset].style.transform = `scaleX(${index / max})`;
      });
    }

    function schedule() {
      if (frame || !timeline.state.moving) return;
      previousTime ??= performance.now();
      frame = requestAnimationFrame((now) => {
        frame = 0;
        timeline.advance((now - previousTime) / 1000);
        previousTime = timeline.state.moving ? now : undefined;
        schedule();
      });
    }

    function measure(trial) {
      const building = createBuilding();
      building.input({ type: "mat", enabled: trial.surface === "mat" });
      if (!building.input(trial.command)) return null;
      let peak;
      let lampAngle = 0;
      building.onReceive((event) => {
        if (event.action === "matDrop" && event.receiverRoom === 6 && (!peak || peak.force < event.force)) peak = event;
      });
      const { lamp, cable } = building.rooms.get(6);
      for (let time = 0; time < 2; time += building.dt) {
        building.step();
        const angle = Math.atan2(lamp.x - cable.anchorB.x, lamp.y - cable.anchorB.y);
        if (Math.abs(angle) > Math.abs(lampAngle)) lampAngle = angle;
      }
      return peak && { index: peak.index, lampAngle, force: peak.force };
    }

    section.addEventListener("cushionchange", render);
    for (const button of buttons) button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (!createBuilding || action !== timeline.state.action) return;
      if (action === "mat-lay") {
        timeline.layMat();
        return;
      }
      const trial = timeline.beginDrop(action === "mat-before" ? "bare" : "mat");
      const repeat = Boolean(timeline.state.comparison);
      const result = measure(trial);
      if (result) {
        timeline.record(trial.id, result);
        feedback.textContent = trial.surface === "bare" ? `맨바닥 쿵 ${result.index}` : repeat ? `매트 위 쿵 ${result.index}` : "";
      } else {
        timeline.cancelDrop(trial.id);
        feedback.textContent = "쿵을 기록하지 못했습니다. 다시 떨어뜨려 주세요.";
      }
      schedule();
    });

    if (typeof IntersectionObserver === "function") {
      const observer = new IntersectionObserver(([entry]) => {
        timeline.setActive(entry.intersectionRatio >= 0.4);
        if (!timeline.state.active) {
          cancelAnimationFrame(frame);
          frame = 0;
          previousTime = undefined;
        }
        schedule();
      }, { threshold: 0.4 });
      observer.observe(panel);
    } else {
      timeline.setActive(true);
      schedule();
    }
    render();

    return {
      setReduced(reduced) { timeline.setReduced(reduced); schedule(); },
      attachPhysics(factory) { createBuilding = factory; controls.hidden = false; feedback.textContent = ""; },
    };
  }
})();
