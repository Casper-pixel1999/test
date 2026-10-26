import { ProxyAgent } from 'undici';

/**
 * Пул прокси для ПУБЛИЧНЫХ запросов (цены). Round-robin + "охлаждение" прокси
 * для конкретного хоста после 429. Авторизованные запросы аккаунта сюда не ходят.
 */
export class ProxyPool {
  constructor(urls = []) {
    this.entries = urls.map((url) => ({
      id: new URL(url).host,
      agent: new ProxyAgent(url),
      cooldownUntil: new Map(), // host -> timestamp
    }));
    this.cursor = 0;
  }

  get size() {
    return this.entries.length;
  }

  /** Вернёт свободный прокси, null если пул пуст, undefined если все в cooldown. */
  pick(host) {
    if (!this.entries.length) return null;
    const now = Date.now();
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[this.cursor++ % this.entries.length];
      if ((e.cooldownUntil.get(host) ?? 0) <= now) return e;
    }
    return undefined;
  }

  cooldown(entry, host, ms) {
    entry.cooldownUntil.set(host, Date.now() + ms);
  }

  msUntilAvailable(host) {
    const now = Date.now();
    return Math.max(0, Math.min(...this.entries.map((e) => (e.cooldownUntil.get(host) ?? 0) - now)));
  }
}
