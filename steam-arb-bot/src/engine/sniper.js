import { fmtUsd } from '../core/utils.js';
import { findOpportunities } from './arbitrage.js';

const ITEM_COOLDOWN_MS = 30 * 60_000;

/**
 * Авто-закупка. Перед покупкой ОБЯЗАТЕЛЬНО перепроверяем цену свежим запросом:
 * между сбором котировок и покупкой лот могут выкупить или цена может измениться.
 */
export class Sniper {
  constructor({ config, db, notifier, steamMarket, venues, logger }) {
    this.cfg = config;
    this.s = config.strategy;
    this.db = db;
    this.notify = notifier;
    this.steam = steamMarket;
    this.venues = venues; // { dmarket: DMarket, ... } — только площадки с API покупки
    this.log = logger.child({ mod: 'sniper' });
    this.lastBuy = new Map();
    this.budgetAlerted = false;
  }

  async consider(appId, opp) {
    const tag = { route: opp.route, name: opp.name, roi: +(opp.roi * 100).toFixed(1) };
    if (opp.roi < this.s.minRoi) return;

    const skip = async (reason) => {
      this.log.debug({ ...tag, reason }, 'skip');
      await this.db.logOpportunity(opp, `skipped:${reason}`);
    };

    if (opp.sellVenue && opp.sellVenue !== 'steam') {
      // Нет API для выставления на Skinport/BUFF -> только сигнал человеку
      await this.db.logOpportunity(opp, 'signal');
      await this.notify.send(`📈 Сигнал ${opp.route}: ${opp.name}\nкупить ${fmtUsd(opp.buyPriceCents)} → продать ${fmtUsd(opp.sellPriceCents)}\nчистыми ${fmtUsd(opp.netProfitCents)} (${tag.roi}%)`);
      return;
    }
    if (opp.buyPriceCents > this.s.maxItemPriceCents) return skip('max_price');
    if (Date.now() - (this.lastBuy.get(opp.name) ?? 0) < ITEM_COOLDOWN_MS) return skip('cooldown');

    const spent = await this.db.spentTodayCents();
    if (spent + opp.costCashCents > this.s.dailyBudgetCents) {
      if (!this.budgetAlerted) await this.notify.send(`⛔ Дневной бюджет исчерпан: ${fmtUsd(spent)}`);
      this.budgetAlerted = true;
      return skip('budget');
    }

    // Свежая перепроверка
    const fresh = await this.#revalidate(appId, opp);
    if (!fresh || fresh.roi < this.s.minRoi) return skip('stale');

    if (this.cfg.dryRun) {
      await this.db.recordPurchase({ appId, opp: fresh, status: 'dry_run' });
      await this.db.logOpportunity(fresh, 'dry_run');
      await this.notify.send(`🧪 [DRY RUN] купил бы ${fresh.name} (${fresh.route}) за ${fmtUsd(fresh.buyPriceCents)}, ROI ${(fresh.roi * 100).toFixed(1)}%`);
      return;
    }

    this.lastBuy.set(opp.name, Date.now());
    try {
      const res = fresh.buyVenue === 'steam'
        ? await this.steam.buyListing(appId, fresh.name, fresh.listing)
        : await this.venues[fresh.buyVenue].buy(fresh.offer);
      const purchaseId = await this.db.recordPurchase({ appId, opp: fresh, status: 'bought', raw: res.raw });
      await this.db.addAwaitingInventory({ purchaseId, appId, name: fresh.name });
      await this.db.logOpportunity(fresh, 'bought');
      await this.notify.send(`✅ Куплено: ${fresh.name}\n${fresh.route} за ${fmtUsd(fresh.buyPriceCents)}\nожидаемый профит ${fmtUsd(fresh.netProfitCents)} (${(fresh.roi * 100).toFixed(1)}%)`);
    } catch (err) {
      this.log.error({ ...tag, err: err.message }, 'buy failed');
      await this.db.recordPurchase({ appId, opp: fresh, status: 'failed', raw: { error: err.message } });
      await this.notify.error(`Покупка ${fresh.name} не удалась: ${err.message}`);
    }
  }

  async #revalidate(appId, opp) {
    const listings = await this.steam.getListings(appId, opp.name, { count: 5 });
    const overview = await this.steam.priceOverview(appId, opp.name);
    const external = [];
    if (opp.buyVenue !== 'steam') {
      const venue = this.venues[opp.buyVenue];
      const [offer] = await venue.cheapestOffers(appId, opp.name, 1);
      if (offer) external.push({ venue, priceCents: offer.priceCents, buyable: true, offer });
    }
    const all = findOpportunities({ appId, name: opp.name, q: { steam: { listings, overview }, external }, s: this.s });
    return all.find((o) => o.route === opp.route) ?? null;
  }
}
