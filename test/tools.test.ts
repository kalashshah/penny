import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';
import { Approvals } from '../src/approvals';
import type { Env } from '../src/env';
import type { Memory } from '../src/memory';
import type { Invoice, Money, PaymentProvider } from '../src/providers/types';
import type { Tenant } from '../src/tenants';
import { describePayout, describeUnsent, invoiceKey, payoutBatchId, recordable, refundable, registerTools } from '../src/tools';
import { fakeD1 } from './helpers/d1';

const inv: Invoice = {
  id: 'INV2-1',
  number: '0042',
  status: 'paid',
  customer: { name: 'Acme', email: 'ap@acme.test' },
  total: { value: 1000, currency: 'USD' },
  due: { value: 0, currency: 'USD' },
  items: [],
  paymentIds: ['CAP1'],
};

describe('refundable', () => {
  it('defaults to what was paid', () => {
    expect(refundable(inv)).toEqual({ ok: true, money: { value: 1000, currency: 'USD' } });
    expect(refundable({ ...inv, status: 'partially_paid', due: { value: 600, currency: 'USD' } })).toEqual({ ok: true, money: { value: 400, currency: 'USD' } });
    expect(refundable({ ...inv, status: 'partially_paid', paid: { value: 250, currency: 'USD' } })).toEqual({ ok: true, money: { value: 250, currency: 'USD' } });
  });
  it('caps at what was paid', () => {
    const r = refundable({ ...inv, status: 'partially_paid', due: { value: 600, currency: 'USD' } }, 500);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Only USD 400.00 was paid/);
    expect(refundable(inv, 99.999)).toEqual({ ok: true, money: { value: 100, currency: 'USD' } });
  });
  it('refuses unpaid invoices and ones paid outside PayPal', () => {
    expect(refundable({ ...inv, status: 'sent' }).ok).toBe(false);
    expect(refundable({ ...inv, paymentIds: [] }).ok).toBe(false);
  });
});

describe('invoiceKey', () => {
  const args = { customer_email: 'ap@acme.test', items: [{ name: 'Design', unit_amount: 1000 }] };
  it('is stable for the same tenant and arguments, whatever the clock', async () => {
    const k = await invoiceKey('t_1', args);
    expect(await invoiceKey('t_1', args)).toBe(k);
    expect(await invoiceKey('t_2', args)).not.toBe(k);
    expect(await invoiceKey('t_1', { ...args, memo: 'x' })).not.toBe(k);
    expect(k.length).toBeLessThanOrEqual(90);
  });
});

describe('payout status', () => {
  it('finds the batch id execute() recorded', () => {
    expect(payoutBatchId({ kind: 'payout', result: 'Paid USD 400.00 to sam@x.test. Payout 5UXD2E8A7EBQJ is pending.' })).toBe('5UXD2E8A7EBQJ');
    expect(payoutBatchId({ kind: 'payout', result: 'Paid USD 400.00 to sam@x.test. Payout 5UXD2E8A7EBQJ is success. PayPal then reported it unclaimed.' })).toBe('5UXD2E8A7EBQJ');
    expect(payoutBatchId({ kind: 'payout', result: 'PayPal POST /v1/payments/payouts failed (422)' })).toBeNull();
    expect(payoutBatchId({ kind: 'refund', result: 'Payout X is y.' })).toBeNull();
  });
  it('says where an unsent payout stands', () => {
    expect(describeUnsent({ status: 'waiting' })).toMatch(/waiting for its invoice/);
    expect(describeUnsent({ status: 'expired' })).toBe('It was never paid: it was expired.');
  });
  it('says the batch in one sentence', () => {
    expect(describePayout({ id: 'B1', status: 'success', items: [{ id: 'I1', status: 'success', amount: { value: 400, currency: 'USD' }, recipient: 'sam@x.test' }] })).toBe('USD 400.00 to sam@x.test went through.');
    expect(describePayout({ id: 'B1', status: 'success', items: [{ id: 'I1', status: 'failed', amount: { value: 400, currency: 'USD' }, recipient: 'sam@x.test', error: 'Receiver is unregistered' }] })).toBe('USD 400.00 to sam@x.test failed (Receiver is unregistered).');
    expect(describePayout({ id: 'B1', status: 'denied', items: [] })).toMatch(/denied/);
  });
});

