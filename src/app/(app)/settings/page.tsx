import type { Metadata } from 'next';
import Link from 'next/link';
import { requireOwner, getEnv } from '@/context';
import { AppNav, EnvChip } from '@/components/ui';
import { Memory } from '@/memory';
import { SettingsForms } from './settings-forms';

export const metadata: Metadata = { title: 'Settings · Penny' };

export default async function SettingsPage() {
  const { tenant: t } = await requireOwner('/settings');
  const env = getEnv();
  return (
    <>
      <AppNav business={t.businessName} k={t.pageKey} extra={<EnvChip connected={Boolean(t.paypalClientId)} env={t.paypalEnv} />} />
      <div className="head rise">
        <div>
          <h1>Settings</h1>
          <p className="sub">Your PayPal app and your limits.</p>
        </div>
        <Link className="btn" href="/">
          Back to dashboard
        </Link>
      </div>
      <SettingsForms
        v={{
          business: t.businessName,
          currency: t.currency,
          threshold: t.approvalThreshold,
          paypalEnv: t.paypalEnv,
          clientIdPrefix: t.paypalClientId?.slice(0, 10) ?? null,
          connectedAt: t.paypalConnectedAt,
          webhookOn: Boolean(t.paypalWebhookId),
          memoryOn: new Memory(env, t.id).enabled,
          tenantId: t.id,
          publicUrl: env.PUBLIC_URL,
        }}
      />
    </>
  );
}
