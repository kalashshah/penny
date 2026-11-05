import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { handleWebhook } from '../src/events';
import type { Memory } from '../src/memory';
import { toEvent } from '../src/providers/paypal';
import type { PaymentProvider } from '../src/providers/types';
import type { Tenant } from '../src/tenants';
import { fakeD1 } from './helpers/d1';

const tenant = { id: 't_1', pageKey: 'pk', approvalThreshold: 100, currency: 'USD' } as Tenant;
const memory = { remember: async () => '' } as unknown as Memory;
const ctx = { waitUntil: () => {} };

export function webhookRig() {
  const env = { DB: fakeD1(), PUBLIC_URL: 'https://penny.test', WEBHOOK_VERIFY: 'off' } as Env;
  const calls = { payout: 0 };
  const provider = {
    name: 'paypal',
    parseEvent: toEvent,
    async payout({ amount, recipientEmail }: { amount: { value: number; currency: string }; recipientEmail: string }) {
      calls.payout++;
      return { id: 'PB-1', status: 'pending', amount, recipient: recipientEmail };
    },
  } as unknown as PaymentProvider;
  const deliver = async (body: unknown) => (await handleWebhook(env, tenant, provider, memory, new Request('https://penny.test/webhooks/paypal/t_1', { method: 'POST', body: JSON.stringify(body) }), ctx)).json() as Promise<Record<string, unknown>>;
  const alerts = async () => (await env.DB.prepare('SELECT * FROM alerts WHERE tenant_id = ?').bind(tenant.id).all<{ title: string; detail: string }>()).results;
  return { env, provider, calls, deliver, alerts, tenant };
}

const paid = { id: 'WH-1', event_type: 'INVOICING.INVOICE.PAID', resource: { invoice: { id: 'INV2-1', detail: { invoice_number: '0042' }, amount: { currency_code: 'USD', value: '1000.00' } } } };

describe('handleWebhook', () => {
  it('alerts once and treats a processed redelivery as a duplicate', async () => {
    const { deliver, alerts } = webhookRig();
    expect((await deliver(paid)).alert).toBeTruthy();
    expect((await deliver(paid)).duplicate).toBe(true);
    expect(await alerts()).toHaveLength(1);
  });

  it('reprocesses a redelivery of an event that failed halfway', async () => {
    const { env, deliver, alerts } = webhookRig();
    // As if an earlier delivery stored the event and then died before acting on it.
    await env.DB.prepare("INSERT INTO events (id, tenant_id, provider, type, summary, payload, received_at) VALUES ('t_1:WH-1', 't_1', 'paypal', 'invoice.paid', 's', '{}', 0)").run();
    const r = await deliver(paid);
    expect(r.duplicate).toBeUndefined();
    expect(await alerts()).toHaveLength(1);
    expect((await deliver(paid)).duplicate).toBe(true);
  });
});
