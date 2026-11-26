import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { findChrome, openChrome } from './browser.mjs';
import { openRecordingPage, verifySegment } from './record.mjs';
import { normalizeVerification } from './verify-scenes.mjs';
import { v10kCopy } from './v10k-copy.mjs';

const desktop = { width: 1440, height: 900, scale: 1 };
const page = new URL('https://qa.invalid/');
const action = (scene, name, tag = 'button') => `#s${scene} ${tag}[data-action="${name}"]`;
const matLink = '#s6 [data-recap="mat"] a[data-action="cushion-revisit"]';
const tidy = (text) => text.trim().replace(/\s+/g, ' ');

function installObservations() {
  const describe = (node) => node && {
    tag: node.localName, id: node.id, action: node.dataset.action ?? null,
    scene: node.closest('[data-scene]')?.dataset.scene ?? null,
    text: (node.innerText || node.textContent).trim().replace(/\s+/g, ' '),
  };

  function focus(selector) {
    const node = document.activeElement;
    const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
    const styles = getComputedStyle(node);
    const x = (left + right) / 2;
    const y = (top + bottom) / 2;
    const hit = document.elementFromPoint(x, y);
    return { ...describe(node), scrollY, matches: node.matches(selector),
      visible: width > 0 && height > 0 && node.checkVisibility({ visibilityProperty: true, opacityProperty: true }),
      hiddenFromAX: Boolean(node.closest('[aria-hidden="true"],[inert]')),
      disabled: node.matches(':disabled,[aria-disabled="true"]'),
      tabindex: node.tabIndex, focusVisible: node.matches(':focus-visible'),
      outline: [styles.outlineStyle, styles.outlineWidth, styles.outlineColor],
      indicator: styles.outlineStyle !== 'none' && Number.parseFloat(styles.outlineWidth) > 0 || styles.boxShadow !== 'none',
      box: [left, top, right, bottom], centerHit: Boolean(hit && node.contains(hit)),
      obscuredBy: node.contains(hit) ? null : describe(hit),
      fits: left >= -1 && right <= innerWidth + 1 && top >= -1 && bottom <= innerHeight + 1,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }

  const events = [];
  const last = new WeakMap();
  function changes(initial = false) {
    for (const node of document.querySelectorAll('[aria-live],[role="status"],[role="alert"],output')) {
      const politeness = node.getAttribute('aria-live') ?? (node.getAttribute('role') === 'alert' ? 'assertive' : 'polite');
      const text = node.textContent.trim().replace(/\s+/g, ' ');
      const current = politeness !== 'off' && text && !node.closest('[aria-hidden="true"],[hidden],[inert]')
        && node.checkVisibility({ visibilityProperty: true, opacityProperty: true }) ? text : '';
      if (last.get(node) !== current && current && !initial) {
        events.push({ ...describe(node), text: current, politeness, fx: node.dataset.fx ?? null,
          floor: node.hasAttribute('data-floor-live'), at: Math.round(performance.now()) });
      }
      last.set(node, current);
    }
  }
  changes(true);
  new MutationObserver(() => changes()).observe(document.body, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['aria-live', 'aria-hidden', 'hidden', 'role', 'inert'],
  });
  window.__ltA11y = { focus, events };
}

function axReadingOrder(nodes) {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const ordered = [];
  const visited = new Set();
  function visit(node) {
    if (!node || visited.has(node.nodeId)) return;
    visited.add(node.nodeId);
    const role = node.role?.value;
    if (!node.ignored && role !== 'InlineTextBox') ordered.push(node);
    for (const child of node.childIds ?? []) visit(byId.get(child));
  }
  const childIds = new Set(nodes.flatMap((node) => node.childIds ?? []));
  for (const node of nodes.filter(({ nodeId }) => !childIds.has(nodeId))) visit(node);
  return ordered;
}

function descendants(node) {
  return [node.backendNodeId, ...(node.children ?? []).flatMap(descendants)];
}

const headings = Array.from({ length: 8 }, (_, i) => [`#s${i}-title`, 'heading']);

