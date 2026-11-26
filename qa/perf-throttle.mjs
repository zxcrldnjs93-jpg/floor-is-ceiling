import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome, openChrome } from './browser.mjs';
import { openRecordingPage } from './record.mjs';

const view = { width: 390, height: 844, scale: 1, mobile: true };
const rates = [4, 6];
const page = new URL('https://qa.invalid/');

export function installPerfProbe() {
  const tasks = [];
  const observer = PerformanceObserver.supportedEntryTypes.includes('longtask')
    ? new PerformanceObserver((list) => tasks.push(...list.getEntries())) : null;
  observer?.observe({ type: 'longtask' });

  let start, previous, frame, intervals;
  function sample(now) {
    intervals.push(now - previous);
    previous = now;
    frame = requestAnimationFrame(sample);
  }

  window.__landingthonPerf = {
    begin() {
      return new Promise((done) => requestAnimationFrame((now) => {
        if (observer) {
          observer.takeRecords();
          tasks.length = 0;
        }
        intervals = [];
        start = previous = now;
        frame = requestAnimationFrame(sample);
        done();
      }));
    },
    async end() {
      await new Promise(requestAnimationFrame);
      const end = previous;
      cancelAnimationFrame(frame);
      // 긴 작업은 관측 콜백이 대기 중인 경우에도 포함한다.
      if (observer) tasks.push(...observer.takeRecords());
      return {
        intervals, elapsedMs: end - start,
        longTasks: observer ? tasks.filter(({ startTime }) => startTime >= start && startTime < end).length : null,
      };
    },
  };
}

const roundMs = (ms) => Math.round(ms * 100) / 100;
export function frameStats({ intervals, elapsedMs, longTasks }) {
  const sorted = [...intervals].sort((left, right) => left - right);
  return {
    elapsedMs: roundMs(elapsedMs),
    frameSamples: sorted.length,
    p95Ms: sorted.length ? roundMs(sorted[Math.ceil(0.95 * sorted.length) - 1]) : null,
    longTasks,
  };
}

export async function measureThrottle(tab, rate) {
  const { send, evaluate } = tab;
  await send('Emulation.setCPUThrottlingRate', { rate });
  await evaluate(`(${installPerfProbe.toString()})()`);
  const recording = (method, value) => `window.__landingthonRecording.${method}(${JSON.stringify(value)})`;
  const state = (name, options) => `${recording('check', { state: name, ...options })}.ok`;
  const point = (selector) => recording('point', [selector]);
  const settle = (ms) => evaluate(`new Promise((done) => setTimeout(done, ${ms}))`);
  async function until(expression, label) {
    const value = await evaluate(`new Promise((done) => {
      const deadline = performance.now() + 8000;
      function poll() {
        let value;
        try { value = (${expression}); } catch {}
        if (value || performance.now() >= deadline) done(value ?? false);
        else setTimeout(poll, 50);
      }
      poll();
    })`);
    if (!value) throw new Error(`상태 미도달 · ${label}`);
    return value;
  }

  async function tap(location) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [location] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async function button(selector) {
    return until(point(selector), selector);
  }
  async function enter(scene, progress) {
    await evaluate(recording('scroll', { scene, progress, seconds: 0 }));
    await settle(300);
  }

  const cases = [];
  async function measure(scene, prepare, run) {
    const result = { scene };
    cases.push(result);
    try {
      const location = await prepare();
      await evaluate('window.__landingthonPerf.begin()');
      try {
        await run(location);
      } finally {
        Object.assign(result, frameStats(await evaluate('window.__landingthonPerf.end()')));
      }
      if (!result.frameSamples || result.longTasks === null) throw new Error('프레임 또는 긴 작업 관측값 누락');
    } catch (error) {
      result.error = error.message;
    }
  }

  await settle(500);
  await measure('S0 쿵', () => button('#s0 button[data-action="drop-high"]'), async (location) => {
    await tap(location);
    await until(state('records', { min: 1 }), 'S0 7층 충격 기록');
    await settle(650);
  });

  await measure('S2 재생', async () => {
    // 자동 재생이 시작되는 진행률 0.2 앞에서 같은 기록을 버튼으로 재생한다.
    await enter('s2', 0.05);
    return button('#s2 button[data-action="replay"]');
  }, async (location) => {
    await tap(location);
    await until(state('replay'), 'S2 기록 재생');
    // 재생 커서는 마지막 위치에 남는다. 충격 뒤 반응 애니메이션까지 측정한다.
    await settle(1650);
  });

  await measure('S4 회전', async () => {
    await enter('s4', 0.2);
    return button('#s4 button[data-action="flip"]');
  }, async (location) => {
    await tap(location);
    await until(`${state('inverted')} && (() => {
      const stage = document.querySelector('#s4 [data-flip-layer]:not([data-building-mirror])');
      const matrix = new DOMMatrixReadOnly(getComputedStyle(stage).transform);
      return stage.dataset.climaxPhase === 'listen' && matrix.m11 <= -0.998;
    })()`, 'S4 180°·위쪽 중력·듣기 상태');
    await settle(250);
  });

  await measure('S5 매트', async () => {
    if (await evaluate(state('inverted'))) {
      await tap(await button('#s4 button[data-action="reset-flip"]'));
      await until(state('upright'), 'S4 정방향 복귀');
    }
    await enter('s5', 0.15);
    await until(state('mat-ready'), 'S5 맨바닥 준비');
    return button('#s5 button[data-action="mat-before"]');
  }, async (location) => {
    await tap(location);
    await until(state('mat-before'), 'S5 맨바닥 충격');
    await tap(await button('#s5 button[data-action="mat-lay"]'));
    await until(state('mat-laid'), 'S5 매트 펼침');
    await settle(850);
    await tap(await button('#s5 button[data-action="mat-after"]'));
    await until(state('mat-result'), 'S5 매트 충격 비교');
    await settle(650);
  });
  return { rate, cases, errors: [...tab.errors] };
}

