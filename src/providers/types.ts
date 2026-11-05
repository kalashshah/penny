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
  /**
   * Paid in full, and every payment on it went through the rail itself (not cash, cheque or "marked as paid").
   * Only then is the money in the balance a payout would come from. Unknown counts as no.
   */
  paidViaRail?: boolean;
}

export interface InvoiceInput {
  customerEmail: string;
  customerName?: string;
  items: { name: string; quantity: number; unitAmount: number }[];
  currency: string;
  dueInDays?: number;
  memo?: string;
  /** The same key within PayPal's window creates (and sends) the invoice once, however often the call is retried. */
  idempotencyKey?: string;
}

/** How a customer paid outside PayPal, as Penny records it on the invoice. */
export type ExternalPaymentMethod = 'BANK_TRANSFER' | 'CASH' | 'CHECK' | 'WIRE_TRANSFER' | 'OTHER';

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
  /** What the seller has already sent PayPal as evidence. */
  evidence: { type: string; notes?: string; tracking: { carrier: string; number: string }[]; at?: string }[];
}

/** Evidence for a dispute: a shipment's tracking (proof it was fulfilled), or a written note. */
export type DisputeEvidence = { kind: 'fulfillment'; carrier: string; trackingNumber: string; notes?: string } | { kind: 'other'; notes: string };

export interface Payout {
  id: string;
  status: string;
  amount: Money;
  recipient: string;
}

/** A payout as PayPal tracks it: the batch, and the one payment per recipient inside it. */
export interface PayoutBatch {
  id: string;
  /** The batch's status, lowercased: pending, processing, success, denied, canceled. */
  status: string;
  items: { id: string; status: string; amount?: Money; recipient?: string; error?: string }[];
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
  /** A payout item that has not reached the recipient yet but is not final either (unclaimed, held). */
  | 'payout.pending'
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
  /** payout.* only: the idempotency key Penny sent with the payout, which is the proposal's id. */
  payoutKey?: string;
  /** payout.failed and payout.pending only: why, in the rail's words, when it says. */
  reason?: string;
  raw: unknown;
}

export interface PaymentProvider {
  readonly name: string;
  listInvoices(opts: { status?: 'open' | 'paid' | 'all'; limit?: number }): Promise<Invoice[]>;
  getInvoice(id: string): Promise<Invoice>;
  createAndSendInvoice(input: InvoiceInput): Promise<Invoice>;
  sendReminder(id: string, note?: string): Promise<void>;
  /** Cancels a sent invoice; the customer is told unless notifyCustomer is false. */
  cancelInvoice(id: string, opts: { note?: string; notifyCustomer: boolean }): Promise<void>;
  /** Records money received outside the rail (cash, cheque, bank transfer) against an invoice. Returns the payment id. */
  recordInvoicePayment(id: string, p: { method: ExternalPaymentMethod; amount: Money; date: string; note?: string; idempotencyKey?: string }): Promise<string>;
  listDisputes(): Promise<Dispute[]>;
  getDispute(id: string): Promise<Dispute>;
  messageDispute(id: string, message: string): Promise<void>;
  acceptDispute(id: string, note: string): Promise<void>;
  provideDisputeEvidence(id: string, evidence: DisputeEvidence): Promise<void>;
  payout(input: { recipientEmail: string; amount: Money; note: string; idempotencyKey: string }): Promise<Payout>;
  getPayout(batchId: string): Promise<PayoutBatch>;
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
