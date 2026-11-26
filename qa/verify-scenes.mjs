import { v04States, validV04Expectation } from './verify-v04.mjs';
import { v05States, validV05Expectation } from './verify-v05.mjs';
import { v06States, v06Watches, validV06Expectation } from './verify-v06.mjs';
import { v06bStates, v06bWatches, validV06bExpectation } from './verify-v06b.mjs';
import { v07States, v07Watches, validV07Expectation } from './verify-v07.mjs';
import { v08States, validV08Expectation } from './verify-v08.mjs';
import { v09States, v09Watches, validV09Expectation } from './verify-v09.mjs';
import { v10kStates, validV10KExpectation } from './verify-v10k.mjs';

const states = ['records', 'replay-pending', 'relay-visible', 'relay-button', 'flip-spot', 'same-flip-spot', 'inverted', 'upright', 'pendulum-safe', 'card-grounded',
  's1-throw-recorded', 's0-replayed', 'chair-index', 'card-png', 'mat-card-peak',
  ...v04States, ...v05States, ...v06States, ...v06bStates, ...v07States, ...v08States, ...v09States, ...v10kStates];
const watches = [
  'relay', 'pendulum', 's0-tape', 'card-png', 'v04-s2-repeat', 'v05-s4', 'v05-s6-link-position',
  ...v06Watches, ...v06bWatches, ...v07Watches, ...v09Watches,
];
const nonnegative = (n) => Number.isFinite(n) && n >= 0;

export function normalizeVerification({ cases }) {
  if (!Array.isArray(cases) || !cases.length) throw new Error('검증 대본에 cases 배열이 필요합니다.');
  return cases.map(({ name, viewport, cues }, index) => {
    if (typeof name !== 'string' || !name.trim() || !Array.isArray(cues) || !cues.length
      || !['width', 'height'].every((key) => Number.isInteger(viewport?.[key]) && viewport[key] > 0)
      || viewport.haptics !== undefined && (typeof viewport.haptics !== 'boolean' || viewport.haptics && (!viewport.mobile || viewport.reducedMotion))) {
      throw new Error(`검증 장면 형식 오류 · cases[${index}]`);
    }
    const track = cues.map(({ at, ...action }, cueIndex) => {
      const [kind] = Object.keys(action);
      const value = action[kind];
      const valid = kind === 'click' ? Array.isArray(value) && value.length && value.every((s) => typeof s === 'string' && s.trim())
        : kind === 'clickAt' ? ['selector', 'scope'].every((key) => typeof value?.[key] === 'string' && value[key].trim())
          && (value.target === undefined || typeof value.target === 'string' && value.target.trim())
          && (value.room === undefined || Array.isArray(value.room) && value.room.length === 2
            && value.room.every((part) => nonnegative(part) && part <= 1))
        : kind === 'keyBurst' ? typeof value?.selector === 'string' && value.selector.trim()
          && Number.isInteger(value.count) && value.count >= 2 && value.count <= 12 && nonnegative(value.intervalMs) && value.intervalMs <= 250
        : kind === 'dragChair' ? !viewport.mobile && value === true
        : kind === 'enter' || kind === 'tabTo' || kind === 'reveal' ? typeof value === 'string' && value.trim()
        : kind === 'snapshot' ? typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,47}$/.test(value)
        : kind === 'scrollByScreens' ? Number.isFinite(value) && value > 0 && value <= 2
        : kind === 'scroll' ? /^s\d+$/.test(value?.scene) && nonnegative(value.progress) && value.progress <= 1 && nonnegative(value.seconds)
          && (value.center === undefined || typeof value.center === 'string' && value.center.trim())
          && (value.input === undefined || value.input === 'wheel' && value.seconds > 0 && !viewport.mobile)
          && (value.sceneProgress === undefined || typeof value.sceneProgress === 'boolean')
          && (value.climaxProgress === undefined || typeof value.climaxProgress === 'boolean'
            && (!value.climaxProgress || value.scene === 's4' && !value.sceneProgress))
          : kind === 'watch' ? watches.includes(value)
            : kind === 'expect' && states.includes(value?.state)
              && (v04States.includes(value.state) ? validV04Expectation(value)
                : v05States.includes(value.state) ? validV05Expectation(value)
                  : v06States.includes(value.state) ? validV06Expectation(value)
                    : v06bStates.includes(value.state) ? validV06bExpectation(value)
                      : v07States.includes(value.state) ? validV07Expectation(value)
                        : v08States.includes(value.state) ? validV08Expectation(value)
                          : v09States.includes(value.state) ? validV09Expectation(value)
                            : v10kStates.includes(value.state) ? validV10KExpectation(value) : value.wait === undefined)
              && (value.state !== 'records' || Number.isInteger(value.min) && value.min > 0)
              && (value.state !== 'relay-button' || typeof value.enabled === 'boolean')
              && (value.stable === undefined || Number.isInteger(value.stable) && value.stable >= 2 && value.stable <= 5 && value.wait >= 0.2)
              && (value.state !== 'relay-visible' || value.count === undefined || Number.isInteger(value.count) && value.count > 0);
      if (Object.keys(action).length !== 1 || !nonnegative(at) || !valid) {
        throw new Error(`검증 큐 값 오류 · ${name} · cues[${cueIndex}]`);
      }
      return { at, kind, value };
    }).sort((a, b) => a.at - b.at);
    if (!track.some(({ kind }) => kind === 'expect')) throw new Error(`검증 판정 누락 · ${name}`);
    return { name, view: { ...viewport, scale: 1 }, track };
  });
}

