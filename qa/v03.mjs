import { setTimeout as pause } from 'node:timers/promises';

const mobile = { width: 390, height: 844, mobile: true };
export const v03Cases = [
  { name: 'v03-s1-s5-audio', view: { width: 1440, height: 900 } },
  { name: 'v03-haptics', view: mobile, haptics: true },
  { name: 'v03-haptics-reduced', view: { ...mobile, reducedMotion: true }, haptics: true },
  { name: 'v03-sensor-cutover', view: mobile, permission: 'granted', branch: 'cutover' },
  { name: 'v03-sensor-denied', view: mobile, permission: 'denied', branch: 'denied' },
  { name: 'v03-sensor-no-sample', view: mobile, permission: 'granted', branch: 'no-sample' },
  { name: 'v03-sensor-screen-90', view: mobile, permission: 'granted', branch: 'screen-rotated', angle: 90 },
  { name: 'v03-sensor-screen-180', view: mobile, permission: 'granted', branch: 'screen-rotated', angle: 180 },
  { name: 'v03-sensor-overdue', view: mobile, permission: 'granted', branch: 'overdue' },
];

// 페이지 코드가 실행되기 전에 호출한다. 실제 오디오는 그대로 두고 진동과 권한 응답만 모의한다.
export function installV03Probes({ haptics, permission }) {
  const query = (selector) => document.querySelector(selector);
  const contexts = [];
  const permissionCalls = [];
  const vibrations = [];
  const originalAddListener = window.addEventListener.bind(window);
  const emit = window.dispatchEvent.bind(window);
  const nativeOrientation = window.DeviceOrientationEvent;
  let lampFrame;
  let lampPeak;

  for (const name of ['AudioContext', 'webkitAudioContext']) {
    if (typeof window[name] !== 'function') continue;
    window[name] = new Proxy(window[name], {
      construct(target, args, newTarget) {
        contexts.push({ userActivation: navigator.userActivation?.hasBeenActive ?? null });
        return Reflect.construct(target, args, newTarget);
      },
    });
  }

  function activeScene() {
    let active;
    for (const scene of document.querySelectorAll('section[data-scene]')) {
      const rect = scene.getBoundingClientRect();
      if (rect.height > 0 && rect.top <= innerHeight * 0.64 && rect.bottom > innerHeight * 0.16) active = scene.dataset.scene;
    }
    return active ?? null;
  }

  if (haptics) {
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value(pattern) {
        const scene = activeScene();
        const listening = query('#main')?.hasAttribute('data-listening') ?? false;
        const pulses = Array.isArray(pattern) ? pattern : [pattern];
        const duration = pulses.reduce((total, n) => total + Math.max(0, Number(n)), 0);
        vibrations.push({ scene, listening, pattern, duration, pulse: pulses.some((n, i) => i % 2 === 0 && Number(n) > 0) });
        return true;
      },
    });
  }

  if (permission) {
    const Orientation = nativeOrientation ?? class extends Event {
      constructor(type, { alpha, beta, gamma, absolute }) {
        super(type);
        Object.assign(this, { alpha, beta, gamma, absolute });
      }
    };
    Object.defineProperty(window, 'DeviceOrientationEvent', { configurable: true, value: Orientation });
    Object.defineProperty(Orientation, 'requestPermission', {
      configurable: true,
      value() {
        permissionCalls.push({ active: navigator.userActivation?.isActive ?? null });
        return Promise.resolve(permission);
      },
    });
    // 브라우저가 자동으로 내보내는 초기값 대신 지정한 응답을 검증한다.
    for (const name of ['deviceorientation', 'deviceorientationabsolute']) {
      originalAddListener(name, (event) => {
        if (event.isTrusted) event.stopImmediatePropagation();
      }, true);
    }
  }

  const number = (selector) => {
    const value = query(selector)?.textContent.match(/-?\d+(?:\.\d+)?/)?.[0];
    return value === undefined ? null : Number(value);
  };
  function visible(node) {
    if (!node || node.hidden || node.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) === false) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth
      && rect.bottom > 0 && rect.top < innerHeight;
  }
  function control(selector, labelSelector) {
    const node = query(selector);
    return {
      visible: visible(node),
      pressed: node?.dataset.pressed ?? null,
      ariaPressedPresent: node?.hasAttribute('aria-pressed') ?? false,
      label: node?.querySelector(labelSelector)?.textContent.trim() ?? null,
    };
  }
  function matLampCueVisible() {
    const result = query('#s5');
    if (!result) return false;
    const cue = result.querySelector('[data-cue="s5-05"]');
    if (cue) return visible(cue);
    const walker = document.createTreeWalker(result, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent.includes('6층 조명이 덜 흔들립니다') && visible(node.parentElement)) return true;
    }
    return false;
  }

  window.__landingthonV03 = {
    read() {
      const mat = query('#s5 [data-mat-test], #s5[data-mat-test]');
      const stage = query('#s4 [data-flip-layer]:not([data-building-mirror])');
      const sensor = query('#s4[data-sensor-state], #s4 [data-sensor-state]:not([data-building-mirror])');
      const status = query('#s4 [data-sensor-status]');
      const screenRotationCue = query('#s4 [data-cue="s4-17"]');
      const transform = stage ? getComputedStyle(stage).transform : 'none';
      const matrix = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform);
      const records = (window.LandingArt?.records?.() ?? []).filter(({ slab, n }) => slab === '7-6' && n > 0);
      const haptics = query('button[data-action="haptics"]');
      return {
        contexts: [...contexts], permissionCalls: [...permissionCalls], vibrations: [...vibrations],
        seq: Math.max(0, ...records.map(({ n }) => n)), scene: activeScene(),
        sound: control('#sound-toggle', '[data-sound-label]'),
        motion: control('#motion-pause', '[data-pause-label]'),
        haptics: { visible: visible(haptics), pressed: haptics?.getAttribute('aria-pressed') ?? null },
        recordArt: Boolean(query('#s6 [data-mat-missed], #s6[data-result-state]')),
        summaryArt: Boolean(query('#s6 [data-recap="mat"]')),
        paused: document.documentElement.hasAttribute('data-motion-paused'),
        s1: Boolean(query('#s1[data-scene="s1"] [data-stage="s1"]')),
        gestures: ['drag-chair', 'throw-ball'].filter((name) => query(`#s1 [data-physics-gesture="${name}"]`)),
        s5: Boolean(query('#s5[data-scene="s5"] [data-stage="s5"]')),
        mat: mat?.dataset.matTest ?? null, matVisible: visible(query('#s5 [data-mat]')),
        matResult: visible(query('#s5 [data-mat-result]')),
        matLampCue: matLampCueVisible(),
        before: number('#s5 [data-impact-before]'), after: number('#s5 [data-impact-after]'),
        reduction: number('#s5 [data-impact-reduction]'),
        sensor: sensor?.dataset.sensorState ?? null, status: visible(status) ? status.textContent.trim() : '',
        screenRotationCue: visible(screenRotationCue) ? screenRotationCue.textContent.trim() : '',
        listening: query('#main')?.hasAttribute('data-listening') ?? false,
        angle: Math.atan2(matrix.m12, matrix.m11) * 180 / Math.PI,
        gx: stage?.dataset.gravityX === undefined ? null : Number(stage.dataset.gravityX),
        gy: stage?.dataset.gravityY === undefined ? null : Number(stage.dataset.gravityY),
        phase: stage?.dataset.climaxPhase ?? null,
      };
    },
    replayLayout() {
      const button = query('#s2 button[data-action="replay"]');
      return { top: visible(button) ? button.getBoundingClientRect().top : null,
        cue: visible(query('#s2 [data-cue="s2-after"]')) || visible(query('#s2 [data-cue="s2-empty"]')) };
    },
    vibrationNotice() {
      const notice = query('[data-cue="u-08"]');
      const on = visible(notice);
      const box = on ? notice.getBoundingClientRect() : null;
      const hits = (selectors) => box ? selectors.filter((selector) => [...document.querySelectorAll(selector)].some((target) => {
        if (!visible(target)) return false;
        const rect = target.getBoundingClientRect();
        return Math.min(box.right, rect.right) - Math.max(box.left, rect.left) > 2
          && Math.min(box.bottom, rect.bottom) - Math.max(box.top, rect.top) > 2;
      })) : [];
      return { scene: activeScene(), visible: on, hidden: notice?.hidden ?? null, away: notice?.classList.contains('is-away') ?? false,
        visibility: notice ? getComputedStyle(notice).visibility : null,
        overlaps: hits(['#s2 [data-record-strip="7-6"]', '#s2 .src-ghost .sg-label', '#s2 .tag.is-now text']),
        layoutOverlaps: hits(['#s2 [data-physics-body="6:chair"]', '#s2 [data-physics-body="6:mug"]', '#s2 [data-place="s2-copy"]']) };
    },
    enter(scene, progress) {
      const section = query(`section[data-scene="${scene}"]`);
      if (!section) throw new Error(`v0.3 장면 누락 · ${scene}`);
      const rect = section.getBoundingClientRect();
      const panel = section.querySelector('[data-motion-sticky]');
      const panelHeight = panel?.getBoundingClientRect().height ?? innerHeight;
      const travel = Math.max(0, rect.height - panelHeight);
      const map = scene === 's4' ? window.LandingBuilding?.createClimaxScrollMap?.({ travel, panelHeight, viewportHeight: innerHeight }) : null;
      window.scrollTo({ top: scrollY + rect.top + (map?.offsetAt(progress) ?? travel * progress), behavior: 'instant' });
    },
    point(selectors) {
      for (const selector of selectors) {
        const element = query(selector);
        if (!visible(element) || element.matches(':disabled,[aria-disabled="true"]')) continue;
        const rect = element.getBoundingClientRect();
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        if (element.contains(document.elementFromPoint(x, y))) return { x, y };
      }
      return null;
    },
    async orient(beta, gamma) {
      for (let i = 0; i < 12; i += 1) {
        emit(new DeviceOrientationEvent('deviceorientation', { alpha: 10, beta, gamma, absolute: false }));
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return true;
    },
    rotateScreen(angle) {
      Object.defineProperty(screen.orientation, 'angle', { configurable: true, value: angle });
      screen.orientation.dispatchEvent(new Event('change'));
      emit(new Event('orientationchange'));
    },
    watchLamp() {
      const lamp = query('#s5 [data-physics-lamp="6"]');
      if (!lamp) throw new Error('v0.3 S5 6층 진자 훅 누락');
      lampPeak = null;
      const sample = () => {
        const magnitude = Math.abs(parseFloat(lamp.style.getPropertyValue('--lamp-angle')));
        if (Number.isFinite(magnitude)) lampPeak = Math.max(lampPeak ?? 0, magnitude);
        lampFrame = requestAnimationFrame(sample);
      };
      lampFrame = requestAnimationFrame(sample);
    },
    stopLamp() {
      cancelAnimationFrame(lampFrame);
      return lampPeak;
    },
  };
}

