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

/** An optional detail (a date, a title): a number becomes text, anything else unusable becomes nothing. It can never fail the answer. */
const looseStr = z.preprocess((v) => (typeof v === 'number' ? String(v) : typeof v === 'string' ? v : undefined), z.string().nullish());
/** Optional prose (missing context, notes): a list of sentences is joined, anything else unusable becomes nothing. */
const looseText = z.preprocess(
  (v) =>
    typeof v === 'string'
      ? v
      : typeof v === 'number'
        ? String(v)
        : Array.isArray(v)
          ? (v as unknown[]).filter((x): x is string => typeof x === 'string' && !!x.trim()).join(' ') || undefined
          : undefined,
  z.string().nullish(),
);
/** A list of non-empty strings, tolerant of nulls, numbers and a missing field; any other shape is an empty list. */
const stringList = z.preprocess(
  (v): unknown[] => (Array.isArray(v) ? (v as unknown[]).filter((x) => typeof x === 'string' && x.trim()) : []),
  z.array(z.string()),
);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Enum values as models write them: "Misleading", " HIGH ", "older than claimed". */
const enumText = (v: unknown) =>
  typeof v === 'string'
    ? v
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, '-')
    : v;
const textOr = (fallback: string) => looseStr.transform((v) => v ?? fallback);

/** What we ask the model to put in its ```json block. Lenient on purpose; the UI copes with gaps. */
export const ModelResultSchema = z.object({
  /** A headline and a broad topic for the user's own records (history, exports). */
  title: looseStr,
  topic: looseStr,
  verdict: z.object({
    label: looseStr.transform((v) => v?.trim() || 'Assessment'),
    kind: z.preprocess(enumText, VerdictKindSchema).catch('unverified'),
    confidence: z.preprocess(enumText, ConfidenceSchema).catch('medium'),
    summary: textOr(''),
  }),
  // A bare string names the source; any other shape that is not an object is dropped, not fatal.
  originalSource: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() ? { title: v } : undefined) : isRecord(v) ? v : undefined),
    z
      .object({
        title: textOr(''),
        url: looseStr,
        publisher: looseStr,
        date: looseStr,
        how: looseStr,
      })
      .nullish(),
  ),
  claims: z.preprocess(
    (v): unknown[] => (Array.isArray(v) ? (v as unknown[]).filter((c) => isRecord(c) && typeof c.text === 'string' && c.text.trim()) : []),
    z.array(
      z.object({
        text: z.string().min(1),
        status: z.preprocess(enumText, ClaimStatusSchema).catch('unverified'),
        note: textOr(''),
        sourceUrls: stringList,
      }),
    ),
  ),
  sources: z.preprocess(
    (v): unknown[] => (Array.isArray(v) ? (v as unknown[]).filter((s) => isRecord(s) && typeof s.url === 'string' && s.url.trim()) : []),
    z.array(
      z.object({
        title: textOr(''),
        url: z.string().min(1),
        date: looseStr,
      }),
    ),
  ),
  evidence: z.preprocess(
    (v) => (isRecord(v) ? v : undefined),
    z
      .object({
        for: stringList,
        against: stringList,
      })
      .nullish(),
  ),
  timeline: z.preprocess(
    (v): unknown[] => (Array.isArray(v) ? (v as unknown[]).filter((t) => isRecord(t) && typeof t.event === 'string' && t.event.trim()) : []),
    z.array(z.object({ date: looseStr, event: z.string().min(1), sourceUrl: looseStr })),
  ),
  missingContext: looseText,
  wouldChange: looseText,
  notes: looseText,
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

/** One dated step in the story behind the content. */
export interface TimelineEvent {
  date?: string;
  event: string;
  sourceId?: number;
}

/** Broad subjects a check is filed under, for the user's own records. */
export const TOPICS = ['politics', 'health', 'science', 'technology', 'business', 'world', 'society', 'history', 'entertainment', 'sports', 'other'] as const;
export type Topic = (typeof TOPICS)[number];

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
  /** Set when the file's metadata could not be read at all (e.g. 'WebP'), so its absence is not a finding. */
  metadataUnread?: string;
}

/** A further question about a finished check, and the model's answer in prose. */
export interface FollowUp {
  id: string;
  createdAt: number;
  question: string;
  answer: string;
  /** The model that answered this one (the check's own, unless that provider is no longer set up). */
  provider: { id: ProviderId; label: string; model: string };
  /** Pages the provider's search actually retrieved for this answer. */
  sources: { title: string; url: string; domain: string }[];
  usage?: Usage;
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
  /** A headline and topic the model gave the check, for history and exports. */
  title?: string;
  topic?: Topic;
  /** Dated events, earliest first, when the question asked for them or the order matters. */
  timeline?: TimelineEvent[];
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
  /** Set when the JSON block was missing or invalid, or the answer was cut off; the narrative still shows. */
  degraded?: boolean;
  /** The model stopped before finishing (output limit, or a tool/server stop); the answer is incomplete. */
  truncated?: boolean;
  rawText: string;
  /** Questions asked after the result, oldest first. */
  followUps?: FollowUp[];
}

