import { randomHex, Sealer, sha256Hex } from './crypto';
import { shortId } from './db';
import type { Env } from './env';
import { Memory } from './memory';
import { PayPalProvider } from './providers/paypal';

export interface Tenant {
  id: string;
  ownerUserId: string;
  businessName: string;
  currency: string;
  approvalThreshold: number;
  provider: 'paypal';
  paypalEnv: 'sandbox' | 'live';
  paypalClientId: string | null;
  paypalSecretCt: string | null;
  paypalSecretIv: string | null;
  paypalWebhookId: string | null;
  paypalConnectedAt: number | null;
  mcpTokenHash: string;
  mcpTokenCt: string;
  mcpTokenIv: string;
  pageKey: string;
  createdAt: number;
}

interface Row {
  id: string;
  owner_user_id: string;
  business_name: string;
  currency: string;
  approval_threshold: number;
  provider: 'paypal';
  paypal_env: 'sandbox' | 'live';
  paypal_client_id: string | null;
  paypal_secret_ct: string | null;
  paypal_secret_iv: string | null;
  paypal_webhook_id: string | null;
  paypal_connected_at: number | null;
  mcp_token_hash: string;
  mcp_token_ct: string;
  mcp_token_iv: string;
  page_key: string;
  created_at: number;
}

function fromRow(r: Row): Tenant {
  return {
    id: r.id,
    ownerUserId: r.owner_user_id,
    businessName: r.business_name,
    currency: r.currency,
    approvalThreshold: r.approval_threshold,
    provider: r.provider,
    paypalEnv: r.paypal_env,
    paypalClientId: r.paypal_client_id,
    paypalSecretCt: r.paypal_secret_ct,
    paypalSecretIv: r.paypal_secret_iv,
    paypalWebhookId: r.paypal_webhook_id,
    paypalConnectedAt: r.paypal_connected_at,
    mcpTokenHash: r.mcp_token_hash,
    mcpTokenCt: r.mcp_token_ct,
    mcpTokenIv: r.mcp_token_iv,
    pageKey: r.page_key,
    createdAt: r.created_at,
  };
}

export function isConnected(t: Tenant): boolean {
  return Boolean(t.paypalClientId && t.paypalSecretCt);
}

export interface SettingsPatch {
  businessName?: string;
  currency?: string;
  approvalThreshold?: number;
}

/** Tenants and their sealed secrets. One business per signed-in user, created on first visit. */
export class Tenants {
  private readonly sealer: Sealer;
  constructor(private readonly env: Env) {
    this.sealer = new Sealer(env.PENNY_MASTER_KEY);
  }

  async byId(id: string): Promise<Tenant | null> {
    const r = await this.env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first<Row>();
    return r ? fromRow(r) : null;
  }

  async forUser(userId: string): Promise<Tenant | null> {
    const r = await this.env.DB.prepare('SELECT * FROM tenants WHERE owner_user_id = ?').bind(userId).first<Row>();
    return r ? fromRow(r) : null;
  }

  async byPageKey(key: string): Promise<Tenant | null> {
    if (!key) return null;
    const r = await this.env.DB.prepare('SELECT * FROM tenants WHERE page_key = ?').bind(key).first<Row>();
    return r ? fromRow(r) : null;
  }

  async byMcpToken(token: string): Promise<Tenant | null> {
    if (!token) return null;
    const r = await this.env.DB.prepare('SELECT * FROM tenants WHERE mcp_token_hash = ?').bind(await sha256Hex(token)).first<Row>();
    return r ? fromRow(r) : null;
  }

  /** Tenants with PayPal connected and an id after `after` (or from the start), in id order: a page of a cron pass. */
  async listConnectedAfter(after: string | null, limit: number): Promise<Tenant[]> {
    const r = await this.env.DB.prepare('SELECT * FROM tenants WHERE paypal_client_id IS NOT NULL AND paypal_secret_ct IS NOT NULL AND id > ? ORDER BY id LIMIT ?')
      .bind(after ?? '', limit)
      .all<Row>();
    return (r.results ?? []).map(fromRow);
  }

  /** Connected tenants that have no digest row for this week yet, oldest first. */
  async listConnectedWithoutDigest(week: string, limit: number): Promise<Tenant[]> {
    const r = await this.env.DB.prepare(
      'SELECT * FROM tenants WHERE paypal_client_id IS NOT NULL AND paypal_secret_ct IS NOT NULL AND id NOT IN (SELECT tenant_id FROM digests WHERE week = ?) ORDER BY created_at LIMIT ?',
    )
      .bind(week, limit)
      .all<Row>();
    return (r.results ?? []).map(fromRow);
  }

  async ensureForUser(user: { id: string; email: string; name?: string | null }): Promise<Tenant> {
    const existing = await this.forUser(user.id);
    if (existing) return existing;
    const token = randomHex(24);
    const sealed = await this.sealer.seal(token);
    const t: Tenant = {
      id: shortId('t'),
      ownerUserId: user.id,
      businessName: user.name?.trim() || user.email.split('@')[0] || 'My business',
      currency: this.env.DEFAULT_CURRENCY || 'USD',
      approvalThreshold: Number(this.env.APPROVAL_THRESHOLD) || 100,
      provider: 'paypal',
      paypalEnv: 'sandbox',
      paypalClientId: null,
      paypalSecretCt: null,
      paypalSecretIv: null,
      paypalWebhookId: null,
      paypalConnectedAt: null,
      mcpTokenHash: await sha256Hex(token),
      mcpTokenCt: sealed.ct,
      mcpTokenIv: sealed.iv,
      pageKey: randomHex(12),
      createdAt: Date.now(),
    };
    await this.env.DB.prepare(
      `INSERT INTO tenants (id, owner_user_id, business_name, currency, approval_threshold, provider, paypal_env, mcp_token_hash, mcp_token_ct, mcp_token_iv, page_key, created_at)
       VALUES (?, ?, ?, ?, ?, 'paypal', 'sandbox', ?, ?, ?, ?, ?)`,
    )
      .bind(t.id, t.ownerUserId, t.businessName, t.currency, t.approvalThreshold, t.mcpTokenHash, t.mcpTokenCt, t.mcpTokenIv, t.pageKey, t.createdAt)
      .run();
    return t;
  }

