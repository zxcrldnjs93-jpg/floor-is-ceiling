import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { findChrome, openChrome, serveRequest } from './browser.mjs';
import { installVerificationProbes, normalizeVerification } from './verify-scenes.mjs';
import { watchCardPng } from './verify-card.mjs';
import { installV04Verification } from './verify-v04.mjs';
import { installV05Verification } from './verify-v05.mjs';
import { installV06Verification } from './verify-v06.mjs';
import { installV06bVerification } from './verify-v06b.mjs';
import { installV07Verification } from './verify-v07.mjs';
import { installV08Verification } from './verify-v08.mjs';
import { installV09Verification } from './verify-v09.mjs';
import { installV10KVerification } from './verify-v10k.mjs';
import { v10kCopy } from './v10k-copy.mjs';

const landscape = { width: 1920, height: 1080, scale: 1 };
const portrait = { width: 540, height: 675, scale: 2, mobile: true };
const clock = { now: () => performance.now(), wait };
const localOrigin = 'https://qa.invalid/';
const ffmpegPath = '/usr/bin/ffmpeg';
const cueTypes = ['hover', 'click', 'scroll', 'dragMat', 'caption', 'expect'];
const expectedStates = ['records', 'replay', 'relay', 'inverted', 'upright', 'result',
  's4-ready', 's4-listen', 's4-chair', 's4-reset-ready',
  'mat-ready', 'mat-before', 'mat-roll-ready', 'mat-laid', 'mat-result', 'mat-card', 'recap', 'coda-frame'];
const usableNumber = (value) => Number.isFinite(value) && value >= 0;
const positiveInteger = (value) => Number.isInteger(value) && value > 0;
const scenePosition = (value) => /^s\d+$/.test(value?.scene) && usableNumber(value.progress) && value.progress <= 1;
const selectorList = (value) => Array.isArray(value) && value.length > 0
  && value.every((selector) => typeof selector === 'string' && selector.trim());
const validRecordingCheck = (value, maxWait) => expectedStates.includes(value?.state)
  && (value.wait === undefined || usableNumber(value.wait) && value.wait <= maxWait)
  && (value.state !== 'records' || positiveInteger(value.min) && (value.minPeak === undefined || usableNumber(value.minPeak)))
  && (value.peak === undefined || value.state === 'records' && positiveInteger(value.peak))
  && (value.before === undefined && value.after === undefined
    || ['mat-roll-ready', 'mat-result', 'mat-card', 'recap'].includes(value.state) && positiveInteger(value.before)
      && (value.state === 'mat-roll-ready' ? value.after === undefined : positiveInteger(value.after) && value.after < value.before));

export function normalizeStoryboard(plan) {
  if (!Number.isInteger(plan.fps) || plan.fps < 12 || plan.fps > 60) throw new Error('콘티는 정수 fps(12~60)를 사용합니다.');
  function covers(seconds) {
    if (!Array.isArray(plan.covers) || plan.covers.length !== 3 || new Set(plan.covers).size !== 3
      || !plan.covers.every((time) => usableNumber(time) && time < seconds)) {
      throw new Error('covers에 가로 영상의 서로 다른 시점 세 개를 지정하세요.');
    }
    return plan.covers;
  }
  function segment(name) {
    const { seconds, cues, prepare } = plan[name];
    const fadeSeconds = name === 'story' ? 0 : plan[name].fadeSeconds ?? 0;
    const loopHoldSeconds = plan[name].loopHoldSeconds ?? 0;
    if (!usableNumber(fadeSeconds) || (fadeSeconds > 0 && (fadeSeconds < 1 / plan.fps || fadeSeconds >= seconds))) {
      throw new Error(`${name}.fadeSeconds는 한 프레임 이상, 구간 길이 미만이어야 합니다.`);
    }
    if (!usableNumber(loopHoldSeconds) || (loopHoldSeconds > 0 && (!fadeSeconds || fadeSeconds + loopHoldSeconds >= seconds))) {
      throw new Error(`${name}.loopHoldSeconds는 페이드가 있는 구간에서만 지정할 수 있습니다.`);
    }
    if (prepare !== undefined && (!scenePosition(prepare) || !usableNumber(prepare.wait)
      || (prepare.click !== undefined || prepare.expect !== undefined) && (!selectorList(prepare.click)
        || prepare.expect?.state !== 'records' || !validRecordingCheck(prepare.expect, 8)))) {
      throw new Error(`${name}.prepare의 장면, 진행률, 대기 시간 또는 사전 낙하 큐가 잘못됐습니다.`);
    }
    if (!Array.isArray(cues) || !cues.length) throw new Error(`${name}.cues가 비어 있습니다.`);
    const track = cues.map(({ at, ...action }, index) => {
      const [kind] = Object.keys(action);
      const value = action[kind];
      const invalid = () => new Error(`콘티 값 오류 · ${name}.cues[${index}]`);
      if (!usableNumber(at) || at > seconds - 1 / plan.fps || Object.keys(action).length !== 1 || !cueTypes.includes(kind)) throw invalid();
      if (['click', 'hover'].includes(kind) && !selectorList(value)) throw invalid();
      if (kind === 'scroll' && (!scenePosition(value) || !usableNumber(value.seconds) || at + value.seconds > seconds
        || (value.sceneProgress !== undefined && typeof value.sceneProgress !== 'boolean')
        || (value.climaxProgress !== undefined && (typeof value.climaxProgress !== 'boolean'
          || value.climaxProgress && (value.scene !== 's4' || value.sceneProgress || value.center)))
        || (value.center !== undefined && (typeof value.center !== 'string' || !value.center.trim() || value.sceneProgress)))) throw invalid();
      if (kind === 'dragMat' && (!usableNumber(value) || value < 1 / plan.fps || at + value > seconds - 1 / plan.fps)) throw invalid();
      if (kind === 'caption' && typeof value !== 'string' && (typeof value?.text !== 'string' || typeof value.showUrl !== 'boolean')) throw invalid();
      if (kind === 'expect' && !validRecordingCheck(value, seconds - 1 / plan.fps - at)) throw invalid();
      return { at, kind, value };
    }).sort((a, b) => a.at - b.at);
    return { seconds, fadeSeconds, loopHoldSeconds, prepare, track };
  }
  if (plan.gallery) {
    const { seconds } = plan.gallery;
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 40 || plan.share || plan.opening || plan.story) {
      throw new Error('갤러리 콘티는 40초 이내의 단일 영상입니다.');
    }
    return { fps: plan.fps, covers: covers(seconds), gallery: segment('gallery') };
  }
  if (plan.share) {
    if (plan.share.seconds !== 6 || plan.opening || plan.story) throw new Error('매트 공유 콘티는 6초입니다.');
    return { fps: plan.fps, covers: [], share: segment('share') };
  }
  if (plan.opening?.seconds !== 6 || plan.story?.seconds !== 24 || !(plan.opening.fadeSeconds >= 1 / plan.fps)) {
    throw new Error('기존 콘티는 오프닝 6초와 본편 24초를 사용합니다.');
  }
  return { fps: plan.fps, covers: covers(30), opening: segment('opening'), story: segment('story') };
}

