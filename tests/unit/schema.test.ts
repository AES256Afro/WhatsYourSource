import { describe, expect, it } from 'vitest';
import { extractJsonBlock, parseModelResult, repairJson } from '@/lib/pipeline/schema';

const GOOD = `The line is widely attributed to Einstein but Quote Investigator traced it to 1981.

\`\`\`json
{
  "verdict": { "label": "Misattributed", "kind": "misattributed", "confidence": "high", "summary": "No evidence Einstein said this." },
  "originalSource": { "title": "Narcotics Anonymous Basic Text", "url": "https://archive.org/x", "publisher": "NA", "date": "1981", "how": "Earliest print appearance." },
  "claims": [ { "text": "Einstein said this", "status": "disputed", "note": "Not in his writings.", "sourceUrls": ["https://quoteinvestigator.com/2017/03/23/same/"] } ],
  "sources": [ { "title": "QI", "url": "https://quoteinvestigator.com/2017/03/23/same/", "date": "2017" } ],
  "notes": null
}
\`\`\``;

describe('extractJsonBlock', () => {
  it('splits narrative and the last fenced json block', () => {
    const { narrative, jsonText } = extractJsonBlock(GOOD);
    expect(narrative).toMatch(/^The line/);
    expect(narrative).not.toContain('```');
    expect(jsonText?.startsWith('{')).toBe(true);
  });
  it('accepts a trailing bare object', () => {
    const { narrative, jsonText } = extractJsonBlock('Some prose.\n{"verdict":{"label":"x","kind":"supported","confidence":"low","summary":""}}');
    expect(narrative).toBe('Some prose.');
    expect(jsonText).toContain('"verdict"');
  });
  it('returns null when there is no JSON', () => {
    expect(extractJsonBlock('just words').jsonText).toBeNull();
  });
});

describe('parseModelResult', () => {
  it('parses a well-formed block', () => {
    const r = parseModelResult(extractJsonBlock(GOOD).jsonText);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.verdict.kind).toBe('misattributed');
      expect(r.value.claims[0]?.sourceUrls).toHaveLength(1);
    }
  });
  it('coerces unknown enum values instead of failing', () => {
    const r = parseModelResult('{"verdict":{"label":"Hmm","kind":"weird","confidence":"sure","summary":"s"},"claims":[{"text":"c","status":"maybe"}]}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.verdict.kind).toBe('unverified');
      expect(r.value.verdict.confidence).toBe('medium');
      expect(r.value.claims[0]?.status).toBe('unverified');
    }
  });
  it('repairs trailing commas and smart quotes', () => {
    const r = parseModelResult('{"verdict":{"label":“x”,"kind":"supported","confidence":"high","summary":"ok",},}');
    expect(r.ok).toBe(true);
  });
  it('fails cleanly on garbage', () => {
    expect(parseModelResult('{not json').ok).toBe(false);
    expect(parseModelResult(null).ok).toBe(false);
  });
});

describe('repairJson', () => {
  it('closes unterminated objects', () => {
    expect(JSON.parse(repairJson('{"a":{"b":1}'))).toEqual({ a: { b: 1 } });
  });
});
