import { Approvals } from '@/approvals';
import { currentOwner, getEnv, jsonError } from '@/context';
import { listAlerts } from '@/events';

// The dashboard polls this and refreshes when something new is waiting.
export async function GET() {
  try {
    const owner = await currentOwner();
    if (!owner) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const env = getEnv();
    const [alerts, pending] = await Promise.all([listAlerts(env, owner.tenant.id), new Approvals(env.DB, owner.tenant.id).listPending()]);
    return Response.json({ alerts: alerts.length, pending: pending.length }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return jsonError('/api/state', e);
  }
}
