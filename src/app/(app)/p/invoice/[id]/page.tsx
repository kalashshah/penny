import type { Metadata } from 'next';
import Link from 'next/link';
import { attempt, providerOf, requirePageTenant, type SearchParams } from '@/context';
import { Card, Chip, delay, ErrorPage, isOverdue, Kpi, ShareHead } from '@/components/ui';
import { fmtMoney } from '@/providers/types';

type Props = { params: Promise<{ id: string }>; searchParams: SearchParams };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Invoice ${decodeURIComponent((await params).id)} · Penny` };
}

export default async function InvoicePage({ params, searchParams }: Props) {
  const { id } = await params;
  const t = await requirePageTenant((await searchParams).k, `/p/invoice/${id}`);
  const r = await attempt(async () => (await providerOf(t)).getInvoice(decodeURIComponent(id)));
  if (!r.ok) return <ErrorPage message={r.error} />;
  const i = r.value;
  return (
    <>
      <ShareHead
        title={`Invoice ${i.number}`}
        k={t.pageKey}
        right={
          <>
            <Chip status={i.status} />
            {isOverdue(i, new Date().toISOString().slice(0, 10)) && <span className="chip bad">overdue</span>}
          </>
        }
      />
      <div className="kpis rise" style={delay(0.05)}>
        <Kpi label="Total" value={fmtMoney(i.total)} />
        <Kpi label="Still due" value={fmtMoney(i.due)} tone={i.due.value > 0 ? 'warn' : 'ok'} />
        <Kpi label="Due date" value={i.dueDate ?? '—'} small={20} />
        <Kpi label="Issued" value={i.issuedAt ?? '—'} small={20} />
      </div>
      <Card
        title={
          <div>
            <h2>{i.customer.name || 'Customer'}</h2>
            <span className="small muted">{i.customer.email}</span>
          </div>
        }
        right={
          i.payLink && (
            <a className="btn dark sm" href={i.payLink} target="_blank" rel="noopener">
              Payment link
            </a>
          )
        }
        d={0.1}
      >
        {i.memo && (
          <p className="sub" style={{ margin: '0 0 12px' }}>
            {i.memo}
          </p>
        )}
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th className="r">Qty</th>
              <th className="r">Unit</th>
            </tr>
          </thead>
          <tbody>
            {i.items.length ? (
              i.items.map((x, n) => (
                <tr key={n}>
                  <td>{x.name}</td>
                  <td className="r">{x.quantity}</td>
                  <td className="r">{fmtMoney(x.unitAmount)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className="empty">
                  No line items
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="small muted" style={{ margin: '12px 0 0' }}>
          {i.paidAt ? `Paid ${i.paidAt}` : 'Not paid yet'} · <Link href={`/p/invoices?k=${encodeURIComponent(t.pageKey)}`}>All invoices</Link>
        </p>
      </Card>
    </>
  );
}
