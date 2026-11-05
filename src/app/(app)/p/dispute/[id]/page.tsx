import type { Metadata } from 'next';
import Link from 'next/link';
import { attempt, providerOf, requirePageTenant, type SearchParams } from '@/context';
import { Card, Chip, delay, ErrorPage, Kpi, ShareHead, when, words } from '@/components/ui';
import { fmtMoney } from '@/providers/types';

type Props = { params: Promise<{ id: string }>; searchParams: SearchParams };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Dispute ${decodeURIComponent((await params).id)} · Penny` };
}

export default async function DisputePage({ params, searchParams }: Props) {
  const { id } = await params;
  const t = await requirePageTenant((await searchParams).k, `/p/dispute/${id}`);
  const r = await attempt(async () => (await providerOf(t)).getDispute(decodeURIComponent(id)));
  if (!r.ok) return <ErrorPage message={r.error} />;
  const d = r.value;
  return (
    <>
      <ShareHead title={`Dispute ${d.id}`} k={t.pageKey} right={<Chip status={d.state.toLowerCase()} />} />
      <div className="kpis rise" style={delay(0.05)}>
        <Kpi label="Amount" value={fmtMoney(d.amount)} tone="bad" />
        <Kpi label="Reason" value={words(d.reason)} small={18} />
        <Kpi label="Respond by" value={when(d.respondBy) || '—'} tone="warn" small={18} />
        <Kpi label="Stage" value={d.stage ? words(d.stage) : '—'} small={18} />
      </div>
      <Card title="Facts" d={0.1}>
        <table className="facts">
          <tbody>
            <tr>
              <td>Opened</td>
              <td>{when(d.createdAt)}</td>
            </tr>
            <tr>
              <td>Status</td>
              <td>{words(d.status)}</td>
            </tr>
            <tr>
              <td>Buyer</td>
              <td>{d.buyerEmail ?? ''}</td>
            </tr>
            <tr>
              <td>Transaction</td>
              <td>{d.transactionId ?? ''}</td>
            </tr>
          </tbody>
        </table>
      </Card>
      <Card title="Evidence" d={0.12}>
        {d.evidence.length ? (
          d.evidence.map((e, n) => (
            <div className="msg" key={n}>
              <b>
                {words(e.type)}
                {e.at ? ` · ${when(e.at)}` : ''}
              </b>
              {[...e.tracking.map((x) => `${x.carrier} tracking ${x.number}`), e.notes].filter(Boolean).join(' · ')}
            </div>
          ))
        ) : (
          <p className="empty">No evidence sent yet.</p>
        )}
        {/* The page is read-only; evidence goes through Penny so the founders hear it before it is sent. */}
        {!/resolved/i.test(`${d.state} ${d.status}`) && <p className="empty">On a call, Penny can send PayPal a tracking number as proof of shipment, or a written note, as evidence.</p>}
      </Card>
      <Card
        title="Messages"
        right={
          <Link className="btn sm" href={`/p/disputes?k=${encodeURIComponent(t.pageKey)}`}>
            All disputes
          </Link>
        }
        d={0.14}
      >
        {d.messages.length ? (
          d.messages.map((m, n) => (
            <div className="msg" key={n}>
              <b>
                {m.by} · {when(m.at)}
              </b>
              {m.text}
            </div>
          ))
        ) : (
          <p className="empty">No messages yet.</p>
        )}
      </Card>
    </>
  );
}
