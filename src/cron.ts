import { Approvals } from './approvals';
import { ingestEndedCalls } from './calls';
import type { Env } from './env';
import { Memory } from './memory';

/** Every five minutes: file ended calls' transcripts into memory, expire stale approvals. */
export async function runCron(env: Env): Promise<void> {
  await Promise.all([
    ingestEndedCalls(env, async (tenantId) => new Memory(env, tenantId)).catch((e) => console.error('ingest_failed', String(e))),
    Approvals.expireStale(env.DB).catch((e) => console.error('expire_failed', String(e))),
  ]);
}
