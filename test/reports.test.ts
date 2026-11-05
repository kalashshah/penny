import { describe, expect, it } from 'vitest';
import type { Invoice } from '../src/providers/types';
import { kindLabel, reportData } from '../src/reports';

const inv = (over: Partial<Invoice>): Invoice => ({
  id: 'INV2-1',
  number: '0001',
  status: 'sent',
  customer: { name: 'Acme Corp', email: 'AP@acme.test' },
  total: { value: 1000, currency: 'USD' },
  due: { value: 1000, currency: 'USD' },
  items: [],
  paymentIds: [],
  ...over,
});

const now = new Date('2026-10-14T12:00:00Z');

describe('reportData', () => {
  it('derives paid, outstanding, overdue and aging per invoice, and one customer per email', () => {
    const d = reportData(
      {
        invoices: [
          inv({ id: 'a', dueDate: '2026-10-01', memo: 'September sprint [seed]' }),
          inv({ id: 'b', status: 'partially_paid', due: { value: 600, currency: 'USD' }, dueDate: '2026-10-20' }),
          inv({ id: 'c', status: 'paid', due: { value: 0, currency: 'USD' }, paidAt: '2026-10-03', dueDate: '2026-09-01' }),
          inv({ id: 'd', customer: { name: 'Pixel', email: 'hi@pixel.test' }, dueDate: '2026-07-01' }),
        ],
        disputes: [],
        transactions: [{ id: 't', date: '2026-10-02T10:00:00Z', amount: { value: 100, currency: 'USD' }, fee: { value: -3.2, currency: 'USD' }, status: 'completed', kind: 'T0006' }],
        business: 'Studio',
        currency: 'USD',
      },
      now,
    );
    const [a, b, c, e] = d.invoices;
    expect(a).toMatchObject({ customerId: 'ap@acme.test', status: 'Open', outstanding: 1000, overdue: 1000, daysOverdue: 13, aging: '1–30 days late', memo: 'September sprint' });
    expect(b).toMatchObject({ status: 'Partially paid', paid: 400, outstanding: 600, overdue: 0, aging: 'Not due' });
    expect(c).toMatchObject({ status: 'Paid', paid: 1000, outstanding: 0, daysOverdue: 0, aging: 'Settled', paidDate: '2026-10-03' });
    expect(e.aging).toBe('60+ days late');
    expect(d.customers.map((x) => x.id)).toEqual(['ap@acme.test', 'hi@pixel.test']);
    expect(d.transactions[0]).toMatchObject({ kind: 'Payment', direction: 'In', net: 96.8 });
  });

  it('names payouts and refunds', () => {
    expect(kindLabel('T0001')).toBe('Payout');
    expect(kindLabel('T1107')).toBe('Refund');
  });
});
