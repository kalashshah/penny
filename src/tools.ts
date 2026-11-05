import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { confirm, runOrHold, type Approvals } from './approvals';
import type { Env } from './env';
import { describeForecast, formatWhatIf, loadForecast } from './forecast';
import type { Memory } from './memory';
import type { Dispute, Invoice, Money, PaymentProvider } from './providers/types';
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
  };
}

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
        const i = await provider.createAndSendInvoice({
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
    'respond_to_dispute',
    { description: 'Post the company\'s reply on a dispute (no money moves). Draft it, read it to the founders, send when they agree.', inputSchema: { dispute_id: z.string(), message: z.string().min(1).max(2000) } },
    ({ dispute_id, message }) =>
      guard(async () => {
        await provider.messageDispute(dispute_id, message);
        return { sent: true, dispute_id };
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
