import type {
  Dispute,
  DisputeEvidence,
  Invoice,
  InvoiceInput,
  InvoiceStatus,
  Money,
  PaymentProvider,
  Payout,
  PennyEvent,
  PennyEventType,
  Refund,
  Transaction,
} from './types';
import { fmtMoney } from './types';

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  env: 'sandbox' | 'live';
  webhookId?: string;
  businessName: string;
}

const HOSTS = { sandbox: 'https://api-m.sandbox.paypal.com', live: 'https://api-m.paypal.com' } as const;

export const PAYPAL_EVENTS = [
  'INVOICING.INVOICE.PAID',
  'INVOICING.INVOICE.CANCELLED',
  'INVOICING.INVOICE.REFUNDED',
  'CUSTOMER.DISPUTE.CREATED',
  'CUSTOMER.DISPUTE.UPDATED',
  'CUSTOMER.DISPUTE.RESOLVED',
  'PAYMENT.PAYOUTSBATCH.SUCCESS',
  'PAYMENT.PAYOUTSBATCH.DENIED',
  'PAYMENT.PAYOUTS-ITEM.SUCCEEDED',
  'PAYMENT.PAYOUTS-ITEM.FAILED',
  'PAYMENT.PAYOUTS-ITEM.UNCLAIMED',
  'PAYMENT.PAYOUTS-ITEM.BLOCKED',
  'PAYMENT.PAYOUTS-ITEM.RETURNED',
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.REFUNDED',
];

const OPEN_STATUSES = ['SENT', 'UNPAID', 'PARTIALLY_PAID', 'PAYMENT_PENDING'];
// Search filter only: search-invoices rejects PAID_EXTERNAL even though invoices can carry it.
const PAID_STATUSES = ['PAID', 'MARKED_AS_PAID'];

// Access tokens per isolate, keyed by env and client id: a token belongs to the app, not to the tenant using it,
// so new credentials (or sandbox → live) never reuse a token minted for the old ones.
const tokens = new Map<string, { token: string; exp: number }>();

export function isWebhookVerificationOff(env: { WEBHOOK_VERIFY?: string }): boolean {
  return env.WEBHOOK_VERIFY === 'off';
}

export class PayPalProvider implements PaymentProvider {
  readonly name = 'paypal';
  constructor(private readonly cfg: PayPalConfig) {}

  private get host(): string {
    return HOSTS[this.cfg.env];
  }

  private get tokenKey(): string {
    return `${this.cfg.env}:${this.cfg.clientId}`;
  }

