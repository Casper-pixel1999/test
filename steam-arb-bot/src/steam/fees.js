/**
 * Комиссии Steam Community Market. Логика повторяет клиентский JS Steam (economy_common.js):
 *   - 5% комиссия Steam, минимум 1 цент;
 *   - комиссия издателя игры (CS2 / Dota 2 / Rust — 10%), минимум 1 цент;
 * Обе считаются ОТ СУММЫ, КОТОРУЮ ПОЛУЧАЕТ ПРОДАВЕЦ. Поэтому "15%" = ~13.04% от цены покупателя.
 * Все значения в центах.
 */
export const STEAM_FEE = 0.05;
export const PUBLISHER_FEE = { 730: 0.1, 570: 0.1, 252490: 0.1 };

export const publisherFeeFor = (appId) => PUBLISHER_FEE[appId] ?? 0.1;

export function feesForReceived(received, publisherFee) {
  const steamFee = Math.floor(Math.max(received * STEAM_FEE, 1));
  const pubFee = publisherFee > 0 ? Math.floor(Math.max(received * publisherFee, 1)) : 0;
  return { steamFee, pubFee, buyerPays: received + steamFee + pubFee };
}

/** Сколько заплатит покупатель, если продавец хочет получить `received`. */
export const buyerPaysFor = (received, appId) => feesForReceived(received, publisherFeeFor(appId)).buyerPays;

/** Сколько получит продавец, если покупатель платит `buyerPays` (максимальный received, влезающий в цену). */
export function receivedFor(buyerPays, appId) {
  const pf = publisherFeeFor(appId);
  if (buyerPays < 3) return 0; // минимальный лот: 1 + 1 + 1 цент
  let r = Math.floor(buyerPays / (1 + STEAM_FEE + pf));
  while (feesForReceived(r + 1, pf).buyerPays <= buyerPays) r++;
  while (r > 1 && feesForReceived(r, pf).buyerPays > buyerPays) r--;
  return r;
}
