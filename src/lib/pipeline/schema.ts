import { z } from 'zod';
import type { Credibility, FactCheck, FirstCapture } from '../lookups';
import type { CheckInput } from '../messaging/protocol';
import type { ProviderId } from '../storage/settings';
import type { Usage } from '../providers/types';

export const ClaimStatusSchema = z.enum(['supported', 'disputed', 'misleading', 'unverified']);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

export const VerdictKindSchema = z.enum([
  'supported',
  'disputed',
  'misleading',
  'misattributed',
  'unverified',
  'mixed',
  'older-than-claimed',
  'ai-generated',
  'authentic',
  'satire',
]);
export type VerdictKind = z.infer<typeof VerdictKindSchema>;

/** How a verdict kind is coloured and iconed, everywhere (panel, history rows, HTML export). */
export type Tone = 'ok' | 'warn' | 'bad' | 'muted';
export function toneForVerdict(kind: VerdictKind): Tone {
  switch (kind) {
    case 'supported':
    case 'authentic':
      return 'ok';
    case 'disputed':
    case 'ai-generated':
      return 'bad';
    case 'misleading':
    case 'misattributed':
    case 'older-than-claimed':
    case 'mixed':
    case 'satire':
      return 'warn';
    default:
      return 'muted';
  }
}

export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);

const nullableStr = z.string().nullish();
/** A list of non-empty strings, tolerant of nulls, numbers and a missing field. */
const stringList = z.preprocess(
  (v): unknown[] => (Array.isArray(v) ? (v as unknown[]).filter((x) => typeof x === 'string' && x.trim()) : []),
  z.array(z.string()),
);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** What we ask the model to put in its ```json block. Lenient on purpose; the UI copes with gaps. */
export const ModelResultSchema = z.object({
  verdict: z.object({
    label: z
      .string()
      .nullish()
      .transform((v) => v?.trim() || 'Assessment'),
    kind: VerdictKindSchema.catch('unverified'),
    confidence: ConfidenceSchema.catch('medium'),
    summary: z
      .string()
      .nullish()
      .transform((v) => v ?? ''),
  }),
  originalSource: z
    .object({
      title: z
        .string()
        .nullish()
        .transform((v) => v ?? ''),
      url: nullableStr,
      publisher: nullableStr,
      date: nullableStr,
      how: nullableStr,
    })
    .nullish(),
  claims: z.preprocess(
    (v): unknown[] => (Array.isArray(v) ? (v as unknown[]).filter((c) => isRecord(c) && typeof c.text === 'string' && c.text.trim()) : []),
    z.array(
      z.object({
        text: z.string().min(1),
        status: ClaimStatusSchema.catch('unverified'),
        note: z
          .string()
          .nullish()
          .transform((v) => v ?? ''),
        sourceUrls: stringList,
      }),
    ),
  ),
  sources: z.preprocess(
    (v): unknown[] => (Array.isArray(v) ? (v as unknown[]).filter((s) => isRecord(s) && typeof s.url === 'string' && s.url.trim()) : []),
    z.array(
      z.object({
        title: z
          .string()
          .nullish()
          .transform((v) => v ?? ''),
        url: z.string().min(1),
        date: nullableStr,
      }),
    ),
  ),
  evidence: z
    .object({
      for: stringList,
      against: stringList,
    })
    .nullish(),
  missingContext: nullableStr,
  wouldChange: nullableStr,
  notes: nullableStr,
});
export type ModelResult = z.infer<typeof ModelResultSchema>;

export interface Source {
  id: number;
  title: string;
  url: string;
  domain: string;
  date?: string;
  /** The URL came from the search/grounding machinery, not just the model's text. */
  verified: boolean;
}

export interface Claim {
  text: string;
  status: ClaimStatus;
  note: string;
  sourceIds: number[];
}

export interface OriginalSource {
  title: string;
  url?: string;
  publisher?: string;
  date?: string;
  how?: string;
  sourceId?: number;
}

export interface LocalProvenance {
  c2pa?: { present: boolean; summary?: string };
  exif?: Record<string, string>;
  aiHints?: string[];
  phash?: string;
  width?: number;
  height?: number;
  mime?: string;
  bytes?: number;
}

export interface CheckResult {
  id: string;
  createdAt: number;
  input: CheckInput;
  provider: { id: ProviderId; label: string; model: string };
  /** The human-readable part of the answer (everything before the JSON block). */
  narrative: string;
  verdict: { label: string; kind: VerdictKind; confidence: z.infer<typeof ConfidenceSchema>; summary: string };
  originalSource?: OriginalSource;
  claims: Claim[];
  sources: Source[];
  searchQueries: string[];
  searchSuggestionsHtml?: string;
  usage?: Usage;
  notes?: string;
  provenance?: LocalProvenance;
  /** The strongest points each way, so the reader sees the case, not just the verdict. */
  evidence?: { for: string[]; against: string[] };
  missingContext?: string;
  wouldChange?: string;
  /** Deterministic lookups, added beside the model's answer. */
  factChecks?: FactCheck[];
  pageCapture?: FirstCapture;
  originalCapture?: FirstCapture;
  credibility?: Record<string, Credibility>;
  mixNotes?: string[];
  /** Set when the JSON block was missing or invalid; the narrative still shows. */
  degraded?: boolean;
  rawText: string;
}

/** Split the model output into the narrative and the last ```json block (or a trailing bare object). */
export function extractJsonBlock(text: string): { narrative: string; jsonText: string | null } {
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  let last: { start: number; body: string } | null = null;
  while ((match = fence.exec(text)) !== null) {
    const body = match[1] ?? '';
    if (body.trim().startsWith('{')) last = { start: match.index, body };
  }
  if (last) return { narrative: text.slice(0, last.start).trim(), jsonText: last.body.trim() };

  // No fence: look for a trailing top-level object.
  const idx = text.lastIndexOf('\n{');
  if (idx !== -1) {
    const candidate = text.slice(idx + 1).trim();
    if (candidate.endsWith('}')) return { narrative: text.slice(0, idx).trim(), jsonText: candidate };
  }
  return { narrative: text.trim(), jsonText: null };
}

export function parseModelResult(jsonText: string | null): { ok: true; value: ModelResult } | { ok: false; error: string } {
  if (!jsonText) return { ok: false, error: 'no JSON block' };
  const attempts = [jsonText, repairJson(jsonText, false), repairJson(jsonText, true)];
  let lastError = '';
  for (const t of attempts) {
    try {
      const obj: unknown = JSON.parse(t);
      const parsed = ModelResultSchema.safeParse(obj);
      if (parsed.success) return { ok: true, value: parsed.data };
      lastError = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, error: lastError };
}

/**
 * Common LLM JSON slips: trailing commas and an unterminated final brace; optionally smart quotes
 * (last resort, since replacing them inside string values can make things worse).
 */
export function repairJson(s: string, smartQuotes = true): string {
  let t = s.trim();
  if (smartQuotes) t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  t = t.replace(/,\s*([}\]])/g, '$1');
  const opens = (t.match(/{/g) ?? []).length;
  const closes = (t.match(/}/g) ?? []).length;
  if (opens > closes) t += '}'.repeat(opens - closes);
  return t;
}
