import { currentOwner, getEnv, tenantByPageKey } from '@/context';

const fail = (status: number, message: string) => Response.json({ error: { message } }, { status });

// AG Studio's OpenAI adapter (studio.tsx) posts here; this adds the key and streams OpenAI's reply back.
// The page key is the bearer (the adapter only sets Authorization), or the owner's session.
export async function POST(req: Request) {
  const env = getEnv();
  const k = req.headers.get('authorization')?.replace(/^Bearer /, '');
  const tenant = (await tenantByPageKey(k)) ?? (await currentOwner())?.tenant;
  if (!tenant) return fail(401, 'Sign in first.');
  if (!env.OPENAI_API_KEY) return fail(503, 'The report assistant is not configured on this deployment.');
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Request body must be JSON.');
  }
  const model = env.OPENAI_MODEL ?? 'gpt-5.4-mini';
  if (body.model && body.model !== model) return fail(400, `Model "${String(body.model)}" is not enabled.`);
  const upstream = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    // ponytail: per-turn output cap only; add a per-tenant daily budget if the assistant gets real traffic.
    body: JSON.stringify({ ...body, model, max_output_tokens: 16_000 }),
    signal: req.signal,
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
  });
}
