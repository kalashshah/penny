'use server';

import { revalidatePath } from 'next/cache';
import { currentOwner, getEnv } from '@/context';
import { Tenants } from '@/tenants';

export interface SettingsResult {
  notes?: string[];
  error?: string;
}

/** Every form on the settings page posts here; `intent` says which one. */
export async function updateSettings(_prev: SettingsResult | null, form: FormData): Promise<SettingsResult> {
  const owner = await currentOwner();
  if (!owner) return { error: 'Your session ended. Sign in again.' };
  const t = owner.tenant;
  const tenants = new Tenants(getEnv());
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === 'string' ? v.trim() : '';
  };
  let result: SettingsResult = {};
  switch (str('intent')) {
    case 'connect': {
      if (!str('client_id') || !str('client_secret')) return { error: 'Client ID and secret are both required.' };
      const r = await tenants.connectPayPal(t, { env: str('env') === 'live' ? 'live' : 'sandbox', clientId: str('client_id'), clientSecret: str('client_secret') });
      result = r.ok ? { notes: r.notes } : { error: `PayPal rejected those credentials: ${r.notes.join(' ')}` };
      break;
    }
    case 'disconnect':
      await tenants.disconnectPayPal(t);
      result = { notes: ['PayPal disconnected.'] };
      break;
    case 'save': {
      const currency = str('currency').toUpperCase();
      const threshold = Number(str('threshold'));
      if (!str('business_name')) return { error: 'Business name is required.' };
      if (!/^[A-Z]{3}$/.test(currency)) return { error: 'Currency must be a 3-letter code like USD.' };
      if (!str('threshold') || !Number.isFinite(threshold) || threshold < 0) return { error: 'Threshold must be a number of zero or more.' };
      await tenants.saveSettings(t, { businessName: str('business_name').slice(0, 80), currency, approvalThreshold: Math.round(threshold * 100) / 100 });
      result = { notes: ['Saved.'] };
      break;
    }
    default:
      return { error: 'Unknown action.' };
  }
  revalidatePath('/', 'layout');
  return result;
}
