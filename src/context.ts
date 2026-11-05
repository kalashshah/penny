// Per-request glue between Next.js and Penny's domain code: bindings, the signed-in owner, the tenant.
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { sessionUser, type SessionUser } from './auth';
import type { Env } from './env';
import { Memory } from './memory';
import { providerFor } from './providers';
import type { PaymentProvider } from './providers/types';
import { memoryFor, Tenants, type Tenant } from './tenants';

export function getEnv(): Env {
  return getCloudflareContext().env;
}

/** The waitUntil of the request being served, for work that may outlive the response. */
export function waitUntil(p: Promise<unknown>): void {
  getCloudflareContext().ctx.waitUntil(p);
}

export const currentUser = cache(async (): Promise<SessionUser | null> => {
  // headers() first: it marks the render as per-request, so Next never tries to prerender a page that reads bindings.
  const h = await headers();
  return sessionUser(getEnv(), h);
});

export interface Owner {
  user: SessionUser;
  tenant: Tenant;
}

/** The signed-in owner and their business (created on first visit), or null. For route handlers and server actions. */
export const currentOwner = cache(async (): Promise<Owner | null> => {
  const user = await currentUser();
  if (!user) return null;
  return { user, tenant: await new Tenants(getEnv()).ensureForUser(user) };
});

/** Pages for owners only: anyone else is sent to sign in and brought back. */
export async function requireOwner(path: string): Promise<Owner> {
  const owner = await currentOwner();
  if (!owner) redirect(`/login?next=${encodeURIComponent(path)}`);
  return owner;
}

/** The tenant behind a page key: how Penny's screen-sharing browser authenticates. */
export const tenantByPageKey = cache(async (k: string | null | undefined): Promise<Tenant | null> => (k ? new Tenants(getEnv()).byPageKey(k) : null));

/**
 * Pages Penny screen-shares (`/p/*`): her browser carries the tenant's page key as `?k=`;
 * the owner's session works too. Anyone else is sent to sign in.
 */
export async function requirePageTenant(k: string | string[] | undefined, path: string): Promise<Tenant> {
  const tenant = (await tenantByPageKey(param(k))) ?? (await currentOwner())?.tenant;
  if (!tenant) redirect(`/login?next=${encodeURIComponent(path)}`);
  return tenant;
}

export async function providerOf(t: Tenant): Promise<PaymentProvider> {
  const env = getEnv();
  return providerFor(env, new Tenants(env), t);
}

export async function memoryOf(t: Tenant): Promise<Memory> {
  const env = getEnv();
  return memoryFor(env, t);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** JSON error responses for route handlers. "Not connected yet" is the caller's state, not a failure of ours. */
export function jsonError(path: string, e: unknown): Response {
  const message = errorMessage(e);
  console.error('request_failed', { path, error: message });
  return Response.json({ error: message }, { status: /not connected/i.test(message) ? 400 : 500 });
}

/** Runs a load that may fail upstream (PayPal, mostly) so the page can show why instead of a bare error digest. */
export async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    console.error('load_failed', errorMessage(e));
    return { ok: false, error: errorMessage(e) };
  }
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** A single-valued query parameter. */
export const param = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
