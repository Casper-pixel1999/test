import { receivedFor } from '../steam/fees.js';

/**
 * Калькулятор арбитража.
 * Цены Steam — в минимальных единицах ВАЛЮТЫ КОШЕЛЬКА, цены сторонних площадок — в центах USD.
 * Результат (cost/revenue/profit) — в центах РЕАЛЬНЫХ USD.
 *
 * Параметры стратегии `s`:
 *  - walletFx: сколько USD стоит 1 единица валюты кошелька (1 для USD-кошелька);
 *  - walletValue: деньги кошелька Steam нельзя вывести. $1 кошелька обычно стоит
 *    0.65–0.80$ реальных денег. Покупка ЗА кошелёк дешевле, продажа ЗА кошелёк — "дешевле" в кэше;
 *  - holdRisk: в CS2 купленный предмет нельзя сразу перепродать (холд/Trade Protection ~7 дней),
 *    цена может уйти. Дисконтируем ожидаемую выручку.
 * Плюс кэшаут-комиссия сторонней площадки (вывод на карту/крипту/PayPal).
 */

const result = (route, name, costCash, revenueCash, extra) => {
  const netProfitCents = Math.round(revenueCash - costCash);
  return {
    route,
    name,
    costCashCents: Math.round(costCash),
    revenueCashCents: Math.round(revenueCash),
    netProfitCents,
    roi: costCash > 0 ? netProfitCents / costCash : 0,
    ...extra,
  };
};

/** Единицы кошелька -> реальные USD-центы. */
export const walletToCash = (walletCents, s) => walletCents * s.walletFx * s.walletValue;

/** Покупка на ТП Steam -> продажа на ТП Steam (снайпинг лотов, выставленных ниже рынка). */
export function steamToSteam({ appId, name, buyTotalCents, sellBuyerPaysCents, s }) {
  const received = receivedFor(sellBuyerPaysCents, appId);
  return result('steam->steam', name, walletToCash(buyTotalCents, s), walletToCash(received, s) * (1 - s.holdRisk), {
    buyPriceCents: buyTotalCents, buyCurrency: s.walletCurrency ?? 'USD', buyUsdCents: Math.round(buyTotalCents * s.walletFx),
    sellPriceCents: sellBuyerPaysCents,
  });
}

/** Покупка на сторонней площадке за реальные деньги -> продажа на ТП Steam за кошелёк. */
export function externalToSteam({ appId, name, venue, buyPriceCents, sellBuyerPaysCents, s }) {
  const cost = buyPriceCents * (1 + venue.fees.buyFeePct);
  const received = receivedFor(sellBuyerPaysCents, appId);
  return result(`${venue.name}->steam`, name, cost, walletToCash(received, s) * (1 - s.holdRisk), {
    buyPriceCents, buyCurrency: 'USD', buyUsdCents: Math.round(cost), sellPriceCents: sellBuyerPaysCents,
  });
}

/** Покупка на ТП Steam за кошелёк -> продажа на сторонней площадке и вывод реальных денег. */
export function steamToExternal({ name, venue, buyTotalCents, sellPriceCents, s }) {
  const revenue = sellPriceCents * (1 - venue.fees.sellFeePct) * (1 - venue.fees.cashoutFeePct) * (1 - s.holdRisk);
  return result(`steam->${venue.name}`, name, walletToCash(buyTotalCents, s), revenue, {
    buyPriceCents: buyTotalCents, buyCurrency: s.walletCurrency ?? 'USD', buyUsdCents: Math.round(buyTotalCents * s.walletFx),
    sellPriceCents,
  });
}

/**
 * Конкурентная цена продажи на ТП Steam: на 1 цент ниже самого дешёвого лота,
 * но не выше медианы за 24ч (минимальный лот бывает "выбросом" вверх).
 */
export function competitiveSteamPrice({ lowestCents, medianCents }) {
  const undercut = lowestCents ? lowestCents - 1 : null;
  if (undercut && medianCents) return Math.min(undercut, medianCents);
  return undercut ?? medianCents ?? null;
}

/** Сколько продавцов в пределах этой полосы над нашей ценой считаем прямыми конкурентами. */
const COMPETING_BAND = 0.05;

