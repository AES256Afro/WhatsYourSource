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
}

/** Mirrors settings.ts; a type-only import keeps zod out of this module. */
export const SETTINGS_KEY = 'settings';
/** storage.local key the background writes the live keyboard binding to ('' when unbound), for the on-page chip. */
export const SHORTCUT_KEY = 'shortcut';
const d = { chip: true, disabledSites: [] as string[], shortcutAction: 'panel' as const, defaultProvider: 'gemini' as const };

/** Mirrors `PROVIDER_IDS` in settings.ts (a value import would pull zod in); a unit test keeps them equal. */
export const PUBLIC_PROVIDER_IDS: ProviderId[] = ['gemini', 'openai-compat', 'anthropic', 'webmode'];

export function readPublicSettings(raw: unknown): PublicSettings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const privacy = (typeof o.privacy === 'object' && o.privacy !== null ? o.privacy : {}) as Record<string, unknown>;
  return {
    chip: typeof privacy.chip === 'boolean' ? privacy.chip : d.chip,
    disabledSites: Array.isArray(privacy.disabledSites) ? privacy.disabledSites.filter((x): x is string => typeof x === 'string') : d.disabledSites,
    shortcutAction: o.shortcutAction === 'webmode' || o.shortcutAction === 'panel' ? o.shortcutAction : d.shortcutAction,
    defaultProvider: PUBLIC_PROVIDER_IDS.includes(o.defaultProvider as ProviderId) ? (o.defaultProvider as ProviderId) : d.defaultProvider,
  };
}

/**
 * Where a check should go when the user triggers it from the page (chip or shortcut) rather than
 * from inside the panel: the web mode if either the trigger or the default provider says so.
 */
export function pageTriggerTarget(s: Pick<PublicSettings, 'shortcutAction' | 'defaultProvider'>): 'panel' | 'webmode' {
  return s.shortcutAction === 'webmode' || s.defaultProvider === 'webmode' ? 'webmode' : 'panel';
}
