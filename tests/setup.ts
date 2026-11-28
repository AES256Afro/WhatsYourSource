import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach } from 'vitest';
import { resetSettingsDbForTests } from '@/lib/storage/settingsStore';
import { resetSettingsForTests } from '@/lib/storage/settings';

// Settings live in IndexedDB: every test starts with an empty settings database, as with fakeBrowser.reset().
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetSettingsDbForTests();
  resetSettingsForTests();
});
