import { z } from 'zod';
import { browser } from 'wxt/browser';

/** `'webmode'` is Google AI Mode on google.com: chosen like a provider, but never an LLM call (`createProvider` returns null for it). */
export const PROVIDER_IDS = ['gemini', 'openai-compat', 'anthropic', 'webmode'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
/** The providers that are LLM calls; `'webmode'` opens Google AI Mode in a tab instead. */
export const LLM_PROVIDER_IDS = ['gemini', 'anthropic', 'openai-compat'] as const satisfies readonly ProviderId[];

const SEARCH_TOOLS = ['none', 'searxng', 'brave', 'tavily'] as const;
export type SearchToolId = (typeof SEARCH_TOOLS)[number];

/**
 * Checked 2026-11-07 against aistudio.google.com/docs/models. The 2.5 series is deprecated and is
 * routed to 3.x models from 2026-12-01; the 2.0 series is shut down. The Verify button lists whatever
 * the key can actually use, so this is only the starting menu.
 */
export const GEMINI_MODELS = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash — best balance (default)' },
  { id: 'gemini-4-argon', label: 'Gemini 4 Argon — flagship, pricier' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite — fast and cheap' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite — cheapest' },
] as const;

export const SettingsSchema = z.object({
  version: z.literal(1),
  onboarded: z.boolean(),
  defaultProvider: z.enum(PROVIDER_IDS),
  /** If the default provider fails or is over quota, try the next configured one. */
  fallback: z.boolean(),
  /** What the keyboard shortcut (Alt+Shift+S by default) and the floating chip do. */
  shortcutAction: z.enum(['panel', 'webmode']),
  /** Google on the web: AI Mode (a conversational answer) or a normal search page with its AI Overview. */
  webmodeVariant: z.enum(['ai-mode', 'overview']),
  /** Extract the claims first (a cheap extra call) so each one can be looked up and checked on its own. */
  twoPass: z.boolean(),
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
      /** What the server said about the selected model (Test button); null = not asked / unknown. */
      modelVision: z.boolean().nullable(),
      modelTools: z.boolean().nullable(),
      modelContext: z.number().nullable(),
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
  history: z.object({
    /** Snapshot storage cap; oldest snapshots are dropped first (results are kept). */
    maxMb: z.number().min(10).max(5000),
  }),
  /** Deterministic lookups that run beside the model and work with every provider. */
  lookups: z.object({
    /** Google Fact Check Tools (ClaimReview) — free key from Google Cloud. */
    factChecks: z.boolean(),
    factCheckKey: z.string(),
    /** Wayback Machine first-capture dates. */
    archive: z.boolean(),
    /** Source reputation from Wikipedia's perennial-sources list, shipped offline. */
    credibility: z.boolean(),
  }),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  onboarded: false,
  defaultProvider: 'gemini',
  fallback: false,
  shortcutAction: 'panel',
  webmodeVariant: 'ai-mode',
  twoPass: true,
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
      modelVision: null,
      modelTools: null,
      modelContext: null,
    },
    anthropic: { apiKey: '', model: 'claude-sonnet-5-5' },
  },
  privacy: { snapshots: true, chip: true, disabledSites: [] },
  history: { maxMb: 200 },
  lookups: { factChecks: true, factCheckKey: '', archive: true, credibility: true },
};

/**
 * Storage layout. `settings` holds everything *except* API keys and is what the content script
 * (which runs on every page) reads for the chip. `secrets` holds the keys and is only ever read by
 * extension pages. Older installs kept the keys inside `settings`; `loadSettings` migrates them.
 */
export const SETTINGS_KEY = 'settings';
export const SECRETS_KEY = 'secrets';

const SECRET_PATHS: readonly (readonly string[])[] = [
  ['providers', 'gemini', 'apiKey'],
  ['providers', 'openaiCompat', 'apiKey'],
  ['providers', 'openaiCompat', 'braveKey'],
  ['providers', 'openaiCompat', 'tavilyKey'],
  ['providers', 'anthropic', 'apiKey'],
  ['lookups', 'factCheckKey'],
];

