// Hahmlet 서브셋 받기 — lt-opus-design
// 실행: node site/fonts/fetch-hahmlet.mjs   (프로젝트 루트에서. 문구가 바뀌면 다시 실행)
// 1) 화면 문자열(index.html, site/ui·modules의 JS, FINAL-STORY 10절 카피 덱·6.3절 유형 카피)에서 글자를 모은다.
// 2) Google Fonts CSS2 API의 text= 서브셋(가변 wght 100..900)을 woff2로 받는다.
// 3) google/fonts 저장소의 OFL.txt 원문을 받는다. 결과는 subset-info.json에 남긴다.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = p => existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '';
// v0.7 F3: 주석 글자는 화면에 안 나온다 → 빼고 모은다(주석까지 모아 서브셋이 75자·20KB 불었다). HTML은 <!-- -->, JS는 따옴표·템플릿을
// 존중하는 간단한 훑기로 // 줄 주석과 /* */ 묶음 주석을 뺀다(정규식 리터럴 속 따옴표는 드묾 — 빠진 글자는 qa/font_coverage.py가 잡는다)
const stripHtml = s => s.replace(/<!--[\s\S]*?-->/g, '');
function stripJs(src) {
  let out = '', q = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (q) { out += c; if (c === '\\') { out += n ?? ''; i++; } else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e - 1; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 1; continue; }
    out += c;
  }
  return out;
}
const jsIn = dir => existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter(f => f.endsWith('.js')).map(f => stripJs(read(join(dir, f)))).join('\n') : '';

const story = read('concepts/FINAL-STORY.md');
const section = (from, to) => { const a = story.indexOf(from); const b = story.indexOf(to, a + 1); return a < 0 ? '' : story.slice(a, b < 0 ? undefined : b); };
const corpus = [
  stripHtml(read('site/index.html')), jsIn('site/ui'), jsIn('site/modules'), jsIn('site/modules/engines'),
  section('## 10. 전체 카피 덱', '## 11.'), section('### 6.3 유형 카피', '### 6.4'),
  '0123456789%−→·…「」‘’“”—–△☎~()[]{}#?!.,:;/\\-+=_*&@\'"<>|'
].join('\n').normalize('NFC');

const keep = ch => {
  const c = ch.codePointAt(0);
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0x3131 && c <= 0x318e) ||
    '·…「」‘’“”—–−→↓↑△☎⟲'.includes(ch);   // ↑: v0.4 S6-12b 카피 덱 표기(화면은 SVG 화살표)
};
const chars = [...new Set([...corpus].filter(keep))].sort();
const text = chars.join('');
const hangul = chars.filter(c => c >= '가' && c <= '힣').length;
if (process.argv.includes('--dry')) {   // 받지 않고 지금 font-copy.txt와의 차이만
  const old = new Set([...read('site/fonts/font-copy.txt').trim()]);
  console.log(JSON.stringify({ characters: chars.length, hangul, added: chars.filter(c => !old.has(c)).join(''), removed: [...old].filter(c => !chars.includes(c)).join('') }));
  process.exit(0);
}

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const api = new URL('https://fonts.googleapis.com/css2');
api.searchParams.set('family', 'Hahmlet:wght@100..900');
api.searchParams.set('text', text);
api.searchParams.set('display', 'swap');

const css = await (await fetch(api, { headers: { 'User-Agent': UA } })).text();
const urls = [...css.matchAll(/url\((https:[^)]+)\)\s*format\('woff2'\)/g)].map(m => m[1]);
if (urls.length !== 1) { console.error(css); throw new Error(`woff2 주소를 1개 기대했는데 ${urls.length}개입니다.`); }
const font = Buffer.from(await (await fetch(urls[0], { headers: { 'User-Agent': UA } })).arrayBuffer());
if (font.subarray(0, 4).toString('latin1') !== 'wOF2') throw new Error('woff2 파일이 아닙니다.');
writeFileSync(join(here, 'hahmlet-subset.woff2'), font);

const ofl = await (await fetch('https://raw.githubusercontent.com/google/fonts/main/ofl/hahmlet/OFL.txt')).text();
if (!/SIL OPEN FONT LICENSE/i.test(ofl)) throw new Error('OFL.txt 내용을 확인하지 못했습니다.');
writeFileSync(join(here, 'OFL.txt'), ofl);

const info = {
  family: 'Hahmlet', axes: 'wght 100..900', license: 'SIL Open Font License 1.1',
  copyright: ofl.split('\n')[0].trim(),
  // 예약 글꼴 이름은 라이선스 전문 앞 머리말(저작권 줄)에 "with Reserved Font Name"으로 선언된다
  reservedFontName: (/with Reserved Font Name[^\n]*/i.exec(ofl.split('-----')[0]) || [null])[0],
  source: 'Google Fonts CSS2 API (text= subset), OFL: github.com/google/fonts/ofl/hahmlet/OFL.txt',
  fetchedAt: new Date().toISOString(), characters: chars.length, hangulSyllables: hangul, bytes: font.length,
  cssWeight: (css.match(/font-weight:\s*([^;]+);/) || [])[1] || null
};
writeFileSync(join(here, 'subset-info.json'), JSON.stringify(info, null, 2) + '\n');
writeFileSync(join(here, 'font-copy.txt'), text + '\n');
console.log(JSON.stringify(info, null, 2));
