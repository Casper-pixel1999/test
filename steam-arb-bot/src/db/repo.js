import pg from 'pg';

export class Repo {
  constructor(connectionString) {
    this.pool = new pg.Pool({ connectionString, max: 5 });
  }

  async close() {
    await this.pool.end();
  }

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

  async recordPurchase({ appId, opp, status, raw = null }) {
    const externalId = String(opp.listing?.listingId ?? opp.offer?.offerId ?? `${Date.now()}`);
    const { rows } = await this.pool.query(
      `INSERT INTO purchases (venue, external_id, app_id, market_hash_name, cost_cents, cost_cash_cents, status, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (venue, external_id) DO UPDATE SET status = EXCLUDED.status, raw = EXCLUDED.raw
       RETURNING id`,
      [opp.buyVenue, `${status === 'dry_run' ? 'dry-' : ''}${externalId}`, appId, opp.name, opp.buyPriceCents, opp.costCashCents, status, raw],
    );
    return rows[0].id;
  }

  async spentTodayCents() {
    const { rows } = await this.pool.query(
      `SELECT coalesce(sum(cost_cash_cents), 0)::int AS s FROM purchases
       WHERE status = 'bought' AND created_at >= date_trunc('day', now())`,
    );
    return rows[0].s;
  }

  async addAwaitingInventory({ purchaseId, appId, name }) {
    await this.pool.query(
      `INSERT INTO inventory (purchase_id, app_id, market_hash_name, status) VALUES ($1,$2,$3,'awaiting')`,
      [purchaseId, appId, name],
    );
  }

  async awaitingSale(appId) {
    const { rows } = await this.pool.query(
      `SELECT i.id, i.market_hash_name, p.cost_cash_cents
       FROM inventory i JOIN purchases p ON p.id = i.purchase_id
       WHERE i.app_id = $1 AND i.status = 'awaiting' ORDER BY i.id`,
      [appId],
    );
    return rows;
  }

  async knownAssetIds() {
    const { rows } = await this.pool.query(`SELECT asset_id FROM inventory WHERE asset_id IS NOT NULL`);
    return rows.map((r) => r.asset_id);
  }

  async markListed(id, { assetId, priceCents, receivedCents }) {
    await this.pool.query(
      `UPDATE inventory SET status='listed', asset_id=$2, list_price_cents=$3, received_cents=$4,
         listed_at=now(), updated_at=now() WHERE id=$1`,
      [id, assetId, priceCents, receivedCents],
    );
  }

  async listedPositions(appId) {
    const { rows } = await this.pool.query(
      `SELECT id, asset_id, market_hash_name, received_cents FROM inventory WHERE app_id=$1 AND status='listed'`,
      [appId],
    );
    return rows;
  }

  async markSold(id) {
    await this.pool.query(`UPDATE inventory SET status='sold', sold_at=now(), updated_at=now() WHERE id=$1`, [id]);
  }
}
