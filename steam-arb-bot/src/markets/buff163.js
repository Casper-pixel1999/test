const API = 'https://buff.163.com/api/market/goods';
const GAME = { 730: 'csgo', 570: 'dota2', 252490: 'rust' };

/**
 * BUFF163 не имеет официального публичного API. Используем внутренний JSON-endpoint сайта
 * с cookie session (только ЧТЕНИЕ). Цены в CNY -> переводим в USD.
 * Endpoint и формат могут меняться без предупреждения; держите частоту низкой (1 запрос / 3-5 с),
 * иначе аккаунт BUFF получит ограничение.
 */
export class Buff163 {
  name = 'buff';

  constructor({ http, fees, sessionCookie, cnyUsdRate, logger }) {
    this.http = http;
    this.fees = fees;
    this.cookie = sessionCookie;
    this.rate = cnyUsdRate;
    this.log = logger.child({ mod: 'buff163' });
  }

  /** Цена конкретного предмета (поиск по названию). */
  async price(appId, name) {
    const url = `${API}?game=${GAME[appId]}&page_num=1&page_size=20&search=${encodeURIComponent(name)}`;
    const r = await this.http.request(url, {
      headers: { cookie: this.cookie, 'x-requested-with': 'XMLHttpRequest', referer: 'https://buff.163.com/market/' },
    });
    if (r?.code !== 'OK') {
      this.log.warn({ code: r?.code }, 'buff returned non-OK (cookie протух?)');
      return null;
    }
    const it = r.data?.items?.find((x) => x.market_hash_name === name);
    if (!it || !it.sell_min_price) return null;
    return {
      priceCents: Math.round(Number(it.sell_min_price) * this.rate * 100),
      buyOrderCents: it.buy_max_price ? Math.round(Number(it.buy_max_price) * this.rate * 100) : null,
      volume: it.sell_num ?? 0,
    };
  }
}
