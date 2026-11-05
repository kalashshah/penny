'use server';

// Owner-only mutations behind the dashboard and the proposal page. Each one checks the session itself:
// a server action is a public POST endpoint like any other.
import { revalidatePath } from 'next/cache';
import { Approvals, confirm } from '@/approvals';
import { callBlocker, startCall } from '@/calls';
import { currentOwner, errorMessage, getEnv, memoryOf, providerOf } from '@/context';
import { dismissAlert, getAlert } from '@/events';
import { isConnected, Tenants } from '@/tenants';

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const signedOut = { ok: false, error: 'Your session ended. Sign in again.' } as const;

export async function startCallAction(alertId: string | null): Promise<Result<{ room: string; joinUrl: string }>> {
  const owner = await currentOwner();
  if (!owner) return signedOut;
  const { tenant: t } = owner;
  if (!isConnected(t)) return { ok: false, error: 'Connect PayPal in Settings first.' };
  try {
    const env = getEnv();
    const blocked = await callBlocker(env, t.id);
    if (blocked) return { ok: false, error: blocked };
    const alert = alertId ? await getAlert(env, t.id, alertId) : null;
    const [provider, memory, mcpToken] = await Promise.all([providerOf(t), memoryOf(t), new Tenants(env).mcpToken(t)]);
    const call = await startCall(env, t, mcpToken, provider, memory, {
      alert: alert ? { title: alert.title, detail: alert.detail, page: alert.page ?? undefined } : undefined,
    });
    if (alert) await dismissAlert(env, t.id, alert.id);
    revalidatePath('/');
    return { ok: true, ...call };
  } catch (e) {
    console.error('call_start_failed', errorMessage(e));
    return { ok: false, error: errorMessage(e) };
  }
}

export async function decideProposalAction(id: string, approved: boolean, by?: string): Promise<Result> {
  const owner = await currentOwner();
  if (!owner) return signedOut;
  const approvals = new Approvals(getEnv().DB, owner.tenant.id);
  try {
    const out = approved
      ? await confirm({ approvals, provider: await providerOf(owner.tenant) }, id, `${by?.trim() || owner.user.email || 'dashboard'} (dashboard)`)
      : await approvals.decide(id, false, 'dashboard');
    if (!out) return { ok: false, error: 'No such proposal.' };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
  revalidatePath('/');
  revalidatePath(`/p/proposal/${id}`);
  return { ok: true };
}

export async function dismissAlertAction(id: string): Promise<Result> {
  const owner = await currentOwner();
  if (!owner) return signedOut;
  await dismissAlert(getEnv(), owner.tenant.id, id);
  revalidatePath('/');
  return { ok: true };
}
