import { useEffect, useState } from 'react';
import { searchFactChecks } from '@/lib/lookups/factcheck';
import type { ProviderId, Settings } from '@/lib/storage/settings';
import { Label, PROVIDER_NAMES } from './common';
import { Globe, Shield } from './Icons';
import { AnthropicCard } from './settings/AnthropicCard';
import { GeminiCard } from './settings/GeminiCard';
import { OpenAICompatCard } from './settings/OpenAICompatCard';
import { CommitInput, DebouncedTextarea, ProviderCard, Row, SecretInput, StatusLine, Toggle, type Status } from './settings/primitives';
import { useShortcutLabel } from '../hooks/useShortcutLabel';
import type { UpdateSettings } from '../hooks/useSettings';

/** DOM ids of the provider cards, for scrolling to the one an error or onboarding points at. */
export const PROVIDER_CARD_ID: Record<ProviderId, string> = {
  gemini: 'wys-card-gemini',
  webmode: 'wys-card-webmode',
  anthropic: 'wys-card-anthropic',
  'openai-compat': 'wys-card-local',
};

export function SettingsView({
  settings,
  update,
  wide,
  focusProvider,
}: {
  settings: Settings;
  update: UpdateSettings;
  wide?: boolean;
  focusProvider?: ProviderId;
}) {
  const shortcut = useShortcutLabel();
  useEffect(() => {
    if (!focusProvider) return;
    const el = document.getElementById(PROVIDER_CARD_ID[focusProvider]);
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    el?.focus({ preventScroll: true });
  }, [focusProvider]);
  return (
    <div className={`flex flex-col gap-4 p-3.5 ${wide ? 'mx-auto max-w-[720px]' : ''}`}>
      <div className="flex flex-col gap-1.5">
        <Label>How checks are done</Label>
        <p className="m-0 text-[12px] leading-4 text-ink-2">The provider marked Default does your checks. Add a key to the ones you want to use.</p>
      </div>
      <GeminiCard settings={settings} update={update} />
      <ProviderCard
        id={PROVIDER_CARD_ID.webmode}
        icon={<Globe size={16} />}
        title={PROVIDER_NAMES.webmode}
        subtitle="No key · opens google.com in a tab · not saved to history"
        isDefault={settings.defaultProvider === 'webmode'}
        onMakeDefault={() => update((s) => ({ ...s, defaultProvider: 'webmode' }))}
      >
        <Row label="Which Google page" hint="AI Mode answers in a conversation; a normal search shows its AI Overview above the results.">
          {(id) => (
            <select
              aria-labelledby={id}
              className="wys-input h-8 w-auto text-[12px]"
              value={settings.webmodeVariant}
              onChange={(e) => update((s) => ({ ...s, webmodeVariant: e.target.value as Settings['webmodeVariant'] }))}
            >
              <option value="ai-mode">AI Mode</option>
              <option value="overview">Search with AI Overview</option>
            </select>
          )}
        </Row>
      </ProviderCard>
      <AnthropicCard settings={settings} update={update} />
      <OpenAICompatCard settings={settings} update={update} />

      <div className="flex flex-col gap-1.5">
        <Label>Extra evidence</Label>
        <p className="m-0 text-[12px] leading-4 text-ink-2">These run beside the AI call, with no model involved, so they work with every provider.</p>
        <div className="wys-card flex flex-col px-3">
          <Row label="Published fact-checks" hint="PolitiFact, Snopes, AFP, Full Fact and others, via Google’s Fact Check Tools index. Needs a free key.">
            {(id) => (
              <Toggle
                checked={settings.lookups.factChecks}
                onChange={(v) => update((s) => ({ ...s, lookups: { ...s.lookups, factChecks: v } }))}
                labelledBy={id}
              />
            )}
          </Row>
          {settings.lookups.factChecks && <FactCheckKeyField settings={settings} update={update} />}
          <Row label="Wayback Machine dates" hint="When the page and the original source were first archived. No key needed.">
            {(id) => (
              <Toggle checked={settings.lookups.archive} onChange={(v) => update((s) => ({ ...s, lookups: { ...s.lookups, archive: v } }))} labelledBy={id} />
            )}
          </Row>
          <Row label="Outlet reputation" hint="Wikipedia editors’ ratings of outlets (shipped offline, CC BY-SA). No key needed.">
            {(id) => (
              <Toggle
                checked={settings.lookups.credibility}
                onChange={(v) => update((s) => ({ ...s, lookups: { ...s.lookups, credibility: v } }))}
                labelledBy={id}
              />
            )}
          </Row>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Behaviour</Label>
        <div className="wys-card flex flex-col px-3">
          <Row label="List the claims first, then check each one" hint="One extra, cheap call; each claim gets its own fact-check lookup.">
            {(id) => <Toggle checked={settings.twoPass} onChange={(v) => update((s) => ({ ...s, twoPass: v }))} labelledBy={id} />}
          </Row>
          <Row label="If the default provider fails or is over quota, try the next one that has a key">
            {(id) => <Toggle checked={settings.fallback} onChange={(v) => update((s) => ({ ...s, fallback: v }))} labelledBy={id} />}
          </Row>
          <Row label={`${shortcut ?? 'The keyboard shortcut (not set)'} and the floating chip`}>
            {(id) => (
              <select
                aria-labelledby={id}
                className="wys-input h-8 w-auto text-[12px]"
                value={settings.shortcutAction}
                onChange={(e) => update((s) => ({ ...s, shortcutAction: e.target.value as Settings['shortcutAction'] }))}
              >
                <option value="panel">Check in the side panel</option>
                <option value="webmode">Open Google AI Mode</option>
              </select>
            )}
          </Row>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Privacy</Label>
        <div className="wys-card flex flex-col px-3">
          <Row label="Text or images are sent only when you press Check, only to the Default provider (and the fallback if you turned it on)" hint="Always on">
            {(id) => <Toggle checked disabled labelledBy={id} />}
          </Row>
          <Row label="Save a copy of the page with each check" hint="Stays on this device.">
            {(id) => (
              <Toggle
                checked={settings.privacy.snapshots}
                onChange={(v) => update((s) => ({ ...s, privacy: { ...s.privacy, snapshots: v } }))}
                labelledBy={id}
              />
            )}
          </Row>
          <Row label="Show the floating “Check source” chip when text is selected">
            {(id) => <Toggle checked={settings.privacy.chip} onChange={(v) => update((s) => ({ ...s, privacy: { ...s.privacy, chip: v } }))} labelledBy={id} />}
          </Row>
          <Row label="Storage for saved pages" hint="Oldest saved pages are removed first; results are kept.">
            {(id) => (
              <span className="inline-flex items-center gap-1 text-[12px] text-ink-2">
                <CommitInput
                  id="wys-maxmb"
                  labelledBy={id}
                  type="number"
                  className="h-8 w-20 text-[12px]"
                  value={String(settings.history.maxMb)}
                  onCommit={(raw) => {
                    const v = Math.min(5000, Math.max(10, Math.round(Number(raw)) || 10));
                    void update((s) => ({ ...s, history: { ...s.history, maxMb: v } }));
                  }}
                />
                MB
              </span>
            )}
          </Row>
          <div className="flex flex-col gap-1 py-2.5">
            <label htmlFor="wys-disabled" className="text-[13px]">
              Never show the chip on these sites <span className="text-ink-2">(one per line)</span>
            </label>
            <DebouncedTextarea
              id="wys-disabled"
              value={settings.privacy.disabledSites.join('\n')}
              placeholder="example.com"
              onCommit={(v) =>
                update((s) => ({
                  ...s,
                  privacy: {
                    ...s.privacy,
                    disabledSites: v
                      .split(/\n+/)
                      .map(
                        (x) =>
                          x
                            .trim()
                            .replace(/^https?:\/\//, '')
                            .replace(/^www\./, '')
                            .split('/')[0] ?? '',
                      )
                      .filter(Boolean),
                  },
                }))
              }
            />
          </div>
        </div>
        <p className="m-0 flex items-start gap-1.5 text-[11px] leading-[15px] text-ink-2">
          <Shield size={13} className="mt-px shrink-0" /> Keys stay on this device, are never synced, and go only to the provider they belong to. A local
          model’s search tool receives the search queries.
        </p>
      </div>
    </div>
  );
}

/** The key field with a Verify that runs one real `claims:search`, so "may work" becomes "works" or "doesn't". */
function FactCheckKeyField({ settings, update }: { settings: Settings; update: UpdateSettings }) {
  const key = settings.lookups.factCheckKey;
  const [verified, setVerified] = useState<Status & { forKey: string }>({ kind: 'idle', forKey: key });
  const status: Status = verified.forKey === key ? verified : { kind: 'idle' };
  const verify = async () => {
    setVerified({ kind: 'checking', forKey: key });
    try {
      const hits = await searchFactChecks('vaccines cause autism', key);
      setVerified({ kind: 'ok', text: `Key works · ${hits.length} fact-check${hits.length === 1 ? '' : 's'} found for a test query`, forKey: key });
    } catch (e) {
      setVerified({ kind: 'bad', text: e instanceof Error ? e.message : String(e), forKey: key });
    }
  };
  return (
    <div className="flex flex-col gap-1 py-2">
      <label htmlFor="wys-fckey" className="text-[13px]">
        Fact Check Tools API key
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[160px] grow basis-0">
          <SecretInput
            id="wys-fckey"
            value={key}
            onCommit={(v) => void update((s) => ({ ...s, lookups: { ...s.lookups, factCheckKey: v } }))}
            placeholder="AIza…"
          />
        </div>
        <button
          className="wys-btn h-8 px-2.5 text-[12px]"
          aria-disabled={!key || status.kind === 'checking'}
          onClick={() => key && status.kind !== 'checking' && void verify()}
        >
          {status.kind === 'checking' ? '…' : 'Verify'}
        </button>
      </div>
      <StatusLine status={status} idleText={key ? undefined : 'Not running: add a key, or turn the lookup off.'} />
      <span className="text-[11px] leading-[15px] text-ink-2">
        Already have a Gemini key from AI Studio? Paste it and press Verify. Otherwise: open{' '}
        <a
          href="https://console.cloud.google.com/apis/library/factchecktools.googleapis.com"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold no-underline"
        >
          Google Cloud
        </a>
        , pick or create a project, enable “Fact Check Tools API”, then Credentials → Create API key. Free.
      </span>
    </div>
  );
}

export { Toggle } from './settings/primitives';
