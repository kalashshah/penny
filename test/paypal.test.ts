import { describe, expect, it } from 'vitest';
import { carrierFor, evidenceInput, mapInvoiceStatus, toDispute, toEvent, toInvoice, toPayoutBatch } from '../src/providers/paypal';

describe('toInvoice', () => {
  it('maps the fields Penny reads', () => {
    const i = toInvoice({
      id: 'INV2-ABCD',
      status: 'SENT',
      detail: { invoice_number: '0042', invoice_date: '2026-10-01', currency_code: 'USD', memo: 'October sprint', payment_term: { due_date: '2026-10-15' }, metadata: { recipient_view_url: 'https://www.sandbox.paypal.com/invoice/p/#ABCD' } },
      primary_recipients: [{ billing_info: { name: { given_name: 'Dana', surname: 'Lee' }, email_address: 'dana@acme.test' } }],
      items: [{ name: 'Sprint', quantity: '1', unit_amount: { currency_code: 'USD', value: '4000.00' } }],
      amount: { currency_code: 'USD', value: '4000.00' },
      due_amount: { currency_code: 'USD', value: '4000.00' },
      payments: { transactions: [{ payment_id: '7AB12', payment_date: '2026-10-10' }] },
    });
    expect(i).toMatchObject({ id: 'INV2-ABCD', number: '0042', status: 'sent', customer: { name: 'Dana Lee', email: 'dana@acme.test' }, total: { value: 4000, currency: 'USD' }, dueDate: '2026-10-15', paidAt: '2026-10-10', paymentIds: ['7AB12'] });
    expect(i.payLink).toContain('sandbox.paypal.com');
    expect(i.items[0]).toEqual({ name: 'Sprint', quantity: 1, unitAmount: { value: 4000, currency: 'USD' } });
  });
  it('maps every PayPal status to one of Penny\'s', () => {
    expect(mapInvoiceStatus('PAID')).toBe('paid');
    expect(mapInvoiceStatus('MARKED_AS_PAID')).toBe('paid');
    expect(mapInvoiceStatus('UNPAID')).toBe('sent');
    expect(mapInvoiceStatus('PARTIALLY_PAID')).toBe('partially_paid');
    expect(mapInvoiceStatus('AUTO_CANCELLED')).toBe('cancelled');
    expect(mapInvoiceStatus('PARTIALLY_REFUNDED')).toBe('refunded');
    expect(mapInvoiceStatus('WHATEVER')).toBe('other');
  });
});

describe('toEvent', () => {
  it('invoice paid', () => {
    const e = toEvent({ id: 'WH-1', event_type: 'INVOICING.INVOICE.PAID', resource: { invoice: { id: 'INV2-1', detail: { invoice_number: '0042' }, amount: { currency_code: 'USD', value: '4000.00' }, primary_recipients: [{ billing_info: { business_name: 'Acme' } }] } } });
    expect(e).toMatchObject({ id: 'WH-1', type: 'invoice.paid', refId: 'INV2-1', refKind: 'invoice', amount: { value: 4000, currency: 'USD' } });
    expect(e?.summary).toBe('Invoice 0042 (USD 4000.00) was paid by Acme');
  });
  it('dispute created', () => {
    const e = toEvent({ id: 'WH-2', event_type: 'CUSTOMER.DISPUTE.CREATED', resource: { dispute_id: 'PP-D-1', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', dispute_amount: { currency_code: 'USD', value: '120.00' } } });
    expect(e).toMatchObject({ type: 'dispute.created', refId: 'PP-D-1', refKind: 'dispute' });
    expect(e?.summary).toContain('not received');
  });
  it('payout item failed', () => {
    const e = toEvent({ id: 'WH-3', event_type: 'PAYMENT.PAYOUTS-ITEM.UNCLAIMED', resource: { payout_batch_id: 'B1', payout_item: { receiver: 'sam@example.com', amount: { currency: 'USD', value: '50.00' } } } });
    expect(e).toMatchObject({ type: 'payout.failed', refKind: 'payout', refId: 'B1' });
    expect(e?.summary).toBe('Payment of USD 50.00 to sam@example.com unclaimed');
  });
  it('payout item failure carries the proposal id and the reason', () => {
    const e = toEvent({ id: 'WH-5', event_type: 'PAYMENT.PAYOUTS-ITEM.FAILED', resource: { payout_batch_id: 'B1', errors: { message: 'Receiver is unregistered' }, payout_item: { sender_item_id: 'ap_0123456789ab-1', receiver: 'x@example.com', amount: { currency: 'USD', value: '5.00' } } } });
    expect(e).toMatchObject({ type: 'payout.failed', payoutKey: 'ap_0123456789ab', reason: 'failed: Receiver is unregistered' });
  });
  it('unknown events are kept but not alerted on; garbage is dropped', () => {
    expect(toEvent({ id: 'WH-4', event_type: 'BILLING.PLAN.CREATED', resource: {} })?.type).toBe('other');
    expect(toEvent({ nope: true })).toBeNull();
    expect(toEvent(null)).toBeNull();
  });
});

describe('dispute evidence', () => {
  it('builds the provide-evidence input: tracking as proof of fulfillment, else a note', () => {
    expect(evidenceInput({ kind: 'fulfillment', carrier: 'FedEx', trackingNumber: ' 1Z999 ', notes: 'Delivered 3 Nov' })).toEqual({
      evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', evidence_info: { tracking_info: [{ carrier_name: 'FEDEX', tracking_number: '1Z999' }] }, notes: 'Delivered 3 Nov' }],
    });
    expect(evidenceInput({ kind: 'other', notes: 'Signed contract attached to the thread.' })).toEqual({ evidences: [{ evidence_type: 'OTHER', notes: 'Signed contract attached to the thread.' }] });
  });
  it('names unknown carriers as OTHER', () => {
    expect(carrierFor('ups')).toEqual({ carrier_name: 'UPS' });
    expect(carrierFor('Royal Mail')).toEqual({ carrier_name: 'OTHER', carrier_name_other: 'Royal Mail' });
  });
  it('maps evidence already sent', () => {
    const d = toDispute({ dispute_id: 'PP-D-1', evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', date: '2026-11-01T00:00:00Z', evidence_info: { tracking_info: [{ carrier_name: 'OTHER', carrier_name_other: 'Royal Mail', tracking_number: 'RM1' }] } }] });
    expect(d.evidence).toEqual([{ type: 'PROOF_OF_FULFILLMENT', notes: undefined, at: '2026-11-01T00:00:00Z', tracking: [{ carrier: 'Royal Mail', number: 'RM1' }] }]);
  });
});

describe('toPayoutBatch', () => {
  it('maps the batch and its items', () => {
    const b = toPayoutBatch({ batch_header: { payout_batch_id: 'B1', batch_status: 'SUCCESS' }, items: [{ payout_item_id: 'I1', transaction_status: 'UNCLAIMED', payout_item: { amount: { currency: 'USD', value: '40.00' }, receiver: 'sam@x.test' } }] });
    expect(b).toEqual({ id: 'B1', status: 'success', items: [{ id: 'I1', status: 'unclaimed', amount: { value: 40, currency: 'USD' }, recipient: 'sam@x.test', error: undefined }] });
  });
});
