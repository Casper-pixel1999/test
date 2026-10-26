export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Экспоненциальная задержка с "full jitter", чтобы ретраи не шли синхронной волной. */
export const backoffMs = (attempt, baseMs = 1000, capMs = 120_000) =>
  Math.floor(Math.random() * Math.min(capMs, baseMs * 2 ** attempt));

/** "$1,234.56" -> 123456. Работает для currency=1 (USD). */
export function parseUsdToCents(str) {
  if (str == null) return null;
  const clean = String(str).replace(/[^0-9.]/g, '');
  if (!clean) return null;
  return Math.round(Number(clean) * 100);
}

export const fmtUsd = (cents) => `$${(cents / 100).toFixed(2)}`;
