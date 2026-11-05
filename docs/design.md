# Penny — design

**Date:** 2026-10-13. **Status:** built; this is the spec it was built from.

## Goal

A multi-tenant AI CFO for PayPal-billing small businesses (any business signs up, connects its own PayPal app, gets its own memory and calls): joins a call with a face, answers money questions from live account data, acts (invoices, reminders, dispute replies, payouts, refunds), remembers across calls, and is proactive on account events. Payment rail is pluggable (PayPal now, Airwallex later). Speaker attribution is out of scope; approval is a spoken yes plus the dashboard as a second channel.

## Shape

One Cloudflare Worker (Next.js App Router via OpenNext, TypeScript, D1). Three faces:

1. **`/mcp`** — a stateless Streamable-HTTP MCP server. LlamaCalls connects to it as a connector; its tools are the only way the call agent touches money or memory. Bearer-token auth.
2. **`/webhooks/paypal`** — PayPal events, signature-verified against PayPal, deduped by event id, turned into alerts + memories.
3. **Dashboard + pages** (`/`, `/p/*`, `/api/*`) — key-gated HTML. The dashboard starts calls (embedding LlamaCalls' `joinUrl`), shows alerts and pending approvals; the `/p/*` pages are what Penny screen-shares.

A cron (every 5 min) files ended calls' transcripts into MemoryHQ and expires stale proposals.

## Why these choices

- **Own MCP server rather than PayPal's remote MCP**: LlamaCalls takes tools as dashboard connectors, not inline URLs; one connector covering PayPal + memory + approvals keeps setup to one step and gives the provider plug point for free. PayPal's remote MCP can be attached alongside later for the long tail (catalog, subscriptions).
- **Approvals server-side**: the tool returns `needs_approval`; the agent cannot pay without a second call, and the dashboard can answer the same proposal. The proposal id is the PayPal idempotency key.
- **Proactive = alert + one-click call**, not an unattended call: LlamaCalls bills per minute; a call nobody joins would burn credit. The alert context becomes the call's greeting and instructions.
- **Memory via REST, not MemoryHQ's MCP**: Penny also writes memories from webhooks and transcripts, so it needs the client anyway; two tools (`remember`, `recall`) cost 30 lines.

## Data (D1)

`events` (dedupe + audit), `proposals` (money-out state machine), `calls` (room, join url, ingest flag), `alerts` (what Penny wants to say).

## Provider interface

See `src/providers/types.ts`. Invoices, disputes, payouts, refunds, transactions, webhook verify/parse/register. `summarize()` is computed from the lists, so a provider only lists.

## Tests

Pure parts have tests: approvals transitions and threshold, summary math, PayPal mappers (invoice, status, events), transcript parsing, instruction length cap. Everything that hits the network is thin and left to the smoke test (`pnpm preview` + curl, documented in the README).

## Multi-tenancy (added 2026-10-13, second pass)

- **Identity:** better-auth on D1 (email OTP, Google when configured), the same stack as LlamaCalls and MemoryHQ. One tenant per user, created on first visit.
- **PayPal access:** each tenant pastes its own REST app credentials (sandbox or live). Partner onboarding was rejected for now: it needs a partner-enabled sandbox, excludes the Disputes API for the available onboarding types, and cannot do payouts on a merchant's behalf.
- **Secrets at rest:** PayPal secret and MCP token sealed with AES-GCM under `PENNY_MASTER_KEY`; the MCP token is also hashed for lookup.
- **Call → tenant binding:** LlamaCalls gained `agent.mcpServers` (inline MCP servers per call, tokens sealed on the call row). Penny passes `{name:'penny', url:PUBLIC_URL/mcp, token:<tenant token>}`; `/mcp` resolves the tenant from the bearer.
- **Memory per tenant:** one MemoryHQ workspace and key for all of Penny; each tenant is an end user in it (`x-end-user-id: <tenant id>`), so memories, profiles and search never cross tenants. (Penny first used a workspace per tenant through MemoryHQ's partner endpoint.)
- **Webhooks per tenant:** `/webhooks/paypal/:tenantId`, registered on the tenant's app at connect time, verified with that tenant's webhook id.
- **Pages:** `/p/*` accept the tenant's page key (Penny's browser) or the owner's session; `/api/*` and approvals need the session.

## Next.js on OpenNext (migrated 2026-10-14)

- **From Hono to the App Router:** pages are React server components; owner mutations (start a call, approve/reject, dismiss, settings) are server actions that check the session themselves; `/mcp`, `/webhooks/paypal/[tenantId]`, `/api/auth/[...all]`, `/api/state` and the reports AI proxy are route handlers. URLs are unchanged, so LlamaCalls, PayPal webhooks and Penny's page links keep working.
- **No middleware:** OpenNext treats Node `proxy.ts` as experimental and Next 16 deprecates edge `middleware.ts`, so auth is checked where data is read (`requireOwner`, `requirePageTenant`, `currentOwner` in `src/context.ts`).
- **One address, two faces:** `/` renders the landing page for visitors and the dashboard for owners. Their stylesheets are scoped (`.ui-landing`, `.ui-app`) because both are loaded on `/`.
- **Cron:** `worker.ts` wraps `.open-next/worker.js` and adds `scheduled`.
- **Next pinned to 16.3.x:** Next 16.4 loads `preview-props.json`, which OpenNext 1.20.11 does not inline yet (every request 500s). Lift the pin when OpenNext supports it.
