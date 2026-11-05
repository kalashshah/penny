import { describe, expect, it } from 'vitest';
import { Approvals, runOrHold } from '../src/approvals';
import type { Env } from '../src/env';
import { handleWebhook } from '../src/events';
import type { Memory } from '../src/memory';
import { toEvent } from '../src/providers/paypal';
import type { Invoice, PaymentProvider } from '../src/providers/types';
import type { Tenant } from '../src/tenants';
import { fakeD1 } from './helpers/d1';

const tenant = { id: 't_1', pageKey: 'pk', approvalThreshold: 100, currency: 'USD' } as Tenant;
const memory = { remember: async () => '' } as unknown as Memory;
const ctx = { waitUntil: () => {} };

function webhookRig() {
  const env = { DB: fakeD1(), PUBLIC_URL: 'https://penny.test', WEBHOOK_VERIFY: 'off' } as Env;
  const calls = { payout: 0 };
  // What getInvoice answers: by default paid in full through PayPal.
  const invoices: Record<string, Partial<Invoice>> = {};
  const provider = {
    name: 'paypal',
    parseEvent: toEvent,
    async getInvoice(id: string): Promise<Invoice> {
      return { id, number: id, status: 'paid', customer: { name: 'Acme', email: 'ap@acme.test' }, total: { value: 1000, currency: 'USD' }, due: { value: 0, currency: 'USD' }, items: [], paymentIds: ['CAP1'], paidViaRail: true, ...invoices[id] };
    },
    async payout({ amount, recipientEmail }: { amount: { value: number; currency: string }; recipientEmail: string }) {
      calls.payout++;
      return { id: 'PB-1', status: 'pending', amount, recipient: recipientEmail };
    },
  } as unknown as PaymentProvider;
  const deliver = async (body: unknown) => (await handleWebhook(env, tenant, provider, memory, new Request('https://penny.test/webhooks/paypal/t_1', { method: 'POST', body: JSON.stringify(body) }), ctx)).json() as Promise<Record<string, unknown>>;
  const alerts = async () => (await env.DB.prepare('SELECT * FROM alerts WHERE tenant_id = ?').bind(tenant.id).all<{ title: string; detail: string }>()).results;
  return { env, provider, calls, deliver, alerts, tenant, invoices };
}

const paid = { id: 'WH-1', event_type: 'INVOICING.INVOICE.PAID', resource: { invoice: { id: 'INV2-1', detail: { invoice_number: '0042' }, amount: { currency_code: 'USD', value: '1000.00' } } } };

