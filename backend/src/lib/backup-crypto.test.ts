import { describe, it, expect } from 'vitest';
import { encryptBackup, decryptBackup } from './backup-crypto';

describe('backup-crypto', () => {
  it('round-trips encrypt/decrypt', () => {
    const payload = JSON.stringify({ version: 1, test: 'hello world' });
    const passphrase = 'my-strong-passphrase';

    const encrypted = encryptBackup(payload, passphrase);
    const decrypted = decryptBackup(encrypted, passphrase);

    expect(decrypted).toBe(payload);
  });

  it('starts with MRBF magic bytes', () => {
    const encrypted = encryptBackup('{}', 'pass');
    expect(encrypted[0]).toBe(0x4d); // M
    expect(encrypted[1]).toBe(0x52); // R
    expect(encrypted[2]).toBe(0x42); // B
    expect(encrypted[3]).toBe(0x46); // F
    expect(encrypted[4]).toBe(0x01); // version
  });

  it('rejects wrong passphrase', () => {
    const encrypted = encryptBackup('secret data', 'correct-pass');
    expect(() => decryptBackup(encrypted, 'wrong-pass')).toThrow('invalid_passphrase');
  });

  it('rejects truncated data', () => {
    expect(() => decryptBackup(Buffer.alloc(10), 'pass')).toThrow('too small');
  });

  it('rejects bad magic bytes', () => {
    const buf = Buffer.alloc(100);
    buf.write('XXXX', 0);
    expect(() => decryptBackup(buf, 'pass')).toThrow('magic');
  });

  it('handles large payloads', () => {
    const large = JSON.stringify({ data: 'x'.repeat(100_000) });
    const encrypted = encryptBackup(large, 'pass123');
    const decrypted = decryptBackup(encrypted, 'pass123');
    expect(decrypted).toBe(large);
  });
});
