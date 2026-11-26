export const v06bStates = [
  'v06b-s4-window', 'v06b-s4-ready', 'v06b-s4-before-listen', 'v06b-s4-listening', 'v06b-s4-hold', 'v06b-s4-return-hidden',
  'v06b-s4-return-shown', 'v06b-s4-return-fade', 'v06b-s4-reset-ready', 'v06b-s4-next-first', 'v06b-s4-next-again',
  'v06b-s4-landscape', 'v06b-u08-visible', 'v06b-u08-clear', 'v06b-s2-pass',
  'v06b-s2-equivalent', 'v06b-mat-label',
];
export const v06bWatches = ['v06b-s4-hold', 'v06b-s4-return-fade', 'v06b-s4-landscape', 'v06b-u08', 'v06b-s2'];

export function validV06bExpectation({ state, wait, pass, source }) {
  return (wait === undefined || Number.isFinite(wait) && wait >= 0 && wait <= 8)
    && (state === 'v06b-s2-pass' ? pass === 1 || pass === 2 : pass === undefined)
    && (state === 'v06b-mat-label' ? ['reference', 'peak'].includes(source) : source === undefined);
}

// 브라우저 탭에서 렌더 프레임을 읽는다. 진동은 러너가 Android 응답으로 모의한다.
export function installV06bVerification({ query, inView, roomInView, artRecords, cardPng }) {
  const tidy = (value) => (value ?? '').replace(/\s+/g, ' ').trim();
  const layer = '#s4 [data-flip-layer]:not([data-building-mirror])';
  const listen = '#s4 [data-flip-cue="listen"]';
  const caption = `${listen} .display`;
  const returnCue = '#s4 [data-flip-cue="return"]';
  const matLink = '#s4 a:is([data-action="s4-next"],[data-action="cushion-next"])[href="#s5"]';
  const chairMark = '#s4 .s4-chair-mark[data-mark-label="6층 의자"]';
  const all = (selector) => [...document.querySelectorAll(selector)];
  const box = (node) => node?.getBoundingClientRect().toJSON() ?? null;
  const drawn = (node) => {
    if (!node || node.closest('[hidden]') || node.checkVisibility({ visibilityProperty: true, opacityProperty: true }) === false) return false;
    for (let parent = node; parent; parent = parent.parentElement) {
      if (Number(getComputedStyle(parent).opacity) < 0.01) return false;
    }
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const overlap = (a, b) => a && b && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5
    && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
  const text = (selector) => tidy(query(selector)?.textContent);

  function s4() {
    const section = query('#s4');
    const panel = section?.querySelector('[data-motion-sticky]');
    const rect = section?.getBoundingClientRect();
    const panelHeight = panel?.getBoundingClientRect().height;
    const stage = query(layer);
    const transform = stage && getComputedStyle(stage).transform;
    const matrix = new DOMMatrixReadOnly(!transform || transform === 'none' ? undefined : transform);
    const degrees = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
    const phase = stage?.dataset.climaxPhase;
    const angle = Math.abs(degrees) < 0.01 ? (phase === 'settle' ? 360 : 0) : (degrees + 360) % 360;
    const opacity = all('#s4 [data-building-mirror]').reduce((max, node) => {
      const style = getComputedStyle(node);
      return Math.max(max, node.hidden || style.visibility === 'hidden' || style.display === 'none' ? 0 : Number(style.opacity));
    }, 0);
    const words = all('#s4 [data-s4-slab-label]').filter(drawn).map((node) => tidy(node.textContent));
    return { phase, angle, opacity, offset: rect ? -rect.top : null, travel: rect?.height - panelHeight, panelHeight,
      scrollY, listening: inView(query(caption)), card: drawn(query(returnCue)), words };
  }

  function listening(snap) {
    return snap.phase === 'listen' && snap.listening && !snap.card && /이제 당신이 아래층입니다/.test(text(caption));
  }

  function settledListening(snap) {
    // 줄이기의 끝점은 미러를 지우고 실제 레이어를 180°에 놓을 수도 있다.
    return listening(snap) && (Math.abs(snap.angle - 180) <= 2 && snap.opacity <= 0.01 || snap.opacity >= 0.99);
  }

  function scrollMap(snap) {
    return window.LandingBuilding?.createClimaxScrollMap?.({
      travel: snap.travel, panelHeight: snap.panelHeight, viewportHeight: innerHeight,
    });
  }

  function scrubTarget(snap) {
    const progress = scrollMap(snap)?.progressAt(snap.offset);
    if (!Number.isFinite(progress)) return { progress, angle: null, settled: false };
    const angle = progress <= 0.25 ? 0 : progress < 0.55 ? 180 * (progress - 0.25) / 0.3
      : progress <= 0.75 ? 180 : Math.min(360, 180 + 180 * (progress - 0.75) / 0.2);
    return { progress, angle, settled: Math.abs(snap.angle - angle) <= 1 };
  }

  function windowSize(snap) {
    const map = scrollMap(snap);
    const width = map ? map.listenEnd - map.listenStart : null;
    return { ok: Boolean(map && Math.abs(snap.panelHeight - innerHeight) <= 1
      && Math.abs(snap.travel / snap.panelHeight - 2.5) <= 0.005 && Math.abs(width / snap.panelHeight - 1.22) <= 0.005),
    start: map?.listenStart, end: map?.listenEnd, width, screens: width === null ? null : width / snap.panelHeight,
    panelHeight: snap.panelHeight, travel: snap.travel };
  }

  async function returnCheck(visible) {
    const { snap, frameAt } = await new Promise((resolve) => {
      requestAnimationFrame((frameAt) => resolve({ snap: s4(), frameAt }));
    });
    const target = scrubTarget(snap);
    const cue = window.LandingBuilding?.visibleClimaxCue;
    const boundary = typeof cue === 'function' ? [
      cue('return', 329.9 * Math.PI / 180), cue('return', 330 * Math.PI / 180),
      cue('settle', 2 * Math.PI), cue('return', 2 * Math.PI, { invertedOpacity: 0.25 }),
    ] : [];
    const expected = visible ? ['7층 바닥', '6층 천장'] : ['6층 바닥', '7층 천장'];
    const labels = snap.words.length === expected.length && expected.every((word) => snap.words.includes(word));
    return { ok: roomInView('s4') && target.settled && labels && boundary.join() === 'returning,return,settle,returning'
      && (visible ? snap.card && snap.phase === 'return' && snap.angle >= 330 && snap.angle < 359.9
        : !snap.card && snap.phase === 'returning' && snap.angle > 180 && snap.angle < 330),
    frameAt, snap, target, expected, boundary };
  }

  let hold, fade, landscape, notice;
  function trace(target, limitMs, sample) {
    const start = performance.now();
    function frame(now) {
      sample(target, now - start);
      if (!target.done && now - start < limitMs) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function watchFade() {
    fade = { partial: 0, early: [], end: null, done: false };
    trace(fade, 5000, (result, elapsed) => {
      const snap = s4();
      if (snap.opacity > 0.01 && snap.opacity < 0.99) result.partial++;
      if (snap.opacity > 0 && snap.card) result.early.push({ elapsed, opacity: snap.opacity, phase: snap.phase });
      if (snap.opacity === 0 && (snap.angle <= 2 || snap.angle >= 358) && snap.card) {
        result.end = { elapsed, phase: snap.phase, words: snap.words };
        result.done = true;
      }
    });
  }

  function watchLandscape() {
    landscape = { paired: 0, marker: 0, bubble: 0, frame: null, conflicts: [], done: false };
    trace(landscape, 7000, (result, elapsed) => {
      if (!roomInView('s4')) return;
      const marks = all(`${chairMark} :is(.tag rect, .tag text)`).filter(drawn).map(box);
      const bubbles = all('#s4 [data-react="7"]').filter(drawn).map(box);
      if (marks.length) result.marker++;
      if (bubbles.length) result.bubble++;
      if (!marks.length || !bubbles.length) return;
      result.paired++;
      const sample = { elapsed, marks, bubbles };
      result.frame ??= sample;
      if (marks.some((mark) => bubbles.some((bubble) => overlap(mark, bubble))) && result.conflicts.length < 8) {
        result.conflicts.push(sample);
      }
    });
  }

  function watchNotice() {
    notice = { shown: 0, paired: 0, first: null, s3: 0, s3Away: false, conflicts: [], done: false };
    trace(notice, 10000, (result, elapsed) => {
      const cue = query('[data-cue="u-08"]');
      const inS3 = roomInView('s3') && !roomInView('s2');
      if (inS3) {
        result.s3++;
        result.s3Away ||= Boolean(cue && !cue.hidden && getComputedStyle(cue).visibility === 'hidden');
      }
      if (!drawn(cue)) return;
      result.shown++;
      const bounds = box(cue);
      result.first ??= { elapsed, bounds };
      if (drawn(query('#s2 [data-react="laptop"]'))) result.paired++;
      for (const selector of [
        '#s2 [data-physics-body^="6:"]', '#s2 [data-react]', '#s2 [data-place="s2-copy"]',
        '#s3 [data-place="s3-top"]', '#s3 button[data-action="nudge"]',
      ]) {
        for (const node of all(selector)) {
          if (result.conflicts.length >= 12) break;
          if (!drawn(node)) continue;
          const target = box(node);
          if (overlap(bounds, target)) result.conflicts.push({ elapsed, selector, bounds, target });
        }
      }
    });
  }

  const replayRuns = [];
  async function watchReplay() {
    const { createBuilding } = await import('@landing/engines/physics-building.js');
    const prototype = Object.getPrototypeOf(createBuilding());
    const { replay, deliver } = prototype;
    const art = window.LandingArt;
    const { setCurrent, cursor } = art;
    prototype.replay = function (track, tape) {
      const accepted = replay.apply(this, arguments);
      if (accepted && track === 'upper' && roomInView('s2')) {
        replayRuns.push({ tape: (tape ?? this.recording('upper')).map((event) =>
          ({ n: event.sequence, value: event.index, x: event.point.x / this.width, label: event.label ?? '쿵' })),
        beats: [], selected: [], cursors: [], live: [] });
      }
      return accepted;
    };
    prototype.deliver = function (event) {
      const result = deliver.call(this, event);
      const run = replayRuns.at(-1);
      if (run && event.kind === 'replay' && event.track === 'upper') {
        run.beats.push({ n: event.sequence, value: event.index, copy: text('#s2 [data-cue="s2-after"]') });
      }
      return result;
    };
    art.setCurrent = function (n) {
      if (roomInView('s2')) replayRuns.at(-1)?.selected.push(n);
      return setCurrent.apply(this, arguments);
    };
    art.cursor = function (scene, x) {
      if (scene === 's2') replayRuns.at(-1)?.cursors.push(x);
      return cursor.apply(this, arguments);
    };
    const live = query('#s2 [data-fx="replay-feedback"]');
    new MutationObserver((entries) => {
      const run = replayRuns.at(-1);
      for (const entry of entries) {
        const spoken = [...entry.addedNodes].map((node) => tidy(node.textContent)).filter(Boolean);
        if (run) run.live.push(...spoken);
      }
    }).observe(live, { childList: true });
  }

  const peakOf = (run) => run?.tape.reduce((best, event) => !best || event.value > best.value ? event : best, null);
  function replayPass(pass) {
    const run = replayRuns[pass - 1];
    // 기본 낙하의 반동도 순번에 들어가므로 높은 낙하의 번호는 테이프에서 읽는다.
    const peak = peakOf(run);
    const expected = peak ? `같은 ${peak.label} #${peak.n} · ${peak.value}, 듣는 자리만 다릅니다.` : '';
    const tag = all('#s2 .tag.is-now[data-mark-n]').find((node) => Number(node.dataset.markN) === peak?.n && drawn(node));
    const matchingTag = Boolean(tag && Number(tag.dataset.markValue) === peak.value && Math.abs(Number(tag.dataset.markX) - peak.x) <= 0.005);
    const cue = '#s2 [data-cue="s2-after"]';
    const copy = text(cue);
    const decksMatch = pass === 1 || JSON.stringify(replayRuns[0]?.tape) === JSON.stringify(run?.tape);
    return { ok: roomInView('s2') && inView(query(cue)) && replayRuns.length === pass && peak?.n > 1 && peak.value === 200
      && run.tape.some(({ n, value }) => n < peak.n && value === 100) && run.beats.length === run.tape.length
      && run.beats.every(({ n, value, copy }, i) => n === run.tape[i].n && value === run.tape[i].value && copy === expected)
      && run.selected.length > 0 && run.selected.every((n) => n === peak.n)
      && run.cursors.length > 0 && run.cursors.every((x) => Math.abs(x - peak.x) <= 0.005)
      && run.live.length === 1 && run.live[0] === expected && copy === expected && matchingTag && decksMatch,
    pass, run, peak, expected, copy, matchingTag, decksMatch };
  }

  async function matLabel(source) {
    const mat = query('#s6 [data-result-mat]');
    const screen = tidy(mat?.innerText ?? mat?.textContent);
    const allowed = source === 'reference' ? ['방 절반 높이 · 매트 위에선 쿵 100 → 56', '절반 높이 · 매트 100 → 56']
      : ['매트 위에선 쿵 200 → 114'];
    const peak = Number(text('#s6 [data-result-peak]'));
    const png = await cardPng();
    const rows = new Map();
    for (const { text, y, x } of png?.matDraw ?? []) {
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ text, x });
    }
    const painted = [...rows.values()].map((row) => tidy(row.sort((a, b) => a.x - b.x).map((part) => part.text).join('')));
    return { ok: roomInView('s6') && drawn(mat) && mat.dataset.matHeightSource === source && allowed.includes(screen)
      && (source === 'peak' ? peak === 200 : peak >= 25 && peak <= 35)
      && png?.width === 1080 && png.height === 1350 && painted.includes(screen),
    source, applied: mat?.dataset.matHeightSource, screen, painted, peak, png };
  }

  return {
    watch(kind) {
      if (kind === 'v06b-s4-hold') hold = s4();
      if (kind === 'v06b-s4-return-fade') watchFade();
      if (kind === 'v06b-s4-landscape') watchLandscape();
      if (kind === 'v06b-u08') watchNotice();
      if (kind === 'v06b-s2') return watchReplay();
    },
    check({ state, pass, source }) {
      switch (state) {
        case 'v06b-s4-window': return windowSize(s4());
        case 'v06b-s4-ready': {
          const snap = s4();
          const flip = query('#s4 button[data-action="flip"]');
          return { ok: roomInView('s4') && snap.phase === 'ready' && snap.angle <= 2 && inView(flip)
            && !flip.matches(':disabled,[aria-disabled="true"]'), snap };
        }
        case 'v06b-s4-before-listen': {
          const snap = s4();
          const target = scrubTarget(snap);
          return { ok: roomInView('s4') && target.settled && snap.phase === 'invert' && !snap.listening
            && snap.angle > 135 && snap.angle < 180 && !snap.card, snap, target };
        }
        case 'v06b-s4-listening': {
          const snap = s4();
          const impacts = artRecords().filter(({ slab, label }) => slab === '6-7' && label === '6층 의자');
          return { ok: roomInView('s4') && settledListening(snap)
            && impacts.length === 1 && inView(query(`${listen} [data-cue="s4-06"]`)) && drawn(query(`${chairMark} text`)),
          snap, impacts };
        }
        case 'v06b-s4-hold': {
          const snap = s4();
          const delta = hold && snap.scrollY - hold.scrollY;
          return { ok: hold && settledListening(hold) && settledListening(snap) && Math.abs(delta - innerHeight) <= 2, hold, snap, delta };
        }
        case 'v06b-s4-return-hidden': return returnCheck(false);
        case 'v06b-s4-return-shown': return returnCheck(true);
        case 'v06b-s4-return-fade':
          return { ok: fade?.partial > 0 && !fade.early.length && fade.end?.words.includes('7층 바닥') && fade.end.words.includes('6층 천장'), fade };
        case 'v06b-s4-reset-ready': {
          const button = query('#s4 button[data-action="reset-flip"]');
          const hidden = button?.hidden ?? null;
          const disabled = button?.getAttribute('aria-disabled') ?? null;
          const visible = inView(button);
          return { ok: hidden === false && disabled === 'false' && visible, hidden, disabled, visible };
        }
        case 'v06b-s4-next-first':
        case 'v06b-s4-next-again': {
          const flip = query('#s4 button[data-action="flip"]');
          const next = query(matLink);
          const hint = query('#s4 [data-place="s4-controls"] .hint');
          const visited = query('#s4')?.dataset.flipSeen === 'true';
          const again = state.endsWith('again');
          const snap = s4();
          const nextColor = next && getComputedStyle(next).backgroundColor;
          const flipColor = flip && getComputedStyle(flip).backgroundColor;
          const ok = roomInView('s4') && inView(flip) && Boolean(next) && visited === again
            && (again ? snap.phase === 'settle' && snap.angle >= 358 : snap.phase === 'ready' && snap.angle <= 2)
            && text('#s4 button[data-action="flip"]') === (again ? '한 번 더 뒤집기' : '중력 뒤집기')
            && (again ? inView(next) && tidy(next.textContent) === '다시 7층으로' && next.matches('.btn-primary')
                && !drawn(hint) && nextColor !== flipColor
              : next.hidden && !drawn(next) && drawn(hint));
          return { ok, visited, next: tidy(next?.textContent), flip: tidy(flip?.textContent), hint: drawn(hint), nextColor, flipColor, snap };
        }
        case 'v06b-s4-landscape':
          if (landscape && landscape.paired && landscape.bubble && !all('#s4 [data-react="7"]').some(drawn)) landscape.done = true;
          return { ok: innerWidth === 844 && innerHeight === 390 && landscape?.done
            && landscape.paired >= 2 && !landscape.conflicts.length, landscape };
        case 'v06b-u08-visible':
          return { ok: innerWidth === 320 && notice?.shown >= 2 && notice.paired > 0 && drawn(query('[data-cue="u-08"]'))
            && window.__qaHapticPulses?.length > 0, notice, pulses: window.__qaHapticPulses };
        case 'v06b-u08-clear':
          if (notice?.s3Away) notice.done = true;
          return { ok: notice?.done && !notice.conflicts.length && !drawn(query('[data-cue="u-08"]')), notice };
        case 'v06b-s2-pass': return replayPass(pass);
        case 'v06b-s2-equivalent': {
          const [first, second] = replayRuns;
          const maximum = peakOf(first);
          const pair = artRecords().filter(({ slab, n }) => slab === '7-6' && n === maximum?.n);
          const peak = Number(text('#s6 [data-result-peak]'));
          const recap = text('#s6 [data-recap="kung"] [data-recap-from]');
          return { ok: roomInView('s6') && first?.live.length === 1 && second?.live.length === 1 && first.live[0] === second.live[0]
            && maximum?.value === peak && peak === 200 && recap === `쿵 #${maximum.n} · ${peak}`
            && pair.some(({ value }) => value === peak), recap, peak, maximum };
        }
        case 'v06b-mat-label': return matLabel(source);
      }
    },
  };
}