const isRotated = (state) => state.phase === 'listen' && state.listening && state.gy < 0
  && Number.isFinite(state.gx) && Math.abs(state.gx) <= Math.abs(state.gy) * 0.05
  && Math.abs(Math.abs(state.angle) - 180) <= 3;
const pulses = (state) => state.vibrations.filter(({ pulse }) => pulse);
const listeningRoom = ({ scene, listening }) => scene === 's2' || scene === 's3' || (scene === 's4' && listening);

export async function inspectV03({ scenario, send, evaluate, evidence, errors, wait = pause }) {
  const call = (method, ...args) => evaluate(`window.__landingthonV03.${method}(${args.map((arg) => JSON.stringify(arg)).join(',')})`);
  const check = (condition, label) => { if (!condition) errors.add(`v0.3 ${label}`); };
  async function read() {
    const state = await call('read');
    for (const [control, name, off, on] of [
      [state.sound, '소리', '소리 켜기', '소리 끄기'],
      [state.motion, '움직임', '움직임 일시정지', '움직임 다시 켜기'],
    ]) {
      check(!control.ariaPressedPresent, `${name} 토글에 aria-pressed가 있습니다.`);
      check(['true', 'false'].includes(control.pressed), `${name} 토글에 data-pressed 상태가 필요합니다.`);
      check(control.label === (control.pressed === 'true' ? on : off), `${name} 토글의 동작 라벨과 data-pressed 불일치`);
    }
    return state;
  }
  await evaluate('document.fonts.ready.then(() => true)');
  async function until(get, pass, label, end = performance.now() + 4500) {
    let result;
    do {
      result = await get();
      if (pass(result) && performance.now() <= end) return result;
      await wait(45);
    } while (performance.now() < end);
    throw new Error(`v0.3 상태 미도달 · ${label} · ${JSON.stringify(result)}`);
  }
  const enter = (scene, progress = 0) => call('enter', scene, progress);
  async function click(...selectors) {
    const { x, y } = await until(() => call('point', selectors), Boolean, `사용할 수 없는 버튼 ${selectors.join(' / ')}`);
    if (scenario.view.mobile) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      }
    }
  }
  const drop = () => click('#s0 button[data-action="drop-high"]', '#s0 button[data-action="drop"]');
  async function s1() {
    check(evidence.initial.s1 && evidence.initial.gestures.length === 2, 'S1 장면 또는 끌기·던지기 훅 누락');
    await enter('s1');
    const first = await read();
    await click('#s1 button[data-action="drag-chair"]');
    evidence.drag = await until(read, (state) => state.seq > first.seq, 'S1 의자 끌기의 충격 기록');
    await wait(500);
    const second = await read();
    await click('#s1 button[data-action="throw-ball"]');
    evidence.throw = await until(read, (state) => state.seq > second.seq, 'S1 공 던지기의 충격 기록');
    await wait(300);
  }
  async function mat({ measureLamp = false } = {}) {
    check(evidence.initial.s5, 'S5 완충재 장면 누락');
    await enter('s5', 0.15);
    if (measureLamp) await call('watchLamp');
    await click('#s5 button[data-action="mat-before"]');
    evidence.bare = await until(read, (state) => state.mat === 'before' && state.before > 0, 'S5 맨바닥 측정');
    if (measureLamp) {
      await wait(1200);
      evidence.barePeak = await call('stopLamp');
    }
    await click('#s5 button[data-action="mat-lay"]');
    evidence.laid = await until(read, (state) => state.mat === 'laid' && state.matVisible, 'S5 매트 설치');
    check(!evidence.bare.matLampCue && !evidence.laid.matLampCue, 'S5-05가 비교 전에 표시됨');
    if (measureLamp) await call('watchLamp');
    await click('#s5 button[data-action="mat-after"]');
    evidence.mat = await until(read, (state) => state.mat === 'done' && state.matResult && state.reduction !== null, 'S5 매트 비교 표시');
    const { before, after, reduction } = evidence.mat;
    check(before === evidence.bare.before && after !== null && before > after && after >= 0 && reduction > 0
      && Math.abs(reduction - 100 * (1 - after / before)) <= 2, 'S5 감소율과 표시 쿵 값 불일치');
    if (measureLamp) {
      await wait(1200);
      evidence.paddedPeak = await call('stopLamp');
      evidence.matLampCue = (await read()).matLampCue;
      const { barePeak, paddedPeak } = evidence;
      check(Number.isFinite(barePeak) && Number.isFinite(paddedPeak), 'S5 6층 진자 실측값 누락');
      const expected = barePeak > 0 && paddedPeak < barePeak * 0.85;
      check(evidence.matLampCue === expected, 'S5-05 진자 진폭 15% 초과 감소 조건 불일치');
    }
  }
  evidence.initial = await read();
  check(evidence.initial.contexts.length === 0, '첫 조작 전에 AudioContext 생성');

  if (scenario.permission) {
    await enter('s4', 0.2);
    check(evidence.initial.permissionCalls.length === 0, '조작 전 센서 권한 요청');
    await click('#s4 [data-action="sensor-enable"]');
    evidence.permission = await until(read, (state) => state.permissionCalls.length > 0, '센서 권한 요청');
    check(evidence.permission.permissionCalls[0].active !== false, '사용자 동작 밖에서 센서 권한 요청');
    const { branch } = scenario;
    if (['cutover', 'screen-rotated', 'overdue'].includes(branch)) {
      await call('orient', 25, 60);
      evidence.tilt = await until(read, (state) => state.sensor === 'tilting' && Math.abs(state.gx) >= 40, '기울기 이벤트에 중력 반응');
      check(Math.abs(evidence.tilt.angle) <= 3, '센서 모드에서 무대가 회전함');
    }
    let started;
    if (branch === 'cutover') {
      await enter('s4', 0.69);
      await wait(350);
      evidence.belowCutover = await read();
      check(evidence.belowCutover.sensor === 'tilting' && Math.abs(evidence.belowCutover.angle) <= 3,
        '진행률 0.69에서 센서 모드가 유지되지 않음');
      started = performance.now();
      await enter('s4', 0.72);
    } else {
      if (branch === 'screen-rotated') await call('rotateScreen', scenario.angle);
      evidence.fallback = await until(read, (state) => {
        if (branch === 'overdue') return state.status.includes('조금 더 거꾸로');
        if (branch === 'screen-rotated') return state.sensor === 'fallback' && Boolean(state.screenRotationCue);
        return state.sensor === 'fallback' && state.status.includes('센서를 쓸 수 없어서');
      }, branch === 'screen-rotated' ? '화면 회전 뒤 S4-17 안내' : '센서 분기 안내',
      performance.now() + (branch === 'overdue' ? 9000 : 4500));
      started = performance.now();
      const flip = '#s4 [data-action="flip"]';
      if (branch !== 'screen-rotated' && !await call('point', [flip])) await click('#s4 [data-action="sensor-use-button"]');
      await click(flip);
    }
    const deadline = started + 3000;
    evidence.result = await until(read, (state) => !['tilting', 'inverted'].includes(state.sensor) && isRotated(state),
      '센서 분기 뒤 3초 안에 공통 반전 결과', deadline);
    evidence.resultMs = Math.round(performance.now() - started);
    await call('orient', 65, -50);
    evidence.afterResult = await read();
    const drift = Math.hypot(evidence.afterResult.gx - evidence.result.gx, evidence.afterResult.gy - evidence.result.gy);
    check(isRotated(evidence.afterResult) && drift <= 2, '버튼·스크롤 전환 뒤 센서 입력이 중력을 다시 바꿈');
    return;
  }

  if (scenario.haptics) {
    if (evidence.initial.haptics.visible && !scenario.view.reducedMotion) {
      check(evidence.initial.haptics.pressed === 'true', 'Android 진동 기본 상태가 켜짐이 아님');
    }
    await drop();
    evidence.upstairs = await until(read, (state) => state.seq > evidence.initial.seq, '위층 충격 기록');
    if (!scenario.view.reducedMotion) await s1();
    const checkV05Layout = evidence.initial.summaryArt && !scenario.view.reducedMotion;
    if (checkV05Layout) {
      await enter('s2', 0.05);
      await until(read, (state) => state.scene === 's2', 'S2 재생 임계점 전 진입');
      evidence.replayBefore = await until(() => call('replayLayout'), (state) => state.top !== null && !state.cue,
        'S2 첫 재생 전 다시 듣기 위치');
    }
    await enter('s2', 0.65);
    await until(read, (state) => state.scene === 's2', 'S2 6층 진입');
    if (evidence.initial.recordArt && !scenario.view.reducedMotion) {
      evidence.vibrationNotice = await until(() => call('vibrationNotice'), (state) => state.visible, 'S2 첫 진동 안내');
      check(evidence.vibrationNotice.overlaps.length === 0, 'S2 진동 안내가 기록 띠나 사건 표지를 덮습니다.');
    }
    if (checkV05Layout) {
      evidence.replayAfter = await until(() => call('replayLayout'), (state) => state.top !== null && state.cue,
        'S2 첫 재생 뒤 다시 듣기 위치');
      evidence.replayTopDelta = Math.abs(evidence.replayAfter.top - evidence.replayBefore.top);
      check(evidence.replayTopDelta <= 0.5, 'S2 첫 재생 전후 다시 듣기 버튼의 세로 위치가 달라졌습니다.');
      check(evidence.vibrationNotice?.layoutOverlaps.length === 0, 'S2 진동 안내가 의자·머그나 안내 글을 덮습니다.');
    }
    await wait(1800);
    if (scenario.view.reducedMotion) {
      evidence.reduced = await read();
      check(pulses(evidence.reduced).length === 0, '움직임 줄이기 상태에서 진동이 울림');
      return;
    }
    await enter('s3', 0.55);
    if (checkV05Layout) {
      evidence.vibrationNoticeS3 = await until(() => call('vibrationNotice'), (state) =>
        state.scene === 's3' && state.hidden === false && state.away && !state.visible && state.visibility === 'hidden', 'S3 진입 후 U-08 시각 숨김');
    }
    await wait(1400);
    await enter('s4', 0.65);
    await until(read, isRotated, '진동 검사 S4 듣기 전용 상태');
    await wait(1400);
    await mat();
    await wait(350);
    evidence.vibrations = pulses(await read());
    check(evidence.vibrations.some(listeningRoom), 'Android 기본 진동이 듣는 쪽 방에서 울리지 않음');
    check(evidence.vibrations.every(listeningRoom), '7층 S0·S1·S5 또는 듣는 쪽 방 밖에서 진동이 울림');
    check(evidence.vibrations.every(({ duration }) => Number.isFinite(duration) && duration <= 80), '진동 한 번의 길이가 80ms를 넘음');
    await click('#motion-pause');
    await until(read, (state) => state.paused && state.motion.pressed === 'true', '진동 검사 일시정지');
    await enter('s2', 0.65);
    await until(read, (state) => state.scene === 's2', '일시정지 상태로 듣는 방 진입');
    const replay = '#s2 button[data-action="replay"]';
    if (await call('point', [replay])) await click(replay);
    await wait(1800);
    evidence.paused = await read();
    check(pulses(evidence.paused).length === evidence.vibrations.length, '일시정지 상태에서 진동이 울림');
    return;
  }

  check(evidence.initial.sound.visible && evidence.initial.sound.pressed === 'false', '기본 음소거 표시 실패');
  await drop();
  evidence.muted = await until(read, (state) => state.seq > evidence.initial.seq, '음소거 상태의 충격 기록');
  check(evidence.muted.contexts.length === 0, '소리를 켜기 전에 AudioContext 생성');
  await click('button[data-action="sound"]');
  evidence.soundOn = (await until(read, (state) => state.sound.pressed === 'true', '소리 활성화')).sound;
  await s1();
  check(evidence.throw.contexts.length > 0, '소리 활성화 후 AudioContext 생성 없음');
  await mat({ measureLamp: true });
  await click('button[data-action="sound"]');
  evidence.soundOff = (await until(read, (state) => state.sound.pressed === 'false', '다시 음소거')).sound;
}
