// Сквозной тест: настоящий PostgreSQL + реальные Sniper/AutoSeller/Repo, ответы площадок — фикстуры.
// Запуск: DATABASE_URL_TEST=postgres://... npm test   (без переменной тест пропускается)
import test from 'node:test';
import assert from 'node:assert/strict';
import { Repo } from '../src/db/repo.js';
import { Sniper } from '../src/engine/sniper.js';
import { AutoSeller } from '../src/engine/seller.js';
import { Scanner } from '../src/engine/scanner.js';
import { findOpportunities } from '../src/engine/arbitrage.js';
import { buyerPaysFor, receivedFor } from '../src/steam/fees.js';
import { strategy, collectingNotifier, silentLogger } from './helpers.js';

const url = process.env.DATABASE_URL_TEST;
const CASE = 'Revolution Case';
const KILO = 'Kilowatt Case';

/** Фейковый SteamMarket с изменяемым состоянием рынка и аккаунта. */
function fakeSteam() {
  const st = {
    overview: { lowestCents: 300, medianCents: 290, volume24h: 500 },
    listings: [{ listingId: 'L1', subtotalCents: 209, feeCents: 31, totalCents: 240 }],
    inventory: [], myListings: new Map(), history: { bought: [], sold: [] },
    bought: [], sold: [], confirmed: [], nextListing: 1, book: null,
  };
  return {
    st,
    currencyName: 'USD',
    priceOverview: async () => st.overview,
    getListings: async () => st.listings,
    getOrderBook: async () => st.book,
    buyListing: async (appId, name, l) => { st.bought.push(l.listingId); return { ok: true, raw: { wallet_info: { success: 1 } } }; },
    getInventory: async () => st.inventory,
    getHistory: async () => st.history,
    getMyListings: async () => st.myListings,
    sellItem: async ({ assetId, buyerPaysCents }) => {
      st.sold.push({ assetId, buyerPaysCents });
      st.myListings.set(assetId, `LST${st.nextListing++}`);
      st.inventory = st.inventory.filter((a) => a.assetId !== assetId);
      return { receivedCents: receivedFor(buyerPaysCents, 730), needsConfirmation: true };
    },
    confirmListing: async (id) => { st.confirmed.push(id); return true; },
  };
}

const quote = (steam, name, external = []) =>
  findOpportunities({ appId: 730, name, q: { steam: { overview: steam.st.overview, listings: steam.st.listings, book: steam.st.book }, external }, s: strategy })[0];

