import { Approvals } from './approvals';
import { sendEmail } from './email';
import type { Env } from './env';
import { createAlert } from './events';
import { fetchForecastInputs, forecast } from './forecast';
import { providerFor } from './providers';
import type { Invoice } from './providers/types';
import { Tenants, type Tenant } from './tenants';

const DAY = 86_400_000;
/** Monday 14:00 UTC: morning on the US east coast, afternoon in Europe. */
const SEND_HOUR_UTC = 14;
const LOOKAHEAD_DAYS = 14;

/** The Monday (UTC) of the week `now` falls in, as yyyy-mm-dd. */
export function weekOf(now: number): string {
  const d = new Date(now);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday)).toISOString().slice(0, 10);
}

/** From Monday's send hour on, this week's digest is due; a week missed on Monday goes out on the next run. */
export function digestDue(now: number): boolean {
  return now >= Date.parse(`${weekOf(now)}T00:00:00Z`) + SEND_HOUR_UTC * 3_600_000;
}

export interface DigestInput {
  business: string;
  currency: string;
  now: number;
  open: Invoice[];
  paid: Invoice[];
  pending: { amount: number; currency: string }[];
  waitingCount: number;
  /** The forecast's lowest balance over the lookahead, when the rail shared a balance. */
  low?: { date: string; balance: number } | null;
}

const say = (c: string, n: number) => `${c} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const round = (n: number) => Math.round(n * 100) / 100;

/** The week in a subject and a few lines. Pure, tested; the email and the alert both use it. */
export function buildDigest(i: DigestInput): { subject: string; lines: string[] } {
  const c = i.currency;
  const since = i.now - 7 * DAY;
  const today = new Date(i.now).toISOString().slice(0, 10);
  const collected = i.paid.filter((x) => x.status === 'paid' && x.paidAt && Date.parse(x.paidAt) >= since && Date.parse(x.paidAt) <= i.now);
  const collectedSum = round(collected.reduce((a, x) => a + (x.paid?.value ?? x.total.value), 0));
  const open = i.open.filter((x) => x.status === 'sent' || x.status === 'partially_paid');
  const outstanding = round(open.reduce((a, x) => a + x.due.value, 0));
  const overdue = open.filter((x) => x.dueDate && x.dueDate.slice(0, 10) < today);
  const overdueSum = round(overdue.reduce((a, x) => a + x.due.value, 0));
  const pendingSum = round(i.pending.filter((p) => p.currency === c).reduce((a, p) => a + p.amount, 0));

  const lines = [
    collected.length ? `Collected in the last 7 days: ${say(c, collectedSum)} from ${plural(collected.length, 'invoice')}.` : 'Nothing was collected in the last 7 days.',
    open.length
      ? `Outstanding: ${say(c, outstanding)} on ${plural(open.length, 'open invoice')}${overdue.length ? `, ${overdue.length} overdue (${say(c, overdueSum)})` : ', none overdue'}.`
      : 'No open invoices.',
    i.pending.length ? `Waiting for your yes: ${plural(i.pending.length, 'payment')}${pendingSum ? ` (${say(c, pendingSum)})` : ''}.` : 'Nothing is waiting for your yes.',
  ];
  if (i.waitingCount) lines.push(`Pay-when-paid: ${plural(i.waitingCount, 'payout')} waiting for a customer to pay.`);
  if (i.low) lines.push(`Lowest cash point in the next ${LOOKAHEAD_DAYS} days: ${say(c, i.low.balance)} on ${i.low.date}${i.low.balance < 0 ? ' (below zero)' : ''}.`);

  const head = [collected.length ? `${say(c, collectedSum)} collected` : 'nothing collected', overdue.length ? `${overdue.length} overdue` : ''].filter(Boolean).join(', ');
  return { subject: `${i.business}: your week with Penny (${head})`, lines };
}

/** Builds one tenant's digest from the rail and the approvals table. */
async function digestFor(env: Env, tenants: Tenants, t: Tenant, now: number): Promise<{ subject: string; lines: string[] }> {
  const provider = await providerFor(env, tenants, t);
  const currency = t.currency || 'USD';
  // The forecast's own fetch already has both invoice lists and the proposals, so the low point costs no extra calls.
  const inputs = await fetchForecastInputs(provider, new Approvals(env.DB, t.id), currency);
  const f = forecast({ ...inputs, horizon: LOOKAHEAD_DAYS });
  return buildDigest({
    business: t.businessName,
    currency,
    now,
    open: inputs.open,
    paid: inputs.paid,
    pending: inputs.proposals.filter((p) => p.status === 'pending'),
    waitingCount: inputs.proposals.filter((p) => p.status === 'waiting').length,
    low: f.startKnown ? f.low : null,
  });
}

/**
 * Weekly: each connected tenant gets the digest once, by email to the owner when an email binding is
 * configured, otherwise as a dashboard alert. A few tenants per run (every five minutes), so a big tenant list
 * spreads over the runs instead of blowing one run's subrequest budget.
 */
export async function sendDigests(env: Env, now = Date.now(), limit = 3): Promise<number> {
  if (!digestDue(now)) return 0;
  const week = weekOf(now);
  const tenants = new Tenants(env);
  let sent = 0;
  // Tenants already done this week are left out in SQL, so every tenant is reached however many there are.
  for (const t of await tenants.listConnectedWithoutDigest(week, limit)) {
    // The INSERT is the lock: another run that got here first owns this tenant's week.
    const claimed = await env.DB.prepare('INSERT OR IGNORE INTO digests (tenant_id, week, sent_at) VALUES (?, ?, ?)').bind(t.id, week, now).run();
    if (!claimed.meta.changes) continue;
    try {
      const d = await digestFor(env, tenants, t, now);
      const to = env.EMAIL ? await env.DB.prepare('SELECT email FROM user WHERE id = ?').bind(t.ownerUserId).first<string>('email') : null;
      if (to) {
        const link = `${env.PUBLIC_URL}/`;
        await sendEmail(env, { to, subject: d.subject, text: `${d.lines.join('\n')}\n\nOpen Penny: ${link}`, html: digestHtml(t.businessName, d.lines, link) });
      } else {
        await createAlert(env, t.id, { eventId: `digest:${week}`, title: d.subject, detail: d.lines.join(' '), page: `${env.PUBLIC_URL}/p/summary?k=${encodeURIComponent(t.pageKey)}` });
      }
      await env.DB.prepare('UPDATE digests SET via = ? WHERE tenant_id = ? AND week = ?').bind(to ? 'email' : 'alert', t.id, week).run();
      sent++;
    } catch (e) {
      // Give the week back so the next hourly run tries again.
      await env.DB.prepare('DELETE FROM digests WHERE tenant_id = ? AND week = ?').bind(t.id, week).run();
      console.error('digest_failed', { tenant: t.id, error: String(e) });
    }
  }
  return sent;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function digestHtml(business: string, lines: string[], link: string): string {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#15171c;padding:32px"><div style="max-width:520px;margin:0 auto"><div style="font-weight:700;font-size:20px">Penny</div><p style="margin:20px 0 12px">Here is the week at ${esc(business)}.</p><ul style="padding-left:18px;line-height:1.6">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul><p style="margin-top:24px"><a href="${esc(link)}" style="background:#15171c;color:#fff;border-radius:10px;padding:10px 16px;text-decoration:none">Open Penny</a></p></div></body></html>`;
}
