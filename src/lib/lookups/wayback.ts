/**
 * The Wayback Machine's CDX index answers "when was this URL first captured?" with no key and no
 * model. A first capture long before the claimed date says "older than claimed"; none at all is a
 * (weak) signal that the page is new. Fetches go to web.archive.org only.
 */
export interface FirstCapture {
  url: string;
  /** ISO date of the earliest 200 capture, or null when the archive has none. */
  firstCaptured: string | null;
  archiveUrl?: string;
}

const CDX = 'https://web.archive.org/cdx/search/cdx';

export function parseCdxTimestamp(json: unknown): string | null {
  // [["timestamp"],["20190304120000"]]
  const rows = Array.isArray(json) ? (json as unknown[]) : [];
  for (const row of rows.slice(1)) {
    const ts = Array.isArray(row) ? String(row[0] ?? '') : '';
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(ts);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return null;
}

export async function firstCapture(url: string, signal?: AbortSignal): Promise<FirstCapture> {
  const u = `${CDX}?url=${encodeURIComponent(url)}&output=json&fl=timestamp&filter=statuscode:200&limit=1`;
  const res = await fetch(u, { signal, credentials: 'omit' });
  if (!res.ok) throw new Error(`Wayback CDX: HTTP ${res.status}`);
  const first = parseCdxTimestamp(await res.json());
  return { url, firstCaptured: first, archiveUrl: first ? `https://web.archive.org/web/${first.replace(/-/g, '')}000000*/${url}` : undefined };
}

/** "Save Page Now": a tab the user opens; the archive does the capture. */
export function savePageUrl(url: string): string {
  return `https://web.archive.org/save/${url}`;
}
