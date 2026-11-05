import type { Metadata } from 'next';
import Link from 'next/link';
import { attempt, param, providerOf, requirePageTenant, type SearchParams } from '@/context';
import { Card, ErrorPage, InvoiceTable, ShareHead } from '@/components/ui';

export const metadata: Metadata = { title: 'Invoices · Penny' };

const TABS = [
  ['open', 'Open'],
  ['paid', 'Paid'],
  ['all', 'All'],
] as const;

export default async function InvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await searchParams;
  const t = await requirePageTenant(q.k, '/p/invoices');
  const status = TABS.find(([s]) => s === param(q.status))?.[0] ?? 'open';
  const r = await attempt(async () => (await providerOf(t)).listInvoices({ status, limit: 50 }));
  if (!r.ok) return <ErrorPage message={r.error} />;
  const k = encodeURIComponent(t.pageKey);
  return (
    <>
      <ShareHead
        title="Invoices"
        k={t.pageKey}
        right={
          <span className="row">
            {TABS.map(([s, label]) => (
              <Link key={s} className={`btn sm${s === status ? ' dark' : ''}`} href={`/p/invoices?status=${s}&k=${k}`}>
                {label}
              </Link>
            ))}
          </span>
        }
      />
      <Card d={0.05}>
        <InvoiceTable list={r.value} k={t.pageKey} />
      </Card>
    </>
  );
}
