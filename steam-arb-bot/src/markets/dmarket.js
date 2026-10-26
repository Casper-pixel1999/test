import nacl from 'tweetnacl';

const BASE = 'https://api.dmarket.com';
// Идентификаторы игр DMarket — сверяйте с актуальной документацией docs.dmarket.com
const GAME_ID = { 730: 'a8db', 570: '9a92', 252490: 'rust' };

/**
 * DMarket — официальный торговый API с подписью Ed25519.
 * Подпись: ed25519(secretKey, METHOD + PATH_WITH_QUERY + BODY + TIMESTAMP).
 * Используется как площадка ПОКУПКИ для маршрута dmarket -> steam.
 * Купленные предметы попадают в инвентарь DMarket; вывод в Steam приходит трейд-оффером,
 * который SteamSession примет автоматически (мы ничего не отдаём).
 */
export class DMarket {
  name = 'dmarket';

  constructor({ http, fees, publicKey, secretKey, logger }) {
    this.http = http;
    this.fees = fees;
    this.publicKey = publicKey;
    this.secretKey = secretKey ? Buffer.from(secretKey, 'hex') : null; // 64 байта: seed + public
    this.log = logger.child({ mod: 'dmarket' });
  }

  #signedHeaders(method, pathWithQuery, body = '') {
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = nacl.sign.detached(Buffer.from(method + pathWithQuery + body + ts), this.secretKey);
    return {
      'X-Api-Key': this.publicKey,
      'X-Sign-Date': ts,
      'X-Request-Sign': `dmar ed25519 ${Buffer.from(sig).toString('hex')}`,
      'content-type': 'application/json',
    };
  }

  async #call(method, path, bodyObj) {
    const body = bodyObj ? JSON.stringify(bodyObj) : '';
    return this.http.request(BASE + path, {
      method,
      headers: this.#signedHeaders(method, path, body),
      body: body || undefined,
    });
  }

  /** Самые дешёвые офферы с точным совпадением названия. */
  async cheapestOffers(appId, name, limit = 5) {
    const q = new URLSearchParams({
      gameId: GAME_ID[appId], title: name, currency: 'USD', limit: String(limit * 4),
      orderBy: 'price', orderDir: 'asc',
    });
    const r = await this.#call('GET', `/exchange/v1/market/items?${q}`);
    return (r?.objects ?? [])
      .filter((o) => o.title === name)
      .slice(0, limit)
      .map((o) => ({ offerId: o.extra?.offerId ?? o.itemId, priceCents: Number(o.price?.USD) }));
  }

  async buy(offer) {
    const r = await this.#call('PATCH', '/exchange/v1/offers-buy', {
      offers: [{ offerId: offer.offerId, price: { amount: (offer.priceCents / 100).toFixed(2), currency: 'USD' }, type: 'dmarket' }],
    });
    if (r?.status && r.status !== 'TxSuccess' && r.status !== 'TxPending') {
      throw new Error(`DMarket buy failed: ${JSON.stringify(r).slice(0, 300)}`);
    }
    return { ok: true, raw: r };
  }
}
