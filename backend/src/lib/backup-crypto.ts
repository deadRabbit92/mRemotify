/**
 * mRemotify Backup File (.mrb) encryption/decryption
 *
 * Binary format:
 *   [4 bytes magic: 0x4D524246]   "MRBF" — mRemotify Backup File
 *   [1 byte  version: 0x01]
 *   [32 bytes salt]                PBKDF2 salt
 *   [12 bytes IV]                  AES-256-GCM nonce
 *   [16 bytes GCM auth tag]
 *   [N  bytes ciphertext]
 *
 * Key derivation: PBKDF2-SHA256, 100 000 iterations, 32-byte key
 */

import { pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const MAGIC = Buffer.from([0x4d, 0x52, 0x42, 0x46]); // "MRBF"
const VERSION = 0x01;
const SALT_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const PBKDF2_ITERATIONS = 100_000;
const HEADER_LEN = MAGIC.length + 1 + SALT_LEN + IV_LEN + TAG_LEN; // 65

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LEN, 'sha256');
}

export function encryptBackup(json: string, passphrase: string): Buffer {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(passphrase, salt);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv, tag, ciphertext]);
}

export function decryptBackup(data: Buffer, passphrase: string): string {
  if (data.length < HEADER_LEN) {
    throw new Error('File too small to be a valid .mrb backup');
  }

  if (!data.subarray(0, 4).equals(MAGIC)) {
    throw new Error('Invalid file: missing MRBF magic bytes');
  }

  const version = data[4];
  if (version !== VERSION) {
    throw new Error(`Unsupported backup version: ${version}`);
  }

  let offset = 5;
  const salt = data.subarray(offset, offset + SALT_LEN);
  offset += SALT_LEN;
  const iv = data.subarray(offset, offset + IV_LEN);
  offset += IV_LEN;
  const tag = data.subarray(offset, offset + TAG_LEN);
  offset += TAG_LEN;
  const ciphertext = data.subarray(offset);

  const key = deriveKey(passphrase, salt);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    throw new Error('invalid_passphrase');
  }
}
