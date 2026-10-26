import test from 'node:test';
import assert from 'node:assert/strict';
import { buyerPaysFor, receivedFor } from '../src/steam/fees.js';
import { steamToSteam, externalToSteam, steamToExternal, competitiveSteamPrice } from '../src/engine/arbitrage.js';
import { encrypt, decrypt } from '../src/core/secrets.js';
import { parsePriceToCents } from '../src/core/utils.js';

test('Steam fees: $1.00 к получению -> покупатель платит $1.15', () => {
  assert.equal(buyerPaysFor(100, 730), 115);
  assert.equal(receivedFor(115, 730), 100);
});

test('Steam fees: минимальная комиссия 1+1 цент', () => {
  assert.equal(buyerPaysFor(1, 730), 3);
  assert.equal(receivedFor(3, 730), 1);
});

test('receivedFor — обратная к buyerPaysFor на широком диапазоне', () => {
  for (let buyer = 3; buyer < 50_000; buyer += 7) {
    const r = receivedFor(buyer, 730);
    assert.ok(buyerPaysFor(r, 730) <= buyer, `buyer=${buyer}`);
    assert.ok(buyerPaysFor(r + 1, 730) > buyer, `buyer=${buyer}`);
  }
});

const s = { walletValue: 1, walletFx: 1, holdRisk: 0, minSteamVolume24h: 0 };
const venue = { name: 'x', fees: { buyFeePct: 0, sellFeePct: 0.08, cashoutFeePct: 0.02 } };

test('steam->steam: перепродажа по той же цене — убыток ровно на комиссию', () => {
  const r = steamToSteam({ appId: 730, name: 'a', buyTotalCents: 1150, sellBuyerPaysCents: 1150, s });
  assert.equal(r.netProfitCents, 1000 - 1150);
});

test('external->steam учитывает комиссию Steam и стоимость кошелька', () => {
  const r = externalToSteam({ appId: 730, name: 'a', venue, buyPriceCents: 700, sellBuyerPaysCents: 1150, s: { ...s, walletValue: 0.75 } });
  assert.equal(r.revenueCashCents, 750); // 1000 * 0.75
  assert.equal(r.netProfitCents, 50);
});

test('steam->external учитывает комиссию продажи и кэшаута', () => {
  const r = steamToExternal({ name: 'a', venue, buyTotalCents: 1000, sellPriceCents: 1000, s: { ...s, walletValue: 0.7 } });
  assert.equal(r.revenueCashCents, Math.round(1000 * 0.92 * 0.98));
  assert.equal(r.costCashCents, 700);
});

test('конкурентная цена не выше медианы', () => {
  assert.equal(competitiveSteamPrice({ lowestCents: 500, medianCents: 450 }), 450);
  assert.equal(competitiveSteamPrice({ lowestCents: 500, medianCents: 600 }), 499);
});

test('шифрование секретов: roundtrip и отказ при неверном пароле', () => {
  const enc = encrypt('{"shared_secret":"x"}', 'correct horse battery');
  assert.equal(decrypt(enc, 'correct horse battery'), '{"shared_secret":"x"}');
  assert.throws(() => decrypt(enc, 'wrong passphrase!!'));
});

test('парсинг цен Steam во всех форматах валют', () => {
  const cases = {
    '$1,234.56': 123456, '$0.03': 3, '$1,234': 123400, '1 234,56 pуб.': 123456, '57 pуб.': 5700,
    '1.234,56€': 123456, '12,34€': 1234, '₸ 1 500': 150000, '¥ 12.5': 1250, '£0.99': 99, '--': null, '': null,
  };
  for (const [str, cents] of Object.entries(cases)) assert.equal(parsePriceToCents(str), cents, str);
});

