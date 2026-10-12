import { useState } from 'react';
import { GeminiProvider } from '@/lib/providers/gemini';
import { GEMINI_FREE_SEARCHES_PER_MONTH } from '@/lib/providers/pricing';
import { GEMINI_MODELS, type Settings } from '@/lib/storage/settings';
import { Sparkle } from '../Icons';
import { ProviderCard, Row, SecretInput, Toggle, type Status } from './primitives';

type Update = (mutate: (s: Settings) => Settings) => Promise<Settings>;

export function GeminiCard({ settings, update }: { settings: Settings; update: Update }) {
  const g = settings.providers.gemini;
  const set = (patch: Partial<typeof g>) => update((s) => ({ ...s, providers: { ...s.providers, gemini: { ...s.providers.gemini, ...patch } } }));
  const [status, setStatus] = useState<Status>({ kind: g.apiKey ? 'ok' : 'idle', text: g.apiKey ? `Key set · ends in …${g.apiKey.slice(-3)}` : undefined });
  const [models, setModels] = useState<string[]>([]);

  const verify = async () => {
    setStatus({ kind: 'checking' });
    const r = await new GeminiProvider(g).validate();
    if (r.ok) {
      setModels(r.models ?? []);
      setStatus({ kind: 'ok', text: `Key verified · ends in …${g.apiKey.trim().slice(-3)}` });
    } else setStatus({ kind: 'bad', text: r.error });
  };

  const modelOptions = Array.from(new Set([...GEMINI_MODELS.map((m) => m.id), ...models, g.model]));
  return (
    <ProviderCard
      icon={<Sparkle size={16} />}
      title="Google AI (Gemini)"
      subtitle={status.kind === 'ok' ? status.text : status.kind === 'bad' ? status.text : status.kind === 'checking' ? 'Checking…' : 'Your own free key from AI Studio · Google Search built in'}
      subtitleTone={status.kind === 'ok' ? 'ok' : status.kind === 'bad' ? 'bad' : undefined}
      isDefault={settings.defaultProvider === 'gemini'}
      onMakeDefault={() => update((s) => ({ ...s, defaultProvider: 'gemini' }))}
    >
      <div className="flex items-center gap-2">
        <label htmlFor="wys-gkey" className="w-[70px] shrink-0 text-[13px]">
          API key
        </label>
        <div className="min-w-0 grow">
          <SecretInput id="wys-gkey" value={g.apiKey} onCommit={(v) => set({ apiKey: v })} placeholder="AIza…" />
        </div>
        <button className="wys-btn h-8 px-2.5 text-[12px]" onClick={verify} disabled={status.kind === 'checking' || !g.apiKey}>
          {status.kind === 'checking' ? '…' : 'Verify'}
        </button>
      </div>
      <span className="text-[11px] leading-[15px] text-ink-2">
        Free at{' '}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="font-semibold no-underline">
          aistudio.google.com
        </a>
        . Google’s free tier may use your prompts to improve its products; a paid key does not. Grounded searches beyond {GEMINI_FREE_SEARCHES_PER_MONTH.toLocaleString()}/month are
        billed to your key.
      </span>
      <Row label="Model">
        <select className="wys-input h-8 w-auto max-w-[220px] text-[12px]" value={g.model} onChange={(e) => set({ model: e.target.value })}>
          {modelOptions.map((id) => (
            <option key={id} value={id}>
              {GEMINI_MODELS.find((m) => m.id === id)?.label ?? id}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Google Search grounding" hint="Finds sources. Needed for citations.">
        <Toggle checked={g.grounding} onChange={(v) => set({ grounding: v })} />
      </Row>
      <Row label="Read linked pages (URL context)">
        <Toggle checked={g.urlContext} onChange={(v) => set({ urlContext: v })} />
      </Row>
    </ProviderCard>
  );
}
