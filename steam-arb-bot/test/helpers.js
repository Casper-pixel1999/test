import pino from 'pino';

export const silentLogger = pino({ level: 'silent' });

/** Подменный HttpClient: маршрутизирует URL на функции-фикстуры и записывает вызовы. */
export function fakeHttp(routes) {
  const calls = [];
  return {
    calls,
    async request(url, opts = {}) {
      calls.push({ url, ...opts });
      for (const [re, fn] of routes) if (re.test(url)) return fn(url, opts);
      throw new Error(`no fixture for ${url}`);
    },
  };
}

export const strategy = {
  minRoi: 0.1, walletValue: 1, walletFx: 1, walletCurrency: 'USD', holdRisk: 0, minSteamVolume24h: 10,
  maxItemPriceCents: 5000, dailyBudgetCents: 1000, minSellMargin: 0.05,
};

export function collectingNotifier() {
  const messages = [];
  return { messages, send: async (t) => { messages.push(t); }, error: async (t) => { messages.push(`🚨 ${t}`); } };
}
