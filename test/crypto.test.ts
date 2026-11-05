import { describe, expect, it } from 'vitest';
import { randomHex, safeEqual, Sealer, sha256Hex } from '../src/crypto';

describe('Sealer', () => {
  it('round-trips a secret and refuses another key', async () => {
    const keyA = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const keyB = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const sealed = await new Sealer(keyA).seal('EHx-secret');
    expect(sealed.ct).not.toContain('EHx-secret');
    expect(await new Sealer(keyA).open(sealed.ct, sealed.iv)).toBe('EHx-secret');
    await expect(new Sealer(keyB).open(sealed.ct, sealed.iv)).rejects.toBeTruthy();
  });
  it('fails loudly without a master key', async () => {
    await expect(new Sealer('').seal('x')).rejects.toThrow(/PENNY_MASTER_KEY/);
  });
});

describe('hashes and tokens', () => {
  it('hashes deterministically and compares in constant shape', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
    expect(randomHex(24)).toMatch(/^[0-9a-f]{48}$/);
  });
});
