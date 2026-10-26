import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { encrypt } from '../src/core/secrets.js';
import { loadMaFile } from '../src/steam/maFile.js';
import { SteamSession } from '../src/steam/session.js';
import { SteamMarket } from '../src/steam/market.js';
import { fakeHttp, silentLogger, collectingNotifier } from './helpers.js';

// Фейковые, но корректные по формату секреты (20/32 байта base64)
const MA = {
  account_name: 'arb_test', shared_secret: Buffer.alloc(20, 7).toString('base64'),
  identity_secret: Buffer.alloc(20, 9).toString('base64'), device_id: 'android:test',
};
// Как в реальном SDA maFile: SteamID — голое 17-значное число, которое JSON.parse округлил бы
const MA_TEXT = JSON.stringify(MA).replace(/}$/, ',"Session":{"SteamID":76561198000000001}}');
const PASS = 'test passphrase 123';

async function tmpFile(name, content) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'arb-'));
  const p = path.join(dir, name);
  await fs.writeFile(p, content);
  return p;
}

test('maFile: зашифрованный грузится, битый/неверный пароль отклоняется', async () => {
  const p = await tmpFile('a.enc', encrypt(MA_TEXT, PASS));
  const ma = await loadMaFile(p, PASS);
  assert.equal(ma.accountName, 'arb_test');
  assert.equal(ma.steamId, '76561198000000001');
  await assert.rejects(loadMaFile(p, 'wrong passphrase!!'));
  await assert.rejects(loadMaFile(p, ''), /SECRETS_PASSPHRASE/);

  const bad = await tmpFile('b.maFile', JSON.stringify({ ...MA, identity_secret: undefined }));
  await assert.rejects(loadMaFile(bad, PASS, silentLogger), /identity_secret/);
});

function makeSession() {
  const store = { v: null, load: async () => store.v, save: async (x) => { store.v = x; }, clear: async () => { store.v = null; } };
  const notifier = collectingNotifier();
  const maFile = { accountName: 'arb_test', sharedSecret: MA.shared_secret, identitySecret: MA.identity_secret, steamId: '76561198000000001' };
  const s = new SteamSession({ accountName: 'arb_test', maFile, tokenStore: store, logger: silentLogger, notifier });
  return { s, store, notifier };
}

test('SteamSession: TOTP-код, cookies, сохранение refresh token', async () => {
  const { s, store } = makeSession();
  assert.match(s.authCode(), /^[23456789BCDFGHJKMNPQRTVWXY]{5}$/);
  s.client.emit('refreshToken', 'rt-123');
  await new Promise((r) => setImmediate(r));
  assert.equal(store.v, 'rt-123');
  s.cookies = ['sessionid=abc', 'steamLoginSecure=xyz; Path=/; Secure'];
  assert.equal(s.cookieHeader(), 'sessionid=abc; steamLoginSecure=xyz');
  s.client.removeAllListeners(); s.manager.removeAllListeners?.();
});

function fakeOffer({ give, receive }) {
  const o = { id: '42', itemsToGive: Array(give).fill({}), itemsToReceive: Array(receive).fill({}),
    partner: { getSteamID64: () => '7656' }, isGlitched: () => false, accepted: false, declined: false };
  o.accept = (cb) => { o.accepted = true; cb(null); };
  o.decline = (cb) => { o.declined = true; cb(null); };
  return o;
}

test('Антискам: принимаем только офферы, где мы ничего не отдаём', async () => {
  const { s, notifier } = makeSession();
  const gift = fakeOffer({ give: 0, receive: 2 });
  const scam = fakeOffer({ give: 1, receive: 1 });
  s.manager.emit('newOffer', gift);
  s.manager.emit('newOffer', scam);
  assert.equal(gift.accepted, true);
  assert.equal(scam.accepted, false);
  assert.equal(scam.declined, true);
  assert.ok(notifier.messages.some((m) => m.includes('Отклонён оффер')));
});

function marketWith(routes, confs = []) {
  const accepted = [];
  const session = {
    sessionID: 'sid', steamId: '76561198000000001', cookieHeader: () => 'sessionid=sid',
    getConfirmations: async () => confs,
    acceptConfirmation: async (c) => { accepted.push(c.id); },
  };
  const http = fakeHttp(routes);
  return { market: new SteamMarket({ http, session, logger: silentLogger }), http, accepted };
}

