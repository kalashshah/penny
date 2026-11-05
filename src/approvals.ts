import type { D1Database } from '@cloudflare/workers-types';
import { rows, shortId } from './db';
import type { Money, PaymentProvider } from './providers/types';
import { fmtMoney, isDefiniteRejection } from './providers/types';

export type ActionKind = 'payout' | 'refund' | 'accept_dispute';
export type ProposalStatus = 'waiting' | 'pending' | 'approved' | 'rejected' | 'expired' | 'done' | 'failed';

export interface Proposal {
  id: string;
  kind: ActionKind;
  description: string;
  amount: number;
  currency: string;
  input: Record<string, unknown>;
  status: ProposalStatus;
  approvedBy?: string;
  result?: string;
  /** Waits for this invoice to be paid before it is run or asked about. */
  afterInvoice?: string;
  createdAt: number;
  decidedAt?: number;
}

/** A held proposal nobody answers is dropped, not paid later by surprise. */
export const PROPOSAL_TTL_MS = 30 * 60_000;
/** One released by a customer paying arrives while nobody is on a call, so it gets a day. */
export const RELEASED_TTL_MS = 24 * 60 * 60_000;

/** When an unanswered pending proposal lapses: a day for one a customer's payment released, else 30 minutes. */
export function expiresAt(p: Pick<Proposal, 'createdAt' | 'afterInvoice'>): number {
  return p.createdAt + (p.afterInvoice ? RELEASED_TTL_MS : PROPOSAL_TTL_MS);
}

/** The threshold is in the tenant's currency; an amount in any other is held, never converted and guessed at. */
export function needsApproval(money: Money, threshold: number, currency: string): boolean {
  return money.currency.toUpperCase() !== currency.toUpperCase() || money.value > threshold;
}

export interface MoneyDeps {
  approvals: Approvals;
  provider: PaymentProvider;
  threshold: number;
  /** The tenant's currency, which the threshold is in. */
  currency: string;
}

/** What a decision does to a proposal. Pure; the one piece of this file with a test. */
export function decideTransition(p: Proposal, approved: boolean, by: string | undefined, now: number): Proposal {
  // A waiting one can be called off, not approved early.
  if (p.status === 'waiting') return approved ? p : { ...p, status: 'rejected', decidedAt: now };
  if (p.status !== 'pending') return p;
  if (now - p.createdAt > (p.afterInvoice ? RELEASED_TTL_MS : PROPOSAL_TTL_MS)) return { ...p, status: 'expired', decidedAt: now };
  return { ...p, status: approved ? 'approved' : 'rejected', approvedBy: by, decidedAt: now };
}

interface Row {
  id: string;
  kind: ActionKind;
  description: string;
  amount: number;
  currency: string;
  input: string;
  status: ProposalStatus;
  approved_by: string | null;
  result: string | null;
  after_invoice: string | null;
  created_at: number;
  decided_at: number | null;
}

function fromRow(r: Row): Proposal {
  return {
    id: r.id,
    kind: r.kind,
    description: r.description,
    amount: r.amount,
    currency: r.currency,
    input: JSON.parse(r.input) as Record<string, unknown>,
    status: r.status,
    approvedBy: r.approved_by ?? undefined,
    result: r.result ?? undefined,
    afterInvoice: r.after_invoice ?? undefined,
    createdAt: r.created_at,
    decidedAt: r.decided_at ?? undefined,
  };
}

export class Approvals {
  constructor(
    private readonly db: D1Database,
    private readonly tenantId: string,
  ) {}

