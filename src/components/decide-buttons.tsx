'use client';

import { useTransition } from 'react';
import { decideProposalAction, dismissAlertAction } from '@/app/actions';

/** Approve or reject a held money-out proposal. Approving records the approver's name. */
export function DecideButtons({ id, size = 'sm' }: { id: string; size?: 'sm' | 'lg' }) {
  const [busy, startTransition] = useTransition();
  const decide = (approved: boolean) => {
    const by = approved ? prompt('Your name (recorded as the approver)') : undefined;
    if (approved && !by) return;
    startTransition(async () => {
      const r = await decideProposalAction(id, approved, by ?? undefined);
      if (!r.ok) alert(r.error);
    });
  };
  return (
    <>
      <button className={`btn dark ${size}`} disabled={busy} onClick={() => decide(true)}>
        Approve
      </button>
      <button className={`btn ${size} danger`} disabled={busy} onClick={() => decide(false)}>
        Reject
      </button>
    </>
  );
}

export function DismissButton({ id }: { id: string }) {
  const [busy, startTransition] = useTransition();
  return (
    <button className="btn sm" disabled={busy} onClick={() => startTransition(async () => void (await dismissAlertAction(id)))}>
      Dismiss
    </button>
  );
}
