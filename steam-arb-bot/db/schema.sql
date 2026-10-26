-- Денежные суммы — в минимальных единицах (центах/копейках), integer.
-- *_cash_cents — приведено к РЕАЛЬНЫМ USD (с учётом курса кошелька и его "стоимости").

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
  net_profit_cents INTEGER     NOT NULL,          -- USD cash
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
  currency         TEXT        NOT NULL,          -- валюта cost_cents (USD, RUB, ...)
  cost_cash_cents  INTEGER     NOT NULL,          -- реальные USD
  -- pending: запись создана ДО запроса покупки; bought | failed | dry_run;
  -- unknown: бот упал посреди покупки и исход не удалось установить — проверить вручную
  status           TEXT        NOT NULL,
  raw              JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue, external_id)
);
CREATE INDEX IF NOT EXISTS purchases_cooldown ON purchases (market_hash_name, created_at DESC);

-- Все assetid, которые бот когда-либо видел в инвентаре. Предмет, увиденный ДО покупки,
-- не может быть купленным предметом -> бот не продаст ваш личный инвентарь.
CREATE TABLE IF NOT EXISTS seen_assets (
  asset_id         TEXT        PRIMARY KEY,
  app_id           INTEGER     NOT NULL,
  market_hash_name TEXT,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory (
  id                  BIGSERIAL PRIMARY KEY,
  purchase_id         BIGINT      NOT NULL REFERENCES purchases(id),
  app_id              INTEGER     NOT NULL,
  market_hash_name    TEXT        NOT NULL,
  asset_id            TEXT,                       -- assetid купленного предмета в инвентаре Steam
  listing_id          TEXT,                       -- id лота на ТП
  -- awaiting: ждёт зачисления/конца холда; listed; sold;
  -- manual: лот сняли вручную, бот предмет больше не трогает; gone: пропал без продажи
  status              TEXT        NOT NULL,
  list_price_cents    INTEGER,                    -- цена для покупателя (валюта кошелька)
  received_cents      INTEGER,                    -- ожидаемо к получению (валюта кошелька)
  sold_received_cents INTEGER,                    -- фактически получено по истории ТП
  sold_cash_cents     INTEGER,                    -- фактически получено, реальные USD
  listed_at           TIMESTAMPTZ,
  sold_at             TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_asset_uniq ON inventory (asset_id) WHERE asset_id IS NOT NULL;

DROP VIEW IF EXISTS daily_profit;
CREATE VIEW daily_profit AS
SELECT date_trunc('day', i.sold_at)                     AS day,
       count(*)                                         AS items_sold,
       sum(i.sold_cash_cents)                           AS revenue_cash_cents,
       sum(p.cost_cash_cents)                           AS cost_cash_cents,
       sum(i.sold_cash_cents) - sum(p.cost_cash_cents)  AS profit_cash_cents
FROM inventory i
JOIN purchases p ON p.id = i.purchase_id
WHERE i.status = 'sold'
GROUP BY 1
ORDER BY 1 DESC;
