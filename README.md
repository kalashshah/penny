# Penny — the AI CFO that joins your calls

Penny is a finance hire for businesses that bill through PayPal. Sign in, connect your PayPal app, and she joins a video call with a face and a voice: screen-shares the money picture, sends and chases invoices, handles disputes, pays contractors, and **never moves money above your threshold without a spoken "yes" on the call** (or a click on her dashboard). She remembers every decision and vendor term across calls in memory that is yours alone, and when something happens on your account (an invoice gets paid, a dispute opens, a payout fails) she asks you to take a call about it.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) (Oct–Nov 2026). Multi-tenant: every business that signs up gets its own PayPal connection, its own memory, its own approvals and its own calls.

## What a call looks like

> **You:** Penny, how are we doing this month?
> **Penny:** *(screen-shares the summary)* You collected eleven thousand two hundred, there's six thousand four hundred outstanding, and two invoices are overdue — Acme's October sprint is twelve days late.
> **You:** Send Acme a reminder, then pay Sam four hundred for the logo work.
> **Penny:** Reminder sent. Four hundred dollars to sam@… is over your limit. Do you approve?
> **You:** Yes.
> **Penny:** Paid. I've noted that Sam is paid on delivery.

> **You:** Will we make payroll on the 30th? And what if Acme pays two weeks late?
> **Penny:** *(shares the forecast timeline)* Yes, with about nine thousand to spare. If Acme slips two weeks, the low point is still five thousand nine hundred.
> **You:** Pay Sam the rest when Acme pays.
> **Penny:** Done. It waits for Acme's invoice; when it's paid, I'll ask you before it goes.

Later, Acme pays. Penny posts an alert: *"Invoice 0042 (USD 4,000.00) was paid by Acme — take the call?"* One click and she's on a call, opening with the news and Sam's payout ready for your yes.

## How it is put together

```
  business owner ──▶ sign in (email code / Google) ──▶ Penny dashboard ──▶ LlamaCalls API ──▶ video call with Penny
                                                             │  starts the call with Penny's persona,              │
                                                             │  this tenant's memory, and an inline MCP server      │ tool calls over MCP,
                                                             │  carrying the tenant's token                         ▼ bearer = tenant
  PayPal webhooks (one URL per tenant) ──▶ /webhooks/paypal/:tenant ──▶ alerts, memory          /mcp (this worker)
                                                             │                                                      │
                                                             ▼                                                      ▼
                                                        Cloudflare D1                      PaymentProvider ──▶ that tenant's PayPal app (sandbox or live)
                                                 (tenants + sealed secrets,                MemoryHQ ──▶ that tenant's own memory   
                                                  events, proposals, alerts, calls)
```

