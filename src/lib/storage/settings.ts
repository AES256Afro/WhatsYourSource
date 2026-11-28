import { z } from 'zod';
import { browser } from 'wxt/browser';
import { createSettingsRecord, readSettingsRecord, writeSettingsRecord } from './settingsStore';
import { PUBLIC_KEY, sameMirror, toPublicMirror } from './publicSettings';
import { ASK_IDS, cleanCustomQuestion, MAX_CUSTOM_QUESTION, normalizeAsk, normalizeAskSettings, type Ask } from '../pipeline/question';

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
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash · default' },
  { id: 'gemini-4-argon', label: 'Gemini 4 Argon · flagship' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite · cheap' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite · cheapest' },
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
  /** The question a check asks unless one is picked for it: a preset, or one of the user's own (`custom`). */
  ask: z.object({
    default: z.enum(ASK_IDS),
    /** The user's question used as the default when `default` is `'custom'` (one of `saved`, normally). */
    custom: z.string().max(MAX_CUSTOM_QUESTION),
    /**
     * The user's own questions, at most `MAX_SAVED_QUESTIONS`, each cleaned, no repeats. The schema
     * takes any list of strings so one bad entry never resets the rest; `normalizeAskSettings` trims it.
     */
    saved: z.array(z.string()),
  }),
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
  ask: { default: 'factcheck', custom: '', saved: [] },
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

/** The question checks ask by default, as chosen in Settings or on the home screen. */
export function defaultAsk(s: Pick<Settings, 'ask'>): Ask {
  return normalizeAsk({ id: s.ask.default, custom: s.ask.custom });
}

/**
 * Storage layout (since 1.3.1). The full settings, API keys included, live in the extension's own
 * IndexedDB (`settingsStore.ts`): web pages and the content script that runs in them cannot open it.
 * The content script gets a small public copy under `PUBLIC_KEY` in `storage.local` (`publicSettings.ts`),
 * rewritten by every save; a change to that key is also the signal extension pages and the background
 * reload on. 1.3.0 and older kept everything in `storage.local` under `settings` and `secrets`
 * (older still: keys inside `settings`); the first load migrates them once and removes them.
 */
export const LEGACY_SETTINGS_KEY = 'settings';
export const LEGACY_SECRETS_KEY = 'secrets';