type Plain = Record<string, unknown>;
function isPlain(v: unknown): v is Plain {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function getPath(obj: unknown, path: readonly (string | number)[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (!isPlain(cur) && !Array.isArray(cur)) return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

function setPath(obj: Plain, path: readonly (string | number)[], value: unknown): void {
  let cur: Record<string | number, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i]!;
    const next = cur[k];
    if (!isPlain(next) && !Array.isArray(next)) {
      cur[k] = {};
    }
    cur = cur[k] as Record<string | number, unknown>;
  }
  cur[path[path.length - 1]!] = value;
}

function deepMerge(b: Plain, p: Plain): Plain {
  const out: Plain = { ...b };
  for (const [k, v] of Object.entries(p)) {
    if (isPlain(v) && isPlain(b[k])) out[k] = deepMerge(b[k], v);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Deep-merge stored values over defaults so new fields never break old installs. Invalid fields are
 * reset to their default one at a time (guided by the schema's issue paths), so one bad value never
 * throws away the rest of the user's settings.
 */
export function mergeSettings(base: Settings, patch: unknown): Settings {
  if (!isPlain(patch)) return base;
  const merged = deepMerge(base, patch);
  for (let attempt = 0; attempt < 32; attempt++) {
    const parsed = SettingsSchema.safeParse(merged);
    if (parsed.success) return parsed.data;
    let changed = false;
    for (const issue of parsed.error.issues) {
      const path = issue.path.filter((p): p is string | number => typeof p === 'string' || typeof p === 'number');
      if (path.length === 0) return base;
      const fallback = getPath(base, path);
      if (fallback === undefined) {
        // Unknown key or deeper than the defaults go: reset the nearest known ancestor.
        const parent = path.slice(0, -1);
        if (parent.length === 0) return base;
        setPath(merged, parent, structuredClone(getPath(base, parent)));
      } else {
        setPath(merged, path, structuredClone(fallback));
      }
      changed = true;
    }
    if (!changed) return base;
  }
  return base;
}

/** The settings object with every secret blanked, which is what goes under `settings` in storage. */
export function stripSecrets(s: Settings): Settings {
  const copy = structuredClone(s) as unknown as Plain;
  for (const p of SECRET_PATHS) setPath(copy, p, '');
  return SettingsSchema.parse(copy);
}

function collectSecrets(s: Settings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of SECRET_PATHS) {
    const v = getPath(s, p);
    if (typeof v === 'string' && v) out[p.join('.')] = v;
  }
  return out;
}

function applySecrets(s: Settings, secrets: unknown): Settings {
  if (!isPlain(secrets)) return s;
  const copy = structuredClone(s) as unknown as Plain;
  for (const p of SECRET_PATHS) {
    const v = secrets[p.join('.')];
    if (typeof v === 'string' && v) setPath(copy, p, v);
  }
  return SettingsSchema.parse(copy);
}

/** Full settings, keys included. Extension pages only. */
export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get([SETTINGS_KEY, SECRETS_KEY]);
  const pub = mergeSettings(DEFAULT_SETTINGS, stored[SETTINGS_KEY]);
  const withSecrets = applySecrets(pub, stored[SECRETS_KEY]);
  // Pre-split installs kept keys inside `settings`; move them out once.
  if (Object.keys(collectSecrets(pub)).length > 0) {
    await saveSettings(withSecrets);
  }
  return withSecrets;
}

/** Settings without keys: what the background keeps in memory (the content script reads `publicSettings` instead). */
export async function loadSettingsWithoutSecrets(): Promise<Settings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  return mergeSettings(DEFAULT_SETTINGS, stored[SETTINGS_KEY]);
}

export async function saveSettings(next: Settings): Promise<void> {
  const parsed = SettingsSchema.parse(next);
  await browser.storage.local.set({ [SETTINGS_KEY]: stripSecrets(parsed), [SECRETS_KEY]: collectSecrets(parsed) });
}

let updateQueue: Promise<unknown> = Promise.resolve();

/** Read-modify-write helper, serialized so two quick edits (blur + click) cannot drop each other. */
export function updateSettings(mutate: (s: Settings) => Settings): Promise<Settings> {
  const run = updateQueue.then(async () => {
    const current = await loadSettings();
    const next = mutate(structuredClone(current));
    await saveSettings(next);
    return next;
  });
  updateQueue = run.catch(() => undefined);
  return run;
}

/** Fires with the full settings (keys included) whenever either storage key changes. Extension pages only. */
export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local') return;
    if (!(SETTINGS_KEY in changes) && !(SECRETS_KEY in changes)) return;
    void loadSettings().then(cb);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/** Is this one provider (the default unless given) configured well enough to try? */
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
    for (const id of LLM_PROVIDER_IDS) {
      if (id !== s.defaultProvider && providerReady(s, id)) order.push(id);
    }
  }
  return order.filter((id) => id !== 'webmode');
}

export { pageTriggerTarget } from './publicSettings';
