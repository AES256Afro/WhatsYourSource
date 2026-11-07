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
const d = { chip: true, disabledSites: [] as string[], shortcutAction: 'panel' as const, defaultProvider: 'gemini' as const };

const PROVIDERS: ProviderId[] = ['gemini', 'openai-compat', 'anthropic', 'webmode'];

export function readPublicSettings(raw: unknown): PublicSettings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const privacy = (typeof o.privacy === 'object' && o.privacy !== null ? o.privacy : {}) as Record<string, unknown>;
  return {
    chip: typeof privacy.chip === 'boolean' ? privacy.chip : d.chip,
    disabledSites: Array.isArray(privacy.disabledSites) ? privacy.disabledSites.filter((x): x is string => typeof x === 'string') : d.disabledSites,
    shortcutAction: o.shortcutAction === 'webmode' || o.shortcutAction === 'panel' ? o.shortcutAction : d.shortcutAction,
    defaultProvider: PROVIDERS.includes(o.defaultProvider as ProviderId) ? (o.defaultProvider as ProviderId) : d.defaultProvider,
  };
}

/** Same rule as `pageTriggerTarget` in settings.ts, for the public subset. */
export function publicTriggerTarget(p: PublicSettings): 'panel' | 'webmode' {
  return p.shortcutAction === 'webmode' || p.defaultProvider === 'webmode' ? 'webmode' : 'panel';
}
