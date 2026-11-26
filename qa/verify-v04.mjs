export const v04States = [
  'v04-s0-ready', 'v04-s0-focus-preview', 'v04-s0-recorded', 'v04-s2-same-event', 'v04-s2-reference',
  'v04-mat-ready', 'v04-mat-bare', 'v04-mat-laid', 'v04-mat-compared', 'v04-mat-repeated',
  'v04-mat-incomplete-card', 'v04-mat-complete-card', 'v04-s6-flip-visible',
];

export function validV04Expectation(value) {
  const { state, wait, count, reduced, action, sequence, peakValue, repeat, heightSource, beforeValue, focused, seenFlip, started, flipPrompt } = value;
  const positiveInt = (item) => Number.isInteger(item) && item > 0;
  return (wait === undefined || Number.isFinite(wait) && wait >= 0 && wait <= 8)
    && (count === undefined || state === 'v04-s0-recorded' && positiveInt(count))
    && (reduced === undefined || state === 'v04-s0-ready' && typeof reduced === 'boolean')
    && (state === 'v04-s0-focus-preview' ? ['drop', 'drop-high'].includes(action) : action === undefined)
    && (sequence === undefined || state === 'v04-s2-same-event' && positiveInt(sequence))
    && (peakValue === undefined || ['v04-s0-recorded', 'v04-s2-same-event'].includes(state) && positiveInt(peakValue))
    && (repeat === undefined || state === 'v04-s2-same-event' && repeat === true)
    && (heightSource === undefined || state === 'v04-mat-ready' && ['peak', 'reference', 'reference-after-drag'].includes(heightSource))
    && (beforeValue === undefined || ['v04-mat-bare', 'v04-mat-complete-card'].includes(state) && positiveInt(beforeValue))
    && (focused === undefined || state === 'v04-mat-ready' && focused === 'mat-before' || state === 'v04-mat-bare' && focused === 'mat-lay')
    && (seenFlip === undefined || state === 'v04-mat-incomplete-card' && typeof seenFlip === 'boolean')
    && (flipPrompt === undefined || state === 'v04-mat-incomplete-card' && seenFlip === false && flipPrompt === 'open')
    && (started === undefined || state === 'v04-mat-incomplete-card' && typeof started === 'boolean');
}

