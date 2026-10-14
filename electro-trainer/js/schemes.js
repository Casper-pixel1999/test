/* Принципиальные электрические схемы заданий (условные обозначения по ГОСТ 2.755, 2.756, 2.722). */
'use strict';

(function (ET) {
  const esc = ET.esc;
  const ln = (x1, y1, x2, y2, cls = '') => `<path d="M${x1} ${y1} L${x2} ${y2}"${cls ? ` class="${cls}"` : ''}/>`;
  const pl = (pts, cls = '') => `<path d="M${pts.map((p) => p.join(' ')).join(' L')}"${cls ? ` class="${cls}"` : ''}/>`;
  const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="2.2" class="sc-dot"/>`;
  const t = (x, y, s, a = 'start', cls = 'sc-t') => `<text x="${x}" y="${y}" text-anchor="${a}" class="${cls}">${esc(s)}</text>`;

  /* Контакты рисуются вертикально, сверху вниз, высота 30 */
  const no = (x, y, lab) => ln(x, y, x, y + 8) + ln(x, y + 22, x - 8, y + 9) + ln(x, y + 22, x, y + 30) + (lab ? t(x + 6, y + 19, lab) : '');
  const nc = (x, y, lab) => ln(x, y, x, y + 8) + ln(x, y + 8, x + 7, y + 8) + ln(x, y + 22, x + 8, y + 6) + ln(x, y + 22, x, y + 30) + (lab ? t(x + 11, y + 19, lab) : '');
  // Автоматический выключатель: контакт с крестиком на неподвижном контакте
  const qf = (x, y, lab) => no(x, y, '') + ln(x - 3, y + 5, x + 3, y + 11) + ln(x + 3, y + 5, x - 3, y + 11) + (lab ? t(x + 6, y + 19, lab) : '');
  // Кнопка: контакт + привод нажатием
  const push = (x, y) => ln(x - 4, y + 15.5, x - 15, y + 15.5, 'sc-dash') + ln(x - 15, y + 11, x - 15, y + 20) + ln(x - 15, y + 11, x - 18, y + 11) + ln(x - 15, y + 20, x - 18, y + 20);
  const btnNo = (x, y, lab) => no(x, y, lab) + push(x, y);
  const btnNc = (x, y, lab) => nc(x, y, lab) + ln(x + 4, y + 14, x - 12, y + 14, 'sc-dash') + ln(x - 12, y + 10, x - 12, y + 19) + ln(x - 12, y + 10, x - 15, y + 10) + ln(x - 12, y + 19, x - 15, y + 19);
  // Контакты с выдержкой времени при срабатывании («парашют»)
  const tNo = (x, y, lab) => no(x, y, lab) + `<path d="M${x - 4} ${y + 15.5} h-9 m0 -4 a4 4 0 0 0 0 8" class="sc-thin"/>`;
  const tNc = (x, y, lab) => nc(x, y, lab) + `<path d="M${x + 4} ${y + 14} h-10 m0 -4 a4 4 0 0 0 0 8" class="sc-thin"/>`;
  // Катушка: прямоугольник 18×12, высота 24
  const coil = (x, y, lab, timer) => ln(x, y, x, y + 6) + `<rect x="${x - 9}" y="${y + 6}" width="18" height="12" class="sc-box"/>` + (timer ? `<rect x="${x - 9}" y="${y + 6}" width="5" height="12" class="sc-fill"/>` : '') + ln(x, y + 18, x, y + 24) + (lab ? t(x + 12, y + 15, lab) : '');
  const lamp = (x, y, lab) => ln(x, y, x, y + 6) + `<circle cx="${x}" cy="${y + 13}" r="7" class="sc-box"/>` + ln(x - 5, y + 8, x + 5, y + 18) + ln(x + 5, y + 8, x - 5, y + 18) + ln(x, y + 20, x, y + 26) + (lab ? t(x + 10, y + 5, lab) : '');
  const socket = (x, y, lab) => ln(x, y, x, y + 8) + `<path d="M${x - 9} ${y + 8} a9 9 0 0 0 18 0 Z" class="sc-box"/>` + ln(x, y + 17, x, y + 26) + (lab ? t(x + 12, y + 5, lab) : '');
  const heater = (x, y) => ln(x, y, x, y + 4) + `<rect x="${x - 5}" y="${y + 4}" width="10" height="16" class="sc-box"/><path d="M${x} ${y + 4} v5 h-3 v6 h3 v5" class="sc-thin"/>` + ln(x, y + 20, x, y + 26);
  const motor = (x, y, lab, conn) => `<circle cx="${x}" cy="${y}" r="17" class="sc-box"/>` + t(x, y + 1, 'M', 'middle', 'sc-tb') + t(x, y + 10, '3~', 'middle', 'sc-ts') + (lab ? t(x + 21, y - 8, lab) : '') + (conn ? t(x + 21, y + 5, conn, 'start', 'sc-ts') : '');
  const link = (x1, x2, y) => ln(x1, y, x2, y, 'sc-dash');
  const pe = (x1, y1, x2, y2) => pl([[x1, y1], [x2, y1], [x2, y2]], 'sc-pe');
  const rail = (y, x1, x2, lab, cls = '') => ln(x1, y, x2, y, cls) + t(x1 - 4, y + 3, lab, 'end', 'sc-tb');
  const svg = (w, h, body) => `<svg viewBox="-24 -6 ${w + 30} ${h + 12}" class="scheme" role="img" aria-label="Принципиальная схема">${body}</svg>`;

  /* Однофазные ветви: верхняя шина L, нижняя N, под ней PE пунктиром */
  function oneLine(w, h, body) {
    return svg(w, h, rail(10, 10, w, 'L') + rail(h - 22, 10, w, 'N') + rail(h - 8, 10, w, 'PE', 'sc-pe') + body);
  }

  const SCHEMES = {};

  SCHEMES.lamp = oneLine(200, 180,
    dot(70, 10) + qf(70, 10, 'QF1') + no(70, 40, 'SA1') + lamp(70, 70, 'HL1') + ln(70, 96, 70, 158) + dot(70, 158) +
    pe(77, 83, 120, 172) + dot(120, 172) + t(126, 120, 'корпус HL1 → PE', 'start', 'sc-ts'));

  SCHEMES.switch2 = oneLine(240, 190,
    dot(60, 10) + qf(60, 10, 'QF1') + ln(60, 40, 60, 48) + dot(60, 48) + ln(60, 48, 150, 48) +
    no(60, 48, 'SA1.1') + no(150, 48, 'SA1.2') + lamp(60, 78, 'HL1') + lamp(150, 78, 'HL2') +
    ln(60, 104, 60, 168) + ln(150, 104, 150, 168) + dot(60, 168) + dot(150, 168) +
    pe(67, 91, 100, 182) + pe(157, 91, 200, 182) + dot(100, 182) + dot(200, 182));

  // Проходные выключатели: два переключающих контакта, перекидные провода между ними
  const changeTop = (x, y, pos, lab) => ln(x, y, x, y + 8) + ln(x, y + 8, x + (pos ? 12 : -12), y + 24) + ln(x - 15, y + 26, x - 15, y + 34) + ln(x + 15, y + 26, x + 15, y + 34) + `<circle cx="${x - 15}" cy="${y + 26}" r="1.6" class="sc-dot"/><circle cx="${x + 15}" cy="${y + 26}" r="1.6" class="sc-dot"/>` + t(x + 20, y + 12, lab);
  const changeBot = (x, y, lab) => ln(x - 15, y, x - 15, y + 8) + ln(x + 15, y, x + 15, y + 8) + `<circle cx="${x - 15}" cy="${y + 8}" r="1.6" class="sc-dot"/><circle cx="${x + 15}" cy="${y + 8}" r="1.6" class="sc-dot"/>` + ln(x, y + 26, x - 12, y + 10) + ln(x, y + 26, x, y + 34) + t(x + 20, y + 24, lab);
  SCHEMES.pass = oneLine(220, 210,
    dot(80, 10) + qf(80, 10, 'QF1') + changeTop(80, 40, 0, 'SA1') + ln(65, 74, 65, 96) + ln(95, 74, 95, 96) + t(100, 88, 'перекидные', 'start', 'sc-ts') +
    changeBot(80, 96, 'SA2') + lamp(80, 130, 'HL1') + ln(80, 156, 80, 188) + dot(80, 188) + pe(87, 143, 140, 202) + dot(140, 202));

  SCHEMES.sockets = oneLine(240, 160,
    dot(60, 10) + qf(60, 10, 'QF1') + ln(60, 40, 60, 60) + dot(60, 60) + ln(60, 60, 160, 60) + socket(60, 60, 'XS1') + socket(160, 60, 'XS2') +
    ln(60, 86, 60, 138) + ln(160, 86, 160, 138) + dot(60, 138) + dot(160, 138) +
    pe(69, 73, 100, 152) + pe(169, 73, 200, 152) + dot(100, 152) + dot(200, 152));

  SCHEMES.panel = svg(300, 280,
    t(40, 4, 'L', 'middle', 'sc-tb') + t(70, 4, 'N', 'middle', 'sc-tb') + t(250, 4, 'PE', 'middle', 'sc-tb') +
    ln(40, 8, 40, 14) + ln(70, 8, 70, 14) + qf(40, 14, '') + qf(70, 14, 'QF0') + link(32, 62, 30) +
    no(40, 52, '') + no(70, 52, '') + link(32, 66, 68) + `<ellipse cx="55" cy="${80}" rx="22" ry="5" class="sc-box"/>` + t(80, 64, 'QD1 30 мА') +
    ln(40, 44, 40, 52) + ln(70, 44, 70, 52) +
    ln(40, 82, 40, 100) + dot(40, 100) + ln(40, 100, 150, 100) +
    qf(40, 100, 'QF1') + qf(150, 100, 'QF2') + socket(40, 140, 'XS1') + ln(40, 130, 40, 140) + no(150, 130, 'SA1') + lamp(150, 160, 'HL1') +
    ln(70, 82, 70, 236) + dot(70, 236) + rail(236, 40, 220, '', 'sc-bus') + t(225, 239, 'шина N после УЗО', 'start', 'sc-ts') +
    ln(40, 166, 40, 236) + ln(150, 186, 150, 236) + dot(40, 236) + dot(150, 236) +
    ln(250, 8, 250, 258, 'sc-pe') + rail(258, 30, 250, '', 'sc-pe') + t(30, 270, 'шина PE', 'start', 'sc-ts') +
    pe(49, 153, 60, 258) + pe(157, 173, 190, 258) + dot(60, 258) + dot(190, 258));

  /* Трёхфазные силовые цепи */
  function threeQf(xs, y, lab) { return xs.map((x, i) => qf(x, y, i === xs.length - 1 ? lab : '')).join('') + link(xs[0] - 6, xs[xs.length - 1], y + 16); }
  function threeNo(xs, y, lab) { return xs.map((x, i) => no(x, y, i === xs.length - 1 ? lab : '')).join('') + link(xs[0] - 6, xs[xs.length - 1], y + 16); }
  const phases = (xs, y) => ['L1', 'L2', 'L3'].map((p, i) => t(xs[i], y, p, 'middle', 'sc-tb')).join('');
  const winding = (cx, cy, conn) => conn === 'Y'
    ? `<path d="M${cx} ${cy} v-10 M${cx} ${cy} l-9 6 M${cx} ${cy} l9 6" class="sc-thin"/>`
    : `<path d="M${cx} ${cy - 10} L${cx - 9} ${cy + 6} L${cx + 9} ${cy + 6} Z" class="sc-thin"/>`;

  function motorOnly(conn, note) {
    const xs = [40, 60, 80];
    return svg(220, 190,
      phases(xs, 4) + xs.map((x) => ln(x, 8, x, 14)).join('') + threeQf(xs, 14, 'QF1') +
      xs.map((x) => ln(x, 44, x, 92)).join('') + pl([[40, 92], [48, 108]]) + pl([[80, 92], [72, 108]]) + ln(60, 92, 60, 104) +
      motor(60, 122, 'M1', conn === 'Y' ? 'звезда' : 'треугольник') + winding(150, 122, conn) + t(150, 146, note, 'middle', 'sc-ts') +
      t(170, 4, 'PE', 'middle', 'sc-tb') + ln(170, 8, 170, 168, 'sc-pe') + pl([[60, 139], [60, 168], [170, 168]], 'sc-pe') + dot(170, 168));
  }
  SCHEMES.star = motorOnly('Y', '230/400 В в сети 400 В');
  SCHEMES.delta = motorOnly('Δ', '400/690 В в сети 400 В');

  // Прямой пуск: силовая часть слева, цепь управления справа
  SCHEMES.dol = svg(300, 260, (() => {
    const xs = [30, 50, 70];
    let s = phases(xs, 4) + xs.map((x) => ln(x, 8, x, 14)).join('') + threeQf(xs, 14, 'QF1');
    s += xs.map((x) => ln(x, 44, x, 60)).join('') + threeNo(xs, 60, 'KM1');
    s += xs.map((x) => ln(x, 90, x, 100) + heater(x, 100)).join('') + t(78, 116, 'KK1');
    s += xs.map((x) => ln(x, 126, x, 170)).join('') + pl([[30, 170], [38, 186]]) + pl([[70, 170], [62, 186]]) + ln(50, 170, 50, 183) + motor(50, 200, 'M1', 'Y');
    // Управление: от L1 через SF1
    s += dot(30, 10) + ln(30, 10, 160, 10) + qf(160, 10, 'SF1') + nc(160, 40, 'KK1 95-96') + btnNc(160, 70, 'SB1 «Стоп»');
    s += ln(160, 100, 160, 104) + dot(160, 104) + ln(160, 104, 220, 104) + btnNo(160, 104, 'SB2') + no(220, 104, 'KM1 13-14');
    s += ln(160, 134, 160, 140) + ln(220, 134, 220, 140) + ln(160, 140, 220, 140) + dot(160, 140) + coil(160, 140, 'KM1');
    s += ln(160, 164, 160, 236) + rail(236, 120, 260, '', '') + t(264, 239, 'N', 'start', 'sc-tb') + dot(160, 236);
    return s;
  })());

  // Реверс: KM2 меняет местами L1 и L3; блокировка НЗ-контактами
  SCHEMES.reverse = svg(340, 270, (() => {
    const xs = [30, 50, 70], ys = [100, 120, 140];
    let s = phases(xs, 4) + xs.map((x) => ln(x, 8, x, 14)).join('') + threeQf(xs, 14, 'QF1');
    s += xs.map((x) => ln(x, 44, x, 60)).join('') + xs.map((x, i) => dot(x, 52 + i * 0) + ln(x, 52, ys[i], 52)).join('');
    s += threeNo(xs, 60, 'KM1') + threeNo(ys, 52, '') + t(146, 70, 'KM2');
    // Выходы KM2 с перекрещиванием L1 ↔ L3
    s += pl([[100, 82], [100, 98], [70, 112]]) + pl([[120, 82], [120, 104], [50, 112]]) + pl([[140, 82], [140, 98], [30, 112]]);
    s += xs.map((x) => ln(x, 90, x, 160)).join('') + xs.map((x) => dot(x, 112)).join('') + pl([[30, 160], [38, 176]]) + pl([[70, 160], [62, 176]]) + ln(50, 160, 50, 173) + motor(50, 190, 'M1');
    s += dot(30, 10) + ln(30, 10, 200, 10) + qf(200, 10, 'SF1') + btnNc(200, 40, 'SB1');
    s += ln(200, 70, 200, 76) + dot(200, 76) + ln(200, 76, 290, 76);
    // Ветвь «Вперёд»
    s += ln(200, 76, 200, 80) + dot(200, 80) + ln(200, 80, 228, 80) + btnNo(200, 80, '') + no(228, 80, '') + t(176, 98, 'SB2', 'end') + ln(200, 110, 228, 110) + dot(200, 110);
    s += nc(200, 110, 'KM2') + coil(200, 140, 'KM1');
    // Ветвь «Назад»
    s += ln(290, 76, 290, 80) + dot(290, 80) + ln(290, 80, 318, 80) + btnNo(290, 80, '') + no(318, 80, '') + t(268, 98, 'SB3', 'end') + ln(290, 110, 318, 110) + dot(290, 110);
    s += nc(290, 110, 'KM1') + coil(290, 140, 'KM2');
    s += ln(200, 164, 200, 246) + ln(290, 164, 290, 246) + rail(246, 160, 330, '', '') + t(334, 249, 'N', 'start', 'sc-tb') + dot(200, 246) + dot(290, 246);
    s += t(232, 92, 'KM1', 'start', 'sc-ts') + t(322, 92, 'KM2', 'start', 'sc-ts');
    return s;
  })());

  // Звезда-треугольник: KM1 — сеть, KM2 — звезда, KM3 — треугольник, KT1 — реле времени
  SCHEMES.stardelta = svg(390, 300, (() => {
    const xs = [30, 50, 70];
    let s = phases(xs, 4) + xs.map((x) => ln(x, 8, x, 14)).join('') + threeQf(xs, 14, 'QF1');
    s += xs.map((x) => ln(x, 44, x, 54)).join('') + threeNo(xs, 54, 'KM1') + xs.map((x) => ln(x, 84, x, 150)).join('');
    s += motor(50, 170, 'M1') + pl([[30, 150], [38, 156]]) + pl([[70, 150], [62, 156]]) + ln(50, 150, 50, 153);
    s += t(16, 128, 'U1 V1 W1', 'end', 'sc-ts') + t(16, 206, 'W2 U2 V2', 'end', 'sc-ts');
    // Концы W2 U2 V2 снизу двигателя
    s += pl([[38, 184], [30, 196]]) + ln(50, 187, 50, 196) + pl([[62, 184], [70, 196]]);
    s += xs.map((x) => ln(x, 196, x, 210)).join('') + threeNo(xs, 210, 'KM2 (звезда)') + ln(30, 240, 70, 240) + xs.map((x) => dot(x, 240)).join('');
    // KM3: начала обмоток соединяются с концами со сдвигом (треугольник)
    s += xs.map((x, i) => dot(x, 120) + ln(x, 120, 100 + i * 20, 120)).join('') + threeNo([100, 120, 140], 120, '') + t(146, 140, 'KM3 (Δ)');
    s += pl([[100, 150], [100, 202], [50, 202]]) + pl([[120, 150], [120, 206], [70, 206]]) + pl([[140, 150], [140, 198], [30, 198]]) + dot(30, 198) + dot(50, 202) + dot(70, 206);
    // Управление
    const X = 210;
    s += dot(30, 10) + ln(30, 10, X, 10) + qf(X, 10, 'SF1') + btnNc(X, 40, 'SB1');
    s += ln(X, 70, X, 74) + dot(X, 74) + ln(X, 74, X + 28, 74) + btnNo(X, 74, '') + no(X + 28, 74, '') + t(X - 22, 92, 'SB2', 'end') + t(X + 32, 86, 'KM1', 'start', 'sc-ts');
    const C = [X, X + 50, X + 100, X + 150];
    s += ln(X, 104, X + 28, 104) + dot(X, 104) + ln(X, 104, X, 110) + ln(X, 110, C[3], 110) + C.map((x) => dot(x, 110)).join('');
    s += coil(C[0], 110, 'KM1') + coil(C[1], 110, 'KT1', true);
    s += tNc(C[2], 110, '') + t(C[2] + 11, 126, 'KT1', 'start', 'sc-ts') + nc(C[2], 140, '') + t(C[2] + 11, 160, 'KM3', 'start', 'sc-ts') + coil(C[2], 170, 'KM2');
    s += tNo(C[3], 110, '') + t(C[3] + 6, 126, 'KT1', 'start', 'sc-ts') + nc(C[3], 140, '') + t(C[3] + 11, 160, 'KM2', 'start', 'sc-ts') + coil(C[3], 170, 'KM3');
    s += ln(C[0], 134, C[0], 276) + ln(C[1], 134, C[1], 276) + ln(C[2], 194, C[2], 276) + ln(C[3], 194, C[3], 276);
    s += rail(276, X - 20, C[3] + 20, '', '') + t(C[3] + 24, 279, 'N', 'start', 'sc-tb') + C.map((x) => dot(x, 276)).join('');
    return s;
  })());

  ET.SCHEMES = SCHEMES;
  ET.schemeFor = (lab) => SCHEMES[lab.scheme || lab.id] || null;
})(window.ET);
