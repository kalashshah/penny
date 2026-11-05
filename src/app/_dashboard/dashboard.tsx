import Link from 'next/link';
import type { CSSProperties } from 'react';
import { Approvals, expiresAt } from '@/approvals';
import { listCalls } from '@/calls';
import { errorMessage, getEnv, providerOf, type Owner } from '@/context';
import { DecideButtons, DismissButton } from '@/components/decide-buttons';
import { AppNav, Card, Chip, EnvChip, InvoiceTable, MoneyTiles, when } from '@/components/ui';
import { listAlerts } from '@/events';
import { Memory } from '@/memory';
import { fetchSummary, type MoneySummary } from '@/summary';
import { isConnected } from '@/tenants';
import { CallButton, CallFrame, CallProvider, StatePoller, TakeCallButton } from './call';

const order = (i: number) => ({ '--i': i }) as CSSProperties;

export async function Dashboard({ owner, openAlert }: { owner: Owner; openAlert?: string }) {
  const env = getEnv();
  const { tenant: t, user } = owner;
  const connected = isConnected(t);
  const approvals = new Approvals(env.DB, t.id);
  const loadSummary = async (): Promise<{ summary: MoneySummary | null; error?: string }> => {
    if (!connected) return { summary: null };
    try {
      return { summary: await fetchSummary(await providerOf(t), t.currency) };
    } catch (e) {
      return { summary: null, error: errorMessage(e) };
    }
  };
  const [{ summary, error }, alerts, pending, recent, calls] = await Promise.all([
    loadSummary(),
    listAlerts(env, t.id),
    approvals.listPending(),
    approvals.listRecent(8),
    listCalls(env, t.id, 5),
  ]);
  const k = t.pageKey;
  const q = `?k=${encodeURIComponent(k)}`;

  return (
    <CallProvider openAlert={openAlert}>
      <StatePoller alerts={alerts.length} pending={pending.length} />
      <AppNav business={t.businessName} k={k} extra={<EnvChip connected={connected} env={t.paypalEnv} />} />
      <div className="head rise">
        <div>
          <h1>{t.businessName}</h1>
          <p className="sub">
            {connected
              ? `Penny can see your ${t.paypalEnv} account${new Memory(getEnv(), t.id).enabled ? ' and remembers past calls' : ''}. Nothing leaves it above your limit without your yes.`
              : 'Connect your PayPal app and Penny can start.'}
          </p>
        </div>
        <CallButton connected={connected} />
      </div>

      {!connected && (
        <Card title="Connect PayPal to get started" d={0.05} style={{ borderColor: 'var(--ink)' }}>
          <p className="sub" style={{ margin: '0 0 14px' }}>
            Penny needs your PayPal app&apos;s client id and secret, sandbox or live, to see invoices, disputes and payouts. Two minutes. Just looking? Settings has a one-click demo sandbox.
          </p>
          <Link className="btn dark" href="/settings">
            Open settings
          </Link>
        </Card>
      )}

      <CallFrame />

      {alerts.length > 0 && (
        <Card title="Penny wants a word" right={<span className="small muted">{alerts.length} new</span>} d={0.08}>
          {alerts.map((a, i) => (
            <div className="alertbar t-toast" key={a.id} style={order(i)}>
              <div>
                <b>{a.title}</b>
                <span className="small muted">
                  {a.detail} · {when(a.created_at)}
                </span>
              </div>
              <span className="a">
                <TakeCallButton alertId={a.id} />
                {a.page && (
                  <a className="btn sm" href={a.page}>
                    Open
                  </a>
                )}
                <DismissButton id={a.id} />
              </span>
            </div>
          ))}
        </Card>
      )}

      {pending.length > 0 && (
        <Card title="Waiting for your yes" right={<span className="small muted">unanswered ones expire</span>} d={0.1}>
          {pending.map((p, i) => (
            <div className="alertbar hold t-toast" key={p.id} style={order(alerts.length + i)}>
              <div>
                <b>{p.description}</b>
                <span className="small muted">
                  Proposed {when(p.createdAt)} · expires {when(expiresAt(p))}
                </span>
              </div>
              <span className="a">
                <DecideButtons id={p.id} />
              </span>
            </div>
          ))}
        </Card>
      )}

      {summary ? (
        <>
          <MoneyTiles s={summary} />
          <Card
            title="Overdue invoices"
            right={
              <Link className="btn sm" href={`/p/invoices${q}`}>
                All invoices
              </Link>
            }
            d={0.12}
          >
            <InvoiceTable list={summary.overdueInvoices} k={k} />
          </Card>
        </>
      ) : (
        connected && (
          <Card title="Account">
            <p className="empty">Could not load the account: {error ?? 'unknown error'}</p>
          </Card>
        )
      )}

      <Card title="Money-out actions" d={0.16}>
        {recent.length ? (
          <table>
            <thead>
              <tr>
                <th>What</th>
                <th>By</th>
                <th>When</th>
                <th className="r">Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/p/proposal/${encodeURIComponent(p.id)}${q}`}>{p.description}</Link>
                    {p.result && <div className="small muted">{p.result}</div>}
                  </td>
                  <td>{p.approvedBy ?? ''}</td>
                  <td>{when(p.createdAt)}</td>
                  <td className="r">
                    <Chip status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty">Nothing yet. Ask Penny to pay someone.</p>
        )}
      </Card>

      <Card title="Calls" d={0.2}>
        {calls.length ? (
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Why</th>
                <th>Ended</th>
                <th className="r">Memory</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.room}>
                  <td>{when(c.started_at)}</td>
                  <td>{c.reason ?? ''}</td>
                  <td>{when(c.ended_at)}</td>
                  <td className="r">{c.ingested ? <span className="chip ok">filed</span> : <span className="chip">pending</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty">No calls yet.</p>
        )}
      </Card>
      <p className="small muted">
        Signed in as {user.email}. Anything over your threshold waits for a spoken yes on the call or a click here. Penny never confirms a payment nobody approved.
      </p>
    </CallProvider>
  );
}
