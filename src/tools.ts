import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { confirm, runOrHold, type Approvals, type Proposal } from './approvals';
import { sha256Hex } from './crypto';
import type { Env } from './env';
import { callOffFor, releaseFor } from './events';
import { describeForecast, formatWhatIf, loadForecast } from './forecast';
import type { Memory } from './memory';
import type { Dispute, Invoice, Money, PaymentProvider, PayoutBatch } from './providers/types';
import { fmtMoney } from './providers/types';
import { REPORT_PAGES } from './reports';
import { describeSummary, summarize } from './summary';
import type { Tenant } from './tenants';

export interface ToolDeps {
  env: Env;
  tenant: Tenant;
  provider: PaymentProvider;
  approvals: Approvals;
  memory: Memory;
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

/** Every tool answers compact JSON; LlamaCalls truncates at 15k chars, so lists stay short. */
function reply(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

async function guard(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return reply(await fn());
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true };
  }
}

function pageUrl(env: Env, path: string): string {
  return `${env.PUBLIC_URL}${path}`;
}

function compactInvoice(i: Invoice, today: string) {
  return {
    id: i.id,
    number: i.number,
    customer: i.customer.name || i.customer.email,
    email: i.customer.email,
    status: i.status,
    total: fmtMoney(i.total),
    due: fmtMoney(i.due),
    dueDate: i.dueDate,
    overdue: (i.status === 'sent' || i.status === 'partially_paid') && !!i.dueDate && i.dueDate < today,
    paidAt: i.paidAt,
    payLink: i.payLink,
  };
}

function compactDispute(d: Dispute) {
  return {
    id: d.id,
    reason: d.reason.toLowerCase().replace(/_/g, ' '),
    status: d.status,
    state: d.state,
    stage: d.stage,
    amount: fmtMoney(d.amount),
    opened: d.createdAt,
    respondBy: d.respondBy,
    buyer: d.buyerEmail,
    lastMessages: d.messages.slice(-4).map((m) => `${m.by}: ${m.text}`),
    evidenceSent: d.evidence.length,
  };
}

/** Same tenant, same arguments, same minute: same key. */
export async function invoiceKey(tenantId: string, args: unknown, now = Date.now(), prefix = 'penny-inv'): Promise<string> {
  return `${prefix}-${(await sha256Hex(`${tenantId}|${JSON.stringify(args)}|${Math.floor(now / 60_000)}`)).slice(0, 40)}`;
}

/**
 * What can be recorded as paid outside PayPal on an invoice: only one still waiting for money, at most what is due.
 * Returns the amount (the whole balance by default) or a sentence the call agent can say.
 */
export function recordable(i: Invoice, requested?: number): { ok: true; money: Money } | { ok: false; error: string } {
  if (i.status !== 'sent' && i.status !== 'partially_paid') return { ok: false, error: `Invoice ${i.number} is ${i.status.replace('_', ' ')}, not waiting for payment, so there is nothing to record.` };
  const due = Math.round(i.due.value * 100) / 100;
  if (due <= 0) return { ok: false, error: `Invoice ${i.number} has nothing left to pay.` };
  const value = Math.round((requested ?? due) * 100) / 100;
  if (value > due) return { ok: false, error: `Only ${fmtMoney(i.due)} is due on invoice ${i.number}; record that or less.` };
  return { ok: true, money: { value, currency: i.due.currency } };
}

const METHOD_WORDS: Record<string, string> = { BANK_TRANSFER: 'bank transfer', CASH: 'cash', CHECK: 'cheque', WIRE_TRANSFER: 'wire', OTHER: 'another method' };

/**
 * What can be refunded on an invoice: only one paid (fully or partly) through PayPal, and at most what was paid.
 * Returns the amount to refund or a sentence the call agent can say.
 */