test('pipeline: покупка -> точный assetid -> лот по listingid -> продажа по истории', { skip: !url && 'DATABASE_URL_TEST не задан' }, async (t) => {
  const db = new Repo(url);
  t.after(() => db.close());
  await db.pool.query('TRUNCATE price_snapshots, opportunities, inventory, purchases, seen_assets RESTART IDENTITY CASCADE');

  const steam = fakeSteam();
  const notifier = collectingNotifier();
  const dmarketBuys = [];
  const dmarket = {
    name: 'dmarket', fees: { buyFeePct: 0, sellFeePct: 0.05, cashoutFeePct: 0.02 },
    cheapestOffers: async () => [{ offerId: 'O1', priceCents: 150 }],
    buy: async (o) => { dmarketBuys.push(o.offerId); return { ok: true, raw: { status: 'TxSuccess' } }; },
  };
  const scanner = new Scanner({ config: { scan: {}, strategy }, steamMarket: steam, dmarket, logger: silentLogger });
  const mk = (dryRun) => ({
    sniper: new Sniper({ config: { dryRun, strategy }, db, notifier, steamMarket: steam, venues: { dmarket }, scanner, logger: silentLogger }),
    seller: new AutoSeller({ config: { dryRun, strategy }, db, notifier, steamMarket: steam, logger: silentLogger }),
  });

  // 0) Личный инвентарь ДО первой покупки: такой же кейс уже лежит на аккаунте
  steam.st.inventory = [{ assetId: 'OWN1', name: CASE, marketable: true }, { assetId: 'OWN2', name: KILO, marketable: true }];
  await mk(false).seller.syncInventory(730);

  // 1) ROI 5.4% < 10% — пропуск
  await mk(false).sniper.consider(730, quote(steam, CASE));
  assert.equal(steam.st.bought.length, 0);

  // 2) Лот за $2.00 (ROI 26.5%): в DRY_RUN — только запись, бюджет не тратится
  steam.st.listings = [{ listingId: 'L2', subtotalCents: 174, feeCents: 26, totalCents: 200 }];
  await mk(true).sniper.consider(730, quote(steam, CASE));
  assert.equal(steam.st.bought.length, 0);
  assert.equal(await db.spentTodayCents(), 0);

  // 3) Боевая покупка: purchases -> bought, позиция в inventory
  await mk(false).sniper.consider(730, quote(steam, CASE));
  assert.deepEqual(steam.st.bought, ['L2']);
  assert.equal(await db.spentTodayCents(), 200);

  // 4) Перезапуск бота (новый Sniper): cooldown хранится в БД и всё ещё действует
  steam.st.listings = [{ listingId: 'L3', subtotalCents: 174, feeCents: 26, totalCents: 200 }];
  await mk(false).sniper.consider(730, quote(steam, CASE));
  assert.deepEqual(steam.st.bought, ['L2'], 'после рестарта повторной покупки нет');

  // 5) Предмет зачислен, но в холде. История ТП говорит: лот L2 -> новый assetid A1
  steam.st.history.bought.push({ listingId: 'L2', newAssetId: 'A1' });
  steam.st.inventory.push({ assetId: 'A1', name: CASE, marketable: false });
  const live = mk(false);
  await live.seller.run(730);
  assert.equal(steam.st.sold.length, 0, 'в холде не выставляем');
  const { rows: [pos] } = await db.pool.query("SELECT asset_id FROM inventory WHERE market_hash_name=$1", [CASE]);
  assert.equal(pos.asset_id, 'A1', 'назначен точный assetid из истории, а не личный OWN1');

  // 6) Холд закончился -> выставляем A1 (НЕ OWN1) и подтверждаем ровно его лот
  steam.st.inventory.find((a) => a.assetId === 'A1').marketable = true;
  steam.st.listings = [{ listingId: 'L4', subtotalCents: 261, feeCents: 39, totalCents: 300 }];
  await live.seller.run(730);
  assert.deepEqual(steam.st.sold.map((x) => x.assetId), ['A1']);
  assert.equal(steam.st.sold[0].buyerPaysCents, Math.max(290, buyerPaysFor(Math.ceil(200 * 1.05), 730)));
  assert.deepEqual(steam.st.confirmed, ['LST1']);
  assert.ok(steam.st.inventory.some((a) => a.assetId === 'OWN1'), 'личный предмет не тронут');

  // 7) Лот висит на ТП -> статус listed; продажа фиксируется только по истории и по факту (250, а не 253)
  await live.seller.run(730);
  assert.equal((await db.listedPositions(730)).length, 1);
  steam.st.myListings.delete('A1');
  steam.st.history.sold.push({ listingId: 'LST1', assetId: 'A1', receivedCents: 250 });
  await live.seller.run(730);
  const { rows: [day] } = await db.pool.query('SELECT items_sold, revenue_cash_cents, cost_cash_cents, profit_cash_cents FROM daily_profit');
  assert.deepEqual([Number(day.items_sold), Number(day.revenue_cash_cents), Number(day.cost_cash_cents), Number(day.profit_cash_cents)], [1, 250, 200, 50]);

  // 8) Маршрут DMarket -> Steam: истории нет, assetid берётся из предметов, появившихся ПОСЛЕ покупки
  steam.st.overview = { lowestCents: 300, medianCents: 290, volume24h: 500 };
  steam.st.listings = [];
  const ext = [{ venue: dmarket, priceCents: 150, buyable: true, offer: { offerId: 'O1', priceCents: 150 } }];
  const dOpp = findOpportunities({ appId: 730, name: KILO, q: { steam: { overview: steam.st.overview, listings: [] }, external: ext }, s: strategy })[0];
  assert.equal(dOpp.route, 'dmarket->steam');
  await live.sniper.consider(730, dOpp);
  assert.deepEqual(dmarketBuys, ['O1']);
  steam.st.inventory.push({ assetId: 'D1', name: KILO, marketable: false });
  await live.seller.run(730);
  const { rows: [kpos] } = await db.pool.query("SELECT asset_id FROM inventory WHERE market_hash_name=$1", [KILO]);
  assert.equal(kpos.asset_id, 'D1', 'OWN2 был в инвентаре до покупки — не назначается');

  // 9) Сбой посреди покупки: pending-записи восстанавливаются при старте
  await db.beginPurchase({ appId: 730, status: 'pending', opp: { buyVenue: 'steam', listing: { listingId: 'L77' }, name: CASE, buyPriceCents: 100, buyCurrency: 'USD', costCashCents: 100 } });
  await db.beginPurchase({ appId: 730, status: 'pending', opp: { buyVenue: 'dmarket', offer: { offerId: 'O55' }, name: KILO, buyPriceCents: 100, buyCurrency: 'USD', costCashCents: 100 } });
  steam.st.history.bought.push({ listingId: 'L77', newAssetId: 'A77' });
  await mk(false).sniper.recoverPending();
  const { rows: rec } = await db.pool.query("SELECT external_id, status FROM purchases WHERE external_id IN ('L77','O55') ORDER BY external_id");
  assert.deepEqual(rec.map((r) => [r.external_id, r.status]), [['L77', 'bought'], ['O55', 'unknown']]);
  assert.ok(notifier.messages.some((m) => m.includes('O55') && m.includes('вручную')));
  const { rows: [{ n }] } = await db.pool.query("SELECT count(*)::int AS n FROM inventory i JOIN purchases p ON p.id=i.purchase_id WHERE p.external_id='L77'");
  assert.equal(n, 1, 'восстановленная покупка попала в очередь на продажу');

  // 10) Тот же лот второй раз купить нельзя (UNIQUE venue+external_id)
  assert.equal(await db.beginPurchase({ appId: 730, status: 'pending', opp: { buyVenue: 'steam', listing: { listingId: 'L77' }, name: CASE, buyPriceCents: 100, buyCurrency: 'USD', costCashCents: 100 } }), null);

  // 11) Лот сняли вручную -> manual; предмет пропал без продажи (>1ч) -> gone. Ни то, ни другое не "продано"
  const { rows: [p1] } = await db.pool.query(`INSERT INTO purchases (venue, external_id, app_id, market_hash_name, cost_cents, currency, cost_cash_cents, status)
    VALUES ('steam','LM',730,'M',100,'USD',100,'bought'), ('steam','LG',730,'G',100,'USD',100,'bought') RETURNING id`);
  await db.pool.query(`INSERT INTO inventory (purchase_id, app_id, market_hash_name, asset_id, status, listed_at) VALUES
    ($1,730,'M','M1','listed',now()), ($1+1,730,'G','G1','listed',now() - interval '2 hours')`, [p1.id]);
  steam.st.inventory.push({ assetId: 'M1', name: 'M', marketable: true });
  await live.seller.run(730);
  const { rows: st } = await db.pool.query("SELECT asset_id, status FROM inventory WHERE asset_id IN ('M1','G1') ORDER BY asset_id");
  assert.deepEqual(st.map((r) => [r.asset_id, r.status]), [['G1', 'gone'], ['M1', 'manual']]);
  assert.equal(Number((await db.pool.query('SELECT items_sold FROM daily_profit')).rows[0].items_sold), 1);

  // 12) Дневной бюджет $10: покупка за $9 при уже потраченных $5.00 не проходит
  steam.st.overview = { lowestCents: 1500, medianCents: 1400, volume24h: 500 };
  steam.st.listings = [{ listingId: 'L9', subtotalCents: 783, feeCents: 117, totalCents: 900 }];
  await live.sniper.consider(730, quote(steam, 'Other'));
  assert.ok(!steam.st.bought.includes('L9'));
  assert.ok(notifier.messages.some((m) => m.includes('Дневной бюджет')));

  // 13) Стакан: покупатели только по $1.00 при покупке за $2.00 -> worst_case, сделка отсекается
  steam.st.overview = { lowestCents: 200, medianCents: 290, volume24h: 500 };
  steam.st.listings = [{ listingId: 'T1', subtotalCents: 174, feeCents: 26, totalCents: 200 }];
  steam.st.book = { asks: [{ priceCents: 200, qty: 1 }, { priceCents: 300, qty: 2 }], bids: [], highestBuyCents: 100 };
  const thin = quote(steam, 'Thin');
  assert.ok(thin.roi > strategy.minRoi && thin.worstRoi < -0.4);
  await live.sniper.consider(730, thin);

  // 14) Неликвид: 100 лотов в пределах +5% от цели при 5 продажах в сутки -> illiquid
  steam.st.overview = { lowestCents: 200, medianCents: 290, volume24h: 15 };
  steam.st.book = { asks: [{ priceCents: 200, qty: 1 }, { priceCents: 295, qty: 100 }], bids: [], highestBuyCents: 230 };
  await live.sniper.consider(730, quote(steam, 'Slow'));

  const { rows: risk } = await db.pool.query("SELECT market_hash_name, decision FROM opportunities WHERE market_hash_name IN ('Thin','Slow') ORDER BY id");
  assert.deepEqual(risk.map((r) => [r.market_hash_name, r.decision]), [['Thin', 'skipped:worst_case'], ['Slow', 'skipped:illiquid']]);
  assert.ok(!steam.st.bought.includes('T1'));
});
