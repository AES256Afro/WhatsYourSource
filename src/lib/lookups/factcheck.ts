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
        url: r.url,
        title: r.title?.slice(0, 200),
        rating: (r.textualRating ?? 'Reviewed').slice(0, 60),
        reviewDate: r.reviewDate,
      });
    }
  }
  return out.slice(0, 8);
}

/** The words worth searching for: the first sentence or the first ~14 words of the content. */
export function factCheckQuery(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const sentence = /^(.{20,220}?[.!?])["”']?(\s|$)/.exec(flat)?.[1] ?? flat;
  return sentence
    .split(' ')
    .slice(0, 24)
    .join(' ')
    .replace(/^["“”']+|["“”']+$/g, '');
}

export async function searchFactChecks(query: string, apiKey: string, signal?: AbortSignal, language = 'en'): Promise<FactCheck[]> {
  if (!apiKey.trim() || !query.trim()) return [];
  const u = `${ENDPOINT}?query=${encodeURIComponent(query)}&languageCode=${encodeURIComponent(language)}&pageSize=8&key=${encodeURIComponent(apiKey.trim())}`;
  const res = await fetch(u, { signal });
  if (!res.ok) throw new Error(`Fact Check Tools: HTTP ${res.status}`);
  return parseFactChecks(await res.json());
}