  async saveSettings(t: Tenant, p: SettingsPatch): Promise<void> {
    await this.env.DB.prepare(
      'UPDATE tenants SET business_name = ?, currency = ?, approval_threshold = ? WHERE id = ?',
    )
      .bind(
        p.businessName ?? t.businessName,
        p.currency ?? t.currency,
        p.approvalThreshold ?? t.approvalThreshold,
        t.id,
      )
      .run();
  }

  // ---- secrets ---------------------------------------------------------------

  async paypalSecret(t: Tenant): Promise<string> {
    if (!t.paypalSecretCt || !t.paypalSecretIv) throw new Error('PayPal is not connected. Open Settings and add your PayPal app credentials.');
    return this.sealer.open(t.paypalSecretCt, t.paypalSecretIv);
  }

  async mcpToken(t: Tenant): Promise<string> {
    return this.sealer.open(t.mcpTokenCt, t.mcpTokenIv);
  }

  // ---- connecting the rail ----------------------------------------------------

  /**
   * Checks the credentials against PayPal, seals them, registers this tenant's
   * webhook (when Penny is reachable from the internet).
   * Returns what to tell the user; never stores credentials PayPal rejected.
   */
  /** Borrow the deployment's shared sandbox app (DEMO_PAYPAL_*). No webhook: one app holds at most 10, and they are per tenant. */
  async connectDemo(t: Tenant): Promise<{ ok: boolean; notes: string[] }> {
    if (!this.env.DEMO_PAYPAL_CLIENT_ID || !this.env.DEMO_PAYPAL_CLIENT_SECRET) return { ok: false, notes: ['This deployment has no demo sandbox.'] };
    const r = await this.connectPayPal(t, { env: 'sandbox', clientId: this.env.DEMO_PAYPAL_CLIENT_ID, clientSecret: this.env.DEMO_PAYPAL_CLIENT_SECRET }, { webhook: false });
    if (r.ok) r.notes = ["Connected to Penny's shared demo sandbox: sample customers, invoices and disputes, no real money. Others trying Penny see the same sandbox, and live alerts are off; connect your own PayPal app for those."];
    return r;
  }

  async connectPayPal(t: Tenant, input: { env: 'sandbox' | 'live'; clientId: string; clientSecret: string }, opts: { webhook?: boolean } = {}): Promise<{ ok: boolean; notes: string[] }> {
    const notes: string[] = [];
    const provider = new PayPalProvider({ clientId: input.clientId, clientSecret: input.clientSecret, env: input.env, businessName: t.businessName });
    try {
      await provider.checkCredentials();
      await provider.listInvoices({ status: 'all', limit: 1 });
    } catch (e) {
      return { ok: false, notes: [e instanceof Error ? e.message : String(e)] };
    }
    const sealed = await this.sealer.seal(input.clientSecret);
    // Reconnecting the same app without registering (locally, or PayPal said no) keeps the webhook it already has;
    // a different app or env cannot verify with the old app's webhook id.
    let webhookId = t.paypalClientId === input.clientId && t.paypalEnv === input.env ? t.paypalWebhookId : null;
    if (opts.webhook === false) {
      webhookId = null;
    } else if (/^https:\/\//.test(this.env.PUBLIC_URL) && !/localhost|127\.0\.0\.1/.test(this.env.PUBLIC_URL)) {
      try {
        webhookId = await provider.registerWebhook(`${this.env.PUBLIC_URL}/webhooks/paypal/${t.id}`);
        notes.push('Webhook registered: Penny will hear about paid invoices, disputes and payouts.');
      } catch (e) {
        notes.push(`Connected, but the webhook could not be registered: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      notes.push('Running locally, so no webhook was registered; events will not reach Penny until deployed.');
    }
    await this.env.DB.prepare(
      'UPDATE tenants SET paypal_env = ?, paypal_client_id = ?, paypal_secret_ct = ?, paypal_secret_iv = ?, paypal_webhook_id = ?, paypal_connected_at = ? WHERE id = ?',
    )
      .bind(input.env, input.clientId, sealed.ct, sealed.iv, webhookId, Date.now(), t.id)
      .run();
    notes.unshift(`PayPal ${input.env} connected.`);
    return { ok: true, notes };
  }

  async disconnectPayPal(t: Tenant): Promise<void> {
    await this.env.DB.prepare(
      'UPDATE tenants SET paypal_client_id = NULL, paypal_secret_ct = NULL, paypal_secret_iv = NULL, paypal_webhook_id = NULL, paypal_connected_at = NULL WHERE id = ?',
    )
      .bind(t.id)
      .run();
  }
}

export function memoryFor(env: Env, t: Tenant): Memory {
  return new Memory(env, t.id);
}
