import type { D1Database } from '@cloudflare/workers-types';

/** Counts one use of `kind` for a tenant today (UTC) and says whether it is within `cap`. One statement, so concurrent uses all count. */
export async function takeDaily(db: D1Database, tenantId: string, kind: string, cap: number, now = Date.now()): Promise<boolean> {
  const day = new Date(now).toISOString().slice(0, 10);
  const n = await db
    .prepare('INSERT INTO usage (tenant_id, kind, day, count) VALUES (?, ?, ?, 1) ON CONFLICT (tenant_id, kind, day) DO UPDATE SET count = count + 1 RETURNING count')
    .bind(tenantId, kind, day)
    .first<number>('count');
  return (n ?? 0) <= cap;
}
