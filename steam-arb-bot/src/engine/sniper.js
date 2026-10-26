import { fmtMoney, fmtUsd } from '../core/utils.js';
import { findOpportunities } from './arbitrage.js';

const ITEM_COOLDOWN_MS = 30 * 60_000;

/**
 * Авто-закупка. Порядок, устойчивый к падению процесса:
 *   1) запись purchases(status='pending') — ДО запроса на покупку;
 *   2) покупка;
 *   3) bought (+ позиция в inventory) или failed — одной транзакцией.
 * Если бот упал между 1 и 3, recoverPending() при старте выясняет исход по истории ТП.
 * Перед покупкой цена ОБЯЗАТЕЛЬНО перепроверяется свежим запросом.
 */
export class Sniper {
  constructor({ config, db, notifier, steamMarket, venues, scanner, logger }) {
    this.cfg = config;
    this.s = config.strategy;
    this.db = db;
    this.notify = notifier;
    this.steam = steamMarket;
    this.venues = venues; // { dmarket: DMarket, ... } — только площадки с API покупки
    this.scanner = scanner;
    this.log = logger.child({ mod: 'sniper' });
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
      await this.notify.send(`📈 Сигнал ${opp.route}: ${opp.name}\nкупить ${fmtMoney(opp.buyPriceCents, opp.buyCurrency)} → продать ${fmtUsd(opp.sellPriceCents)}\nчистыми ${fmtUsd(opp.netProfitCents)} (${tag.roi}%)`);
      return;
    }
    if (opp.buyUsdCents > this.s.maxItemPriceCents) return skip('max_price');
    const risk = this.#riskReason(opp);
    if (risk) return skip(risk);

    // В dry run считаем cooldown по dry_run-записям, иначе алерты повторялись бы каждый цикл
    const cooldownStatuses = this.cfg.dryRun ? ['dry_run'] : ['pending', 'bought', 'unknown'];
    if (await this.db.recentPurchaseExists(opp.name, cooldownStatuses, ITEM_COOLDOWN_MS)) return skip('cooldown');

    const spent = await this.db.spentTodayCents();
    if (spent + opp.costCashCents > this.s.dailyBudgetCents) {
      if (!this.budgetAlerted) await this.notify.send(`⛔ Дневной бюджет исчерпан: ${fmtUsd(spent)}`);
      this.budgetAlerted = true;
      return skip('budget');
    }

    const fresh = await this.#revalidate(appId, opp);
    if (!fresh || fresh.roi < this.s.minRoi) return skip('stale');
    const freshRisk = this.#riskReason(fresh);
    if (freshRisk) return skip(freshRisk);

    const purchaseId = await this.db.beginPurchase({ appId, opp: fresh, status: this.cfg.dryRun ? 'dry_run' : 'pending' });
    if (!purchaseId) return skip('duplicate');

    const price = fmtMoney(fresh.buyPriceCents, fresh.buyCurrency);
    if (this.cfg.dryRun) {
      await this.db.logOpportunity(fresh, 'dry_run');
      await this.notify.send(`🧪 [DRY RUN] купил бы ${fresh.name} (${fresh.route}) за ${price}, ROI ${(fresh.roi * 100).toFixed(1)}%`);
      return;
    }

    try {
      const res = fresh.buyVenue === 'steam'
        ? await this.steam.buyListing(appId, fresh.name, fresh.listing)
        : await this.venues[fresh.buyVenue].buy(fresh.offer);
      await this.db.completePurchase(purchaseId, 'bought', res.raw);
      await this.db.logOpportunity(fresh, 'bought');
      await this.notify.send(`✅ Куплено: ${fresh.name}\n${fresh.route} за ${price}\nожидаемый профит ${fmtUsd(fresh.netProfitCents)} (${(fresh.roi * 100).toFixed(1)}%)`);
    } catch (err) {
      this.log.error({ ...tag, err: err.message }, 'buy failed');
      await this.db.completePurchase(purchaseId, 'failed', { error: err.message });
      await this.notify.error(`Покупка ${fresh.name} не удалась: ${err.message}`);
    }
  }

  /**
   * Покупки, зависшие в pending после падения. Для Steam исход восстанавливается по истории ТП;
   * для остальных площадок — status=unknown и алерт на ручную проверку.
   */
  async recoverPending() {
    const pending = await this.db.pendingPurchases();
    if (!pending.length) return;
    let history = null;
    if (pending.some((p) => p.venue === 'steam')) {
      history = await this.steam.getHistory().catch((err) => (this.log.warn({ err: err.message }, 'history failed'), null));
    }
    for (const p of pending) {
      if (p.venue === 'steam' && history) {
        const bought = history.bought.some((b) => b.listingId === p.external_id);
        await this.db.completePurchase(p.id, bought ? 'bought' : 'failed', { recovered: true });
        await this.notify.send(`♻️ Восстановлена прерванная покупка ${p.market_hash_name}: ${bought ? 'куплено' : 'не куплено'}`);
        continue;
      }
      await this.db.completePurchase(p.id, 'unknown', { recovered: false });
      await this.notify.error(`Прерванная покупка ${p.market_hash_name} (${p.venue} ${p.external_id}): исход неизвестен, проверьте вручную`);
    }
  }

  /**
   * Отсекает сделки, прибыльные только «по медиане»:
   *  - worst_case: продажа в лучшую заявку прямо сейчас даёт убыток больше MAX_WORST_LOSS_PCT
   *    (или заявок нет вовсе, когда стакан известен);
   *  - illiquid: по объёму продаж наш лот с конкурентами продаётся дольше MAX_DAYS_TO_SELL.
   */
  #riskReason(opp) {
    if (opp.sellVenue && opp.sellVenue !== 'steam') return null;
    if (opp.worstRoi != null && opp.worstRoi < -this.s.maxWorstLoss) return 'worst_case';
    if (opp.worstRoi == null && opp.bookKnown) return 'worst_case';
    if (opp.daysToSell != null && opp.daysToSell > this.s.maxDaysToSell) return 'illiquid';
    return null;
  }

  async #revalidate(appId, opp) {
    const venues = opp.buyVenue === 'steam' ? [] : [opp.buyVenue];
    const q = await this.scanner.deepQuote(appId, opp.name, { venues });
    const all = findOpportunities({ appId, name: opp.name, q, s: this.s });
    return all.find((o) => o.route === opp.route) ?? null;
  }
}
