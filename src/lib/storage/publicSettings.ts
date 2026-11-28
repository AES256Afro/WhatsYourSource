import type { ProviderId, Settings } from './settings';

/**
 * What the always-on content script knows about the settings: a small public copy under its own
 * `storage.local` key, written by every save. The settings themselves (API keys, endpoints, provider
 * order, question texts) live in the extension's own IndexedDB (`settingsStore.ts`), which the
 * content script cannot open. Nothing trusted ever reads this copy back as settings: a page that
 * rewrites it can only change how the chip looks on pages, and extension pages and the background
 * treat a change to it as a signal to reload from the database.
 * Read without the schema library (the full settings module pulls zod into every page). Unknown or
 * malformed values fall back to defaults.
 */
export interface PublicSettings {
  chip: boolean;
  disabledSites: string[];
  /** Where a check started on the page (chip or shortcut) goes: see `pageTriggerTarget`. */
  trigger: 'panel' | 'webmode';
  /** Short name of the default question when it is not the ordinary fact-check ('' otherwise), for the chip. */
  askName: string;
}

/** The mirror as stored: the public fields plus `rev`, bumped on every save so each save is a change. */
export interface PublicMirror extends PublicSettings {
  rev: number;
}

/** storage.local key of the public mirror. */
export const PUBLIC_KEY = 'public';
/** storage.local key the background writes the live keyboard binding to ('' when unbound), for the on-page chip. */
export const SHORTCUT_KEY = 'shortcut';
const d: PublicSettings = { chip: true, disabledSites: [], trigger: 'panel', askName: '' };

/** Mirrors the labels in pipeline/question.ts (importing it would put every preset's text into each page); a unit test keeps them equal. */
export const PUBLIC_ASK_NAMES: Record<string, string> = {
  explain: 'Explain it',
  summarize: 'Summarize',
  timeline: 'Timeline',
  flaws: 'Find the flaws',
  sources: 'Find more sources',
  custom: 'Your question',
};

/**
 * The chip's name for the default question. A custom default with nothing written falls back to the
 * fact-check, as everywhere else. Which of the saved questions it is does not matter here: the chip
 * only says "Your question", so no question text goes into the mirror.
 */
export function publicAskName(ask: { default: string; custom: string }): string {
  const askId = ask.default !== 'custom' || ask.custom.trim() ? ask.default : '';
  return PUBLIC_ASK_NAMES[askId] ?? '';
}

/** The mirror for these settings at revision `rev`. Only the chip's fields: no keys, endpoints or question texts. */
export function toPublicMirror(s: Pick<Settings, 'privacy' | 'shortcutAction' | 'defaultProvider' | 'ask'>, rev: number): PublicMirror {
  return {
    rev,
    chip: s.privacy.chip,
    disabledSites: [...s.privacy.disabledSites],
    trigger: pageTriggerTarget(s),
    askName: publicAskName(s.ask),
  };
}

/** Reads the mirror (raw storage value), field by field. */
export function readPublicSettings(raw: unknown): PublicSettings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    chip: typeof o.chip === 'boolean' ? o.chip : d.chip,
    disabledSites: Array.isArray(o.disabledSites) ? o.disabledSites.filter((x): x is string => typeof x === 'string') : d.disabledSites,
    trigger: o.trigger === 'webmode' || o.trigger === 'panel' ? o.trigger : d.trigger,
    askName: typeof o.askName === 'string' && Object.values(PUBLIC_ASK_NAMES).includes(o.askName) ? o.askName : d.askName,
  };
}

/** Whether a stored mirror value is exactly `want` (same revision and fields). */
export function sameMirror(raw: unknown, want: PublicMirror): boolean {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const got = readPublicSettings(raw);
  return (
    o.rev === want.rev &&
    Object.keys(o).length === 5 &&
    got.chip === want.chip &&
    got.trigger === want.trigger &&
    got.askName === want.askName &&
    Array.isArray(o.disabledSites) &&
    o.disabledSites.length === want.disabledSites.length &&
    got.disabledSites.length === want.disabledSites.length &&
    got.disabledSites.every((x, i) => x === want.disabledSites[i])
  );
}

/**
 * Where a check should go when the user triggers it from the page (chip or shortcut) rather than
 * from inside the panel: the web mode if either the trigger or the default provider says so.
 */
export function pageTriggerTarget(s: { shortcutAction: Settings['shortcutAction']; defaultProvider: ProviderId }): 'panel' | 'webmode' {
  return s.shortcutAction === 'webmode' || s.defaultProvider === 'webmode' ? 'webmode' : 'panel';
}

/**
 * A "never show the chip here" entry as the content script compares it: the host name the browser
 * itself would report (lower case, punycode for international names, no port, no scheme or path),
 * without a leading "www.". '' for anything that is not a host.
 */
export function normalizeSiteEntry(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  try {
    const host = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(t) ? t : `https://${t}`).hostname;
    return host.replace(/^www\./, '').replace(/\.$/, '');
  } catch {
    return '';
  }
}

/** Whether the chip may show on `hostname`, given the user's list. Compared in lower case, so entries saved by older builds match too. */
export function siteAllowed(hostname: string, disabledSites: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return !disabledSites.some((raw) => {
    const s = raw.toLowerCase();
    return !!s && (host === s || host.endsWith(`.${s}`));
  });
}
