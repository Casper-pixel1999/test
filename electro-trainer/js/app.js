/* Интерфейс: экраны, монтажная плата, жесты, задания, теория, тест. */
'use strict';

(function (ET) {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = ET.esc;
  const def = ET.def;
  const { evaluate, key, volt } = ET.sim;

  /* ---------- Хранилище ---------- */
  const STORE_KEY = 'electro-trainer.v1';
  let DB = {};
  try { DB = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { DB = {}; }
  DB.progress = DB.progress || {};
  DB.boards = DB.boards || {};
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(DB)); } catch (e) { /* хранилище недоступно */ } };

  const WIRE_COLORS = [
    { id: 'brown', name: 'Коричневый — фаза' },
    { id: 'black', name: 'Чёрный — фаза' },
    { id: 'grey', name: 'Серый — фаза' },
    { id: 'blue', name: 'Синий — N' },
    { id: 'yg', name: 'Жёлто-зелёный — PE' },
  ];

  /* ---------- Состояние стенда ---------- */
  const B = {
    mode: null, lab: null, board: null,
    tool: 'wire', color: 'brown',
    sel: null, selWire: -1, probe: [],
    view: { x: 0, y: 0, k: 1 },
    sim: null, hist: [], live: 0, faults: new Set(),
    result: null,
  };

  const initState = (c) => { const d = def(c); return d.init ? d.init() : {}; };
  const comp = (id) => B.board.comps.find((c) => c.id === id);
  const termOf = (k) => {
    const i = k.lastIndexOf('.');
    const c = comp(k.slice(0, i));
    if (!c) return null;
    const t = def(c).terms.find((x) => x.id === k.slice(i + 1));
    return t ? { c, t, x: c.x + t.x, y: c.y + t.y, dir: t.dir } : null;
  };

  function boardFromLab(lab) {
    const saved = DB.boards['lab:' + lab.id];
    const comps = lab.comps.map((c) => ({ id: c.id, type: c.type, x: c.x, y: c.y, params: { ...(c.params || {}) } }));
    if (saved && saved.pos) for (const c of comps) if (saved.pos[c.id]) [c.x, c.y] = saved.pos[c.id];
    comps.forEach((c) => (c.state = initState(c)));
    const wires = (lab.wires || []).map((w) => ({ ...w }));
    if (saved && saved.wires) wires.push(...saved.wires.map((w) => ({ a: w.a, b: w.b, color: w.color })));
    return { comps, wires };
  }

  function boardFromSandbox() {
    const src = DB.boards.sandbox || ET.SANDBOX_DEFAULT;
    const comps = src.comps.filter((c) => ET.CATALOG[c.type]).map((c) => ({ id: c.id, type: c.type, x: c.x, y: c.y, params: { ...(c.params || {}) } }));
    comps.forEach((c) => (c.state = initState(c)));
    const ids = new Set(comps.map((c) => c.id));
    const wires = src.wires.filter((w) => ids.has(w.a.split('.')[0]) && ids.has(w.b.split('.')[0])).map((w) => ({ a: w.a, b: w.b, color: w.color }));
    return { comps, wires };
  }

  function persist() {
    if (!B.board) return;
    if (B.mode === 'lab') {
      const pos = {};
      B.board.comps.forEach((c) => (pos[c.id] = [c.x, c.y]));
      DB.boards['lab:' + B.lab.id] = { pos, wires: B.board.wires.filter((w) => !w.locked).map(({ a, b, color }) => ({ a, b, color })) };
    } else {
      DB.boards.sandbox = {
        comps: B.board.comps.map(({ id, type, x, y, params }) => ({ id, type, x, y, params })),
        wires: B.board.wires.map(({ a, b, color }) => ({ a, b, color })),
      };
    }
    save();
  }

  function snapshot() {
    return JSON.stringify({ comps: B.board.comps.map(({ id, type, x, y, params }) => ({ id, type, x, y, params })), wires: B.board.wires });
  }
  function pushHist() { B.hist.push(snapshot()); if (B.hist.length > 80) B.hist.shift(); }
  function undo() {
    const s = B.hist.pop();
    if (!s) { toast('Отменять нечего'); return; }
    const d = JSON.parse(s);
    const old = new Map(B.board.comps.map((c) => [c.id, c.state]));
    B.board.comps = d.comps.map((c) => ({ ...c, state: old.get(c.id) || initState(c) }));
    B.board.wires = d.wires;
    B.sel = null; B.selWire = -1;
    changed();
  }

  /* ---------- Симуляция и уведомления ---------- */
  function simulate() {
    B.sim = evaluate(B.board);
    const now = new Set();
    for (const f of B.sim.faults) {
      now.add(f.msg);
      if (!B.faults.has(f.msg)) toast(f.msg, f.type === 'hum' ? 'warn' : 'bad');
    }
    B.faults = now;
  }

  function changed(opts = {}) {
    simulate();
    render();
    if (!opts.noSave) persist();
    if (B.result && !opts.keepResult) { B.result = null; renderResults(); }
  }

  let toastSeq = 0;
  function toast(msg, kind = 'info') {
    const box = $('#toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast toast-' + kind;
    el.textContent = msg;
    el.dataset.n = ++toastSeq;
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => el.classList.add('out'), kind === 'bad' ? 5200 : 3200);
    setTimeout(() => el.remove(), kind === 'bad' ? 5600 : 3600);
  }

  /* ---------- Отрисовка платы ---------- */
  const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

  function wirePath(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (a.c === b.c) {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const n = dist || 1, bow = Math.min(10, dist * 0.18);
      return `M${a.x} ${a.y} Q${mx - (dy / n) * bow} ${my + (dx / n) * bow} ${b.x} ${b.y}`;
    }
    const d = Math.min(90, 18 + dist * 0.35);
    const va = DIRV[a.dir] || [0, 1], vb = DIRV[b.dir] || [0, 1];
    return `M${a.x} ${a.y} C${a.x + va[0] * d} ${a.y + va[1] * d} ${b.x + vb[0] * d} ${b.y + vb[1] * d} ${b.x} ${b.y}`;
  }

  function isLive(k) {
    if (!B.sim) return false;
    const p = B.sim.net.pot(k);
    return p && p !== '0';
  }

  function railsSvg() {
    const rows = new Map();
    for (const c of B.board.comps) {
      if (!def(c).modular) continue;
      const y = c.y + 60;
      const r = rows.get(y) || { x0: Infinity, x1: -Infinity };
      r.x0 = Math.min(r.x0, c.x); r.x1 = Math.max(r.x1, c.x + def(c).w);
      rows.set(y, r);
    }
    let s = '';
    for (const [y, r] of rows) s += `<rect class="rail" x="${r.x0 - 16}" y="${y - 13}" width="${r.x1 - r.x0 + 32}" height="26" rx="2"/><rect class="rail-lip" x="${r.x0 - 16}" y="${y - 4}" width="${r.x1 - r.x0 + 32}" height="8"/>`;
    return s;
  }

  function render() {
    const svg = $('#board');
    if (!svg || !B.board) return;
    const st = B.sim ? B.sim.status : {};
    let s = `<defs>
      <pattern id="perf" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="8" cy="8" r="1.6" class="perf-dot"/></pattern>
      <radialGradient id="glowg"><stop offset="0" stop-color="#ffe9a0" stop-opacity=".95"/><stop offset="1" stop-color="#ffd257" stop-opacity="0"/></radialGradient>
      <marker id="arrowhead" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="arrowhead"/></marker>
    </defs>`;
    s += `<g id="vp" transform="translate(${B.view.x} ${B.view.y}) scale(${B.view.k})">`;
    s += `<rect x="-4000" y="-4000" width="8000" height="8000" class="plate"/><rect x="-4000" y="-4000" width="8000" height="8000" fill="url(#perf)"/>`;
    s += railsSvg();
    for (const c of B.board.comps) {
      const d = def(c);
      s += `<g class="comp" data-comp="${esc(c.id)}" transform="translate(${c.x} ${c.y})">`;
      if (!d.sources) s += `<text x="0" y="-13" class="t-id">${esc(c.id)}</text>`;
      s += d.render(c, st[c.id]);
      s += `</g>`;
    }
    B.board.wires.forEach((w, i) => {
      const a = termOf(w.a), b = termOf(w.b);
      if (!a || !b) return;
      const p = wirePath(a, b);
      const live = isLive(w.a);
      s += `<g class="wire w-${w.color} ${i === B.selWire ? 'is-sel' : ''} ${live ? 'is-live' : ''}" data-wire="${i}">`;
      s += `<path d="${p}" class="w-hit"/>`;
      if (live) s += `<path d="${p}" class="w-glow"/>`;
      s += `<path d="${p}" class="w-sheath"/><path d="${p}" class="w-core"/>`;
      if (w.color === 'yg') s += `<path d="${p}" class="w-stripe"/>`;
      s += `</g>`;
    });
    for (const c of B.board.comps) {
      const d = def(c);
      for (const t of d.terms) {
        const k = key(c.id, t.id);
        const x = c.x + t.x, y = c.y + t.y;
        const cls = [k === B.sel ? 'is-sel' : '', B.probe.includes(k) ? 'is-probe' : '', isLive(k) ? 'is-live' : ''].join(' ');
        s += `<g class="term ${cls}" data-term="${esc(k)}"><circle cx="${x}" cy="${y}" r="13" class="term-hit"/><circle cx="${x}" cy="${y}" r="5" class="term-screw"/><path d="M${x - 3} ${y} h6" class="term-slot"/></g>`;
        if (!d.sources && t.label) {
          const ly = t.dir === 'up' ? y - 7 : y + 15;
          s += `<text x="${x + 7}" y="${ly}" class="t-term">${esc(t.label)}</text>`;
        }
        const pi = B.probe.indexOf(k);
        if (pi >= 0) s += `<text x="${x - 9}" y="${y - 9}" class="t-probe" text-anchor="middle">${pi ? 'B' : 'A'}</text>`;
      }
    }
    s += `<path id="rubber" class="rubber" d="" />`;
    s += `</g>`;
    svg.innerHTML = s;
    renderStatus();
    renderReadout();
  }

  function applyView() {
    const vp = $('#vp');
    if (vp) vp.setAttribute('transform', `translate(${B.view.x} ${B.view.y}) scale(${B.view.k})`);
  }

  function updateRubber(from, wx, wy) {
    const el = $('#rubber');
    if (!el) return;
    if (!from) { el.setAttribute('d', ''); return; }
    const a = termOf(from);
    if (!a) return;
    el.setAttribute('d', `M${a.x} ${a.y} L${wx} ${wy}`);
    el.setAttribute('class', 'rubber w-' + B.color);
  }

  function renderStatus() {
    const el = $('#statusline');
    if (!el) return;
    const sup = B.board.comps.filter((c) => def(c).sources);
    const on = sup.some((c) => c.state.on);
    const trips = B.board.comps.filter((c) => c.state.tripped && !c.state.on).map((c) => c.id);
    let h = on
      ? `<span class="pill pill-live">Питание подано</span>`
      : `<span class="pill">Питание отключено</span><span class="hint-inline">монтируйте спокойно, для проверки включите ввод</span>`;
    if (trips.length) h += `<span class="pill pill-bad">Сработал: ${esc(trips.join(', '))}</span>`;
    el.innerHTML = h;
  }

  function potText(k) {
    const p = B.sim.net.pot(k);
    if (!p) return 'нет напряжения';
    if (p === '0') return B.sim.net.labelsOf(k).has('N') ? 'ноль N' : 'земля PE';
    return B.sim.three ? `фаза ${p}` : 'фаза L';
  }

  function renderReadout() {
    const el = $('#readout');
    if (!el) return;
    let h = '';
    if (B.tool === 'probe') {
      if (!B.probe.length) h = '<b>Тестер.</b> Нажмите на клемму, чтобы узнать потенциал, затем на вторую — чтобы измерить напряжение между ними.';
      else {
        const [a, b] = B.probe;
        h = `<b>A</b> ${esc(a)}: ${potText(a)}`;
        if (b) {
          const v = volt(B.sim.net.pot(a), B.sim.net.pot(b));
          h += ` · <b>B</b> ${esc(b)}: ${potText(b)} · <span class="volt">U = ${v} В</span>`;
        }
      }
    } else if (B.selWire >= 0 && B.board.wires[B.selWire]) {
      const w = B.board.wires[B.selWire];
      h = `Провод ${esc(w.a)} – ${esc(w.b)} <button type="button" class="btn btn-small btn-bad" id="btn-del-wire">Удалить провод</button>`;
    } else if (B.sel) {
      h = `Выбрана клемма <b>${esc(B.sel)}</b>. Нажмите на вторую клемму, чтобы проложить провод.`;
    }
    el.innerHTML = h;
    el.hidden = !h;
    const del = $('#btn-del-wire');
    if (del) del.onclick = () => deleteWire(B.selWire);
  }

  /* ---------- Действия ---------- */
  function connect(a, b) {
    if (a === b) return;
    const ta = termOf(a), tb = termOf(b);
    if (!ta || !tb) return;
    if (B.board.wires.some((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a))) { toast('Эти клеммы уже соединены'); return; }
    const n = (k) => B.board.wires.filter((w) => w.a === k || w.b === k).length;
    if (n(a) >= 3 || n(b) >= 3) { toast('Под один винт — не больше трёх проводов. Используйте шину или клемму WAGO', 'warn'); return; }
    if (isLive(a) || isLive(b)) { B.live++; toast('Клемма под напряжением! В реальности так работать нельзя — сначала отключите ввод', 'warn'); }
    pushHist();
    B.board.wires.push({ a, b, color: B.color });
    changed();
  }

  function deleteWire(i) {
    const w = B.board.wires[i];
    if (!w) return;
    if (w.locked) { toast('Этот провод смонтирован заранее и входит в задание'); return; }
    if (isLive(w.a) || isLive(w.b)) { B.live++; toast('Провод под напряжением! Отключите ввод перед демонтажем', 'warn'); }
    pushHist();
    B.board.wires.splice(i, 1);
    B.selWire = -1;
    changed();
  }

  function removeComp(c) {
    if (B.mode !== 'sandbox') { toast('В задании аппараты удалять нельзя — удаляйте провода'); return; }
    pushHist();
    B.board.comps = B.board.comps.filter((x) => x !== c);
    const p = c.id + '.';
    B.board.wires = B.board.wires.filter((w) => !w.a.startsWith(p) && !w.b.startsWith(p));
    B.sel = null; B.selWire = -1;
    changed();
  }

  function termTap(k) {
    if (B.tool === 'probe') {
      B.probe = B.probe.length >= 2 ? [k] : [...B.probe, k];
      render();
      return;
    }
    if (B.tool === 'delete') {
      let i = -1;
      B.board.wires.forEach((w, j) => { if ((w.a === k || w.b === k) && !w.locked) i = j; });
      if (i >= 0) deleteWire(i); else toast('К этой клемме не подключено проводов, которые можно удалить');
      return;
    }
    B.selWire = -1;
    if (!B.sel) B.sel = k;
    else if (B.sel === k) B.sel = null;
    else { const a = B.sel; B.sel = null; connect(a, k); return; }
    render();
  }

  function wireTap(i) {
    if (B.tool === 'delete') { deleteWire(i); return; }
    B.sel = null;
    B.selWire = B.selWire === i ? -1 : i;
    render();
  }

  function zoneTap(c, zone) {
    const d = def(c);
    if (!d.tap) return;
    d.tap(c, zone);
    changed({ noSave: true });
  }

  function addComp(type) {
    const d = ET.CATALOG[type];
    let n = 1;
    const prefix = d.prefix;
    const used = new Set(B.board.comps.map((c) => c.id));
    let id = prefix === 'ВВОД' ? 'ВВОД' : prefix + n;
    while (used.has(id)) id = prefix + (prefix === 'ВВОД' ? ++n : ++n);
    const r = $('#board').getBoundingClientRect();
    const cx = (r.width / 2 - B.view.x) / B.view.k, cy = (r.height / 2 - B.view.y) / B.view.k;
    const c = { id, type, x: Math.round((cx - d.w / 2) / 10) * 10, y: Math.round((cy - d.h / 2) / 10) * 10, params: { ...(d.params || {}) } };
    c.state = initState(c);
    pushHist();
    B.board.comps.push(c);
    changed();
    toast(`Добавлен ${id}. Перетащите его на нужное место`);
    if (window.matchMedia('(max-width: 860px)').matches) setPanel(false);
  }

  /* ---------- Вид: вписать, масштаб ---------- */
  function fit() {
    const svg = $('#board');
    if (!svg || !B.board.comps.length) return;
    const r = svg.getBoundingClientRect();
    const tb = $('.toolbar');
    const bottom = tb ? tb.getBoundingClientRect().height + 16 : 70;
    const top = 56;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of B.board.comps) {
      const d = def(c);
      x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y - 16);
      x1 = Math.max(x1, c.x + d.w); y1 = Math.max(y1, c.y + d.h + 14);
    }
    const pad = 24;
    const aw = Math.max(100, r.width - pad * 2), ah = Math.max(100, r.height - top - bottom - pad);
    const k = Math.max(0.25, Math.min(2.2, Math.min(aw / (x1 - x0), ah / (y1 - y0))));
    B.view.k = k;
    B.view.x = (r.width - (x1 - x0) * k) / 2 - x0 * k;
    B.view.y = top + (ah - (y1 - y0) * k) / 2 + pad / 2 - y0 * k;
    applyView();
  }

  function zoomAt(cx, cy, f) {
    const k2 = Math.max(0.2, Math.min(4, B.view.k * f));
    const ff = k2 / B.view.k;
    B.view.x = cx - (cx - B.view.x) * ff;
    B.view.y = cy - (cy - B.view.y) * ff;
    B.view.k = k2;
    applyView();
  }

  /* ---------- Жесты ---------- */
  const ptrs = new Map();
  let G = null;
  let held = null;

  function local(e) {
    const r = $('#board').getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function toWorld(e) {
    const p = local(e);
    return { x: (p.x - B.view.x) / B.view.k, y: (p.y - B.view.y) / B.view.k };
  }
  function releaseHeld() {
    if (held) { held.state.pressed = false; held = null; changed({ noSave: true }); }
  }

  function onDown(e) {
    if (e.button && e.button !== 0) return;
    const svg = $('#board');
    ptrs.set(e.pointerId, local(e));
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* нет захвата */ }
    if (ptrs.size === 2) {
      releaseHeld();
      const [p1, p2] = [...ptrs.values()];
      G = { type: 'pinch', d: Math.hypot(p1.x - p2.x, p1.y - p2.y), cx: (p1.x + p2.x) / 2, cy: (p1.y + p2.y) / 2 };
      updateRubber(null);
      return;
    }
    if (ptrs.size > 2) return;
    // Клеммы и органы управления важнее проводов, которые лежат поверх них
    const stack = document.elementsFromPoint(e.clientX, e.clientY);
    const pick = (sel) => { for (const x of stack) { const m = x.closest && x.closest(sel); if (m) return m; } return null; };
    const termEl = pick('[data-term]');
    const zoneEl = termEl ? null : pick('[data-zone]');
    const wireEl = termEl || (zoneEl && B.tool !== 'delete') ? null : pick('[data-wire]');
    const compEl = zoneEl ? zoneEl.closest('[data-comp]') : pick('[data-comp]');
    const base = { sx: e.clientX, sy: e.clientY, moved: false };
    if (termEl) G = { type: 'term', key: termEl.dataset.term, ...base };
    else if (zoneEl && compEl && B.tool !== 'delete') {
      const c = comp(compEl.dataset.comp), zone = zoneEl.dataset.zone;
      if ((def(c).momentary || []).includes(zone)) {
        c.state.pressed = true; held = c;
        changed({ noSave: true });
        G = { type: 'held', ...base };
      } else G = { type: 'zone', c, zone, ox: c.x, oy: c.y, ...base };
    } else if (wireEl) G = { type: 'wire', idx: +wireEl.dataset.wire, ...base };
    else if (compEl) { const c = comp(compEl.dataset.comp); G = { type: 'comp', c, ox: c.x, oy: c.y, ...base }; }
    else G = { type: 'pan', vx: B.view.x, vy: B.view.y, ...base };
    e.preventDefault();
  }

  function onMove(e) {
    if (!ptrs.has(e.pointerId)) {
      if (B.sel && e.pointerType === 'mouse') { const w = toWorld(e); updateRubber(B.sel, w.x, w.y); }
      return;
    }
    ptrs.set(e.pointerId, local(e));
    if (!G) return;
    if (G.type === 'pinch') {
      if (ptrs.size < 2) return;
      const [p1, p2] = [...ptrs.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
      B.view.x += cx - G.cx; B.view.y += cy - G.cy;
      if (G.d > 10) zoomAt(cx, cy, d / G.d);
      G.d = d; G.cx = cx; G.cy = cy;
      applyView();
      return;
    }
    const dx = e.clientX - G.sx, dy = e.clientY - G.sy;
    const far = Math.hypot(dx, dy) > (e.pointerType === 'mouse' ? 4 : 9);
    if ((G.type === 'zone' || G.type === 'comp') && (G.moved || far)) {
      if (!G.moved) { pushHist(); G.moved = true; }
      G.c.x = Math.round((G.ox + dx / B.view.k) / 2) * 2;
      G.c.y = Math.round((G.oy + dy / B.view.k) / 2) * 2;
      render();
    } else if (G.type === 'pan' && (G.moved || far)) {
      G.moved = true;
      B.view.x = G.vx + dx; B.view.y = G.vy + dy;
      applyView();
    } else if (G.type === 'term' && B.tool === 'wire') {
      if (far) G.moved = true;
      if (G.moved) { const w = toWorld(e); updateRubber(G.key, w.x, w.y); }
    } else if (G.type === 'wire' && far) G.moved = true;
  }

  function onUp(e) {
    ptrs.delete(e.pointerId);
    if (!G) return;
    if (G.type === 'pinch') { if (ptrs.size === 0) G = null; return; }
    const g = G;
    G = null;
    if (g.type === 'held') { releaseHeld(); return; }
    if (g.type === 'term') {
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const t = hit && hit.closest && hit.closest('[data-term]');
      updateRubber(null);
      if (g.moved && B.tool === 'wire') {
        if (t && t.dataset.term !== g.key) { B.sel = null; connect(g.key, t.dataset.term); }
        else render();
      } else if (!g.moved) termTap(g.key);
      return;
    }
    if (g.type === 'zone') { if (g.moved) persist(); else zoneTap(g.c, g.zone); return; }
    if (g.type === 'comp') {
      if (g.moved) persist();
      else if (B.tool === 'delete') removeComp(g.c);
      return;
    }
    if (g.type === 'wire') { if (!g.moved) wireTap(g.idx); return; }
    if (g.type === 'pan' && !g.moved) {
      if (B.sel || B.selWire >= 0 || B.probe.length) { B.sel = null; B.selWire = -1; B.probe = []; render(); }
    }
  }

  function onCancel(e) {
    ptrs.delete(e.pointerId);
    if (G && G.type === 'held') releaseHeld();
    if (ptrs.size === 0) G = null;
    updateRubber(null);
  }

  function onWheel(e) {
    e.preventDefault();
    const p = local(e);
    if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    else { B.view.x -= e.deltaX; applyView(); }
  }

  /* ---------- Панель стенда ---------- */
  function setPanel(open) {
    $('#view-bench').classList.toggle('panel-open', open);
    const t = $('#btn-panel');
    if (t) t.setAttribute('aria-expanded', String(open));
  }

  function renderPanel() {
    const body = $('#panel-body');
    $('#b-title').textContent = B.mode === 'lab' ? B.lab.title : 'Песочница';
    $('#b-eyebrow').textContent = B.mode === 'lab' ? `Задание ${ET.LABS.indexOf(B.lab) + 1} · ${B.lab.group}` : 'Свободная сборка';
    if (B.mode === 'lab') {
      const lab = B.lab;
      body.innerHTML = `
        <p class="goal">${esc(lab.goal)}</p>
        <div class="howto">
          <p><b>Провод:</b> нажмите клемму, потом вторую. Или протяните от клеммы к клемме.</p>
          <p><b>Аппараты:</b> нажимайте на рычаги, клавиши и кнопки. Кнопки работают, пока их держите.</p>
          <p><b>Плата:</b> двигайте пальцем по пустому месту, масштаб — двумя пальцами или колесом.</p>
        </div>
        <details class="hints"><summary>Подсказка по шагам</summary><ol>${lab.hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ol></details>
        <div class="panel-actions">
          <button type="button" class="btn btn-primary" id="btn-check">Проверить схему</button>
          <button type="button" class="btn btn-ghost" id="btn-clear">Снять все провода</button>
        </div>
        <div id="results" aria-live="polite"></div>`;
      $('#btn-check').onclick = runCheck;
      armClear($('#btn-clear'));
      renderResults();
    } else {
      const groups = {};
      for (const [type, d] of Object.entries(ET.CATALOG)) (groups[d.group] = groups[d.group] || []).push([type, d]);
      body.innerHTML = `
        <p class="goal">Собирайте любые схемы: добавляйте аппараты, перетаскивайте их и соединяйте проводами. Симулятор покажет, что заработает, а что выбьет.</p>
        ${Object.entries(groups).map(([g, items]) => `
          <h3 class="pal-h">${esc(g)}</h3>
          <div class="palette">${items.map(([t, d]) => `<button type="button" class="pal-item" data-add="${t}">${esc(d.title)}</button>`).join('')}</div>`).join('')}
        <p class="note">Удалить аппарат: инструмент «Удалить», затем нажмите на аппарат.</p>
        <div class="panel-actions">
          <button type="button" class="btn btn-ghost" id="btn-clear">Снять все провода</button>
          <button type="button" class="btn btn-ghost" id="btn-reset-sb">Очистить песочницу</button>
        </div>`;
      $$('[data-add]', body).forEach((b) => (b.onclick = () => addComp(b.dataset.add)));
      armClear($('#btn-clear'));
      armConfirm($('#btn-reset-sb'), 'Удалить всё?', () => {
        pushHist();
        B.board = { comps: [], wires: [] };
        changed();
      });
    }
  }

  function armConfirm(btn, ask, fn) {
    const label = btn.textContent;
    let armed = false, timer = 0;
    btn.onclick = () => {
      if (!armed) {
        armed = true; btn.textContent = ask; btn.classList.add('btn-bad');
        timer = setTimeout(() => { armed = false; btn.textContent = label; btn.classList.remove('btn-bad'); }, 3000);
        return;
      }
      clearTimeout(timer); armed = false; btn.textContent = label; btn.classList.remove('btn-bad');
      fn();
    };
  }
  function armClear(btn) {
    armConfirm(btn, 'Нажмите ещё раз', () => {
      pushHist();
      B.board.wires = B.board.wires.filter((w) => w.locked);
      B.sel = null; B.selWire = -1;
      changed();
    });
  }

  function runCheck() {
    const res = ET.check.checkLab(B.board, B.lab, B.live);
    B.result = res;
    if (res.ok) {
      const prev = DB.progress[B.lab.id] || 0;
      DB.progress[B.lab.id] = Math.max(prev, res.stars);
      save();
    }
    renderResults();
    setPanel(true);
    const r = $('#results');
    if (r) r.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function stars(n, total = 3) {
    let s = '';
    for (let i = 0; i < total; i++) s += `<svg class="star ${i < n ? 'is-on' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.5L12 17.3 6.1 20.5l1.3-6.5L2.5 9.4l6.6-.8z"/></svg>`;
    return `<span class="stars" aria-label="${n} из ${total}">${s}</span>`;
  }

  function renderResults() {
    const el = $('#results');
    if (!el) return;
    const r = B.result;
    if (!r) { el.innerHTML = ''; return; }
    let h = `<div class="res-head ${r.ok ? 'is-ok' : 'is-bad'}">${r.ok ? `Схема работает ${stars(r.stars)}` : 'Схема пока не работает как нужно'}</div><ul class="res-list">`;
    for (const s of r.scenarios) h += `<li class="${s.ok ? 'ok' : 'bad'}"><b>${esc(s.name)}</b>${s.ok ? '' : `<span>${esc(s.msg)}</span>`}</li>`;
    for (const p of r.pe) h += `<li class="${p.ok ? 'ok' : 'bad'}"><b>Заземление ${esc(p.term)}</b>${p.ok ? '' : '<span>Корпус не подключён к PE. Протяните жёлто-зелёный провод от PE ввода или шины PE.</span>'}</li>`;
    h += `</ul>`;
    if (r.remarks.length) h += `<div class="remarks"><b>Замечания${r.ok ? ' (минус звезда)' : ''}:</b><ul>${r.remarks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
    if (r.ok) {
      const i = ET.LABS.indexOf(B.lab);
      const next = ET.LABS[i + 1];
      if (next) h += `<a class="btn btn-primary btn-block" href="#lab-${next.id}">Следующее: ${esc(next.title)}</a>`;
      else h += `<p class="note">Все задания пройдены. Попробуйте песочницу или тест.</p>`;
    }
    el.innerHTML = h;
  }

  function setTool(t) {
    B.tool = t;
    B.sel = null; B.selWire = -1; B.probe = [];
    $$('.tb-btn[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    $('#board').dataset.tool = t;
    render();
  }

  function setColor(c) {
    B.color = c;
    $$('[data-color]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === c)));
    if (B.tool !== 'wire') setTool('wire');
  }

  function openBench(mode, lab) {
    B.mode = mode; B.lab = lab || null;
    B.board = mode === 'lab' ? boardFromLab(lab) : boardFromSandbox();
    B.hist = []; B.sel = null; B.selWire = -1; B.probe = []; B.live = 0; B.faults = new Set(); B.result = null;
    showView('bench');
    $('#check-label').textContent = mode === 'lab' ? 'Проверить' : 'Аппараты';
    renderPanel();
    setPanel(false);
    simulate();
    B.faults = new Set(B.sim.faults.map((f) => f.msg));
    setTool('wire');
    requestAnimationFrame(() => { fit(); render(); });
  }

  /* ---------- Список заданий ---------- */
  function renderLabs() {
    const el = $('#view-labs');
    const groups = [];
    for (const lab of ET.LABS) {
      let g = groups.find((x) => x.name === lab.group);
      if (!g) groups.push((g = { name: lab.group, labs: [] }));
      g.labs.push(lab);
    }
    const done = ET.LABS.filter((l) => DB.progress[l.id]).length;
    const totalStars = ET.LABS.reduce((s, l) => s + (DB.progress[l.id] || 0), 0);
    el.innerHTML = `
      <div class="page-in">
        <header class="hero">
          <p class="eyebrow">Тренажёр электромонтажника</p>
          <h1>Соберите схему — и включите её</h1>
          <p class="lede">Подключайте светильники, розетки, щитки и двигатели на виртуальном стенде. Симулятор считает цепь по-настоящему: КЗ выбивает автомат, ошибка с нулём роняет УЗО, а двигатель крутится в ту сторону, в какую вы его подключили.</p>
          <div class="progress"><span class="mono">${done}/${ET.LABS.length}</span> заданий · ${stars(Math.round(totalStars / Math.max(1, ET.LABS.length)))}<span class="mono">${totalStars}/${ET.LABS.length * 3}</span></div>
        </header>
        ${groups.map((g) => `
          <section class="lab-group">
            <h2>${esc(g.name)}</h2>
            <div class="lab-grid">
              ${g.labs.map((l) => `
                <a class="lab-card" href="#lab-${l.id}">
                  <span class="lab-n mono">${String(ET.LABS.indexOf(l) + 1).padStart(2, '0')}</span>
                  <span class="lab-t">${esc(l.title)}</span>
                  <span class="lab-b">${esc(l.brief)}</span>
                  <span class="lab-f"><span class="lvl" aria-label="Сложность ${l.level} из 4">${'<i class="on"></i>'.repeat(l.level)}${'<i></i>'.repeat(4 - l.level)}</span>${stars(DB.progress[l.id] || 0)}</span>
                </a>`).join('')}
            </div>
          </section>`).join('')}
        <section class="lab-group">
          <h2>Свободно</h2>
          <div class="lab-grid">
            <a class="lab-card lab-card-alt" href="#sandbox"><span class="lab-n mono">∞</span><span class="lab-t">Песочница</span><span class="lab-b">Все аппараты из каталога: соберите свой щиток или схему управления.</span></a>
            <a class="lab-card lab-card-alt" href="#theory"><span class="lab-n mono">Т</span><span class="lab-t">Теория</span><span class="lab-b">Цвета проводов, обозначения, звезда и треугольник, самоподхват, УЗО.</span></a>
            <a class="lab-card lab-card-alt" href="#quiz"><span class="lab-n mono">?</span><span class="lab-t">Тест</span><span class="lab-b">${ET.QUIZ.length} вопросов с объяснениями.${DB.quizBest != null ? ` Лучший результат: ${DB.quizBest}/${ET.QUIZ.length}.` : ''}</span></a>
          </div>
        </section>
        <footer class="foot">
          <p>Установите тренажёр как приложение: на телефоне — «Добавить на главный экран», на компьютере — значок установки в адресной строке. Работает без интернета.</p>
        </footer>
      </div>`;
  }

  function renderTheory() {
    $('#view-theory').innerHTML = `<div class="page-in">
      <header class="hero hero-sm"><p class="eyebrow">Справочник</p><h1>Теория</h1></header>
      <div class="theory">${ET.THEORY.map((t) => `<article class="card"><h2>${esc(t.title)}</h2>${t.body}</article>`).join('')}</div>
    </div>`;
  }

  /* ---------- Тест ---------- */
  const Q = { order: [], i: 0, score: 0, answered: false };
  function startQuiz() {
    Q.order = ET.QUIZ.map((_, i) => i).sort(() => Math.random() - 0.5);
    Q.i = 0; Q.score = 0; Q.answered = false;
    renderQuiz();
  }
  function renderQuiz() {
    const el = $('#view-quiz');
    if (Q.i >= Q.order.length) {
      const best = Math.max(DB.quizBest || 0, Q.score);
      DB.quizBest = best; save();
      el.innerHTML = `<div class="page-in quiz"><header class="hero hero-sm"><p class="eyebrow">Тест</p><h1>${Q.score} из ${Q.order.length}</h1>
        <p class="lede">${Q.score === Q.order.length ? 'Безупречно.' : Q.score >= Q.order.length * 0.8 ? 'Хороший результат. Повторите разделы, где были ошибки.' : 'Загляните в теорию и попробуйте ещё раз.'} Лучший результат: ${best}.</p></header>
        <div class="panel-actions"><button type="button" class="btn btn-primary" id="q-again">Пройти заново</button><a class="btn btn-ghost" href="#theory">Теория</a></div></div>`;
      $('#q-again').onclick = startQuiz;
      return;
    }
    const q = ET.QUIZ[Q.order[Q.i]];
    el.innerHTML = `<div class="page-in quiz">
      <header class="hero hero-sm"><p class="eyebrow">Вопрос ${Q.i + 1} из ${Q.order.length} · верно ${Q.score}</p><h1 class="q">${esc(q.q)}</h1></header>
      <div class="answers">${q.a.map((a, i) => `<button type="button" class="answer" data-a="${i}">${esc(a)}</button>`).join('')}</div>
      <div id="q-expl" class="q-expl" hidden></div>
    </div>`;
    Q.answered = false;
    $$('[data-a]', el).forEach((b) => (b.onclick = () => {
      if (Q.answered) return;
      Q.answered = true;
      const i = +b.dataset.a;
      if (i === q.c) Q.score++;
      $$('[data-a]', el).forEach((x) => {
        const j = +x.dataset.a;
        x.disabled = true;
        if (j === q.c) x.classList.add('is-right');
        else if (j === i) x.classList.add('is-wrong');
      });
      const ex = $('#q-expl');
      ex.hidden = false;
      ex.innerHTML = `<p><b>${i === q.c ? 'Верно.' : 'Неверно.'}</b> ${esc(q.e)}</p><button type="button" class="btn btn-primary" id="q-next">${Q.i + 1 < Q.order.length ? 'Дальше' : 'Результат'}</button>`;
      $('#q-next').onclick = () => { Q.i++; renderQuiz(); };
      $('#q-next').focus();
    }));
  }

  /* ---------- Навигация ---------- */
  function showView(v) {
    $$('.view').forEach((x) => (x.hidden = x.id !== 'view-' + v));
    document.body.dataset.view = v;
  }

  function route() {
    const h = (location.hash || '#labs').slice(1);
    let tab = h;
    if (h.startsWith('lab-')) {
      const lab = ET.LABS.find((l) => 'lab-' + l.id === h);
      if (lab) { openBench('lab', lab); tab = 'labs'; } else { location.hash = '#labs'; return; }
    } else if (h === 'sandbox') openBench('sandbox');
    else if (h === 'theory') { renderTheory(); showView('theory'); }
    else if (h === 'quiz') { startQuiz(); showView('quiz'); }
    else { tab = 'labs'; renderLabs(); showView('labs'); }
    $$('[data-nav]').forEach((a) => a.setAttribute('aria-current', a.dataset.nav === tab ? 'page' : 'false'));
    if (!h.startsWith('lab-') && h !== 'sandbox') window.scrollTo(0, 0);
  }

  /* ---------- Запуск ---------- */
  function init() {
    const svg = $('#board');
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onCancel);
    svg.addEventListener('lostpointercapture', (e) => { if (G && G.type === 'held' && ptrs.has(e.pointerId)) onCancel(e); });
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('contextmenu', (e) => e.preventDefault());

    $('#colors').innerHTML = WIRE_COLORS.map((c) => `<button type="button" class="swatch sw-${c.id}" data-color="${c.id}" title="${esc(c.name)}" aria-label="${esc(c.name)}" aria-pressed="false"></button>`).join('');
    $$('[data-color]').forEach((b) => (b.onclick = () => setColor(b.dataset.color)));
    $$('.tb-btn[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
    setColor('brown');
    $('#btn-undo').onclick = undo;
    $('#btn-fit').onclick = fit;
    $('#btn-panel').onclick = () => setPanel(!$('#view-bench').classList.contains('panel-open'));
    $('#btn-panel-close').onclick = () => setPanel(false);
    $('#btn-check-tb').onclick = () => { if (B.mode === 'lab') runCheck(); else setPanel(true); };

    document.addEventListener('keydown', (e) => {
      if (document.body.dataset.view !== 'bench' || e.target.closest('input,textarea')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if (e.key === 'Escape') { B.sel = null; B.selWire = -1; B.probe = []; render(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && B.selWire >= 0) { e.preventDefault(); deleteWire(B.selWire); }
      else if (e.key === '1') setTool('wire');
      else if (e.key === '2') setTool('delete');
      else if (e.key === '3') setTool('probe');
    });
    window.addEventListener('pointerup', () => { if (held && !G) releaseHeld(); });
    window.addEventListener('blur', releaseHeld);
    let rt = 0;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (document.body.dataset.view === 'bench') fit(); }, 150); });
    window.addEventListener('hashchange', route);
    route();

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !document.documentElement.dataset.noSw) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.ET);
