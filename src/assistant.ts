// The report assistant's OpenAI proxy rules (route: app/(app)/p/reports/ai/responses).

/** OpenAI requests per tenant per UTC day; a Studio chat turn is a handful (tool calls loop), so this is a lot of chatting. */
export const AI_DAILY_CAP = 300;
/** The whole request, data context included. Bigger than any real Studio turn, small enough to bound a bill. */
export const AI_MAX_BODY = 600_000;
const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);

/**
 * Only what the AG Studio adapter sends, and nothing that runs up cost or reaches outside the request
 * (hosted tools, chaining onto other stored responses, background runs, bigger output). The page key is a bearer anyone
 * on a call can see, so the body is treated as untrusted.
 */
export function allowedRequest(body: Record<string, unknown>, model: string): Record<string, unknown> {
  const tools = Array.isArray(body.tools) ? body.tools.filter((t) => (t as { type?: unknown })?.type === 'function') : undefined;
  const effort = (body.reasoning as { effort?: unknown } | undefined)?.effort;
  const out: Record<string, unknown> = {
    model,
    input: body.input,
    instructions: typeof body.instructions === 'string' ? body.instructions : undefined,
    stream: body.stream === true,
    tools,
    tool_choice: body.tool_choice,
    text: body.text,
    reasoning: typeof effort === 'string' && EFFORTS.has(effort) ? { effort } : undefined,
    parallel_tool_calls: typeof body.parallel_tool_calls === 'boolean' ? body.parallel_tool_calls : undefined,
    max_output_tokens: 16_000,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}