async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('사용법 · QA_OUT=/tmp/ltperf CHROME_BIN=/usr/bin/google-chrome node qa/perf-throttle.mjs [BUILD_DIR]');
    return 0;
  }
  if (args.length > 1 || args[0]?.startsWith('-')) throw new Error('배포 폴더 경로를 하나 지정하세요.');
  const root = await realpath(args[0] ?? fileURLToPath(new URL('../site/dist/', import.meta.url)));
  if (!(await stat(join(root, 'index.html'))).isFile()) throw new Error('배포 폴더에 index.html이 필요합니다.');
  const executable = findChrome();
  const outBase = resolve(process.env.QA_OUT || `/tmp/ltperf-${process.getuid?.() ?? 'local'}`);
  await mkdir(outBase, { recursive: true });
  const output = await mkdtemp(join(await realpath(outBase), 'perf-'));
  const profile = await mkdtemp(join(await realpath(outBase), 'p-'));
  const chrome = openChrome(executable, profile);
  const report = { viewport: view, runs: [] };
  try {
    report.chrome = (await chrome.send('Browser.getVersion')).product;
    for (const rate of rates) {
      let tab;
      const run = { rate, cases: [], errors: [] };
      report.runs.push(run);
      try {
        tab = await openRecordingPage(chrome, root, page, view, false);
        Object.assign(run, await measureThrottle(tab, rate));
      } catch (error) {
        run.errors.push(error.message);
      } finally {
        await tab?.close().catch((error) => run.errors.push(error.message));
      }
    }
  } catch (error) {
    report.error = [error.message, chrome.log()].filter(Boolean).join('\n');
  } finally {
    await chrome.close();
    await rm(profile, { recursive: true, force: true });
  }
  console.log('CPU\t장면\tp95(ms)\t긴 작업\t프레임 간격 수');
  for (const { rate, cases, errors } of report.runs) {
    for (const { scene, p95Ms, longTasks, frameSamples, error } of cases) {
      const row = [`${rate}×`, scene, p95Ms ?? '—', longTasks ?? '—', frameSamples ?? '—'];
      console.log([...row, ...(error ? [error] : [])].join('\t'));
    }
    for (const error of errors) console.error(`${rate}× · ${error}`);
  }
  if (report.error) console.error(report.error);
  const path = join(output, 'report.json');
  await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  console.log(`성능 보고서 · ${path}`);
  return report.error || report.runs.some(({ cases, errors }) => errors.length || cases.some(({ error }) => error)) ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
