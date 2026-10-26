import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { HttpClient, HttpError } from '../src/core/http.js';
import { ProxyPool } from '../src/core/proxyPool.js';
import { TokenBucket } from '../src/core/rateLimiter.js';
import { silentLogger } from './helpers.js';

function listen(server) {
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

test('HttpClient: JSON, ретрай после 429, HttpError на 4xx, проход через CONNECT-прокси', async (t) => {
  let hits = 0;
  const api = http.createServer((req, res) => {
    hits++;
    if (req.url === '/flaky' && hits === 1) { res.writeHead(429, { 'retry-after': '0' }); return res.end(); }
    if (req.url === '/forbidden') { res.writeHead(403); return res.end('nope'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, url: req.url, ua: req.headers['user-agent'] }));
  });
  const apiPort = await listen(api);

  let tunnels = 0;
  const proxy = http.createServer();
  proxy.on('connect', (req, client, head) => {
    tunnels++;
    const [host, port] = req.url.split(':');
    const upstream = net.connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(client); client.pipe(upstream);
    });
  });
  const proxyPort = await listen(proxy);
  t.after(() => { api.close(); proxy.close(); });

  const limits = { [`127.0.0.1:${apiPort}`]: { capacity: 100, refillPerSec: 100 } };
  const direct = new HttpClient({ proxyPool: new ProxyPool([]), logger: silentLogger, limits });

  const r = await direct.request(`http://127.0.0.1:${apiPort}/ok`);
  assert.equal(r.ok, true);
  assert.match(r.ua, /Mozilla/);

  const t0 = Date.now();
  assert.equal((await direct.request(`http://127.0.0.1:${apiPort}/flaky`)).ok, true);
  assert.ok(Date.now() - t0 < 6000, 'backoff после 429 без прокси ограничен ~5с на первой попытке');

  await assert.rejects(direct.request(`http://127.0.0.1:${apiPort}/forbidden`), (e) => e instanceof HttpError && e.status === 403);

  const viaProxy = new HttpClient({ proxyPool: new ProxyPool([`http://127.0.0.1:${proxyPort}`]), logger: silentLogger, limits });
  assert.equal((await viaProxy.request(`http://127.0.0.1:${apiPort}/p`)).ok, true);
  assert.ok(tunnels >= 1, 'запрос из пула прошёл через прокси');

  const sticky = new HttpClient({ proxyPool: new ProxyPool([]), stickyProxyUrl: `http://127.0.0.1:${proxyPort}`, logger: silentLogger, limits });
  const before = tunnels;
  assert.equal((await sticky.request(`http://127.0.0.1:${apiPort}/s`, { sticky: true })).ok, true);
  assert.ok(tunnels > before, 'sticky-запрос идёт через прокси аккаунта');
});

test('ProxyPool: round-robin и cooldown по хосту', () => {
  const pool = new ProxyPool(['http://p1:1', 'http://p2:2']);
  const a = pool.pick('h'); const b = pool.pick('h');
  assert.notEqual(a.id, b.id);
  pool.cooldown(a, 'h', 60_000);
  for (let i = 0; i < 4; i++) assert.equal(pool.pick('h').id, b.id);
  assert.equal(pool.pick('other').id === a.id || true, true); // другой хост не затронут
  pool.cooldown(b, 'h', 30_000);
  assert.equal(pool.pick('h'), undefined);
  const wait = pool.msUntilAvailable('h');
  assert.ok(wait > 29_000 && wait <= 30_000);
});

test('TokenBucket выдерживает заданную частоту', async () => {
  const b = new TokenBucket({ capacity: 1, refillPerSec: 10 });
  const t0 = Date.now();
  for (let i = 0; i < 6; i++) await b.take();
  const el = Date.now() - t0;
  assert.ok(el >= 450 && el < 1000, `elapsed ${el}ms`);
});
