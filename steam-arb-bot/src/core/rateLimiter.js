import { sleep } from './utils.js';

/**
 * Token bucket: capacity запросов "пачкой", дальше refillPerSec запросов в секунду.
 * Один бакет на хост (а для пула прокси — на пару хост+прокси).
 */
export class TokenBucket {
  constructor({ capacity, refillPerSec }) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.tokens = capacity;
    this.last = Date.now();
  }

  #refill() {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSec);
    this.last = now;
  }

  async take(n = 1) {
    for (;;) {
      this.#refill();
      if (this.tokens >= n) {
        this.tokens -= n;
        return;
      }
      await sleep(Math.ceil(((n - this.tokens) / this.refillPerSec) * 1000));
    }
  }
}
