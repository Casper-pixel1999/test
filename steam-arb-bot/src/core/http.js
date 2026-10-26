import { fetch, ProxyAgent } from 'undici';
import { TokenBucket } from './rateLimiter.js';
import { backoffMs, sleep } from './utils.js';

export class HttpError extends Error {
  constructor(status, body, url) {
    super(`HTTP ${status} ${url}`);
    this.status = status;
    this.body = body?.slice?.(0, 500);
  }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/**
 * Лимиты консервативные — это те значения, на которых не прилетают 429,
 * а не "максимум, который удаётся выжать".
 */
const DEFAULT_LIMITS = {
  'steamcommunity.com': { capacity: 1, refillPerSec: 1 / 3.5 }, // ~17 req/min на IP
  'api.skinport.com': { capacity: 1, refillPerSec: 8 / 300 },   // 8 запросов / 5 мин
  'buff.163.com': { capacity: 1, refillPerSec: 1 / 4 },
  'api.dmarket.com': { capacity: 5, refillPerSec: 2 },
  'api.telegram.org': { capacity: 5, refillPerSec: 1 },
  default: { capacity: 2, refillPerSec: 1 },
};

export class HttpClient {
  /**
   * @param {object} o
   * @param {import('./proxyPool.js').ProxyPool} o.proxyPool  пул для публичных запросов
   * @param {string|null} o.stickyProxyUrl                   прокси аккаунта для авторизованных запросов
   */
  constructor({ proxyPool, stickyProxyUrl = null, limits = {}, logger, maxRetries = 4 }) {
    this.pool = proxyPool;
    this.sticky = stickyProxyUrl ? { id: 'sticky', agent: new ProxyAgent(stickyProxyUrl) } : null;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.buckets = new Map();
    this.log = logger;
    this.maxRetries = maxRetries;
  }

  #bucket(host, proxyId) {
    const key = `${host}|${proxyId}`;
    if (!this.buckets.has(key)) {
      this.buckets.set(key, new TokenBucket(this.limits[host] ?? this.limits.default));
    }
    return this.buckets.get(key);
  }

  /**
   * @param {string} url
   * @param {object} [o]
   * @param {boolean} [o.sticky]  true — запрос от имени аккаунта: всегда один и тот же IP
   * @param {'json'|'text'} [o.as]
   */
  async request(url, { method = 'GET', headers = {}, body, sticky = false, as = 'json', timeoutMs = 20_000 } = {}) {
    const host = new URL(url).host;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let proxy = sticky ? this.sticky : this.pool.pick(host);
      if (proxy === undefined) {
        // Все прокси пула "остывают" для этого хоста — ждём, а не долбим.
        await sleep(this.pool.msUntilAvailable(host));
        proxy = this.pool.pick(host) ?? null;
      }
      await this.#bucket(host, proxy?.id ?? 'direct').take();

      let res;
      try {
        res = await fetch(url, {
          method,
          headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', ...headers },
          body,
          dispatcher: proxy?.agent,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        this.log.warn({ host, attempt, proxy: proxy?.id, err: err.message }, 'network error');
        await sleep(backoffMs(attempt));
        continue;
      }

      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after')) * 1000 || 0;
        const wait = Math.max(retryAfter, 60_000 * 2 ** attempt);
        await res.body?.cancel();
        this.log.warn({ host, status: res.status, attempt, proxy: proxy?.id }, 'rate limited / server error');
        if (res.status === 429 && proxy && !sticky) {
          this.pool.cooldown(proxy, host, wait); // следующая попытка уйдёт через другой прокси
        } else {
          await sleep(sticky ? wait : backoffMs(attempt, 5_000));
        }
        continue;
      }

      if (!res.ok) throw new HttpError(res.status, await res.text().catch(() => ''), url);
      return as === 'json' ? res.json() : res.text();
    }
    throw new Error(`Retries exhausted: ${method} ${url}`);
  }
}
