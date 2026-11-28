import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { savedQuestionsChanged } from '@/lib/menus';
import { PUBLIC_KEY, readPublicSettings } from '@/lib/storage/publicSettings';
import {
  DEFAULT_SETTINGS,
  LEGACY_SECRETS_KEY,
  LEGACY_SETTINGS_KEY,
  loadSettingsWithoutSecrets,
  loadSettings,
  mergeSettings,
  onSettingsChanged,
  pageTriggerTarget,
  repairPublicMirror,
  saveSettings,
  SECRET_PATHS,
  serveSettingsMessage,
  SETTINGS_GET,
  SETTINGS_SAVE,
  stripSecrets,
  updateSettings,
  type Settings,
} from '@/lib/storage/settings';
import { readMenusBuiltFrom, readSettingsRecord, resetSettingsDbForTests, writeMenusBuiltFrom } from '@/lib/storage/settingsStore';

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

const BASE_URL = 'https://llm.example.net/v1';
const SECRET = (p: readonly string[]) => `SECRET-${p.join('-')}`;

/** Settings with every key set to a distinct value and a non-default endpoint. */
function withAllSecrets(): Settings {
  const s = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, Record<string, Record<string, unknown>>>;
  for (const p of SECRET_PATHS) {
    let cur: Record<string, unknown> = s;
    for (const k of p.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
    cur[p[p.length - 1]!] = SECRET(p);
  }
  const out = s as unknown as Settings;
  out.providers.openaiCompat.baseUrl = BASE_URL;
  out.ask = { default: 'custom', custom: 'Who pays?', saved: ['Who pays?'] };
  return out;
}

/** Everything in storage.local, as one string, must hold no key and no endpoint. */
async function expectNothingSecretInStorageLocal() {
  const all = JSON.stringify(await fakeBrowser.storage.local.get(null));
  for (const p of SECRET_PATHS) expect(all).not.toContain(SECRET(p));
  expect(all).not.toContain(BASE_URL);
  expect(all).not.toContain('llm.example.net');
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('settings live in the extension database, not storage.local', () => {
  beforeEach(() => fakeBrowser.reset());

  it('a save puts everything in the database and only the chip fields in the public mirror', async () => {
    await saveSettings(withAllSecrets());
    const all = await fakeBrowser.storage.local.get(null);
    expect(Object.keys(all)).toEqual([PUBLIC_KEY]);
    expect(Object.keys(all[PUBLIC_KEY] as object).sort()).toEqual(['askName', 'chip', 'disabledSites', 'rev', 'trigger']);
    expect(JSON.stringify(all[PUBLIC_KEY])).not.toContain('Who pays?'); // the chip shows the name, not the words
    await expectNothingSecretInStorageLocal();
    const loaded = await loadSettings();
    for (const p of SECRET_PATHS) expect(JSON.stringify(loaded)).toContain(SECRET(p));
    expect(loaded.providers.openaiCompat.baseUrl).toBe(BASE_URL);
    expect((await loadSettingsWithoutSecrets()).providers.gemini.apiKey).toBe('');
    expect(stripSecrets(loaded).providers.openaiCompat.braveKey).toBe('');
  });

  it('migrates 1.2.x/1.3.0 storage (settings + secrets) into the database and removes the old keys', async () => {
    const s = withAllSecrets();
    await fakeBrowser.storage.local.set({
      [LEGACY_SETTINGS_KEY]: stripSecrets(s),
      [LEGACY_SECRETS_KEY]: Object.fromEntries(SECRET_PATHS.map((p) => [p.join('.'), SECRET(p)])),
    });
    const loaded = await loadSettings();
    expect(loaded).toEqual(s);
    const stored = await fakeBrowser.storage.local.get(null);
    expect(stored[LEGACY_SETTINGS_KEY]).toBeUndefined();
    expect(stored[LEGACY_SECRETS_KEY]).toBeUndefined();
    expect(readPublicSettings(stored[PUBLIC_KEY]).askName).toBe('Your question');
    await expectNothingSecretInStorageLocal();
    expect(mergeSettings(DEFAULT_SETTINGS, (await readSettingsRecord()).settings)).toEqual(s);
  });

  it('migrates a pre-split install that kept the keys inside settings', async () => {
    const old = structuredClone(DEFAULT_SETTINGS);
    old.providers.anthropic.apiKey = 'sk-ant-old';
    await fakeBrowser.storage.local.set({ [LEGACY_SETTINGS_KEY]: old });
    expect((await loadSettings()).providers.anthropic.apiKey).toBe('sk-ant-old');
    const stored = await fakeBrowser.storage.local.get(null);
    expect(Object.keys(stored)).toEqual([PUBLIC_KEY]);
    expect(JSON.stringify(stored)).not.toContain('sk-ant-old');
  });

  it('migrates once: an old-format key planted afterwards is ignored and swept', async () => {
    await fakeBrowser.storage.local.set({ [LEGACY_SETTINGS_KEY]: { defaultProvider: 'anthropic' } });
    expect((await loadSettings()).defaultProvider).toBe('anthropic');
    const { rev } = await readSettingsRecord();
    await fakeBrowser.storage.local.set({
      [LEGACY_SETTINGS_KEY]: { defaultProvider: 'openai-compat', providers: { openaiCompat: { baseUrl: 'http://evil.test/v1' } } },
    });
    const again = await loadSettings();
    expect(again.defaultProvider).toBe('anthropic');
    expect(again.providers.openaiCompat.baseUrl).toBe(DEFAULT_SETTINGS.providers.openaiCompat.baseUrl);
    expect((await readSettingsRecord()).rev).toBe(rev);
    await tick();
    expect((await fakeBrowser.storage.local.get(LEGACY_SETTINGS_KEY))[LEGACY_SETTINGS_KEY]).toBeUndefined();
  });

  it('two first loads at once migrate once', async () => {
    await fakeBrowser.storage.local.set({ [LEGACY_SETTINGS_KEY]: { onboarded: true }, [LEGACY_SECRETS_KEY]: { 'providers.gemini.apiKey': 'k' } });
    const remove = vi.spyOn(fakeBrowser.storage.local, 'remove');
    const [a, b, c] = await Promise.all([loadSettings(), loadSettings(), updateSettings((s) => ({ ...s, fallback: true }))]);
    expect(a.providers.gemini.apiKey).toBe('k');
    expect(b.providers.gemini.apiKey).toBe('k');
    expect(c.providers.gemini.apiKey).toBe('k');
    expect(remove).toHaveBeenCalledTimes(1);
    remove.mockRestore();
    // One migration (rev 1) and one save (rev 2).
    expect((await readSettingsRecord()).rev).toBe(2);
    expect((await loadSettings()).fallback).toBe(true);
  });

  it('a forged mirror write changes nothing the extension trusts, and the background puts it back', async () => {
    await saveSettings(withAllSecrets());
    const before = await loadSettings();
    const seen: Settings[] = [];
    const off = onSettingsChanged((s) => seen.push(s));
    const forged = {
      rev: 999,
      chip: false,
      disabledSites: [],
      trigger: 'webmode',
      askName: '',
      providers: { openaiCompat: { baseUrl: 'http://evil.test/v1' } },
    };
    await fakeBrowser.storage.local.set({ [PUBLIC_KEY]: forged });
    await tick();
    expect(await loadSettings()).toEqual(before);
    expect(seen.at(-1)).toEqual(before); // the change only caused a reload from the database
    off();
    expect(await repairPublicMirror(forged)).toBe(true);
    const repaired = (await fakeBrowser.storage.local.get(PUBLIC_KEY))[PUBLIC_KEY];
    expect(readPublicSettings(repaired)).toMatchObject({ chip: true, trigger: 'panel' });
    expect(await repairPublicMirror(repaired)).toBe(false); // no loop
  });

  it('every save bumps the revision and tells onSettingsChanged listeners', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    const rev1 = ((await fakeBrowser.storage.local.get(PUBLIC_KEY))[PUBLIC_KEY] as { rev: number }).rev;
    const seen: Settings[] = [];
    const off = onSettingsChanged((s) => seen.push(s));
    await updateSettings((s) => ({ ...s, privacy: { ...s.privacy, chip: false } }));
    await saveSettings({ ...DEFAULT_SETTINGS, privacy: { ...DEFAULT_SETTINGS.privacy, chip: false } }); // same content, still a change
    await tick();
    off();
    const mirror = (await fakeBrowser.storage.local.get(PUBLIC_KEY))[PUBLIC_KEY] as { rev: number; chip: boolean };
    expect(mirror.rev).toBe(rev1 + 2);
    expect(mirror.chip).toBe(false);
    expect(seen).toHaveLength(2);
    expect(seen.every((s) => !s.privacy.chip)).toBe(true);
  });
});

describe('the menu rebuild check survives a worker wake', () => {
  it('compares with the list persisted in the settings database', async () => {
    expect(await readMenusBuiltFrom()).toBeNull();
    expect(savedQuestionsChanged(['A?'], await readMenusBuiltFrom())).toBe(true);
    await writeMenusBuiltFrom(['A?', 'B?']);
    resetSettingsDbForTests(); // a new worker: a new connection to the same database
    expect(await readMenusBuiltFrom()).toEqual(['A?', 'B?']);
    expect(savedQuestionsChanged(['A?', 'B?'], await readMenusBuiltFrom())).toBe(false);
    expect(savedQuestionsChanged(['B?', 'A?'], await readMenusBuiltFrom())).toBe(true);
  });
});

describe('private-window pages get their settings from the background', () => {
  const page = () => ({ id: fakeBrowser.runtime.id, url: fakeBrowser.runtime.getURL('/options.html') });
  const contentScript = () => ({ id: fakeBrowser.runtime.id, url: 'https://evil.example/article', tab: { id: 4 }, frameId: 0 });
  beforeEach(() => fakeBrowser.reset());
  afterEach(() => {
    (fakeBrowser.extension as { inIncognitoContext: boolean }).inIncognitoContext = false;
    vi.restoreAllMocks();
  });

  it('refuses a content script and serves an extension page', async () => {
    await saveSettings(withAllSecrets());
    expect(await serveSettingsMessage({ type: SETTINGS_GET }, contentScript())).toEqual({ ok: false, error: 'refused' });
    expect(await serveSettingsMessage({ type: SETTINGS_GET }, { id: 'another-extension', url: 'chrome-extension://another-extension/x.html' })).toEqual({
      ok: false,
      error: 'refused',
    });
    const evil = {
      ...DEFAULT_SETTINGS,
      defaultProvider: 'openai-compat',
      providers: { ...DEFAULT_SETTINGS.providers, openaiCompat: { ...DEFAULT_SETTINGS.providers.openaiCompat, baseUrl: 'http://evil.test/v1' } },
    };
    expect(await serveSettingsMessage({ type: SETTINGS_SAVE, settings: evil }, contentScript())).toEqual({ ok: false, error: 'refused' });
    expect((await loadSettings()).providers.openaiCompat.baseUrl).toBe(BASE_URL);
    // Not ours, or malformed.
    expect(serveSettingsMessage({ type: 'wys:check' }, page())).toBeNull();
    expect(await serveSettingsMessage({ type: SETTINGS_SAVE, settings: { version: 2 } }, page())).toEqual({ ok: false, error: 'bad request' });

    const got = await serveSettingsMessage({ type: SETTINGS_GET }, page());
    expect(got?.ok && mergeSettings(DEFAULT_SETTINGS, got.settings).providers.gemini.apiKey).toBe(SECRET(['providers', 'gemini', 'apiKey']));
  });

  it('loads and saves through runtime messages when the page is in a private window', async () => {
    await saveSettings(withAllSecrets());
    (fakeBrowser.extension as { inIncognitoContext: boolean }).inIncognitoContext = true;
    // The background's reply, as an extension page in a private window would receive it.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- sendMessage resolves to the reply
    const send = vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((msg: unknown) => serveSettingsMessage(msg, page()));
    const loaded = await loadSettings();
    expect(loaded.providers.openaiCompat.baseUrl).toBe(BASE_URL);
    await updateSettings((s) => ({ ...s, twoPass: false }));
    expect(send.mock.calls.map(([m]) => (m as unknown as { type: string }).type)).toEqual([SETTINGS_GET, SETTINGS_GET, SETTINGS_SAVE]);
    (fakeBrowser.extension as { inIncognitoContext: boolean }).inIncognitoContext = false;
    expect((await loadSettings()).twoPass).toBe(false);
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