// 녹화 탭에만 커서와 자막을 그린다. 클릭은 CDP에서 실제 포인터 이벤트로 보낸다.
function installOverlay(draw) {
  const overlay = document.createElement('div');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  const cursor = document.createElement('span');
  cursor.style.cssText = 'position:absolute;width:19px;height:19px;transform:translate(-50%,-50%);'
    + 'border:2px solid #fff;border-radius:50%;background:#1e2631e8;box-shadow:0 0 0 1px #1e2631';
  cursor.hidden = true;
  const caption = document.createElement('div');
  caption.style.cssText = 'position:absolute;bottom:4%;left:50%;transform:translateX(-50%);'
    + 'max-width:87%;width:max-content;padding:.3em .75em;color:#fff;background:#171d27eb;'
    + 'font-size:clamp(16px,3.4vw,40px);line-height:1.25;font-weight:700;text-align:center;white-space:pre-line;overflow-wrap:anywhere';
  caption.hidden = true;
  const firstFrame = document.createElement('img');
  firstFrame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:fill;opacity:0';
  firstFrame.alt = '';
  firstFrame.hidden = true;
  overlay.append(cursor, caption, firstFrame);
  if (draw) document.body.append(overlay);

  let scrolling, dragTrace, dragListeners;
  const matRoll = '#s5 [data-mat-roll]';
  const rectOf = (element) => {
    const rect = element?.getBoundingClientRect();
    return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
  };
  const describeTarget = (element) => element?.localName ? {
    tag: element.localName, id: element.id || undefined, action: element.closest('[data-action]')?.dataset.action,
  } : null;

  function observeMatDrag(roll, stage) {
    dragListeners?.abort();
    dragListeners = new AbortController();
    const { signal } = dragListeners;
    const stageRect = rectOf(stage);
    const rollRect = rectOf(roll);
    const trace = { rollRect, stageRect, events: [],
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, scrollY },
      ariaDisabled: roll?.getAttribute('aria-disabled') ?? null };
    dragTrace = trace;
    if (!roll) return trace;

    function record(event, onRoll) {
      if (trace.events.length >= 80) return;
      const stageAtRelease = event.type === 'pointerup' ? rectOf(stage) : null;
      trace.events.push({
        type: event.type, onRoll, rollInPath: onRoll || event.composedPath().includes(roll),
        time: event.timeStamp, x: event.clientX, y: event.clientY,
        button: event.button, buttons: event.buttons, pointerId: event.pointerId, pointerType: event.pointerType,
        pressure: event.pressure, target: describeTarget(event.target),
        captured: event.pointerId === undefined ? undefined : roll.hasPointerCapture(event.pointerId),
        translate: roll.style.translate, ariaDisabled: roll.getAttribute('aria-disabled'),
        releaseStageX: stageAtRelease?.width ? (event.clientX - stageAtRelease.left) / stageAtRelease.width : undefined,
      });
    }
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture', 'dragstart']) {
      roll.addEventListener(type, (event) => record(event, true), { signal, passive: true });
      document.addEventListener(type, (event) => record(event, false), { signal, capture: true, passive: true });
    }
    return trace;
  }
  function scrollTarget({ scene, progress, sceneProgress, climaxProgress, useClimaxMap, center }) {
    const section = document.querySelector(`[data-scene="${scene}"]`);
    if (!section) throw new Error(`녹화 장면 누락 · ${scene}`);
    if (center) {
      const target = section.querySelector(center);
      if (!target) throw new Error(`녹화 화면에 맞출 요소가 없습니다 · ${scene} ${center}`);
      const { top, height } = target.getBoundingClientRect();
      return scrollY + top + (height - innerHeight) / 2;
    }
    const panel = section.querySelector('[data-motion-sticky]');
    const bounds = section.getBoundingClientRect();
    const panelHeight = panel?.getBoundingClientRect().height ?? innerHeight;
    const range = bounds.height - panelHeight;
    if (climaxProgress || useClimaxMap) {
      const map = window.LandingBuilding?.createClimaxScrollMap?.({ travel: range, panelHeight, viewportHeight: innerHeight });
      if (map) return scrollY + bounds.top + map.offsetAt(progress);
      if (climaxProgress) throw new Error('S4 듣기 구간 스크롤 매핑이 없습니다.');
    }
    // 짧은 장면의 진행률은 섹션 이동거리 대신 뷰포트에서의 위치를 기준으로 한다.
    const offset = sceneProgress && range <= innerHeight * 0.1
      ? innerHeight * (progress * 0.55 - 0.6)
      : progress * Math.max(0, range);
    return scrollY + bounds.top + offset;
  }
  window.__landingthonRecording = {
    point(selectors) {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (!element || element.hidden || element.matches(':disabled,[aria-disabled="true"]')) continue;
        const rect = element.getBoundingClientRect();
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        if (element.contains(document.elementFromPoint(x, y))) return { x, y };
      }
      throw new Error(`녹화 조작부가 가려졌거나 비활성 상태입니다 · ${selectors.join(' / ')}`);
    },
    matDragPoints() {
      const roll = document.querySelector(matRoll);
      const stage = document.querySelector('#s5 [data-stage="s5"]');
      const trace = observeMatDrag(roll, stage);
      if (trace.ariaDisabled !== 'false') {
        throw new Error('말린 매트가 활성화되기 전에는 드래그할 수 없습니다.');
      }
      const mat = window.LandingArt?.geometry?.('s5')?.mat;
      const { rollRect, stageRect } = trace;
      const from = { x: Math.round(rollRect.left + rollRect.width / 2), y: Math.round(rollRect.top + rollRect.height / 2) };
      const fromTarget = document.elementFromPoint(from.x, from.y);
      Object.assign(trace, { from, fromTarget: describeTarget(fromTarget), fromHitsRoll: roll.contains(fromTarget) });
      if (!trace.fromHitsRoll) throw new Error('말린 매트의 드래그 시작점이 다른 요소에 가려졌습니다.');
      if (!stageRect || !mat) throw new Error('매트 드래그 도착 위치를 찾지 못했습니다.');
      const x = Math.round(stageRect.left + stageRect.width * (mat.x0 + mat.x1) / 2);
      const to = { x, y: from.y };
      Object.assign(trace, { to, matRange: [mat.x0, mat.x1], toStageX: (x - stageRect.left) / stageRect.width });
      if (!Number.isFinite(x) || x - from.x <= 10 || x >= innerWidth
        || trace.toStageX < mat.x0 || trace.toStageX > mat.x1) throw new Error('매트 드래그 위치가 잘못됐습니다.');
      return { from, to };
    },
    finishMatDrag() {
      dragListeners?.abort();
      return dragTrace;
    },
    pointer(point, pressed) {
      cursor.hidden = !point;
      if (!point) return;
      cursor.style.left = `${point.x}px`;
      cursor.style.top = `${point.y}px`;
      if (pressed) cursor.animate([{ scale: '1', background: '#d84d2b' }, { scale: '1.65', background: '#1e2631' }], 210);
    },
    caption(value) {
      caption.textContent = value;
      caption.hidden = !value;
    },
    scrollTarget(value) {
      return Math.min(scrollTarget(value), document.scrollingElement.scrollHeight - innerHeight);
    },
    scroll(value) {
      const from = scrollY;
      const to = scrollTarget(value);
      const { seconds } = value;
      cancelAnimationFrame(scrolling);
      if (seconds === 0) {
        window.scrollTo({ top: to, behavior: 'instant' });
        return;
      }
      const start = performance.now();
      function frame(now) {
        const fraction = Math.min(1, (now - start) / (1000 * seconds));
        const eased = fraction * fraction * (3 - 2 * fraction);
        window.scrollTo({ top: from + (to - from) * eased, behavior: 'instant' });
        if (fraction < 1) scrolling = requestAnimationFrame(frame);
      }
      scrolling = requestAnimationFrame(frame);
    },
    check({ state, min, minPeak = 0, peak: expectedPeak, before: expectedBefore, after: expectedAfter }) {
      const allRecords = window.LandingArt?.records?.() ?? [];
      const records = allRecords.filter((record) => record.n > 0 && record.slab === '7-6');
      const query = (selector) => document.querySelector(selector);
      const text = (selector) => query(selector)?.textContent.trim() ?? '';
      const number = (selector) => {
        const value = text(selector).replaceAll(',', '');
        return /^\d+$/.test(value) ? Number(value) : null;
      };
      const visible = (selector) => {
        const node = query(selector);
        if (!node || node.hidden || node.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) === false) return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.left >= -0.5 && rect.right <= innerWidth + 0.5
          && rect.top >= -0.5 && rect.bottom <= innerHeight + 0.5;
      };
      const replay = text('#s2 [data-fx="replay-feedback"]').match(/쿵\s*#(\d+)/);
      const stage = query('#s4 [data-flip-layer]:not([data-building-mirror])');
      const gy = Number(stage?.dataset.gravityY);
      const listening = query('#main')?.hasAttribute('data-listening');
      const peak = number('#s6 [data-result-peak]');
      const recordedPeak = Math.max(0, ...records.map(({ value }) => value));
      const mat = query('#s5')?.dataset.matTest;
      const before = number('#s5 [data-impact-before]');
      const after = number('#s5 [data-impact-after]');
      const rollAriaDisabled = query(matRoll)?.getAttribute('aria-disabled') ?? null;
      const diminished = before > 0 && after !== null && after < before;
      const matchingMat = (expectedBefore === undefined || before === expectedBefore)
        && (expectedAfter === undefined || after === expectedAfter);
      const matBeforeButton = '#s5 button[data-action="mat-before"]';
      if (state.startsWith('s4-')) {
        const phase = stage?.dataset.climaxPhase;
        const s4 = query('#s4'), panel = s4?.querySelector('[data-motion-sticky]');
        const panelHeight = panel?.getBoundingClientRect().height;
        const travel = s4?.getBoundingClientRect().height - panelHeight;
        const map = window.LandingBuilding?.createClimaxScrollMap?.({ travel, panelHeight, viewportHeight: innerHeight });
        const screens = map ? (map.listenEnd - map.listenStart) / panelHeight : null;
        const floor = '#s4 [data-s4-slab-label="floor"]', ceiling = '#s4 [data-s4-slab-label="ceiling"]';
        const labels = [floor, ceiling].map((selector) => visible(selector) ? text(selector) : '');
        const chair = allRecords.filter(({ slab, label }) => slab === '6-7' && label === '6층 의자');
        const marker = '#s4 .s4-chair-mark';
        const chairShown = chair.length === 1 && visible('#s4 [data-cue="s4-06"]') && visible(`${marker} text`)
          && Number(query(marker)?.dataset.markValue) === chair[0].value;
        const onListen = phase === 'listen' && listening && gy < 0 && screens !== null && Math.abs(screens - 1.22) <= 0.005
          && labels.join() === '6층 바닥,7층 천장' && visible('#s4 [data-flip-cue="listen"] .display');
        const reset = '#s4 button[data-action="reset-flip"]';
        const resetDisabled = query(reset)?.getAttribute('aria-disabled') ?? null;
        const resetReady = visible(reset) && resetDisabled === 'false';
        const ok = state === 's4-ready' ? phase === 'ready' && gy > 0 && labels.join() === '7층 바닥,6층 천장'
          : onListen && (state !== 's4-chair' || chairShown) && (state !== 's4-reset-ready' || resetReady);
        return { ok, phase, gy, screens, labels, chair, chairShown, resetReady, resetDisabled };
      }
      if (state === 'recap') {
        const hasListen = Boolean(query('#s6 [data-recap="listen"]'));
        const fields = ['kung', hasListen ? 'listen' : 'relay', 'mat'].map((name) => {
          const cell = `#s6 [data-recap="${name}"]`;
          return { shown: visible(cell) && visible(`${cell} [data-recap-from]`) && visible(`${cell} [data-recap-to]`),
            done: query(cell)?.dataset.state === 'done', from: text(`${cell} [data-recap-from]`), to: text(`${cell} [data-recap-to]`) };
        });
        const relay = allRecords.find(({ slab, label }) => slab === (hasListen ? '6-7' : '6-5') && label === '6층 의자');
        const max = records.find(({ value }) => value === recordedPeak);
        const [kung, chair, comparison] = fields;
        return { ok: visible('#s6 #recap-title') && text('#s6 #recap-title') === '오늘 확인한 것'
          && fields.every(({ shown, done }) => shown && done) && Boolean(max && relay)
          && kung.from === `쿵 #${max?.n} · ${max?.value}` && kung.to === '6층 천장'
          && chair.from === `6층 의자 · ${relay?.value}` && chair.to === (hasListen ? '7층 천장' : '5층 천장')
          && diminished && matchingMat && comparison.from === `쿵 ${before}` && comparison.to === String(after),
        fields, before, after };
      }
      const pass = {
        records: new Set(records.map(({ n }) => n)).size >= min && recordedPeak >= minPeak
          && (expectedPeak === undefined || recordedPeak === expectedPeak),
        replay: Boolean(replay) && records.some(({ n }) => n === Number(replay[1])),
        relay: allRecords.some(({ slab }) => slab === '6-5'),
        inverted: listening && gy < 0,
        upright: !listening && gy > 0 && stage?.dataset.climaxPhase === 'settle',
        result: peak > 0 && Boolean(text('[data-result-title]')),
        'mat-ready': mat === 'ready' && visible(matBeforeButton) && query(matBeforeButton).getAttribute('aria-disabled') !== 'true',
        'mat-before': mat === 'before' && before > 0,
        'mat-roll-ready': mat === 'before' && before > 0 && matchingMat && rollAriaDisabled === 'false' && visible(matRoll),
        'mat-laid': mat === 'laid' && visible('#s5 [data-mat]'),
        'mat-result': mat === 'done' && diminished && matchingMat && visible('#s5 [data-mat-result]'),
        'mat-card': diminished && matchingMat && peak > 0 && peak === (recordedPeak || before) && visible('#s6 [data-result-peak]')
          && visible('#s6 [data-result-mat]') && number('#s6 [data-result-mat-before]') === before
          && number('#s6 [data-result-mat-after]') === after,
        'coda-frame': visible('#s7 .coda') && text('#s7 .coda') === '누군가의 바닥은, 내 천장입니다.',
      };
      return { ok: Boolean(pass[state]), count: records.length, replay: replay?.[1] ?? null,
        phase: stage?.dataset.climaxPhase, gy, peak, recordedPeak, mat, before, after, rollAriaDisabled };
    },
    async prepareFade(png) {
      firstFrame.src = `data:image/png;base64,${png}`;
      await firstFrame.decode();
    },
    fade(seconds) {
      firstFrame.hidden = false;
      firstFrame.animate([{ opacity: 0 }, { opacity: 1 }], { duration: seconds * 1000, fill: 'forwards' });
    },
  };
}

