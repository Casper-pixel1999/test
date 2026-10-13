/* Симулятор: сети по клеммам, КЗ и срабатывание автоматов, УЗО, контакторы, двигатели. */
'use strict';

(function (ET) {
  const PHASES = ['L1', 'L2', 'L3'];
  const key = (id, t) => id + '.' + t;
  const def = ET.def;

  class UF {
    constructor() { this.p = new Map(); }
    find(x) {
      if (!this.p.has(x)) this.p.set(x, x);
      let r = x;
      while (this.p.get(r) !== r) r = this.p.get(r);
      while (this.p.get(x) !== r) { const n = this.p.get(x); this.p.set(x, r); x = n; }
      return r;
    }
    union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(ra, rb); }
  }

  /* opts.all — все контакты замкнуты и все вводы считаются поданными (статический анализ ролей)
     opts.skip(c) — исключить контакты компонента (проверка «что если отключить») */
  function buildNets(board, opts = {}) {
    const uf = new UF();
    for (const c of board.comps) for (const t of def(c).terms) uf.find(key(c.id, t.id));
    for (const w of board.wires) uf.union(w.a, w.b);
    for (const c of board.comps) {
      const d = def(c);
      if (d.fixed) for (const [a, b] of d.fixed(c)) uf.union(key(c.id, a), key(c.id, b));
      if (d.contacts && !(opts.skip && opts.skip(c))) {
        for (const ct of d.contacts(c)) if (opts.all || ct.closed) uf.union(key(c.id, ct.a), key(c.id, ct.b));
      }
    }
    const labels = new Map();
    for (const c of board.comps) {
      const d = def(c);
      const src = opts.all ? d.roleSources : d.sources;
      if (!src) continue;
      for (const [t, lab] of src(c)) {
        const r = uf.find(key(c.id, t));
        if (!labels.has(r)) labels.set(r, new Set());
        labels.get(r).add(lab);
      }
    }
    const labelsOf = (k) => labels.get(uf.find(k)) || new Set();
    return {
      root: (k) => uf.find(k),
      labelsOf,
      labels,
      pot(k) {
        const s = labelsOf(k);
        for (const p of PHASES) if (s.has(p)) return p;
        if (s.has('N') || s.has('PE')) return '0';
        return null;
      },
    };
  }

  function shortRoots(net) {
    const out = [];
    for (const [r, s] of net.labels) {
      const ph = PHASES.filter((p) => s.has(p));
      const zero = s.has('N') || s.has('PE');
      if (ph.length > 1 || (ph.length && zero)) out.push({ root: r, labels: [...s] });
    }
    return out;
  }

  function volt(pa, pb) {
    if (!pa || !pb || pa === pb) return 0;
    if (pa === '0' || pb === '0') return 230;
    return 400;
  }

  function describeShort(sc, three) {
    const ph = sc.labels.filter((l) => PHASES.includes(l)).map((l) => (three ? l : 'L'));
    const z = sc.labels.filter((l) => l === 'N' || l === 'PE');
    return [...ph, ...z].join('–');
  }

  function ratingOf(c) {
    const m = String((c.params && c.params.rating) || (def(c).params && def(c).params.rating) || '100').match(/\d+/);
    return m ? +m[0] : 100;
  }

  function tripFor(board) {
    let best = null;
    for (const c of board.comps) {
      const d = def(c);
      if (!d.protective || !c.state.on) continue;
      const n2 = buildNets(board, { skip: (x) => x.id === c.id });
      if (shortRoots(n2).length) continue;
      if (!best || ratingOf(c) < ratingOf(best)) best = c;
    }
    return best;
  }

  function loadPairs(board) {
    const out = [];
    for (const c of board.comps) {
      const d = def(c);
      if (d.loads) for (const l of d.loads) out.push({ c, a: key(c.id, l.a), b: key(c.id, l.b), kind: l.kind });
    }
    return out;
  }

  function checkRcd(board, net) {
    const loads = loadPairs(board).filter((l) => !l.c.state.burnt && volt(net.pot(l.a), net.pot(l.b)) > 0);
    for (const r of board.comps) {
      if (!def(r).isRcd || !r.state.on) continue;
      const nr = buildNets(board, { skip: (x) => x.id === r.id });
      const keeps = (k, p) => {
        const s = nr.labelsOf(k);
        return p === '0' ? s.has('N') || s.has('PE') : s.has(p);
      };
      for (const l of loads) {
        const pa = net.pot(l.a), pb = net.pot(l.b);
        const ta = !keeps(l.a, pa), tb = !keeps(l.b, pb);
        if (ta !== tb) return { rcd: r, load: l.c };
      }
    }
    return null;
  }

  function motorStatus(c, net) {
    const d = def(c);
    if (c.state.burnt) return { mode: 'burnt' };
    const P = {};
    for (const t of ['U1', 'U2', 'V1', 'V2', 'W1', 'W2']) P[t] = { pot: net.pot(key(c.id, t)), root: net.root(key(c.id, t)) };
    const W = d.windings.map(([a, b]) => ({ a, b, pa: P[a].pot, pb: P[b].pot }));
    const isPh = (p) => p && p !== '0';
    let conn = null, vw = 0, order = null;

    // Треугольник: каждая обмотка между двумя разными фазами, все три фазы задействованы
    if (W.every((w) => isPh(w.pa) && isPh(w.pb) && w.pa !== w.pb)) {
      const used = new Set(W.flatMap((w) => [w.pa, w.pb]));
      if (used.size === 3) { conn = 'delta'; vw = 400; order = [P.U1.pot, P.V1.pot, P.W1.pot]; }
    }
    // Звезда: у каждой обмотки ровно один конец на фазе, вторые концы в одной общей точке
    if (!conn) {
      const ends = W.map((w) => {
        if (isPh(w.pa) && !isPh(w.pb)) return { ph: w.pa, star: P[w.b].root, starPot: w.pb };
        if (isPh(w.pb) && !isPh(w.pa)) return { ph: w.pb, star: P[w.a].root, starPot: w.pa };
        return null;
      });
      if (ends.every(Boolean)) {
        const phs = new Set(ends.map((e) => e.ph));
        const stars = new Set(ends.map((e) => e.star));
        if (phs.size === 3 && stars.size === 1) { conn = 'star'; vw = 230; order = ends.map((e) => e.ph); }
      }
    }
    const anyV = W.some((w) => volt(w.pa, w.pb) > 0) || W.some((w) => isPh(w.pa) || isPh(w.pb));
    if (!conn) return { mode: anyV ? 'hum' : 'stop', anyV };

    const idx = order.map((p) => PHASES.indexOf(p));
    const fwd = (idx[1] - idx[0] + 3) % 3 === 1 && (idx[2] - idx[1] + 3) % 3 === 1;
    if (vw > d.windV) return { mode: 'overvolt', conn, vw };
    if (vw < d.windV) return { mode: fwd ? 'weak-fwd' : 'weak-rev', conn, vw };
    return { mode: fwd ? 'fwd' : 'rev', conn, vw };
  }

  /* Главный расчёт. Меняет состояние платы (срабатывания, контакторы, сгорания). */
  function evaluate(board) {
    const faults = [];
    const three = board.comps.some((c) => c.type === 'supply3');
    let net = null;
    let stable = false;
    for (let iter = 0; iter < 40; iter++) {
      net = buildNets(board);
      const sc = shortRoots(net);
      if (sc.length) {
        const desc = describeShort(sc[0], three);
        const br = tripFor(board);
        if (br) {
          br.state.on = false; br.state.tripped = true;
          faults.push({ type: 'short', comp: br.id, msg: `Короткое замыкание ${desc}: отключился ${br.id}` });
        } else {
          for (const s of board.comps) if (def(s).sources && s.state.on) { s.state.on = false; s.state.fuse = true; }
          faults.push({ type: 'short', comp: null, msg: `Короткое замыкание ${desc} до защитного автомата! Сгорели предохранители на вводе` });
        }
        continue;
      }
      let changed = false;
      for (const c of board.comps) {
        if (c.type !== 'contactor') continue;
        const v = volt(net.pot(key(c.id, 'A1')), net.pot(key(c.id, 'A2')));
        if (v > 300 && !c.state.burnt) {
          c.state.burnt = true;
          faults.push({ type: 'burn', comp: c.id, msg: `На катушку ${c.id} подано 400 В вместо 230 В — катушка сгорела` });
        }
        const on = !c.state.burnt && v >= 150 && v <= 300;
        if (on !== !!c.state.on) { c.state.on = on; changed = true; }
      }
      if (changed) continue;
      const rt = checkRcd(board, net);
      if (rt) {
        rt.rcd.state.on = false; rt.rcd.state.tripped = true;
        faults.push({ type: 'rcd', comp: rt.rcd.id, msg: `Сработало УЗО ${rt.rcd.id}: ток ${rt.load.id} уходит мимо УЗО (фаза и ноль нагрузки должны оба идти через УЗО, ноль после УЗО нельзя соединять с нулём до него или с PE)` });
        continue;
      }
      stable = true;
      break;
    }
    if (!stable) faults.push({ type: 'osc', comp: null, msg: 'Схема «звонит»: контактор непрерывно включается и отключается' });

    const status = {};
    for (const c of board.comps) {
      const d = def(c);
      if (d.loads) {
        const l = d.loads[0];
        const v = volt(net.pot(key(c.id, l.a)), net.pot(key(c.id, l.b)));
        if (l.kind === 'lamp') {
          if (v > 300 && !c.state.burnt) { c.state.burnt = true; faults.push({ type: 'burn', comp: c.id, msg: `${c.id}: подано 400 В (между фазами) — лампа сгорела` }); }
          status[c.id] = { on: !c.state.burnt && v > 0 && v <= 300, v };
        } else if (l.kind === 'socket') {
          if (v > 300) faults.push({ type: 'burn', comp: c.id, msg: `${c.id}: в розетке 400 В! Подключённый прибор сгорит` });
          status[c.id] = { on: v > 0, v, pe: net.labelsOf(key(c.id, 'PE')).has('PE') };
        } else if (l.kind === 'coil') {
          status[c.id] = { on: !!c.state.on, v };
        }
      }
      if (d.windings) {
        const ms = motorStatus(c, net);
        if (ms.mode === 'overvolt') {
          c.state.burnt = true;
          faults.push({ type: 'burn', comp: c.id, msg: `${c.id}: обмотки на ${ms.vw} В вместо ${d.windV} В (${ms.conn === 'delta' ? 'треугольник' : 'звезда'}) — двигатель перегрелся и сгорел` });
          status[c.id] = { mode: 'burnt' };
        } else {
          if (ms.mode === 'hum') faults.push({ type: 'hum', comp: c.id, msg: `${c.id} гудит и не крутится: обмотки собраны не полностью или пропала фаза` });
          status[c.id] = ms;
        }
      }
    }
    return { net, faults, status, three };
  }

  /* Роли сетей для проверки цветов и PE: все контакты замкнуты, все вводы поданы. */
  function roles(board) {
    const net = buildNets(board, { all: true });
    return (k) => {
      const s = net.labelsOf(k);
      return { ph: PHASES.some((p) => s.has(p)), n: s.has('N'), pe: s.has('PE') };
    };
  }

  const COLOR_NAMES = { brown: 'коричневый', black: 'чёрный', grey: 'серый', blue: 'синий', yg: 'жёлто-зелёный' };

  function colorRemarks(board) {
    const role = roles(board);
    const out = [];
    for (const w of board.wires) {
      if (w.locked) continue;
      const r = role(w.a);
      const nm = `${w.a} – ${w.b}`;
      if (r.pe && !r.ph && !r.n && w.color !== 'yg') out.push(`${nm}: защитный проводник PE — только жёлто-зелёный (сейчас ${COLOR_NAMES[w.color]})`);
      else if (r.n && !r.ph && !r.pe && w.color !== 'blue') out.push(`${nm}: нулевой рабочий N — синий (сейчас ${COLOR_NAMES[w.color]})`);
      else if (r.ph && !r.n && !r.pe && (w.color === 'blue' || w.color === 'yg')) out.push(`${nm}: фазный провод не может быть ${COLOR_NAMES[w.color]} — берите коричневый, чёрный или серый`);
      else if (!r.ph && !r.n && !r.pe && w.color === 'yg') out.push(`${nm}: жёлто-зелёный используют только для PE`);
    }
    return out;
  }

  ET.sim = { evaluate, buildNets, roles, colorRemarks, volt, key, PHASES, COLOR_NAMES };
})(window.ET);
