import pg from 'pg';

export class Repo {
  constructor(connectionString) {
    this.pool = new pg.Pool({ connectionString, max: 5 });
  }

  async close() {
    await this.pool.end();
  }

  // ─── Цены и возможности ──────────────────────────────────────────────

  async savePrices(source, appId, rows) {
    if (!rows.length) return;
    await this.pool.query(
      `INSERT INTO price_snapshots (source, app_id, market_hash_name, price_cents, median_cents, volume)
       SELECT $1, $2, * FROM unnest($3::text[], $4::int[], $5::int[], $6::int[])`,
      [source, appId, rows.map((r) => r.name), rows.map((r) => r.priceCents),
        rows.map((r) => r.medianCents ?? null), rows.map((r) => r.volume ?? null)],
    );
  }

  async logOpportunity(o, decision) {
    await this.pool.query(
      `INSERT INTO opportunities (route, market_hash_name, buy_price_cents, sell_price_cents, net_profit_cents, roi_pct, decision)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [o.route, o.name, o.buyPriceCents, o.sellPriceCents, o.netProfitCents, (o.roi * 100).toFixed(2), decision],
    );
  }

  /** Хранилище item_nameid для SteamMarket. */
  nameIdStore() {
    return {
      get: async (appId, name) => (await this.pool.query(
        'SELECT item_nameid FROM item_nameids WHERE app_id=$1 AND market_hash_name=$2', [appId, name])).rows[0]?.item_nameid ?? null,
      set: async (appId, name, id) => { await this.pool.query(
        `INSERT INTO item_nameids (app_id, market_hash_name, item_nameid) VALUES ($1,$2,$3)
         ON CONFLICT (app_id, market_hash_name) DO UPDATE SET item_nameid = EXCLUDED.item_nameid`, [appId, name, id]); },
    };
  }

  // ─── Покупки ─────────────────────────────────────────────────────────

  /**
   * Создаёт запись ДО запроса на покупку. Возвращает id или null, если этот лот уже покупался
   * (UNIQUE venue+external_id) — защита от двойной покупки.
   */
  async beginPurchase({ appId, opp, status }) {
    const externalId = String(opp.listing?.listingId ?? opp.offer?.offerId);
    const { rows } = await this.pool.query(
      `INSERT INTO purchases (venue, external_id, app_id, market_hash_name, cost_cents, currency, cost_cash_cents, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (venue, external_id) DO NOTHING
       RETURNING id`,
      [opp.buyVenue, `${status === 'dry_run' ? 'dry-' : ''}${externalId}`, appId, opp.name,
        opp.buyPriceCents, opp.buyCurrency, opp.costCashCents, status],
    );
    return rows[0]?.id ?? null;
  }

  /** Атомарно: статус покупки + (при успехе) позиция в инвентаре на продажу. */
  async completePurchase(id, status, raw = null) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [p] } = await client.query(
        `UPDATE purchases SET status=$2, raw=$3 WHERE id=$1 RETURNING app_id, market_hash_name`, [id, status, raw]);
      if (status === 'bought') {
        await client.query(
          `INSERT INTO inventory (purchase_id, app_id, market_hash_name, status) VALUES ($1,$2,$3,'awaiting')`,
          [id, p.app_id, p.market_hash_name]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async pendingPurchases() {
    const { rows } = await this.pool.query(
      `SELECT id, venue, external_id, market_hash_name FROM purchases WHERE status='pending' ORDER BY id`);
    return rows;
  }

  /** Cooldown хранится в БД -> переживает перезапуск бота. */
  async recentPurchaseExists(name, statuses, ms) {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM purchases WHERE market_hash_name=$1 AND status = ANY($2)
         AND created_at > now() - make_interval(secs => $3) LIMIT 1`,
      [name, statuses, ms / 1000]);
    return rows.length > 0;
  }

  /** pending тоже считается: деньги, возможно, уже списаны. */
  async spentTodayCents() {
    const { rows } = await this.pool.query(
      `SELECT coalesce(sum(cost_cash_cents), 0)::int AS s FROM purchases
       WHERE status IN ('bought','pending','unknown') AND created_at >= date_trunc('day', now())`);
    return rows[0].s;
  }

  // ─── Инвентарь ───────────────────────────────────────────────────────

  /** Запоминает все assetid инвентаря; first_seen_at ставится только при первом появлении. */
  async upsertSeenAssets(appId, assets) {
    if (!assets.length) return;
    await this.pool.query(
      `INSERT INTO seen_assets (asset_id, app_id, market_hash_name)
       SELECT a, $1, n FROM unnest($2::text[], $3::text[]) AS t(a, n)
       ON CONFLICT (asset_id) DO NOTHING`,
      [appId, assets.map((a) => a.assetId), assets.map((a) => a.name ?? null)]);
  }

  /** Позиции, для которых ещё не найден assetid. */
  async awaitingWithoutAsset(appId) {
    const { rows } = await this.pool.query(
      `SELECT i.id, i.market_hash_name, p.venue, p.external_id, p.created_at AS purchased_at
       FROM inventory i JOIN purchases p ON p.id = i.purchase_id
       WHERE i.app_id=$1 AND i.status='awaiting' AND i.asset_id IS NULL ORDER BY i.id`, [appId]);
    return rows;
  }

  /** Кандидаты для позиции: такое же название, впервые увидены ПОСЛЕ покупки и никому не назначены. */
  async newAssetsSince(appId, name, since) {
    const { rows } = await this.pool.query(
      `SELECT s.asset_id FROM seen_assets s
       WHERE s.app_id=$1 AND s.market_hash_name=$2 AND s.first_seen_at > $3
         AND NOT EXISTS (SELECT 1 FROM inventory i WHERE i.asset_id = s.asset_id)
       ORDER BY s.first_seen_at, s.asset_id`, [appId, name, since]);
    return rows.map((r) => r.asset_id);
  }

  async knownAssetIds() {
    const { rows } = await this.pool.query(`SELECT asset_id FROM inventory WHERE asset_id IS NOT NULL`);
    return rows.map((r) => r.asset_id);
  }

  async assignAsset(id, assetId) {
    await this.pool.query(`UPDATE inventory SET asset_id=$2, updated_at=now() WHERE id=$1`, [id, assetId]);
  }

  async readyToList(appId) {
    const { rows } = await this.pool.query(
      `SELECT i.id, i.market_hash_name, i.asset_id, p.cost_cash_cents
       FROM inventory i JOIN purchases p ON p.id = i.purchase_id
       WHERE i.app_id=$1 AND i.status='awaiting' AND i.asset_id IS NOT NULL ORDER BY i.id`, [appId]);
    return rows;
  }

  async markListed(id, { priceCents, receivedCents, listingId }) {
    await this.pool.query(
      `UPDATE inventory SET status='listed', list_price_cents=$2, received_cents=$3, listing_id=$4,
         listed_at=now(), updated_at=now() WHERE id=$1`,
      [id, priceCents, receivedCents, listingId ?? null]);
  }

  async setListingId(id, listingId) {
    await this.pool.query(`UPDATE inventory SET listing_id=$2, updated_at=now() WHERE id=$1`, [id, listingId]);
  }

  async listedPositions(appId) {
    const { rows } = await this.pool.query(
      `SELECT id, asset_id, listing_id, market_hash_name, received_cents, listed_at
       FROM inventory WHERE app_id=$1 AND status='listed' ORDER BY id`, [appId]);
    return rows;
  }

  async markSold(id, { receivedCents, cashCents }) {
    await this.pool.query(
      `UPDATE inventory SET status='sold', sold_received_cents=$2, sold_cash_cents=$3, sold_at=now(), updated_at=now()
       WHERE id=$1`, [id, receivedCents, cashCents]);
  }

  async setStatus(id, status) {
    await this.pool.query(`UPDATE inventory SET status=$2, updated_at=now() WHERE id=$1`, [id, status]);
  }
}