async function inspectAX(tab, mode, evidence, file, f2 = false) {
  await tab.send('Accessibility.enable');
  const { nodes } = await tab.send('Accessibility.getFullAXTree');
  const rows = axReadingOrder(nodes);
  await file(`ax-${mode}.json`, nodes);
  const { root } = await tab.send('DOM.getDocument', { depth: 0 });
  const { nodeId: listenCell } = await tab.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#s6 [data-recap="listen"]' });
  const f3 = Boolean(listenCell);
  const ruler = '#s6 figure.ruler';
  const { nodeId: rulerNode } = await tab.send('DOM.querySelector', { nodeId: root.nodeId, selector: ruler });
  const { nodeId: sideRuler } = await tab.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#s6 .side figure.ruler' });
  const bridge = `${ruler} .ruler-note + p`;
  const { nodeId: bridgeNode } = await tab.send('DOM.querySelector', { nodeId: root.nodeId, selector: bridge });
  const { nodeId: firstDefinition } = await tab.send('DOM.querySelector', {
    nodeId: root.nodeId, selector: '#s0 [data-cue="s0-band"] .br-def',
  });
  const definition = firstDefinition ? v10kCopy.definition : rulerNode
    ? '쿵 지수는 방 절반 높이에서 떨어진 공을 100으로 둔 상대값입니다. 실제 소음(dB)이 아니고, 200이 100의 두 배로 시끄럽다는 뜻도 아닙니다.'
    : /방 절반 높이.+100.+상대값.+실제 소음\(dB\)이 아닙니다/;
  const definitionInRuler = Boolean(sideRuler && firstDefinition);
  const scale = [
    ['200', '천장 가까이에서 떨어진 공'], ['140', '의자 끌기(드르륵)*'], ['114', '매트 위 · 천장 가까이'],
    ['100', '방 절반 높이에서 떨어진 공 · 기준'], ['56', '매트 위 · 방 절반 높이'], ['43', '바닥 톡'],
  ];
  const rulerOrder = rulerNode ? [
    [ruler, 'figure', /^쿵 지수 견주기$/],
    ['#ruler-title', 'StaticText', '쿵 지수 견주기'],
    ...(definitionInRuler ? [[`${ruler} > .recap-def`, 'StaticText', definition]] : []),
    [`${ruler} .ruler-list`, 'list'],
    ...scale.flatMap(([value, label], index) => {
      const row = `${ruler} .ruler-list > li:nth-child(${index + 1})`;
      return [[`${row} .rl-v`, 'StaticText', value], [`${row} .rl-t`, 'StaticText', label]];
    }),
    ...(mode === 'done' ? [
      [`${ruler} [data-ruler-mine-label]`, 'StaticText', /^내 최대 (쿵|드르륵)$/],
      [`${ruler} [data-ruler-mine-value]`, 'StaticText', /^[1-9]\d*$/],
    ] : []),
    [`${ruler} .ruler-note`, 'StaticText', '* 드르륵은 의자가 움직인 거리와 힘으로 따로 계산합니다.'],
    ...(bridgeNode ? [
      [bridge, 'StaticText', /쿵 지수|한국소비자원이 실제 소리로/],
      [`${bridge} > span`, 'StaticText', /한국소비자원.+어린이 매트 시험/],
    ] : []),
  ] : [];
  const recapKeys = ['kung', f3 ? 'listen' : 'relay', 'mat'];
  const summaries = mode === 'empty'
    ? [/7층 바닥.+6층 천장/, f3 ? /6층 바닥.+7층 천장/ : /6층 바닥.+5층 천장/, /아직 매트로 재 보지 않았어요/]
    : [/(?:쿵|드르륵) #\d+.+6층 천장/, f3 ? /6층 의자.+7층 천장/ : /6층 의자.+5층 천장/, /같은 높이에서 맨바닥 쿵 \d+.+매트 위 쿵 \d+/];
  const activeRecap = recapKeys.flatMap((id, i) => {
    const row = `#s6 [data-recap="${id}"]`;
    return [[`${row} .rc-t`, 'StaticText', id === 'listen' ? /^그리고 나도, 누군가의 아래층$/ : undefined],
      ...(id === 'mat' && mode === 'empty' ? [[matLink, 'link', /매트 깔아 보기/]] : []),
      [`${row} [data-recap-sr]`, 'StaticText', summaries[i]]];
  });
  const skipFlip = '#s6 [data-flip-missed] a[data-action="flip-revisit"]';
  const flipMissed = f3 && mode === 'empty' ? [
    ['#s6 [data-flip-missed] span', 'StaticText', /아직 뒤집어 보지 않았어요/],
    [skipFlip, 'link', /^중력 뒤집기 보기$/],
  ] : [];
  const card = [
    ['#s6-title', 'heading'], ['#s6 [data-result-canvas]', 'article'],
    ['#s6 [data-result-peak]', 'StaticText', mode === 'empty' ? /^0$/ : /^[1-9][0-9,]*$/],
    ...(mode === 'done' ? [['#s6 [data-result-mat-before]', 'StaticText', /^\d+$/],
      ['#s6 [data-result-mat-after]', 'StaticText', /^\d+$/]] : []),
    ['#s6 [data-result-detail]', 'StaticText', mode === 'empty' ? /쿵 0번/ : /쿵 [1-9][0-9,]*번/],
    ...(mode === 'empty' ? [['#s6 [data-result-empty] p', 'StaticText', /아직 쿵 0번/],
      [action(6, 'intro-revisit', 'a'), 'link', f2 ? /^집으로$/ : /^7층으로$/]] : []),
    ...(f3 ? [[action(6, 'save'), 'button', /^카드 저장 PNG 1장$/],
      [action(6, 'share'), 'button', /^공유하기$/],
      ['#s6 .disclaim', 'StaticText', /실제 생활을 판정하지 않아요/]] : []),
    ...(sideRuler ? [...flipMissed, ...rulerOrder] : []),
    ['#recap-title', 'heading'],
    ...(f3 && !definitionInRuler ? [['#s6 .recap-def', 'StaticText', definition]] : []),
    ...(sideRuler ? [] : rulerOrder), ...activeRecap, ['#next-title', 'heading'],
    ['#s6 .next-cell:first-child .nk', 'StaticText', /위층이라면/],
    ['#s6 .next-cell:first-child .nk + p', 'StaticText', /매트/],
    ...(f3 ? [['#s6 .next-cell:first-child summary', 'DisclosureTriangle', /^매트 깔 자리$/, false]] : []),
    ['#s6 .next-cell:last-child .nk', 'StaticText', /아래층이라면/],
    ...(f3 ? [['#s6 .next-cell:last-child .nk + p', 'StaticText', /층간소음 이웃사이센터 전화 상담부터/]] : []),
    ['#s6 .next-cell:last-child a[href="tel:16612642"]', 'link', /1661-2642/],
    ...(f3 ? [
      ['#s6 .next-cell:last-child summary', 'DisclosureTriangle', /^쪽지 한 장, 그다음 도움$/, false],
      ...(!sideRuler ? flipMissed : []),
      ['#s6 .vote > p:first-child', 'StaticText', /랜딩톤.*출품작/],
      ['#vote-link', 'link', /^갤러리에서 투표하기 \(외부 사이트, 새 탭\)$/],
      ['#s6 .vote-note', 'StaticText', /로그인한 누구나 작품마다 한 표씩 줄 수 있어요/],
    ] : []),
  ];
  async function locate([selector, role, pattern, expanded]) {
    const { nodeId } = await tab.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) return { selector, matches: [] };
    const { node } = await tab.send('DOM.describeNode', { nodeId, depth: -1 });
    const ids = new Set(role === 'StaticText' ? descendants(node) : [node.backendNodeId]);
    const matches = rows.flatMap(({ backendDOMNodeId, role: actualRole, name, properties }, index) =>
      ids.has(backendDOMNodeId) && actualRole?.value === role
        && (expanded === undefined || properties?.some((property) => property.name === 'expanded' && property.value.value === expanded))
        ? [{ index, name: name?.value, properties }] : []);
    if (typeof pattern === 'string') {
      // Chrome은 인라인 요소를 경계로 한 문장의 낭독 텍스트를 여러 노드로 나눈다.
      const name = tidy(matches.map((match) => match.name).join(''));
      return { selector, matches: matches.length && name === pattern
        ? [{ index: matches[0].index, endIndex: matches.at(-1).index, name }] : [] };
    }
    return { selector, matches: matches.filter(({ name }) => !pattern || pattern.test(tidy(name ?? ''))) };
  }
  async function ordered(label, entries) {
    const items = await Promise.all(entries.map(locate));
    let previous = -1;
    const problems = [];
    for (const { selector, matches } of items) {
      const found = matches.find(({ index }) => index > previous);
      if (!found) problems.push(selector);
      else previous = found.endIndex ?? found.index;
    }
    evidence(label, problems.length === 0, { items, problems });
  }
  if (mode === 'empty') {
    await ordered('건너뛰기·토글·본문·제목 순서', [
      ['.skip', 'link', /본문으로 건너뛰기/], ['#sound-toggle', 'button', /^소리 켜기$/],
      ['#motion-pause', 'button', /^움직임 일시정지$/], ['#main', 'main'], ...headings,
    ]);
  }
  await ordered(`S6 ${mode} 낭독 순서`, card);
  const visualValues = recapKeys.flatMap((key) =>
    ['from', 'to'].map((side) => [`[data-recap="${key}"] [data-recap-${side}]`, 'StaticText']));
  if (f3) visualValues.push(['#s6 [data-recap-reduction]', 'StaticText']);
  if (rulerNode && mode === 'empty') visualValues.push([`${ruler} [data-ruler-mine]`, 'StaticText']);
  const duplicates = (await Promise.all(visualValues.map(locate)))
    .filter(({ matches }) => matches.length);
  const hiddenLinks = mode === 'done'
    ? (await Promise.all([matLink, action(6, 'intro-revisit', 'a'), ...(f3 ? [skipFlip] : [])]
      .map((selector) => locate([selector, 'link']))))
      .filter(({ matches }) => matches.length)
    : [];
  evidence('요약 시각용 중복과 완료 뒤 빈 상태 링크', !duplicates.length && !hiddenLinks.length, { duplicates, hiddenLinks });
}