// 새 탭에서 장면을 방문하기 전에 설치한다. 수치는 실제 낙하 입력과 결과 이벤트에서 읽는다.
export function installV04Verification({ query, inView, roomInView, upper, feedbackRecord, sameRecord }) {
  const trials = new Map();
  const originals = new Map();
  let cushion;
  query('#s5')?.addEventListener('cushionchange', ({ detail }) => {
    cushion = detail;
    const { pending } = detail;
    if (pending && !trials.has(pending.id)) {
      const { id, surface, command } = pending;
      trials.set(id, { id, surface, height: command?.y, type: command?.type });
    }
  });

  function number(selector) {
    const value = query(selector)?.textContent.trim().replaceAll(',', '');
    return /^\d+$/.test(value) ? Number(value) : null;
  }

  const pageText = (selector) => query(selector)?.textContent.trim() ?? '';
  const input = (name) => query(`#s0 button[data-action="${name}"]`);
  const actionable = (node) => inView(node) && !node.matches(':disabled,[aria-disabled="true"]');
  const intro = '[data-place="s0-intro"]';
  const response = '#s0 [data-cue="s0-after"]';
  const invite = '#s0 .drop-invite.is-invite';
  const dropArtwork = `${invite} .inv-drop .dp-ball`;
  const tapArtwork = `${invite} .inv-tap .inv-ring`;
  const replayNotice = '#s2 [data-fx="replay-feedback"]';
  const flipReminder = '#s6 [data-flip-missed]';
  let repeatNotice;

  function watchRepeat() {
    const target = query(replayNotice);
    if (!target) throw new Error('S2 다시 듣기 낭독 훅이 없습니다.');
    repeatNotice = [];
    const observer = new MutationObserver((entries) => {
      for (const entry of entries) {
        for (const node of entry.addedNodes) {
          const value = node.textContent.trim();
          if (value) repeatNotice.push(value);
        }
      }
    });
    observer.observe(target, { childList: true });
  }

  function auditLayout(hints, controls) {
    const items = [];
    for (const selector of [...hints, ...controls]) {
      for (const element of document.querySelectorAll(selector)) {
        if (!inView(element) || items.some((item) => item.element === element)) continue;
        const isHint = hints.includes(selector);
        const text = (element.innerText ?? element.textContent).replace(/\s+/g, ' ').trim();
        const rects = [];
        if (!isHint) rects.push(element.getBoundingClientRect());
        else {
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          const range = document.createRange();
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent.trim() || node.parentElement.checkVisibility?.({
              checkOpacity: true, checkVisibilityCSS: true,
            }) === false) continue;
            range.selectNodeContents(node);
            rects.push(...[...range.getClientRects()].filter(({ width, height }) => width > 1 && height > 1));
          }
        }
        if (rects.length) items.push({ selector, element, isHint, text, rects });
      }
    }

    const duplicates = [], overlaps = [], overlappingCopy = [];
    for (let right = 1; right < items.length; right += 1) {
      const a = items[right];
      for (const b of items.slice(0, right)) {
        if (a.element.contains(b.element) || b.element.contains(a.element)) continue;
        if (a.isHint && b.isHint && a.text && a.text === b.text) duplicates.push(a.text);
        if (a.rects.some((x) => b.rects.some((y) => Math.min(x.right, y.right) - Math.max(x.left, y.left) > 2
          && Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 2))) {
          overlaps.push([a.selector, b.selector]);
          overlappingCopy.push([a.text, b.text]);
        }
      }
    }
    return { ok: duplicates.length === 0 && overlaps.length === 0, duplicates, overlaps, overlappingCopy };
  }

  function firstAction(state, { count = 1, reduced, action, peakValue }) {
    const raw = pageText('#s0 [data-fx="first-impact"]');
    const last = feedbackRecord(raw);
    const total = new Set(upper().map(({ n }) => n)).size;
    const postVisible = inView(query(response));
    const layout = auditLayout([`#s0 ${intro}`, response, '#s0 [data-cue="s0-band"]', '#s0 .inv-label',
      '#s0 [data-place="s0-line1"]', '#s0 [data-place="s0-line2"]'],
      ['#s0 button[data-action]', '#s0 [data-place="s0-down"]']);
    const dropVisible = inView(query(dropArtwork));
    const tapVisible = inView(query(tapArtwork));
    const invitation = { dropVisible, tapVisible };
    if (state === 'v04-s0-ready') {
      const initialVisible = inView(query(`#s0 ${intro}`));
      const ready = ['drop', 'drop-high', 'tap'].filter((name) => actionable(input(name)));
      const motion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const pinging = [...document.querySelectorAll(`${invite} .inv-ping`)]
        .some((element) => element.getAnimations().some(({ playState }) => playState === 'running'));
      const ok = roomInView('s0') && total === 0 && !raw && initialVisible && !postVisible && ready.length > 0
        && dropVisible && tapVisible && layout.ok && (reduced === undefined || motion === reduced) && (!motion || !pinging);
      return { ok, initialVisible, postVisible, invitation, motion, pinging, ready, total, raw, layout };
    }
    if (state === 'v04-s0-focus-preview') {
      const focused = document.activeElement === input(action) && input(action)?.matches(':focus-visible');
      const ball = query('#s0 .drop-invite:not(.is-invite) .dp-ball');
      const geometry = window.LandingArt?.geometry?.('s0');
      const target = geometry?.ceilings?.[7] + (geometry?.floors?.[7] - geometry?.ceilings?.[7]) * (action === 'drop' ? 0.5 : 0);
      const radius = Number(ball?.getAttribute('r'));
      const firstY = (geometry?.lines?.ceilings?.[7] ?? geometry?.ceilings?.[7]) + radius + 2;
      const lastY = geometry?.floors?.[7] - radius - 2;
      const expectedY = Math.max(firstY, Math.min(lastY, target));
      const actualY = ball ? Number(ball.getAttribute('cy')) : null;
      const ok = Boolean(focused && inView(ball) && !dropVisible && !tapVisible && Math.abs(actualY - expectedY) <= 1 && layout.ok);
      return { ok, action, focused, expectedY, actualY, invitation, layout };
    }
    const recorded = upper();
    const record = last && recorded.find((item) => sameRecord(item, last));
    const peak = Math.max(0, ...recorded.map(({ value }) => value));
    const ok = Boolean(roomInView('s0') && last?.label === '쿵' && last.value > 0 && total >= count && postVisible
      && !dropVisible && !tapVisible && layout.ok && Number.isFinite(record?.x) && (peakValue === undefined || peak === peakValue));
    if (ok) for (const item of recorded) originals.set(item.n, { n: item.n, value: item.value, x: item.x, label: item.label ?? '쿵' });
    return { ok, total, last, peak, postVisible, invitation, layout };
  }

  function downstairs(state, { sequence, peakValue, repeat }) {
    const raw = pageText(replayNotice);
    const f2b = typeof window.LandingBuilding?.createClimaxScrollMap === 'function';
    const pinned = /^같은\s+(쿵|드르륵)\s+#(\d+)\s*·\s*(\d+), 듣는 자리만 다릅니다\.$/.exec(raw);
    const current = f2b ? pinned && { label: pinned[1], n: Number(pinned[2]), value: Number(pinned[3]) } : feedbackRecord(raw);
    const replay = f2b ? Boolean(pinned) : raw.startsWith('재생');
    const room = roomInView('s2');
    const cue = '#s2 [data-cue="s2-after"]';
    const visibleCopy = inView(query(cue)) ? pageText(cue).replace(/\s+/g, ' ') : '';
    const activeTags = [...document.querySelectorAll('#s2 .tag.is-now')].filter(inView).map((item) => ({
      name: item.querySelector('.tag-n')?.textContent.trim(),
      value: Number(item.querySelector('.tag-v')?.textContent.trim()),
      markN: item.dataset.markN,
      markValue: Number(item.dataset.markValue),
      markX: Number.parseFloat(item.dataset.markX),
    }));
    const geometry = window.LandingArt?.geometry?.('s2');
    const source = query('#s2 .src-ghost');
    const axis = source?.querySelector('.ln-axis');
    const axisStart = Number(axis?.getAttribute('x1'));
    const axisEnd = Number(axis?.getAttribute('x2'));
    const sourceX = axis && Number.isFinite(geometry?.w) && geometry.w > 0 ? axisStart / geometry.w : null;
    const sourceId = source?.getAttribute('data-source-n');
    const sourceLabel = source?.querySelector('.sg-label')?.textContent.trim() ?? '';
    const sourceVisible = inView(source?.querySelector('.sg-body')) && inView(source?.querySelector('.sg-label'));
    const cursor = query('#s2 [data-replay-cursor]');
    const cursorX = cursor?.hidden === false ? Number.parseFloat(cursor.style.getPropertyValue('--cursor')) : null;
    const layout = auditLayout([cue, '#s2 [data-cue="s2-empty"]', '#s2 [data-cue="s2-06"]', '#s2-title',
      '#s2 .src-ghost .sg-label', '#s2 .tag.is-now text'], ['#s2 button[data-action="replay"]', '.hud']);
    if (state === 'v04-s2-reference') {
      const reference = (f2b ? /^기준 낙하\s*·\s*100$/ : /^재생\s*·\s*기준 낙하\s*·\s*[1-9]\d*$/).test(raw);
      const emptyCue = inView(query('#s2 [data-cue="s2-empty"]'));
      return { ok: room && reference && emptyCue && !visibleCopy && !current && activeTags.length === 0
          && upper().length === 0 && sourceVisible && sourceId === '' && sourceLabel === '7층, 공 한 번' && layout.ok,
        raw, reference, current, activeTags, visibleCopy, emptyCue, sourceId, sourceLabel, sourceVisible, layout };
    }
    const original = originals.get(current?.n);
    const retained = upper();
    const maximum = retained.reduce((peak, item) => !peak || item.value > peak.value ? item : peak, null);
    const sameCopy = current && visibleCopy === `같은 ${current.label} #${current.n} · ${current.value}, 듣는 자리만 다릅니다.`;
    const matchingTag = original && activeTags.find(({ markN, markValue, markX }) =>
      markN === String(original.n) && markValue === original.value && Math.abs(markX - original.x) <= 0.005);
    const sameTagRecord = Boolean(matchingTag);
    const sameTag = Boolean(matchingTag && matchingTag.name === `${current.label} #${current.n}` && matchingTag.value === current.value);
    const sameX = original && Number.isFinite(cursorX) && Number.isFinite(sourceX) && axisStart === axisEnd
      && Math.abs(cursorX - original.x) <= 0.005 && Math.abs(sourceX - original.x) <= 0.005;
    const replayedAgain = !repeat || repeatNotice?.includes(raw) === true;
    const ok = Boolean(room && replay && ['쿵', '드르륵'].includes(current?.label) && (sequence === undefined || current.n === sequence)
      && (peakValue === undefined || current.value === peakValue && maximum?.value === peakValue)
      && (!f2b || maximum && sameRecord(current, maximum)) && replayedAgain
      && original && sameRecord(original, current) && sameCopy && sameTag && sameX && sourceId === String(current.n)
      && sourceVisible && layout.ok
      && [...originals.values()].every((item) => retained.some((record) => sameRecord(item, record))));
    return { ok, raw, current, originals: [...originals.values()], visibleCopy, activeTags, cursorX, sourceX, sourceId, sourceLabel,
      sourceVisible, sameCopy, sameTagRecord, sameTag, sameX, layout, f2b, maximum, replayedAgain, repeatNotice };
  }

  function matLabelRows() {
    const read = (selector) => [...document.querySelectorAll(`#s5 svg[data-art-mat] ${selector}`)]
      .filter(inView).map((node) => node.textContent.trim());
    return { upstairs: read('.mat-tag:not(.lamp-tag)'), downstairs: read('.lamp-tag') };
  }

  function matState(state, { heightSource, seenFlip, focused, beforeValue, started = true, flipPrompt: expectedFlipPrompt }) {
    const mat = query('#s5')?.dataset.matTest;
    const position = Number(query('#s5 [data-stage="s5"]')?.dataset.dropHeight);
    const results = [...trials.values()];
    const [first, ...rest] = results;
    const sameHeight = Boolean(first && rest.length && first.surface === 'bare' && Number.isFinite(first.height)
      && results.every(({ type }) => type === 'matDrop')
      && rest.every(({ height, surface }) => height === first.height && surface === 'mat'));
    const before = cushion?.before?.index ?? null;
    const reading = {
      before: number('#s5 [data-impact-before]'),
      after: number('#s5 [data-impact-after]'),
      reduction: number('#s5 [data-impact-reduction]'),
    };
    const result = query('#s5 [data-mat-result]');
    const matNote = pageText('#s5 [data-cue="s5-07"]').replace(/\s+/g, ' ');
    const f3 = Boolean(query('#s6 [data-recap="listen"]'));
    const matNoteOk = !f3 || matNote === '이 수치는 이 페이지 물리엔진의 값입니다. 실제 매트는 가벼운 충격엔 효과가 크고, 높은 데서 물건이 떨어지는 큰 충격엔 효과가 적습니다.';
    const comparison = cushion?.comparison;
    const drops = cushion?.matDrops ?? 0;
    const next = ['mat-before', 'mat-lay', 'mat-after'].filter((name) => {
      return actionable(query(`#s5 button[data-action="${name}"]`));
    });
    const labels = matLabelRows();
    const pair = (row) => row.length === 2 && row.includes('맨바닥') && row.includes('매트 위');
    const compact = innerWidth <= 360 || innerHeight <= 559;
    const stepButtons = ['mat-before', 'mat-after'].map((name) => query(`#s5 button[data-action="${name}"]`));
    const stepNamesVisible = stepButtons.every(inView)
      && stepButtons[0].textContent.includes('맨바닥') && stepButtons[1].textContent.includes('매트 위');
    const upperLabels = pair(labels.upstairs) || compact && labels.upstairs.length === 1 && labels.upstairs[0] === '맨바닥' && stepNamesVisible;
    const lampCue = inView(query('#s5 [data-cue="s5-05"]'));
    const lampFigures = [...document.querySelectorAll('#s5 .lamp-ghost')].filter(inView).length;
    const lowerLabels = comparison?.lampContrast
      ? pair(labels.downstairs) || compact && labels.downstairs.length === 0 && lampCue && lampFigures === 2
      : labels.downstairs.length === 0;
    const coherentLabels = upperLabels && lowerLabels;
    const compared = Boolean(mat === 'done' && sameHeight && coherentLabels && comparison?.before === before && before > comparison.after
      && comparison.after >= 0 && inView(result) && reading.before === comparison.before && reading.after === comparison.after
      && reading.reduction === Math.round(comparison.reduction * 100));
    const layout = auditLayout(['#s5 [data-place="s5-head"]', '#s5 [data-mat-result]', '#s5 [data-cue="s5-07"]',
      '#s5 [data-cue="s5-05"]', '#s5 [data-cue="s5-after"]'], ['#s5 .steps button[data-action]', '#s5 svg[data-art-mat] text']);
    let ok;
    switch (state) {
      case 'v04-mat-ready':
        ok = mat === 'ready' && results.length === 0 && !comparison && !inView(result) && next.join() === 'mat-before';
        break;
      case 'v04-mat-bare':
        ok = mat === 'before' && results.length === 1 && first.surface === 'bare' && before > 0
          && !comparison && !inView(result) && next.join() === 'mat-lay';
        break;
      case 'v04-mat-laid':
        ok = mat === 'laid' && results.length === 1 && before > 0 && !comparison && !inView(result)
          && inView(query('#s5 [data-mat]')) && next.join() === 'mat-after';
        break;
      case 'v04-mat-compared':
        ok = compared && matNoteOk && drops === 1 && results.length === 2 && next.join() === 'mat-after';
        break;
      case 'v04-mat-repeated':
        ok = compared && matNoteOk && drops === 2 && results.length === 3 && next.join() === 'mat-after';
        break;
      case 'v04-mat-incomplete-card': {
        const cardMat = query('#s6 [data-result-mat]');
        const peak = number('#s6 [data-result-peak]');
        const flipPrompt = query(flipReminder);
        const matPrompt = query('#s6 [data-mat-missed]');
        const summaryMat = query('#s6 [data-recap="mat"]');
        const link = (matPrompt ?? summaryMat)?.querySelector('a[href="#s5"]');
        const rows = window.LandingArt?.records?.() ?? [];
        const upperPeak = Math.max(0, ...rows.filter(({ slab, n }) => slab === '7-6' && n > 0).map(({ value }) => value));
        const reminder = matPrompt ? inView(matPrompt) && actionable(link)
          : Boolean(summaryMat?.dataset.state === 'empty' && link
            && link.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false);
        const flipPromptOpen = Boolean(flipPrompt && !flipPrompt.hidden);
        const flipPromptVisible = inView(flipPrompt);
        const prompt = seenFlip
          ? reminder && flipPrompt?.hidden && link.textContent.includes('매트 깔아 보기')
          : (expectedFlipPrompt === 'open' ? flipPromptOpen : flipPromptVisible) && (matPrompt ? matPrompt.hidden : reminder);
        const incomplete = started ? (mat === 'before' || mat === 'laid') && results.length === 1 && before > 0
          : mat === 'ready' && results.length === 0 && before === null;
        ok = Boolean(incomplete && drops === 0 && !comparison && cardMat?.hidden
          && peak === (upperPeak || before || 0) && inView(query('#s6 [data-result-peak]')) && prompt);
        return { ok, mat, trials: results, drops, before, cardMatHidden: cardMat?.hidden, peak, upperPeak,
          flipPromptOpen, flipPrompt: flipPromptVisible, matPrompt: inView(matPrompt), href: link?.getAttribute('href') };
      }
      case 'v04-mat-complete-card': {
        const cardMat = query('#s6 [data-result-mat]');
        const cardBefore = number('#s6 [data-result-mat-before]');
        const cardAfter = number('#s6 [data-result-mat-after]');
        const matPrompt = query('#s6 [data-mat-missed]');
        const summaryMat = query('#s6 [data-recap="mat"]');
        const summaryLink = summaryMat?.querySelector('a[href="#s5"]');
        const reminderHidden = matPrompt ? matPrompt.hidden : summaryMat?.dataset.state === 'done'
          && (!summaryLink || summaryLink.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) === false);
        const peak = number('#s6 [data-result-peak]');
        const ok = Boolean(mat === 'done' && comparison && reminderHidden && roomInView('s6') && inView(cardMat)
          && cardBefore === comparison.before && cardAfter === comparison.after
          && (beforeValue === undefined || peak === beforeValue && cardBefore === beforeValue));
        return { ok, mat, cardBefore, cardAfter, matPromptHidden: reminderHidden, peak, comparison };
      }
    }
    const fromPeak = inView(query('#s5 [data-cue="s5-08"]'));
    const fromReference = inView(query('#s5 [data-cue="s5-08b"]'));
    const recorded = [...originals.values()];
    const dragLed = heightSource === 'reference-after-drag' && recorded.length > 0
      && upper().some(({ label, value }) => label === '드르륵' && value > Math.max(...recorded.map((item) => item.value)));
    const referenceHeight = fromReference && !fromPeak && Math.abs(position - 0.5) <= 0.001;
    const sourceOk = !heightSource || (heightSource === 'peak'
      ? fromPeak && !fromReference && position >= 0 && position < 0.49
      : referenceHeight && (heightSource !== 'reference-after-drag' || dragLed));
    const active = document.activeElement?.getAttribute('data-action') ?? null;
    return { ok: Boolean(ok && sourceOk && layout.ok && (focused === undefined || active === focused)
        && (beforeValue === undefined || before === beforeValue)),
      mat, trials: results, drops, sameHeight, before, reading, next, active,
      position, fromPeak, fromReference, dragLed, labels, lampCue, lampFigures, resultVisible: inView(result), compared, matNote, matNoteOk, layout };
  }

  return {
    watchRepeat,
    check(options) {
      if (options.state === 'v04-s6-flip-visible') {
        const node = query(flipReminder);
        const visible = inView(node);
        const linkVisible = inView(node?.querySelector('a[href="#s4"]'));
        return { ok: Boolean(node && !node.hidden && visible && linkVisible), hidden: node?.hidden ?? null, visible, linkVisible };
      }
      if (options.state.startsWith('v04-s0-')) return firstAction(options.state, options);
      if (options.state.startsWith('v04-s2-')) return downstairs(options.state, options);
      return matState(options.state, options);
    },
  };
}
