import { describe, expect, it } from 'vitest';
import { PROPOSAL_TTL_MS, decideTransition, needsApproval, type Proposal } from '../src/approvals';

const base: Proposal = { id: 'ap_1', kind: 'payout', description: 'Pay USD 500.00 to sam@example.com', amount: 500, currency: 'USD', input: {}, status: 'pending', createdAt: 1_000 };

describe('needsApproval', () => {
  it('holds anything strictly over the threshold', () => {
    expect(needsApproval(100, 100)).toBe(false);
    expect(needsApproval(100.01, 100)).toBe(true);
    expect(needsApproval(5, 0)).toBe(true);
  });
});

describe('decideTransition', () => {
  it('approves a fresh pending proposal and records who', () => {
    const next = decideTransition(base, true, 'Alex', 2_000);
    expect(next.status).toBe('approved');
    expect(next.approvedBy).toBe('Alex');
    expect(next.decidedAt).toBe(2_000);
  });
  it('rejects', () => {
    expect(decideTransition(base, false, undefined, 2_000).status).toBe('rejected');
  });
  it('expires instead of approving a stale one', () => {
    const next = decideTransition(base, true, 'Alex', base.createdAt + PROPOSAL_TTL_MS + 1);
    expect(next.status).toBe('expired');
    expect(next.approvedBy).toBeUndefined();
  });
  it('lets a waiting one be called off but not approved early', () => {
    const waiting: Proposal = { ...base, status: 'waiting', afterInvoice: 'INV2-1' };
    expect(decideTransition(waiting, true, 'Alex', 2_000)).toBe(waiting);
    expect(decideTransition(waiting, false, undefined, 2_000).status).toBe('rejected');
  });
  it('gives a released pay-when-paid a day, not 30 minutes', () => {
    const released: Proposal = { ...base, afterInvoice: 'INV2-1' };
    expect(decideTransition(released, true, 'Alex', base.createdAt + PROPOSAL_TTL_MS + 1).status).toBe('approved');
  });
  it('never re-decides a settled proposal', () => {
    for (const status of ['approved', 'rejected', 'expired', 'done', 'failed'] as const) {
      expect(decideTransition({ ...base, status }, true, 'Alex', 2_000).status).toBe(status);
    }
  });
});