describe('handleWebhook', () => {
  it('alerts once and treats a processed redelivery as a duplicate', async () => {
    const { deliver, alerts } = webhookRig();
    expect((await deliver(paid)).alert).toBeTruthy();
    expect((await deliver(paid)).duplicate).toBe(true);
    expect(await alerts()).toHaveLength(1);
  });

  it('reprocesses a redelivery of an event that failed halfway', async () => {
    const { env, deliver, alerts } = webhookRig();
    // As if an earlier delivery stored the event and then died before acting on it.
    await env.DB.prepare("INSERT INTO events (id, tenant_id, provider, type, summary, payload, received_at) VALUES ('t_1:WH-1', 't_1', 'paypal', 'invoice.paid', 's', '{}', 0)").run();
    const r = await deliver(paid);
    expect(r.duplicate).toBeUndefined();
    expect(await alerts()).toHaveLength(1);
    expect((await deliver(paid)).duplicate).toBe(true);
  });

  it('calls off waiting payouts when their invoice is cancelled, and releases them when paid', async () => {
    const { env, deliver, calls } = webhookRig();
    const approvals = new Approvals(env.DB, 't_1');
    const later = await approvals.create('payout', 'Pay later', { value: 50, currency: 'USD' }, { recipientEmail: 'sam@example.com' }, 'INV2-2');
    const other = await approvals.create('payout', 'Pay later', { value: 50, currency: 'USD' }, { recipientEmail: 'sam@example.com' }, 'INV2-1');
    await deliver({ id: 'WH-2', event_type: 'INVOICING.INVOICE.CANCELLED', resource: { invoice: { id: 'INV2-2', amount: { currency_code: 'USD', value: '50.00' } } } });
    const off = await approvals.get(later.id);
    expect(off?.status).toBe('rejected');
    expect(off?.result).toMatch(/cancelled/);
    await deliver(paid);
    expect((await approvals.get(other.id))?.status).toBe('done');
    expect(calls.payout).toBe(1);
  });

  it('marks a payout PayPal later failed as failed, with why, and still alerts', async () => {
    const { env, deliver, alerts } = webhookRig();
    const approvals = new Approvals(env.DB, 't_1');
    const out = await runOrHold({ approvals, provider: webhookRig().provider, threshold: 100, currency: 'USD' }, 'payout', 'Pay USD 50.00 to sam@example.com: x', { value: 50, currency: 'USD' }, { recipientEmail: 'sam@example.com' });
    expect(out.status).toBe('done');
    await deliver({ id: 'WH-6', event_type: 'PAYMENT.PAYOUTS-ITEM.RETURNED', resource: { payout_batch_id: 'PB-1', payout_item: { sender_item_id: `${out.proposal.id}-1`, receiver: 'sam@example.com', amount: { currency: 'USD', value: '50.00' } } } });
    const p = await approvals.get(out.proposal.id);
    expect(p?.status).toBe('failed');
    expect(p?.result).toMatch(/PayPal then reported it returned/);
    const [a] = await alerts();
    expect(a.detail).toMatch(/did not go through/);
  });

  it('an unclaimed payout only informs; a later success settles it, and undoes an old unclaimed failure', async () => {
    const { env, deliver, alerts } = webhookRig();
    const approvals = new Approvals(env.DB, 't_1');
    const deps = { approvals, provider: webhookRig().provider, threshold: 100, currency: 'USD' };
    const out = await runOrHold(deps, 'payout', 'Pay USD 50.00 to sam@example.com: x', { value: 50, currency: 'USD' }, { recipientEmail: 'sam@example.com' });
    const item = (id: string, state: string, key: string) => ({ id, event_type: `PAYMENT.PAYOUTS-ITEM.${state}`, resource: { payout_batch_id: 'PB-1', payout_item: { sender_item_id: `${key}-1`, receiver: 'sam@example.com', amount: { currency: 'USD', value: '50.00' } } } });
    await deliver(item('WH-7', 'UNCLAIMED', out.proposal.id));
    expect((await approvals.get(out.proposal.id))?.status).toBe('done');
    const [a] = await alerts();
    expect(a.detail).not.toMatch(/did not go through/);
    expect(a.detail).toMatch(/has not reached them yet/);

    // A proposal the old code failed on an unclaimed report comes back to done when PayPal says it went through.
    const old = await runOrHold(deps, 'payout', 'Pay USD 40.00 to jo@example.com: y', { value: 40, currency: 'USD' }, { recipientEmail: 'jo@example.com' });
    await approvals.failPayout(old.proposal.id, 'unclaimed: no account yet');
    await deliver(item('WH-8', 'SUCCEEDED', old.proposal.id));
    expect((await approvals.get(old.proposal.id))?.status).toBe('done');

    // A final failure stays failed whatever comes later.
    await deliver(item('WH-9', 'RETURNED', out.proposal.id));
    await deliver(item('WH-10', 'SUCCEEDED', out.proposal.id));
    expect((await approvals.get(out.proposal.id))?.status).toBe('failed');
  });

  it('a paid webhook releases for a yes when the invoice was marked paid outside PayPal, and not at all when partly paid', async () => {
    const { env, deliver, calls, invoices } = webhookRig();
    const approvals = new Approvals(env.DB, 't_1');
    const p = await approvals.create('payout', 'Pay later', { value: 50, currency: 'USD' }, { recipientEmail: 'sam@example.com' }, 'INV2-1');
    invoices['INV2-1'] = { status: 'partially_paid', due: { value: 600, currency: 'USD' }, paidViaRail: false };
    await deliver(paid);
    expect((await approvals.get(p.id))?.status).toBe('waiting');
    invoices['INV2-1'] = { status: 'paid', paidViaRail: false };
    await deliver({ ...paid, id: 'WH-1b' });
    expect((await approvals.get(p.id))?.status).toBe('pending');
    expect(calls.payout).toBe(0);
  });

  it('a retry after a crash between release and running still runs what was released, once', async () => {
    const { env, deliver, calls } = webhookRig();
    const approvals = new Approvals(env.DB, 't_1');
    const p = await approvals.create('payout', 'Pay later', { value: 50, currency: 'USD' }, { recipientEmail: 'sam@example.com' }, 'INV2-1');
    // The first delivery stored the event and released the payout, then died.
    await env.DB.prepare("INSERT INTO events (id, tenant_id, provider, type, summary, payload, received_at) VALUES ('t_1:WH-1', 't_1', 'paypal', 'invoice.paid', 's', '{}', 0)").run();
    await approvals.release('INV2-1');
    await deliver(paid);
    expect((await approvals.get(p.id))?.status).toBe('done');
    expect(calls.payout).toBe(1);
  });

  it('a refunded invoice calls off what waited on it', async () => {
    const { env, deliver } = webhookRig();
    const approvals = new Approvals(env.DB, 't_1');
    const p = await approvals.create('payout', 'Pay later', { value: 50, currency: 'USD' }, { recipientEmail: 'sam@example.com' }, 'INV2-3');
    await deliver({ id: 'WH-11', event_type: 'INVOICING.INVOICE.REFUNDED', resource: { invoice: { id: 'INV2-3', amount: { currency_code: 'USD', value: '50.00' } } } });
    const off = await approvals.get(p.id);
    expect(off?.status).toBe('rejected');
    expect(off?.result).toMatch(/refunded/);
  });
});
