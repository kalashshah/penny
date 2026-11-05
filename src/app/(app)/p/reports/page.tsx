import type { Metadata } from 'next';
import { attempt, errorMessage, getEnv, param, providerOf, requirePageTenant, type SearchParams } from '@/context';
import { delay, ErrorPage, ShareHead } from '@/components/ui';
import { REPORT_PAGES, reportData, type ReportPage } from '@/reports';
import { ReportsClient } from './reports-client';

export const metadata: Metadata = { title: 'Reports · Penny' };

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await searchParams;
  const t = await requirePageTenant(q.k, '/p/reports');
  const env = getEnv();
  const to = new Date();
  const from = new Date(to.getTime() - 31 * 86_400_000);
  let note: string | undefined;
  const r = await attempt(async () => {
    const provider = await providerOf(t);
    return Promise.all([
      provider.listInvoices({ status: 'open', limit: 100 }),
      provider.listInvoices({ status: 'paid', limit: 100 }),
      provider.listDisputes(),
      // The ledger needs Transaction Search on the PayPal app; the report is still useful without it.
      provider.listTransactions(from, to).catch((e) => {
        const msg = errorMessage(e);
        note = msg.includes('(403)')
          ? 'The Cash page has no PayPal ledger yet: turn on Transaction Search for your PayPal app (developer.paypal.com → your app → Features).'
          : `The Cash page has no PayPal ledger: ${msg}`;
        return [];
      }),
    ]);
  });
  if (!r.ok) return <ErrorPage message={r.error} />;
  const [open, paid, disputes, transactions] = r.value;
  const asked = param(q.page);
  const page: ReportPage = asked && asked in REPORT_PAGES ? (asked as ReportPage) : 'overview';
  const data = reportData({ invoices: [...open, ...paid], disputes, transactions, business: t.businessName, currency: t.currency });
  return (
    <>
      <ShareHead title="Reports" k={t.pageKey} right={<span className="small muted">{t.businessName}</span>} />
      {note && <div className="note rise">{note}</div>}
      <div id="studio" className="rise" style={delay(0.05)}>
        <ReportsClient
          boot={{
            data,
            page,
            pageKey: t.pageKey,
            licenseKey: env.AG_STUDIO_LICENSE,
            aiModel: env.OPENAI_API_KEY ? (env.OPENAI_MODEL ?? 'gpt-5.4-mini') : undefined,
          }}
        />
      </div>
    </>
  );
}
