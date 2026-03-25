import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY environment variable is required');
  return createHash('sha256').update(raw).digest();
}

export function encrypt(text: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(encryptedText: string): string {
  const [ivHex, encryptedHex] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
