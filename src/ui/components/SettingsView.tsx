import { useEffect, useState } from 'react';
import { GeminiProvider } from '@/lib/providers/gemini';
import { GEMINI_FREE_SEARCHES_PER_MONTH } from '@/lib/providers/pricing';
import { GEMINI_MODELS, type ProviderId, type Settings } from '@/lib/storage/settings';
import { Label } from './common';
import { Check, Cpu, Globe, Shield, Sparkle } from './Icons';

type Update = (mutate: (s: Settings) => Settings) => Promise<Settings>;

export function SettingsView({ settings, update, wide }: { settings: Settings; update: Update; wide?: boolean }) {
  return (
    <div className={`flex flex-col gap-4 p-3.5 ${wide ? 'mx-auto max-w-[720px]' : ''}`}>
      <p className="m-0 text-[12px] leading-[17px] text-ink-2">
        Your selection is sent only to the provider marked as default, and only when you press Check. Keys stay on this device.
      </p>

      <GeminiCard settings={settings} update={update} />
      <WebModeCard settings={settings} update={update} />
      <LocalCard settings={settings} update={update} />
      <AnthropicCard settings={settings} update={update} />

      <div className="flex flex-col gap-1.5">
        <Label>Behaviour</Label>
        <div className="wys-card flex flex-col px-3">
          <Row label="If the default provider fails or is over quota, try the next configured one">
            <Toggle checked={settings.fallback} onChange={(v) => update((s) => ({ ...s, fallback: v }))} />
          </Row>
          <Row label="Ctrl+Shift+S and the floating chip">
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
            <Toggle checked disabled onChange={() => {}} />
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
              onCommit={(v) =>
                update((s) => ({
                  ...s,
                  privacy: {
                    ...s.privacy,
                    disabledSites: v
                      .split(/\n+/)
                      .map((x) => x.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] ?? '')
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

function GeminiCard({ settings, update }: { settings: Settings; update: Update }) {
  const g = settings.providers.gemini;
  const [key, setKey] = useState(g.apiKey);
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<{ kind: 'idle' | 'checking' | 'ok' | 'bad'; text?: string }>({ kind: g.apiKey ? 'ok' : 'idle' });
  const [models, setModels] = useState<string[]>([]);
  useEffect(() => setKey(g.apiKey), [g.apiKey]);

  const verify = async () => {
    setStatus({ kind: 'checking' });
    const trimmed = key.trim();
    await update((s) => ({ ...s, providers: { ...s.providers, gemini: { ...s.providers.gemini, apiKey: trimmed } } }));
    const r = await new GeminiProvider({ ...g, apiKey: trimmed }).validate();
    if (r.ok) {
      setModels(r.models ?? []);
      setStatus({ kind: 'ok', text: `Key verified${trimmed ? ` · ends in …${trimmed.slice(-3)}` : ''}` });
    } else setStatus({ kind: 'bad', text: r.error });
  };

  const modelOptions = Array.from(new Set([...GEMINI_MODELS.map((m) => m.id), ...models, g.model]));
  const isDefault = settings.defaultProvider === 'gemini';
  return (
    <ProviderCard
      icon={<Sparkle size={16} />}
      title="Google AI (Gemini)"
      subtitle={status.kind === 'ok' ? status.text ?? 'Key set' : status.kind === 'bad' ? status.text ?? 'Key rejected' : 'Your own free key from AI Studio'}
      subtitleTone={status.kind === 'ok' ? 'ok' : status.kind === 'bad' ? 'bad' : undefined}
      isDefault={isDefault}
      onMakeDefault={() => update((s) => ({ ...s, defaultProvider: 'gemini' }))}
    >
      <div className="flex gap-2">
        <label htmlFor="wys-gkey" className="sr-only">
          Gemini API key
        </label>
        <input
          id="wys-gkey"
          className="wys-input min-w-0 grow"
          type={show ? 'text' : 'password'}
          placeholder="Paste key…"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <button className="wys-btn px-2.5" type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide key' : 'Show key'}>
          {show ? 'Hide' : 'Show'}
        </button>
        <button className="wys-btn" type="button" onClick={verify} disabled={status.kind === 'checking'}>
          {status.kind === 'checking' ? 'Checking…' : 'Verify'}
        </button>
      </div>
      <span className="text-[11px] leading-[15px] text-ink-2">
        Free at{' '}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="font-semibold no-underline">
          aistudio.google.com
        </a>
        . Google’s free tier may use your prompts to improve its products; a paid key does not. Grounded searches beyond{' '}
        {GEMINI_FREE_SEARCHES_PER_MONTH.toLocaleString()}/month are billed to your key.
      </span>
      <Row label="Model">
        <select
          className="wys-input h-8 w-auto max-w-[220px] text-[12px]"
          value={g.model}
          onChange={(e) => update((s) => ({ ...s, providers: { ...s.providers, gemini: { ...s.providers.gemini, model: e.target.value } } }))}
        >
          {modelOptions.map((id) => (
            <option key={id} value={id}>
              {GEMINI_MODELS.find((m) => m.id === id)?.label ?? id}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Google Search grounding" hint="Finds sources. Needed for citations.">
        <Toggle checked={g.grounding} onChange={(v) => update((s) => ({ ...s, providers: { ...s.providers, gemini: { ...s.providers.gemini, grounding: v } } }))} />
      </Row>
      <Row label="Read linked pages (URL context)">
        <Toggle checked={g.urlContext} onChange={(v) => update((s) => ({ ...s, providers: { ...s.providers, gemini: { ...s.providers.gemini, urlContext: v } } }))} />
      </Row>
    </ProviderCard>
  );
}

function WebModeCard({ settings, update }: { settings: Settings; update: Update }) {
  return (
    <ProviderCard
      icon={<Globe size={16} />}
      title="Google AI Mode (web)"
      subtitle="No key · opens google.com in a tab · not saved to history"
      isDefault={settings.defaultProvider === 'webmode'}
      onMakeDefault={() => update((s) => ({ ...s, defaultProvider: 'webmode' }))}
    />
  );
}

function LocalCard({ settings, update }: { settings: Settings; update: Update }) {
  const o = settings.providers.openaiCompat;
  return (
    <ProviderCard
      icon={<Cpu size={16} />}
      title="Local model (OpenAI-compatible)"
      subtitle="Ollama, LM Studio, llama.cpp or any OpenAI-style API — arriving in the next milestone"
      isDefault={settings.defaultProvider === 'openai-compat'}
      disabled
    >
      <span className="text-[12px] text-ink-2">Endpoint: {o.baseUrl}</span>
    </ProviderCard>
  );
}

function AnthropicCard({ settings }: { settings: Settings; update: Update }) {
  return (
    <ProviderCard
      icon={<span className="text-[13px] font-bold">A</span>}
      title="Anthropic (Claude)"
      subtitle="Web search built in — arriving in the next milestone"
      isDefault={settings.defaultProvider === 'anthropic'}
      disabled
    />
  );
}

function ProviderCard({
  icon,
  title,
  subtitle,
  subtitleTone,
  isDefault,
  onMakeDefault,
  disabled,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  subtitleTone?: 'ok' | 'bad';
  isDefault: boolean;
  onMakeDefault?: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-2.5 rounded-xl border p-3 ${isDefault ? 'border-accent bg-accent-wash' : 'border-line'} ${disabled ? 'opacity-70' : ''}`}>
      <div className="flex items-center gap-2">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] ${isDefault ? 'bg-accent text-white' : 'bg-surface-2 text-ink-2'}`}>{icon}</span>
        <span className="flex min-w-0 grow flex-col">
          <span className="text-[14px] font-semibold">{title}</span>
          {subtitle && (
            <span className={`inline-flex items-center gap-1 text-[11px] ${subtitleTone === 'ok' ? 'font-semibold text-ok' : subtitleTone === 'bad' ? 'font-semibold text-bad' : 'text-ink-2'}`}>
              {subtitleTone === 'ok' && <Check size={11} />}
              {subtitle}
            </span>
          )}
        </span>
        {isDefault ? (
          <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">Default</span>
        ) : (
          onMakeDefault &&
          !disabled && (
            <button className="wys-btn h-[30px] px-2.5 text-[12px]" onClick={onMakeDefault}>
              Make default
            </button>
          )
        )}
      </div>
      {children}
    </div>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[40px] items-center gap-3 border-b border-surface-2 py-1.5 text-[13px] last:border-b-0">
      <span className="flex grow flex-col">
        <span>{label}</span>
        {hint && <span className="text-[11px] text-ink-2">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full border-0 p-0 transition-colors ${checked ? 'bg-accent' : 'bg-line-2'} ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

export function DebouncedTextarea({ id, value, onCommit }: { id: string; value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <textarea
      id={id}
      className="wys-input h-16 resize-none py-2 text-[12px]"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      placeholder="example.com"
    />
  );
}

export type { ProviderId };
