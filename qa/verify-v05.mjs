export const v05States = [
  'v05-preview', 'v05-s0-revisit', 'v05-s6-empty', 'v05-s6-done', 'v05-s6-summary', 'v05-s6-actions',
  'v05-s6-link-stable', 'v05-s4-listen', 'v05-s4-impact', 'v05-s4-single', 'v05-s5-low-height', 'v05-s5-low-result',
];

export function validV05Expectation({ state, wait, compared, seenFlip }) {
  return (wait === undefined || Number.isFinite(wait) && wait >= 0 && wait <= 8)
    && (state === 'v05-s6-summary' ? typeof compared === 'boolean' : compared === undefined)
    && (seenFlip === undefined || ['v05-s6-empty', 'v05-s6-done'].includes(state) && typeof seenFlip === 'boolean');
}

// 이 함수는 문자열로 브라우저 탭에 주입된다.
export function installV05Verification({ query, inView, roomInView, artRecords, upper, text, index }) {
  const all = (selector) => [...document.querySelectorAll(selector)];
  const compactText = (node) => (node?.innerText ?? node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const visible = (node) => Boolean(node && !node.hidden
    && node.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false
    && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
  const value = (selector) => index(text(selector));
  const peak = () => Math.max(0, ...upper().map(({ value: reading }) => reading));
  const summary = '#s6 .recap';
  const actions = '#s6 .next';
  const empty = '#s6 [data-result-empty]';
  const emptyLink = `${empty} a[href="#s0"]`;
  const listen = '#s4 [data-flip-cue="listen"]';
  const flipLayer = '#s4 [data-flip-layer]:not([data-building-mirror])';
  const summaryLink = '#s6 [data-recap="mat"] a[data-action="cushion-revisit"][href="#s5"]';
  const summarySampleTimes = [0, 300, 1000, 2000];
  const summaryWatchMs = summarySampleTimes.at(-1);

  const summaryLinkY = () => {
    const link = query(summaryLink);
    return visible(link) ? link.getBoundingClientRect().top + scrollY : null;
  };
  let summaryTrace;
  function startSummaryLinkTrace() {
    const initialY = summaryLinkY();
    if (initialY === null) throw new Error('S6 직행 전 매트 링크의 문서 y를 읽을 수 없습니다.');
    if (roomInView('s6')) throw new Error('매트 링크 위치 관측은 S6에 도착하기 전에 시작해야 합니다.');
    const trace = { initialY, arrivedAt: null, elapsedMs: 0, frames: 0, missing: 0, maxDeltaY: 0, milestones: [] };
    summaryTrace = trace;
    function sample(now) {
      const y = summaryLinkY();
      trace.frames += 1;
      if (y === null) trace.missing += 1;
      else trace.maxDeltaY = Math.max(trace.maxDeltaY, Math.abs(y - initialY));
      if (trace.arrivedAt === null && roomInView('s6')) trace.arrivedAt = now;
      if (trace.arrivedAt !== null) {
        trace.elapsedMs = now - trace.arrivedAt;
        const targetMs = summarySampleTimes[trace.milestones.length];
        if (trace.milestones.length < summarySampleTimes.length && trace.elapsedMs >= targetMs) {
          trace.milestones.push({ targetMs, observedMs: Math.round(trace.elapsedMs), y, scrollY });
        }
      }
      if (trace.elapsedMs < summaryWatchMs) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }

  function summaryLinkStable() {
    const { initialY, elapsedMs, frames, missing, maxDeltaY, milestones } = summaryTrace ?? {};
    const ok = elapsedMs >= summaryWatchMs && missing === 0 && maxDeltaY <= 0.5
      && milestones.length === summarySampleTimes.length;
    return { ok, initialY, elapsedMs, frames, missing, maxDeltaY, milestones };
  }

  function preview() {
    const read = (selector) => all(selector).map((node) => node.content.trim());
    const og = read('meta[property="og:description"]');
    const twitter = read('meta[name="twitter:description"]');
    const descriptions = read('meta[name="description"]');
    const length = [...(og[0] ?? '')].length;
    const metaLength = [...(descriptions[0] ?? '')].length;
    const singleQuestion = /^[^.!?。！？\n]+[?？]$/.test(og[0] ?? '');
    const shareCopy = '내가 직접 떨어뜨린 ‘쿵’, 아래층 천장에서는 어떻게 들릴까요?';
    const image = read('meta[property="og:image"]');
    const inline = query('script[type="importmap"]')?.textContent.includes('data:text/javascript;base64,');
    const imageOk = image.length === 1 && (/^https:\/\/[^\s/]+\//.test(image[0]) || inline && image[0].startsWith('data:image/'));
    const ok = og.length === 1 && twitter.length === 1 && descriptions.length === 1 && og[0] === twitter[0]
      && og[0] === shareCopy && singleQuestion && length >= 30 && length <= 45 && metaLength > length && metaLength <= 150 && imageOk;
    return { ok, og, twitter, descriptions, length, metaLength, singleQuestion, imageOk };
  }

  function endLayout() {
    const added = [empty, summary, actions];
    const selectors = [...added, '#s6 [data-result-headline]', '#s6 [data-result-canvas]', '#s6 .side .actions',
      '#s6 [data-flip-missed]', '#s6 [data-mat-missed]'];
    const boxes = selectors.flatMap((selector) => all(selector).filter(visible)
      .map((node) => ({ selector, node, rect: node.getBoundingClientRect() })));
    const overlaps = [];
    for (let i = 0; i < boxes.length; i += 1) {
      const a = boxes[i];
      for (const b of boxes.slice(0, i)) {
        if (!added.includes(a.selector) && !added.includes(b.selector)) continue;
        if (a.node.contains(b.node) || b.node.contains(a.node)) continue;
        if (Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left) > 2
          && Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top) > 2) {
          overlaps.push([a.selector, b.selector]);
        }
      }
    }
    const overflow = boxes.filter(({ rect }) => rect.left < -1 || rect.right > innerWidth + 1).map(({ selector }) => selector);
    return { ok: !overlaps.length && !overflow.length, overlaps, overflow };
  }

  function card(state, { compared, seenFlip }) {
    const mode = query('#s6 [data-result-state], #s6[data-result-state]')?.dataset.resultState ?? null;
    const computedPeak = peak();
    const shownPeak = value('#s6 [data-result-peak]');
    const detail = text('#s6 [data-result-detail]');
    const layout = endLayout();
    const ready = roomInView('s6') && layout.ok;
    if (state === 'v05-s6-empty' || state === 'v05-s6-done') {
      const notice = query(empty);
      const links = all(`${empty} :is(a[href],button)`).filter(visible);
      const link = query(emptyLink);
      const prompt = compactText(notice);
      const linkText = compactText(link);
      const noInput = upper().length === 0 && shownPeak === 0 && /쿵\s*0번/.test(detail);
      const flipReminderHidden = query('#s6 [data-flip-missed]')?.hidden;
      const ok = state === 'v05-s6-empty'
        ? ready && mode === 'empty' && noInput && inView(notice) && inView(link) && links.length === 1
          && link?.getAttribute('href') === '#s0' && linkText === '7층으로'
          && prompt.replace(linkText, '').trim() === '아직 쿵 0번이에요. 공 하나면 이 카드가 달라집니다.'
        : ready && mode === 'done' && computedPeak > 0 && shownPeak === computedPeak && !visible(notice);
      return { ok: ok && (seenFlip === undefined || seenFlip === flipReminderHidden),
        mode, computedPeak, shownPeak, detail, prompt, links: links.length, flipReminderHidden, layout };
    }
    if (state === 'v05-s6-summary') {
      const cells = all(`${summary} [data-recap]`);
      const labels = cells.map((cell) => [compactText(cell.querySelector('[data-recap-from]')), compactText(cell.querySelector('[data-recap-to]'))]);
      const accessible = cells.map((cell) => compactText(cell.querySelector('[data-recap-sr]')));
      const modes = cells.map((cell) => cell.dataset.state);
      const tag = /^(쿵|드르륵) #([1-9]\d*) · ([\d,]+)$/.exec(labels[0]?.[0] ?? '');
      const upperRecord = tag && upper().find(({ n, value: reading, label }) => n === Number(tag[2])
        && reading === shownPeak && reading === index(tag[3]) && (label || '쿵') === tag[1]);
      const upperOk = upper().length
        ? Boolean(modes[0] === 'done' && upperRecord && accessible[0] === `내 ${tag[1]} #${tag[2]} · ${tag[3]}, 6층 천장에 그대로 닿았습니다.`)
        : modes[0] === 'empty' && labels[0]?.[0] === '7층 바닥' && accessible[0] === '7층 바닥의 쿵은 6층 천장에 닿습니다.';
      const chair = artRecords().filter(({ slab, label }) => slab === '6-5' && label === '6층 의자').at(-1);
      const chairOk = chair ? modes[1] === 'done' && labels[1]?.[0] === `6층 의자 · ${chair.value}`
          && accessible[1] === `6층 의자 · ${chair.value}, 5층 천장에 닿았습니다.`
        : modes[1] === 'empty' && labels[1]?.[0] === '6층 바닥' && accessible[1] === '6층 바닥의 소리는 5층 천장에 닿습니다.';
      const before = value('#s5 [data-impact-before]');
      const after = value('#s5 [data-impact-after]');
      const pair = labels[2]?.map((part) => index(part.replace(/^쿵\s+/, ''))) ?? [];
      const tryMat = query(summaryLink);
      const unplayed = cells[2]?.querySelector('.rc-todo');
      const reading = cells[2]?.querySelector('.rc-v');
      const comparisonOk = compared
        ? modes[2] === 'done' && query('#s5')?.dataset.matTest === 'done'
          && Number.isInteger(before) && Number.isInteger(after) && before > after && after >= 0 && pair[0] === before && pair[1] === after
          && !visible(unplayed) && visible(reading) && value('#s6 [data-result-mat-before]') === before
          && value('#s6 [data-result-mat-after]') === after && accessible[2] === `같은 높이에서 맨바닥 쿵 ${before}, 매트 위 쿵 ${after}.`
        : modes[2] === 'empty' && query('#s5')?.dataset.matTest !== 'done' && !visible(reading) && visible(tryMat)
          && compactText(unplayed).includes('아직 재 보지 않았어요') && compactText(tryMat) === '매트 깔아 보기'
          && accessible[2] === '아직 매트로 재 보지 않았어요.';
      const title = compactText(query(summary));
      const inOrder = cells.map((cell) => cell.dataset.recap).join() === 'kung,relay,mat';
      const ok = ready && title.includes('오늘 확인한 것') && inOrder && cells.every(visible)
        && labels[0]?.[1] === '6층 천장' && labels[1]?.[1] === '5층 천장' && upperOk && chairOk
        && comparisonOk && !query('#s6 [data-mat-missed]');
      return { ok, labels, accessible, modes, shownPeak, chair: chair?.value, pair, before, after, compared, tryMat: visible(tryMat), layout };
    }
    const blocks = all(`${actions} .next-cell`).filter(visible);
    const roles = blocks.map((node) => compactText(node.querySelector('.nk')));
    const [upstairs, downstairs] = blocks.map(compactText);
    const telephone = all(`${actions} a[href="tel:16612642"]`).filter(visible);
    const forbidden = /신고|처벌|보복|응징|가해|피해/.exec(compactText(query('#s6')))?.[0] ?? null;
    const ok = ready && roles.join() === '위층이라면,아래층이라면'
      && upstairs.includes('쿵이 나는 자리에 매트 한 장부터.')
      && downstairs.includes('층간소음 이웃사이센터 전화 상담부터')
      && telephone.length === 1 && compactText(telephone[0]) === '1661-2642' && !forbidden;
    return { ok, roles, upstairs, downstairs, phone: telephone.length, forbidden, layout };
  }

  let trace, frame;
  const chairRecords = () => artRecords().filter(({ slab, label }) => slab === '6-7' && label === '6층 의자');
  const edges = (rect) => rect ? Array.from([rect.left, rect.top, rect.right, rect.bottom], Math.round) : null;
  const overlap = (a, b) => a && b && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2
    && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
  function sample(now) {
    const caption = query(`${listen} .display`);
    const detail = query(`${listen} :is([data-cue="s4-06"], .s406)`);
    const phase = query(flipLayer)?.dataset.climaxPhase;
    if (trace.listenAt === null && phase === 'listen' && inView(caption) && compactText(caption).includes('이제 당신이 아래층입니다')) {
      trace.listenAt = now;
    }
    if (trace.listenAt !== null) {
      for (const record of chairRecords()) {
        if (!trace.seen.has(record)) {
          trace.seen.add(record);
          trace.impacts.push({ delayMs: Math.round(now - trace.listenAt), n: record.n ?? null, value: record.value, x: record.x });
        }
      }
      if (inView(detail) && trace.detailMs === null) trace.detailMs = Math.round(now - trace.listenAt);
      if (trace.impacts.length && trace.visibleBeatMs === null) {
        const arcs = all(`${flipLayer} [data-wave-layer="6-7"] .lt-slab-wave-arc`);
        const wave = arcs.find((arc) => {
          const rect = arc.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
            && rect.width > 0 && rect.height > 0 && Number(getComputedStyle(arc).opacity) >= 0.05;
        });
        const selector = '.s4-chair-mark[data-mark-label="6층 의자"]';
        const marker = trace.reduced
          ? all(`#s4 ${selector}`).find((node) => inView(node.querySelector('text')))
          : query(`${flipLayer} ${selector}`);
        const label = marker?.querySelector('text');
        const chairSelector = '[data-physics-body="6:chair"]';
        const chair = trace.reduced ? all(`#s4 ${chairSelector}`).find(inView) : query(`${flipLayer} ${chairSelector}`);
        const callout = query(listen)?.getBoundingClientRect();
        const chairRect = chair?.getBoundingClientRect();
        const labelRect = label?.getBoundingClientRect();
        const covered = Boolean(overlap(callout, chairRect) || overlap(callout, labelRect));
        const reading = text('#s4 [data-fx="perspective-feedback"]');
        const slot = wave?.closest('.lt-slab-wave-slot')?.getBoundingClientRect();
        const source = trace.impacts[0];
        const markValue = Number(marker?.dataset.markValue);
        const markX = Number(marker?.dataset.markX);
        trace.geometry = { chair: edges(chairRect), label: edges(labelRect), callout: edges(callout),
          wave: edges(wave?.getBoundingClientRect()), contact: slot ? [Math.round(slot.left), Math.round(slot.top)] : null, covered };
        trace.mark = { label: compactText(label), value: markValue, x: markX };
        if (phase === 'listen' && inView(chair) && (wave || trace.reduced) && inView(label) && !covered
          && trace.mark.label.includes('6층 의자') && markValue === source.value && Math.abs(markX - source.x) <= 0.005
          && reading === `재생 · 6층 의자 · ${source.value}`) {
          trace.visibleBeatMs = Math.round(now - trace.listenAt);
        }
      }
    }
    frame = requestAnimationFrame(sample);
  }

  function startChairTrace() {
    cancelAnimationFrame(frame);
    trace = {
      listenAt: null, detailMs: null, visibleBeatMs: null, impacts: [], seen: new Set(chairRecords()),
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      hasRelay: artRecords().some(({ slab, label }) => slab === '6-5' && label === '6층 의자'),
    };
    frame = requestAnimationFrame(sample);
  }

  function s4(state) {
    const { listenAt, detailMs, visibleBeatMs, impacts, geometry, mark, hasRelay, reduced } = trace
      ?? { listenAt: null, detailMs: null, visibleBeatMs: null, impacts: [] };
    const elapsedMs = listenAt === null ? null : Math.round(performance.now() - listenAt);
    const first = impacts[0];
    const timingOk = first?.delayMs >= 300 && first.delayMs <= 1500;
    const realImpact = first?.n === 0 && first.value > 0 && Number.isFinite(first.x) && first.x >= 0 && first.x <= 1;
    const referenceImpact = hasRelay || first?.value === 141 && Math.abs(first.x - 176.71 / 480) <= 0.005;
    const renderedBeat = visibleBeatMs !== null && first && visibleBeatMs >= first.delayMs && visibleBeatMs <= first.delayMs + 250;
    const observed = timingOk && realImpact && referenceImpact && renderedBeat && detailMs === first?.delayMs && impacts.length === 1;
    const ok = state === 'v05-s4-listen' ? listenAt !== null && impacts.length === 0 && detailMs === null
      : state === 'v05-s4-impact' ? observed && roomInView('s4')
        : observed && elapsedMs >= 2300 && roomInView('s4');
    if (ok && state === 'v05-s4-single') cancelAnimationFrame(frame);
    return { ok: Boolean(ok), elapsedMs, impacts, detailMs, visibleBeatMs, renderedBeat, referenceImpact: Boolean(referenceImpact), reduced, geometry, mark };
  }

  function lowMat(state) {
    const originalPeak = peak();
    const dropHeight = Number(query('#s5 [data-stage="s5"]')?.dataset.dropHeight);
    const fromReference = inView(query('#s5 [data-cue="s5-08b"]'));
    const fromPeak = visible(query('#s5 [data-cue="s5-08"]'));
    const bare = value('#s5 [data-impact-before]');
    const mat = value('#s5 [data-impact-after]');
    const reading = value('#s6 [data-result-peak]');
    const low = upper().length === 1 && originalPeak >= 25 && originalPeak <= 35;
    const sameReference = Math.abs(dropHeight - 0.5) <= 0.001;
    const ok = state === 'v05-s5-low-height'
      ? low && roomInView('s5') && sameReference && fromReference && !fromPeak
      : low && roomInView('s6') && sameReference && bare === 100 && mat === 44 && reading === originalPeak
        && value('#s6 [data-result-mat-before]') === bare && value('#s6 [data-result-mat-after]') === mat;
    return { ok, originalPeak, dropHeight, fromReference, fromPeak, bare, mat, reading };
  }

  return {
    startChairTrace,
    startSummaryLinkTrace,
    check(options) {
      const { state } = options;
      if (state === 'v05-preview') return preview();
      if (state === 'v05-s6-link-stable') return summaryLinkStable();
      if (state === 'v05-s0-revisit') {
        const drop = query('#s0 button[data-action="drop"]');
        const records = upper().length;
        const ready = inView(drop) && !drop.matches(':disabled,[aria-disabled="true"]');
        const focused = document.activeElement === drop;
        return { ok: roomInView('s0') && scrollY <= 2 && records === 0 && ready && focused, records, ready, focused, scrollY };
      }
      if (state.startsWith('v05-s4-')) return s4(state);
      if (state.startsWith('v05-s5-')) return lowMat(state);
      return card(state, options);
    },
  };
}
