import type { ProviderId, Settings } from './settings';

/**
 * The handful of settings the always-on content script needs, read without the schema library (the
 * full settings module pulls zod into every page). Unknown or malformed values fall back to defaults.
 */
export interface PublicSettings {
  chip: boolean;
  disabledSites: string[];
  shortcutAction: Settings['shortcutAction'];
  defaultProvider: ProviderId;
  /** Short name of the default question when it is not the ordinary fact-check ('' otherwise), for the chip. */
  askName: string;
}

/** Mirrors settings.ts; a type-only import keeps zod out of this module. */
export const SETTINGS_KEY = 'settings';
/** storage.local key the background writes the live keyboard binding to ('' when unbound), for the on-page chip. */
export const SHORTCUT_KEY = 'shortcut';
const d = { chip: true, disabledSites: [] as string[], shortcutAction: 'panel' as const, defaultProvider: 'gemini' as const };

/** Mirrors the labels in pipeline/question.ts (importing it would put every preset's text into each page); a unit test keeps them equal. */
export const PUBLIC_ASK_NAMES: Record<string, string> = {
  explain: 'Explain it',
  summarize: 'Summarize',
  timeline: 'Timeline',
  flaws: 'Find the flaws',
  sources: 'Find more sources',
  custom: 'Your question',
};

/** Mirrors `PROVIDER_IDS` in settings.ts (a value import would pull zod in); a unit test keeps them equal. */
export const PUBLIC_PROVIDER_IDS: ProviderId[] = ['gemini', 'openai-compat', 'anthropic', 'webmode'];

export function readPublicSettings(raw: unknown): PublicSettings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const privacy = (typeof o.privacy === 'object' && o.privacy !== null ? o.privacy : {}) as Record<string, unknown>;
  const ask = (typeof o.ask === 'object' && o.ask !== null ? o.ask : {}) as Record<string, unknown>;
  // A custom default with nothing written falls back to the fact-check, as everywhere else. Which of
  // the saved questions it is does not matter here: the chip only says "Your question".
  const askId = typeof ask.default === 'string' && (ask.default !== 'custom' || (typeof ask.custom === 'string' && ask.custom.trim())) ? ask.default : '';
  return {
    chip: typeof privacy.chip === 'boolean' ? privacy.chip : d.chip,
    disabledSites: Array.isArray(privacy.disabledSites) ? privacy.disabledSites.filter((x): x is string => typeof x === 'string') : d.disabledSites,
    shortcutAction: o.shortcutAction === 'webmode' || o.shortcutAction === 'panel' ? o.shortcutAction : d.shortcutAction,
    defaultProvider: PUBLIC_PROVIDER_IDS.includes(o.defaultProvider as ProviderId) ? (o.defaultProvider as ProviderId) : d.defaultProvider,
    askName: PUBLIC_ASK_NAMES[askId] ?? '',
  };
}

/**
 * Where a check should go when the user triggers it from the page (chip or shortcut) rather than
 * from inside the panel: the web mode if either the trigger or the default provider says so.
 */
export function pageTriggerTarget(s: Pick<PublicSettings, 'shortcutAction' | 'defaultProvider'>): 'panel' | 'webmode' {
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