test('рублёвый кошелёк: Steam-суммы переводятся в USD через walletFx', () => {
  const rub = { ...s, walletFx: 0.011, walletValue: 0.75, walletCurrency: 'RUB' };
  const r = steamToExternal({ name: 'a', venue, buyTotalCents: 10_000, sellPriceCents: 150, s: rub }); // 100 ₽ -> $1.50
  assert.equal(r.costCashCents, Math.round(10_000 * 0.011 * 0.75)); // 83¢ реальных
  assert.equal(r.buyCurrency, 'RUB');
  assert.equal(r.buyUsdCents, 110);
  const e = externalToSteam({ appId: 730, name: 'a', venue, buyPriceCents: 100, sellBuyerPaysCents: 11_500, s: rub });
  assert.equal(e.revenueCashCents, Math.round(10_000 * 0.011 * 0.75));
});

// ─── Стакан и оценка выхода ──────────────────────────────────────────────
import { estimateSteamExit, findOpportunities } from '../src/engine/arbitrage.js';

const sOpp = { ...s, minRoi: 0.1, minSteamVolume24h: 10 };

test('регрессия: после покупки самого дешёвого лота цель — следующий лот, а не наш же', () => {
  const listings = [{ totalCents: 200 }, { totalCents: 295 }, { totalCents: 300 }];
  const overview = { lowestCents: 200, medianCents: 290, volume24h: 100 }; // lowest = покупаемый лот
  const exit = estimateSteamExit({ overview, listings, removeCheapest: true });
  assert.equal(exit.nextAskCents, 295);
  assert.equal(exit.targetCents, 290);
  assert.equal(exit.worstCents, null);

  // единственный лот и priceoverview указывает на него же -> рыночной цены нет, кроме медианы
  const alone = estimateSteamExit({ overview, listings: [{ totalCents: 200 }], removeCheapest: true });
  assert.equal(alone.nextAskCents, null);
  assert.equal(alone.targetCents, 290);
});

test('стакан: несколько лотов по минимальной цене, заявки, конкуренты, дни продажи', () => {
  const book = { asks: [{ priceCents: 200, qty: 2 }, { priceCents: 295, qty: 3 }, { priceCents: 320, qty: 10 }], highestBuyCents: 210 };
  const overview = { lowestCents: 200, medianCents: 290, volume24h: 4 };
  const e = estimateSteamExit({ book, overview, removeCheapest: true });
  assert.equal(e.nextAskCents, 200, 'второй лот по 2.00 остаётся — конкурируем с ним');
  assert.equal(e.targetCents, 210, 'цель не ниже лучшей заявки');
  assert.equal(e.competing, 1);
  assert.equal(e.daysToSell, 0.5);

  const book2 = { asks: [{ priceCents: 200, qty: 1 }, { priceCents: 295, qty: 3 }, { priceCents: 300, qty: 10 }], highestBuyCents: 210 };
  const e2 = estimateSteamExit({ book: book2, overview, removeCheapest: true });
  assert.equal(e2.targetCents, 290);
  assert.equal(e2.competing, 13); // 295x3 и 300x10 в пределах +5% от 2.90
  assert.equal(e2.daysToSell, 14 / 4);
});

test('«прибыль по медиане»: покупатели только по $2.10 -> worstRoi отрицательный', () => {
  const book = { asks: [{ priceCents: 200, qty: 1 }, { priceCents: 300, qty: 5 }], highestBuyCents: 210 };
  const q = { steam: { overview: { lowestCents: 200, medianCents: 290, volume24h: 50 }, listings: [{ listingId: 'L', totalCents: 200 }], book }, external: [] };
  const [o] = findOpportunities({ appId: 730, name: 'x', q, s: sOpp });
  assert.equal(o.route, 'steam->steam');
  assert.equal(o.sellPriceCents, 290);
  assert.ok(o.roi > 0.25);
  assert.equal(o.highestBuyCents, 210);
  assert.ok(Math.abs(o.worstRoi - (receivedFor(210, 730) - 200) / 200) < 1e-9); // (183-200)/200 = -8.5%
  assert.equal(o.bookKnown, true);
});
