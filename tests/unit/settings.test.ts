import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, providerOrder, providerReady } from '@/lib/storage/settings';
import { googleAiModeUrl } from '@/lib/webmode';
import { domainOf, normalizeUrl } from '@/lib/util/url';

describe('settings', () => {
  it('merges partial stored settings over defaults', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { providers: { gemini: { apiKey: 'abc' } }, privacy: { chip: false } });
    expect(s.providers.gemini.apiKey).toBe('abc');
    expect(s.providers.gemini.model).toBe(DEFAULT_SETTINGS.providers.gemini.model);
    expect(s.privacy.chip).toBe(false);
    expect(s.privacy.snapshots).toBe(true);
  });
  it('falls back to defaults on invalid data', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { defaultProvider: 'nope' })).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(DEFAULT_SETTINGS, 'garbage')).toEqual(DEFAULT_SETTINGS);
  });
  it('knows which providers are ready and the fallback order', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { fallback: true, providers: { gemini: { apiKey: 'k' }, anthropic: { apiKey: 'a' } } });
    expect(providerReady(s, 'gemini')).toBe(true);
    expect(providerReady(s, 'openai-compat')).toBe(false);
    expect(providerOrder(s)).toEqual(['gemini', 'anthropic']);
    expect(providerOrder({ ...s, fallback: false })).toEqual(['gemini']);
  });
});

describe('webmode + url helpers', () => {
  it('builds a Google AI Mode URL with the text', () => {
    const u = googleAiModeUrl({ kind: 'text', text: 'hello world', pageUrl: '', pageTitle: '' });
    expect(u.startsWith('https://www.google.com/search?udm=50&q=')).toBe(true);
    expect(decodeURIComponent(u)).toContain('"hello world"');
  });
  it('normalizes urls and extracts domains', () => {
    expect(domainOf('https://www.Example.com/a/b')).toBe('example.com');
    expect(domainOf('quoteinvestigator.com')).toBe('quoteinvestigator.com');
    expect(normalizeUrl('https://www.example.com/p/?utm_source=x#frag')).toBe(normalizeUrl('https://example.com/p'));
  });
});

describe('shortcut labels', () => {
  it('spells the binding for the platform', async () => {
    const { shortcutLabelForPlatform, DEFAULT_SHORTCUT } = await import('@/lib/shortcut');
    expect(DEFAULT_SHORTCUT).toBe('Alt+Shift+S');
    const label = shortcutLabelForPlatform('Alt+Shift+S');
    expect(['Alt+Shift+S', '⌥⇧S']).toContain(label);
    expect(shortcutLabelForPlatform('Ctrl+Shift+S')).toMatch(/Ctrl\+Shift\+S|⌘⇧S/);
  });
});

describe('pricing', () => {
  it('prices by the longest matching model prefix', async () => {
    const { estimateUsd } = await import('@/lib/providers/pricing');
    expect(estimateUsd('gemini-3.5-flash-lite', 1_000_000, 0)).toBeCloseTo(0.3, 5);
    expect(estimateUsd('gemini-3.8-flash', 1_000_000, 1_000_000, 1)).toBeCloseTo(0.75 + 3.75 + 0.014, 5);
    expect(estimateUsd('unknown-model', 10, 10)).toBeUndefined();
  });
});

describe('manifest description', () => {
  it('fits the Chrome Web Store limit', async () => {
    const { EXTENSION_DESCRIPTION, MANIFEST_DESCRIPTION_MAX } = await import('@/lib/meta');
    expect(EXTENSION_DESCRIPTION.length).toBeLessThanOrEqual(MANIFEST_DESCRIPTION_MAX);
  });
});
