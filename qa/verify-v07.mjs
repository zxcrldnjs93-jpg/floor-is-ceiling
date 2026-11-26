export const v07States = [
  'v07-first', 'v07-mat-copy', 'v07-mat-percent-ready', 'v07-mat-percent', 'v07-recap-definition',
  'v07-recap-empty', 'v07-recap-done', 'v07-details-closed', 'v07-detail',
  'v07-save', 'v07-png', 'v07-vote', 'v07-footer', 'v07-restart', 'v07-font', 'v07-s1-no-guide', 'v07-s1-guide',
  'v07-s2-no-guide', 'v07-s2-guide', 'v07-s4-layout', 'v07-s4-beat', 'v07-s4-mask', 'v07-s4-paused-upright', 'v07-reduced-span',
];
export const v07Watches = ['v07-s4', 'v07-mask', 'v07-s2'];

export function validV07Expectation({ state, wait, pass, detail, mode, scene, before, after }) {
  return (wait === undefined || Number.isFinite(wait) && wait >= 0 && wait <= 8)
    && (state === 'v07-s4-beat' ? [1, 2].includes(pass) : pass === undefined)
    && (state === 'v07-detail' ? ['up', 'down'].includes(detail) : detail === undefined)
    && (state === 'v07-s4-mask' ? ['normal', 'reduced', 'paused', 'resumed'].includes(mode) : mode === undefined)
    && (state === 'v07-font' ? ['s0', 's2', 's6', 's7'].includes(scene) : scene === undefined)
    && (['v07-mat-percent-ready', 'v07-mat-percent'].includes(state)
      ? before === 100 && after === 56 || before === 200 && after === 114
      : before === undefined && after === undefined);
}

