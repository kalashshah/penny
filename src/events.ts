import { Approvals, releaseWaiting } from './approvals';
import { rows, shortId } from './db';
import type { Env } from './env';
import type { Memory } from './memory';
import type { PaymentProvider, PennyEvent } from './providers/types';
import type { Tenant } from './tenants';

export interface Alert {
  id: string;
  tenant_id: string;
  event_id: string | null;
  title: string;
  detail: string;
  page: string | null;
  created_at: number;
  dismissed: number;
}

const DETAIL: Partial<Record<PennyEvent['type'], string>> = {
  'invoice.paid': 'Money landed. Penny can confirm what is still outstanding.',
  'invoice.cancelled': 'Penny can re-issue it or chase the customer.',
  'dispute.created': 'There is a response deadline. Penny has the facts and can draft the reply.',
  'dispute.updated': 'Something changed on an open dispute.',
  'dispute.resolved': 'Penny can tell you how it ended.',
  'payout.failed': 'Someone did not get paid. Penny can retry or try another email.',
  'payout.completed': 'The payout went through.',
  'payment.received': 'A payment came in outside an invoice.',
  'payment.refunded': 'A refund was processed.',
};

/** Where Penny should point when this event comes up on a call. The page key lets her browser in. */
export function pageFor(env: Env, t: Tenant, e: PennyEvent): string | undefined {
  const k = `k=${encodeURIComponent(t.pageKey)}`;
  if (e.refKind === 'invoice' && e.refId) return `${env.PUBLIC_URL}/p/invoice/${encodeURIComponent(e.refId)}?${k}`;
  if (e.refKind === 'dispute' && e.refId) return `${env.PUBLIC_URL}/p/dispute/${encodeURIComponent(e.refId)}?${k}`;
  if (e.refKind === 'transaction' || e.refKind === 'payout') return `${env.PUBLIC_URL}/p/transactions?${k}`;
  return undefined;
}

/** One provider webhook for one tenant: verify, dedupe, remember, alert. */
export async function handleWebhook(
  env: Env,
  t: Tenant,
  provider: PaymentProvider,
  memory: Memory,
  request: Request,
  ctx: { waitUntil(p: Promise<unknown>): void },
): Promise<Response> {
  const raw = await request.text();
  if (env.WEBHOOK_VERIFY !== 'off' && !(await provider.verifyWebhook(request.headers, raw))) {
    return Response.json({ error: 'signature verification failed' }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'not json' }, { status: 400 });
  }
  const event = provider.parseEvent(body);
  if (!event) return Response.json({ ok: true, ignored: true });

  const inserted = await env.DB.prepare('INSERT OR IGNORE INTO events (id, tenant_id, provider, type, summary, payload, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(`${t.id}:${event.id}`, t.id, provider.name, event.type, event.summary, raw.slice(0, 60_000), Date.now())
    .run();
  if (!inserted.meta.changes) return Response.json({ ok: true, duplicate: true });
  if (event.type === 'other') return Response.json({ ok: true, noted: true });

  let detail = DETAIL[event.type] ?? '';
  let page = pageFor(env, t, event);
  // Payouts that were waiting on this invoice ("pay Sam when Acme pays") go now, or ask for a yes.
  if (event.type === 'invoice.paid' && event.refId) {
    const released = await releaseWaiting({ approvals: new Approvals(env.DB, t.id), provider, threshold: t.approvalThreshold, currency: t.currency || 'USD' }, event.refId);
    if (released.length) {
      detail = released.map((o) => (o.status === 'needs_approval' ? `You asked to pay ${o.proposal.input.recipientEmail} ${o.proposal.currency} ${o.proposal.amount.toFixed(2)} once this came in. It needs your yes.` : (o.result ?? ''))).join(' ');
      const ask = released.find((o) => o.status === 'needs_approval');
      if (ask) page = `${env.PUBLIC_URL}/p/proposal/${ask.proposal.id}?k=${encodeURIComponent(t.pageKey)}`;
    }
  }
  const alert = await createAlert(env, t.id, { eventId: event.id, title: event.summary, detail, page });
  ctx.waitUntil(memory.remember(`${new Date().toUTCString()}: ${event.summary}`, false).catch((e) => console.error('memory.remember_failed', String(e))));
  return Response.json({ ok: true, alert: alert.id });
}

export async function createAlert(env: Env, tenantId: string, a: { eventId?: string; title: string; detail: string; page?: string }): Promise<Alert> {
  const alert: Alert = { id: shortId('al'), tenant_id: tenantId, event_id: a.eventId ?? null, title: a.title, detail: a.detail, page: a.page ?? null, created_at: Date.now(), dismissed: 0 };
  await env.DB.prepare('INSERT INTO alerts (id, tenant_id, event_id, title, detail, page, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(alert.id, alert.tenant_id, alert.event_id, alert.title, alert.detail, alert.page, alert.created_at)
    .run();
  return alert;
}

export async function listAlerts(env: Env, tenantId: string): Promise<Alert[]> {
  return rows<Alert>(env.DB.prepare('SELECT * FROM alerts WHERE tenant_id = ? AND dismissed = 0 ORDER BY created_at DESC LIMIT 20').bind(tenantId));
}

export async function getAlert(env: Env, tenantId: string, id: string): Promise<Alert | null> {
  return env.DB.prepare('SELECT * FROM alerts WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first<Alert>();
}

export async function dismissAlert(env: Env, tenantId: string, id: string): Promise<void> {
  await env.DB.prepare('UPDATE alerts SET dismissed = 1 WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
}

