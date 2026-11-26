import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile, rm } from 'node:fs/promises';
import { delimiter, extname, join, relative, resolve, sep } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { c11Viewports, inspectC11, installC11Probes } from './c11.mjs';
import {
  allowRequest, auditDeploymentMeta, auditDeploymentResponses, deploymentUrl, isPermissionsWarning,
  probeDeploymentFiles, probeMissing, selectedHeaders,
} from './remote.mjs';
import { inspectV03, installV03Probes, v03Cases } from './v03.mjs';

const viewports = [
  { width: 320, height: 568, mobile: true },
  { width: 390, height: 844, mobile: true },
  { width: 768, height: 1024, mobile: true },
  { width: 844, height: 390, mobile: true },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 390, height: 844, mobile: true, cpu: 4 },
  { width: 390, height: 844, mobile: true, reducedMotion: true },
];

const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.otf': 'font/otf', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
};

export function findChrome() {
  const paths = (process.env.PATH ?? '').split(delimiter);
  for (const name of [process.env.CHROME_BIN || 'google-chrome', 'chromium', 'chromium-browser']) {
    const candidates = name.includes(sep) ? [name] : paths.map((directory) => join(directory, name));
    for (const candidate of candidates) {
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // 다음 실행 파일을 확인한다.
      }
    }
  }
  throw new Error('Chrome/Chromium 실행 파일을 찾지 못했습니다. CHROME_BIN을 확인하세요.');
}

