import type { CheckInput } from '../messaging/protocol';
import type { Settings } from '../storage/settings';
import { domainOf, isHttpUrl } from '../util/url';
import { rateDomains, sourceMixNotes, type Credibility } from './credibility';
import { factCheckQuery, searchFactChecks, type FactCheck } from './factcheck';
import { firstCapture, type FirstCapture } from './wayback';

export type { Credibility, FactCheck, FirstCapture };

/** Deterministic evidence gathered beside the model call. Every part is optional and fails alone. */
export interface Lookups {
  factChecks: FactCheck[];
  factCheckError?: string;
  /** First Wayback capture of the page / post the content came from. */
  pageCapture?: FirstCapture;
}

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
): { forPrompt: Promise<string>; all: Promise<Lookups> } {
  const l = settings.lookups;
  // One query from the content itself, plus one per extracted claim (first three) when a first pass ran.
  const queries: Promise<string[]> = claims
    ? claims.then((cs) => [factCheckQuery(textOf(input)), ...cs.slice(0, 3)])
    : Promise.resolve([factCheckQuery(textOf(input))]);
  const factChecks: Promise<Pick<Lookups, 'factChecks' | 'factCheckError'>> =
    l.factChecks && l.factCheckKey
      ? queries
          .then((qs) => Promise.all(Array.from(new Set(qs.filter(Boolean))).map((q) => searchFactChecks(q, l.factCheckKey, signal))))
          .then((lists) => {
            const seen = new Set<string>();
            const factChecks = lists.flat().filter((f) => (seen.has(f.url) ? false : (seen.add(f.url), true)));
            return { factChecks: factChecks.slice(0, 8) };
          })
          .catch((e: unknown) => ({ factChecks: [], factCheckError: e instanceof Error ? e.message : String(e) }))
      : Promise.resolve({ factChecks: [] });
  const page = pageUrlOf(input);
  const pageCapture: Promise<FirstCapture | undefined> =
    l.archive && isHttpUrl(page)
      ? withTimeout(
          firstCapture(page, signal).catch(() => undefined),
          6000,
          undefined,
        )
      : Promise.resolve(undefined);
  const all = Promise.all([factChecks, pageCapture]).then(([fc, pc]) => ({ ...fc, pageCapture: pc }));
  const forPrompt = factChecks.then((fc) => lookupsForPrompt({ ...fc }));
  return { forPrompt, all };
}

/** Things to add once the sources are known: reputation of each outlet, dating of the original source. */
export interface SourceEvidence {
  credibility: Record<string, Credibility>;
  mixNotes: string[];
  originalCapture?: FirstCapture;
}

export async function sourceLookups(sourceUrls: string[], originalUrl: string | undefined, settings: Settings, signal: AbortSignal): Promise<SourceEvidence> {
  const l = settings.lookups;
  const domains = sourceUrls.map(domainOf).filter(Boolean);
  const credibility = l.credibility ? await rateDomains([...domains, ...(originalUrl ? [originalUrl] : [])]).catch(() => ({})) : {};
  const originalCapture =
    l.archive && originalUrl && isHttpUrl(originalUrl)
      ? await withTimeout(
          firstCapture(originalUrl, signal).catch(() => undefined),
          6000,
          undefined,
        )
      : undefined;
  return { credibility, mixNotes: l.credibility ? sourceMixNotes(domains, credibility) : [], originalCapture };
}

/** The deterministic facts the model should see, framed as data it did not produce. */
export function lookupsForPrompt(l: Lookups): string {
  const lines: string[] = [];
  for (const f of l.factChecks.slice(0, 5))
    lines.push(`- ${f.publisher} rated "${f.claim}" as "${f.rating}"${f.reviewDate ? ` (${f.reviewDate.slice(0, 10)})` : ''}: ${f.url}`);
  if (l.pageCapture?.firstCaptured) lines.push(`- The page was first archived by the Wayback Machine on ${l.pageCapture.firstCaptured}.`);
  return lines.join('\n');
}
