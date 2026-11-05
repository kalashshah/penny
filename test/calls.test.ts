import { describe, expect, it } from 'vitest';
import { transcriptText } from '../src/calls';
import { buildInstructions } from '../src/persona';

describe('transcriptText', () => {
  it('keeps final lines, names speakers, skips junk', () => {
    const ndjson = [
      JSON.stringify({ role: 'assistant', speakerName: null, text: 'Hi, it is Penny.', final: true }),
      JSON.stringify({ role: 'user', speakerName: 'Alex', text: 'Pay Sam fifty dollars.', final: true }),
      JSON.stringify({ role: 'user', speakerName: 'Alex', text: 'Pay Sam', final: false }),
      JSON.stringify({ role: 'user', speakerName: null, text: '   ', final: true }),
      '{not json',
    ].join('\n');
    expect(transcriptText(ndjson)).toBe('Penny: Hi, it is Penny.\nAlex: Pay Sam fifty dollars.');
  });
});

describe('buildInstructions', () => {
  it('stays under the LlamaCalls limit even with a huge memory block', () => {
    const text = buildInstructions({ business: 'Acme', currency: 'USD', threshold: 100, memoryPrompt: 'x'.repeat(20_000), snapshot: 'Nothing overdue.', alert: 'Invoice 0042 was paid' });
    expect(text.length).toBeLessThanOrEqual(8_000);
    expect(text).toContain('Invoice 0042 was paid');
    expect(text).toContain('USD 100');
  });
});