  private async token(): Promise<string> {
    const key = this.tokenKey;
    const cached = tokens.get(key);
    if (cached && cached.exp > Date.now() + 60_000) return cached.token;
    const res = await fetch(`${this.host}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${this.cfg.clientId}:${this.cfg.clientSecret}`)}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`PayPal auth failed (${res.status}); check the client id and secret of the PayPal app`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    tokens.set(key, { token: j.access_token, exp: Date.now() + j.expires_in * 1000 });
    return j.access_token;
  }

  private async api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    // FormData carries its own multipart content-type (with the boundary), so it must not get the JSON one.
    const form = body instanceof FormData;
    const send = async () =>
      fetch(`${this.host}${path}`, {
        method,
        headers: { Authorization: `Bearer ${await this.token()}`, ...(form ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : form ? body : JSON.stringify(body),
      });
    let res = await send();
    // A cached token keeps the scopes it was issued with; one minted after a feature is enabled on the app has them.
    if (res.status === 401 || res.status === 403) {
      tokens.delete(this.tokenKey);
      res = await send();
    }
    const text = await res.text();
    if (res.status === 403) {
      throw new Error(`PayPal ${method} ${path} was refused (403): this PayPal app lacks the permission for it. In developer.paypal.com → Apps & Credentials → your app → Features, enable ${featureFor(path)}, save, then retry (PayPal can take a few minutes to apply it).`);
    }
    if (!res.ok) throw new Error(`PayPal ${method} ${path} failed (${res.status}): ${describeError(text)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  // ---- invoices ------------------------------------------------------------

  async listInvoices({ status = 'open', limit = 50 }: { status?: 'open' | 'paid' | 'all'; limit?: number }): Promise<Invoice[]> {
    const body: Record<string, unknown> = {};
    if (status === 'open') body.status = OPEN_STATUSES;
    if (status === 'paid') body.status = PAID_STATUSES;
    const res = await this.api<{ items?: RawInvoice[] }>(
      'POST',
      `/v2/invoicing/search-invoices?page=1&page_size=${Math.min(limit, 100)}&total_required=false`,
      body,
    );
    const items = res.items ?? [];
    if (status !== 'paid') return items.map(toInvoice);
    // Search omits payments.transactions, so paidAt (what "collected this month" keys on) needs the full invoice.
    // ponytail: newest 20 only (Workers subrequest budget); older paid invoices keep no paidAt, fine for a this-month total.
    return Promise.all(items.map((raw, n) => (n < 20 && !raw.payments?.transactions ? this.getInvoice(raw.id) : toInvoice(raw))));
  }

  async getInvoice(id: string): Promise<Invoice> {
    return toInvoice(await this.api<RawInvoice>('GET', `/v2/invoicing/invoices/${encodeURIComponent(id)}`));
  }

  async createAndSendInvoice(input: InvoiceInput): Promise<Invoice> {
    const { invoice_number } = await this.api<{ invoice_number: string }>('POST', '/v2/invoicing/generate-next-invoice-number');
    const [given, ...rest] = (input.customerName ?? '').trim().split(/\s+/).filter(Boolean);
    const created = await this.api<RawInvoice & { href?: string }>(
      'POST',
      '/v2/invoicing/invoices',
      {
        detail: {
          currency_code: input.currency,
          invoice_number,
          invoice_date: isoDate(new Date()),
          payment_term: { term_type: 'DUE_ON_DATE_SPECIFIED', due_date: isoDate(addDays(new Date(), input.dueInDays ?? 14)) },
          ...(input.memo ? { memo: input.memo } : {}),
        },
        invoicer: { business_name: this.cfg.businessName },
        primary_recipients: [
          {
            billing_info: {
              email_address: input.customerEmail,
              ...(given ? { name: { given_name: given, ...(rest.length ? { surname: rest.join(' ') } : {}) } } : {}),
            },
          },
        ],
        items: input.items.map((i) => ({
          name: i.name,
          quantity: String(i.quantity),
          unit_amount: { currency_code: input.currency, value: i.unitAmount.toFixed(2) },
          unit_of_measure: 'QUANTITY',
        })),
      },
      { Prefer: 'return=representation', ...(input.idempotencyKey ? { 'PayPal-Request-Id': input.idempotencyKey } : {}) },
    );
    const id = created.id ?? created.href?.split('/').pop();
    if (!id) throw new Error('PayPal created the invoice but returned no id');
    // A replayed create returns the first invoice, which may already be sent; the same request id makes the send a replay too.
    await this.api('POST', `/v2/invoicing/invoices/${id}/send`, { send_to_recipient: true, send_to_invoicer: false }, input.idempotencyKey ? { 'PayPal-Request-Id': `${input.idempotencyKey}-send` } : {});
    return this.getInvoice(id);
  }

  async sendReminder(id: string, note?: string): Promise<void> {
    await this.api('POST', `/v2/invoicing/invoices/${encodeURIComponent(id)}/remind`, {
      subject: `Reminder: your invoice from ${this.cfg.businessName}`,
      note: note ?? 'A friendly reminder that this invoice is due. Thank you!',
      send_to_recipient: true,
      send_to_invoicer: false,
    });
  }

  // ---- disputes ------------------------------------------------------------

  async listDisputes(): Promise<Dispute[]> {
    const res = await this.api<{ items?: RawDispute[] }>('GET', '/v1/customer/disputes?page_size=50');
    return (res.items ?? []).map(toDispute);
  }

  async getDispute(id: string): Promise<Dispute> {
    return toDispute(await this.api<RawDispute>('GET', `/v1/customer/disputes/${encodeURIComponent(id)}`));
  }

  async messageDispute(id: string, message: string): Promise<void> {
    await this.api('POST', `/v1/customer/disputes/${encodeURIComponent(id)}/send-message`, { message });
  }

  async acceptDispute(id: string, note: string): Promise<void> {
    await this.api('POST', `/v1/customer/disputes/${encodeURIComponent(id)}/accept-claim`, { note, accept_claim_type: 'REFUND' });
  }

  async provideDisputeEvidence(id: string, evidence: DisputeEvidence): Promise<void> {
    // provide-evidence is multipart/form-data only: the evidence JSON goes in a part named `input` (files would be file1, file2...).
    const form = new FormData();
    form.append('input', new Blob([JSON.stringify(evidenceInput(evidence))], { type: 'application/json' }), 'input.json');
    await this.api('POST', `/v1/customer/disputes/${encodeURIComponent(id)}/provide-evidence`, form);
  }

  // ---- money out -----------------------------------------------------------

  async payout({ recipientEmail, amount, note, idempotencyKey }: { recipientEmail: string; amount: Money; note: string; idempotencyKey: string }): Promise<Payout> {
    const res = await this.api<{ batch_header: { payout_batch_id: string; batch_status: string } }>(
      'POST',
      '/v1/payments/payouts',
      {
        sender_batch_header: {
          sender_batch_id: idempotencyKey.slice(0, 30),
          email_subject: `You have a payment from ${this.cfg.businessName}`,
          email_message: note,
        },
        items: [
          {
            recipient_type: 'EMAIL',
            receiver: recipientEmail,
            amount: { value: amount.value.toFixed(2), currency: amount.currency },
            note,
            sender_item_id: `${idempotencyKey.slice(0, 26)}-1`,
          },
        ],
      },
      { 'PayPal-Request-Id': idempotencyKey },
    );
    return { id: res.batch_header.payout_batch_id, status: res.batch_header.batch_status.toLowerCase(), amount, recipient: recipientEmail };
  }

  async refundInvoice(invoiceId: string, amount?: Money, idempotencyKey?: string): Promise<Refund> {
    const inv = await this.getInvoice(invoiceId);
    const captureId = inv.paymentIds[0];
    if (!captureId) throw new Error(`Invoice ${inv.number} has no PayPal payment on it to refund`);
    const res = await this.api<{ id: string; status: string }>(
      'POST',
      `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
      amount ? { amount: { value: amount.value.toFixed(2), currency_code: amount.currency } } : {},
      idempotencyKey ? { 'PayPal-Request-Id': idempotencyKey } : {},
    );
    return { id: res.id, status: res.status.toLowerCase(), amount: amount ?? inv.total };
  }

  // ---- reporting -----------------------------------------------------------

  async listTransactions(from: Date, to: Date): Promise<Transaction[]> {
    const q = new URLSearchParams({
      start_date: paypalDate(from),
      end_date: paypalDate(to),
      fields: 'transaction_info,payer_info,cart_info',
      page_size: '100',
      page: '1',
    });
    const res = await this.api<{ transaction_details?: RawTransaction[] }>('GET', `/v1/reporting/transactions?${q}`);
    return (res.transaction_details ?? []).map(toTransaction);
  }

  async getBalance(currency: string): Promise<Money | null> {
    type Amount = { currency_code: string; value: string };
    const res = await this.api<{ balances?: { currency: string; primary?: boolean; total_balance?: Amount; available_balance?: Amount }[] }>(
      'GET',
      `/v1/reporting/balances?currency_code=${encodeURIComponent(currency)}`,
    );
    const b = res.balances?.find((x) => x.currency === currency) ?? res.balances?.find((x) => x.primary);
    return money(b?.available_balance ?? b?.total_balance) ?? null;
  }

  // ---- webhooks ------------------------------------------------------------

  async verifyWebhook(headers: Headers, rawBody: string): Promise<boolean> {
    if (!this.cfg.webhookId) return false;
    const h = (name: string) => JSON.stringify(headers.get(name) ?? '');
    // Built by hand so `webhook_event` is the exact bytes PayPal signed; re-serialising would fail verification.
    const body =
      `{"auth_algo":${h('paypal-auth-algo')},"cert_url":${h('paypal-cert-url')},` +
      `"transmission_id":${h('paypal-transmission-id')},"transmission_sig":${h('paypal-transmission-sig')},` +
      `"transmission_time":${h('paypal-transmission-time')},"webhook_id":${JSON.stringify(this.cfg.webhookId)},` +
      `"webhook_event":${rawBody}}`;
    const res = await fetch(`${this.host}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json' },
      body,
    });
    if (!res.ok) return false;
    const j = (await res.json()) as { verification_status?: string };
    return j.verification_status === 'SUCCESS';
  }

  parseEvent(body: unknown): PennyEvent | null {
    return toEvent(body);
  }

  async registerWebhook(url: string): Promise<string> {
    const existing = await this.api<{ webhooks?: { id: string; url: string }[] }>('GET', '/v1/notifications/webhooks');
    const found = existing.webhooks?.find((w) => w.url === url);
    if (found) return found.id;
    const res = await this.api<{ id: string }>('POST', '/v1/notifications/webhooks', {
      url,
      event_types: PAYPAL_EVENTS.map((name) => ({ name })),
    });
    return res.id;
  }
}

// ---- raw shapes (only the fields Penny reads) --------------------------------

interface RawMoney {
  currency_code?: string;
  currency?: string;
  value?: string;
}
interface RawName {
  given_name?: string;
  surname?: string;
  full_name?: string;
}
interface RawInvoice {
  id: string;
  status: string;
  detail?: {
    invoice_number?: string;
    invoice_date?: string;
    currency_code?: string;
    memo?: string;
    note?: string;
    payment_term?: { due_date?: string };
    metadata?: { recipient_view_url?: string };
  };
  primary_recipients?: { billing_info?: { name?: RawName; business_name?: string; email_address?: string } }[];
  items?: { name: string; quantity: string; unit_amount?: RawMoney }[];
  amount?: RawMoney;
  due_amount?: RawMoney;
  payments?: { paid_amount?: RawMoney; transactions?: { payment_id?: string; payment_date?: string }[] };
}
interface RawDispute {
  dispute_id: string;
  reason?: string;
  status?: string;
  dispute_state?: string;
  dispute_life_cycle_stage?: string;
  dispute_amount?: RawMoney;
  create_time?: string;
  seller_response_due_date?: string;
  disputed_transactions?: { seller_transaction_id?: string; buyer?: { email?: string } }[];
  messages?: { posted_by?: string; time_posted?: string; content?: string }[];
  evidences?: { evidence_type?: string; notes?: string; date?: string; evidence_info?: { tracking_info?: RawTracking[] } }[];
}
interface RawTracking {
  carrier_name?: string;
  carrier_name_other?: string;
  tracking_number?: string;
}
interface RawTransaction {
  transaction_info?: {
    transaction_id?: string;
    transaction_initiation_date?: string;
    transaction_amount?: RawMoney;
    fee_amount?: RawMoney;
    transaction_status?: string;
    transaction_event_code?: string;
    transaction_subject?: string;
    invoice_id?: string;
  };
  payer_info?: { email_address?: string; payer_name?: { alternate_full_name?: string; given_name?: string; surname?: string } };
}

// ---- mappers (pure, exported for tests) --------------------------------------

export function toInvoice(raw: RawInvoice): Invoice {
  const bill = raw.primary_recipients?.[0]?.billing_info;
  const txns = raw.payments?.transactions ?? [];
  const currency = raw.detail?.currency_code ?? raw.amount?.currency_code ?? 'USD';
  return {
    id: raw.id,
    number: raw.detail?.invoice_number ?? raw.id,
    status: mapInvoiceStatus(raw.status),
    customer: { name: fullName(bill?.name) || bill?.business_name || '', email: bill?.email_address ?? '' },
    total: money(raw.amount) ?? { value: 0, currency },
    due: money(raw.due_amount) ?? { value: 0, currency },
    dueDate: raw.detail?.payment_term?.due_date,
    issuedAt: raw.detail?.invoice_date,
    paidAt: txns[0]?.payment_date,
    payLink: raw.detail?.metadata?.recipient_view_url,
    memo: raw.detail?.memo ?? raw.detail?.note,
    items: (raw.items ?? []).map((i) => ({ name: i.name, quantity: Number(i.quantity), unitAmount: money(i.unit_amount) ?? { value: 0, currency } })),
    paid: money(raw.payments?.paid_amount),
    paymentIds: txns.map((t) => t.payment_id).filter((x): x is string => Boolean(x)),
  };
}

function featureFor(path: string): string {
  if (path.startsWith('/v1/reporting')) return 'Transaction Search';
  if (path.startsWith('/v2/invoicing')) return 'Invoicing';
  if (path.startsWith('/v1/payments/payouts')) return 'Payouts';
  if (path.startsWith('/v1/customer/disputes')) return 'Disputes';
  return 'the feature this call needs';
}

export function mapInvoiceStatus(s: string | undefined): InvoiceStatus {
  switch (s) {
    case 'DRAFT':
      return 'draft';
    case 'SENT':
    case 'UNPAID':
    case 'SCHEDULED':
    case 'PAYMENT_PENDING':
      return 'sent';
    case 'PAID':
    case 'MARKED_AS_PAID':
    case 'PAID_EXTERNAL':
      return 'paid';
    case 'PARTIALLY_PAID':
      return 'partially_paid';
    case 'CANCELLED':
    case 'AUTO_CANCELLED':
      return 'cancelled';
    case 'REFUNDED':
    case 'MARKED_AS_REFUNDED':
    case 'PARTIALLY_REFUNDED':
      return 'refunded';
    default:
      return 'other';
  }
}

export function toDispute(raw: RawDispute): Dispute {
  const txn = raw.disputed_transactions?.[0];
  return {
    id: raw.dispute_id,
    reason: raw.reason ?? 'OTHER',
    status: raw.status ?? '',
    state: raw.dispute_state ?? '',
    stage: raw.dispute_life_cycle_stage,
    amount: money(raw.dispute_amount) ?? { value: 0, currency: 'USD' },
    createdAt: raw.create_time,
    respondBy: raw.seller_response_due_date,
    transactionId: txn?.seller_transaction_id,
    buyerEmail: txn?.buyer?.email,
    messages: (raw.messages ?? []).map((m) => ({ by: m.posted_by ?? '', at: m.time_posted, text: m.content ?? '' })),
    evidence: (raw.evidences ?? []).map((e) => ({
      type: e.evidence_type ?? 'OTHER',
      notes: e.notes,
      at: e.date,
      tracking: (e.evidence_info?.tracking_info ?? []).map((t) => ({ carrier: (t.carrier_name === 'OTHER' && t.carrier_name_other) || t.carrier_name || '', number: t.tracking_number ?? '' })),
    })),
  };
}

// PayPal's carrier_name is an enum of hundreds of codes; these are the ones a founder names out loud.
// ponytail: anything else goes as OTHER with the name spelled out, which PayPal accepts for any carrier.
const CARRIERS: Record<string, string> = { UPS: 'UPS', USPS: 'USPS', FEDEX: 'FEDEX', DHL: 'DHL' };

/** "FedEx" → FEDEX; "Royal Mail" → OTHER + carrier_name_other. */
export function carrierFor(name: string): { carrier_name: string; carrier_name_other?: string } {
  const code = CARRIERS[name.toUpperCase().replace(/[^A-Z]/g, '')];
  return code ? { carrier_name: code } : { carrier_name: 'OTHER', carrier_name_other: name.trim() || 'Other' };
}

/** The `input` part of provide-evidence: one evidence, PROOF_OF_FULFILLMENT with tracking or OTHER with notes. */
export function evidenceInput(e: DisputeEvidence): { evidences: Record<string, unknown>[] } {
  if (e.kind === 'fulfillment') {
    return {
      evidences: [
        {
          evidence_type: 'PROOF_OF_FULFILLMENT',
          evidence_info: { tracking_info: [{ ...carrierFor(e.carrier), tracking_number: e.trackingNumber.trim() }] },
          ...(e.notes ? { notes: e.notes.slice(0, 2000) } : {}),
        },
      ],
    };
  }
  return { evidences: [{ evidence_type: 'OTHER', notes: e.notes.slice(0, 2000) }] };
}

const TXN_STATUS: Record<string, string> = { S: 'completed', P: 'pending', D: 'denied', V: 'reversed' };

export function toTransaction(raw: RawTransaction): Transaction {
  const t = raw.transaction_info ?? {};
  const p = raw.payer_info;
  return {
    id: t.transaction_id ?? '',
    date: t.transaction_initiation_date ?? '',
    amount: money(t.transaction_amount) ?? { value: 0, currency: 'USD' },
    fee: money(t.fee_amount),
    status: TXN_STATUS[t.transaction_status ?? ''] ?? (t.transaction_status ?? ''),
    kind: t.transaction_event_code ?? '',
    counterparty: p?.payer_name?.alternate_full_name || fullName(p?.payer_name) || p?.email_address,
    note: t.transaction_subject,
    invoiceId: t.invoice_id,
  };
}

/** A PayPal webhook body → Penny's event, or null for anything Penny does not understand. */
export function toEvent(body: unknown): PennyEvent | null {
  const b = body as { id?: unknown; event_type?: unknown; resource?: Record<string, unknown> } | null;
  if (!b || typeof b.id !== 'string' || typeof b.event_type !== 'string') return null;
  const t = b.event_type;
  const r = (b.resource ?? {}) as Record<string, any>;
  const base = { id: b.id, raw: body };

  if (t.startsWith('INVOICING.INVOICE.')) {
    const inv = (r.invoice ?? r) as RawInvoice;
    const number = inv?.detail?.invoice_number ?? inv?.id ?? '?';
    const amount = money(inv?.amount);
    const bill = inv?.primary_recipients?.[0]?.billing_info;
    const who = fullName(bill?.name) || bill?.business_name || bill?.email_address || 'the customer';
    const type: PennyEventType = t.endsWith('.PAID')
      ? 'invoice.paid'
      : t.endsWith('.CANCELLED')
        ? 'invoice.cancelled'
        : t.endsWith('.REFUNDED')
          ? 'invoice.refunded'
          : 'other';
    const verb = type === 'invoice.paid' ? `was paid by ${who}` : type === 'invoice.cancelled' ? 'was cancelled' : type === 'invoice.refunded' ? 'was refunded' : t;
    return { ...base, type, summary: `Invoice ${number} (${fmtMoney(amount)}) ${verb}`, amount, refId: inv?.id, refKind: 'invoice' };
  }
  if (t.startsWith('CUSTOMER.DISPUTE.')) {
    const amount = money(r.dispute_amount);
    const type: PennyEventType = t.endsWith('.CREATED') ? 'dispute.created' : t.endsWith('.RESOLVED') ? 'dispute.resolved' : 'dispute.updated';
    const what = type === 'dispute.created' ? 'opened' : type === 'dispute.resolved' ? 'resolved' : 'updated';
    const reason = String(r.reason ?? '').toLowerCase().replace(/_/g, ' ');
    return { ...base, type, summary: `Dispute ${r.dispute_id ?? ''} ${what}: ${reason} (${fmtMoney(amount)})`, amount, refId: r.dispute_id, refKind: 'dispute' };
  }
  if (t.startsWith('PAYMENT.PAYOUTSBATCH.')) {
    const type: PennyEventType = t.endsWith('.SUCCESS') ? 'payout.completed' : t.endsWith('.DENIED') ? 'payout.failed' : 'other';
    const amount = money(r.batch_header?.amount);
    const id = r.batch_header?.payout_batch_id;
    const payoutKey = r.batch_header?.sender_batch_header?.sender_batch_id;
    return { ...base, type, summary: `Payout batch ${id ?? ''} ${type === 'payout.completed' ? 'completed' : type === 'payout.failed' ? 'was denied' : 'is processing'} (${fmtMoney(amount)})`, amount, refId: id, refKind: 'payout', payoutKey, reason: type === 'payout.failed' ? 'PayPal denied the payout batch' : undefined };
  }
  if (t.startsWith('PAYMENT.PAYOUTS-ITEM.')) {
    const item = r.payout_item ?? {};
    const amount = money(item.amount);
    const ok = t.endsWith('.SUCCEEDED');
    const state = t.split('.').pop()?.toLowerCase() ?? '';
    // payout() sends sender_item_id `${proposalId}-1`.
    const sender = typeof item.sender_item_id === 'string' ? item.sender_item_id : undefined;
    return {
      ...base,
      type: ok ? 'payout.completed' : 'payout.failed',
      summary: `Payment of ${fmtMoney(amount)} to ${item.receiver ?? 'recipient'} ${ok ? 'went through' : state}`,
      amount,
      refId: r.payout_batch_id,
      refKind: 'payout',
      payoutKey: sender?.replace(/-1$/, ''),
      reason: ok ? undefined : [state, r.errors?.message ?? (state === 'unclaimed' ? 'the recipient has no PayPal account yet; PayPal returns the money if it stays unclaimed for 30 days' : undefined)].filter(Boolean).join(': '),
    };
  }
  if (t === 'PAYMENT.CAPTURE.COMPLETED' || t === 'PAYMENT.CAPTURE.REFUNDED') {
    const amount = money(r.amount);
    const received = t.endsWith('COMPLETED');
    return { ...base, type: received ? 'payment.received' : 'payment.refunded', summary: `${received ? 'Payment received' : 'Payment refunded'}: ${fmtMoney(amount)}`, amount, refId: r.id, refKind: 'transaction' };
  }
  return { ...base, type: 'other', summary: t };
}

// ---- small helpers -------------------------------------------------------------

function money(m: RawMoney | undefined): Money | undefined {
  if (!m || m.value === undefined) return undefined;
  const currency = m.currency_code ?? m.currency;
  if (!currency) return undefined;
  return { value: Number(m.value), currency };
}

function fullName(n: RawName | undefined): string {
  if (!n) return '';
  return n.full_name ?? [n.given_name, n.surname].filter(Boolean).join(' ');
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/** PayPal's reporting API wants `2026-10-01T00:00:00-0000`, not `…Z`. */
function paypalDate(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, '-0000');
}

function describeError(text: string): string {
  try {
    const j = JSON.parse(text) as { name?: string; message?: string; details?: { issue?: string; description?: string }[] };
    const detail = j.details?.map((d) => d.description ?? d.issue).filter(Boolean).join('; ');
    return [j.name, j.message, detail].filter(Boolean).join(' – ') || text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}
