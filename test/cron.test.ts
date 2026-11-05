import { describe, expect, it, vi } from 'vitest';
import { Approvals } from '../src/approvals';
import { deadlineAlerts, pollWaiting, watchDeadlines } from '../src/cron';
import type { Env } from '../src/env';
import { RailError, type Dispute, type Invoice, type PaymentProvider } from '../src/providers/types';
import { fakeD1 } from './helpers/d1';

const rail = vi.hoisted(() => ({ seen: [] as string[] }));
vi.mock('../src/providers', () => ({
  providerFor: async (_env: unknown, _tenants: unknown, t: { id: string }) => {
    rail.seen.push(t.id);
    return { listInvoices: async () => [], listDisputes: async () => [] };
  },
}));

const now = Date.UTC(2026, 10, 20, 12);
const inv = (id: string, dueDate: string, status: Invoice['status'] = 'sent'): Invoice => ({
  id,
  number: id,
  status,
  customer: { name: 'Acme', email: 'ap@acme.test' },
  total: { value: 100, currency: 'USD' },
  due: { value: 100, currency: 'USD' },
  dueDate,
  items: [],
  paymentIds: [],
});
const dispute = (id: string, respondBy: string, status = 'WAITING_FOR_SELLER_RESPONSE'): Dispute => ({ id, reason: 'X', status, state: 'OPEN', amount: { value: 40, currency: 'USD' }, respondBy, messages: [], evidence: [] });

describe('deadlineAlerts', () => {
  it('flags invoices a week or more overdue, once a week', () => {
    const a = deadlineAlerts([inv('A', '2026-11-13'), inv('B', '2026-11-15'), inv('C', '2026-11-01', 'paid')], [], now);
    expect(a.map((x) => x.key)).toEqual(['overdue:A']);
    expect(a[0].title).toBe('Invoice A (Acme) is 7 days overdue');
    expect(a[0].since).toBe(now - 7 * 86_400_000);
  });
  it('flags disputes due within 48 hours, keyed by deadline', () => {
    const a = deadlineAlerts([], [dispute('D1', '2026-11-21T12:00:00Z'), dispute('D2', '2026-11-25T12:00:00Z'), dispute('D3', '2026-11-19T12:00:00Z'), dispute('D4', '2026-11-21T00:00:00Z', 'RESOLVED')], now);
    expect(a.map((x) => x.key)).toEqual(['respond-by:D1:2026-11-21T12:00:00Z']);
    expect(a[0].title).toMatch(/within 24 hours/);
  });
});

describe('pollWaiting', () => {
  it('calls off a payout whose invoice PayPal no longer has', async () => {
    const env = { DB: fakeD1(), PUBLIC_URL: 'https://penny.test', PENNY_MASTER_KEY: '' } as Env;
    await env.DB.prepare("INSERT INTO user (id, email, name) VALUES ('u1', 'o@x.test', 'O')").run();
    await env.DB.prepare(
      "INSERT INTO tenants (id, owner_user_id, business_name, paypal_client_id, paypal_secret_ct, paypal_secret_iv, mcp_token_hash, mcp_token_ct, mcp_token_iv, page_key, created_at) VALUES ('t_1', 'u1', 'Biz', 'APP', 'ct', 'iv', 'h', 'c', 'i', 'pk', 0)",
    ).run();
    const approvals = new Approvals(env.DB, 't_1');
    const p = await approvals.create('payout', 'Pay later', { value: 50, currency: 'USD' }, { recipientEmail: 'sam@example.com' }, 'INV2-GONE');
    const provider = {
      getInvoice: async () => {
        throw new RailError('PayPal GET /v2/invoicing/invoices/INV2-GONE failed (404): RESOURCE_NOT_FOUND', 404);
      },
    } as unknown as PaymentProvider;
    expect(await pollWaiting(env, 10, -1, async () => provider)).toBe(1);
    const off = await approvals.get(p.id);
    expect(off?.status).toBe('rejected');
    expect(off?.result).toMatch(/no longer has the invoice/);
  });
});

describe('watchDeadlines', () => {
  it('pages through every tenant a batch per run, and starts a new pass an hour after the last', async () => {
    const env = { DB: fakeD1(), PUBLIC_URL: 'https://penny.test', PENNY_MASTER_KEY: '' } as Env;
    for (let n = 0; n < 25; n++) {
      await env.DB.prepare('INSERT INTO user (id, email, name) VALUES (?, ?, ?)').bind(`u${n}`, `o${n}@x.test`, 'O').run();
      await env.DB.prepare(
        "INSERT INTO tenants (id, owner_user_id, business_name, paypal_client_id, paypal_secret_ct, paypal_secret_iv, mcp_token_hash, mcp_token_ct, mcp_token_iv, page_key, created_at) VALUES (?, ?, 'B', 'APP', 'ct', 'iv', ?, 'c', 'i', ?, 0)",
      )
        .bind(`t_${String(n).padStart(2, '0')}`, `u${n}`, `h${n}`, `pk${n}`)
        .run();
    }
    rail.seen = [];
    for (const m of [0, 5, 10, 15]) await watchDeadlines(env, now + m * 60_000, 10);
    expect(rail.seen).toHaveLength(25);
    expect(new Set(rail.seen).size).toBe(25);
    await watchDeadlines(env, now + 61 * 60_000, 10);
    expect(rail.seen).toHaveLength(35);
  });
});