export async function openRecordingPage(chrome, root, page, view, draw = true, { isolated = false } = {}) {
  const context = isolated ? await chrome.send('Target.createBrowserContext') : {};
  let targetId, sessionId;
  const close = async () => {
    if (sessionId) chrome.unlisten(sessionId);
    if (context.browserContextId) await chrome.send('Target.disposeBrowserContext', context);
    else if (targetId) await chrome.send('Target.closeTarget', { targetId });
  };
  try {
    ({ targetId } = await chrome.send('Target.createTarget', { url: 'about:blank', ...context }));
    ({ sessionId } = await chrome.send('Target.attachToTarget', { targetId, flatten: true }));
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
  const errors = new Set();
  const send = (method, params) => chrome.send(method, params, sessionId);
  let onFrame = () => {};
  chrome.listen(sessionId, (method, params) => {
    if (method === 'Fetch.requestPaused') {
      serveRequest(send, params, root, page, errors).catch((error) => errors.add(error.message));
    } else if (method === 'Page.screencastFrame') {
      onFrame(params.data);
      send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch((error) => errors.add(error.message));
    } else if (method === 'Runtime.exceptionThrown') {
      const detail = params.exceptionDetails;
      errors.add((detail.exception?.description ?? detail.text).split('\n')[0]);
    } else if (method === 'Log.entryAdded' && params.entry.level === 'error') {
      errors.add(params.entry.text);
    } else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
      errors.add(params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' '));
    }
  });
  const allowDownloads = (downloadPath) => chrome.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath, ...context });
  async function evaluate(expression) {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }
  try {
    await send('Page.enable');
    await send('Page.bringToFront');
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Fetch.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: view.width, height: view.height, deviceScaleFactor: view.scale, mobile: Boolean(view.mobile),
    });
    if (!draw && view.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true });
    if (view.haptics) {
      await send('Emulation.setUserAgentOverride', {
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
        platform: 'Android',
      });
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
        const pulses = [];
        window.__qaHapticPulses = pulses;
        Object.defineProperty(navigator, 'vibrate', { configurable: true, value(pattern) {
          const first = Array.isArray(pattern) ? pattern[0] : pattern;
          if (first > 0) pulses.push({ at: performance.now(), duration: first });
          return true;
        } });
      })()` });
    }
    await send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-reduced-motion', value: view.reducedMotion ? 'reduce' : 'no-preference' },
        ...(view.forcedColors ? [{ name: 'forced-colors', value: 'active' }] : []),
      ],
    });
    const navigation = await send('Page.navigate', { url: page.href });
    if (navigation.errorText) throw new Error(navigation.errorText);
    const deadline = performance.now() + 12000;
    while (!await evaluate(`document.readyState === 'complete' && Boolean(document.querySelector('#s0 button[data-action="drop"]:not([hidden])'))`)) {
      if (errors.size || performance.now() >= deadline) throw new Error(`녹화할 C11 빌드가 준비되지 않았습니다. ${[...errors].join(' · ')}`);
      await wait(50);
    }
    await evaluate("document.fonts.ready.then(() => true)");
    await evaluate(`(${installOverlay.toString()})(${draw})`);
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
  return { send, evaluate, close, allowDownloads, errors, receive(listener) { onFrame = listener; } };
}

const pngName = (frame) => `frame-${String(frame).padStart(5, '0')}.png`;
const callProbe = (tab, object, method, ...args) => tab.evaluate(
  `window.${object}.${method}(${args.map((arg) => JSON.stringify(arg)).join(',')})`,
);

async function performInput(tab, { kind, value }, showPointer, view, timer = clock) {
  const call = (method, ...args) => callProbe(tab, '__landingthonRecording', method, ...args);
  if (kind === 'scroll') {
    if (showPointer) await call('pointer', null, false);
    const targetOptions = !showPointer && value.scene === 's4' ? { ...value, useClimaxMap: true } : value;
    if (value.input === 'wheel' && view) {
      const target = await call('scrollTarget', targetOptions);
      const deadline = timer.now() + 1000 * value.seconds;
      let distance = target - await tab.evaluate('scrollY');
      while (Math.abs(distance) >= 4 && timer.now() < deadline) {
        const step = Math.min(Math.abs(distance), 120);
        await tab.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel', x: Math.round(view.width / 2), y: Math.round(view.height / 2),
          deltaX: 0, deltaY: Math.sign(distance) * step,
        });
        // 목표 직전에는 브라우저가 휠 입력을 반영한 뒤 위치를 다시 읽는다.
        await timer.wait(step < 120 ? 32 : 12);
        distance = target - await tab.evaluate('scrollY');
      }
      if (Math.abs(distance) >= 4) throw new Error(`휠 스크롤이 ${value.scene}에 닿지 못했습니다 · ${Math.round(distance)}px 남음`);
    } else await call('scroll', targetOptions);
    return;
  }
  const click = kind === 'click' || kind === 'clickAt';
  const point = kind === 'clickAt' ? await callProbe(tab, '__landingthonVerify', 'pointIn', value) : await call('point', value);
  if (!point) throw new Error(`그림 위치의 실제 입력 영역을 찾을 수 없습니다 · ${value?.selector}`);
  if (showPointer) await call('pointer', point, click);
  if (view?.mobile && click) {
    await tab.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await tab.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return;
  }
  await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  if (click) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await tab.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
    }
  }
}

export async function verifySegment({ tab, track, view, capture, fontReport, timer = clock }) {
  const checks = [];
  const snapshots = [];
  const hasChecks = (prefix) => track.some(({ kind, value }) => kind === 'expect' && value.state.startsWith(prefix));
  const v04 = hasChecks('v04-');
  const v05 = hasChecks('v05-');
  const v06 = hasChecks('v06-');
  const v06b = hasChecks('v06b-');
  const v07 = hasChecks('v07-');
  const v08 = hasChecks('v08-');
  const v09 = hasChecks('v09-');
  const v10k = hasChecks('v10k-');
  const call = (method, ...args) => callProbe(tab, '__landingthonVerify', method, ...args);
  async function press(key, windowsVirtualKeyCode, text) {
    const params = { key, code: key, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode };
    await tab.send('Input.dispatchKeyEvent', { ...params, type: text ? 'keyDown' : 'rawKeyDown', text });
    await tab.send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' });
  }
  try {
    await tab.evaluate(`(${installVerificationProbes.toString()})(${watchCardPng.toString()},
      ${v04 ? installV04Verification.toString() : 'null'}, ${v05 ? installV05Verification.toString() : 'null'},
      ${v06 ? installV06Verification.toString() : 'null'}, ${v06b ? installV06bVerification.toString() : 'null'},
      ${v07 ? installV07Verification.toString() : 'null'}, ${v08 ? installV08Verification.toString() : 'null'},
      ${v09 ? installV09Verification.toString() : 'null'}, ${v10k ? installV10KVerification.toString() : 'null'},
      ${JSON.stringify({ v10kCopy, fontReport })})`);
    if (track.some(({ kind, value }) => kind === 'expect' && ['replay-pending', 's0-replayed'].includes(value.state))) {
      await call('observeReplayBeats');
    }
    const start = timer.now();
    for (const cue of track) {
      const delay = start + cue.at * 1000 - timer.now();
      if (delay > 0) await timer.wait(delay);
      if (tab.errors.size) throw new Error([...tab.errors].join('\n'));
      if (cue.kind === 'watch') await call('watch', cue.value);
      else if (cue.kind === 'tabTo') {
        let focused = await call('focused', cue.value);
        for (let count = 0; !focused && count < 24; count += 1) {
          await press('Tab', 9);
          focused = await call('focused', cue.value);
        }
        if (!focused) throw new Error(`탭으로 조작부에 도달하지 못했습니다 · ${cue.value}`);
      } else if (cue.kind === 'enter') {
        if (!await call('focused', cue.value) && !await call('focus', cue.value)) {
          throw new Error(`키보드 초점을 받을 수 없습니다 · ${cue.value}`);
        }
        await press('Enter', 13, '\r');
      } else if (cue.kind === 'keyBurst') {
        const { selector, count, intervalMs } = cue.value;
        if (!await call('focused', selector)) throw new Error(`연타를 시작할 키보드 초점이 없습니다 · ${selector}`);
        const first = timer.now();
        for (let index = 0; index < count; index++) {
          const pause = first + index * intervalMs - timer.now();
          if (pause > 0) await timer.wait(pause);
          await press('Enter', 13, '\r');
        }
      } else if (cue.kind === 'dragChair') {
        const selector = '#s1 [data-physics-gesture="drag-chair"]';
        const point = await call('pointIn', { selector, scope: '#s1 [data-stage="s1"]', target: selector });
        if (!point) throw new Error('S1에서 실제 드래그할 의자를 찾을 수 없습니다.');
        await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, pointerType: 'mouse' });
        await tab.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
        let x = point.x;
        for (const dx of [-12, -24, -12, -36, -55, -66]) {
          await timer.wait(35);
          x = point.x + dx;
          await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: point.y, button: 'left', buttons: 1, pointerType: 'mouse' });
        }
        await timer.wait(150);
        await tab.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: point.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
      } else if (cue.kind === 'snapshot') {
        snapshots.push(await capture(cue.value));
      } else if (cue.kind === 'reveal') {
        if (!await call('reveal', cue.value)) throw new Error(`화면에서 확인할 요소가 없습니다 · ${cue.value}`);
      } else if (cue.kind === 'scrollByScreens') {
        await tab.evaluate(`window.scrollBy({ top: innerHeight * ${cue.value}, behavior: 'instant' })`);
      } else if (cue.kind === 'expect') {
        const deadline = timer.now() + 1000 * (cue.value.wait ?? 0);
        const required = cue.value.stable ?? 1;
        let observed = await call('check', cue.value);
        let stable = observed.ok ? 1 : 0;
        while (stable < required && timer.now() < deadline && !tab.errors.size) {
          await timer.wait(40);
          observed = await call('check', cue.value);
          stable = observed.ok ? stable + 1 : 0;
        }
        if (required > 1) observed = { ...observed, ok: stable >= required, stableSamples: stable, requiredSamples: required };
        checks.push({ at: cue.at, state: cue.value.state, observed,
          ...(cue.value.wait ? { observedAt: Math.round(timer.now() - start) / 1000 } : {}) });
        if (!observed.ok) throw new Error(`${cue.at}초 ${cue.value.state} · ${JSON.stringify(observed)}`);
      } else await performInput(tab, cue, false, view, timer);
    }
    if (tab.errors.size) throw new Error([...tab.errors].join('\n'));
    return { ok: true, checks, ...(snapshots.length ? { snapshots } : {}) };
  } catch (error) {
    if ((v04 || v05 || v06 || v06b || v07 || v08 || v09 || v10k) && capture) {
      try { snapshots.push(await capture('failed')); } catch { /* 장면 오류를 유지한다. */ }
    }
    return { ok: false, checks, ...(snapshots.length ? { snapshots } : {}), error: error.message };
  }
}

export async function recordSegment({ tab, segment, view, fps, frameDirectory, offset = 0, pageUrl = '', timer = clock }) {
  const { send } = tab;
  const call = (method, ...args) => callProbe(tab, '__landingthonRecording', method, ...args);
  const numberOfFrames = segment.seconds * fps;
  const cues = segment.track.flatMap((cue) => {
    if (cue.kind !== 'dragMat') return [cue];
    const steps = Math.ceil(cue.value * fps);
    return Array.from({ length: steps + 1 }, (_, step) => ({
      at: cue.at + cue.value * step / steps, kind: 'matDragFrame', value: step / steps,
    }));
  });
  const hold = segment.loopHoldSeconds ?? 0;
  if (segment.fadeSeconds) cues.push({ at: segment.seconds - segment.fadeSeconds - hold, kind: 'fade', value: segment.fadeSeconds });
  cues.sort((a, b) => a.at - b.at);
  const checks = [];
  const matDrags = [];
  let drag;

  async function finishDrag() {
    if (!drag) return;
    try {
      drag.browser = await call('finishMatDrag');
    } catch (error) {
      drag.traceError = error.message;
    }
    matDrags.push(drag);
    drag = undefined;
  }

  async function sendDragMouse(at, type, point, button, buttons) {
    const input = { type, ...point, button, buttons, pointerType: 'mouse' };
    if (type !== 'mouseMoved') input.clickCount = 1;
    drag.sent.push({ at, ...input });
    await send('Input.dispatchMouseEvent', input);
  }

  async function perform({ kind, value, at }, time = at) {
    if (kind === 'click' || kind === 'hover' || kind === 'scroll') {
      await performInput(tab, { kind, value }, true);
    } else if (kind === 'matDragFrame') {
      if (value === 0) {
        await finishDrag();
        drag = { at, sent: [] };
        Object.assign(drag, await call('matDragPoints'));
      }
      const { from, to } = drag;
      const point = { x: from.x + (to.x - from.x) * value, y: from.y };
      await call('pointer', point, value === 0);
      if (value === 0) {
        await sendDragMouse(at, 'mouseMoved', point, 'none', 0);
        await sendDragMouse(at, 'mousePressed', point, 'left', 1);
      } else {
        await sendDragMouse(at, 'mouseMoved', point, 'left', 1);
        if (value === 1) await sendDragMouse(at, 'mouseReleased', point, 'left', 0);
      }
    } else if (kind === 'caption') {
      await call('caption', typeof value === 'string' ? value : [value.text, value.showUrl ? pageUrl : ''].filter(Boolean).join('\n'));
    } else if (kind === 'expect') {
      const observed = await call('check', value);
      if (!observed.ok && value.wait > 0 && time < at + value.wait) return false;
      if (value.state === 'mat-laid') await finishDrag();
      if (!observed.ok) throw new Error(`콘티 상태 미도달 · ${at}초 ${value.state} · ${JSON.stringify(observed)}`);
      checks.push({ at, state: value.state, observed, ...(value.wait ? { observedAt: time } : {}) });
    } else if (kind === 'fade') {
      await call('fade', value);
    }
  }

  let screencasting = false;
  try {
    if (segment.prepare) {
      const { click, expect, wait: settle, ...position } = segment.prepare;
      if (click) {
        await performInput(tab, { kind: 'click', value: click }, false);
        const deadline = timer.now() + 1000 * (expect.wait ?? 0);
        let observed = await call('check', expect);
        while (!observed.ok && timer.now() < deadline) {
          await timer.wait(40);
          observed = await call('check', expect);
        }
        if (!observed.ok) throw new Error(`녹화 준비 낙하 미도달 · ${JSON.stringify(observed)}`);
        checks.push({ stage: 'prepare', state: expect.state, observed });
      }
      await call('scroll', { ...position, seconds: 0 });
      await timer.wait(settle * 1000);
    }
    let nextCue = 0;
    while (cues[nextCue]?.at === 0 && !cues[nextCue].value?.wait) await perform(cues[nextCue++]);
    const { data: initial } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    if (segment.fadeSeconds) await call('prepareFade', initial);
    let latest = initial, received = 0, lagMs = 0;
    tab.receive((data) => { latest = data; received += 1; });
    await send('Page.startScreencast', {
      format: 'png', maxWidth: view.width * view.scale, maxHeight: view.height * view.scale, everyNthFrame: 1,
    });
    screencasting = true;
    const started = timer.now();
    async function reach(seconds) {
      const left = started + seconds * 1000 - timer.now();
      if (left > 0) await timer.wait(left);
    }
    for (let frame = 0; frame < numberOfFrames; frame += 1) {
      const time = frame / fps;
      while (cues[nextCue] && cues[nextCue].at <= time) {
        const cue = cues[nextCue];
        await reach(cue.kind === 'expect' && cue.value.wait ? time : cue.at);
        if (await perform(cue, time) === false) break;
        nextCue += 1;
      }
      await reach(time);
      lagMs = Math.max(lagMs, timer.now() - started - time * 1000);
      const loopEdge = frame === 0 || (segment.fadeSeconds && (frame === numberOfFrames - 1 || time >= segment.seconds - hold));
      await writeFile(join(frameDirectory, pngName(offset + frame)), Buffer.from(loopEdge ? initial : latest, 'base64'));
    }
    await finishDrag();
    if (tab.errors.size) throw new Error([...tab.errors].join('\n'));
    if (!received) throw new Error('Chrome이 screencast 프레임을 보내지 않았습니다.');
    return { frames: numberOfFrames, received, maxLagMs: Math.round(lagMs), checks, ...(matDrags.length ? { matDrags } : {}) };
  } catch (error) {
    await finishDrag();
    if (!matDrags.length) throw error;
    const failure = new Error(`${error.message}\n매트 드래그 진단 · ${JSON.stringify(matDrags)}`, { cause: error });
    failure.matDrags = matDrags;
    throw failure;
  } finally {
    if (screencasting) await send('Page.stopScreencast');
    tab.receive(() => {});
  }
}

const scaleFilter = (width, height) => `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;

