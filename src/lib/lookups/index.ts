import type { CheckInput } from '../messaging/protocol';
import type { CheckResult } from '../pipeline/schema';
import type { Settings } from '../storage/settings';
import { domainOf, isHttpUrl } from '../util/url';
import { rateDomains, sourceMixNotes, type Credibility } from './credibility';
import { factCheckQuery, searchFactChecks, type FactCheck } from './factcheck';
import { firstCapture, type FirstCapture } from './wayback';

export type { Credibility, FactCheck, FirstCapture };

/** Deterministic evidence gathered beside the model call. Every part is optional and fails alone. */
export interface PreRunLookups {
  factChecks: FactCheck[];
  /** First Wayback capture of the page / post the content came from. */
  pageCapture?: FirstCapture;
}

/** How long each lookup may hold things up. The model waits only for fact-checks; archive dates arrive whenever. */
export const LOOKUP_BUDGET_MS = { forPrompt: 2500, forPromptTwoPass: 4000, archive: 6000, factChecks: 8000 } as const;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

function textOf(input: CheckInput): string {
  switch (input.kind) {
    case 'text':
      return input.text;
    case 'post':
      return input.text;
    case 'page':
      return input.title || input.excerpt || '';
    case 'image':
      return input.alt || input.nearbyText || '';
  }
}

function pageUrlOf(input: CheckInput): string {
  if (input.kind === 'page') return input.url;
  if (input.kind === 'post') return input.permalink ?? input.pageUrl;
  return input.pageUrl;
}

/**
 * Start the lookups that do not depend on the model's answer. Cheap, parallel, individually fallible.
 * `forPrompt` resolves as soon as the fact-check lookup does (or at once when it is off), so the model
 * can be given published fact-checks without waiting for the slower archive query.
 */
export function startLookups(
  input: CheckInput,
  settings: Settings,
  signal: AbortSignal,
  claims?: Promise<string[]>,
): { forPrompt: Promise<string>; all: Promise<PreRunLookups> } {
  const l = settings.lookups;
  // One query from the content itself, plus one per extracted claim (first three) when a first pass ran.
  const queries: Promise<string[]> = claims
    ? claims.then((cs) => [factCheckQuery(textOf(input)), ...cs.slice(0, 3)])
    : Promise.resolve([factCheckQuery(textOf(input))]);
  const factChecks: Promise<Pick<PreRunLookups, 'factChecks'>> =
    l.factChecks && l.factCheckKey
      ? queries
          .then((qs) => Promise.all(Array.from(new Set(qs.filter(Boolean))).map((q) => searchFactChecks(q, l.factCheckKey, signal))))
          .then((lists) => {
            const seen = new Set<string>();
            const factChecks = lists.flat().filter((f) => (seen.has(f.url) ? false : (seen.add(f.url), true)));
            return { factChecks: factChecks.slice(0, 8) };
          })
          .catch(() => ({ factChecks: [] }))
      : Promise.resolve({ factChecks: [] });
  // A hanging fact-check request must not hold the result's evidence (or anything after it) forever.
  const factChecksBounded = withTimeout(factChecks, LOOKUP_BUDGET_MS.factChecks, { factChecks: [] });
  const page = pageUrlOf(input);
  const pageCapture: Promise<FirstCapture | undefined> =
    l.archive && isHttpUrl(page)
      ? withTimeout(
          firstCapture(page, signal).catch(() => undefined),
          LOOKUP_BUDGET_MS.archive,
          undefined,
        )
      : Promise.resolve(undefined);
  const all = Promise.all([factChecksBounded, pageCapture]).then(([fc, pc]) => ({ ...fc, pageCapture: pc }));
  const forPrompt = factChecksBounded.then((fc) => lookupsForPrompt({ ...fc }));
  return { forPrompt, all };
}

/** Things to add once the sources are known: reputation of each outlet, dating of the original source. */
export interface SourceLookups {
  credibility: Record<string, Credibility>;
  mixNotes: string[];
  originalCapture?: FirstCapture;
}

/** `sourceHostsOrUrls`: the sources' domains (or full URLs); grounding redirect URLs would not rate, their domains do. */
export async function sourceLookups(
  sourceHostsOrUrls: string[],
  originalUrl: string | undefined,
  settings: Settings,
  signal: AbortSignal,
): Promise<SourceLookups> {
  const l = settings.lookups;
  const domains = sourceHostsOrUrls.map(domainOf).filter(Boolean);
  const credibility = l.credibility ? await rateDomains([...domains, ...(originalUrl ? [originalUrl] : [])]).catch(() => ({})) : {};
  const originalCapture =
    l.archive && originalUrl && isHttpUrl(originalUrl)
      ? await withTimeout(
          firstCapture(originalUrl, signal).catch(() => undefined),
          LOOKUP_BUDGET_MS.archive,
          undefined,
        )
      : undefined;
  return { credibility, mixNotes: l.credibility ? sourceMixNotes(domains, credibility) : [], originalCapture };
}

/** The deterministic facts the model should see, framed as data it did not produce. */
export function lookupsForPrompt(l: PreRunLookups): string {
  const lines: string[] = [];
  for (const f of l.factChecks.slice(0, 5))
    lines.push(`- ${f.publisher} rated "${f.claim}" as "${f.rating}"${f.reviewDate ? ` (${f.reviewDate.slice(0, 10)})` : ''}: ${f.url}`);
  if (l.pageCapture?.firstCaptured) lines.push(`- The page was first archived by the Wayback Machine on ${l.pageCapture.firstCaptured}.`);
  return lines.join('\n');
}

/** The result with the lookups folded in, as a new object (the original may already be in React state). */
export function attachLookups(result: CheckResult, pre: PreRunLookups, src: SourceLookups): CheckResult {
  return {
    ...result,
    factChecks: pre.factChecks.length ? pre.factChecks : undefined,
    pageCapture: pre.pageCapture,
    originalCapture: src.originalCapture,
    credibility: Object.keys(src.credibility).length ? src.credibility : undefined,
    mixNotes: src.mixNotes.length ? src.mixNotes : undefined,
  };
}