| Piece | Where | What |
|---|---|---|
| Tenants | `src/tenants.ts` | one business per user; PayPal secret and MCP token sealed with AES-GCM (`src/crypto.ts`) |
| Login | `src/auth.ts` | better-auth: email one-time codes, Google when configured |
| Penny's tools | `src/tools.ts` | 19 MCP tools: summary, cash forecast, invoices, reminders, disputes, pay, pay-when-paid, refund, approvals, transactions, memory |
| Payment rail | `src/providers/paypal.ts` | Invoicing v2, Disputes v1, Payouts v1, Payments v2 (refunds), Transaction Search v1, Webhooks (signature verification) |
| Approvals | `src/approvals.ts` | propose → hold or run → confirm/cancel; 30-minute expiry; idempotent execution. Pay-when-paid payouts wait for an invoice's paid webhook, then run or ask |
| Forecast | `src/forecast.ts`, `src/app/(app)/p/forecast/` | balance today (PayPal Balances), open invoices dated by how late each customer usually pays, held payouts, last month's payments repeating, open disputes if lost; a [Bryntum Scheduler](https://bryntum.com/products/scheduler/) timeline where dragging a payment re-runs the balance line |
| Calls | `src/calls.ts` | persona + memory context + live snapshot → LlamaCalls call; transcripts filed into memory when calls end |
| Reports | `src/app/(app)/p/reports/`, `src/reports.ts` | [AG Studio](https://www.ag-grid.com/studio/) dashboard over the tenant's live PayPal data (overview, who owes us, cash and disputes); Penny opens it on calls with `show_report`, the owner edits it or asks its OpenAI-backed assistant for new charts |
| Alerts | `src/events.ts` | verified webhooks → dedupe → alert → memory |
| App | `src/app/` | Next.js App Router on Cloudflare Workers via [OpenNext](https://opennext.js.org/cloudflare): landing page, dashboard, settings, login, the pages Penny screen-shares under `/p/*` (summary, invoice, dispute, approval, transactions with AG Grid), and the `/mcp`, webhook and auth route handlers. `src/context.ts` connects requests to bindings, sessions and tenants; `worker.ts` adds the cron |

**AI in the loop:** the call agent (LlamaCalls' LLM brain, voice and face) decides which PayPal tools to call and how to explain the results; MemoryHQ extracts durable facts from calls and events and hands Penny a context block at the start of every call.

**PayPal in the loop:** everything Penny reports or does is a PayPal API call against the tenant's own app: search and create invoices, send and remind, list and answer disputes, accept claims, payouts, refunds on captures, transaction search, and signature-verified webhooks that drive the proactive calls. Sandbox or live is a per-tenant switch in Settings.

## The money-out rule

`pay`, `refund_invoice` and `accept_dispute` go through `runOrHold`:

- at or under the tenant's approval threshold: executed immediately, recorded as auto-approved;
- above it: a **proposal** is stored and the tool returns `needs_approval` with its id. Penny reads the amount and recipient back and asks. Only an explicit yes makes her call `confirm_action` (with the approver's name). The signed-in owner can approve or reject the same proposal on the dashboard. Unanswered proposals expire after 30 minutes. Execution uses the proposal id as PayPal's idempotency key, so a retry can never pay twice.

## How tenants stay apart

- Each tenant's PayPal credentials and MCP token are sealed with `PENNY_MASTER_KEY` before they touch D1.
- Every call is started with an **inline MCP server** (`agent.mcpServers` on the LlamaCalls API) carrying that tenant's token; `/mcp` resolves the tenant from the bearer token, so a call can only ever reach its own account.
- Webhooks arrive on a per-tenant URL and are verified against that tenant's webhook id.
- Memory lives in one MemoryHQ workspace, and every call sends the tenant's id as MemoryHQ's `x-end-user-id`. Each tenant's facts, profile and search results stay private to that tenant.
- The pages Penny screen-shares are read-only and opened by her browser with the tenant's page key; approving money needs a signed-in owner.

## Swapping the payment rail

Penny talks to `PaymentProvider` (`src/providers/types.ts`), never to PayPal directly. Add `src/providers/airwallex.ts` implementing the same 14 methods, add a `case` in `src/providers/index.ts`, store its credentials on the tenant. Tools, approvals, pages, webhooks and calls do not change.

## Run it yourself

You need a Cloudflare account (free tier is fine), a [LlamaCalls](https://llamacalls.com/developers) API key (Penny pays for her customers' calls), and optionally a MemoryHQ workspace with an API key and a Google OAuth client. Each business brings its own PayPal app.

```bash
pnpm install
cp .dev.vars.example .dev.vars && pnpm run setup   # generates secrets, checks keys
npx wrangler d1 create penny                        # paste the id into wrangler.jsonc
pnpm run db:local && pnpm dev                       # http://localhost:8787/login (next dev, bindings via OpenNext)
pnpm preview                                        # the built worker on workerd, as it runs in production
```

Login codes are printed to the terminal when no email binding is configured. Sign in, open **Settings**, paste a PayPal sandbox app's client id and secret (enable Invoicing, Payouts, Transaction Search and Disputes on the app; create a sandbox *personal* account to pay invoices with), and press **Call Penny**.

To put Penny on real calls she must be reachable from the internet (LlamaCalls connects to `/mcp`; PayPal posts webhooks):

```bash
# set PUBLIC_URL in wrangler.jsonc to your worker's URL, then
pnpm run db:remote && pnpm run deploy && pnpm run secrets
```

Reconnect PayPal in Settings after deploying so the webhook is registered on the public URL. If MemoryHQ and a verified Email Sending domain live on the **same** Cloudflare account, deploy with `pnpm run deploy:me` (it switches on the service and email bindings; workers.dev → workers.dev fetches are blocked within one account).

To fill a fresh sandbox with a small studio's books (invoices paid, open and overdue, plus memories about the clients), run `pnpm run seed`. It reads your tenant from remote D1, refuses live accounts, and runs once unless you pass `--force`.

`WEBHOOK_VERIFY=off` lets you post fake events to `/webhooks/paypal/<tenantId>` in local demos. Never set it in production.

## Tests

```bash
pnpm test        # approvals state machine, summary math, report rows, PayPal mappings, sealing, transcripts, persona
pnpm typecheck
```

## Hackathon notes

Everything in this repository was written during the submission window. Two of the author's existing products are used as hosted services through their public APIs, exactly as any developer would use them: **LlamaCalls** (an AI participant on a video call: voice, face, screen-share, MCP tools; the inline `mcpServers` option on its calls API was added for Penny) and **MemoryHQ** (long-term memory with fact extraction; its partner provisioning endpoint was added for Penny, and later replaced by per-end-user memory). Neither is vendored here.

## License

MIT