async function press(tab, key, shift = false) {
  const keys = { Tab: 9, Enter: 13, ' ': 32 };
  const params = { key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: keys[key], modifiers: shift ? 8 : 0 };
  const text = key === 'Enter' ? '\r' : key === ' ' ? ' ' : '';
  await tab.send('Input.dispatchKeyEvent', { ...params, type: text ? 'keyDown' : 'rawKeyDown', ...(text ? { text } : {}) });
  await tab.send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' });
}

async function poll(read, accept, ms = 4500) {
  const deadline = performance.now() + ms;
  let last;
  do {
    last = await read();
    if (accept(last)) return { ok: true, observed: last };
    await wait(40);
  } while (performance.now() < deadline);
  return { ok: false, observed: last };
}

async function keyboard(tab, result, file, snapshot, view, output, f2) {
  const { evidence, focusPath } = result;
  await tab.evaluate(`(${installObservations.toString()})()`);
  const focus = (selector = '*') => tab.evaluate(`window.__ltA11y.focus(${JSON.stringify(selector)})`);
  const liveEvents = () => tab.evaluate('window.__ltA11y.events');
  const text = (selector) => `document.querySelector(${JSON.stringify(selector)})?.textContent.trim()`;
  const selected = (selector) => `document.querySelector(${JSON.stringify(selector)})`;
  async function verify(label, expression, predicate = Boolean) {
    const { ok, observed } = await poll(() => tab.evaluate(expression), predicate);
    evidence(label, ok, observed);
    if (!ok) throw new Error(label);
    return observed;
  }
  async function tabOnce(selector = '*', reverse = false) {
    await press(tab, 'Tab', reverse);
    const entry = await focus(selector);
    focusPath.push({ key: reverse ? 'Shift+Tab' : 'Tab', ...entry });
    if (!f2 || entry.tag !== 'body') evidence('탭 대상 의미', entry.visible && !entry.hiddenFromAX && entry.tabindex === 0, entry);
    return entry;
  }
  async function order(selector, reverse = false) {
    const entry = await tabOnce(selector, reverse);
    evidence(`초점 순서 ${selector}`, entry.matches, entry);
    if (!entry.matches) throw new Error(`초점 순서 · ${selector}`);
  }
  async function tabTo(selector) {
    for (let count = 0; count < 24; count++) {
      if ((await tabOnce(selector)).matches) return;
    }
    throw new Error(`Tab으로 도달하지 못함 · ${selector}`);
  }
  async function focused(selector, label) {
    const { ok, observed } = await poll(() => focus(selector), (entry) =>
      entry.matches && entry.visible && entry.focusVisible && entry.indicator && entry.fits && entry.centerHit && entry.overflow <= 1, 1200);
    evidence(`초점 표시·가림·폭 · ${label}`, ok, observed);
    return observed.matches;
  }
  async function use(selector, label, key = 'Enter') {
    if (!await focused(selector, label)) throw new Error(`초점 이탈 · ${label}`);
    await verify(`조작 가능 · ${label}`, `${selected(selector)}?.matches(':not([aria-disabled="true"], :disabled)')`);
    await press(tab, key);
  }
  function status(label, events, pattern, scene, expectedCount = 1) {
    const matching = events.filter((entry) => (scene === 'floor' ? entry.floor : entry.scene === scene) && pattern.test(entry.text));
    evidence(`라이브 · ${label}`, matching.length === expectedCount && matching.every(({ politeness }) => politeness === 'polite'), matching);
  }
  const records = 'window.LandingArt.records()';
  try {
    await verify('CSS 뷰포트와 미디어', `({ width: innerWidth, height: innerHeight, forced: matchMedia('(forced-colors: active)').matches,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches })`,
    ({ width, height, forced, reduced }) => width === view.width && height === view.height
      && forced === Boolean(view.forcedColors) && reduced === Boolean(view.reducedMotion));
    await order('.skip');
    await focused('.skip', '건너뛰기');
    await snapshot('skip');
    await order('#sound-toggle');
    await order('#motion-pause');
    await use('#motion-pause', '일시정지', ' ');
    await verify('일시정지 라벨', `${text('[data-pause-label]')} === '움직임 다시 켜기'`);
    await use('#motion-pause', '움직임 다시 켜기', ' ');
    await verify('재개 라벨', `${text('[data-pause-label]')} === '움직임 일시정지'`);
    await order('#sound-toggle', true);
    await order('.skip', true);
    await use('.skip', '건너뛰기');
    await verify('건너뛴 뒤 본문 초점', "document.activeElement.id === 'main'");
    const drop = action(0, 'drop');
    await order(drop);
    let from = (await liveEvents()).length;
    await use(drop, '공 떨어뜨리기');
    const dropRecord = await verify('S0 실제 쿵', `${records}.find(({ n, slab }) => n > 0 && slab === '7-6')`);
    let events = (await liveEvents()).slice(from);
    status('첫 쿵 값 한 번', events, new RegExp(`^(?:쿵 #${dropRecord.n}\\s*·\\s*)?${dropRecord.value}${f2
      ? '(?:, 6층 천장에 닿았습니다\\.)?' : ''}$`), 's0');
    if (f2) {
      const first = events.filter(({ scene }) => scene === 's0');
      evidence('첫 쿵의 수신층을 한 문장으로 안내', first.length === 1
        && first[0].text === `쿵 #${dropRecord.n} · ${dropRecord.value}, 6층 천장에 닿았습니다.`, first);
    }
    await snapshot('s0');

    const drag = action(1, 'drag-chair');
    await tabTo(drag);
    from = (await liveEvents()).length;
    await use(drag, '의자 끌기');
    const scrape = await verify('S1 실제 드르륵', `${records}.find(({ label }) => label === '드르륵')`);
    status('의자 끌기 사건과 값', (await liveEvents()).slice(from),
      new RegExp(`^드르륵 #${scrape.n}\\s*·\\s*${scrape.value}$`), 's1');

    const replay = action(2, 'replay');
    await tabTo(replay);
    await use(replay, '다시 듣기');
    const maximum = f2 ? await tab.evaluate(`${records}.filter(({ slab, n }) => slab === '7-6' && n > 0)
      .reduce((peak, record) => !peak || record.value > peak.value ? record : peak, null)`) : dropRecord;
    const replayMatch = new RegExp(`${maximum.label ?? '쿵'} #${maximum.n}\\s*·\\s*${maximum.value}${f2
      ? '(?:, 듣는 자리만 다릅니다\\.)?' : ''}$`);
    const replayEvents = await poll(liveEvents, (entries) => entries.some(({ fx, text }) => fx === 'replay-feedback' && replayMatch.test(text)));
    const matching = replayEvents.observed.filter(({ fx, text }) => fx === 'replay-feedback' && replayMatch.test(text));
    evidence('S2 같은 사건 번호·값의 라이브 재생', replayEvents.ok && matching.every(({ politeness }) => politeness === 'polite'), matching);
    status('6층 도착 한 번', replayEvents.observed, /^6층에 도착했습니다/, 'floor');
    await snapshot('s2');

    const nudge = action(3, 'nudge');
    from = (await liveEvents()).length;
    await tabTo(nudge);
    await use(nudge, '6층 의자 밀기');
    const relay = await verify('S3 6→5 전달', `${records}.find(({ slab, label }) => slab === '6-5' && label === '6층 의자')`);
    events = (await liveEvents()).slice(from);
    status('5층 도착 한 번', events, /^5층에 도착했습니다/, 'floor');
    status('6층 의자 전달 값', events, new RegExp(`\\b${relay.value}$`), 's3');

    const flip = action(4, 'flip'), reset = action(4, 'reset-flip');
    await tabTo(flip);
    from = (await liveEvents()).length;
    await use(flip, '중력 뒤집기');
    await verify('S4 아래층 도달', "document.querySelector('#main').dataset.perspective === 'downstairs'");
    evidence('뒤집은 뒤 복귀 버튼 초점', await focused(reset, '원래대로 돌리기'));
    await snapshot('s4-inverted');
    events = (await liveEvents()).slice(from);
    status('뒤집기 안내 한 번', events, /뒤집혔습니다/, 'floor');
    evidence('S4 같은 문장의 중복 라이브 없음', !events.some(({ scene, text: message }) => scene === 's4' && /뒤집혔습니다/.test(message)), events);
    if (f2) {
      const chair = /^6층 의자 · \d+, 7층 천장에 닿았습니다\.$/;
      const heard = await poll(async () => (await liveEvents()).slice(from), (entries) =>
        entries.some(({ scene, text: message }) => scene === 's4' && chair.test(message)));
      status('S4 듣기 장면의 의자 수치와 수신층', heard.observed, chair, 's4');
      evidence('S4 가구 낙하의 보조 수치 생략', !heard.observed.some(({ scene, text: message }) =>
        scene === 's4' && /쿵\s*지수\s*\d+/.test(message)), heard.observed);
    }
    from = (await liveEvents()).length;
    await use(reset, '원래대로 돌리기');
    await verify('S4 원래 방향 복귀', "document.querySelector('#main').dataset.perspective === 'upstairs'");
    evidence('복귀 뒤 뒤집기 버튼 초점', await focused(flip, '다시 뒤집기'));
    const returning = /원래대로 돌아왔습니다/;
    const restored = f2 ? (await poll(async () => (await liveEvents()).slice(from), (entries) =>
      entries.some(({ floor, text }) => floor && returning.test(text)))).observed : (await liveEvents()).slice(from);
    status('원래대로 안내 한 번', restored, returning, 'floor');

    const bare = action(5, 'mat-before'), lay = action(5, 'mat-lay'), after = action(5, 'mat-after');
    await tabTo(bare);
    from = (await liveEvents()).length;
    await use(bare, '맨바닥에 떨어뜨리기');
    const matState = "document.querySelector('#s5').dataset.matTest";
    await verify('S5 맨바닥 측정', `${matState} === 'before'`);
    const bareReading = await verify('S5 맨바닥 수치', `Number(${text('[data-impact-before]')})`, (value) => value > 0);
    status('맨바닥 수치', (await liveEvents()).slice(from), new RegExp(`\\b${bareReading}\\b`), 's5');
    await order(lay);
    await use(lay, '매트 깔기');
    await verify('S5 매트 설치', `${matState} === 'laid'`);
    await order(after);
    from = (await liveEvents()).length;
    await use(after, '매트 위에 떨어뜨리기');
    await verify('S5 매트 비교 완료', `${matState} === 'done'`);
    const comparison = await tab.evaluate(`[${text('[data-impact-before]')}, ${text('[data-impact-after]')}].map(Number)`);
    evidence('S5 0 < 매트 값 < 맨바닥 값', comparison[1] > 0 && comparison[1] < comparison[0], comparison);
    status('매트 전후 비교', (await liveEvents()).slice(from),
      new RegExp(`\\b${comparison[0]}\\b.*\\b${comparison[1]}\\b`), 's5');
    await snapshot('s5');

    const save = action(6, 'save');
    await tabTo(save);
    await verify('S6 완료 카드', "document.querySelector('#s6').dataset.resultState === 'done'");
    await snapshot('s6');
    if (!view.forcedColors && !view.reducedMotion) {
      await inspectAX(tab, 'done', evidence, file, f2);
      const before = new Set(await readdir(output));
      from = (await liveEvents()).length;
      await use(save, '카드 저장');
      const saved = await poll(() => readdir(output), (files) => files.some((name) => name.endsWith('.png') && !before.has(name)));
      evidence('키보드 카드 PNG 저장', saved.ok, saved.observed.filter((name) => !before.has(name)));
      const saveNotice = /카드 저장을 시작했습니다/;
      const announced = await poll(async () => (await liveEvents()).slice(from), (entries) =>
        entries.some(({ scene, text }) => scene === 's6' && saveNotice.test(text)));
      status('카드 저장 시작', announced.observed, saveNotice, 's6');
    }
    await tabTo('#s6 .next a[href="tel:16612642"]');
    await focused('#s6 .next a[href="tel:16612642"]', '상담 전화 링크');
    await snapshot('s6-next');
    const footerTarget = f2 ? '#s7 [data-action="engine-view"], #s7 details summary' : '#s7 .help a';
    await tabTo(footerTarget);
    await focused(footerTarget, f2 ? 'S7 엔진 또는 글꼴 라이선스' : 'S7 도움말 링크');
    await snapshot('s7');
    evidence('S0~S7 키보드 완주', true);
  } finally {
    await file('live.json', await liveEvents());
  }
}

