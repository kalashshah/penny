import { describe, expect, it } from 'vitest';
import type { Dispute, Invoice } from '../src/providers/types';
import { describeSummary, summarize } from '../src/summary';

const inv = (over: Partial<Invoice>): Invoice => ({
  id: 'INV2-1',
  number: '0001',
  status: 'sent',
  customer: { name: 'Acme', email: 'ap@acme.test' },
  total: { value: 1000, currency: 'USD' },
  due: { value: 1000, currency: 'USD' },
  items: [],
  paymentIds: [],
  ...over,
});

const now = new Date('2026-10-13T12:00:00Z');

describe('summarize', () => {
  it('splits collected, outstanding and overdue, and counts open disputes', () => {
    const invoices = [
      inv({ id: 'a', status: 'paid', paidAt: '2026-10-02', due: { value: 0, currency: 'USD' } }),
      inv({ id: 'b', status: 'paid', paidAt: '2026-09-28', due: { value: 0, currency: 'USD' } }), // last month
      inv({ id: 'c', status: 'sent', dueDate: '2026-10-20' }),
      inv({ id: 'd', status: 'sent', dueDate: '2026-10-01', total: { value: 250, currency: 'USD' }, due: { value: 250, currency: 'USD' } }),
      inv({ id: 'e', status: 'partially_paid', dueDate: '2026-10-12', due: { value: 400, currency: 'USD' } }),
      inv({ id: 'f', status: 'cancelled', dueDate: '2026-09-01' }),
    ];
    const disputes: Dispute[] = [
      { id: 'PP-1', reason: 'UNAUTHORISED', status: 'OPEN', state: 'REQUIRED_ACTION', amount: { value: 90, currency: 'USD' }, messages: [], evidence: [] },
      { id: 'PP-2', reason: 'OTHER', status: 'RESOLVED', state: 'RESOLVED', amount: { value: 10, currency: 'USD' }, messages: [], evidence: [] },
    ];
    const s = summarize(invoices, disputes, now);
    expect(s.collectedThisMonth).toBe(1000);
    expect(s.collectedCount).toBe(1);
    expect(s.outstanding).toBe(1650);
    expect(s.outstandingCount).toBe(3);
    expect(s.overdue).toBe(650);
    expect(s.overdueInvoices.map((i) => i.id)).toEqual(['d', 'e']);
    expect(s.openDisputes.map((d) => d.id)).toEqual(['PP-1']);
    expect(s.disputedAmount).toBe(90);
    expect(describeSummary(s)).toContain('Overdue: USD 650.00 on 2');
  });
  it('is calm when there is nothing', () => {
    const text = describeSummary(summarize([], [], now, 'EUR'));
    expect(text).toContain('Nothing overdue');
    expect(text).toContain('No open disputes');
    expect(text).toContain('EUR 0.00');
  });
});
