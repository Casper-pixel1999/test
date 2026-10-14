/* Проверка симулятора и заданий: node tests/sim.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { window: {}, console };
vm.createContext(ctx);
for (const f of ['components.js', 'sim.js', 'labs.js', 'content.js', 'check.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const ET = ctx.window.ET;

function board(labId, extra) {
  const lab = ET.LABS.find((l) => l.id === labId);
  const comps = lab.comps.map((c) => ({ ...c, params: { ...(c.params || {}) }, state: ET.def(c).init ? ET.def(c).init() : {} }));
  const wires = (lab.wires || []).map((w) => ({ ...w }));
  for (const [a, b, color] of extra) wires.push({ a, b, color: color || 'brown' });
  return { lab, b: { comps, wires } };
}

let fails = 0;
function expectLab(name, labId, wires, wantOk, wantStars) {
  const { lab, b } = board(labId, wires);
  const r = ET.check.checkLab(b, lab, 0);
  const good = r.ok === wantOk && (wantStars == null || r.stars === wantStars);
  if (!good) {
    fails++;
    console.log(`FAIL ${name}: ok=${r.ok} stars=${r.stars}`);
    console.log(JSON.stringify(r, null, 1));
  } else {
    const why = r.scenarios.find((s) => !s.ok);
    console.log(`ok   ${name}${why ? '  → ' + why.msg : ''}`);
  }
}

const N = 'blue', PE = 'yg';

// 1. Лампа
const lamp = [['ВВОД.L', 'QF1.1'], ['QF1.2', 'SA1.L'], ['SA1.1', 'HL1.L'], ['ВВОД.N', 'HL1.N', N], ['ВВОД.PE', 'HL1.PE', PE]];
expectLab('lamp correct', 'lamp', lamp, true, 3);
expectLab('lamp switch in N', 'lamp', [['ВВОД.L', 'QF1.1'], ['QF1.2', 'HL1.L'], ['HL1.N', 'SA1.L', N], ['SA1.1', 'ВВОД.N', N], ['ВВОД.PE', 'HL1.PE', PE]], false);
expectLab('lamp no PE', 'lamp', lamp.slice(0, 4), false);
expectLab('lamp wrong colors', 'lamp', [...lamp.slice(0, 3), ['ВВОД.N', 'HL1.N', 'black'], ['ВВОД.PE', 'HL1.PE', PE]], true, 2);
expectLab('lamp short L-N', 'lamp', [...lamp, ['QF1.2', 'HL1.N']], false);

// 2. Розетки
const sock = [['ВВОД.L', 'QF1.1'], ['QF1.2', 'XS1.L'], ['ВВОД.N', 'XS1.N', N], ['ВВОД.PE', 'XS1.PE', PE], ['XS1.L', 'XS2.L'], ['XS1.N', 'XS2.N', N], ['XS1.PE', 'XS2.PE', PE]];
expectLab('sockets correct', 'sockets', sock, true, 3);
expectLab('sockets no PE on XS2', 'sockets', sock.slice(0, 6), false);

// 3. Двухклавишный
const sw2 = [['ВВОД.L', 'QF1.1'], ['QF1.2', 'SA1.L'], ['SA1.1', 'HL1.L'], ['SA1.2', 'HL2.L'], ['ВВОД.N', 'X1.t1', N], ['X1.t2', 'HL1.N', N], ['X1.t3', 'HL2.N', N], ['ВВОД.PE', 'X2.t1', PE], ['X2.t2', 'HL1.PE', PE], ['X2.t3', 'HL2.PE', PE]];
expectLab('switch2 correct', 'switch2', sw2, true, 3);
expectLab('switch2 swapped keys', 'switch2', [...sw2.slice(0, 2), ['SA1.2', 'HL1.L'], ['SA1.1', 'HL2.L'], ...sw2.slice(4)], false);

// 4. Проходные
const pass = [['ВВОД.L', 'QF1.1'], ['QF1.2', 'SA1.L'], ['SA1.1', 'SA2.1'], ['SA1.2', 'SA2.2'], ['SA2.L', 'HL1.L'], ['ВВОД.N', 'HL1.N', N], ['ВВОД.PE', 'HL1.PE', PE]];
expectLab('pass correct', 'pass', pass, true, 3);
expectLab('pass one switch only', 'pass', [['ВВОД.L', 'QF1.1'], ['QF1.2', 'SA1.L'], ['SA1.1', 'HL1.L'], ['ВВОД.N', 'HL1.N', N], ['ВВОД.PE', 'HL1.PE', PE]], false);

// 5. Щиток
const panel = [
  ['ВВОД.L', 'QF0.1'], ['ВВОД.N', 'QF0.3', N], ['QF0.2', 'QD1.1'], ['QF0.4', 'QD1.N', N],
  ['QD1.2', 'QF1.1'], ['QF1.1', 'QF2.1'], ['QD1.N2', 'XN.t1', N], ['ВВОД.PE', 'XPE.t1', PE],
  ['QF1.2', 'XS1.L'], ['XN.t2', 'XS1.N', N], ['XPE.t2', 'XS1.PE', PE],
  ['QF2.2', 'SA1.L'], ['SA1.1', 'HL1.L'], ['XN.t3', 'HL1.N', N], ['XPE.t3', 'HL1.PE', PE],
];
expectLab('panel correct', 'panel', panel, true, 3);
expectLab('panel N before RCD', 'panel', panel.map((w) => (w[0] === 'XN.t3' ? ['ВВОД.N', 'HL1.N', N] : w)), false);
expectLab('panel N-PE bridged after RCD', 'panel', [...panel, ['XN.t4', 'XPE.t4', N]], false);
expectLab('panel socket bypasses RCD', 'panel', panel.map((w) => (w[0] === 'QD1.2' ? ['QF0.2', 'QF1.1'] : w)), false);

// 6. Звезда
const star = [['ВВОД.L1', 'QF1.1'], ['ВВОД.L2', 'QF1.3', 'black'], ['ВВОД.L3', 'QF1.5', 'grey'], ['QF1.2', 'M1.U1'], ['QF1.4', 'M1.V1', 'black'], ['QF1.6', 'M1.W1', 'grey'], ['M1.W2', 'M1.U2', 'black'], ['M1.U2', 'M1.V2', 'black'], ['ВВОД.PE', 'M1.PE', PE]];
expectLab('star correct', 'star', star, true, 3);
expectLab('star reversed', 'star', star.map((w) => (w[1] === 'M1.U1' ? ['QF1.2', 'M1.V1'] : w[1] === 'M1.V1' ? ['QF1.4', 'M1.U1', 'black'] : w)), false);
expectLab('star as delta (burns)', 'star', [...star.slice(0, 6), ['M1.U1', 'M1.W2', 'black'], ['M1.V1', 'M1.U2', 'black'], ['M1.W1', 'M1.V2', 'black'], ['ВВОД.PE', 'M1.PE', PE]], false);
expectLab('star missing jumper (hum)', 'star', star.filter((w) => w[1] !== 'M1.V2'), false);

// 7. Треугольник
const delta = [...star.slice(0, 6), ['M1.U1', 'M1.W2', 'black'], ['M1.V1', 'M1.U2', 'black'], ['M1.W1', 'M1.V2', 'black'], ['ВВОД.PE', 'M1.PE', PE]];
expectLab('delta correct', 'delta', delta, true, 3);
expectLab('delta made as star (weak)', 'delta', star, false);

// 8. Прямой пуск
const dolPower = [
  ['ВВОД.L1', 'QF1.1'], ['ВВОД.L2', 'QF1.3', 'black'], ['ВВОД.L3', 'QF1.5', 'grey'],
  ['QF1.2', 'KM1.1L1'], ['QF1.4', 'KM1.3L2', 'black'], ['QF1.6', 'KM1.5L3', 'grey'],
  ['KM1.2T1', 'KK1.1L1'], ['KM1.4T2', 'KK1.3L2', 'black'], ['KM1.6T3', 'KK1.5L3', 'grey'],
  ['KK1.2T1', 'M1.U1'], ['KK1.4T2', 'M1.V1', 'black'], ['KK1.6T3', 'M1.W1', 'grey'],
];
const dolCtl = [
  ['ВВОД.L1', 'SF1.1'], ['SF1.2', 'KK1.95'], ['KK1.96', 'SB1.11'], ['SB1.12', 'SB2.13'], ['SB2.14', 'KM1.A1'],
  ['SB2.13', 'KM1.13'], ['KM1.14', 'KM1.A1'], ['KM1.A2', 'ВВОД.N', N],
];
expectLab('dol correct', 'dol', [...dolPower, ...dolCtl], true, 3);
expectLab('dol no self-hold', 'dol', [...dolPower, ...dolCtl.filter((w) => w[0] !== 'SB2.13' && w[0] !== 'KM1.14')], false);
expectLab('dol thermal not in circuit', 'dol', [...dolPower, ...dolCtl.map((w) => (w[0] === 'SF1.2' ? ['SF1.2', 'SB1.11'] : w)).filter((w) => w[0] !== 'KK1.96')], false);
expectLab('dol self-hold bypasses stop', 'dol', [...dolPower, ...dolCtl.map((w) => (w[0] === 'SB2.13' ? ['SF1.2', 'KM1.13'] : w))], false);
expectLab('dol coil on 400V', 'dol', [...dolPower, ...dolCtl.map((w) => (w[0] === 'KM1.A2' ? ['KM1.A2', 'ВВОД.L2', 'black'] : w))], false);

// 9. Реверс
const revPower = [['KM2.2T1', 'M1.W1'], ['KM2.4T2', 'M1.V1', 'black'], ['KM2.6T3', 'M1.U1', 'grey']];
const revCtl = [
  ['ВВОД.L1', 'SF1.1'], ['SF1.2', 'SB1.11'],
  ['SB1.12', 'SB2.13'], ['SB2.13', 'SB3.13'], ['SB2.13', 'KM1.13'], ['SB3.13', 'KM2.13'],
  ['SB2.14', 'KM1.14'], ['KM1.14', 'KM2.21'], ['KM2.22', 'KM1.A1'],
  ['SB3.14', 'KM2.14'], ['KM2.14', 'KM1.21'], ['KM1.22', 'KM2.A1'],
  ['KM1.A2', 'ВВОД.N', N], ['KM2.A2', 'ВВОД.N', N],
];
expectLab('reverse correct', 'reverse', [...revPower, ...revCtl], true, 3);
const noLock = [
  ['ВВОД.L1', 'SF1.1'], ['SF1.2', 'SB1.11'],
  ['SB1.12', 'SB2.13'], ['SB2.13', 'SB3.13'], ['SB2.13', 'KM1.13'], ['SB3.13', 'KM2.13'],
  ['SB2.14', 'KM1.14'], ['KM1.14', 'KM1.A1'],
  ['SB3.14', 'KM2.14'], ['KM2.14', 'KM2.A1'],
  ['KM1.A2', 'ВВОД.N', N], ['KM2.A2', 'ВВОД.N', N],
];
expectLab('reverse without interlock', 'reverse', [...revPower, ...noLock], false);
expectLab('reverse KM2 no phase swap', 'reverse', [['KM2.2T1', 'M1.U1'], ['KM2.4T2', 'M1.V1', 'black'], ['KM2.6T3', 'M1.W1', 'grey'], ...revCtl], false);

// 10. Звезда-треугольник
const sdCtl = [
  ['ВВОД.L1', 'SF1.1'], ['SF1.2', 'SB1.11'], ['SB1.12', 'SB2.13'], ['SB2.14', 'KM1.A1'], ['SB2.13', 'KM1.13'], ['KM1.14', 'KM1.A1'],
  ['KM1.A1', 'KT1.A1'], ['KT1.A1', 'KT1.15'],
  ['KT1.16', 'KM3.21'], ['KM3.22', 'KM2.A1'],
  ['KT1.18', 'KM2.21'], ['KM2.22', 'KM3.A1'],
  ['KM1.A2', 'ВВОД.N', N], ['KT1.A2', 'KM1.A2', N], ['KM2.A2', 'KT1.A2', N], ['KM3.A2', 'KM2.A2', N],
];
expectLab('stardelta correct', 'stardelta', sdCtl, true, 3);
expectLab('stardelta alt wiring', 'stardelta', sdCtl.map((w) => (w[0] === 'KT1.16' ? ['KT1.16', 'KM2.A1'] : w[0] === 'KT1.18' ? ['KT1.18', 'KM3.A1'] : w)).filter((w) => !['KM3.22', 'KM2.22'].includes(w[0])).concat([['KT1.15', 'KM2.21'], ['KM2.22', 'KM3.21']]), true);
expectLab('stardelta timer not wired', 'stardelta', sdCtl.filter((w) => w[1] !== 'KT1.A1'), false);
expectLab('stardelta stays in star', 'stardelta', sdCtl.filter((w) => w[0] !== 'KT1.18'), false);

// Поиск неисправностей: в исходном виде задание не проходит, после ремонта — проходит
function faultCase(id, fix) {
  const lab = ET.LABS.find((l) => l.id === id);
  const mk = () => ({ comps: lab.comps.map((c) => ({ ...c, params: { ...(c.params || {}) }, state: ET.def(c).init ? ET.def(c).init() : {} })), wires: lab.wires.map((w) => ({ ...w })) });
  const before = ET.check.checkLab(mk(), lab, 0);
  const b = mk();
  fix(b);
  const after = ET.check.checkLab(b, lab, 0);
  const ok = !before.ok && after.ok;
  console.log(`${ok ? 'ok  ' : 'FAIL'} fault ${id}: before → ${(before.scenarios.find((x) => !x.ok) || {}).msg}`);
  if (!ok) { fails++; console.log(JSON.stringify(after, null, 1)); }
}
const replace = (b, a, bb, na, nb, color) => { b.wires = b.wires.filter((w) => !(w.a === a && w.b === bb)); if (na) b.wires.push({ a: na, b: nb, color }); };
faultCase('f-lamp', (b) => replace(b, 'SA1.1', 'HL1.L', 'SA1.1', 'HL1.L', 'brown'));
faultCase('f-socket', (b) => replace(b, 'XS1.N', 'XS2.N', 'XS1.N', 'XS2.N', 'blue'));
faultCase('f-rcd', (b) => replace(b, 'ВВОД.N', 'HL1.N', 'XN.t3', 'HL1.N', 'blue'));
faultCase('f-phase', (b) => replace(b, 'KK1.4T2', 'M1.V1', 'KK1.4T2', 'M1.V1', 'black'));
faultCase('f-chatter', (b) => { replace(b, 'SB2.13', 'KM1.21', 'SB2.13', 'KM1.13', 'brown'); replace(b, 'KM1.22', 'KM1.A1', 'KM1.14', 'KM1.A1', 'brown'); });
faultCase('f-reverse', (b) => { replace(b, 'KM2.2T1', 'M1.U1', 'KM2.2T1', 'M1.W1', 'brown'); replace(b, 'KM2.6T3', 'M1.W1', 'KM2.6T3', 'M1.U1', 'grey'); });

// Короткое замыкание до автомата
{
  const { b } = board('lamp', [['ВВОД.L', 'ВВОД.N']]);
  b.comps[0].state.on = true;
  const r = ET.sim.evaluate(b);
  const ok = r.faults.some((f) => f.type === 'short' && /до защитного/.test(f.msg)) && !b.comps[0].state.on;
  console.log(`${ok ? 'ok  ' : 'FAIL'} short before breaker blows supply fuses`);
  if (!ok) fails++;
}

console.log(fails ? `\n${fails} FAILED` : '\nAll passed');
process.exit(fails ? 1 : 0);
