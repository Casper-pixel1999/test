// Сквозной тест: настоящий PostgreSQL + реальные Sniper/AutoSeller/Repo, ответы площадок — фикстуры.
// Запуск: DATABASE_URL_TEST=postgres://... npm test   (без переменной тест пропускается)
import test from 'node:test';
import assert from 'node:assert/strict';
import { Repo } from '../src/db/repo.js';
import { Sniper } from '../src/engine/sniper.js';
import { AutoSeller } from '../src/engine/seller.js';
import { findOpportunities } from '../src/engine/arbitrage.js';
import { buyerPaysFor, receivedFor } from '../src/steam/fees.js';
import { strategy, collectingNotifier, silentLogger } from './helpers.js';

const url = process.env.DATABASE_URL_TEST;
const NAME = 'Revolution Case';

/** Фейковый SteamMarket с изменяемым состоянием рынка. */
function fakeSteam() {
  const st = {
    overview: { lowestCents: 300, medianCents: 290, volume24h: 500 },
    listings: [{ listingId: 'L1', subtotalCents: 209, feeCents: 31, totalCents: 240 }],
    inventory: [], listedAssets: new Set(), bought: [], sold: [], confirmCalls: [],
  };
  return {
    st,
    priceOverview: async () => st.overview,
    getListings: async () => st.listings,
    buyListing: async (appId, name, l) => { st.bought.push(l.listingId); return { ok: true, raw: { wallet_info: { success: 1 } } }; },
    getInventory: async () => st.inventory,
    sellItem: async ({ assetId, buyerPaysCents }) => {
      st.sold.push({ assetId, buyerPaysCents });
      st.listedAssets.add(assetId);
      st.inventory = st.inventory.filter((a) => a.assetId !== assetId);
      return { receivedCents: receivedFor(buyerPaysCents, 730), needsConfirmation: true };
    },
    confirmOwnListings: async (names) => { st.confirmCalls.push(names); return names.length; },
    getListedAssetIds: async () => st.listedAssets,
  };
}

test('pipeline: scan -> dry run -> buy -> list -> sold', { skip: !url && 'DATABASE_URL_TEST не задан' }, async (t) => {
  const db = new Repo(url);
  t.after(() => db.close());
  await db.pool.query('TRUNCATE price_snapshots, opportunities, inventory, purchases RESTART IDENTITY CASCADE');

  const steam = fakeSteam();
  const notifier = collectingNotifier();
  const mk = (dryRun) => ({
    sniper: new Sniper({ config: { dryRun, strategy }, db, notifier, steamMarket: steam, venues: {}, logger: silentLogger }),
    seller: new AutoSeller({ config: { dryRun, strategy }, db, notifier, steamMarket: steam, logger: silentLogger }),
  });

  // 1) Снапшоты цен пишутся в БД
  await db.savePrices('steam', 730, [{ name: NAME, priceCents: 300, medianCents: 290, volume: 500 }]);
  await db.savePrices('skinport', 730, [{ name: NAME, priceCents: 250 }]);
  const { rows: snaps } = await db.pool.query('SELECT source, price_cents FROM price_snapshots ORDER BY id');
  assert.deepEqual(snaps.map((r) => [r.source, r.price_cents]), [['steam', 300], ['skinport', 250]]);

  // 2) Лот за $2.40 против медианы $2.90 -> получим 253c, ROI 5.4% < 10% -> не покупаем
  let [opp] = findOpportunities({ appId: 730, name: NAME, q: { steam: { overview: steam.st.overview, listings: steam.st.listings }, external: [] }, s: strategy });
  assert.equal(opp.route, 'steam->steam');
  assert.equal(opp.netProfitCents, receivedFor(290, 730) - 240);
  await mk(false).sniper.consider(730, opp);
  assert.equal(steam.st.bought.length, 0, 'ROI ниже порога — без покупки');

  // 3) Лот подешевел до $2.00 -> ROI 26% -> в DRY_RUN только запись и алерт
  steam.st.listings = [{ listingId: 'L2', subtotalCents: 174, feeCents: 26, totalCents: 200 }];
  [opp] = findOpportunities({ appId: 730, name: NAME, q: { steam: { overview: steam.st.overview, listings: steam.st.listings }, external: [] }, s: strategy });
  await mk(true).sniper.consider(730, opp);
  assert.equal(steam.st.bought.length, 0);
  assert.ok(notifier.messages.some((m) => m.includes('[DRY RUN]')));
  assert.equal(await db.spentTodayCents(), 0, 'dry run не тратит бюджет');

  // 4) Боевой режим: покупка, запись в purchases и inventory
  const live = mk(false);
  await live.sniper.consider(730, opp);
  assert.deepEqual(steam.st.bought, ['L2']);
  assert.equal(await db.spentTodayCents(), 200);
  const awaiting = await db.awaitingSale(730);
  assert.equal(awaiting.length, 1);
  assert.equal(awaiting[0].cost_cash_cents, 200);

  // 5) Повторная покупка того же предмета блокируется cooldown'ом
  await live.sniper.consider(730, opp);
  assert.deepEqual(steam.st.bought, ['L2']);

  // 6) Продавец ждёт, пока предмет в холде (не marketable)
  steam.st.inventory = [{ assetId: 'A1', name: NAME, marketable: false, tradable: false }];
  await live.seller.run(730);
  assert.equal(steam.st.sold.length, 0);

  // 7) Холд закончился -> выставляем по конкурентной цене, не ниже пола
  steam.st.inventory = [{ assetId: 'A1', name: NAME, marketable: true, tradable: true }];
  steam.st.listings = [{ listingId: 'L3', subtotalCents: 261, feeCents: 39, totalCents: 300 }];
  await live.seller.run(730);
  const floor = buyerPaysFor(Math.ceil(200 * 1.05), 730);
  assert.equal(steam.st.sold.length, 1);
  assert.equal(steam.st.sold[0].buyerPaysCents, Math.max(Math.min(299, 290), floor));
  assert.deepEqual(steam.st.confirmCalls, [[NAME]]);
  const { rows: [listed] } = await db.pool.query("SELECT status, asset_id, list_price_cents FROM inventory");
  assert.equal(listed.status, 'listed');
  assert.equal(listed.asset_id, 'A1');

  // 8) Лот пропал с ТП и из инвентаря -> продано, статистика считается
  steam.st.listedAssets.clear();
  await live.seller.reconcileSold(730);
  const { rows: [day] } = await db.pool.query('SELECT items_sold, revenue_wallet_cents, cost_cash_cents FROM daily_profit');
  assert.equal(Number(day.items_sold), 1);
  assert.equal(Number(day.cost_cash_cents), 200);
  assert.ok(notifier.messages.some((m) => m.startsWith('💰 Продано')));

  // 9) Дневной бюджет: следующая покупка на $9 превысит лимит $10
  steam.st.overview = { lowestCents: 1500, medianCents: 1400, volume24h: 500 };
  steam.st.listings = [{ listingId: 'L9', subtotalCents: 783, feeCents: 117, totalCents: 900 }];
  [opp] = findOpportunities({ appId: 730, name: 'Other', q: { steam: { overview: steam.st.overview, listings: steam.st.listings }, external: [] }, s: strategy });
  await live.sniper.consider(730, opp);
  assert.ok(!steam.st.bought.includes('L9'));
  assert.ok(notifier.messages.some((m) => m.includes('Дневной бюджет')));

  const { rows: decisions } = await db.pool.query('SELECT decision FROM opportunities ORDER BY id');
  assert.deepEqual(decisions.map((r) => r.decision), ['dry_run', 'bought', 'skipped:cooldown', 'skipped:budget']);
});
