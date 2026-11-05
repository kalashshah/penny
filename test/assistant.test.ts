import { describe, expect, it } from 'vitest';
import { allowedRequest } from '../src/assistant';
import { takeDaily } from '../src/usage';
import { fakeD1 } from './helpers/d1';

describe('allowedRequest', () => {
  it('keeps what the Studio adapter sends and forces the model and output cap', () => {
    const fn = { type: 'function', name: 'f', parameters: {} };
    const out = allowedRequest(
      {
        model: 'gpt-x',
        input: [{ role: 'user', content: 'hi' }],
        instructions: 'be brief',
        stream: true,
        tools: [fn, { type: 'web_search' }, { type: 'code_interpreter' }],
        tool_choice: 'auto',
        text: { format: { type: 'text' } },
        reasoning: { effort: 'medium', summary: 'detailed' },
        parallel_tool_calls: true,
        max_output_tokens: 1_000_000,
        previous_response_id: 'resp_someone_elses',
        background: true,
        metadata: { a: 1 },
      },
      'gpt-5.4-mini',
    );
    expect(out).toEqual({
      model: 'gpt-5.4-mini',
      input: [{ role: 'user', content: 'hi' }],
      instructions: 'be brief',
      stream: true,
      tools: [fn],
      tool_choice: 'auto',
      text: { format: { type: 'text' } },
      reasoning: { effort: 'medium' },
      parallel_tool_calls: true,
      max_output_tokens: 16_000,
    });
  });
});

describe('takeDaily', () => {
  it('allows up to the cap per tenant per day', async () => {
    const db = fakeD1();
    const now = Date.UTC(2026, 10, 5, 12);
    const takes = [];
    for (let n = 0; n < 4; n++) takes.push(await takeDaily(db, 't_1', 'ai', 3, now));
    expect(takes).toEqual([true, true, true, false]);
    expect(await takeDaily(db, 't_2', 'ai', 3, now)).toBe(true);
    expect(await takeDaily(db, 't_1', 'ai', 3, now + 86_400_000)).toBe(true);
  });
});
