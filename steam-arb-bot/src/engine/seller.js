import { fmtMoney, fmtUsd } from '../core/utils.js';
import { buyerPaysFor } from '../steam/fees.js';
import { estimateSteamExit, walletToCash } from './arbitrage.js';

const GONE_AFTER_MS = 60 * 60_000;

/**
 * Авто-продажа на ТП Steam. Один цикл run():
 *  1) syncInventory — все assetid запоминаются в seen_assets (то, что было ДО покупки, — не наше);
 *  2) resolveAssets — купленной позиции назначается ТОЧНЫЙ assetid:
 *     покупка на SCM -> new_id из истории ТП; иначе -> предмет, впервые появившийся ПОСЛЕ покупки;
 *  3) listReady — выставляем то, что стало marketable, и подтверждаем лот строго по его listingid;
 *  4) reconcile — продажа фиксируется только по событию в истории ТП с фактической суммой.
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

  get cur() {
    return this.market.currencyName ?? 'USD';
  }

  async syncInventory(appId) {
    const inventory = await this.market.getInventory(appId);
    await this.db.upsertSeenAssets(appId, inventory);
    return inventory;
  }

  async run(appId) {
    const inventory = await this.syncInventory(appId);
    let history = null; // запрашиваем лениво и не больше одного раза за цикл
    const getHistory = async () => (history ??= await this.market.getHistory());

    await this.#resolveAssets(appId, getHistory);
    await this.#listReady(appId, inventory);
    await this.#reconcile(appId, inventory, getHistory);
  }

  async #resolveAssets(appId, getHistory) {
    const pending = await this.db.awaitingWithoutAsset(appId);
    if (!pending.length) return;
    const taken = new Set(await this.db.knownAssetIds());

    for (const p of pending) {
      let assetId = null;
      if (p.venue === 'steam') {
        const h = await getHistory().catch((err) => (this.log.warn({ err: err.message }, 'history failed'), null));
        const b = h?.bought.find((x) => x.listingId === p.external_id);
        if (b?.newAssetId && !taken.has(b.newAssetId)) assetId = b.newAssetId;
      }
      if (!assetId) {
        const candidates = await this.db.newAssetsSince(appId, p.market_hash_name, p.purchased_at);
        assetId = candidates.find((id) => !taken.has(id)) ?? null;
      }
      if (!assetId) continue; // ещё не зачислен
      taken.add(assetId);
      await this.db.assignAsset(p.id, assetId);
      this.log.info({ name: p.market_hash_name, assetId }, 'asset resolved');
    }
  }

  async #listReady(appId, inventory) {
    const ready = await this.db.readyToList(appId);
    const byId = new Map(inventory.map((a) => [a.assetId, a]));

    for (const pos of ready) {
      if (!byId.get(pos.asset_id)?.marketable) continue; // в холде или ещё не пришёл

      const overview = await this.market.priceOverview(appId, pos.market_hash_name);
      const listings = await this.market.getListings(appId, pos.market_hash_name, { count: 5 });
      const book = await this.market.getOrderBook(appId, pos.market_hash_name).catch(() => null);
      // ниже лучшего лота на 1 цент, не выше медианы и не ниже лучшей заявки на покупку
      const { targetCents: target } = estimateSteamExit({ book, overview, listings });

      // Пол: себестоимость (реальные USD -> единицы кошелька) + маржа ПОСЛЕ комиссий Steam
      const minReceived = Math.ceil((pos.cost_cash_cents / (this.s.walletFx * this.s.walletValue)) * (1 + this.s.minSellMargin));
      const floor = buyerPaysFor(minReceived, appId);
      const price = Math.max(target ?? floor, floor);

      if (this.cfg.dryRun) {
        this.log.info({ name: pos.market_hash_name, price, floor }, '[DRY RUN] would list');
        continue;
      }
      try {
        const { receivedCents, needsConfirmation } = await this.market.sellItem({ appId, assetId: pos.asset_id, buyerPaysCents: price });
        const listingId = (await this.market.getMyListings(appId)).get(pos.asset_id) ?? null;
        await this.db.markListed(pos.id, { priceCents: price, receivedCents, listingId });

        if (needsConfirmation) {
          const ok = listingId && (await this.market.confirmListing(listingId));
          if (!ok) await this.notify.error(`Лот ${pos.market_hash_name} ждёт подтверждения, но его listingid не найден — подтвердите вручную`);
        }
        await this.notify.send(`🏷 Выставлено: ${pos.market_hash_name} за ${fmtMoney(price, this.cur)} (получим ${fmtMoney(receivedCents, this.cur)})${price === floor ? ' — по полу цены' : ''}`);
      } catch (err) {
        this.log.error({ name: pos.market_hash_name, err: err.message }, 'listing failed');
        await this.notify.error(`Не удалось выставить ${pos.market_hash_name}: ${err.message}`);
      }
    }
  }

  async #reconcile(appId, inventory, getHistory) {
    const listed = await this.db.listedPositions(appId);
    if (!listed.length) return;
    const history = await getHistory();
    const onMarket = await this.market.getMyListings(appId);
    const inInventory = new Set(inventory.map((a) => a.assetId));

    for (const pos of listed) {
      const sale = history.sold.find((x) => (pos.listing_id && x.listingId === pos.listing_id) || x.assetId === pos.asset_id);
      if (sale) {
        const cashCents = Math.round(walletToCash(sale.receivedCents, this.s));
        await this.db.markSold(pos.id, { receivedCents: sale.receivedCents, cashCents });
        await this.notify.send(`💰 Продано: ${pos.market_hash_name} — ${fmtMoney(sale.receivedCents, this.cur)} на кошелёк (≈${fmtUsd(cashCents)})`);
        continue;
      }
      if (onMarket.has(pos.asset_id)) {
        const listingId = onMarket.get(pos.asset_id);
        if (listingId && !pos.listing_id) await this.db.setListingId(pos.id, listingId);
        continue;
      }
      if (inInventory.has(pos.asset_id)) {
        // Лот сняли вручную: бот предмет больше не трогает
        await this.db.setStatus(pos.id, 'manual');
        await this.notify.send(`✋ Лот ${pos.market_hash_name} снят вручную — бот больше не управляет этим предметом`);
        continue;
      }
      // Нет ни продажи в истории, ни лота, ни предмета (например, отдан трейдом)
      if (Date.now() - new Date(pos.listed_at).getTime() > GONE_AFTER_MS) {
        await this.db.setStatus(pos.id, 'gone');
        await this.notify.error(`${pos.market_hash_name} (asset ${pos.asset_id}) пропал без продажи — проверьте аккаунт`);
      }
    }
  }
}
