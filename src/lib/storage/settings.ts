import { z } from 'zod';
import { browser } from 'wxt/browser';

export const PROVIDER_IDS = ['gemini', 'openai-compat', 'anthropic', 'webmode'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const SEARCH_TOOLS = ['none', 'searxng', 'brave', 'tavily'] as const;
export type SearchToolId = (typeof SEARCH_TOOLS)[number];

/** Checked 2026-10-12 against ai.google.dev/gemini-api/docs/models. The 2.5 series shuts down 2026-10-16. */
export const GEMINI_MODELS = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash — best quality' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite — fast and cheap' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite — cheapest' },
] as const;

export const SettingsSchema = z.object({
  version: z.literal(1),
  onboarded: z.boolean(),
  defaultProvider: z.enum(PROVIDER_IDS),
  /** If the default provider fails or is over quota, try the next configured one. */
  fallback: z.boolean(),
  /** What Ctrl+Shift+S and the floating chip do. */
  shortcutAction: z.enum(['panel', 'webmode']),
  providers: z.object({
    gemini: z.object({
      apiKey: z.string(),
      model: z.string(),
      grounding: z.boolean(),
      urlContext: z.boolean(),
    }),
    openaiCompat: z.object({
      baseUrl: z.string(),
      apiKey: z.string(),
      model: z.string(),
      searchTool: z.enum(SEARCH_TOOLS),
      searxngUrl: z.string(),
      braveKey: z.string(),
      tavilyKey: z.string(),
    }),
    anthropic: z.object({
      apiKey: z.string(),
      model: z.string(),
    }),
  }),
  privacy: z.object({
    /** Save a copy of the page with each check (local only). */
    snapshots: z.boolean(),
    /** Show the floating "Check source" chip when text is selected. */
    chip: z.boolean(),
    /** Hostnames where the chip is never shown. */
    disabledSites: z.array(z.string()),
  }),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  onboarded: false,
  defaultProvider: 'gemini',
  fallback: false,
  shortcutAction: 'panel',
  providers: {
    gemini: { apiKey: '', model: 'gemini-3.8-flash', grounding: true, urlContext: true },
    openaiCompat: {
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      model: '',
      searchTool: 'none',
      searxngUrl: '',
      braveKey: '',
      tavilyKey: '',
    },
    anthropic: { apiKey: '', model: 'claude-sonnet-5-5' },
  },
  privacy: { snapshots: true, chip: true, disabledSites: [] },
};

const STORAGE_KEY = 'settings';

type Plain = Record<string, unknown>;
function isPlain(v: unknown): v is Plain {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/** Deep-merge stored values over defaults so new fields never break old installs. */
export function mergeSettings(base: Settings, patch: unknown): Settings {
  const merge = (b: Plain, p: Plain): Plain => {
    const out: Plain = { ...b };
    for (const [k, v] of Object.entries(p)) {
      if (isPlain(v) && isPlain(b[k])) out[k] = merge(b[k] as Plain, v);
      else if (v !== undefined) out[k] = v;
    }
    return out;
  };
  const merged = isPlain(patch) ? merge(base as unknown as Plain, patch) : base;
  const parsed = SettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : base;
}

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  return mergeSettings(DEFAULT_SETTINGS, stored[STORAGE_KEY]);
}

export async function saveSettings(next: Settings): Promise<void> {
  const parsed = SettingsSchema.parse(next);
  await browser.storage.local.set({ [STORAGE_KEY]: parsed });
}

/** Shallow helper for `saveSettings({...settings, ...})` call sites that only know a path. */
export async function updateSettings(mutate: (s: Settings) => Settings): Promise<Settings> {
  const current = await loadSettings();
  const next = mutate(structuredClone(current));
  await saveSettings(next);
  return next;
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local') return;
    const change = changes[STORAGE_KEY];
    if (change) cb(mergeSettings(DEFAULT_SETTINGS, change.newValue));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/** Is any provider usable right now? */
export function providerReady(s: Settings, id: ProviderId = s.defaultProvider): boolean {
  switch (id) {
    case 'gemini':
      return s.providers.gemini.apiKey.trim().length > 0;
    case 'openai-compat':
      return s.providers.openaiCompat.baseUrl.trim().length > 0 && s.providers.openaiCompat.model.trim().length > 0;
    case 'anthropic':
      return s.providers.anthropic.apiKey.trim().length > 0;
    case 'webmode':
      return true;
  }
}

/** Providers to try, in order: default first, then the others that are configured (if fallback is on). */
export function providerOrder(s: Settings): ProviderId[] {
  const order: ProviderId[] = [s.defaultProvider];
  if (s.fallback) {
    for (const id of ['gemini', 'anthropic', 'openai-compat'] as const) {
      if (id !== s.defaultProvider && providerReady(s, id)) order.push(id);
    }
  }
  return order.filter((id) => id !== 'webmode');
}
