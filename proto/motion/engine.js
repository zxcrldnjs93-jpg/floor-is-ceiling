(function () {
  "use strict";

  const clamp = (value) => Math.max(0, Math.min(1, value));
  const mix = (from, to, progress) => from + (to - from) * progress;

  function cubicBezier(x1, y1, x2, y2) {
    if (![x1, y1, x2, y2].every(Number.isFinite) || x1 !== clamp(x1) || x2 !== clamp(x2)) {
      throw new RangeError("cubic-bezier requires finite values and x coordinates between 0 and 1");
    }

    const coordinate = (time, first, second) => {
      const rest = 1 - time;
      return 3 * rest * rest * time * first + 3 * rest * time * time * second + time ** 3;
    };

    return Object.freeze({
      css: `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`,
      sample(progress) {
        if (progress <= 0 || progress >= 1) return clamp(progress);
        let lower = 0;
        let upper = 1;
        for (let iteration = 0; iteration < 16; iteration += 1) {
          const time = (lower + upper) / 2;
          if (coordinate(time, x1, x2) < progress) lower = time;
          else upper = time;
        }
        return coordinate((lower + upper) / 2, y1, y2);
      },
    });
  }

  const easing = Object.freeze({
    linear: Object.freeze({ css: "linear", sample: clamp }),
    easeInOut: cubicBezier(0.42, 0, 0.58, 1),
    easeOut: cubicBezier(0.16, 1, 0.3, 1),
  });

  function range({ start = 0, end = 1, ease = easing.linear } = {}) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1 || start >= end) {
      throw new RangeError("Expected 0 <= start < end <= 1");
    }
    if (typeof ease?.css !== "string" || typeof ease.sample !== "function") {
      throw new TypeError("Expected an easing preset or cubicBezier() curve");
    }
    return { start, end, ease, sample: (progress) => ease.sample(clamp((progress - start) / (end - start))) };
  }

  function tween(from, to, options) {
    const { sample } = range(options);
    return (progress) => mix(from, to, sample(progress));
  }

  const transformDefaults = { x: 0, y: 0, rotate: 0, scale: 1 };

  function transform(from, to, progress) {
    const value = (key) => mix(from[key] ?? transformDefaults[key], to[key] ?? transformDefaults[key], progress);
    return `translate(${value("x")}px, ${value("y")}px) rotate(${value("rotate")}deg) scale(${value("scale")})`;
  }

  function trackValues(track, progress) {
    const values = {};
    if (track.hasTransform) values.transform = transform(track.from, track.to, progress);
    if (track.hasOpacity) values.opacity = mix(track.from.opacity ?? 1, track.to.opacity ?? 1, progress);
    return values;
  }

  function restoreStyle(track) {
    if (!track.wroteStyle) return;
    for (const [property, value] of Object.entries(track.originalStyle)) {
      track.element.style.setProperty(property, value.text, value.priority);
    }
    track.wroteStyle = false;
    track.lastPosition = undefined;
  }

  let nextTrackId = 0;

  function attachNativeTrack(sheet, track) {
    const name = `lt-motion-track-${nextTrackId++}`;
    const declaration = (progress) => Object.entries(trackValues(track, progress))
      .map(([property, value]) => `${property}: ${value}`).join("; ");
    const keyframes = sheet.insertRule(`@keyframes ${name} {
      from { ${declaration(0)} }
      to { ${declaration(1)} }
    }`, sheet.cssRules.length);
    const animation = sheet.insertRule(`@media (prefers-reduced-motion: no-preference) {
      .${name} {
        animation-name: ${name};
        animation-duration: auto;
        animation-timing-function: ${track.range.ease.css};
        animation-fill-mode: both;
        animation-timeline: --lt-motion-root;
        animation-range: var(--lt-motion-start) var(--lt-motion-end);
      }
    }`, sheet.cssRules.length);
    track.nativeName = name;
    track.removeNative = () => {
      track.element.classList.remove(name);
      track.element.style.removeProperty("--lt-motion-start");
      track.element.style.removeProperty("--lt-motion-end");
      for (const rule of track.rules) {
        const index = Array.from(sheet.cssRules).indexOf(rule);
        if (index !== -1) sheet.deleteRule(index);
      }
    };
    track.rules = [sheet.cssRules[keyframes], sheet.cssRules[animation]];
  }

  function createMotion({ driver = "auto" } = {}) {
    if (driver !== "auto" && driver !== "js") throw new RangeError("Expected an auto or js driver");

    const root = document.documentElement;
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const scenes = new Set();
    const sections = new WeakSet();
    const tracked = new WeakSet();
    let frame = 0;
    let needsMeasurement = true;
    let destroyed = false;
    let style;

    if (driver === "auto" && CSS.supports("animation-timeline: --lt-motion-root") &&
        CSS.supports("animation-range: 0px 1px") &&
        getComputedStyle(root).getPropertyValue("scroll-timeline-name").includes("--lt-motion-root")) {
      style = document.createElement("style");
      document.head.append(style);
    }
    const sheet = style?.sheet;

    function schedule() {
      if (!destroyed && !frame) frame = requestAnimationFrame(update);
    }

    function refresh() {
      needsMeasurement = true;
      schedule();
    }

    function update() {
      frame = 0;
      const scroll = window.scrollY;
      const reduced = preference.matches;

      if (needsMeasurement) {
        needsMeasurement = false;
        const measurements = Array.from(scenes, (scene) => {
          const bounds = scene.section.getBoundingClientRect();
          const panelHeight = scene.panel.getBoundingClientRect().height;
          return { scene, top: scroll + bounds.top, length: Math.max(0, bounds.height - panelHeight) };
        });
        for (const { scene, top, length } of measurements) {
          if (scene.top === top && scene.length === length) continue;
          scene.top = top;
          scene.length = length;
          scene.geometryChanged = true;
          if (sheet) {
            for (const track of scene.tracks) {
              track.element.classList.toggle(track.nativeName, length > 0);
              track.element.style.setProperty("--lt-motion-start", `${top + length * track.range.start}px`);
              track.element.style.setProperty("--lt-motion-end", `${top + length * track.range.end}px`);
            }
          }
        }
      }

      for (const scene of scenes) {
        if (scene.top === undefined) continue;
        const progress = scene.length ? clamp((scroll - scene.top) / scene.length) : Number(scroll >= scene.top);
        const previousProgress = scene.progress;
        const previousReduced = scene.reduced;
        const geometryChanged = scene.geometryChanged;
        scene.progress = progress;
        scene.reduced = reduced;
        scene.geometryChanged = false;
        const progressChanged = progress !== previousProgress;
        const followsProgress = !reduced || scene.followReducedProgress;
        if (reduced === previousReduced && ((reduced && !followsProgress) || (!progressChanged && !geometryChanged))) continue;

        for (const track of scene.tracks) {
          if (sheet && !reduced && scene.length) {
            restoreStyle(track);
            continue;
          }
          const position = track.range.sample(reduced ? 1 : progress);
          if (position === track.lastPosition) continue;
          track.lastPosition = position;
          for (const [property, value] of Object.entries(trackValues(track, position))) {
            track.element.style.setProperty(property, value);
          }
          track.wroteStyle = true;
        }

        const context = { scene: scene.handle, reduced };
        if ((followsProgress && progressChanged) || reduced !== previousReduced) {
          scene.onProgress?.(followsProgress ? progress : 1, context);
        }
        const events = reduced || progress < previousProgress ? scene.reverseEvents : scene.events;
        for (const event of events) {
          if (!scenes.has(scene)) break;
          const active = !reduced && progress >= event.at;
          if (active === event.active) continue;
          event.active = active;
          if (active) event.enter?.(context);
          else event.leave?.(context);
        }
      }
    }

    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(refresh) : null;
    observer?.observe(root);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", refresh);
    preference.addEventListener("change", refresh);

    function addScene(section, {
      panel = section.querySelector("[data-motion-sticky]"), tracks = [], events = [], onProgress, followReducedProgress = false,
    } = {}) {
      if (destroyed) throw new Error("Motion controller has been destroyed");
      if (!section.isConnected || !panel || panel.parentElement !== section) {
        throw new Error("A scene needs a sticky panel directly inside its section");
      }
      if (sections.has(section)) throw new Error("This section already has a motion scene");

      const elements = new Set();
      const configuredTracks = tracks.map(({ element, from = {}, to = {}, ...options }) => {
        if (!panel.contains(element) || panel === element || tracked.has(element) || elements.has(element)) {
          throw new Error("Use one motion track per element inside its scene panel");
        }
        elements.add(element);
        const hasTransform = Object.keys(transformDefaults).some((key) => key in from || key in to);
        const hasOpacity = "opacity" in from || "opacity" in to;
        if ((!hasTransform && !hasOpacity) || !Object.values(from).every(Number.isFinite) ||
            !Object.values(to).every(Number.isFinite)) {
          throw new TypeError("A track needs finite numeric transform or opacity values");
        }
        const properties = [...(hasTransform ? ["transform"] : []), ...(hasOpacity ? ["opacity"] : [])];
        const originalStyle = Object.fromEntries(properties.map((property) => [property, {
          text: element.style.getPropertyValue(property),
          priority: element.style.getPropertyPriority(property),
        }]));
        return { element, from, to, hasTransform, hasOpacity, range: range(options), originalStyle };
      });

      const orderedEvents = events.map(({ at, enter, leave }) => {
        if (!Number.isFinite(at) || at <= 0 || at > 1) throw new RangeError("Expected 0 < event.at <= 1");
        return { at, enter, leave, active: false };
      }).sort((first, second) => first.at - second.at);

      const scene = { section, panel, tracks: configuredTracks, onProgress, followReducedProgress, events: orderedEvents,
        reverseEvents: orderedEvents.slice().reverse() };
      const handle = {
        get progress() { return scene.progress ?? 0; },
        remove() {
          if (!scenes.delete(scene)) return;
          sections.delete(section);
          observer?.unobserve(section);
          observer?.unobserve(panel);
          for (const track of scene.tracks) {
            restoreStyle(track);
            track.removeNative?.();
            tracked.delete(track.element);
          }
          for (const event of scene.reverseEvents) {
            if (event.active) event.leave?.({ scene: handle, reduced: preference.matches });
          }
        },
      };
      scene.handle = handle;

      for (const track of scene.tracks) {
        tracked.add(track.element);
        if (sheet) attachNativeTrack(sheet, track);
      }
      scenes.add(scene);
      sections.add(section);
      observer?.observe(section);
      observer?.observe(panel);
      refresh();
      return handle;
    }

    return {
      driver: sheet ? "css" : "js",
      addScene,
      refresh,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        cancelAnimationFrame(frame);
        observer?.disconnect();
        window.removeEventListener("scroll", schedule);
        window.removeEventListener("resize", refresh);
        preference.removeEventListener("change", refresh);
        for (const scene of scenes) scene.handle.remove();
        style?.remove();
      },
    };
  }

  function splitText(element) {
    if (element.children.length) throw new Error("splitText expects a plain text element");
    const original = element.textContent;
    element.setAttribute("aria-label", original);
    if (!Intl.Segmenter) return [];

    const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });
    const accessible = document.createElement("span");
    accessible.className = "lt-motion-sr-only";
    accessible.textContent = original;
    const visual = document.createElement("span");
    visual.setAttribute("aria-hidden", "true");
    const glyphs = [];

    for (const part of original.split(/(\s+)/u)) {
      if (!part || /^\s+$/u.test(part)) {
        visual.append(part);
        continue;
      }
      const word = document.createElement("span");
      word.className = "lt-motion-word";
      for (const { segment } of segmenter.segment(part)) {
        const glyph = document.createElement("span");
        glyph.className = "lt-motion-glyph";
        glyph.textContent = segment;
        word.append(glyph);
        glyphs.push(glyph);
      }
      visual.append(word);
    }

    element.replaceChildren(accessible, visual);
    return glyphs;
  }

  function pathPoses(path, steps, createPose, { hideFirst = false, finalPath } = {}) {
    if (!Number.isInteger(steps) || steps < 2 || steps > 60) throw new RangeError("Expected 2 to 60 path steps");
    if (path.localName !== "path" || !path.parentNode) throw new Error("Expected an attached SVG path");
    const poses = [];
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < steps; index += 1) {
      if (hideFirst && index === 0) {
        poses.push(null);
        continue;
      }
      const pose = path.cloneNode(false);
      pose.removeAttribute("id");
      pose.removeAttribute("tabindex");
      pose.setAttribute("aria-hidden", "true");
      pose.style.pointerEvents = "none";
      pose.style.opacity = 0;
      createPose(pose, index / steps);
      fragment.append(pose);
      poses.push(pose);
    }
    if (finalPath !== undefined) path.setAttribute("d", finalPath);
    path.before(fragment);
    poses.push(path);
    const finalOpacity = path.style.opacity;
    let visible = steps;
    return (progress) => {
      const index = Math.round(clamp(progress) * steps);
      if (visible === index) return;
      if (poses[visible]) poses[visible].style.opacity = 0;
      if (poses[index]) poses[index].style.opacity = finalOpacity;
      visible = index;
    };
  }

  function drawPath(path, { steps = 30 } = {}) {
    return pathPoses(path, steps, (pose, progress) => {
      pose.setAttribute("pathLength", "1");
      pose.style.fill = "none";
      pose.style.strokeDasharray = "1 1";
      pose.style.strokeDashoffset = 1 - progress;
    }, { hideFirst: true });
  }

  const pathArguments = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };

  function parsePath(source) {
    const token = /[MLQCZ]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
    const tokens = source.match(token) ?? [];
    if (!/^[\s,]*$/.test(source.replace(token, "")) || tokens[0] !== "M") {
      throw new Error("Morph paths must start with M and use explicit absolute M, L, Q, C, Z commands");
    }
    const commands = [];
    for (let index = 0; index < tokens.length;) {
      const command = tokens[index++];
      const count = pathArguments[command];
      const points = tokens.slice(index, index + count).map(Number);
      if (count === undefined || count !== points.length || !points.every(Number.isFinite)) {
        throw new Error("Invalid morph path coordinates");
      }
      commands.push({ command, points });
      index += count;
    }
    return commands;
  }

  function morphPath(path, destination, { steps = 24 } = {}) {
    const from = parsePath(path.getAttribute("d") ?? "");
    const to = parsePath(destination);
    if (from.length !== to.length || from.some(({ command }, index) => command !== to[index].command)) {
      throw new Error("Morph paths need the same command sequence");
    }

    return pathPoses(path, steps, (pose, progress) => {
      if (progress === 0) return;
      const data = from.map(({ command, points }, index) => {
        const coordinates = points.map((value, coordinate) => mix(value, to[index].points[coordinate], progress).toFixed(3));
        return [command, ...coordinates].join(" ");
      }).join(" ");
      pose.setAttribute("d", data);
    }, { finalPath: destination });
  }

  function counter(element, { from = 0, to, start = 0, end = 1, ease, label = String(to) } = {}) {
    if (![from, to].every((value) => Number.isSafeInteger(value) && value >= 0)) {
      throw new RangeError("Counter endpoints must be nonnegative safe integers");
    }
    const interpolate = tween(from, to, { start, end, ease });
    const minimum = Math.min(from, to);
    const maximum = Math.max(from, to);
    const places = String(maximum).length;
    const digits = [];
    const fragment = document.createDocumentFragment();

    for (let position = 0; position < places; position += 1) {
      const viewport = document.createElement("span");
      viewport.className = "lt-motion-digit";
      viewport.setAttribute("aria-hidden", "true");
      const strip = document.createElement("span");
      strip.className = "lt-motion-digit-strip";
      for (let digit = 0; digit <= 9; digit += 1) {
        const glyph = document.createElement("span");
        glyph.textContent = digit;
        strip.append(glyph);
      }
      digits.push({ viewport, strip });
      viewport.append(strip);
      fragment.append(viewport);
    }

    element.classList.add("lt-motion-counter");
    element.setAttribute("role", "img");
    element.setAttribute("aria-label", label);
    element.replaceChildren(fragment);

    let previous;
    function render(progress) {
      const value = Math.round(Math.max(minimum, Math.min(maximum, interpolate(progress))));
      if (value === previous) return;
      previous = value;
      const decimal = String(value).padStart(places, " ");
      digits.forEach((place, index) => {
        const digit = decimal[index];
        if (digit === place.previous) return;
        place.previous = digit;
        place.viewport.style.opacity = digit === " " ? 0 : 1;
        if (digit !== " ") place.strip.style.transform = `translateY(${-Number(digit) * 10}%)`;
      });
    }

    render(1);
    return render;
  }

  window.LandingMotion = Object.freeze({ createMotion, cubicBezier, easing, tween, splitText, drawPath, morphPath, counter });
})();