test('SteamMarket: парсинг priceoverview / listings / inventory', async () => {
  const { market, http } = marketWith([
    [/priceoverview/, () => ({ success: true, lowest_price: '$1,234.56', median_price: '$1,200.00', volume: '1,050' })],
    [/\/render\//, () => ({ success: true, listinginfo: {
      2: { listingid: '2', converted_price: 200, converted_fee: 30 },
      1: { listingid: '1', converted_price: 100, converted_fee: 15 },
      3: { listingid: '3', converted_price: 0, converted_fee: 0 } } })],
    [/\/inventory\//, () => ({ assets: [{ assetid: '9001', classid: 'c', instanceid: '0' }],
      descriptions: [{ classid: 'c', instanceid: '0', market_hash_name: 'Revolution Case', marketable: 1, tradable: 0 }] })],
  ]);
  assert.deepEqual(await market.priceOverview(730, 'Revolution Case'), { lowestCents: 123456, medianCents: 120000, volume24h: 1050 });
  const l = await market.getListings(730, 'AK-47 | Redline (Field-Tested)');
  assert.deepEqual(l.map((x) => [x.listingId, x.totalCents]), [['1', 115], ['2', 230]]);
  assert.match(http.calls[1].url, /AK-47%20%7C%20Redline%20\(Field-Tested\)/);
  assert.deepEqual(await market.getInventory(730), [{ assetId: '9001', name: 'Revolution Case', marketable: true, tradable: false }]);
  assert.equal(http.calls[2].sticky, true, 'инвентарь — авторизованный запрос через sticky IP');
});

test('SteamMarket.buyListing: корректная форма, sticky, подтверждение только своей покупки', async () => {
  const confs = [{ id: 'trade-1', type: 2 }, { id: 'buy-77', type: 12 }];
  const { market, http, accepted } = marketWith([
    [/buylisting\/555/, () => ({ need_confirmation: true, confirmation: { confirmation_id: 'buy-77' } })],
  ], confs);
  await market.buyListing(730, 'X', { listingId: '555', subtotalCents: 100, feeCents: 15, totalCents: 115 });
  const call = http.calls[0];
  assert.equal(call.method, 'POST');
  assert.equal(call.sticky, true);
  const form = new URLSearchParams(call.body);
  assert.deepEqual([form.get('subtotal'), form.get('fee'), form.get('total'), form.get('sessionid')], ['100', '15', '115', 'sid']);
  assert.deepEqual(accepted, ['buy-77']);
});

test('SteamMarket.sellItem: в Steam уходит сумма продавца без комиссий', async () => {
  const { market, http } = marketWith([[/sellitem/, () => ({ success: true, requires_confirmation: 1 })]]);
  const r = await market.sellItem({ appId: 730, assetId: '9001', buyerPaysCents: 115 });
  assert.equal(r.receivedCents, 100);
  assert.equal(r.needsConfirmation, true);
  assert.equal(new URLSearchParams(http.calls[0].body).get('price'), '100');
});

test('confirmListing: подтверждается ровно лот с нужным listingid, трейды не трогаются', async () => {
  const confs = [
    { id: 'c-trade', type: 2, creator: 'LST1' },     // трейд с тем же creator — не трогаем
    { id: 'c-other', type: 3, creator: 'LST2' },     // чужой лот
    { id: 'c-mine', type: 3, creator: 'LST1' },
  ];
  const { market, accepted } = marketWith([], confs);
  assert.equal(await market.confirmListing('LST1'), true);
  assert.deepEqual(accepted, ['c-mine']);
  assert.equal(await market.confirmListing('NOPE'), false);
  assert.deepEqual(accepted, ['c-mine']);
});

test('getMyListings: assetid -> listingid из обоих форматов ответа', async () => {
  const { market } = marketWith([[/mylistings/, () => ({
    assets: { 730: { 2: { 111: {} } } },
    listings: [{ listingid: '901', asset: { id: '111' } }],
    listings_to_confirm: [{ listingid: '902', asset: { id: '222' } }],
  })]]);
  const m = await market.getMyListings(730);
  assert.deepEqual([...m.entries()].sort(), [['111', '901'], ['222', '902']]);
});

test('getHistory: наши покупки (new_id) и продажи (фактически получено)', async () => {
  const { market } = marketWith([[/myhistory/, () => ({
    success: true,
    events: [
      { listingid: '500', purchaseid: '1', event_type: 4 },
      { listingid: '600', purchaseid: '2', event_type: 3 },
      { listingid: '700', purchaseid: '0', event_type: 1 },
    ],
    purchases: {
      '500_1': { listingid: '500', asset: { id: 'seller-asset', new_id: 'A1' }, paid_amount: 200, paid_fee: 30 },
      '600_2': { listingid: '600', asset: { id: 'A9' }, received_amount: 252 },
    },
  })]]);
  const h = await market.getHistory();
  assert.deepEqual(h.bought, [{ listingId: '500', newAssetId: 'A1' }]);
  assert.deepEqual(h.sold, [{ listingId: '600', assetId: 'A9', receivedCents: 252 }]);
});
