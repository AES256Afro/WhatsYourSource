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
  snapshots: { key: string; value: StoredSnapshot };
}

let dbPromise: Promise<IDBPDatabase<WysDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<WysDB>> {
  dbPromise ??= openDB<WysDB>('whatsyoursource', 1, {
    upgrade(db) {
      const checks = db.createObjectStore('checks', { keyPath: 'id' });
      checks.createIndex('by-created', 'createdAt');
      db.createObjectStore('snapshots', { keyPath: 'checkId' });
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
}

export async function listChecks(opts: ListOptions = {}): Promise<StoredCheck[]> {
  const db = await getDb();
  const q = (opts.query ?? '').trim().toLowerCase();
  const out: StoredCheck[] = [];
  const limit = opts.limit ?? 500;
  let cursor = await db.transaction('checks').store.index('by-created').openCursor(null, 'prev');
  while (cursor && out.length < limit) {
    const c = cursor.value;
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
  return (await getDb()).get('checks', id);
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
  let cursor = await db.transaction('snapshots').store.openCursor();
  while (cursor) {
    snapshots++;
    snapshotBytes += cursor.value.bytes;
    cursor = await cursor.continue();
  }
  return { checks, snapshots, snapshotBytes };
}

/** Drop the oldest snapshots (never the results) until snapshot storage fits under the cap. */
export async function enforceSnapshotCap(maxBytes: number): Promise<number> {
  const db = await getDb();
  const { snapshotBytes } = await storageStats();
  if (snapshotBytes <= maxBytes) return 0;
  let excess = snapshotBytes - maxBytes;
  let removed = 0;
  let cursor = await db.transaction('checks').store.index('by-created').openCursor(null, 'next');
  const victims: string[] = [];
  while (cursor && excess > 0) {
    if (cursor.value.hasSnapshot) {
      const snap = await db.get('snapshots', cursor.value.id);
      if (snap) {
        victims.push(cursor.value.id);
        excess -= snap.bytes;
      }
    }
    cursor = await cursor.continue();
  }
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

export async function exportAll(): Promise<{ version: 1; exportedAt: string; checks: Array<StoredCheck & { snapshot?: Omit<StoredSnapshot, 'screenshot'> }> }> {
  const db = await getDb();
  const checks = await listChecks({ limit: 100000 });
  const out = [];
  for (const c of checks) {
    const s = await db.get('snapshots', c.id);
    if (s) {
      const { screenshot: _drop, ...rest } = s;
      out.push({ ...c, snapshot: rest });
    } else out.push(c);
  }
  return { version: 1, exportedAt: new Date().toISOString(), checks: out };
}
