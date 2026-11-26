export const v06States = [
  'v06-engine-drag', 'v06-engine-queue', 'v06-gesture', 'v06-burst', 'v06-cancel', 'v06-burst-card',
  'v06-first-live', 'v06-floor-live', 'v06-s4-chair', 'v06-inverted', 'v06-s4-line-before', 'v06-s4-line-after',
  'v06-s4-line-during', 'v06-s4-line-return', 'v06-s4-question', 'v06-pause-moving', 'v06-pause-held', 'v06-pause-resumed',
  'v06-mat', 'v06-mat-card', 'v06-mat-repeat-live', 'v06-home', 'v06-home-mat', 'v06-coda',
];
export const v06Watches = ['v06-live', 'v06-input', 'v06-camera', 'v06-line'];

export function validV06Expectation({ state, wait, before, after }) {
  return (wait === undefined || Number.isFinite(wait) && wait >= 0 && wait <= 8)
    && (['v06-mat', 'v06-mat-card', 'v06-mat-repeat-live'].includes(state)
      ? before === 100 && after === 56 || before === 200 && after === 114
      : before === undefined && after === undefined);
}

// 이 함수는 직렬화해 검사 탭에 주입한다. 엔진 모듈은 빌드의 import map에서 읽는다.
export function installV06Verification({ query, inView, roomInView, artRecords }) {
  const layerSelector = '#s4 [data-flip-layer]:not([data-building-mirror])';
  const matButton = '#s5 [data-mat-result]';
  const tidy = (value) => (value ?? '').replace(/\s+/g, ' ').trim();
  const text = (selector) => tidy(query(selector)?.textContent);
  const integer = (selector) => /^\d+$/.test(text(selector).replaceAll(',', '')) ? Number(text(selector).replaceAll(',', '')) : null;
  const importEngine = (engine) => import(`@landing/engines/${engine}.js`);
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const box = (node) => {
    const rect = node?.getBoundingClientRect();
    return rect ? [rect.left, rect.top, rect.right, rect.bottom] : null;
  };

  async function dragTrials() {
    const { createBuilding } = await importEngine('physics-building');
    const trials = [60, 120, 144].map((hz) => {
      const building = createBuilding();
      const hits = [];
      building.onReceive((event) => { if (event.action === 'dragChair') hits.push(event); });
      const start = 190.3, travel = 300;
      const x = building.rooms.get(7).props.chair.x;
      const samples = Array.from({ length: Math.floor((travel - 1) / 8) }, (_, i) => {
        const t = (i + 1) * 8;
        return [start + t, x - 70 * t / travel + 40 * Math.sin(t / 21)];
      });
      samples.push([start + travel, x - 70]);
      const end = start + travel + 150;
      let accumulator = 0, previous = 0, grabbed, released, sent = 0, inputs = true;
      for (let frame = 0; frame <= 4 * hz; frame++) {
        const time = frame * 1000 / hz;
        if (grabbed === undefined && time >= start) grabbed = building.input({ type: 'grabChair', x, timeMs: start });
        while (samples[sent]?.[0] <= time) {
          const [timeMs, position] = samples[sent++];
          inputs = building.pushPointerSample(timeMs, position) && inputs;
        }
        if (released === undefined && time >= end) released = building.input({ type: 'releaseChair', timeMs: end });
        accumulator += Math.min(0.08, (time - previous) / 1000);
        previous = time;
        for (let count = 0; accumulator >= building.dt && count < 8; count++) {
          building.step();
          accumulator -= building.dt;
        }
      }
      return { hz, inputs: Boolean(grabbed && released && inputs && sent === samples.length), hits: hits.length,
        index: hits[0]?.index, force: hits[0]?.force, distance: hits[0]?.dragDistance };
    });
    return { ok: trials.every(({ inputs, hits, index, force, distance }) => inputs && hits === 1 && index === 99
      && Math.abs(force - 607.496) <= 0.001 && Math.abs(distance - 9.466) <= 0.001), trials };
  }

  async function queueTrials() {
    const { createBuilding } = await importEngine('physics-building');
    const trials = [null, 'rotation', 'sensor'].map((turn) => {
      const building = createBuilding();
      const accepted = new Set(), recorded = new Map(), cancelled = new Map();
      let queueMax = 0;
      const step = (count) => { for (let i = 0; i < count; i++) building.step(); };
      building.onReceive((event) => {
        if (event.kind === 'live' && event.action === 'dropBall' && !recorded.has(event.actionId)) recorded.set(event.actionId, event);
      });
      building.onInputCancelled((event) => cancelled.set(event.actionId, event.reason));
      for (let i = 0; i < 12; i++) {
        const id = building.nextActionId;
        if (building.input({ type: 'dropBall', x: 120, y: 26 })) accepted.add(id);
        queueMax = Math.max(queueMax, building.dropQueue.length);
        if (i < 11) step(12);
      }
      const lastPress = building.world.time;
      if (turn === 'rotation') building.setProgress(0.65);
      if (turn === 'sensor') building.setSensorGravity({ x: 0, y: -920 }, { listening: true });
      step(360);
      const tail = Math.max(...[...recorded.values()].map(({ time }) => time - lastPress));
      const accounted = [...accepted].every((id) => recorded.has(id) !== cancelled.has(id))
        && recorded.size + cancelled.size === accepted.size;
      const tape = building.recording('upper');
      const ok = accepted.size === 4 && queueMax === 1 && !building.hasPendingDrop && accounted
        && new Set(tape.map(({ actionId }) => actionId)).size === recorded.size
        && tape.every(({ actionId }) => recorded.has(actionId) && !cancelled.has(actionId))
        && (turn ? recorded.size === 1 && cancelled.size === 3 && [...cancelled.values()].every((reason) => reason === turn)
          : recorded.size === 4 && tail <= 1.4);
      return { ok, turn, accepted: [...accepted], recorded: [...recorded.keys()], cancelled: [...cancelled], queueMax, tail,
        tape: tape.map(({ actionId, index }) => ({ actionId, index })) };
    });
    return { ok: trials.every(({ ok }) => ok), trials };
  }

  let observedBuilding;
  const presses = [], received = [], cancelled = [], pointer = [];
  async function observeInputs() {
    const { createBuilding } = await importEngine('physics-building');
    const prototype = Object.getPrototypeOf(createBuilding());
    const { input, deliver, pushPointerSample } = prototype;
    prototype.input = function (command) {
      if (observedBuilding !== this) {
        observedBuilding = this;
        this.onInputCancelled((event) => cancelled.push(event));
      }
      const at = performance.now(), id = this.nextActionId;
      const accepted = input.call(this, command);
      presses.push({ at, id, type: command.type, timeMs: command.timeMs ?? null, accepted, queue: this.dropQueue.length });
      return accepted;
    };
    prototype.deliver = function (event) {
      const chairX = event.cue === 's4-chair' ? this.rooms.get(6).props.chair.x / this.width : null;
      received.push({ kind: event.kind, n: event.actionId, action: event.action, slab: event.slab, x: event.point.x / this.width,
        value: event.index, cue: event.cue, chairX, source: event.sourceRoom, receiver: event.receiverRoom });
      return deliver.call(this, event);
    };
    prototype.pushPointerSample = function (timeMs, x) {
      const accepted = pushPointerSample.call(this, timeMs, x);
      if (accepted) pointer.push({ timeMs, x });
      return accepted;
    };
  }

  const live = [];
  function observeLive() {
    const previous = new WeakMap();
    function read(initial = false) {
      for (const node of document.querySelectorAll('output,[role="status"],[role="alert"],[aria-live]')) {
        const politeness = node.getAttribute('aria-live') ?? (node.getAttribute('role') === 'alert' ? 'assertive' : 'polite');
        const current = !node.closest('[hidden],[aria-hidden="true"],[inert]') && politeness !== 'off'
          && node.checkVisibility({ visibilityProperty: true, opacityProperty: true }) ? tidy(node.textContent) : '';
        if (current && previous.get(node) !== current && !initial) {
          live.push({ text: current, politeness, scene: node.closest('[data-scene]')?.dataset.scene, fx: node.dataset.fx,
            floor: node.hasAttribute('data-floor-live') });
        }
        previous.set(node, current);
      }
    }
    read(true);
    new MutationObserver(() => read()).observe(document.body, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['aria-live', 'aria-hidden', 'hidden', 'role', 'inert'] });
  }

  function stagePose() {
    const layer = query(layerSelector);
    if (!layer) return null;
    const style = getComputedStyle(layer);
    const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
    const angle = Math.abs(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI);
    const [sx = '1', sy = sx] = style.scale === 'none' ? [] : style.scale.split(/\s+/);
    const translation = style.translate === 'none' ? ['0px', '0px'] : style.translate.split(/\s+/);
    const xy = translation.slice(0, 2).map((value, i) => Number.parseFloat(value)
      * (value.endsWith('%') ? (i ? layer.clientHeight : layer.clientWidth) / 100 : 1));
    const positions = [...layer.querySelectorAll('[data-physics-body]:not([data-physics-body^="copy:"])')].map(box);
    return { angle, scale: [Number(sx) * Math.hypot(matrix.a, matrix.b), Number(sy) * Math.hypot(matrix.c, matrix.d)],
      translate: [matrix.e + xy[0], matrix.f + (xy[1] ?? 0)], stage: box(layer), positions,
      tick: Number(layer.dataset.motionTick), paused: query('#motion-pause')?.dataset.pressed === 'true' };
  }

  function samePose(a, b) {
    const close = (left, right, limit) => left.length === right.length
      && left.every((value, i) => Number.isFinite(value) && Math.abs(value - right[i]) <= limit);
    return a && b && Number.isFinite(a.tick) && a.tick === b.tick && Math.abs(a.angle - b.angle) <= 0.25
      && close(a.scale, b.scale, 0.002) && close(a.translate, b.translate, 0.5) && close(a.stage, b.stage, 0.75)
      && a.positions.length >= 3 && a.positions.length === b.positions.length
      && a.positions.every((rect, i) => close(rect, b.positions[i], 0.75));
  }

  let paused, resumed;
  const frozen = [];
  function observeCamera() {
    const toggle = query('#motion-pause');
    let before;
    toggle?.addEventListener('click', () => {
      before = stagePose();
    }, { capture: true });
    // 앱이 등록한 버튼 리스너 뒤에 읽는다. 네이티브 클릭의 캡처 마이크로태스크는 그보다 먼저 실행될 수 있다.
    toggle?.addEventListener('click', () => {
      const after = stagePose(), at = performance.now();
      if (!before || !after || before.paused === after.paused) return;
      if (!after.paused) {
        resumed = { at, before, after };
        return;
      }
      paused = { at, before, after };
      frozen.length = 0;
      function sample(now) {
        const pose = stagePose();
        if (!pose?.paused) return;
        frozen.push({ elapsed: now - at, pose });
        if (now - at < 900) requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
  }

  const beforeWords = ['7층 바닥', '6층 천장'];
  const afterWords = ['6층 바닥', '7층 천장'];
  const readingCue = '#s4 [data-flip-cue="listen"] .display';
  function upright(node) {
    const ctm = node.getScreenCTM?.();
    if (ctm) return ctm.a > 0 && Math.abs(Math.atan2(ctm.b, ctm.a)) <= Math.PI / 18;
    let radians = 0;
    for (let parent = node; parent; parent = parent.parentElement) {
      const { rotate, transform } = getComputedStyle(parent);
      if (transform !== 'none') {
        const matrix = new DOMMatrixReadOnly(transform);
        radians += Math.atan2(matrix.b, matrix.a);
      }
      if (rotate !== 'none') {
        const value = rotate.split(/\s+/).at(-1);
        radians += Number.parseFloat(value) * (value.endsWith('rad') ? 1 : value.endsWith('turn') ? 2 * Math.PI : Math.PI / 180);
      }
    }
    return Math.cos(radians) > 0 && Math.abs(Math.sin(radians)) <= Math.sin(Math.PI / 18);
  }
  function lineLabels(words) {
    return words.map((word, index) => {
      const role = index === 0 ? 'floor' : 'ceiling';
      const node = [...document.querySelectorAll(`#s4 [data-s4-slab-label="${role}"]`)]
        .find((candidate) => tidy(candidate.textContent) === word && inView(candidate));
      return { word, role, box: box(node), upright: node ? upright(node) : null,
        hiddenFromAX: Boolean(node?.closest('[aria-hidden="true"]')) };
    });
  }

  function line(state) {
    const words = state === 'v06-s4-line-after' ? afterWords : beforeWords;
    const labels = lineLabels(words);
    const other = lineLabels(words === beforeWords ? afterWords : beforeWords);
    const [a, b] = labels.map((label) => label.box);
    const overlap = a && b && Math.min(a[2], b[2]) > Math.max(a[0], b[0]) && Math.min(a[3], b[3]) > Math.max(a[1], b[1]);
    const pose = stagePose();
    const orderedY = a && b && a[3] <= b[1];
    const listening = inView(query(readingCue));
    const returned = state !== 'v06-s4-line-return' || inView(query('#s4 [data-flip-cue="return"]'));
    return { ok: roomInView('s4') && a && b && !overlap && labels.every(({ upright, hiddenFromAX }) => upright && hiddenFromAX)
      && (innerWidth > 360 || orderedY) && other.every(({ box: rect }) => !rect)
      && returned && (words === beforeWords ? pose?.angle <= 2 : listening && (reduced() || pose?.angle >= 177)),
    labels, other, angle: pose?.angle, overlap, orderedY, listening, returned };
  }

  let motionFrame, movingLabels = [];
  let listeningFrame, swappedFrame, lineFrame;
  function observeLine() {
    cancelAnimationFrame(motionFrame);
    movingLabels = [];
    listeningFrame = swappedFrame = undefined;
    lineFrame = 0;
    const deadline = performance.now() + 6000;
    function sample() {
      const pose = stagePose();
      lineFrame += 1;
      if (listeningFrame === undefined && inView(query(readingCue))) listeningFrame = lineFrame;
      if (swappedFrame === undefined && lineLabels(afterWords).every(({ box: rect }) => rect)) swappedFrame = lineFrame;
      if (pose && pose.angle >= 25 && pose.angle <= 155 && roomInView('s4')) {
        const labels = [...lineLabels(beforeWords), ...lineLabels(afterWords)].filter(({ box: rect }) => rect);
        movingLabels.push({ angle: pose.angle, labels });
      }
      if (performance.now() < deadline) motionFrame = requestAnimationFrame(sample);
    }
    motionFrame = requestAnimationFrame(sample);
  }

  async function burst(state) {
    const accepted = presses.filter(({ accepted, type }) => accepted && ['dropBall', 'tap'].includes(type));
    const delivered = received.filter((event) => event.kind === 'live' && event.source === 7 && event.receiver === 6
      && ['dropBall', 'tap'].includes(event.action));
    const events = new Map();
    for (const event of delivered) if (!events.has(event.n)) events.set(event.n, event);
    const shown = artRecords().filter(({ n, slab }) => n > 0 && slab === '7-6');
    const accounted = !observedBuilding?.hasPendingDrop && accepted.length === events.size + cancelled.length
      && accepted.every(({ id }) => events.has(id) !== cancelled.some(({ actionId }) => actionId === id));
    const queueMax = Math.max(...presses.map(({ queue }) => queue));
    const common = accounted && queueMax <= 1 && shown.length >= events.size && shown.length <= delivered.length
      && shown.every((record) => delivered.some(({ value, x }) => value === record.value && Math.abs(x - record.x) <= 0.005));
    if (state === 'v06-burst-card') {
      const { classifyBehavior } = await importEngine('fx-type');
      const relevant = accepted.filter(({ id }) => events.has(id));
      const result = classifyBehavior({ events: relevant.map(({ id, at }) => ({ index: events.get(id).value, timeMs: at })) }, { enableV11: true });
      const title = text('#s6 [data-result-title]');
      const count = Number(text('#s6 [data-result-detail]').match(/쿵\s*(\d+)번/)?.[1]);
      return { ok: roomInView('s6') && common && result.stats.burst >= 6 && title === result.title && result.stats.n === count,
        title, expectedTitle: result.title, count, expectedCount: result.stats.n, burst: result.stats.burst, accepted, queueMax, shown };
    }
    return { ok: common && (state === 'v06-cancel'
      ? cancelled.length > 0 && cancelled.every(({ reason }) => reason === 'rotation')
      : accepted.length > 0 && accepted.length < 12 && cancelled.length === 0),
    accepted, cancelled, queueMax, records: [...events.values()], shown, pending: observedBuilding?.hasPendingDrop };
  }

  function mat(state, before, after) {
    const values = [integer('#s5 [data-impact-before]'), integer('#s5 [data-impact-after]'), integer('#s5 [data-impact-reduction]')];
    const reduction = Math.round((1 - after / before) * 100);
    const message = `같은 높이에서 맨바닥 쿵 ${before}, 매트 위 쿵 ${after}. 쿵 지수가 ${reduction}% 줄었습니다.`;
    const s5Live = live.filter(({ scene, fx }) => scene === 's5' && fx === 'mat-feedback');
    const comparison = s5Live.filter(({ text }) => text === message || text === `${message} 6층 조명이 덜 흔들립니다.`);
    const bare = s5Live.filter(({ text }) => text === `맨바닥 쿵 ${before}.`);
    const repeat = s5Live.filter(({ text }) => text === `매트 위 쿵 ${after}.`);
    const s5Done = query('#s5')?.dataset.matTest === 'done' && values.join() === [before, after, reduction].join();
    if (state !== 'v06-mat-card') {
      const copy = text(matButton);
      const expectedCopy = `쿵 ${before} → ${after}. 쿵 지수가 ${reduction}% 줄었습니다.`;
      return { ok: s5Done && inView(query(matButton)) && copy === expectedCopy && bare.length === 1 && comparison.length === 1
        && (state === 'v06-mat-repeat-live' ? repeat.length === 1 : repeat.length === 0)
        && s5Live.every(({ politeness }) => politeness === 'polite'), values, copy, expectedCopy, s5Live };
    }
    const summary = '#s6 [data-recap="mat"]';
    const shown = [integer('#s6 [data-result-mat-before]'), integer('#s6 [data-result-mat-after]')];
    const recap = [Number(text(`${summary} [data-recap-from]`).match(/\d+/)?.[0]),
      Number(text(`${summary} [data-recap-to]`).match(/\d+/)?.[0])];
    const accessible = text(`${summary} [data-recap-sr]`);
    return { ok: roomInView('s6') && s5Done && inView(query(summary)) && shown.join() === [before, after].join()
      && recap.join() === shown.join() && new RegExp(`\\b${before}\\b.*\\b${after}\\b`).test(accessible),
    values, shown, recap, accessible };
  }

  let emptyPeakColor;
  return {
    watch(kind) {
      if (kind === 'v06-input') return observeInputs();
      if (kind === 'v06-live') return observeLive();
      if (kind === 'v06-camera') return observeCamera();
      if (kind === 'v06-line') return observeLine();
    },
    check({ state, before, after }) {
      if (state === 'v06-engine-drag') return dragTrials();
      if (state === 'v06-engine-queue') return queueTrials();
      if (state === 'v06-gesture') {
        const grab = presses.find(({ type, accepted }) => type === 'grabChair' && accepted);
        const release = presses.find(({ type, accepted }) => type === 'releaseChair' && accepted);
        const hits = received.filter(({ kind, action }) => kind === 'live' && action === 'dragChair');
        return { ok: Number.isFinite(grab?.timeMs) && Number.isFinite(release?.timeMs) && pointer.length >= 3
          && pointer.every(({ timeMs }, i) => timeMs >= (pointer[i - 1]?.timeMs ?? grab.timeMs) && timeMs <= release.timeMs)
          && hits.length === 1 && hits[0].value > 0, grab, release, pointer, hits };
      }
      if (['v06-burst', 'v06-cancel', 'v06-burst-card'].includes(state)) return burst(state);
      if (state === 'v06-first-live') {
        const first = artRecords().find(({ slab, n }) => slab === '7-6' && n > 0);
        const entries = live.filter(({ scene }) => scene === 's0');
        const expected = first && `쿵 #${first.n} · ${first.value}, 6층 천장에 닿았습니다.`;
        return { ok: Boolean(first && entries.length === 1 && entries[0].text === expected && entries[0].politeness === 'polite'),
          first, entries, expected };
      }
      if (state === 'v06-floor-live') {
        const entries = live.filter(({ floor, text: message }) => floor && /^5층에 도착/.test(message));
        return { ok: roomInView('s3') && entries.length === 1 && entries[0].politeness === 'polite', entries };
      }
      if (state === 'v06-s4-chair') {
        const events = received.filter(({ cue }) => cue === 's4-chair');
        const hit = events[0];
        const record = artRecords().findLast(({ slab, label }) => slab === '6-7' && label === '6층 의자');
        const marker = [...document.querySelectorAll('#s4 .s4-chair-mark[data-mark-label="6층 의자"]')]
          .find((node) => inView(node.querySelector('text')));
        const entries = live.filter(({ scene }) => scene === 's4');
        const semantic = hit && entries.filter(({ text: message, politeness }) => message === `6층 의자 · ${hit.value}, 7층 천장에 닿았습니다.`
          && politeness === 'polite');
        const wrong = entries.filter(({ text: message }) => /쿵\s*지수\s*\d+/.test(message));
        const orientation = live.filter(({ text: message, politeness }) => politeness === 'polite'
          && message === '건물이 뒤집혔습니다. 이제 7층이 맨 아래이고, 7층 바닥이던 선이 7층 천장입니다.');
        const markX = Number(marker?.dataset.markX);
        const delta = hit && Math.abs(markX - hit.chairX);
        const relay = artRecords().findLast(({ slab, label }) => slab === '6-5' && label === '6층 의자');
        return { ok: events.length === 1 && hit.source === 6 && hit.receiver === 7 && hit.slab === '6/7'
          && relay?.value === hit.value && Number(marker?.dataset.markValue) === hit.value && Math.abs(record?.x - hit.x) <= 0.005
          && delta <= 0.02 && Math.abs(hit.x - hit.chairX) <= 0.02 && semantic.length === 1 && !wrong.length && orientation.length === 1,
        relay, events, record, markX, delta, entries, orientation };
      }
      if (state === 'v06-inverted') {
        const pose = stagePose();
        const layer = query(layerSelector);
        return { ok: layer?.dataset.climaxPhase === 'listen' && (pose?.angle >= 177 || reduced())
          && Number(layer.dataset.gravityY) < 0, pose, phase: layer?.dataset.climaxPhase, gravityY: layer?.dataset.gravityY };
      }
      if (state === 'v06-s4-line-during') {
        const withLabels = movingLabels.filter(({ labels }) => labels.length === 2);
        return { ok: withLabels.length >= 2 && withLabels.every(({ labels }) => labels.every(({ upright }) => upright))
          && listeningFrame !== undefined && listeningFrame === swappedFrame,
        frames: movingLabels.length, withLabels: withLabels.length, listeningFrame, swappedFrame, samples: withLabels.slice(0, 4) };
      }
      if (state === 'v06-s4-question') {
        const question = query('#s4 [data-s4-question]');
        const pose = stagePose();
        return { ok: innerWidth === 390 && pose?.angle >= 105 && pose.angle <= 135 && inView(question) && upright(question)
          && Boolean(question.closest('[aria-hidden="true"]')) && tidy(question.textContent) === '중력을 뒤집으면?',
        angle: pose?.angle, question: box(question), copy: tidy(question?.textContent) };
      }
      if (state.startsWith('v06-s4-line-')) return line(state);
      if (state === 'v06-pause-moving') {
        const pose = stagePose();
        return { ok: pose?.angle >= 105 && pose.angle <= 135 && !pose.paused, pose };
      }
      if (state === 'v06-pause-held') return { ok: paused?.before.angle >= 101 && paused.before.angle <= 145
        && samePose(paused.before, paused.after) && frozen.at(-1)?.elapsed >= 250
        && frozen.every(({ pose }) => samePose(paused.before, pose)), paused, frames: frozen.length, last: frozen.at(-1) };
      if (state === 'v06-pause-resumed') {
        const pose = stagePose();
        return { ok: resumed?.before.paused && !resumed.after?.paused && samePose(resumed.before, resumed.after)
          && pose.tick > resumed.after.tick && Math.abs(pose.angle - resumed.after.angle) >= 1,
        resumed, pose };
      }
      if (state.startsWith('v06-mat')) return mat(state, before, after);
      if (state === 'v06-home' || state === 'v06-home-mat') {
        const section = query('#s6');
        const mode = section?.dataset.resultEmpty;
        const link = query('#s6 [data-result-empty] a[data-action="intro-revisit"][href="#s0"]');
        const isMat = state === 'v06-home-mat';
        const promptNode = query(isMat ? '#s6 .e1-mat' : '#s6 .e1-none');
        const other = query(isMat ? '#s6 .e1-none' : '#s6 .e1-mat');
        const prompt = tidy(promptNode?.innerText ?? promptNode?.textContent);
        const peak = query('#s6 [data-result-peak]');
        const peakColor = peak && getComputedStyle(peak).color;
        if (!isMat && mode === 'none' && integer('#s6 [data-result-peak]') === 0) emptyPeakColor = peakColor;
        return { ok: section?.dataset.resultState === 'empty' && inView(link) && inView(promptNode)
          && other?.checkVisibility({ visibilityProperty: true, opacityProperty: true }) === false && tidy(link.textContent) === '집으로'
          && (isMat ? mode === 'mat' && prompt === '매트 시험만 했어요. 집에서 공 하나면 이 카드가 달라집니다.'
              && peakColor && emptyPeakColor && peakColor !== emptyPeakColor
            : mode === 'none' && prompt === '아직 쿵 0번이에요. 집에서 공 하나면 이 카드가 달라집니다.'),
        label: tidy(link?.textContent), mode, prompt, peakColor, emptyPeakColor };
      }
      const coda = query('#s7 .coda');
      const footer = query('#s7 footer');
      const engineControl = query('#s7 [data-action="engine-view"]');
      const scroller = document.scrollingElement;
      const scroll = scroller && { top: scroller.scrollTop, max: scroller.scrollHeight - scroller.clientHeight };
      const atEnd = Boolean(scroll && Math.abs(scroll.max - scroll.top) <= 1);
      const visible = inView(coda);
      const afterFooter = Boolean(coda && footer?.nextElementSibling === coda);
      const closing = query('#s7 .coda-end');
      const actions = closing?.querySelector('.coda-acts');
      const status = closing?.querySelector('.coda-status');
      const closingOrder = Boolean(coda && (closing
        ? coda.nextElementSibling === closing && !closing.nextElementSibling && actions && status && actions.nextElementSibling === status
        : !coda.nextElementSibling));
      const engineInFooter = Boolean(engineControl && footer?.contains(engineControl));
      const nonLive = Boolean(coda && !coda.closest('[aria-live],[role="status"],[role="alert"]'));
      const copy = tidy(coda?.textContent);
      return { ok: atEnd && visible && afterFooter && closingOrder && engineInFooter && nonLive
        && copy === '누군가의 바닥은, 내 천장입니다.',
      atEnd, scroll, viewport: [innerWidth, innerHeight], visible, bounds: box(coda), afterFooter,
      closingOrder, withActions: Boolean(closing), engineInFooter, nonLive, copy };
    },
  };
}
