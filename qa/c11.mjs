import { setTimeout as wait } from 'node:timers/promises';

export const c11Viewports = [
  { width: 1440, height: 900 },
  { width: 320, height: 568, mobile: true },
  { width: 844, height: 390, mobile: true },
  { width: 390, height: 844, mobile: true, reducedMotion: true },
];

// Chrome이 새 문서를 만들 때 실행한다. 브라우저 쪽 의존성만 사용한다.
export function installC11Probes() {
  const sensors = [
    'DeviceOrientationEvent', 'DeviceMotionEvent', 'AbsoluteOrientationSensor',
    'RelativeOrientationSensor', 'Accelerometer', 'LinearAccelerationSensor', 'GravitySensor', 'Gyroscope',
  ];
  for (const name of sensors) {
    Reflect.deleteProperty(window, name);
    if (window[name] !== undefined) Object.defineProperty(window, name, { configurable: true, value: undefined });
  }

  const climax = '[data-scene="s4"]';
  const existingSelectors = {
    stage: `${climax} [data-flip-layer]:not([data-building-mirror])`,
    flip: `${climax} [data-action="flip"]`,
    'reset-flip': `${climax} [data-action="reset-flip"]`,
    pause: '#motion-pause',
    'after-layer': `${climax} [data-building-mirror]`,
  };
  function select(role) {
    const liveOnly = role === 'stage' || role === 'before-layer' ? ':not([data-building-mirror])' : '';
    return document.querySelector(`[data-qa-c11="${role}"]${liveOnly}`)
      ?? (existingSelectors[role] ? document.querySelector(existingSelectors[role]) : null);
  }
  const requireElement = (role) => {
    const element = select(role);
    if (!element) throw new Error(`C11 연결 요소 누락 · ${role}`);
    return element;
  };

  function rotation(element) {
    let angle = 0;
    let mirrored = false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.transform !== 'none') {
        const matrix = new DOMMatrixReadOnly(style.transform);
        angle += Math.atan2(matrix.m12, matrix.m11) * 180 / Math.PI;
        if (matrix.m11 * matrix.m22 - matrix.m12 * matrix.m21 < 0) mirrored = !mirrored;
      }
      // getComputedStyle의 독립 rotate 속성은 각도를 deg로 반환한다.
      const independent = style.rotate?.match(/(?:^|\s)(-?[\d.]+)deg$/);
      if (independent) angle += Number(independent[1]);
      if (style.scale && style.scale !== 'none') {
        const [x, y = x] = style.scale.split(' ').map(Number);
        if (x * y < 0) mirrored = !mirrored;
      }
    }
    return { angle, mirrored };
  }

  function readNumber(element, key) {
    const raw = element.dataset[key];
    if (raw === undefined) return null;
    const value = raw?.trim() ? Number(raw) : NaN;
    if (!Number.isFinite(value)) throw new Error(`C11 엔진 관측값 누락 또는 잘못된 값 · ${key}`);
    return value;
  }

  function snapshot() {
    const stage = requireElement('stage');
    const toggle = requireElement('pause');
    const pressed = toggle.dataset.pressed;
    const checkbox = toggle.matches('input[type=checkbox]');
    const paused = checkbox ? toggle.checked : pressed === 'true';
    if (!checkbox && !['true', 'false'].includes(pressed)) {
      throw new Error('C11 일시정지 버튼에 data-pressed 상태가 필요합니다.');
    }
    return {
      ...rotation(stage), paused,
      pauseControl: {
        pressed: pressed ?? null,
        ariaPressedPresent: toggle.hasAttribute('aria-pressed'),
        label: toggle.querySelector('[data-pause-label]')?.textContent.trim() ?? null,
        checkLabel: toggle.id === 'motion-pause',
      },
      gravity: { x: readNumber(stage, 'gravityX'), y: readNumber(stage, 'gravityY') },
      motionTick: readNumber(stage, 'motionTick'),
      phase: stage.dataset.climaxPhase ?? null,
      sensorFree: sensors.every((name) => window[name] === undefined),
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  }

  let trace = [];
  let animationFrame;
  function visualSample() {
    const opacity = (role) => {
      const layer = select(role) ?? (role === 'before-layer' ? requireElement('stage') : null);
      if (!layer) return 0;
      const style = getComputedStyle(layer);
      return style.visibility === 'hidden' || !layer.getClientRects().length ? 0 : Number(style.opacity);
    };
    return { ...rotation(requireElement('stage')), oldOpacity: opacity('before-layer'), newOpacity: opacity('after-layer') };
  }

  function traceFrame() {
    trace.push(visualSample());
    animationFrame = requestAnimationFrame(traceFrame);
  }

  function renderAudit(pageHref, voteHref) {
    const page = new URL(pageHref);
    const mount = new URL('./', page).pathname;
    const pages = [mount, `${mount}index.html`].map(decodeURIComponent);
    const vote = new URL(voteHref).href;
    const linkErrors = [];
    let voteCount = 0;
    let phoneCount = 0;
    const selectors = 'a, area, form[action], button[formaction], input[formaction]';
    for (const element of document.querySelectorAll(selectors)) {
      const anchor = element.matches('a, area');
      if (element.getAttribute('method')?.toLowerCase() === 'dialog'
        || element.getAttribute('formmethod')?.toLowerCase() === 'dialog') continue;
      const value = anchor ? element.getAttribute('href') ?? element.getAttribute('xlink:href')
        : element.getAttribute('formaction') ?? element.getAttribute('action');
      if (value === null) continue;
      let url, path, fragment;
      try {
        url = new URL(value, element.baseURI);
        path = decodeURIComponent(url.pathname);
        fragment = decodeURIComponent(url.hash.slice(1).split(':~:', 1)[0]);
      } catch {
        linkErrors.push('주소를 해석할 수 없는 링크 또는 폼');
        continue;
      }
      const download = anchor && element.hasAttribute('download');
      if (element.localName === 'a' && !download && url.href === 'tel:16612642') {
        phoneCount += 1;
        continue;
      }
      if (url.origin === page.origin && path.endsWith('/404.html')) {
        linkErrors.push('404.html로 향하는 링크가 있습니다.');
        continue;
      }
      if (download && (url.origin === page.origin || ['blob:', 'data:'].includes(url.protocol))) continue;
      if (url.origin !== page.origin || url.username) {
        if (anchor && !download && url.href === vote) voteCount += 1;
        else linkErrors.push(`허용 목록 밖의 <${element.localName}> 이동 · ${url.origin}${url.pathname}`);
      } else if (!pages.includes(path) || url.search !== page.search) {
        linkErrors.push(`다른 내부 주소로 이동 · ${url.pathname}`);
      } else if (anchor && fragment && fragment.toLowerCase() !== 'top'
        && !document.getElementById(fragment) && ![...document.anchors].some((item) => item.name === fragment)) {
        linkErrors.push(`앵커 대상 없음 · ${fragment}`);
      }
    }
    if (voteCount > 1) linkErrors.push(`외부 투표 링크 ${voteCount}개`);
    if (phoneCount > 1) linkErrors.push(`이웃사이센터 전화 링크 ${phoneCount}개`);

    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')]
      .filter((heading) => heading.getClientRects().length && heading.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false);
    const breaks = headings.flatMap(findWordBreaks);
    const stage = select('stage')?.getBoundingClientRect();
    return {
      voteCount, phoneCount, linkErrors, headingCount: headings.length, wordBreaks: breaks,
      layoutWidth: document.documentElement.clientWidth, scrollWidth: document.scrollingElement.scrollWidth,
      stageInView: Boolean(stage?.width && stage.height && stage.bottom > 0 && stage.top < innerHeight
        && stage.right > 0 && stage.left < innerWidth),
    };
  }

  function findWordBreaks(heading) {
    const runs = [];
    let text = '';
    function collect(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const start = text.length;
        text += node.data;
        if (node.data) runs.push({ node, start, end: text.length });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
      if (node.localName === 'br') text += ' ';
      else {
        const block = node !== heading && /^(block|flex|grid|flow-root|list-item)$/.test(style.display);
        if (block) text += ' ';
        node.childNodes.forEach(collect);
        if (block) text += ' ';
      }
    }
    collect(heading);

    const style = getComputedStyle(heading);
    const vertical = /^(vertical|sideways)-/.test(style.writingMode);
    const radians = rotation(heading).angle * Math.PI / 180;
    const axisX = vertical ? Math.cos(radians) : -Math.sin(radians);
    const axisY = vertical ? Math.sin(radians) : Math.cos(radians);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    const range = document.createRange();
    const segmenter = new Intl.Segmenter(document.documentElement.lang || 'ko', { granularity: 'grapheme' });
    const problems = [];

    for (const match of text.matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
      let previous;
      for (const { segment, index } of segmenter.segment(match[0])) {
        const start = match.index + index;
        const end = start + segment.length;
        const head = runs.find((run) => run.start <= start && run.end > start);
        const tail = runs.find((run) => run.start < end && run.end >= end);
        range.setStart(head.node, start - head.start);
        range.setEnd(tail.node, end - tail.start);
        const rect = [...range.getClientRects()].find(({ width, height }) => width && height);
        if (!rect) continue;
        const center = (rect.x + rect.width / 2) * axisX + (rect.y + rect.height / 2) * axisY;
        if (previous !== undefined && Math.abs(center - previous) > Math.max(3, lineHeight * 0.65)) {
          problems.push({
            heading: heading.id || heading.localName, word: match[0],
            split: `${match[0].slice(0, index)}/${match[0].slice(index)}`,
            wordBreak: style.wordBreak, overflowWrap: style.overflowWrap,
          });
          break;
        }
        previous = center;
      }
    }
    return problems;
  }

  window.__landingthonC11Qa = {
    snapshot, renderAudit, visualSample,
    startTrace() {
      trace = [];
      traceFrame();
    },
    stopTrace() {
      cancelAnimationFrame(animationFrame);
      return trace;
    },
    enterClimax() {
      const flip = requireElement('flip');
      const section = flip.closest(climax);
      const panel = section?.querySelector('[data-motion-sticky]');
      if (!panel) {
        flip.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        return;
      }
      const bounds = section.getBoundingClientRect();
      const panelHeight = panel.getBoundingClientRect().height;
      const travel = Math.max(0, bounds.height - panelHeight);
      const map = window.LandingBuilding?.createClimaxScrollMap?.({ travel, panelHeight, viewportHeight: innerHeight });
      // v2의 0.15~0.25는 정방향에서 반전 버튼을 누르는 구간이다.
      window.scrollTo({ top: scrollY + bounds.top + (map?.offsetAt(0.2) ?? travel * 0.2), behavior: 'instant' });
    },
    point(role) {
      const element = role === 'reset-flip' ? select(role) ?? requireElement('flip') : requireElement(role);
      function hitPoint() {
        const rect = element.getBoundingClientRect();
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        return element.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
      }
      const visible = hitPoint();
      if (visible) return visible;
      if (role === 'pause') {
        element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        const scrolled = hitPoint();
        if (scrolled) return scrolled;
      }
      throw new Error(`C11 조작부가 가려졌습니다 · ${role}`);
    },
  };
}

