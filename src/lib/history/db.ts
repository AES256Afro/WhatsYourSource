import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { askLabel, normalizeAsk } from '../pipeline/question';
import type { CheckInput } from '../messaging/protocol';
import type { ProviderId } from '../storage/settings';
import type { CheckResult, FollowUp, VerdictKind } from '../pipeline/schema';
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
  /** Display label of the provider that ran the check (the result holds the id and model too). */
  providerLabel: string;
  model: string;
  hasSnapshot: boolean;
  note: string;
  result: CheckResult;
}

export interface StoredSnapshot {
  checkId: string;
  url: string;
  title: string;
  /** Sanitized main-content HTML (Readability + DOMPurify, run by `snapshot-capture.js` injected into the checked tab). */
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

function getDb(): Promise<IDBPDatabase<WysDB>> {
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
  }).catch((e: unknown) => {
    // A failed open (disk full, a transient backing-store error) must not be cached for the page's life.
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

/** For tests: drop the cached connection so a fresh fake DB can be used. */
export function resetDbForTests() {
  dbPromise = null;
}

function summarizeInput(input: CheckInput): { title: string; site: string } {
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
    providerLabel: result.provider.label,
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
  /** With `before`: also the checks created at exactly that timestamp whose id sorts below this one (an exact cursor for exports). */
  beforeId?: string;
}

export async function listChecks(opts: ListOptions = {}): Promise<StoredCheck[]> {
  const db = await getDb();
  const q = (opts.query ?? '').trim().toLowerCase();
  const out: StoredCheck[] = [];
  const limit = opts.limit ?? 500;
  // Within one timestamp a backwards cursor visits ids in descending order, so (time, id) is an exact position.
  const range = opts.before != null ? IDBKeyRange.upperBound(opts.before, opts.beforeId == null) : null;
  let cursor = await db.transaction('checks').store.index('by-created').openCursor(range, 'prev');
  while (cursor && out.length < limit) {
    if (opts.beforeId != null && cursor.value.createdAt === opts.before && cursor.value.id >= opts.beforeId) {
      cursor = await cursor.continue();
      continue;
    }
    const c = upgradeStoredCheck(cursor.value);
    const kindOk = !opts.kind || opts.kind === 'all' || c.kind === opts.kind;
    const snapOk = !opts.withSnapshot || c.hasSnapshot;
    const textOk =
      !q ||
      c.title.toLowerCase().includes(q) ||
      (c.result.title ?? '').toLowerCase().includes(q) ||
      (c.result.topic ?? '').toLowerCase().includes(q) ||
      // The question, when it was not the ordinary fact-check ("fact" must not match every row).
      (normalizeAsk(c.result.input.ask).id !== 'factcheck' && askLabel(c.result.input.ask).toLowerCase().includes(q)) ||
      (c.result.input.ask?.custom ?? '').toLowerCase().includes(q) ||
      c.site.toLowerCase().includes(q) ||
      c.verdictLabel.toLowerCase().includes(q) ||
      c.note.toLowerCase().includes(q) ||
      c.result.narrative.toLowerCase().includes(q) ||
      c.result.sources.some((s) => s.domain.includes(q) || s.title.toLowerCase().includes(q)) ||
      (c.result.originalSource?.title ?? '').toLowerCase().includes(q) ||
      (c.result.originalSource?.publisher ?? '').toLowerCase().includes(q);
    if (kindOk && snapOk && textOk) out.push(c);
    cursor = await cursor.continue();
  }
  return out;
}

/**
 * Every check matching the filters, newest first, a page at a time: the heap holds one page however
 * long the history is. Exports use this. The cursor is (time, id), so checks that share a timestamp
 * are neither skipped nor repeated at a page boundary.
 */
export async function* eachCheck(opts: Omit<ListOptions, 'limit' | 'before' | 'beforeId'> = {}, pageSize = 200): AsyncGenerator<StoredCheck> {
  let before: number | undefined;
  let beforeId: string | undefined;
  for (;;) {
    const page = await listChecks({ ...opts, limit: pageSize, before, beforeId });
    yield* page;
    if (page.length < pageSize) return;
    const last = page[page.length - 1]!;
    before = last.createdAt;
    beforeId = last.id;
  }
}

export async function getCheck(id: string): Promise<StoredCheck | undefined> {
  const c = await (await getDb()).get('checks', id);
  return c ? upgradeStoredCheck(c) : undefined;
}

/** Rows written by older builds may lack fields added since; fill them so views never dereference undefined. */
/** Rows written before the result carried a provider id only have the label; guess the id from it. */
function providerIdFromLabel(label: string): ProviderId {
  if (/gemini|google/i.test(label)) return 'gemini';
  if (/claude|anthropic/i.test(label)) return 'anthropic';
  return 'openai-compat';
}

export function upgradeStoredCheck(c: StoredCheck): StoredCheck {
  const legacy = c as StoredCheck & { provider?: string };
  if (!c.providerLabel && legacy.provider) c = { ...c, providerLabel: legacy.provider };
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
      provider: r.provider ?? { id: providerIdFromLabel(c.providerLabel), label: c.providerLabel, model: c.model ?? '' },
      input: input.kind === 'post' ? { ...input, images: input.images ?? [], links: input.links ?? [] } : input,
    },
  };
}

