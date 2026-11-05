import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Approvals } from '@/approvals';
import { currentOwner, getEnv, requirePageTenant, type SearchParams } from '@/context';
import { DecideButtons } from '@/components/decide-buttons';
import { Chip, delay, money, ShareHead, when } from '@/components/ui';

export const metadata: Metadata = { title: 'Approve? · Penny' };

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const t = await requirePageTenant((await searchParams).k, `/p/proposal/${id}`);
  // Penny's screen-sharing browser comes in with the page key and no session: it sees the page, not the buttons or the dashboard.
  const isOwner = (await currentOwner())?.tenant.id === t.id;
  const p = await new Approvals(getEnv().DB, t.id).get(decodeURIComponent(id));
  if (!p) notFound();
  const open = p.status === 'pending';
  return (
    <>
      <ShareHead title={open ? 'Penny is asking' : p.status === 'waiting' ? 'Paid when they pay' : 'Money-out action'} k={t.pageKey} right={<Chip status={p.status} />} />
      <div className="card approve rise" style={{ ...delay(0.05), maxWidth: 560, marginLeft: 'auto', marginRight: 'auto' }}>
        <div className="mono">{p.kind.replace('_', ' ')}</div>
        <div className="big">{money(p.amount, p.currency)}</div>
        <div className="what">{p.description}</div>
        {open ? (
          <>
            {isOwner && (
              <div className="row" style={{ justifyContent: 'center' }}>
                <DecideButtons id={p.id} size="lg" />
              </div>
            )}
            <p className="small muted" style={{ margin: isOwner ? '16px 0 0' : 0 }}>
              {isOwner ? 'Or just say yes to Penny on the call.' : 'Say yes to Penny on the call, or approve it from your dashboard.'}
            </p>
          </>
        ) : p.status === 'waiting' ? (
          <p className="small muted" style={{ margin: 0 }}>
            Nothing moves until PayPal says the invoice is paid. Then Penny pays it, or asks you first if it is over your limit.
          </p>
        ) : (
          <>
            <p style={{ margin: '0 0 6px' }}>{p.result ?? ''}</p>
            <p className="small muted" style={{ margin: 0 }}>
              {p.approvedBy ? `Approved by ${p.approvedBy} · ` : ''}
              {when(p.decidedAt ?? p.createdAt)}
            </p>
          </>
        )}
        {isOwner && (
          <p className="small" style={{ margin: '18px 0 0' }}>
            <Link href="/">Dashboard</Link>
          </p>
        )}
      </div>
    </>
  );
}
