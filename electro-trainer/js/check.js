/* Проверка задания: прогон сценариев на копии платы, PE, цвета проводов. */
'use strict';

(function (ET) {
  const { evaluate, roles, colorRemarks, key } = ET.sim;
  const def = ET.def;
  const HARD = new Set(['short', 'rcd', 'burn', 'osc']);

  function prepare(board, lab) {
    const b = JSON.parse(JSON.stringify(board));
    b.now = 0;
    for (const c of b.comps) {
      const d = def(c);
      c.state = d.init ? d.init() : {};
      if (d.sources || d.protective || d.isRcd) c.state.on = true;
    }
    if (lab && lab.initial) for (const [id, st] of Object.entries(lab.initial)) Object.assign(b.comps.find((c) => c.id === id).state, st);
    return b;
  }

  function hasPhase(r, c) {
    return def(c).terms.some((t) => { const p = r.net.pot(key(c.id, t.id)); return p && p !== '0'; });
  }

  const MOTOR_TEXT = {
    stop: 'двигатель стоит',
    fwd: 'вращается вперёд',
    rev: 'вращается назад',
    hum: 'гудит, но не крутится (схема обмоток не собрана или пропала фаза)',
    burnt: 'двигатель сгорел',
  };

  function actualText(c, st, r) {
    if (def(c).windings) {
      if (st.mode && st.mode.startsWith('weak')) return `крутится без мощности: на обмотках ${st.vw} В вместо ${def(c).windV} В`;
      return MOTOR_TEXT[st.mode] || st.mode;
    }
    if (c.state.burnt) return 'сгорела';
    if (st.on) return c.type === 'socket' ? 'есть 230 В' : 'горит';
    if (c.type === 'socket') return hasPhase(r, c) ? 'фаза на розетке есть, но напряжения L–N нет (разорван ноль)' : 'нет напряжения';
    return hasPhase(r, c) ? 'не горит, но на клеммах есть фаза' : 'не горит';
  }

  function runScenario(board, lab, sc) {
    const b = prepare(board, lab);
    const byId = (id) => b.comps.find((c) => c.id === id);
    const mark = {}, phaseWhenOff = {};
    let r;
    const track = () => {
      for (const c of b.comps) {
        const st = r.status[c.id];
        if (st && 'on' in st && !st.on && def(c).loads && def(c).loads[0].kind === 'lamp' && hasPhase(r, c)) phaseWhenOff[c.id] = true;
      }
      return r.faults.find((x) => HARD.has(x.type)) || null;
    };
    r = evaluate(b);
    let fault = track();
    if (fault) return { ok: false, msg: `При подаче питания: ${fault.msg}`, comp: fault.comp };
    for (const step of sc.steps) {
      const [op, id, arg, msg] = step;
      const c = byId(id);
      if (op === 'expect') {
        const st = r.status[id] || {};
        let ok = true;
        if (def(c).windings) {
          const m = st.mode || 'stop';
          ok = arg.split('|').some((w) => (w === 'run' ? m === 'fwd' || m === 'rev' : m === w));
        } else if (arg === 'on') ok = !!st.on;
        else if (arg === 'off') ok = !st.on;
        else if (arg === 'dead') ok = !st.on && !hasPhase(r, c);
        else if (arg === 'mark') { mark[id] = !!st.on; continue; }
        else if (arg === 'toggled') { ok = !!st.on !== mark[id]; mark[id] = !!st.on; }
        else if (arg === 'offIsDead') ok = !phaseWhenOff[id];
        if (!ok) return { ok: false, msg: `${msg}. Сейчас ${id}: ${actualText(c, st, r)}.`, comp: id };
        continue;
      }
      if (op === 'set') Object.assign(c.state, arg);
      else if (op === 'press') c.state.pressed = true;
      else if (op === 'release') c.state.pressed = false;
      else if (op === 'test') def(c).tap(c, 'test');
      else if (op === 'wait') b.now += ET.sim.timerDelay(c) + 0.01;
      r = evaluate(b);
      fault = track();
      if (fault) {
        const what = op === 'wait' ? `после выдержки ${id}` : op === 'press' ? `при нажатии ${id}` : op === 'release' ? `при отпускании ${id}` : op === 'test' ? `при нажатии «Тест» ${id}` : `при переключении ${id}`;
        return { ok: false, msg: `Авария ${what}: ${fault.msg}`, comp: fault.comp };
      }
    }
    return { ok: true };
  }

  function checkLab(board, lab, liveWork) {
    const res = { scenarios: [], pe: [], remarks: [], ok: true, stars: 0 };
    const userWires = board.wires.filter((w) => !w.locked).length;
    if (!userWires) {
      res.ok = false;
      res.scenarios.push({ name: 'Монтаж', ok: false, msg: 'Не проложено ни одного провода. Нажмите на клемму, затем на другую, чтобы соединить их.' });
      return res;
    }
    for (const sc of lab.scenarios) {
      const r = runScenario(board, lab, sc);
      res.scenarios.push({ name: sc.name, ...r });
      if (!r.ok) res.ok = false;
    }
    const role = roles(board);
    for (const t of lab.pe || []) {
      const ok = role(t).pe;
      res.pe.push({ term: t, ok });
      if (!ok) res.ok = false;
    }
    res.remarks = colorRemarks(board);
    if (liveWork) res.remarks.push(`Монтаж под напряжением (${liveWork} раз). Сначала отключайте ввод, потом подключайте провода.`);
    if (res.ok) {
      res.stars = 3;
      if (colorRemarks(board).length) res.stars--;
      if (liveWork) res.stars--;
      res.stars = Math.max(1, res.stars);
    }
    return res;
  }

  ET.check = { checkLab };
})(window.ET);
