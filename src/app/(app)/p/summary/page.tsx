import type { Metadata } from 'next';
import { attempt, providerOf, requirePageTenant, type SearchParams } from '@/context';
import { Card, DisputeTable, ErrorPage, InvoiceTable, MoneyTiles, ShareHead } from '@/components/ui';
import { fetchSummary } from '@/summary';

export const metadata: Metadata = { title: 'Money summary · Penny' };

export default async function SummaryPage({ searchParams }: { searchParams: SearchParams }) {
  const t = await requirePageTenant((await searchParams).k, '/p/summary');
  const r = await attempt(async () => fetchSummary(await providerOf(t), t.currency));
  if (!r.ok) return <ErrorPage message={r.error} />;
  const s = r.value;
  return (
    <>
      <ShareHead title={`${t.businessName} · right now`} k={t.pageKey} />
      <MoneyTiles s={s} />
      <Card title="Overdue" d={0.08}>
        <InvoiceTable list={s.overdueInvoices} k={t.pageKey} />
      </Card>
      <Card title="Open disputes" d={0.12}>
        <DisputeTable list={s.openDisputes} k={t.pageKey} />
      </Card>
    </>
  );
}
