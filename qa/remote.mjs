import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const headerNames = new Set([
  'content-type', 'cache-control', 'age', 'etag', 'last-modified', 'expires', 'vary', 'content-encoding',
  'cf-cache-status', 'content-security-policy', 'x-content-type-options', 'referrer-policy',
  'permissions-policy', 'strict-transport-security', 'x-frame-options',
  'content-length', 'location', 'x-robots-tag',
]);

export function deploymentUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || (!url.pathname.endsWith('/') && !url.pathname.endsWith('/index.html'))) {
    throw new Error('--url에는 HTTPS 배포 디렉터리 또는 index.html 주소를 지정하세요.');
  }
  const host = url.hostname.replace(/\.$/, '');
  if (host === 'hackathon.parallax.kr' || host.endsWith('.hackathon.parallax.kr')) {
    throw new Error('--url의 대상은 작품 배포 주소입니다.');
  }
  return url;
}

export function selectedHeaders(entries) {
  return Object.fromEntries([...entries].map(([key, value]) => [key.toLowerCase(), String(value)])
    .filter(([key]) => headerNames.has(key)));
}

export function allowRequest(request, page) {
  return new URL(request.url).origin === page.origin && ['GET', 'HEAD'].includes(request.method);
}

export async function probeMissing(page, request = fetch) {
  const url = new URL('no/such/path', new URL('./', page));
  try {
    const response = await request(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000) });
    const returns = (await response.text()).match(/\blocation\.replace\s*\(/g)?.length ?? 0;
    return { path: url.pathname, status: response.status, headers: selectedHeaders(response.headers), returns,
      ok: response.status === 404 && returns === 1 };
  } catch (error) {
    return { path: url.pathname, status: null, ok: false, error: error.message };
  }
}

export async function probeDeploymentFiles(page, { v03 = false, request = fetch } = {}) {
  const home = new URL('./', page);
  const checks = [
    { key: 'indexAlias', path: 'index.html', method: 'HEAD', pass: ({ status, headers }) =>
      [301, 302, 303, 307, 308].includes(status) && Boolean(headers.location)
        && new URL(headers.location, home).href === home.href },
    { key: 'headersFile', path: '_headers', method: 'GET', pass: ({ status }) => status === 404 },
    { key: 'font', path: 'fonts/hahmlet-subset.woff2', method: v03 ? 'GET' : 'HEAD', pass: ({ status, headers }) =>
      status === 200 && /^font\/woff2\b/i.test(headers['content-type'] ?? '') },
    { key: 'entry', path: 'modules/main.js', method: 'GET', pass: ({ status, headers }) =>
      status === 200 && /^(br|gzip)$/i.test(headers['content-encoding'] ?? '') },
  ];
  return Object.fromEntries(await Promise.all(checks.map(async ({ key, path, method, pass }) => {
    const url = new URL(path, home);
    try {
      const response = await request(url, { method, redirect: 'manual', signal: AbortSignal.timeout(8000),
        headers: key === 'entry' ? { 'Accept-Encoding': 'br, gzip' } : undefined });
      const report = { path: url.pathname, status: response.status, headers: selectedHeaders(response.headers) };
      report.ok = pass(report);
      if (key === 'font' && v03 && report.ok) {
        const script = fileURLToPath(new URL('./font_coverage.py', import.meta.url));
        const result = spawnSync('python3', [script], { input: Buffer.from(await response.arrayBuffer()), encoding: 'utf8', timeout: 10000 });
        if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr.trim());
        report.missingGlyphs = JSON.parse(result.stdout).missing;
        report.ok = !report.missingGlyphs;
      } else await response.body?.cancel();
      if (key === 'entry') report.compressedBytes = report.headers['content-length'] ? Number(report.headers['content-length']) : null;
      return [key, report];
    } catch (error) {
      return [key, { path: url.pathname, ok: false, error: error.message }];
    }
  })));
}

export const isPermissionsWarning = (message) => /permissions?[- ]policy/i.test(message);

export function auditDeploymentMeta({ image, canonical, ogUrl }, page, errors) {
  let secureImage = false;
  try { secureImage = /^https:\/\//i.test(image) && new URL(image).protocol === 'https:'; } catch { /* URL 형식 오류 */ }
  if (!secureImage) errors.add('배포 og:image가 HTTPS 절대 주소가 아닙니다.');
  const home = new URL('./', page);
  for (const [key, value] of [['canonical', canonical], ['og:url', ogUrl]]) {
    if (value && value !== home.href) errors.add(`배포 ${key} 값이 작품 루트 주소와 일치하지 않습니다.`);
  }
}

export function auditDeploymentResponses(responses, page, errors, warnings) {
  const landing = responses.find(({ type, path }) => type === 'Document'
    && [page.pathname, new URL('./', page).pathname, new URL('index.html', page).pathname].includes(path));
  if (!landing) errors.add('원격 문서 응답을 관측하지 못했습니다.');
  else {
    if (landing.status < 200 || landing.status >= 300 || !/^text\/html\b/i.test(landing.headers['content-type'] ?? '')) {
      errors.add(`원격 문서 HTTP/Content-Type 오류 · ${landing.status} · ${landing.headers['content-type'] ?? '없음'}`);
    }
    if (!landing.headers['cache-control']) warnings.push('원격 문서 Cache-Control 미지정');
    const headers = landing.headers;
    if (headers['x-content-type-options']?.toLowerCase() !== 'nosniff') errors.add('배포 X-Content-Type-Options에 nosniff가 없습니다.');
    for (const header of ['referrer-policy', 'permissions-policy', 'content-security-policy']) {
      if (!headers[header]) errors.add(`배포 헤더 누락 · ${header}`);
    }
    const preview = /^(?:[^.]+\.){2}pages\.dev$/i.test(page.hostname);
    if (preview && !/\bnoindex\b/i.test(headers['x-robots-tag'] ?? '')) errors.add('미리보기 배포 X-Robots-Tag에 noindex가 없습니다.');
    if (!preview && headers['x-robots-tag']) errors.add('프로덕션 응답에 X-Robots-Tag가 설정됐습니다.');
  }
  const cacheableTypes = new Set(['Script', 'Stylesheet', 'Font', 'Image']);
  const assets = responses.filter(({ type }) => cacheableTypes.has(type));
  const withoutCache = assets.filter(({ headers }) => !headers['cache-control'] && !headers.expires);
  if (withoutCache.length) warnings.push(`캐시 만료 정책 미지정 리소스 ${withoutCache.length}개`);
  for (const { path, status } of responses) {
    if (status >= 400) errors.add(`원격 리소스 HTTP ${status} · ${path}`);
  }
  return { landing, assets: assets.length, withoutCache: withoutCache.map(({ path }) => path), responses };
}
