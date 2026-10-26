import { TokenBucket } from '../core/rateLimiter.js';

/**
 * Алерты в Telegram. Никогда не бросает исключений наружу — падение уведомлений
 * не должно ронять торговый цикл. Лимит Telegram: ~1 сообщение/сек в один чат.
 */
export class Telegram {
  constructor({ token, chatId, logger }) {
    this.enabled = Boolean(token && chatId);
    this.url = `https://api.telegram.org/bot${token}/sendMessage`;
    this.chatId = chatId;
    this.bucket = new TokenBucket({ capacity: 3, refillPerSec: 1 });
    this.log = logger.child({ mod: 'telegram' });
  }

  async send(text) {
    if (!this.enabled) return this.log.info({ text }, 'notify (telegram disabled)');
    await this.bucket.take();
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) this.log.warn({ status: res.status }, 'telegram send failed');
    } catch (err) {
      this.log.warn({ err: err.message }, 'telegram send failed');
    }
  }

  error(text) {
    return this.send(`🚨 ${text}`);
  }
}
