import { describe, expect, it } from 'vitest';
import { buildClaimsRequest, parseClaims } from '@/lib/pipeline/claims';
import { buildFollowUpRequest } from '@/lib/pipeline/followUp';
import { buildRequest } from '@/lib/pipeline/prompts';
import { collectCheck } from '@/lib/pipeline/runCheck';
import { extractJsonBlock, parseModelResult, repairJson, stripThinking, type CheckResult } from '@/lib/pipeline/schema';
import type { CheckInput } from '@/lib/messaging/protocol';
import type { GenEvent, LlmProvider } from '@/lib/providers/types';

const VERDICT = '"verdict":{"label":"x","kind":"supported","confidence":"high","summary":"Holds up."}';
const BODY = `{"title":"t",${VERDICT},"claims":[],"sources":[]}`;

describe('B2-03: wrong-typed optional fields are dropped per field', () => {
  it('keeps the answer when originalSource.date is a number', () => {
    const r = parseModelResult(`{${VERDICT},"originalSource":{"title":"Census","date":2019,"url":7}}`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.originalSource?.date).toBe('2019');
      expect(r.value.originalSource?.title).toBe('Census');
    }
  });
  it('takes a bare string originalSource as its title, and drops an array', () => {
    const a = parseModelResult(`{${VERDICT},"originalSource":"Reuters, 12 March 2021"}`);
    expect(a.ok && a.value.originalSource?.title).toBe('Reuters, 12 March 2021');
    const b = parseModelResult(`{${VERDICT},"originalSource":["x"]}`);
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.value.originalSource).toBeUndefined();
  });
  it('joins a missingContext list and drops an evidence array', () => {
    const r = parseModelResult(`{${VERDICT},"missingContext":["It omits 2020.","And 2021."],"evidence":["a","b"],"notes":{"x":1},"wouldChange":3}`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.missingContext).toBe('It omits 2020. And 2021.');
      expect(r.value.evidence).toBeUndefined();
      expect(r.value.notes).toBeUndefined();
      expect(r.value.wouldChange).toBe('3');
    }
  });
});

describe('B2-04: enum values are matched case-insensitively', () => {
  it('normalises verdict kind, confidence and claim status', () => {
    const r = parseModelResult(
      '{"verdict":{"label":"x","kind":" Misleading ","confidence":"High","summary":"s"},"claims":[{"text":"c","status":"Supported"}],"sources":[]}',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.verdict.kind).toBe('misleading');
      expect(r.value.verdict.confidence).toBe('high');
      expect(r.value.claims[0]!.status).toBe('supported');
    }
    const o = parseModelResult('{"verdict":{"label":"x","kind":"Older than claimed","confidence":"LOW","summary":"s"}}');
    expect(o.ok && o.value.verdict.kind).toBe('older-than-claimed');
  });
});

describe('B2-05: the claim lister repairs its JSON', () => {
  it('keeps claims after a trailing comma, and accepts {text} items', () => {
    expect(parseClaims('```json\n{"claims":["Crime fell 31% in 2019","The mayor said so",]}\n```')).toEqual(['Crime fell 31% in 2019', 'The mayor said so']);
    expect(parseClaims('{"claims":[{"text":"Crime fell 31% in 2019"}]}')).toEqual(['Crime fell 31% in 2019']);
  });
});

describe('P5B4-01: fence pairing', () => {
  it('finds the JSON behind a stray ``` in the prose', () => {
    const r = extractJsonBlock(`Use \`\`\` to fence code.\n\n\`\`\`json\n${BODY}\n\`\`\``);
    expect(r.jsonText).toBe(BODY);
    expect(r.narrative).toBe('Use ``` to fence code.');
  });
  it('accepts a 4-backtick fence', () => {
    expect(extractJsonBlock(`\`\`\`\`json${BODY}\`\`\``).jsonText).toBe(BODY);
    expect(extractJsonBlock(`Narrative.\n\n\`\`\`\`json\n${BODY}\n\`\`\`\``).jsonText).toBe(BODY);
  });
  it('unwraps a ```markdown wrapper around the whole reply', () => {
    const r = extractJsonBlock(`\`\`\`markdown\nThe claim holds.\n\n\`\`\`json\n${BODY}\n\`\`\`\n\`\`\``);
    expect(r.jsonText).toBe(BODY);
    expect(r.narrative).toBe('The claim holds.');
  });
  it('keeps ``` inside a JSON string value', () => {
    const body = `{${VERDICT},"notes":"wrap code in \`\`\`js fences \`\`\` like this"}`;
    const r = extractJsonBlock(`Text.\n\n\`\`\`json\n${body}\n\`\`\``);
    expect(r.jsonText).toBe(body);
    expect(parseModelResult(r.jsonText).ok).toBe(true);
  });
});