/**
 * Оценка выхода из позиции на ТП Steam по стакану.
 *  - nextAsk: лучший лот ПОСЛЕ того, как мы выкупили самый дешёвый (removeCheapest) — иначе
 *    «рыночной» ценой оказался бы наш же покупаемый лот;
 *  - target: на 1 цент ниже nextAsk, не выше медианы 24ч и не ниже лучшей заявки на покупку
 *    (ниже заявки выставлять бессмысленно — по ней можно продать сразу);
 *  - worst: лучшая заявка на покупку — цена гарантированного выхода «прямо сейчас»;
 *  - daysToSell: (наш лот + конкуренты в пределах +5% от target) / продажи за 24ч.
 *
 * book: { asks: [{priceCents, qty}], bids: [...], highestBuyCents } — из itemordershistogram.
 * Без стакана используются отдельные лоты (listings) — тогда worst неизвестен.
 */
export function estimateSteamExit({ book, overview, listings = [], removeCheapest = false }) {
  let asks = (book?.asks?.length ? book.asks : listings.map((l) => ({ priceCents: l.totalCents, qty: 1 })))
    .map((a) => ({ ...a }))
    .sort((a, b) => a.priceCents - b.priceCents);
  if (removeCheapest && asks.length) {
    asks[0].qty -= 1;
    if (asks[0].qty <= 0) asks = asks.slice(1);
  }
  // Без стакана и без второго лота следующую цену берём из priceoverview, только если она выше покупки
  const fallbackAsk = !removeCheapest || (overview?.lowestCents ?? 0) > (listings[0]?.totalCents ?? Infinity)
    ? overview?.lowestCents ?? null : null;
  const nextAskCents = asks[0]?.priceCents ?? fallbackAsk;
  const highestBuyCents = book?.highestBuyCents ?? null;

  let targetCents = competitiveSteamPrice({ lowestCents: nextAskCents, medianCents: overview?.medianCents });
  if (targetCents != null && highestBuyCents != null) targetCents = Math.max(targetCents, highestBuyCents);

  const competing = targetCents == null ? 0
    : asks.filter((a) => a.priceCents <= targetCents * (1 + COMPETING_BAND)).reduce((sum, a) => sum + a.qty, 0);
  const daysToSell = overview?.volume24h > 0 ? (competing + 1) / overview.volume24h : Infinity;

  return { targetCents, worstCents: highestBuyCents, nextAskCents, daysToSell, competing };
}

/**
 * Перебирает все маршруты для одного предмета и возвращает возможности, отсортированные по ROI.
 * Для маршрутов с продажей на Steam добавляет worstRoi (продажа в лучшую заявку прямо сейчас)
 * и daysToSell — по ним снайпер отсекает сделки, «прибыльные» только по медиане.
 * @param {object} q  котировки: { steam: {listings, overview, book?}, external: [{venue, priceCents, volume, buyable}] }
 */
export function findOpportunities({ appId, name, q, s }) {
  const out = [];
  const { overview, listings, book } = q.steam;
  if (!overview || overview.volume24h < s.minSteamVolume24h) return out; // неликвид не трогаем

  const cheapest = listings[0];
  const withExit = (routeFn, args, exit) => {
    const main = routeFn({ ...args, sellBuyerPaysCents: exit.targetCents });
    const worstRoi = exit.worstCents ? routeFn({ ...args, sellBuyerPaysCents: exit.worstCents }).roi : null;
    return { ...main, worstRoi, daysToSell: exit.daysToSell, highestBuyCents: exit.worstCents, bookKnown: Boolean(book) };
  };

  // Купили самый дешёвый лот -> конкурируем со следующим
  const afterBuy = estimateSteamExit({ book, overview, listings, removeCheapest: true });
  if (cheapest && afterBuy.targetCents) {
    out.push({ ...withExit(steamToSteam, { appId, name, buyTotalCents: cheapest.totalCents, s }, afterBuy),
      buyVenue: 'steam', listing: cheapest });
  }

  const asIs = estimateSteamExit({ book, overview, listings });
  for (const ext of q.external) {
    if (!ext?.priceCents) continue;
    if (ext.buyable && asIs.targetCents) {
      out.push({ ...withExit(externalToSteam, { appId, name, venue: ext.venue, buyPriceCents: ext.priceCents, s }, asIs),
        buyVenue: ext.venue.name, offer: ext.offer });
    }
    if (cheapest) {
      // продаём на 1 цент дешевле текущего минимума площадки; стакана площадки у нас нет -> worstRoi неизвестен
      out.push({ ...steamToExternal({ name, venue: ext.venue, buyTotalCents: cheapest.totalCents, sellPriceCents: ext.priceCents - 1, s }),
        worstRoi: null, daysToSell: null, buyVenue: 'steam', listing: cheapest, sellVenue: ext.venue.name });
    }
  }
  return out.sort((a, b) => b.roi - a.roi);
}
