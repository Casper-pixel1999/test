import { fmtUsd } from '../core/utils.js';
import { buyerPaysFor } from '../steam/fees.js';
import { competitiveSteamPrice } from './arbitrage.js';

/**
 * Авто-продажа на ТП Steam:
 *  1) находим купленные позиции, которые уже появились в инвентаре и стали marketable
 *     (в CS2 после покупки действует холд — до этого просто ждём);
 *  2) считаем конкурентную цену, но не ниже "пола" = себестоимость + минимальная маржа;
 *  3) выставляем и подтверждаем ТОЛЬКО свой лот через identity_secret.
 */
export class AutoSeller {
  constructor({ config, db, notifier, steamMarket, logger }) {
    this.cfg = config;
    this.s = config.strategy;
    this.db = db;
    this.notify = notifier;
    this.market = steamMarket;
    this.log = logger.child({ mod: 'seller' });
  }

  async run(appId) {
    const positions = await this.db.awaitingSale(appId);
    if (!positions.length) return;

    const inventory = await this.market.getInventory(appId);
    const taken = new Set(await this.db.knownAssetIds());
    const listedNames = [];

    for (const pos of positions) {
      const asset = inventory.find((a) => a.name === pos.market_hash_name && a.marketable && !taken.has(a.assetId));
      if (!asset) continue; // ещё не пришёл или в холде
      taken.add(asset.assetId);

      const overview = await this.market.priceOverview(appId, pos.market_hash_name);
      const listings = await this.market.getListings(appId, pos.market_hash_name, { count: 5 });
      const target = competitiveSteamPrice({ lowestCents: listings[0]?.totalCents, medianCents: overview?.medianCents });

      // Пол: чтобы получить себестоимость(в кошельковых $) + маржу ПОСЛЕ комиссий Steam
      const minReceived = Math.ceil((pos.cost_cash_cents / this.s.walletValue) * (1 + this.s.minSellMargin));
      const floor = buyerPaysFor(minReceived, appId);
      const price = Math.max(target ?? floor, floor);

      if (this.cfg.dryRun) {
        this.log.info({ name: pos.market_hash_name, price, floor }, '[DRY RUN] would list');
        continue;
      }
      try {
        const { receivedCents, needsConfirmation } = await this.market.sellItem({ appId, assetId: asset.assetId, buyerPaysCents: price });
        await this.db.markListed(pos.id, { assetId: asset.assetId, priceCents: price, receivedCents });
        if (needsConfirmation) listedNames.push(pos.market_hash_name);
        await this.notify.send(`🏷 Выставлено: ${pos.market_hash_name} за ${fmtUsd(price)} (получим ${fmtUsd(receivedCents)})${price === floor ? ' — по полу цены' : ''}`);
      } catch (err) {
        this.log.error({ name: pos.market_hash_name, err: err.message }, 'listing failed');
        await this.notify.error(`Не удалось выставить ${pos.market_hash_name}: ${err.message}`);
      }
    }

    if (listedNames.length) {
      const n = await this.market.confirmOwnListings(listedNames);
      this.log.info({ confirmed: n, expected: listedNames.length }, 'listings confirmed');
    }
  }

  /** Лот исчез и с ТП, и из инвентаря -> продан. */
  async reconcileSold(appId) {
    const listed = await this.db.listedPositions(appId);
    if (!listed.length) return;
    const onMarket = await this.market.getListedAssetIds(appId);
    const inInventory = new Set((await this.market.getInventory(appId)).map((a) => a.assetId));
    for (const pos of listed) {
      if (onMarket.has(pos.asset_id) || inInventory.has(pos.asset_id)) continue;
      await this.db.markSold(pos.id);
      await this.notify.send(`💰 Продано: ${pos.market_hash_name} — ${fmtUsd(pos.received_cents)} на кошелёк`);
    }
  }
}