describe('P5B4-03: repairJson ignores braces and commas inside strings', () => {
  it('repairs a trailing comma when a value holds a brace', () => {
    expect(JSON.parse(repairJson('{"a":"{",}'))).toEqual({ a: '{' });
    expect(JSON.parse(repairJson('{"a":"}"'))).toEqual({ a: '}' });
    expect(JSON.parse(repairJson('{"a":"x, }","b":[1,2,],'))).toEqual({ a: 'x, }', b: [1, 2] });
  });
  it('closes a cut-off reply in order', () => {
    expect(JSON.parse(repairJson('{"claims":[{"text":"a"},{"text":"b'))).toEqual({ claims: [{ text: 'a' }, { text: 'b' }] });
  });
});

describe('S8-01: stripThinking', () => {
  it('keeps its behaviour', () => {
    expect(stripThinking('<think>plan</think>\n\nAnswer.')).toBe('Answer.');
    expect(stripThinking('A <THINK>x</think> B')).toBe('A B');
    expect(stripThinking('Answer. <think>never closed')).toBe('Answer. ');
    expect(stripThinking('no tags')).toBe('no tags');
  });
  it('is linear on long hostile streams', () => {
    const decoys = '<think>x</thin'.repeat(40_000); // 560k chars
    const unclosed = '<think>' + 'a'.repeat(500_000);
    const t0 = performance.now();
    stripThinking(decoys);
    stripThinking(unclosed);
    stripThinking('Answer.' + '<think>x</think>'.repeat(30_000));
    expect(performance.now() - t0).toBeLessThan(300);
  });
});

function fakeProvider(replies: string[]): LlmProvider {
  let call = 0;
  return {
    id: 'gemini',
    label: 'Fake',
    model: 'm',
    capabilities: { image: true, webSearch: true, urlContext: false },
    async *generate(): AsyncIterable<GenEvent> {
      yield { type: 'delta', text: replies[call++] ?? '' };
      yield { type: 'done' };
    },
    validate: async () => ({ ok: true }),
  };
}

describe('P5C7-01: a repaired JSON-only reply', () => {
  it('shows the verdict summary, not raw JSON, as the assessment', async () => {
    // Valid JSON with the wrong shape (verdict is a string): the first parse fails, the repair pass succeeds.
    const provider = fakeProvider(['{"verdict":"Supported","summary":"It holds."}', `\`\`\`json\n${BODY}\n\`\`\``]);
    const { result } = await collectCheck({ kind: 'text', text: 'Crime fell', pageUrl: 'https://e.com', pageTitle: 't' }, provider);
    expect(result!.degraded).toBe(false);
    expect(result!.narrative).toBe('Holds up.');
    expect(result!.narrative).not.toContain('{');
  });
});

describe('B6-01 / P5S6-06: local page addresses never reach the prompt', () => {
  const path = 'file:///Users/jane/Documents/medical-letter.html';
  const inputs: CheckInput[] = [
    { kind: 'text', text: 'Crime fell 31% in 2019.', pageUrl: path, pageTitle: 'medical-letter.html' },
    { kind: 'image', srcUrl: 'https://cdn.example/a.jpg', pageUrl: path, pageTitle: 'medical-letter.html', alt: 'a chart' },
    { kind: 'page', url: path, title: 'medical-letter.html', excerpt: 'Crime fell.' },
    {
      kind: 'post',
      site: 'x',
      text: 'Crime fell.',
      permalink: path,
      pageUrl: path,
      images: [],
      links: [],
    } as unknown as CheckInput,
  ];
  for (const input of inputs) {
    it(`${input.kind}: no file path or title in the main request, the claim lister or a follow-up`, () => {
      const all = [
        ...buildRequest(input).parts.map((p) => ('text' in p ? p.text : '')),
        ...buildClaimsRequest(input).parts.map((p) => ('text' in p ? p.text : '')),
        ...buildFollowUpRequest(
          {
            input,
            verdict: { label: 'x', kind: 'supported', confidence: 'high', summary: 's' },
            narrative: 'n',
            claims: [],
            sources: [],
          } as unknown as CheckResult,
          'Why?',
        ).parts.map((p) => ('text' in p ? p.text : '')),
      ].join('\n');
      expect(all).not.toContain('file://');
      expect(all).not.toContain('jane');
      expect(buildRequest(input).urls ?? []).not.toContain(path);
    });
  }
  it('still sends a web page address', () => {
    const text = buildRequest({ kind: 'text', text: 'x', pageUrl: 'https://news.example/a', pageTitle: 'A' }).parts[0]!;
    expect('text' in text && text.text).toContain('page="https://news.example/a"');
  });
});
