import { currentOwner, getEnv, tenantByPageKey } from '@/context';
import { AI_DAILY_CAP, AI_MAX_BODY, allowedRequest } from '@/assistant';
import { takeDaily } from '@/usage';

const fail = (status: number, message: string) => Response.json({ error: { message } }, { status });

// AG Studio's OpenAI adapter (studio.tsx) posts here; this adds the key and streams OpenAI's reply back.
// The page key is the bearer (the adapter only sets Authorization), or the owner's session.
export async function POST(req: Request) {
  const env = getEnv();
  const k = req.headers.get('authorization')?.replace(/^Bearer /, '');
  const tenant = (await tenantByPageKey(k)) ?? (await currentOwner())?.tenant;
  if (!tenant) return fail(401, 'Sign in first.');
  if (!env.OPENAI_API_KEY) return fail(503, 'The report assistant is not configured on this deployment.');
  const raw = await req.text();
  if (raw.length > AI_MAX_BODY) return fail(413, 'That request is too large for the report assistant; narrow the data or start a new chat.');
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, 'Request body must be JSON.');
  }
  if (!body || typeof body !== 'object' || body.input === undefined) return fail(400, 'Request needs an input.');
  const model = env.OPENAI_MODEL ?? 'gpt-5.4-mini';
  if (body.model && body.model !== model) return fail(400, `Model "${String(body.model)}" is not enabled.`);
  if (!(await takeDaily(env.DB, tenant.id, 'ai', AI_DAILY_CAP))) return fail(429, 'The report assistant has reached today\'s limit for this business. It resets at midnight UTC.');
  const upstream = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify(allowedRequest(body, model)),
    signal: req.signal,
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
  });
}
