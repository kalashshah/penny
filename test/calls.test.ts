import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAILY_CALL_CAP, callBlocker, transcriptText } from '../src/calls';
import type { Env } from '../src/env';
import { fakeD1 } from './helpers/d1';
import { buildInstructions } from '../src/persona';

describe('transcriptText', () => {
  it('keeps final lines, names speakers, skips junk', () => {
    const ndjson = [
      JSON.stringify({ role: 'assistant', speakerName: null, text: 'Hi, it is Penny.', final: true }),
      JSON.stringify({ role: 'user', speakerName: 'Alex', text: 'Pay Sam fifty dollars.', final: true }),
      JSON.stringify({ role: 'user', speakerName: 'Alex', text: 'Pay Sam', final: false }),
      JSON.stringify({ role: 'user', speakerName: null, text: '   ', final: true }),
      '{not json',
    ].join('\n');
    expect(transcriptText(ndjson)).toBe('Penny: Hi, it is Penny.\nAlex: Pay Sam fifty dollars.');
  });
});

describe('buildInstructions', () => {
  it('stays under the LlamaCalls limit even with a huge memory block', () => {
    const text = buildInstructions({ business: 'Acme', currency: 'USD', threshold: 100, memoryPrompt: 'x'.repeat(20_000), snapshot: 'Nothing overdue.', alert: 'Invoice 0042 was paid' });
    expect(text.length).toBeLessThanOrEqual(8_000);
    expect(text).toContain('Invoice 0042 was paid');
    expect(text).toContain('USD 100');
  });
});

describe('callBlocker', () => {
  const now = Date.UTC(2026, 10, 5, 12);
  const rig = () => {
    const env = { DB: fakeD1(), LLAMACALLS_URL: 'https://calls.test', LLAMACALLS_KEY: 'k' } as Env;
    const add = (room: string, startedAt: number, endedAt: number | null = null) =>
      env.DB.prepare('INSERT INTO calls (room, tenant_id, join_url, started_at, ended_at) VALUES (?, ?, ?, ?, ?)').bind(room, 't_1', 'u', startedAt, endedAt).run();
    return { env, add };
  };
  const llamaSays = (endedAt: number | null) => vi.stubGlobal('fetch', vi.fn(async () => Response.json({ call: { endedAt } })));
  afterEach(() => vi.unstubAllGlobals());

  it('lets a tenant with no open call start one', async () => {
    const { env, add } = rig();
    await add('r1', now - 3_600_000, now - 3_000_000);
    expect(await callBlocker(env, 't_1', now)).toBeNull();
  });
  it('refuses a second call while one is live', async () => {
    const { env, add } = rig();
    await add('r1', now - 5 * 60_000);
    llamaSays(null);
    expect(await callBlocker(env, 't_1', now)).toMatch(/already on a call/);
  });
  it('does not block on a call LlamaCalls says has ended, and records the end', async () => {
    const { env, add } = rig();
    await add('r1', now - 5 * 60_000);
    llamaSays(now - 60_000);
    expect(await callBlocker(env, 't_1', now)).toBeNull();
    expect(await env.DB.prepare("SELECT ended_at FROM calls WHERE room = 'r1'").first<number>('ended_at')).toBe(now - 60_000);
  });
  it('caps calls per day', async () => {
    const { env, add } = rig();
    for (let n = 0; n < DAILY_CALL_CAP; n++) await add(`r${n}`, now - (n + 1) * 60_000, now - n * 60_000);
    expect(await callBlocker(env, 't_1', now)).toMatch(/daily limit/);
  });
});
