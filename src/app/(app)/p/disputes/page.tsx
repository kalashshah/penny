import type { Metadata } from 'next';
import { attempt, providerOf, requirePageTenant, type SearchParams } from '@/context';
import { Card, DisputeTable, ErrorPage, ShareHead } from '@/components/ui';

export const metadata: Metadata = { title: 'Disputes · Penny' };

export default async function DisputesPage({ searchParams }: { searchParams: SearchParams }) {
  const t = await requirePageTenant((await searchParams).k, '/p/disputes');
  const r = await attempt(async () => (await providerOf(t)).listDisputes());
  if (!r.ok) return <ErrorPage message={r.error} />;
  return (
    <>
      <ShareHead title="Disputes" k={t.pageKey} />
      <Card d={0.05}>
        <DisputeTable list={r.value} k={t.pageKey} />
      </Card>
    </>
  );
}
