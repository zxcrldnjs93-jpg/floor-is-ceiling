/* 「중력을 뒤집으면」 시각 층 — 머리띠 (lt-opus-design, 고전 스크립트, defer)
   - v0.8 U-02b: 엘리베이터 옆 보이는 글 "지금 7층 · 위층"([data-lift-now])과 엘리베이터 이름(U-02)을 같은 상태로 쓴다.
     상태는 엔진 #main[data-current-floor][data-current-view]가 있으면 그것, 없으면 아래 관찰자와 관점으로 고른다.
   - 엘리베이터 미니맵(U-02): 화면 가운데에 걸린 장면의 data-floor("7" | "6" | "5" | "7 6 5")를 켠다.
     #main[data-perspective="downstairs"]이면 순서를 5F 6F 7F로 뒤집는다.
     v0.3 S5 진입(세 층 → 7층): 5F → 6F → 7F를 0.2초씩 켠다(엘리베이터가 올라가는 박자, 움직임 줄이기·일시정지에서는 바로 7F).
   - 층 도착 알림(U-03): [data-floor-live]에 한 번씩 쓴다.
   - #motion-pause(U-04)·#sound-toggle(U-05, v0.3): data-pressed("true"|"false")에 맞춰 보이는 라벨을 바꾼다
     ("움직임 일시정지" ↔ "움직임 다시 켜기", "소리 켜기" ↔ "소리 끄기"). 누르는 동작은 엔진 담당.
     v0.3.5: 라벨이 동작을 말하므로 aria-pressed는 쓰지 않는다(MDN 토글 버튼 권고 — 둘을 함께 쓰면 두 번 말한다).
     옮겨 가는 동안: 엔진이 아직 aria-pressed를 쓰면 그 값을 data-pressed로 옮겨 모양·라벨을 맞춘다(aria-pressed를 지우는 일은 엔진 쪽 변경과 함께). */
