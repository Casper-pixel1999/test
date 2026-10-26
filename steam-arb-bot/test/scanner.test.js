import test from 'node:test';
import assert from 'node:assert/strict';
import { Scanner } from '../src/engine/scanner.js';
import { silentLogger, strategy } from './helpers.js';

const venue = (name, fees) => ({ name, fees: { buyFeePct: 0, sellFeePct: 0, cashoutFeePct: 0, ...fees } });

function setup({ pages = 3, dmarket = true } = {}) {
  const searchCalls = [];
  const steamMarket = {
    searchPage: async (appId, start) => {
      searchCalls.push(start);
      const all = [
        { name: 'CheapOnSteam', priceUsdCents: 100, listings: 50 },   // Skinport 200 -> купить на Steam
        { name: 'DearOnSteam', priceUsdCents: 400, listings: 50 },    // Skinport 200 -> купить на DMarket
        { name: 'Fair', priceUsdCents: 200, listings: 50 },
        { name: 'Illiquid', priceUsdCents: 50, listings: 3 },
        { name: 'TooExpensive', priceUsdCents: 900_000, listings: 50 },
        { name: 'NoRef', priceUsdCents: 10, listings: 50 },
      ];
      return { total: all.length, items: start === 0 ? all : [] };
    },
  };
  const skinport = {
    ...venue('skinport', { sellFeePct: 0.08, cashoutFeePct: 0.02 }),
    prices: async () => new Map([['CheapOnSteam', { priceCents: 200 }], ['DearOnSteam', { priceCents: 200 }],
      ['Fair', { priceCents: 200 }], ['Illiquid', { priceCents: 500 }], ['TooExpensive', { priceCents: 1_000_000 }]]),
  };
  const cfg = { scan: { pages, minListings: 20, roiFactor: 0.5, deepPerCycle: 10 }, strategy };
  return {
    searchCalls,
    scanner: new Scanner({ config: cfg, steamMarket, skinport, dmarket: dmarket ? venue('dmarket') : null, logger: silentLogger }),
  };
}

test('screen: отбирает кандидатов в обе стороны, фильтрует неликвид/дорогие/без ориентира', async () => {
  const { scanner, searchCalls } = setup();
  const c = await scanner.screen(730);
  assert.deepEqual(c.map((x) => [x.name, x.route]), [['CheapOnSteam', 'steam->skinport'], ['DearOnSteam', 'dmarket->steam']]);
  assert.ok(c[0].estRoi > c[1].estRoi);
  assert.deepEqual(searchCalls, [0], 'total=6 -> вторая страница не запрашивается');
});

test('screen: без DMarket маршрут «Steam дороже» не предлагается', async () => {
  const { scanner } = setup({ dmarket: false });
  assert.deepEqual((await scanner.screen(730)).map((x) => x.name), ['CheapOnSteam']);
});

test('deepQuote: стакан необязателен — ошибка стакана не роняет котировку', async () => {
  const scanner = new Scanner({
    config: { scan: {}, strategy },
    steamMarket: {
      priceOverview: async () => ({ lowestCents: 1, medianCents: 1, volume24h: 1 }),
      getListings: async () => [],
      getOrderBook: async () => { throw new Error('429'); },
    },
    logger: silentLogger,
  });
  const q = await scanner.deepQuote(730, 'X');
  assert.equal(q.steam.book, null);
  assert.deepEqual(q.external, []);
});
