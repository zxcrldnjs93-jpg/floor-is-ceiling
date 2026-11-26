/* 「중력을 뒤집으면」 시각 층 — 장면 무대 배치 (lt-opus-design, 고전 스크립트, defer)
   하는 일: 장면마다 단면도(고정 선화)를 그리고, index.html에 있는 훅 요소를 놓는다.
   - [data-physics-body="층:이름"]  바디 상자. 정지 자세 = bindDOM과 같은 규칙
       transform-origin:0 0; transform: translate(cx,cy) rotate(a) translate(-50%,-50%)
       data-cx·cy·w·h·angle(무대 px, 도), data-shape(circle|box|hull), data-pose-flipped="cx,cy,deg"(S4만)
   - [data-physics-lamp="층"]  진자. 고정점 data-ax·ay, 줄 길이 data-len. 각도는 CSS 변수 --lamp-angle
   - [data-wave-layer="A-B"]  윗변 = 맞은 면. A층 바닥에서 B층으로 퍼지는 파동(엔진 .lt-slab-wave-arc)
   - [data-record-strip="A-B"] 슬래브 속 파형 띠. LandingArt.record()가 쿵을 새긴다
   - [data-hit]  바닥 누름 영역(data-action 포함)
   무대 기하는 [data-stage]의 data-geometry(JSON)와 'lt:art-layout' 이벤트(bubbles)로 알린다.
   엔진이 바디를 잡으면 [data-stage]에 data-physics-live를 붙인다 → 이 파일은 그 뒤 바디 transform을 건드리지 않는다. */