describe('recordable', () => {
  const open: Invoice = { ...inv, status: 'sent', due: { value: 1000, currency: 'USD' }, paymentIds: [] };
  it('defaults to what is due and caps at it', () => {
    expect(recordable(open)).toEqual({ ok: true, money: { value: 1000, currency: 'USD' } });
    expect(recordable({ ...open, status: 'partially_paid', due: { value: 400, currency: 'USD' } }, 150)).toEqual({ ok: true, money: { value: 150, currency: 'USD' } });
    const r = recordable(open, 1200);
    expect(!r.ok && r.error).toMatch(/Only USD 1000.00 is due/);
  });
  it('refuses invoices not waiting for money', () => {
    expect(recordable(inv).ok).toBe(false);
    expect(recordable({ ...open, status: 'cancelled' }).ok).toBe(false);
  });
});

/** The registered tools by name, run against a fake rail and a real (in-memory) approvals table. */
function toolRig(invoice: Invoice) {
  const handlers = new Map<string, (a: Record<string, unknown>) => Promise<{ content: { text: string }[] }>>();
  const server = { registerTool: (name: string, _c: unknown, h: never) => handlers.set(name, h) } as unknown as McpServer;
  const env = { DB: fakeD1(), PUBLIC_URL: 'https://penny.test' } as Env;
  const tenant = { id: 't_1', pageKey: 'pk', approvalThreshold: 100, currency: 'USD' } as Tenant;
  const calls: string[] = [];
  let current = invoice;
  const provider = {
    name: 'paypal',
    getInvoice: async () => current,
    createAndSendInvoice: async (i: { idempotencyKey: string }) => {
      calls.push(`create ${i.idempotencyKey}`);
      return current;
    },
    cancelInvoice: async () => {
      calls.push('cancel');
      current = { ...current, status: 'cancelled' };
    },
    recordInvoicePayment: async (_id: string, p: { amount: Money }) => {
      calls.push(`record ${p.amount.value}`);
      const due = Math.round((current.due.value - p.amount.value) * 100) / 100;
      current = { ...current, status: due ? 'partially_paid' : 'paid', due: { ...current.due, value: due } };
      return 'EXTR-1';
    },
    getPayout: async (id: string) => {
      calls.push(`getPayout ${id}`);
      return { id, status: 'success', items: [{ id: 'I1', status: 'unclaimed', amount: { value: 50, currency: 'USD' }, recipient: 'sam@x.test' }] };
    },
    payout: async ({ amount, recipientEmail }: { amount: Money; recipientEmail: string }) => {
      calls.push('payout');
      return { id: 'PB-1', status: 'pending', amount, recipient: recipientEmail };
    },
  } as unknown as PaymentProvider;
  const approvals = new Approvals(env.DB, tenant.id);
  registerTools(server, { env, tenant, provider, approvals, memory: {} as Memory });
  const run = async (name: string, args: Record<string, unknown>) => JSON.parse((await handlers.get(name)!(args)).content[0].text) as Record<string, unknown>;
  return { run, approvals, calls };
}

