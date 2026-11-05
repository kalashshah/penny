#!/usr/bin/env node
// Fills in generated secrets, checks the keys you pasted, and prints what is left to do.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (!existsSync('.dev.vars')) {
  writeFileSync('.dev.vars', readFileSync('.dev.vars.example', 'utf8'));
  console.log('created .dev.vars from the example');
}
let text = readFileSync('.dev.vars', 'utf8');
const get = (k) => text.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() ?? '';
const set = (k, v) => {
  text = text.match(new RegExp(`^${k}=.*$`, 'm')) ? text.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : `${text.trimEnd()}\n${k}=${v}\n`;
};
if (!get('BETTER_AUTH_SECRET')) set('BETTER_AUTH_SECRET', randomBytes(32).toString('hex'));
if (!get('PENNY_MASTER_KEY')) set('PENNY_MASTER_KEY', randomBytes(32).toString('base64'));
writeFileSync('.dev.vars', text);
console.log('secrets: BETTER_AUTH_SECRET and PENNY_MASTER_KEY present');

const publicUrl = (process.env.PUBLIC_URL || readFileSync('wrangler.jsonc', 'utf8').match(/"PUBLIC_URL":\s*"([^"]+)"/)?.[1] || 'http://localhost:8787').replace(/\/$/, '');
console.log(`public url (wrangler.jsonc): ${publicUrl}`);
console.log(`google oauth redirect uri: ${publicUrl}/api/auth/callback/google`);

const key = get('LLAMACALLS_KEY');
if (key) {
  const base = 'https://llamacalls.com';
  const res = await fetch(`${base}/api/avatars`, { headers: { Authorization: `Bearer ${key}` } });
  if (res.ok) {
    const j = await res.json();
    const faces = [...(j.avatars ?? []), ...(j.catalogue ?? [])].slice(0, 6);
    console.log('llamacalls: key OK' + (faces.length ? '; faces you can set as LLAMACALLS_AVATAR_ID in wrangler.jsonc:\n' + faces.map((f) => `  ${f.id}  ${f.label ?? ''}`).join('\n') : ''));
  } else console.log(`llamacalls: key rejected (${res.status})`);
} else console.log('llamacalls: LLAMACALLS_KEY missing (calls will not start)');

const memWorkspace = get('MEMORYHQ_WORKSPACE');
const memKey = get('MEMORYHQ_KEY');
const memUrl = readFileSync('wrangler.jsonc', 'utf8').match(/"MEMORYHQ_URL":\s*"([^"]+)"/)?.[1];
if (memWorkspace && memKey && memUrl) {
  const res = await fetch(`${memUrl}/api/${memWorkspace}/profile`, { headers: { 'x-api-key': memKey, 'x-end-user-id': 'penny-setup-check' } });
  console.log(res.ok ? 'memoryhq: workspace and key OK' : `memoryhq: workspace or key rejected (${res.status})`);
} else console.log('memoryhq: MEMORYHQ_WORKSPACE / MEMORYHQ_KEY missing (tenants will run without memory)');

console.log('\nnext: pnpm run db:local && pnpm dev   # then open ' + publicUrl + '/login');
