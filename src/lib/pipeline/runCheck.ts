import type { CheckInput } from '../messaging/protocol';
import { toProviderError, type GenEvent, type LlmProvider, type RawSource, type Usage } from '../providers/types';
import { buildSources, resolveClaims, resolveOriginal } from './merge';
import { buildRepairRequest, buildRequest } from './prompts';
import { extractJsonBlock, parseModelResult, type CheckResult, type LocalProvenance, type ModelResult } from './schema';

export type CheckEvent =
  | { type: 'status'; message: string; done?: boolean }
  | { type: 'delta'; text: string }
  | { type: 'searchQueries'; queries: string[] }
  | { type: 'sources'; sources: RawSource[] }
  | { type: 'searchSuggestions'; html: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'result'; result: CheckResult }
  | { type: 'error'; code: string; message: string; details?: string };

export interface RunOptions {
  /** Second, tool-less call to coerce the output into JSON when the first pass didn't. */
  repair?: boolean;
  image?: { base64: string; mime: string; provenance?: LocalProvenance; provenanceFacts?: string; provenanceMetadata?: string };
  /** Pre-run lookups to show the model (see `lookupsForPrompt`). */
  lookups?: string;
}

export async function* runCheck(input: CheckInput, provider: LlmProvider, signal: AbortSignal, opts: RunOptions = {}): AsyncGenerator<CheckEvent> {
  const req = buildRequest(input, {
    imageBase64: opts.image?.base64,
    imageMime: opts.image?.mime,
    provenanceFacts: opts.image?.provenanceFacts,
    provenanceMetadata: opts.image?.provenanceMetadata,
    lookups: opts.lookups,
  });

  let text = '';
  const raw: RawSource[] = [];
  let queries: string[] = [];
  let suggestions: string | undefined;
  let usage: Usage | undefined;

  try {
    for await (const ev of provider.generate(req, signal)) {
      switch (ev.type) {
        case 'delta':
          text += ev.text;
          yield ev;
          break;
        case 'sources':
          raw.push(...ev.sources);
          yield ev;
          break;
        case 'searchQueries':
          queries = ev.queries;
          yield ev;
          break;
        case 'searchSuggestions':
          suggestions = ev.html;
          yield ev;
          break;
        case 'usage':
          usage = ev.usage;
          yield ev;
          break;
        case 'status':
          yield ev;
          break;
        case 'done':
          break;
      }
    }
  } catch (e) {
    const err = toProviderError(e);
    yield { type: 'error', code: err.code, message: err.message, details: err.details };
    return;
  }

  if (signal.aborted) {
    yield { type: 'error', code: 'cancelled', message: 'Cancelled.' };
    return;
  }
  if (!text.trim()) {
    yield {
      type: 'error',
      code: 'empty',
      message: 'The provider returned nothing.',
      details: 'The reply had no text. A local model may have run out of context; try a shorter selection or a bigger context window.',
    };
    return;
  }

  const extracted = extractJsonBlock(text);
  let narrative = extracted.narrative;
  let parsed = parseModelResult(extracted.jsonText);

  if (!parsed.ok && opts.repair !== false && text.trim().length > 0) {
    yield { type: 'status', message: 'Tidying up the answer…' };
    try {
      let repairText = '';
      for await (const ev of provider.generate(buildRepairRequest(text), signal)) {
        if (ev.type === 'delta') repairText += ev.text;
      }
      const again = extractJsonBlock(repairText);
      const p2 = parseModelResult(again.jsonText);
      if (p2.ok) {
        parsed = p2;
        if (!narrative) narrative = text.trim();
      }
    } catch {
      /* keep the degraded result */
    }
  }

  const model: ModelResult | null = parsed.ok ? parsed.value : null;
  const sources = buildSources(model, raw);
  const result: CheckResult = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    input,
    provider: { id: provider.id, label: provider.label, model: provider.model },
    narrative: narrative || (model ? model.verdict.summary : text.trim()),
    verdict: model
      ? { ...model.verdict }
      : { label: 'See assessment', kind: 'unverified', confidence: 'low', summary: 'The answer could not be structured; read the assessment below.' },
    originalSource: resolveOriginal(model, sources),
    claims: resolveClaims(model, sources),
    sources,
    searchQueries: queries,
    searchSuggestionsHtml: suggestions,
    usage,
    notes: model?.notes ?? undefined,
    evidence:
      model?.evidence && (model.evidence.for.length || model.evidence.against.length)
        ? { for: model.evidence.for, against: model.evidence.against }
        : undefined,
    missingContext: model?.missingContext ?? undefined,
    wouldChange: model?.wouldChange ?? undefined,
    provenance: opts.image?.provenance,
    degraded: !model,
    rawText: text,
  };
  yield { type: 'status', message: 'Done', done: true };
  yield { type: 'result', result };
}

/** Convenience for tests and non-streaming callers. */
export async function collectCheck(
  input: CheckInput,
  provider: LlmProvider,
  signal = new AbortController().signal,
  opts?: RunOptions,
): Promise<{ result?: CheckResult; error?: Extract<CheckEvent, { type: 'error' }>; events: CheckEvent[] }> {
  const events: CheckEvent[] = [];
  let result: CheckResult | undefined;
  let error: Extract<CheckEvent, { type: 'error' }> | undefined;
  for await (const ev of runCheck(input, provider, signal, opts)) {
    events.push(ev);
    if (ev.type === 'result') result = ev.result;
    if (ev.type === 'error') error = ev;
  }
  return { result, error, events };
}

export type { GenEvent };
