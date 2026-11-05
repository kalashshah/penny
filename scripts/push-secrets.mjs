#!/usr/bin/env node
// Pushes every non-empty secret in .dev.vars to the deployed worker in one go.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Plain vars live in wrangler.jsonc; PUBLIC_URL in .dev.vars is the local override and must not be pushed.
const PUBLIC_VARS = new Set(['PUBLIC_URL', 'MEMORYHQ_URL', 'LLAMACALLS_URL', 'LLAMACALLS_AVATAR_ID', 'DEFAULT_CURRENCY', 'APPROVAL_THRESHOLD']);
const secrets = {};
for (const line of readFileSync('.dev.vars', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !line.trim().startsWith('#') && m[2] && !PUBLIC_VARS.has(m[1])) secrets[m[1]] = m[2];
}
if (secrets.WEBHOOK_VERIFY === 'off') console.log('note: WEBHOOK_VERIFY=off is being pushed; unset it for real deployments');
writeFileSync('.secrets.tmp.json', JSON.stringify(secrets));
console.log(`pushing ${Object.keys(secrets).length} secrets: ${Object.keys(secrets).join(', ')}`);
const r = spawnSync('npx', ['wrangler', 'secret', 'bulk', '.secrets.tmp.json'], { stdio: 'inherit' });
unlinkSync('.secrets.tmp.json');
process.exit(r.status ?? 1);
