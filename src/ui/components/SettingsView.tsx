import type { Settings } from '@/lib/storage/settings';
import { Label } from './common';
import { Globe, Shield } from './Icons';
import { AnthropicCard } from './settings/AnthropicCard';
import { GeminiCard } from './settings/GeminiCard';
import { LocalCard } from './settings/LocalCard';
import { DebouncedTextarea, ProviderCard, Row, Toggle } from './settings/primitives';
import { useShortcutLabel } from '../hooks/useShortcutLabel';

type Update = (mutate: (s: Settings) => Settings) => Promise<Settings>;

export function SettingsView({ settings, update, wide }: { settings: Settings; update: Update; wide?: boolean }) {
  const shortcut = useShortcutLabel();
  return (
    <div className={`flex flex-col gap-4 p-3.5 ${wide ? 'mx-auto max-w-[720px]' : ''}`}>
      <p className="m-0 text-[12px] leading-[17px] text-ink-2">
        Your selection is sent only to the provider marked as default, and only when you press Check. Keys stay on this device.
      </p>

      <GeminiCard settings={settings} update={update} />
      <ProviderCard
        icon={<Globe size={16} />}
        title="Google AI Mode (web)"
        subtitle="No key · opens google.com in a tab · not saved to history"
        isDefault={settings.defaultProvider === 'webmode'}
        onMakeDefault={() => update((s) => ({ ...s, defaultProvider: 'webmode' }))}
      />
      <AnthropicCard settings={settings} update={update} />
      <LocalCard settings={settings} update={update} />

      <div className="flex flex-col gap-1.5">
        <Label>Behaviour</Label>
        <div className="wys-card flex flex-col px-3">
          <Row label="If the default provider fails or is over quota, try the next configured one">
            <Toggle checked={settings.fallback} onChange={(v) => update((s) => ({ ...s, fallback: v }))} />
          </Row>
          <Row label={`${shortcut} and the floating chip`}>
            <select
              className="wys-input h-8 w-auto text-[12px]"
              value={settings.shortcutAction}
              onChange={(e) => update((s) => ({ ...s, shortcutAction: e.target.value as Settings['shortcutAction'] }))}
            >
              <option value="panel">Check in the side panel</option>
              <option value="webmode">Open Google AI Mode</option>
            </select>
          </Row>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Privacy</Label>
        <div className="wys-card flex flex-col px-3">
          <Row label="Send text or images only when I press Check" hint="Always on">
            <Toggle checked disabled />
          </Row>
          <Row label="Save a copy of the page with each check (local only)">
            <Toggle checked={settings.privacy.snapshots} onChange={(v) => update((s) => ({ ...s, privacy: { ...s.privacy, snapshots: v } }))} />
          </Row>
          <Row label="Show the floating “Check source” chip on selection">
            <Toggle checked={settings.privacy.chip} onChange={(v) => update((s) => ({ ...s, privacy: { ...s.privacy, chip: v } }))} />
          </Row>
          <Row label="Page snapshot storage limit" hint="Oldest snapshots are removed first; results are kept.">
            <span className="inline-flex items-center gap-1 text-[12px] text-ink-2">
              <input
                type="number"
                min={10}
                max={5000}
                step={10}
                className="wys-input h-8 w-20 text-[12px]"
                value={settings.history.maxMb}
                onChange={(e) => {
                  const v = Math.min(5000, Math.max(10, Number(e.target.value) || 10));
                  void update((s) => ({ ...s, history: { ...s.history, maxMb: v } }));
                }}
                aria-label="Snapshot storage limit in megabytes"
              />
              MB
            </span>
          </Row>
          <div className="flex flex-col gap-1 py-2.5">
            <label htmlFor="wys-disabled" className="text-[13px]">
              Never show the chip on these sites <span className="text-ink-2">(one hostname per line)</span>
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
      </div>

      <p className="m-0 flex items-start gap-1.5 text-[11px] leading-[15px] text-ink-2">
        <Shield size={13} className="mt-px shrink-0" /> Keys are stored in browser.storage.local — never synced, never sent anywhere but the provider you chose.
      </p>
    </div>
  );
}

export { Toggle } from './settings/primitives';
