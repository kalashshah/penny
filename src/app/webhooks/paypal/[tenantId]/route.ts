import { getEnv, jsonError, memoryOf, providerOf, waitUntil } from '@/context';
import { handleWebhook } from '@/events';
import { isConnected, Tenants } from '@/tenants';

// PayPal events, one URL per tenant, verified against that tenant's webhook id.
export async function POST(req: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const env = getEnv();
    const tenant = await new Tenants(env).byId((await params).tenantId);
    if (!tenant || tenant.provider !== 'paypal' || !isConnected(tenant)) return Response.json({ error: 'unknown tenant' }, { status: 404 });
    const [provider, memory] = await Promise.all([providerOf(tenant), memoryOf(tenant)]);
    return await handleWebhook(env, tenant, provider, memory, req, { waitUntil });
  } catch (e) {
    return jsonError('/webhooks/paypal', e);
  }
}
