/**
 * The payment rail behind Penny, in Penny's own words. `paypal.ts` implements it
 * today; an Airwallex adapter implements the same interface and nothing above
 * this file changes (tools, approvals, pages, webhooks all speak these types).
 */
export interface Money {
  value: number;
  currency: string;
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'partially_paid' | 'cancelled' | 'refunded' | 'other';

export interface Invoice {
  id: string;
  number: string;
  status: InvoiceStatus;
  customer: { name: string; email: string };
  total: Money;
  due: Money;
  dueDate?: string;
  issuedAt?: string;
  paidAt?: string;
  payLink?: string;
  memo?: string;
  items: { name: string; quantity: number; unitAmount: Money }[];
  /** What has been paid against it so far, when the rail says. */
  paid?: Money;
  /** Provider ids of the payments received against it (what a refund targets). */
  paymentIds: string[];
}

export interface InvoiceInput {
  customerEmail: string;
  customerName?: string;
  items: { name: string; quantity: number; unitAmount: number }[];
  currency: string;
  dueInDays?: number;
  memo?: string;
}

export interface Dispute {
  id: string;
  reason: string;
  status: string;
  state: string;
  stage?: string;
  amount: Money;
  createdAt?: string;
  respondBy?: string;
  transactionId?: string;
  buyerEmail?: string;
  messages: { by: string; at?: string; text: string }[];
}

export interface Payout {
  id: string;
  status: string;
  amount: Money;
  recipient: string;
}

export interface Refund {
  id: string;
  status: string;
  amount?: Money;
}

export interface Transaction {
  id: string;
  date: string;
  amount: Money;
  fee?: Money;
  status: string;
  kind: string;
  counterparty?: string;
  note?: string;
  invoiceId?: string;
}

export type PennyEventType =
  | 'invoice.paid'
  | 'invoice.cancelled'
  | 'invoice.refunded'
  | 'dispute.created'
  | 'dispute.updated'
  | 'dispute.resolved'
  | 'payout.completed'
  | 'payout.failed'
  | 'payment.received'
  | 'payment.refunded'
  | 'other';

export interface PennyEvent {
  id: string;
  type: PennyEventType;
  summary: string;
  amount?: Money;
  refId?: string;
  refKind?: 'invoice' | 'dispute' | 'payout' | 'transaction';
  raw: unknown;
}

export interface PaymentProvider {
  readonly name: string;
  listInvoices(opts: { status?: 'open' | 'paid' | 'all'; limit?: number }): Promise<Invoice[]>;
  getInvoice(id: string): Promise<Invoice>;
  createAndSendInvoice(input: InvoiceInput): Promise<Invoice>;
  sendReminder(id: string, note?: string): Promise<void>;
  listDisputes(): Promise<Dispute[]>;
  getDispute(id: string): Promise<Dispute>;
  messageDispute(id: string, message: string): Promise<void>;
  acceptDispute(id: string, note: string): Promise<void>;
  payout(input: { recipientEmail: string; amount: Money; note: string; idempotencyKey: string }): Promise<Payout>;
  refundInvoice(invoiceId: string, amount?: Money, idempotencyKey?: string): Promise<Refund>;
  listTransactions(from: Date, to: Date): Promise<Transaction[]>;
  /** What is in the account now, or null when the rail will not say. */
  getBalance(currency: string): Promise<Money | null>;
  verifyWebhook(headers: Headers, rawBody: string): Promise<boolean>;
  parseEvent(body: unknown): PennyEvent | null;
  registerWebhook(url: string): Promise<string>;
}

export function fmtMoney(m: Money | undefined): string {
  if (!m) return '';
  return `${m.currency} ${m.value.toFixed(2)}`;
}
