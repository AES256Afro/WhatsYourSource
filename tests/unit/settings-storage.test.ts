import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  DEFAULT_SETTINGS,
  loadPublicSettings,
  loadSettings,
  mergeSettings,
  pageTriggerTarget,
  saveSettings,
  SECRETS_KEY,
  SETTINGS_KEY,
  stripSecrets,
} from '@/lib/storage/settings';

describe('mergeSettings is lenient per field', () => {
  it('resets only the invalid field, keeping everything else the user set', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, {
      providers: { gemini: { apiKey: 'keep-me', model: 'gemini-x' } },
      history: { maxMb: 999999 }, // out of range
      shortcutAction: 'bogus', // bad enum
      privacy: { chip: false },
    });
    expect(s.providers.gemini.apiKey).toBe('keep-me');
    expect(s.providers.gemini.model).toBe('gemini-x');
    expect(s.privacy.chip).toBe(false);
    expect(s.history.maxMb).toBe(DEFAULT_SETTINGS.history.maxMb);
    expect(s.shortcutAction).toBe(DEFAULT_SETTINGS.shortcutAction);
  });
  it('resets a whole section when its shape is wrong', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { providers: { gemini: 'nope' }, privacy: { snapshots: false } });
    expect(s.providers.gemini).toEqual(DEFAULT_SETTINGS.providers.gemini);
    expect(s.privacy.snapshots).toBe(false);
  });
  it('handles wrong element types inside arrays', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { privacy: { disabledSites: ['ok.com', 42] }, fallback: true });
    expect(s.fallback).toBe(true);
    expect(Array.isArray(s.privacy.disabledSites)).toBe(true);
  });
});

describe('secrets live apart from public settings', () => {
  beforeEach(() => fakeBrowser.reset());

  it('saves keys under their own storage key and blanks them in settings', async () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.providers.gemini.apiKey = 'AIza-secret';
    s.providers.openaiCompat.braveKey = 'BSA-secret';
    await saveSettings(s);
    const stored = await fakeBrowser.storage.local.get([SETTINGS_KEY, SECRETS_KEY]);
    expect(JSON.stringify(stored[SETTINGS_KEY])).not.toContain('secret');
    expect(stored[SECRETS_KEY]).toEqual({ 'providers.gemini.apiKey': 'AIza-secret', 'providers.openaiCompat.braveKey': 'BSA-secret' });
    expect((await loadSettings()).providers.gemini.apiKey).toBe('AIza-secret');
    expect((await loadPublicSettings()).providers.gemini.apiKey).toBe('');
    expect(stripSecrets(s).providers.openaiCompat.braveKey).toBe('');
  });

  it('migrates keys out of an old-style settings object on first load', async () => {
    const old = structuredClone(DEFAULT_SETTINGS);
    old.providers.anthropic.apiKey = 'sk-ant-old';
    await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: old });
    const loaded = await loadSettings();
    expect(loaded.providers.anthropic.apiKey).toBe('sk-ant-old');
    const stored = await fakeBrowser.storage.local.get([SETTINGS_KEY, SECRETS_KEY]);
    expect(JSON.stringify(stored[SETTINGS_KEY])).not.toContain('sk-ant-old');
    expect(stored[SECRETS_KEY]).toEqual({ 'providers.anthropic.apiKey': 'sk-ant-old' });
  });
});

describe('pageTriggerTarget', () => {
  it('sends chip and shortcut to the web when either setting says so', () => {
    expect(pageTriggerTarget(DEFAULT_SETTINGS)).toBe('panel');
    expect(pageTriggerTarget({ ...DEFAULT_SETTINGS, shortcutAction: 'webmode' })).toBe('webmode');
    expect(pageTriggerTarget({ ...DEFAULT_SETTINGS, defaultProvider: 'webmode' })).toBe('webmode');
  });
});
