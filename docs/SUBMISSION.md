# Penny: Devpost submission kit

Paste-ready text for the submission form, a 3-minute demo video script, and a pre-submit checklist. Everything here matches what the code does today; update it if that changes.

## Tagline (≤ 200 chars)

Penny is an AI CFO for businesses that bill through PayPal. She joins your video call, screen-shares the money picture, chases invoices and pays people, but never moves money above your limit without a spoken yes.

## Inspiration

Small businesses run on PayPal invoices and payouts, but nobody on a five-person team is the finance person. Money questions ("Will we make payroll if Acme pays late?") get answered by digging through tabs. Chores like chasing overdue invoices, answering disputes before the deadline and paying contractors when the client pays slip through the cracks. We wanted a finance hire you can simply talk to, who shows her working, remembers what you decided last week, and can't be talked into moving money you didn't approve.

## What it does

- **She joins your call** with a face and a voice (LlamaCalls), and screen-shares live pages built from your PayPal account: summary, invoices, disputes, cash forecast, transactions and an AG Studio report.
- **Answers money questions from live data.** Collected, outstanding and overdue. A cash forecast that dates each open invoice by how late that customer usually pays. "What if Acme pays two weeks late?" is a drag on a Bryntum timeline.
- **24 MCP tools on PayPal APIs:**
  - **Invoicing:** create, send, remind, cancel, and record cash or cheque payments.
  - **Disputes:** reply, send tracking or other evidence, accept.
  - **Payouts:** pay, pay-when-paid, and status by recipient.
  - **Refunds**, **transaction search**, and **memory**.
- **The money-out rule.** Payouts, refunds and accepted disputes at or under your threshold run immediately. Above it they become a proposal that needs a spoken yes on the call or a click on the dashboard.
  - Each proposal is claimed atomically, so it runs once even if both say yes at the same moment.
  - Amounts in another currency are always held.
  - Payouts released by money recorded outside PayPal always ask first.
  - The proposal id is PayPal's idempotency key.
- **Pay-when-paid.** "Pay Sam the rest when Acme pays" waits for Acme's invoice-paid webhook, then runs or asks. If the invoice is cancelled, the payout is called off.
- **Proactive.** Verified PayPal webhooks raise alerts: invoice paid, dispute opened, payout failed. A cron flags invoices a week overdue and disputes due within 48 hours, and sends a weekly digest. Each alert is one click to a call that opens with the news.
- **Remembers.** Decisions, vendor terms and call transcripts go into memory private to each business (MemoryHQ), and are handed to Penny at the start of every call.
- **Multi-tenant.** Every business signs in and connects its own PayPal app, sandbox or live, or tries Penny's shared demo sandbox in one click. Secrets are sealed with AES-GCM, and each call carries a token that only reaches its own account.

## How we built it

- Next.js App Router on Cloudflare Workers (OpenNext) with D1 and a cron.
- **PayPal APIs** behind a `PaymentProvider` interface, so the rail is swappable: Invoicing v2, Disputes v1 (including provide-evidence), Payouts v1, Payments v2 refunds, Transaction Search v1, Balances, and Webhooks with signature verification.
- An MCP server (stateless Streamable HTTP). Each call is started with an inline MCP server carrying the tenant's own token.
- LlamaCalls for the call agent (voice, face, screen-share, MCP tool use) and MemoryHQ for long-term memory.
- AG Grid and AG Studio for transactions and reports. The report assistant is an allow-listed, per-tenant-capped proxy. Bryntum Scheduler for the forecast timeline.
- Tests run the approvals state machine (concurrent confirms, expiry, pay-when-paid), webhook reprocessing, tool guards and the digest against an in-memory SQLite with the real migrations.

## Challenges we ran into

