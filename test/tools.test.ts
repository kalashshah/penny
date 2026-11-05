import { describe, expect, it } from 'vitest';
import type { Invoice } from '../src/providers/types';
import { invoiceKey, refundable } from '../src/tools';

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
