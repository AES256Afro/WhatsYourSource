import { useState } from 'react';
import { AnthropicProvider } from '@/lib/providers/anthropic';
import type { Settings } from '@/lib/storage/settings';
import { PROVIDER_NAMES } from '../common';
import { PROVIDER_CARD_ID } from '../SettingsView';
import { CommitInput, ProviderCard, SecretInput, StatusLine, type Status } from './primitives';

type Update = (mutate: (s: Settings) => Settings) => Promise<Settings>;

export function AnthropicCard({ settings, update }: { settings: Settings; update: Update }) {
  const a = settings.providers.anthropic;
  const set = (patch: Partial<typeof a>) => update((s) => ({ ...s, providers: { ...s.providers, anthropic: { ...s.providers.anthropic, ...patch } } }));
  const [verified, setVerified] = useState<Status & { forKey: string }>({ kind: 'idle', forKey: a.apiKey });
  const [models, setModels] = useState<string[]>([]);
  const status: Status = verified.forKey === a.apiKey ? verified : { kind: 'idle' };
  const idleText = a.apiKey ? `Key set · ends in …${a.apiKey.trim().slice(-3)}` : 'Web search built in · bring your own key';

  const verify = async () => {
    const key = a.apiKey;
    setVerified({ kind: 'checking', forKey: key });
    const r = await new AnthropicProvider(a).validate();
    if (r.ok) {
      setModels(r.models ?? []);
      setVerified({ kind: 'ok', text: `Key works · ends in …${key.trim().slice(-3)}`, forKey: key });
    } else setVerified({ kind: 'bad', text: r.error, forKey: key });
  };

  return (
    <ProviderCard
      id={PROVIDER_CARD_ID.anthropic}
      icon={<span className="text-[13px] font-bold">A</span>}
      title={PROVIDER_NAMES.anthropic}
      subtitle={status.kind === 'ok' || status.kind === 'bad' ? status.text : status.kind === 'checking' ? 'Checking…' : idleText}
      subtitleTone={status.kind === 'ok' ? 'ok' : status.kind === 'bad' ? 'bad' : undefined}
      isDefault={settings.defaultProvider === 'anthropic'}
      onMakeDefault={() => update((s) => ({ ...s, defaultProvider: 'anthropic' }))}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="wys-akey" className="w-[70px] shrink-0 text-[13px]">
          API key
        </label>
        <div className="min-w-[160px] grow basis-0">
          <SecretInput id="wys-akey" value={a.apiKey} onCommit={(v) => set({ apiKey: v })} placeholder="sk-ant-…" />
        </div>
        <button
          className="wys-btn h-8 px-2.5 text-[12px]"
          aria-disabled={status.kind === 'checking' || !a.apiKey}
          onClick={() => status.kind !== 'checking' && a.apiKey && void verify()}
        >
          {status.kind === 'checking' ? '…' : 'Verify'}
        </button>
      </div>
      <StatusLine status={status} />
      <div className="flex items-center gap-2">
        <label htmlFor="wys-amodel" className="w-[70px] shrink-0 text-[13px]">
          Model
        </label>
        <CommitInput
          id="wys-amodel"
          list="wys-amodels"
          value={a.model}
          onCommit={(v) => set({ model: v })}
          placeholder="claude-sonnet-5-5"
          className="h-8 min-w-0 grow text-[12px]"
        />
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
