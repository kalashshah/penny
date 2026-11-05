import type { D1Database } from '@cloudflare/workers-types';
import { isDefiniteRejection } from './providers/types';

/** How long a retried call gets the first call's answer instead of doing it again. */
export const IDEMPOTENCY_TTL_MS = 10 * 60_000;

/**
 * Runs `fn` once per tenant and key within the TTL; a repeat gets the first answer back. A first call that the rail
 * definitely refused frees the key for a retry. One that ended unclearly (it may have gone through) keeps it, so a
 * retry is told to check rather than doing it twice. `fn` receives the claim time, to tie a rail-side request id to
 * this claim rather than to the arguments alone.
 */
export async function once<T>(db: D1Database, tenantId: string, key: string, fn: (claimedAt: number) => Promise<T>, now = Date.now()): Promise<T> {
  await db.prepare('DELETE FROM idempotency WHERE tenant_id = ? AND key = ? AND created_at < ?').bind(tenantId, key, now - IDEMPOTENCY_TTL_MS).run();
  const claimed = await db.prepare('INSERT OR IGNORE INTO idempotency (tenant_id, key, result, created_at) VALUES (?, ?, NULL, ?)').bind(tenantId, key, now).run();
  if (!claimed.meta.changes) {
    const result = await db.prepare('SELECT result FROM idempotency WHERE tenant_id = ? AND key = ?').bind(tenantId, key).first<string | null>('result');
    if (result) return JSON.parse(result) as T;
    throw new Error('The same request was made moments ago and has not finished (or ended unclearly). Check whether it went through before asking again.');
  }
  let out: T;
  try {
    out = await fn(now);
  } catch (e) {
    if (isDefiniteRejection(e)) await db.prepare('DELETE FROM idempotency WHERE tenant_id = ? AND key = ?').bind(tenantId, key).run();
    throw e;
  }
  await db.prepare('UPDATE idempotency SET result = ? WHERE tenant_id = ? AND key = ?').bind(JSON.stringify(out ?? null), tenantId, key).run();
  return out;
}
