import { Approvals } from './approvals';
import { ingestEndedCalls } from './calls';
import { rows } from './db';
import type { Env } from './env';
import { callOffFor, createAlert, releaseFor } from './events';
import { Memory } from './memory';
import { providerFor } from './providers';
import { isConnected, Tenants } from './tenants';

/** Every five minutes: file ended calls' transcripts into memory, expire stale approvals, catch missed invoice webhooks. */
export async function runCron(env: Env): Promise<void> {
  await Promise.all([
    ingestEndedCalls(env, async (tenantId) => new Memory(env, tenantId)).catch((e) => console.error('ingest_failed', String(e))),
    Approvals.expireStale(env.DB).catch((e) => console.error('expire_failed', String(e))),
    pollWaiting(env).catch((e) => console.error('poll_waiting_failed', String(e))),
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
