import type { Dispute, Invoice, Transaction } from './providers/types';

/** Flat, related tables for the AG Studio reports page (client/reports.tsx). Pure, provider-neutral, tested. */
export interface ReportData {
  asOf: string;
  business: string;
  currency: string;
  customers: { id: string; name: string; email: string }[];
  invoices: {
    id: string;
    number: string;
    customerId: string;
    status: string;
    isOpen: boolean;
    invoiceDate: string | null;
    dueDate: string | null;
    paidDate: string | null;
    total: number;
    paid: number;
    outstanding: number;
    overdue: number;
    daysOverdue: number;
    aging: string;
    memo: string;
  }[];
  disputes: { id: string; reason: string; status: string; amount: number; openedOn: string | null; respondBy: string | null; buyer: string }[];
  transactions: { id: string; date: string; kind: string; status: string; direction: string; counterparty: string; note: string; amount: number; fee: number; net: number }[];
}

const STATUS: Record<string, string> = {
  draft: 'Draft',
  sent: 'Open',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  other: 'Other',
};

// PayPal T-codes by family; T0001 is a payout. https://developer.paypal.com/docs/transaction-search/transaction-event-codes/
const KIND: Record<string, string> = { T00: 'Payment', T01: 'Fee', T03: 'Bank deposit', T04: 'Bank withdrawal', T11: 'Refund', T12: 'Dispute or reversal', T22: 'Transfer' };
export const kindLabel = (code: string) => (code === 'T0001' ? 'Payout' : (KIND[code.slice(0, 3)] ?? (code || 'Other')));

const day = (s: string | undefined) => (s ? s.slice(0, 10) : null);
const round = (n: number) => Math.round(n * 100) / 100;

export function aging(daysOverdue: number, isOpen: boolean): string {
  if (!isOpen) return 'Settled';
  if (daysOverdue <= 0) return 'Not due';
  if (daysOverdue <= 30) return '1–30 days late';
  if (daysOverdue <= 60) return '31–60 days late';
  return '60+ days late';
}

export function reportData(
  input: { invoices: Invoice[]; disputes: Dispute[]; transactions: Transaction[]; business: string; currency: string },
  now = new Date(),
): ReportData {
  const today = now.toISOString().slice(0, 10);
  const customers = new Map<string, { id: string; name: string; email: string }>();
  const invoices = input.invoices.map((i) => {
    const id = (i.customer.email || i.customer.name || 'unknown').toLowerCase();
    if (!customers.has(id)) customers.set(id, { id, name: i.customer.name || i.customer.email, email: i.customer.email });
    const isOpen = i.status === 'sent' || i.status === 'partially_paid';
    const dueDate = day(i.dueDate);
    const daysOverdue = isOpen && dueDate ? Math.max(0, Math.round((Date.parse(today) - Date.parse(dueDate)) / 86_400_000)) : 0;
    const outstanding = isOpen ? i.due.value : 0;
    const paid = i.status === 'paid' ? i.total.value : i.status === 'partially_paid' ? i.total.value - i.due.value : 0;
    return {
      id: i.id,
      number: i.number,
      customerId: id,
      status: STATUS[i.status] ?? i.status,
      isOpen,
      invoiceDate: day(i.issuedAt),
      dueDate,
      paidDate: day(i.paidAt),
      total: i.total.value,
      paid: round(paid),
      outstanding: round(outstanding),
      overdue: daysOverdue > 0 ? round(outstanding) : 0,
      daysOverdue,
      aging: aging(daysOverdue, isOpen),
      memo: (i.memo ?? '').replace(/\s*\[seed\]$/, ''),
    };
  });
  return {
    asOf: now.toISOString(),
    business: input.business,
    currency: input.currency,
    customers: [...customers.values()],
    invoices,
    disputes: input.disputes.map((d) => ({
      id: d.id,
      reason: d.reason.replace(/_/g, ' ').toLowerCase(),
      status: d.status.replace(/_/g, ' ').toLowerCase(),
      amount: d.amount.value,
      openedOn: day(d.createdAt),
      respondBy: day(d.respondBy),
      buyer: d.buyerEmail ?? '',
    })),
    transactions: input.transactions.map((t) => ({
      id: t.id,
      date: t.date,
      kind: kindLabel(t.kind),
      status: t.status,
      direction: t.amount.value < 0 ? 'Out' : 'In',
      counterparty: t.counterparty ?? '',
      note: t.note ?? '',
      amount: t.amount.value,
      fee: t.fee?.value ?? 0,
      net: round(t.amount.value + (t.fee?.value ?? 0)),
    })),
  };
}

/** Report pages Penny can put on screen during a call; ids match the pages in client/reports.tsx. */
export const REPORT_PAGES = {
  overview: 'Billed vs collected by month, invoice status, who owes what',
  receivables: 'Who owes us: open invoices by customer and how late they are',
  cash: 'Money in and out: PayPal transactions, payouts, fees and disputes',
} as const;
export type ReportPage = keyof typeof REPORT_PAGES;