export async function getSnapshot(checkId: string): Promise<StoredSnapshot | undefined> {
  return (await getDb()).get('snapshots', checkId);
}

export async function setNote(id: string, note: string): Promise<void> {
  const db = await getDb();
  // One transaction: a read and a write in two would let a concurrent update be lost.
  const tx = db.transaction('checks', 'readwrite');
  const c = await tx.store.get(id);
  if (c) await tx.store.put({ ...c, note });
  await tx.done;
}

/**
 * Replace the result of a check that is already saved (evidence that arrived after the first save).
 * The note and the snapshot flag are kept, and a row the user has deleted meanwhile stays deleted.
 */
export async function updateCheckResult(result: CheckResult): Promise<boolean> {
  const db = await getDb();
  const tx = db.transaction('checks', 'readwrite');
  const c = await tx.store.get(result.id);
  // Follow-ups are written by their own call; a result that does not carry them must not drop them.
  if (c) await tx.store.put({ ...c, result: { ...result, followUps: result.followUps ?? c.result.followUps } });
  await tx.done;
  return !!c;
}

/**
 * Add a follow-up to a saved check. A thread already holding `max` is left as it is (the panel refuses
 * new questions at the cap; the first ones are never dropped). False when it was not added.
 */
export async function appendFollowUp(checkId: string, followUp: FollowUp, max = 30): Promise<boolean> {
  const db = await getDb();
  const tx = db.transaction('checks', 'readwrite');
  const c = await tx.store.get(checkId);
  const room = !!c && (c.result.followUps?.length ?? 0) < max;
  if (c && room) await tx.store.put({ ...c, result: { ...c.result, followUps: [...(c.result.followUps ?? []), followUp] } });
  await tx.done;
  return room;
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
/**
 * Runs one at a time (two panels can finish checks together): a pass that read the total before the
 * other pass deleted anything would otherwise evict the same excess a second time.
 */
let capRun: Promise<unknown> = Promise.resolve();

export function enforceSnapshotCap(maxBytes: number): Promise<number> {
  const run = capRun.then(() => capPass(maxBytes));
  capRun = run.catch(() => undefined);
  return run;
}

async function capPass(maxBytes: number): Promise<number> {
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

  // Pass 2: delete oldest first, one transaction each, counting only bytes actually deleted (a snapshot
  // already gone, removed by the user meanwhile, frees nothing here and must not count).
  let removed = 0;
  for (const id of candidates) {
    if (excess <= 0) break;
    const tx = db.transaction(['checks', 'snapshots'], 'readwrite');
    const snap = await tx.objectStore('snapshots').get(id);
    if (snap) {
      const c = await tx.objectStore('checks').get(id);
      if (c) await tx.objectStore('checks').put({ ...c, hasSnapshot: false });
      await tx.objectStore('snapshots').delete(id);
    }
    await tx.done;
    if (!snap) continue;
    excess -= snap.bytes;
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
  // A page of checks at a time (`eachCheck`), each row handed to a Blob at once: the heap holds one page, not the history.
  const parts: BlobPart[] = [`{"version":1,"exportedAt":${JSON.stringify(new Date().toISOString())},"checks":[`];
  let first = true;
  for await (const c of eachCheck()) {
    const s = await db.get('snapshots', c.id);
    let row: unknown = c;
    if (s) {
      const { screenshot: _drop, ...rest } = s;
      row = { ...c, snapshot: rest };
    }
    parts.push(new Blob([(first ? '' : ',') + JSON.stringify(row)]));
    first = false;
  }
  parts.push(']}');
  return new Blob(parts, { type: 'application/json' });
}
