import { describe, expect, it } from 'vitest';
import { Approvals, PROPOSAL_TTL_MS, confirm, decideTransition, needsApproval, releaseWaiting, runOrHold, type Proposal } from '../src/approvals';
import type { PaymentProvider } from '../src/providers/types';
import { fakeD1 } from './helpers/d1';

const base: Proposal = { id: 'ap_1', kind: 'payout', description: 'Pay USD 500.00 to sam@example.com', amount: 500, currency: 'USD', input: {}, status: 'pending', createdAt: 1_000 };

describe('needsApproval', () => {
  it('holds anything strictly over the threshold', () => {
    const usd = (value: number) => ({ value, currency: 'USD' });
    expect(needsApproval(usd(100), 100, 'USD')).toBe(false);
    expect(needsApproval(usd(100.01), 100, 'USD')).toBe(true);
    expect(needsApproval(usd(5), 0, 'USD')).toBe(true);
  });
  it('holds any amount in a currency other than the threshold\'s', () => {
    expect(needsApproval({ value: 5, currency: 'JPY' }, 100, 'USD')).toBe(true);
    expect(needsApproval({ value: 5, currency: 'usd' }, 100, 'USD')).toBe(false);
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

// A rail that only counts: enough to see how many times money would have moved.
function countingProvider() {
  const calls = { payout: 0 };
  const provider = {
    name: 'fake',
    async payout({ amount, recipientEmail }: { amount: { value: number; currency: string }; recipientEmail: string }) {
      calls.payout++;
      await Promise.resolve();
      return { id: `PB-${calls.payout}`, status: 'pending', amount, recipient: recipientEmail };
    },
  } as unknown as PaymentProvider;
  return { provider, calls };
}

describe('confirm (against SQLite)', () => {
  const setup = () => {
    const approvals = new Approvals(fakeD1(), 't_1');
    return { approvals, ...countingProvider() };
  };
  const held = (a: Approvals) => a.create('payout', 'Pay USD 500.00 to sam@example.com', { value: 500, currency: 'USD' }, { recipientEmail: 'sam@example.com', note: 'x' });

  it('runs a pending proposal once and records the approver', async () => {
    const { approvals, provider, calls } = setup();
    const p = await held(approvals);
    const out = await confirm({ approvals, provider }, p.id, 'Alex');
    expect(out?.status).toBe('done');
    expect(calls.payout).toBe(1);
    const saved = await approvals.get(p.id);
    expect(saved?.status).toBe('done');
    expect(saved?.approvedBy).toBe('Alex');
  });

  it('is a no-op on a proposal that already ran', async () => {
    const { approvals, provider, calls } = setup();
    const p = await held(approvals);
    await confirm({ approvals, provider }, p.id, 'Alex');
    const again = await confirm({ approvals, provider }, p.id, 'Sam');
    expect(again?.status).toBe('unchanged');
    expect(again?.proposal.status).toBe('done');
    expect(again?.result).toMatch(/already ran/);
    expect(calls.payout).toBe(1);
    expect((await approvals.get(p.id))?.approvedBy).toBe('Alex');
  });

  it('runs two concurrent yeses exactly once', async () => {
    const { approvals, provider, calls } = setup();
    const p = await held(approvals);
    const outs = await Promise.all([confirm({ approvals, provider }, p.id, 'Alex'), confirm({ approvals, provider }, p.id, 'Sam')]);
    expect(calls.payout).toBe(1);
    expect(outs.map((o) => o?.status).sort()).toEqual(['done', 'unchanged']);
  });

  it('cannot reject what is already running or done', async () => {
    const { approvals, provider } = setup();
    const p = await held(approvals);
    await confirm({ approvals, provider }, p.id, 'Alex');
    expect((await approvals.decide(p.id, false, 'Sam'))?.status).toBe('done');
  });

  it('expires instead of running a stale one', async () => {
    const { approvals, provider, calls } = setup();
    const p = await held(approvals);
    const out = await approvals.claim(p.id, 'Alex', p.createdAt + PROPOSAL_TTL_MS + 1);
    expect(out).toBeNull();
    expect(calls.payout).toBe(0);
    void provider;
  });

  it('pay-when-paid: waits, then a release under the threshold pays once', async () => {
    const { approvals, provider, calls } = setup();
    const p = await approvals.create('payout', 'Pay later', { value: 50, currency: 'USD' }, { recipientEmail: 'sam@example.com' }, 'INV2-1');
    expect((await confirm({ approvals, provider }, p.id, 'Alex'))?.status).toBe('unchanged');
    const deps = { approvals, provider, threshold: 100, currency: 'USD' };
    const [first, second] = await Promise.all([releaseWaiting(deps, 'INV2-1'), releaseWaiting(deps, 'INV2-1')]);
    expect([...first, ...second].map((o) => o.status)).toEqual(['done']);
    expect(calls.payout).toBe(1);
  });

  it('pay-when-paid: a release over the threshold asks, then a yes pays', async () => {
    const { approvals, provider, calls } = setup();
    const p = await approvals.create('payout', 'Pay later', { value: 500, currency: 'USD' }, { recipientEmail: 'sam@example.com' }, 'INV2-1');
    const [o] = await releaseWaiting({ approvals, provider, threshold: 100, currency: 'USD' }, 'INV2-1');
    expect(o.status).toBe('needs_approval');
    expect((await confirm({ approvals, provider }, p.id, 'Alex'))?.status).toBe('done');
    expect(calls.payout).toBe(1);
  });
});

describe('runOrHold', () => {
  it('runs a small same-currency action, holds a small foreign-currency one', async () => {
    const approvals = new Approvals(fakeD1(), 't_1');
    const { provider, calls } = countingProvider();
    const deps = { approvals, provider, threshold: 100, currency: 'USD' };
    const small = await runOrHold(deps, 'payout', 'Pay 50', { value: 50, currency: 'USD' }, { recipientEmail: 'a@example.com' });
    expect(small.status).toBe('done');
    const foreign = await runOrHold(deps, 'payout', 'Pay 50 EUR', { value: 50, currency: 'EUR' }, { recipientEmail: 'a@example.com' });
    expect(foreign.status).toBe('needs_approval');
    expect(calls.payout).toBe(1);
  });
});