describe('cancel_invoice and record_invoice_payment', () => {
  const open: Invoice = { ...inv, status: 'sent', due: { value: 1000, currency: 'USD' }, paymentIds: [] };
  it('cancelling calls off payouts waiting on the invoice', async () => {
    const { run, approvals, calls } = toolRig(open);
    const p = await approvals.create('payout', 'Pay Sam when Acme pays', { value: 50, currency: 'USD' }, { recipientEmail: 'sam@x.test' }, open.id);
    const r = await run('cancel_invoice', { invoice_id: open.id });
    expect(calls).toEqual(['cancel']);
    expect(r.spoken).toMatch(/^Cancelled invoice 0042 for Acme and let them know\. Called off: paying sam@x.test USD 50.00\.$/);
    expect((await approvals.get(p.id))?.status).toBe('rejected');
  });
  it('refuses to cancel a paid invoice', async () => {
    const { run, calls } = toolRig(inv);
    expect((await run('cancel_invoice', { invoice_id: inv.id })).error).toMatch(/is paid/);
    expect(calls).toEqual([]);
  });
  it('a cheque that pays it off releases what waited on it, for a yes', async () => {
    const { run, approvals, calls } = toolRig(open);
    const p = await approvals.create('payout', 'Pay Sam when Acme pays', { value: 50, currency: 'USD' }, { recipientEmail: 'sam@x.test' }, open.id);
    const part = await run('record_invoice_payment', { invoice_id: open.id, method: 'CHECK', amount: 400 });
    expect(part.spoken).toBe('Recorded USD 400.00 by cheque on invoice 0042; USD 600.00 is still due.');
    expect((await approvals.get(p.id))?.status).toBe('waiting');
    const rest = await run('record_invoice_payment', { invoice_id: open.id, method: 'CASH' });
    expect(rest.spoken).toMatch(/^Recorded USD 600.00 by cash on invoice 0042; it is now paid in full\. You asked to pay sam@x.test USD 50.00 once this came in\. It needs your yes\./);
    // The cash is not in PayPal, so even a small payout waits for a yes instead of leaving the balance.
    expect(calls).toEqual(['record 400', 'record 600']);
    expect((await approvals.get(p.id))?.status).toBe('pending');
  });
});

describe('retried invoicing calls', () => {
  const open: Invoice = { ...inv, status: 'sent', due: { value: 1000, currency: 'USD' }, paymentIds: [] };
  it('a retried record_invoice_payment returns the first answer instead of recording again, even across a minute boundary', async () => {
    const { run, calls } = toolRig(open);
    const now = Date.now();
    const first = await run('record_invoice_payment', { invoice_id: open.id, method: 'CHECK', amount: 400 });
    vi.useFakeTimers({ now: now + 5 * 60_000, toFake: ['Date'] });
    try {
      const again = await run('record_invoice_payment', { invoice_id: open.id, method: 'CHECK', amount: 400 });
      expect(again).toEqual(first);
      expect(calls).toEqual(['record 400']);
      // After the window it is a new request.
      vi.setSystemTime(now + 11 * 60_000);
      await run('record_invoice_payment', { invoice_id: open.id, method: 'CHECK', amount: 400 });
      expect(calls).toEqual(['record 400', 'record 400']);
    } finally {
      vi.useRealTimers();
    }
  });
  it('a retried create_invoice creates one invoice', async () => {
    const { run, calls } = toolRig(open);
    const args = { customer_email: 'ap@acme.test', items: [{ name: 'Design', unit_amount: 1000 }] };
    const a = await run('create_invoice', args);
    const b = await run('create_invoice', args);
    expect(b).toEqual(a);
    expect(calls.filter((c) => c.startsWith('create'))).toHaveLength(1);
  });
});

describe('payout_status tool', () => {
  it('finds the latest payout to a recipient and asks PayPal about its batch', async () => {
    const { run, approvals, calls } = toolRig(inv);
    const r = await run('pay', { recipient_email: 'sam@x.test', amount: 50, note: 'logo' });
    expect(r.status).toBe('done');
    const s = await run('payout_status', { recipient_email: 'SAM@x.test' });
    expect(calls).toEqual(['payout', 'getPayout PB-1']);
    expect(s.spoken).toMatch(/^USD 50.00 to sam@x.test is unclaimed/);
    const held = await approvals.create('payout', 'Pay Jo', { value: 500, currency: 'USD' }, { recipientEmail: 'jo@x.test' });
    expect((await run('payout_status', { proposal_id: held.id })).spoken).toBe('It has not been paid: it is still waiting for a yes.');
    expect((await run('payout_status', { recipient_email: 'nobody@x.test' })).error).toMatch(/no recent payout/);
  });
});
