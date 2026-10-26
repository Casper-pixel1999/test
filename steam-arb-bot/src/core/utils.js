export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Экспоненциальная задержка с "full jitter", чтобы ретраи не шли синхронной волной. */
export const backoffMs = (attempt, baseMs = 1000, capMs = 120_000) =>
  Math.floor(Math.random() * Math.min(capMs, baseMs * 2 ** attempt));

/** Коды валют Steam (ECurrencyCode) -> ISO. */
export const STEAM_CURRENCY = {
  1: 'USD', 2: 'GBP', 3: 'EUR', 4: 'CHF', 5: 'RUB', 6: 'PLN', 7: 'BRL', 8: 'JPY', 9: 'NOK', 10: 'IDR',
  11: 'MYR', 12: 'PHP', 13: 'SGD', 14: 'THB', 15: 'VND', 16: 'KRW', 17: 'TRY', 18: 'UAH', 19: 'MXN', 20: 'CAD',
  21: 'AUD', 22: 'NZD', 23: 'CNY', 24: 'INR', 25: 'CLP', 26: 'PEN', 27: 'COP', 28: 'ZAR', 29: 'HKD', 30: 'TWD',
  31: 'SAR', 32: 'AED', 34: 'ARS', 35: 'ILS', 37: 'KZT', 38: 'KWD', 39: 'QAR', 40: 'CRC', 41: 'UYU',
};
export const currencyName = (code) => STEAM_CURRENCY[code] ?? `steam#${code}`;

/**
 * Отформатированная цена Steam в любой валюте -> центы (минимальные единицы).
 * "$1,234.56" | "1 234,56 pуб." | "1.234,56€" | "12,34€" | "₸ 1 500" -> 123456 | 123456 | 123456 | 1234 | 150000
 * Десятичный разделитель — последний '.' или ',', за которым идут ровно 1–2 цифры.
 */
export function parsePriceToCents(str) {
  if (str == null) return null;
  const s = String(str).replace(/[^0-9.,]/g, '').replace(/[.,]+$/, '');
  if (!/\d/.test(s)) return null;
  const m = s.match(/^(.*)[.,](\d{1,2})$/);
  const intPart = (m ? m[1] : s).replace(/[.,]/g, '') || '0';
  const frac = m ? m[2].padEnd(2, '0') : '00';
  return Number(intPart) * 100 + Number(frac);
}

export const fmtMoney = (cents, currency = 'USD') => `${(cents / 100).toFixed(2)} ${currency}`;
export const fmtUsd = (cents) => `$${(cents / 100).toFixed(2)}`;
