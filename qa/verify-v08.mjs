export const v08States = ['v08-intro-ready', 'v08-intro-scale', 'v08-record', 'v08-ruler', 'v08-marker', 'v08-hud'];

export function validV08Expectation({ state, wait, scene, view, kind, value }) {
  return (wait === undefined || Number.isFinite(wait) && wait >= 0 && wait <= 8)
    && (state === 'v08-hud'
      ? (scene === 's4' ? ['all', 'listening'].includes(view) : ['s0', 's1', 's2', 's3', 's5', 's6'].includes(scene) && view === undefined)
      : scene === undefined && view === undefined)
    && (state === 'v08-record' ? ['thump', 'scrape'].includes(kind) && [30, 43, 100, 140, 200].includes(value)
      : state === 'v08-marker' ? ['empty', 'thump', 'scrape', 'mat-only'].includes(kind) && value === undefined
        : kind === undefined && value === undefined);
}

// 이 함수는 검수 탭에 직렬화한다. 실제 빌드의 물리 모듈에서 대표 입력을 다시 실행한다.
export function installV08Verification({ query, inView, roomInView, artRecords, v10kCopy }) {
  const clean = (text) => (text ?? '').replace(/\s+/g, ' ').trim();
  const rendered = (node) => clean(node?.innerText ?? node?.textContent);
  const all = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const painted = (node) => Boolean(node && !node.closest('[hidden]')
    && node.checkVisibility({ visibilityProperty: true, opacityProperty: true }));
  const shown = (node) => painted(node) && inView(node);
  const introNote = '#s0 [data-cue="s0-band"]';
  const introCopy = '#s0 [data-place="s0-intro"]';
  const definition = '#s6 .recap-def';
  const hasV10K = () => Boolean(v10kCopy && query(`${introNote} .br-def`));
  const marker = '#s6 [data-ruler-mine]';
  const negation = '200이 100의 두 배로 시끄럽다는 뜻도 아닙니다.';
  const cardPeak = '#s6 [data-result-peak]';
  const upper = () => artRecords().filter(({ slab, n }) => slab === '7-6' && n > 0);
  const numbers = (text) => (text.match(/\d+/g) ?? []).map(Number);
  const asNumber = (text) => /^\d+$/.test(text) ? Number(text) : null;
  const blockedText = (copy) => copy.replace(hasV10K() ? v10kCopy.negation : negation, '')
    .match(/(?:두\s*배|2\s*배|[×x]\s*2|데시벨|법정|기준치|발걸음|아이(?:가|의|들|\s))/i)?.[0] ?? null;

  let measured;
  async function measure() {
    if (measured) return measured;
    const { createBuilding } = await import('@landing/engines/physics-building.js');
    const { startBuildingAction } = await import('@landing/adapters.js');
    const run = () => {
      const building = createBuilding();
      const events = [];
      building.onReceive((event) => {
        if (event.kind === 'live' && event.sourceRoom === 7 && event.receiverRoom === 6) events.push(event);
      });
      return {
        building,
        record(accept) {
          const start = events.length;
          if (!accept()) return null;
          for (let step = 0; step < 360; step++) building.step();
          return events[start]?.index ?? null;
        },
      };
    };
    function drop(action, high = false) {
      const trial = run();
      const { building } = trial;
      const room = building.rooms.get(7);
      return trial.record(() => startBuildingAction(building, action, building.width / 2, high ? room.top : undefined));
    }
    function mat(high) {
      const trial = run();
      const { building } = trial;
      const room = building.rooms.get(7);
      const y = high ? room.top + room.props.ball.shape.radius : (room.top + room.bottom) / 2;
      const bare = trial.record(() => building.input({ type: 'matDrop', y }));
      const padded = trial.record(() => building.input({ type: 'mat', enabled: true }) && building.input({ type: 'matDrop', y }));
      return [bare, padded];
    }
    const chair = run();
    measured = {
      tap: drop('tap'), standard: drop('drop'), high: drop('drop', true),
      chair: chair.record(() => chair.building.input({ type: 'dragChair', distance: -55 })),
      matStandard: mat(false), matHigh: mat(true),
    };
    return measured;
  }

  function textRects(node) {
    if (!painted(node)) return [];
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    const boxes = [];
    for (let part = walker.nextNode(); part; part = walker.nextNode()) {
      if (!clean(part.textContent) || !painted(part.parentElement) || part.parentElement.closest('.sr,.sr-only')) continue;
      range.selectNodeContents(part);
      for (const rect of range.getClientRects()) {
        if (rect.width > 1 && rect.height > 1) {
          boxes.push({ rect, copy: clean(part.textContent), size: Number.parseFloat(getComputedStyle(part.parentElement).fontSize) });
        }
      }
    }
    return boxes;
  }

  function layout(items) {
    const collisions = [], overflow = [];
    for (let i = 0; i < items.length; i++) {
      for (const a of items[i]) {
        const x = a.rect;
        if (x.left < -0.5 || x.right > innerWidth + 0.5) overflow.push(a.copy);
        for (const b of items.slice(i + 1).flat()) {
          const y = b.rect;
          if (Math.min(x.right, y.right) - Math.max(x.left, y.left) > 1
            && Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 1) collisions.push([a.copy, b.copy]);
        }
      }
    }
    return { ok: !collisions.length && !overflow.length, collisions, overflow };
  }

  function box(node) {
    return painted(node) ? [{ rect: node.getBoundingClientRect(), copy: rendered(node) || node.id }] : [];
  }

  function rulerFigure() {
    return all('#s6 figure').find((figure) => rendered(figure.querySelector('figcaption')) === '쿵 지수 견주기');
  }

  async function introScale() {
    const note = query(introNote);
    const v10k = hasV10K();
    const copy = v10k ? clean(note?.textContent) : rendered(note);
    const engine = await measure();
    const actual = numbers(copy);
    const collisions = layout([textRects(note), ...['#s0-title', introCopy, '#s0 [data-cue="s0-after"]', '#s0 [data-place="s0-down"]']
      .map((selector) => textRects(query(selector))), ...all('#s0 [data-place="s0-keys"] button').map(box), box(query('.hud'))]);
    const expectedCopy = v10k ? copy === v10kCopy.intro
      : /^쿵 지수\s*:\s*바닥 톡 43\s*·\s*방 절반 높이 공 100\s*·\s*천장 가까이 공 200$/.test(copy);
    return { ok: shown(note) && actual.join() === [engine.tap, engine.standard, engine.high].join() && expectedCopy
      && !blockedText(copy) && collisions.ok, copy, actual, engine, layout: collisions };
  }

  async function ruler() {
    const figure = rulerFigure(), title = figure?.querySelector('figcaption');
    const rows = figure ? all('ol > li', figure) : [];
    const engine = await measure();
    const values = rows.map((node) => numbers(rendered(node)));
    const listings = rows.map(rendered);
    const barValues = rows.map((node) => asNumber(getComputedStyle(node).getPropertyValue('--v').trim()));
    const barWidths = rows.map((node) => node.querySelector('.rl-bar')?.getBoundingClientRect().width ?? 0);
    const expected = [engine.high, engine.chair, engine.matHigh[1], engine.standard, engine.matStandard[1], engine.tap];
    const contracts = [200, 140, 114, 100, 56, 43];
    const measuredBars = barWidths[0] > 0 && barWidths.every((width, i) => Math.abs(width - barWidths[0] * expected[i] / 200) <= 1);
    const hints = [/천장 가까이.*공/, /의자 끌기.*드르륵/, /매트 위.*천장 가까이/, /방 절반 높이.*공.*기준/, /매트 위.*방 절반 높이/, /바닥 톡/];
    const definitionNode = query(definition);
    const description = rendered(definitionNode);
    const expectedDefinition = hasV10K() ? v10kCopy.definition
      : `쿵 지수는 방 절반 높이에서 떨어진 공을 100으로 둔 상대값입니다. 실제 소음(dB)이 아니고, ${negation}`;
    const disclaimer = description === expectedDefinition;
    const footnote = rendered(figure?.querySelector('.ruler-note')).includes('드르륵은 의자가 움직인 거리와 힘으로 따로 계산합니다.');
    const bridge = rendered(figure?.querySelector('.ruler-note + p'));
    let scaleCopy = rendered(figure);
    if (figure?.contains(definitionNode)) scaleCopy = scaleCopy.replace(description, '');
    if (bridge.includes('한국소비자원') && bridge.includes('줄였')) scaleCopy = scaleCopy.replace(bridge, '');
    const claim = blockedText(`${description} ${scaleCopy}`);
    const readingOrder = Boolean(title && rows.length === 6 && rows.every(painted)
      && rows.every((node, i) => (i ? rows[i - 1] : title).compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
    const rulerText = [textRects(title), ...rows.map(textRects), textRects(figure?.querySelector('.ruler-note'))];
    const small = rulerText.flat().filter(({ size }) => size < 12).map(({ copy, size }) => ({ copy, size }));
    const collisions = layout([...rulerText, textRects(definitionNode), textRects(query(marker)),
      ...all('#s6 .recap-list .rc-t').map(textRects)]);
    return { ok: Boolean(figure && shown(title) && readingOrder && disclaimer && footnote && !claim
      && !/\bdB\b/i.test(scaleCopy) && expected.join() === contracts.join()
      && engine.matStandard[0] === engine.standard && engine.matHigh[0] === engine.high
      && barValues.join() === expected.join() && measuredBars
      && values.length === expected.length && values.every(([v, extra], i) => v === expected[i] && extra === undefined && hints[i].test(listings[i]))
      && !small.length && collisions.ok), listings, values, barValues, barWidths, measuredBars, engine,
    disclaimer, footnote, claim, readingOrder, small, layout: collisions };
  }

  function mine(kind) {
    const node = query(marker), figure = rulerFigure();
    const value = Number(node?.dataset.rulerValue);
    const card = asNumber(rendered(query(cardPeak)));
    const best = upper().reduce((peak, item) => !peak || item.value > peak.value ? item : peak, null);
    const fromMat = asNumber(rendered(query('#s6 [data-result-mat-before]')));
    const hasRecord = kind !== 'empty';
    const expectedValue = kind === 'mat-only' ? !best && fromMat : best?.value;
    const expectedKind = best?.label === '드르륵' ? 'scrape' : 'thump';
    const label = rendered(query(`${marker} [data-ruler-mine-label]`));
    const display = asNumber(rendered(query(`${marker} [data-ruler-mine-value]`)));
    const rawPosition = node ? getComputedStyle(node).getPropertyValue('--ruler-position').trim() : '';
    const position = rawPosition.endsWith('%') ? Number.parseFloat(rawPosition) : null;
    const axis = node?.getBoundingClientRect();
    const needle = node?.querySelector('.rm-needle');
    const needleBox = needle?.getBoundingClientRect();
    const needleOffset = axis && needleBox ? (needleBox.left + needleBox.width / 2) - axis.left : null;
    const aligned = Boolean(axis?.width > 0 && needleBox?.width > 0 && needleBox.height > 0
      && needle.getAttribute('aria-hidden') === 'true' && Math.abs(needleOffset - axis.width * card / 200) <= 1);
    const lastTick = figure ? all('ol > li', figure).at(-1) : null;
    const ordered = Boolean(node && lastTick && (lastTick.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
    const rulerRows = figure ? all('ol > li', figure) : [];
    const markerText = textRects(node);
    const collisions = layout([markerText, ...rulerRows.map(textRects)]);
    const ok = hasRecord ? Boolean(figure?.contains(node) && painted(node) && ordered && !node.closest('[aria-hidden="true"]')
      && markerText.length && markerText.every(({ size }) => size >= 12)
      && Number.isFinite(expectedValue) && card === expectedValue && value === card && display === card
      && node.dataset.rulerKind === expectedKind && (kind === 'mat-only' || kind === expectedKind)
      && label === (expectedKind === 'scrape' ? '내 최대 드르륵' : '내 최대 쿵')
      && position !== null && Math.abs(position - 100 * card / 200) <= 0.1 && aligned && collisions.ok)
      : Boolean(figure?.contains(node) && card === 0 && !best && !painted(node));
    return { ok, kind, value, card, best, fromMat, display, position, needleOffset, aligned, label, ordered, layout: collisions };
  }

  function floor(scene, view) {
    const isAll = scene === 's4' && view === 'all';
    const isListening = scene === 's4' && view === 'listening';
    const expectedFloor = isAll ? '7 6 5' : scene === 's2' ? '6' : scene === 's3' ? '5' : '7';
    const expectedView = isAll ? 'all' : isListening || ['s2', 's3'].includes(scene) ? 'lower' : 'upper';
    const expectedCopy = isAll ? '세 층 모두' : `${expectedFloor}층 · ${expectedView === 'lower' ? '아래층' : '위층'}`;
    const label = query('.hud [data-lift-now]');
    const labelFloor = rendered(label?.querySelector('.ln-txt .ln-floor'));
    const labelView = rendered(label?.querySelector('.ln-txt .ln-view'));
    const now = label?.querySelector('.ln-txt .ln-now');
    const copy = [painted(now) ? rendered(now) : '', labelFloor, labelView].filter(Boolean).join(' ');
    const lift = query('.hud [data-lift]');
    const aria = clean(lift?.getAttribute('aria-label')).replace(/,\s*/g, ' · ');
    const active = lift ? all('[data-lift-floor].is-on', lift).map((node) => node.dataset.liftFloor).sort() : [];
    const root = query('#main');
    const state = { floor: root?.dataset.currentFloor, view: root?.dataset.currentView, perspective: root?.dataset.perspective };
    const title = query('#s4 [data-flip-cue="listen"] .display');
    const labelRects = textRects(label?.querySelector('.ln-txt'));
    const collisions = layout([labelRects, ...all('.hud [data-lift-floor]').map(box),
      ...all('.hud .brand,.hud button').map(box)]);
    return { ok: roomInView(scene) && shown(label) && label.getAttribute('aria-hidden') === 'true'
      && labelFloor === (isAll ? '세 층' : `${expectedFloor}층`) && labelView === (isAll ? '모두' : expectedView === 'lower' ? '아래층' : '위층')
      && labelRects.length > 0 && labelRects.every(({ size }) => size >= (innerWidth >= 1000 ? 16 : 15))
      && (innerWidth <= 480 || painted(now) && rendered(now) === '지금') && aria === `엘리베이터 표시: 지금 ${expectedCopy}`
      && state.floor === expectedFloor && state.view === expectedView && active.join() === expectedFloor.split(' ').sort().join()
      && (scene !== 's4' || isListening === (state.perspective === 'downstairs') && isListening === shown(title))
      && collisions.ok, scene, view, copy, aria, active, state, layout: collisions };
  }

  return {
    check({ state, scene, view, kind, value }) {
      if (state === 'v08-intro-ready') {
        const copy = rendered(query(introCopy));
        return { ok: shown(query(introCopy)) && copy.includes('방 위쪽을 눌러 보세요. 누른 높이에서 공이 떨어집니다.')
          && upper().length === 0 && !painted(query(introNote)), copy };
      }
      if (state === 'v08-intro-scale') return introScale();
      if (state === 'v08-ruler') return ruler();
      if (state === 'v08-marker') return mine(kind);
      if (state === 'v08-hud') return floor(scene, view);
      const first = upper()[0];
      const matches = kind === 'scrape' ? first?.label === '드르륵' : first?.label === '쿵';
      const index = first?.value;
      // 실제 방문 중의 의자 끌기와 공 클릭은 시작 자세에 따라 달라진다.
      const expected = kind === 'scrape' ? [128, 140] : value === 30 ? [25, 35] : [value, value];
      return { ok: Boolean(matches && index >= expected[0] && index <= expected[1]), first, expected };
    },
  };
}