  async create(kind: ActionKind, description: string, money: Money, input: Record<string, unknown>, afterInvoice?: string): Promise<Proposal> {
    const p: Proposal = { id: shortId('ap'), kind, description, amount: money.value, currency: money.currency, input, status: afterInvoice ? 'waiting' : 'pending', afterInvoice, createdAt: Date.now() };
    await this.db
      .prepare('INSERT INTO proposals (id, tenant_id, kind, description, amount, currency, input, status, after_invoice, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(p.id, this.tenantId, p.kind, p.description, p.amount, p.currency, JSON.stringify(p.input), p.status, afterInvoice ?? null, p.createdAt)
      .run();
    return p;
  }

  async get(id: string): Promise<Proposal | null> {
    const r = await this.db.prepare('SELECT * FROM proposals WHERE id = ? AND tenant_id = ?').bind(id, this.tenantId).first<Row>();
    return r ? fromRow(r) : null;
  }

  async listPending(): Promise<Proposal[]> {
    return (await rows<Row>(this.db.prepare("SELECT * FROM proposals WHERE tenant_id = ? AND status = 'pending' ORDER BY created_at DESC").bind(this.tenantId))).map(fromRow);
  }

  async listWaiting(): Promise<Proposal[]> {
    return (await rows<Row>(this.db.prepare("SELECT * FROM proposals WHERE tenant_id = ? AND status = 'waiting' ORDER BY created_at DESC").bind(this.tenantId))).map(fromRow);
  }

  /** The invoice was paid: its waiting proposals become pending, once (the UPDATE is the lock). */
  async release(invoiceId: string): Promise<Proposal[]> {
    const r = await this.db
      .prepare("UPDATE proposals SET status = 'pending', created_at = ? WHERE tenant_id = ? AND after_invoice = ? AND status = 'waiting' RETURNING *")
      .bind(Date.now(), this.tenantId, invoiceId)
      .all<Row>();
    return (r.results ?? []).map(fromRow);
  }

  /** The invoice will never be paid (cancelled, refunded): what waited on it is called off, with why. */
  async callOff(invoiceId: string, why: string): Promise<Proposal[]> {
    const r = await this.db
      .prepare("UPDATE proposals SET status = 'rejected', result = ?, decided_at = ? WHERE tenant_id = ? AND after_invoice = ? AND status = 'waiting' RETURNING *")
      .bind(why, Date.now(), this.tenantId, invoiceId)
      .all<Row>();
    return (r.results ?? []).map(fromRow);
  }

  async listRecent(limit = 10): Promise<Proposal[]> {
    return (await rows<Row>(this.db.prepare('SELECT * FROM proposals WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?').bind(this.tenantId, limit))).map(fromRow);
  }

  /**
   * Takes a pending, unexpired proposal for running: the UPDATE is the lock, so two yeses at once
   * (call and dashboard, or a double click) run it once. 'approved' doubles as "executing" until finish.
   */
  async claim(id: string, by: string, now = Date.now()): Promise<Proposal | null> {
    const r = await this.db
      .prepare(
        "UPDATE proposals SET status = 'approved', approved_by = ?, decided_at = ? WHERE id = ? AND tenant_id = ? AND status = 'pending' AND created_at >= CASE WHEN after_invoice IS NULL THEN ? ELSE ? END RETURNING *",
      )
      .bind(by, now, id, this.tenantId, now - PROPOSAL_TTL_MS, now - RELEASED_TTL_MS)
      .first<Row>();
    return r ? fromRow(r) : null;
  }

  /** Rejects, or records an expiry; approving goes through claim. Returns the proposal as it now stands. */
  async decide(id: string, approved: boolean, by?: string): Promise<Proposal | null> {
    const p = await this.get(id);
    if (!p) return null;
    const next = decideTransition(p, approved, by, Date.now());
    if (next.status === p.status || next.status === 'approved') return p;
    // Only from the status we read: a racing claim wins and this becomes a no-op.
    const res = await this.db
      .prepare('UPDATE proposals SET status = ?, approved_by = ?, decided_at = ? WHERE id = ? AND tenant_id = ? AND status = ?')
      .bind(next.status, next.approvedBy ?? null, next.decidedAt ?? null, p.id, this.tenantId, p.status)
      .run();
    return res.meta.changes ? next : this.get(id);
  }

  /** Only a claimed proposal settles, so a late or repeated finish never rewrites a decided one. */
  async finish(id: string, ok: boolean, result: string): Promise<void> {
    await this.db
      .prepare("UPDATE proposals SET status = ?, result = ? WHERE id = ? AND tenant_id = ? AND status = 'approved'")
      .bind(ok ? 'done' : 'failed', result, id, this.tenantId)
      .run();
  }

  /** Records what is known about a claimed proposal that has not settled (PayPal's answer was unclear), keeping it claimed. */
  async note(id: string, result: string): Promise<void> {
    await this.db.prepare("UPDATE proposals SET result = ? WHERE id = ? AND tenant_id = ? AND status = 'approved'").bind(result, id, this.tenantId).run();
  }

  /**
   * The rail took a payout and later reported it failed for good (denied, returned, blocked...): it is not done after all.
   * Only a payout that ran, so a stray or replayed event cannot touch anything else.
   */
  async failPayout(id: string, reason: string): Promise<Proposal | null> {
    const r = await this.db
      .prepare(
        "UPDATE proposals SET status = 'failed', result = COALESCE(result || ' ', '') || ? WHERE id = ? AND tenant_id = ? AND kind = 'payout' AND status IN ('done', 'approved') RETURNING *",
      )
      .bind(`PayPal then reported it ${reason}.`, id, this.tenantId)
      .first<Row>();
    return r ? fromRow(r) : null;
  }

  /**
   * The rail reported the payout went through. Settles one still marked running, and undoes a failure that an earlier
   * not-final report (unclaimed, held) recorded before those stopped counting as failures. Never touches a final failure.
   */
  async completePayout(id: string, batchId?: string): Promise<Proposal | null> {
    // One still running may have no result yet; the batch id goes in it, since payout_status reads it from there.
    const r = await this.db
      .prepare(
        "UPDATE proposals SET status = 'done', result = COALESCE(result || ' ', ?) || 'PayPal then reported it went through.' WHERE id = ? AND tenant_id = ? AND kind = 'payout' AND (status = 'approved' OR (status = 'failed' AND (result LIKE '%PayPal then reported it unclaimed%' OR result LIKE '%PayPal then reported it held%'))) RETURNING *",
      )
      .bind(batchId ? `Payout ${batchId} is success. ` : '', id, this.tenantId)
      .first<Row>();
    return r ? fromRow(r) : null;
  }

  /**
   * Cron, across every tenant: payouts claimed more than `minAgeMs` ago that never settled (PayPal's answer was unclear,
   * or the worker died mid-run). A random few, so ones that stay unclear cannot starve the rest.
   */
  static async stuckPayouts(db: D1Database, limit: number, minAgeMs: number, now = Date.now()): Promise<(Proposal & { tenantId: string })[]> {
    const r = await rows<Row & { tenant_id: string }>(
      db.prepare("SELECT * FROM proposals WHERE kind = 'payout' AND status = 'approved' AND decided_at < ? ORDER BY RANDOM() LIMIT ?").bind(now - minAgeMs, limit),
    );
    return r.map((x) => ({ ...fromRow(x), tenantId: x.tenant_id }));
  }

  /** Cron, across every tenant. */
  static async expireStale(db: D1Database, now = Date.now()): Promise<number> {
    const res = await db
      .prepare("UPDATE proposals SET status = 'expired', decided_at = ? WHERE status = 'pending' AND created_at < CASE WHEN after_invoice IS NULL THEN ? ELSE ? END")
      .bind(now, now - PROPOSAL_TTL_MS, now - RELEASED_TTL_MS)
      .run();
    return res.meta.changes ?? 0;
  }

}

/** Runs an approved proposal against the rail and says what happened in one sentence. */
export async function execute(provider: PaymentProvider, p: Proposal): Promise<string> {
  const money: Money = { value: p.amount, currency: p.currency };
  const input = p.input as Record<string, string>;
  switch (p.kind) {
    case 'payout': {
      const r = await provider.payout({ recipientEmail: input.recipientEmail, amount: money, note: input.note ?? '', idempotencyKey: p.id });
      return `Paid ${fmtMoney(money)} to ${input.recipientEmail}. Payout ${r.id} is ${r.status}.`;
    }
    case 'refund': {
      const r = await provider.refundInvoice(input.invoiceId, money, p.id);
      return `Refunded ${fmtMoney(money)} on invoice ${input.invoiceNumber ?? input.invoiceId}. Refund ${r.id} is ${r.status}.`;
    }
    case 'accept_dispute': {
      await provider.acceptDispute(input.disputeId, input.note ?? '');
      return `Accepted dispute ${input.disputeId}; the buyer gets ${fmtMoney(money)} back.`;
    }
  }
}

export interface ActionOutcome {
  /** unchanged: it was already decided (or being run), so this call did nothing. unknown: PayPal's answer was unclear; it is being checked. */
  status: 'done' | 'needs_approval' | 'failed' | 'unchanged' | 'unknown';
  proposal: Proposal;
  result?: string;
}

/** The whole money-out path: propose, then run it now if small or hold it for a yes. */
export async function runOrHold(
  deps: MoneyDeps,
  kind: ActionKind,
  description: string,
  money: Money,
  input: Record<string, unknown>,
): Promise<ActionOutcome> {
  const proposal = await deps.approvals.create(kind, description, money, input);
  if (needsApproval(money, deps.threshold, deps.currency)) return { status: 'needs_approval', proposal };
  return (await claimAndSettle(deps, proposal.id, 'auto (under threshold)')) ?? { status: 'failed', proposal, result: 'The action vanished before it ran.' };
}

/** A customer paid: run what was waiting on it if small, otherwise leave it pending for a yes. */
/** `alwaysAsk`: the money came in outside PayPal (cash, cheque), so nothing pays out of the balance without a yes. */
export async function releaseWaiting(deps: MoneyDeps, invoiceId: string, opts: { alwaysAsk?: boolean } = {}): Promise<ActionOutcome[]> {
  const released = await deps.approvals.release(invoiceId);
  return Promise.all(
    released.map(async (p) => {
      if (opts.alwaysAsk || needsApproval({ value: p.amount, currency: p.currency }, deps.threshold, deps.currency)) return { status: 'needs_approval' as const, proposal: p };
      return (await claimAndSettle(deps, p.id, 'auto (under threshold, invoice paid)')) ?? { status: 'failed' as const, proposal: p, result: 'The action vanished before it ran.' };
    }),
  );
}

/** A human said yes (on the call or on the dashboard): run it, unless it already ran or is running. */
export async function confirm(
  deps: { approvals: Approvals; provider: PaymentProvider },
  id: string,
  approvedBy: string,
): Promise<ActionOutcome | null> {
  return claimAndSettle(deps, id, approvedBy);
}

async function claimAndSettle(deps: { approvals: Approvals; provider: PaymentProvider }, id: string, by: string): Promise<ActionOutcome | null> {
  const claimed = await deps.approvals.claim(id, by);
  if (claimed) return settle(deps, claimed);
  // Not ours to run: missing, expired (recorded now), or already decided. Say where it stands.
  const p = await deps.approvals.decide(id, true, by);
  if (!p) return null;
  return { status: 'unchanged', proposal: p, result: describeUnchanged(p) };
}

export function describeUnchanged(p: Proposal): string {
  switch (p.status) {
    case 'approved':
      return `This action is already approved and running${p.result ? ` (${p.result})` : ''}; nothing more was done.`;
    case 'done':
    case 'failed':
      return `This action already ran (${p.status})${p.result ? `: ${p.result}` : ''}. Nothing more was done.`;
    case 'waiting':
      return 'This payment is waiting for its invoice to be paid; it cannot be approved before then.';
    default:
      return `This action is ${p.status}, so nothing was done.`;
  }
}

/** What a payout whose outcome PayPal left unclear says until reconcilePayout settles it. */
export const CHECKING = 'Penny is checking with PayPal whether it went through and will update this; do not pay it again.';

async function settle(deps: { approvals: Approvals; provider: PaymentProvider }, p: Proposal): Promise<ActionOutcome> {
  let ok: boolean;
  let result: string;
  try {
    result = await execute(deps.provider, p);
    ok = true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // A payout PayPal may have taken (network error, timeout, 5xx) is not a failure: marking it one invites paying twice.
    // It stays claimed, and the cron re-sends it with the same sender_batch_id, which PayPal will not pay twice.
    if (p.kind === 'payout' && !isDefiniteRejection(e)) {
      result = `PayPal did not answer clearly (${msg}). ${CHECKING}`;
      await deps.approvals.note(p.id, result);
      return { status: 'unknown', proposal: { ...p, result }, result };
    }
    ok = false;
    result = msg;
  }
  await deps.approvals.finish(p.id, ok, result);
  return outcomeOf(deps.approvals, p, ok, result);
}

/** After finish: what the proposal actually is now, since a webhook (failPayout, completePayout) may have got there first. */
async function outcomeOf(approvals: Approvals, p: Proposal, ok: boolean, result: string): Promise<ActionOutcome> {
  const now = (await approvals.get(p.id)) ?? { ...p, status: ok ? ('done' as const) : ('failed' as const), result };
  const status = now.status === 'done' ? 'done' : now.status === 'failed' ? 'failed' : 'unknown';
  return { status, proposal: now, result: now.result ?? result };
}

/** PayPal's way of saying a batch with this sender_batch_id already exists: the first attempt reached it. */
function alreadySent(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /DUPLICATE_REQUEST_ID|SENDER_BATCH_ID_ALREADY_USED|sender_batch_id.*(already|exists|used)/i.test(msg);
}

/**
 * Settles a payout left claimed ('approved') without an outcome by sending it again under the same id: PayPal answers a
 * replayed PayPal-Request-Id with the first batch, refuses a second batch with the same sender_batch_id, and pays it
 * once if the first never arrived. A still-unclear answer leaves it for the next run.
 */
export async function reconcilePayout(deps: { approvals: Approvals; provider: PaymentProvider }, p: Proposal): Promise<ActionOutcome> {
  if (p.kind !== 'payout' || p.status !== 'approved') return { status: 'unchanged', proposal: p, result: describeUnchanged(p) };
  try {
    const result = await execute(deps.provider, p);
    await deps.approvals.finish(p.id, true, result);
    return outcomeOf(deps.approvals, p, true, result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (alreadySent(e)) {
      const result = `PayPal already has this payout from the first attempt (${msg}); its own reports will say if it fails.`;
      await deps.approvals.finish(p.id, true, result);
      return outcomeOf(deps.approvals, p, true, result);
    }
    if (isDefiniteRejection(e)) {
      await deps.approvals.finish(p.id, false, msg);
      return outcomeOf(deps.approvals, p, false, msg);
    }
    const result = `PayPal still did not answer clearly (${msg}). ${CHECKING}`;
    await deps.approvals.note(p.id, result);
    return { status: 'unknown', proposal: { ...p, result }, result };
  }
}
