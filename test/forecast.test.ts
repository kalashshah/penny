import { describe, expect, it } from 'vitest';
import type { Proposal } from '../src/approvals';
import { describeForecast, flowItems, forecast, lateness, parseWhatIf, project } from '../src/forecast';
import type { Invoice } from '../src/providers/types';

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

const today = '2026-10-16';

describe('forecast', () => {
  it('learns how late each customer pays', () => {
    const paid = [
      inv({ status: 'paid', dueDate: '2026-08-01', paidAt: '2026-08-11' }),
      inv({ status: 'paid', dueDate: '2026-09-01', paidAt: '2026-09-15' }),
      inv({ status: 'paid', customer: { name: 'Northwind', email: 'nw@test' }, dueDate: '2026-09-10', paidAt: '2026-09-08' }),
    ];
    expect(lateness(paid)).toEqual(new Map([['ap@acme.test', 12], ['nw@test', 0]]));
  });

  it('dates invoices by habit, overdue ones a week out, and pay-when-paid with its invoice', () => {
    const paid = [inv({ status: 'paid', dueDate: '2026-09-01', paidAt: '2026-09-11' })];
    const open = [
      inv({ id: 'a', dueDate: '2026-10-20' }), // Acme, usually 10 days late
      inv({ id: 'b', customer: { name: 'Northwind', email: 'nw@test' }, dueDate: '2026-10-01', due: { value: 500, currency: 'USD' } }),
    ];
    const proposals = [
      { id: 'p1', kind: 'payout', status: 'waiting', afterInvoice: 'a', amount: 400, currency: 'USD', input: { recipientEmail: 'sam@studio.co' }, description: 'Pay Sam' },
      { id: 'p2', kind: 'payout', status: 'done', amount: 99, currency: 'USD', input: {}, description: 'old' },
    ] as Proposal[];
    const items = flowItems({ today, horizon: 30, open, paid, proposals, transactions: [], disputes: [] });
    expect(items.map((x) => [x.id, x.date, x.amount])).toEqual([
      ['inv:b', '2026-10-23', 500],
      ['inv:a', '2026-10-30', 1000],
      ['ap:p1', '2026-10-30', -400],
    ]);
  });

  it('what-if pushes a customer later, out of the window', () => {
    const items = flowItems({ today, horizon: 30, open: [inv({ dueDate: '2026-11-01' })], paid: [], proposals: [], transactions: [], disputes: [], whatIf: parseWhatIf('acme:20') });
    expect(items).toEqual([]);
  });

  it('runs the balance and finds the low point', () => {
    const p = project(
      100,
      [
        { id: '1', kind: 'bill', label: '', who: '', date: '2026-10-17', amount: -300 },
        { id: '2', kind: 'invoice', label: '', who: '', date: '2026-10-19', amount: 1000 },
      ],
      today,
      5,
    );
    expect(p.low).toEqual({ date: '2026-10-17', balance: -200 });
    expect(p.end).toBe(800);
    expect(p.days).toHaveLength(6);
  });

  it('says it', () => {
    const f = forecast({ today, horizon: 30, currency: 'USD', balance: 2000, open: [inv({ dueDate: '2026-10-20' })], paid: [], proposals: [], transactions: [], disputes: [] });
    expect(describeForecast(f)).toContain('Lowest point: USD 2,000');
    expect(f.end).toBe(3000);
  });
});
