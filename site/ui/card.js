/* 「중력을 뒤집으면」 시각 층 — 위층 유형 카드 (lt-opus-design, 고전 스크립트, defer)
   1) 화면 카드: S6의 [data-result-canvas] 안 HTML 카드(1080×1350)를 보드 폭에 맞춰 줄이고, 미니 단면을 그린다.
      엔진이 [data-result-title|copy|detail|peak|label]을 바꾸면 다시 그린다.
   2) 공유 PNG: LandingArt.drawCard(canvas, data) → Promise<canvas>. 같은 배치를 canvas 2D로 그린다.
      data = { title, copy, detail, peak, label, events:[[x0~1, 쿵]], url } (빠진 값은 화면 카드에서 읽는다)
   판정 면책(S6-03)은 이미지에 넣지 않는다(FINAL-STORY 6.4). 이름·동호수 없음. */
(function () {
  const Art = (window.LandingArt = window.LandingArt || {});
  const CW = 1080, CH = 1350;

  /* ── 화면 카드 ── */
  function fitBoard() {
    const board = document.querySelector('[data-place="s6-board"]');
    if (!board) return;
    const W = document.documentElement.clientWidth, H = innerHeight, m = W <= 720;
    const M = Math.min(80, Math.max(20, W * 0.055));
    const cw = m ? W - 2 * (M + 4) - 24 : Math.min(500, Math.max(240, (H - 64 - 150) / 1.25));   // 낮은 창에서도 240px 아래로 줄지 않음
    board.style.setProperty('--cw', Math.round(cw) + 'px');
  }

  function cardData(root) {
    const t = sel => (root.querySelector(sel)?.textContent || '').trim();
    const records = (Art.records ? Art.records() : []).filter(r => (r.slab || '7-6') === '7-6');
    // v0.3 카드 v2: 매트 줄(S6-10)과 센서 배지(S6-09)는 엔진이 hidden을 풀었을 때만
    const matEl = root.querySelector('[data-result-mat]'), badgeEl = root.querySelector('[data-result-sensor]');
    const mm = matEl && !matEl.hidden ? /(\d+)\D+?(\d+)\s*$/.exec(matEl.textContent.trim()) : null;
    // v0.6 F2b(story S6-10b): 기준 높이 시험이면 arch가 화면 줄 앞말을 '방 절반 높이 · 매트 위에선 쿵 '으로 바꾼다 → PNG도 같은 앞말
    const matLabel = matEl && (matEl.querySelector('[data-result-mat-label]') || (matEl.firstChild?.nodeType === 3 ? matEl.firstChild : null));
    if (mm) Object.assign(mm, { labelPrefix: matLabel?.textContent || '', heightSource: matEl.dataset.matHeightSource || '' });
    return {
      title: t('[data-result-title]'), copy: t('[data-result-copy]'), detail: t('[data-result-detail]'),
      peak: t('[data-result-peak]'), label: t('[data-result-label]'),
      events: records.length ? records.map(r => [r.x, r.value]) : null,
      url: t('[data-result-url]'),
      peakX: parseFloat(root.querySelector('[data-result-peak]')?.dataset.peakX),   // (선택) 세션 최대 사건의 열 0~1 — 엔진이 data-peak-x로 줄 수 있다
      mat: mm ? { before: +mm[1], after: +mm[2], labelPrefix: mm.labelPrefix, heightSource: mm.heightSource } : null,
      badge: badgeEl && !badgeEl.hidden ? badgeEl.textContent.trim() : null
    };
  }

  function drawMini(root) {
    const svg = root.querySelector('svg[data-card-mini]');
    const D = Art.draw;
    if (!svg || !D) return;
    const d = cardData(root);
    svg.replaceChildren();
    svg.setAttribute('viewBox', '0 0 880 500');
    const G = D.g(svg);
    D.el('rect', { x: 0, y: 0, width: 880, height: 500, class: 'f-paper' }, G);
    const s = 1.2, roof = D.floorStack(G, 0, 880, 10, { scale: s });
    D.parapet(G, 10, 870, 10, s);
    const floor = 390, fs = D.floorStack(G, 0, 880, floor, { scale: s });
    D.el('rect', { x: 0, y: fs.ceiling, width: 880, height: 500 - fs.ceiling, class: 'f-paper-2' }, G);
    D.el('line', { x1: 0, y1: fs.ceiling, x2: 880, y2: fs.ceiling, class: 'ln-cut' }, G);
    D.windowEl(G, 330, roof.ceiling + 46, 220, 150, .9);
    const P = poses(floor, d.mat);
    const bandY = (fs.soft + fs.slabBottom) / 2;
    D.band(G, 0, 880, bandY, 20);
    const events = d.events || [];
    const pk = peakMark(d, events);
    events.forEach(([x, v]) => D.burst(G, 30 + 820 * x, bandY, 20, Math.min(1, v / 190), !!pk && x === pk.x, 40));
    // '최대 N' 표지 = LED와 같은 세션 최대. 모든 물건 윗면보다 위, 지시선은 물건보다 먼저 그려 물건 뒤로 지나간다(v0.2 #4)
    if (pk) {
      const px = 30 + 820 * pk.x, t = peakTag(px, floor, P, 880, 22);
      D.el('line', { x1: px, y1: bandY - 14, x2: px, y2: t.y - 10, class: 'ln-thin ln-leader' }, G);
      const tx = D.el('text', { x: t.x, y: t.y, class: 'svg-annot card-peak', 'text-anchor': t.anchor }, G);
      tx.textContent = `최대 ${pk.value}`;
      try { const bb = tx.getBBox(); if (bb.width) G.insertBefore(D.el('rect', { x: bb.x - 5, y: bb.y - 2, width: bb.width + 10, height: bb.height + 4, class: 'tag-chip' }), tx); } catch (e) { /* 숨은 카드 */ }
    }
    // 매트(S5를 마쳤을 때): 바닥 위 완충재 한 장. 그 위 물건은 매트 두께만큼 올라가 있다
    if (P.mat) D.el('rect', { x: P.mat.x0, y: floor - P.mat.t, width: P.mat.x1 - P.mat.x0, height: P.mat.t, rx: 3, fill: 'url(#pat-soft)', class: 'ln-mat' }, G);
    // 절정 뒤 흐트러진 내 방(엔진 스냅숏의 x·회전, 세로는 바닥에 닿게)
    const { ball, chair, cup } = P.items;
    D.ball(G, ball.x, ball.base - 28, 28, ball.rot);
    D.chair(D.g(G, { transform: `translate(${chair.x.toFixed(1)} ${chair.ty.toFixed(1)})` }), 0, 0, 1.25, chair.rot);
    D.cup(G, cup.x, cup.ty, 1.25, cup.rot);
  }

  /* 카드 미니 단면의 물건 배치(미니 좌표 0~880). 엔진이 Art.cardLayout({ball:[x, dy, 회전], chair:[x, 회전], cup:[x, 회전]})을
     넘기면 그것(최대 쿵 순간 스냅숏 권장), 없으면 기본 흐트러짐 */
  function layout() { return Art.cardLayout || { ball: [136, 0, 40], chair: [720, -78], cup: [500, 92] }; }

  /* 자세 정리(레드팀 v0.2.2 5절 2번): x·회전은 스냅숏 그대로, 세로는 회전한 외곽의 가장 낮은 점이 바닥(매트 위면 매트 윗면)에 닿게.
     물건끼리 겹치면 옆으로 비키고, 미니 단면 밖으로 나가지 않는다. 그림 원점 = 바닥에 닿는 점(아래 가운데) */
  const SHAPE = { chair: [-31, -118, 33, 0], cup: [-16, -31, 26, 0] };
  function rotBox([x0, y0, x1, y1], s, deg) {
    const a = deg * Math.PI / 180, c = Math.cos(a), n = Math.sin(a);
    const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => [x * s * c - y * s * n, x * s * n + y * s * c]);
    return { x0: Math.min(...pts.map(p => p[0])), x1: Math.max(...pts.map(p => p[0])), y0: Math.min(...pts.map(p => p[1])), y1: Math.max(...pts.map(p => p[1])) };
  }
  function poses(floor, mat) {
    const lay = layout(), L = 24, R = 856, gap = 12;
    const items = [
      { k: 'ball', x: lay.ball[0], rot: lay.ball[2] || 0, b: { x0: -28, x1: 28, y0: -56, y1: 0 } },
      { k: 'chair', x: lay.chair[0], rot: lay.chair[1] || 0 },
      { k: 'cup', x: lay.cup[0], rot: lay.cup[1] || 0 }
    ];
    items.forEach(o => { if (!o.b) o.b = rotBox(SHAPE[o.k], 1.25, o.rot); });
    items.sort((p, q) => p.x - q.x);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < items.length; i++) {   // 왼쪽 물건과 겹치면 오른쪽으로
        const p = items[i - 1], o = items[i], over = p.x + p.b.x1 + gap - (o.x + o.b.x0);
        if (over > 0) o.x += over;
      }
      const last = items[items.length - 1], out = last.x + last.b.x1 - R;   // 오른쪽 끝을 넘으면 모두 왼쪽으로
      if (out > 0) items.forEach(o => { o.x -= out; });
      const first = items[0], under = L - (first.x + first.b.x0);
      if (under > 0) items.forEach(o => { o.x += under; });
    }
    let m = null;
    if (mat) {   // 매트는 공 밑에(공이 매트 위에서 쉰다)
      const ball = items.find(o => o.k === 'ball'), w = 232, cx = Math.max(L + w / 2, Math.min(R - w / 2, ball.x));
      m = { x0: cx - w / 2, x1: cx + w / 2, t: 12 };
    }
    items.forEach(o => {
      const on = m && o.x + o.b.x1 > m.x0 && o.x + o.b.x0 < m.x1;
      o.base = floor - (on ? m.t : 0);
      o.ty = o.base - o.b.y1;
      o.box = { x0: o.x + o.b.x0, x1: o.x + o.b.x1, y0: o.ty + o.b.y0, y1: o.base };
    });
    return { items: Object.fromEntries(items.map(o => [o.k, o])), mat: m };
  }

  /* '최대 N'의 값과 열(레드팀 v0.3 6절 1번): 값은 LED와 같은 세션 최대(d.peak), 미니 띠의 최근 기록 최대가 아니다.
     열 = 엔진이 주는 d.peakX(0~1) → 그 값과 같은 기록 → 띠에서 가장 큰 기록(대표 열). 최대가 없으면(0·'—') 표지 없음 */
  function peakMark(d, events) {
    const value = parseInt(String(d.peak ?? '').replace(/[^\d]/g, ''), 10);
    if (!(value > 0)) return null;
    const same = events.find(e => Math.round(e[1]) === value);
    const top = events.length ? events.reduce((a, e) => (e[1] > a[1] ? e : a)) : null;
    const x = Number.isFinite(d.peakX) ? d.peakX : (same || top || [])[0];
    return Number.isFinite(x) ? { value, x } : null;
  }

  /* 기록 칸 후보(말줄임 없음): 전체 → 뒤 항목의 '의자 ' 뺀 것 → 첫 항목("쿵 13번")만 */
  function detailOptions(text) {
    const parts = String(text || '').split(/\s*·\s*/).filter(Boolean);
    return [...new Set([parts.join(' · '), parts.map((p, i) => (i ? p.replace(/^의자\s*/, '') : p)).join(' · '), parts[0] || ''])];
  }
  function fitDetail(ctx, text, maxW, family) {
    const opts = detailOptions(text);
    for (const t of opts) for (let s = 30; s >= 22; s--) { ctx.font = `720 ${s}px ${family}`; if (ctx.measureText(t).width <= maxW) return { text: t, size: s }; }
    const t = opts[opts.length - 1]; let s = 22;
    for (; s > 14; s--) { ctx.font = `720 ${s}px ${family}`; if (ctx.measureText(t).width <= maxW) break; }
    return { text: t, size: s };
  }
  /* 화면 카드의 기록 칸: 엔진 글(읽기용)은 그대로 두고, 옆에 보이는 글을 같은 규칙으로 맞춘다 */
  function fitDetailCell(src) {
    const cell = src && src.parentElement;
    if (!cell || !cell.clientWidth) return;
    let fit = cell.querySelector('b.fit');
    if (!fit) { fit = document.createElement('b'); fit.className = 'fit'; fit.setAttribute('aria-hidden', 'true'); src.after(fit); }
    src.classList.add('is-fitted');
    const opts = detailOptions(src.textContent.trim());
    const tryFit = (t, s) => { fit.textContent = t; fit.style.fontSize = s + 'px'; return fit.scrollWidth <= fit.clientWidth; };
    for (const t of opts) for (let s = 30; s >= 22; s--) if (tryFit(t, s)) return;
    for (let s = 22; s >= 14; s--) if (tryFit(opts[opts.length - 1], s)) return;
  }

  /* '최대 N' 글 자리: 모든 물건 윗면보다 위(겹치지 않음), 오른쪽 끝이면 왼쪽으로 */
  function peakTag(px, floor, P, width, size) {
    const top = Math.min(floor - 52, ...Object.values(P.items).map(o => o.box.y0)) - 14;
    const right = px + 8 + size * 4.2 > width - 12;
    return { x: right ? px - 8 : px + 8, y: top, anchor: right ? 'end' : 'start' };
  }

  /* 주소 표기(v0.2.2 #4): 프로토콜·질의·해시·index.html·끝의 /를 뗀다 */
  function shortUrl(u) {
    return String(u || '').trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[?#].*$/, '').replace(/\/index\.html?$/i, '').replace(/\/$/, '');
  }
  Art.shortUrl = shortUrl;

  /* 화면 카드 주소 칸: 칸 폭을 넘으면 글자를 줄이고(22→14px), 그래도 길면 말줄임(CSS) */
  function fitUrlCell(el) {
    if (!el || !el.clientWidth) return;
    el.style.fontSize = '';
    let size = parseFloat(getComputedStyle(el).fontSize) || 22;
    while (el.scrollWidth > el.clientWidth && size > 14) { size -= 1; el.style.fontSize = size + 'px'; }
  }

  /* PNG 칸 안에 들어가는 글자 크기: measureText로 max → min까지 줄이고, 그래도 넘치면 끝을 … 으로 */
  function fitText(ctx, text, maxW, weight, max, min, family) {
    let size = max;
    for (; size > min; size -= 1) { ctx.font = `${weight} ${size}px ${family}`; if (ctx.measureText(text).width <= maxW) return { text, size }; }
    ctx.font = `${weight} ${min}px ${family}`;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return { text: t === text ? t : t + '…', size: min };
  }

  function setupCard() {
    const root = document.querySelector('[data-result-canvas]');
    if (!root) return;
    const canonical = document.querySelector('link[rel="canonical"]')?.href;
    const url = root.querySelector('[data-result-url]');
    if (url) {
      const where = canonical || (/^https?:/.test(location.protocol) ? location.origin + location.pathname : '');
      url.textContent = shortUrl(where);
      url.closest('[data-cell]')?.toggleAttribute('hidden', !url.textContent);
      fitUrlCell(url);
    }
    const redraw = () => {
      const peak = root.querySelector('[data-result-peak]');
      if (peak) {
        const txt = peak.textContent.trim(), pct = /%/.test(txt);
        peak.classList.toggle('is-pct', pct);
        peak.classList.toggle('is-3', !pct && txt.replace(/\D/g, '').length >= 3);   // 세 자리는 150px(v0.2 #4)
      }
      fitDetailCell(root.querySelector('[data-result-detail]'));
      drawMini(root);
    };
    // 글자 칸만 감시한다(미니 단면 SVG를 다시 그리는 변화는 감시하지 않는다 → 되먹임 없음)
    const mo = new MutationObserver(redraw);
    root.querySelectorAll('[data-result-title], [data-result-copy], [data-result-detail], [data-result-peak], [data-result-label], [data-result-mat], [data-result-sensor]')
      .forEach(el => mo.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] }));
    Art.redrawCard = redraw;
    redraw();
  }

  /* ── 공유 PNG(canvas) ── */
  function tokens() {
    const cs = getComputedStyle(document.documentElement);
    const v = n => cs.getPropertyValue(n).trim();
    return { paper: v('--c-paper') || '#F5F6F3', paper2: v('--c-paper-2') || '#ECEEEB', ink: v('--c-ink') || '#1B2128', ink2: v('--c-ink-2') || '#59626A', ink3: v('--c-ink-3') || '#7E878D',
      concrete: v('--c-concrete') || '#DCDFDD', agg: v('--c-aggregate') || '#99A1A5', mortar: v('--c-mortar') || '#E7E8E4', wood: v('--c-wood') || '#D7B98E', woodInk: v('--c-wood-ink') || '#8B6A43',
      kung: v('--c-kung') || '#EC4A1F', kungInk: v('--c-kung-ink') || '#C23A12', soft: v('--c-soft') || '#2F9A8A', softInk: v('--c-soft-ink') || '#1F7366', softTint: v('--c-soft-tint') || '#D3EAE4',
      panel: v('--c-led-panel') || '#161A1E', led: v('--c-led') || '#FF5A2C', ledOff: v('--c-led-off') || '#3A221A', ceramic: v('--c-ceramic') || '#FFFFFF', font: 'Hahmlet' };
  }

  function wrap(ctx, text, width) {
    const words = (text || '').split(/\s+/).filter(Boolean), lines = [];
    let line = '';
    for (const w of words) {
      const cand = line ? line + ' ' + w : w;
      if (ctx.measureText(cand).width <= width) { line = cand; continue; }
      if (line) lines.push(line);
      if (ctx.measureText(w).width <= width) { line = w; continue; }
      line = '';
      for (const ch of w) { if (line && ctx.measureText(line + ch).width > width) { lines.push(line); line = ''; } line += ch; }
    }
    if (line) lines.push(line);
    return lines;
  }

  function seeded(n) { let a = n; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }

  function stack(ctx, T, x0, x1, y, s, seedN) {
    const rnd = seeded(seedN);
    const layer = (h, fill) => { ctx.fillStyle = fill; ctx.fillRect(x0, y, x1 - x0, h); const top = y; y += h; return top; };
    const wood = layer(6 * s, T.wood), mortar = layer(11 * s, T.mortar), soft = layer(8 * s, T.softTint), conc = layer(40 * s, T.concrete);
    // 완충재 물결
    ctx.strokeStyle = T.soft; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = x0; x <= x1; x += 2) { const yy = soft + 4 * s + Math.sin((x - x0) / 14 * Math.PI * 2) * 3 * s; x === x0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy); }
    ctx.stroke();
    // 골재
    ctx.fillStyle = T.agg;
    for (let i = 0; i < (x1 - x0) / 9; i++) {
      const ax = x0 + rnd() * (x1 - x0), ay = conc + 4 + rnd() * (40 * s - 8);
      if (rnd() < .5) { ctx.beginPath(); ctx.arc(ax, ay, .9, 0, 7); ctx.fill(); }
      else { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + 3, ay - 4.4); ctx.lineTo(ax + 6, ay); ctx.fill(); }
    }
    ctx.strokeStyle = T.ink3; ctx.lineWidth = .75;
    [mortar, soft, conc].forEach(yy => { ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke(); });
    ctx.strokeStyle = T.ink; ctx.lineWidth = 2.5;
    [wood, y].forEach(yy => { ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke(); });
    const board = y + 7 * s;
    ctx.fillStyle = T.paper; ctx.fillRect(x0, board, x1 - x0, 4 * s);
    ctx.beginPath(); ctx.moveTo(x0, board + 4 * s); ctx.lineTo(x1, board + 4 * s); ctx.stroke();
    return { soft, slabBottom: y, ceiling: board + 4 * s };
  }

  function ledNumber(ctx, T, text, x, y, w, h, size, pitch) {
    const off = document.createElement('canvas'); off.width = w; off.height = h;
    const o = off.getContext('2d');
    o.fillStyle = '#fff'; o.font = `800 ${size}px ${T.font}`; o.textBaseline = 'middle';
    o.fillText(text, 0, h / 2 + size * .04);
    const img = o.getImageData(0, 0, w, h).data;
    ctx.save();
    for (let yy = pitch / 2; yy < h; yy += pitch) for (let xx = pitch / 2; xx < w; xx += pitch) {
      const a = img[((yy | 0) * w + (xx | 0)) * 4 + 3];
      ctx.beginPath(); ctx.arc(x + xx, y + yy, a > 110 ? pitch * .36 : pitch * .28, 0, 7);
      if (a > 110) { ctx.fillStyle = T.led; ctx.shadowColor = 'rgba(255,90,44,.6)'; ctx.shadowBlur = 7; }
      else { ctx.fillStyle = T.ledOff; ctx.shadowBlur = 0; }
      ctx.fill();
    }
    ctx.restore();
  }

  function chairPath(ctx, s) {
    [[[-30, 0], [-23, 0], [-19, -56], [-23, -118], [-31, -118], [-27, -56]], [[-31, -61], [33, -61], [33, -52], [-31, -52]],
     [[24, -52], [31, -52], [30, 0], [24, 0]], [[-24, -21], [26, -21], [26, -17], [-24, -17]], [[-30, -108], [-20, -108], [-20, -84], [-29, -84]]]
      .forEach(poly => { ctx.beginPath(); poly.forEach(([px, py], i) => i ? ctx.lineTo(px * s, py * s) : ctx.moveTo(px * s, py * s)); ctx.closePath(); ctx.fill(); ctx.stroke(); });
  }

  Art.drawCard = async function (canvas, input) {
    const root = document.querySelector('[data-result-canvas]');
    const d = Object.assign({}, root ? cardData(root) : {}, input || {});
    const T = tokens();
    if (document.fonts) { try { await Promise.all(['800 74px', '720 44px', '420 31px', '620 30px', '700 22px', '520 28px', '520 24px', '800 24px'].map(f => document.fonts.load(`${f} ${T.font}`, d.title + d.copy + (d.badge || '') + '내 바닥은, 누군가의 천장.작품기록층주소최대쿵매트위에선방절반높이·0123456789%−→'))); } catch (e) { /* 시스템 글꼴로 그린다 */ } }
    canvas.width = CW; canvas.height = CH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = T.paper; ctx.fillRect(0, 0, CW, CH);
    ctx.strokeStyle = T.ink; ctx.lineWidth = 3; ctx.strokeRect(37.5, 37.5, CW - 75, CH - 75);
    ctx.lineWidth = 1; ctx.strokeRect(50.5, 50.5, CW - 101, CH - 101);

    // 주인공: LED 숫자
    ctx.fillStyle = T.panel; ctx.beginPath(); ctx.roundRect(100, 120, 440, 330, 14); ctx.fill();
    ctx.strokeStyle = '#2A3035'; ctx.lineWidth = 5; ctx.beginPath(); ctx.roundRect(102.5, 122.5, 435, 325, 12); ctx.stroke();
    ctx.fillStyle = '#C9B2A8'; ctx.font = `620 30px ${T.font}`; ctx.textBaseline = 'top';
    ctx.fillText(d.label || '최대 쿵', 134, 150);
    const num = String(d.peak || '0'), pct = /%/.test(num), three = !pct && num.replace(/\D/g, '').length >= 3;
    ledNumber(ctx, T, num, 134, 200, 380, 220, pct ? 124 : three ? 150 : 190, pct ? 7 : three ? 7.5 : 9);
    // v0.3 카드 v2 보조 줄 S6-10 "매트 위에선 쿵 {a} → {b}"(큰 숫자는 늘 최대 쿵). 숫자 색 = S5 막대 색
    // v0.6 F2b(story S6-10b): 기준 높이 시험이면 앞말 '방 절반 높이 · '. 줄은 LED 판 아래에서 오른쪽 유형 단(x 580) 앞 16px 안에 끝낸다 —
    // 화면 카드와 같은 글이 먼저다: 넘치면 24px, 그래도 넘칠 때만 story의 짧은 꼴 '절반 높이 · 매트 '
    if (d.mat && Number.isFinite(d.mat.before) && Number.isFinite(d.mat.after)) {
      ctx.textBaseline = 'top';
      const ref = d.mat.heightSource === 'reference' || /절반/.test(d.mat.labelPrefix || '');
      const full = d.mat.labelPrefix || (ref ? '방 절반 높이 · 매트 위에선 쿵 ' : '매트 위에선 쿵 ');
      const segs = pre => [[pre, T.ink, 520], [String(Math.round(d.mat.before)), T.kungInk, 800], [' → ', T.ink, 520], [String(Math.round(d.mat.after)), T.softInk, 800]];
      const width = (list, px) => list.reduce((sum, [s, , w]) => { ctx.font = `${w} ${px}px ${T.font}`; return sum + ctx.measureText(s).width; }, 0);
      const maxW = 580 - 16 - 100;
      let list = segs(full), px = 28;
      if (width(list, px) > maxW) px = 24;
      if (width(list, px) > maxW && ref) list = segs('절반 높이 · 매트 ');
      let x = 100;
      list.forEach(([s, c, w]) => { ctx.font = `${w} ${px}px ${T.font}`; ctx.fillStyle = c; ctx.fillText(s, x, 464 + (28 - px) / 2); x += ctx.measureText(s).width; });
    }

    // 유형과 한 줄
    ctx.fillStyle = T.ink; ctx.font = `820 74px ${T.font}`;
    let y = 132;
    wrap(ctx, d.title, 400).forEach(l => { ctx.fillText(l, 580, y); y += 80; });
    ctx.font = `420 31px ${T.font}`; y += 18;
    wrap(ctx, d.copy, 400).slice(0, 5).forEach(l => { ctx.fillText(l, 580, y); y += 46; });

    // 미니 단면: 내 방 + 띠에 새긴 쿵
    const X0 = 100, X1 = 980, Y0 = 500, Y1 = 1060;
    ctx.save(); ctx.beginPath(); ctx.rect(X0, Y0, X1 - X0, Y1 - Y0); ctx.clip();
    ctx.fillStyle = T.paper; ctx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
    const roof = stack(ctx, T, X0, X1, Y0 + 10, 1.2, 7);
    const floor = 950, fs = stack(ctx, T, X0, X1, floor, 1.2, 11);
    ctx.fillStyle = T.paper2; ctx.fillRect(X0, fs.ceiling, X1 - X0, Y1 - fs.ceiling);
    ctx.strokeStyle = T.ink3; ctx.lineWidth = 1.25; ctx.strokeRect(430, roof.ceiling + 60, 220, 160); ctx.strokeRect(436, roof.ceiling + 66, 208, 148);
    ctx.beginPath(); ctx.moveTo(540, roof.ceiling + 66); ctx.lineTo(540, roof.ceiling + 214); ctx.stroke();
    const bandY = (fs.soft + fs.slabBottom) / 2;
    ctx.fillStyle = 'rgba(245,246,243,.8)'; ctx.fillRect(X0, bandY - 10, X1 - X0, 20);
    ctx.strokeStyle = T.ink3; ctx.lineWidth = .75; ctx.strokeRect(X0, bandY - 10, X1 - X0, 20);
    const events = d.events || [];
    const pk = peakMark(d, events);   // LED와 같은 세션 최대(레드팀 v0.3 6절 1번)
    const P = poses(floor, d.mat);   // 화면 미니 단면과 같은 자세 정리(미니 x + X0, 세로는 이 바닥 기준)
    events.forEach(([ex, v]) => {
      const cx = X0 + 30 + (X1 - X0 - 60) * ex, k = Math.min(1, v / 190), A = 8.5 * Math.min(1, Math.log1p(k * 9) / Math.log(10)), on = !!pk && ex === pk.x;
      ctx.strokeStyle = T.kung; ctx.globalAlpha = on ? 1 : .55; ctx.lineWidth = on ? 2 : 1.3; ctx.beginPath();
      for (let i = 0; i <= 24; i++) { const t = i / 24, env = Math.exp(-3.2 * t) * Math.min(1, t * 8), px = cx - 20 + 40 * t, py = bandY - A * env * Math.sin(t * Math.PI * 7); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.stroke(); ctx.globalAlpha = 1;
    });
    // '최대 N': 물건 윗면보다 위에 글, 지시선은 물건보다 먼저 그려 물건 뒤로 지나간다(v0.2 #4)
    if (pk) {
      const mx = 30 + 820 * pk.x, t = peakTag(mx, floor, P, X1 - X0, 22), cx = X0 + mx;
      ctx.strokeStyle = T.ink2; ctx.lineWidth = .75; ctx.beginPath(); ctx.moveTo(cx, bandY - 14); ctx.lineTo(cx, t.y - 10); ctx.stroke();
      ctx.font = `700 22px ${T.font}`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = t.anchor === 'end' ? 'right' : 'left';
      const label = `최대 ${pk.value}`, lw = ctx.measureText(label).width, lx = t.anchor === 'end' ? X0 + t.x - lw : X0 + t.x;
      ctx.fillStyle = T.paper; ctx.fillRect(lx - 5, t.y - 21, lw + 10, 27);   // 종이 바탕: 창틀 선 위에서도 읽힘
      ctx.fillStyle = T.kungInk; ctx.fillText(label, X0 + t.x, t.y); ctx.textAlign = 'left';
    }
    // 매트(S5를 마쳤을 때): 완충재 무늬 한 장
    if (P.mat) {
      const mx0 = X0 + P.mat.x0, mw = P.mat.x1 - P.mat.x0, my = floor - P.mat.t;
      ctx.fillStyle = T.softTint; ctx.beginPath(); ctx.roundRect(mx0, my, mw, P.mat.t, 3); ctx.fill();
      ctx.save(); ctx.clip(); ctx.strokeStyle = T.soft; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = mx0; x <= mx0 + mw; x += 2) { const yy = my + P.mat.t / 2 + Math.sin((x - mx0) / 14 * Math.PI * 2) * 3; x === mx0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy); }
      ctx.stroke(); ctx.restore();
      ctx.strokeStyle = T.ink; ctx.lineWidth = 1.25; ctx.beginPath(); ctx.roundRect(mx0, my, mw, P.mat.t, 3); ctx.stroke();
    }
    // 흐트러진 물건(자세 정리 뒤)
    const { ball, chair, cup } = P.items;
    ctx.lineJoin = 'round'; ctx.lineWidth = 1.75;
    ctx.save(); ctx.translate(X0 + ball.x, ball.base - 28); ctx.rotate(ball.rot * Math.PI / 180); ctx.fillStyle = T.kung; ctx.strokeStyle = T.ink; ctx.beginPath(); ctx.arc(0, 0, 28, 0, 7); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-26.6, -5); ctx.bezierCurveTo(-9.8, 11.8, 9.8, 11.8, 26.6, -5); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.translate(X0 + chair.x, chair.ty); ctx.rotate(chair.rot * Math.PI / 180); ctx.fillStyle = T.wood; ctx.strokeStyle = T.woodInk; ctx.lineWidth = 1.75; chairPath(ctx, 1.25); ctx.restore();
    ctx.save(); ctx.translate(X0 + cup.x, cup.ty); ctx.rotate(cup.rot * Math.PI / 180); ctx.scale(1.25, 1.25); ctx.fillStyle = T.ceramic; ctx.strokeStyle = T.ink; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(11, 0); ctx.lineTo(15, -30); ctx.lineTo(-15, -30); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = T.soft; ctx.fillRect(-14.6, -22, 29.2, 4); ctx.restore();
    ctx.restore();
    ctx.strokeStyle = T.ink3; ctx.lineWidth = 1.5; ctx.strokeRect(X0, Y0, X1 - X0, Y1 - Y0);

    // 핵심 문장과 표제란
    ctx.fillStyle = T.ink; ctx.font = `720 44px ${T.font}`; ctx.textBaseline = 'top';
    ctx.fillText('내 바닥은, 누군가의 천장.', 100, 1094);
    if (d.badge) {   // v0.3 S6-09 배지: 오른쪽 끝, 완충 색 테두리 도장
      ctx.font = `700 22px ${T.font}`;
      const bw = ctx.measureText(d.badge).width + 66, bx = 980 - bw, by = 1096;
      ctx.strokeStyle = T.softInk; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.roundRect(bx, by, bw, 44, 22); ctx.stroke();
      ctx.lineWidth = 1.8; ctx.beginPath(); ctx.roundRect(bx + 18, by + 11, 13, 22, 2.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx + 22, by + 28.5); ctx.lineTo(bx + 27, by + 28.5); ctx.stroke();
      ctx.fillStyle = T.softInk; ctx.textBaseline = 'middle'; ctx.fillText(d.badge, bx + 44, by + 23); ctx.textBaseline = 'top';
    }
    ctx.strokeStyle = T.ink; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(50, 1182.5); ctx.lineTo(1030, 1182.5); ctx.stroke();
    const url = shortUrl(d.url);   // https://…/index.html → 호스트/경로(v0.2.2 #4)
    const cells = [['작품', '중력을 뒤집으면', 1.7], ['기록', d.detail || '', 1.3], ['층', '7F', .6], ['주소', url, 1.8]].filter(c => c[0] !== '주소' || c[1]);   // 화면 카드 .tb와 같은 비율
    const total = cells.reduce((a, c) => a + c[2], 0);
    let cx = 50;
    cells.forEach(([k, v, f], i) => {
      const w = 980 * f / total;
      if (i) { ctx.beginPath(); ctx.moveTo(cx + .5, 1182); ctx.lineTo(cx + .5, 1300); ctx.stroke(); }
      const px = cx + (i ? 22 : 50);
      ctx.fillStyle = T.ink2; ctx.font = `420 19px ${T.font}`; ctx.fillText(k, px, 1200);
      if (k === '주소') {   // 칸 폭(오른쪽 테두리 안 18px)에 맞춰 글자 크기를 줄인다
        const fit = fitText(ctx, v, cx + w - 18 - px, 500, 22, 13, T.font);
        ctx.fillStyle = T.ink2; ctx.font = `500 ${fit.size}px ${T.font}`;
        ctx.fillText(fit.text, px, 1240 + (22 - fit.size) * .5);
      } else {   // 기록 칸이 길어져도(예: "쿵 12번 · 의자 끌기 0.8칸") 칸 안에 들어가게
        const fit = k === '기록' ? fitDetail(ctx, v, cx + w - 18 - px, T.font) : fitText(ctx, v, cx + w - 18 - px, 720, 30, 20, T.font);   // 기록: "쿵 13번" 먼저, 말줄임 없음
        ctx.fillStyle = T.ink; ctx.font = `720 ${fit.size}px ${T.font}`;
        ctx.fillText(fit.text, px, 1232 + (30 - fit.size) * .5);
      }
      cx += w;
    });
    return canvas;
  };

  Art.records = Art.records || (() => []);
  function start() { fitBoard(); setupCard(); addEventListener('resize', () => { fitBoard(); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
