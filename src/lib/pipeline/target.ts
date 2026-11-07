import { providerOrder, providerReady, type ProviderId, type Settings } from '../storage/settings';

/** Where a check goes: Google's web page, nowhere until something is set up, or a list of providers to try in order. */
export type CheckTarget = { kind: 'webmode' } | { kind: 'setup' } | { kind: 'run'; order: ProviderId[] };

/** `only` names one provider for a second opinion: no fallback chain. */
export function decideTarget(s: Settings, only?: ProviderId): CheckTarget {
  if (!only && s.defaultProvider === 'webmode') return { kind: 'webmode' };
  const order = only ? [only] : providerOrder(s).filter((id) => providerReady(s, id));
  return order.length ? { kind: 'run', order } : { kind: 'setup' };
}
