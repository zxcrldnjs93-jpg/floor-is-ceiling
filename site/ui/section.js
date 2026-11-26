/* 「중력을 뒤집으면」 시각 층 — 단면도 그리기 (lt-opus-design, 의존성 없음, 고전 스크립트)
   좌표는 무대(장면 패널) 기준 CSS px. 물건 함수의 원점은 "바닥에 닿는 점(아래 가운데)", 위쪽이 음수 y.
   색은 tokens.css의 CSS 변수를 클래스로 읽는다(styles/site.css의 SVG 클래스). */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const Art = (window.LandingArt = window.LandingArt || {});
  let uid = 0;

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    // 낮은 뷰포트에서 계산이 음수가 돼도 rect 크기는 0 아래로 내려가지 않게(B2)
    if (attrs && tag === 'rect') ['width', 'height'].forEach(k => { if (attrs[k] != null && +attrs[k] < 0) attrs[k] = 0; });
    if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const g = (p, a) => el('g', a || {}, p);
  const pts = (arr, s = 1) => arr.map(([x, y]) => `${(x * s).toFixed(1)},${(y * s).toFixed(1)}`).join(' ');

  /* 패턴·그라데이션은 문서에 한 번만(숨기지 않은 0×0 SVG). 회전 거울 복제본도 같은 정의를 쓴다 */
  function globalDefs() {
    if (document.getElementById('lt-art-defs')) return;
    const svg = el('svg', { id: 'lt-art-defs', width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false', style: 'position:absolute;width:0;height:0;overflow:hidden' });
    svg.innerHTML = `<defs>
      <pattern id="pat-concrete" width="30" height="30" patternUnits="userSpaceOnUse">
        <rect width="30" height="30" class="f-concrete"/>
        <path class="f-aggregate" d="M4 9 l3.2 -4.6 l3.2 4.6z M18 22 l2.6 -3.8 l2.6 3.8z M21 7 l2.2 -3.2 l2.2 3.2z M7 27 l1.8-2.6 l1.8 2.6z"/>
        <circle class="f-aggregate" cx="13" cy="14" r="1.1"/><circle class="f-aggregate" cx="27" cy="15" r=".8"/>
        <circle class="f-aggregate" cx="25" cy="27" r=".9"/><circle class="f-aggregate" cx="3" cy="18" r=".7"/>
        <circle class="f-aggregate" cx="15" cy="3" r=".6"/>
      </pattern>
      <pattern id="pat-soft" width="14" height="9" patternUnits="userSpaceOnUse">
        <rect width="14" height="9" class="f-soft-tint"/>
        <path class="s-soft" d="M0 4.5 C 1.8 0.5, 5.2 0.5, 7 4.5 S 12.2 8.5, 14 4.5"/>
      </pattern>
      <pattern id="pat-wood" width="46" height="8" patternUnits="userSpaceOnUse">
        <rect width="46" height="8" class="f-wood"/><path class="s-grain" d="M0 3 H20 M25 5.5 H46"/>
      </pattern>
      <pattern id="pat-mortar" width="9" height="9" patternUnits="userSpaceOnUse">
        <rect width="9" height="9" class="f-mortar"/>
        <circle class="f-aggregate" cx="2.5" cy="3" r=".6"/><circle class="f-aggregate" cx="7" cy="7" r=".5"/>
      </pattern>
      <pattern id="pat-wall" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="9" height="9" class="f-concrete"/><line x1="0" y1="0" x2="0" y2="9" class="s-hatch"/>
      </pattern>
      <linearGradient id="grad-cone" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" class="stop-lamp" stop-opacity=".5"/><stop offset="1" class="stop-lamp" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="grad-kung" cx=".5" cy=".5" r=".5">
        <stop offset="0" class="stop-kung" stop-opacity=".42"/><stop offset="1" class="stop-kung" stop-opacity="0"/>
      </radialGradient></defs>`;
    document.body.prepend(svg);
  }

  /* 바닥 구조 한 벌: 마루 → 몰탈 → 완충재 → 슬래브 → 천장 속 → 천장판. y = 위층 바닥 마감선 */
  function floorStack(p, x0, x1, y, opt = {}) {
    const s = opt.scale || 1, slab = opt.slab || 40 * s;
    const layers = [['wood', 6 * s], ['mortar', 11 * s], ['soft', 8 * s], ['concrete', slab]];
    const grp = g(p, { class: 'floor-stack' });
    let yy = y; const edges = [y];
    layers.forEach(([k, h]) => { el('rect', { x: x0, y: yy, width: x1 - x0, height: h, fill: `url(#pat-${k})` }, grp); yy += h; edges.push(yy); });
    edges.slice(1, -1).forEach(e => el('line', { x1: x0, y1: e, x2: x1, y2: e, class: 'ln-thin' }, grp));
    el('line', { x1: x0, y1: y, x2: x1, y2: y, class: 'ln-cut' }, grp);
    el('line', { x1: x0, y1: yy, x2: x1, y2: yy, class: 'ln-cut' }, grp);
    const plenum = opt.plenum ?? 7 * s, board = 4 * s;
    el('rect', { x: x0, y: yy + plenum, width: x1 - x0, height: board, class: 'f-paper' }, grp);
    el('line', { x1: x0, y1: yy + plenum, x2: x1, y2: yy + plenum, class: 'ln-beyond' }, grp);
    el('line', { x1: x0, y1: yy + plenum + board, x2: x1, y2: yy + plenum + board, class: 'ln-cut' }, grp);
    for (let x = x0 + 60 * s; x < x1; x += 180 * s) el('line', { x1: x, y1: yy, x2: x, y2: yy + plenum, class: 'ln-thin' }, grp);
    return { floor: y, soft: edges[3], slabTop: edges[3], slabBottom: yy, ceiling: yy + plenum + board };
  }

  function wall(p, x, y0, y1, w) {
    const grp = g(p);
    el('rect', { x, y: y0, width: w, height: y1 - y0, fill: 'url(#pat-wall)' }, grp);
    el('line', { x1: x, y1: y0, x2: x, y2: y1, class: 'ln-cut' }, grp);
    el('line', { x1: x + w, y1: y0, x2: x + w, y2: y1, class: 'ln-cut' }, grp);
    return grp;
  }

  function windowEl(p, x, y, w, h, s = 1) {
    const grp = g(p, { class: 'window' });
    if (h < 40 * s || w < 40 * s) return grp;   // 들어갈 자리가 없으면 창은 그리지 않는다
    el('rect', { x, y, width: w, height: h, class: 'ln-beyond' }, grp);
    el('rect', { x: x + 6 * s, y: y + 6 * s, width: w - 12 * s, height: h - 12 * s, class: 'ln-thin' }, grp);
    el('line', { x1: x + w / 2, y1: y + 6 * s, x2: x + w / 2, y2: y + h - 6 * s, class: 'ln-beyond' }, grp);
    el('line', { x1: x - 10 * s, y1: y + h + 3 * s, x2: x + w + 10 * s, y2: y + h + 3 * s, class: 'ln-beyond' }, grp);
    for (let i = 0; i < 4; i++) {
      const cx = x + w - 10 * s - i * 9 * s;
      let d = `M${cx},${y - 4 * s}`;
      for (let yy = 0; yy <= h * 0.92; yy += 16 * s) d += ` Q${cx + (i % 2 ? 4 : -4) * s},${y + yy + 8 * s} ${cx},${y + yy + 16 * s}`;
      el('path', { d, class: 'ln-thin' }, grp);
    }
    el('line', { x1: x - 14 * s, y1: y - 6 * s, x2: x + w + 14 * s, y2: y - 6 * s, class: 'ln-beyond' }, grp);
    return grp;
  }

  function outlet(p, x, y, s = 1) {
    const grp = g(p, { class: 'outlet' });
    el('rect', { x: x - 8 * s, y: y - 12 * s, width: 16 * s, height: 24 * s, rx: 2 * s, class: 'ln-beyond f-paper' }, grp);
    el('circle', { cx: x - 3 * s, cy: y, r: 1.4 * s, class: 'f-ink' }, grp);
    el('circle', { cx: x + 3 * s, cy: y, r: 1.4 * s, class: 'f-ink' }, grp);
    return grp;
  }

  function level(p, x, y, label, s = 1, below = false) {
    const grp = g(p, { class: 'level' });
    const t = 7 * s;
    el('path', { d: below ? `M${x - t},${y + t * 1.2} L${x + t},${y + t * 1.2} L${x},${y} Z` : `M${x - t},${y - t * 1.2} L${x + t},${y - t * 1.2} L${x},${y} Z`, class: 'ln-beyond f-paper' }, grp);
    el('line', { x1: x - t * 1.8, y1: below ? y + t * 1.2 : y - t * 1.2, x2: x + 70 * s, y2: below ? y + t * 1.2 : y - t * 1.2, class: 'ln-thin' }, grp);
    const tx = el('text', { x: x + t * 1.6, y: below ? y + t * 1.2 + 14 * s : y - t * 1.2 - 5 * s, class: 'svg-annot' }, grp);
    tx.textContent = label;
    return grp;
  }

  function leader(p, x0, y0, x1, y1, x2) {
    const grp = g(p, { class: 'leader' });
    el('circle', { cx: x0, cy: y0, r: 2.6, class: 'f-ink' }, grp);
    el('path', { d: `M${x0},${y0} L${x1},${y1} L${x2},${y1}`, class: 'ln-thin ln-leader' }, grp);
    return grp;
  }

  /* ── 물건(입면 선화) ── */
  function ball(p, cx, cy, r, rot = 0) {
    const b = g(p, { class: 'ball', transform: `translate(${cx} ${cy}) rotate(${rot})` });
    el('circle', { r, class: 'f-kung ln-body' }, b);
    el('path', { d: `M${-r * .95},${-r * .18} C${-r * .35},${r * .42} ${r * .35},${r * .42} ${r * .95},${-r * .18}`, class: 'ln-body', fill: 'none', 'stroke-width': 1.2 }, b);
    el('path', { d: `M${-r * .58},${-r * .52} A${r * .7},${r * .7} 0 0 1 ${-r * .08},${-r * .8}`, fill: 'none', stroke: '#fff', 'stroke-width': Math.max(1.5, r * .12), 'stroke-linecap': 'round', opacity: .8 }, b);
    return b;
  }

  function chair(p, x, y, s = 1, rot = 0) {
    const c = g(p, { class: 'chair', transform: `translate(${x} ${y}) rotate(${rot})` });
    [
      [[-30, 0], [-23, 0], [-19, -56], [-23, -118], [-31, -118], [-27, -56]],
      [[-31, -61], [33, -61], [33, -52], [-31, -52]],
      [[24, -52], [31, -52], [30, 0], [24, 0]],
      [[-24, -21], [26, -21], [26, -17], [-24, -17]],
      [[-30, -108], [-20, -108], [-20, -84], [-29, -84]]
    ].forEach(pp => el('polygon', { points: pts(pp, s), class: 'f-wood s-wood' }, c));
    el('line', { x1: -24 * s, y1: -57 * s, x2: 22 * s, y2: -57 * s, class: 's-grain' }, c);
    return c;
  }

  function cup(p, x, y, s = 1, rot = 0) {
    const c = g(p, { class: 'cup', transform: `translate(${x} ${y}) rotate(${rot}) scale(${s})` });
    el('path', { d: 'M-11,0 L11,0 Q13.5,0 13.8,-3 L15,-30 L-15,-30 L-13.8,-3 Q-13.5,0 -11,0 Z', class: 'f-ceramic ln-body' }, c);
    el('path', { d: 'M14.2,-23 C27,-23 27,-8 13.9,-8', class: 'ln-body', fill: 'none' }, c);
    el('rect', { x: -14.6, y: -22, width: 29.2, height: 4, class: 'f-soft' }, c);
    return c;
  }

  function mug(p, x, y, s = 1, ripple = 0) {
    const grp = g(p, { class: 'mug', transform: `translate(${x} ${y}) scale(${s})` });
    el('path', { d: 'M-12,0 L12,0 L13,-26 L-13,-26 Z', class: 'f-ceramic ln-body' }, grp);
    el('path', { d: 'M12.6,-20 C23,-20 23,-7 12.2,-7', class: 'ln-body', fill: 'none' }, grp);
    for (let i = 0; i < ripple; i++) el('ellipse', { cx: 0, cy: -21, rx: 5 + i * 4, ry: 1.4 + i * .5, fill: 'none', class: 's-kung', 'stroke-width': .9, opacity: .8 - i * .25 }, grp);
    return grp;
  }

  function plant(p, x, y, s = 1, rot = 0) {
    const grp = g(p, { class: 'plant', transform: `translate(${x} ${y}) rotate(${rot}) scale(${s})` });
    el('path', { d: 'M-12,0 L12,0 L15,-24 L-15,-24 Z', class: 'f-wood ln-body' }, grp);
    ['M0,-24 C-4,-44 -20,-50 -24,-58', 'M0,-24 C2,-46 12,-56 20,-62', 'M0,-24 C0,-40 -2,-56 2,-70'].forEach(d => el('path', { d, class: 's-leaf' }, grp));
    [[-24, -58, -30], [20, -62, 30], [2, -70, 0]].forEach(([lx, ly, a]) => el('ellipse', { cx: lx, cy: ly, rx: 9, ry: 4.5, transform: `rotate(${a} ${lx} ${ly})`, class: 'f-soft' }, grp));
    return grp;
  }

  function cabinet(p, x, y, w, h, s = 1) {
    const c = g(p, { class: 'cabinet' });
    el('rect', { x: x - w / 2, y: y - h, width: w, height: h, class: 'ln-beyond f-paper' }, c);
    el('line', { x1: x, y1: y - h + 6 * s, x2: x, y2: y - 6 * s, class: 'ln-thin' }, c);
    el('line', { x1: x - 8 * s, y1: y - h / 2, x2: x - 4 * s, y2: y - h / 2, class: 'ln-beyond' }, c);
    el('line', { x1: x + 4 * s, y1: y - h / 2, x2: x + 8 * s, y2: y - h / 2, class: 'ln-beyond' }, c);
    return c;
  }

  function desk(p, x, y, w, s = 1) {
    const grp = g(p, { class: 'desk' });
    const top = y - 98 * s;
    el('rect', { x, y: top, width: w, height: 6 * s, class: 'ln-beyond f-paper' }, grp);
    el('line', { x1: x + 8 * s, y1: top + 6 * s, x2: x + 8 * s, y2: y, class: 'ln-beyond' }, grp);
    el('line', { x1: x + w - 8 * s, y1: top + 6 * s, x2: x + w - 8 * s, y2: y, class: 'ln-beyond' }, grp);
    return { grp, top };
  }

  /* 6층 노트북(정면). quiet=true면 회의가 끝나 화면이 꺼짐. '…?'는 별도 요소(data-react)로 켠다 */
  function laptop(p, x, y, s = 1, opt = {}) {
    const grp = g(p, { class: 'laptop' + (opt.quiet ? ' is-quiet' : ''), transform: `translate(${x} ${y}) scale(${s})` });
    el('path', { d: 'M-46,0 L46,0 L52,6 L-52,6 Z', class: 'f-ink' }, grp);
    el('rect', { x: -42, y: -62, width: 84, height: 60, rx: 3, class: 'f-ink ln-body' }, grp);
    el('rect', { x: -37, y: -57, width: 74, height: 50, class: 'screen' }, grp);
    const call = g(grp, { class: 'call' });
    [[-36, -56], [1, -56], [-36, -31], [1, -31]].forEach(([tx, ty], i) => {
      el('rect', { x: tx, y: ty, width: 35, height: 23, class: i === 0 ? 'tile tile-me' : 'tile' }, call);
      el('circle', { cx: tx + 17.5, cy: ty + 10, r: 4.2, class: 'tile-face' }, call);
      el('path', { d: `M${tx + 9},${ty + 23} Q${tx + 17.5},${ty + 13} ${tx + 26},${ty + 23}`, class: 'tile-face' }, call);
    });
    return grp;
  }

  function sofa(p, x, y, w, s = 1) {
    const grp = g(p, { class: 'sofa' });
    const h = 74 * s;
    el('rect', { x, y: y - h, width: w, height: h * .55, rx: 10 * s, class: 'ln-beyond f-paper' }, grp);
    el('rect', { x: x - 8 * s, y: y - h * .62, width: w + 16 * s, height: h * .5, rx: 8 * s, class: 'ln-beyond f-paper' }, grp);
    el('line', { x1: x + w / 2, y1: y - h * .58, x2: x + w / 2, y2: y - h * .14, class: 'ln-thin' }, grp);
    el('line', { x1: x + 6 * s, y1: y - h * .12, x2: x + 6 * s, y2: y, class: 'ln-beyond' }, grp);
    el('line', { x1: x + w - 6 * s, y1: y - h * .12, x2: x + w - 6 * s, y2: y, class: 'ln-beyond' }, grp);
    return grp;
  }

  function parapet(p, x0, x1, y, s = 1) {
    const grp = g(p, { class: 'parapet' });
    const h = 34 * s, w = 14 * s;
    [x0, x1 - w].forEach(x => {
      el('rect', { x, y: y - h, width: w, height: h, fill: 'url(#pat-wall)' }, grp);
      el('rect', { x, y: y - h, width: w, height: h, class: 'ln-cut' }, grp);
    });
    el('line', { x1: x0 + w, y1: y - h * .7, x2: x1 - w, y2: y - h * .7, class: 'ln-beyond' }, grp);
    for (let x = x0 + 90 * s; x < x1 - 40 * s; x += 90 * s) el('line', { x1: x, y1: y - h * .7, x2: x, y2: y, class: 'ln-thin' }, grp);
    return grp;
  }

  // v0.7 F3-10: 화면 글 12 아래 금지(휴대폰 S4 10.1이던 것). min: 축소되는 층(S4 회전층) 안이면 12 ÷ 그 배율
  function roomTag(p, x, y, label, s = 1, min = 12) {
    const grp = g(p, { class: 'roomtag' }), f = Math.max(min, 13 * s);
    const t = el('text', { x, y, class: 'svg-annot svg-roomtag', style: `font-size:${f.toFixed(1)}px` }, grp); t.textContent = label;
    el('line', { x1: x, y1: y + 5 * s, x2: x + label.length * f * 12 / 13, y2: y + 5 * s, class: 'ln-thin' }, grp);
    return grp;
  }

  function canopy(p, x, y, s = 1) { el('rect', { x: x - 11 * s, y, width: 22 * s, height: 5 * s, class: 'ln-beyond f-paper' }, p); }

  /* 펜던트(고정 선화가 아니라 진자 요소 안에 그린다). 원점 = 고정점 */
  function lampFigure(p, len, s = 1, cone = 220) {
    el('path', { d: `M${-36 * s},${len} L${36 * s},${len} L${150 * s},${len + cone * s} L${-150 * s},${len + cone * s} Z`, fill: 'url(#grad-cone)', class: 'lamp-cone' }, p);
    el('line', { x1: 0, y1: 0, x2: 0, y2: len - 28 * s, class: 'ln-cord' }, p);
    el('path', { d: `M${-9 * s},${len - 28 * s} L${9 * s},${len - 28 * s} L${36 * s},${len} L${-36 * s},${len} Z`, class: 'f-paper ln-body' }, p);
    el('ellipse', { cx: 0, cy: len + 2 * s, rx: 10 * s, ry: 5 * s, class: 'f-lamp' }, p);
  }

  /* 쿵 파동(정지 그림). 엔진 파동(.lt-slab-wave-arc)이 없을 때의 결과 프레임에 쓴다 */
  function wave(p, cx, y, k, opt = {}) {
    const s = opt.scale || 1, dir = opt.dir || 1, n = opt.rings || (3 + Math.round(k * 2));
    const id = 'ltclip' + (++uid);
    const cp = el('clipPath', { id }, p);
    const H = opt.depth || 400 * s;
    el('rect', { x: cx - 2000, y: dir > 0 ? y : y - H, width: 4000, height: H }, cp);
    const grp = g(p, { class: 'kung-wave', 'clip-path': `url(#${id})` });
    el('ellipse', { cx, cy: y + dir * 18 * s, rx: (70 + 90 * k) * s, ry: (26 + 26 * k) * s, fill: 'url(#grad-kung)' }, grp);
    for (let i = 0; i < n; i++) {
      const rx = (26 + i * (opt.step || 40)) * s * (0.8 + k * 0.4), ry = rx * 0.52;
      el('path', { d: `M${cx - rx},${y} A${rx},${ry} 0 0 ${dir > 0 ? 0 : 1} ${cx + rx},${y}`, class: 's-kung', 'stroke-width': ((1.2 + 3.6 * k) * (1 - i / (n + 1)) * s).toFixed(2), opacity: ((0.35 + 0.65 * k) * (1 - i / (n + 0.6))).toFixed(2) }, grp);
    }
    return grp;
  }

  /* 파형 띠 위의 쿵 한 번(지진계 모양) */
  function burst(p, x, y, h, k, now, w = 34) {
    const A = (h / 2 - 1.5) * Math.min(1, Math.log1p(k * 9) / Math.log(10));
    let d = `M${x - w / 2},${y}`;
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, env = Math.exp(-3.2 * t) * Math.min(1, t * 8);
      d += ` L${(x - w / 2 + w * t).toFixed(1)},${(y - A * env * Math.sin(t * Math.PI * 7)).toFixed(1)}`;
    }
    return el('path', { d, class: 's-kung burst' + (now ? ' is-now' : '') }, p);
  }

  /* 의자 끌기 한 번(U-07 '드르륵'): 낮고 긴 톱니. 쿵(지진계 한 번)과 모양으로 구별된다 */
  function scrape(p, x, y, h, k, now, w = 52) {
    const A = (h / 2 - 2) * (.3 + .4 * Math.min(1, Math.log1p(k * 9) / Math.log(10)));
    let d = `M${x - w / 2},${y}`;
    for (let i = 1; i <= 20; i++) {
      const t = i / 20, env = 1 - Math.abs(t - .5) * .8;
      d += ` L${(x - w / 2 + w * t).toFixed(1)},${(y + (i % 2 ? -A : A * .55) * env).toFixed(1)}`;
    }
    return el('path', { d, class: 's-kung burst scrape' + (now ? ' is-now' : '') }, p);
  }

  function band(p, x0, x1, y, h) {
    const grp = g(p, { class: 'band' });
    el('rect', { x: x0, y: y - h / 2, width: x1 - x0, height: h, class: 'f-paper band-bg' }, grp);
    el('line', { x1: x0, y1: y - h / 2, x2: x1, y2: y - h / 2, class: 'ln-thin' }, grp);
    el('line', { x1: x0, y1: y + h / 2, x2: x1, y2: y + h / 2, class: 'ln-thin' }, grp);
    el('line', { x1: x0, y1: y, x2: x1, y2: y, class: 'ln-thin', 'stroke-dasharray': '2 3' }, grp);
    return grp;
  }

  /* 같은 사건 표지(U-07): 7층 바닥 위·6층 천장 아래 같은 x */
  function tag(p, x, y, label, value, opt = {}) {
    const grp = g(p, { class: 'tag' + (opt.now ? ' is-now' : '') });
    const up = opt.below ? 1 : -1, drop = opt.drop || 0;   // drop: 지금 표지를 한 줄 내려 옆 표지와 겹치지 않게
    el('line', { x1: x, y1: y, x2: x, y2: y + up * (14 + drop), class: 'ln-thin ln-leader' }, grp);
    const t = el('text', { x: opt.left ? x - 4 : x + 4, y: y + up * ((opt.below ? 26 : 18) + drop), class: 'svg-annot svg-tag', 'text-anchor': opt.left ? 'end' : 'start' }, grp);
    if (opt.fs) t.style.fontSize = opt.fs.toFixed(1) + 'px';   // v0.7 F3-10: 축소되는 층 안의 표지(S4)는 화면에서 12 이상이 되게
    const a = el('tspan', { class: 'tag-n' }, t); a.textContent = label;
    if (value != null) { const b = el('tspan', { dx: 5, class: 'tag-v' }, t); b.textContent = value; }
    // 종이 바탕 칩: 제목 글자·가구 위에 놓여도 읽힌다(v0.2 #9)
    try { const bb = t.getBBox(); if (bb.width) grp.insertBefore(el('rect', { x: bb.x - 4, y: bb.y - 1.5, width: bb.width + 8, height: bb.height + 3, rx: 2, class: 'tag-chip' }), t); } catch (e) { /* 아직 그려지지 않은 SVG */ }
    if (opt.now) el('circle', { cx: x, cy: y, r: 3.2, class: 'f-kung' }, grp);
    return grp;
  }

  /* 바디 하나 = 따로 움직이는 작은 SVG. bbox: [x0, y0, x1, y1] (그림 원점 기준) */
  const BODY = {
    ball: { bbox: s => [-22 * s, -44 * s, 22 * s, 0], draw: (p, s) => ball(p, 0, -22 * s, 22 * s), shape: 'circle' },
    chair: { bbox: s => [-32 * s, -119 * s, 34 * s, 1 * s], draw: (p, s) => chair(p, 0, 0, s), shape: 'hull' },
    cup: { bbox: s => [-16 * s, -31 * s, 26 * s, 1 * s], draw: (p, s) => cup(p, 0, 0, s), shape: 'box' },
    mug: { bbox: s => [-14 * s, -27 * s, 22 * s, 1 * s], draw: (p, s) => mug(p, 0, 0, s), shape: 'box' },
    plant: { bbox: s => [-34 * s, -76 * s, 30 * s, 1 * s], draw: (p, s) => plant(p, 0, 0, s), shape: 'box' }
  };
  function bodySvg(kind, s = 1) {
    const B = BODY[kind], [x0, y0, x1, y1] = B.bbox(s), w = x1 - x0, h = y1 - y0;
    const svg = el('svg', { viewBox: `${x0} ${y0} ${w} ${h}`, width: w.toFixed(1), height: h.toFixed(1), 'aria-hidden': 'true', focusable: 'false' });
    B.draw(svg, s);
    // 바닥 접점(원점)에서 상자 중심까지
    return { svg, w, h, dx: (x0 + x1) / 2, dy: (y0 + y1) / 2, shape: B.shape };
  }

  /* 한글 잉크를 선에 맞추기 */
  function inkMetrics(elm, sample) {
    const cs = getComputedStyle(elm);
    const ctx = (inkMetrics.c ||= document.createElement('canvas').getContext('2d'));
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = ctx.measureText(sample || elm.textContent);
    const F = parseFloat(cs.fontSize), lh = parseFloat(cs.lineHeight) || F;
    const A = m.fontBoundingBoxAscent, D = m.fontBoundingBoxDescent;
    const baseline = (lh - (A + D)) / 2 + A;
    return { baseline, inkTop: baseline - m.actualBoundingBoxAscent, inkBottom: baseline + m.actualBoundingBoxDescent };
  }
  function standOn(elm, lineY, sample) { const m = inkMetrics(elm, sample); elm.style.top = (lineY - m.inkBottom) + 'px'; }
  function hangFrom(elm, lineY, gap, sample) { const m = inkMetrics(elm, sample); elm.style.top = (lineY + (gap || 0) - m.inkTop) + 'px'; }

  Art.draw = { el, g, globalDefs, floorStack, wall, windowEl, outlet, level, leader, ball, chair, cup, mug, plant, cabinet, desk, laptop, sofa, parapet, roomTag, canopy, lampFigure, wave, burst, scrape, band, tag, bodySvg, standOn, hangFrom, inkMetrics };
})();
