import { externalToSteam, steamToExternal } from './arbitrage.js';

const PAGE_SIZE = 100;

/**
 * Двухступенчатый сканер.
 *
 * Ступень 1 — screen(): дешёвый широкий отбор. Поиск Steam отдаёт 100 предметов за запрос
 * (минимальная цена в USD), Skinport — все цены одним запросом. По ним грубо оцениваем ROI
 * в обе стороны и берём лучших кандидатов. 10 страниц = 1000 самых популярных предметов
 * за 10 запросов к Steam.
 *
 * Ступень 2 — deepQuote(): полная котировка одного предмета (priceoverview + лоты + стакан
 * + сторонние площадки). Дорого (~3 запроса к Steam), поэтому только для кандидатов и watchlist.
 */
export class Scanner {
  constructor({ config, steamMarket, skinport = null, buff = null, dmarket = null, db = null, logger }) {
    this.cfg = config.scan;
    this.s = config.strategy;
    this.steam = steamMarket;
    this.skinport = skinport;
    this.buff = buff;
    this.dmarket = dmarket;
    this.db = db;
    this.log = logger.child({ mod: 'scanner' });
  }

  async screen(appId) {
    if (!this.skinport) return []; // без внешнего ориентира грубая оценка невозможна
    const ref = await this.skinport.prices(appId);
    // Поиск Steam — в USD, поэтому для оценки курс кошелька не нужен
    const s = { ...this.s, walletFx: 1 };
    const found = [];

    for (let page = 0; page < this.cfg.pages; page++) {
      const { items, total } = await this.steam.searchPage(appId, page * PAGE_SIZE, PAGE_SIZE);
      for (const it of items) {
        if (it.listings < this.cfg.minListings || it.priceUsdCents > this.s.maxItemPriceCents) continue;
        const ext = ref.get(it.name);
        if (!ext?.priceCents) continue;

        // Steam дешевле внешнего рынка: купить на Steam (перепродажа на Skinport или недооценённый лот)
        const cheapOnSteam = steamToExternal({ name: it.name, venue: this.skinport, buyTotalCents: it.priceUsdCents, sellPriceCents: ext.priceCents - 1, s });
        let best = { name: it.name, estRoi: cheapOnSteam.roi, route: cheapOnSteam.route };

        // Steam дороже: купить на DMarket (цена Skinport — приближение его цены) и продать на Steam
        if (this.dmarket) {
          const dearOnSteam = externalToSteam({ appId, name: it.name, venue: this.dmarket, buyPriceCents: ext.priceCents, sellBuyerPaysCents: it.priceUsdCents - 1, s });
          if (dearOnSteam.roi > best.estRoi) best = { name: it.name, estRoi: dearOnSteam.roi, route: dearOnSteam.route };
        }
        if (best.estRoi >= this.s.minRoi * this.cfg.roiFactor) found.push(best);
      }
      if ((page + 1) * PAGE_SIZE >= total) break;
    }

    const top = found.sort((a, b) => b.estRoi - a.estRoi).slice(0, this.cfg.deepPerCycle);
    this.log.info({ screened: found.length, picked: top.length }, 'screening done');
    return top;
  }

  /**
   * Полная котировка. venues: какие сторонние площадки опрашивать (по умолчанию все включённые).
   * Стакан необязателен: при ошибке арбитраж посчитается по лотам, но без worst-case оценки.
   */
  async deepQuote(appId, name, { venues = ['skinport', 'buff', 'dmarket'] } = {}) {
    const overview = await this.steam.priceOverview(appId, name);
    const listings = await this.steam.getListings(appId, name, { count: 10 });
    const book = await this.steam.getOrderBook(appId, name).catch((err) => {
      this.log.warn({ name, err: err.message }, 'order book unavailable');
      return null;
    });

    const external = [];
    if (this.skinport && venues.includes('skinport')) {
      const sp = (await this.skinport.prices(appId).catch(() => new Map())).get(name);
      if (sp) external.push({ venue: this.skinport, priceCents: sp.priceCents, volume: sp.volume, buyable: false });
    }
    if (this.buff && venues.includes('buff')) {
      const bp = await this.buff.price(appId, name).catch(() => null);
      if (bp) external.push({ venue: this.buff, priceCents: bp.priceCents, volume: bp.volume, buyable: false });
    }
    if (this.dmarket && venues.includes('dmarket')) {
      const [offer] = await this.dmarket.cheapestOffers(appId, name, 1);
      if (offer) external.push({ venue: this.dmarket, priceCents: offer.priceCents, buyable: true, offer });
    }

    if (this.db) {
      if (overview?.lowestCents) {
        await this.db.savePrices(`steam:${this.s.walletCurrency ?? 'USD'}`, appId,
          [{ name, priceCents: overview.lowestCents, medianCents: overview.medianCents, volume: overview.volume24h }]);
      }
      for (const e of external) await this.db.savePrices(e.venue.name, appId, [{ name, priceCents: e.priceCents, volume: e.volume }]);
    }
    return { steam: { overview, listings, book }, external };
  }
}
