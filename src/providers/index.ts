import type { Env } from '../env';
import type { Tenant, Tenants } from '../tenants';
import { PayPalProvider } from './paypal';
import type { PaymentProvider } from './types';

/** The one place a rail is chosen for a tenant. Add `case 'airwallex'` with its adapter and nothing else changes. */
export async function providerFor(env: Env, tenants: Tenants, t: Tenant): Promise<PaymentProvider> {
  switch (t.provider) {
    case 'paypal': {
      if (!t.paypalClientId) throw new Error('PayPal is not connected. Open Settings and add your PayPal app credentials.');
      return new PayPalProvider({
        clientId: t.paypalClientId,
        clientSecret: await tenants.paypalSecret(t),
        env: t.paypalEnv,
        webhookId: t.paypalWebhookId ?? undefined,
        businessName: t.businessName,
      });
    }
    default:
      throw new Error(`Provider "${t.provider}" has no adapter yet; see src/providers/types.ts`);
  }
}

export { isWebhookVerificationOff } from './paypal';
export type { PaymentProvider };
