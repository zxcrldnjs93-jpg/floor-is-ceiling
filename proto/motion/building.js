(function () {
  "use strict";

  const { easing, tween } = window.LandingMotion;
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const smoothStep = (value) => {
    const amount = clamp(value);
    return amount * amount * (3 - 2 * amount);
  };
  const svgNamespace = "http://www.w3.org/2000/svg";

  const ledSegments = [
    "M4 2h14l2 2-2 2H4L2 4Z", "M20 5l2 2v10l-2 2-2-2V7Z", "M20 21l2 2v10l-2 2-2-2V23Z",
    "M4 34h14l2 2-2 2H4l-2-2Z", "M2 21l2 2v10l-2 2-2-2V23Z", "M2 5l2 2v10l-2 2-2-2V7Z",
    "M4 18h14l2 2-2 2H4l-2-2Z",
  ];
  const ledCodes = ["012345", "12", "01346", "01236", "1256", "02356", "023456", "012", "0123456", "012356"];

  function createFloorDisplay(element, status) {
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("viewBox", "0 0 49 40");
    svg.setAttribute("aria-hidden", "true");
    const digitSegments = ledSegments.map((path) => {
      const segment = document.createElementNS(svgNamespace, "path");
      segment.setAttribute("d", path);
      svg.append(segment);
      return segment;
    });
    const suffix = document.createElementNS(svgNamespace, "path");
    suffix.setAttribute("d", "M29 2h19v4H33v12h12v4H33v16h-4Z");
    svg.append(suffix);
    element.replaceChildren(svg);
    let previous;

    return (floor) => {
      if (!Number.isInteger(floor) || floor < 0 || floor > 9) throw new RangeError("Floor must be a digit");
      if (floor === previous) return;
      digitSegments.forEach((segment, index) => {
        segment.style.opacity = ledCodes[floor].includes(String(index)) ? 1 : 0.14;
      });
      element.setAttribute("data-floor", floor);
      if (status) status.textContent = `${floor}층`;
      previous = floor;
    };
  }

  function createFloorDescent(stack, { floors = [7, 6, 5], onFloorChange } = {}) {
    if (floors.length < 2 || floors.length !== stack.children.length ||
        !floors.every((floor) => Number.isInteger(floor) && floor >= 0 && floor <= 9)) {
      throw new RangeError("Provide a digit for each room in the stack");
    }

    const intervals = floors.length - 1;
    const descents = floors.slice(1).map((_, index) => tween(0, 1, {
      start: (index + 0.18) / intervals, end: (index + 0.82) / intervals, ease: easing.easeInOut,
    }));
    let previousIndex;
    let previousPosition;

    return (progress, { reduced = false } = {}) => {
      const distance = descents.reduce((total, descent) => total + descent(progress), 0);
      // Use the scroll midpoint directly so floor changes are exact in both directions.
      const index = Math.min(intervals, Math.round(clamp(progress) * intervals));
      const position = reduced ? index : distance;
      if (position !== previousPosition) {
        stack.style.transform = `translateY(${-position * 100}%)`;
        previousPosition = position;
      }
      if (index !== previousIndex) {
        const previousFloor = floors[previousIndex];
        previousIndex = index;
        onFloorChange?.(floors[index], { previousFloor, reduced });
      }
      return floors[index];
    };
  }

  function createSlabWave(layer, { fullImpulse = 250, reduced = false } = {}) {
    if (!Number.isFinite(fullImpulse) || fullImpulse <= 0) throw new RangeError("Expected a positive full impulse");
    const slots = Array.from({ length: 4 }, () => {
      const slot = document.createElement("span");
      slot.className = "lt-slab-wave-slot";
      slot.setAttribute("aria-hidden", "true");
      const arcs = Array.from({ length: 3 }, () => {
        const arc = document.createElement("span");
        arc.className = "lt-slab-wave-arc";
        slot.append(arc);
        return arc;
      });
      layer.append(slot);
      return { slot, arcs, animations: [] };
    });
    let cursor = 0;
    let lastImpact;

    function clearSlot(group) {
      group.animations.forEach((animation) => animation.cancel());
      group.animations.length = 0;
      group.arcs.forEach((arc) => { arc.style.opacity = ""; });
    }

    function render(impact) {
      const { x, direction, strength } = impact;
      const viewportWidth = document.documentElement?.clientWidth || window.innerWidth || 480;
      const viewportScale = viewportWidth / 480;
      const amplitude = (12 + strength * 44) * viewportScale;
      const thickness = (1.6 + strength * 0.6) * viewportScale;
      const duration = (380 + strength * 160) * viewportScale;
      const brightness = 0.22 + strength * 0.73;
      const group = slots[cursor];
      cursor = (cursor + 1) % slots.length;
      clearSlot(group);
      group.slot.style.left = `${x * 100}%`;
      group.slot.style.setProperty("--lt-slab-wave-thickness", `${thickness}px`);

      group.arcs.forEach((arc, index) => {
        const pose = (phase, spread, height, opacity) => ({
          transform: `translateX(-50%) scaleY(${direction}) translateY(${amplitude * phase}px) scale(${spread}, ${height})`,
          opacity,
        });
        if (reduced || !arc.animate) {
          const still = pose(0.28 + index * 0.27, 0.46 + index * 0.24, 0.28 + strength * 0.65, brightness * (1 - index * 0.24));
          arc.style.transform = still.transform;
          arc.style.opacity = still.opacity;
          return;
        }
        group.animations.push(arc.animate([
          pose(0, 0.17, 0.16, 0),
          { ...pose(0.23, 0.48, 0.25 + strength * 0.53, brightness * (1 - index * 0.2)), offset: 0.25 },
          pose(1, 1.12, 0.36 + strength * 0.9, 0),
        ], { duration, delay: index * 32 * viewportScale, easing: "ease-out" }));
      });
      return { strength, amplitude, brightness, thickness, duration };
    }

    return {
      pulse({ impulse, x = 0.5, direction = 1 }) {
        if (!Number.isFinite(impulse) || impulse <= 0 || !Number.isFinite(x)) return null;
        lastImpact = { x: clamp(x), direction: direction < 0 ? -1 : 1, strength: clamp(impulse / fullImpulse) };
        if (reduced) slots.forEach(clearSlot);
        return render(lastImpact);
      },
      setReduced(next) {
        if (next === reduced) return;
        reduced = next;
        slots.forEach(clearSlot);
        if (reduced && lastImpact) render(lastImpact);
      },
      destroy() {
        slots.forEach((group) => { clearSlot(group); group.slot.remove(); });
      },
    };
  }

  function createPageFlip(layer, { reduced = false, onChange, onFrame } = {}) {
    const upright = [...layer.querySelectorAll("[data-building-upright]")];
    const properties = [[layer, "opacity"], ...[layer, ...upright].map((element) => [element, "transform"])];
    const saved = properties.map(([element, key]) => [element, key, element.style.getPropertyValue(key), element.style.getPropertyPriority(key)]);
    const mirror = layer.cloneNode(true);
    mirror.setAttribute("aria-hidden", "true");
    mirror.setAttribute("inert", "");
    mirror.setAttribute("data-building-mirror", "");
    mirror.removeAttribute("id");
    mirror.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
    layer.after(mirror);

    function rotate(face, copy, degrees) {
      face.style.transform = `rotate(${degrees}deg)`;
      copy.forEach((element) => { element.style.transform = `rotate(${-degrees}deg)`; });
    }

    rotate(mirror, mirror.querySelectorAll("[data-building-upright]"), 180);
    let progress = 0;
    let flipped = false;
    let paused = false;
    let frame = 0;
    let listeningFrame;

    function frameFace(face, inverted) {
      const scale = inverted ? listeningFrame.scale : 1;
      const offsetY = inverted ? listeningFrame.offsetY : 0;
      face.style.scale = scale === 1 ? "" : String(scale);
      face.style.translate = offsetY ? `0 ${offsetY}px` : "";
    }

    function render() {
      // At either endpoint the real DOM occupies the visible pose, including for keyboard and text selection.
      const blend = reduced && progress > 0 && progress < 1;
      const degrees = blend ? 0 : progress * 180;
      rotate(layer, upright, degrees);
      layer.style.opacity = blend ? 1 - progress : 1;
      mirror.style.opacity = blend ? progress : 0;
      if (listeningFrame) {
        frameFace(layer, reduced && degrees === 180);
        frameFace(mirror, reduced);
      }
      onFrame?.(progress);
    }

    function updateTarget(next) {
      if (next === flipped) return;
      flipped = next;
      onChange?.(flipped);
    }

    function animateTo(to) {
      cancelAnimationFrame(frame);
      frame = 0;
      const from = progress;
      if (paused || from === to) return;
      const started = performance.now();
      const duration = (reduced ? 210 : 720) * Math.abs(to - from);
      const update = (now) => {
        const time = clamp((now - started) / duration);
        progress = time === 1 ? to : from + (to - from) * easing.easeInOut.sample(time);
        render();
        frame = time < 1 ? requestAnimationFrame(update) : 0;
      };
      frame = requestAnimationFrame(update);
    }

    function setFlipped(next) {
      if (next === flipped) return;
      updateTarget(next);
      animateTo(Number(next));
    }

    render();
    return {
      get flipped() { return flipped; },
      setFlipped,
      toggle() { setFlipped(!flipped); },
      setPaused(next) {
        if (next === paused) return;
        paused = next;
        animateTo(Number(flipped));
      },
      setListeningFrame({ scale, offsetY }) {
        if (listeningFrame && listeningFrame.scale === scale && listeningFrame.offsetY === offsetY) return;
        if (!listeningFrame) {
          for (const key of ["scale", "translate"]) {
            saved.push([layer, key, layer.style.getPropertyValue(key), layer.style.getPropertyPriority(key)]);
          }
        }
        listeningFrame = { scale, offsetY };
        render();
      },
      seek(value) {
        cancelAnimationFrame(frame);
        frame = 0;
        progress = clamp(value);
        updateTarget(progress >= 0.5);
        render();
      },
      setReduced(next) {
        if (next === reduced) return;
        reduced = next;
        render();
        if (frame) animateTo(Number(flipped));
      },
      destroy() {
        cancelAnimationFrame(frame);
        mirror.remove();
        for (const [element, key, value, priority] of saved) {
          element.style.setProperty(key, value, priority);
        }
      },
    };
  }

  const maxClimaxAngularSpeed = 225 * Math.PI / 180;
  const climaxEpsilon = 1e-10;
  const climaxListenStart = 0.55;
  const climaxListenEnd = 0.75;
  const climaxReturnCardAngle = 11 * Math.PI / 6;

  function createClimaxScrollMap({ travel, panelHeight, viewportHeight = panelHeight }) {
    if (![travel, panelHeight, viewportHeight].every((size) => Number.isFinite(size) && size > 0)) return null;

    // Retain the approach and return distances from the 260svh scene when space allows.
    const sideTravel = Math.min(1.28 * panelHeight, Math.max(travel - viewportHeight, travel / 4));
    const sideProgress = climaxListenStart + (1 - climaxListenEnd);
    const listenStart = sideTravel * (climaxListenStart / sideProgress);
    const listenEnd = travel - sideTravel * ((1 - climaxListenEnd) / sideProgress);

    return {
      listenStart, listenEnd,
      progressAt(offset) {
        offset = Math.max(0, Math.min(travel, offset));
        if (offset < listenStart) return climaxListenStart * (offset / listenStart);
        if (offset < listenEnd) {
          return climaxListenStart + (climaxListenEnd - climaxListenStart) * ((offset - listenStart) / (listenEnd - listenStart));
        }
        return climaxListenEnd + (1 - climaxListenEnd) * ((offset - listenEnd) / (travel - listenEnd));
      },
      offsetAt(progress) {
        progress = clamp(progress);
        if (progress < climaxListenStart) return listenStart * (progress / climaxListenStart);
        if (progress < climaxListenEnd) {
          return listenStart + (listenEnd - listenStart) * ((progress - climaxListenStart) / (climaxListenEnd - climaxListenStart));
        }
        return listenEnd + (travel - listenEnd) * ((progress - climaxListenEnd) / (1 - climaxListenEnd));
      },
    };
  }

  function climaxAngle(progress) {
    if (progress <= 0.25) return 0;
    if (progress < climaxListenStart) return Math.PI * (progress - 0.25) / 0.30;
    if (progress <= climaxListenEnd) return Math.PI;
    if (progress < 0.95) return Math.PI * (1 + (progress - climaxListenEnd) / 0.20);
    return 2 * Math.PI;
  }

  function climaxPhase(progress) {
    if (progress < 0.15) return "zoom";
    if (progress < 0.25) return "ready";
    if (progress < climaxListenStart) return "invert";
    if (progress <= climaxListenEnd) return "listen";
    if (progress < 0.95) return "return";
    return "settle";
  }

  function visibleClimaxCue(phase, angle, { listening = false, invertedOpacity = 0 } = {}) {
    if (listening) return "listen";
    if (phase === "listen") return "invert";
    if (phase !== "return" && phase !== "settle") return phase;
    if (invertedOpacity > 0 || !Number.isFinite(angle)) return "returning";
    if (angle < Math.PI - climaxEpsilon) return "invert";
    if (angle < climaxReturnCardAngle - climaxEpsilon || angle > 2 * Math.PI + climaxEpsilon) return "returning";
    return phase === "settle" && angle >= 2 * Math.PI - climaxEpsilon ? "settle" : "return";
  }

  function climaxRotationScale(angle, stageAspect) {
    if (!Number.isFinite(angle) || !Number.isFinite(stageAspect)) return 1;
    const wide = clamp((stageAspect - 1) / 0.6);
    return 1 - 0.24 * wide * Math.sin(angle) ** 2;
  }

  function climaxDesktopFrame(angle, { width, height, desktop = false, reduced = false, sensor = false } = {}) {
    const aspect = width / height;
    const maxAspect = height <= 960 ? 1.8 : 1.7;
    if (!desktop || reduced || sensor || ![angle, width, height].every(Number.isFinite) ||
        width < 1280 || height < 720 || aspect < 1.5 || aspect > maxAspect) return { scale: 1, offsetY: 0 };

    const degrees = angle * 180 / Math.PI;
    if (degrees <= 38 || degrees >= 180) return { scale: 1, offsetY: 0 };

    const wide = Math.max(0, aspect - 1.6);
    const short = clamp((900 - height) / 180);
    const shrink = 0.18 + 0.27 * wide + 0.016 * short;
    const framingScale = 1 - shrink * smoothStep((degrees - 38) / 68);

    // Combined scale recovers by at most 3% per 3° and eases into the 180° hold.
    const remaining = 180 - degrees;
    const recoveryDistance = remaining < 2 ? remaining ** 2 / 4 : remaining - 1;
    const recoveryScale = Math.exp(-0.0098 * recoveryDistance) / climaxRotationScale(angle, aspect);

    // Shorter stages need to give the lower lamp more room above the HUD sooner.
    const shiftRelease = 137 + 9 * wide - 7 * short;
    const shiftWeight = smoothStep((degrees - 72) / 38) * (1 - smoothStep((degrees - shiftRelease) / (180 - shiftRelease)));
    const lift = height * (0.12 + 0.03 * wide - 0.012 * short);
    return { scale: Math.max(framingScale, recoveryScale), offsetY: shiftWeight ? -lift * shiftWeight : 0 };
  }

  function climaxListeningFrame(angle, { width, height, reduced = false, sensor = false } = {}) {
    if (reduced || sensor || ![angle, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      return { scale: 1, offsetY: 0 };
    }

    const distance = Math.abs(angle - Math.PI) * 180 / Math.PI;
    const weight = smoothStep(1 - distance / 45);
    const narrow = Math.min(0.16, 48 / width) * clamp((720 - width) / 320);
    const short = width > height ? clamp((560 - height) / 170) : 0;
    const inset = Math.max(narrow, 0.16 * short);
    // On short landscape screens the listening copy sits above the replay.
    const shift = 0.41 * height * short;
    return { scale: 1 - inset * weight, offsetY: shift * weight };
  }

  function createClimaxView(angle = 0) {
    let previous = angle;
    let current = angle;
    let last;
    let held;

    return {
      record(angle, { snap = false } = {}) {
        previous = snap ? angle : current;
        current = angle;
        held = undefined;
        if (snap) last = undefined;
      },
      sample({ alpha = 1, zoom = 1, width, height, desktop = false, paused = false, reduced = false, sensor = false } = {}) {
        if (paused && last) held = last;
        if (held) return held;

        const poseAlpha = reduced ? 1 : clamp(alpha);
        const angle = sensor ? 0 : previous + (current - previous) * poseAlpha;
        let scale = 1;
        let offsetY = 0;
        if (!reduced) {
          const desktopFrame = climaxDesktopFrame(angle, { width, height, desktop, sensor });
          const listeningFrame = climaxListeningFrame(angle, { width, height, sensor });
          const zoomOut = 1 - clamp(zoom);
          scale = climaxRotationScale(angle, width / height) * (1 + 0.23 * zoomOut) * desktopFrame.scale * listeningFrame.scale;
          offsetY = desktopFrame.offsetY + listeningFrame.offsetY - (Number.isFinite(height) ? 0.08 * height * zoomOut : 0);
        }
        last = { angle, scale, offsetY, poseAlpha };
        if (paused) held = last;
        return last;
      },
    };
  }

  function projectClimaxPoint({ x, y }, { width, height, angle = 0, scale = 1, offsetY = 0 }) {
    const cx = width / 2;
    const cy = height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    return {
      x: cx + (dx * cos - dy * sin) * scale,
      y: cy + (dx * sin + dy * cos) * scale + offsetY,
    };
  }

  function climaxSlabLabels({ width, height, slabY, anchorX = width / 2, frame = {}, inverted = false, sensor = false,
    labelWidth = 78, labelHeight = 24, insets: { top = 8, right = 8, bottom = 8, left = 8 } = {} }) {
    const { angle = 0, scale = 1, offsetY = 0 } = frame;
    if (![width, height, slabY, anchorX, angle, scale, offsetY, labelWidth, labelHeight, top, right, bottom, left].every(Number.isFinite) ||
        width <= 0 || height <= 0 || scale <= 0 || labelWidth <= 0 || labelHeight <= 0) return null;

    const stacked = width <= 360;
    const sensorInverted = sensor && inverted;
    const anchor = projectClimaxPoint({ x: anchorX, y: slabY }, { width, height, angle, scale, offsetY });
    const floorSide = inverted ? -1 : 1;
    const nx = Math.sin(angle) * floorSide;
    const ny = -Math.cos(angle) * floorSide;
    const gap = 8;
    const distance = (Math.abs(nx) * labelWidth + Math.abs(ny) * labelHeight) / 2 + gap;
    const dx = stacked ? 0 : nx * distance;
    const dy = stacked ? (sensorInverted ? 1 : -1) * (labelHeight / 2 + gap) : ny * distance;

    // Fit the pair as a group so viewport constraints cannot collapse the gap.
    const halfWidth = labelWidth / 2 + Math.abs(dx);
    const halfHeight = labelHeight / 2 + Math.abs(dy);
    const minX = left + halfWidth;
    const maxX = width - right - halfWidth;
    const minY = top + halfHeight;
    const maxY = height - bottom - halfHeight;
    if (minX > maxX || minY > maxY) return null;
    const cx = Math.min(maxX, Math.max(minX, anchor.x));
    const cy = Math.min(maxY, Math.max(minY, anchor.y));

    return {
      anchor, stacked, textAngle: sensorInverted ? Math.PI : 0,
      floor: { room: inverted ? 6 : 7, x: cx + dx, y: cy + dy },
      ceiling: { room: inverted ? 7 : 6, x: cx - dx, y: cy - dy },
    };
  }

  function climaxSlabLabelFrames({ invertedInsets, ...options }) {
    const { width, height } = options;
    return {
      upright: climaxSlabLabels({ ...options, frame: {}, inverted: false, sensor: false }),
      inverted: climaxSlabLabels({ ...options, insets: invertedInsets ?? options.insets,
        frame: { angle: Math.PI, ...climaxListeningFrame(Math.PI, { width, height }) }, inverted: true, sensor: false }),
    };
  }

  function showClimaxQuestion(phase, width) {
    return Number.isFinite(width) && width > 0 && width <= 480 && (phase === "ready" || phase === "invert");
  }

  const gestureHintDelayMs = 3000;

  function sceneHint(scene, { touch = false, idleMs = 0, gestureUsed = false, replaying = false,
    replayFinished = false, soundMuted = false, vibrationHint = false } = {}) {
    if (scene === "gesture" && touch && !gestureUsed && idleMs >= gestureHintDelayMs) return "gesture";
    if (scene !== "listen") return null;
    if (vibrationHint) return "vibration";
    if (!replaying && replayFinished && soundMuted) return "sound";
    return null;
  }

  function climaxImpactMarker(event, width, listening) {
    if (!listening || event?.kind !== "replay" || event.cue !== "s4-chair" ||
        event.sourceRoom !== 6 || event.receiverRoom !== 7 || !Number.isFinite(width) || width <= 0 ||
        !Number.isFinite(event.point?.x) || !Number.isFinite(event.index) || event.index < 0) return null;
    return { n: 0, slab: "6-7", label: event.label, x: clamp(event.point.x / width), value: event.index };
  }

  function climaxButtonTurnFraction(time) {
    const ramp = 0.15;
    const edge = Math.min(time, 1 - time);
    const rampTime = edge / ramp;
    // Integrate a smooth speed ramp, then hold constant angular speed.
    const distance = edge < ramp ? ramp * rampTime ** 3 * (1 - rampTime / 2) : edge - ramp / 2;
    const fraction = distance / (1 - ramp);
    return time <= 0.5 ? fraction : 1 - fraction;
  }

  function createClimaxTimeline({ eventTarget = new EventTarget(), reduced = false, holdButtonToListenEnd = false } = {}) {
    let progress = 0;
    let angle = 0;
    let targetProgress = 0;
    let rawScroll;
    let anchor;
    let playback;
    let queued = false;
    let holding = false;
    let skipped = false;
    let sensor;
    let sensorCue = null;
    let nextCue;
    let state;

    function isRewinding() {
      return climaxAngle(targetProgress) < angle;
    }

    function availableButton(phase) {
      if (playback || queued) return null;
      if (isRewinding() || phase === "ready" || phase === "invert") return "invert";
      if (phase === "listen" || phase === "return") return "return";
      return null;
    }

    function publish() {
      let phase = climaxPhase(progress);
      if (phase === "listen" && targetProgress < climaxListenStart) phase = "invert";
      if (phase === "listen" && targetProgress > climaxListenEnd) phase = "return";
      const playing = playback?.kind ?? null;
      const listening = phase === "listen";
      const stageAngle = sensor ? 0 : angle;
      const next = {
        progress, angle, angleDegrees: angle * 180 / Math.PI, phase, reduced, playing, queued, holding, skipped,
        stageAngle, stageAngleDegrees: stageAngle * 180 / Math.PI,
        mode: sensor ? "sensor" : "timeline", sensorPhase: sensor?.phase ?? null, sensorGravity: sensor?.gravity ?? null, sensorCue,
        zoom: clamp(progress / 0.15), blend: clamp(1 - Math.abs(angle / Math.PI - 1)),
        listening, canInput: !sensor && (progress < 0.25 || progress >= 0.95),
        button: availableButton(phase),
        moving: Boolean(nextCue || playing || targetProgress !== progress),
      };
      if (state && Object.keys(next).every((key) => next[key] === state[key])) return;
      state = Object.freeze(next);
      eventTarget.dispatchEvent(new CustomEvent("climaxchange", { detail: state, bubbles: true }));
    }

    function mapScroll(value) {
      if (!anchor || value === 0 || value === 1) return value;
      if (value >= anchor.scroll) {
        const resume = anchor.listenUntil ?? anchor.scroll;
        const fraction = Math.max(0, value - resume) / (1 - resume);
        return anchor.progress + (1 - anchor.progress) * fraction;
      }
      return anchor.progress * value / anchor.scroll;
    }

    function skip() {
      rawScroll = progress = targetProgress = 1;
      angle = 2 * Math.PI;
      anchor = playback = sensor = undefined;
      clearSensorCue();
      holding = queued = false;
      skipped = true;
      publish();
    }

    function scrub(value, { interruptPlayback = false } = {}) {
      if (!Number.isFinite(value)) throw new RangeError("Climax scroll progress must be finite");
      value = clamp(value);
      if (value === rawScroll && !(interruptPlayback && playback)) return;
      if (playback && !interruptPlayback) {
        // Focus and scroll restoration can report a new position immediately after the button press.
        rawScroll = value;
        return;
      }
      if (sensor) {
        rawScroll = value;
        if (value === 0 || value > 0.7) stopSensor(value === 0 ? "inactive" : "scroll");
        return;
      }
      if (rawScroll === undefined && value === 1) {
        skip();
        return;
      }
      if (queued && value > 0 && value < 1) {
        rawScroll = value;
        return;
      }
      if (playback) {
        anchor = { scroll: rawScroll, progress };
        playback = undefined;
      }
      if (value === 0 || value === 1) {
        anchor = undefined;
        clearSensorCue();
      }
      rawScroll = value;
      holding = holding && anchor?.listenUntil !== undefined && value >= anchor.scroll && value <= anchor.listenUntil;
      skipped = queued = false;
      targetProgress = mapScroll(value);
      if (angle === climaxAngle(targetProgress)) progress = targetProgress;
      publish();
    }

    function startPlayback(kind) {
      const returning = kind === "return";
      const from = Math.max(progress, returning ? 0.75 : 0.25);
      const to = returning ? 0.95 : 0.75;
      const turnEnd = returning ? to : 0.55;
      const secondsPerProgress = returning ? 5 : 4.8;
      progress = targetProgress = from;
      clearSensorCue();
      holding = queued = skipped = false;
      playback = { kind, elapsed: 0, from, to, turnEnd, turnDuration: (turnEnd - from) * secondsPerProgress,
        duration: (to - from) * secondsPerProgress };
    }

    function activate(action = state.button) {
      if (playback || queued) return false;
      if (sensor && (action === "invert" || action === "return")) stopSensor();
      if (action === "invert" && isRewinding()) {
        queued = true;
        targetProgress = 0.2;
      } else if (action === "invert" && progress >= 0.15 && progress < 0.55) {
        startPlayback(action);
      } else if (action === "return" && progress >= 0.55 && progress < 0.95) {
        startPlayback(action);
      } else {
        return false;
      }
      publish();
      return true;
    }

    function startSensor() {
      if (sensor || reduced || state.phase !== "ready" || rawScroll < 0.15 || rawScroll >= 0.25) return false;
      targetProgress = progress;
      anchor = undefined;
      clearSensorCue();
      sensor = { phase: "tilting", gravity: null };
      publish();
      return true;
    }

    function clearSensorCue() {
      sensorCue = null;
      nextCue = undefined;
    }

    function stopSensor(reason) {
      const rotatedBeforeSample = reason === "screen-rotated" && state.phase === "ready" &&
        nextCue?.id !== "S4-17" && sensorCue !== "S4-17";
      if (!sensor && !rotatedBeforeSample) return false;
      if (sensor?.phase === "returned" && rawScroll > 0 && rawScroll < 1) anchor = { scroll: rawScroll, progress };
      sensor = undefined;
      clearSensorCue();
      if (reason === "screen-rotated") {
        progress = 0.2;
        angle = 0;
        anchor = { scroll: rawScroll, progress };
        nextCue = { id: "S4-17", remaining: 1.2 };
      } else if (reason === "scroll") {
        sensorCue = "S4-18";
        nextCue = { id: null, remaining: 1.2 };
      }
      targetProgress = mapScroll(rawScroll);
      if (angle === climaxAngle(targetProgress)) progress = targetProgress;
      publish();
      return true;
    }

    function setSensorGravity(vector) {
      const { x, y } = vector ?? {};
      if (!sensor || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      if (x !== sensor.gravity?.x || y !== sensor.gravity?.y) sensor.gravity = Object.freeze({ x, y });
      publish();
      return true;
    }

    function setSensorPhase(phase) {
      const previous = sensor?.phase;
      if (!(phase === "inverted" && previous === "tilting") && !(phase === "returned" && previous === "inverted")) return false;
      sensor.phase = phase;
      clearSensorCue();
      progress = targetProgress = phase === "inverted" ? 0.65 : 0.95;
      angle = climaxAngle(progress);
      publish();
      return true;
    }

    function showSensorListeningCopy() {
      if (sensor?.phase !== "inverted" || nextCue || sensorCue) return false;
      nextCue = { id: "S4-19", remaining: 2 };
      publish();
      return true;
    }

    function advance(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("Climax timestep must be finite and nonnegative");
      if (!state.moving || seconds === 0) return;

      if (nextCue) {
        nextCue.remaining -= seconds;
        if (nextCue.remaining <= climaxEpsilon) {
          sensorCue = nextCue.id;
          nextCue = undefined;
        }
      }

      if (playback) {
        playback.elapsed += seconds;
        const { elapsed, from, to, turnEnd, turnDuration, duration } = playback;
        if (elapsed >= duration - climaxEpsilon) targetProgress = to;
        else if (elapsed < turnDuration) {
          targetProgress = from + (turnEnd - from) * climaxButtonTurnFraction(elapsed / turnDuration);
        } else {
          targetProgress = turnEnd + (to - turnEnd) * (elapsed - turnDuration) / (duration - turnDuration);
        }
      }

      const targetAngle = climaxAngle(targetProgress);
      const difference = targetAngle - angle;
      const limit = maxClimaxAngularSpeed * seconds;
      if (Math.abs(difference) <= limit + climaxEpsilon) {
        angle = targetAngle;
        progress = targetProgress;
        if (queued) {
          startPlayback("invert");
          publish();
          advance(Math.max(0, seconds - Math.abs(difference) / maxClimaxAngularSpeed));
          return;
        }
      } else {
        angle += Math.sign(difference) * limit;
        // Keep the published progress on the same angle curve the physics engine uses.
        progress = angle < Math.PI || (angle === Math.PI && difference < 0)
          ? 0.25 + 0.30 * angle / Math.PI
          : 0.75 + 0.20 * (angle / Math.PI - 1);
      }

      if (playback && progress === playback.to) {
        anchor = { scroll: rawScroll, progress };
        holding = playback.kind === "invert";
        if (holding && holdButtonToListenEnd && rawScroll < climaxListenEnd) anchor.listenUntil = climaxListenEnd;
        playback = undefined;
      }
      publish();
    }

    publish();
    return {
      events: eventTarget,
      get state() { return state; },
      scrub, activate, advance, skip, startSensor, stopSensor, setSensorGravity, setSensorPhase, showSensorListeningCopy,
      setReduced(next) {
        reduced = Boolean(next);
        if (reduced) clearSensorCue();
        if (!reduced || !stopSensor()) publish();
      },
    };
  }

  function connectClimaxPhysics(timeline, building, { gravity = 920 } = {}) {
    let sensorDriven = false;
    function apply(detail) {
      if (detail.mode === "sensor") {
        sensorDriven = building.setSensorGravity(detail.sensorGravity ?? { x: 0, y: gravity }, { listening: detail.listening });
      } else if (sensorDriven) {
        building.clearSensorGravity();
        sensorDriven = false;
        // The solver kept its scripted angle fixed during sensor input. Resume it from the shared pose.
        building.angle = detail.angle;
        const x = Math.sin(detail.angle) * gravity;
        const y = Math.cos(detail.angle) * gravity;
        building.world.gravity(Math.abs(x) < climaxEpsilon ? 0 : x, Math.abs(y) < climaxEpsilon ? 0 : y);
      }
      building.setProgress(detail.progress);
    }

    const listener = ({ detail }) => apply(detail);
    timeline.events.addEventListener("climaxchange", listener);
    apply(timeline.state);
    return () => {
      timeline.events.removeEventListener("climaxchange", listener);
      if (sensorDriven) building.clearSensorGravity();
    };
  }

  function createClimaxReturnPose(building) {
    let settled = false;

    function update(state) {
      if (state.phase !== "settle") {
        settled = false;
        return false;
      }
      if (settled) return true;
      if (state.mode === "sensor" || Math.abs(building.angle - state.angle) >= 1e-6 || building.world.gy <= 0) return false;
      if (!building.returnPoseReady) for (const id of building.rooms.keys()) building.wakeRoom(id);
      settled = building.settleReturnedRooms();
      if (settled) building.resetCopyBlocks();
      return settled;
    }

    return { update, get settled() { return settled; } };
  }

  const s5Arrival = 0.6;
  const s5Comparison = 0.45;
  const s5Conclusion = 1;

  function createCushionTimeline({ eventTarget = new EventTarget(), reduced = false,
    drop = { type: "matDrop" }, heightSource = "reference" } = {}) {
    const command = Object.freeze({ ...drop });
    const heightCue = heightSource === "peak" ? "S5-08" : "S5-08b";
    let active = false;
    let arrival = 0;
    let reveal = 0;
    let laid = false;
    let pending;
    let before;
    let comparison;
    let matDrops = 0;
    let nextId = 1;
    let state;

    function publish() {
      const arrived = arrival >= s5Arrival;
      const floorStep = Math.min(2, Math.floor((arrival + climaxEpsilon) / 0.2));
      const matTest = pending?.surface === "mat" ? "dropping-after" : comparison ? "done" : laid ? "laid"
        : before ? "before" : pending ? "dropping-before" : "ready";
      const phase = !arrived ? "arrival" : !comparison ? matTest : reveal < s5Comparison ? "compare"
        : reveal < s5Conclusion ? "pendulums" : "conclusion";
      const interactive = active && arrived && !pending && (!comparison || phase === "conclusion");
      const action = interactive ? laid ? "mat-after" : before ? "mat-lay" : "mat-before" : null;
      const next = {
        active, reduced, phase, matTest, action, floor: 5 + floorStep,
        floorOpacity: arrived ? 1 : 0.72 + 0.28 * clamp((arrival - floorStep * 0.2) / 0.2),
        laid, pending, before, comparison, matDrops,
        arrivalCue: arrived ? "S5-01" : null,
        heightCue: arrived && !laid ? heightCue : null,
        matCue: laid && !comparison ? "S5-02" : null,
        resultCue: comparison ? "S5-04" : null,
        lampCue: comparison?.lampContrast && phase !== "compare" ? "S5-05" : null,
        conclusionCue: phase === "conclusion" ? "S5-06" : null,
        provenanceCue: comparison ? "S5-07" : null,
        pendulumProgress: comparison ? clamp((reveal - s5Comparison) / (s5Conclusion - s5Comparison)) : 0,
        moving: Boolean(active && !reduced && (!arrived || comparison && reveal < s5Conclusion)),
      };
      if (state && Object.keys(next).every((key) => next[key] === state[key])) return;
      state = Object.freeze(next);
      eventTarget.dispatchEvent(new CustomEvent("cushionchange", { detail: state, bubbles: true }));
    }

    function beginDrop(surface) {
      const action = surface === "bare" ? "mat-before" : surface === "mat" ? "mat-after" : null;
      if (!action || action !== state.action) return null;
      pending = Object.freeze({ id: nextId++, surface, command });
      const trial = pending;
      publish();
      return trial;
    }

    function record(id, measurement) {
      const { index, lampAngle, force = null } = measurement ?? {};
      if (!pending || pending.id !== id || !Number.isFinite(index) || index < 0 || !Number.isFinite(lampAngle) ||
          (force !== null && (!Number.isFinite(force) || force < 0))) return false;
      const frame = Object.freeze({ surface: pending.surface, index, lampAngle, force });
      pending = undefined;
      if (frame.surface === "bare") before = frame;
      else {
        matDrops += 1;
        if (!comparison) {
          const beforeAmplitude = Math.abs(before.lampAngle);
          const lampReduction = beforeAmplitude > 0 ? 1 - Math.abs(frame.lampAngle) / beforeAmplitude : null;
          const lampContrast = lampReduction !== null && lampReduction > 0.15 + climaxEpsilon;
          comparison = Object.freeze({ before: before.index, after: frame.index,
            reduction: before.index > 0 ? 1 - frame.index / before.index : null,
            lampReduction, lampContrast, frames: Object.freeze([before, frame]) });
          if (reduced || !lampContrast) reveal = s5Conclusion;
        }
      }
      publish();
      return true;
    }

    publish();
    return {
      events: eventTarget,
      get state() { return state; },
      setActive(next) {
        active = Boolean(next);
        if (active && reduced) arrival = s5Arrival;
        publish();
      },
      setReduced(next) {
        reduced = Boolean(next);
        if (reduced && active) arrival = s5Arrival;
        if (reduced && comparison) reveal = s5Conclusion;
        publish();
      },
      advance(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("Cushion timestep must be finite and nonnegative");
        if (!state.moving || seconds === 0) return;
        arrival = Math.min(s5Arrival, arrival + seconds + climaxEpsilon);
        if (comparison) reveal = Math.min(s5Conclusion, reveal + seconds + climaxEpsilon);
        publish();
      },
      beginDrop, record,
      cancelDrop(id) {
        if (!pending || pending.id !== id) return false;
        pending = undefined;
        publish();
        return true;
      },
      layMat() {
        if (state.action !== "mat-lay") return false;
        laid = true;
        publish();
        return true;
      },
    };
  }

  function sampleIntroExtension(progress, { reduced = false } = {}) {
    const active = progress > 0;
    return { active, floor: 7, reveal: reduced ? Number(active) : easing.easeOut.sample(clamp(progress / 0.25)) };
  }

  window.LandingBuilding = Object.freeze({
    createFloorDisplay, createFloorDescent, createSlabWave, createPageFlip, createClimaxTimeline, climaxRotationScale, climaxDesktopFrame, climaxListeningFrame,
    createClimaxScrollMap, visibleClimaxCue, createClimaxView, projectClimaxPoint, climaxSlabLabels, climaxSlabLabelFrames, showClimaxQuestion,
    sceneHint, gestureHintDelayMs, climaxImpactMarker, connectClimaxPhysics, createClimaxReturnPose, createCushionTimeline, sampleIntroExtension,
  });
})();
