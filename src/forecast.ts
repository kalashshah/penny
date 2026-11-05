import type { Approvals, Proposal } from './approvals';
import type { Dispute, Invoice, PaymentProvider, Transaction } from './providers/types';

/**
 * Where cash is heading: every expected movement as a dated item, then a running
 * balance over them. Pure and provider-neutral; the forecast page runs `project`
 * again in the browser when an item is dragged to another day.
 */

export type FlowKind = 'invoice' | 'payout' | 'bill' | 'dispute';

export interface FlowItem {
  id: string;
  kind: FlowKind;
  label: string;
  who: string;
  /** YYYY-MM-DD the money is expected to move. */
  date: string;
  /** Signed: + in, - out. */
  amount: number;
  note?: string;
}

export interface ForecastDay {
  date: string;
  balance: number;
  in: number;
  out: number;
}

export interface Projection {
  days: ForecastDay[];
  low: { date: string; balance: number };
  end: number;
}

export interface Forecast extends Projection {
  currency: string;
  today: string;
  horizon: number;
  start: number;
  /** False when the rail could not tell us the balance: the line is then the change from today. */
  startKnown: boolean;
  items: FlowItem[];
}

const DAY = 86_400_000;
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const round = (n: number) => Math.round(n * 100) / 100;
const key = (s: string) => s.trim().toLowerCase();

/** How many days after the due date each customer usually pays, from their paid invoices. Keyed by email. */
export function lateness(paid: Invoice[]): Map<string, number> {
  const seen = new Map<string, number[]>();
  for (const i of paid) {
    if (!i.dueDate || !i.paidAt) continue;
    const late = Math.max(0, daysBetween(i.dueDate.slice(0, 10), i.paidAt.slice(0, 10)));
    seen.set(key(i.customer.email), [...(seen.get(key(i.customer.email)) ?? []), late]);
  }
  return new Map([...seen].map(([k, v]) => [k, Math.round(v.reduce((a, b) => a + b, 0) / v.length)]));
}

/** "What if Acme pays two weeks late": extra days per customer, matched on name or email. */
export type WhatIf = { customer: string; daysLate: number }[];

export function flowItems(input: {
  today: string;
  horizon: number;
  open: Invoice[];
  paid: Invoice[];
  proposals: Proposal[];
  transactions: Transaction[];
  disputes: Dispute[];
  whatIf?: WhatIf;
}): FlowItem[] {
  const { today, horizon, whatIf = [] } = input;
  const late = lateness(input.paid);
  const extra = (i: Invoice) => whatIf.find((w) => [key(i.customer.name), key(i.customer.email)].includes(key(w.customer)))?.daysLate ?? 0;
  const items: FlowItem[] = [];
  const expected = new Map<string, string>();

  for (const i of input.open) {
    const usual = late.get(key(i.customer.email)) ?? 0;
    let date = addDays(i.dueDate?.slice(0, 10) ?? addDays(today, 30), usual);
    // Already past when we'd expect it: assume another week.
    if (date < today) date = addDays(today, 7);
    date = addDays(date, extra(i));
    expected.set(i.id, date);
    const who = i.customer.name || i.customer.email;
    const notes = [usual ? `usually pays ${usual} days late` : '', extra(i) ? `what if: ${extra(i)} days later` : ''].filter(Boolean);
    items.push({ id: `inv:${i.id}`, kind: 'invoice', label: `Invoice ${i.number}`, who, date, amount: i.due.value, note: notes.join('; ') || undefined });
  }

  for (const p of input.proposals) {
    if (p.status !== 'pending' && p.status !== 'waiting') continue;
    const who = String(p.input.recipientEmail ?? p.input.invoiceNumber ?? p.input.disputeId ?? p.kind);
    // A waiting payout moves the day its invoice is expected to be paid.
    const date = p.status === 'waiting' && p.afterInvoice ? (expected.get(p.afterInvoice) ?? addDays(today, 30)) : today;
    items.push({ id: `ap:${p.id}`, kind: 'payout', label: p.status === 'waiting' ? 'Pay when paid' : 'Waiting for a yes', who, date, amount: -p.amount, note: p.description });
  }

  // ponytail: assumes last month's outgoing payments recur monthly; a real bills list replaces this when there is one.
  for (const t of input.transactions) {
    // Payments sent only (PayPal T00xx); refunds, reversals and fees do not repeat.
    if (t.amount.value >= 0 || (t.kind && !t.kind.startsWith('T00'))) continue;
    const date = addDays(t.date.slice(0, 10), 30);
    if (date < today) continue;
    items.push({ id: `tx:${t.id}`, kind: 'bill', label: 'Repeats monthly?', who: t.counterparty || t.note || 'Outgoing payment', date, amount: t.amount.value, note: `Paid ${t.date.slice(0, 10)}` });
  }

  for (const d of input.disputes) {
    if (['RESOLVED', 'resolved'].includes(d.state) || ['RESOLVED', 'resolved'].includes(d.status)) continue;
    const by = d.respondBy?.slice(0, 10);
    items.push({ id: `dp:${d.id}`, kind: 'dispute', label: 'Dispute, if lost', who: d.buyerEmail ?? d.id, date: by && by > today ? by : addDays(today, 10), amount: -d.amount.value, note: d.reason.toLowerCase().replace(/_/g, ' ') });
  }

  const last = addDays(today, horizon);
  return items.filter((x) => x.date <= last).sort((a, b) => a.date.localeCompare(b.date));
}

