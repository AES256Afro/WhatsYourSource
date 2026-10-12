import { useState } from 'react';
import { AnthropicProvider } from '@/lib/providers/anthropic';
import type { Settings } from '@/lib/storage/settings';
import { CommitInput, ProviderCard, SecretInput, type Status } from './primitives';

type Update = (mutate: (s: Settings) => Settings) => Promise<Settings>;

export function AnthropicCard({ settings, update }: { settings: Settings; update: Update }) {
  const a = settings.providers.anthropic;
  const set = (patch: Partial<typeof a>) => update((s) => ({ ...s, providers: { ...s.providers, anthropic: { ...s.providers.anthropic, ...patch } } }));
  const [status, setStatus] = useState<Status>({ kind: a.apiKey ? 'ok' : 'idle', text: a.apiKey ? 'Key set' : undefined });
  const [models, setModels] = useState<string[]>([]);

  const verify = async () => {
    setStatus({ kind: 'checking' });
    const r = await new AnthropicProvider(a).validate();
    if (r.ok) {
      setModels(r.models ?? []);
      setStatus({ kind: 'ok', text: `Key verified · ends in …${a.apiKey.trim().slice(-3)}` });
    } else setStatus({ kind: 'bad', text: r.error });
  };

  return (
    <ProviderCard
      icon={<span className="text-[13px] font-bold">A</span>}
      title="Anthropic (Claude)"
      subtitle={status.kind === 'ok' ? status.text : status.kind === 'bad' ? status.text : 'Web search built in · bring your own key'}
      subtitleTone={status.kind === 'ok' ? 'ok' : status.kind === 'bad' ? 'bad' : undefined}
      isDefault={settings.defaultProvider === 'anthropic'}
      onMakeDefault={() => update((s) => ({ ...s, defaultProvider: 'anthropic' }))}
    >
      <div className="flex items-center gap-2">
        <label htmlFor="wys-akey" className="w-[70px] shrink-0 text-[13px]">
          API key
        </label>
        <div className="min-w-0 grow">
          <SecretInput id="wys-akey" value={a.apiKey} onCommit={(v) => set({ apiKey: v })} placeholder="sk-ant-…" />
        </div>
        <button className="wys-btn h-8 px-2.5 text-[12px]" onClick={verify} disabled={status.kind === 'checking' || !a.apiKey}>
          {status.kind === 'checking' ? '…' : 'Verify'}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="wys-amodel" className="w-[70px] shrink-0 text-[13px]">
          Model
        </label>
        <CommitInput id="wys-amodel" list="wys-amodels" value={a.model} onCommit={(v) => set({ model: v })} placeholder="claude-sonnet-5-5" className="h-8 min-w-0 grow text-[12px]" />
        <datalist id="wys-amodels">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>
      <span className="text-[11px] leading-[15px] text-ink-2">
        Keys from{' '}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="font-semibold no-underline">
          console.anthropic.com
        </a>
        . Web searches are billed by Anthropic per search on top of tokens.
      </span>
    </ProviderCard>
  );
}
