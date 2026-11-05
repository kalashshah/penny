/** AES-GCM for tenant secrets at rest: 12-byte IV, base64 in and out. Same shape LlamaCalls uses for connector tokens. */
export class Sealer {
  private key: Promise<CryptoKey> | undefined;
  constructor(private readonly keyBase64: string) {}

  private getKey(): Promise<CryptoKey> {
    if (!this.keyBase64) throw new Error('PENNY_MASTER_KEY is not set');
    this.key ??= crypto.subtle.importKey('raw', fromBase64(this.keyBase64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    return this.key;
  }

  async seal(plaintext: string): Promise<{ ct: string; iv: string }> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.getKey(), new TextEncoder().encode(plaintext));
    return { ct: toBase64(new Uint8Array(buf)), iv: toBase64(iv) };
  }

  async open(ct: string, iv: string): Promise<string> {
    const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, await this.getKey(), fromBase64(ct));
    return new TextDecoder().decode(buf);
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomHex(bytes = 24): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