// 브라우저에서 각 실시간 렌더 프레임을 관측한다.
export function installVerificationProbes(watchCardPng, installV04, installV05, installV06, installV06b, installV07, installV08,
  installV09, installV10K, { v10kCopy, fontReport } = {}) {
  const query = (selector) => document.querySelector(selector);
  const artRecords = () => window.LandingArt?.records?.() ?? [];
  const upper = () => artRecords().filter(({ n, slab }) => n > 0 && slab === '7-6');
  const relay = () => artRecords().filter(({ slab, label }) => slab === '6-5' && label === '6층 의자');
  const angleOf = (lamp) => lamp ? Number.parseFloat(getComputedStyle(lamp).getPropertyValue('--lamp-angle')) : NaN;
  const roomInView = (scene) => {
    const rect = query(`#${scene}`)?.getBoundingClientRect();
    return Boolean(rect && rect.top <= innerHeight * 0.64 && rect.bottom > innerHeight * 0.16);
  };
  function inView(node) {
    if (!node || node.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) === false) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.left >= -0.5 && rect.right <= innerWidth + 0.5
      && rect.top >= -0.5 && rect.bottom <= innerHeight + 0.5;
  }
  const text = (selector) => query(selector)?.textContent.trim() ?? '';
  const index = (value) => /^[\d,]+$/.test(value) ? Number(value.replaceAll(',', '')) : null;
  const feedbackRecord = (value) => {
    const match = /^(?:재생\s*·\s*)?(쿵|드르륵)\s*#(\d+)\s*·\s*(\d+)(?:, 6층 천장에 닿았습니다\.)?$/.exec(value.trim());
    return match && { label: match[1], n: Number(match[2]), value: Number(match[3]) };
  };
  const sameRecord = (a, b) => a.n === b.n && a.value === b.value;
  const newScenes = installV04?.({ query, inView, roomInView, upper, feedbackRecord, sameRecord });
  const laterScenes = installV05?.({ query, inView, roomInView, artRecords, upper, text, index });
  const currentScenes = installV06?.({ query, inView, roomInView, artRecords });

  let initialFlipScroll, observation, animationFrame, s0Tape, readPng, chair;
  let replayBeats;
  const additions = installV06b?.({ query, inView, roomInView, artRecords, cardPng: () => readPng?.() });
  const f3 = installV07?.({ query, inView, roomInView, artRecords, cardPng: () => readPng?.(), v10kCopy });
  const v08 = installV08?.({ query, inView, roomInView, artRecords, v10kCopy });
  const v09 = installV09?.({ query, inView, roomInView, artRecords, cardPng: () => readPng?.(), v10kCopy });
  const v10k = installV10K?.({ query, inView, roomInView, v10kCopy, fontReport });

  function watchS0Tape() {
    const baseline = upper().map(({ n, value }) => ({ n, value }));
    const feedback = query('#s2 [data-fx="replay-feedback"]');
    const replayed = [];
    if (!baseline.length || !feedback) throw new Error('S0 원본 쿵 또는 S2 재생 관측 훅이 없습니다.');
    function collect(mutations) {
      for (const mutation of mutations) for (const node of mutation.addedNodes) {
        const message = node.textContent ?? '';
        const record = feedbackRecord(message);
        if (message.startsWith('재생') && record) replayed.push(record);
      }
    }
    const observer = new MutationObserver(collect);
    observer.observe(feedback, { childList: true });
    s0Tape = { baseline, replayed, observer, collect };
  }

  async function cardPng() {
    const png = await readPng?.();
    const records = upper();
    const newer = chair ? records.filter(({ n }) => n > chair.n) : [];
    const newest = Math.max(0, ...newer.map(({ n }) => n));
    const quietTail = Boolean(chair && newest >= chair.n + 12 && newer.every(({ value }) => value < chair.sessionPeak));
    const screenLed = index(text('#s6 [data-result-peak]'));
    const label = [...document.querySelectorAll('#s6 svg[data-card-mini] text')]
      .map((node) => /^최대\s+([\d,]+)$/.exec(node.textContent.trim()))
      .find(Boolean);
    const screenMini = label ? index(label[1]) : null;
    const expected = chair?.sessionPeak;
    const ok = roomInView('s6') && quietTail && png?.width === 1080 && png.height === 1350 && expected > 0
      && [screenLed, screenMini, png.led, png.mini].every((value) => value === expected);
    return { ok, expected, quietTail, newest, screenLed, screenMini, png: png ?? null };
  }

  function sampleRelay(report) {
    const [record] = relay();
    if (!record || report.hadRecord) return;
    const s3Visible = roomInView('s3');
    const label = [...document.querySelectorAll('#s3 svg[data-art-marks] text')]
      .find((node) => node.textContent.includes('6층 의자'));
    if (report.chairValue === null) {
      report.chairValue = record.value;
      report.recordedInS3 = s3Visible && inView(label);
    }
    if (!s3Visible) return;
    const lamp = query('#s3 [data-physics-lamp="5"]');
    const angle = angleOf(lamp);
    if (inView(lamp?.querySelector('path.ln-body')) && Number.isFinite(angle) && Number.isFinite(report.baselineAngle)) {
      report.maxVisibleSwing = Math.max(report.maxVisibleSwing, Math.abs(angle - report.baselineAngle));
    }
    report.reactionInView ||= inView(query('#s3 [data-react="5"]'));
  }

  function samplePendant(report) {
    if (!roomInView('s0')) return;
    const stage = query('#s0 [data-stage="s0"]');
    const geo = window.LandingArt?.geometry?.('s0');
    const lamp = stage?.querySelector('[data-physics-lamp="6"]');
    const shade = lamp?.querySelector('path.ln-body');
    const line = geo?.lines?.ceilings?.[6];
    const angle = angleOf(lamp);
    if (!shade || !Number.isFinite(line) || !Number.isFinite(angle) || !(geo.h > 0)) return;
    const room = stage.getBoundingClientRect();
    const box = shade.getBoundingClientRect();
    if (!box.width || !box.height || shade.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) === false) return;
    const slab = room.top + line * room.height / geo.h;
    const clearance = box.top - slab;
    report.samples += 1;
    report.maxAbsAngle = Math.max(report.maxAbsAngle, Math.abs(angle));
    report.minClearance = report.minClearance === null ? clearance : Math.min(report.minClearance, clearance);
    if (upper().some(({ n }) => n > report.baselineRecord)) report.samplesAfterDrop += 1;
  }

  function sample() {
    if (observation.kind === 'relay') sampleRelay(observation);
    else samplePendant(observation);
    animationFrame = requestAnimationFrame(sample);
  }

  function finish(kind) {
    cancelAnimationFrame(animationFrame);
    return observation?.kind === kind ? observation : null;
  }

  function cardGrounded() {
    const mini = query('#s6 svg[data-card-mini]');
    const line = mini?.querySelector('[data-card-floor]')
      ?? [...(mini?.querySelectorAll('.floor-stack') ?? [])].at(-1)?.querySelector('line.ln-cut');
    const matrix = line?.getScreenCTM();
    if (!mini || !matrix || !roomInView('s6')) return { ok: false, error: 'S6 카드 바닥선 미관측' };
    const floorY = new DOMPoint(Number(line.getAttribute('x1')), Number(line.getAttribute('y1'))).matrixTransform(matrix).y;
    const scale = Math.hypot(matrix.c, matrix.d);
    const bodies = ['ball', 'chair', 'cup'].map((kind) => {
      const body = mini.querySelector(`[data-card-body="${kind}"], .${kind}`);
      let bottom = -Infinity;
      for (const shape of body?.querySelectorAll('circle, ellipse, line, path, polygon, polyline, rect') ?? []) {
        const transform = shape.getScreenCTM();
        if (!transform) continue;
        const length = shape.getTotalLength();
        const segments = Math.max(1, Math.ceil(length / 2));
        for (let step = 0; step <= segments; step += 1) {
          const point = shape.getPointAtLength(length * step / segments);
          bottom = Math.max(bottom, new DOMPoint(point.x, point.y).matrixTransform(transform).y);
        }
      }
      return { kind, floorGap: Number.isFinite(bottom) && scale > 0 ? (floorY - bottom) / scale : null };
    });
    return { ok: bodies.every(({ floorGap }) => floorGap !== null && Math.abs(floorGap) <= 3), bodies };
  }

  window.__landingthonVerify = {
    async observeReplayBeats() {
      if (!window.LandingBuilding?.createClimaxScrollMap) return;
      replayBeats = [];
      const { createBuilding } = await import('@landing/engines/physics-building.js');
      const prototype = Object.getPrototypeOf(createBuilding());
      const { deliver } = prototype;
      prototype.deliver = function (event) {
        if (event.kind === 'replay' && event.track === 'upper' && event.sequence > 0 && roomInView('s2')) {
          replayBeats.push({ n: event.sequence, value: event.index, label: event.label ?? '쿵' });
        }
        return deliver.call(this, event);
      };
    },
    focus(selector) {
      const node = query(selector);
      if (!inView(node) || node.tabIndex < 0 || node.matches(':disabled,[aria-disabled="true"]')) return false;
      node.focus({ preventScroll: true });
      return document.activeElement === node;
    },
    focused(selector) {
      const node = document.activeElement;
      return Boolean(node?.matches(selector) && inView(node) && !node.matches(':disabled,[aria-disabled="true"]'));
    },
    reveal(selector) {
      const node = query(selector);
      if (!node || node.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) === false) return false;
      node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      return true;
    },
    pointIn({ selector, scope, target, room }) {
      const artwork = query(selector);
      const container = artwork?.closest(scope);
      if (!container || !inView(artwork)) return null;
      const rect = artwork.getBoundingClientRect();
      let x = rect.left + rect.width / 2;
      let y = rect.top + rect.height / 2;
      if (room) {
        const geometry = window.LandingArt?.geometry?.(container.dataset.stage);
        const top = geometry?.lines?.ceilings?.[7] ?? geometry?.ceilings?.[7];
        const bottom = geometry?.floors?.[7];
        if (!Number.isFinite(top) || !Number.isFinite(bottom) || !(geometry.h > 0)) return null;
        x = rect.left + rect.width * room[0];
        y = rect.top + (top + (bottom - top) * room[1]) * rect.height / geometry.h;
      }
      const hit = document.elementFromPoint(x, y);
      return container.contains(hit) && (!target || hit.closest(target)) && (!room || !hit.closest('[data-action]')) ? { x, y } : null;
    },
    watch(kind) {
      if (kind.startsWith('v07-')) return f3.watch(kind);
      if (kind.startsWith('v09-')) return v09.watch(kind);
      if (kind.startsWith('v06b-')) return additions.watch(kind);
      if (kind.startsWith('v06-')) return currentScenes.watch(kind);
      if (kind === 'v04-s2-repeat') return newScenes.watchRepeat();
      if (kind === 'v05-s4') return laterScenes.startChairTrace();
      if (kind === 'v05-s6-link-position') return laterScenes.startSummaryLinkTrace();
      if (kind === 's0-tape') return watchS0Tape();
      if (kind === 'card-png') {
        readPng = watchCardPng();
        return;
      }
      cancelAnimationFrame(animationFrame);
      observation = kind === 'relay' ? {
        kind, hadRecord: relay().length > 0,
        baselineAngle: angleOf(query('#s3 [data-physics-lamp="5"]')),
        chairValue: null, recordedInS3: false, maxVisibleSwing: 0, reactionInView: false,
      } : {
        kind, baselineRecord: Math.max(0, ...upper().map(({ n }) => n)),
        samples: 0, samplesAfterDrop: 0, maxAbsAngle: 0, minClearance: null,
      };
      sample();
    },
    check(options) {
      const { state, min, count: expectedCount, enabled } = options;
      if (state.startsWith('v10k-')) return v10k.check(options);
      if (state.startsWith('v09-')) return v09.check(options);
      if (state.startsWith('v08-')) return v08.check(options);
      if (state.startsWith('v07-')) return f3.check(options);
      if (state.startsWith('v06b-')) return additions.check(options);
      if (state.startsWith('v06-')) return currentScenes.check(options);
      if (state.startsWith('v04-')) return newScenes.check(options);
      if (state.startsWith('v05-')) return laterScenes.check(options);
      if (state === 'records') {
        const count = new Set(upper().map(({ n }) => n)).size;
        return { ok: count >= min, count };
      }
      if (state === 'replay-pending') {
        const sequences = upper().map(({ n }) => n);
        const current = replayBeats ? replayBeats.at(-1)?.n
          : Number(query('#s2 [data-fx="replay-feedback"]')?.textContent.match(/재생.*쿵\s*#(\d+)/)?.[1]);
        const latest = Math.max(0, ...sequences);
        return { ok: roomInView('s2') && sequences.includes(current) && current < latest, current, latest };
      }
      if (state === 'relay-visible') {
        const report = finish('relay');
        const count = relay().length;
        const ok = Boolean(report?.recordedInS3 && report.chairValue > 0 && report.maxVisibleSwing >= 0.01
          && (expectedCount === undefined || count === expectedCount));
        return { ...report, count, ok };
      }
      if (state === 'relay-button') {
        const button = query('#s3 button[data-action="nudge"]');
        const ariaDisabled = button?.getAttribute('aria-disabled');
        const count = relay().length;
        const ok = roomInView('s3') && inView(button) && ariaDisabled === String(!enabled) && (!enabled || count === 0);
        return { ok, ariaDisabled, count };
      }
      if (state === 'pendulum-safe') {
        const report = finish('pendulum');
        return { ...report, ok: Boolean(report?.samplesAfterDrop > 1 && report.maxAbsAngle <= 0.6 && report.minClearance >= -0.5) };
      }
      if (state === 'card-grounded') return cardGrounded();
      if (state === 's1-throw-recorded') {
        const record = feedbackRecord(text('#s1 [data-fx="gesture-feedback"]'));
        const newestS0 = Math.max(0, ...(s0Tape?.baseline ?? []).map(({ n }) => n));
        return { ok: roomInView('s1') && record?.label === '쿵' && record.n > newestS0 && record.value > 0, record };
      }
      if (state === 's0-replayed') {
        const { baseline, replayed, observer, collect } = s0Tape;
        collect(observer.takeRecords());
        observer.disconnect();
        const retained = upper();
        const observedBeats = replayBeats ?? replayed;
        const missing = baseline.filter((item) => !retained.some((record) => sameRecord(item, record))
          || !observedBeats.some((record) => record.label === '쿵' && sameRecord(item, record)));
        return { ok: matchMedia('(prefers-reduced-motion: reduce)').matches && roomInView('s2') && missing.length === 0,
          baseline, replayed: observedBeats, missing };
      }
      if (state === 'chair-index') {
        const record = feedbackRecord(text('#s1 [data-fx="gesture-feedback"]'));
        const records = upper();
        const ok = roomInView('s1') && record?.label === '드르륵' && record.value >= 0 && record.value <= 200
          && records.some((item) => item.label === '드르륵' && sameRecord(item, record));
        if (ok) chair = { ...record, sessionPeak: Math.max(...records.map(({ value }) => value)) };
        return { ok, record };
      }
      if (state === 'card-png') return cardPng();
      if (state === 'mat-card-peak') {
        const bare = index(text('#s5 [data-impact-before]'));
        const peak = index(text('#s6 [data-result-peak]'));
        const records = upper().length;
        const done = query('#s5')?.dataset.matTest === 'done';
        return { ok: roomInView('s6') && done && records === 0 && bare > 0 && peak === bare, bare, peak, records, done };
      }
      if (state === 'flip-spot' || state === 'same-flip-spot') {
        if (state === 'flip-spot') initialFlipScroll = scrollY;
        const distance = Math.abs(scrollY - initialFlipScroll);
        return { ok: roomInView('s4') && distance <= 2, initialFlipScroll, scrollY, distance };
      }
      const stage = query('#s4 [data-flip-layer]:not([data-building-mirror])');
      const gy = Number(stage?.dataset.gravityY);
      const phase = stage?.dataset.climaxPhase;
      const listening = query('#main')?.hasAttribute('data-listening');
      const transform = stage ? getComputedStyle(stage).transform : 'none';
      const matrix = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform);
      const angle = Math.abs(Math.atan2(matrix.m12, matrix.m11) * 180 / Math.PI);
      const ok = state === 'inverted' ? listening && gy < 0 && phase === 'listen' && angle >= 178
        : !listening && gy > 0 && phase === 'settle' && angle <= 2;
      return { ok: roomInView('s4') && Boolean(ok), phase, gy, angle, scrollY };
    },
  };
}
