import { stripTracking, truncate } from '../util/url';

/**
 * Published fact-checks via Google's Fact Check Tools API (ClaimReview markup aggregated from
 * PolitiFact, Snopes, AFP, Full Fact, Reuters and many more). Free; needs an API key from Google
 * Cloud with the Fact Check Tools API enabled. No model involved, so it works with every provider.
 */
export interface FactCheck {
  claim: string;
  claimant?: string;
  claimDate?: string;
  publisher: string;
  publisherSite?: string;
  url: string;
  title?: string;
  rating: string;
  reviewDate?: string;
}

const ENDPOINT = 'https://factchecktools.googleapis.com/v1alpha1/claims:search';

interface ApiClaim {
  text?: string;
  claimant?: string;
  claimDate?: string;
  claimReview?: {
    publisher?: { name?: string; site?: string };
    url?: string;
    title?: string;
    reviewDate?: string;
    textualRating?: string;
    languageCode?: string;
  }[];
}

export function parseFactChecks(json: unknown): FactCheck[] {
  const claims = (json as { claims?: ApiClaim[] } | null)?.claims ?? [];
  const out: FactCheck[] = [];
  for (const c of claims) {
    for (const r of c.claimReview ?? []) {
      if (!r.url || !/^https?:\/\//i.test(r.url)) continue;
      out.push({
        claim: (c.text ?? '').slice(0, 300),
        claimant: c.claimant?.slice(0, 120),
        claimDate: c.claimDate,
        publisher: (r.publisher?.name || r.publisher?.site || 'Fact-checker').slice(0, 80),
        publisherSite: r.publisher?.site,
        url: stripTracking(r.url),
        title: r.title?.slice(0, 200),
        rating: (r.textualRating ?? 'Reviewed').slice(0, 60),
        reviewDate: r.reviewDate,
      });
    }
  }
  return out.slice(0, 8);
}

/** Words a period follows without ending the sentence ("Sept.", "Univ.", "Dr."). Single letters and dotted initials (U.S., F.D.A.) are handled by shape. */
const ABBREVIATIONS = new Set(
  (
    'mr mrs ms dr prof sr jr st mt ft gen gov sen rep col lt sgt capt cmdr adm pres rev hon ' +
    'jan feb mar apr jun jul aug sep sept oct nov dec univ dept assn inc ltd co corp bros est approx vs etc no nos vol vols fig al ed eds'
  ).split(' '),
);

/** The end of the first sentence (index after its punctuation) within `max` characters, or -1. */
function firstSentenceEnd(flat: string, min: number, max: number): number {
  const end = /[.!?。！？]+/g;
  let m: RegExpExecArray | null;
  while ((m = end.exec(flat)) !== null) {
    const stop = m.index + m[0].length;
    if (stop > max) return -1;
    const cjk = /[。！？]/.test(m[0]);
    const after = flat.slice(stop).replace(/^["”'’」』)]+/, '');
    // A period inside a token ("3.5", "example.com") is not an end; CJK punctuation needs no space.
    if (!cjk && after && !after.startsWith(' ')) continue;
    if (m[0] === '.') {
      const word = /[\p{L}.]*$/u.exec(flat.slice(0, m.index))?.[0] ?? '';
      if (/^(\p{L}\.)*\p{L}$/u.test(word) && (word.length === 1 || word.includes('.'))) continue; // "J." or "U.S."
      if (ABBREVIATIONS.has(word.toLowerCase())) continue;
    }
    if (stop >= min) return stop;
  }
  return -1;
}

/** The words worth searching for: the first sentence, at most 24 words and 200 characters (text without spaces, like Chinese or Thai, is cut by length). */
export function factCheckQuery(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const stop = firstSentenceEnd(flat, 20, 220);
  const sentence = stop === -1 ? flat : flat.slice(0, stop);
  const words = sentence
    .split(' ')
    .slice(0, 24)
    .join(' ')
    .replace(/^["“”']+|["“”']+$/g, '');
  // truncate() never splits an emoji (a lone surrogate makes encodeURIComponent throw); its ellipsis is not part of a query.
  return words.length > 200 ? truncate(words, 201).replace(/…$/, '') : words;
}

export async function searchFactChecks(query: string, apiKey: string, signal?: AbortSignal, language = 'en'): Promise<FactCheck[]> {
  if (!apiKey.trim() || !query.trim()) return [];
  const u = `${ENDPOINT}?query=${encodeURIComponent(query)}&languageCode=${encodeURIComponent(language)}&pageSize=8`;
  // The key goes in a header like every other key here, not in the address (addresses get logged).
  const res = await fetch(u, { signal, headers: { 'X-Goog-Api-Key': apiKey.trim() } });
  if (!res.ok) throw new Error(`Fact Check Tools: HTTP ${res.status}`);
  return parseFactChecks(await res.json());
}