const nearAngle = (a, b, target) => Math.abs(Math.abs(((b - a + 180) % 360 + 360) % 360 - 180) - target) <= 2;
const hasGravity = ({ x, y }) => Number.isFinite(x) && Number.isFinite(y);
const oppositeGravity = (before, after) => hasGravity(before) && hasGravity(after) && before.y > 0 && after.y < 0
  && (before.x * after.x + before.y * after.y) / (Math.hypot(before.x, before.y) * Math.hypot(after.x, after.y)) <= -0.95;
const fadeSettled = (frame, initialAngle) => frame.newOpacity >= 0.95 && frame.oldOpacity <= 0.05
  || (nearAngle(initialAngle, frame.angle, 180) && frame.oldOpacity >= 0.95 && frame.newOpacity <= 0.05);

export function checkCrossfade(trace, initialAngle) {
  const first = trace[0];
  const last = trace.at(-1);
  const partial = (opacity) => opacity > 0.05 && opacity < 0.95;
  return {
    frameCount: trace.length,
    noAnimatedRotation: trace.length > 0 && trace.every((frame) => !frame.mirrored
      && (nearAngle(initialAngle, frame.angle, 0) || nearAngle(initialAngle, frame.angle, 180))),
    overlapped: trace.some((frame) => partial(frame.oldOpacity) && partial(frame.newOpacity)),
    endpoints: Boolean(first && last && first.oldOpacity >= 0.95 && first.newOpacity <= 0.05
      && fadeSettled(last, initialAngle)),
  };
}

