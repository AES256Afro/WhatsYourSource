import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CheckInput } from '../messaging/protocol';
import type { CheckResult, VerdictKind } from '../pipeline/schema';
import { domainOf, truncate } from '../util/url';

/**
 * History lives in IndexedDB (storage.local is too small for page snapshots).
 * Two stores: `checks` (the result card) and `snapshots` (the page as it was), keyed by check id,
 * so a snapshot can be evicted to free space while the result stays.
 */
export interface StoredCheck {
  id: string;
  createdAt: number;
  kind: CheckInput['kind'];
  /** Short human title: the quote, the image URL, the page title. */
  title: string;
  site: string;
  verdictLabel: string;
  verdictKind: VerdictKind;
  provider: string;
  model: string;
  hasSnapshot: boolean;
  note: string;
  result: CheckResult;
}

export interface StoredSnapshot {
  checkId: string;
  url: string;
  title: string;
  /** Sanitized main-content HTML (Readability + DOMPurify in the content script). */
  html: string;
  capturedAt: number;
  /** The checked text, so the detail view can mark it. */
  highlight?: string;
  bytes: number;
  /** Visible-area screenshot (JPEG), when the browser let us take one. */
  screenshot?: Blob;
}

export type SnapshotInput = Omit<StoredSnapshot, 'checkId' | 'bytes'>;

interface WysDB extends DBSchema {
  checks: { key: string; value: StoredCheck; indexes: { 'by-created': number } };
  snapshots: { key: string; value: StoredSnapshot; indexes: { 'by-bytes': number } };
}

let dbPromise: Promise<IDBPDatabase<WysDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<WysDB>> {
  dbPromise ??= openDB<WysDB>('whatsyoursource', 2, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        const checks = db.createObjectStore('checks', { keyPath: 'id' });
        checks.createIndex('by-created', 'createdAt');
        db.createObjectStore('snapshots', { keyPath: 'checkId' });
      }
      if (oldVersion < 2) {
        // Byte totals come from this index's keys, so the stats never deserialise a snapshot.
        tx.objectStore('snapshots').createIndex('by-bytes', 'bytes');
      }
    },
  });
  return dbPromise;
}

/** For tests: drop the cached connection so a fresh fake DB can be used. */
export function resetDbForTests() {
  dbPromise = null;
}

export function summarizeInput(input: CheckInput): { title: string; site: string } {
  switch (input.kind) {
    case 'text':
      return { title: truncate(input.text.replace(/\s+/g, ' ').trim(), 140), site: domainOf(input.pageUrl) };
    case 'image':
      return { title: input.alt ? truncate(input.alt, 140) : `Image on ${domainOf(input.pageUrl)}`, site: domainOf(input.pageUrl) };
    case 'page':
      return { title: input.title ? truncate(input.title, 140) : input.url, site: domainOf(input.url) };
    case 'post':
      return { title: `${input.author ? `${input.author}: ` : ''}${truncate(input.text.replace(/\s+/g, ' ').trim(), 120)}`, site: input.site };
  }
}

export async function saveCheck(result: CheckResult, snapshot?: SnapshotInput | null): Promise<StoredCheck> {
  const db = await getDb();
  const { title, site } = summarizeInput(result.input);
  const check: StoredCheck = {
    id: result.id,
    createdAt: result.createdAt,
    kind: result.input.kind,
    title,
    site,
    verdictLabel: result.verdict.label,
    verdictKind: result.verdict.kind,
    provider: result.provider.label,
    model: result.provider.model,
    hasSnapshot: !!snapshot,
    note: '',
    result,
  };
  const tx = db.transaction(['checks', 'snapshots'], 'readwrite');
  await tx.objectStore('checks').put(check);
  if (snapshot) {
    const bytes = snapshot.html.length * 2 + (snapshot.screenshot?.size ?? 0);
    await tx.objectStore('snapshots').put({ ...snapshot, checkId: result.id, bytes });
  }
  await tx.done;
  return check;
}

export interface ListOptions {
  query?: string;
  kind?: CheckInput['kind'] | 'all';
  withSnapshot?: boolean;
  limit?: number;
  /** Only checks created strictly before this timestamp: the paging cursor. */
  before?: number;
}

export async function listChecks(opts: ListOptions = {}): Promise<StoredCheck[]> {
  const db = await getDb();
  const q = (opts.query ?? '').trim().toLowerCase();
  const out: StoredCheck[] = [];
  const limit = opts.limit ?? 500;
  const range = opts.before != null ? IDBKeyRange.upperBound(opts.before, true) : null;
  let cursor = await db.transaction('checks').store.index('by-created').openCursor(range, 'prev');
  while (cursor && out.length < limit) {
    const c = normalizeStored(cursor.value);
    const kindOk = !opts.kind || opts.kind === 'all' || c.kind === opts.kind;
    const snapOk = !opts.withSnapshot || c.hasSnapshot;
    const textOk =
      !q ||
      c.title.toLowerCase().includes(q) ||
      c.site.toLowerCase().includes(q) ||
      c.verdictLabel.toLowerCase().includes(q) ||
      c.note.toLowerCase().includes(q) ||
      c.result.narrative.toLowerCase().includes(q);
    if (kindOk && snapOk && textOk) out.push(c);
    cursor = await cursor.continue();
  }
  return out;
}

