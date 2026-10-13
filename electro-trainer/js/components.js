/* Каталог электрических компонентов: геометрия, клеммы, контакты, отрисовка. */
'use strict';

(function (global) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const text = (x, y, s, cls = 't-sm', anchor = 'middle') =>
    `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${esc(s)}</text>`;
  const term = (id, x, y, dir, label) => ({ id, x, y, dir, label: label == null ? id : label });

  /* ---------- Ввод питания ---------- */
  function supply(three) {
    const ids = three ? ['L1', 'L2', 'L3', 'N', 'PE'] : ['L', 'N', 'PE'];
    const step = three ? 44 : 44;
    const w = three ? 250 : 190;
    const terms = ids.map((id, i) => term(id, 26 + i * step, 88, 'down'));
    const label = { L: 'L1', L1: 'L1', L2: 'L2', L3: 'L3', N: 'N', PE: 'PE' };
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
        let s = `<rect class="dev dev-supply" x="0" y="0" width="${w}" height="100" rx="6"/>`;
        s += text(12, 20, three ? 'ВВОД 3~ 400 В' : 'ВВОД 1~ 230 В', 't-md t-dk', 'start');
        s += `<g data-zone="power" class="zone">`;
        s += `<rect x="${w - 70}" y="8" width="60" height="24" rx="12" class="pwr-switch ${on ? 'is-on' : ''}"/>`;
        s += `<circle cx="${on ? w - 22 : w - 58}" cy="20" r="9" class="pwr-knob"/>`;
        s += `</g>`;
        s += text(w - 40, 46, on ? 'ПОДАНО' : 'ОТКЛ', on ? 't-xs t-lit' : 't-xs t-dk', 'middle');
        if (c.state.fuse) s += text(12, 46, 'Предохранители сгорели', 't-xs t-badlit', 'start');
        ids.forEach((id, i) => {
          const x = 26 + i * step;
          const cls = id === 'N' ? 'pin-n' : id === 'PE' ? 'pin-pe' : 'pin-l';
          s += `<rect x="${x - 13}" y="58" width="26" height="40" rx="3" class="${cls}"/>`;
          s += text(x, 72, id === 'L' ? 'L' : id, 't-xs t-inv');
        });
        return s;
      },
    };
  }

  /* ---------- Модульный автомат ---------- */
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
        let s = `<rect class="dev" x="0" y="0" width="${w}" height="120" rx="4"/>`;
        for (let i = 0; i < poles; i++) {
          s += `<rect class="dev-screw" x="${4 + 36 * i}" y="2" width="28" height="16" rx="2"/>`;
          s += `<rect class="dev-screw" x="${4 + 36 * i}" y="102" width="28" height="16" rx="2"/>`;
        }
        s += `<g data-zone="lever" class="zone">`;
        s += `<rect class="dev-face" x="3" y="22" width="${w - 6}" height="76" rx="3"/>`;
        s += text(w / 2, 34, (c.params && c.params.rating) || 'C16', 't-sm t-strong');
        const lx = poles === 1 ? 9 : 8, lw = poles === 1 ? 18 : w - 16;
        s += `<rect class="lever-track" x="${lx - 2}" y="40" width="${lw + 4}" height="42" rx="3"/>`;
        s += `<rect class="lever ${c.state.tripped ? 'is-tripped' : ''}" x="${lx}" y="${on ? 42 : 62}" width="${lw}" height="18" rx="3"/>`;
        s += `<rect x="${w / 2 - 6}" y="86" width="12" height="7" rx="1" class="${on ? 'ind-on' : 'ind-off'}"/>`;
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
      let s = `<rect class="dev" x="0" y="0" width="72" height="120" rx="4"/>`;
      s += `<rect class="dev-screw" x="4" y="2" width="28" height="16" rx="2"/><rect class="dev-screw" x="40" y="2" width="28" height="16" rx="2"/>`;
      s += `<rect class="dev-screw" x="4" y="102" width="28" height="16" rx="2"/><rect class="dev-screw" x="40" y="102" width="28" height="16" rx="2"/>`;
      s += `<g data-zone="lever" class="zone">`;
      s += `<rect class="dev-face" x="3" y="22" width="66" height="76" rx="3"/>`;
      s += text(36, 33, 'УЗО 30мА', 't-xs t-strong');
      s += `<rect class="lever-track" x="10" y="40" width="22" height="42" rx="3"/>`;
      s += `<rect class="lever lever-rcd ${c.state.tripped ? 'is-tripped' : ''}" x="8" y="${on ? 42 : 60}" width="26" height="18" rx="3"/>`;
      s += `<rect x="15" y="86" width="12" height="7" rx="1" class="${on ? 'ind-on' : 'ind-off'}"/>`;
      s += `</g>`;
      s += `<g data-zone="test" class="zone"><circle cx="52" cy="60" r="11" class="btn-test"/>${text(52, 64, 'T', 't-sm t-inv')}</g>`;
      s += text(52, 88, 'тест', 't-xs');
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
        let s = `<rect class="${kind === 'N' ? 'bus-n' : 'bus-pe'}" x="0" y="4" width="${w}" height="22" rx="3"/>`;
        s += text(6, 30 + 10, kind, 't-xs t-strong', 'start');
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
        let s = `<rect class="wago" x="0" y="0" width="${w}" height="34" rx="4"/>`;
        for (let i = 0; i < n; i++) s += `<rect class="wago-lever" x="${6 + i * 16}" y="18" width="14" height="12" rx="2"/>`;
        return s;
      },
    };
  }

  /* ---------- Бытовые выключатели ---------- */
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
      let s = `<rect class="dev" x="0" y="0" width="70" height="84" rx="8"/>`;
      s += `<g data-zone="k1" class="zone"><rect class="key ${c.state.k1 ? 'is-on' : ''}" x="12" y="8" width="46" height="52" rx="5"/>`;
      s += `<rect class="key-mark" x="31" y="${c.state.k1 ? 14 : 46}" width="8" height="8" rx="1"/></g>`;
      return s;
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
      let s = `<rect class="dev" x="0" y="0" width="84" height="84" rx="8"/>`;
      ['k1', 'k2'].forEach((k, i) => {
        const x = 10 + i * 33;
        s += `<g data-zone="${k}" class="zone"><rect class="key ${c.state[k] ? 'is-on' : ''}" x="${x}" y="8" width="31" height="52" rx="4"/>`;
        s += `<rect class="key-mark" x="${x + 12}" y="${c.state[k] ? 14 : 46}" width="7" height="7" rx="1"/></g>`;
        s += text(x + 15.5, 70, i + 1, 't-xs');
      });
      return s;
    },
  };

  const switchPass = {
    title: 'Проходной выключатель',
    group: 'Освещение',
    prefix: 'SA',
    w: 84, h: 84,
    terms: [term('1', 16, 76, 'down'), term('L', 42, 76, 'down', 'L (общ.)'), term('2', 68, 76, 'down')],
    init: () => ({ pos: 0 }),
    contacts: (c) => [
      { a: 'L', b: '1', tag: 'a', closed: !c.state.pos },
      { a: 'L', b: '2', tag: 'b', closed: !!c.state.pos },
    ],
    tap(c) { c.state.pos = c.state.pos ? 0 : 1; },
    render(c) {
      let s = `<rect class="dev" x="0" y="0" width="84" height="84" rx="8"/>`;
      s += `<g data-zone="k1" class="zone"><rect class="key ${c.state.pos ? 'is-on' : ''}" x="14" y="8" width="56" height="52" rx="5"/>`;
      s += `<path d="M30 ${c.state.pos ? 40 : 26} L42 ${c.state.pos ? 26 : 40} L54 ${c.state.pos ? 40 : 26}" class="key-arrow"/></g>`;
      s += text(42, 68, c.state.pos ? 'L→2' : 'L→1', 't-xs');
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
      let s = `<rect class="dev dev-lamp" x="0" y="44" width="76" height="48" rx="6"/>`;
      if (on) s += `<circle cx="38" cy="30" r="34" class="glow"/>`;
      s += `<g data-zone="bulb" class="zone"><circle cx="38" cy="30" r="22" class="bulb ${on ? 'is-on' : ''} ${c.state.burnt ? 'is-burnt' : ''}"/>`;
      s += `<path d="M30 34 q4 -10 8 0 q4 -10 8 0" class="filament ${on ? 'is-on' : ''}"/>`;
      if (c.state.burnt) s += `<path d="M24 18 L34 30 L28 34 L44 46" class="crack"/>`;
      s += `</g>`;
      s += `<rect x="28" y="50" width="20" height="10" rx="2" class="lamp-base"/>`;
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
      let s = `<rect class="dev" x="0" y="0" width="76" height="92" rx="10"/>`;
      s += `<circle cx="38" cy="38" r="27" class="socket-face"/>`;
      s += `<circle cx="27" cy="38" r="4.5" class="socket-hole"/><circle cx="49" cy="38" r="4.5" class="socket-hole"/>`;
      s += `<rect x="34" y="11" width="8" height="6" rx="1" class="socket-pe ${st && st.pe ? 'is-ok' : ''}"/>`;
      s += `<rect x="34" y="59" width="8" height="6" rx="1" class="socket-pe ${st && st.pe ? 'is-ok' : ''}"/>`;
      s += `<circle cx="66" cy="10" r="4" class="${on ? 'led-on' : 'led-off'}"/>`;
      s += text(38, 76, on ? '~230 В' : '—', on ? 't-xs t-live' : 't-xs');
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
        let s = `<rect class="dev" x="0" y="0" width="48" height="66" rx="5"/>`;
        s += `<g data-zone="bulb" class="zone"><circle cx="24" cy="24" r="16" class="pilot pilot-${color} ${on ? 'is-on' : ''} ${c.state.burnt ? 'is-burnt' : ''}"/></g>`;
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
        let s = `<rect class="dev" x="0" y="0" width="56" height="84" rx="6"/>`;
        s += `<g data-zone="btn" class="zone"><circle cx="28" cy="30" r="22" class="btn-ring"/>`;
        s += `<circle cx="28" cy="30" r="${p ? 14 : 17}" class="${no ? 'btn-start' : 'btn-stop'}"/>`;
        s += text(28, 34, (c.params && c.params.caption) || (no ? 'I' : 'O'), 't-sm t-inv');
        s += `</g>`;
        s += text(28, 64, no ? 'НО' : 'НЗ', 't-xs');
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
      let s = `<rect class="dev" x="0" y="0" width="144" height="140" rx="5"/>`;
      KX.forEach((x) => {
        s += `<rect class="dev-screw" x="${x - 9}" y="2" width="18" height="15" rx="2"/>`;
        s += `<rect class="dev-screw" x="${x - 9}" y="123" width="18" height="15" rx="2"/>`;
      });
      s += `<g data-zone="body" class="zone"><rect class="dev-face" x="6" y="24" width="132" height="92" rx="4"/>`;
      s += `<rect x="42" y="36" width="60" height="30" rx="3" class="km-window"/>`;
      s += `<rect x="50" y="${on ? 54 : 42}" width="44" height="8" rx="2" class="${on ? 'ind-on' : 'km-arm'}"/>`;
      s += text(72, 84, c.state.burnt ? 'КАТУШКА СГОРЕЛА' : '230В~ AC-3', c.state.burnt ? 't-xs t-bad' : 't-xs');
      s += text(36, 104, 'НО 13-14', 't-xs');
      s += text(108, 104, 'НЗ 21-22', 't-xs');
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
      let s = `<rect class="dev" x="0" y="0" width="146" height="116" rx="5"/>`;
      TX.forEach((x) => {
        s += `<rect class="dev-screw" x="${x - 10}" y="2" width="20" height="15" rx="2"/>`;
        s += `<rect class="dev-screw" x="${x - 10}" y="99" width="20" height="15" rx="2"/>`;
      });
      s += `<rect class="dev-face" x="6" y="22" width="134" height="72" rx="4"/>`;
      s += text(44, 36, 'KK  2,5–4 А', 't-xs t-strong');
      s += `<rect x="20" y="46" width="48" height="16" rx="3" class="${tr ? 'flag-trip' : 'flag-ok'}"/>`;
      s += text(44, 58, tr ? 'СРАБОТАЛО' : 'норма', 't-xs t-inv');
      s += `<g data-zone="test" class="zone"><rect x="82" y="30" width="48" height="22" rx="4" class="btn-trip"/>${text(106, 45, 'Перегруз', 't-xs t-inv')}</g>`;
      s += `<g data-zone="reset" class="zone"><rect x="82" y="58" width="48" height="22" rx="4" class="btn-reset"/>${text(106, 73, 'Сброс', 't-xs t-inv')}</g>`;
      s += text(116, 90, '95-96 НЗ', 't-xs');
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
        const spin = mode === 'fwd' || mode === 'weak-fwd' ? 'spin-fwd' : mode === 'rev' || mode === 'weak-rev' ? 'spin-rev' : mode === 'hum' ? 'hum' : '';
        let s = `<g data-zone="body" class="zone">`;
        s += `<rect class="motor-body ${c.state.burnt ? 'is-burnt' : ''}" x="20" y="10" width="130" height="100" rx="14"/>`;
        for (let i = 0; i < 7; i++) s += `<rect class="motor-fin" x="${30 + i * 16}" y="6" width="8" height="108" rx="3"/>`;
        s += `<rect class="motor-shaft" x="150" y="52" width="26" height="14" rx="3"/>`;
        s += `<g transform="translate(85 60)"><g class="fan ${spin}">`;
        s += `<circle r="30" class="fan-disc"/>`;
        for (let i = 0; i < 4; i++) s += `<path d="M0 0 L26 -7 A27 27 0 0 1 26 7 Z" transform="rotate(${i * 90})" class="fan-blade"/>`;
        s += `<circle r="6" class="fan-hub"/></g></g>`;
        s += `<rect class="motor-plate" x="6" y="18" width="40" height="30" rx="2"/>`;
        s += text(26, 30, windV === 230 ? '230/400' : '400/690', 't-xxs t-strong');
        s += text(26, 42, 'Δ / Y', 't-xxs');
        if (mode === 'fwd' || mode === 'rev' || mode.startsWith('weak')) {
          s += `<path d="${mode.endsWith('rev') ? 'M120 30 A40 40 0 0 0 50 30' : 'M50 30 A40 40 0 0 1 120 30'}" class="rot-arrow" marker-end="url(#arrowhead)"/>`;
        }
        s += `</g>`;
        s += `<rect class="tbox" x="28" y="128" width="128" height="78" rx="6"/>`;
        s += `<rect class="tbox-pe" x="158" y="166" width="24" height="40" rx="4"/>`;
        s += text(92, 124, 'Клеммная коробка', 't-xxs t-plate');
        let label = '';
        if (c.state.burnt) label = 'ОБМОТКИ СГОРЕЛИ';
        else if (mode === 'fwd') label = '▶ вперёд';
        else if (mode === 'rev') label = '◀ назад';
        else if (mode === 'hum') label = 'гудит, не крутится';
        else if (mode.startsWith('weak')) label = 'слабо, мало мощности';
        if (label) s += text(85, 102, label, mode === 'hum' || c.state.burnt ? 't-xs t-badlit' : 't-xs t-lit');
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
  global.ET.def = (c) => CATALOG[c.type];
  global.ET.esc = esc;
})(window);