export async function inspectC11({ view, page, voteUrl, send, evaluate, capture, errors, evidence }) {
  const call = (method, ...args) => evaluate(`window.__landingthonC11Qa.${method}(${args.map((arg) => JSON.stringify(arg)).join(', ')})`);
  async function until(read, accept, error, consecutive = 1) {
    const deadline = performance.now() + 5000;
    let matching = 0;
    do {
      const state = await read();
      matching = accept(state) ? matching + 1 : 0;
      if (matching >= consecutive) return state;
      await wait(40);
    } while (performance.now() < deadline);
    throw new Error(error);
  }
  async function snapshot() {
    const state = await call('snapshot');
    const { ariaPressedPresent, checkLabel, label } = state.pauseControl;
    if (ariaPressedPresent) errors.add('C11 움직임 토글에 aria-pressed가 있습니다.');
    if (checkLabel && label !== (state.paused ? '움직임 다시 켜기' : '움직임 일시정지')) {
      errors.add('C11 움직임 토글의 동작 라벨이 data-pressed와 일치하지 않습니다.');
    }
    return state;
  }

  async function click(role, restoreScroll = false) {
    const yBefore = restoreScroll ? await evaluate('scrollY') : 0;
    const { x, y } = await call('point', role);
    if (view.mobile) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    }
    if (restoreScroll) await evaluate(`window.scrollTo({top:${yBefore},behavior:'instant'})`);
  }

  async function audit(label) {
    const result = await call('renderAudit', page.href, voteUrl);
    evidence[label] = result;
    if (result.scrollWidth > result.layoutWidth + 1 || result.layoutWidth > view.width + 1) {
      errors.add(`C11 가로 넘침/뷰포트 불일치 · ${label} (${result.scrollWidth}/${result.layoutWidth}px)`);
    }
    if (!result.headingCount) errors.add(`C11 읽을 수 있는 제목이 없습니다 · ${label}`);
    if (label !== 'entry' && !result.stageInView) errors.add(`C11 절정 장면이 화면 밖입니다 · ${label}`);
    for (const { heading, split, wordBreak, overflowWrap } of result.wordBreaks) {
      errors.add(`C11 keep-all 위반 · ${label} · ${heading} · ${split} (${wordBreak}, ${overflowWrap})`);
    }
    for (const error of result.linkErrors) errors.add(`C11 한 장 위반 · ${label} · ${error}`);
  }

  await evaluate('document.fonts.ready.then(() => true)');
  await audit('entry');
  await call('enterClimax');
  let before;
  try {
    before = await until(snapshot,
      (state) => (state.phase == null || state.phase === 'ready') && !state.mirrored
        && nearAngle(0, state.angle, 0) && (!hasGravity(state.gravity) || state.gravity.y > 0),
      'C11 S4 반전 준비 구간에서 정방향에 안정되지 않음', 3);
  } catch (error) {
    errors.add(error.message);
    before = await snapshot();
    evidence.before = before;
    return;
  }
  evidence.before = before;
  if (!before.sensorFree || before.reducedMotion !== Boolean(view.reducedMotion)) throw new Error('C11 에뮬레이션 불일치');
  if (!hasGravity(before.gravity)) errors.add('C11 엔진 중력 관측값 미연결');
  if (before.mirrored || !nearAngle(0, before.angle, 0) || (hasGravity(before.gravity) && before.gravity.y <= 0)) {
    errors.add('C11 반전 전 정방향 확인 실패');
  }
  if (before.paused) throw new Error('C11 초기 상태의 움직임을 시작할 수 없습니다.');
  await audit('upright');
  await capture('c11-before');

  if (!view.reducedMotion && before.motionTick !== null) {
    try {
      const running = await until(snapshot,
        (state) => state.motionTick > before.motionTick, 'C11 정방향에서 엔진 진행 없음');
      evidence.pause = { running: running.motionTick };
      await click('pause', true);
      const paused = await until(snapshot, (state) => state.paused, 'C11 일시정지 토글이 켜지지 않음');
      evidence.pause.pausedControl = paused.pauseControl;
      await wait(250);
      const held = await snapshot();
      evidence.pause.frozen = [paused.motionTick, held.motionTick];
      if (!held.paused || held.motionTick !== paused.motionTick) errors.add('C11 일시정지 상태에서 엔진이 진행됨');
      await click('pause', true);
      const resumed = await until(snapshot, (state) => !state.paused && state.motionTick > held.motionTick,
        'C11 재개 뒤 엔진 진행 없음');
      evidence.pause.resumed = resumed.motionTick;
      evidence.pause.resumedControl = resumed.pauseControl;
    } catch (error) {
      errors.add(error.message);
    }
  }

  if (view.reducedMotion) await call('startTrace');
  await click('flip');
  let after;
  try {
    after = await until(snapshot,
      (state) => !state.mirrored && (!hasGravity(before.gravity) || oppositeGravity(before.gravity, state.gravity))
        && (state.phase == null || state.phase === 'listen')
        && (nearAngle(before.angle, state.angle, 180) || (view.reducedMotion && nearAngle(before.angle, state.angle, 0))),
      'C11 중력 반전 또는 페이지 자세가 안정 상태에 도달하지 않음', 3);
    if (view.reducedMotion) {
      await until(() => call('visualSample'), (frame) => fadeSettled(frame, before.angle),
        'C11 크로스페이드 종료 상태 확인 실패', 3);
      after = await snapshot();
    }
  } catch (error) {
    errors.add(error.message);
    after = await snapshot();
  }

  evidence.after = after;
  if (view.reducedMotion) {
    const trace = await call('stopTrace');
    evidence.crossfade = checkCrossfade(trace, before.angle);
    evidence.transitionFrames = trace;
    const { noAnimatedRotation, overlapped, endpoints } = evidence.crossfade;
    if (!noAnimatedRotation || !overlapped || !endpoints) errors.add('C11 움직임 줄이기에서 회전 없는 교차 페이드가 재현되지 않음');
    if (after.motionTick !== null) {
      // 교차 페이드 뒤 E5 의자 재생이 정지 프레임을 한 번 갱신할 수 있다.
      let firstStillFrame = after, since = performance.now();
      try {
        const still = await until(snapshot, (state) => {
          const stable = state.motionTick === firstStillFrame.motionTick;
          if (!stable) {
            firstStillFrame = state;
            since = performance.now();
          }
          return state.phase === 'listen' && stable && performance.now() - since >= 750;
        }, 'C11 움직임 줄이기에서 E5 뒤 정지 프레임에 도달하지 않음');
        evidence.stillFrame = [firstStillFrame.motionTick, still.motionTick];
        evidence.after = still;
      } catch (error) {
        errors.add(error.message);
      }
    }
  }
  await audit('inverted');
  await capture('c11-after');

  if (!view.reducedMotion && before.motionTick === null) {
    await click('reset-flip');
    const moving = await until(snapshot, (state) => !nearAngle(before.angle, state.angle, 0)
      && !nearAngle(before.angle, state.angle, 180), 'C11 일시정지 대상인 회전 진행을 관측하지 못함');
    await click('pause', true);
    const paused = await until(snapshot, (state) => state.paused, 'C11 일시정지 토글이 켜지지 않음');
    await wait(250);
    const held = await snapshot();
    evidence.pause = { movingAngle: moving.angle, frozenAngles: [paused.angle, held.angle], pausedControl: paused.pauseControl };
    if (!held.paused || !nearAngle(paused.angle, held.angle, 0)) errors.add('C11 일시정지 뒤 회전이 계속됨');
    await click('pause', true);
    const unpaused = await until(snapshot, (state) => !state.paused, 'C11 일시정지 토글이 꺼지지 않음');
    evidence.pause.resumedControl = unpaused.pauseControl;
    await click('flip');
    const resumed = await until(snapshot, (state) => nearAngle(before.angle, state.angle, 180),
      'C11 일시정지 해제 뒤 반전에서 회전이 다시 작동하지 않음');
    evidence.pause.resumedAngle = resumed.angle;
  }
}
