import { parseUsdToCents } from '../core/utils.js';
import { receivedFor } from './fees.js';

const BASE = 'https://steamcommunity.com';
// Тип мобильного подтверждения "лот на торговой площадке" в steamcommunity
const CONF_TYPE_MARKET_LISTING = 3;

export class SteamMarket {
  /**
   * @param {object} o
   * @param {import('../core/http.js').HttpClient} o.http
   * @param {import('./session.js').SteamSession} o.session
   */
  constructor({ http, session, currency = 1, logger }) {
    this.http = http;
    this.session = session;
    this.currency = currency;
    this.log = logger.child({ mod: 'steam-market' });
  }

  #authHeaders(referer) {
    return {
      cookie: this.session.cookieHeader(),
      origin: BASE,
      referer,
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    };
  }

  /** Публичный endpoint: минимальная цена, медиана и объём продаж за 24ч. */
  async priceOverview(appId, name) {
    const url = `${BASE}/market/priceoverview/?appid=${appId}&currency=${this.currency}&market_hash_name=${encodeURIComponent(name)}`;
    const r = await this.http.request(url);
    if (!r?.success) return null;
    return {
      lowestCents: parseUsdToCents(r.lowest_price),
      medianCents: parseUsdToCents(r.median_price),
      volume24h: r.volume ? Number(String(r.volume).replace(/,/g, '')) : 0,
    };
  }

  /**
   * Активные лоты (самые дешёвые первыми). totalCents — то, что реально спишется с кошелька.
   * Публичный запрос -> идёт через пул прокси.
   */
  async getListings(appId, name, { count = 10 } = {}) {
    const url = `${BASE}/market/listings/${appId}/${encodeURIComponent(name)}/render/`
      + `?start=0&count=${count}&currency=${this.currency}&language=english&country=US&format=json`;
    const r = await this.http.request(url);
    if (!r?.success || !r.listinginfo) return [];
    return Object.values(r.listinginfo)
      .filter((l) => l.converted_price > 0)
      .map((l) => ({
        listingId: l.listingid,
        subtotalCents: l.converted_price,
        feeCents: l.converted_fee,
        totalCents: l.converted_price + l.converted_fee,
      }))
      .sort((a, b) => a.totalCents - b.totalCents);
  }

  /** Покупка конкретного лота. Авторизованный запрос -> sticky IP аккаунта. */
  async buyListing(appId, name, listing) {
    const referer = `${BASE}/market/listings/${appId}/${encodeURIComponent(name)}`;
    const body = new URLSearchParams({
      sessionid: this.session.sessionID,
      currency: String(this.currency),
      subtotal: String(listing.subtotalCents),
      fee: String(listing.feeCents),
      total: String(listing.totalCents),
      quantity: '1',
      billing_state: '',
      save_my_address: '0',
    });
    const r = await this.http.request(`${BASE}/market/buylisting/${listing.listingId}`, {
      method: 'POST', sticky: true, headers: this.#authHeaders(referer), body: body.toString(),
    });

    // Покупка может потребовать мобильного подтверждения — подтверждаем ТОЛЬКО его, по id
    if (r?.need_confirmation && r.confirmation?.confirmation_id) {
      const confs = await this.session.getConfirmations();
      const conf = confs.find((c) => String(c.id) === String(r.confirmation.confirmation_id));
      if (!conf) throw new Error('Покупка требует подтверждения, но оно не найдено');
      await this.session.acceptConfirmation(conf);
      return { ok: true, confirmed: true, raw: r };
    }
    if (r?.wallet_info?.success !== 1) throw new Error(`buylisting failed: ${JSON.stringify(r).slice(0, 300)}`);
    return { ok: true, raw: r };
  }

  /** Инвентарь аккаунта (с cookies видно и непродаваемые пока предметы). */
  async getInventory(appId, contextId = 2) {
    const url = `${BASE}/inventory/${this.session.steamId}/${appId}/${contextId}?l=english&count=2000`;
    const r = await this.http.request(url, { sticky: true, headers: { cookie: this.session.cookieHeader() } });
    const descr = new Map((r?.descriptions ?? []).map((d) => [`${d.classid}_${d.instanceid}`, d]));
    return (r?.assets ?? []).map((a) => {
      const d = descr.get(`${a.classid}_${a.instanceid}`) ?? {};
      return {
        assetId: a.assetid,
        name: d.market_hash_name,
        marketable: d.marketable === 1,
        tradable: d.tradable === 1,
      };
    });
  }

  /**
   * Выставить предмет. Steam принимает price = сумма, которую получит ПРОДАВЕЦ (без комиссий).
   */
  async sellItem({ appId, contextId = 2, assetId, buyerPaysCents }) {
    const receivedCents = receivedFor(buyerPaysCents, appId);
    const body = new URLSearchParams({
      sessionid: this.session.sessionID,
      appid: String(appId),
      contextid: String(contextId),
      assetid: String(assetId),
      amount: '1',
      price: String(receivedCents),
    });
    const r = await this.http.request(`${BASE}/market/sellitem/`, {
      method: 'POST', sticky: true,
      headers: this.#authHeaders(`${BASE}/profiles/${this.session.steamId}/inventory/`),
      body: body.toString(),
    });
    if (!r?.success) throw new Error(`sellitem failed: ${r?.message ?? JSON.stringify(r).slice(0, 300)}`);
    return { receivedCents, needsConfirmation: Boolean(r.requires_confirmation || r.needs_mobile_confirmation) };
  }

  /**
   * Подтверждаем только лоты ТП, созданные ботом за последние 10 минут и совпадающие по названию.
   * Трейд-подтверждения не трогаем вообще — это главный вектор угона предметов.
   */
  async confirmOwnListings(names) {
    const freshAfter = Date.now() - 10 * 60_000;
    const confs = await this.session.getConfirmations();
    let confirmed = 0;
    for (const c of confs) {
      if (c.type !== CONF_TYPE_MARKET_LISTING) continue;
      if (c.timestamp && c.timestamp.getTime() < freshAfter) continue;
      const text = `${c.title} ${c.sending}`; // title = "<type_name> - <headline>"
      if (!names.some((n) => text.includes(n))) continue;
      await this.session.acceptConfirmation(c);
      confirmed++;
    }
    return confirmed;
  }

  /** assetid предметов, которые сейчас выставлены (или ждут подтверждения) на ТП. */
  async getListedAssetIds(appId, contextId = 2) {
    const r = await this.http.request(`${BASE}/market/mylistings/render/?start=0&count=100&norender=1`, {
      sticky: true, headers: { cookie: this.session.cookieHeader() },
    });
    // Формат ответа недокументирован: берём assetid и из словаря assets, и из массивов лотов
    const ids = new Set(Object.keys(r?.assets?.[appId]?.[contextId] ?? {}));
    for (const l of [...(r?.listings ?? []), ...(r?.listings_to_confirm ?? []), ...(r?.listings_on_hold ?? [])]) {
      if (l?.asset?.id) ids.add(String(l.asset.id));
    }
    return ids;
  }
}
