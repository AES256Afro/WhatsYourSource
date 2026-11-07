import type { RawSource } from '../providers/types';
import { domainOf, isHttpUrl, normalizeUrl } from '../util/url';
import type { Claim, ModelResult, OriginalSource, Source } from './schema';

/**
 * Sources shown to the user = what the search machinery actually touched (verified) + what the
 * model listed. A model-listed URL on a domain the search machinery also touched is linked through
 * the verified entry (its redirect always resolves); a model-listed URL on an unknown domain is
 * kept but flagged unverified, and the UI renders it without a live link.
 */
export function buildSources(model: ModelResult | null, raw: RawSource[]): Source[] {
  const out: Source[] = [];
  const byNorm = new Map<string, Source>();
  const byDomain = new Map<string, Source>();
  let nextId = 1;

  for (const r of raw) {
    if (!r.url || !isHttpUrl(r.url)) continue;
    const norm = normalizeUrl(r.url);
    if (byNorm.has(norm)) continue;
    const s: Source = {
      id: nextId++,
      title: cleanTitle(r.title, r.domain),
      url: r.url,
      domain: r.domain || domainOf(r.url),
      // Every raw source came from the search/grounding machinery; only model-named pages (below) are unverified.
      verified: true,
    };
    out.push(s);
    byNorm.set(norm, s);
    if (!byDomain.has(s.domain)) byDomain.set(s.domain, s);
  }

  for (const m of model?.sources ?? []) {
    if (!m.url || !isHttpUrl(m.url)) continue;
    const norm = normalizeUrl(m.url);
    const existing = byNorm.get(norm);
    if (existing) {
      if (m.title && (!existing.title || existing.title === existing.domain)) existing.title = m.title;
      if (m.date && !existing.date) existing.date = m.date;
      continue;
    }
    const domain = domainOf(m.url);
    const sameDomain = byDomain.get(domain);
    if (sameDomain && (sameDomain.title === sameDomain.domain || !sameDomain.title)) {
      // The grounding chunk only knew the domain; the model knows the page. Keep the verified link.
      sameDomain.title = m.title || sameDomain.title;
      if (m.date && !sameDomain.date) sameDomain.date = m.date;
      byNorm.set(norm, sameDomain);
      continue;
    }
    const s: Source = {
      id: nextId++,
      title: m.title || domain,
      url: m.url,
      domain,
      date: m.date ?? undefined,
      verified: false,
    };
    out.push(s);
    byNorm.set(norm, s);
    if (!byDomain.has(domain)) byDomain.set(domain, s);
  }

  return out;
}

export function resolveClaims(model: ModelResult | null, sources: Source[]): Claim[] {
  if (!model) return [];
  return model.claims.map((c) => ({
    text: c.text,
    status: c.status,
    note: c.note,
    sourceIds: uniq(c.sourceUrls.map((u) => findSource(sources, u)?.id).filter((x): x is number => typeof x === 'number')),
  }));
}

export function resolveOriginal(model: ModelResult | null, sources: Source[]): OriginalSource | undefined {
  const o = model?.originalSource;
  if (!o || (!o.title && !o.url)) return undefined;
  // Exact page only: a same-domain grounding redirect would open a different article under this card.
  const match = o.url ? findSource(sources, o.url, { exact: true }) : undefined;
  return {
    title: o.title || match?.title || o.url || '',
    url: match?.url ?? (o.url && isHttpUrl(o.url) ? o.url : undefined),
    publisher: o.publisher ?? undefined,
    date: o.date ?? undefined,
    how: o.how ?? undefined,
    sourceId: match?.id,
  };
}

function findSource(sources: Source[], url: string, opts: { exact?: boolean } = {}): Source | undefined {
  if (!url) return undefined;
  const norm = normalizeUrl(url);
  const exact = sources.find((s) => normalizeUrl(s.url) === norm);
  if (exact || opts.exact) return exact;
  return sources.find((s) => s.domain === domainOf(url) && s.verified) ?? sources.find((s) => s.domain === domainOf(url));
}

function cleanTitle(title: string | undefined, domain: string): string {
  const t = (title ?? '').trim();
  return t || domain;
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
