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

/** A key as the dataset writes it, as lookups compare it: no `www.`, lower-case host, no trailing slash. */
export function normalizeKey(key: string): string {
  const k = key
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '');
  const slash = k.indexOf('/');
  return slash === -1 ? k.toLowerCase().replace(/\.$/, '') : k.slice(0, slash).toLowerCase().replace(/\.$/, '') + k.slice(slash).replace(/\/+$/, '');
}

/** "(November 2022–present)", "2012-2018", "(talk shows)": a name that rates one period or part of the outlet. */
const isScoped = (name: string) => /\(.*\)/.test(name) || /\b(1[89]|20)\d\d\b/.test(name);
const latestYear = (name: string) => (/present/i.test(name) ? 9999 : Math.max(0, ...(name.match(/\b(?:1[89]|20)\d\d\b/g) ?? []).map(Number)));

/**
 * Several entries can share a key (Fox News news vs talk shows, CNET by period). The choice never rests
 * on file order: an entry that rates the whole outlet wins (the shortest such name, e.g. "Forbes" over
 * "Forbes.com non-staff"); when every entry is scoped, the current period ("…–present", else the latest
 * year). A tie with different ratings becomes a "mixed" entry that names them. When the shown entry
 * is not the only rating, its summary says the others exist.
 */
export function pickEntry(entries: CredibilityEntry[]): CredibilityEntry | undefined {
  if (entries.length <= 1) return entries[0];
  const candidates = [...entries].sort((a, b) => a.name.localeCompare(b.name) || a.status.localeCompare(b.status));
  const general = candidates.filter((e) => !isScoped(e.name));
  let pool: CredibilityEntry[];
  if (general.length) {
    const shortest = Math.min(...general.map((e) => e.name.length));
    pool = general.filter((e) => e.name.length === shortest);
  } else {
    const latest = Math.max(...candidates.map((e) => latestYear(e.name)));
    pool = candidates.filter((e) => latestYear(e.name) === latest);
  }
  if (pool.length === 1 || new Set(pool.map((e) => e.status)).size === 1) {
    const chosen = [...pool].sort((a, b) => a.name.localeCompare(b.name))[0]!;
    const rest = candidates.filter((e) => e.status !== chosen.status);
    if (!rest.length) return chosen;
    const list = rest.map((e) => `${e.name} (${e.status})`).join('; ');
    return { ...chosen, summary: `${chosen.summary} Wikipedia editors rate other periods or parts of this site separately: ${list}.` };
  }
  return {
    name: pool.map((e) => e.name).join(' / '),
    status: 'mixed',
    domains: Array.from(new Set(pool.flatMap((e) => e.domains))),
    summary: `Wikipedia editors rate parts of this site differently: ${pool.map((e) => `${e.name} (${e.status})`).join('; ')}.`,
  };
}

/** One entry per key (host, or host plus path prefix), chosen by `pickEntry`. */
export function buildIndex(entries: CredibilityEntry[]): Map<string, CredibilityEntry> {
  const byKey = new Map<string, CredibilityEntry[]>();
  for (const e of entries) {
    for (const d of new Set(e.domains.map(normalizeKey))) {
      if (!d) continue;
      const list = byKey.get(d) ?? [];
      list.push(e);
      byKey.set(d, list);
    }
  }
  const out = new Map<string, CredibilityEntry>();
  for (const [k, list] of byKey) {
    const e = pickEntry(list);
    if (e) out.set(k, e);
  }
  return out;
}

function load() {
  loaded ??= import('@/data/reliable-sources.json').then((m) => {
    const data = (m as { default: Dataset }).default;
    return { byDomain: buildIndex(data.entries), statuses: data.statuses, updated: data.updated };
  });
  return loaded;
}

/** Host (no `www.`, lower case) and path (lower case, no query) of a host or URL. */
function hostAndPath(hostOrUrl: string): { host: string; path: string } {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(hostOrUrl) ? hostOrUrl : `https://${hostOrUrl}`);
    return {
      host: u.hostname
        .replace(/^www\./, '')
        .replace(/\.$/, '')
        .toLowerCase(),
      path: decodeSafe(u.pathname).toLowerCase(),
    };
  } catch {
    return { host: domainOf(hostOrUrl), path: '/' };
  }
}

function decodeSafe(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

/**
 * Match the host or any parent domain (`edition.cnn.com` → `cnn.com`). On each, a key with a path
 * (`rollingstone.com/politics`, `newsnationnow.com/space/ufo*`) matches pages under that path, and
 * the longest matching path wins over the bare host.
 */
export function lookup(byDomain: Map<string, CredibilityEntry>, hostOrUrl: string): CredibilityEntry | undefined {
  const { host, path } = hostAndPath(hostOrUrl);
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const h = parts.slice(i).join('.');
    if (path.length > 1) {
      let best: { len: number; entry: CredibilityEntry } | undefined;
      for (const [k, entry] of byDomain) {
        if (!k.startsWith(`${h}/`)) continue;
        const raw = k.slice(h.length).toLowerCase();
        const star = raw.endsWith('*');
        const prefix = star ? raw.slice(0, -1) : raw;
        const hit = star ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`);
        if (hit && (!best || prefix.length > best.len)) best = { len: prefix.length, entry };
      }
      if (best) return best.entry;
    }
    const hit = byDomain.get(h);
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
    const hit = lookup(byDomain, h);
    if (hit) out[domain] = { name: hit.name, status: hit.status, statusLabel: statuses[hit.status], summary: hit.summary };
  }
  return out;
}

/** Things worth saying about a source list as a whole. */
export function sourceMixNotes(domains: string[], ratings: Record<string, Credibility>): string[] {
  const notes: string[] = [];
  const unique = Array.from(new Set(domains.filter(Boolean)));
  if (domains.length >= 3 && unique.length === 1) notes.push(`Every source is from ${unique[0]}; look for an independent one.`);
  const bad = unique.filter((d) => ['unreliable', 'deprecated', 'blacklisted'].includes(ratings[d]?.status ?? ''));
  if (bad.length) {
    const names = bad.map((d) => ratings[d]?.name ?? d);
    notes.push(`${names.join(', ')} ${bad.length === 1 ? 'is' : 'are'} rated unreliable by Wikipedia editors; weigh accordingly.`);
  }
  return notes;
}