export function openChrome(executable, profile, { offline = true } = {}) {
  const network = offline ? ['--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND'] : [];
  const child = spawn(executable, [
    '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--disable-breakpad', ...network, 'about:blank',
  ], {
    stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
    env: { ...process.env, TMPDIR: profile, XDG_CONFIG_HOME: profile, XDG_CACHE_HOME: profile },
  });
  const pending = new Map();
  const listeners = new Map();
  let nextId = 0;
  let buffer = '';
  let failure;
  let chromeLog = '';

  function disconnect(error) {
    failure ??= error;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(failure);
    }
    pending.clear();
  }

  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    chromeLog = (chromeLog + chunk).slice(-5000);
  });
  const closed = new Promise((done) => child.once('close', (code, signal) => {
    disconnect(new Error(`Chrome 종료 (${code ?? signal})`));
    done();
  }));
  child.on('error', disconnect);
  const input = child.stdio[3];
  input.on('error', disconnect);
  child.stdio[4].setEncoding('utf8').on('data', (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (message.id !== undefined) {
        const request = pending.get(message.id);
        if (!request) continue;
        clearTimeout(request.timer);
        pending.delete(message.id);
        if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
        else request.resolve(message.result);
      } else {
        listeners.get(message.sessionId)?.(message.method, message.params);
      }
    }
  }).on('error', disconnect);

  return {
    send(method, params = {}, sessionId) {
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} 응답 시간 초과`));
        }, 12000);
        pending.set(id, { method, resolve, reject, timer });
        input.write(JSON.stringify({ id, method, params, sessionId }) + '\0');
      });
    },
    listen(sessionId, listener) { listeners.set(sessionId, listener); },
    unlisten(sessionId) { listeners.delete(sessionId); },
    log() { return chromeLog.trim(); },
    async close() {
      child.kill();
      const forceKill = setTimeout(() => child.kill('SIGKILL'), 3000);
      try { await closed; } finally { clearTimeout(forceKill); }
    },
  };
}

export async function serveRequest(send, { requestId, request }, root, page, errors) {
  const url = new URL(request.url);
  const mount = new URL('./', page).pathname;
  const path = url.pathname;
  const fulfill = (responseCode, type, content) => send('Fetch.fulfillRequest', {
    requestId, responseCode,
    responseHeaders: [{ name: 'Content-Type', value: type }, { name: 'Cache-Control', value: 'no-store' }],
    body: request.method === 'HEAD' ? '' : content?.toString('base64') ?? '',
  });
  if (url.origin !== page.origin) {
    errors.add(`외부 리소스 차단 · ${url.origin}${path}`);
    await send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    return;
  }

  try {
    if (!['GET', 'HEAD'].includes(request.method) || !path.startsWith(mount)) throw new Error();
    const name = decodeURIComponent(path.slice(mount.length)) || 'index.html';
    if (name.includes('\\') || name.split('/').some((part) => !part || part.startsWith('.'))) throw new Error();
    const candidate = resolve(root, name);
    const local = relative(root, candidate);
    if (!local || local === '..' || local.startsWith(`..${sep}`)) throw new Error();
    if (await realpath(candidate) !== candidate || !(await stat(candidate)).isFile()) throw new Error();
    await fulfill(200, mime[extname(candidate).toLowerCase()] ?? 'application/octet-stream', await readFile(candidate));
  } catch (error) {
    if (request.method === 'GET' && path === '/favicon.ico' && (error.code === 'ENOENT' || !path.startsWith(mount))) {
      await fulfill(204, 'image/x-icon');
      return;
    }
    errors.add(`오프라인에서 제공할 수 없는 리소스 · ${path}`);
    await fulfill(404, 'text/plain');
  }
}

function installObservers() {
  const result = { lcpMs: null, cls: null };
  window.__landingthonQa = result;
  if (PerformanceObserver.supportedEntryTypes.includes('largest-contentful-paint')) {
    new PerformanceObserver((list) => {
      result.lcpMs = list.getEntries().at(-1)?.startTime ?? result.lcpMs;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  }
  if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
    result.cls = 0;
    let first = -Infinity;
    let previous = -Infinity;
    let score = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        if (entry.startTime - previous >= 1000 || entry.startTime - first >= 5000) {
          first = entry.startTime;
          score = 0;
        }
        score += entry.value;
        previous = entry.startTime;
        result.cls = Math.max(result.cls, score);
      }
    }).observe({ type: 'layout-shift', buffered: true });
  }
}

function serveRemote(send, { requestId, request }, page, errors) {
  if (allowRequest(request, page)) return send('Fetch.continueRequest', { requestId });
  errors.add(`범위 밖 원격 요청 차단 · ${request.method} ${new URL(request.url).origin}`);
  return send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
}

async function inspectMissingPage(chrome, page, path) {
  const errors = new Set();
  const home = new URL('./', page);
  const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await chrome.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => chrome.send(method, params, sessionId);
  let finalUrl = null;
  chrome.listen(sessionId, (method, params) => {
    if (method === 'Fetch.requestPaused') serveRemote(send, params, page, errors).catch((error) => errors.add(error.message));
    if (method === 'Log.entryAdded' && isPermissionsWarning(params.entry.text)) errors.add(params.entry.text);
    if (method === 'Page.frameNavigated' && !params.frame.parentId) finalUrl = params.frame.url;
  });
  try {
    await send('Page.enable');
    await send('Log.enable');
    await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Fetch.enable');
    await send('Page.navigate', { url: new URL(path, home).href });
    const deadline = performance.now() + 5000;
    while (finalUrl !== home.href && performance.now() < deadline) await pause(60);
  } catch (error) {
    errors.add(error.message);
  } finally {
    chrome.unlisten(sessionId);
    await chrome.send('Target.closeTarget', { targetId });
  }
  if (finalUrl !== home.href) errors.add('404에서 작품 루트로 돌아오지 못했습니다.');
  return { finalUrl, errors: [...errors], ok: errors.size === 0 };
}

async function inspectViewport(chrome, view, root, page, output, voteUrl, scenario) {
  const name = scenario?.name ?? `${view.width}x${view.height}${view.cpu ? '-cpu4x' : ''}${view.reducedMotion ? '-reduced' : ''}`;
  const errors = new Set();
  const warnings = [];
  const screenshots = [];
  const c11 = voteUrl && !scenario ? {} : undefined;
  const features = scenario ? {} : undefined;
  const responses = root ? null : [];
  const responseById = new Map();
  let metrics = null;
  const context = scenario || c11 ? await chrome.send('Target.createBrowserContext') : {};
  const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank', ...context });
  const { sessionId } = await chrome.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => chrome.send(method, params, sessionId);
  const mount = new URL('./', page).pathname;
  const inspectAddress = (url) => {
    const next = new URL(url);
    if (next.origin !== page.origin) {
      errors.add(`스크립트가 외부 주소로 이동했습니다 · ${next.origin}`);
    } else if (![mount, `${mount}index.html`].includes(next.pathname) || next.search !== page.search) {
      errors.add(`스크립트가 내부 주소를 변경했습니다 · ${next.pathname}`);
    }
  };
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  const capture = async (position, y) => {
    const scrollY = y ?? await evaluate('scrollY');
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = `${name}-${position}.png`;
    await writeFile(join(output, file), Buffer.from(data, 'base64'));
    screenshots.push({ file, scrollY });
  };
  chrome.listen(sessionId, (method, params) => {
    if (method === 'Fetch.requestPaused') {
      if (root) serveRequest(send, params, root, page, errors).catch((error) => errors.add(`리소스 제공 오류 · ${error.message}`));
      else serveRemote(send, params, page, errors).catch((error) => errors.add(error.message));
    } else if (responses && method === 'Network.responseReceived') {
      const { response, type } = params;
      const url = new URL(response.url);
      if (url.origin === page.origin) {
        const entry = { path: url.pathname, type, status: response.status, headers: selectedHeaders(Object.entries(response.headers)) };
        responseById.set(params.requestId, entry);
        responses.push(entry);
      }
    } else if (responses && method === 'Network.loadingFinished') {
      const entry = responseById.get(params.requestId);
      if (entry) entry.encodedBytes = params.encodedDataLength;
    } else if (responses && method === 'Network.loadingFailed' && !params.canceled) {
      errors.add(`원격 리소스 로딩 실패 · ${params.type} · ${params.errorText}`);
    } else if (method === 'Runtime.exceptionThrown') {
      const detail = params.exceptionDetails;
      errors.add((detail.exception?.description ?? detail.text).split('\n')[0]);
    } else if (method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(params.type)) {
      errors.add(`console.${params.type} · ${params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ')}`);
    } else if (responses && method === 'Runtime.consoleAPICalled' && params.type === 'warning') {
      const message = params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ');
      if (isPermissionsWarning(message)) errors.add(`Permissions-Policy 콘솔 경고 · ${message}`);
    } else if (method === 'Log.entryAdded' && params.entry.level === 'error') {
      errors.add(`Chrome 로그 · ${params.entry.text}`);
    } else if (responses && method === 'Log.entryAdded' && isPermissionsWarning(params.entry.text)) {
      errors.add(`Permissions-Policy 경고 · ${params.entry.text}`);
    } else if (method === 'Page.frameNavigated' && !params.frame.parentId && params.frame.url !== 'about:blank') {
      inspectAddress(params.frame.url);
    } else if (method === 'Page.navigatedWithinDocument' && params.navigationType === 'historyApi') {
      inspectAddress(params.url);
    } else if (voteUrl && method === 'Page.windowOpen') {
      errors.add('C11 한 장 위반 · 검사 동작 중 새 창이 열렸습니다.');
    } else if (method === 'Inspector.targetCrashed') {
      errors.add('Chrome 렌더러가 종료되었습니다.');
    }
  });

  try {
    await send('Page.enable');
    if (scenario) await send('Page.bringToFront');
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Inspector.enable');
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Fetch.enable');
    await send('Performance.enable', { timeDomain: 'timeTicks' });
    await send('Emulation.setDeviceMetricsOverride', {
      width: view.width, height: view.height, deviceScaleFactor: 1, mobile: Boolean(view.mobile),
      screenOrientation: view.width > view.height
        ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 },
    });
    await send('Emulation.setTouchEmulationEnabled', { enabled: Boolean(view.mobile) });
    if (scenario?.view.mobile) await send('Emulation.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
    });
    if (view.cpu) await send('Emulation.setCPUThrottlingRate', { rate: view.cpu });
    if (view.reducedMotion) await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installObservers.toString()})();` });
    if (c11) await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installC11Probes.toString()})();` });
    if (scenario) await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(${installV03Probes.toString()})(${JSON.stringify(scenario)});`,
    });

    const started = performance.now();
    const navigation = await send('Page.navigate', { url: page.href });
    if (navigation.errorText) throw new Error(navigation.errorText);
    while (!await evaluate('document.readyState === "complete" && Boolean(window.__landingthonQa)')) {
      if (performance.now() - started > 10000) throw new Error('문서 로딩 시간 초과');
      await pause(100);
    }
    await pause(Math.max(0, 3000 - (performance.now() - started)));
    if (responses) {
      const meta = await evaluate(`({
        image: document.querySelector('meta[property="og:image"]')?.content,
        canonical: document.querySelector('link[rel="canonical"]')?.href,
        ogUrl: document.querySelector('meta[property="og:url"]')?.content,
      })`);
      auditDeploymentMeta(meta, page, errors);
    }
    const { metrics: devtoolsMetrics } = await send('Performance.getMetrics');
    const duration = devtoolsMetrics.find(({ name }) => name === 'ScriptDuration')?.value;
    const { lcpMs, cls } = await evaluate('window.__landingthonQa');
    metrics = { lcpMs, cls, scriptMs: duration === undefined ? null : Math.round(duration * 1000) };
    for (const [key, limit] of [['lcpMs', 2500], ['cls', 0.1], ['scriptMs', view.cpu ? 500 : 250]]) {
      if (metrics[key] === null || metrics[key] > limit) {
        warnings.push(`${key} ${metrics[key] ?? '미측정'} · 기준 ${limit}`);
      }
    }

    if (scenario) {
      await inspectV03({ scenario, send, evaluate, evidence: features, errors });
    } else if (c11) {
      await inspectC11({ view, page, voteUrl, send, evaluate, capture, errors, evidence: c11 });
    } else {
      const scrollHeight = await evaluate('Math.max(0, document.scrollingElement.scrollHeight - innerHeight)');
      const positions = [['top', 0]];
      if (scrollHeight > 0) positions.push(['middle', Math.round(scrollHeight / 2)], ['bottom', scrollHeight]);
      for (const [position, y] of positions) {
        await evaluate(`window.scrollTo({ top: ${y}, behavior: 'instant' })`);
        await pause(200);
        const layout = await evaluate(`({
          layoutWidth: document.documentElement.clientWidth,
          scrollWidth: document.scrollingElement.scrollWidth,
          y: scrollY
        })`);
        if (layout.scrollWidth > layout.layoutWidth + 1 || layout.layoutWidth > view.width + 1) {
          errors.add(`가로 넘침/뷰포트 불일치 · ${position} (${layout.scrollWidth}/${layout.layoutWidth}px, 목표 ${view.width}px)`);
        }
        await capture(position, layout.y);
      }
    }
  } catch (error) {
    errors.add(error.message);
  } finally {
    chrome.unlisten(sessionId);
    if (context.browserContextId) await chrome.send('Target.disposeBrowserContext', context);
    else await chrome.send('Target.closeTarget', { targetId });
  }

  const deployment = responses ? auditDeploymentResponses(responses, page, errors, warnings) : undefined;
  return { name, viewport: view, metrics, screenshots, c11, features, deployment, warnings, errors: [...errors] };
}

async function main() {
  const [directory, outputDirectory, pageUrl = 'https://qa.invalid/', voteUrl, ...options] = process.argv.slice(2);
  const remote = options.includes('--remote');
  const v03 = options.includes('--v03');
  const root = remote ? null : await realpath(directory);
  const page = remote ? deploymentUrl(pageUrl) : new URL(pageUrl);
  const executable = findChrome();
  const outBase = resolve(outputDirectory);
  await mkdir(outBase, { recursive: true });
  if (await realpath(outBase) !== outBase) throw new Error('출력 폴더는 일반 디렉터리여야 합니다.');
  const output = await mkdtemp(join(outBase, 'run-'));
  const profile = await mkdtemp(join(output, 'profile-'));
  const chrome = openChrome(executable, profile, { offline: !remote });
  const views = [];
  const v03Results = [];
  let missingRoute;
  let deploymentFiles;
  console.log(`Chrome 결과 · ${output}`);
  try {
    const { product } = await chrome.send('Browser.getVersion');
    if (remote) {
      const [missing, files] = await Promise.all([probeMissing(page), probeDeploymentFiles(page, { v03 })]);
      const browser = await inspectMissingPage(chrome, page, missing.path);
      missingRoute = { ...missing, browser, ok: missing.ok && browser.ok };
      deploymentFiles = files;
      console.log(`배포 404 ${missingRoute.ok ? 'PASS' : 'FAIL'} · ${missing.status ?? missing.error} · 최종 ${browser.finalUrl ?? '미확인'}`);
      for (const error of browser.errors) console.log(`  실패 · ${error}`);
      for (const [name, result] of Object.entries(files)) {
        console.log(`배포 ${name} ${result.ok ? 'PASS' : 'FAIL'} · ${result.error ?? result.status}${result.missingGlyphs ? ` · 누락 ${result.missingGlyphs}` : ''}`);
      }
    }
    const writeReport = () => writeFile(join(output, 'report.json'), JSON.stringify({
      chrome: product, url: remote ? page.href : undefined, missingRoute, deploymentFiles, views, v03: v03 ? v03Results : undefined,
    }, null, 2) + '\n');
    for (const view of voteUrl ? c11Viewports : viewports) {
      const result = await inspectViewport(chrome, view, root, page, output, voteUrl);
      views.push(result);
      console.log(`${result.name} ${result.errors.length ? 'FAIL' : 'PASS'} · PNG ${result.screenshots.length}장`, result.metrics ?? '');
      for (const error of result.errors) console.log(`  실패 · ${error}`);
      for (const warning of result.warnings) console.log(`  검토 · ${warning}`);
      await writeReport();
    }
    if (v03) {
      for (const scenario of v03Cases) {
        const result = await inspectViewport(chrome, scenario.view, root, page, output, voteUrl, scenario);
        v03Results.push(result);
        console.log(`${result.name} ${result.errors.length ? 'FAIL' : 'PASS'}`);
        for (const error of result.errors) console.log(`  실패 · ${error}`);
        await writeReport();
      }
    }
  } catch (error) {
    throw new Error([error.message, chrome.log()].filter(Boolean).join('\n'));
  } finally {
    await chrome.close();
    await rm(profile, { force: true, recursive: true });
  }
  const failed = views.filter((view) => view.errors.length).length;
  console.log(`${voteUrl ? 'C11 ' : ''}Chrome 검사 ${failed ? 'FAIL' : 'PASS'} · ${views.length}개 조건 · 실패 ${failed}개`);
  const v03Failed = v03Results.filter((view) => view.errors.length).length;
  if (v03) console.log(`v0.3 기능 검사 ${v03Failed ? 'FAIL' : 'PASS'} · ${v03Results.length}개 · 실패 ${v03Failed}개`);
  const remoteFailed = remote && (!missingRoute?.ok || Object.values(deploymentFiles).some(({ ok }) => !ok));
  return failed || v03Failed || remoteFailed ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`Chrome 실행 환경 오류 · ${error.message}`);
    process.exitCode = 3;
  }
}