export function refundable(i: Invoice, requested?: number): { ok: true; money: Money } | { ok: false; error: string } {
  if (i.status !== 'paid' && i.status !== 'partially_paid') return { ok: false, error: `Invoice ${i.number} is ${i.status.replace('_', ' ')}, not paid, so there is nothing to refund.` };
  if (!i.paymentIds.length) return { ok: false, error: `Invoice ${i.number} was marked paid outside PayPal, so Penny cannot refund it; refund the customer the way they paid.` };
  // A fully paid invoice without paid_amount was paid in full; a partly paid one has paid total minus what is due.
  const paid = i.paid?.value ?? (i.status === 'paid' ? i.total.value : i.total.value - i.due.value);
  const cap = Math.round(paid * 100) / 100;
  if (cap <= 0) return { ok: false, error: `Invoice ${i.number} shows no money received, so there is nothing to refund.` };
  const value = Math.round((requested ?? cap) * 100) / 100;
  const currency = i.paid?.currency ?? i.total.currency;
  if (value > cap) return { ok: false, error: `Only ${fmtMoney({ value: cap, currency })} was paid on invoice ${i.number}; refund that or less.` };
  return { ok: true, money: { value, currency } };
}

/** execute() records "Payout <batch id> is <status>." in the proposal's result; that is the only place the batch id is kept. */
export function payoutBatchId(p: Pick<Proposal, 'kind' | 'result'>): string | null {
  if (p.kind !== 'payout') return null;
  return /\bPayout (\S+) is\b/.exec(p.result ?? '')?.[1] ?? null;
}

/** Where a payout proposal stands before (or without) reaching PayPal, in a sentence. */
export function describeUnsent(p: Pick<Proposal, 'status' | 'result'>): string {
  switch (p.status) {
    case 'waiting':
      return 'It has not been paid: it is waiting for its invoice to be paid first.';
    case 'pending':
      return 'It has not been paid: it is still waiting for a yes.';
    case 'approved':
      return 'It was approved and is being sent to PayPal right now.';
    case 'failed':
      return `It never reached PayPal: ${p.result ?? 'it failed'}.`;
    case 'done':
      return `It ran, but Penny has no PayPal batch id to check: ${p.result ?? ''}`;
    default:
      return `It was never paid: it was ${p.status}${p.result ? ` (${p.result})` : ''}.`;
  }
}

const ITEM_SAYS: Record<string, string> = {
  success: 'went through',
  pending: 'is still pending at PayPal',
  unclaimed: 'is unclaimed: the recipient has no PayPal account yet, and PayPal returns the money if it stays unclaimed for 30 days',
  onhold: 'is on hold while PayPal reviews it',
  failed: 'failed',
  returned: 'was returned',
  blocked: 'was blocked by PayPal',
  refunded: 'was refunded',
  reversed: 'was reversed',
  denied: 'was denied',
};

/** A payout batch as one sentence a voice agent can say. */
export function describePayout(b: PayoutBatch): string {
  if (!b.items.length) return b.status === 'denied' ? 'PayPal denied that payout, so nothing was sent.' : `That payout is ${b.status} at PayPal.`;
  const parts = b.items.map((i) => {
    const said = ITEM_SAYS[i.status] ?? `is ${i.status}`;
    return `${fmtMoney(i.amount) || 'the payment'} to ${i.recipient ?? 'the recipient'} ${said}${i.error && i.status !== 'success' ? ` (${i.error})` : ''}`;
  });
  const s = parts.join('; ');
  return `${s[0].toUpperCase()}${s.slice(1)}.`;
}

