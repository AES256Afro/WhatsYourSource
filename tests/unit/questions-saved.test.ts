import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { askForMenu, menuItems, parseMenuId, savedQuestionsChanged, storedSavedQuestions } from '@/lib/menus';
import {
  addSavedQuestion,
  availableAsks,
  cleanSavedQuestions,
  editSavedQuestion,
  MAX_SAVED_QUESTIONS,
  normalizeAskSettings,
  removeSavedQuestion,
  savedAsks,
} from '@/lib/pipeline/question';
import { readPublicSettings } from '@/lib/storage/publicSettings';
import { DEFAULT_SETTINGS, defaultAsk, loadSettings, mergeSettings, saveSettings, SETTINGS_KEY, updateSettings } from '@/lib/storage/settings';

/** A settings object as 1.2.x stored it: one custom question, no saved list. */
const v12 = (over: object = {}) => ({
  version: 1,
  onboarded: true,
  defaultProvider: 'gemini',
  ask: { default: 'custom', custom: '  Who pays\nfor this? ' },
  privacy: { snapshots: true, chip: false, disabledSites: ['example.com'] },
  ...over,
});

describe('saved questions in settings', () => {
  it('migrates a 1.2.x settings object: its custom question becomes the first saved one', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, v12());
    expect(s.ask).toEqual({ default: 'custom', custom: 'Who pays for this?', saved: ['Who pays for this?'] });
    expect(defaultAsk(s)).toEqual({ id: 'custom', custom: 'Who pays for this?' });
    expect(s.privacy.chip).toBe(false);
    // A custom question that was written but not the default is kept as a saved one, not as the default.
    const notDefault = mergeSettings(DEFAULT_SETTINGS, v12({ ask: { default: 'timeline', custom: 'Why now?' } }));
    expect(notDefault.ask).toEqual({ default: 'timeline', custom: 'Why now?', saved: ['Why now?'] });
    expect(mergeSettings(DEFAULT_SETTINGS, v12({ ask: { default: 'factcheck', custom: '' } })).ask.saved).toEqual([]);
  });

  it('cleans the stored list: trimmed, no repeats or empties, at most 8, bad entries dropped one by one', () => {
    const many = Array.from({ length: 12 }, (_, i) => `Question ${i}?`);
    const s = mergeSettings(DEFAULT_SETTINGS, { ask: { default: 'factcheck', custom: '', saved: [' A? ', 'A?', '', 42, 'B?', ...many] } });
    expect(s.ask.saved).toHaveLength(MAX_SAVED_QUESTIONS);
    expect(s.ask.saved.slice(0, 3)).toEqual(['A?', 'B?', 'Question 0?']);
    expect(mergeSettings(DEFAULT_SETTINGS, { ask: { default: 'explain', saved: 'nope' } }).ask).toEqual({ default: 'explain', custom: '', saved: [] });
    expect(cleanSavedQuestions(['x'.repeat(400)])[0]).toHaveLength(300);
  });

  it('keeps the default consistent with the list', () => {
    const ask = { default: 'custom' as const, custom: 'B?', saved: ['A?', 'B?'] };
    expect(editSavedQuestion(ask, 1, 'B2?')).toEqual({ default: 'custom', custom: 'B2?', saved: ['A?', 'B2?'] });
    expect(editSavedQuestion(ask, 0, 'B?')).toBe(ask); // a repeat changes nothing
    expect(editSavedQuestion(ask, 0, '   ')).toBe(ask);
    expect(removeSavedQuestion(ask, 1)).toEqual({ default: 'factcheck', custom: '', saved: ['A?'] });
    expect(removeSavedQuestion(ask, 0)).toEqual({ default: 'custom', custom: 'B?', saved: ['B?'] });
    expect(addSavedQuestion(ask, ' C? ').saved).toEqual(['A?', 'B?', 'C?']);
    const full = { default: 'factcheck' as const, custom: '', saved: Array.from({ length: 8 }, (_, i) => `Q${i}`) };
    expect(addSavedQuestion(full, 'Q9')).toBe(full);
    // A custom default that is not saved joins the list when there is room.
    expect(normalizeAskSettings({ default: 'custom', custom: 'New?', saved: ['A?'] }).saved).toEqual(['A?', 'New?']);
    expect(normalizeAskSettings({ default: 'custom', custom: '', saved: ['A?'] }).default).toBe('factcheck');
  });

  it('offers every saved question next to the presets', () => {
    expect(savedAsks(['A?', 'B?'])).toEqual([
      { id: 'custom', custom: 'A?' },
      { id: 'custom', custom: 'B?' },
    ]);
    const all = availableAsks(['A?', 'B?']);
    expect(all.filter((a) => a.id === 'custom')).toHaveLength(2);
    expect(all.slice(0, 6).map((a) => a.id)).toEqual(['factcheck', 'explain', 'summarize', 'timeline', 'flaws', 'sources']);
    expect(availableAsks('Only one?').at(-1)).toEqual({ id: 'custom', custom: 'Only one?' });
  });

  it('leaves keys alone and saves the list normalized', async () => {
    fakeBrowser.reset();
    await saveSettings({ ...DEFAULT_SETTINGS, providers: { ...DEFAULT_SETTINGS.providers, gemini: { ...DEFAULT_SETTINGS.providers.gemini, apiKey: 'k' } } });
    const next = await updateSettings((s) => ({ ...s, ask: { ...s.ask, default: 'custom', custom: ' Who? ', saved: ['Who?', 'Who?'] } }));
    expect(next.ask).toEqual({ default: 'custom', custom: 'Who?', saved: ['Who?'] });
    const loaded = await loadSettings();
    expect(loaded.ask.saved).toEqual(['Who?']);
    expect(loaded.providers.gemini.apiKey).toBe('k');
    const stored = await fakeBrowser.storage.local.get(SETTINGS_KEY);
    expect(JSON.stringify(stored[SETTINGS_KEY])).not.toContain('"k"');
  });

  it('the chip still names the default question', () => {
    expect(readPublicSettings({ ask: { default: 'custom', custom: 'Who?', saved: ['Who?'] } }).askName).toBe('Your question');
    expect(readPublicSettings({ ask: { default: 'sources', custom: '', saved: ['Who?'] } }).askName).toBe('Find more sources');
    expect(readPublicSettings(v12()).askName).toBe('Your question');
  });
});

