import type { D1PreparedStatement } from '@cloudflare/workers-types';

/** Short, URL-safe ids; PayPal caps batch ids at 30 chars, so keep these well under. */
export function shortId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export async function rows<T>(stmt: D1PreparedStatement): Promise<T[]> {
  const res = await stmt.all<T>();
  return res.results ?? [];
}
