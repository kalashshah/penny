import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import type { Dispute, Invoice } from '@/providers/types';
import { fmtMoney } from '@/providers/types';
import type { MoneySummary } from '@/summary';
import { SignOutButton } from './sign-out-button';

/** `--d` staggers the rise-in animation (app.css). */
export const delay = (d: number) => ({ '--d': `${d}s` }) as CSSProperties;

export function money(v: number, currency: string): string {
  return `${currency} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function when(ms: number | string | null | undefined): string {
  if (!ms) return '';
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? String(ms) : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

const today = () => new Date().toISOString().slice(0, 10);
export const words = (s: string) => s.toLowerCase().replace(/_/g, ' ');
export const isOverdue = (i: Invoice, on: string) => (i.status === 'sent' || i.status === 'partially_paid') && !!i.dueDate && i.dueDate < on;

export function Chip({ status }: { status: string }) {
  const s = status;
  const tone =
    s === 'paid' || s === 'done' || s === 'completed' || s === 'resolved'
      ? 'ok'
      : s === 'cancelled' || s === 'rejected' || s === 'failed' || s === 'expired'
        ? 'bad'
        : s === 'pending' || s === 'waiting' || s === 'sent' || s === 'partially_paid' || s === 'required_action'
          ? 'warn'
          : '';
  return <span className={`chip ${tone}`}>{s.replace(/_/g, ' ')}</span>;
}

export function EnvChip({ connected, env }: { connected: boolean; env: 'sandbox' | 'live' }) {
  if (!connected) return <span className="chip warn">PayPal not connected</span>;
  return (
    <span className={`chip ${env === 'live' ? 'bad' : 'ok'}`}>
      <span className="dot" />
      PayPal {env}
    </span>
  );
}

/** A KPI figure whose digits pop in, the last two a beat late (CSS in app.css). */
export function Digits({ text }: { text: string }) {
  const chars = [...text];
  return (
    <span className="t-digit-group">
      {chars.map((c, i) => {
        const fromEnd = chars.length - 1 - i;
        return (
          <span key={i} className="t-digit" data-stagger={fromEnd === 1 ? '1' : fromEnd === 0 ? '2' : undefined}>
            {c === ' ' ? ' ' : c}
          </span>
        );
      })}
    </span>
  );
}

export function Kpi({ label, value, sub, tone = '', small }: { label: string; value: string; sub?: string; tone?: string; small?: number }) {
  return (
    <div className={`kpi ${tone}`}>
      <div className="l">{label}</div>
      <div className="n" style={small ? { fontSize: small } : undefined}>
        <Digits text={value} />
      </div>
      {sub !== undefined && <div className="s">{sub}</div>}
    </div>
  );
}

export function Logo({ href = '/' }: { href?: string }) {
  return (
    <Link className="logo" href={href}>
      <span className="mk">p</span>Penny
    </Link>
  );
}

function PageLinks({ k }: { k: string }) {
  const q = `?k=${encodeURIComponent(k)}`;
  return (
    <>
      <Link href={`/p/summary${q}`}>Summary</Link>
      <Link href={`/p/invoices${q}`}>Invoices</Link>
      <Link href={`/p/disputes${q}`}>Disputes</Link>
      <Link href={`/p/forecast${q}`}>Forecast</Link>
      <Link href={`/p/transactions${q}`}>Transactions</Link>
      <Link href={`/p/reports${q}`}>Reports</Link>
    </>
  );
}

/** The signed-in owner's nav. */
export function AppNav({ business, k, extra }: { business: string; k: string; extra?: ReactNode }) {
  return (
    <nav className="app">
      <Logo />
      <div className="links">
        <PageLinks k={k} />
        <Link href="/settings">Settings</Link>
      </div>
      <div className="right">
        {extra}
        <span className="small muted">{business}</span>
        <SignOutButton />
      </div>
    </nav>
  );
}

/** Header for the pages Penny screen-shares: no account chrome, just where you are. */
export function ShareHead({ title, k, right }: { title: ReactNode; k: string; right?: ReactNode }) {
  return (
    <>
      <nav className="app">
        {/* "/" is the landing page without a session (Penny's browser), so home here is the summary page. */}
        <Logo href={`/p/summary?k=${encodeURIComponent(k)}`} />
        <div className="links">
          <PageLinks k={k} />
        </div>
        <div className="right">{right}</div>
      </nav>
      <div className="head rise">
        <h1>{title}</h1>
        <span className="small muted">{when(Date.now())}</span>
      </div>
    </>
  );
}

export function MoneyTiles({ s }: { s: MoneySummary }) {
  return (
    <div className="kpis rise" style={delay(0.05)}>
      <Kpi tone="ok" label="Collected this month" value={money(s.collectedThisMonth, s.currency)} sub={`${s.collectedCount} paid`} />
      <Kpi label="Outstanding" value={money(s.outstanding, s.currency)} sub={`${s.outstandingCount} open`} />
      <Kpi tone={s.overdueCount ? 'warn' : ''} label="Overdue" value={money(s.overdue, s.currency)} sub={`${s.overdueCount} invoice${s.overdueCount === 1 ? '' : 's'}`} />
      <Kpi tone={s.openDisputes.length ? 'bad' : ''} label="Open disputes" value={String(s.openDisputes.length)} sub={`${money(s.disputedAmount, s.currency)} at risk`} />
    </div>
  );
}

export function InvoiceTable({ list, k }: { list: Invoice[]; k: string }) {
  if (!list.length) return <p className="empty">None.</p>;
  const on = today();
  return (
    <table>
      <thead>
        <tr>
          <th>Invoice</th>
          <th>Customer</th>
          <th>Due date</th>
          <th className="r">Total</th>
          <th className="r">Still due</th>
          <th className="r">Status</th>
        </tr>
      </thead>
      <tbody>
        {list.map((i) => (
          <tr key={i.id}>
            <td>
              <Link href={`/p/invoice/${encodeURIComponent(i.id)}?k=${encodeURIComponent(k)}`}>{i.number}</Link>
            </td>
            <td>{i.customer.name || i.customer.email}</td>
            <td>{i.dueDate ?? ''}</td>
            <td className="r">{fmtMoney(i.total)}</td>
            <td className="r">{fmtMoney(i.due)}</td>
            <td className="r">{isOverdue(i, on) ? <span className="chip bad">overdue</span> : <Chip status={i.status} />}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DisputeTable({ list, k }: { list: Dispute[]; k: string }) {
  if (!list.length) return <p className="empty">None.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Dispute</th>
          <th>Reason</th>
          <th>Respond by</th>
          <th className="r">Amount</th>
          <th className="r">State</th>
        </tr>
      </thead>
      <tbody>
        {list.map((d) => (
          <tr key={d.id}>
            <td>
              <Link href={`/p/dispute/${encodeURIComponent(d.id)}?k=${encodeURIComponent(k)}`}>{d.id}</Link>
            </td>
            <td>{words(d.reason)}</td>
            <td>{when(d.respondBy)}</td>
            <td className="r">{fmtMoney(d.amount)}</td>
            <td className="r">
              <Chip status={d.state.toLowerCase()} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Card({ title, right, d, children, style }: { title?: ReactNode; right?: ReactNode; d?: number; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="card rise" style={{ ...(d ? delay(d) : {}), ...style }}>
      {(title || right) && (
        <div className="cardhead">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

/** Full-page message: errors, not found. */
export function MessagePage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="wrap">
      <div className="auth rise">
        <Logo />
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function ErrorPage({ message }: { message: string }) {
  return (
    <MessagePage title="Something went wrong">
      <div className="card">
        <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 13.5 }}>{message}</pre>
      </div>
      <Link className="btn" href="/">
        Back
      </Link>
    </MessagePage>
  );
}
