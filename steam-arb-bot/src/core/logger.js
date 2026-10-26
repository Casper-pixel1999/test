import pino from 'pino';
import { config } from '../config.js';

// Секреты никогда не должны попадать в логи: pino вырезает эти поля из любых объектов.
export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'password', '*.password', 'refreshToken', '*.refreshToken',
      'cookies', '*.cookies', 'sessionID', '*.sessionID',
      'shared_secret', 'identity_secret', '*.sharedSecret', '*.identitySecret',
      'headers.cookie', 'headers.Cookie', 'headers["X-Api-Key"]', 'headers["X-Request-Sign"]',
      'apiKey', '*.apiKey', 'secretKey', '*.secretKey',
    ],
    censor: '[REDACTED]',
  },
});