export function installV07Verification({ query, inView, roomInView, artRecords, cardPng, v10kCopy }) {
  const clean = (str) => (str ?? '').replace(/\s+/g, ' ').trim();
  const all = (sel) => [...document.querySelectorAll(sel)];
  const text = (sel) => clean(query(sel)?.textContent);
  const numeric = (sel) => /^\s*\d+\s*$/.test(text(sel)) ? Number(text(sel)) : null;
  const painted = (node) => Boolean(node?.checkVisibility({
    opacityProperty: true, visibilityProperty: true,
  }));
  const drawn = (node) => painted(node) && !node.closest('[hidden]');
  const shown = (sel) => drawn(query(sel)) && inView(query(sel));
  const receiver = '방금 그 쿵, 6층 천장에 닿았습니다.';
  const firstDefinition = '쿵 지수는 방 절반 높이에서 떨어진 공이 100입니다.';
  const recapDefinition = '쿵 지수는 방 절반 높이에서 떨어진 공을 100으로 둔 상대값입니다. 실제 소음(dB)이 아닙니다.';
  const firstRuler = '쿵 지수: 바닥 톡 43 · 방 절반 높이 공 100 · 천장 가까이 공 200';
  const recapRulerDefinition = '쿵 지수는 방 절반 높이에서 떨어진 공을 100으로 둔 상대값입니다. 실제 소음(dB)이 아니고, 200이 100의 두 배로 시끄럽다는 뜻도 아닙니다.';
  const hasRuler = () => Boolean(query('#s6 figure.ruler'));
  const hasV10K = () => Boolean(v10kCopy && query('#s0 [data-cue="s0-band"] .br-def'));
  const row = (key) => `#s6 [data-recap="${key}"]`;
  const listenCopy = '#s4 [data-flip-cue="listen"] .display';
  const explanation = '#s4 [data-cue="s4-06"]';
  const s4Layer = '#s4 [data-flip-layer]:not([data-building-mirror])';
  const marker = '#s4 .s4-chair-mark[data-mark-label="6층 의자"]';
  const soundGuide = '#s2 [data-cue="s2-06"]';
  const touchGuide = '#s1 [data-cue="s1-03"]';
  const upper = () => artRecords().filter(({ slab, n }) => slab === '7-6' && n > 0);
  const chairRecords = () => artRecords().filter(({ slab, label }) => slab === '6-7' && label === '6층 의자');
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pause = () => document.documentElement.hasAttribute('data-motion-paused');
  const beforeAfter = () => [numeric('#s6 [data-result-mat-before]'), numeric('#s6 [data-result-mat-after]')];
  const links = (section) => all(`${section} a[href], ${section} button`).filter((node) => drawn(node) && !node.closest('footer'));

  function wordsInView(scope) {
    if (!scope) return [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    const words = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      const copy = clean(node.textContent);
      if (!copy || !drawn(parent) || parent.closest('.sr, .sr-only, script, style')) continue;
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter(({ left, right, top, bottom, width, height }) =>
        width > 1 && height > 1 && right > 0 && left < innerWidth && top < innerHeight && bottom > 0);
      if (rects.length) words.push({ copy, size: Number.parseFloat(getComputedStyle(parent).fontSize), rects });
    }
    return words;
  }

  function first() {
    const cues = all('#s0 [data-cue="s0-after"], #s0 [data-cue="s0-band"]').filter(inView).map((node) => clean(node.textContent));
    const copy = cues.join(' ');
    const sentences = copy.split(/[.!?]+\s*/).filter(Boolean);
    const event = upper().find(({ n, value }) => n === 1 && value === 100);
    const expectedBand = hasV10K() ? v10kCopy.intro : hasRuler() ? firstRuler : firstDefinition;
    return { ok: roomInView('s0') && Boolean(event) && cues.length === 2 && copy.startsWith(receiver)
      && cues[1] === expectedBand && sentences.length === 3, copy, sentences, event, expectedBand };
  }

  function recapDefinitionOnScreen() {
    const selector = '#s6 .recap-def';
    const definition = text(selector);
    const expectedDefinition = hasV10K() ? v10kCopy.definition : hasRuler() ? recapRulerDefinition : recapDefinition;
    const visible = shown(selector);
    return { ok: visible && definition === expectedDefinition, visible, definition, expectedDefinition };
  }

  function recap(done) {
    const target = row('listen');
    const current = query(target)?.dataset.state ?? null;
    const from = text(`${target} [data-recap-from]`);
    const to = text(`${target} [data-recap-to]`);
    const title = text(`${target} .rc-t`);
    const chairs = chairRecords();
    const fromS3 = artRecords().find(({ slab, label }) => slab === '6-5' && label === '6층 의자');
    const visible = shown(target);
    const ok = visible && title === '그리고 나도, 누군가의 아래층' && to === '7층 천장'
      && current === (done ? 'done' : 'empty')
      && (done ? chairs.some(({ value }) => from === `6층 의자 · ${value}` && (!fromS3 || value === fromS3.value))
        : chairs.length === 0 && from === '6층 바닥');
    return { ok, visible, current, title, from, to, chairs, fromS3 };
  }

  function matPercent(state, expectedBefore, expectedAfter) {
    const [before, after] = beforeAfter();
    const selector = `${row('mat')} [data-recap-reduction]`;
    const percent = numeric(selector);
    const node = query(selector), values = query(`${row('mat')} .rc-v`);
    const caption = node?.closest('.rc-pct');
    const recapState = query(row('mat'))?.dataset.state ?? null;
    const paintedCaption = drawn(caption);
    const ready = recapState === 'done' && before === expectedBefore && after === expectedAfter
      && percent === Math.round(100 * (expectedBefore - expectedAfter) / expectedBefore) && paintedCaption;
    const measurement = { before, after, percent, recapState, paintedCaption };
    if (state === 'v07-mat-percent-ready') return { ok: ready, ...measurement };

    const valueNodes = ['from', 'to'].map((side) => query(`${row('mat')} [data-recap-${side}]`));
    const percentSize = node ? Number.parseFloat(getComputedStyle(node).fontSize) : null;
    const valueSize = valueNodes.every(Boolean)
      ? Math.max(...valueNodes.map((value) => Number.parseFloat(getComputedStyle(value).fontSize))) : null;
    const positioned = Boolean(caption && values?.nextElementSibling === caption);
    const visible = shown(selector) && inView(caption);
    const label = clean(caption?.textContent);
    const expectedLabel = hasV10K() ? `쿵 지수 ${percent}% 감소` : `${percent}% 덜 울림`;
    return { ok: ready && label === expectedLabel
      && visible && positioned && valueSize !== null && percentSize > valueSize,
    ...measurement, percentSize, valueSize, visible, positioned, label, expectedLabel };
  }

  function matCopy() {
    const copy = text('#s5 [data-cue="s5-07"]');
    const result = text('#s5 [data-mat-result]');
    const ok = shown('#s5 [data-cue="s5-07"]') && copy === '이 수치는 이 페이지 물리엔진의 값입니다. 실제 매트는 가벼운 충격엔 효과가 크고, 높은 데서 물건이 떨어지는 큰 충격엔 효과가 적습니다.'
      && !/(?:dB|데시벨)/i.test(result);
    return { ok, copy, result };
  }

  function disclosure(which) {
    const panels = all('#s6 .next details');
    const open = panels.map((entry) => entry.open);
    const names = panels.map((panel) => clean(panel.querySelector('summary')?.textContent));
    if (!which) return { ok: names.join() === '매트 깔 자리,쪽지 한 장, 그다음 도움' && open.every((item) => !item)
      && panels.every((panel) => drawn(panel.querySelector('summary')) && !panel.querySelector('summary').hasAttribute('onclick')), open, names };
    const panel = panels[which === 'up' ? 0 : 1];
    const copy = clean(panel?.textContent);
    const note = clean(panel?.querySelector('blockquote')?.textContent);
    const steps = [...(panel?.querySelectorAll('ol > li') ?? [])].map(({ textContent }) => clean(textContent));
    const guidance = which === 'up' ? /매트/.test(copy) && !/(원\b|\d\s*(?:cm|mm)|https?:|상품명|브랜드)/i.test(copy)
      : /저희 집 소리도 들리면 알려 주세요\.$/.test(note) && steps.length === 2 && /관리사무소.*중재/.test(steps[0])
        && /1661-2642.*방문 상담/.test(steps[1]) && !/(?:대여|고소|신고|처벌|불법|기준 초과|○○호|법적 조치)/.test(copy);
    const next = query('#s6 .next');
    const bounds = panel?.getBoundingClientRect();
    const area = next?.getBoundingClientRect();
    const fits = Boolean(bounds && area && bounds.width <= area.width + 1 && bounds.left >= area.left - 1 && bounds.right <= area.right + 1);
    return { ok: panels.length === 2 && open.filter(Boolean).length === 1 && panel?.open === true
      && drawn(panel) && fits && guidance, which, open, copy, fits };
  }

  function save() {
    const primary = query('#s6 [data-action="save"]'), share = query('#s6 [data-action="share"]');
    const restart = query('#s6 a[data-action="restart"][href="#s0"]');
    const info = text('#s6 .side');
    const width = primary?.getBoundingClientRect().width ?? 0;
    const available = primary?.parentElement?.clientWidth ?? Infinity;
    return { ok: query('#s6')?.dataset.resultState === 'done' && inView(primary)
      && primary?.matches('button.btn-primary') && share?.matches('button:not(.btn-primary)')
      && !restart && /PNG\s*1장/i.test(info)
      && (innerWidth > 720 || width >= available - 2), width, available, info, restart: clean(restart?.textContent) };
  }

  function vote() {
    const anchor = query('#s6 .vote a[href][target="_blank"]');
    const label = clean(anchor?.textContent);
    const accessible = anchor?.getAttribute('aria-label') ?? '';
    const nearby = text('#s6 .vote');
    const localVote = all('#s7 a[href^="#"]').find((link) => /투표/.test(clean(link.textContent)));
    const externalVoteLinks = all('a[href^="https://hackathon.parallax.kr/"]').length;
    const height = anchor?.getBoundingClientRect().height ?? 0;
    return { ok: inView(anchor) && /갤러리에서\s*△\s*투표하기/.test(label) && /새 탭/.test(accessible)
      && nearby.includes('로그인한 누구나 작품마다 한 표씩 줄 수 있어요.') && height >= 44 && externalVoteLinks === 1
      && !anchor.matches('.btn-primary') && anchor.relList.contains('noopener')
      && Boolean(anchor?.id && localVote?.getAttribute('href') === `#${anchor.id}`),
    label, accessible, nearby, href: anchor?.href, height, externalVoteLinks };
  }

  function footer() {
    const coda = query('#s7 .coda');
    const inside = links('#s7').filter((link) => Boolean(coda?.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING));
    const labels = inside.map((node) => clean(node.textContent));
    const root = document.scrollingElement;
    const atEnd = Math.abs(root.scrollHeight - root.clientHeight - root.scrollTop) <= 1;
    const copy = text('#s7');
    const fact = /한국소비자원.*어린이 매트 8종/.test(copy) && /2025\.12\.24/.test(copy)
      && /16\s*[~～∼–-]\s*17/.test(copy) && /0\.4\s*m/i.test(copy) && /4\s*[~～∼–-]\s*5/.test(copy)
      && /1\s*m/i.test(copy) && /1\s*[~～∼–-]\s*2/.test(copy);
    const status = copy.match(/1\s*\/\s*120\s*초\s*고정 스텝\s*·\s*외부 라이브러리\s*0\s*·\s*JS\s*\d+(?:\.\d+)?\s*KB\s*·\s*출처\s*\d+\s*개/i)?.[0] ?? '';
    const font = coda ? Number.parseFloat(getComputedStyle(coda).fontSize) : null;
    const sources = query('#s7 footer ul.src');
    const sourceCount = sources?.children.length ?? 0;
    const stated = Number(status.match(/출처\s*(\d+)/)?.[1]);
    const expectedLabels = ['투표하기', '카드 저장', '처음부터 다시'];
    const actionSelectors = ['a[href="#vote-link"]:not(.btn)',
      ':is(a, button.link-btn)[data-action="save"]:not(.btn)', 'a[href="#s0"][data-action="restart"]:not(.btn)'];
    const actionTypes = inside.map((node, i) => actionSelectors[i] ? node.matches(actionSelectors[i]) : false);
    const after = Boolean(coda && (query('#s7 footer')?.compareDocumentPosition(coda) & Node.DOCUMENT_POSITION_FOLLOWING));
    return { ok: atEnd && inView(coda) && clean(coda?.textContent) === '누군가의 바닥은, 내 천장입니다.'
      && labels.length === expectedLabels.length && labels.every((label, i) => label.includes(expectedLabels[i])) && inside.every(inView)
      && actionTypes.every(Boolean)
      && after && !coda.closest('[aria-live],[role="status"],[role="alert"]')
      && fact && Boolean(status) && sourceCount === 7 && sourceCount === stated
      && all('#s7 .src :is(a, [data-source-url])').some((source) =>
        (source.dataset.sourceUrl ?? source.href)?.includes('consumer.go.kr/') && /한국소비자원/.test(source.textContent))
      && (innerWidth > 720 || font >= (innerWidth <= 360 ? 28 : 30) && wordsInView(coda).flatMap(({ rects }) => rects).length <= 2),
    atEnd, labels, actionTypes, fact, status, sourceCount, stated, font };
  }

  function font(scene) {
    const scope = query(`#${scene}`);
    const words = scope ? wordsInView(scope) : [];
    const undersized = words.filter(({ size }) => size < 12).map(({ copy, size }) => ({ copy, size }));
    const u06 = query('#s2 .u06');
    const style = u06 && getComputedStyle(u06);
    const u06Size = style ? Number.parseFloat(style.fontSize) : null;
    const u06Color = style?.color;
    const title = query('#s2-title');
    const ink = Boolean(title && u06Color === getComputedStyle(title).color);
    return { ok: words.length > 0 && undersized.length === 0
      && (scene !== 's2' || u06Size >= (innerHeight < 560 ? 13 : 14) && ink),
    scene, sampled: words.length, undersized, u06Size, u06Color };
  }

  function s4Layout() {
    const title = query(listenCopy);
    const active = wordsInView(query('#s4 [data-flip-cue="listen"]'));
    const shapes = all(`${s4Layer} [data-physics-body="6:chair"], ${s4Layer} [data-physics-body="6:mug"], ${marker} text`)
      .filter(drawn).map((node) => node.getBoundingClientRect());
    const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const conflicts = active.filter(({ rects }) => rects.some((rect) => shapes.some((shape) => overlap(rect, shape)))).map(({ copy }) => copy);
    return { ok: inView(title) && active.length > 0 && shapes.length >= 2 && !conflicts.length, conflicts, shapes: shapes.length };
  }

  function displayAngle() {
    const stage = query(s4Layer);
    if (!stage) return null;
    const transform = getComputedStyle(stage).transform;
    const matrix = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform);
    return Math.abs(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI);
  }

  function pausedUpright() {
    const section = query('#s4');
    const panel = section?.querySelector('[data-motion-sticky]');
    const bounds = section?.getBoundingClientRect();
    const panelHeight = panel?.getBoundingClientRect().height;
    const map = window.LandingBuilding?.createClimaxScrollMap?.({
      travel: bounds?.height - panelHeight, panelHeight, viewportHeight: innerHeight,
    });
    const progress = map?.progressAt(-bounds.top);
    const angle = displayAngle();
    const phase = query(s4Layer)?.dataset.climaxPhase;
    return { ok: pause() && Math.abs(progress - 0.62) <= 0.005 && Number.isFinite(angle) && angle <= 1
      && phase === 'ready' && !painted(query(listenCopy)), progress, angle, phase };
  }

  let s2, s4, mask;
  const speedRuns = new Map();
  let deliverWrapped = false;
  async function watch(kind) {
    if (kind === 'v07-s4' || kind === 'v07-s2') {
      if (kind === 'v07-s4') s4 = { hits: [], earlyArcs: 0, earlyReaction: 0, firstCopyAt: null, firstWaveAt: null, waveX: [] };
      if (kind === 'v07-s2') s2 = { total: null, delivered: 0 };
      if (!deliverWrapped) {
        const { createBuilding } = await import('@landing/engines/physics-building.js');
        const prototype = Object.getPrototypeOf(createBuilding());
        const { deliver, replay } = prototype;
        prototype.replay = function (track, tape) {
          const accepted = replay.apply(this, arguments);
          if (s2 && accepted && track === 'upper') {
            s2.total = (tape ?? this.recording('upper')).length || 1;
            s2.delivered = 0;
          }
          return accepted;
        };
        prototype.deliver = function (event) {
          if (s2 && event.kind === 'replay' && event.track === 'upper') s2.delivered++;
          if (s4 && event.cue === 's4-chair') s4.hits.push({ at: performance.now(), value: event.index,
            x: event.point.x / this.width, chairX: this.rooms.get(6).props.chair.x / this.width,
            label: event.label, source: event.sourceRoom, receiver: event.receiverRoom });
          return deliver.call(this, event);
        };
        deliverWrapped = true;
      }
    }
    if (kind === 'v07-mask') mask = { clips: [], visibleFrames: 0, hiddenFrames: 0, modeMs: 0,
      minAngle: null, maxAngle: null, animationName: null };
    if (kind === 'v07-s2') return;
    const trace = kind === 'v07-mask' ? mask : s4;
    const start = performance.now();
    const animations = new WeakSet();
    let currentPause, modeStart;
    function observe(now) {
      if (trace !== (kind === 'v07-mask' ? mask : s4) || now - start > 12000) return;
      const title = query(listenCopy);
      if (kind === 'v07-mask') {
        if (inView(title)) {
          const paused = pause();
          if (paused !== currentPause) {
            currentPause = paused;
            modeStart = now;
          }
          trace.modeMs = now - modeStart;
          trace.visibleFrames++;
          trace.animationName = getComputedStyle(title).animationName;
          const angle = displayAngle();
          if (angle !== null) {
            trace.minAngle = Math.min(trace.minAngle ?? angle, angle);
            trace.maxAngle = Math.max(trace.maxAngle ?? angle, angle);
          }
          for (const anim of title.getAnimations({ subtree: true })) {
            if (animations.has(anim)) continue;
            const frames = anim.effect.getKeyframes();
            if (!frames.some((frame) => frame.clipPath || frame.maskPosition)) continue;
            animations.add(anim);
            trace.clips.push({ duration: anim.effect.getTiming().duration, frames });
          }
        } else if (trace.visibleFrames > 0) {
          trace.hiddenFrames++;
        }
      }
      if (kind === 'v07-s4' && roomInView('s4')) {
        if (inView(title)) trace.firstCopyAt ??= now;
        if (!trace.hits.length && painted(query(`${s4Layer} [data-react="7"]`))) trace.earlyReaction++;
        const arcs = all(`${s4Layer} .lt-slab-wave-slot`).filter((slot) => [...slot.children].some((arc) =>
          painted(arc) && Number(getComputedStyle(arc).opacity) > 0.02
          && arc.getAnimations().some(({ playState }) => playState === 'running')));
        if (arcs.length) {
          if (!trace.hits.length || trace.firstCopyAt === null) trace.earlyArcs += arcs.length;
          trace.firstWaveAt ??= now;
          trace.waveX.push(...arcs.map((slot) => Number.parseFloat(slot.style.left) / 100));
        }
      }
      requestAnimationFrame(observe);
    }
    requestAnimationFrame(observe);
  }

  function s4Beat(pass) {
    const trace = s4;
    const mark = query(marker);
    const markX = Number(mark?.dataset.markX), markValue = Number(mark?.dataset.markValue);
    const hit = s4?.hits[0];
    const delay = hit && s4.firstCopyAt !== null ? hit.at - s4.firstCopyAt : null;
    const first = speedRuns.get(1);
    const same = pass === 1 || first && hit?.label === first.label && hit?.value === first.value && Math.abs(hit.x - first.x) <= 0.005;
    const ok = Boolean(hit && s4.hits.length === 1 && !s4.earlyArcs && !s4.earlyReaction && hit.source === 6 && hit.receiver === 7
      && hit.label === '6층 의자' && shown(explanation) && shown(`${marker} text`) && markValue === hit.value
      && Math.abs(hit.x - 0.8) <= 0.005 && Math.abs(hit.chairX - hit.x) <= 0.005
      && Math.abs(markX - hit.x) <= 0.005 && s4.waveX.some((x) => Math.abs(x - hit.x) <= 0.005)
      && delay >= 400 && delay <= 950 && same);
    if (ok) { speedRuns.set(pass, hit); s4 = null; }
    return { ok, pass, hit, markX, markValue, delay, first, same, trace };
  }

  function downwardClip({ duration, frames }) {
    function edges(frame) {
      const match = /^inset\(([^)]+)\)$/.exec(frame?.clipPath ?? '');
      const values = match?.[1].trim().split(/\s+/) ?? [];
      if (!values.length || values.length > 4) return [];
      const [top, right = top, bottom = top, left = right] = values;
      return [top, right, bottom, left];
    }
    const zero = (value) => /^0(?:px|%)?$/.test(value);
    const from = edges(frames[0]), to = edges(frames.at(-1));
    return duration === 360 && from.length === 4 && from[2] === '100%'
      && [from[0], from[1], from[3]].every(zero) && to.length === 4 && to.every(zero);
  }

  function maskState(mode) {
    const titleVisible = shown(listenCopy);
    const settled = Boolean(mask?.modeMs >= 420 && mask.visibleFrames > 1 && !mask.hiddenFrames && titleVisible);
    const inverted = Number.isFinite(mask?.minAngle) && mask.minAngle >= 179
      && mask.maxAngle - mask.minAngle <= 0.25 && query(s4Layer)?.dataset.climaxPhase === 'listen'
      && Number(query(s4Layer)?.dataset.gravityY) < 0;
    const still = mask?.clips.length === 0 && mask.animationName === 'none';
    let correct;
    if (mode === 'normal') correct = !reduced() && !pause() && mask?.clips.length === 1 && downwardClip(mask.clips[0]);
    else if (mode === 'reduced') correct = reduced() && still;
    else correct = !reduced() && pause() === (mode === 'paused') && still && inverted;
    return { ok: Boolean(settled && correct), mode, titleVisible, inverted, mask };
  }

  async function reducedSpan() {
    const section = query('#s4'), panel = section?.querySelector('[data-motion-sticky]');
    if (!reduced() || !section || !panel || !shown(listenCopy)) return { ok: false, ready: false };
    const saved = scrollY, top = saved + section.getBoundingClientRect().top;
    const panelHeight = panel.getBoundingClientRect().height;
    const travel = section.getBoundingClientRect().height - panelHeight;
    const map = window.LandingBuilding?.createClimaxScrollMap?.({ travel, panelHeight, viewportHeight: innerHeight });
    if (!map) return { ok: false, ready: false };
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const signature = () => [listenCopy, explanation, '#s4 [data-s4-slab-label="floor"]',
      '#s4 [data-s4-slab-label="ceiling"]', '#s4 [data-flip-cue="return"]', `${marker} text`,
      `${s4Layer} [data-physics-body="6:chair"]`, `${s4Layer} [data-physics-body="7:ball"]`]
      .filter((sel) => drawn(query(sel))).map((sel) => {
        const rect = query(sel).getBoundingClientRect();
        return [text(sel), Math.round(rect.x / 2), Math.round(rect.y / 2), Math.round(rect.width / 2), Math.round(rect.height / 2)];
      });
    let last, runStart, longest = 0;
    const samples = [];
    try {
      for (let i = 0; i <= 16; i++) {
        const offset = map.offsetAt(0.55 + i * (0.2 / 16));
        window.scrollTo({ top: top + offset, behavior: 'instant' });
        await frame();
        await frame();
        const key = JSON.stringify(signature());
        const y = scrollY;
        if (key !== last) runStart = y;
        longest = Math.max(longest, y - runStart);
        samples.push({ y, pose: JSON.parse(key) });
        last = key;
      }
    } finally {
      window.scrollTo({ top: saved, behavior: 'instant' });
    }
    const span = samples.at(-1).y - samples[0].y;
    return { ok: span >= map.listenEnd - map.listenStart - 2 && samples.every(({ pose }) => pose.length > 0),
      exceedsOneScreen: longest > innerHeight + 1, measured: span, longest, viewportHeight: innerHeight, samples };
  }

  return {
    watch,
    async check({ state, pass, detail, mode, scene, before, after }) {
      switch (state) {
        case 'v07-first': return first();
        case 'v07-mat-copy': return matCopy();
        case 'v07-mat-percent-ready':
        case 'v07-mat-percent': return matPercent(state, before, after);
        case 'v07-recap-definition': return recapDefinitionOnScreen();
        case 'v07-recap-empty': return recap(false);
        case 'v07-recap-done': return recap(true);
        case 'v07-details-closed': return disclosure();
        case 'v07-detail': return disclosure(detail);
        case 'v07-save': return save();
        case 'v07-png': {
          const png = await cardPng();
          const peak = numeric('#s6 [data-result-peak]');
          return { ok: Boolean(peak > 0 && png?.filename?.endsWith('.png') && /[가-힣]/.test(png.filename)
            && png.width === 1080 && png.height === 1350 && png.led === peak && png.mini === peak
            && png.matDraw.every(({ text }) => !/%|실제 소음/.test(text))), png, peak };
        }
        case 'v07-vote': return vote();
        case 'v07-footer': return footer();
        case 'v07-restart': return { ok: scrollY <= 1 && roomInView('s0') && upper().length === 0,
          scrollY, remaining: upper().length };
        case 'v07-font': return font(scene);
        case 'v07-s1-no-guide': return { ok: roomInView('s1') && !painted(query(touchGuide)), shown: painted(query(touchGuide)) };
        case 'v07-s1-guide': return { ok: roomInView('s1') && shown(touchGuide), shown: shown(touchGuide) };
        case 'v07-s2-no-guide': return { ok: roomInView('s2') && s2?.total > s2.delivered && !painted(query(soundGuide)), replay: s2 };
        case 'v07-s2-guide': return { ok: roomInView('s2') && s2?.total > 0 && s2.delivered === s2.total && shown(soundGuide), replay: s2 };
        case 'v07-s4-layout': return s4Layout();
        case 'v07-s4-beat': return s4Beat(pass);
        case 'v07-s4-mask': return maskState(mode);
        case 'v07-s4-paused-upright': return pausedUpright();
        case 'v07-reduced-span': return reducedSpan();
      }
    },
  };
}