export const SECRET_PATHS: readonly (readonly string[])[] = [
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
  migrateAsk(merged, patch);
  for (let attempt = 0; attempt < 32; attempt++) {
    const parsed = SettingsSchema.safeParse(merged);
    if (parsed.success) return withNormalizedAsk(parsed.data);
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

/**
 * Settings stored by 1.2.x have one custom question (`ask.custom`) and no `ask.saved`: that question
 * becomes the first saved one. Entries that are not strings are dropped here, before the schema
 * check, so one bad entry does not reset the whole list.
 */
function migrateAsk(merged: Plain, patch: Plain): void {
  const ask = merged.ask;
  if (!isPlain(ask)) return;
  const storedAsk = patch.ask;
  if (!isPlain(storedAsk)) return;
  if (storedAsk.saved === undefined) {
    const custom = cleanCustomQuestion(typeof ask.custom === 'string' ? ask.custom : '');
    ask.saved = custom ? [custom] : [];
  } else if (Array.isArray(ask.saved)) {
    ask.saved = ask.saved.filter((q): q is string => typeof q === 'string');
  }
}

/** The settings with the question settings made consistent (see `normalizeAskSettings`). */
export function withNormalizedAsk(s: Settings): Settings {
  return { ...s, ask: normalizeAskSettings(s.ask) };
}

/** The settings object with every secret blanked (the background's in-memory copy). */
export function stripSecrets(s: Settings): Settings {
  const copy = structuredClone(s) as unknown as Plain;
  for (const p of SECRET_PATHS) setPath(copy, p, '');
  return SettingsSchema.parse(copy);
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

const LOCK_NAME = 'wys-settings-migrate';
let localLock: Promise<unknown> = Promise.resolve();

/**
 * Runs `fn` with the migration lock held: `navigator.locks` spans every extension page and the
 * background (Chrome and Firefox), so two panels and the worker starting together migrate once.
 * Where it is missing (tests) a promise chain serialises within this context; the database's
 * create-if-absent transaction is the backstop either way.
 */
function withMigrationLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as (Navigator & { locks?: LockManager }) | undefined)?.locks;
  if (locks?.request) return locks.request(LOCK_NAME, fn) as Promise<T>;
  const run = localLock.then(fn);
  localLock = run.catch(() => undefined);
  return run;
}

/**
 * Moves 1.3.0-and-older settings out of `storage.local` into the database, once. Only runs while the
 * database has no settings record; afterwards nothing reads the old keys again, so an old-format
 * `settings` or `secrets` key that a page plants later is ignored (and removed by `sweepLegacyKeys`).
 */
async function migrate(): Promise<{ settings: Settings; rev: number }> {
  return withMigrationLock(async () => {
    const existing = await readSettingsRecord();
    if (existing.settings !== undefined) return { settings: mergeSettings(DEFAULT_SETTINGS, existing.settings), rev: existing.rev };
    const old = await browser.storage.local.get([LEGACY_SETTINGS_KEY, LEGACY_SECRETS_KEY]);
    // mergeSettings keeps keys that pre-split installs stored inside `settings`; `secrets` wins where set.
    const migrated = applySecrets(mergeSettings(DEFAULT_SETTINGS, old[LEGACY_SETTINGS_KEY]), old[LEGACY_SECRETS_KEY]);
    const { created, rev } = await createSettingsRecord(migrated);
    const settings = created ? migrated : mergeSettings(DEFAULT_SETTINGS, (await readSettingsRecord()).settings);
    if (created) await writeMirror(settings, rev);
    await browser.storage.local.remove([LEGACY_SETTINGS_KEY, LEGACY_SECRETS_KEY]);
    return { settings, rev };
  });
}

let swept: Promise<void> | null = null;
/** Once per context: drop old-format keys left in `storage.local` (a migration cut short, or planted). Never read. */
function sweepLegacyKeys(): Promise<void> {
  // Under the migration lock, so it never races a migration that is still moving the keys.
  swept ??= withMigrationLock(async () => {
    const r = await browser.storage.local.get([LEGACY_SETTINGS_KEY, LEGACY_SECRETS_KEY]);
    if (Object.values(r).some((v) => v !== undefined)) await browser.storage.local.remove([LEGACY_SETTINGS_KEY, LEGACY_SECRETS_KEY]);
  }).catch(() => undefined);
  return swept;
}

/** For tests: forget this context's one-time work. */
export function resetSettingsForTests(): void {
  swept = null;
  localLock = Promise.resolve();
}

/** Settings and revision straight from the database (migrating first if it is empty). Not for private-window pages. */
async function loadDirect(): Promise<{ settings: Settings; rev: number }> {
  const stored = await readSettingsRecord();
  if (stored.settings === undefined) return migrate();
  void sweepLegacyKeys();
  return { settings: mergeSettings(DEFAULT_SETTINGS, stored.settings), rev: stored.rev };
}

async function saveDirect(next: Settings): Promise<void> {
  const parsed = withNormalizedAsk(SettingsSchema.parse(next));
  // A first save must not skip the migration: the old keys would stay behind in storage.local.
  await loadDirect();
  const rev = await writeSettingsRecord(parsed);
  await writeMirror(parsed, rev);
}

function writeMirror(s: Settings, rev: number): Promise<void> {
  return browser.storage.local.set({ [PUBLIC_KEY]: toPublicMirror(s, rev) });
}

/**
 * Firefox gives extension pages in a private window their own, in-memory IndexedDB, where the
 * settings would look empty. Those pages ask the background (which runs outside the private window
 * and serves its own database) instead. In Chrome this is never true for our pages.
 */
function viaBackground(): boolean {
  try {
    return (browser.extension as { inIncognitoContext?: boolean } | undefined)?.inIncognitoContext === true;
  } catch {
    return false;
  }
}

export const SETTINGS_GET = 'wys:settings-get';
/** The page sends the whole next object: `updateSettings`'s mutate function cannot cross a message. */
export const SETTINGS_SAVE = 'wys:settings-save';
const SettingsMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal(SETTINGS_GET) }).strict(),
  z.object({ type: z.literal(SETTINGS_SAVE), settings: SettingsSchema }).strict(),
]);
const SettingsReplySchema = z.union([
  z.object({ ok: z.literal(true), settings: z.unknown().optional() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
type SettingsReply = z.infer<typeof SettingsReplySchema>;

async function askBackground(msg: z.infer<typeof SettingsMessageSchema>): Promise<unknown> {
  const reply = SettingsReplySchema.parse(await browser.runtime.sendMessage(msg));
  if (!reply.ok) throw new Error(reply.error);
  return reply.settings;
}

/** True only for the extension's own pages: a content script's sender carries the web page's URL. */
export function fromOwnPage(sender: { id?: string; url?: string }): boolean {
  const own = browser.runtime.getURL('');
  return sender.id === browser.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(own);
}

/**
 * The background's side of `viaBackground`: null for any other message; for a settings message, the
 * reply. Refused unless the sender is one of the extension's own pages.
 */
export function serveSettingsMessage(raw: unknown, sender: { id?: string; url?: string }): Promise<SettingsReply> | null {
  const parsed = SettingsMessageSchema.safeParse(raw);
  if (!parsed.success) {
    // A settings request with a malformed body is still answered (and refused), never passed on.
    const type = typeof raw === 'object' && raw !== null ? (raw as { type?: unknown }).type : undefined;
    return type === SETTINGS_GET || type === SETTINGS_SAVE ? Promise.resolve({ ok: false, error: 'bad request' }) : null;
  }
  if (!fromOwnPage(sender)) return Promise.resolve({ ok: false, error: 'refused' });
  const msg = parsed.data;
  const work =
    msg.type === SETTINGS_GET
      ? loadDirect().then(({ settings }) => ({ ok: true as const, settings }))
      : saveDirect(msg.settings).then(() => ({ ok: true as const }));
  return work.catch((e: unknown) => ({ ok: false as const, error: String(e) }));
}

/** Full settings, keys included. Extension pages and the background only. */
export async function loadSettings(): Promise<Settings> {
  if (viaBackground()) return mergeSettings(DEFAULT_SETTINGS, await askBackground({ type: SETTINGS_GET }));
  return (await loadDirect()).settings;
}

/** Settings with every key blanked: what the background keeps in memory. */
export async function loadSettingsWithoutSecrets(): Promise<Settings> {
  return stripSecrets(await loadSettings());
}

/** The settings and the revision the public mirror should carry (background only: it repairs the mirror). */
export function loadSettingsWithRev(): Promise<{ settings: Settings; rev: number }> {
  return loadDirect();
}

/**
 * Rewrites the public mirror when it is not what the database says (a stale write from a racing
 * save, or a page that rewrote it). Background only. Resolves to whether it wrote.
 */
export async function repairPublicMirror(current: unknown): Promise<boolean> {
  const { settings, rev } = await loadDirect();
  const want = toPublicMirror(settings, rev);
  if (sameMirror(current, want)) return false;
  await browser.storage.local.set({ [PUBLIC_KEY]: want });
  return true;
}

/** Saves to the database first, then the public mirror (with a new revision), which tells every other context. */
export async function saveSettings(next: Settings): Promise<void> {
  if (viaBackground()) {
    await askBackground({ type: SETTINGS_SAVE, settings: withNormalizedAsk(SettingsSchema.parse(next)) });
    return;
  }
  await saveDirect(next);
}

let updateQueue: Promise<unknown> = Promise.resolve();

/** Read-modify-write helper, serialized so two quick edits (blur + click) cannot drop each other. */
export function updateSettings(mutate: (s: Settings) => Settings): Promise<Settings> {
  const run = updateQueue.then(async () => {
    const current = await loadSettings();
    const next = withNormalizedAsk(SettingsSchema.parse(mutate(structuredClone(current))));
    await saveSettings(next);
    return next;
  });
  updateQueue = run.catch(() => undefined);
  return run;
}

/**
 * Fires with the full settings (keys included, reloaded from the database) whenever the public
 * mirror changes. A page can rewrite the mirror, which only causes a harmless reload. Extension pages only.
 */
export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local' || !(PUBLIC_KEY in changes)) return;
    void loadSettings().then(cb, (e: unknown) => console.warn('[wys] settings unreadable', e));
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

/** True for a server on this machine (localhost, 127.0.0.1, [::1]). Mirrors `localServer` in providers/localModels. */
const isLocalUrl = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(u);
const hostOfUrl = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return '';
  }
};

/**
 * The OpenAI-style settings after the endpoint changes to `rawUrl`, the one rule every writer of the
 * endpoint uses (the Server select, the Endpoint field, the first-run screen). A key belongs to the
 * host it was entered for: a different host or a move between this machine and the network starts
 * without one. A new server means a new model list: the model and what was learned about it go too.
 */
export function withEndpoint(o: Settings['providers']['openaiCompat'], rawUrl: string): Settings['providers']['openaiCompat'] {
  const baseUrl = rawUrl.trim().replace(/\/+$/, '');
  if (baseUrl === o.baseUrl.trim().replace(/\/+$/, '')) return { ...o, baseUrl };
  const sameHost = hostOfUrl(baseUrl) === hostOfUrl(o.baseUrl) && isLocalUrl(baseUrl) === isLocalUrl(o.baseUrl);
  return {
    ...o,
    baseUrl,
    apiKey: sameHost ? o.apiKey : '',
    model: '',
    modelVision: null,
    modelTools: null,
    modelContext: null,
  };
}
