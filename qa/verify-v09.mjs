export const v09States = [
  'v09-grouped-mark', 'v09-s4-return', 'v09-s4-settled', 'v09-s4-cls', 'v09-s4-question',
  'v09-ruler-placement', 'v09-ruler-source', 'v09-card-source-free', 'v09-room-tags',
];
export const v09Watches = ['v09-layout-shifts'];

export function validV09Expectation({ state, wait, angle }) {
  return (wait === undefined || Number.isFinite(wait) && wait >= 0 && wait <= 8)
    && (state === 'v09-room-tags' ? [0, 56, 90, 236, 270, 360].includes(angle) : angle === undefined);
}

export function installV09Verification({ query, inView, roomInView, artRecords, cardPng, v10kCopy }) {
  const all = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const clean = (value) => (value ?? '').replace(/\s+/g, ' ').trim();
  const text = (node) => clean(node?.innerText ?? node?.textContent);
  const painted = (node) => Boolean(node && !node.closest('[hidden]') && node.checkVisibility({
    opacityProperty: true, visibilityProperty: true,
  }));
  const shown = (node) => painted(node) && inView(node);
  function box(node) {
    const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
    return { left, right, top, bottom, width, height };
  }
  const horizontalGap = (a, b) => Math.max(b.left - a.right, a.left - b.right);
  const heightShared = (a, b) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const overlaps = (a, b) => horizontalGap(a, b) < -0.5 && heightShared(a, b) > 0.5;
  const intersectsViewport = (rect) => Boolean(rect && rect.width > 0 && rect.height > 0
    && rect.left < innerWidth && rect.right > 0 && rect.top < innerHeight && rect.bottom > 0);
  const after = (a, b) => Boolean(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
  const s4Layer = '#s4 [data-flip-layer]:not([data-building-mirror])';
  const s4Return = '#s4 [data-place="s4-return"]';
  const s4Controls = '#s4 [data-place="s4-controls"]';
  const rulerSelector = '#s6 figure.ruler';
  const bridge = '쿵 지수는 dB로 바꿀 수 없습니다. 한국소비자원이 실제 소리로 재 보니, 어린이 매트가 가벼운 충격음은 약 16~17dB(A) 줄였지만, 1m 높이에서 떨어뜨린 고무공 소리는 1~2dB(A)만 줄였습니다.';
  const citation = '출처: 한국소비자원, 층간소음 저감 어린이 매트 시험(2025.12.24)';
  let observer;
  const shifts = [];

  function groupedMark() {
    const band = query('#s0 [data-cue="s0-band"]');
    const heading = band?.querySelector('.br-k');
    const upper = artRecords().filter(({ slab, n }) => slab === '7-6' && n > 0);
    const ceiling = all('#s0 [data-art-marks] .tag[data-mark-n]').find((tag) => /^\d+-\d+$/.test(tag.dataset.markN));
    const floor = query('#s0 [data-art-marks] .tag.is-now');
    const label = text(ceiling?.querySelector('.tag-n'));
    const value = Number(ceiling?.dataset.markValue);
    const mark = ceiling?.querySelector('text');
    const chip = ceiling?.querySelector('.tag-chip');
    const markRect = label && painted(mark) ? box(mark) : null;
    const bandRect = band && box(band);
    const titleRect = heading && box(heading);
    const gap = markRect && titleRect && heightShared(markRect, titleRect) > 0 ? horizontalGap(markRect, titleRect) : null;
    const clash = Boolean(markRect && bandRect && overlaps(chip ? box(chip) : markRect, bandRect));
    const grouped = /#\d+.*(?:#\d+|외).*최대/;
    const markerOnly = Boolean(ceiling && !label && painted(ceiling) && ceiling.querySelector('.ln-leader')
      && grouped.test(text(floor?.querySelector('.tag-n'))) && shown(floor?.querySelector('text'))
      && Number(text(floor?.querySelector('.tag-v'))) === value);
    const visibleGroup = shown(mark) && grouped.test(label) && Number(text(ceiling.querySelector('.tag-v'))) === value;
    return { ok: roomInView('s0') && upper.length >= 2 && shown(heading) && upper.some((record) => record.value === value)
      && (markerOnly || visibleGroup && !clash && (gap === null || gap >= 12)),
    label, value, markerOnly, records: upper, markRect, bandRect, titleRect, gap, clash };
  }

  function collectShifts(entries) {
    for (const entry of entries) {
      if (entry.hadRecentInput) continue;
      const sources = (entry.sources ?? []).map(({ node }) => {
        const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        return element?.closest('#s4 [data-place]')?.dataset.place ?? element?.localName ?? null;
      });
      shifts.push({ at: entry.startTime, value: entry.value, sources });
    }
  }

  function s4Frame() {
    const layer = query(s4Layer);
    const match = /rotate\(([-\d.e]+)deg\)/.exec(layer?.style.transform ?? '');
    return { phase: layer?.dataset.climaxPhase ?? null, angle: match ? Number(match[1]) : null };
  }

  function s4ReturnState(settled) {
    const frame = s4Frame();
    const panel = query(s4Return);
    const controls = query(s4Controls);
    const next = controls?.querySelector('[data-action="s4-next"]');
    const flip = controls?.querySelector('button[data-action="flip"]');
    const ready = shown(next) && shown(flip) && !next.matches('[aria-disabled="true"]')
      && !flip.matches('[aria-disabled="true"],:disabled');
    return { ok: roomInView('s4') && shown(panel) && (settled ? frame.phase === 'settle' && ready
      : frame.phase === 'return' && !painted(next)), ...frame, ready,
    returnBox: panel && box(panel), controlsBox: controls && box(controls) };
  }

  function cls() {
    if (observer) collectShifts(observer.takeRecords());
    const total = shifts.reduce((sum, entry) => sum + entry.value, 0);
    const s4Shifts = shifts.filter(({ value, sources }) =>
      value > 0.005 && sources.some((source) => ['s4-return', 's4-controls'].includes(source)));
    return { ok: Boolean(observer && s4ReturnState(true).ok && total < 0.01 && !s4Shifts.length),
      supported: Boolean(observer), total, s4Shifts, shifts };
  }

  function s4Question() {
    const questions = all('#s4 [data-physics-body="copy:0"], #s4 [data-s4-question]')
      .filter((node) => text(node) === '중력을 뒤집으면?');
    const remaining = questions.filter(painted);
    const chair = query('#s4 [data-physics-body="6:chair"]');
    const chairBox = painted(chair) ? box(chair) : null;
    const buttons = all(`${s4Controls} :is(button, a)`).filter(shown);
    const chairInFrame = intersectsViewport(chairBox);
    const safe = remaining.every((question) => shown(question)
      && [chairBox, ...buttons.map(box)].every((item) => item && !overlaps(box(question), item)));
    const settled = s4ReturnState(true);
    const hud = query('.hud');
    const returnUnderHud = Boolean(hud && settled.returnBox && overlaps(settled.returnBox, box(hud)));
    return { ok: Boolean(settled.ok && questions.length && text(query('#s4-title')).includes('중력을 뒤집으면?')
      && chairInFrame && buttons.length >= 2 && safe),
    hidden: !remaining.length, questionBoxes: remaining.map(box), chairBox, chairInFrame, returnUnderHud,
    buttons: buttons.map((button) => text(button)) };
  }

  function rulerPlacement() {
    const figures = all(rulerSelector).filter(painted);
    const [figure] = figures;
    const caption = figure?.querySelector('figcaption');
    const rulerList = figure?.querySelector('.ruler-list');
    const card = query('#s6 [data-place="s6-board"]');
    const definition = query('#s6 .recap-def');
    const summary = query('#s6 .recap-list');
    const side = query('#s6 .side');
    const disclaimer = query('#s6 .side .disclaim');
    const content = query('#s6 .end');
    const fig = figure && box(figure);
    const cardRect = card && box(card);
    const sideRect = side && box(side);
    const disclaimerRect = disclaimer && box(disclaimer);
    const summaryRect = summary && box(summary);
    const cardEndMinusSideEnd = cardRect && sideRect ? cardRect.bottom - sideRect.bottom : null;
    const wide = innerWidth >= 1280 || Boolean(cardRect && sideRect && side.clientWidth >= 480
      && sideRect.left >= cardRect.right - 0.5 && sideRect.top < cardRect.bottom - 2);
    const beside = Boolean(fig && cardRect && figure.parentElement === side && side.clientWidth >= 480 && disclaimerRect
      && fig.left >= cardRect.right - 0.5 && fig.top >= disclaimerRect.bottom - 0.5
      && sideRect.top < cardRect.bottom - 2 && cardEndMinusSideEnd <= 160);
    const stacked = Boolean(fig && cardRect && fig.top >= cardRect.bottom - 0.5);
    const ordered = beside ? after(disclaimer, figure) && caption?.nextElementSibling === definition
      && after(definition, rulerList) && after(figure, summary)
      : after(definition, figure) && after(figure, summary);
    const fits = fig && fig.left >= -0.5 && fig.right <= innerWidth + 0.5
      && content?.scrollWidth <= content?.clientWidth + 1;
    const captionVisible = shown(caption);
    return { ok: Boolean(figures.length === 1 && captionVisible && ordered && fits
      && summaryRect && !overlaps(fig, summaryRect) && (wide ? beside : stacked)),
    figures: figures.length, state: query('#s6')?.dataset.resultState, wide, beside, stacked, ordered, fits, captionVisible,
    cardEndMinusSideEnd,
    captionBox: caption && box(caption),
    fig, cardRect, sideRect, disclaimerRect, summaryRect };
  }

  function unexpectedSoundUnits(bridgeCopy) {
    const study = all('#s7 .facts > li').map(text).find((copy) => copy.startsWith('한국소비자원이 어린이 매트')) ?? '';
    const law = all('#s7 footer > p.block').map(text).find((copy) => copy.startsWith('법령이 정한 층간소음 기준')) ?? '';
    const unapproved = text(query('#main')).replace(bridgeCopy, '')
      .replace(study, study.replace('가벼운 충격음은 약 16~17dB(A) 줄었고', '')
        .replace('무거운 충격음은 4~5dB(A), 1m에서는 1~2dB(A) 줄었습니다.', ''))
      .replace(law, law.replace('낮(06~22시) 39dB(A) · 밤(22~06시) 34dB(A)', '')
        .replace('2005년 6월 30일 이전에 사업승인을 받은 공동주택은 2dB(A)을 더해 적용합니다.', ''));
    return [...unapproved.matchAll(/dB\s*\(\s*A\s*\)/gi)].map(({ index }) =>
      unapproved.slice(Math.max(0, index - 24), index + 18));
  }

  function rulerSource() {
    const figure = query(rulerSelector);
    const last = figure?.querySelector('.ruler-note');
    const note = last?.nextElementSibling;
    const source = note?.lastElementChild;
    const noteBox = note && box(note);
    const lastBox = painted(last) ? box(last) : null;
    const copy = text(note);
    const original = query('#s7 .src :is(a[href*="A1081254"], [data-source-url*="A1081254"])');
    const href = original?.dataset.sourceUrl ?? original?.href;
    const copyMatches = text(source) === citation && clean(copy.replace(citation, '')) === bridge;
    const unexpectedDb = unexpectedSoundUnits(copy);
    const cleanAxis = figure && all('li', figure).every((row) => !/dB|데시벨/i.test(text(row)));
    const definition = text(figure?.querySelector('.recap-def'));
    const figureCopy = text(figure);
    const scaleCopy = definition === v10kCopy?.definition ? figureCopy.replace(definition, '') : figureCopy;
    const noForbiddenCopy = !/데시벨|법정|기준치|발걸음|두\s*배|2\s*배/.test(scaleCopy);
    const below = Boolean(noteBox && lastBox && after(last, note) && noteBox.top >= lastBox.bottom - 0.5
      && horizontalGap(noteBox, lastBox) <= 0 && noteBox.top - lastBox.bottom <= 48);
    const noteVisible = shown(note), sourceVisible = shown(source);
    const sourceAllowed = Boolean(href?.startsWith('https://www.consumer.go.kr/') && href.includes('cntntsId=00000566'));
    const readable = noteVisible && sourceVisible && !note.closest('[aria-hidden="true"]') && !note.querySelector('a')
      && [note, source].every((node) => Number.parseFloat(getComputedStyle(node).fontSize) >= 12);
    return { ok: Boolean(note?.matches('p') && readable && below && copyMatches && !unexpectedDb.length && cleanAxis && noForbiddenCopy
      && sourceAllowed),
    copy, href, sourceAllowed, noteBox, lastBox, below, noteVisible, sourceVisible, readable, copyMatches, unexpectedDb, cleanAxis, noForbiddenCopy };
  }

  async function cardSourceFree() {
    const png = await cardPng();
    const sourceWords = png?.textDraw?.filter(({ text }) => /dB|데시벨|한국소비자원/.test(text));
    return { ok: Boolean(png?.filename?.endsWith('.png') && png.width === 1080 && png.height === 1350
      && png.textDraw?.length > 0 && !sourceWords.length),
    captured: Boolean(png), filename: png?.filename ?? null, width: png?.width ?? null, height: png?.height ?? null,
    feedback: text(query('#s6 [data-fx="share-feedback"]')), sourceWords: sourceWords ?? null };
  }

  function roomTags(angle) {
    const frame = s4Frame();
    const roomLabels = all(`${s4Layer} .svg-roomtag`);
    const laidOut = roomLabels.flatMap((node) => {
      const group = node.closest('.roomtag');
      if (!painted(node) || group && getComputedStyle(group).display === 'none') return [];
      const rect = box(node);
      return rect.width > 0 && rect.height > 0 ? [{ node, rect }] : [];
    });
    const labels = laidOut.filter(({ rect }) => intersectsViewport(rect)).map(({ node, rect }) => {
      const matrix = node.getScreenCTM();
      const fontSize = Number.parseFloat(getComputedStyle(node).fontSize);
      const scale = matrix ? Math.hypot(matrix.c, matrix.d) : null;
      return { label: text(node), rect, fontSize, scale, cssPx: scale === null ? null : fontSize * scale };
    });
    const upright = angle === 0 || angle === 360;
    const slabLabels = all('#s4 [data-s4-slab-label]').filter(shown).map(text);
    const hud = query('.hud [data-lift]');
    const floorCopy = hud?.getAttribute('aria-label') ?? '';
    const hudLabel = query('.hud [data-lift-now] .ln-txt');
    const hudCopy = text(hudLabel);
    const hudVisible = shown(hudLabel);
    const orientation = upright ? labels.length >= 2 && labels.every(({ cssPx }) => Number.isFinite(cssPx) && cssPx >= 11.95)
      : roomLabels.length >= 2 && laidOut.length === 0 && slabLabels.length === 2
        && hudVisible && hudCopy === '지금 세 층 모두' && floorCopy.includes('세 층 모두');
    return { ok: roomInView('s4') && frame.angle !== null && Math.abs(frame.angle - angle) <= 3 && orientation,
      ...frame, expectedAngle: angle, roomLabelCount: roomLabels.length, laidOutCount: laidOut.length,
      labels, slabLabels, hudVisible, hudCopy, floorCopy };
  }

  return {
    watch() {
      if (!PerformanceObserver.supportedEntryTypes.includes('layout-shift')) return;
      observer = new PerformanceObserver((list) => collectShifts(list.getEntries()));
      observer.observe({ type: 'layout-shift', buffered: true });
    },
    check({ state, angle }) {
      switch (state) {
        case 'v09-grouped-mark': return groupedMark();
        case 'v09-s4-return': return s4ReturnState(false);
        case 'v09-s4-settled': return s4ReturnState(true);
        case 'v09-s4-cls': return cls();
        case 'v09-s4-question': return s4Question();
        case 'v09-ruler-placement': return rulerPlacement();
        case 'v09-ruler-source': return rulerSource();
        case 'v09-card-source-free': return cardSourceFree();
        case 'v09-room-tags': return roomTags(angle);
      }
    },
  };
}
