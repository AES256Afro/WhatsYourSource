import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/**
 * Where the settings (API keys included) live: an IndexedDB database in the extension's own origin.
 * The content script runs in the page's origin, so unlike `storage.local` it can neither read nor
 * write this database. One object store, a few records:
 *  - `settings`: the full settings object, as saved (the loader merges it over the defaults);
 *  - `rev`: a counter bumped on every save, copied into the public mirror so each save changes it;
 *  - `menusBuiltFrom`: the saved questions the context menu was last built from (background only).
 */
type RecordKey = 'settings' | 'rev' | 'menusBuiltFrom';

interface SettingsDB extends DBSchema {
  kv: { key: RecordKey; value: unknown };
}

const DB_NAME = 'wys-settings';
let dbPromise: Promise<IDBPDatabase<SettingsDB>> | null = null;

function getDb(): Promise<IDBPDatabase<SettingsDB>> {
  dbPromise ??= openDB<SettingsDB>(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore('kv');
    },
  }).catch((e: unknown) => {
    // A failed open must not be cached for the context's life.
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

/** For tests: drop the cached connection so a fresh fake database is used. */
export function resetSettingsDbForTests(): void {
  dbPromise = null;
}

const revOf = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0);

/** The stored settings object (undefined when nothing was ever stored here) and the current revision. */
export async function readSettingsRecord(): Promise<{ settings: unknown; rev: number }> {
  const db = await getDb();
  const tx = db.transaction('kv');
  const [settings, rev] = await Promise.all([tx.store.get('settings'), tx.store.get('rev'), tx.done]);
  return { settings, rev: revOf(rev) };
}

/** Stores the settings and bumps the revision in one transaction; resolves to the new revision. */
export async function writeSettingsRecord(settings: unknown): Promise<number> {
  const db = await getDb();
  const tx = db.transaction('kv', 'readwrite');
  const rev = revOf(await tx.store.get('rev')) + 1;
  await Promise.all([tx.store.put(settings, 'settings'), tx.store.put(rev, 'rev'), tx.done]);
  return rev;
}

/**
 * Stores the settings only if no settings record exists yet (checked and written in one transaction,
 * so two contexts racing here store once). Resolves to whether this call stored them, and the revision.
 */
export async function createSettingsRecord(settings: unknown): Promise<{ created: boolean; rev: number }> {
  const db = await getDb();
  const tx = db.transaction('kv', 'readwrite');
  const existing = await tx.store.get('settings');
  if (existing !== undefined) {
    const rev = revOf(await tx.store.get('rev'));
    await tx.done;
    return { created: false, rev };
  }
  const rev = revOf(await tx.store.get('rev')) + 1;
  await Promise.all([tx.store.put(settings, 'settings'), tx.store.put(rev, 'rev'), tx.done]);
  return { created: true, rev };
}

/** The saved questions the context menu was last built from; null when never recorded. */
export async function readMenusBuiltFrom(): Promise<string[] | null> {
  const v = await (await getDb()).get('kv', 'menusBuiltFrom');
  return Array.isArray(v) && v.every((q) => typeof q === 'string') ? v : null;
}

export async function writeMenusBuiltFrom(saved: readonly string[]): Promise<void> {
  await (await getDb()).put('kv', [...saved], 'menusBuiltFrom');
}
