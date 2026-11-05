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
  'payout.pending': 'It has not reached them yet, but it has not failed either; nothing needs doing for now.',
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

  const key = `${t.id}:${event.id}`;
  const inserted = await env.DB.prepare('INSERT OR IGNORE INTO events (id, tenant_id, provider, type, summary, payload, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(key, t.id, provider.name, event.type, event.summary, raw.slice(0, 60_000), Date.now())
    .run();
  // Seen before: a no-op only if that delivery got to the end. Otherwise PayPal is retrying one we failed halfway.
  if (!inserted.meta.changes && (await env.DB.prepare('SELECT processed FROM events WHERE id = ?').bind(key).first<number>('processed'))) {
    return Response.json({ ok: true, duplicate: true });
  }
  const done = () => env.DB.prepare('UPDATE events SET processed = 1 WHERE id = ?').bind(key).run();
  if (event.type === 'other') {
    await done();
    return Response.json({ ok: true, noted: true });
  }

  let detail = DETAIL[event.type] ?? '';
  let page = pageFor(env, t, event);
  if (event.type === 'invoice.paid' && event.refId) {
    const r = await releaseFor(env, t, provider, event.refId);
    if (r) {
      detail = r.detail;
      page = r.page ?? page;
    }
  }
  // A payout Penny reported as paid that PayPal later failed: the proposal says so now, not "done".
  if (event.type === 'payout.failed' && event.payoutKey) {
    const p = await new Approvals(env.DB, t.id).failPayout(event.payoutKey, event.reason ?? 'failed');
    if (p) {
      detail = `${p.description} did not go through${event.reason ? ` (${event.reason})` : ''}. ${detail}`;
      page = `${env.PUBLIC_URL}/p/proposal/${p.id}?k=${encodeURIComponent(t.pageKey)}`;
    }
  }
  // Not final (unclaimed, held): say where it stands, and leave the proposal as it is.
  if (event.type === 'payout.pending' && event.payoutKey) {
    const p = await new Approvals(env.DB, t.id).get(event.payoutKey);
    if (p?.kind === 'payout') {
      detail = `${p.description} has not reached them yet${event.reason ? ` (${event.reason})` : ''}. It has not failed; PayPal will report again when it settles.`;
      page = `${env.PUBLIC_URL}/p/proposal/${p.id}?k=${encodeURIComponent(t.pageKey)}`;
    }
  }
  if (event.type === 'payout.completed' && event.payoutKey) {
    const p = await new Approvals(env.DB, t.id).completePayout(event.payoutKey, event.refId);
    if (p) page = `${env.PUBLIC_URL}/p/proposal/${p.id}?k=${encodeURIComponent(t.pageKey)}`;
  }
  if (event.type === 'invoice.cancelled' && event.refId) {
    const off = await callOffFor(env, t, event.refId, 'The invoice it waited on was cancelled.');
    if (off) detail = `${detail} ${off}`;
  }
  // A retry after the alert was written but before processed was set should not alert twice.
  const prior = inserted.meta.changes ? null : await env.DB.prepare('SELECT id FROM alerts WHERE tenant_id = ? AND event_id = ?').bind(t.id, event.id).first<string>('id');
  const alert = prior ? { id: prior } : await createAlert(env, t.id, { eventId: event.id, title: event.summary, detail, page });
  await done();
  ctx.waitUntil(memory.remember(`${new Date().toUTCString()}: ${event.summary}`, false).catch((e) => console.error('memory.remember_failed', String(e))));
  return Response.json({ ok: true, alert: alert.id });
}

/** Payouts that were waiting on this invoice ("pay Sam when Acme pays") go now, or ask for a yes. Null when none waited. */
export async function releaseFor(env: Env, t: Tenant, provider: PaymentProvider, invoiceId: string, opts: { alwaysAsk?: boolean } = {}): Promise<{ detail: string; page?: string } | null> {
  const released = await releaseWaiting({ approvals: new Approvals(env.DB, t.id), provider, threshold: t.approvalThreshold, currency: t.currency || 'USD' }, invoiceId, opts);
  if (!released.length) return null;
  const detail = released.map((o) => (o.status === 'needs_approval' ? `You asked to pay ${o.proposal.input.recipientEmail} ${o.proposal.currency} ${o.proposal.amount.toFixed(2)} once this came in. It needs your yes.` : (o.result ?? ''))).join(' ');
  const ask = released.find((o) => o.status === 'needs_approval');
  return { detail, page: ask ? `${env.PUBLIC_URL}/p/proposal/${ask.proposal.id}?k=${encodeURIComponent(t.pageKey)}` : undefined };
}

/** The invoice will never be paid, so what waited on it is called off rather than waiting forever. Says so, or null. */
export async function callOffFor(env: Env, t: Tenant, invoiceId: string, why: string): Promise<string | null> {
  const off = await new Approvals(env.DB, t.id).callOff(invoiceId, why);
  if (!off.length) return null;
  return `Called off: ${off.map((p) => `paying ${p.input.recipientEmail} ${p.currency} ${p.amount.toFixed(2)}`).join(', ')}.`;
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

