/* Каталог электрических компонентов: геометрия, клеммы, контакты, отрисовка. */
'use strict';

(function (global) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const text = (x, y, s, cls = 't-sm', anchor = 'middle') =>
    `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${esc(s)}</text>`;
  const term = (id, x, y, dir, label) => ({ id, x, y, dir, label: label == null ? id : label });

  /* Общие градиенты и фильтры. Аппараты — физические предметы, поэтому цвета одинаковы в обеих темах. */
  const SVG_DEFS = `
    <linearGradient id="g-plastic" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e3e6e2"/><stop offset=".18" stop-color="#fbfbf8"/><stop offset=".82" stop-color="#f6f7f3"/><stop offset="1" stop-color="#d6dad5"/></linearGradient>
    <linearGradient id="g-plastic-v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fdfdfb"/><stop offset="1" stop-color="#e2e5e0"/></linearGradient>
    <linearGradient id="g-front" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eceee9"/></linearGradient>
    <linearGradient id="g-grey" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9aa2a9"/><stop offset=".2" stop-color="#c9ced2"/><stop offset=".8" stop-color="#bfc5ca"/><stop offset="1" stop-color="#8e979e"/></linearGradient>
    <linearGradient id="g-dark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a5561"/><stop offset="1" stop-color="#262d34"/></linearGradient>
    <linearGradient id="g-steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5d6873"/><stop offset=".5" stop-color="#46505a"/><stop offset="1" stop-color="#343c44"/></linearGradient>
    <linearGradient id="g-lever" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a6570"/><stop offset=".45" stop-color="#2f363d"/><stop offset="1" stop-color="#1c2126"/></linearGradient>
    <linearGradient id="g-lever-blue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6d9ae8"/><stop offset=".45" stop-color="#2b5fc4"/><stop offset="1" stop-color="#1c3f88"/></linearGradient>
    <linearGradient id="g-brass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7dc8c"/><stop offset=".5" stop-color="#d4a83a"/><stop offset="1" stop-color="#9c7518"/></linearGradient>
    <linearGradient id="g-copper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3b48a"/><stop offset=".5" stop-color="#c87443"/><stop offset="1" stop-color="#8c4a24"/></linearGradient>
    <linearGradient id="g-motor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d4a66"/><stop offset=".22" stop-color="#7aa0c4"/><stop offset=".45" stop-color="#4f7598"/><stop offset="1" stop-color="#22374c"/></linearGradient>
    <linearGradient id="g-motor-end" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2b4258"/><stop offset=".5" stop-color="#5a7fa3"/><stop offset="1" stop-color="#2b4258"/></linearGradient>
    <linearGradient id="g-shaft" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8d959c"/><stop offset=".35" stop-color="#f2f4f6"/><stop offset="1" stop-color="#6c747b"/></linearGradient>
    <linearGradient id="g-bakelite" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7b5236"/><stop offset="1" stop-color="#5a3a24"/></linearGradient>
    <linearGradient id="g-key" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#f4f5f1"/><stop offset="1" stop-color="#dcdfd9"/></linearGradient>
    <linearGradient id="g-key-on" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dcdfd9"/><stop offset=".5" stop-color="#f4f5f1"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
    <linearGradient id="g-wago" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f8f9" stop-opacity=".95"/><stop offset="1" stop-color="#c9d1d6" stop-opacity=".95"/></linearGradient>
    <linearGradient id="g-wago-lever" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb056"/><stop offset="1" stop-color="#e06b00"/></linearGradient>
    <linearGradient id="g-busn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5d8fe8"/><stop offset="1" stop-color="#1f4fa8"/></linearGradient>
    <linearGradient id="g-buspe" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5ccc85"/><stop offset="1" stop-color="#1b7e3f"/></linearGradient>
    <radialGradient id="g-screw" cx=".38" cy=".35" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#cfd5da"/><stop offset="1" stop-color="#78828a"/></radialGradient>
    <radialGradient id="g-nut" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#fff0b8"/><stop offset=".5" stop-color="#d9ad45"/><stop offset="1" stop-color="#8a6512"/></radialGradient>
    <radialGradient id="g-bulb-off" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#eef2f4" stop-opacity=".95"/><stop offset="1" stop-color="#c9d2d8" stop-opacity=".95"/></radialGradient>
    <radialGradient id="g-bulb-on" cx=".45" cy=".42" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="#fff2b0"/><stop offset=".8" stop-color="#ffd24a"/><stop offset="1" stop-color="#f0a800"/></radialGradient>
    <radialGradient id="g-bulb-burnt" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#8f9496"/><stop offset=".7" stop-color="#4b4f51"/><stop offset="1" stop-color="#2a2d2e"/></radialGradient>
    <radialGradient id="glowg"><stop offset="0" stop-color="#ffe9a0" stop-opacity=".95"/><stop offset=".55" stop-color="#ffd257" stop-opacity=".35"/><stop offset="1" stop-color="#ffd257" stop-opacity="0"/></radialGradient>
    <radialGradient id="g-btn-green" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#8ef0ad"/><stop offset=".55" stop-color="#22a654"/><stop offset="1" stop-color="#0f6630"/></radialGradient>
    <radialGradient id="g-btn-red" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#ff9d93"/><stop offset=".55" stop-color="#d8382a"/><stop offset="1" stop-color="#861a12"/></radialGradient>
    <radialGradient id="g-btn-yellow" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#fff0a6"/><stop offset=".55" stop-color="#f2b705"/><stop offset="1" stop-color="#9a7300"/></radialGradient>
    <radialGradient id="g-btn-blue" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#a9c6ff"/><stop offset=".55" stop-color="#2f6bd8"/><stop offset="1" stop-color="#193f87"/></radialGradient>
    <radialGradient id="g-bezel" cx=".5" cy=".5" r=".5"><stop offset=".7" stop-color="#f4f6f8"/><stop offset=".85" stop-color="#9aa3ab"/><stop offset="1" stop-color="#e5e8eb"/></radialGradient>
    <radialGradient id="g-lens-g" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#d4ffe2"/><stop offset=".5" stop-color="#2fe070"/><stop offset="1" stop-color="#0d7a34"/></radialGradient>
    <radialGradient id="g-lens-r" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#ffe0dc"/><stop offset=".5" stop-color="#ff4b3b"/><stop offset="1" stop-color="#8c160c"/></radialGradient>
    <radialGradient id="g-lens-off" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#8a948f"/><stop offset="1" stop-color="#2d3330"/></radialGradient>
    <radialGradient id="g-fan" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#1b2a38"/><stop offset="1" stop-color="#0d151d"/></radialGradient>
    <radialGradient id="g-dial" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c3c9ce"/></radialGradient>
    <pattern id="p-thread" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="2" fill="#b9bfc4"/><rect y="2" width="4" height="2" fill="#7f878d"/></pattern>
    <pattern id="p-vent" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="3" fill="#3a434c"/></pattern>
    <filter id="f-shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="3" stdDeviation="2.4" flood-color="#000" flood-opacity=".28"/></filter>
    <filter id="f-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5"/></filter>`;

  /* Мелкие детали, общие для аппаратов */
  const terminalWell = (x, y, w = 22, h = 16) => `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="2.5" class="well"/>`;
  const vents = (x, y, w, n, step = 4) => { let s = ''; for (let i = 0; i < n; i++) s += `<rect x="${x}" y="${y + i * step}" width="${w}" height="1.6" rx=".8" class="vent"/>`; return s; };
  const smoke = (x, y) => `<g class="smoke"><circle cx="${x}" cy="${y}" r="7"/><circle cx="${x + 9}" cy="${y - 8}" r="9"/><circle cx="${x - 3}" cy="${y - 18}" r="8"/></g>`;

  /* ---------- Ввод питания: щиток ввода с рубильником ---------- */
  function supply(three) {
    const ids = three ? ['L1', 'L2', 'L3', 'N', 'PE'] : ['L', 'N', 'PE'];
    const step = 44;
    const w = three ? 250 : 190;
    const terms = ids.map((id, i) => term(id, 26 + i * step, 88, 'down'));
    const label = { L: 'L1', L1: 'L1', L2: 'L2', L3: 'L3', N: 'N', PE: 'PE' };
    const blockCls = { L: 'blk-l1', L1: 'blk-l1', L2: 'blk-l2', L3: 'blk-l3', N: 'blk-n', PE: 'blk-pe' };
    return {
      title: three ? 'Ввод 3~ 400 В' : 'Ввод 1~ 230 В',
      group: 'Питание',
      prefix: 'ВВОД',
      w, h: 100, terms,
      init: () => ({ on: false }),
      sources: (c) => (c.state.on ? ids.map((id) => [id, label[id]]) : []),
      roleSources: () => ids.map((id) => [id, label[id]]),
      tap(c) { c.state.on = !c.state.on; c.state.fuse = false; },
      render(c) {
        const on = c.state.on;
        let s = '';
        // Вводной кабель уходит вверх
        s += `<rect x="${w / 2 - 9}" y="-34" width="18" height="40" rx="3" class="cable"/><rect x="${w / 2 - 12}" y="-2" width="24" height="8" rx="2" class="gland"/>`;
        s += `<rect x="0" y="0" width="${w}" height="100" rx="7" fill="url(#g-steel)" class="box-edge" filter="url(#f-shadow)"/>`;
        s += `<rect x="4" y="4" width="${w - 8}" height="92" rx="5" class="box-inner"/>`;
        s += text(12, 20, three ? 'ВВОД 3~ 400/230 В' : 'ВВОД 1~ 230 В', 't-md t-dk', 'start');
        s += text(12, 32, three ? '50 Гц · TN-C-S' : '50 Гц · TN-C-S', 't-xxs t-dkm', 'start');
        if (c.state.fuse) s += text(12, 46, 'Предохранители сгорели!', 't-xs t-badlit', 'start');
        // Рубильник: поворотная рукоять на жёлтой плашке
        const kx = w - 34, ky = 26;
        s += `<g data-zone="power" class="zone">`;
        s += `<rect x="${kx - 24}" y="${ky - 20}" width="48" height="40" rx="5" class="rot-plate"/>`;
        s += `<circle cx="${kx}" cy="${ky}" r="13" class="rot-ring"/>`;
        s += `<g transform="rotate(${on ? 90 : 0} ${kx} ${ky})"><rect x="${kx - 21}" y="${ky - 5}" width="42" height="10" rx="5" class="rot-handle"/><circle cx="${kx}" cy="${ky}" r="4" class="rot-hub"/></g>`;
        s += `</g>`;
        s += text(kx - 30, ky + 30, '0', on ? 't-xxs t-dkm' : 't-xs t-dk', 'middle');
        s += text(kx + 26, ky + 30, 'I', on ? 't-xs t-lit' : 't-xxs t-dkm', 'middle');
        s += `<circle cx="${kx + 14}" cy="${ky + 27}" r="3" class="${on ? 'lamp-live' : 'lamp-dead'}"/>`;
        // Клеммник: цветные проходные клеммы на DIN-рейке
        s += `<rect x="6" y="${60}" width="${w - 12}" height="8" rx="1" class="mini-rail"/>`;
        ids.forEach((id, i) => {
          const x = 26 + i * step;
          s += `<rect x="${x - 15}" y="56" width="30" height="40" rx="3" class="${blockCls[id]}"/>`;
          s += `<rect x="${x - 11}" y="79" width="22" height="16" rx="2.5" class="well"/>`;
          s += text(x, 70, id, id === 'PE' ? 't-xs t-strong' : 't-xs t-inv t-strong');
        });
        return s;
      },
    };
  }

  /* ---------- Модульный автомат ---------- */
  function modularShell(w, opts = {}) {
    // Корпус модульного аппарата: узкие клеммные зоны сверху и снизу, широкая лицевая часть посередине
    let s = `<g filter="url(#f-shadow)">`;
    s += `<rect x="1" y="0" width="${w - 2}" height="120" rx="4" fill="url(#g-plastic)" class="dev-edge"/>`;
    s += `</g>`;
    s += `<rect x="1" y="20" width="${w - 2}" height="80" rx="3" fill="url(#g-plastic)" class="dev-edge"/>`;
    s += `<rect x="4" y="23" width="${w - 8}" height="74" rx="3" fill="url(#g-front)" class="front-edge"/>`;
    for (let i = 0; i < w / 36; i++) {
      s += terminalWell(18 + 36 * i, 9, 24, 16) + terminalWell(18 + 36 * i, 111, 24, 16);
      if (!opts.noPoleMarks) {
        s += `<path d="M${36 * i + 4} 20 v-2 M${36 * i + 32} 20 v-2" class="seam"/>`;
      }
    }
    for (let i = 1; i < w / 36; i++) s += `<path d="M${36 * i} 2 V118" class="seam"/>`;
    return s;
  }

  function breaker(poles) {
    const w = 36 * poles;
    const terms = [];
    for (let i = 0; i < poles; i++) {
      terms.push(term(String(2 * i + 1), 18 + 36 * i, 9, 'up'));
      terms.push(term(String(2 * i + 2), 18 + 36 * i, 111, 'down'));
    }
    return {
      title: `Автомат ${poles}P`,
      group: 'Защита',
      prefix: 'QF',
      w, h: 120, terms, protective: true, modular: true,
      params: { rating: poles === 1 ? 'C16' : 'C25' },
      init: () => ({ on: false }),
      contacts(c) {
        const r = [];
        for (let i = 0; i < poles; i++) r.push({ a: String(2 * i + 1), b: String(2 * i + 2), tag: 'p' + i, closed: !!c.state.on });
        return r;
      },
      tap(c) { c.state.on = !c.state.on; c.state.tripped = false; },
      render(c) {
        const on = c.state.on;
        const rating = (c.params && c.params.rating) || 'C16';
        let s = modularShell(w);
        s += `<g data-zone="lever" class="zone">`;
        s += `<rect x="4" y="23" width="${w - 8}" height="74" rx="3" fill="transparent"/>`;
        s += text(w / 2, 33, 'ВА47-29', 't-xxs t-mute');
        s += text(w / 2, 45, rating, 't-md t-strong');
        // Прорезь и рычаг, общий для всех полюсов
        const lw = w - 14, lx = 7;
        s += `<rect x="${lx - 1}" y="50" width="${lw + 2}" height="30" rx="3" class="slot"/>`;
        s += `<rect x="${lx}" y="${on ? 51 : 63}" width="${lw}" height="16" rx="3" fill="url(#g-lever)" class="lever-edge ${c.state.tripped ? 'is-tripped' : ''}"/>`;
        for (let i = 0; i < 3; i++) s += `<rect x="${lx + 4}" y="${(on ? 54 : 66) + i * 4}" width="${lw - 8}" height="1.2" class="grip"/>`;
        s += text(w - 6, 57, 'I', 't-xxs t-mute', 'end');
        s += text(w - 6, 79, 'O', 't-xxs t-mute', 'end');
        // Индикатор положения контактов
        s += `<rect x="${w / 2 - 7}" y="84" width="14" height="8" rx="1.5" class="${on ? 'flag-red' : 'flag-green'}"/>`;
        s += `</g>`;
        return s;
      },
    };
  }

  /* ---------- УЗО 2P ---------- */
  const rcd = {
    title: 'УЗО 2P 30 мА',
    group: 'Защита',
    prefix: 'QD',
    w: 72, h: 120, modular: true, isRcd: true,
    terms: [term('1', 18, 9, 'up', 'L'), term('N', 54, 9, 'up', 'N'), term('2', 18, 111, 'down', 'L'), term('N2', 54, 111, 'down', 'N')],
    params: { rating: '40А 30мА' },
    init: () => ({ on: false }),
    contacts: (c) => [
      { a: '1', b: '2', tag: 'L', closed: !!c.state.on },
      { a: 'N', b: 'N2', tag: 'N', closed: !!c.state.on },
    ],
    tap(c, zone) {
      if (zone === 'test') { if (c.state.on) { c.state.on = false; c.state.tripped = true; c.state.byTest = true; } return; }
      c.state.on = !c.state.on; c.state.tripped = false; c.state.byTest = false;
    },
    render(c) {
      const on = c.state.on;
      let s = modularShell(72);
      s += `<g data-zone="lever" class="zone">`;
      s += `<rect x="4" y="23" width="40" height="74" rx="3" fill="transparent"/>`;
      s += text(36, 32, 'ВД1-63  УЗО', 't-xxs t-mute');
      s += text(20, 44, '40 A', 't-xs t-strong');
      s += `<rect x="7" y="50" width="28" height="30" rx="3" class="slot"/>`;
      s += `<rect x="8" y="${on ? 51 : 63}" width="26" height="16" rx="3" fill="url(#g-lever-blue)" class="lever-edge ${c.state.tripped ? 'is-tripped' : ''}"/>`;
      for (let i = 0; i < 3; i++) s += `<rect x="12" y="${(on ? 54 : 66) + i * 4}" width="18" height="1.2" class="grip"/>`;
      s += `<rect x="14" y="84" width="14" height="8" rx="1.5" class="${on ? 'flag-red' : 'flag-green'}"/>`;
      s += `</g>`;
      s += text(54, 44, 'IΔn 30mA', 't-xxs t-strong');
      // Схема дифтрансформатора на лицевой панели
      s += `<path d="M46 72 h16 M46 78 h16" class="schem"/><ellipse cx="54" cy="75" rx="4" ry="8" class="schem"/>`;
      s += `<g data-zone="test" class="zone"><circle cx="54" cy="58" r="8.5" class="btn-ring-sm"/><circle cx="54" cy="58" r="6.5" fill="url(#g-btn-yellow)"/>${text(54, 60.8, 'T', 't-xs t-strong')}</g>`;
      s += text(54, 92, 'тест', 't-xxs t-mute');
      return s;
    },
  };

  /* ---------- Шины и клеммы ---------- */
  function bus(kind, n) {
    const w = 16 + n * 24;
    const terms = [];
    for (let i = 0; i < n; i++) terms.push(term('t' + (i + 1), 20 + i * 24, 14, 'up', ''));
    return {
      title: kind === 'N' ? 'Шина N (ноль)' : 'Шина PE (земля)',
      group: 'Монтаж',
      prefix: kind === 'N' ? 'XN' : 'XPE',
      w, h: 30, terms,
      fixed: () => terms.slice(1).map((t) => ['t1', t.id]),
      render() {
        let s = `<g filter="url(#f-shadow)">`;
        s += `<rect x="0" y="10" width="${w}" height="18" rx="3" fill="url(${kind === 'N' ? '#g-busn' : '#g-buspe'})" class="ins-edge"/>`;
        s += `</g>`;
        s += `<rect x="6" y="4" width="${w - 12}" height="20" rx="2" fill="url(#g-brass)" class="brass-edge"/>`;
        for (let i = 0; i < n; i++) s += `<rect x="${12 + i * 24}" y="6" width="16" height="16" rx="2" class="brass-hole"/>`;
        s += `<rect x="-2" y="8" width="8" height="22" rx="2" fill="url(${kind === 'N' ? '#g-busn' : '#g-buspe'})"/><rect x="${w - 6}" y="8" width="8" height="22" rx="2" fill="url(${kind === 'N' ? '#g-busn' : '#g-buspe'})"/>`;
        s += text(w / 2, 40, kind === 'N' ? 'N  —  нулевая шина' : 'PE  —  шина заземления', 't-xxs t-plate');
        return s;
      },
    };
  }

  function wago(n) {
    const w = 10 + n * 16;
    const terms = [];
    for (let i = 0; i < n; i++) terms.push(term('t' + (i + 1), 13 + i * 16, 8, 'up', ''));
    return {
      title: `Клемма WAGO ×${n}`,
      group: 'Монтаж',
      prefix: 'X',
      w, h: 34, terms,
      fixed: () => terms.slice(1).map((t) => ['t1', t.id]),
      render() {
        let s = `<rect x="0" y="0" width="${w}" height="34" rx="4" fill="url(#g-wago)" class="wago-edge" filter="url(#f-shadow)"/>`;
        s += `<rect x="3" y="12" width="${w - 6}" height="5" rx="1" fill="url(#g-copper)" opacity=".75"/>`;
        for (let i = 0; i < n; i++) s += `<rect x="${6 + i * 16}" y="19" width="14" height="13" rx="2" fill="url(#g-wago-lever)" class="wago-lever-edge"/><rect x="${9 + i * 16}" y="22" width="8" height="1.4" class="grip-w"/>`;
        return s;
      },
    };
  }

  /* ---------- Бытовые выключатели ---------- */
  function wallFrame(w) {
    // Рамка накладного выключателя и механизм с винтовыми клеммами снизу
    let s = `<rect x="${w / 2 - 26}" y="58" width="52" height="26" rx="3" class="mech"/>`;
    s += `<rect x="0" y="0" width="${w}" height="64" rx="9" fill="url(#g-plastic-v)" class="dev-edge" filter="url(#f-shadow)"/>`;
    s += `<rect x="5" y="5" width="${w - 10}" height="54" rx="6" class="frame-inner"/>`;
    return s;
  }
  function rocker(x, y, w, h, on, zone, mark = true) {
    let s = `<g data-zone="${zone}" class="zone">`;
    s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="url(${on ? '#g-key-on' : '#g-key'})" class="key-edge"/>`;
    s += `<path d="M${x + 3} ${y + h / 2} H${x + w - 3}" class="key-split ${on ? 'is-on' : ''}"/>`;
    if (mark) s += `<rect x="${x + w / 2 - 3}" y="${on ? y + 5 : y + h - 11}" width="6" height="6" rx="1" class="${on ? 'key-led-on' : 'key-led'}"/>`;
    s += `</g>`;
    return s;
  }

  const switch1 = {
    title: 'Выключатель 1-клав.',
    group: 'Освещение',
    prefix: 'SA',
    w: 70, h: 84,
    terms: [term('L', 18, 76, 'down'), term('1', 52, 76, 'down')],
    init: () => ({ k1: false }),
    contacts: (c) => [{ a: 'L', b: '1', tag: 'k1', closed: !!c.state.k1 }],
    tap(c) { c.state.k1 = !c.state.k1; },
    render(c) {
      return wallFrame(70) + rocker(12, 9, 46, 46, c.state.k1, 'k1');
    },
  };

  const switch2 = {
    title: 'Выключатель 2-клав.',
    group: 'Освещение',
    prefix: 'SA',
    w: 84, h: 84,
    terms: [term('L', 16, 76, 'down'), term('1', 42, 76, 'down'), term('2', 68, 76, 'down')],
    init: () => ({ k1: false, k2: false }),
    contacts: (c) => [
      { a: 'L', b: '1', tag: 'k1', closed: !!c.state.k1 },
      { a: 'L', b: '2', tag: 'k2', closed: !!c.state.k2 },
    ],
    tap(c, zone) { c.state[zone] = !c.state[zone]; },
    render(c) {
      let s = wallFrame(84);
      s += rocker(10, 9, 31, 46, c.state.k1, 'k1') + rocker(43, 9, 31, 46, c.state.k2, 'k2');
      s += text(25.5, 72, '1', 't-xxs t-mute') + text(58.5, 72, '2', 't-xxs t-mute');
      return s;
    },
  };

  const switchPass = {
    title: 'Проходной выключатель',
    group: 'Освещение',
    prefix: 'SA',
    w: 84, h: 84,
    terms: [term('1', 16, 76, 'down'), term('L', 42, 76, 'down', 'L'), term('2', 68, 76, 'down')],
    init: () => ({ pos: 0 }),
    contacts: (c) => [
      { a: 'L', b: '1', tag: 'a', closed: !c.state.pos },
      { a: 'L', b: '2', tag: 'b', closed: !!c.state.pos },
    ],
    tap(c) { c.state.pos = c.state.pos ? 0 : 1; },
    render(c) {
      let s = wallFrame(84);
      s += rocker(14, 9, 56, 46, !!c.state.pos, 'k1', false);
      s += `<path d="M38 22 l4 -5 l4 5 M38 42 l4 5 l4 -5" class="key-arrow"/>`;
      s += text(42, 35, c.state.pos ? '→2' : '→1', 't-xxs t-mute');
      return s;
    },
  };

  /* ---------- Нагрузки ---------- */
  const lamp = {
    title: 'Светильник',
    group: 'Освещение',
    prefix: 'HL',
    w: 76, h: 92,
    terms: [term('L', 16, 84, 'down'), term('N', 38, 84, 'down'), term('PE', 60, 84, 'down')],
    loads: [{ a: 'L', b: 'N', kind: 'lamp' }],
    init: () => ({}),
    tap(c) { if (c.state.burnt) c.state.burnt = false; },
    render(c, st) {
      const on = st && st.on;
      const burnt = c.state.burnt;
      let s = '';
      if (on) s += `<circle cx="38" cy="28" r="48" fill="url(#glowg)" class="glow"/>`;
      // Монтажная платформа светильника с клеммной колодкой
      s += `<rect x="0" y="60" width="76" height="32" rx="7" fill="url(#g-plastic-v)" class="dev-edge" filter="url(#f-shadow)"/>`;
      s += `<rect x="6" y="74" width="64" height="16" rx="3" class="term-strip"/>`;
      // Патрон E27 и колба
      s += `<rect x="26" y="44" width="24" height="18" rx="3" class="socket-holder"/>`;
      s += `<g data-zone="bulb" class="zone">`;
      s += `<rect x="29" y="36" width="18" height="12" rx="2" fill="url(#p-thread)"/>`;
      s += `<path d="M38 2 C21 2 14 14 14 24 C14 32 22 36 28 38 L48 38 C54 36 62 32 62 24 C62 14 55 2 38 2 Z" fill="url(${burnt ? '#g-bulb-burnt' : on ? '#g-bulb-on' : '#g-bulb-off'})" class="bulb-edge ${on ? 'is-on' : ''}"/>`;
      s += `<path d="M33 37 L33 26 M43 37 L43 26" class="lead"/>`;
      s += `<path d="M30 25 q2 -5 4 0 q2 -5 4 0 q2 -5 4 0 q2 -5 4 0" class="filament ${on ? 'is-on' : ''}"/>`;
      if (!burnt) s += `<path d="M23 16 C25 10 30 7 34 6" class="glass-hl"/>`;
      if (burnt) s += `<path d="M22 14 L32 24 L27 28 L40 36" class="crack"/>` + smoke(46, -4);
      s += `</g>`;
      return s;
    },
  };

  const socket = {
    title: 'Розетка с заземлением',
    group: 'Розетки',
    prefix: 'XS',
    w: 76, h: 92,
    terms: [term('L', 16, 84, 'down'), term('N', 38, 84, 'down'), term('PE', 60, 84, 'down')],
    loads: [{ a: 'L', b: 'N', kind: 'socket' }],
    init: () => ({}),
    render(c, st) {
      const on = st && st.on;
      const pe = st && st.pe;
      let s = `<rect x="0" y="0" width="76" height="92" rx="11" fill="url(#g-plastic-v)" class="dev-edge" filter="url(#f-shadow)"/>`;
      s += `<rect x="5" y="5" width="66" height="66" rx="8" class="frame-inner"/>`;
      s += `<circle cx="38" cy="38" r="26" class="socket-recess"/>`;
      s += `<circle cx="38" cy="38" r="22" class="socket-floor"/>`;
      // Заземляющие скобы сверху и снизу
      s += `<rect x="32" y="12" width="12" height="7" rx="1.5" class="${pe ? 'pe-clip is-ok' : 'pe-clip'}"/>`;
      s += `<rect x="32" y="57" width="12" height="7" rx="1.5" class="${pe ? 'pe-clip is-ok' : 'pe-clip'}"/>`;
      s += `<circle cx="28" cy="38" r="4.6" class="socket-hole"/><circle cx="48" cy="38" r="4.6" class="socket-hole"/>`;
      s += `<circle cx="27" cy="37" r="1.4" class="hole-hl"/><circle cx="47" cy="37" r="1.4" class="hole-hl"/>`;
      s += `<circle cx="64" cy="12" r="3.4" class="${on ? 'lamp-live' : 'lamp-dead'}"/>`;
      s += `<rect x="6" y="74" width="64" height="16" rx="3" class="term-strip"/>`;
      if (st && st.v > 300) s += smoke(52, 10);
      return s;
    },
  };

  function pilot(color) {
    return {
      title: color === 'g' ? 'Сигнальная лампа зел.' : 'Сигнальная лампа красн.',
      group: 'Управление',
      prefix: 'HL',
      w: 48, h: 66,
      terms: [term('X1', 12, 58, 'down'), term('X2', 36, 58, 'down')],
      loads: [{ a: 'X1', b: 'X2', kind: 'lamp' }],
      init: () => ({}),
      tap(c) { if (c.state.burnt) c.state.burnt = false; },
      render(c, st) {
        const on = st && st.on;
        let s = '';
        if (on) s += `<circle cx="24" cy="24" r="30" fill="url(#glowg)" class="glow glow-${color}"/>`;
        s += `<rect x="0" y="0" width="48" height="66" rx="6" fill="url(#g-grey)" class="dev-edge" filter="url(#f-shadow)"/>`;
        s += `<rect x="4" y="48" width="40" height="16" rx="2.5" class="term-strip"/>`;
        s += `<g data-zone="bulb" class="zone"><circle cx="24" cy="24" r="18" fill="url(#g-bezel)" class="bezel-edge"/>`;
        s += `<circle cx="24" cy="24" r="13" fill="url(${c.state.burnt || !on ? '#g-lens-off' : color === 'g' ? '#g-lens-g' : '#g-lens-r'})"/>`;
        if (!on && !c.state.burnt) s += `<circle cx="24" cy="24" r="13" fill="${color === 'g' ? '#1f8a45' : '#a12a20'}" opacity=".45"/>`;
        s += `<circle cx="19" cy="19" r="3.5" class="lens-hl"/></g>`;
        return s;
      },
    };
  }

  /* ---------- Кнопки ---------- */
  function button(kind) {
    const no = kind !== 'stop';
    const a = no ? '13' : '11', b = no ? '14' : '12';
    return {
      title: no ? 'Кнопка «Пуск» (НО)' : 'Кнопка «Стоп» (НЗ)',
      group: 'Управление',
      prefix: 'SB',
      w: 56, h: 84,
      terms: [term(a, 14, 76, 'down'), term(b, 42, 76, 'down')],
      momentary: ['btn'],
      init: () => ({ pressed: false }),
      contacts: (c) => [{ a, b, tag: 'c', closed: no ? !!c.state.pressed : !c.state.pressed }],
      render(c) {
        const p = c.state.pressed;
        let s = `<rect x="0" y="0" width="56" height="84" rx="6" fill="url(#g-grey)" class="dev-edge" filter="url(#f-shadow)"/>`;
        // Контактный блок на тыльной стороне
        s += `<rect x="4" y="62" width="48" height="20" rx="2.5" class="${no ? 'cblock-no' : 'cblock-nc'}"/>`;
        s += `<g data-zone="btn" class="zone">`;
        s += `<circle cx="28" cy="28" r="23" fill="url(#g-bezel)" class="bezel-edge"/>`;
        if (no) {
          s += `<circle cx="28" cy="28" r="17" class="btn-collar"/>`;
          s += `<circle cx="28" cy="${p ? 29 : 28}" r="${p ? 13 : 15}" fill="url(#g-btn-green)" class="btn-edge"/>`;
        } else {
          // «Грибок» аварийного стопа
          s += `<circle cx="28" cy="${p ? 29 : 28}" r="${p ? 18 : 20}" fill="url(#g-btn-red)" class="btn-edge"/>`;
          s += `<circle cx="28" cy="${p ? 29 : 28}" r="${p ? 12 : 13}" fill="none" class="btn-rim"/>`;
        }
        s += text(28, (p ? 33 : 32), (c.params && c.params.caption) || (no ? 'I' : 'O'), 't-md t-inv t-strong');
        s += `</g>`;
        s += `<rect x="10" y="53" width="36" height="9" rx="1.5" class="tag-plate"/>`;
        s += text(28, 60, no ? 'ПУСК' : 'СТОП', 't-xxs t-strong');
        s += text(28, 73, no ? 'НО' : 'НЗ', 't-xxs t-mute');
        return s;
      },
    };
  }

  /* ---------- Контактор ---------- */
  const KX = [12, 40, 62, 84, 110, 132];
  const contactor = {
    title: 'Контактор 230 В~',
    group: 'Управление',
    prefix: 'KM',
    w: 144, h: 140,
    terms: [
      term('A1', KX[0], 9, 'up'), term('1L1', KX[1], 9, 'up', 'L1'), term('3L2', KX[2], 9, 'up', 'L2'), term('5L3', KX[3], 9, 'up', 'L3'),
      term('13', KX[4], 9, 'up'), term('21', KX[5], 9, 'up'),
      term('A2', KX[0], 131, 'down'), term('2T1', KX[1], 131, 'down', 'T1'), term('4T2', KX[2], 131, 'down', 'T2'), term('6T3', KX[3], 131, 'down', 'T3'),
      term('14', KX[4], 131, 'down'), term('22', KX[5], 131, 'down'),
    ],
    loads: [{ a: 'A1', b: 'A2', kind: 'coil' }],
    init: () => ({ on: false }),
    contacts: (c) => {
      const on = !!c.state.on;
      return [
        { a: '1L1', b: '2T1', tag: 'p0', closed: on },
        { a: '3L2', b: '4T2', tag: 'p1', closed: on },
        { a: '5L3', b: '6T3', tag: 'p2', closed: on },
        { a: '13', b: '14', tag: 'no', closed: on },
        { a: '21', b: '22', tag: 'nc', closed: !on },
      ];
    },
    tap(c) { if (c.state.burnt) c.state.burnt = false; },
    render(c) {
      const on = c.state.on;
      let s = '';
      // Основной корпус (силовая часть + катушка)
      s += `<rect x="0" y="0" width="98" height="140" rx="5" fill="url(#g-plastic)" class="dev-edge" filter="url(#f-shadow)"/>`;
      // Пристыкованная приставка доп. контактов
      s += `<rect x="98" y="6" width="46" height="128" rx="4" fill="url(#g-grey)" class="dev-edge" filter="url(#f-shadow)"/>`;
      KX.forEach((x) => { s += terminalWell(x, 9, 18, 15) + terminalWell(x, 131, 18, 15); });
      s += `<g data-zone="body" class="zone">`;
      // Дугогасительная камера: рёбра сверху
      s += `<rect x="26" y="20" width="70" height="22" rx="2" class="arc-chute"/>`;
      for (let i = 0; i < 9; i++) s += `<rect x="${29 + i * 7.4}" y="22" width="3.6" height="18" rx="1" class="arc-rib"/>`;
      // Окно положения якоря
      s += `<rect x="30" y="50" width="62" height="34" rx="3" class="window"/>`;
      s += `<rect x="36" y="${on ? 66 : 54}" width="50" height="10" rx="2" class="${on ? 'armature-on' : 'armature'}"/>`;
      s += `<path d="M36 ${on ? 66 : 54} h50" class="armature-hl"/>`;
      s += text(61, 92, 'КМИ-11210', 't-xxs t-mute');
      s += `<rect x="30" y="96" width="62" height="20" rx="2" class="tag-plate"/>`;
      s += text(61, 105, 'Uc 230В~  12А', 't-xxs t-strong');
      s += text(61, 113, 'AC-3', 't-xxs t-mute');
      // Катушка A1–A2 слева
      s += `<rect x="4" y="50" width="20" height="66" rx="2" class="coil-zone"/>`;
      s += `<path d="M8 58 h12 M8 64 h12 M8 70 h12 M8 76 h12 M8 82 h12 M8 88 h12 M8 94 h12 M8 100 h12 M8 106 h12" class="coil-wind ${c.state.burnt ? 'is-burnt' : on ? 'is-on' : ''}"/>`;
      if (c.state.burnt) s += smoke(16, 44);
      // Приставка: схемное обозначение контактов
      s += `<rect x="102" y="24" width="38" height="92" rx="3" class="aux-face"/>`;
      s += text(121, 36, 'ПКИ', 't-xxs t-strong');
      s += `<path d="M110 48 v10 M110 64 v10 M110 58 l6 -6" class="schem"/>`;
      s += `<path d="M132 48 v10 M132 64 v10 M132 64 l-6 -6 M132 58 h-6" class="schem"/>`;
      s += text(110, 86, 'НО', 't-xxs t-strong') + text(132, 86, 'НЗ', 't-xxs t-strong');
      s += `<circle cx="121" cy="102" r="5" class="${on ? 'lamp-live' : 'lamp-dead'}"/>`;
      s += `</g>`;
      return s;
    },
  };

  /* ---------- Тепловое реле ---------- */
  const TX = [18, 44, 70, 104, 130];
  const thermal = {
    title: 'Тепловое реле',
    group: 'Защита',
    prefix: 'KK',
    w: 146, h: 116,
    terms: [
      term('1L1', TX[0], 9, 'up', 'L1'), term('3L2', TX[1], 9, 'up', 'L2'), term('5L3', TX[2], 9, 'up', 'L3'), term('95', TX[3], 9, 'up'), term('97', TX[4], 9, 'up'),
      term('2T1', TX[0], 107, 'down', 'T1'), term('4T2', TX[1], 107, 'down', 'T2'), term('6T3', TX[2], 107, 'down', 'T3'), term('96', TX[3], 107, 'down'), term('98', TX[4], 107, 'down'),
    ],
    init: () => ({ tripped: false }),
    fixed: () => [['1L1', '2T1'], ['3L2', '4T2'], ['5L3', '6T3']],
    contacts: (c) => [
      { a: '95', b: '96', tag: 'nc', closed: !c.state.tripped },
      { a: '97', b: '98', tag: 'no', closed: !!c.state.tripped },
    ],
    tap(c, zone) {
      if (zone === 'test') c.state.tripped = true;
      if (zone === 'reset') c.state.tripped = false;
    },
    render(c) {
      const tr = c.state.tripped;
      let s = `<rect x="0" y="0" width="146" height="116" rx="5" fill="url(#g-grey)" class="dev-edge" filter="url(#f-shadow)"/>`;
      TX.forEach((x) => { s += terminalWell(x, 9, 20, 15) + terminalWell(x, 107, 20, 15); });
      s += `<rect x="5" y="20" width="136" height="76" rx="4" fill="url(#g-plastic-v)" class="front-edge"/>`;
      s += text(48, 31, 'РТИ-1308  2,5–4 А', 't-xxs t-strong');
      // Уставка тока: поворотный диск со шкалой
      s += `<circle cx="34" cy="62" r="20" class="dial-ring"/>`;
      s += `<circle cx="34" cy="62" r="16" fill="url(#g-dial)" class="dial-edge"/>`;
      for (let i = 0; i <= 6; i++) {
        const a = (-130 + i * (260 / 6)) * Math.PI / 180;
        s += `<path d="M${34 + Math.sin(a) * 17} ${62 - Math.cos(a) * 17} L${34 + Math.sin(a) * 20} ${62 - Math.cos(a) * 20}" class="tick"/>`;
      }
      s += `<path d="M34 62 L${34 + Math.sin(0.5) * 13} ${62 - Math.cos(0.5) * 13}" class="dial-ptr"/>`;
      s += `<rect x="31" y="51" width="6" height="22" rx="2" transform="rotate(28 34 62)" class="dial-slot"/>`;
      s += text(34, 92, '3,2 A', 't-xxs t-mute');
      // Флажок срабатывания
      s += `<rect x="62" y="40" width="24" height="12" rx="2" class="window"/>`;
      s += `<rect x="64" y="42" width="20" height="8" rx="1.5" class="${tr ? 'flag-red' : 'flag-green'}"/>`;
      s += text(74, 62, tr ? 'СРАБОТАЛО' : 'норма', tr ? 't-xxs t-bad t-strong' : 't-xxs t-mute');
      s += `<g data-zone="test" class="zone"><rect x="92" y="34" width="44" height="22" rx="4" class="btn-plate"/><circle cx="104" cy="45" r="7" fill="url(#g-btn-red)"/>${text(122, 48, 'Тест', 't-xxs t-strong')}</g>`;
      s += `<g data-zone="reset" class="zone"><rect x="92" y="60" width="44" height="22" rx="4" class="btn-plate"/><circle cx="104" cy="71" r="7" fill="url(#g-btn-blue)"/>${text(122, 74, 'Сброс', 't-xxs t-strong')}</g>`;
      s += text(114, 92, '95-96 НЗ', 't-xxs t-mute');
      return s;
    },
  };

  /* ---------- Асинхронный двигатель ---------- */
  function motor(windV) {
    const MX = [52, 92, 132];
    return {
      title: windV === 230 ? 'Двигатель 230/400 В Δ/Y' : 'Двигатель 400/690 В Δ/Y',
      group: 'Двигатели',
      prefix: 'M',
      w: 184, h: 214,
      windV,
      terms: [
        term('W2', MX[0], 148, 'up'), term('U2', MX[1], 148, 'up'), term('V2', MX[2], 148, 'up'),
        term('U1', MX[0], 186, 'down'), term('V1', MX[1], 186, 'down'), term('W1', MX[2], 186, 'down'),
        term('PE', 170, 186, 'down'),
      ],
      windings: [['U1', 'U2'], ['V1', 'V2'], ['W1', 'W2']],
      init: () => ({}),
      tap(c) { if (c.state.burnt) c.state.burnt = false; },
      render(c, st) {
        const mode = (st && st.mode) || 'stop';
        const burnt = c.state.burnt;
        const spin = mode === 'fwd' || mode === 'weak-fwd' ? 'spin-fwd' : mode === 'rev' || mode === 'weak-rev' ? 'spin-rev' : '';
        let s = `<g data-zone="body" class="zone ${mode === 'hum' ? 'hum' : ''}">`;
        // Лапы
        s += `<path d="M58 98 h84 l6 14 h-96 z" fill="url(#g-steel)" class="motor-edge"/>`;
        s += `<rect x="50" y="110" width="20" height="5" rx="1" class="foot"/><rect x="130" y="110" width="20" height="5" rx="1" class="foot"/>`;
        // Станина с продольными рёбрами охлаждения
        s += `<rect x="46" y="16" width="104" height="88" rx="10" fill="url(#g-motor)" class="motor-edge" filter="url(#f-shadow)"/>`;
        for (let i = 0; i < 9; i++) s += `<rect x="50" y="${21 + i * 9.4}" width="96" height="3" rx="1.5" class="fin"/>`;
        // Подшипниковый щит и вал
        s += `<rect x="148" y="24" width="12" height="72" rx="4" fill="url(#g-motor-end)" class="motor-edge"/>`;
        s += `<rect x="160" y="53" width="22" height="14" rx="2" fill="url(#g-shaft)" class="shaft-edge"/>`;
        s += `<rect x="170" y="56" width="10" height="3" class="keyway"/>`;
        // Шильдик
        s += `<rect x="92" y="34" width="54" height="40" rx="2" class="nameplate"/>`;
        s += text(119, 43, 'АИР 71 B4', 't-xxs t-strong');
        s += text(119, 52, windV === 230 ? '230/400 В  Δ/Y' : '400/690 В  Δ/Y', 't-xxs t-strong');
        s += text(119, 61, windV === 230 ? '0,75 кВт 1390' : '7,5 кВт 1450', 't-xxs');
        s += text(119, 70, 'IP55  50 Гц', 't-xxs');
        // Кожух вентилятора (торец) с решёткой, за ней крутится крыльчатка
        s += `<circle cx="46" cy="60" r="42" fill="url(#g-motor-end)" class="motor-edge"/>`;
        s += `<circle cx="46" cy="60" r="36" fill="url(#g-fan)"/>`;
        s += `<g transform="translate(46 60)"><g class="fan ${spin}">`;
        for (let i = 0; i < 6; i++) s += `<path d="M0 -4 C10 -10 22 -10 31 -4 L31 4 C22 2 10 4 0 4 Z" transform="rotate(${i * 60})" class="fan-blade"/>`;
        s += `<circle r="7" class="fan-hub"/></g></g>`;
        for (let r = 10; r <= 34; r += 6) s += `<circle cx="46" cy="60" r="${r}" class="grille"/>`;
        s += `<path d="M10 60 H82 M46 24 V96" class="grille"/>`;
        if (mode === 'fwd' || mode === 'rev' || mode.startsWith('weak')) {
          const rev = mode.endsWith('rev');
          s += `<path d="${rev ? 'M74 22 A46 46 0 0 0 18 22' : 'M18 22 A46 46 0 0 1 74 22'}" class="rot-arrow" marker-end="url(#arrowhead)"/>`;
        }
        if (burnt) s += `<rect x="46" y="16" width="104" height="88" rx="10" class="soot"/>` + smoke(110, 10) + smoke(70, 6);
        s += `</g>`;
        // Клеммная коробка со снятой крышкой: изоляционная плита и латунные шпильки
        s += `<rect x="26" y="124" width="132" height="84" rx="7" fill="url(#g-steel)" class="motor-edge" filter="url(#f-shadow)"/>`;
        s += `<rect x="32" y="130" width="120" height="72" rx="4" fill="url(#g-bakelite)" class="board-edge"/>`;
        MX.forEach((x) => {
          [148, 186].forEach((y) => {
            s += `<polygon points="${x - 9},${y} ${x - 4.5},${y - 8} ${x + 4.5},${y - 8} ${x + 9},${y} ${x + 4.5},${y + 8} ${x - 4.5},${y + 8}" fill="url(#g-nut)" class="nut-edge"/>`;
          });
        });
        s += `<rect x="158" y="164" width="24" height="42" rx="4" class="pe-boss"/>`;
        s += `<path d="M164 172 h12 M166 176 h8 M168 180 h4 M170 166 v6" class="pe-sign"/>`;
        let label = '';
        if (burnt) label = 'ОБМОТКИ СГОРЕЛИ';
        else if (mode === 'fwd') label = 'вращение вперёд';
        else if (mode === 'rev') label = 'вращение назад';
        else if (mode === 'hum') label = 'гудит, не крутится';
        else if (mode.startsWith('weak')) label = 'мало мощности';
        if (label) {
          const bad = mode === 'hum' || burnt;
          s += `<rect x="${92 - label.length * 2.6 - 8}" y="114" width="${label.length * 5.2 + 16}" height="13" rx="6.5" class="${bad ? 'badge-bad' : 'badge-ok'}"/>`;
          s += text(92, 123.5, label, 't-xxs t-inv t-strong');
        }
        return s;
      },
    };
  }

  const CATALOG = {
    supply1: supply(false),
    supply3: supply(true),
    breaker1: breaker(1),
    breaker2: breaker(2),
    breaker3: breaker(3),
    rcd,
    busN: bus('N', 6),
    busPE: bus('PE', 6),
    wago3: wago(3),
    wago5: wago(5),
    switch1,
    switch2,
    switchPass,
    lamp,
    socket,
    pilotG: pilot('g'),
    pilotR: pilot('r'),
    btnStart: button('start'),
    btnStop: button('stop'),
    contactor,
    thermal,
    motorY: motor(230),
    motorD: motor(400),
  };

  for (const k of Object.keys(CATALOG)) CATALOG[k].type = k;

  global.ET = global.ET || {};
  global.ET.CATALOG = CATALOG;
  global.ET.SVG_DEFS = SVG_DEFS;
  global.ET.def = (c) => CATALOG[c.type];
  global.ET.esc = esc;
})(window);
