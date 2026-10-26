import { currencyName, parsePriceToCents } from '../core/utils.js';
import { receivedFor } from './fees.js';

const BASE = 'https://steamcommunity.com';
// Тип мобильного подтверждения "лот на торговой площадке" в steamcommunity
const CONF_TYPE_MARKET_LISTING = 3;
// Типы событий истории ТП (/market/myhistory)
const HISTORY_EVENT = { ListingCreated: 1, ListingCancelled: 2, ListingSold: 3, ListingPurchased: 4 };

export class SteamMarket {
  /**
   * @param {object} o
   * @param {import('../core/http.js').HttpClient} o.http
   * @param {import('./session.js').SteamSession} o.session
   */
  /** currency — валюта КОШЕЛЬКА аккаунта (ECurrencyCode): Steam принимает покупку только в ней. */
  constructor({ http, session, currency = 1, logger, nameIdStore = memoryStore() }) {
    this.http = http;
    this.nameIds = nameIdStore;
    this.session = session;
    this.currency = currency;
    this.currencyName = currencyName(currency);
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
      lowestCents: parsePriceToCents(r.lowest_price),
      medianCents: parsePriceToCents(r.median_price),
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

  /**
   * Широкий поиск: до 100 предметов за запрос, отсортированы по популярности.
   * sell_price — минимальная цена покупателя в центах USD (поиск не учитывает валюту кошелька),
   * поэтому результаты годятся только для предварительного отбора.
   */
  async searchPage(appId, start = 0, count = 100) {
    const url = `${BASE}/market/search/render/?query=&start=${start}&count=${count}&search_descriptions=0`
      + `&sort_column=popular&sort_dir=desc&appid=${appId}&norender=1`;
    const r = await this.http.request(url);
    if (!r?.success) return { items: [], total: 0 };
    return {
      total: r.total_count ?? 0,
      items: (r.results ?? []).map((it) => ({
        name: it.hash_name ?? it.asset_description?.market_hash_name ?? it.name,
        priceUsdCents: it.sell_price,
        listings: it.sell_listings ?? 0,
      })).filter((it) => it.name && it.priceUsdCents > 0),
    };
  }

  /**
   * item_nameid нужен для стакана. Он не меняется никогда, поэтому страница предмета
   * запрашивается один раз, а id кэшируется (в БД — через nameIdStore).
   */
  async getItemNameId(appId, name) {
    const cached = await this.nameIds.get(appId, name);
    if (cached) return cached;
    const html = await this.http.request(`${BASE}/market/listings/${appId}/${encodeURIComponent(name)}`, { as: 'text' });
    const m = html.match(/Market_LoadOrderSpread\(\s*(\d+)\s*\)/);
    if (!m) throw new Error(`item_nameid не найден для ${name}`);
    await this.nameIds.set(appId, name, m[1]);
    return m[1];
  }

  /**
   * Стакан заявок (цены — то, что платит покупатель, в валюте кошелька).
   * Графики Steam кумулятивные: [[цена, накопленное кол-во, подпись], ...] -> переводим в уровни.
   */
  async getOrderBook(appId, name) {
    const id = await this.getItemNameId(appId, name);
    const r = await this.http.request(`${BASE}/market/itemordershistogram?country=US&language=english`
      + `&currency=${this.currency}&item_nameid=${id}&two_factor=0&norender=1`);
    if (!r?.success) return null;
    const levels = (graph = []) => graph.map(([price, cum], i) => ({
      priceCents: Math.round(price * 100),
      qty: cum - (i > 0 ? graph[i - 1][1] : 0),
    })).filter((l) => l.qty > 0);
    return {
      asks: levels(r.sell_order_graph).sort((a, b) => a.priceCents - b.priceCents),
      bids: levels(r.buy_order_graph).sort((a, b) => b.priceCents - a.priceCents),
      highestBuyCents: r.highest_buy_order ? Number(r.highest_buy_order) : null,
      lowestSellCents: r.lowest_sell_order ? Number(r.lowest_sell_order) : null,
    };
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
   * Наши лоты на ТП: assetid -> listingid (активные, ждущие подтверждения и в холде).
   * Формат ответа недокументирован: assetid берём и из словаря assets, и из массивов лотов.
   */
  async getMyListings(appId, contextId = 2) {
    const r = await this.http.request(`${BASE}/market/mylistings/render/?start=0&count=100&norender=1`, {
      sticky: true, headers: { cookie: this.session.cookieHeader() },
    });
    const byAsset = new Map(Object.keys(r?.assets?.[appId]?.[contextId] ?? {}).map((id) => [id, null]));
    for (const l of [...(r?.listings ?? []), ...(r?.listings_to_confirm ?? []), ...(r?.listings_on_hold ?? [])]) {
      if (l?.asset?.id) byAsset.set(String(l.asset.id), l.listingid ? String(l.listingid) : null);
    }
    return byAsset;
  }

  /**
   * История ТП: наши покупки (listingid -> новый assetid в нашем инвентаре)
   * и наши продажи (listingid/assetid -> сколько фактически получили).
   */
  async getHistory({ count = 100 } = {}) {
    const r = await this.http.request(`${BASE}/market/myhistory/render/?query=&start=0&count=${count}&norender=1`, {
      sticky: true, headers: { cookie: this.session.cookieHeader() },
    });
    const purchases = r?.purchases ?? {};
    const bought = [];
    const sold = [];
    for (const e of r?.events ?? []) {
      const p = purchases[`${e.listingid}_${e.purchaseid}`];
      if (!p) continue;
      if (e.event_type === HISTORY_EVENT.ListingPurchased) {
        bought.push({ listingId: String(e.listingid), newAssetId: p.asset?.new_id ? String(p.asset.new_id) : null });
      } else if (e.event_type === HISTORY_EVENT.ListingSold) {
        sold.push({ listingId: String(e.listingid), assetId: p.asset?.id ? String(p.asset.id) : null, receivedCents: Number(p.received_amount) });
      }
    }
    return { bought, sold };
  }

  /**
   * Подтверждает РОВНО один лот: подтверждение типа "лот на ТП", чей creator == listingid.
   * Трейды и любые другие подтверждения не трогаются — главный вектор угона предметов.
   */
  async confirmListing(listingId) {
    const confs = await this.session.getConfirmations();
    const conf = confs.find((c) => c.type === CONF_TYPE_MARKET_LISTING && String(c.creator) === String(listingId));
    if (!conf) return false;
    await this.session.acceptConfirmation(conf);
    return true;
  }
}

function memoryStore() {
  const m = new Map();
  return {
    get: async (appId, name) => m.get(`${appId}|${name}`) ?? null,
    set: async (appId, name, id) => { m.set(`${appId}|${name}`, id); },
  };
}