describe('saved questions on the right-click menu', () => {
  const custom = (items: ReturnType<typeof menuItems>) => items.filter((i) => i.id.includes(':custom') || i.id.endsWith(':yours'));

  it('0 saved: presets only', () => {
    expect(custom(menuItems([]))).toEqual([]);
  });

  it('1 saved: one row per target, as before', () => {
    const items = custom(menuItems(['Who pays?']));
    expect(items.map((i) => i.id)).toEqual(['selection', 'image', 'post', 'page', 'link'].map((t) => `wys-${t}:custom-0`));
    expect(items.every((i) => !i.parentId)).toBe(true);
    expect(items[3]?.title).toBe('Ask about this article: “Who pays?”');
  });

  it('3 saved: a "Your questions" item per target with one child each', () => {
    const items = menuItems(['A & B?', 'Why %s?', 'C?']);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    const parent = items.find((i) => i.id === 'wys-selection:yours')!;
    expect(parent.title).toBe('Your questions about the selection');
    expect(parseMenuId(parent.id)).toBeNull();
    const children = items.filter((i) => i.parentId === parent.id);
    expect(children.map((i) => i.id)).toEqual(['wys-selection:custom-0', 'wys-selection:custom-1', 'wys-selection:custom-2']);
    expect(children[0]?.title).toBe('Ask about selection: “A && B?”');
    expect(children[1]?.title).not.toContain('%s');
    expect(items.find((i) => i.id === 'wys-link:yours')?.title).toBe('Your questions about the linked page');
    expect(items.filter((i) => i.parentId).every((i) => i.contexts[0] === items.find((p) => p.id === i.parentId)?.contexts[0])).toBe(true);
  });

  it('item ids carry the index, and a click reads that question at click time', () => {
    expect(parseMenuId('wys-post:custom-2')).toEqual({ target: 'post', askId: 'custom', index: 2 });
    expect(parseMenuId('wys-post:custom')).toEqual({ target: 'post', askId: 'custom', index: 0 }); // a 1.2.x item still on screen
    expect(parseMenuId('wys-post:custom-9')).toBeNull();
    expect(parseMenuId('wys-post:timeline-1')).toBeNull();
    expect(parseMenuId('wys-page:timeline')).toEqual({ target: 'page', askId: 'timeline' });
    expect(askForMenu('custom', ['A?', 'B?', 'C?'], 2)).toEqual({ id: 'custom', custom: 'C?' });
  });

  it('a click on a question removed since the menu was built is ignored', () => {
    const item = parseMenuId('wys-selection:custom-2')!;
    expect(askForMenu(item.askId, ['A?', 'B?'], item.index)).toBeNull();
  });

  it('rebuilds when the list changes, including after a worker wake', () => {
    const st = (saved: string[] | undefined, custom = '') => ({ ask: { default: 'factcheck', custom, ...(saved ? { saved } : {}) } });
    // After a wake: compared with the stored old value.
    expect(savedQuestionsChanged({ oldValue: st(['A?']), newValue: st(['A?', 'B?']) }, null)).toBe(true);
    expect(savedQuestionsChanged({ oldValue: st(['A?', 'B?']), newValue: st(['B?', 'A?']) }, null)).toBe(true); // reordered
    expect(savedQuestionsChanged({ oldValue: st(['A?']), newValue: st([' A? ']) }, null)).toBe(false);
    expect(savedQuestionsChanged({ oldValue: st(['A?'], 'A?'), newValue: { ...st(['A?'], 'A?'), privacy: { chip: false } } }, null)).toBe(false);
    // A 1.2.x object rewritten with the same question as its first saved one: nothing to rebuild.
    expect(savedQuestionsChanged({ oldValue: st(undefined, 'A?'), newValue: st(['A?'], 'A?') }, null)).toBe(false);
    expect(storedSavedQuestions(st(undefined, 'A?'))).toEqual(['A?']);
    // Known build: compared with that.
    expect(savedQuestionsChanged({ oldValue: st(['A?']), newValue: st(['A?']) }, [])).toBe(true);
    expect(savedQuestionsChanged({ oldValue: st([]), newValue: st(['A?']) }, ['A?'])).toBe(false);
  });
});

describe('storage round trip', () => {
  beforeEach(() => fakeBrowser.reset());
  it('a 1.2.x object in storage loads with its question saved', async () => {
    await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: v12() });
    expect((await loadSettings()).ask.saved).toEqual(['Who pays for this?']);
  });
});
