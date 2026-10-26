import fs from 'node:fs/promises';
import { decrypt, isEncrypted } from '../core/secrets.js';

const B64 = /^[A-Za-z0-9+/]+=*$/;

/**
 * Загружает maFile (формат Steam Desktop Authenticator / steamguard-cli).
 * Поддерживает как наш зашифрованный формат, так и plaintext (с предупреждением).
 *
 * Важно: если в SDA включено собственное шифрование (manifest.json "encrypted": true),
 * сначала снимите его в SDA и сразу перешифруйте через `npm run encrypt-mafile`.
 *
 * @returns {{accountName:string, sharedSecret:string, identitySecret:string, deviceId:string, steamId:string|null}}
 */
export async function loadMaFile(path, passphrase, logger) {
  const raw = await fs.readFile(path, 'utf8');
  let json;
  if (isEncrypted(raw)) {
    if (!passphrase) throw new Error('maFile зашифрован, а SECRETS_PASSPHRASE не задан');
    json = decrypt(raw, passphrase);
  } else {
    logger?.warn('maFile хранится в открытом виде — зашифруйте его: npm run encrypt-mafile');
    json = raw;
  }

  const ma = JSON.parse(json);
  for (const k of ['shared_secret', 'identity_secret']) {
    if (typeof ma[k] !== 'string' || !B64.test(ma[k])) throw new Error(`maFile: поле ${k} отсутствует или не base64`);
  }

  return {
    accountName: ma.account_name,
    sharedSecret: ma.shared_secret,     // -> 5-символьные коды Steam Guard (логин)
    identitySecret: ma.identity_secret, // -> подписи мобильных подтверждений (трейды, лоты на ТП)
    deviceId: ma.device_id,
    steamId: ma.Session?.SteamID ? String(ma.Session.SteamID) : null,
  };
}
