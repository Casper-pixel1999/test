import fs from 'node:fs/promises';
import { config as cfg } from './config.js';
import { logger } from './core/logger.js';
import { HttpClient } from './core/http.js';
import { ProxyPool } from './core/proxyPool.js';
import { EncryptedFileStore } from './core/secrets.js';
import { currencyName, sleep } from './core/utils.js';
import { Repo } from './db/repo.js';
import { Telegram } from './notify/telegram.js';
import { loadMaFile } from './steam/maFile.js';
import { SteamSession } from './steam/session.js';
import { SteamMarket } from './steam/market.js';
import { Skinport } from './markets/skinport.js';
import { Buff163 } from './markets/buff163.js';
import { DMarket } from './markets/dmarket.js';
import { findOpportunities } from './engine/arbitrage.js';
import { Sniper } from './engine/sniper.js';
import { AutoSeller } from './engine/seller.js';

const SELL_INTERVAL_MS = 10 * 60_000;
let running = true;

async function main() {
  const appId = cfg.appId;
  const watchlist = JSON.parse(await fs.readFile(cfg.watchlistPath, 'utf8'));
  const notifier = new Telegram({ ...cfg.telegram, logger });
  const db = new Repo(cfg.databaseUrl);
  const http = new HttpClient({ proxyPool: new ProxyPool(cfg.proxyPool), stickyProxyUrl: cfg.steam.accountProxy, logger });

  // ── Steam ──
  const maFile = await loadMaFile(cfg.steam.maFilePath, cfg.secretsPassphrase, logger);
  const session = new SteamSession({
    accountName: cfg.steam.accountName,
    password: cfg.steam.password,
    maFile,
    tokenStore: new EncryptedFileStore(cfg.steam.refreshTokenPath, cfg.secretsPassphrase),
    proxyUrl: cfg.steam.accountProxy,
    logger,
    notifier,
  });
  await session.login();

  // Валюта кошелька: Steam принимает покупки и продажи только в ней
  const walletCurrency = await session.resolveWalletCurrency(cfg.steam.currency);
  const walletFx = walletCurrency === 1 ? 1 : cfg.steam.walletUsdRate;
  if (!walletFx) {
    throw new Error(`Кошелёк Steam в валюте ${currencyName(walletCurrency)}: задайте WALLET_USD_RATE (USD за 1 ${currencyName(walletCurrency)})`);
  }
  const strategy = { ...cfg.strategy, walletFx, walletCurrency: currencyName(walletCurrency) };
  const runtime = { ...cfg, strategy };
  logger.info({ currency: strategy.walletCurrency, walletFx }, 'wallet currency');
  const steam = new SteamMarket({ http, session, currency: walletCurrency, logger });

  // ── Сторонние площадки ──
  const v = cfg.venues;
  const skinport = v.skinport.enabled ? new Skinport({ http, fees: v.skinport, logger }) : null;
  const buff = v.buff.enabled ? new Buff163({ http, fees: v.buff, sessionCookie: v.buff.sessionCookie, cnyUsdRate: v.buff.cnyUsdRate, logger }) : null;
  const dmarket = v.dmarket.enabled ? new DMarket({ http, fees: v.dmarket, publicKey: v.dmarket.publicKey, secretKey: v.dmarket.secretKey, logger }) : null;

  const sniper = new Sniper({ config: runtime, db, notifier, steamMarket: steam, venues: { dmarket }, logger });
  const seller = new AutoSeller({ config: runtime, db, notifier, steamMarket: steam, logger });

  // До ПЕРВОЙ покупки запоминаем текущий инвентарь: эти предметы бот никогда не продаст
  await seller.syncInventory(appId);
  await sniper.recoverPending();

  await notifier.send(`🤖 Бот запущен. appId=${appId}, items=${watchlist.length}, кошелёк ${strategy.walletCurrency}, DRY_RUN=${cfg.dryRun}`);

  // ── Цикл продаж ──
  (async () => {
    while (running) {
      try {
        await seller.run(appId);
      } catch (err) {
        logger.error({ err: err.message }, 'sell loop error');
        await notifier.error(`Ошибка цикла продаж: ${err.message}`);
      }
      await sleep(SELL_INTERVAL_MS);
    }
  })();

  // ── Цикл мониторинга и снайпинга ──
  while (running) {
    const skinportPrices = skinport ? await skinport.prices(appId).catch((err) => (logger.warn({ err: err.message }, 'skinport'), new Map())) : new Map();

    for (const name of watchlist) {
      if (!running) break;
      try {
        const [overview, listings] = [await steam.priceOverview(appId, name), await steam.getListings(appId, name, { count: 5 })];
        const external = [];

        const sp = skinportPrices.get(name);
        if (sp) external.push({ venue: skinport, priceCents: sp.priceCents, volume: sp.volume, buyable: false });
        if (buff) {
          const bp = await buff.price(appId, name);
          if (bp) external.push({ venue: buff, priceCents: bp.priceCents, volume: bp.volume, buyable: false });
        }
        if (dmarket) {
          const [offer] = await dmarket.cheapestOffers(appId, name, 1);
          if (offer) external.push({ venue: dmarket, priceCents: offer.priceCents, buyable: true, offer });
        }

        if (overview?.lowestCents) {
          await db.savePrices(`steam:${strategy.walletCurrency}`, appId, [{ name, priceCents: overview.lowestCents, medianCents: overview.medianCents, volume: overview.volume24h }]);
        }
        for (const e of external) await db.savePrices(e.venue.name, appId, [{ name, priceCents: e.priceCents, volume: e.volume }]);

        const opps = findOpportunities({ appId, name, q: { steam: { overview, listings }, external }, s: strategy });
        // Берём только лучшую возможность по предмету — не покупаем один и тот же лот дважды
        if (opps[0]) await sniper.consider(appId, opps[0]);
      } catch (err) {
        logger.error({ name, err: err.message }, 'scan error');
      }
    }
  }
}

function shutdown(sig) {
  logger.info({ sig }, 'shutting down');
  running = false;
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (err) => logger.error({ err: err?.message }, 'unhandledRejection'));

main().catch((err) => {
  logger.fatal({ err: err.message }, 'fatal');
  process.exit(1);
});
