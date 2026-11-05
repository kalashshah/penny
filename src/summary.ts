import type { Dispute, Invoice, PaymentProvider } from './providers/types';

export interface MoneySummary {
  currency: string;
  collectedThisMonth: number;
  collectedCount: number;
  outstanding: number;
  outstandingCount: number;
  overdue: number;
  overdueCount: number;
  overdueInvoices: Invoice[];
  openDisputes: Dispute[];
  disputedAmount: number;
}

const RESOLVED = new Set(['RESOLVED', 'resolved']);

/** Cash picture from the invoice and dispute lists; provider-neutral, pure, tested. */
export function summarize(invoices: Invoice[], disputes: Dispute[], now = new Date(), currency = 'USD'): MoneySummary {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const today = now.toISOString().slice(0, 10);
  // ponytail: sums ignore currency; add per-currency buckets when a second currency shows up.
  const paid = invoices.filter((i) => i.status === 'paid' && i.paidAt && new Date(i.paidAt) >= monthStart);
  const open = invoices.filter((i) => i.status === 'sent' || i.status === 'partially_paid');
  const overdue = open.filter((i) => i.dueDate && i.dueDate.slice(0, 10) < today);
  const openDisputes = disputes.filter((d) => !RESOLVED.has(d.state) && !RESOLVED.has(d.status));
  const sum = (xs: Invoice[], pick: (i: Invoice) => number) => Math.round(xs.reduce((a, i) => a + pick(i), 0) * 100) / 100;
  return {
    currency: invoices[0]?.total.currency ?? currency,
    collectedThisMonth: sum(paid, (i) => i.total.value),
    collectedCount: paid.length,
    outstanding: sum(open, (i) => i.due.value),
    outstandingCount: open.length,
    overdue: sum(overdue, (i) => i.due.value),
    overdueCount: overdue.length,
    overdueInvoices: overdue,
    openDisputes,
    disputedAmount: Math.round(openDisputes.reduce((a, d) => a + d.amount.value, 0) * 100) / 100,
  };
}

/** The summary as Penny would say it; also the snapshot pasted into a call's instructions. */
export function describeSummary(s: MoneySummary): string {
  const c = s.currency;
  const lines = [
    `Collected this month: ${c} ${s.collectedThisMonth.toFixed(2)} across ${s.collectedCount} paid invoice${s.collectedCount === 1 ? '' : 's'}.`,
    `Outstanding: ${c} ${s.outstanding.toFixed(2)} on ${s.outstandingCount} open invoice${s.outstandingCount === 1 ? '' : 's'}.`,
    s.overdueCount
      ? `Overdue: ${c} ${s.overdue.toFixed(2)} on ${s.overdueCount}: ${s.overdueInvoices.map((i) => `${i.customer.name || i.customer.email} (${i.number}, due ${i.dueDate})`).join('; ')}.`
      : 'Nothing overdue.',
    s.openDisputes.length
      ? `Open disputes: ${s.openDisputes.length} worth ${c} ${s.disputedAmount.toFixed(2)}.`
      : 'No open disputes.',
  ];
  return lines.join('\n');
}

/** Fetches what `summarize` needs from the rail: open and paid invoices, and disputes. */
export async function fetchSummary(provider: PaymentProvider, currency: string, limit?: number): Promise<MoneySummary> {
  const [open, paid, disputes] = await Promise.all([
    provider.listInvoices({ status: 'open', limit }),
    provider.listInvoices({ status: 'paid', limit }),
    provider.listDisputes(),
  ]);
  return summarize([...open, ...paid], disputes, new Date(), currency);
}
