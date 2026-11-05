'use client';

import { useActionState, type InputHTMLAttributes } from 'react';
import { Card, delay, when } from '@/components/ui';
import { updateSettings, type SettingsResult } from './actions';

export interface SettingsView {
  business: string;
  currency: string;
  threshold: number;
  paypalEnv: 'sandbox' | 'live';
  /** Only the first characters reach the browser. */
  clientIdPrefix: string | null;
  connectedAt: number | null;
  webhookOn: boolean;
  memoryOn: boolean;
  tenantId: string;
  publicUrl: string;
}

function Field({ name, label, ...input }: { name: string; label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="fld">
      <label className="f" htmlFor={name}>
        {label}
      </label>
      <input className="f" id={name} name={name} {...input} />
    </div>
  );
}

export function SettingsForms({ v }: { v: SettingsView }) {
  const [state, action, pending] = useActionState<SettingsResult | null, FormData>(updateSettings, null);
  const connected = Boolean(v.clientIdPrefix);
  return (
    <>
      {state?.notes?.length ? (
        <div className="note rise" role="status">
          {state.notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      ) : null}
      {state?.error && (
        <div className="note err rise" role="alert">
          {state.error}
        </div>
      )}

      <Card
        title="PayPal"
        right={
          connected ? (
            <span className={`chip ${v.paypalEnv === 'live' ? 'bad' : 'ok'}`}>
              <span className="dot" />
              {v.paypalEnv} · connected
            </span>
          ) : (
            <span className="chip warn">not connected</span>
          )
        }
        d={0.05}
      >
        {connected && (
          <>
            <p className="sub" style={{ margin: '0 0 12px' }}>
              App <code>{v.clientIdPrefix}…</code> connected {when(v.connectedAt)}. Webhook{' '}
              {v.webhookOn ? 'registered.' : 'not registered: deploy Penny on https, then reconnect.'}
            </p>
            <form
              action={action}
              onSubmit={(e) => {
                if (!confirm('Disconnect PayPal? Penny will stop seeing your account until you reconnect.')) e.preventDefault();
              }}
            >
              <input type="hidden" name="intent" value="disconnect" />
              <button className="btn sm danger" disabled={pending}>
                Disconnect
              </button>
            </form>
            <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '18px 0' }} />
          </>
        )}
        <form action={action}>
          <input type="hidden" name="intent" value="connect" />
          <p className="sub" style={{ margin: 0 }}>
            Create a REST app at{' '}
            <a href="https://developer.paypal.com/dashboard/applications/sandbox" target="_blank" rel="noopener">
              developer.paypal.com
            </a>{' '}
            with Invoicing, Payouts, Transaction Search and Disputes enabled, then paste its credentials. Sandbox to try, Live for real money.
          </p>
          <div className="fld">
            <label className="f" htmlFor="env">
              Environment
            </label>
            <select className="f" id="env" name="env" style={{ maxWidth: 240 }} defaultValue={v.paypalEnv}>
              <option value="sandbox">Sandbox</option>
              <option value="live">Live</option>
            </select>
          </div>
          <div className="grid2">
            <Field name="client_id" label="Client ID" required autoComplete="off" />
            <Field name="client_secret" label="Secret" type="password" required autoComplete="off" />
          </div>
          <button className="btn dark" style={{ marginTop: 18 }} disabled={pending}>
            {connected ? 'Reconnect' : 'Connect PayPal'}
          </button>
        </form>
      </Card>

      <Card title="Business" d={0.1}>
        {/* `key` remounts the inputs with the saved values after each save. */}
        <form action={action} key={`${v.business}|${v.currency}|${v.threshold}`}>
          <input type="hidden" name="intent" value="save" />
          <Field name="business_name" label="Business name (appears on invoices)" defaultValue={v.business} required />
          <div className="grid2">
            <Field name="currency" label="Currency" defaultValue={v.currency} maxLength={3} />
            <Field name="threshold" label="Approval threshold (money out above this needs a yes)" defaultValue={String(v.threshold)} type="number" min="0" step="0.01" />
          </div>
          <button className="btn dark" style={{ marginTop: 18 }} disabled={pending}>
            Save
          </button>
        </form>
      </Card>

      <Card title="Memory" right={v.memoryOn ? <span className="chip ok"><span className="dot" />on</span> : <span className="chip warn">off</span>} d={0.15}>
        <p className="sub" style={{ margin: 0 }}>
          {v.memoryOn
            ? 'Penny remembers decisions, vendor terms and call transcripts for your business in MemoryHQ, kept private to you.'
            : 'This deployment has no MemoryHQ workspace and key, so memory is off.'}
        </p>
      </Card>

      <div className="card rise" style={delay(0.2)}>
        <div className="cardhead">
          <h2>For the curious</h2>
        </div>
        <p className="sub small" style={{ margin: 0 }}>
          Webhook URL{' '}
          <code>
            {v.publicUrl}/webhooks/paypal/{v.tenantId}
          </code>
          <br />
          Penny&apos;s tools for your calls are served from <code>{v.publicUrl}/mcp</code> with a token only your calls carry.
        </p>
      </div>
    </>
  );
}
