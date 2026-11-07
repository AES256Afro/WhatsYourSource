import { GeminiProvider } from '@/lib/providers/gemini';
import { PROVIDER_LABELS } from '@/lib/providers/registry';
import { GEMINI_FREE_SEARCHES_PER_MONTH } from '@/lib/providers/pricing';
import { GEMINI_MODELS, type Settings } from '@/lib/storage/settings';
import { Sparkle } from '../Icons';
import { PROVIDER_CARD_ID } from '../SettingsView';
import { ProviderCard, Row, SecretInput, StatusLine, Toggle } from './primitives';
import { useProviderVerify } from './useProviderVerify';
import type { UpdateSettings } from '../../hooks/useSettings';

export function GeminiCard({ settings, update }: { settings: Settings; update: UpdateSettings }) {
  const g = settings.providers.gemini;
  const set = (patch: Partial<typeof g>) => update((s) => ({ ...s, providers: { ...s.providers, gemini: { ...s.providers.gemini, ...patch } } }));
  const { status, models, verify } = useProviderVerify(() => new GeminiProvider(g), g.apiKey);
  const idleText = g.apiKey ? `Key set · ends in …${g.apiKey.trim().slice(-3)}` : 'Free key from Google AI Studio · searches Google';

  const modelOptions = Array.from(new Set([...GEMINI_MODELS.map((m) => m.id), ...models, g.model]));
  return (
    <ProviderCard
      id={PROVIDER_CARD_ID.gemini}
      icon={<Sparkle size={16} />}
      title={PROVIDER_LABELS.gemini}
      subtitle={status.kind === 'ok' || status.kind === 'bad' ? status.text : status.kind === 'checking' ? 'Checking…' : idleText}
      subtitleTone={status.kind === 'ok' ? 'ok' : status.kind === 'bad' ? 'bad' : undefined}
      isDefault={settings.defaultProvider === 'gemini'}
      onMakeDefault={() => update((s) => ({ ...s, defaultProvider: 'gemini' }))}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="wys-gkey" className="w-[70px] shrink-0 text-[13px]">
          API key
        </label>
        <div className="min-w-[160px] grow basis-0">
          <SecretInput id="wys-gkey" value={g.apiKey} onCommit={(v) => set({ apiKey: v })} placeholder="AIza…" />
        </div>
        <button
          className="wys-btn h-8 px-2.5 text-[12px]"
          aria-disabled={status.kind === 'checking' || !g.apiKey}
          onClick={() => status.kind !== 'checking' && g.apiKey && void verify()}
        >
          {status.kind === 'checking' ? '…' : 'Verify'}
        </button>
      </div>
      <StatusLine status={status} />
      <span className="text-[11px] leading-[15px] text-ink-2">
        Free at{' '}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="font-semibold no-underline">
          aistudio.google.com
        </a>
        . Google’s free tier may use your prompts to improve its products; a paid key does not. Searches beyond{' '}
        {GEMINI_FREE_SEARCHES_PER_MONTH.toLocaleString()} a month are billed to your key.
      </span>
      <div className="flex flex-col gap-1">
        <label htmlFor="wys-gmodel" className="text-[13px]">
          Model
        </label>
        <select id="wys-gmodel" className="wys-input h-8 text-[12px]" value={g.model} onChange={(e) => set({ model: e.target.value })}>
          {modelOptions.map((id) => (
            <option key={id} value={id}>
              {GEMINI_MODELS.find((m) => m.id === id)?.label ?? id}
            </option>
          ))}
        </select>
      </div>
      <Row label="Search Google for sources" hint="Recommended: this is what makes citations possible.">
        {(id) => <Toggle checked={g.grounding} onChange={(v) => set({ grounding: v })} labelledBy={id} />}
      </Row>
      <Row label="Let Gemini read the pages it cites" hint="Better answers for links and posts.">
        {(id) => <Toggle checked={g.urlContext} onChange={(v) => set({ urlContext: v })} labelledBy={id} />}
      </Row>
    </ProviderCard>
  );
}
