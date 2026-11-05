// Fills a tenant's PayPal sandbox and memory with a believable small studio's books, so calls have something to talk about.
// Run: pnpm run seed [tenantId]   (reads the tenant from remote D1, decrypts with PENNY_MASTER_KEY from .dev.vars)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Sealer } from '../src/crypto';
import { Memory } from '../src/memory';
import { PayPalProvider } from '../src/providers/paypal';

const vars = Object.fromEntries(
  readFileSync('.dev.vars', 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const wranglerVars = readFileSync('wrangler.jsonc', 'utf8');
const MEMORYHQ_URL = /"MEMORYHQ_URL":\s*"([^"]+)"/.exec(wranglerVars)![1];

const sql = `SELECT * FROM tenants${process.argv[2] ? ` WHERE id = '${process.argv[2].replace(/[^\w]/g, '')}'` : ''} LIMIT 1`;
const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'penny', '--remote', '--json', '--command', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const t = JSON.parse(out)[0].results[0];
if (!t) throw new Error('No tenant found');
if (t.paypal_env !== 'sandbox') throw new Error(`Tenant ${t.id} is on ${t.paypal_env}; the seed only runs against sandbox.`);

const sealer = new Sealer(vars.PENNY_MASTER_KEY);
const paypal = new PayPalProvider({ clientId: t.paypal_client_id, clientSecret: await sealer.open(t.paypal_secret_ct, t.paypal_secret_iv), env: 'sandbox', businessName: t.business_name });
// The provider keeps its raw API helper private; the seed needs backdated invoices and recorded payments it has no method for.
const api = (paypal as unknown as { api: <T>(m: string, p: string, b?: unknown, h?: Record<string, string>) => Promise<T> }).api.bind(paypal);
const memory = new Memory({ MEMORYHQ_URL, MEMORYHQ_WORKSPACE: vars.MEMORYHQ_WORKSPACE, MEMORYHQ_KEY: vars.MEMORYHQ_KEY } as never, t.id);

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

interface Seed {
  name: string;
  email: string;
  item: string;
  amount: number;
  issued: number; // days from today
  due: number;
  paid?: { amount: number; on: number; method: 'BANK_TRANSFER' | 'PAYPAL' | 'CHECK' };
}

const INVOICES: Seed[] = [
  { name: 'Acme Corp', email: 'billing@acme.example.com', item: 'August product sprint', amount: 3600, issued: -60, due: -30, paid: { amount: 3600, on: -18, method: 'BANK_TRANSFER' } },
  { name: 'Acme Corp', email: 'billing@acme.example.com', item: 'September product sprint', amount: 4000, issued: -43, due: -13 },
  { name: 'Acme Corp', email: 'billing@acme.example.com', item: 'October product sprint', amount: 4000, issued: -2, due: 28 },
  { name: 'Brightside Studio', email: 'accounts@brightside.example.com', item: 'Brand refresh: deposit', amount: 1200, issued: -25, due: -11, paid: { amount: 1200, on: -12, method: 'PAYPAL' } },
  { name: 'Brightside Studio', email: 'accounts@brightside.example.com', item: 'Brand refresh: phase 1', amount: 2400, issued: -4, due: 10 },
  { name: 'Northwind Labs', email: 'ap@northwind.example.com', item: 'Website maintenance: September', amount: 850, issued: -39, due: -9 },
  { name: 'Northwind Labs', email: 'ap@northwind.example.com', item: 'Payments API integration', amount: 2000, issued: -20, due: 10, paid: { amount: 500, on: -6, method: 'BANK_TRANSFER' } },
  { name: 'Pixel & Co', email: 'hello@pixelco.example.com', item: 'Landing page build', amount: 1200, issued: -21, due: -7, paid: { amount: 1200, on: -11, method: 'PAYPAL' } },
];

const existing = await paypal.listInvoices({ status: 'all', limit: 100 });
if (existing.some((i) => i.memo?.includes('[seed]')) && !process.argv.includes('--force')) {
  console.log('This sandbox is already seeded (invoices with [seed] in the memo). Pass --force to add another set.');
  process.exit(0);
}

for (const s of INVOICES) {
  const { invoice_number } = await api<{ invoice_number: string }>('POST', '/v2/invoicing/generate-next-invoice-number');
  const created = await api<{ id?: string; href?: string }>('POST', '/v2/invoicing/invoices', {
    detail: {
      currency_code: 'USD',
      invoice_number,
      invoice_date: day(s.issued),
      memo: `${s.item} [seed]`,
      payment_term: { term_type: 'DUE_ON_DATE_SPECIFIED', due_date: day(s.due) },
    },
    invoicer: { business_name: t.business_name },
    primary_recipients: [{ billing_info: { email_address: s.email, name: { given_name: s.name } } }],
    items: [{ name: s.item, quantity: '1', unit_amount: { currency_code: 'USD', value: s.amount.toFixed(2) }, unit_of_measure: 'QUANTITY' }],
  }, { Prefer: 'return=representation' });
  const id = created.id ?? created.href!.split('/').pop()!;
  await api('POST', `/v2/invoicing/invoices/${id}/send`, { send_to_recipient: true, send_to_invoicer: false });
  if (s.paid) {
    await api('POST', `/v2/invoicing/invoices/${id}/payments`, { method: s.paid.method, payment_date: day(s.paid.on), amount: { currency_code: 'USD', value: s.paid.amount.toFixed(2) } });
  }
  console.log(`invoice ${invoice_number}  ${s.name.padEnd(18)} ${s.item.padEnd(32)} $${s.amount}${s.paid ? `  (paid $${s.paid.amount})` : ''}`);
}

// One past contractor payout so "what have we paid Sam" has an answer. Sandbox payouts to unregistered emails stay unclaimed, which is fine.
try {
  const p = await paypal.payout({ recipientEmail: 'sam.designs@example.com', amount: { value: 250, currency: 'USD' }, note: 'Logo concepts for Brightside', idempotencyKey: `seed-${t.id}-sam` });
  console.log(`payout ${p.id}  Sam Rivera  $250  ${p.status}`);
} catch (e) {
  console.log(`payout skipped: ${e instanceof Error ? e.message : String(e)}`);
}

const FACTS = [
  'Acme Corp is our biggest client. They are billed a monthly product sprint, net 30, and usually pay one to three weeks late; a polite reminder from Penny is enough, no late fees.',
  'Acme Corp contact for invoices is Dana Whitfield in accounts payable (billing@acme.example.com).',
  'Brightside Studio is a brand refresh project: deposit paid, phase 1 invoiced, phase 2 (about $2,400) will be billed when the new logo is approved.',
  'Northwind Labs pays in instalments. They paid $500 towards the Payments API integration and agreed to clear the rest by the due date.',
  'Northwind Labs September maintenance invoice ($850) is late; their AP team said it was stuck in approval.',
  'Pixel & Co always pays early through PayPal. Good client to offer more work to.',
  'Sam Rivera (sam.designs@example.com) is our freelance designer. Sam is paid through PayPal Payouts on delivery of each piece of work, no invoice needed.',
  'Priya Nair (priya.dev@example.com) is our contract developer, paid $400 per completed milestone through PayPal Payouts.',
  'The owner wants anything over $100 leaving the account approved out loud on a call.',
];
if (memory.enabled) {
  for (const f of FACTS) await memory.remember(f, false);
  console.log(`memory: ${FACTS.length} facts saved`);
} else {
  console.log('memory: off for this tenant, facts skipped');
}
