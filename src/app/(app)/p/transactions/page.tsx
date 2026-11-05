import type { Metadata } from 'next';
import Link from 'next/link';
import { attempt, param, providerOf, requirePageTenant, type SearchParams } from '@/context';
import { delay, ErrorPage, Kpi, money, ShareHead } from '@/components/ui';
import { TransactionsGrid, type TxRow } from './grid';

export const metadata: Metadata = { title: 'Transactions · Penny' };

export default async function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await searchParams;
  const t = await requirePageTenant(q.k, '/p/transactions');
  const days = Math.min(31, Math.max(1, Number(param(q.days)) || 30));
  const to = new Date();
  const r = await attempt(async () => (await providerOf(t)).listTransactions(new Date(to.getTime() - days * 86_400_000), to));
  if (!r.ok) return <ErrorPage message={r.error} />;
  const list = r.value;
  const rows: TxRow[] = list.map((x) => ({
    date: x.date.slice(0, 10),
    who: x.counterparty ?? '',
    note: x.note ?? '',
    amount: x.amount.value,
    currency: x.amount.currency,
    fee: x.fee?.value ?? null,
    status: x.status,
    id: x.id,
    invoice: x.invoiceId ?? '',
  }));
  const inflow = list.filter((x) => x.amount.value > 0).reduce((a, x) => a + x.amount.value, 0);
  const outflow = list.filter((x) => x.amount.value < 0).reduce((a, x) => a + x.amount.value, 0);
  const cur = list[0]?.amount.currency ?? 'USD';
  const k = encodeURIComponent(t.pageKey);
  return (
    <>
      <ShareHead
        title="Transactions"
        k={t.pageKey}
        right={
          <span className="row">
            {[7, 30].map((n) => (
              <Link key={n} className={`btn sm${n === days ? ' dark' : ''}`} href={`/p/transactions?days=${n}&k=${k}`}>
                {n} days
              </Link>
            ))}
          </span>
        }
      />
      <div className="kpis rise" style={delay(0.05)}>
        <Kpi label="In" value={money(inflow, cur)} tone="ok" />
        <Kpi label="Out" value={money(outflow, cur)} tone="bad" />
        <Kpi label="Transactions" value={String(list.length)} />
        <Kpi label="Window" value={`last ${days} days`} small={20} />
      </div>
      <div className="card rise" style={{ ...delay(0.1), padding: 10 }}>
        <TransactionsGrid rows={rows} />
        {!list.length && (
          <p className="empty" style={{ padding: '10px 12px' }}>
            No transactions in this window. PayPal sandbox reporting can lag a few hours behind live activity.
          </p>
        )}
      </div>
    </>
  );
}
