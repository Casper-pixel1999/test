import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const MAGIC = 'ARB-ENC-1';
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** AES-256-GCM + scrypt KDF. На выходе JSON, безопасный для хранения на диске. */
export function encrypt(plaintext, passphrase) {
  if (!passphrase || passphrase.length < 12) throw new Error('Passphrase должен быть >= 12 символов');
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32, SCRYPT);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return JSON.stringify({
    magic: MAGIC,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  });
}

export function isEncrypted(text) {
  try {
    return JSON.parse(text).magic === MAGIC;
  } catch {
    return false;
  }
}

export function decrypt(text, passphrase) {
  const o = JSON.parse(text);
  if (o.magic !== MAGIC) throw new Error('Неизвестный формат зашифрованного файла');
  const key = crypto.scryptSync(passphrase, Buffer.from(o.salt, 'base64'), 32, SCRYPT);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(o.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(o.tag, 'base64'));
  // Неверный пароль или подмена файла -> исключение на final()
  return Buffer.concat([decipher.update(Buffer.from(o.data, 'base64')), decipher.final()]).toString('utf8');
}

/** Хранилище одного секрета (например refresh token) в зашифрованном файле. */
export class EncryptedFileStore {
  constructor(path, passphrase) {
    this.path = path;
    this.passphrase = passphrase;
  }

  async load() {
    try {
      return decrypt(await fs.readFile(this.path, 'utf8'), this.passphrase);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async save(value) {
    await fs.writeFile(this.path, encrypt(value, this.passphrase), { mode: 0o600 });
  }

  async clear() {
    await fs.rm(this.path, { force: true });
  }
}
