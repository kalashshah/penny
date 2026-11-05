// A real SQLite (node:sqlite) behind the slice of the D1 API Penny uses, with the repo's migrations applied.
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database } from '@cloudflare/workers-types';

type Arg = string | number | null;

export function fakeD1(): D1Database {
  const db = new DatabaseSync(':memory:');
  const dir = new URL('../../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'));
  const prepare = (sql: string) => {
    let args: Arg[] = [];
    const stmt = {
      bind(...a: unknown[]) {
        args = a.map((x) => (x === undefined ? null : (x as Arg)));
        return stmt;
      },
      async first<T>() {
        return (db.prepare(sql).get(...args) as T | undefined) ?? null;
      },
      async all<T>() {
        return { results: db.prepare(sql).all(...args) as T[], success: true, meta: {} };
      },
      async run() {
        const r = db.prepare(sql).run(...args);
        return { results: [], success: true, meta: { changes: Number(r.changes) } };
      },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}
