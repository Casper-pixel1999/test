#!/usr/bin/env node
// Шифрует maFile: node scripts/encrypt-mafile.js <in.maFile> <out.enc>
// Пароль берётся из SECRETS_PASSPHRASE или запрашивается в терминале.
import fs from 'node:fs/promises';
import readline from 'node:readline/promises';
import { encrypt } from '../src/core/secrets.js';

const [, , input, output = './data/account.maFile.enc'] = process.argv;
if (!input) {
  console.error('Usage: node scripts/encrypt-mafile.js <in.maFile> [out.enc]');
  process.exit(1);
}

let pass = process.env.SECRETS_PASSPHRASE;
if (!pass) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  pass = await rl.question('Passphrase (>=12 символов): ');
  rl.close();
}

const plain = await fs.readFile(input, 'utf8');
const ma = JSON.parse(plain);
if (!ma.shared_secret || !ma.identity_secret) throw new Error('Это не maFile: нет shared_secret / identity_secret');

await fs.writeFile(output, encrypt(plain, pass), { mode: 0o600 });
console.log(`OK -> ${output}\nТеперь удалите открытый файл и храните его копию офлайн (вместе с revocation_code).`);
