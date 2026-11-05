import { describe, expect, it, vi } from 'vitest';
import { buildDigest, digestDue, sendDigests, weekOf } from '../src/digest';
import type { Env } from '../src/env';
import type { Invoice, PaymentProvider } from '../src/providers/types';
import { fakeD1 } from './helpers/d1';

const rail = vi.hoisted(() => ({ provider: null as unknown, fail: false }));
vi.mock('../src/providers', () => ({
  providerFor: async () => {
    if (rail.fail) throw new Error('PayPal is down');
    return rail.provider;
  },
}));

const now = Date.UTC(2026, 10, 9, 15); // Monday 9 Nov 2026, 15:00 UTC
const inv = (id: string, over: Partial<Invoice>): Invoice => ({
  id,
  number: id,
  status: 'sent',
  customer: { name: 'Acme', email: 'ap@acme.test' },
  total: { value: 100, currency: 'USD' },
  due: { value: 100, currency: 'USD' },
  items: [],
  paymentIds: [],
  ...over,
});

describe('weekOf and digestDue', () => {
  it('keys the week by its Monday and sends from Monday 14:00 UTC', () => {
    expect(weekOf(now)).toBe('2026-11-09');
    expect(weekOf(Date.UTC(2026, 10, 15, 23))).toBe('2026-11-09'); // Sunday
    expect(digestDue(Date.UTC(2026, 10, 9, 13, 59))).toBe(false);
    expect(digestDue(now)).toBe(true);
    expect(digestDue(Date.UTC(2026, 10, 12))).toBe(true); // Thursday: a missed Monday still goes out
  });
});

describe('buildDigest', () => {
  it('says the week in a few lines', () => {
    const d = buildDigest({
      business: 'Studio',
      currency: 'USD',
      now,
      paid: [
        inv('P1', { status: 'paid', total: { value: 4000, currency: 'USD' }, paidAt: '2026-11-05T10:00:00Z' }),
        inv('P2', { status: 'paid', total: { value: 999, currency: 'USD' }, paidAt: '2026-10-20T10:00:00Z' }),
      ],
      open: [inv('O1', { dueDate: '2026-11-01', due: { value: 1200, currency: 'USD' } }), inv('O2', { dueDate: '2026-12-01' })],
      pending: [{ amount: 400, currency: 'USD' }],
      waitingCount: 2,
      low: { date: '2026-11-12', balance: -150 },
    });
    expect(d.subject).toBe('Studio: your week with Penny (USD 4,000.00 collected, 1 overdue)');
    expect(d.lines).toEqual([
      'Collected in the last 7 days: USD 4,000.00 from 1 invoice.',
      'Outstanding: USD 1,300.00 on 2 open invoices, 1 overdue (USD 1,200.00).',
      'Waiting for your yes: 1 payment (USD 400.00).',
      'Pay-when-paid: 2 payouts waiting for a customer to pay.',
      'Lowest cash point in the next 14 days: USD -150.00 on 2026-11-12 (below zero).',
    ]);
  });
  it('a quiet week', () => {
    const d = buildDigest({ business: 'Studio', currency: 'USD', now, paid: [], open: [], pending: [], waitingCount: 0 });
    expect(d.subject).toBe('Studio: your week with Penny (nothing collected)');
    expect(d.lines).toEqual(['Nothing was collected in the last 7 days.', 'No open invoices.', 'Nothing is waiting for your yes.']);
  });
});

describe('sendDigests', () => {
  function rig(email?: boolean) {
    const sent: { to: string; subject: string }[] = [];
    const env = {
      DB: fakeD1(),
      PUBLIC_URL: 'https://penny.test',
      PENNY_MASTER_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      ...(email ? { EMAIL: { send: async (m: { to: string; subject: string }) => void sent.push(m) } } : {}),
    } as unknown as Env;
    rail.fail = false;
    rail.provider = {
      listInvoices: async ({ status }: { status: string }) => (status === 'open' ? [inv('O1', { dueDate: '2026-11-01' })] : []),
      listDisputes: async () => [],
      listTransactions: async () => [],
      getBalance: async () => null,
    } as unknown as PaymentProvider;
    const seed = async () => {
      await env.DB.prepare("INSERT INTO user (id, email, name) VALUES ('u1', 'owner@studio.test', 'Owner')").run();
      await env.DB.prepare(
        "INSERT INTO tenants (id, owner_user_id, business_name, paypal_client_id, paypal_secret_ct, paypal_secret_iv, mcp_token_hash, mcp_token_ct, mcp_token_iv, page_key, created_at) VALUES ('t_1', 'u1', 'Studio', 'cid', 'ct', 'iv', 'h', 'c', 'i', 'pk', 0)",
      ).run();
    };
    const alerts = async () => (await env.DB.prepare('SELECT * FROM alerts').all<{ title: string; event_id: string }>()).results;
    return { env, sent, seed, alerts };
  }

  it('emails the owner once a week when email is configured', async () => {
    const { env, sent, seed, alerts } = rig(true);
    await seed();
    expect(await sendDigests(env, now)).toBe(1);
    expect(await sendDigests(env, now + 3_600_000)).toBe(0);
    expect(sent).toEqual([expect.objectContaining({ to: 'owner@studio.test', subject: 'Studio: your week with Penny (nothing collected, 1 overdue)' })]);
    expect(await alerts()).toHaveLength(0);
  });

  it('posts an alert without email, and retries a week that failed', async () => {
    const { env, seed, alerts } = rig(false);
    await seed();
    rail.fail = true;
    expect(await sendDigests(env, now)).toBe(0);
    rail.fail = false;
    expect(await sendDigests(env, now + 3_600_000)).toBe(1);
    expect((await alerts()).map((a) => a.event_id)).toEqual(['digest:2026-11-09']);
  });

  it('waits for Monday afternoon', async () => {
    const { env, seed } = rig(true);
    await seed();
    expect(await sendDigests(env, Date.UTC(2026, 10, 9, 10))).toBe(0);
  });
});
