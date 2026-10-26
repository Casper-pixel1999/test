import test from 'node:test';
import assert from 'node:assert/strict';
import { buyerPaysFor, receivedFor } from '../src/steam/fees.js';
import { steamToSteam, externalToSteam, steamToExternal, competitiveSteamPrice } from '../src/engine/arbitrage.js';
import { encrypt, decrypt } from '../src/core/secrets.js';

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

const s = { walletValue: 1, holdRisk: 0, minSteamVolume24h: 0 };
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
