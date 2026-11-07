import type { Settings } from '../storage/settings';
import { SearchError, readError, type SearchBackend, type SearchHit } from './types';

const MAX = 8;

export function createSearxng(baseUrl: string): SearchBackend {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    id: 'searxng',
    label: 'SearXNG',
    async search(query, signal) {
      if (!base) throw new SearchError('Set your SearXNG URL in settings.');
      const u = `${base}/search?q=${encodeURIComponent(query)}&format=json&language=en`;
      const res = await fetch(u, { signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new SearchError('SearXNG returned an error.', await readError(res));
      const j = (await res.json()) as { results?: { title?: string; url?: string; content?: string; publishedDate?: string | null }[] };
      return (j.results ?? [])
        .filter((r) => r.url)
        .slice(0, MAX)
        .map((r) => ({ title: r.title ?? r.url!, url: r.url!, snippet: r.content ?? '', date: r.publishedDate ?? undefined }));
    },
  };
}

export function createBrave(apiKey: string): SearchBackend {
  return {
    id: 'brave',
    label: 'Brave Search',
    async search(query, signal) {
      if (!apiKey) throw new SearchError('Set your Brave Search API key in settings.');
      const u = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX}`;
      const res = await fetch(u, { signal, headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey } });
      if (!res.ok) throw new SearchError('Brave Search returned an error.', await readError(res));
      const j = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string; age?: string }[] } };
      return (j.web?.results ?? [])
        .filter((r) => r.url)
        .slice(0, MAX)
        .map((r) => ({ title: r.title ?? r.url!, url: r.url!, snippet: stripTags(r.description ?? ''), date: r.age }));
    },
  };
}

export function createTavily(apiKey: string): SearchBackend {
  return {
    id: 'tavily',
    label: 'Tavily',
    async search(query, signal) {
      if (!apiKey) throw new SearchError('Set your Tavily API key in settings.');
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, max_results: MAX, include_answer: false, search_depth: 'basic' }),
      });
      if (!res.ok) throw new SearchError('Tavily returned an error.', await readError(res));
      const j = (await res.json()) as { results?: { title?: string; url?: string; content?: string; published_date?: string }[] };
      return (j.results ?? [])
        .filter((r) => r.url)
        .slice(0, MAX)
        .map((r) => ({ title: r.title ?? r.url!, url: r.url!, snippet: r.content ?? '', date: r.published_date }));
    },
  };
}

export function createSearchBackend(s: Settings['providers']['openaiCompat']): SearchBackend | null {
  switch (s.searchTool) {
    case 'searxng':
      return createSearxng(s.searxngUrl);
    case 'brave':
      return createBrave(s.braveKey);
    case 'tavily':
      return createTavily(s.tavilyKey);
    default:
      return null;
  }
}

export function formatHits(hits: SearchHit[]): string {
  if (hits.length === 0) return 'No results.';
  return hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.date ? `\n   ${h.date}` : ''}\n   ${h.snippet}`).join('\n');
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}
