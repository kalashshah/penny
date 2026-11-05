import { describe, expect, it } from 'vitest';
import { deadlineAlerts } from '../src/cron';
import type { Dispute, Invoice } from '../src/providers/types';

const now = Date.UTC(2026, 10, 20, 12);
const inv = (id: string, dueDate: string, status: Invoice['status'] = 'sent'): Invoice => ({
  id,
  number: id,
  status,
  customer: { name: 'Acme', email: 'ap@acme.test' },
  total: { value: 100, currency: 'USD' },
  due: { value: 100, currency: 'USD' },
  dueDate,
  items: [],
  paymentIds: [],
});
const dispute = (id: string, respondBy: string, status = 'WAITING_FOR_SELLER_RESPONSE'): Dispute => ({ id, reason: 'X', status, state: 'OPEN', amount: { value: 40, currency: 'USD' }, respondBy, messages: [] });

describe('deadlineAlerts', () => {
  it('flags invoices a week or more overdue, once a week', () => {
    const a = deadlineAlerts([inv('A', '2026-11-13'), inv('B', '2026-11-15'), inv('C', '2026-11-01', 'paid')], [], now);
    expect(a.map((x) => x.key)).toEqual(['overdue:A']);
    expect(a[0].title).toBe('Invoice A (Acme) is 7 days overdue');
    expect(a[0].since).toBe(now - 7 * 86_400_000);
  });
  it('flags disputes due within 48 hours, keyed by deadline', () => {
    const a = deadlineAlerts([], [dispute('D1', '2026-11-21T12:00:00Z'), dispute('D2', '2026-11-25T12:00:00Z'), dispute('D3', '2026-11-19T12:00:00Z'), dispute('D4', '2026-11-21T00:00:00Z', 'RESOLVED')], now);
    expect(a.map((x) => x.key)).toEqual(['respond-by:D1:2026-11-21T12:00:00Z']);
    expect(a[0].title).toMatch(/within 24 hours/);
  });
});
