import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// AES-256-GCM. Stored format: base64(iv).base64(tag).base64(ciphertext)
export class Secrets {
  private key: Buffer;

  constructor(base64Key: string | undefined, onInsecure?: () => void) {
    if (base64Key) {
      const key = Buffer.from(base64Key, 'base64');
      if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes encoded as base64');
      this.key = key;
    } else {
      onInsecure?.();
      this.key = createHash('sha256').update('compras-whatsapp-dev-only-key').digest();
    }
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
  }

  decrypt(stored: string): string {
    const [iv, tag, enc] = stored.split('.').map((p) => Buffer.from(p, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }
}