async function inspectLayout(tab, { evidence }, snapshot, view) {
  const forced = await tab.evaluate("matchMedia('(forced-colors: active)').matches");
  evidence('강제 색상 환경', forced === Boolean(view.forcedColors), { forced });
  for (const [label, scroll, selectors] of [
    ['s0', { scene: 's0', progress: 0 }, ['#s0-title', action(0, 'drop')]],
    ['s2', { scene: 's2', progress: 0.35 }, ['#s2-title', action(2, 'replay')]],
    ['s4', { scene: 's4', progress: 0.18 }, [action(4, 'flip')]],
    ['s5', { scene: 's5', progress: 0.25 }, ['#s5-title', action(5, 'mat-before'), action(5, 'mat-lay'), action(5, 'mat-after')]],
    ['s6-card', '#s6-title', ['#s6-title', '#s6 [data-result-peak]', action(6, 'intro-revisit', 'a')]],
    ['s6-summary', '#s6 .recap', ['#recap-title', matLink]],
    ['s6-next', '#s6 .next', ['#next-title', '#s6 .next a[href="tel:16612642"]']],
    ['s7', '#s7-title', ['#s7-title']],
  ]) {
    await tab.evaluate(typeof scroll === 'string'
      ? `document.querySelector(${JSON.stringify(scroll)}).scrollIntoView({ block:'center', behavior:'instant' })`
      : `window.__landingthonRecording.scroll(${JSON.stringify({ ...scroll, seconds: 0 })})`);
    await tab.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const measured = await tab.evaluate(`(${((selectors) => {
      const width = document.documentElement.clientWidth;
      return { width, overflow: document.documentElement.scrollWidth - width, elements: selectors.map((selector) => {
        const node = document.querySelector(selector);
        const rect = node?.getBoundingClientRect();
        const style = node && getComputedStyle(node);
        return { selector, horizontalFit: Boolean(rect && rect.width && rect.left >= -1 && rect.right <= width + 1
          && node.checkVisibility({ visibilityProperty: true, opacityProperty: true })),
        box: rect?.toJSON(), color: style?.color, background: style?.backgroundColor,
        border: style?.borderTopColor, forcedAdjust: style?.forcedColorAdjust };
      }) };
    }).toString()})(${JSON.stringify(selectors)})`);
    evidence(`문서 폭과 필수 요소 가로 경계 · ${label}`, measured.overflow <= 1
      && measured.elements.every(({ horizontalFit }) => horizontalFit), measured);
    await snapshot(label);
  }
}

