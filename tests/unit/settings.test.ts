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
