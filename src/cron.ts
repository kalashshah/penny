import { Approvals } from './approvals';
import { ingestEndedCalls } from './calls';
import { rows } from './db';
import type { Env } from './env';
import { callOffFor, createAlert, releaseFor } from './events';
import { Memory } from './memory';
import { providerFor } from './providers';
import type { Dispute, Invoice } from './providers/types';
import { fmtMoney } from './providers/types';
import { isConnected, Tenants } from './tenants';

/** Every five minutes: file ended calls' transcripts into memory, expire stale approvals, catch missed invoice webhooks. */
export async function runCron(env: Env): Promise<void> {
  await Promise.all([
    ingestEndedCalls(env, async (tenantId) => new Memory(env, tenantId)).catch((e) => console.error('ingest_failed', String(e))),
    Approvals.expireStale(env.DB).catch((e) => console.error('expire_failed', String(e))),
    pollWaiting(env).catch((e) => console.error('poll_waiting_failed', String(e))),
    // Once an hour (the cron runs every five minutes): a PayPal read per tenant is too many to do every run.
    new Date().getUTCMinutes() < 5 ? watchDeadlines(env).catch((e) => console.error('deadlines_failed', String(e))) : undefined,
  ]);
}

/**
 * Pay-when-paid leans on the invoice.paid webhook; if PayPal never delivers it, the payout would wait forever.
 * So ask PayPal about the invoices waiting payouts hang on, a few per run (a random few, so a backlog
 * bigger than one batch is still covered over a few runs), skipping ones younger than a webhook needs.
 */
export async function pollWaiting(env: Env, limit = 10, minAgeMs = 5 * 60_000): Promise<number> {
  const due = await rows<{ tenant_id: string; after_invoice: string }>(
    env.DB.prepare("SELECT tenant_id, after_invoice FROM proposals WHERE status = 'waiting' AND created_at < ? GROUP BY tenant_id, after_invoice ORDER BY RANDOM() LIMIT ?").bind(
      Date.now() - minAgeMs,
      limit,
    ),
  );
  const tenants = new Tenants(env);
  let acted = 0;
  for (const { tenant_id, after_invoice } of due) {
    try {
      const t = await tenants.byId(tenant_id);
      if (!t || !isConnected(t)) continue;
      const provider = await providerFor(env, tenants, t);
      const inv = await provider.getInvoice(after_invoice);
      const page = `${env.PUBLIC_URL}/p/invoice/${encodeURIComponent(inv.id)}?k=${encodeURIComponent(t.pageKey)}`;
      if (inv.status === 'paid') {
        const r = await releaseFor(env, t, provider, inv.id);
        if (r) await createAlert(env, t.id, { title: `Invoice ${inv.number} (${inv.customer.name || inv.customer.email}) was paid`, detail: r.detail, page: r.page ?? page });
      } else if (inv.status === 'cancelled' || inv.status === 'refunded') {
        const off = await callOffFor(env, t, inv.id, `The invoice it waited on was ${inv.status}.`);
        if (off) await createAlert(env, t.id, { title: `Invoice ${inv.number} was ${inv.status}`, detail: off, page });
      } else continue;
      acted++;
    } catch (e) {
      console.error('poll_waiting_item_failed', { tenant: tenant_id, invoice: after_invoice, error: String(e) });
    }
  }
  return acted;
}

/** An invoice this many days past due gets an alert, at most once a week. */
export const OVERDUE_DAYS = 7;
const WEEK_MS = 7 * 86_400_000;
const RESPOND_WINDOW_MS = 48 * 60 * 60_000;
const RESOLVED = new Set(['RESOLVED', 'resolved']);

export interface DeadlineAlert {
  /** Stored as the alert's event_id; an alert with this key created after `since` means "already said". */
  key: string;
  since: number;
  title: string;
  detail: string;
  path: string;
}

/**
 * What is worth a nudge: invoices well overdue (an alert, not an automatic email to the customer:
 * the founders decide whether to chase) and disputes whose response deadline is under 48 hours away.
 */
export function deadlineAlerts(open: Invoice[], disputes: Dispute[], now: number): DeadlineAlert[] {
  const out: DeadlineAlert[] = [];
  for (const i of open) {
    if ((i.status !== 'sent' && i.status !== 'partially_paid') || !i.dueDate) continue;
    const days = Math.floor((now - Date.parse(i.dueDate.slice(0, 10))) / 86_400_000);
    if (!(days >= OVERDUE_DAYS)) continue;
    const who = i.customer.name || i.customer.email || 'the customer';
    out.push({
      key: `overdue:${i.id}`,
      since: now - WEEK_MS,
      title: `Invoice ${i.number} (${who}) is ${days} days overdue`,
      detail: `${fmtMoney(i.due)} is still due. Penny can send ${who} a reminder, or talk through what to do.`,
      path: `/p/invoice/${encodeURIComponent(i.id)}`,
    });
  }
  for (const d of disputes) {
    if (RESOLVED.has(d.state) || RESOLVED.has(d.status) || !d.respondBy) continue;
    const left = Date.parse(d.respondBy) - now;
    if (!(left > 0 && left < RESPOND_WINDOW_MS)) continue;
    out.push({
      // The deadline is in the key: a new deadline on the same dispute is worth a new alert.
      key: `respond-by:${d.id}:${d.respondBy}`,
      since: 0,
      title: `Dispute ${d.id} needs a response within ${Math.max(1, Math.round(left / 3_600_000))} hours`,
      detail: `${fmtMoney(d.amount)} is at stake and PayPal decides against you if nobody responds by ${d.respondBy}. Penny can draft the reply.`,
      path: `/p/dispute/${encodeURIComponent(d.id)}`,
    });
  }
  return out;
}

/** Hourly: raise the deadline alerts each connected tenant has not been given yet. */
export async function watchDeadlines(env: Env, now = Date.now()): Promise<number> {
  const tenants = new Tenants(env);
  let raised = 0;
  for (const t of await tenants.listConnected(50)) {
    try {
      const provider = await providerFor(env, tenants, t);
      const [open, disputes] = await Promise.all([provider.listInvoices({ status: 'open', limit: 50 }), provider.listDisputes()]);
      for (const a of deadlineAlerts(open, disputes, now)) {
        const seen = await env.DB.prepare('SELECT 1 AS x FROM alerts WHERE tenant_id = ? AND event_id = ? AND created_at > ? LIMIT 1').bind(t.id, a.key, a.since).first<number>('x');
        if (seen) continue;
        await createAlert(env, t.id, { eventId: a.key, title: a.title, detail: a.detail, page: `${env.PUBLIC_URL}${a.path}?k=${encodeURIComponent(t.pageKey)}` });
        raised++;
      }
    } catch (e) {
      console.error('deadlines_tenant_failed', { tenant: t.id, error: String(e) });
    }
  }
  return raised;
}