export function registerTools(server: McpServer, deps: ToolDeps): void {
  const { provider, approvals, memory, tenant } = deps;
  const threshold = tenant.approvalThreshold;
  const currency = tenant.currency || 'USD';
  // Pages Penny screen-shares carry the tenant's page key, which is how her browser gets in.
  const env = { ...deps.env, PUBLIC_URL: deps.env.PUBLIC_URL };
  const withKey = (path: string) => `${path}${path.includes('?') ? '&' : '?'}k=${encodeURIComponent(tenant.pageKey)}`;
  const today = () => new Date().toISOString().slice(0, 10);
  const money = { approvals, provider, threshold, currency };

  // ---- looking ---------------------------------------------------------------

  server.registerTool(
    'money_summary',
    { description: 'How the money looks right now: collected this month, outstanding, overdue invoices, open disputes. Show its page when asked how things are going.', inputSchema: {} },
    () =>
      guard(async () => {
        const [open, paid, disputes] = await Promise.all([
          provider.listInvoices({ status: 'open', limit: 50 }),
          provider.listInvoices({ status: 'paid', limit: 50 }),
          provider.listDisputes(),
        ]);
        const s = summarize([...open, ...paid], disputes, new Date(), currency);
        return { spoken: describeSummary(s), numbers: { currency: s.currency, collectedThisMonth: s.collectedThisMonth, outstanding: s.outstanding, overdue: s.overdue, overdueCount: s.overdueCount, openDisputes: s.openDisputes.length }, page: pageUrl(env, withKey('/p/summary')) };
      }),
  );

  server.registerTool(
    'show_report',
    {
      description: `Put a live chart dashboard of the books on screen. Use it when someone wants to see the picture rather than hear one number. Pages: ${Object.entries(REPORT_PAGES)
        .map(([id, what]) => `${id} (${what})`)
        .join('; ')}.`,
      inputSchema: { page: z.enum(Object.keys(REPORT_PAGES) as [keyof typeof REPORT_PAGES, ...(keyof typeof REPORT_PAGES)[]]) },
    },
    ({ page }) => guard(async () => ({ showing: REPORT_PAGES[page], page: pageUrl(env, withKey(`/p/reports?page=${page}`)) })),
  );

  server.registerTool(
    'cash_forecast',
    {
      description:
        'Where cash is heading over the next days: the balance today, customer payments dated by how late each customer usually pays, payouts waiting for a yes or for an invoice, last month\'s bills repeating, and open disputes if lost. Use it for "will we make payroll", "can we afford this", "what if Acme pays late". Shows a timeline.',
      inputSchema: {
        days: z.number().int().min(7).max(90).optional(),
        what_if: z.array(z.object({ customer: z.string().min(1), days_late: z.number().int().min(-30).max(90) })).optional(),
      },
    },
    ({ days, what_if }) =>
      guard(async () => {
        const horizon = days ?? 30;
        const whatIf = (what_if ?? []).map((w) => ({ customer: w.customer, daysLate: w.days_late }));
        const f = await loadForecast(provider, approvals, currency, horizon, whatIf);
        const q = new URLSearchParams({ days: String(horizon), ...(whatIf.length ? { late: formatWhatIf(whatIf) } : {}) });
        return {
          spoken: describeForecast(f),
          numbers: { currency, today: f.startKnown ? f.start : null, lowest: f.low, inDays: f.end },
          biggest: [...f.items].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 8).map((x) => ({ date: x.date, who: x.who, amount: x.amount, what: x.label, note: x.note })),
          page: pageUrl(env, withKey(`/p/forecast?${q}`)),
        };
      }),
  );

  server.registerTool(
    'list_invoices',
    { description: 'Invoices, newest first. status: open (unpaid, default), paid, or all.', inputSchema: { status: z.enum(['open', 'paid', 'all']).optional(), limit: z.number().int().min(1).max(50).optional() } },
    ({ status, limit }) =>
      guard(async () => {
        const list = await provider.listInvoices({ status: status ?? 'open', limit: limit ?? 20 });
        return { count: list.length, invoices: list.map((i) => compactInvoice(i, today())), page: pageUrl(env, withKey(`/p/invoices?status=${status ?? 'open'}`)) };
      }),
  );

  server.registerTool(
    'get_invoice',
    { description: 'One invoice in full, with its line items and payment link.', inputSchema: { invoice_id: z.string() } },
    ({ invoice_id }) =>
      guard(async () => {
        const i = await provider.getInvoice(invoice_id);
        return { ...compactInvoice(i, today()), items: i.items.map((x) => ({ name: x.name, quantity: x.quantity, unit: fmtMoney(x.unitAmount) })), memo: i.memo, page: pageUrl(env, withKey(`/p/invoice/${encodeURIComponent(i.id)}`)) };
      }),
  );

  server.registerTool(
    'list_disputes',
    { description: 'Open and recent disputes (chargebacks, claims) against the company.', inputSchema: {} },
    () =>
      guard(async () => {
        const list = await provider.listDisputes();
        return { count: list.length, disputes: list.map(compactDispute), page: pageUrl(env, withKey('/p/disputes')) };
      }),
  );

  server.registerTool(
    'get_dispute',
    { description: 'One dispute with its reason, deadline, amount and the message thread.', inputSchema: { dispute_id: z.string() } },
    ({ dispute_id }) =>
      guard(async () => {
        const d = await provider.getDispute(dispute_id);
        return { ...compactDispute(d), messages: d.messages.slice(-10), transactionId: d.transactionId, page: pageUrl(env, withKey(`/p/dispute/${encodeURIComponent(d.id)}`)) };
      }),
  );

  server.registerTool(
    'list_transactions',
    { description: 'Account transactions for the last N days (max 31): payments in and out, fees, refunds.', inputSchema: { days: z.number().int().min(1).max(31).optional() } },
    ({ days }) =>
      guard(async () => {
        const d = days ?? 30;
        const to = new Date();
        const from = new Date(to.getTime() - d * 86_400_000);
        const list = await provider.listTransactions(from, to);
        const inflow = list.filter((t) => t.amount.value > 0).reduce((a, t) => a + t.amount.value, 0);
        const outflow = list.filter((t) => t.amount.value < 0).reduce((a, t) => a + t.amount.value, 0);
        return {
          days: d,
          count: list.length,
          inflow: Math.round(inflow * 100) / 100,
          outflow: Math.round(outflow * 100) / 100,
          transactions: list.slice(0, 40).map((t) => ({ id: t.id, date: t.date.slice(0, 10), amount: fmtMoney(t.amount), fee: t.fee ? fmtMoney(t.fee) : undefined, status: t.status, who: t.counterparty, note: t.note })),
          page: pageUrl(env, withKey(`/p/transactions?days=${d}`)),
        };
      }),
  );

  // ---- money in --------------------------------------------------------------

  server.registerTool(
    'create_invoice',
    {
      description: 'Create and send an invoice to a customer. Confirm customer, amount and due date with the founders first. Returns the payment link.',
      inputSchema: {
        customer_email: z.string().email(),
        customer_name: z.string().optional(),
        items: z.array(z.object({ name: z.string(), quantity: z.number().positive().optional(), unit_amount: z.number().positive() })).min(1),
        currency: z.string().length(3).optional(),
        due_in_days: z.number().int().min(0).max(120).optional(),
        memo: z.string().max(500).optional(),
      },
    },
    (a) =>
      guard(async () => {
        // A voice agent retries a slow tool call; the same invoice asked for again within the minute is one invoice.
        const idempotencyKey = await invoiceKey(tenant.id, a);
        const i = await provider.createAndSendInvoice({
          idempotencyKey,
          customerEmail: a.customer_email,
          customerName: a.customer_name,
          items: a.items.map((x) => ({ name: x.name, quantity: x.quantity ?? 1, unitAmount: x.unit_amount })),
          currency: (a.currency ?? currency).toUpperCase(),
          dueInDays: a.due_in_days,
          memo: a.memo,
        });
        return { sent: true, ...compactInvoice(i, today()), page: pageUrl(env, withKey(`/p/invoice/${encodeURIComponent(i.id)}`)) };
      }),
  );

  server.registerTool(
    'send_reminder',
    { description: 'Send the customer a reminder for an unpaid invoice, with an optional personal note.', inputSchema: { invoice_id: z.string(), note: z.string().max(500).optional() } },
    ({ invoice_id, note }) =>
      guard(async () => {
        await provider.sendReminder(invoice_id, note);
        return { sent: true, invoice_id };
      }),
  );

  server.registerTool(
    'cancel_invoice',
    {
      description:
        'Cancel a sent invoice that should not be paid (wrong amount, deal off). The customer is emailed unless notify_customer is false. Payouts waiting on it (pay_when_paid) are called off. Confirm which invoice first; to fix an amount, cancel and create a new one.',
      inputSchema: { invoice_id: z.string(), note: z.string().max(500).optional(), notify_customer: z.boolean().optional() },
    },
    ({ invoice_id, note, notify_customer }) =>
      guard(async () => {
        const inv = await provider.getInvoice(invoice_id);
        if (inv.status === 'partially_paid') return { error: `Invoice ${inv.number} already has a payment on it, so Penny will not cancel it; refund that payment or record the rest instead.` };
        if (inv.status !== 'sent') return { error: `Invoice ${inv.number} is ${inv.status}, so there is nothing to cancel.` };
        const notify = notify_customer ?? true;
        await provider.cancelInvoice(inv.id, { note, notifyCustomer: notify });
        const off = await callOffFor(deps.env, tenant, inv.id, 'The invoice it waited on was cancelled.');
        const who = inv.customer.name || inv.customer.email;
        return { cancelled: true, invoice_id: inv.id, spoken: [`Cancelled invoice ${inv.number} for ${who}${notify ? ' and let them know' : ''}.`, off].filter(Boolean).join(' '), page: pageUrl(env, withKey(`/p/invoice/${encodeURIComponent(inv.id)}`)) };
      }),
  );

  server.registerTool(
    'record_invoice_payment',
    {
      description:
        'Record money a customer paid outside PayPal (cash, cheque, bank transfer) against an invoice, so it shows as paid. amount defaults to everything still due; payment_date defaults to today. If that pays it off, payouts waiting on it (pay_when_paid) are released and always need a yes, since that money is not in the PayPal balance.',
      inputSchema: {
        invoice_id: z.string(),
        method: z.enum(['BANK_TRANSFER', 'CASH', 'CHECK', 'WIRE_TRANSFER', 'OTHER']),
        amount: z.number().positive().optional(),
        payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        note: z.string().max(500).optional(),
      },
    },
    (a) =>
      guard(async () => {
        const inv = await provider.getInvoice(a.invoice_id);
        const r = recordable(inv, a.amount);
        if (!r.ok) return { error: r.error };
        const date = a.payment_date ?? today();
        if (date > today()) return { error: 'That payment date is in the future; record it once the money is in.' };
        const idempotencyKey = await invoiceKey(tenant.id, a, Date.now(), 'penny-pay');
        await provider.recordInvoicePayment(inv.id, { method: a.method, amount: r.money, date, note: a.note, idempotencyKey });
        const after = await provider.getInvoice(inv.id);
        // Paid in full outside PayPal is still paid, so what waited on this invoice is released now. But that money is
        // not in the PayPal balance the payout would come from, so releaseFor has every released payout wait for a yes.
        const released = await releaseFor(deps.env, tenant, provider, inv.id, { invoice: after });
        const left = after.status === 'paid' ? 'it is now paid in full' : `${fmtMoney(after.due)} is still due`;
        return {
          recorded: true,
          ...compactInvoice(after, today()),
          spoken: [`Recorded ${fmtMoney(r.money)} by ${METHOD_WORDS[a.method]} on invoice ${inv.number}; ${left}.`, released?.detail].filter(Boolean).join(' '),
          page: released?.page ?? pageUrl(env, withKey(`/p/invoice/${encodeURIComponent(inv.id)}`)),
        };
      }),
  );

  server.registerTool(
    'respond_to_dispute',
    { description: 'Post the company\'s reply on a dispute (no money moves). Draft it, read it to the founders, send when they agree.', inputSchema: { dispute_id: z.string(), message: z.string().min(1).max(2000) } },
    ({ dispute_id, message }) =>
      guard(async () => {
        await provider.messageDispute(dispute_id, message);
        return { sent: true, dispute_id };
      }),
  );

  server.registerTool(
    'provide_dispute_evidence',
    {
      description:
        'Send PayPal evidence on a dispute (no money moves): a tracking number as proof the order shipped (carrier + tracking_number, best for "item not received"), or a written note with the facts (notes alone). Read it back and send when the founders agree.',
      inputSchema: {
        dispute_id: z.string(),
        carrier: z.string().min(2).max(60).optional(),
        tracking_number: z.string().min(3).max(60).optional(),
        notes: z.string().max(2000).optional(),
      },
    },
    ({ dispute_id, carrier, tracking_number, notes }) =>
      guard(async () => {
        if (tracking_number && !carrier) return { error: 'Which carrier shipped it? PayPal needs the carrier with the tracking number.' };
        if (!tracking_number && !notes?.trim()) return { error: 'Give a tracking number or a note; there is no evidence to send yet.' };
        await provider.provideDisputeEvidence(
          dispute_id,
          tracking_number && carrier ? { kind: 'fulfillment', carrier, trackingNumber: tracking_number, notes } : { kind: 'other', notes: notes!.trim() },
        );
        const spoken = tracking_number ? `Sent PayPal the ${carrier} tracking number as proof the order shipped${notes ? ', with your note' : ''}.` : 'Sent PayPal your note as evidence on the dispute.';
        return { sent: true, dispute_id, spoken, page: pageUrl(env, withKey(`/p/dispute/${encodeURIComponent(dispute_id)}`)) };
      }),
  );

  // ---- money out (goes through approvals) ------------------------------------

  server.registerTool(
    'pay',
    {
      description: `Pay someone (a contractor, a vendor, a refund by email) from the company account. Above ${currency} ${threshold}, or in any other currency, this returns needs_approval and a proposal_id: read the amount and recipient back, ask "Do you approve?", and only then call confirm_action.`,
      inputSchema: { recipient_email: z.string().email(), amount: z.number().positive(), currency: z.string().length(3).optional(), note: z.string().max(200) },
    },
    (a) =>
      guard(async () => {
        const m = { value: Math.round(a.amount * 100) / 100, currency: (a.currency ?? currency).toUpperCase() };
        const out = await runOrHold(money, 'payout', `Pay ${fmtMoney(m)} to ${a.recipient_email}: ${a.note}`, m, { recipientEmail: a.recipient_email, note: a.note });
        return { status: out.status, proposal_id: out.proposal.id, description: out.proposal.description, result: out.result, page: pageUrl(env, withKey(`/p/proposal/${out.proposal.id}`)) };
      }),
  );

  server.registerTool(
    'pay_when_paid',
    {
      description: `Hold a payment until a customer pays an invoice ("pay Sam when Acme pays"). Nothing moves now. When PayPal reports the invoice paid, Penny pays it at once if it is ${currency} ${threshold} or less, and otherwise asks the founders for a yes. Confirm recipient, amount and which invoice first.`,
      inputSchema: { invoice_id: z.string(), recipient_email: z.string().email(), amount: z.number().positive(), currency: z.string().length(3).optional(), note: z.string().max(200) },
    },
    (a) =>
      guard(async () => {
        const inv = await provider.getInvoice(a.invoice_id);
        if (inv.status !== 'sent' && inv.status !== 'partially_paid') return { error: `Invoice ${inv.number} is ${inv.status}, not waiting for payment. Use pay instead.` };
        const m = { value: Math.round(a.amount * 100) / 100, currency: (a.currency ?? currency).toUpperCase() };
        const p = await approvals.create(
          'payout',
          `Pay ${fmtMoney(m)} to ${a.recipient_email} once ${inv.customer.name || inv.customer.email} pays invoice ${inv.number}: ${a.note}`,
          m,
          { recipientEmail: a.recipient_email, note: a.note },
          inv.id,
        );
        return { status: 'waiting', proposal_id: p.id, description: p.description, page: pageUrl(env, withKey(`/p/proposal/${p.id}`)) };
      }),
  );

  server.registerTool(
    'refund_invoice',
    { description: `Refund a paid invoice, fully or partially (at most what the customer paid; the default is all of it). Above ${currency} ${threshold} this needs a spoken approval (see pay).`, inputSchema: { invoice_id: z.string(), amount: z.number().positive().optional(), reason: z.string().max(200).optional() } },
    (a) =>
      guard(async () => {
        const inv = await provider.getInvoice(a.invoice_id);
        const r = refundable(inv, a.amount);
        if (!r.ok) return { error: r.error };
        const m = r.money;
        const out = await runOrHold(money, 'refund', `Refund ${fmtMoney(m)} on invoice ${inv.number} (${inv.customer.name || inv.customer.email})${a.reason ? `: ${a.reason}` : ''}`, m, { invoiceId: inv.id, invoiceNumber: inv.number });
        return { status: out.status, proposal_id: out.proposal.id, description: out.proposal.description, result: out.result, page: pageUrl(env, withKey(`/p/proposal/${out.proposal.id}`)) };
      }),
  );

  server.registerTool(
    'accept_dispute',
    { description: `Accept a dispute and refund the buyer. Above ${currency} ${threshold} this needs a spoken approval (see pay).`, inputSchema: { dispute_id: z.string(), note: z.string().max(500).optional() } },
    (a) =>
      guard(async () => {
        const d = await provider.getDispute(a.dispute_id);
        const out = await runOrHold(money, 'accept_dispute', `Accept dispute ${d.id} and refund ${fmtMoney(d.amount)} to ${d.buyerEmail ?? 'the buyer'}`, d.amount, { disputeId: d.id, note: a.note ?? 'We accept the claim and are refunding you in full.' });
        return { status: out.status, proposal_id: out.proposal.id, description: out.proposal.description, result: out.result, page: pageUrl(env, withKey(`/p/proposal/${out.proposal.id}`)) };
      }),
  );

  server.registerTool(
    'payout_status',
    {
      description:
        'Where a payout stands at PayPal (went through, pending, unclaimed, failed). Give the proposal_id from when it was paid, the recipient_email for the latest payout to that person ("did Sam get paid?"), or a PayPal payout_batch_id.',
      inputSchema: { proposal_id: z.string().optional(), recipient_email: z.string().email().optional(), payout_batch_id: z.string().optional() },
    },
    ({ proposal_id, recipient_email, payout_batch_id }) =>
      guard(async () => {
        let batchId = payout_batch_id;
        if (!batchId) {
          let p: Proposal | null | undefined;
          if (proposal_id) p = await approvals.get(proposal_id);
          else if (recipient_email) p = (await approvals.listRecent(50)).find((x) => x.kind === 'payout' && String(x.input.recipientEmail).toLowerCase() === recipient_email.toLowerCase());
          else return { error: 'Which payout? Give the proposal id, the recipient\'s email, or the PayPal payout batch id.' };
          if (!p) return { error: proposal_id ? 'No such proposal' : `Penny has no recent payout to ${recipient_email}.` };
          if (p.kind !== 'payout') return { error: `That is a ${p.kind.replace('_', ' ')}, not a payout.` };
          batchId = payoutBatchId(p) ?? undefined;
          if (!batchId) return { status: p.status, description: p.description, spoken: describeUnsent(p), page: pageUrl(env, withKey(`/p/proposal/${p.id}`)) };
        }
        const b = await provider.getPayout(batchId);
        return { batch: b.id, batchStatus: b.status, items: b.items.map((i) => ({ status: i.status, amount: fmtMoney(i.amount), recipient: i.recipient, error: i.error })), spoken: describePayout(b) };
      }),
  );

  server.registerTool(
    'confirm_action',
    { description: 'Execute a held money-out action after a clear spoken yes on this call. approved_by is the name of the person who said yes.', inputSchema: { proposal_id: z.string(), approved_by: z.string().min(1) } },
    ({ proposal_id, approved_by }) =>
      guard(async () => {
        const out = await confirm({ approvals, provider }, proposal_id, approved_by);
        if (!out) return { error: 'No such proposal' };
        return { status: out.status, result: out.result, description: out.proposal.description };
      }),
  );

  server.registerTool(
    'cancel_action',
    { description: 'Drop a held money-out action the founders declined.', inputSchema: { proposal_id: z.string() } },
    ({ proposal_id }) =>
      guard(async () => {
        const p = await approvals.decide(proposal_id, false, 'declined on call');
        return p ? { status: p.status, description: p.description } : { error: 'No such proposal' };
      }),
  );

  server.registerTool(
    'pending_actions',
    { description: 'Money-out actions still waiting for a yes, and payouts waiting for a customer to pay (cancel_action calls either off).', inputSchema: {} },
    () =>
      guard(async () => {
        const [list, waiting] = await Promise.all([approvals.listPending(), approvals.listWaiting()]);
        const row = (p: (typeof list)[number]) => ({ proposal_id: p.id, description: p.description, amount: fmtMoney({ value: p.amount, currency: p.currency }), created: new Date(p.createdAt).toISOString() });
        return { count: list.length, pending: list.map(row), waitingForInvoice: waiting.map(row) };
      }),
  );

  // ---- memory ----------------------------------------------------------------

  server.registerTool(
    'remember',
    { description: 'Save a durable fact, decision or instruction in one clear sentence (vendor terms, a customer habit, "hold the AWS bill until the 15th").', inputSchema: { fact: z.string().min(3).max(1000) } },
    ({ fact }) => guard(async () => ({ saved: await memory.remember(fact) })),
  );

  server.registerTool(
    'recall',
    { description: 'Look something up in memory: past decisions, what someone said, vendor or customer facts.', inputSchema: { query: z.string().min(1) } },
    ({ query }) =>
      guard(async () => {
        const found = await memory.recall(query);
        return { count: found.length, memories: found.map((m) => m.content) };
      }),
  );
}
