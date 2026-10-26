import { receivedFor } from '../steam/fees.js';

/**
 * Калькулятор арбитража. Все суммы — в центах.
 *
 * Ключевые поправки, без которых "профит" получается фиктивным:
 *  - walletValue: деньги на кошельке Steam нельзя вывести. $1 кошелька обычно стоит
 *    0.65–0.80$ реальных денег. Покупка ЗА кошелёк дешевле, продажа ЗА кошелёк — "дешевле" в кэше.
 *  - holdRisk: в CS2 купленный предмет нельзя сразу перепродать (холд/Trade Protection ~7 дней),
 *    цена может уйти. Дисконтируем ожидаемую выручку.
 *  - кэшаут-комиссия сторонней площадки (вывод на карту/крипту/PayPal).
 */

const result = (route, name, costCash, revenueCash, extra = {}) => {
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

/** Покупка на ТП Steam -> продажа на ТП Steam (снайпинг лотов, выставленных ниже рынка). */
export function steamToSteam({ appId, name, buyTotalCents, sellBuyerPaysCents, s }) {
  const received = receivedFor(sellBuyerPaysCents, appId);
  // Обе стороны в "кошельковых" долларах -> walletValue сокращается, но держим явно
  const cost = buyTotalCents * s.walletValue;
  const revenue = received * s.walletValue * (1 - s.holdRisk);
  return result('steam->steam', name, cost, revenue, { buyPriceCents: buyTotalCents, sellPriceCents: sellBuyerPaysCents });
}

/** Покупка на сторонней площадке за реальные деньги -> продажа на ТП Steam за кошелёк. */
export function externalToSteam({ appId, name, venue, buyPriceCents, sellBuyerPaysCents, s }) {
  const cost = buyPriceCents * (1 + venue.fees.buyFeePct);
  const received = receivedFor(sellBuyerPaysCents, appId);
  const revenue = received * s.walletValue * (1 - s.holdRisk);
  return result(`${venue.name}->steam`, name, cost, revenue, { buyPriceCents, sellPriceCents: sellBuyerPaysCents });
}

/** Покупка на ТП Steam за кошелёк -> продажа на сторонней площадке и вывод реальных денег. */
export function steamToExternal({ name, venue, buyTotalCents, sellPriceCents, s }) {
  const cost = buyTotalCents * s.walletValue;
  const revenue = sellPriceCents * (1 - venue.fees.sellFeePct) * (1 - venue.fees.cashoutFeePct) * (1 - s.holdRisk);
  return result(`steam->${venue.name}`, name, cost, revenue, { buyPriceCents: buyTotalCents, sellPriceCents });
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

/**
 * Перебирает все маршруты для одного предмета и возвращает возможности, отсортированные по ROI.
 * @param {object} q  котировки: { steam: {listings, overview}, external: [{venue, priceCents, volume, buyable}] }
 */
export function findOpportunities({ appId, name, q, s }) {
  const out = [];
  const { overview, listings } = q.steam;
  if (!overview || overview.volume24h < s.minSteamVolume24h) return out; // неликвид не трогаем

  const sellOnSteam = competitiveSteamPrice(overview);
  const cheapest = listings[0];

  if (cheapest && sellOnSteam) {
    out.push({ ...steamToSteam({ appId, name, buyTotalCents: cheapest.totalCents, sellBuyerPaysCents: sellOnSteam, s }),
      buyVenue: 'steam', listing: cheapest });
  }

  for (const ext of q.external) {
    if (!ext?.priceCents) continue;
    if (ext.buyable && sellOnSteam) {
      out.push({ ...externalToSteam({ appId, name, venue: ext.venue, buyPriceCents: ext.priceCents, sellBuyerPaysCents: sellOnSteam, s }),
        buyVenue: ext.venue.name, offer: ext.offer });
    }
    if (cheapest) {
      // продаём на 1 цент дешевле текущего минимума площадки
      out.push({ ...steamToExternal({ name, venue: ext.venue, buyTotalCents: cheapest.totalCents, sellPriceCents: ext.priceCents - 1, s }),
        buyVenue: 'steam', listing: cheapest, sellVenue: ext.venue.name });
    }
  }
  return out.sort((a, b) => b.roi - a.roi);
}
