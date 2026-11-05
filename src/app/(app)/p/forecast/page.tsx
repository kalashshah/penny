import type { Metadata } from 'next';
import Link from 'next/link';
import { Approvals } from '@/approvals';
import { attempt, getEnv, param, providerOf, requirePageTenant, type SearchParams } from '@/context';
import { ErrorPage, ShareHead } from '@/components/ui';
import { loadForecast, parseWhatIf } from '@/forecast';
import { ForecastView } from './view';

export const metadata: Metadata = { title: 'Cash forecast · Penny' };

export default async function ForecastPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await searchParams;
  const t = await requirePageTenant(q.k, '/p/forecast');
  const days = Math.min(90, Math.max(7, Number(param(q.days)) || 30));
  const whatIf = parseWhatIf(param(q.late));
  const r = await attempt(async () => loadForecast(await providerOf(t), new Approvals(getEnv().DB, t.id), t.currency, days, whatIf));
  if (!r.ok) return <ErrorPage message={r.error} />;
  const k = encodeURIComponent(t.pageKey);
  const late = param(q.late) ? `&late=${encodeURIComponent(param(q.late)!)}` : '';
  return (
    <>
      <ShareHead
        title="Cash forecast"
        k={t.pageKey}
        right={
          <span className="row">
            {[30, 60, 90].map((n) => (
              <Link key={n} className={`btn sm${n === days ? ' dark' : ''}`} href={`/p/forecast?days=${n}${late}&k=${k}`}>
                {n} days
              </Link>
            ))}
          </span>
        }
      />
      {whatIf.length > 0 && (
        <p className="sub rise">
          What if: {whatIf.map((w) => `${w.customer} pays ${w.daysLate} days ${w.daysLate < 0 ? 'early' : 'later'}`).join(', ')}.{' '}
          <Link href={`/p/forecast?days=${days}&k=${k}`}>Back to the expected case</Link>
        </p>
      )}
      <ForecastView f={r.value} />
    </>
  );
}
