import { domainOf } from '../util/url';

/**
 * Source reputation from Wikipedia's "Reliable sources / Perennial sources" list (CC BY-SA), shipped
 * as JSON and loaded only when a result needs it. It is a summary of Wikipedia editors' discussions,
 * not a verdict on any article, and the UI says so.
 */
export type CredibilityStatus = 'reliable' | 'no-consensus' | 'unreliable' | 'deprecated' | 'blacklisted' | 'mixed';

export interface CredibilityEntry {
  name: string;
  status: CredibilityStatus;
  domains: string[];
  summary: string;
}

export interface Credibility {
  name: string;
  status: CredibilityStatus;
  statusLabel: string;
  summary: string;
}

interface Dataset {
  source: string;
  license: string;
  updated: string;
  statuses: Record<CredibilityStatus, string>;
  entries: CredibilityEntry[];
}

let loaded: Promise<{ byDomain: Map<string, CredibilityEntry>; statuses: Record<CredibilityStatus, string>; updated: string }> | null = null;

function load() {
  loaded ??= import('@/data/reliable-sources.json').then((m) => {
    const data = (m as { default: Dataset }).default;
    const byDomain = new Map<string, CredibilityEntry>();
    for (const e of data.entries) for (const d of e.domains) byDomain.set(d, e);
    return { byDomain, statuses: data.statuses, updated: data.updated };
  });
  return loaded;
}

/** Match the host or any parent domain (`edition.cnn.com` → `cnn.com`). */
export function lookup(byDomain: Map<string, CredibilityEntry>, hostOrUrl: string): CredibilityEntry | undefined {
  const host = domainOf(hostOrUrl);
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const hit = byDomain.get(parts.slice(i).join('.'));
    if (hit) return hit;
  }
  return undefined;
}

export async function rateDomains(hostsOrUrls: Iterable<string>): Promise<Record<string, Credibility>> {
  const { byDomain, statuses } = await load();
  const out: Record<string, Credibility> = {};
  for (const h of hostsOrUrls) {
    const domain = domainOf(h);
    if (!domain || out[domain]) continue;
    const hit = lookup(byDomain, domain);
    if (hit) out[domain] = { name: hit.name, status: hit.status, statusLabel: statuses[hit.status], summary: hit.summary };
  }
  return out;
}

/** Things worth saying about a source list as a whole. */
export function sourceMixNotes(domains: string[], ratings: Record<string, Credibility>): string[] {
  const notes: string[] = [];
  const unique = Array.from(new Set(domains.filter(Boolean)));
  if (unique.length >= 2 && unique.length === 1) notes.push('All sources come from one outlet.');
  if (domains.length >= 3 && unique.length === 1) notes.push(`Every source is from ${unique[0]}; look for an independent one.`);
  const bad = unique.filter((d) => ['unreliable', 'deprecated', 'blacklisted'].includes(ratings[d]?.status ?? ''));
  if (bad.length) notes.push(`${bad.join(', ')} ${bad.length === 1 ? 'is' : 'are'} rated unreliable by Wikipedia editors; weigh accordingly.`);
  return notes;
}
