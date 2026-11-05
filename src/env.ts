import type { D1Database } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  /** Service binding to the MemoryHQ worker when both live on one Cloudflare account (workers.dev → workers.dev fetches are blocked there). Optional. */
  MEMORYHQ?: { fetch(input: string, init?: RequestInit): Promise<Response> };
  /** Cloudflare Email Sending binding for login codes. Absent: codes are logged (local dev). */
  EMAIL?: { send(message: { to: string; from: string; subject: string; html?: string; text?: string }): Promise<void> };

  /** Where this worker is reachable, no trailing slash. Cookies, OAuth callbacks and webhooks are issued for it. */
  PUBLIC_URL: string;
  BETTER_AUTH_SECRET: string;
  /** Base64 32-byte AES key; seals every tenant secret (PayPal secret, memory key, MCP token) at rest. */
  PENNY_MASTER_KEY: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  EMAIL_FROM?: string;

  MEMORYHQ_URL: string;
  /** Penny's one MemoryHQ workspace and an API key for it; each tenant is an end user in it. Absent: tenants run without memory. */
  MEMORYHQ_WORKSPACE?: string;
  MEMORYHQ_KEY?: string;

  LLAMACALLS_URL: string;
  LLAMACALLS_KEY: string;
  /** Penny's face (a LlamaCalls avatar id). */
  LLAMACALLS_AVATAR_ID?: string;

  /** AG Studio licence for the reports page. Absent: Studio runs unlicensed (watermark). */
  AG_STUDIO_LICENSE?: string;
  /** Backs the reports page's AI assistant (proxied, never sent to the browser). Absent: the assistant is hidden. */
  OPENAI_API_KEY?: string;
  /** The one model the assistant may use; defaults to gpt-5.4-mini. */
  OPENAI_MODEL?: string;

  /** "off" skips provider webhook signature checks. Local demos only. */
  WEBHOOK_VERIFY?: string;

  /** Defaults for a new tenant. */
  DEFAULT_CURRENCY: string;
  APPROVAL_THRESHOLD: string;
}

declare global {
  // What `getCloudflareContext().env` returns (OpenNext declares the interface; Penny fills it in).
  interface CloudflareEnv extends Env {}
}