/**
 * Reasoning models (Qwen3, DeepSeek-R1 via Ollama/LM Studio) wrap their thinking in <think> tags; none
 * of it is the answer. An unclosed <think> drops the rest. One forward pass, so it stays linear on long
 * streams (it runs on every flush of the live view).
 */
export function stripThinking(text: string): string {
  const open = /<think>/gi;
  const close = /<\/think>\s*/gi;
  let out = '';
  let at = 0;
  for (;;) {
    open.lastIndex = at;
    const o = open.exec(text);
    if (!o) return out + text.slice(at);
    out += text.slice(at, o.index);
    close.lastIndex = o.index + o[0].length;
    const c = close.exec(text);
    if (!c) return out;
    at = c.index + c[0].length;
  }
}

/** Where a fenced JSON body could start: a run of 3+ backticks at the start of a line, or one directly followed by "json". */
const FENCE_OPEN = /(^|\n)[ \t]*(`{3,})[ \t]*(?:json)?[ \t]*\n?|`{3,}json[ \t]*\n?/gi;

function parsesAsJson(t: string): boolean {
  for (const c of [t, repairJson(t, false)]) {
    try {
      JSON.parse(c);
      return true;
    } catch {
      /* try the next */
    }
  }
  return false;
}

/**
 * Split the model output into the narrative and the last ```json block (or a trailing bare object).
 * Tolerates 4-backtick fences, stray ``` in the prose, a ```markdown wrapper around the whole reply
 * and ``` inside JSON string values.
 */
export function extractJsonBlock(text: string): { narrative: string; jsonText: string | null } {
  const candidates: { start: number; body: string }[] = [];
  FENCE_OPEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCE_OPEN.exec(text)) !== null) {
    const start = m.index + (m[1] ?? '').length;
    const bodyStart = m.index + m[0].length;
    if (!text.slice(bodyStart).trimStart().startsWith('{')) continue;
    candidates.push({ start, body: fencedBody(text, bodyStart) });
  }
  if (candidates.length) {
    // The last block that parses; ``` inside an earlier block's string values can look like an opener.
    const chosen = [...candidates].reverse().find((c) => parsesAsJson(c.body)) ?? candidates[candidates.length - 1]!;
    const narrative = text
      .slice(0, chosen.start)
      .replace(/^\s*`{3,}[\w-]*[ \t]*\n/, '') // a ```markdown (or bare) wrapper opened before the narrative
      .trim();
    return { narrative, jsonText: chosen.body };
  }

  // Native JSON mode (Gemini responseMimeType, OpenAI response_format): the whole reply is the object, no fence.
  const whole = text.trim();
  if (whole.startsWith('{') && whole.endsWith('}')) return { narrative: '', jsonText: whole };

  // No fence: look for a trailing top-level object.
  const idx = text.lastIndexOf('\n{');
  if (idx !== -1) {
    const candidate = text.slice(idx + 1).trim();
    if (candidate.endsWith('}')) return { narrative: text.slice(0, idx).trim(), jsonText: candidate };
  }
  return { narrative: text.trim(), jsonText: null };
}

/** The JSON body after an opener: up to the last closing fence that ends an object, else to the end. */
function fencedBody(text: string, bodyStart: number): string {
  const closers: number[] = [];
  const re = /`{3,}/g;
  re.lastIndex = bodyStart;
  let c: RegExpExecArray | null;
  while ((c = re.exec(text)) !== null) closers.push(c.index);
  for (let i = closers.length - 1; i >= 0; i--) {
    const body = text.slice(bodyStart, closers[i]).trim();
    if (body.endsWith('}')) return body;
  }
  const rest = text
    .slice(bodyStart)
    .replace(/`+\s*$/, '')
    .trim();
  return closers.length && !rest.endsWith('}') ? text.slice(bodyStart, closers[0]).trim() : rest;
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
 * Common LLM JSON slips: trailing commas and unterminated brackets/braces (a cut-off reply); optionally
 * smart quotes (last resort, since replacing them inside string values can make things worse). One pass
 * that knows when it is inside a string, so braces and commas in values are left alone.
 */
export function repairJson(s: string, smartQuotes = true): string {
  let t = s.trim();
  if (smartQuotes) t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  let out = '';
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let pendingComma = -1; // index in `out` of a comma followed so far only by whitespace
  for (const ch of t) {
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '}' || ch === ']') {
      if (pendingComma !== -1) out = out.slice(0, pendingComma) + out.slice(pendingComma + 1);
      pendingComma = -1;
      stack.pop();
      out += ch;
      continue;
    }
    if (/\s/.test(ch)) {
      out += ch;
      continue;
    }
    pendingComma = -1;
    if (ch === '"') inString = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === ',') pendingComma = out.length;
    out += ch;
  }
  if (inString) out += '"';
  if (pendingComma !== -1) out = out.slice(0, pendingComma) + out.slice(pendingComma + 1);
  return out + stack.reverse().join('');
}