(function () {
  const LIVE = {
    '7': '7층, 당신의 집입니다.',
    '6': '6층에 도착했습니다.',
    '5': '5층에 도착했습니다.',
    down: '건물이 뒤집혔습니다. 이제 7층이 맨 아래이고, 7층 바닥이던 선이 7층 천장입니다.',   // v0.6 F2 U-03c(아이디어 ①의 낭독판)
    up: '건물이 원래대로 돌아왔습니다.'
  };
  const still = () => document.documentElement.hasAttribute('data-motion-paused') || matchMedia('(prefers-reduced-motion: reduce)').matches;

  function toggleLabel(btn, sel, off, on) {
    if (!btn) return;
    const label = btn.querySelector(sel);
    const sync = () => {
      const legacy = btn.getAttribute('aria-pressed');   // 엔진이 아직 aria-pressed를 쓰는 동안만
      if (legacy !== null && btn.dataset.pressed !== legacy) btn.dataset.pressed = legacy;
      const pressed = btn.dataset.pressed === 'true';
      if (label && label.textContent !== (pressed ? on : off)) label.textContent = pressed ? on : off;
      btn.classList.toggle('is-on', pressed);
    };
    new MutationObserver(sync).observe(btn, { attributes: true, attributeFilter: ['data-pressed', 'aria-pressed'] });
    sync();
  }

  function start() {
    const main = document.getElementById('main');
    const lift = document.querySelector('[data-lift]');
    const live = document.querySelector('[data-floor-live]');
    if (!main || !lift) return;
    const cells = [...lift.querySelectorAll('[data-lift-floor]')];
    const nowEl = document.querySelector('[data-lift-now]');
    let floor = '7', said = '', ride = [], lastView = null;

    // v0.6 F2(arch 연결): 엔진이 [data-floor-live-engine]을 붙이면 층 도착 문장은 엔진이 쓴다 → 여기는 쓰지 않는다(표시·토글은 그대로)
    function say(text) { if (live && text && text !== said && !live.hasAttribute('data-floor-live-engine')) { live.textContent = text; said = text; } }

    /* v0.8 U-02b·U-02: 지금 몇 층·위층/아래층. 엔진 상태(#main[data-current-floor][data-current-view], HOOKS)가 있으면 그것 하나만 쓴다 —
       LED 칸·보이는 글·엘리베이터 이름이 같은 상태라 중앙 교차 관찰자와 엇갈려 다른 층을 잠깐 켜지 않는다. 없으면(엔진 전·실패) 예전처럼
       화면 가운데 장면의 data-floor와 관점으로 고른다 */
    const engineFloor = () => main.dataset.currentFloor || null;
    function state() {
      const f = engineFloor() || floor, down = main.dataset.perspective === 'downstairs';
      const view = main.dataset.currentView || (f.includes(' ') ? 'all' : (f !== '7' || down) ? 'lower' : 'upper');
      return { floor: f, view };
    }
    function words({ floor: f, view }) {
      if (view === 'all' || f.includes(' ')) return { floor: '세 층', sep: ' ', view: '모두', label: '지금 세 층 모두' };
      const v = view === 'lower' ? '아래층' : '위층';
      return { floor: `${f}층`, sep: ' · ', view: v, label: `지금 ${f}층, ${v}` };
    }

    function paint(shown) {
      const down = main.dataset.perspective === 'downstairs';
      lift.toggleAttribute('data-flipped', down);
      const st = state(), w = words(st);
      const on = (shown || st.floor).split(' ');
      cells.forEach(c => c.classList.toggle('is-on', on.includes(c.dataset.liftFloor)));
      lift.setAttribute('aria-label', `엘리베이터 표시: ${w.label}`);
      if (nowEl) {
        const t = nowEl.querySelector('.ln-txt');
        const set = (sel, v) => { const e = t?.querySelector(sel); if (e && e.textContent !== v) e.textContent = v; };
        set('.ln-floor', w.floor); set('.ln-sep', w.sep); set('.ln-view', w.view);
        nowEl.dataset.view = st.view;
        // '아래층'이 되는 순간 한 번 비친다(줄이기·일시정지에서는 글만)
        if (st.view === 'lower' && lastView !== null && lastView !== 'lower' && !still()) {
          nowEl.classList.remove('is-flash'); void nowEl.offsetWidth; nowEl.classList.add('is-flash');
          clearTimeout(paint.t); paint.t = setTimeout(() => nowEl.classList.remove('is-flash'), 950);
        }
        lastView = st.view;
      }
    }

    const sections = [...document.querySelectorAll('section[data-scene][data-floor]')];
    const seen = new Map();
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => seen.set(e.target, e.isIntersecting));
      const active = sections.filter(s => seen.get(s)).pop();
      if (!active) return;
      const next = active.dataset.floor;
      if (next !== floor) {
        const up = +next.split(' ')[0] >= +floor.split(' ')[0];
        const climb = active.dataset.scene === 's5' && floor.includes(' ') && !still();   // 세 층 → 다시 7층
        lift.dataset.moving = (+next.split(' ')[0] < +floor.split(' ')[0]) ? 'down' : 'up';
        floor = next;
        ride.forEach(clearTimeout); ride = [];
        if (climb && up) { paint('5'); ride = [setTimeout(() => paint('6'), 200), setTimeout(() => paint(), 400)]; }
        else paint();
        if (LIVE[next]) say(LIVE[next]);
        clearTimeout(start.t); start.t = setTimeout(() => delete lift.dataset.moving, climb ? 1000 : 900);
      }
    }, { rootMargin: '-45% 0px -45% 0px' });
    sections.forEach(s => io.observe(s));

    let last = main.dataset.perspective;
    new MutationObserver(() => {
      const now = main.dataset.perspective;
      if (now !== last) { say(now === 'downstairs' ? LIVE.down : LIVE.up); last = now; }
      paint();
    }).observe(main, { attributes: true, attributeFilter: ['data-perspective', 'data-current-floor', 'data-current-view'] });   // v0.8: 엔진 층·관점 상태

    toggleLabel(document.getElementById('motion-pause'), '[data-pause-label]', '움직임 일시정지', '움직임 다시 켜기');
    toggleLabel(document.querySelector('#sound-toggle, [data-action="sound"]'), '[data-sound-label]', '소리 켜기', '소리 끄기');
    paint();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
