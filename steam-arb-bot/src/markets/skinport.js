const API = 'https://api.skinport.com/v1/items';
const CACHE_MS = 5 * 60_000; // Skinport сам кэширует ответ на 5 минут — чаще ходить бессмысленно

/**
 * Skinport public API: одним запросом отдаёт ВСЕ предметы игры с минимальной ценой.
 * Требует заголовок Accept-Encoding: br. Лимит — 8 запросов / 5 минут.
 * Покупка через публичный API не поддерживается -> Skinport используется как источник цены
 * и площадка для продажи (маршрут steam -> skinport даёт сигнал в Telegram).
 */
export class Skinport {
  name = 'skinport';

  constructor({ http, fees, logger }) {
    this.http = http;
    this.fees = fees;
    this.log = logger.child({ mod: 'skinport' });
    this.cache = new Map(); // appId -> { at, map }
  }

  async prices(appId, currency = 'USD') {
    const hit = this.cache.get(appId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.map;

    const items = await this.http.request(`${API}?app_id=${appId}&currency=${currency}&tradable=0`, {
      headers: { 'accept-encoding': 'br', accept: 'application/json' },
    });
    const map = new Map();
    for (const it of items ?? []) {
      if (it.min_price == null) continue;
      map.set(it.market_hash_name, {
        priceCents: Math.round(it.min_price * 100),
        medianCents: it.median_price != null ? Math.round(it.median_price * 100) : null,
        volume: it.quantity ?? 0,
      });
    }
    this.cache.set(appId, { at: Date.now(), map });
    this.log.debug({ appId, items: map.size }, 'prices refreshed');
    return map;
  }
}
