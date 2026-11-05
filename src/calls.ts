import { rows } from './db';
import type { Env } from './env';
import type { Memory } from './memory';
import { buildInstructions } from './persona';
import type { PaymentProvider } from './providers/types';
import { describeSummary, fetchSummary } from './summary';
import type { Tenant } from './tenants';

export interface CallRow {
  room: string;
  tenant_id: string;
  join_url: string;
  reason: string | null;
  started_at: number;
  ended_at: number | null;
  ingested: number;
}

export interface AlertContext {
  title: string;
  detail: string;
  page?: string;
}

/** Starts a LlamaCalls call with Penny on it for one tenant. The founder joins through `joinUrl`. */
export async function startCall(
  env: Env,
  t: Tenant,
  mcpToken: string,
  provider: PaymentProvider,
  memory: Memory,
  opts: { reason?: string; alert?: AlertContext } = {},
): Promise<{ room: string; joinUrl: string }> {
  const [snapshot, memoryPrompt] = await Promise.all([
    snapshotText(t, provider),
    memory.contextPrompt(opts.alert ? `${opts.alert.title}. ${opts.alert.detail}` : 'company finances, decisions, vendors, customers, founders'),
  ]);
  const instructions = buildInstructions({
    business: t.businessName,
    currency: t.currency,
    threshold: t.approvalThreshold,
    memoryPrompt,
    snapshot,
    alert: opts.alert ? `${opts.alert.title}. ${opts.alert.detail}${opts.alert.page ? ` Show ${opts.alert.page} with show_page.` : ''}` : undefined,
  });
  const body = {
    agent: {
      name: 'Penny',
      instructions,
      ...(opts.alert ? { greeting: `Hi, it's Penny. ${opts.alert.title.slice(0, 200)}. Want me to walk you through it?` } : {}),
      // This tenant's own tools: Penny's MCP server, keyed by the tenant's token.
      mcpServers: [{ name: 'penny', url: `${env.PUBLIC_URL}/mcp`, token: mcpToken }],
      capabilities: {
        screenShare: true,
        recording: 'transcript',
        respond: 'always',
        ...(env.LLAMACALLS_AVATAR_ID ? { face: 'lifelike', avatarId: env.LLAMACALLS_AVATAR_ID } : {}),
      },
    },
    metadata: { tenant: t.id, reason: opts.reason ?? (opts.alert ? 'alert' : 'dashboard'), ...(opts.alert ? { alert: opts.alert.title.slice(0, 200) } : {}) },
  };
  const res = await fetch(`${env.LLAMACALLS_URL}/api/calls`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.LLAMACALLS_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as { room?: string; joinUrl?: string; url?: string; token?: string; error?: string };
  if (!res.ok || !j.room) throw new Error(`LlamaCalls could not start the call (${res.status}): ${j.error ?? 'no room returned'}`);
  const joinUrl =
    j.joinUrl ??
    `${env.LLAMACALLS_URL}/embed/${encodeURIComponent(j.room)}#${new URLSearchParams({ url: j.url ?? '', token: j.token ?? '', name: 'Penny' })}`;
  await env.DB.prepare('INSERT INTO calls (room, tenant_id, join_url, reason, started_at) VALUES (?, ?, ?, ?, ?)')
    .bind(j.room, t.id, joinUrl, opts.reason ?? opts.alert?.title ?? null, Date.now())
    .run();
  return { room: j.room, joinUrl };
}

export async function listCalls(env: Env, tenantId: string, limit = 5): Promise<CallRow[]> {
  return rows<CallRow>(env.DB.prepare('SELECT * FROM calls WHERE tenant_id = ? ORDER BY started_at DESC LIMIT ?').bind(tenantId, limit));
}

/** Cron: every ended call gets its transcript filed in its tenant's memory, once. */
export async function ingestEndedCalls(env: Env, memoryFor: (tenantId: string) => Promise<Memory>): Promise<number> {
  const pending = await rows<CallRow>(
    env.DB.prepare('SELECT * FROM calls WHERE ingested = 0 AND started_at > ? ORDER BY started_at ASC LIMIT 20').bind(Date.now() - 2 * 86_400_000),
  );
  let done = 0;
  const headers = { Authorization: `Bearer ${env.LLAMACALLS_KEY}` };
  for (const call of pending) {
    // One call's failure (a LlamaCalls hiccup, memory down) is retried next run and never holds up the rest.
    try {
      const meta = await fetch(`${env.LLAMACALLS_URL}/api/calls/${encodeURIComponent(call.room)}`, { headers });
      if (!meta.ok) continue;
      const { call: info } = (await meta.json()) as { call?: { endedAt?: number | null } };
      if (!info?.endedAt) continue;
      const tx = await fetch(`${env.LLAMACALLS_URL}/api/calls/${encodeURIComponent(call.room)}/transcript`, { headers });
      const text = tx.ok ? transcriptText(await tx.text()) : '';
      if (text.split('\n').length >= 3) {
        const memory = await memoryFor(call.tenant_id);
        if (memory.enabled) {
          const when = new Date(call.started_at).toUTCString();
          await memory.remember(`Call between Penny (the AI CFO) and the founders on ${when}. Keep decisions, instructions to Penny, vendor/customer facts and deadlines.\n\n${text.slice(0, 20_000)}`);
        }
      }
      await env.DB.prepare('UPDATE calls SET ended_at = ?, ingested = 1 WHERE room = ?').bind(info.endedAt, call.room).run();
      done++;
    } catch (e) {
      console.error('ingest_call_failed', { room: call.room, error: String(e) });
    }
  }
  return done;
}

/** LlamaCalls transcripts are NDJSON segments; keep the final ones as "Name: text" lines. */
export function transcriptText(ndjson: string): string {
  const out: string[] = [];
  for (const line of ndjson.split('\n')) {
    if (!line.trim()) continue;
    try {
      const s = JSON.parse(line) as { role?: string; speakerName?: string | null; text?: string; final?: boolean };
      if (s.final === false || !s.text?.trim()) continue;
      out.push(`${s.role === 'assistant' ? 'Penny' : s.speakerName || 'Founder'}: ${s.text.trim()}`);
    } catch {
      /* a partial line; skip it */
    }
  }
  return out.join('\n');
}

async function snapshotText(t: Tenant, provider: PaymentProvider): Promise<string> {
  try {
    return describeSummary(await fetchSummary(provider, t.currency, 50));
  } catch (e) {
    console.error('snapshot_failed', String(e));
    return '';
  }
}
