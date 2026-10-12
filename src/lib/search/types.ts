export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  date?: string;
}

/** A web search backend for models that cannot search by themselves. */
export interface SearchBackend {
  id: 'searxng' | 'brave' | 'tavily';
  label: string;
  search(query: string, signal?: AbortSignal): Promise<SearchHit[]>;
}

export class SearchError extends Error {
  constructor(
    message: string,
    public details?: string,
  ) {
    super(message);
    this.name = 'SearchError';
  }
}

export async function readError(res: Response): Promise<string> {
  const t = await res.text().catch(() => '');
  return `${res.status} ${t.slice(0, 200)}`.trim();
}
