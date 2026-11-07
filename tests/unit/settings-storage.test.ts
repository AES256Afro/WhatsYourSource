import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  DEFAULT_SETTINGS,
  loadSettingsWithoutSecrets,
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
    expect((await loadSettingsWithoutSecrets()).providers.gemini.apiKey).toBe('');
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

describe('jobs are per window', () => {
  it('ignores jobs addressed to another window', async () => {
    const { jobIsForWindow } = await import('@/lib/jobs');
    const base = { id: 'j', createdAt: 1, input: { kind: 'page' as const, url: 'https://e.com', title: '' } };
    expect(jobIsForWindow({ ...base, windowId: 7 }, 7)).toBe(true);
    expect(jobIsForWindow({ ...base, windowId: 7 }, 8)).toBe(false);
    expect(jobIsForWindow(base, 8)).toBe(true);
    expect(jobIsForWindow({ ...base, windowId: 7 }, undefined)).toBe(true);
  });
  it('serializes overlapping updates', async () => {
    const { updateSettings, loadSettings } = await import('@/lib/storage/settings');
    await Promise.all([
      updateSettings((s) => ({ ...s, providers: { ...s.providers, gemini: { ...s.providers.gemini, apiKey: 'k1' } } })),
      updateSettings((s) => ({ ...s, privacy: { ...s.privacy, chip: false } })),
    ]);
    const s = await loadSettings();
    expect(s.providers.gemini.apiKey).toBe('k1');
    expect(s.privacy.chip).toBe(false);
  });
});

describe('clampInput', () => {
  it('brings oversized producer values within the schema limits instead of letting the job be rejected', async () => {
    const { clampInput, CheckInputSchema, LIMITS } = await import('@/lib/messaging/protocol');
    const long = 'x'.repeat(5000);
    const page = clampInput({ kind: 'page', url: `https://x.com/${long}`, title: long });
    expect(CheckInputSchema.safeParse(page).success).toBe(true);
    expect(page.kind === 'page' && page.title.length).toBe(LIMITS.title);
    const post = clampInput({
      kind: 'post',
      pageUrl: 'https://x.com/a',
      pageTitle: long,
      site: long,
      author: long,
      postedAt: long,
      permalink: 'javascript:alert(1)',
      text: long,
      images: ['data:image/png;base64,AAAA', 'https://i.example/a.jpg'],
      links: Array<string>(20).fill('https://l.example/'),
    });
    const parsed = CheckInputSchema.safeParse(post);
    expect(parsed.success).toBe(true);
    if (post.kind === 'post') {
      expect(post.permalink).toBeUndefined();
      expect(post.images).toEqual(['https://i.example/a.jpg']);
      expect(post.links).toHaveLength(12);
      expect(post.author?.length).toBe(LIMITS.short);
    }
  });
});

describe('oversized inline images', () => {
  it('are replaced by the sentinel so the job still fits the schema', async () => {
    const { clampInput, CheckInputSchema, INLINE_IMAGE_SENTINEL } = await import('@/lib/messaging/protocol');
    const big = clampInput({ kind: 'image', srcUrl: 'data:image/png;base64,' + 'A'.repeat(2_000_000), pageUrl: 'https://x.com/a', pageTitle: 't' });
    expect(big.kind === 'image' && big.srcUrl).toBe(INLINE_IMAGE_SENTINEL);
    expect(CheckInputSchema.safeParse(big).success).toBe(true);
  });
});