(function () {
  const Art = (window.LandingArt = window.LandingArt || {});
  const D = Art.draw;
  const params = new URLSearchParams(location.search);
  const PREVIEW = params.get('preview') || '';   // 시각 점검용: impact | flipped | returned | result
  const records = [];                             // {n, x(0~1), value, slab, label}
  let current = null;
  let s4Since = 0;                                // v0.5 E5: 이번 반전(downstairs가 된 때)의 records 길이 — S4 표지는 그 뒤 기록만
  const slabLabels = {};                          // v0.6 F2 아이디어 ①: setupSlabLabels가 update를 채운다

  const margin = W => Math.min(80, Math.max(20, W * 0.055));
  // 낮은 뷰포트(가로모드 휴대폰 844×390, 낮은 창): styles/site.css의 @media (max-height: 559px)와 같은 기준
  const isShort = H => H < 560;
  const hudH = (W, H) => isShort(H) ? 48 : W <= 720 ? 56 : 64;
  const rad = d => d * Math.PI / 180;
  const poseStr = (cx, cy, deg) => `translate(${cx.toFixed(1)}px,${cy.toFixed(1)}px) rotate(${rad(deg).toFixed(4)}rad) translate(-50%,-50%)`;
  const q = (root, sel) => root.querySelector(sel);
  const qa = (root, sel) => [...root.querySelectorAll(sel)].filter(e => !e.closest('[data-building-mirror]'));

  function place(el, x, y, w, h) {
    if (!el) return;
    el.style.left = x.toFixed(1) + 'px'; el.style.top = y.toFixed(1) + 'px';
    if (w != null) el.style.width = w.toFixed(1) + 'px';
    if (h != null) el.style.height = h.toFixed(1) + 'px';
  }

  function room(stage) {
    let svg = qa(stage, 'svg[data-art-room]')[0];
    svg.replaceChildren();
    const W = stage.clientWidth, H = stage.clientHeight;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    return { svg, g: D.g(svg), W, H };
  }

  /* ───────────── 물리 건물과 같은 자리(B5) ─────────────
     보이는 가구·소품은 전부 물리 바디 요소 자체이고, 놓이는 자리는 엔진의 가구 배치에서 온다.
     엔진 방은 PHYS.width × PHYS.room 단위(proto/physics/building.js: 480×158, 가구는 바닥에 놓임).
     화면 대응: 가로 = 무대 전체 폭(x / width = 무대 폭 비율. 엔진의 공 정렬·클릭 위치·파동·쿵 기록·?debug와 같은 기준),
               세로 = 방마다 바닥 기준. 방이 가로 배율로 잰 높이보다 높으면 바닥 쪽 그 높이만 물리 방으로 쓴다(등방).
     엔진이 LandingArt.physicsLayout(building)을 부르면 실제 값으로 바꾸고 다시 배치한다. 아래 표는 같은 값의 기본값. */
  let PHYS = {
    width: 480, room: 158,
    props: {   // x = 중심, y = 방 윗면에서 중심까지, w·h = 상자(공은 지름)
      '7:ball': { x: 310, y: 144, w: 28, h: 28 },
      '7:chair': { x: 375, y: 126, w: 49, h: 64 },
      '7:cup': { x: 440, y: 149, w: 14, h: 18 },
      '6:chair': { x: 163, y: 127, w: 52, h: 62 },
      '6:mug': { x: 366, y: 149, w: 14, h: 18 },
      '5:plant': { x: 326, y: 134, w: 34, h: 48 },
      'copy:0': { x: 127, y: 46, w: 118, h: 25 },   // 5층에 떠 있는 글 블록
      'copy:1': { x: 290, y: 48, w: 104, h: 24 }    // 7층에 떠 있는 글 블록
    }
  };
  Art.physicsLayout = function (building) {
    try {
      const props = {};
      const add = (id, b, room) => {
        const r = b.shape && b.shape.radius;
        props[id] = { x: b.x, y: b.y - room.top, w: r ? 2 * r : b.right - b.left, h: r ? 2 * r : b.bottom - b.top };
      };
      for (const [id, room] of building.rooms) {
        for (const [name, b] of Object.entries(room.props)) {
          if (name === 'copy') continue;
          add(`${id}:${id === 6 && name === 'cup' ? 'mug' : name}`, b, room);
        }
      }
      building.copyBlocks.forEach((b, i) => add(`copy:${i}`, b, building.rooms.get(i === 0 ? 5 : 7)));
      const r7 = building.rooms.get(7);
      PHYS = { width: building.width, room: r7.bottom - r7.top, props };
      layoutAll();
    } catch (e) { /* 기본표를 그대로 쓴다 */ }
  };
  Art.physicsTable = () => JSON.parse(JSON.stringify(PHYS));

  /* 화면 방 하나 = 물리 방. ceil·floor = 그린 천장판 아랫면·바닥 마감선 */
  function proom(W, ceil, floor, iso) {
    const sx = W / PHYS.width;
    const top = iso ? Math.max(ceil, floor - PHYS.room * sx) : ceil;
    const sy = (floor - top) / PHYS.room;
    return { sx, sy, top, ceil, floor, X: x => x * sx, Y: y => top + y * sy };
  }

  const UNIT = {};
  /* 물리 바디 하나 놓기. 요소 상자: 높이 = 물리 상자 높이(바닥에 닿는다), 폭 = 그림 폭, 중심 = 물리 중심.
     그림은 상자 바닥 가운데(공은 한가운데). opt.fill: 그림 높이 / 상자 높이(컵처럼 물리 상자가 큰 소품) */
  function body(stage, id, kind, R, opt = {}) {
    const el = qa(stage, `[data-physics-body="${id}"]`)[0], p = PHYS.props[id] && Object.assign({}, PHYS.props[id], opt.at);   // opt.at: 이 장면의 정지 자리(S5 낙하 지점)
    if (!el) return null;
    el.hidden = !p;
    if (!p) return null;
    const u = UNIT[kind] || (UNIT[kind] = D.bodySvg(kind, 1));
    const boxW = p.w * R.sx, boxH = p.h * R.sy;
    let s = kind === 'ball' ? Math.min(boxH, 1.25 * boxW) / u.h : Math.min(boxH * (opt.fill || 1) / u.h, 1.6 * boxW / u.w);
    s = Math.max(.2, Math.round(s * 100) / 100);
    const key = `${kind}:${s}:${opt.mirror ? 'm' : ''}`;
    if (el.dataset.artKey !== key) {
      const b = D.bodySvg(kind, s);
      if (opt.mirror) b.svg.classList.add('is-mirror');
      el.replaceChildren(b.svg);
      el._b = b; el.dataset.artKey = key;
    }
    const b = el._b;
    const w = b.w, h = kind === 'ball' ? b.h : Math.max(boxH, b.h);
    const cx = R.X(p.x), cy = R.Y(p.y);
    el.style.width = w.toFixed(1) + 'px'; el.style.height = h.toFixed(1) + 'px';
    Object.assign(el.dataset, { shape: b.shape, w: w.toFixed(1), h: h.toFixed(1), cx: cx.toFixed(1), cy: cy.toFixed(1), angle: '0' });
    el.style.transformOrigin = '0 0';
    if (!stage.hasAttribute('data-physics-live')) el.style.transform = poseStr(cx, cy, 0);
    // 발자국: 정적 그림이 피해야 하는 상자(물리 상자와 그림 중 큰 쪽)
    const fw = Math.max(w, boxW);
    return { el, cx, cy, w, h, x0: cx - fw / 2, x1: cx + fw / 2, y0: cy - h / 2, y1: cy + h / 2 };
  }

  /* 글 블록 바디(S4 무대 블록): 물리 글 블록 중심에 글 상자 중심을 둔다 */
  function textBody(stage, id, R, W, flipped) {
    const el = qa(stage, `[data-physics-body="${id}"]`)[0], p = PHYS.props[id];
    if (!el || !p) return null;
    el.style.transformOrigin = '0 0';
    el.style.transform = 'none';
    const w = el.offsetWidth, h = el.offsetHeight;
    const cx = Math.max(w / 2 + 6, Math.min(W - w / 2 - 6, R.X(p.x))), cy = R.Y(p.y);
    Object.assign(el.dataset, { shape: 'box', w: w.toFixed(1), h: h.toFixed(1), cx: cx.toFixed(1), cy: cy.toFixed(1), angle: '0' });
    if (flipped) el.dataset.poseFlipped = flipped(cx, w, h).map(v => v.toFixed(1)).join(',');
    if (!stage.hasAttribute('data-physics-live')) el.style.transform = poseStr(cx, cy, 0);
    return { el, cx, cy, w, h, x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 };
  }

  /* v0.7 F3-10: S4 듣기 자세(180°)에서 회전층이 줄어드는 배율(motion climaxListeningFrame, 어댑터와 같은 입력). 엔진이 없거나
     1 이상이면 1 → 회전층 안 글은 12 ÷ 이 값으로 그려 화면에서 12 아래로 내려가지 않게 한다 */
  function listenK(layer) {
    try {
      const k = window.LandingBuilding?.climaxListeningFrame?.(Math.PI, { width: layer.clientWidth, height: layer.clientHeight })?.scale;
      return k > .3 && k < 1 ? k : 1;
    } catch (e) { return 1; }
  }

  /* 정적 그림이 바디와 겹치는지(가로 x0~x1, 세로 y0~y1) */
  const clear = (bodies, x0, x1, y0, y1, pad = 8) =>
    bodies.filter(Boolean).every(b => x1 + pad <= b.x0 || x0 - pad >= b.x1 || y1 <= b.y0 || y0 >= b.y1);
  /* 바디 사이 빈 바닥 구간 [a, b] 중 폭 w가 들어가는 가장 넓은 곳의 왼쪽 x */
  function freeSpan(bodies, a, b, w, pad = 16) {
    const xs = bodies.filter(Boolean).map(o => [o.x0 - pad, o.x1 + pad]).sort((p, q) => p[0] - q[0]);
    let best = null, cur = a;
    for (const [l, r] of [...xs, [b, b]]) {
      if (l - cur >= w && (!best || l - cur > best[1] - best[0])) best = [cur, Math.min(l, b)];
      cur = Math.max(cur, r);
    }
    return best ? best[0] + (best[1] - best[0] - w) / 2 : null;
  }
  /* 옆벽: 물리 벽(무대 가장자리)에 안쪽 면을 맞춘다 → 화면에는 벽 두께의 반만 보인다 */
  function edgeWalls(g, W, y0, y1, ww) { D.wall(g, -ww / 2, y0, y1, ww); D.wall(g, W - ww / 2, y0, y1, ww); }

  /* 진자: 엔진 진자는 방 가운데, 방 윗면에서 56 단위에 매달린다(별도 세계라 바디와 부딪히지 않고 각도만 쓴다).
     줄·갓이 글과 겹치지 않으면 그 자리에 맞추고, 겹치면 디자인 자리 fallback = [x, 줄 길이]를 쓴다 */
  const rectOf = (el, stage) => {   // 글이 실제로 차지하는 줄 상자(블록 폭이 아니라 글자 범위), 무대 좌표
    if (!el || getComputedStyle(el).display === 'none') return null;
    const r = document.createRange(); r.selectNodeContents(el);
    const b = r.getBoundingClientRect(), o = stage.getBoundingClientRect();
    return b.width ? { left: b.left - o.left, right: b.right - o.left, top: b.top - o.top, bottom: b.bottom - o.top } : null;
  };
  const rectOfBody = b => b && { left: b.x0, right: b.x1, top: b.y0, bottom: b.y1 };
  function physLamp(stage, g, id, R, ceilY, lps, cone, fallback, avoid = []) {
    const ax = R.X(PHYS.width / 2), ay = ceilY + 5 * lps;
    const len = R.Y(56) - ay + 14 * lps;
    const x0 = ax - 40 * lps, x1 = ax + 40 * lps, y1 = ay + len + 6 * lps;
    const ok = len >= 34 * lps && avoid.filter(Boolean).every(r => x1 < r.left || x0 > r.right || y1 < r.top || ay > r.bottom);
    const [x, l] = ok ? [ax, len] : fallback;
    D.canopy(g, x, ceilY, lps);
    lamp(stage, id, x, ay, l, lps, cone);
    return x;
  }

  /* 6층 살림(S2·S3·S4 같은 규칙): 의자·머그 = 물리 바디. 책상·노트북 = 물리에 없는 배경이라 의자 옆 빈 바닥에만 둔다
     (책상에서 빼낸 의자). 머그는 엔진에서 바닥에 놓여 있으므로 책상 위에 올리지 않는다 */
  function furnish6(stage, g, R, W, ww, opt = {}) {
    const chair = body(stage, '6:chair', 'chair', R, opt.chair);
    const mug = body(stage, '6:mug', 'mug', R);   // 엔진 컵 14×18 = 그림 비율이라 상자 높이 그대로
    const ds = Math.max(.4, Math.min(1.4, (chair ? chair.h : 110) * .74 / 98));   // 책상 높이 ≈ 의자 높이의 3/4
    const want = (opt.deskW || 320) * Math.min(1, ds);
    let dx = null, dw = want;
    if (chair && mug) {
      const [lo, hi] = chair.cx < mug.cx ? [chair, mug] : [mug, chair];
      const gap = hi.x0 - lo.x1 - 32;
      if (gap >= Math.min(want, 150 * ds)) { dw = Math.min(want, gap); dx = chair === lo ? lo.x1 + 16 : hi.x0 - 16 - dw; }
    }
    if (dx == null) dx = freeSpan([chair, mug], ww, W - ww, dw);
    let desk = null;
    if (dx != null) {
      const dk = D.desk(g, dx, R.floor, dw, ds);
      const ls = ds * .9, lapX = dx + dw * .52;
      D.laptop(g, lapX, dk.top, ls).setAttribute('data-laptop', '6');
      desk = { x: dx, w: dw, top: dk.top, ls, lapX };
    }
    return { chair, mug, desk };
  }

  function lamp(stage, id, ax, ay, len, s, cone) {
    const el = qa(stage, `[data-physics-lamp="${id}"]`)[0];
    if (!el) return;
    const half = 150 * s, h = len + cone * s + 12;
    const key = `${len}:${s}:${cone}`;
    if (el.dataset.artKey !== key) {
      const svg = D.el('svg', { viewBox: `${-half} 0 ${half * 2} ${h}`, width: half * 2, height: h, 'aria-hidden': 'true', focusable: 'false' });
      D.lampFigure(svg, len, s, cone);
      el.replaceChildren(svg); el.dataset.artKey = key;
    }
    place(el, ax - half, ay, half * 2, h);
    el.style.transformOrigin = `${half}px 0`;
    Object.assign(el.dataset, { ax: ax.toFixed(1), ay: ay.toFixed(1), len: (len + 2 * s).toFixed(1) });
  }

  function waveLayer(stage, id, y, H, W) {
    qa(stage, `[data-wave-layer="${id}"]`).forEach(el => place(el, 0, y, W, Math.max(0, H - y)));
  }

  function strip(stage, id, y, h, W) {
    qa(stage, `[data-record-strip="${id}"]`).forEach(el => {
      place(el, 0, y - h / 2, W, h);
      let svg = q(el, 'svg.strip-art');
      if (!svg) { svg = D.el('svg', { class: 'strip-art', 'aria-hidden': 'true', focusable: 'false' }); el.prepend(svg); }
      svg.setAttribute('viewBox', `0 0 ${W} ${h}`); svg.setAttribute('width', W); svg.setAttribute('height', h);
    });
  }

  function marks(stage) {
    let svg = qa(stage, 'svg[data-art-marks]')[0];
    if (!svg) {
      svg = D.el('svg', { 'data-art-marks': '', class: 'marks', 'aria-hidden': 'true', focusable: 'false' });
      (qa(stage, '[data-flip-layer]')[0] || stage).appendChild(svg);
    }
    svg.setAttribute('viewBox', `0 0 ${stage.clientWidth} ${stage.clientHeight}`);
    return svg;
  }

  /* 숨은 버튼까지 켜진 모양으로 잰 상자 크기(.is-measure, site.css). maxW를 주면 그 폭에서 줄바꿈한 높이 */
  function measure(el, maxW) {
    if (!el) return { w: 0, h: 40 };
    if (maxW) el.style.maxWidth = maxW + 'px';
    el.classList.add('is-measure');
    const r = { w: el.offsetWidth, h: el.offsetHeight };
    el.classList.remove('is-measure');
    return r;
  }

  /* 아직 숨은 글(hidden, 첫 쿵 뒤에 열리는 큐)의 높이: .is-measure-self(site.css)로 보이지 않게 켠 채 잰다.
     hidden 속성은 건드리지 않는다(엔진·초대가 hidden 변화를 지켜본다). 같은 동기 구간 안에서 되돌리므로 화면에 그려지지 않는다 */
  function hiddenBox(el, maxW) {
    if (!el) return { w: 0, h: 0 };
    const mw = el.style.maxWidth;
    if (maxW) el.style.maxWidth = maxW + 'px';
    el.classList.add('is-measure-self');
    const r = { w: el.offsetWidth, h: el.offsetHeight };
    el.classList.remove('is-measure-self');
    el.style.maxWidth = mw;
    return r;
  }

  function hit(stage, id, x, y, w, h) { qa(stage, `[data-hit="${id}"]`).forEach(el => place(el, x, y, w, h)); }
  function react(stage, id, x, y) { qa(stage, `[data-react="${id}"]`).forEach(el => place(el, x, y)); }

  function publish(stage, geo) {
    stage.dataset.geometry = JSON.stringify(geo);
    stage._geo = geo;
    if (PREVIEW === 'physics') physicsPreview(stage, geo);
    stage.dispatchEvent(new CustomEvent('lt:art-layout', { bubbles: true, detail: geo }));
  }

  /* 시각 점검(?preview=physics): 엔진 없이 물리 정지 윤곽을 겹쳐 본다.
     대응식은 modules/debug.js와 같다(px = x·w/폭, py = 천장 + (y − 방 윗면)·세로배율). 실제 엔진 확인은 ?debug */
  function physicsPreview(stage, geo) {
    let svg = qa(stage, 'svg[data-art-physics]')[0];
    if (!svg) { svg = D.el('svg', { 'data-art-physics': '', class: 'phys-preview', 'aria-hidden': 'true', focusable: 'false' }); (qa(stage, '[data-flip-layer]')[0] || stage).appendChild(svg); }
    if (!geo.floors) { svg.replaceChildren(); return; }
    svg.setAttribute('viewBox', `0 0 ${geo.w} ${geo.h}`); svg.replaceChildren();
    const sx = geo.w / PHYS.width;
    const frame = f => { const top = geo.ceilings?.[f] ?? 0, bottom = geo.floors?.[f] ?? geo.h; return { top, sy: (bottom - top) / PHYS.room }; };
    const shown = f => geo.floors?.[f] !== undefined || geo.ceilings?.[f] !== undefined;
    const label = (x, y, t) => { D.el('text', { x, y, class: 'phys-label' }, svg).textContent = t; };
    Object.entries(PHYS.props).forEach(([id, p]) => {
      const f = id.startsWith('copy:') ? (id === 'copy:0' ? 5 : 7) : +id[0];
      if (!shown(f)) return;
      const { top, sy } = frame(f), cx = p.x * sx, cy = top + p.y * sy;
      if (id.endsWith('ball')) D.el('ellipse', { cx, cy, rx: p.w / 2 * sx, ry: p.h / 2 * sy, class: 'phys-outline' }, svg);
      else D.el('rect', { x: cx - p.w / 2 * sx, y: cy - p.h / 2 * sy, width: p.w * sx, height: p.h * sy, class: 'phys-outline' }, svg);
      label(cx - p.w / 2 * sx, cy - p.h / 2 * sy - 4, id.startsWith('copy:') ? `${f}:copy` : id);
    });
    [6, 5].filter(shown).forEach(f => {   // 진자(엔진 방 가운데, 윗면 + 56). 바디와 부딪히지 않는 별도 세계
      const { top, sy } = frame(f), cx = PHYS.width / 2 * sx, cy = top + 56 * sy;
      D.el('ellipse', { cx, cy, rx: 9 * sx, ry: 9 * sy, class: 'phys-outline is-lamp' }, svg);
      label(cx + 10 * sx, cy, `${f}:lamp`);
    });
  }

  /* ───────────── 장면 배치 ───────────── */
  const SCENES = {};

  /* 7층 방 한 벌(S0·S1 같은 방): 단면·바디·아래층 펜던트·띠·파동·바닥 누름 영역 */
  function room7(stage, g, W, H) {
    const m = W <= 720, sh = isShort(H), s = sh ? .6 : m ? .75 : 1, M = margin(W);
    const hud = hudH(W, H);
    // v0.4.1: 짧은 휴대폰(320×568 등)은 지붕을 머리띠 쪽으로 10px 올린다 — 안내 2줄 + 버튼 2줄이 1행 제목('내 바닥은,')에 붙지 않게
    const cm = m && !sh && H < 700;
    const floorY = Math.round(H * (sh ? .70 : m ? .62 : .68)), roofY = sh || cm ? hud + 30 : m ? 96 : 112;
    D.el('rect', { x: 0, y: 0, width: W, height: H, class: 'f-paper' }, g);
    const roof = D.floorStack(g, 0, W, roofY, { scale: s });
    const ww = m ? 10 : 16;
    D.parapet(g, 0, W, roofY, s);
    const fs = D.floorStack(g, 0, W, floorY, { scale: s });
    D.el('rect', { x: 0, y: fs.ceiling, width: W, height: H - fs.ceiling, class: 'f-paper-2' }, g);
    D.el('line', { x1: 0, y1: fs.ceiling, x2: W, y2: fs.ceiling, class: 'ln-cut' }, g);
    edgeWalls(g, W, roof.ceiling, H, ww);
    const bandY = (fs.soft + fs.slabBottom) / 2, bandH = m ? 10 : 14;
    D.band(g, 0, W, bandY, bandH);
    // 바디: 7층 공·의자·컵 — 엔진의 7층 가구 배치 그대로
    const R7 = proom(W, roof.ceiling, floorY, true);
    const ball = body(stage, '7:ball', 'ball', R7);
    const chair = body(stage, '7:chair', 'chair', R7, { mirror: true });
    const cup = body(stage, '7:cup', 'cup', R7);
    const B7 = [ball, chair, cup];
    // 배경(물리에 없음): 바디와 겹치지 않을 때만 둔다
    if (!sh) {
      const wx = W * (m ? .62 : .444), wy = roof.ceiling + (m ? 150 : 96), wwid = m ? 110 : 250, wh = m ? 120 : 200;
      if (clear(B7, wx, wx + wwid, wy, wy + wh)) D.windowEl(g, wx, wy, wwid, wh, m ? .55 : 1);
      D.windowEl(g, wx, fs.ceiling + (m ? 150 : 96), wwid, wh, m ? .55 : 1).setAttribute('opacity', .55);
    }
    const ox = W - ww / 2 - (m ? 22 : 30);
    if (clear(B7, ox - 10, ox + 10, floorY - 40, floorY - 12)) D.outlet(g, ox, floorY - 26, m ? .8 : 1);
    // 아래층(6층) 펜던트: 물리는 각도만 쓴다(다른 세계라 바디와 부딪히지 않음). 글 2행 오른쪽
    const lx = Math.round(W * (sh ? .56 : m ? .8 : .75));
    const ls = sh ? .5 : m ? .66 : 1;
    D.canopy(g, lx, fs.ceiling, ls);
    lamp(stage, '6', lx, fs.ceiling + 5 * ls, sh ? 34 : m ? 81 : 107, ls, sh ? 60 : m ? 150 : 190);
    waveLayer(stage, '7-6', floorY, H, W);
    strip(stage, '7-6', bandY, bandH, W);
    hit(stage, '7', 0, floorY - 30, W, 30 + (fs.slabBottom - floorY));
    if (sh) react(stage, '6', lx + 30, fs.ceiling + 20);
    else if (m && H < 700) react(stage, '6', W - M - 74, fs.ceiling + 104);   // 짧은 휴대폰: 2행 제목 아래 오른쪽
    else react(stage, '6', lx + (m ? -60 : 40), fs.ceiling + (m ? 150 : 148));
    return { m, sh, s, M, roof, roofY, floorY, fs, bandY, bandH, R7, B7, lx, ls };
  }
  const geo7 = (scene, W, H, k) => ({ scene, w: W, h: H, mobile: k.m, walls: [0, W], roof: k.roofY,
    floors: { 7: k.floorY }, ceilings: { 7: k.R7.top }, lines: { ceilings: { 7: k.roof.ceiling, 6: k.fs.ceiling } },
    slabs: { '7-6': { top: k.floorY, bottom: k.fs.slabBottom, band: k.bandY, bandHeight: k.bandH } } });

  /* S0 · 7층, 나의 집 */
  SCENES.s0 = (section, stage) => {
    const { g, W, H } = room(stage);
    const k = room7(stage, g, W, H), { m, sh, M, roof, floorY, fs, bandY, B7 } = k;

    // 글: 1행은 7층 바닥에 서고, 2행은 6층 천장에 매달린다
    const L = M + (m ? 8 : 26);
    const l1 = q(section, '[data-place="s0-line1"]'), l2 = q(section, '[data-place="s0-line2"]');
    if (l1 && l2) {
      l1.style.left = L + 'px'; l2.style.left = L + 'px';
      l2.classList.toggle('is-wrapped', m && !sh);
      // 1행이 같은 바닥의 바디(공·의자·컵)에 닿지 않게(v0.2 #10): 넘치면 두 줄을 같은 비율로 줄인다(320px 등)
      l1.style.fontSize = l2.style.fontSize = '';
      const firstBody = Math.min(...B7.filter(Boolean).map(b => b.x0).filter(x => x > L + 40));
      const rg = document.createRange(); rg.selectNodeContents(l1);
      const w1 = rg.getBoundingClientRect().width, room1 = firstBody - L - 14;
      if (Number.isFinite(room1) && w1 > room1) {
        const f = Math.max(28, parseFloat(getComputedStyle(l1).fontSize) * room1 / w1).toFixed(1) + 'px';
        l1.style.fontSize = f; l2.style.fontSize = f;
      }
      D.standOn(l1, floorY - (m || sh ? 4 : 6), '내바닥은');
      D.hangFrom(l2, fs.ceiling, sh ? 8 : m ? 16 : 22, '누군가의천장입니다');
    }
    // 안내 → 버튼 → '방금 그 쿵'을 실제 높이로 위에서부터 쌓는다(모든 폭, v0.2.2: S0-02·S0-05가 길어지고 버튼이 셋)
    const intro = q(section, '[data-place="s0-intro"]'), keys = q(section, '[data-place="s0-keys"]'), after = q(section, '[data-place="s0-after"]');
    const cm = m && !sh && H < 700;   // 짧은 휴대폰(320×568 등)
    const kb = measure(keys, W - 2 * L);   // 버튼은 엔진이 켜기 전엔 숨어 있으므로 켜진 모양으로 잰다
    const y0 = roof.ceiling + (sh ? 8 : cm ? 10 : m ? 22 : 40);
    place(intro, L, y0);
    let ky = y0 + (intro ? intro.offsetHeight : 54) + (sh ? 6 : cm ? 8 : 16);
    // v0.6 F2(R11 4): 낮은 화면(844×390)은 안내 2줄 + 버튼 줄 아래에 50px만 남아 1행 제목이 28px까지 줄었다 →
    // 폭이 되면 버튼을 안내 오른쪽에 나란히 둔다(같은 세로 가운데). 아래 계산은 ky + kb.h = 두 덩어리의 아래 끝으로 읽는다
    let keysSide = false;
    if (sh && intro) {
      const ir = rectOf(intro, stage), kx = ir ? ir.right + 28 : Infinity;
      if (kx + kb.w <= W - M - 8) {
        keysSide = true;
        const ih = intro.offsetHeight, top = y0 + Math.max(0, (ih - kb.h) / 2);
        place(keys, kx, top);
        ky = y0 + Math.max(ih, kb.h) - kb.h;
      }
    }
    if (!keysSide) place(keys, L, ky);
    // v0.4.1(호스트 검수 1): 버튼 아래 끝과 1행 제목의 글줄 상자 사이를 띄운다. 모자라면 두 줄 제목을 같은 비율로 줄인다(최소 28px)
    if (l1 && l2) {
      for (let i = 0; i < 2; i++) {
        const r1 = rectOf(l1, stage), want = ky + kb.h + (cm ? 6 : 10), base = floorY - (m || sh ? 4 : 6);
        if (!r1 || r1.top >= want || base - r1.top < 1) break;
        const f = parseFloat(getComputedStyle(l1).fontSize), nf = Math.max(28, f * (base - want) / (base - r1.top));
        if (nf >= f - .5) break;
        l1.style.fontSize = l2.style.fontSize = nf.toFixed(1) + 'px';
        D.standOn(l1, base, '내바닥은');
        D.hangFrom(l2, fs.ceiling, sh ? 8 : m ? 16 : 22, '누군가의천장입니다');
      }
    }
    // 낮은 화면: 버튼 오른쪽에 두 줄이 들어가면. v0.4.1: 그 자리가 7층 의자·컵에 걸리면(844×390 '울립니다'가 의자 뒤) 안내 자리를 이어받는다
    const ab = hiddenBox(after, W - 2 * L), sx = L + kb.w + 16;
    const sideBox = { left: sx, right: sx + Math.max(280, ab.w), top: ky - 4, bottom: ky - 4 + ab.h };
    const sideAfter = !keysSide && sh && sideBox.right <= W - M
      && ![B7[1], B7[2]].filter(Boolean).some(b => b.x0 < sideBox.right + 6 && b.x1 > sideBox.left - 6 && b.y0 < sideBox.bottom + 4 && b.y1 > sideBox.top - 4);
    // v0.4.1(호스트 검수 3): 넓은 화면도 버튼 아래에 '방금 그 쿵' 두 줄이 1행 제목 글줄 상자 위로 다 들어가야 아래에 둔다(1280×720은 모자람)
    const belowY = ky + Math.max(36, kb.h) + 12, r1 = l1 && rectOf(l1, stage);
    const fitsBelow = !r1 || belowY + ab.h + 8 <= r1.top;
    const replace = cm || (sh && !sideAfter) || (!sh && !fitsBelow);  // 아니면 첫 쿵 뒤 안내 문장 자리를 이어받는다(site.css가 안내를 숨김)
    section.querySelector('.copy')?.classList.toggle('after-replaces-intro', replace);
    if (replace) place(after, L, y0);
    else if (sh) place(after, L + kb.w + 16, ky - 4);
    else place(after, L, belowY);
    const note = q(section, '[data-place="s0-band"]');
    if (note) {
      // v0.8(S0-07 한 줄 눈금 "쿵 지수: 바닥 톡 43 · 방 절반 높이 공 100 · 천장 가까이 공 200"): 172px 두 줄이던 주석보다 길다 →
      // 넓은 화면은 2행 제목 오른쪽 빈 폭(280 이상이면 최대 420)에 두 줄, 모자라면 2행 제목 바로 아래 오른쪽. 오른쪽 끝 = 지시선(띠에서 내려옴)
      // 2행 제목 오른쪽은 6층 조명(W·0.75)이 내려와 있다(1280·1440에서 넓힌 한 줄이 조명 줄·몸통을 가로질렀다) →
      //   ① 제목과 조명 사이가 400 이상이면 거기 두 줄, ② 아니면 조명 오른쪽 좁은 칸에 세로 미니 눈금(.is-col), ③ 그것도 좁으면 제목 아래
      const r2n = l2 && rectOf(l2, stage);
      let nw = 172, nx = W - M - 196, ny = fs.ceiling + 58, col = false;
      if (!m && !sh) {
        const left0 = (r2n ? r2n.right : 0) + 28, right0 = W - M - 24;
        const lampL = k.lx - 40 * k.ls - 16, lampR = k.lx + 40 * k.ls + 16;
        if (lampL - left0 >= 400) { nw = Math.min(440, lampL - left0); nx = left0; }
        else if (right0 - lampR >= 140) { col = true; nw = right0 - lampR; nx = lampR; ny = fs.ceiling + 14; }
        else { nw = Math.min(420, right0 - L); nx = right0 - nw; if (r2n) ny = r2n.bottom + 16; }
      }
      note.classList.toggle('is-col', col);
      note.style.width = (m ? W - 2 * L : sh ? Math.min(360, Math.max(240, W - M - 24 - ((keysSide && r2n ? r2n.right : 0) + 24))) : nw) + 'px';
      if (sh) place(note, W - M - parseFloat(note.style.width), keysSide ? fs.ceiling + 8 : roof.ceiling + 8);   // 낮은 뷰포트: 지시선 없이 오른쪽 위(버튼이 그 자리면 6층 오른쪽, 2행 제목 피함)
      else if (cm) place(note, L, H - 6 - hiddenBox(note, W - 2 * L).h);   // 맨 아래(보일 때는 '아래층으로'를 대신한다, site.css). 실제 높이로. v1.0 K1: 세 줄이라 12 → 6
      else place(note, m ? L : nx, m ? fs.ceiling + 120 : ny);
      // 지시선은 설명 요소 안에 그린다 → 설명이 숨으면 함께 숨는다
      q(note, 'svg.note-leader')?.remove();
      if (!m && !sh) {
        // 지시선: 띠에서 주석 오른쪽 끝으로 내려와 주석 아래를 받치는 밑줄(높이는 실제 글 높이 — 세로 눈금은 네 줄)
        const lx = nw, ly0 = bandY - ny, ly1 = hiddenBox(note, nw).h + 4;
        const sv = D.el('svg', { class: 'note-leader', 'aria-hidden': 'true', focusable: 'false', width: 1, height: 1 });
        D.leader(sv, lx, ly0, lx, ly1, 0);
        note.appendChild(sv);
      }
    }
    const down = q(section, '[data-place="s0-down"]');
    if (sh) place(down, W - M - 96, H - 30);    // 2행 제목과 겹치지 않게 오른쪽 아래
    else if (down) {
      // v0.4.1(호스트 검수 2): 가운데 아래가 2행 제목('누군가의 천장입니다.')의 글줄 상자 안이면(1280×720) 오른쪽 아래로 비킨다
      place(down, W / 2 - 44, H - (m ? 40 : 46));
      const r2 = l2 && rectOf(l2, stage), dw = down.offsetWidth || 96, dh = down.offsetHeight || 26;
      const hitsTitle = (x, y) => r2 && x < r2.right + 8 && x + dw > r2.left - 8 && y < r2.bottom + 4 && y + dh > r2.top - 4;
      if (hitsTitle(W / 2 - 44, H - (m ? 40 : 46))) place(down, W - M - dw, H - dh - 12);
      // v1.0 K1: 세로 미니 눈금(정의 한 줄 더)이 그 자리를 덮으면 띠가 보이는 동안 숨긴다(site.css)
      const dx = parseFloat(down.style.left), dy = parseFloat(down.style.top), nb = note?.classList.contains('is-col') && hiddenBox(note, parseFloat(note.style.width));
      down.toggleAttribute('data-under-band', Boolean(nb && dx < parseFloat(note.style.left) + nb.w + 8 && dx + dw > parseFloat(note.style.left) - 8 && dy < parseFloat(note.style.top) + nb.h + 8));
    }

    // walls = 물리 벽(무대 가장자리). floors/ceilings = 물리 방(바디가 있는 층만). lines = 그린 천장선(표지용)
    publish(stage, geo7('s0', W, H, k));
    renderMarks(stage);
    inviteRender();
  };

  /* S1 · 7층, 쿵 기록 확장(v0.3). S0와 같은 방이고 바디도 같은 엔진 바디다(이름으로 묶임). 오른쪽 위에 작은 안내 */
  SCENES.s1 = (section, stage) => {
    const { g, W, H } = room(stage);
    const k = room7(stage, g, W, H), { m, sh, M, roof } = k;
    const L = M + (m ? 8 : 26);
    const note = q(section, '[data-place="s1-note"]'), keys = q(section, '[data-place="s1-keys"]');
    const nw = m ? W - 2 * L : sh ? 420 : 340, nx = m ? L : W - M - nw;
    if (note) { note.style.width = nw + 'px'; place(note, nx, roof.ceiling + (sh ? 8 : m ? 22 : 40)); }
    if (keys) {
      // v0.3.1(레드팀 v0.3 6절 4번): 휴대폰은 화면 아래 엄지 자리(6층 쪽) — 공이 굴러오는 7층 바닥선 위를 비운다.
      // 넓은 화면은 안내 바로 아래(방 위쪽, 의자 키보다 위). 안내 높이는 숨은 S1-03까지 켠 모양으로 잰다
      const kb = measure(keys, nw);
      if (m) place(keys, L, H - (H < 700 ? 12 : 22) - kb.h);
      else place(keys, nx, roof.ceiling + (sh ? 8 : 40) + measure(note, nw).h + (sh ? 8 : 14));
    }
    publish(stage, geo7('s1', W, H, k));
    renderMarks(stage);
  };

  /* 끌기 자국(S1-움직임 "의자를 끌면 다리 자국이 바닥에 잠깐 남는다"): 7층 바닥 x0~x1(0~1)에 두 줄을 그렸다가 지운다 */
  Art.scuff = function (scene, x0, x1) {
    const st = q(document, `[data-stage="${scene || 's1'}"]`), geo = st?._geo;
    if (!geo || !geo.floors?.[7]) return;
    let svg = qa(st, 'svg[data-art-scuff]')[0];
    if (!svg) { svg = D.el('svg', { 'data-art-scuff': '', class: 'marks', 'aria-hidden': 'true', focusable: 'false' }); st.appendChild(svg); }
    svg.setAttribute('viewBox', `0 0 ${geo.w} ${geo.h}`);
    const [a, b] = [x0, x1].map(v => Math.max(0, Math.min(1, v)) * geo.w).sort((p, r) => p - r), y = geo.floors[7];
    const grp = D.g(svg, { class: 'scuff' });
    [1.6, 3.8].forEach(dy => D.el('line', { x1: a, y1: y + dy, x2: b, y2: y + dy }, grp));   // 마루 켜 안쪽(바닥면 바로 밑)
    setTimeout(() => grp.remove(), 2600);
  };

  /* S2 글 묶음이 6층 바닥(floor6 − 10) 아래로 내려가거나 의자 상자에 글줄이 걸리는지.
     재생 뒤에 열리는 S2-03·소리 안내와 엔진이 켜는 [다시 듣기]까지 켠 모양으로 잰다(.is-measure-self·.is-measure, site.css) */
  function s2Crowded(copy, stage, floor6, chair) {
    const cues = qa(copy, '[data-cue="s2-after"], [data-cue="s2-06"]').filter(e => e.hidden), acts = q(copy, '.actions');
    cues.forEach(e => e.classList.add('is-measure-self')); acts?.classList.add('is-measure');
    const o = stage.getBoundingClientRect(), rg = document.createRange(), lines = [];
    const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim() || n.parentElement.closest('.sr, [data-cue="s2-empty"]')) continue;
      rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) if (r.width > 1) lines.push({ left: r.left - o.left, right: r.right - o.left, top: r.top - o.top, bottom: r.bottom - o.top });
    }
    const btn = q(copy, 'button'); if (btn) { const r = btn.getBoundingClientRect(); if (r.width) lines.push({ left: r.left - o.left, right: r.right - o.left, top: r.top - o.top, bottom: r.bottom - o.top }); }
    cues.forEach(e => e.classList.remove('is-measure-self')); acts?.classList.remove('is-measure');
    if (!lines.length) return false;
    const bottom = Math.max(...lines.map(l => l.bottom));
    const hitsChair = chair && lines.some(l => l.right > chair.x0 - 4 && l.left < chair.x1 && l.bottom > chair.y0 + 2 && l.top < chair.y1);
    return bottom > floor6 - 10 || hitsChair;
  }

  /* S2 · 6층, 같은 쿵 다른 자리 */
  SCENES.s2 = (section, stage) => {
    const { g, W, H } = room(stage); const m = W <= 720, sh = isShort(H), s = sh ? .6 : m ? .75 : 1, M = margin(W);
    const hud = hudH(W, H);
    D.el('rect', { x: 0, y: 0, width: W, height: H, class: 'f-paper-2' }, g);
    const up = D.floorStack(g, 0, W, sh ? hud + 24 : m ? 92 : 136, { scale: s });
    D.el('rect', { x: 0, y: 0, width: W, height: up.floor, class: 'f-paper' }, g);
    D.el('line', { x1: 0, y1: up.floor, x2: W, y2: up.floor, class: 'ln-cut' }, g);
    // v0.4: 짧은 휴대폰(320×568 등)은 글 묶음이 6층 가구·바닥까지 넘쳤다(아래 .is-compact)
    const cm = m && !sh && H < 700;
    // v0.7 F3-10: 짧은 휴대폰은 6층 바닥을 22px 낮춘다(바닥 아래 슬래브는 화면 끝에서 잘린다) — 쿵 지수 설명(14 → 13, 3줄)이
    // 책상·노트북·의자 위로 지나가던 것(F2 12px 2줄부터)을 가구 위로 올린다
    const floor6 = Math.round(H - (sh ? 40 : cm ? 36 : m ? 58 : 72));
    D.floorStack(g, 0, W, floor6, { scale: s });
    const ww = m ? 10 : 16;
    edgeWalls(g, W, 0, H, ww);
    const bandY = (up.soft + up.slabBottom) / 2, bandH = m || sh ? 10 : 14;
    D.band(g, 0, W, bandY, bandH);
    if (!m && !sh) {
      D.windowEl(g, W * .444, up.ceiling + 96, 250, 200).setAttribute('opacity', .45);
    }
    const R6 = proom(W, up.ceiling, floor6, true);
    const f6 = furnish6(stage, g, R6, W, ww);
    if (!m && !sh && f6.chair && clear([f6.chair, f6.mug], W - 150 - ww, W - ww - 20, floor6 - 30, floor6)) D.level(g, W - 150 - ww, floor6, '6층 바닥');
    const dk = f6.desk;
    stage._deskTop = dk ? dk.top : null;   // v0.5 U-08 자리(watchU08): 6층 가구의 맨 위
    const L = M + (m ? 8 : 26);
    // v0.4: 짧은 휴대폰(320×568 등)은 글 묶음(6층입니다 · 제목 · S2-03 두 줄 · 소리 안내 · 다시 듣기 · U-06)이 6층 가구·바닥까지 넘쳤다
    // → 진자를 오른쪽 위 벽 쪽에 짧게 걸고 글을 위로 올린다(site.css가 같은 조건에서 글자를 한 단계 줄인다)
    section.querySelector('.copy')?.classList.toggle('is-compact', cm);
    const copy = q(section, '[data-place="s2-copy"]');
    if (copy) {   // 글 먼저: 진자가 글을 피해 자리를 고른다
      const box = section.querySelector('.copy');
      box?.classList.remove('is-fit', 'is-tight');
      const u06 = q(copy, '.u06'); if (u06) u06.style.maxWidth = '';
      const side = [u06, q(copy, '[data-cue="s2-06"]')].filter(Boolean);
      const unside = e => Object.assign(e.style, { position: '', left: '', top: '', width: '', margin: '' });
      side.forEach(unside);
      place(copy, L, up.ceiling + (sh ? 12 : cm ? 30 : m ? 118 : 76));   // v0.7 F3-10: 짧은 휴대폰 46 → 30(제목 윗줄이 '쿵 #n' 표지 아래 8px)
      copy.style.width = sh ? Math.max(280, (dk ? dk.x : W * .6) - L - 24) + 'px' : m ? (W - 2 * L) + 'px' : Math.min(760, W / 2 - L - 60) + 'px';
      // v0.7 F3-10: 낮은 화면(844×390 등)은 글 묶음이 6층 바닥 아래로 넘쳐 쿵 지수 설명이 화면 밖에서 잘렸고, [다시 듣기]가 바닥선에 걸렸고,
      // 6층 의자가 소리 안내 글 위에 그려졌다 → 쿵 지수 설명·소리 안내를 책상 오른쪽 빈 벽(천장 '쿵 #n' 표지 아래)에 도면 주석처럼
      // 세운다. 소리 안내는 "오른쪽 위에서 소리를 켜면"이라 소리 토글 아래가 제자리다. 읽는 순서(DOM)는 그대로, 안 들어가면 흐름에 남긴다
      if (sh && dk) {
        const x0 = dk.x + dk.w + 20, x1 = W - ww - 20, cl = parseFloat(copy.style.left), ct = parseFloat(copy.style.top);
        let y = up.ceiling + 44;
        if (x1 - x0 >= 180) for (const e of side) {
          Object.assign(e.style, { position: 'absolute', margin: '0', width: (x1 - x0).toFixed(0) + 'px', left: (x0 - cl).toFixed(1) + 'px', top: (y - ct).toFixed(1) + 'px' });
          const h = e.offsetHeight;
          if (y + h > floor6 - 10) { unside(e); break; }
          y += h + 12;
        }
      }
      // v0.4.1: 넓지만 낮은 화면(1280×720·1366×768·1024×768, 노트북 브라우저 창 1366×657 등)에서 글 묶음이 6층 바닥 아래로 넘치고
      // 6층 의자(물리 바디, 글 위에 그려짐)가 S2-03·소리 안내를 가렸다 → 맞춤 단계 두 개(site.css .is-fit → .is-tight):
      // 글을 올리고 제목·간격을 한 단계씩 줄이며, 쿵 지수 주석은 의자 왼쪽 폭으로 접는다
      if (!m && !sh && s2Crowded(copy, stage, floor6, f6.chair)) {
        if (u06 && f6.chair && f6.chair.x0 - L - 14 < parseFloat(copy.style.width)) u06.style.maxWidth = Math.max(220, f6.chair.x0 - L - 14) + 'px';
        box?.classList.add('is-fit');
        place(copy, L, up.ceiling + 40);
        if (s2Crowded(copy, stage, floor6, f6.chair)) { box?.classList.add('is-tight'); place(copy, L, up.ceiling + 24); }
      }
    }
    const lps = sh ? .5 : m ? .62 : 1;
    physLamp(stage, g, '6', R6, up.ceiling, lps, sh ? 80 : cm ? 70 : m ? 150 : 250,
      cm ? [W - ww / 2 - 30, 22] : [dk ? dk.x + dk.w * .62 : W * .6, sh ? 46 : m ? 73 : 215], [rectOf(copy, stage)]);
    waveLayer(stage, '7-6', up.floor, H, W);
    strip(stage, '7-6', bandY, bandH, W);
    if (dk) {
      // v0.6 F2(R11 8): 짧은 휴대폰(320)은 노트북 '…?'가 쿵 지수 주석(U-06)을 가렸다 → 주석 위, [다시 듣기] 오른쪽 빈자리로 올린다
      let rx = dk.lapX - 26 * dk.ls, ry = dk.top - 55 * dk.ls;
      const u = cm && copy && rectOf(q(copy, '.u06'), stage);
      if (u) {
        const bw = 64, bh = 42;
        if (rx < u.right && rx + bw > u.left && ry < u.bottom && ry + bh > u.top) { ry = u.top - bh - 8; rx = Math.max(rx, L + 132); }
      }
      react(stage, 'laptop', rx, ry);
    }

    const geo = { scene: 's2', w: W, h: H, mobile: m, short: sh, walls: [0, W],
      floors: { 6: floor6 }, ceilings: { 6: R6.top }, lines: { ceilings: { 6: up.ceiling } },
      slabs: { '7-6': { top: up.floor, bottom: up.slabBottom, band: bandY, bandHeight: bandH } } };
    publish(stage, geo);
    renderMarks(stage);
  };

  /* S3 · 5층, 6층도 누군가의 위층 */
  SCENES.s3 = (section, stage) => {
    const { g, W, H } = room(stage); const m = W <= 720, sh = isShort(H), s = sh ? .6 : m ? .75 : 1, M = margin(W);
    const hud = hudH(W, H);
    const y6 = Math.round(H * (sh ? .5 : m ? .46 : .5)), floor5 = Math.round(H - (sh ? 44 : m ? 70 : 84));
    D.el('rect', { x: 0, y: 0, width: W, height: H, class: 'f-paper-2' }, g);
    const st = D.floorStack(g, 0, W, y6, { scale: s });
    const below = D.g(g, { class: 'fading' });                 // 5층 아래: 점선으로 흐려지는 슬래브
    D.floorStack(below, 0, W, floor5, { scale: s });
    const ww = m ? 10 : 16;
    edgeWalls(g, W, 0, H, ww);
    const bandY = (st.soft + st.slabBottom) / 2, bandH = m ? 10 : 14;
    D.band(g, 0, W, bandY, bandH);
    // 6층(위): S2와 같은 배치(의자·머그 = 물리, 책상·노트북 = 둘 사이 배경)
    const R6 = proom(W, 0, y6, true);
    const f6 = furnish6(stage, g, R6, W, ww);
    // 5층(아래): 화분 = 물리. 소파는 화분과 겹치지 않는 빈 바닥에
    const R5 = proom(W, st.ceiling, floor5, true);
    const plant = body(stage, '5:plant', 'plant', R5);
    if (!m && !sh) D.windowEl(g, W * .444, st.ceiling + 70, 250, 180).setAttribute('opacity', .5);
    const sw = m ? 150 : sh ? 200 : 260, ss = m ? .7 : sh ? .6 : 1;
    const pref = m ? W - M - 190 : W * .22;
    const sx0 = plant && !clear([plant], pref - 8 * ss, pref + sw + 8 * ss, floor5 - 80, floor5) ? freeSpan([plant], ww, W - ww, sw + 16 * ss) : pref;
    if (sx0 != null && !sh) D.sofa(g, sx0 + 8 * ss, floor5, sw, ss);   // 낮은 뷰포트: 5층 방이 낮아 소파는 생략
    const L = M + (m ? 8 : 26);
    place(q(section, '[data-place="s3-top"]'), L, hud + (sh ? 10 : m ? 26 : 40));
    const key = q(section, '[data-place="s3-key"]');
    place(key, L, st.ceiling + (sh ? 30 : m ? 30 : 48));   // 천장 아래 쿵 표지(약 24px) 밑으로
    const below5 = q(section, '[data-place="s3-below"]');
    if (below5) place(below5, L, floor5 + (sh ? 8 : m ? 12 : 18));

    const lps = sh ? .5 : m ? .62 : 1;
    const lx = physLamp(stage, g, '5', R5, st.ceiling, lps, sh ? 70 : m ? 140 : 210,
      [m ? W - M - 120 : Math.round(W * .62), sh ? 40 : m ? 70 : 120], [rectOf(key, stage), rectOfBody(plant)]);
    waveLayer(stage, '6-5', y6, H, W);
    strip(stage, '6-5', bandY, bandH, W);
    const c6 = f6.chair;
    if (c6) hit(stage, '6', c6.x0 - 20, c6.y0, c6.x1 - c6.x0 + 40, c6.y1 - c6.y0);
    if (sh) react(stage, '5', lx + 40, st.ceiling + 44);
    else react(stage, '5', lx + (m ? -60 : 40), st.ceiling + (m ? 120 : 160));

    const geo = { scene: 's3', w: W, h: H, mobile: m, walls: [0, W],
      floors: { 6: y6, 5: floor5 }, ceilings: { 6: R6.top, 5: R5.top }, lines: { ceilings: { 5: st.ceiling } },
      slabs: { '6-5': { top: y6, bottom: st.slabBottom, band: bandY, bandHeight: bandH } } };
    publish(stage, geo);
    renderMarks(stage);
  };

  /* S4 · 절정: 세 층 단면(바로 선 상태). 회전은 [data-flip-layer]만, 엔진(createPageFlip)이 한다 */
  SCENES.s4 = (section, stage) => {
    const layer = qa(stage, '[data-flip-layer]')[0];
    const { g, W, H } = room(stage); const m = W <= 720, sh = isShort(H), s = m || sh ? .6 : .8, M = margin(W);
    const hud = hudH(W, H), stackH = 76 * s;
    const roofY = hud + 34 * s + 6;
    D.el('rect', { x: 0, y: 0, width: W, height: H, class: 'f-paper' }, g);
    const roof = D.floorStack(g, 0, W, roofY, { scale: s });
    D.parapet(g, 0, W, roofY, s);
    // 한 층 높이. 세 층이 다 안 들어가는 낮은 뷰포트에서는 최소 높이를 지키고 5층은 화면 아래로 잘린다
    // (뒤집히면 무대 중앙 기준 180°라 보이는 것은 7·6층 두 층). B2: 여기서 음수가 나와 창 높이가 -48이 됐다
    const rh = Math.max(sh ? 120 : 90, Math.round((H - roof.ceiling - 3 * stackH - (m ? 8 : 14)) / 3));
    const f7 = roof.ceiling + rh, st7 = D.floorStack(g, 0, W, f7, { scale: s });
    const f6 = st7.ceiling + rh, st6 = D.floorStack(g, 0, W, f6, { scale: s });
    const f5 = st6.ceiling + rh, st5 = D.floorStack(D.g(g, { class: 'fading' }), 0, W, f5, { scale: s });
    D.el('rect', { x: 0, y: st7.ceiling, width: W, height: f6 - st7.ceiling, class: 'f-paper-2' }, g);
    D.el('rect', { x: 0, y: st6.ceiling, width: W, height: f5 - st6.ceiling, class: 'f-paper-2' }, g);
    [st7.ceiling, st6.ceiling].forEach(y => D.el('line', { x1: 0, y1: y, x2: W, y2: y, class: 'ln-cut' }, g));
    const ww = m ? 10 : 14;
    edgeWalls(g, W, roof.ceiling, H, ww);
    const L = M + (m ? 8 : 26);   // v0.6 F2(R11 5): 다른 장면과 같은 글 시작선(설명 상자 왼쪽 끝 = 벽 안 +26)
    const c7 = roof.ceiling, c6 = st7.ceiling, c5 = st6.ceiling;
    // 물리 방 셋(세 층은 낮고 넓어 가로·세로 배율이 다르다: 뒤집히면 바디가 그린 천장에 닿아야 하므로 등방으로 줄이지 않는다)
    const R7 = proom(W, c7, f7, false), R6 = proom(W, c6, f6, false), R5 = proom(W, c5, f5, false);

    // 바디: 엔진의 세 층 가구 배치 그대로. 글 블록 copy:1 = 7층(S4-01), copy:0 = 5층(S4-02)
    // 뒤집힌 결과 포즈(층 좌표, 엔진이 안 잡을 때만): 같은 x에서 그 방의 천장(옛 천장선) 위로 떨어진 자세
    const pose = (b, ceil, hh, deg) => { if (b) b.el.dataset.poseFlipped = [b.cx, ceil + hh / 2, deg].map(v => v.toFixed(1)).join(','); };
    const ball = body(stage, '7:ball', 'ball', R7); pose(ball, c7, ball?.h, 150);
    const ch7 = body(stage, '7:chair', 'chair', R7, { mirror: true }); pose(ch7, c7, ch7?.w, 90);
    const cp7 = body(stage, '7:cup', 'cup', R7); pose(cp7, c7, cp7?.w, 90);
    const f6s = furnish6(stage, g, R6, W, ww, { deskW: 300 });
    const ch6 = f6s.chair, mg6 = f6s.mug; pose(ch6, c6, ch6?.w, -90); pose(mg6, c6, mg6?.h, 180);
    const pl5 = body(stage, '5:plant', 'plant', R5); pose(pl5, c5, pl5?.w, -90);
    // 글 블록의 뒤집힌 자세: 같은 천장에 떨어진 물건(누운 의자·컵은 높이가 폭이 된다)을 피해 빈 자리에 눕는다
    //   빈 자리가 없으면(좁은 화면) 그 상태에서 숨긴다
    const lying = (b, side) => b && { x0: b.cx - (side ? b.h : b.w) / 2, x1: b.cx + (side ? b.h : b.w) / 2, y0: 0, y1: 1 };
    const b1 = textBody(stage, 'copy:1', R7, W), b2 = textBody(stage, 'copy:0', R5, W);
    const fpose = (b, obs, ceil, deg) => {
      if (!b) return;
      const x0 = freeSpan(obs.filter(Boolean), 8, W - 8, b.w, 12);
      b.el.dataset.poseFlipped = x0 == null ? '' : [x0 + b.w / 2, ceil + b.h / 2, deg].map(v => v.toFixed(1)).join(',');
    };
    fpose(b1, [lying(ball), lying(ch7, true), lying(cp7, true)], c7, 182);
    fpose(b2, [lying(pl5, true)], c5, 177.5);
    if (b2 && m) b2.el.dataset.poseFlipped = '';    // 모바일: 뒤집힌 5층은 듣기 카피 상자 아래
    if (b1 && sh) b1.el.dataset.poseFlipped = '';   // 낮은 뷰포트: 뒤집힌 7층 천장은 화면 아래 끝

    // 배경(물리에 없음): 바디·글 블록과 겹치지 않을 때만
    const B = [ball, ch7, cp7, ch6, mg6, pl5, b1, b2];
    if (!m && !sh) {
      const wx = W * .444, wy = c7 + 30, wh = Math.max(0, Math.min(130, rh - 60));
      if (clear(B, wx, wx + 220, wy, wy + wh)) D.windowEl(g, wx, wy, 220, wh, .7);
    }
    const sw = (m ? 130 : 260) * (m ? .6 : .9), ss = m ? .6 : .9;
    // 버튼은 5층 바닥 아래 슬래브 띠에 둔다(아래). 낮은 화면만 방 안(왼쪽 아래)이라 그 자리를 비운다
    const ctlCorner = !m && !sh;
    const ctlZone = sh ? { x0: 0, x1: L + 220, y0: 0, y1: H } : null;
    const sx0 = freeSpan([pl5, ctlZone], ww, W - ww, sw + 16 * ss);
    if (sx0 != null) D.sofa(g, sx0 + 8 * ss, f5, sw, ss);
    const ox = W - ww / 2 - (m ? 18 : 26);
    if (clear(B, ox - 10, ox + 10, f7 - 36, f7 - 8)) D.outlet(g, ox, f7 - 22, s);
    const tx = W - ww / 2 - (m ? 44 : 70);   // 방 이름표: 오른쪽 벽 쪽(왼쪽 아래는 버튼 자리)
    const kMin = 12 / listenK(layer);         // v0.7 F3-10: 듣기 자세에서 회전층이 줄어도(휴대폰 .84) 화면 글 12 이상
    [[c7, '7층'], [c6, '6층'], [c5, '5층']].forEach(([y, t]) => { if (clear(B, tx - 4, tx + 40 * s, y + 8, y + 34)) D.roomTag(g, tx, y + 26, t, s * 1.3, kMin).dataset.room = t; });
    stage.toggleAttribute('data-short', sh);   // v0.9b: 낮은 화면 복귀 설명(오른쪽 아래)이 6층 방 이름표 자리를 덮는다 → site.css가 그동안 숨김
    const lps = sh ? .5 : s, llen = sh ? 46 : m ? 60 : 84, lcone = sh ? 60 : m ? 90 : 120;
    physLamp(stage, g, '6', R6, c6, lps, lcone, [f6s.desk ? f6s.desk.x + f6s.desk.w * .62 : W * .52, llen], [ch6, mg6].map(rectOfBody));
    physLamp(stage, g, '5', R5, c5, lps, lcone, [m ? W * .62 : W * .42, llen], [b2, pl5].map(rectOfBody));

    waveLayer(stage, '7-6', f7, H, W);
    waveLayer(stage, '6-5', f6, H, W);
    qa(stage, '[data-wave-layer="6-7"]').forEach(el => place(el, 0, st7.ceiling, W, 0));   // 뒤집힌 뒤 6층 → 7층(위로)
    qa(stage, '[data-wave-layer="5-6"]').forEach(el => place(el, 0, st6.ceiling, W, 0));
    strip(stage, '7-6', (st7.soft + st7.slabBottom) / 2, m ? 8 : 12, W);
    strip(stage, '6-5', (st6.soft + st6.slabBottom) / 2, m ? 8 : 12, W);
    // 뒤집힌 뒤 내 방 '…?'(upright 요소, 화면에서는 오른쪽 가운데). 낮은 화면은 왼쪽 위 듣기 큐를 피해 더 오른쪽
    react(stage, '7', m ? W * .5 : sh ? W * .3 : W * .38, roof.ceiling + (m ? 70 : 76));

    // 돌지 않는 겹 층
    // 데스크톱: 무대 오른쪽 아래 구석(도면 표제란 자리). 정착 뒤 5층 바닥에 떨어진 글 블록(x≈127)이 버튼 밑에 깔리지 않는다
    const ctl = q(section, '[data-place="s4-controls"]');
    // v0.2.2: 5층 바닥선 아래 슬래브 띠 안. 물건은 슬래브에 들어오지 않으므로 복귀 뒤 화분·글 블록이 어디에 떨어져도 덮지 않는다
    const cue = qa(section, '[data-flip-cue="listen"]')[0];
    const back = qa(section, '[data-flip-cue="return"]')[0];
    // v0.6 F2b: 두 번째부터 버튼 줄이 커진다([data-flip-again], watchControls) → 무대 전체를 다시 그리지 않고 이 자리만 다시 잰다.
    // 낮은 화면은 오른쪽 아래 복귀 설명이 커진 버튼 줄과 겹치지 않게 함께 잰다(844×390: '한 번 더 뒤집기'가 상자 밑으로 들어갔다)
    // v0.9 G2(judge N1): 휴대폰·낮은 화면은 둘째 상태([data-flip-again] — [다시 7층으로] + '한 번 더 뒤집기', 휴대폰은 작은 단)의 상자 크기를
    // 처음부터 잡는다 → 정착 순간 버튼 줄이 커지며 버튼·복귀 설명이 밀리던 것(CLS 844 0.144). 같은 부모 안에서 복제본을 보이지 않게 재고 바로 지운다
    const againBox = () => {
      const c = ctl.cloneNode(true);
      c.setAttribute('data-flip-again', ''); c.classList.remove('is-corner');
      c.querySelectorAll('[hidden]').forEach(e => e.removeAttribute('hidden'));
      c.querySelector('.hint')?.remove();
      const lb = c.querySelector('[data-flip-label]'); if (lb) lb.textContent = '한 번 더 뒤집기';
      Object.assign(c.style, { position: 'absolute', left: '0', top: '0', visibility: 'hidden', minWidth: '', minHeight: '', width: '', maxWidth: (W - 2 * L) + 'px' });
      c.setAttribute('aria-hidden', 'true');
      ctl.parentNode.appendChild(c);
      const r = { w: c.offsetWidth, h: c.offsetHeight }; c.remove();
      return r;
    };
    let ctlW = 0;   // v0.9b: 이 배치의 버튼 상자 최대 폭 → 복귀 설명 왼쪽 끝(667: 정착 때 옆 밀림 방지)
    stage._placeCtl = () => {
      if (!ctl) return;
      ctl.classList.toggle('is-corner', ctlCorner);
      ctl.style.minWidth = ctl.style.minHeight = '';
      if (!ctlCorner) { const ab = againBox(); ctl.style.minWidth = ab.w + 'px'; ctl.style.minHeight = ab.h + 'px'; }
      const cb = measure(ctl, W - 2 * L), band = H - f5;
      ctlW = Math.max(ctlW, cb.w);
      const inBand = !sh && band >= cb.h + 4;
      const top = inBand ? f5 + (band - cb.h) / 2 : Math.min(H - (sh ? 72 : m ? 128 : 112), H - cb.h - 12);
      if (ctlCorner) Object.assign(ctl.style, { left: 'auto', bottom: 'auto', right: (ww / 2 + 24) + 'px', top: top.toFixed(1) + 'px' });
      else { ctl.style.right = ctl.style.bottom = ''; place(ctl, L, top); }
      if (sh && back) {
        const left = Math.max(W - M - Math.min(440, W * .52), L + ctlW + 16);
        back.style.width = (W - M - left) + 'px'; place(back, left, 0); back.style.top = 'auto'; back.style.bottom = '8px';
      }
    };
    if (back) back.style.bottom = '';   // v0.9b: _placeCtl 앞에서 지운다(뒤에서 지우면 낮은 화면 bottom: 8px가 사라져 y=0, 머리띠 밑)
    stage._placeCtl();
    // v0.6 F2(motion R10-5): 480 이하에서 준비·회전 동안 arch가 [data-s4-question]을 열고 움직이는 S4-02 글 블록(copy:0)은 visibility로 가린다.
    // 고정 질문은 회전층 밖, 그 글 블록이 바로 선 자세로 쉬는 자리 — 열리는 순간 글이 제자리에 있고, 건물만 그 밑에서 돈다
    const fq = q(section, '[data-s4-question]');
    if (fq && b2) { place(fq, b2.cx - b2.w / 2, b2.cy - b2.h / 2); fq.style.width = Math.ceil(b2.w) + 'px'; }
    // v0.3 센서로 뒤집힌 동안(data-sensor-state="inverted")은 무대가 돌지 않고 사람이 휴대폰을 돌린다.
    // 듣기 큐는 site.css가 180° 돌리고(사람에게 똑바로), 자리는 화면 위아래를 맞바꾼다(top 값 → bottom 값) → 사람 눈에는 버튼 경로와 같은 자리
    const inverted = section.dataset.sensorState === 'inverted';
    if (cue) { cue.style.bottom = ''; cue.style.maxWidth = ''; }
    if (sh) {
      // 낮은 뷰포트: 듣기 큐는 왼쪽 위(뒤집힌 7층 천장에 떨어진 바디·글을 가리지 않게).
      // v0.6 F2(R11 9): 복귀 큐는 오른쪽 아래 — 오른쪽 위에 두면 돌아온 7층의 S4-01 글 덩어리 윗부분을 덮었다(844×390)
      if (cue) { place(cue, L, hud + 8); cue.style.width = Math.min(420, W * .5) + 'px'; }
      // 복귀 큐(오른쪽 아래)는 위 _placeCtl이 버튼 줄과 함께 놓는다
    } else {
      // v0.5 E5(QA v0.5 1280·1440 covered): 넓은 화면의 듣기 설명은 뒤집힌 6층 방(의자가 6층 바닥 = 화면에서 슬래브 위에 눕는 자리)과
      // 내 천장 밑('6층 의자' 표지)을 둘 다 비우도록 맨 위(뒤집힌 5층 방, 머리띠 바로 아래)에 둔다. 의자는 듣기가 시작될 때 아직
      // 떨어지거나 미끄러지는 중이라 좌우로 피할 자리를 미리 알 수 없다(실측: 시작 x와 0.6초 뒤 x가 다름) → 위아래로 비킨다.
      // v0.6 F2(R7 2): 절정 글을 키우면서(1440 80px) 넓은 화면은 늘 넓은 상자 — 큰 글·S4-06을 한 줄씩, 상자 폭 = 글 폭(최대 벽 사이).
      // 그래야 상자 아래 끝이 뒤집힌 6층 바닥의 의자 키보다 위에 머문다
      cue?.classList.toggle('is-wide', !m);
      if (cue) {
        place(cue, L, m ? (H - f5) + 14 : hud + 12);
        cue.style.width = m ? (W - 2 * L) + 'px' : 'auto';
        if (!m) cue.style.maxWidth = (W - 2 * L) + 'px';
      }
      // v0.6 F2(아이디어 ①): 휴대폰 복귀 설명은 돌아온 6/7 슬래브의 '7층 바닥' 이름표 위에서 끝난다(320: 상자 아래 끝이 이름표를 덮었다)
      // v1.0(v0.9b 6절): 넓은 화면은 글 폭 상자(최대 760)를 7/6 슬래브 가운데에. 760 고정·(H − f6) + 8 자리는 정착한 6층 의자(1280 −18)·
      //   7층 공·의자(1024·1280 −15)를 덮었다. 아래 끝 ≤ 6층 바닥 − 의자 키 − 12, 위 끝 ≥ S4-01 글 블록 아래 + 12. 안 맞으면 이전 자리
      if (back) {
        back.style.width = m ? (W - 2 * L) + 'px' : 'auto';
        back.style.maxWidth = m ? '' : '760px';
        const bh = hiddenBox(back, m ? W - 2 * L : 760).h;
        let by = (H - f6) + 8;
        if (m) by = Math.max(hud + 8, Math.min(hud + 40, f7 - 40 - bh));
        else {
          const hi = Math.max(hud + 8, b1 ? b1.y1 + 12 : 0), lo = f6 - (ch6 ? ch6.h : 0) - 12 - bh;
          if (hi <= lo) by = Math.min(lo, Math.max(hi, (f7 + c6) / 2 - bh / 2));
        }
        place(back, L, by);
      }
    }
    if (cue && inverted) { cue.style.bottom = cue.style.top; cue.style.top = 'auto'; }
    // 센서 카드(S4-10~S4-16): 6층 방 한가운데(휴대폰 아래쪽 버튼 띠·위쪽 글 블록을 가리지 않는다).
    // 낮은 화면은 오른쪽 아래(7층 바닥 밑, 왼쪽 아래 버튼과 떨어져)
    const sensor = q(section, '[data-place="s4-sensor"]');
    if (sensor) {
      const sw = Math.min(m ? W - 2 * L : 400, W - 2 * L);
      sensor.style.width = sw + 'px';
      if (sh) Object.assign(sensor.style, { left: (W - M - sw) + 'px', top: 'auto', bottom: '8px', transform: 'none' });
      else { sensor.style.bottom = ''; place(sensor, m ? L : W - M - sw, (c6 + f6) / 2); sensor.style.transform = 'translateY(-50%)'; }
    }
    // 센서 알림(S4-13·14·17·18·20): 중력 뒤집기 버튼 바로 위에 아래부터 쌓인다(S4-17은 버튼과 함께 읽힌다)
    const msgs = q(section, '[data-place="s4-msgs"]');
    if (msgs && ctl) {
      const top = parseFloat(ctl.style.top) || H - 112;
      msgs.style.width = Math.min(m ? W - 2 * L : 420, W - 2 * L) + 'px';
      Object.assign(msgs.style, { top: 'auto', bottom: (H - top + 8).toFixed(1) + 'px' });
      const corner = ctl.classList.contains('is-corner');
      msgs.classList.toggle('is-right', corner);
      if (corner) Object.assign(msgs.style, { left: 'auto', right: ctl.style.right });
      else Object.assign(msgs.style, { left: L + 'px', right: 'auto' });
    }

    // v0.6 F2 아이디어 ① '같은 선이 내 천장이 된다': 6/7 슬래브(7층 바닥 ~ 6층 천장) 한 판을 옅은 쿵 색으로 — 회전해도 그 판을 눈으로 따라간다.
    // 이름표 두 개는 회전층 밖 겹층(setupSlabLabels)이 같은 판의 한 점(slabY, anchorX)에 붙인다
    D.el('rect', { x: 0, y: f7, width: W, height: c6 - f7, class: 's4-same-slab' }, g);
    const geo = { scene: 's4', w: W, h: H, mobile: m, short: sh, walls: [0, W], roof: roofY, rotate: 'center',
      floors: { 7: f7, 6: f6, 5: f5 }, ceilings: { 7: c7, 6: c6, 5: c5 },
      slabs: { '7-6': { top: f7, bottom: st7.slabBottom }, '6-5': { top: f6, bottom: st6.slabBottom }, '5-4': { top: f5, bottom: st5.slabBottom } } };
    publish(stage, geo);
    applyPerspective(section);
    if (layer) layer.style.setProperty('--stage-w', W + 'px');
    slabLabels.update?.();   // v0.6 F2 아이디어 ①: 새 크기의 판 좌표로 이름표를 다시 잰다(표지보다 먼저 — 표지가 이름표를 피한다)
    renderMarks(stage);   // v0.5: 다시 배치해도(창 크기 변경) 띠의 쿵·'6층 의자' 표지가 새 좌표로 남는다
    if (PREVIEW === 'flipped') {   // 미리보기: 6층 의자 쿵이 6/7 슬래브를 지나 내 방으로(층 좌표에서는 위쪽)
      const sv = marks(stage);
      const fx = ch6 ? +ch6.el.dataset.poseFlipped.split(',')[0] : W * .3;
      D.wave(sv, fx, c6, .85, { dir: -1, scale: s * 1.1, depth: c6 - roof.ceiling + 20, step: m ? 30 : 44 });
    }
  };

  /* ───────────── S5 · 다시 7층, 매트 한 장 (v0.3) ─────────────
     같은 공(7:ball)을 같은 높이에서 맨바닥 한 번, 매트 위 한 번. 그림 = 시험 성적서:
     공은 낙하 지점 위 점선에 매달려 있고, 왼쪽 치수선이 "같은 높이"를, 바닥의 점선 사각형이 매트 자리를 보인다.
     결과는 오른쪽에 막대 두 개(맨바닥 = 쿵 색, 매트 = 완충재 무늬)와 줄어든 만큼의 치수, 띠의 쿵 두 번, 6층 펜던트 대비.
     값은 엔진이 채우는 [data-impact-before|after]를 읽는다(또는 LandingArt.matResult). 낙하 높이는 [data-stage="s5"]의 data-drop-height.
     MAT: 낙하 열 x(무대 폭 비율), 매트 폭·두께(엔진 방 단위 480×158). 엔진 프리셋이 정해지면 LandingArt.matLayout({x, width, thickness}) */
  const MAT = { x: .65, width: 96, thickness: 4 };
  let matOver = null, matLampOver = null;
  Art.matLayout = o => { if (o) { if (o.x != null) MAT.x = o.x; if (o.width) MAT.width = o.width; if (o.thickness) MAT.thickness = o.thickness; } layoutAll(); };
  Art.matResult = r => { matOver = r || null; const st = q(document, '[data-stage="s5"]'); st && renderMarks(st); };
  Art.matLamp = r => { matLampOver = r || null; const st = q(document, '[data-stage="s5"]'); st && renderMarks(st); };   // {before, after}: 6층 펜던트 최대 |각|(rad)

  SCENES.s5 = (section, stage) => {
    const { g, W, H } = room(stage); const m = W <= 720, sh = isShort(H), s = sh ? .6 : m ? .75 : 1, M = margin(W);
    const cm = m && !sh && H < 700, hud = hudH(W, H);
    const floorY = Math.round(H * (sh ? .70 : cm ? .46 : m ? .51 : .68)), roofY = sh ? hud + 30 : m ? 96 : 112;
    D.el('rect', { x: 0, y: 0, width: W, height: H, class: 'f-paper' }, g);
    const roof = D.floorStack(g, 0, W, roofY, { scale: s });
    D.parapet(g, 0, W, roofY, s);
    const fs = D.floorStack(g, 0, W, floorY, { scale: s });
    D.el('rect', { x: 0, y: fs.ceiling, width: W, height: H - fs.ceiling, class: 'f-paper-2' }, g);
    D.el('line', { x1: 0, y1: fs.ceiling, x2: W, y2: fs.ceiling, class: 'ln-cut' }, g);
    const ww = m ? 10 : 16;
    edgeWalls(g, W, roof.ceiling, H, ww);
    const bandY = (fs.soft + fs.slabBottom) / 2, bandH = m ? 10 : 14;
    D.band(g, 0, W, bandY, bandH);
    const R7 = proom(W, roof.ceiling, floorY, true);
    // 시험 장치: 낙하 지점(x), 높이(0 = 물리 방 윗면 — hooks.js의 height와 같은 식), 매트 자리
    const hRaw = parseFloat(stage.dataset.dropHeight), dh = Number.isFinite(hRaw) ? Math.max(0, Math.min(.92, hRaw)) : .5;
    const mx = MAT.x * W, mw = MAT.width * R7.sx, mt = Math.max(m ? 6 : 8, MAT.thickness * R7.sy);
    const x0 = mx - mw / 2, x1 = mx + mw / 2, dropY = R7.top + dh * (floorY - R7.top);
    const ball = body(stage, '7:ball', 'ball', R7, { at: { x: MAT.x * PHYS.width, y: (dropY - R7.top) / R7.sy } });
    const br = ball ? ball.h / 2 : 14;
    if (!m && !sh) {   // 배경 창(물리에 없음): 공·매줄과 겹치지 않을 때만
      const wx = W * .444, wy = roof.ceiling + 96;
      if (clear([ball], wx, wx + 250, wy, wy + 200) && wx + 250 < mx - br - 30) D.windowEl(g, wx, wy, 250, 200);
    }
    // 매트 자리(점선) — 매트를 깔면 "매트 한 장"으로 바뀐다(site.css .when-off/.when-on)
    D.el('rect', { x: x0, y: floorY - mt, width: mw, height: mt, rx: Math.min(3, mt / 3), class: 'ln-spot when-off' }, g);
    const tag = (t, cls) => { const e = D.el('text', { x: x1, y: floorY - mt - 7, class: 'svg-annot ' + cls, 'text-anchor': 'end' }, g); e.textContent = t; };
    tag('매트 자리', 'when-off'); tag('매트 한 장', 'when-on mat-annot');
    // 같은 높이: 천장 걸쇠에서 공까지 점선, 공 아래~바닥 치수선(왼쪽)
    D.el('line', { x1: mx, y1: roof.ceiling + 4 * s, x2: mx, y2: dropY - br - 4, class: 'ln-motion' }, g);
    D.el('rect', { x: mx - 10 * s, y: roof.ceiling, width: 20 * s, height: 4 * s, class: 'ln-beyond f-paper' }, g);
    const dx = mx - br - (m ? 10 : 16), dy0 = dropY + br + 3;
    if (floorY - dy0 > 18) {
      D.el('line', { x1: dx, y1: dy0, x2: dx, y2: floorY, class: 'ln-thin ln-leader' }, g);
      [dy0, floorY].forEach(y => D.el('line', { x1: dx - 5, y1: y, x2: dx + 5, y2: y, class: 'dim-tick' }, g));
      if (!cm) { const t = D.el('text', { x: dx - 7, y: (dy0 + floorY) / 2 + 4, class: 'svg-annot', 'text-anchor': 'end' }, g); t.textContent = '같은 높이'; }   // 320: 안내 글 자리라 눈금만
    }
    // 매트(엔진이 hidden을 푼다): 완충재 단면 무늬 — 바닥 속 완충재 켜와 같은 그림
    const mat = qa(stage, '[data-mat]')[0];
    if (mat) {
      const key = `${mw.toFixed(1)}:${mt.toFixed(1)}`;
      if (mat.dataset.artKey !== key) {
        const sv = D.el('svg', { viewBox: `0 0 ${mw} ${mt}`, width: mw.toFixed(1), height: mt.toFixed(1), 'aria-hidden': 'true', focusable: 'false' });
        D.el('rect', { x: .75, y: .75, width: mw - 1.5, height: mt - 1.5, rx: Math.min(3, mt / 3), fill: 'url(#pat-soft)', class: 'ln-mat' }, sv);
        mat.replaceChildren(sv); mat.dataset.artKey = key;
      }
      const cy = floorY - mt / 2;
      mat.style.width = mw.toFixed(1) + 'px'; mat.style.height = mt.toFixed(1) + 'px'; mat.style.transformOrigin = '0 0';
      Object.assign(mat.dataset, { shape: 'box', w: mw.toFixed(1), h: mt.toFixed(1), cx: mx.toFixed(1), cy: cy.toFixed(1), angle: '0' });
      mat.style.transform = poseStr(mx, cy, 0);   // 매트는 물리 바디 이름이 아니라 엔진이 잡지 않는다 → 엔진이 무대를 잡아도 늘 이 자리
    }
    // 말린 매트(나선 단면): 매트 자리 왼쪽 끝. 깔면 오른쪽으로 굴러가며 펼쳐지고 사라진다
    const rr = Math.max(m ? 9 : 11, 7 * R7.sy), roll = qa(stage, '[data-mat-roll]')[0];
    if (roll) {
      if (roll.dataset.artKey !== rr.toFixed(1)) {
        const sv = D.el('svg', { viewBox: `${-rr} ${-rr} ${2 * rr} ${2 * rr}`, width: (2 * rr).toFixed(1), height: (2 * rr).toFixed(1), 'aria-hidden': 'true', focusable: 'false' });
        D.el('circle', { r: rr - .9, class: 'f-soft-tint ln-mat' }, sv);
        let d = '';
        for (let i = 0; i <= 72; i++) { const t = i / 72, a = t * 6 * Math.PI, r = rr * (.16 + .7 * t); d += (i ? 'L' : 'M') + (r * Math.cos(a)).toFixed(2) + ',' + (r * Math.sin(a)).toFixed(2); }
        D.el('path', { d, class: 's-soft', 'stroke-width': 1.3 }, sv);
        roll.replaceChildren(sv); roll.dataset.artKey = rr.toFixed(1);
      }
      place(roll, x0 - 2 * rr - 3, floorY - 2 * rr, 2 * rr, 2 * rr);
      roll.style.setProperty('--roll-dx', (mw + 3).toFixed(1) + 'px');
      roll.style.setProperty('--roll-turn', ((mw + 3) / rr * 180 / Math.PI).toFixed(0) + 'deg');
    }
    // 6층(작은 창): 펜던트와 방 이름
    // 320: 결과 문장(S5-04)이 펜던트 바로 밑을 지나므로 펜던트를 오른쪽 벽 가까이 두고 대비 그림은 벽 쪽으로 흔든다(레드팀 v0.3 6절 4번)
    // v0.7 F3b(호스트 검수 · QA v04-mat-compared 390): 휴대폰(390)은 펜던트가 W·0.8이라 대비 잔상의 줄이 결론 첫 줄 끝('않습니다.')을
    // 지났고 '매트 위' 이름표가 결과 줄에 얹혔다 → 휴대폰도 오른쪽 벽 가까이(320과 같은 자리). 잔상은 그대로 왼쪽으로 흔들고,
    // 결론 둘째 줄이 짧아 생긴 오른쪽 빈자리에 이름표가 선다
    const lx = Math.round(cm || m ? W - ww / 2 - 40 : W * (sh ? .58 : .75)), ls = sh ? .5 : m ? .66 : 1;
    D.canopy(g, lx, fs.ceiling, ls);
    lamp(stage, '6', lx, fs.ceiling + 5 * ls, sh ? 34 : cm ? 26 : m ? 64 : 107, ls, sh ? 60 : m ? 130 : 190);
    if (!m) D.roomTag(g, W - ww / 2 - (sh ? 50 : 70), fs.ceiling + (sh ? 20 : 30), '6층', s * 1.3);
    waveLayer(stage, '7-6', floorY, H, W);
    strip(stage, '7-6', bandY, bandH, W);
    // 막대 자리(오른쪽 벽 쪽): 맨바닥 | 매트 위, 오른쪽 끝에 줄어든 만큼의 치수
    const barW = cm ? 12 : m ? 18 : sh ? 22 : Math.round(Math.min(36, W * .025)), gap = Math.max(8, Math.round(barW * .8)), brk = cm ? 12 : 16;
    const bx1 = W - ww / 2 - (m ? 12 : sh ? 30 : 56) - brk;
    // 글
    const L = M + (m ? 8 : 26);
    const head = q(section, '[data-place="s5-head"]'), steps = q(section, '[data-place="s5-steps"]');
    const res = q(section, '[data-place="s5-result"]'), lampN = q(section, '[data-place="s5-lamp"]'), keyN = q(section, '[data-place="s5-key"]');
    const copy = section.querySelector('.copy');
    // 데스크톱 결과 글(S5-04 + S5-07)은 막대 위에 놓이므로, 숨은 S5-04까지 켠 높이만큼 막대 최대 높이를 줄인다(1280×720에서 지붕에 닿지 않게)
    let hmax = (floorY - roof.ceiling) * (sh ? .45 : m ? .42 : .55);
    if (res && !m && !sh) { res.style.width = '300px'; hmax = Math.max(60, Math.min(hmax, floorY - roof.ceiling - 52 - measure(res).h - 16)); }
    stage._mat = { floorY, mx, mt, lx, ls, hmax, font: cm ? 12 : m ? 14 : sh ? 15 : 20, swing: cm ? -1 : 1,
      bars: { before: [bx1 - 2 * barW - gap, bx1 - barW - gap], after: [bx1 - barW, bx1] } };
    // 제목 묶음: 부제 세 가지(S5-08·S5-08b·S5-02)가 한 칸에 겹쳐 가장 긴 것의 높이를 늘 차지한다(site.css) →
    // 엔진이 부제를 바꿔도 단계 목록과 겹치지 않고 밀리지도 않는다(레드팀 v0.3 6절 4번)
    const headW = Math.max(150, Math.min(m || sh ? 9999 : 560, mx - br - (m || sh ? 24 : 60) - L));
    if (head) { head.style.width = headW + 'px'; place(head, L, roof.ceiling + (sh ? 8 : cm ? 10 : m ? 18 : 40)); }
    const headB = head ? head.offsetTop + head.offsetHeight : roof.ceiling + 90;
    let stepsY = headB + 26;
    if (steps) {
      steps.classList.toggle('is-row', sh);
      let sb = measure(steps, sh ? mx - br - 24 - L : W - 2 * L);
      if (!m && !sh && headB + 26 + sb.h > floorY - 18) { steps.classList.add('is-row'); sb = measure(steps, mx - br - 40 - L); }   // 낮은 데스크톱 창(1280×720): 한 줄로
      stepsY = m ? H - (cm ? 12 : 22) - sb.h : sh ? headB + 6 : Math.min(headB + 26, floorY - 18 - sb.h);
      place(steps, L, stepsY);
    }
    const unset = el => { if (el) { el.style.left = el.style.right = el.style.top = el.style.bottom = ''; } };
    [res, lampN].forEach(unset);
    if (res) {
      if (m) { res.style.width = (W - 2 * L) + 'px'; Object.assign(res.style, { left: L + 'px', bottom: (H - stepsY + 36).toFixed(1) + 'px' }); }
      else if (sh) {
        // v0.7 F3-4: S5-07이 길어져(사실 문장) 6층 오른쪽(높이 70)에서 셋째 줄이 화면 밖으로 잘렸고, 결과 줄 끝이 '6층' 이름표에 닿았다 →
        // 7층 방 안, 공이 떨어지는 열 오른쪽 ~ 막대 왼쪽 빈 벽에 둔다(데스크톱이 결과 글을 막대 위에 두는 것과 같은 생각). 매트 이름표 위에서
        // 끝나지 않으면 예전 자리(6층 오른쪽)
        const rx0 = mx + br + 24, rx1 = bx1 - 2 * barW - gap - 18;
        res.style.width = (rx1 - rx0).toFixed(0) + 'px'; place(res, rx0, roof.ceiling + 8);
        if (rx1 - rx0 < 220 || roof.ceiling + 8 + res.offsetHeight > floorY - mt - 26) { res.style.width = (W * .38 - M) + 'px'; place(res, W * .62, fs.ceiling + 4); }
      }
      else Object.assign(res.style, { right: (W - bx1 - brk).toFixed(1) + 'px', bottom: (H - (floorY - hmax - 52)).toFixed(1) + 'px' });
    }
    if (lampN) {   // S5-05: 데스크톱은 6층 펜던트 오른쪽, 휴대폰은 결과 줄 바로 아래(버튼 위) — 숨어 있어도 자리는 같다(밀림 없음)
      if (m) Object.assign(lampN.style, { left: L + 'px', bottom: (H - stepsY + 8).toFixed(1) + 'px' });
      else if (sh) place(lampN, lx - 190, fs.ceiling + 26);
      else place(lampN, lx + 56, fs.ceiling + 34);
    }
    // S5-06: 6층 천장에 매달린다(S0 제목 2행과 같은 문법). 짧은 휴대폰은 6층이 좁아 S5 제목 자리를 이어받는다
    copy?.classList.toggle('key-replaces-head', cm);
    if (keyN) {
      keyN.style.width = cm ? headW + 'px' : '';
      if (cm) place(keyN, L, roof.ceiling + 10);
      else { keyN.style.left = L + 'px'; D.hangFrom(keyN, fs.ceiling, sh ? 6 : m ? 12 : 22, '배려는거창하지'); }
    }

    const geo = { scene: 's5', w: W, h: H, mobile: m, short: sh, walls: [0, W], roof: roofY,
      floors: { 7: floorY }, ceilings: { 7: R7.top }, lines: { ceilings: { 7: roof.ceiling, 6: fs.ceiling } },
      slabs: { '7-6': { top: floorY, bottom: fs.slabBottom, band: bandY, bandHeight: bandH } },
      drop: { x: MAT.x, height: dh, y: dropY }, mat: { x0: x0 / W, x1: x1 / W, top: floorY - mt, thickness: mt } };
    publish(stage, geo);
    renderMarks(stage);
  };

  /* S5 결과 그림: 막대 두 개·치수·띠의 쿵 두 번·6층 펜던트 대비. 값이 없으면 빈 자리(점선)만 */
  const numOf = el => { const v = parseFloat((el?.textContent || '').replace(/[^\d.]/g, '')); return Number.isFinite(v) ? v : null; };
  function drawMat(stage) {
    const geo = stage._geo, k = stage._mat; if (!geo || !k) return;
    const sec = stage.closest('section');
    let svg = qa(stage, 'svg[data-art-mat]')[0];
    if (!svg) { svg = D.el('svg', { 'data-art-mat': '', class: 'marks', 'aria-hidden': 'true', focusable: 'false' }); stage.appendChild(svg); }
    svg.setAttribute('viewBox', `0 0 ${geo.w} ${geo.h}`); svg.replaceChildren();
    const v = { before: matOver?.before ?? numOf(q(sec, '[data-impact-before]')), after: matOver?.after ?? numOf(q(sec, '[data-impact-after]')) };
    const has = x => x != null && x >= 0;
    const vmax = Math.max(100, has(v.before) ? v.before : 0, has(v.after) ? v.after : 0);
    const hOf = x => Math.max(3, k.hmax * Math.min(x, 999) / vmax);
    const seen = stage._matSeen || (stage._matSeen = {});
    const tags = {};
    [['before', 'is-before', '맨바닥'], ['after', 'is-after', '매트 위']].forEach(([key, cls, label]) => {
      const [a, b] = k.bars[key], cx = (a + b) / 2, x = v[key];
      let top = k.floorY - 12;
      if (!has(x)) D.el('rect', { x: a, y: top, width: b - a, height: 12, class: 'bar-slot' }, svg);
      else {
        const h = hOf(x); top = k.floorY - h;
        D.el('rect', { x: a, y: top, width: b - a, height: h, class: `bar ${cls}${seen[key] === x ? '' : ' is-new'}` }, svg);
        seen[key] = x;
        const t = D.el('text', { x: cx, y: top - 7, class: 'bar-v ' + cls, 'text-anchor': 'middle', style: `font-size:${k.font}px` }, svg); t.textContent = Math.round(x);
        top -= k.font + 9;
      }
      tags[key] = { cx, y: top - 6, label, cls };
    });
    // v0.4: 이름표는 모든 폭에서(휴대폰에서 빠지면 숫자 두 개만 남아 어느 쪽이 매트인지 색으로만 읽힌다).
    // 막대가 좁아 두 이름표가 가로로 겹치면 높은 쪽을 한 줄 더 올린다. 오른쪽 벽을 넘지 않게 끝을 맞춘다
    {
      const fs = 12, tb = tags.before, ta = tags.after;   // v0.7 F3-10: 화면 글 12 아래 금지(휴대폰 11이던 것)
      const wOf = s => {   // 실제 글자 폭(그리기 전이면 한글 1em·공백 0.3em으로 어림)
        const t = D.el('text', { class: 'svg-annot mat-tag', style: `font-size:${fs}px` }, svg); t.textContent = s;
        let w = 0; try { w = t.getBBox().width; } catch (e) { /* 아직 안 그려짐 */ }
        t.remove(); return w || [...s].reduce((a, c) => a + (c === ' ' ? .3 : 1), 0) * fs;
      };
      // '매트 위'는 맨바닥 막대와 감소 치수 화살표(막대 오른쪽 +8) 사이에 넣는다(좁은 막대에서 화살표에 걸리지 않게)
      const lo = k.bars.before[1] + 2, hi = k.bars.after[1] + 6, wa = wOf(ta.label);
      if (hi - lo >= wa) ta.cx = Math.min(Math.max(ta.cx, lo + wa / 2), hi - wa / 2);
      else ta.cx = hi - wa / 2;   // 안 들어가면 화살표 앞에서 끝낸다(맨바닥 값과 얹히면 아래에서 뺀다)
      if (Math.abs(tb.cx - ta.cx) < (wOf(tb.label) + wa) / 2 + 4 && Math.abs(tb.y - ta.y) < fs + 3) {
        if (tb.y <= ta.y) tb.y = ta.y - fs - 3; else ta.y = tb.y - fs - 3;
      }
      // 아주 좁은 막대(320)에서 '매트 위'가 맨바닥 값 글자에 얹히면 뺀다(같은 색 숫자의 결과 문장·'매트 한 장' 표지가 같은 말을 한다)
      if (has(v.before)) {
        const vy = k.floorY - hOf(v.before) - 7, vw = String(Math.round(v.before)).length * k.font * .62, bc = (k.bars.before[0] + k.bars.before[1]) / 2;
        if (ta.cx - wa / 2 < bc + vw / 2 + 2 && ta.cx + wa / 2 > bc - vw / 2 - 2 && ta.y > vy - k.font - 2 && ta.y - fs < vy + 2) ta.skip = true;
      }
      [tb, ta].filter(o => !o.skip).forEach(o => {
        const x = Math.min(o.cx, geo.w - 6 - wOf(o.label) / 2);
        const t = D.el('text', { x, y: o.y, class: 'svg-annot mat-tag ' + o.cls, 'text-anchor': 'middle', style: `font-size:${fs}px` }, svg); t.textContent = o.label;
      });
    }
    if (has(v.before) && has(v.after) && v.after < v.before) {   // 줄어든 만큼: 맨바닥 높이에서 매트 높이까지
      const yb = k.floorY - hOf(v.before), ym = k.floorY - hOf(v.after), xr = k.bars.after[1] + 8;
      D.el('line', { x1: k.bars.before[1] + 3, y1: yb, x2: xr + 4, y2: yb, class: 'dim-ext' }, svg);
      D.el('line', { x1: xr, y1: yb, x2: xr, y2: ym - 1, class: 'dim-line' }, svg);
      D.el('path', { d: `M${xr - 4},${ym - 8} L${xr},${ym - 1} L${xr + 4},${ym - 8}`, class: 'dim-line' }, svg);
    }
    // 띠: 같은 자리의 쿵 두 번(맨바닥 = 쿵 색, 매트 = 완충 색). S0·S1 기록은 renderMarks가 먼저 흐리게 그렸다
    qa(stage, '[data-record-strip="7-6"] svg.strip-art').forEach(art => {
      const h = +art.getAttribute('height');
      if (has(v.before)) D.burst(art, k.mx, h / 2, h, Math.min(1, v.before / 180), !has(v.after), geo.mobile ? 24 : 34);
      if (has(v.after)) D.burst(art, k.mx, h / 2, h, Math.min(1, v.after / 180), true, geo.mobile ? 24 : 34).classList.add('is-soft');
    });
    // 6층 펜던트 대비: S5-05(진폭이 실제로 15% 넘게 줄었을 때 엔진이 연다)가 보일 때만 그린다 — 그림이 문장보다 앞서 말하지 않게.
    // 각도는 엔진 값(LandingArt.matLamp), 없으면 쿵 값에 비례(상한 0.6rad)
    const lampEl = qa(stage, '[data-physics-lamp="6"]')[0], cue = q(sec, '[data-cue="s5-05"]');
    const cueOn = cue && (!cue.hidden || document.documentElement.dataset.preview === 'mat');
    if (lampEl && cueOn && has(v.before) && has(v.after)) {
      const ax = +lampEl.dataset.ax, ay = +lampEl.dataset.ay, s = k.ls, len = +lampEl.dataset.len - 2 * s;
      const ang = (x, given) => Number.isFinite(given) ? Math.abs(given) : .6 * Math.min(x, 240) / 240;
      const sw = k.swing || 1;   // 1 = 왼쪽으로 흔든 모양, −1 = 오른쪽(벽 쪽, 320)
      const ghost = (a, cls) => {
        const gg = D.g(svg, { class: 'lamp-ghost ' + cls, transform: `rotate(${(sw * a * 180 / Math.PI).toFixed(2)} ${ax} ${ay})` });
        D.el('line', { x1: ax, y1: ay, x2: ax, y2: ay + len - 28 * s }, gg);
        D.el('path', { d: `M${ax - 9 * s},${ay + len - 28 * s} L${ax + 9 * s},${ay + len - 28 * s} L${ax + 36 * s},${ay + len} L${ax - 36 * s},${ay + len} Z` }, gg);
      };
      const ab = ang(v.before, matLampOver?.before), aa = ang(v.after, matLampOver?.after);
      ghost(ab, 'is-before'); ghost(aa, 'is-after');
      const r = len + 10 * s; let d = '';
      for (let i = 0; i <= 16; i++) { const a = aa + (ab - aa) * i / 16; d += (i ? 'L' : 'M') + (ax - sw * r * Math.sin(a)).toFixed(1) + ',' + (ay + r * Math.cos(a)).toFixed(1); }
      D.el('path', { d, class: 'dim-line lamp-arc' }, svg);
      // v0.4 같은 이름표: 7층 막대(원인)와 같은 낱말·색을 6층 조명 잔상(결과)에도 단다 — 호의 두 끝 바깥.
      // 펜던트가 아주 작은 화면(320·낮은 화면)은 글이 그림을 덮으므로 빼고, S5-05 문장이 같은 말을 한다
      if (r >= 45) {
        const end = a => [ax - sw * r * Math.sin(a), ay + r * Math.cos(a)];
        const [xb, yb] = end(ab), [xa, ya] = end(aa);
        // v0.7 F3b: 이름표가 S5 글줄(제목·단계·결과·S5-05·결론 — 상자가 아니라 실제 글줄 사각형)이나 벽에 닿으면 그 이름표는 뺀다
        // (S5-05 문장이 같은 말을 한다). 결론 둘째 줄처럼 짧은 줄 오른쪽의 빈자리는 쓸 수 있다
        const sr = stage.getBoundingClientRect(), rng = document.createRange(), texts = [];
        ['s5-head', 's5-steps', 's5-result', 's5-lamp', 's5-key'].map(p => q(sec, `[data-place="${p}"]`))
          .filter(e => e && !e.hidden && getComputedStyle(e).visibility !== 'hidden')
          .forEach(e => {
            const walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
            for (let n = walk.nextNode(); n; n = walk.nextNode()) {
              if (!n.textContent.trim() || n.parentElement.closest('[hidden]') || getComputedStyle(n.parentElement).visibility === 'hidden') continue;
              rng.selectNodeContents(n);
              for (const b of rng.getClientRects()) if (b.width && b.height) texts.push({ l: b.left - sr.left, r: b.right - sr.left, t: b.top - sr.top, b: b.bottom - sr.top });
            }
          });
        // 자리 후보: 호 끝 바깥(기본) → 12px 위 → 24px 위. 처음 비는 자리에 선다(값이 작으면 호 끝이 낮아 결과 줄 높이까지 내려온다)
        const put = (x, y, text, cls, anchor) => {
          const t = D.el('text', { x, class: 'svg-annot mat-tag lamp-tag ' + cls, 'text-anchor': anchor }, svg); t.textContent = text;
          for (const dy of [0, -12, -24]) {
            t.setAttribute('y', (y + dy).toFixed(1));
            try {
              const bb = t.getBBox(); if (!bb.width) return;
              const l = bb.x - 3, rr = bb.x + bb.width + 3, tp = bb.y - 1, bt = bb.y + bb.height + 1;
              if (l < 4 || rr > geo.w - 4 || texts.some(o => l < o.r + 4 && rr > o.l - 4 && tp < o.b + 2 && bt > o.t - 2)) continue;
              svg.insertBefore(D.el('rect', { x: l, y: tp, width: bb.width + 6, height: bb.height + 2, rx: 2, class: 'tag-chip' }), t);
              return;
            } catch (e) { return; /* 아직 안 그려짐 */ }
          }
          t.remove();
        };
        put(xb - sw * 7, yb + 4, '맨바닥', 'is-before', sw > 0 ? 'end' : 'start');
        put(xa + sw * 7, ya + 13, '매트 위', 'is-after', sw > 0 ? 'start' : 'end');
      }
    }
  }

  /* S6 · 끝 화면: 엘리베이터 안 */
  SCENES.s6 = (section, stage) => {
    const board = q(section, '[data-place="s6-board"]');
    // v0.9 G4(judge 8 · C2 '1440 오른쪽 빈칸'): 넓은 두 단에서 카드 옆 오른쪽 단 아래가 비어 있다(1440 약 400px) → 눈금(S6-17)을 그 빈칸,
    // 버튼·면책 아래로 올린다(S6 세로 길이 −약 360px). 오른쪽 단이 카드 아래 끝을 넘거나 폭이 480 미만이면 원래 자리(요약판 기준 줄 아래).
    // 무대 크기(room)를 재기 전에 옮긴다 — 패널 높이가 바뀌기 때문
    // v1.0 C2(judge): ① 1280·1366 기록 있음·1440 빈 상태도 오른쪽 단이 비었다(카드 끝 − 단 끝 296~339) → 넘침 제한(+160)을 뺀다.
    //   요약판에 두면 S6이 눈금 전체만큼 길어지므로 단이 카드보다 길어져도 오른쪽 단이 짧다.
    //   ② 오른쪽 단에서는 기준 한 줄(S6-16 .recap-def)을 눈금 제목 바로 아래로 옮긴다 — 숫자보다 기준이 먼저 읽힌다(F3-2). 새 줄은 없다(옮길 뿐)
    const ruler = q(section, '.ruler'), side = q(section, '.end .side'), head = q(section, '.recap-head');
    const def = q(section, '.recap-def'), cap = ruler && q(ruler, '.ruler-h');
    // v1.0c: '건물을 아직 뒤집어 보지 않았어요' 띠도 오른쪽 단일 때는 단 안(안내문 아래, 눈금 위)으로. 원래 자리는 처음 본 곳(E3 뒤)
    const band = q(section, '[data-flip-missed]');
    if (band && !band._home) band._home = { parent: band.parentNode, next: band.nextSibling };
    if (ruler && side && head) {
      const home = () => {
        if (ruler.previousElementSibling !== head) head.after(ruler);
        ruler.classList.remove('is-side');
        if (def && def.parentNode !== head) head.appendChild(def);
        if (band?._home && band.parentNode !== band._home.parent) band._home.parent.insertBefore(band, band._home.next);
      };
      if (section.clientWidth > 720 && board) {
        if (ruler.parentNode !== side) side.appendChild(ruler);
        ruler.classList.add('is-side');
        if (def && cap && cap.nextElementSibling !== def) cap.after(def);
        if (band && ruler.previousElementSibling !== band) ruler.before(band);
        const sb = side.getBoundingClientRect(), bb = board.getBoundingClientRect();
        if (side.clientWidth < 480 || sb.top >= bb.bottom - 2) home();
      } else home();
      // v1.0e(judge N13): 오른쪽 단 높이는 'S6에 들어갈 때 될 상태'로 미리 잰다. S6이 화면 밖일 때(로드·크기 변경·기록이 생길 때·
      // S4에서 뒤집은 뒤) 정해 두고, S6 진입·이탈 때 일어나는 상태 변화는 그 높이 안에서만 일어난다(스크롤 중 문서 높이 변화 0).
      //   · 7-6 기록이 하나라도 있으면 엔진이 S6 진입 때 '기록 있음'으로 바꾼다(adapters: events.length, 같은 때 Art.record) →
      //     빈 상태 안내를 미리 숨기고(data-s6-will-done, site.css) 기록 있음 모양으로 잰다
      //   · S4가 한 번 뒤집혔으면(#s4[data-flip-seen="true"] = 엔진 flipMode) '건물을 아직…' 띠는 다시 뜨지 않는다 → 자리를 잡지 않는다.
      //     아니면 숨어 있어도 자리를 지킨다(data-s6-band-reserve, site.css) — S6 활성 때 그 자리에 켜진다
      //   v1.0b·c의 '빈 상태 + 띠' 최대 높이(846)는 기록 있음·뒤집은 뒤 출처 줄 아래 약 150px을 비웠다
      const sizeSide = () => {
        const on = ruler.classList.contains('is-side');
        const done = records.some(r => r.slab === '7-6');
        const seen = q(document, '#s4')?.dataset.flipSeen === 'true';
        section.toggleAttribute('data-s6-will-done', on && done);
        section.toggleAttribute('data-s6-band-reserve', on && !seen);
        side.style.minHeight = '';
        if (!on) return;
        const st = section.dataset.resultState;
        if (done && st !== 'done') section.dataset.resultState = 'done';   // 같은 동기 구간에서 그 모양으로 재고 되돌린다
        const h = side.offsetHeight;
        if (st === undefined) delete section.dataset.resultState; else if (section.dataset.resultState !== st) section.dataset.resultState = st;
        side.style.minHeight = h + 'px';
      };
      section._sizeSide = sizeSide;
      sizeSide();
      delete side.dataset.minW;
    }
    const { g, W, H } = room(stage); const m = W <= 720, M = margin(W);
    D.el('rect', { x: 0, y: 0, width: W, height: H, class: 'f-paper' }, g);
    const top = hudH(W, innerHeight), bot = H - (m ? 18 : 28);
    D.el('line', { x1: 0, y1: top + 10, x2: W, y2: top + 10, class: 'ln-beyond' }, g);
    const r = board ? board.getBoundingClientRect() : null, sr = stage.getBoundingClientRect();
    // v0.5: 카드·버튼 줄 아래에 E2 안내판·E3·투표가 붙어 패널이 길어졌다 → 손잡이 레일은 카드 줄 바로 아래(안내판 위)를 지나고,
    // 카드와 오른쪽 단 사이 가운데 이음선은 레일에서 끝난다(아래 투표 문단을 가로지르지 않게). 바깥 이음선은 바닥까지
    const rowB = [r, ...['.end .side', '.end > .missed'].map(s => q(section, s)).filter(e => e && !e.hidden).map(e => e.getBoundingClientRect())]
      .filter(b => b && b.height).map(b => b.bottom - sr.top);
    const ry = rowB.length ? Math.min(H - 40, Math.max(...rowB) + 24) : H * .82;
    // 한 단 배치(휴대폰·태블릿 세로, site.css): 오른쪽 단이 카드 아래로 내려가면 가운데 이음선·레일 없이 휴대폰과 같게
    const sideR = q(section, '.end .side')?.getBoundingClientRect();
    const one = m || !r || (sideR && sideR.height && sideR.top >= r.bottom - 2);
    const seams = one ? [M - 4, W - M + 4] : [M - 10, r.right - sr.left + 36, W - M + 10];
    seams.forEach((x, i) => {
      const y2 = !one && i === 1 ? ry - 5 : bot;
      D.el('line', { x1: x, y1: top + 10, x2: x, y2, class: 'ln-thin' }, g); D.el('line', { x1: x + 3, y1: top + 10, x2: x + 3, y2, class: 'ln-thin', opacity: .5 }, g);
    });
    if (!one) {   // 손잡이 레일: 좁은 화면에서는 버튼 옆에 걸리므로 그리지 않는다(v0.2 #4)
      D.el('rect', { x: M, y: ry - 5, width: W - 2 * M, height: 10, rx: 5, class: 'f-paper ln-rail' }, g);
      [M + 40, W - M - 40].forEach(x => D.el('rect', { x: x - 4, y: ry + 5, width: 8, height: 18, class: 'ln-beyond f-paper' }, g));
    }
    D.el('line', { x1: 0, y1: bot, x2: W, y2: bot, class: 'ln-cut' }, g);
    for (let x = 0; x < W; x += 24) D.el('line', { x1: x, y1: bot + 4, x2: x + 12, y2: bot + 4, class: 'ln-thin' }, g);
    publish(stage, { scene: 's6', w: W, h: H, mobile: m });
  };

  /* v0.5 E5(심사 I1 ①): S4 듣기 설명 뒤 엔진이 다시 보이는 6층 의자 → 7층 충격.
     계약(lt-sol-arch-v05-연결): LandingArt.record({n:0, slab:'6-7', label:'6층 의자', x(엔진 좌표 0~1, 회전 전), value}).
     S3와 같은 문법 — 받는 쪽(뒤집힌 뒤 내 천장 = 층 좌표의 7층 바닥선) 아래 이름표 + 슬래브를 지나는 같은 x 일점쇄선 + 띠의 쿵.
     표지 SVG는 회전층 안(층 좌표)이라 이름표 묶음만 기준점에서 180° 돌려 세운다 → 버튼으로 뒤집든(무대가 돎) 휴대폰을 돌리든(사람이 돎)
     사람에게 똑바로 읽힌다. 바로 선 상태에서는 거꾸로라 site.css가 [data-perspective="downstairs"] 동안만 보인다.
     이번 반전(downstairs가 된 뒤)에 온 기록 중 최신 하나만. 듣기 설명·버튼 상자와 겹치면 반대쪽 → 한 줄씩 아래(화면 좌표로 실측) */
  function drawS4Chair(stage, svg) {
    const geo = stage._geo, W = geo.w, m = geo.mobile;
    const r = records.slice(s4Since).reverse().find(o => o.slab === '6-7'); if (!r) return;
    const x = r.x * W, f7 = geo.floors[7], c6 = geo.ceilings[6];
    qa(stage, '[data-record-strip="7-6"] svg.strip-art').forEach(art => {
      const h = +art.getAttribute('height');
      D.burst(art, x, h / 2, h, Math.min(1, r.value / 180), true, m ? 24 : 34);
    });
    const g = D.g(svg, { class: 's4-chair-mark', 'data-mark-n': String(r.n ?? 0), 'data-mark-label': r.label || '6층 의자', 'data-mark-value': String(r.value), 'data-mark-x': (+r.x).toFixed(3) });
    D.el('line', { x1: x, y1: c6, x2: x, y2: f7, class: 'ln-axis' }, g);
    const fs = Math.max(12.5, 12 / listenK(q(stage, '[data-flip-layer]')));   // v0.7 F3-10: 줄어든 회전층 안에서도 화면 12 이상
    const put = (left, drop) => {
      const t = D.g(g, { transform: `rotate(180 ${x.toFixed(1)} ${f7.toFixed(1)})` });
      D.tag(t, x, f7, r.label || '6층 의자', r.value, { below: true, now: true, left, drop, fs });
      return t;
    };
    const sec = stage.closest('section'), sr = stage.getBoundingClientRect();
    const seen = el => el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const avoid = ['[data-flip-cue="listen"]', '[data-place="s4-controls"]', '[data-place="s4-msgs"]', '[data-react="7"]'].map(s => q(sec, s))
      .filter(seen).map(e => e.getBoundingClientRect()).filter(b => b.width)
      .concat(slabLabels.rects?.() || []);   // v0.6 F2: 아이디어 ① 선 이름표, 내 방 '…?'(심사 v0.5c 4 — 844×390에서 표지가 말풍선을 덮었다)도 피한다
    const bad = t => {
      const c = (q(t, '.tag-chip') || q(t, 'text'))?.getBoundingClientRect();
      if (!c || !c.width) return false;   // 숨은 상태(바로 선 건물)에서는 잴 수 없다 → 기본 자리
      return c.left < sr.left + 4 || c.right > sr.right - 4
        || avoid.some(a => c.left < a.right + 4 && c.right > a.left - 4 && c.top < a.bottom + 4 && c.bottom > a.top - 4);
    };
    let t = null;
    for (const [left, drop] of [[false, 0], [true, 0], [false, 24], [true, 24], [false, 48], [true, 48]]) {
      t?.remove(); t = put(left, drop);
      if (!bad(t)) break;
    }
  }

  /* ───────────── 같은 사건 표지·띠 ───────────── */
  function renderMarks(stage) {
    const geo = stage._geo; if (!geo) return;
    const svg = marks(stage); svg.replaceChildren();
    const W = geo.w, m = geo.mobile;
    const slab = geo.scene === 's3' ? '6-5' : '7-6';
    const list = records.filter(r => (r.slab || '7-6') === slab);
    const test = geo.scene === 's5';   // S5: 지난 기록은 흐리게만, 시험 낙하 두 번은 drawMat
    qa(stage, `[data-record-strip="${slab}"] svg.strip-art`).forEach(art => {
      art.replaceChildren();
      const h = +art.getAttribute('height');
      list.forEach(r => {
        const p = r.label === '드르륵' ? D.scrape(art, r.x * W, h / 2, h, Math.min(1, r.value / 180), r.n === current, m ? 36 : 52)
          : D.burst(art, r.x * W, h / 2, h, Math.min(1, r.value / 180), r.n === current, m ? 24 : 34);
        if (test) p.classList.add('is-past');
      });
    });
    if (test) return drawMat(stage);
    if (geo.scene === 's4') return drawS4Chair(stage, svg);
    if (geo.scene === 's6') return;
    const sl = geo.slabs[slab]; if (!sl) return;
    const floor7 = geo.scene === 's0' || geo.scene === 's1';
    const upper = floor7 ? sl.top : null;                                    // 7층 바닥 위 표지(S0·S1)
    const lowerKey = slab === '7-6' ? 6 : 5;
    const lower = (geo.lines?.ceilings || geo.ceilings)[lowerKey];           // 아래층 천장 아래 표지(그린 천장선)
    const preview = document.documentElement.dataset.preview === 'impact';
    if (!list.length) {   // S2 기록 없음(S2-empty): 엔진의 기준 낙하 한 번도 같은 문법으로 위층에 보인다
      if (geo.scene === 's2' && stage._srcX != null) drawSource(svg, geo, { x: stage._srcX }, sl, lower, '7층, 공 한 번');
      return;
    }
    // v0.2 #9: x 차이 3% 이내 쿵은 한 묶음(자리 = 그 묶음의 가장 큰 쿵). 이름표는 한 묶음에만 —
    // 7층(S0)·5층(S3): 가장 최근 쿵의 묶음. 6층(S2): 재생 중인 쿵의 묶음(재생 전·후엔 가장 최근). 나머지 묶음은 점
    const groups = [];
    [...list].sort((a, b) => a.x - b.x).forEach(r => {
      const gr = groups[groups.length - 1];
      if (gr && r.x - gr.x0 <= .03) gr.items.push(r); else groups.push({ x0: r.x, items: [r] });
    });
    groups.forEach(gr => {
      gr.items.sort((a, b) => a.n - b.n);
      gr.top = gr.items.reduce((a, b) => (b.value > a.value ? b : a));
    });
    const own = geo.scene !== 's2';
    const latest = list[list.length - 1];
    const playing = !own && current != null ? list.find(r => r.n === current) : null;
    const focus = playing || latest;
    const ns = items => {
      const n = items.map(r => r.n);
      if (n.length === 1) return `#${n[0]}`;
      if (n[n.length - 1] - n[0] === n.length - 1) return `#${n[0]}–#${n[n.length - 1]}`;
      return n.length <= 3 ? n.map(v => `#${v}`).join('·') : `#${n[0]} 외 ${n.length - 1}`;
    };
    groups.forEach(gr => {
      const isFocus = gr.items.includes(focus);
      // v0.4.1: S2 재생 중(setCurrent(n))에는 묶음 대표(최대)가 아니라 재생 중인 그 기록 하나로 표지를 단다 —
      // S2-03 "같은 쿵 #n · 값"·출처 유령과 번호·값·자리가 같아야 한다(같은 열 #1=100·#2=200에서 #1 재생 → "쿵 #1 100")
      const solo = isFocus && !!playing;
      const r = solo ? playing : gr.top, x = r.x * W;
      if (!isFocus) {   // 점: 7층 바닥 위(S0) 또는 아래층 천장 아래
        if (upper != null) D.el('circle', { cx: x, cy: upper - 3, r: 2.4, class: 'f-ink', opacity: .45 }, svg);
        else if (lower != null) D.el('circle', { cx: x, cy: lower + 4, r: 2.4, class: 'f-ink', opacity: .45 }, svg);
        return;
      }
      const many = !solo && gr.items.length > 1;
      // S0·S1 모바일은 짧은 표기("#4–#5 158")로 폭을 줄인다(좁은 방에서 제목·버튼과 겹치지 않게).
      // U-07: "쿵 #n" · "드르륵 #n"(S1 의자 끌기, 번호는 같은 순번) · "6층 의자"(번호 없음)
      // v0.8b(arch 연결): 엔진이 7→6 기록에 번호 있는 표지 글(tagLabel "쿵 #1")을 넘긴다 — label은 사건 종류('쿵'·'드르륵')로 남는다
      const one = r.tagLabel ?? (r.label === '드르륵' ? `드르륵 #${r.n}` : (r.label || `쿵 #${r.n}`));
      const label = floor7 && m ? ns(gr.items) : many ? `쿵 ${ns(gr.items)} · 최대` : one;
      const tw = (label.length + String(r.value).length) * 7.6 + 14;
      const left = x + 4 + tw > W - 6;
      const now = own ? true : !!playing;
      if (preview) {   // 미리보기: 엔진이 그릴 정지 파동(결과 프레임)을 대신 그린다
        D.wave(svg, x, sl.top, Math.min(1, r.value / 180), { scale: m ? .75 : 1, depth: geo.h - sl.top, step: m ? 32 : 46 });
        qa(stage, '[data-physics-lamp]').forEach(l => l.style.setProperty('--lamp-angle', (own ? -.1 : -.2) + 'rad'));
      }
      const span = lf => (lf ? [x - 4 - tw, x - 4] : [x + 4, x + 4 + tw]);
      const hitsSide = (rr, lf) => { if (!rr) return false; const [a, b] = span(lf); return a < rr.right && b > rr.left; };
      const hits = rr => hitsSide(rr, left);
      let upDrop = 0, lowLabel = true, upLeft = left, upText = true, lowLeft = left;
      if (floor7) {
        const sec = stage.closest('section');
        const r1 = rectOf(q(sec, '[data-place="s0-line1"]'), stage), r2 = rectOf(q(sec, '[data-place="s0-line2"]'), stage);
        // 바닥 위 표지 글(v0.2.2): 공·의자·컵은 표지를 그린 뒤에도 바닥을 따라 움직이므로(공이 굴러감),
        // 자리를 피하는 대신 이 방에서 가장 큰 물건의 키보다 늘 위에 둔다. 제목 1행과는 옆으로 비키고, 못 비키면 그 위로
        const tallest = Math.max(0, ...qa(stage, '.pbody:not([hidden])').map(b => +b.dataset.h || 0));
        upDrop = Math.max(0, tallest - 14);
        const inside = lf => { const [a, b] = span(lf); return a > 4 && b < W - 4; };
        if (hitsSide(r1, upLeft)) {
          if (inside(!upLeft) && !hitsSide(r1, !upLeft)) upLeft = !upLeft;
          else upDrop = Math.max(upDrop, upper - r1.top - 8);
        }
        // 그래도 안내·버튼·'방금 그 쿵'·띠 설명 글에 얹히면 글은 빼고 눈금만(아래층 천장 표지가 같은 사건을 보인다)
        const [a, b] = span(upLeft), ty = upper - 18 - upDrop;
        const o = stage.getBoundingClientRect();
        const box = el => { const k = el.getBoundingClientRect(); return k.width ? { left: k.left - o.left, right: k.right - o.left, top: k.top - o.top, bottom: k.bottom - o.top } : null; };
        const shown = el => el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
        const copyRects = (geo.scene === 's1' ? ['s1-note'] : ['s0-intro', 's0-keys', 's0-after', 's0-band']).flatMap(k => {
          const el = q(sec, `[data-place="${k}"]`);
          if (!shown(el)) return [];
          return k === 's0-keys' ? [...el.children].filter(shown).map(box) : k === 's1-note' ? [box(el)] : [rectOf(el, stage)];   // 버튼은 하나씩(두 줄로 감기면 빈 자리가 생긴다)
        });
        if (copyRects.some(rr => rr && a < rr.right && b > rr.left && ty > rr.top - 2 && ty - 14 < rr.bottom + 2)) upText = false;
        if (hits(r2)) lowLabel = false;
        // v0.9 G1(judge N5): 6층 천장 표지(묶음 "쿵 #1–#3 · 최대 170")가 넓은 화면 세로 눈금 제목줄 "쿵 지수:"에 4px 붙었다(1280 '쿵' 가림) →
        // 띠 눈금과 12px 안이면 반대쪽으로 펼치고(2행 제목도 피해), 그것도 막히면 글은 빼고 점만(위층 표지가 같은 사건을 보인다)
        const bandEl = q(sec, '[data-place="s0-band"]'), bandR = shown(bandEl) ? box(bandEl) : null;
        if (lowLabel && bandR && lower != null) {
          const ly0 = lower + 12, ly1 = lower + 30;
          const near = lf => { const [p, z] = span(lf); return p < bandR.right + 12 && z > bandR.left - 12 && ly0 < bandR.bottom + 12 && ly1 > bandR.top - 12; };
          if (near(lowLeft)) {
            if (inside(!lowLeft) && !near(!lowLeft) && !hitsSide(r2, !lowLeft)) lowLeft = !lowLeft;
            else lowLabel = false;
          }
        }
      }
      if (upper != null) {
        if (upText) D.tag(svg, x, upper, label, r.value, { now, left: upLeft, drop: upDrop });
        else D.tag(svg, x, upper, '', null, { now });
      }
      if (lower != null) {
        const t = lowLabel ? D.tag(svg, x, lower, label, r.value, { below: true, now: !own && now, left: lowLeft, drop: !own && now && m ? 18 : 0 })
          : D.tag(svg, x, lower, '', null, { below: true });
        // 검수 훅: 아래층 천장 표지가 가리키는 기록(묶음이면 n은 "1-2"처럼 범위, 값은 최대)
        if (t) Object.assign(t.dataset, { markN: many ? `${gr.items[0].n}-${gr.items[gr.items.length - 1].n}` : String(r.n), markValue: String(r.value), markX: r.x.toFixed(3) });
      }
    });
    // 출처 = 지금 듣는 그 기록(묶음 대표가 아니라 재생 중인 #n 자체 — 번호·x가 S0 원본과 같다)
    if (geo.scene === 's2' && focus) drawSource(svg, geo, focus, sl, lower, focus.label === '드르륵' ? '7층, 아까 그 의자' : '7층, 아까 그 공');
  }

  /* 같은 사건의 위/아래(v0.4, S2): 6층에서 다시 듣는 쿵이 위층 어디에서 났는지.
     7층 바닥(화면 위 좁은 띠)의 같은 x에 출처를 점선 유령으로 둔다 — 단면도에서 점선 = 이 단면에 없는 것(여기선 위층의 내 물건).
     공은 S0과 같은 크기(PHYS 7:ball), '드르륵'이면 의자(띠에는 다리만 보인다). 유령 중심에서 슬래브를 지나 6층 천장 표지까지 일점쇄선 중심선.
     재생 쿵 순간(엔진이 LandingArt.cursor('s2', x)를 부른다)에 유령이 짧게 눌린다(줄이기 = 정지) */
  function drawSource(svg, geo, rec, sl, lower, text) {
    const W = geo.w, x = rec.x * W, floor = sl.top, sx = W / PHYS.width;
    const r = (PHYS.props['7:ball']?.w || 28) * sx / 2;
    const g = D.g(svg, { class: 'src-ghost', 'data-source-x': rec.x.toFixed(3), 'data-source-n': rec.n ?? '' });   // 점검용: 출처 x(0~1)·번호
    let topY = floor - 2 * r, right = x + r;
    if (rec.label === '드르륵') {
      const c = PHYS.props['7:chair'] || { w: 49, h: 64 };
      const s = Math.max(.2, Math.round(Math.min(c.h * sx / 120, 1.6 * c.w * sx / 66) * 100) / 100);
      const body = D.g(g, { class: 'sg-body sg-chair', transform: `translate(${x} 0) scale(-1 1) translate(${-x} 0)` });   // S0 의자와 같은 방향(거울)
      D.chair(body, x, floor, s);
      topY = floor - 119 * s; right = x + 32 * s;
    } else {
      D.el('circle', { cx: x, cy: floor - r, r: r - .8, class: 'sg-body sg-ball' }, g);
    }
    D.el('ellipse', { cx: x, cy: floor - 1, rx: r * 1.3, ry: Math.max(2.5, r * .22), class: 'sg-hitring' }, g);
    D.el('line', { x1: x, y1: Math.max(topY, floor - 2 * r) + r * .2, x2: x, y2: (lower ?? sl.bottom) + 3, class: 'ln-axis' }, g);
    const lf = right + 8 + text.length * 12 > W - 8;
    const t = D.el('text', { x: lf ? x - r - 8 : right + 8, y: floor - 7, class: 'svg-annot sg-label', 'text-anchor': lf ? 'end' : 'start' }, g);
    t.textContent = text;
    try { const bb = t.getBBox(); if (bb.width) g.insertBefore(D.el('rect', { x: bb.x - 4, y: bb.y - 1.5, width: bb.width + 8, height: bb.height + 3, rx: 2, class: 'tag-chip' }), t); } catch (e) { /* 아직 안 그려짐 */ }
    return g;
  }

  /* 공개 API (lt-sol-arch 연결용) */
  // v1.0e: S6 오른쪽 단 높이를 다시 잴 때(기록 변화·S4 뒤집힘). 한 프레임에 한 번
  let s6Raf = 0;
  const resizeS6 = () => { if (!s6Raf) s6Raf = requestAnimationFrame(() => { s6Raf = 0; q(document, '#s6')?._sizeSide?.(); }); };
  Art.record = function (r) {                    // {n, x(0~1), value, slab?, label?}
    records.push(Object.assign({ slab: '7-6' }, r));
    stages().forEach(renderMarks);
    Art.redrawCard?.();
    resizeS6();
  };
  Art.records = () => records.slice();
  Art.clearRecords = function () {
    records.length = 0; current = null; s4Since = 0;
    const s2 = q(document, '[data-stage="s2"]'); if (s2) s2._srcX = null;   // 기준 낙하 유령도 처음 상태로
    stages().forEach(renderMarks); Art.redrawCard?.();
    resizeS6();
  };
  // S4가 뒤집힌 세션(data-flip-seen)이면 S6 띠 자리를 뺀다. 단 S4가 화면에 있는 동안에는 미룬다 — 복귀가 바로 서는 순간(358.5°)에
  // S6 높이가 바뀌면 전체 다시 배치가 복귀 동작 한가운데 끼어 S4가 그 각도에 멈췄다(qa v06 1280). S4가 화면을 벗어날 때 잰다(S6은 아직 화면 밖)
  { const s4 = q(document, '#s4');
    if (s4) {
      let s4In = false, pend = false;
      if (window.IntersectionObserver) new IntersectionObserver(es => { s4In = es[es.length - 1].isIntersecting; if (!s4In && pend) { pend = false; resizeS6(); } }).observe(s4);
      new MutationObserver(() => { if (s4In) pend = true; else resizeS6(); }).observe(s4, { attributes: true, attributeFilter: ['data-flip-seen'] });
    } }
  Art.setCurrent = function (n) { current = n; stages().forEach(renderMarks); };
  Art.cursor = function (scene, t) {             // 재생 막대 위치(0~1). S2에서는 = 재생 쿵 순간(hooks.js renderThump)
    const st = q(document, `[data-stage="${scene}"]`);
    st && qa(st, '[data-replay-cursor]').forEach(c => { c.hidden = t == null; c.style.setProperty('--cursor', t ?? 0); });
    if (scene !== 's2' || !st || t == null) return;
    // v0.4: 위층 유령이 그 순간 눌린다. 기록이 없을 때(기준 낙하)는 이 x에 유령을 새로 그린다
    st._srcX = t;
    if (!records.some(r => (r.slab || '7-6') === '7-6')) renderMarks(st);
    const ghost = qa(st, 'svg[data-art-marks] .src-ghost')[0];
    if (ghost) { ghost.classList.remove('is-hit'); void ghost.getBoundingClientRect(); ghost.classList.add('is-hit'); }
  };
  Art.geometry = scene => q(document, `[data-stage="${scene}"]`)?._geo || null;
  Art.applyPose = function (scene, which) {      // 'rest' | 'flipped' — 엔진이 바디를 잡지 않을 때(줄이기·일시정지)
    const st = q(document, `[data-stage="${scene}"]`); if (!st) return;
    // 진자: 뒤집히면 줄이 느슨해져 갓이 천장에 눕는다
    qa(st, '[data-physics-lamp]').forEach((l, i) => {
      l.classList.toggle('is-fallen', which === 'flipped');
      l.style.setProperty('--lamp-angle', which === 'flipped' ? (i % 2 ? -1.45 : 1.45) + 'rad' : '0rad');
    });
    qa(st, '[data-physics-body]').forEach(el => {
      if (el.hidden) return;
      if (which === 'flipped' && el.dataset.poseFlipped) {
        const [x, y, a] = el.dataset.poseFlipped.split(',').map(Number);
        el.style.transform = poseStr(x, y, a); el.classList.add('is-settled');
      } else if (which === 'flipped' && el.dataset.poseFlipped === '') {
        el.style.visibility = 'hidden';
      } else {
        el.style.visibility = ''; el.classList.remove('is-settled');
        el.style.transform = poseStr(+el.dataset.cx, +el.dataset.cy, 0);
      }
    });
  };
  Art.layout = layoutAll;

  /* 관점(upstairs/downstairs) 변화: 큐 표시와, 엔진이 바디를 안 잡았을 때의 결과 포즈 */
  function applyPerspective(section) {
    const main = section.closest('[data-perspective]') || document.getElementById('main');
    const down = main && main.dataset.perspective === 'downstairs';
    const st = q(section, '[data-stage]');
    if (st && !st.hasAttribute('data-physics-live')) Art.applyPose('s4', down ? 'flipped' : 'rest');
  }

  function stages() { return [...document.querySelectorAll('[data-stage]')].filter(s => s._geo); }

  function layoutAll() {
    D.globalDefs();
    document.querySelectorAll('section[data-scene]').forEach(section => {
      const stage = q(section, '[data-stage]');
      const fn = SCENES[section.dataset.scene];
      if (stage && fn && !stage.clientWidth) return;   // 아직 숨은 장면: 자리를 잡을 때까지 글도 숨겨 둔다
      // v0.4.1 CLS: [data-place] 글은 자리를 잡기 전까지 숨어 있다(site.css .copy:not(.is-laid)).
      // 배치보다 먼저 켠다 — 배치 함수가 글·버튼의 실제 보임(visibility)을 읽는다. 같은 동기 구간이라 빈 자리 프레임은 그려지지 않는다
      section.querySelectorAll('.copy').forEach(c => c.classList.add('is-laid'));
      if (stage && fn) fn(section, stage);
    });
  }

  /* 시각 점검용 미리보기(?preview=…). 실제 흐름에서는 엔진이 같은 함수를 부른다 */
  function previewImpact() {   // 쿵 다섯 번을 친 뒤, 6층에서 #4를 재생하는 순간
    const m = document.documentElement.clientWidth <= 720;
    const xs = m ? [.24, .41, .89, .62, .64] : [.6, .68, .875, .795, .81];   // #4·#5는 3% 안 → 한 묶음(v0.2 #9 점검)
    [84, 132, 61, 158, 97].forEach((v, i) => records.push({ n: i + 1, x: xs[i], value: v, slab: '7-6' }));
    current = 4;
  }

  function setupPreview() {
    const only = params.get('scene');                       // 시각 점검용: 한 장면만 띄운다(?scene=s4). 준비 전이라 숨은 장면(S1·S5)도 연다
    if (only) {
      document.documentElement.dataset.only = only;
      const sec = document.querySelector(`section[data-scene="${only}"]`);
      if (sec) { sec.classList.add('is-only'); sec.hidden = false; }
    }
    if (!PREVIEW) return;
    const main = document.getElementById('main');
    document.documentElement.dataset.preview = PREVIEW;
    const $ = s => document.querySelector(s), show = s => document.querySelectorAll(s).forEach(e => { e.hidden = false; });
    const text = (s, v) => document.querySelectorAll(s).forEach(e => { e.textContent = v; });
    if (PREVIEW.startsWith('mat')) {   // v0.3 S5: mat0 = 시작, mat1 = 맨바닥 한 번 뒤, mat = 비교 끝(쿵 132 → 49)
      const s5 = $('section[data-scene="s5"]'), done = PREVIEW === 'mat';
      if (s5) s5.dataset.matTest = done ? 'done' : PREVIEW === 'mat1' ? 'before' : 'ready';
      show(PREVIEW === 'mat08' ? '[data-cue="s5-08"]' : '[data-cue="s5-08b"]');   // mat08 = 시작 화면, '내 최대 쿵 높이' 부제
      if (PREVIEW === 'mat1' || done) text('[data-impact-before]', '132');
      if (done) { show('[data-mat], [data-mat-result], [data-cue="s5-05"], [data-cue="s5-after"]'); text('[data-impact-after]', '49'); text('[data-impact-reduction]', '63'); }
    }
    if (PREVIEW.startsWith('sensor')) {   // v0.3 S4 센서 카드: sensor = 제안, sensor-tilt = 기울이는 중, sensor-fail = 실패 → 버튼, sensor-flip = 센서로 뒤집힘
      const s4 = $('section[data-scene="s4"]'), st = { sensor: 'idle', 'sensor-tilt': 'tilting', 'sensor-fail': 'fallback', 'sensor-flip': 'inverted' }[PREVIEW] || 'idle';
      if (s4) s4.dataset.sensorState = st;
      if (st === 'idle' || st === 'tilting') show('[data-sensor-offer]');
      if (st === 'fallback') text('[data-sensor-status]', '센서를 쓸 수 없어서, 버튼으로 뒤집을게요.');
      if (st === 'inverted') { main.dataset.perspective = 'downstairs'; show('[data-cue="s4-19"]'); }
    }
    if (PREVIEW === 's1') {   // v0.3 S1: 처음 안내, 끌기 한 번(드르륵)과 던지기 한 번이 새겨진 뒤
      show('[data-cue="s1-03"]');
      [[.3, 96, null], [.62, 74, '드르륵'], [.71, 168, null]].forEach(([x, value, label], i) => records.push({ n: i + 1, x, value, slab: '7-6', label }));
      setTimeout(() => Art.scuff('s1', .58, .66), 400);
    }
    if (PREVIEW === 'flipped') {   // v0.5 E5: 듣기 설명 뒤 6층 의자 재생 표지까지(물리 기본 실측: 쿵 141, x 176.71/480)
      main.dataset.perspective = 'downstairs'; show('[data-flip-cue="listen"]');
      records.push({ n: 0, slab: '6-7', label: '6층 의자', x: 176.71 / 480, value: 141 });
    }
    if (PREVIEW === 'returned') { main.dataset.perspective = 'upstairs'; main.dataset.flipReturned = ''; }
    if (PREVIEW === 'impact') { previewImpact(); records.push({ n: 6, x: .38, value: 118, slab: '6-5', label: '6층 의자' }); }
    if (PREVIEW === 'missed') document.querySelector('[data-flip-missed]')?.removeAttribute('hidden');   // v0.2 #8 한 줄 점검
    if (PREVIEW === 'missed-mat') document.querySelector('[data-mat-missed]')?.removeAttribute('hidden');   // v0.4 S6-12 매트 띠 점검(v0.5에서 E2 ③으로 흡수)
    // v0.5 S6: end-empty = 기록 0으로 도착(E1 + 빈 요약), end-done = 기록·S3·매트를 다 한 사람(요약 세 칸 값 — 실제는 arch가 채운다)
    if (PREVIEW === 'end-empty') { const s6 = $('#s6'); if (s6) s6.dataset.resultState = 'empty'; show('[data-flip-missed]'); }
    if (PREVIEW === 'end-done') {
      const s6 = $('#s6'); if (s6) s6.dataset.resultState = 'done';
      const cell = (k, from, to, sr) => { const li = $(`[data-recap="${k}"]`); if (!li) return; li.dataset.state = 'done'; li.querySelector('[data-recap-from]').textContent = from; li.querySelector('[data-recap-to]').textContent = to; li.querySelector('[data-recap-sr]').textContent = sr; };
      cell('kung', '쿵 #2 · 200', '6층 천장', '내 쿵 #2 · 200, 6층 천장에 그대로 닿았습니다.');
      cell('listen', '6층 의자 · 141', '7층 천장', '6층 의자 · 141, 7층 천장에 닿았습니다.');   // v0.7 F3-5 ②칸 반전 짝
      cell('mat', '쿵 200', '114', '같은 높이에서 맨바닥 쿵 200, 매트 위 쿵 114. 쿵 지수가 43% 줄었습니다.');
      const red = $('[data-recap-reduction]'); if (red) red.textContent = '43';   // v0.7 F3-2 S6-14c(실제는 엔진이 정수로)
      const mine = $('[data-ruler-mine]');   // v0.8 S6-17g 내 기록(실제는 엔진 showRulerMark)
      if (mine) { mine.hidden = false; mine.dataset.rulerValue = '200'; mine.dataset.rulerKind = 'thump'; mine.style.setProperty('--ruler-position', '100%');
        mine.querySelector('[data-ruler-mine-value]').textContent = '200'; }
    }
    if (PREVIEW.startsWith('result') || PREVIEW.startsWith('missed') || PREVIEW === 'end-done') {   // 엔진이 채울 결과 칸을 예시 값으로(FINAL-STORY 6.3 쿵쿵 드러머형)
      const set = (k, v) => { const e = document.querySelector(`[data-result-${k}]`); if (e) e.textContent = v; };
      set('title', '쿵쿵 드러머형'); set('copy', '박자감은 인정합니다. 아래층은 그 박자를 벌써 외웠습니다.');
      set('peak', PREVIEW === 'end-done' ? '200' : '184'); set('detail', '쿵 12번');
      if (PREVIEW === 'result-v2') { set('mat-before', '184'); set('mat-after', '68'); show('[data-result-mat], [data-result-sensor]'); }   // 카드 v2: 매트 줄 + 센서 배지
      if (PREVIEW === 'end-done') { set('mat-before', '200'); set('mat-after', '114'); show('[data-result-mat]'); }
      [[.12, 62], [.2, 88], [.27, 71], [.33, 184], [.41, 95], [.47, 77], [.55, 120], [.6, 66], [.66, 101], [.73, 58], [.8, 132], [.86, 90]]
        .forEach(([x, v], i) => records.push({ n: i + 1, x, value: v, slab: '7-6' }));
    }
  }

  /* v0.5(심사 v0.4.1 390 작은 묶음): U-08 첫 진동 안내(엔진이 첫 실제 진동 때 열고 3초 뒤 닫는다)는 휴대폰에서 화면 아래에 떠서
     S2의 6층 의자·머그나, 읽어 내려간 경우 S3 첫 문장·[6층 의자 밀기]를 덮었다.
       ① 자리: 휴대폰 S2에서 열리면 글 묶음 아래 ~ 6층 가구(의자·머그·책상·노트북 '…?') 위의 빈 띠에 띄운다. 띠가 모자라면 화면 아래 그대로.
       ② 시점: 열린 장면을 벗어나면(S3로 내려감) 화면에서만 걷는다(.is-away). 열고 닫는 것(hidden)은 엔진 몫이라 건드리지 않는다 */
  function watchU08() {
    const u08 = q(document, '[data-cue="u-08"]'); if (!u08) return;
    let shownIn = null;
    const sceneAt = () => {
      const y = innerHeight / 2;
      return [...document.querySelectorAll('section[data-scene]')].find(s => { const r = s.getBoundingClientRect(); return r.height && r.top <= y && r.bottom > y; })?.dataset.scene || null;
    };
    const place08 = () => {
      u08.style.bottom = '';
      if (u08.hidden) { shownIn = null; u08.classList.remove('is-away'); return; }
      shownIn ??= sceneAt();
      if (document.documentElement.clientWidth > 720 || shownIn !== 's2') return;
      const st = q(document, '[data-stage="s2"]'), copy = st && q(st.closest('section'), '[data-place="s2-copy"]');
      if (!st || !copy) return;
      const o = st.getBoundingClientRect(), cb = copy.getBoundingClientRect().bottom;
      const tops = qa(st, '[data-physics-body="6:chair"], [data-physics-body="6:mug"]')
        .map(e => e.getBoundingClientRect()).filter(r => r.height).map(r => r.top);
      if (Number.isFinite(st._deskTop)) tops.push(o.top + st._deskTop);
      // v0.6 F2: 노트북 '…?'는 같은 순간에 튀어나오며 부푸는 중이라(react-pop) 잰 높이가 낮다 → 숨어 있어도 놓일 자리(style.top)로 센다
      const lap = q(st, '[data-react="laptop"]');
      if (lap && lap.style.top) tops.push(o.top + parseFloat(lap.style.top));
      if (!tops.length) return;
      const top = Math.min(...tops), h = u08.offsetHeight;
      if (top - cb >= h + 16) { u08.style.bottom = Math.round(innerHeight - (top - 8)) + 'px'; return; }
      // v0.6 F2(심사 v0.5c 6): 320은 글 묶음 아래 띠가 모자라 화면 아래에 떠서 6층 가구·'…?'·S2 글을 덮었다 →
      // 글 묶음 위(머리띠 아래 ~ '6층입니다.' 위)의 띠에 둔다. 3초 동안 7층 바닥 띠를 덮지만, 그때 일어나는 6층 반응과 글은 보인다
      const hudB = q(document, '.hud')?.getBoundingClientRect().bottom ?? 56, ct = copy.getBoundingClientRect().top;
      if (ct - hudB >= h + 16) { u08.style.top = Math.round(hudB + 8) + 'px'; u08.style.bottom = 'auto'; }
    };
    let y0 = 0;
    new MutationObserver(() => { u08.style.top = ''; u08.classList.remove('is-away'); y0 = scrollY; place08(); }).observe(u08, { attributes: true, attributeFilter: ['hidden'] });
    // 열린 장면을 벗어나면 걷는다. v0.6 F2(심사 v0.5c 6 — 390 S3 첫 줄을 0.8초 덮음): 화면에 붙은 안내 밑으로 글·가구가 지나가기 시작하면
    // (열린 뒤 32px 넘게 스크롤, 또는 안내 자리가 열린 장면 밖) 화면에서 걷는다. 휴대폰만 — 데스크톱은 머리띠 아래 오른쪽 작은 상자
    const away = () => {
      if (u08.hidden || !shownIn) return false;
      if (document.documentElement.clientWidth <= 720 && Math.abs(scrollY - y0) > 32) return true;
      const sec = q(document, `section[data-scene="${shownIn}"]`), r = sec?.getBoundingClientRect(), t = u08.getBoundingClientRect();
      return sceneAt() !== shownIn || (r && t.height && (r.bottom < t.bottom + 4 || r.top > t.top - 4));
    };
    addEventListener('scroll', () => { if (!u08.hidden && shownIn) u08.classList.toggle('is-away', away()); }, { passive: true });
  }

  /* v0.6 F2b(story S4-22·23): 첫 뒤집기를 마치고 돌아온 뒤 arch가 버튼 줄에 [data-flip-again]을 붙이고 글을 '한 번 더 뒤집기'로 바꾼다.
     위계는 site.css. 버튼 줄의 크기가 바뀌면(링크가 나타남·글이 길어져 줄이 넘어감) 그 자리만 다시 잰다 — 390에서 둘째 줄이 화면 밖으로 나갔다 */
  function watchControls() {
    const ctl = q(document, '[data-place="s4-controls"]'); if (!ctl || !window.ResizeObserver) return;
    let last = '';
    new ResizeObserver(() => {
      const k = ctl.offsetWidth + 'x' + ctl.offsetHeight; if (k === last) return; last = k;
      q(document, '[data-stage="s4"]')?._placeCtl?.();
    }).observe(ctl);
  }

  /* 관찰: 관점·일시정지·줄이기 */
  function watch() {
    const main = document.getElementById('main');
    if (!main) return;
    // S0 큐('방금 그 쿵'·띠 설명)가 나타나거나 숨으면 바닥 표지 자리를 다시 잡는다(표지 글이 큐 글에 얹히지 않게)
    const s0 = q(document, '[data-stage="s0"]');
    const cues = s0 ? qa(s0.closest('section'), '[data-cue]') : [];
    if (cues.length) { const mo = new MutationObserver(() => s0._geo && renderMarks(s0)); cues.forEach(c => mo.observe(c, { attributes: true, attributeFilter: ['hidden'] })); }
    let last = main.dataset.perspective;
    new MutationObserver(() => {
      const now = main.dataset.perspective;
      if (last === 'downstairs' && now === 'upstairs') main.dataset.flipReturned = '';
      if (now === 'downstairs' && last !== 'downstairs') {   // v0.5 E5: 새 반전 — 지난 반전의 '6층 의자' 표지는 다시 띄우지 않는다
        s4Since = records.length;
        const s4st = q(document, '[data-stage="s4"]'); if (s4st?._geo) renderMarks(s4st);
      }
      last = now;
      const s4 = q(document, 'section[data-scene="s4"]'); if (s4) applyPerspective(s4);
    }).observe(main, { attributes: true, attributeFilter: ['data-perspective'] });
    // v0.3: 준비 전 숨어 있던 장면(S1·S5)이 열리면, S4 센서 상태·S5 낙하 높이가 바뀌면 다시 놓는다
    // v0.5: S6 결과 상태(E1 안내가 나타나고 사라짐)가 바뀌면 엘리베이터 손잡이 자리도 다시
    // v1.0e: 값이 실제로 바뀐 때만(한 묶음의 첫 옛값 ≠ 지금 값). S6 sizeSide가 같은 동기 구간에서 상태를 잠깐 바꿨다 되돌리는 것은 무시한다(아니면 다시 배치 → 다시 잼이 매 프레임 돈다)
    const re = new MutationObserver(recs => {
      const first = new Map();
      for (const r of recs) { const m = first.get(r.target) || new Map(); if (!m.has(r.attributeName)) m.set(r.attributeName, r.oldValue); first.set(r.target, m); }
      for (const [el, m] of first) for (const [a, old] of m) if (el.getAttribute(a) !== old) { relayout(); return; }
    });
    document.querySelectorAll('section[data-scene]').forEach(s => re.observe(s, { attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'data-sensor-state', 'data-result-state'] }));
    watchU08();
    const s5 = q(document, '[data-stage="s5"]');
    if (s5) {
      re.observe(s5, { attributes: true, attributeFilter: ['data-drop-height'] });
      // S5 값(엔진이 채움)과 S5-05가 바뀌면 막대·진자 대비를 다시 그린다
      const mo = new MutationObserver(() => s5._geo && renderMarks(s5)), sec = s5.closest('section');
      qa(sec, '[data-impact-before], [data-impact-after]').forEach(e => mo.observe(e, { childList: true, characterData: true, subtree: true }));
      qa(sec, '[data-cue="s5-05"], [data-mat-result]').forEach(e => mo.observe(e, { attributes: true, attributeFilter: ['hidden'] }));
    }
  }

  let raf = 0;
  const relayout = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(layoutAll); };
  /* 그림자 공 한 벌(낙하 미리보기·첫 조작 초대가 같이 쓴다): 점선 공 + 공 아래~바닥 치수선(양 끝 눈금) + 공 열의 연직선.
     to = 치수선이 끝나는 y(기본 바닥선, 초대는 진짜 공 윗면) */
  function dropGhost(svg, bx, by, r, floor, to = floor) {
    if (to - (by + r) > 10) {
      const lx = bx + r + 8;
      D.el('line', { x1: lx, y1: by + r, x2: lx, y2: to, class: 'dp-line' }, svg);
      [by + r, to].forEach(yy => D.el('line', { x1: lx - 5, y1: yy, x2: lx + 5, y2: yy, class: 'dp-tick' }, svg));
      D.el('line', { x1: bx, y1: by + r, x2: bx, y2: to, class: 'dp-line', opacity: .55 }, svg);
    }
    return D.el('circle', { cx: bx, cy: by, r, class: 'dp-ball' }, svg);
  }
  let inviteHover = () => {};    // 마우스 미리보기가 보이는 동안 초대를 잠시 숨긴다(setupInvite가 바꾼다)
  let inviteRender = () => {};   // S0 배치가 바뀌면 다시 그린다
  /* ───────────── 높이 낙하 미리보기(v0.2.2 #3, 데스크톱 마우스) ─────────────
     포인터가 7층 방 안(그린 천장 ~ 바닥)에 있으면 그 높이에서 떨어질 공을 그림자 공·치수선·바닥 그림자로 보인다.
     누름 판정과 같은 범위·같은 높이 식(modules/hooks.js actionFor: height = (y − ceilings[7]) / (floors[7] − ceilings[7])).
     버튼·공·바닥 띠(톡) 위에서는 그리지 않는다. 엔진이 입력을 막는 동안은 [data-stage="s0"]에 data-drop-preview="off"를 붙인다.
     엔진이 실제 낙하 열을 알려 주려면 LandingArt.dropColumn = (x0to1, height0to1) => x0to1 을 둔다(없으면 포인터 x). */
  function setupDropPreview() {
    const stage = q(document, '[data-stage="s0"]');
    if (!stage || !window.matchMedia) return;
    const fine = matchMedia('(hover: hover) and (pointer: fine)');
    let svg = null, raf = 0, last = null;
    const hide = () => { last = null; if (svg) svg.style.display = 'none'; inviteHover(false); };
    const draw = () => {
      raf = 0;
      const e = last, geo = stage._geo;
      if (!e || !geo || !(fine.matches || PREVIEW === 'drop') || stage.dataset.dropPreview === 'off') return hide();   // 점검 화면(헤드리스엔 포인터 없음)만 예외
      const o = stage.getBoundingClientRect(), x = e.clientX - o.left, y = e.clientY - o.top;
      const ceil = geo.lines?.ceilings?.[7] ?? geo.ceilings[7], top = geo.ceilings[7], floor = geo.floors[7];
      if (!(y >= ceil && y <= floor - 6)) return hide();
      const ball = q(stage, '[data-physics-body="7:ball"]'), r = ball ? (+ball.dataset.w || 40) / 2 : 20;
      const h = Math.max(0, Math.min(1, (y - top) / (floor - top)));              // 0 = 가장 높음
      let fx = x / geo.w;
      if (typeof Art.dropColumn === 'function') { const c = Art.dropColumn(fx, h); if (Number.isFinite(c)) fx = c; }
      const bx = Math.max(r, Math.min(geo.w - r, fx * geo.w)), by = Math.max(ceil + r + 2, Math.min(floor - r - 2, y));
      if (!svg) { svg = D.el('svg', { class: 'drop-preview', 'aria-hidden': 'true', focusable: 'false' }); stage.appendChild(svg); }
      svg.style.display = '';
      svg.setAttribute('viewBox', `0 0 ${geo.w} ${geo.h}`);
      svg.replaceChildren();
      const near = 1 - (floor - by - r) / Math.max(1, floor - ceil);              // 1 = 바닥 가까이
      D.el('ellipse', { cx: bx, cy: floor - 1, rx: r * (1.15 - .45 * near), ry: Math.max(2, r * .16), class: 'dp-shadow', opacity: (.06 + .12 * near).toFixed(3) }, svg);
      dropGhost(svg, bx, by, r, floor);
      inviteHover(true);
    };
    const move = e => {
      if (e.pointerType && e.pointerType !== 'mouse') return hide();
      if (e.target.closest && e.target.closest('[data-action], a, button')) return hide();   // 공·바닥 띠(톡)·버튼
      last = e; if (!raf) raf = requestAnimationFrame(draw);
    };
    stage.addEventListener('pointermove', move, { passive: true });
    stage.addEventListener('pointerleave', hide);
    stage.addEventListener('pointerdown', hide);
    addEventListener('scroll', hide, { passive: true });
    if (PREVIEW === 'drop') setTimeout(() => {   // 시각 점검: 방 위쪽 30% 지점에 포인터가 있는 모양
      const geo = stage._geo; if (!geo) return;
      const o = stage.getBoundingClientRect(), ceil = geo.lines?.ceilings?.[7] ?? geo.ceilings[7];
      const room = q(stage, 'svg[data-art-room]');
      room?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: o.left + geo.w * .5, clientY: o.top + ceil + (geo.floors[7] - ceil) * .3 }));
    }, 300);
  }

  /* ───────────── 첫 조작 초대(v0.4, S0 — 터치·키보드·마우스 공통) ─────────────
     마우스 미리보기는 포인터를 방에 올려야만 보인다. 그래서 휴대폰·키보드로 온 사람은 방 안 어디를 누르면 되는지 모른다.
     첫 쿵 전까지만 방 안에 "실제로 눌러도 되는 자리" 두 곳을 그린다.
       ① 유령 공: 진짜 공 바로 위, 글·버튼·가구를 피한 가장 높은 자리. 누르면 정말 그 높이에서 떨어진다(hooks.js actionFor와 같은 식).
       ② 바닥 '톡' 고리: 바닥선 위 빈 자리. 바닥 띠(data-hit="7")를 누르면 공이 그 자리에서 톡 튄다.
     고리 맥박은 1초 뒤 세 번만 뛰고 멈춘다(줄이기 = 정지 그림, 일시정지 = 엔진이 입력을 막으므로 숨김).
     첫 기록(LandingArt.record)·방 누름·버튼 누름 가운데 하나가 오면 초대는 영구히 걷힌다.
     버튼에 키보드 초점(:focus-visible)이나 마우스가 오면 그 버튼이 할 일을 같은 그림으로 방 안에 미리 그린다(첫 쿵 뒤에도).
       공 떨어뜨리기 = 방 높이의 절반(엔진 기본 낙하) · 높은 데서 = 방 윗면 · 바닥 톡 = 공 아래 고리.
     엔진이 입력을 막는 동안([data-stage="s0"][data-drop-preview="off"])은 아무것도 그리지 않는다. */
  function setupInvite() {
    const stage = q(document, '[data-stage="s0"]'); if (!stage) return;
    const section = stage.closest('section');
    const controls = qa(section, 'button[data-action="drop"], button[data-action="drop-high"], button[data-action="tap"]');
    let done = false, hover = false, mode = null, svg = null, pinged = false, lastX = null, pingAt = null;
    // 고리 맥박: 처음 그린 때부터 잰 시각으로 이어 뛴다(다시 그려도 처음부터 다시 뛰지 않는다). 1초 뒤 2.4초 × 3번
    const pingDelay = base => {
      if (pinged) return null;
      if (pingAt == null) pingAt = performance.now();
      const t = (performance.now() - pingAt) / 1000;
      if (t > 1.7 + 2.4 * 3) { pinged = true; return null; }
      return `animation-delay:${(base - t).toFixed(2)}s`;
    };
    const liveX = ball => {
      if (!ball) return NaN;
      const r = ball.getBoundingClientRect(), s = stage.getBoundingClientRect();
      return r.width ? r.left + r.width / 2 - s.left : +ball.dataset.cx;
    };
    const ready = () => PREVIEW === 'invite' || controls.some(b => !b.hidden);
    const blocked = () => stage.dataset.dropPreview === 'off' && PREVIEW !== 'invite';
    const clearSvg = () => { if (svg) { svg.replaceChildren(); svg.style.display = 'none'; } };
    const o = () => stage.getBoundingClientRect();
    const box = el => {   // hidden 속성이 아니라 실제로 보이는지로 판정(미리보기는 숨은 버튼을 CSS로 켠다)
      if (!el || getComputedStyle(el).display === 'none' || getComputedStyle(el).visibility === 'hidden') return null;
      const k = el.getBoundingClientRect(), s = o();
      return k.width ? { left: k.left - s.left, right: k.right - s.left, top: k.top - s.top, bottom: k.bottom - s.top } : null;
    };
    const bodyBox = id => {
      const b = qa(stage, `[data-physics-body="${id}"]`)[0]; if (!b || b.hidden) return null;
      const cx = +b.dataset.cx, cy = +b.dataset.cy, w = +b.dataset.w, h = +b.dataset.h;
      return Number.isFinite(cx) ? { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 } : null;
    };
    const meets = (a, b, pad = 6) => a && b && a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;
    // 바닥 '톡' 표지: 납작한 고리(바닥에 닿는 자리) + 위에 '톡'
    function tapMark(x, floor, r, ping, lift = 0) {
      const g = D.g(svg, { class: 'inv-tap' });
      const rx = Math.max(10, r * 1.05), ry = Math.max(3, r * .28);
      D.el('ellipse', { cx: x, cy: floor - 1, rx, ry, class: 'inv-ring' }, g);
      if (ping) D.el('ellipse', { cx: x, cy: floor - 1, rx, ry, class: 'inv-ping is-floor', style: ping }, g);
      const t = D.el('text', { x, y: floor - ry - 8 - lift, class: 'svg-annot inv-label', 'text-anchor': 'middle' }, g); t.textContent = '톡';
      chip(g, t);
      return g;
    }
    function chip(g, t) { try { const bb = t.getBBox(); if (bb.width) g.insertBefore(D.el('rect', { x: bb.x - 4, y: bb.y - 1.5, width: bb.width + 8, height: bb.height + 3, rx: 2, class: 'tag-chip' }), t); } catch (e) { /* 아직 안 그려짐 */ } }
    function render() {
      const geo = stage._geo;
      const want = mode || (!done && !hover && ready() ? 'invite' : null);
      if (!geo || !want || blocked()) return clearSvg();
      const ball = qa(stage, '[data-physics-body="7:ball"]')[0];
      // 버튼 미리보기 = 엔진이 버튼 낙하에 쓰는 자리(data-cx, hooks.js actionFor). 초대 = 지금 공이 있는 자리(엔진 공은 가만히 있다가도 굴러간다 —
      // 방을 누르면 누른 x에서 떨어지므로 유령은 늘 진짜 공 위에 둔다)
      const bx = want === 'invite' ? liveX(ball) : +ball?.dataset.cx, r = (+ball?.dataset.w || 40) / 2;
      if (!Number.isFinite(bx)) return clearSvg();
      if (want === 'invite') lastX = bx;
      if (!svg) { svg = D.el('svg', { class: 'drop-preview drop-invite', 'aria-hidden': 'true', focusable: 'false' }); stage.appendChild(svg); }
      svg.style.display = '';
      svg.setAttribute('viewBox', `0 0 ${geo.w} ${geo.h}`);
      svg.replaceChildren();
      svg.classList.toggle('is-invite', want === 'invite');
      svg.dataset.mode = want;   // 점검용: invite | drop | drop-high | tap
      const W = geo.w, ceil = geo.lines?.ceilings?.[7] ?? geo.ceilings[7], top = geo.ceilings[7], floor = geo.floors[7];
      const yOf = h => Math.max(ceil + r + 2, Math.min(floor - r - 2, top + h * (floor - top)));   // 공 중심 = 방 윗면 + h·(바닥 − 윗면)
      // 엔진이 낙하 열을 옮기면(가구·숨은 바디를 피함) 그 열에 그린다 — 미리보기와 같은 훅(LandingArt.dropColumn(x0to1, h0to1) → x0to1)
      const col = (x, h) => { if (typeof Art.dropColumn !== 'function') return x; const c = Art.dropColumn(x / W, h); return Number.isFinite(c) ? c * W : x; };
      if (want === 'tap') { tapMark(bx, floor, r, false, 2 * r); return; }
      if (want === 'drop' || want === 'drop-high') { const h = want === 'drop' ? .5 : 0; dropGhost(svg, col(bx, h), yOf(h), r, floor, floor - 2 * r); return; }
      // 초대: 피할 것 = 안내 글·버튼·제목 1행·가구(공 자신은 바로 아래라 뺀다)
      const avoid = [rectOf(q(section, '[data-place="s0-intro"]'), stage), rectOf(q(section, '[data-place="s0-line1"]'), stage),
        ...qa(section, '[data-place="s0-keys"] > *').map(box), bodyBox('7:chair'), bodyBox('7:cup')].filter(Boolean);
      // 이름표: 들어가는 가장 긴 문구(좁은 휴대폰은 짧게). 폭은 실제 글자로 잰다
      const words = ['누르면 이 높이에서 떨어집니다', '누르면 여기서 떨어집니다', '누르면 여기서'].map(text => {
        const t = D.el('text', { class: 'svg-annot inv-label' }, svg); t.textContent = text;
        let w = text.length * 12; try { w = t.getBBox().width || w; } catch (e) { /* 기본값 */ }
        t.remove(); return { text, w };
      });
      let pick = null, bare = null;
      const ring = r + Math.min(7, r * .6);                                    // 누르는 자리 고리(작은 공은 작게)
      for (let h = .16; h <= .72 && !pick; h += .02) {
        const by = yOf(h), gx = col(bx, h);
        if (Math.abs(gx - bx) > r) continue;                                   // 엔진이 이 높이의 열을 옮기면 공 위가 아니다 → 더 낮은 높이
        if (floor - 2 * r - (by + r) < 18) break;                              // 진짜 공과 붙으면 유령이 아니다
        const ghost = { left: gx - ring, right: gx + ring, top: by - ring, bottom: by + ring };
        if (avoid.some(a => meets(ghost, a, 3))) continue;
        bare ||= { by, side: 1, text: null, h, gx };                            // v0.4.1: 이름표 자리가 끝내 없으면 유령·고리만이라도(320 호스트 검수)
        for (const wd of words) {
          const side = [1, -1].find(sd => {
            const lb = sd > 0 ? { left: gx + r + 14, right: gx + r + 14 + wd.w } : { left: gx - r - 14 - wd.w, right: gx - r - 14 };
            Object.assign(lb, { top: by - 10, bottom: by + 8 });
            return lb.left > 6 && lb.right < W - 6 && !avoid.some(a => meets(lb, a, 4));
          });
          if (side) { pick = { by, side, text: wd.text, h, gx }; break; }
        }
      }
      pick ||= bare;
      if (pick) {
        const { by, side, text, h, gx: bx } = pick;
        const g = D.g(svg, { class: 'inv-drop', 'data-drop-height': h.toFixed(2) });   // 점검용: 이 자리를 누르면 엔진이 받는 height
        // 같은 열 일점쇄선: 진짜 공이 닿는 바닥에서 슬래브를 지나 6층 천장까지(S2 출처 중심선과 같은 문법 — 내 바닥 = 누군가의 천장)
        const c6 = geo.lines?.ceilings?.[6];
        if (c6 > floor) D.el('line', { x1: bx, y1: floor, x2: bx, y2: c6 + 4, class: 'ln-axis' }, g);
        dropGhost(g, bx, by, r, floor, floor - 2 * r);   // 치수선은 진짜 공 윗면까지(이 공이 이만큼 떨어진다)
        D.el('circle', { cx: bx, cy: by, r: ring, class: 'inv-ring' }, g);
        const pd = pingDelay(1);
        if (pd) D.el('circle', { cx: bx, cy: by, r: ring, class: 'inv-ping', style: pd }, g);
        if (text) {
          const t = D.el('text', { x: side > 0 ? bx + r + 14 : bx - r - 14, y: by + 4, class: 'svg-annot inv-label', 'text-anchor': side > 0 ? 'start' : 'end' }, g);
          t.textContent = text;
          chip(g, t);
        }
      }
      // 바닥 '톡' 자리: 공에서 떨어진 빈 바닥 중 공에 가장 가까운 곳(제목 1행·가구·벽 피함)
      const r1 = rectOf(q(section, '[data-place="s0-line1"]'), stage), pad = Math.max(8, Math.min(22, r));
      const blocks = [[0, W * .06], [W * .93, W], [bx - 2.6 * r - 12, bx + 2.6 * r + 12]];
      ['7:chair', '7:cup'].map(bodyBox).filter(Boolean).forEach(b => blocks.push([b.left - pad, b.right + pad]));
      if (r1 && r1.bottom > floor - 90) blocks.push([r1.left - pad, r1.right + pad]);
      let tx = null;
      for (let d = 2.6 * r + 14; d < W; d += 4) {
        tx = [bx - d, bx + d].find(x => x > 0 && x < W && !blocks.some(([a, b]) => x > a && x < b));
        if (tx != null) break;
      }
      if (tx != null) tapMark(tx, floor, r, pingDelay(1.7));
    }
    // 첫 충격 = 엔진이 S0-after를 연다(HOOKS 10). 처음부터 다시 하면 다시 닫히고 초대가 돌아온다.
    // 아무 데나 누른 것(빈 벽·입력 차단 중)이나 S1 기록만으로는 걷지 않는다(arch v0.4 연결)
    const after = q(section, '[data-cue="s0-after"]');
    const sync = () => { const now = !!after && !after.hidden; if (now !== done) { done = now; if (!done) { pinged = false; pingAt = null; } } render(); };
    controls.forEach(b => {
      const act = b.dataset.action;
      b.addEventListener('focus', () => { if (b.matches(':focus-visible')) { mode = act; render(); } });
      b.addEventListener('blur', () => { if (mode === act) { mode = null; render(); } });
      b.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { mode = act; render(); } });
      b.addEventListener('pointerleave', () => { if (mode === act && !b.matches(':focus-visible')) { mode = null; render(); } });
    });
    // 고리 맥박은 처음 그린 한 번만(다시 그려도 다시 뛰지 않는다)
    stage.addEventListener('animationend', e => { if (e.target.classList?.contains('inv-ping')) pinged = true; });
    inviteHover = on => { if (hover !== on) { hover = on; render(); } };
    inviteRender = render;
    const mo = new MutationObserver(sync);
    mo.observe(stage, { attributes: true, attributeFilter: ['data-drop-preview'] });
    controls.forEach(b => mo.observe(b, { attributes: true, attributeFilter: ['hidden'] }));
    if (after) mo.observe(after, { attributes: true, attributeFilter: ['hidden'] });
    // 초대가 보이는 동안만: 공이 3px 넘게 굴러가면 따라 그린다(0.4초마다 위치만 읽는다)
    setInterval(() => {
      if (done || mode || hover || !svg || svg.style.display === 'none' || document.hidden) return;
      const x = liveX(qa(stage, '[data-physics-body="7:ball"]')[0]);
      if (Number.isFinite(x) && (lastX == null || Math.abs(x - lastX) > 3)) render();
    }, 400);
    sync();
  }

  /* ───────────── v0.6 F2 아이디어 ① '같은 선이 내 천장이 된다'(S4-21·S4-21b, story F2 3.2) ─────────────
     S4 6/7 슬래브 한 판에 이름표 두 개: 바로 선 건물 '7층 바닥'(위) · '6층 천장'(아래) → 뒤집힌 뒤 같은 판이 '6층 바닥'(위) · '7층 천장'(아래).
     - 자리: 회전층 밖 겹층(.slab-labels). arch가 회전층([data-flip-layer])에 쓰는 rotate·scale·translate를 그 프레임에 읽어
       motion의 LandingBuilding.climaxSlabLabels(판의 한 점 → 화면 좌표, 글자는 늘 바로 섬)로 놓는다. 이동은 transform(레이아웃 흔들림 없음).
     - 이름 교체: arch의 inverted(S4-05 "이제 당신이 아래층입니다."와 같은 프레임에 참) → 뒤집힌 이름. 단계 'return'·'settle'(S4-07과 같은 프레임)은 원래 이름.
       센서는 arch가 넘긴 sensor·inverted 그대로(글자 각도는 motion textAngle — 기기를 든 사람에게 바로).
     - 줄이기: motion climaxSlabLabelFrames의 전후 두 컷. 교차 페이드 절반에서 컷과 이름이 바뀌고, 겹층 투명도는 |1−2p|.
     - 지시선: 두 이름표에서 판의 같은 점까지 가는 선 — '한 선에 이름 둘'. 낭독은 U-03c(arch)가 맡고 여기는 aria-hidden */
  function setupSlabLabels() {
    const sec = q(document, 'section[data-scene="s4"]'), stage = sec && q(sec, '[data-stage]'), layer = stage && q(stage, '[data-flip-layer]');
    if (!layer) return;
    const NAMES = { up: { floor: '7층 바닥', ceiling: '6층 천장' }, inv: { floor: '6층 바닥', ceiling: '7층 천장' } };
    const box = document.createElement('div'); box.className = 'slab-labels'; box.setAttribute('aria-hidden', 'true');
    const svg = D.el('svg', { class: 'slab-leaders', focusable: 'false' }); box.appendChild(svg);
    const mk = role => { const s = document.createElement('span'); s.className = 'slab-label'; s.dataset.s4SlabLabel = role; box.appendChild(s); return s; };
    const fl = mk('floor'), cl = mk('ceiling');
    stage.appendChild(box);
    let inverted = false, size = null, raf = 0, ext = null;   // ext = arch가 그리는 시점에 넘긴 마지막 상태(LandingArt.climaxFrame)
    const ANCHORS = [.16, .84]; let anchorK = 0;
    const measureSize = () => {   // 두 문구 중 큰 상자(motion: labelWidth·labelHeight). 겹층이 숨어 있으면 잴 때만 보이지 않게 켠다
      const was = box.hidden; box.hidden = false; box.style.visibility = 'hidden';
      let w = 0, h = 0;
      for (const t of [NAMES.up.floor, NAMES.up.ceiling, NAMES.inv.floor, NAMES.inv.ceiling]) { fl.textContent = t; w = Math.max(w, fl.offsetWidth); h = Math.max(h, fl.offsetHeight); }
      box.hidden = was; box.style.visibility = '';
      size = w && h ? { w: Math.ceil(w), h: Math.ceil(h) } : null;
    };
    const frameOf = () => {
      if (PREVIEW === 'flipped') return { angle: Math.PI, scale: 1, offsetY: 0 };   // 미리보기는 CSS로 180° 돌린다
      const m1 = /rotate\(\s*([-\d.e]+)deg\)/.exec(layer.style.transform || '');
      const tr = (layer.style.translate || '').trim().split(/\s+/);
      let offsetY = 0;
      if (tr[1]) offsetY = tr[1].endsWith('%') ? parseFloat(tr[1]) / 100 * layer.offsetHeight : parseFloat(tr[1]) || 0;
      return { angle: m1 ? +m1[1] * Math.PI / 180 : 0, scale: parseFloat(layer.style.scale) || 1, offsetY };
    };
    const update = () => {
      raf = 0;
      const LB = window.LandingBuilding, geo = stage._geo;
      if (!LB?.climaxSlabLabels || !geo?.floors?.[7]) { box.hidden = true; return; }
      if (!size) measureSize();
      const sensor = ext && typeof ext.sensor === 'boolean' ? ext.sensor : sec.dataset.sensorState === 'inverted';
      const phase = ext?.phase || layer.dataset.climaxPhase;
      const reduced = !!ext?.reduced && !sensor && !!LB.climaxSlabLabelFrames;
      const p = Math.max(0, Math.min(1, +ext?.progress || 0));
      let inv = ext && typeof ext.inverted === 'boolean' ? ext.inverted : (sensor || inverted || PREVIEW === 'flipped');
      // story F2 3.2: 360° 복귀는 S4-07 "중력이 돌아오면 —"과 같은 프레임(단계 return)에 원래 이름. arch의 inverted는 360° 도달까지 참이라 여기서 맞춘다
      if (!sensor && (phase === 'return' || phase === 'settle')) inv = false;
      if (reduced) inv = p >= .5;   // 줄이기: 교차 페이드 절반에서 컷이 바뀐다 → 컷마다 그 이름
      const names = inv ? NAMES.inv : NAMES.up;
      fl.textContent = names.floor; cl.textContent = names.ceiling;
      const hud = hudH(geo.w, geo.h);
      const opts = { width: geo.w, height: geo.h, slabY: (geo.floors[7] + geo.ceilings[6]) / 2,
        labelWidth: size?.w, labelHeight: size?.h, insets: { top: hud + 8, right: 8, bottom: 8, left: 8 } };
      const frame = sensor ? { angle: 0 } : (ext?.frame || frameOf());
      const solve = k => {   // 판 끝 쪽(story 3.2 '선 이름표는 선 끝 쪽') 두 후보 중 하나: 0.16W 또는 0.84W(회전층 좌표)
        if (!size) return null;
        const o2 = { ...opts, anchorX: geo.w * ANCHORS[k] };
        if (reduced) { const cuts = LB.climaxSlabLabelFrames(o2); return inv ? cuts.inverted : cuts.upright; }   // 줄이기: 전후 두 컷(컷 안에서 고정)
        return LB.climaxSlabLabels({ ...o2, frame, inverted: inv, sensor });
      };
      // 설명 상자(듣기·복귀)·센서 제안 카드가 이름표를 덮으면 판의 다른 끝으로 옮기고, 거기도 덮이면 둘 다 숨긴다
      // (반쪽만 보이는 이름 한 쌍은 읽히지 않는다). 안 덮이는 동안은 자리를 바꾸지 않는다 — 회전 중 튀지 않게
      const o = stage.getBoundingClientRect();
      // v0.9b: 바로 선 자세에서는 버튼 줄도 피한다(740: 6층 천장 × 버튼). 도는 동안은 빼서 건너뛰지 않게
      const upright = phase === 'ready' || phase === 'settle';
      const obs = ['[data-flip-cue="listen"]', '[data-flip-cue="return"]', '[data-place="s4-sensor"]', upright && '[data-place="s4-controls"]'].filter(Boolean).map(s => q(sec, s))
        .filter(e => e && !e.hidden && e.checkVisibility?.({ checkVisibilityCSS: true }) !== false)
        .map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
      const hits = r => r && obs.some(b => [r.floor, r.ceiling].some(c => c.x + size.w / 2 > b.left - o.left - 4 && c.x - size.w / 2 < b.right - o.left + 4
        && c.y + size.h / 2 > b.top - o.top - 4 && c.y - size.h / 2 < b.bottom - o.top + 4));
      let res = solve(anchorK);
      if (hits(res)) { const alt = solve(1 - anchorK); if (alt && !hits(alt)) { anchorK = 1 - anchorK; res = alt; } else res = null; }
      box.style.opacity = reduced && p > 0 && p < 1 ? Math.abs(1 - 2 * p).toFixed(3) : '';   // 줄이기: 건물처럼 사라졌다 나타난다
      box.hidden = !res;
      if (!res) return;
      const rot = res.textAngle ? ` rotate(${res.textAngle}rad)` : '';
      for (const [el, p] of [[fl, res.floor], [cl, res.ceiling]]) el.style.transform = `translate(${(p.x - size.w / 2).toFixed(1)}px, ${(p.y - size.h / 2).toFixed(1)}px)${rot}`;
      // 지시선: 이름표 가운데 → 판의 같은 점(이름표 상자가 선 위를 덮어 상자 밖 구간만 보인다) + 점
      svg.setAttribute('viewBox', `0 0 ${geo.w} ${geo.h}`);
      svg.replaceChildren();
      for (const p of [res.floor, res.ceiling]) D.el('line', { x1: p.x, y1: p.y, x2: res.anchor.x, y2: res.anchor.y, class: 'ln-leader' }, svg);
      D.el('circle', { cx: res.anchor.x, cy: res.anchor.y, r: 3.2, class: 'f-kung' }, svg);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    // arch 계약(lt-sol-arch-v06F2-연결): 동작층이 그리는 시점에 LandingArt.climaxFrame({ frame, phase, inverted, sensor, reduced, progress })를 부른다.
    // 받은 값이 1순위. 아직 안 불렸으면(이전 빌드·미리보기) 회전층 스타일과 단계 속성을 그 프레임에 읽는 대비책으로 놓는다
    Art.climaxFrame = state => { ext = state || null; update(); };
    new MutationObserver(recs => {
      if (ext) return;
      for (const r of recs) if (r.attributeName === 'data-climax-phase') {
        const ph = layer.dataset.climaxPhase;
        if (ph === 'listen') inverted = true;
        else if (ph === 'return' || ph === 'settle' || ph === 'ready') inverted = false;
      }
      update();
    }).observe(layer, { attributes: true, attributeFilter: ['style', 'data-climax-phase'] });
    new MutationObserver(schedule).observe(sec, { attributes: true, attributeFilter: ['data-sensor-state'] });
    // 센서 카드·설명 상자가 열리고 닫힐 때(위 겹침 규칙)
    ['[data-place="s4-sensor"]', '[data-flip-cue="listen"]', '[data-flip-cue="return"]'].map(s => q(sec, s)).filter(Boolean)
      .forEach(el => new MutationObserver(schedule).observe(el, { attributes: true, subtree: true, attributeFilter: ['hidden', 'class'] }));
    new MutationObserver(schedule).observe(document.getElementById('main') || document.body, { attributes: true, attributeFilter: ['data-perspective', 'data-flip-returned'] });
    if (document.fonts) document.fonts.ready.then(() => { size = null; schedule(); });
    slabLabels.update = () => { size = null; update(); };
    slabLabels.rects = () => box.hidden ? [] : [fl, cl].map(e => e.getBoundingClientRect()).filter(r => r.width);
  }

  function start() {
    setupPreview();
    setupSlabLabels();
    layoutAll();
    watch();
    setupDropPreview();
    setupInvite();
    watchControls();
    addEventListener('resize', relayout);
    if (document.fonts) document.fonts.ready.then(layoutAll);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