export async function getCheck(id: string): Promise<StoredCheck | undefined> {
  const c = await (await getDb()).get('checks', id);
  return c ? normalizeStored(c) : undefined;
}

/** Rows written by older builds may lack fields added since; fill them so views never dereference undefined. */
export function normalizeStored(c: StoredCheck): StoredCheck {
  const r = c.result;
  const input = r.input as CheckInput & { images?: string[]; links?: string[] };
  return {
    ...c,
    note: c.note ?? '',
    title: c.title ?? '',
    site: c.site ?? '',
    verdictLabel: c.verdictLabel ?? r.verdict?.label ?? '',
    verdictKind: c.verdictKind ?? r.verdict?.kind ?? 'unverified',
    result: {
      ...r,
      narrative: r.narrative ?? '',
      rawText: r.rawText ?? '',
      claims: r.claims ?? [],
      sources: r.sources ?? [],
      searchQueries: r.searchQueries ?? [],
      verdict: r.verdict ?? { label: 'Assessment', kind: 'unverified', confidence: 'low', summary: '' },
      provider: r.provider ?? { id: c.provider ?? '', label: c.provider ?? '', model: c.model ?? '' },
      input: input.kind === 'post' ? { ...input, images: input.images ?? [], links: input.links ?? [] } : input,
    },
  };
}

export async function getSnapshot(checkId: string): Promise<StoredSnapshot | undefined> {
  return (await getDb()).get('snapshots', checkId);
}

export async function setNote(id: string, note: string): Promise<void> {
  const db = await getDb();
  const c = await db.get('checks', id);
  if (!c) return;
  await db.put('checks', { ...c, note });
}

export async function deleteCheck(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['checks', 'snapshots'], 'readwrite');
  await tx.objectStore('checks').delete(id);
  await tx.objectStore('snapshots').delete(id);
  await tx.done;
}

export async function clearHistory(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['checks', 'snapshots'], 'readwrite');
  await tx.objectStore('checks').clear();
  await tx.objectStore('snapshots').clear();
  await tx.done;
}

export async function storageStats(): Promise<{ checks: number; snapshots: number; snapshotBytes: number }> {
  const db = await getDb();
  const checks = await db.count('checks');
  let snapshotBytes = 0;
  let snapshots = 0;
  // Key cursor over the bytes index: sums sizes without loading a single HTML string or screenshot.
  let cursor = await db.transaction('snapshots').store.index('by-bytes').openKeyCursor();
  while (cursor) {
    snapshots++;
    snapshotBytes += cursor.key;
    cursor = await cursor.continue();
  }
  return { checks, snapshots, snapshotBytes };
}
/**
 * Drop the oldest snapshots (never the results) until snapshot storage fits under the cap.
 * IndexedDB auto-commits a transaction the moment control leaves it, so the cursor pass below only
 * collects ids; every other read and write happens afterwards in its own transaction. (fake-indexeddb
 * does not enforce this, so a unit test cannot catch an interleaved await; keep the passes separate.)
 */
export async function enforceSnapshotCap(maxBytes: number): Promise<number> {
  const db = await getDb();
  const { snapshotBytes } = await storageStats();
  if (snapshotBytes <= maxBytes) return 0;
  let excess = snapshotBytes - maxBytes;

  // Pass 1: candidate ids, oldest first (one transaction, no foreign awaits).
  const candidates: string[] = [];
  let cursor = await db.transaction('checks').store.index('by-created').openCursor(null, 'next');
  while (cursor) {
    if (cursor.value.hasSnapshot) candidates.push(cursor.value.id);
    cursor = await cursor.continue();
  }

  // Pass 2: sizes, then victims.
  const victims: string[] = [];
  for (const id of candidates) {
    if (excess <= 0) break;
    const snap = await db.get('snapshots', id);
    if (!snap) continue;
    victims.push(id);
    excess -= snap.bytes;
  }

  // Pass 3: delete, flagging the check row.
  let removed = 0;
  for (const id of victims) {
    const tx = db.transaction(['checks', 'snapshots'], 'readwrite');
    const c = await tx.objectStore('checks').get(id);
    if (c) await tx.objectStore('checks').put({ ...c, hasSnapshot: false });
    await tx.objectStore('snapshots').delete(id);
    await tx.done;
    removed++;
  }
  return removed;
}

/**
 * Everything as one JSON file, built as Blob parts one check at a time so a large history never has to
 * exist as a single JavaScript string (engines cap strings at ~1 GB; a 5 GB snapshot cap can exceed it).
 */
export async function exportAll(): Promise<Blob> {
  const db = await getDb();
  const checks = await listChecks({ limit: 1_000_000 });
  const parts: string[] = [`{"version":1,"exportedAt":${JSON.stringify(new Date().toISOString())},"checks":[`];
  let first = true;
  for (const c of checks) {
    const s = await db.get('snapshots', c.id);
    let row: unknown = c;
    if (s) {
      const { screenshot: _drop, ...rest } = s;
      row = { ...c, snapshot: rest };
    }
    parts.push((first ? '' : ',') + JSON.stringify(row));
    first = false;
  }
  parts.push(']}');
  return new Blob(parts, { type: 'application/json' });
}