- **A voice agent that moves money.** The model decides which tool to call, so safety had to live on the server: thresholds per tenant currency, proposals claimed with a single conditional `UPDATE … RETURNING`, idempotency keys on every payout, and failure states kept distinct from "not sure yet".
- **Webhooks that arrive twice, late or never.** Events are deduplicated but reprocessed when an earlier delivery failed halfway. Pay-when-paid payouts are also checked by polling, in case the webhook never arrives.
- **Keeping tenants apart in one deployment.** Penny uses per-tenant webhook URLs, sealed per-tenant secrets, an MCP token per call, and per-end-user memory.

## Accomplishments we're proud of

- The whole loop works on a real call. You ask "how are we doing?" and Penny shares the summary. You say "pay Sam when Acme pays"; days later Acme pays, Penny raises an alert, you click into a call, and she asks for your yes.
- Money never moves above your limit without an explicit human yes, and every path that could pay twice has a test.

## What we learned

An AI that can pay people needs the boring parts of finance software more, not less: state machines, idempotency, audit trails and honest "pending" states.

## What's next

- PayPal partner onboarding so connecting is one click.
- Airwallex as a second `PaymentProvider`.
- Scheduled payouts and approval by a second person.

## Built with

paypal-invoicing, paypal-payouts, paypal-disputes, paypal-transaction-search, paypal-webhooks, cloudflare-workers, d1, next.js, mcp, llamacalls, memoryhq, ag-grid, ag-studio, bryntum, typescript

---

## Demo video script (about 3 minutes)

1. **0:00 Hook (15 s).** "Meet Penny, the finance hire for businesses that bill through PayPal. She's on this call."
2. **0:15 Money picture (35 s).** "Penny, how are we doing this month?" She shares the summary: collected, outstanding, the overdue invoice. Then "Will we make payroll on the 30th if Acme pays two weeks late?" She shares the forecast; drag Acme's invoice on the timeline and the low point updates.
3. **0:50 Acting (45 s).** "Send Acme a reminder." Done. "Pay Sam four hundred for the logo." It's over the threshold, so Penny reads back the amount and recipient and asks. "Yes." The payout is sent, and `payout_status` confirms it later.
4. **1:35 Pay-when-paid (40 s).** "Pay Sam the rest when Acme pays." The payout waits. Pay Acme's invoice in the sandbox. An alert appears: "Invoice 0042 was paid — take the call?" Click it, and Penny opens with the news and asks for your yes.
5. **2:15 Disputes (25 s).** "There's a dispute from Lee: send the USPS tracking number as evidence." The evidence goes to PayPal, and the dispute page shows it.
6. **2:40 Safety and memory (20 s).** Show the dashboard: approvals, the threshold and the weekly digest. Next call: "What did we decide about Sam?" "Sam is paid on delivery."

## Pre-submit checklist

- [ ] `pnpm test && pnpm typecheck && pnpm build` pass.
- [ ] `pnpm run db:remote` applied (migrations 0005–0010), then `pnpm run deploy` and `pnpm run secrets`. `DEMO_PAYPAL_CLIENT_ID` and `DEMO_PAYPAL_CLIENT_SECRET` are set if judges should use the shared sandbox.
- [ ] TODO.md items done: Google redirect URI, reconnect PayPal so the webhook registers on penny.keronlabs.com, an email code arrives, and a click-through of the AG Studio and transactions grid.
- [ ] Seed the demo sandbox: connect a tenant to it, then `pnpm run seed <tenantId>`.
- [ ] On production: sign in, use the demo sandbox, take a call, pay under and over the threshold, and run pay-when-paid end to end.
- [ ] Unverified against live sandbox so far, so worth one manual try each: provide-evidence (multipart), cancel and record-payment, the payout status fields, and the duplicate-batch error text that payout reconciliation matches.
- [ ] Tenants connected before this release keep their old webhook event list: reconnect PayPal in Settings so payout UNCLAIMED/HELD/RETURNED events arrive.
- [ ] Video uploaded, repository link and testing instructions pasted into Devpost.