/** The running balance, one point a day from today. */
export function project(start: number, items: FlowItem[], today: string, horizon: number): Projection {
  const days: ForecastDay[] = [];
  let balance = start;
  let low = { date: today, balance: start };
  for (let n = 0; n <= horizon; n++) {
    const date = addDays(today, n);
    const moves = items.filter((x) => (n === 0 ? x.date <= date : x.date === date));
    const inflow = moves.filter((x) => x.amount > 0).reduce((a, x) => a + x.amount, 0);
    const outflow = moves.filter((x) => x.amount < 0).reduce((a, x) => a + x.amount, 0);
    balance = round(balance + inflow + outflow);
    days.push({ date, balance, in: round(inflow), out: round(outflow) });
    if (balance < low.balance) low = { date, balance };
  }
  return { days, low, end: balance };
}

/** The forecast as Penny would say it. */
export function describeForecast(f: Forecast): string {
  const c = f.currency;
  const say = (n: number) => `${c} ${Math.round(n).toLocaleString('en-US')}`;
  const ins = f.items.filter((x) => x.amount > 0);
  const outs = f.items.filter((x) => x.amount < 0);
  const lines = [
    f.startKnown ? `Balance today: ${say(f.start)}.` : 'PayPal did not share the balance, so these are changes from today.',
    `Next ${f.horizon} days: ${say(ins.reduce((a, x) => a + x.amount, 0))} expected in from ${ins.length} invoice${ins.length === 1 ? '' : 's'}, ${say(-outs.reduce((a, x) => a + x.amount, 0))} going out.`,
    `Lowest point: ${say(f.low.balance)} on ${f.low.date}${f.low.balance < 0 ? ' (below zero)' : ''}. In ${f.horizon} days: ${say(f.end)}.`,
  ];
  const late = ins.filter((x) => x.note?.includes('usually pays'));
  if (late.length) lines.push(`Adjusted for late payers: ${late.map((x) => `${x.who} (${x.note})`).join('; ')}.`);
  return lines.join('\n');
}

export function forecast(input: Parameters<typeof flowItems>[0] & { currency: string; balance: number | null }): Forecast {
  const items = flowItems(input);
  const start = input.balance ?? 0;
  return { currency: input.currency, today: input.today, horizon: input.horizon, start, startKnown: input.balance !== null, items, ...project(start, items, input.today, input.horizon) };
}

export type ForecastInputs = Omit<Parameters<typeof forecast>[0], 'horizon' | 'whatIf'>;

/** Fetches everything `forecast` needs from the rail and the approvals table (the weekly digest reuses the invoice lists). */
export async function fetchForecastInputs(provider: PaymentProvider, approvals: Approvals, currency: string): Promise<ForecastInputs> {
  const now = new Date();
  const [open, paid, disputes, transactions, pending, waiting, balance] = await Promise.all([
    provider.listInvoices({ status: 'open', limit: 50 }),
    provider.listInvoices({ status: 'paid', limit: 50 }),
    provider.listDisputes(),
    // Transaction Search can be off on a sandbox app; the forecast still works without bills.
    provider.listTransactions(new Date(now.getTime() - 30 * DAY), now).catch(() => []),
    approvals.listPending(),
    approvals.listWaiting(),
    provider.getBalance(currency).catch(() => null),
  ]);
  return { today: now.toISOString().slice(0, 10), currency, balance: balance?.value ?? null, open, paid, disputes, transactions, proposals: [...pending, ...waiting] };
}

/** Type-only imports keep this file browser-safe. */
export async function loadForecast(provider: PaymentProvider, approvals: Approvals, currency: string, horizon = 30, whatIf: WhatIf = []): Promise<Forecast> {
  return forecast({ ...(await fetchForecastInputs(provider, approvals, currency)), horizon, whatIf });
}

/** `?late=Acme:14,Northwind:7` ⇄ WhatIf. */
export function parseWhatIf(s: string | undefined): WhatIf {
  return (s ?? '')
    .split(',')
    .map((p) => p.split(':'))
    .filter(([c, d]) => c?.trim() && Number.isFinite(Number(d)))
    .map(([c, d]) => ({ customer: c!.trim(), daysLate: Math.max(-30, Math.min(90, Math.round(Number(d)))) }));
}

export const formatWhatIf = (w: WhatIf) => w.map((x) => `${x.customer}:${x.daysLate}`).join(',');
