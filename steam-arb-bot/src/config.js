import 'dotenv/config';

const str = (k, d = '') => process.env[k] ?? d;
const num = (k, d) => {
  const v = process.env[k];
  if (v === undefined || v === '') return d;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env ${k} должен быть числом, получено "${v}"`);
  return n;
};
const bool = (k, d) => (process.env[k] === undefined ? d : process.env[k] === 'true');
const pct = (k, d) => num(k, d) / 100;
const list = (k) => str(k).split(',').map((s) => s.trim()).filter(Boolean);
const usdCents = (k, d) => Math.round(num(k, d) * 100);

export const config = Object.freeze({
  dryRun: bool('DRY_RUN', true),
  logLevel: str('LOG_LEVEL', 'info'),
  appId: num('APP_ID', 730),
  watchlistPath: str('WATCHLIST_PATH', './watchlist.json'),

  steam: {
    accountName: str('STEAM_ACCOUNT_NAME'),
    password: str('STEAM_PASSWORD'),
    maFilePath: str('MAFILE_PATH', './data/account.maFile.enc'),
    refreshTokenPath: str('REFRESH_TOKEN_PATH', './data/refresh_token.enc'),
    currency: num('STEAM_CURRENCY', 1),
    accountProxy: str('STEAM_ACCOUNT_PROXY') || null,
  },
  secretsPassphrase: str('SECRETS_PASSPHRASE'),
  proxyPool: list('PROXY_POOL'),

  venues: {
    skinport: {
      enabled: bool('SKINPORT_ENABLED', true),
      sellFeePct: pct('SKINPORT_SELL_FEE_PCT', 8),
      cashoutFeePct: pct('SKINPORT_CASHOUT_FEE_PCT', 2),
      buyFeePct: 0,
    },
    buff: {
      enabled: bool('BUFF_ENABLED', false),
      sessionCookie: str('BUFF_SESSION_COOKIE'),
      sellFeePct: pct('BUFF_SELL_FEE_PCT', 2.5),
      cashoutFeePct: pct('BUFF_CASHOUT_FEE_PCT', 1),
      buyFeePct: 0,
      cnyUsdRate: num('CNY_USD_RATE', 0.138),
    },
    dmarket: {
      enabled: bool('DMARKET_ENABLED', false),
      publicKey: str('DMARKET_PUBLIC_KEY'),
      secretKey: str('DMARKET_SECRET_KEY'),
      buyFeePct: pct('DMARKET_BUY_FEE_PCT', 0),
      sellFeePct: pct('DMARKET_SELL_FEE_PCT', 5),
      cashoutFeePct: pct('DMARKET_CASHOUT_FEE_PCT', 2),
    },
  },

  strategy: {
    minRoi: pct('MIN_ROI_PCT', 10),
    walletValue: num('STEAM_WALLET_VALUE', 0.75),
    holdRisk: pct('HOLD_RISK_PCT', 3),
    minSteamVolume24h: num('MIN_STEAM_VOLUME_24H', 20),
    maxItemPriceCents: usdCents('MAX_ITEM_PRICE_USD', 50),
    dailyBudgetCents: usdCents('DAILY_BUDGET_USD', 200),
    minSellMargin: pct('MIN_SELL_MARGIN_PCT', 5),
  },

  telegram: {
    token: str('TELEGRAM_BOT_TOKEN'),
    chatId: str('TELEGRAM_CHAT_ID'),
  },

  databaseUrl: str('DATABASE_URL'),
});
