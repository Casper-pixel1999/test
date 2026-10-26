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
