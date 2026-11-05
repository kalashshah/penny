import { describe, expect, it } from 'vitest';
import type { Invoice } from '../src/providers/types';
import { describePayout, describeUnsent, invoiceKey, payoutBatchId, refundable } from '../src/tools';

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
  const t = Date.UTC(2026, 10, 5, 12, 0, 10);
  it('is stable for a retry within the minute and differs otherwise', async () => {
    const k = await invoiceKey('t_1', args, t);
    expect(await invoiceKey('t_1', args, t + 30_000)).toBe(k);
    expect(await invoiceKey('t_1', args, t + 60_000)).not.toBe(k);
    expect(await invoiceKey('t_2', args, t)).not.toBe(k);
    expect(await invoiceKey('t_1', { ...args, memo: 'x' }, t)).not.toBe(k);
    expect(k.length).toBeLessThanOrEqual(108);
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