export function videoArgs({ frames, fps, seconds, width, height, output }) {
  return [
    '-framerate', String(fps), '-start_number', '0', '-i', join(frames, 'frame-%05d.png'),
    '-map', '0:v:0', '-frames:v', String(seconds * fps), '-vf', scaleFilter(width, height),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-maxrate', '12M', '-bufsize', '24M',
    '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', output,
  ];
}

function ffmpeg(args) {
  return new Promise((done, fail) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr = (stderr + chunk).slice(-6000); });
    child.once('error', fail);
    child.once('close', (code) => code === 0 ? done() : fail(new Error(`ffmpeg 종료 ${code} · ${stderr.trim()}`)));
  });
}

async function fontCoverage(root) {
  const script = fileURLToPath(new URL('static.py', import.meta.url));
  try {
    const { stdout } = await promisify(execFile)('python3', ['-B', script, '--font-only', root]);
    return JSON.parse(stdout);
  } catch (error) {
    return { error: error.stdout?.trim() || error.message };
  }
}

async function main(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('사용법 · QA_OUT=/tmp/ltvideo node qa/record.mjs [--verify-only] [BUILD_DIR] [STORY.json] [--page-url URL]');
    return;
  }
  const positional = [];
  let verifyOnly = false;
  let page = new URL(localOrigin);
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (value === '--page-url') page = new URL(args[++i]);
    else if (value === '--verify-only') verifyOnly = true;
    else if (value.startsWith('-')) throw new Error(`알 수 없는 인수 · ${value}`);
    else positional.push(value);
  }
  if (positional.length > 2 || !['https:', 'http:'].includes(page.protocol) || page.username || page.password
    || page.search || page.hash || (!page.pathname.endsWith('/') && !page.pathname.endsWith('/index.html'))) {
    throw new Error('빌드·콘티 경로와 디렉터리 또는 index.html의 공개 HTTP(S) 주소를 지정하세요.');
  }
  const [build = fileURLToPath(new URL('../site/dist/', import.meta.url)),
    storyboard = fileURLToPath(new URL(verifyOnly ? './verify-story.json' : './record-story.json', import.meta.url))] = positional;
  if (!storyboard.endsWith('.json') || !(await realpath(storyboard)).endsWith('.json')) {
    throw new Error('녹화 콘티는 JSON 파일을 지정하세요.');
  }
  const root = await realpath(build);
  if (!(await stat(join(root, 'index.html'))).isFile()) throw new Error('배포 폴더에 index.html이 필요합니다.');
  const data = JSON.parse(await readFile(storyboard, 'utf8'));
  const plan = verifyOnly ? normalizeVerification(data) : normalizeStoryboard(data);
  const fontReport = verifyOnly && plan.some(({ track }) => track.some(({ kind, value }) =>
    kind === 'expect' && value.state === 'v10k-font')) ? await fontCoverage(root) : undefined;
  const prefix = verifyOnly ? 'ltverify' : 'ltvideo';
  const outBase = resolve(process.env.QA_OUT || `/tmp/${prefix}-${process.getuid?.() ?? 'local'}`);
  if (!verifyOnly) await access(ffmpegPath, constants.X_OK);
  const executable = findChrome();
  await mkdir(outBase, { recursive: true });
  if (await realpath(outBase) !== outBase) throw new Error('출력 폴더는 일반 디렉터리여야 합니다.');
  const output = await mkdtemp(join(outBase, verifyOnly ? 'verify-' : 'video-'));
  const wide = join(output, 'gallery-frames');
  const tall = join(output, 'share-frames');
  const products = [];
  if (!verifyOnly) {
    if (plan.gallery || plan.opening) {
      const seconds = plan.gallery?.seconds ?? plan.opening.seconds + plan.story.seconds;
      const chapters = plan.gallery ? [['갤러리 본편', plan.gallery]]
        : [['갤러리 오프닝', plan.opening], ['갤러리 본편', plan.story]];
      products.push({ name: `gallery-${seconds}s.mp4`, seconds, frames: wide, view: landscape, chapters });
    }
    if (plan.share || plan.opening) {
      const name = plan.share ? 'share-mat-6s.mp4' : 'share-6s.mp4';
      const chapter = plan.share ? ['매트 공유 루프', plan.share] : ['공유용 루프', plan.opening];
      products.push({ name, seconds: chapter[1].seconds, frames: tall, view: portrait, chapters: [chapter] });
    }
    await Promise.all(products.map(({ frames }) => mkdir(frames)));
  }
  const profile = await mkdtemp(join(outBase, 'p-'));
  const chrome = openChrome(executable, profile);
  const evidence = [];
  console.log(`${verifyOnly ? '검증' : '녹화'} 결과 · ${output}`);

  async function sequence(name, segment, view, frameDirectory, offset = 0) {
    console.log(`녹화 중 · ${name} ${segment.seconds}초`);
    const tab = await openRecordingPage(chrome, root, page, view);
    try {
      const publicUrl = page.href !== localOrigin ? page.href
        : await tab.evaluate("document.querySelector('link[rel=canonical]')?.href ?? ''");
      const details = await recordSegment({ tab, segment, view, fps: plan.fps, frameDirectory, offset, pageUrl: publicUrl });
      evidence.push({ name, ...details });
      console.log(`프레임 저장 · ${details.frames}장 · Chrome 송신 ${details.received}장 · 최대 지연 ${details.maxLagMs}ms`);
    } catch (error) {
      if (error.matDrags) {
        const report = { name, error: error.cause?.message ?? error.message, matDrags: error.matDrags };
        await writeFile(join(output, 'recording-failure.json'), JSON.stringify(report, null, 2) + '\n');
      }
      throw error;
    } finally {
      await tab.close();
    }
  }

  try {
    await chrome.send('Browser.getVersion');
    if (verifyOnly) {
      for (const { name, view, track } of plan) {
        let tab, result;
        try {
          tab = await openRecordingPage(chrome, root, page, view, false, { isolated: true });
          const expectsCard = track.some(({ kind, value }) => kind === 'watch' && value === 'card-png');
          const cardFolder = expectsCard ? `scene-${evidence.length + 1}-downloads` : null;
          const downloadPath = cardFolder ? join(output, cardFolder) : null;
          if (downloadPath) {
            await mkdir(downloadPath);
            await tab.allowDownloads(downloadPath);
          }
          let snapshotIndex = 0;
          const capture = async (label) => {
            const filename = `scene-${evidence.length + 1}-${++snapshotIndex}-${label}.png`;
            const { data } = await tab.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
            await writeFile(join(output, filename), Buffer.from(data, 'base64'));
            return filename;
          };
          result = await verifySegment({ tab, track, view, capture, fontReport });
          if (result.ok && downloadPath) {
            const deadline = performance.now() + 3000;
            do {
              result.downloads = (await readdir(downloadPath)).filter((name) => name.endsWith('.png')).map((name) => join(cardFolder, name));
              if (result.downloads.length) break;
              await wait(40);
            } while (performance.now() < deadline);
            if (!result.downloads.length) result = { ...result, ok: false, error: '카드 PNG 다운로드 미완료' };
          }
        } catch (error) {
          result = { ok: false, checks: [], error: error.message };
        } finally {
          try {
            await tab?.close();
          } catch (error) {
            result = { ...result, ok: false, error: [result?.error, error.message].filter(Boolean).join(' · ') };
          }
        }
        evidence.push({ name, viewport: view, ...result });
        console.log(`${result.ok ? 'PASS' : 'FAIL'} · ${name}${result.error ? ` · ${result.error}` : ''}`);
      }
      const failed = evidence.filter(({ ok }) => !ok).length;
      await writeFile(join(output, 'verification.json'), JSON.stringify({ cases: evidence }, null, 2) + '\n');
      console.log(`검증 완료 · ${evidence.length}장면 · 실패 ${failed}개`);
      return failed ? 1 : 0;
    }
    for (const { frames, view, chapters } of products) {
      let offset = 0;
      for (const [name, segment] of chapters) {
        await sequence(name, segment, view, frames, offset);
        offset += segment.seconds * plan.fps;
      }
    }
  } catch (error) {
    throw new Error([error.message, chrome.log()].filter(Boolean).join('\n'));
  } finally {
    await chrome.close();
    await rm(profile, { recursive: true, force: true });
  }

  for (const { name, frames, seconds, view } of products) {
    const width = view.width * view.scale, height = view.height * view.scale;
    const path = join(output, name);
    await ffmpeg(videoArgs({ frames, fps: plan.fps, seconds, width, height, output: path }));
    const bytes = (await stat(path)).size;
    if (!bytes || (view === landscape && bytes > 200_000_000)) throw new Error(`영상 파일 크기 조건 실패 · ${name} ${bytes} B`);
    console.log(`MP4 저장 · ${name} · ${width}×${height} · ${seconds}초 · ${bytes} B`);
  }
  for (const [index, at] of plan.covers.entries()) {
    const path = join(output, `cover-0${index + 1}.png`);
    await ffmpeg(['-i', join(wide, pngName(Math.floor(at * plan.fps))), '-vf', scaleFilter(1920, 1080),
      '-frames:v', '1', '-update', '1', path]);
  }
  await writeFile(join(output, 'recording.json'), JSON.stringify({ fps: plan.fps, covers: plan.covers, segments: evidence }, null, 2) + '\n');
  console.log(`녹화 완료 · MP4 ${products.length}개${plan.covers.length ? ` · 표지 PNG ${plan.covers.length}장` : ''}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = (await main(process.argv.slice(2))) ?? 0;
  } catch (error) {
    const mode = process.argv.includes('--verify-only') ? '검증' : '녹화';
    console.error(`${mode} 실패 · ${error.message}`);
    process.exitCode = 1;
  }
}
