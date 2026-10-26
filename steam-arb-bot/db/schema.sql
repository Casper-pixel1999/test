-- Все денежные суммы — в центах USD (integer), чтобы не ловить ошибки float.

CREATE TABLE IF NOT EXISTS price_snapshots (
  id               BIGSERIAL PRIMARY KEY,
  source           TEXT        NOT NULL,          -- steam | skinport | buff | dmarket
  app_id           INTEGER     NOT NULL,
  market_hash_name TEXT        NOT NULL,
  price_cents      INTEGER     NOT NULL,          -- минимальная цена продажи (что платит покупатель)
  median_cents     INTEGER,
  volume           INTEGER,                       -- продажи за 24ч / кол-во лотов
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS price_snapshots_lookup
  ON price_snapshots (market_hash_name, source, fetched_at DESC);

CREATE TABLE IF NOT EXISTS opportunities (
  id               BIGSERIAL PRIMARY KEY,
  route            TEXT        NOT NULL,          -- steam->steam | dmarket->steam | steam->skinport ...
  market_hash_name TEXT        NOT NULL,
  buy_price_cents  INTEGER     NOT NULL,
  sell_price_cents INTEGER     NOT NULL,
  net_profit_cents INTEGER     NOT NULL,
  roi_pct          NUMERIC(8,2) NOT NULL,
  decision         TEXT        NOT NULL,          -- bought | dry_run | skipped:<reason> | signal
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchases (
  id               BIGSERIAL PRIMARY KEY,
  venue            TEXT        NOT NULL,
  external_id      TEXT        NOT NULL,          -- listing id / offer id площадки
  app_id           INTEGER     NOT NULL,
  market_hash_name TEXT        NOT NULL,
  cost_cents       INTEGER     NOT NULL,          -- полная стоимость с комиссиями, в валюте площадки
  cost_cash_cents  INTEGER     NOT NULL,          -- приведённая к реальным деньгам
  status           TEXT        NOT NULL,          -- bought | dry_run | failed
  raw              JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue, external_id)
);

CREATE TABLE IF NOT EXISTS inventory (
  id               BIGSERIAL PRIMARY KEY,
  purchase_id      BIGINT      REFERENCES purchases(id),
  app_id           INTEGER     NOT NULL,
  market_hash_name TEXT        NOT NULL,
  asset_id         TEXT,                          -- assetid в инвентаре Steam (появляется после зачисления)
  sell_venue       TEXT        NOT NULL DEFAULT 'steam',
  status           TEXT        NOT NULL,          -- awaiting | listed | sold | manual
  list_price_cents INTEGER,                       -- цена для покупателя
  received_cents   INTEGER,                       -- сколько получим после комиссий
  listed_at        TIMESTAMPTZ,
  sold_at          TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_asset_uniq ON inventory (asset_id) WHERE asset_id IS NOT NULL;

CREATE OR REPLACE VIEW daily_profit AS
SELECT date_trunc('day', i.sold_at)                   AS day,
       count(*)                                       AS items_sold,
       sum(i.received_cents)                          AS revenue_wallet_cents,
       sum(p.cost_cash_cents)                         AS cost_cash_cents
FROM inventory i
JOIN purchases p ON p.id = i.purchase_id
WHERE i.status = 'sold'
GROUP BY 1
ORDER BY 1 DESC;