async function main(args) {
  if (args.includes('--help')) {
    console.log('QA_OUT=/tmp/lta6 CHROME_BIN=/usr/bin/google-chrome node qa/a11y-v06.mjs [--f2] [BUILD_DIR]');
    return 0;
  }
  const f2 = args.includes('--f2');
  const positional = args.filter((arg) => arg !== '--f2');
  if (positional.length > 1) throw new Error('빌드 디렉터리를 하나 지정하세요.');
  const root = await realpath(positional[0] ?? 'site/dist/');
  if (!(await stat(join(root, 'index.html'))).isFile()) throw new Error('빌드에 index.html이 필요합니다.');
  const base = resolve(process.env.QA_OUT || '/tmp/lta6');
  await mkdir(base, { recursive: true });
  const executable = findChrome();
  const output = await mkdtemp(join(base, 'r4-'));
  const profile = await mkdtemp(join(base, 'c-'));
  const chrome = openChrome(executable, profile);
  const cases = [];
  console.log(`R4 결과 · ${output}`);

  async function scenario(name, view, url, run) {
    const dir = join(output, name);
    await mkdir(dir);
    const result = { name, view, focusPath: [], checks: [] };
    result.evidence = (label, ok, observed) => result.checks.push({ label, ok: Boolean(ok), observed });
    const file = (name, value) => writeFile(join(dir, name), JSON.stringify(value, null, 2) + '\n');
    let tab;
    const snapshot = async (label) => {
      const { data } = await tab.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const name = `${label}.png`;
      await writeFile(join(dir, name), Buffer.from(data, 'base64'));
      return name;
    };
    try {
      tab = await openRecordingPage(chrome, root, url, view, false, { isolated: true });
      await run(tab, result, file, snapshot, dir);
    } catch (error) {
      result.evidence('대본 진행', false, error.message);
      if (tab) await snapshot('stopped').catch(() => {});
    } finally {
      if (tab?.errors.size) result.evidence('콘솔 오류', false, [...tab.errors]);
      await tab?.close().catch((error) => result.evidence('탭 닫기', false, error.message));
    }
    cases.push(result);
    const failed = result.checks.filter(({ ok }) => !ok);
    console.log(`${failed.length ? 'FAIL' : 'PASS'} · ${name}${failed.length ? ` · ${failed.map(({ label }) => label).join(' / ')}` : ''}`);
    await file('result.json', result);
  }

  let browser;
  try {
    browser = await chrome.send('Browser.getVersion');
    await scenario('ax-empty', desktop, new URL('#s6', page), async (tab, result, file, snapshot) => {
      const empty = await poll(() => tab.evaluate("document.querySelector('#s6').dataset.resultState"), (state) => state === 'empty');
      result.evidence('S6 입력 0', empty.ok, empty.observed);
      await inspectAX(tab, 'empty', result.evidence, file, f2);
      await snapshot('s6-empty');
    });
    const zoom = { ...desktop, width: 720, height: 450, reducedMotion: true };
    const forced = { ...desktop, forcedColors: true, reducedMotion: true };
    for (const [name, view] of [['keyboard', desktop], ['zoom-keyboard', zoom], ['forced-keyboard', forced]]) {
      const downloads = join(output, name, 'downloads');
      await scenario(name, view, page, async (tab, result, file, snapshot) => {
        await mkdir(downloads);
        await tab.allowDownloads(downloads);
        await keyboard(tab, result, file, snapshot, view, downloads, f2);
      });
    }
    await scenario('zoom-layout', zoom, page, (tab, result, file, snapshot) => inspectLayout(tab, result, snapshot, zoom));
    await scenario('forced-layout', forced, page, (tab, result, file, snapshot) => inspectLayout(tab, result, snapshot, forced));

    const story = JSON.parse(await readFile(new URL('./verify-v05-story.json', import.meta.url), 'utf8'));
    const mobileCase = normalizeVerification(story).find(({ track }) =>
      track.some(({ kind, value }) => kind === 'expect' && value.state === 'v05-s6-link-stable'));
    if (!mobileCase || mobileCase.view.width !== 390) throw new Error('390px M1 판정이 대본에 없습니다.');
    const stop = mobileCase.track.findIndex(({ kind, value }) => kind === 'expect' && value.state === 'v05-s6-link-stable');
    await scenario('m1-s6-direct', mobileCase.view, page, async (tab, result, file, snapshot) => {
      const trace = await verifySegment({ tab, track: mobileCase.track.slice(0, stop + 1), view: mobileCase.view, capture: snapshot });
      result.evidence('M1 S6 직행 뒤 E2 링크 y', trace.ok, trace);
      if (trace.ok) await snapshot('s6-direct');
    });
  } finally {
    await chrome.close();
    await rm(profile, { recursive: true, force: true });
    await writeFile(join(output, 'report.json'), JSON.stringify({ browser, cases }, null, 2) + '\n');
  }
  const failed = cases.filter(({ checks }) => checks.some(({ ok }) => !ok)).length;
  console.log(`R4 · ${cases.length}장면 · 실패 ${failed}개`);
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
