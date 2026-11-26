export const v10kStates = ['v10k-copy', 'v10k-font', 'v10k-intro-layout', 'v10k-mat-layout', 'v10k-s4-settled'];

export function validV10KExpectation({ wait }) {
  return wait === undefined || Number.isFinite(wait) && wait >= 0 && wait <= 8;
}

export function installV10KVerification({ query, inView, roomInView, v10kCopy, fontReport }) {
  const intro = '#s0 [data-cue="s0-band"]';
  const mat = '#s6 [data-recap="mat"]';
  const clean = (copy) => (copy ?? '').replace(/\s+/g, ' ').trim();
  const copy = (node) => clean(node?.textContent);
  const rendered = (node) => clean(node?.innerText ?? node?.textContent);
  const painted = (node) => Boolean(node && !node.closest('[hidden]')
    && node.checkVisibility({ visibilityProperty: true, opacityProperty: true }));
  const shown = (node) => painted(node) && inView(node);

  function textRects(node) {
    if (!painted(node)) return [];
    const range = document.createRange();
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const rects = [];
    for (let part = walker.nextNode(); part; part = walker.nextNode()) {
      const parent = part.parentElement;
      if (!clean(part.textContent) || !painted(parent) || parent.closest('.br-sep')) continue;
      range.selectNodeContents(part);
      rects.push(...[...range.getClientRects()].filter(({ width, height }) => width > 0 && height > 0));
    }
    return rects;
  }

  function overflow(node, rects) {
    if (!node || !rects.length) return true;
    const bounds = node.getBoundingClientRect();
    return bounds.left < -0.5 || bounds.right > innerWidth + 0.5 || node.scrollWidth > node.clientWidth + 1
      || document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      || rects.some(({ left, right }) => left < bounds.left - 0.5 || right > bounds.right + 0.5);
  }

  function introLayout() {
    const band = query(intro);
    const definition = query(`${intro} .br-def`);
    const definitionRects = textRects(definition);
    const hudBottom = query('.hud')?.getBoundingClientRect().bottom;
    const definitionVisible = shown(definition) && Number.isFinite(hudBottom) && definitionRects.length > 0
      && definitionRects.every(({ top, bottom }) => top >= hudBottom - 0.5 && bottom <= innerHeight + 0.5);
    const bandOverflow = overflow(band, textRects(band));
    return { ok: roomInView('s0') && definitionVisible && !bandOverflow && copy(band) === v10kCopy.intro,
      definition: copy(definition), definitionVisible, hudBottom, definitionRects, bandOverflow, scrollY };
  }

  function matLayout() {
    const row = query(mat);
    const caption = query(`${mat} .rc-pct`);
    const rects = textRects(caption);
    const label = copy(caption);
    const oneLine = rects.length > 0 && Math.max(...rects.map(({ top }) => top)) < Math.min(...rects.map(({ bottom }) => bottom));
    const cellOverflow = overflow(row, rects);
    return { ok: row?.dataset.state === 'done' && shown(caption) && /^쿵 지수 \d+% 감소$/.test(label)
      && oneLine && !cellOverflow, label, oneLine, cellOverflow, rects };
  }

  function pageCopy() {
    const band = copy(query(intro));
    const definition = rendered(query('#s6 .recap-def'));
    const s2 = copy(query('#s2 .u06'));
    const s7 = [...document.querySelectorAll('#s7 footer > p.block')].map(copy).find((text) => text.startsWith('쿵 지수:'));
    const page = rendered(document.body);
    const oldSound = /덜\s*울림/.test(page);
    const oldForce = /충격의\s*크기/.test(page);
    const definitionFirst = definition.startsWith('쿵 지수는 바닥이 받은 충격의 세기');
    const otherTwice = /두\s*배|2\s*배/.test(page.replace(v10kCopy.definition, v10kCopy.definition.replace(v10kCopy.negation, '')));
    return { ok: band === v10kCopy.intro && definition === v10kCopy.definition && definitionFirst
      && s2 === v10kCopy.u06 && s7 === v10kCopy.u06 && !oldSound && !oldForce && !otherTwice,
    band, definition, definitionFirst, s2, s7, oldSound, oldForce, otherTwice };
  }

  function settledS4() {
    const layer = query('#s4 [data-flip-layer]:not([data-building-mirror])');
    const panel = query('#s4 [data-place="s4-return"]');
    const chair = query('#s4 [data-physics-body="6:chair"]');
    const visible = shown(panel) && shown(chair);
    const panelBox = panel?.getBoundingClientRect();
    const chairBox = chair?.getBoundingClientRect();
    const overlap = visible ? {
      x: Math.max(0, Math.min(panelBox.right, chairBox.right) - Math.max(panelBox.left, chairBox.left)),
      y: Math.max(0, Math.min(panelBox.bottom, chairBox.bottom) - Math.max(panelBox.top, chairBox.top)),
    } : null;
    const phase = layer?.dataset.climaxPhase;
    return { ok: Boolean(roomInView('s4') && phase === 'settle' && overlap && (overlap.x <= 0.5 || overlap.y <= 0.5)),
      phase, visible, panelBox, chairBox, overlap };
  }

  return {
    check({ state }) {
      switch (state) {
        case 'v10k-copy': return pageCopy();
        case 'v10k-font': return { ok: fontReport?.missing === '', ...fontReport };
        case 'v10k-intro-layout': return introLayout();
        case 'v10k-mat-layout': return matLayout();
        case 'v10k-s4-settled': return settledS4();
      }
    },
  };
}
