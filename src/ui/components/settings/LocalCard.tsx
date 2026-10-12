import { useEffect, useState } from 'react';
import { hasAllUrls, hasOrigin, requestAllUrls, requestOrigin } from '@/lib/permissions';
import { OPENAI_COMPAT_PRESETS, openaiCompatLabel } from '@/lib/providers/registry';
import { OpenAICompatProvider } from '@/lib/providers/openaiCompat';
import { createSearchBackend } from '@/lib/search/backends';
import type { SearchToolId, Settings } from '@/lib/storage/settings';
import { Alert, Cpu } from '../Icons';
import { CommitInput, ProviderCard, Row, SecretInput, type Status } from './primitives';

type Update = (mutate: (s: Settings) => Settings) => Promise<Settings>;
type O = Settings['providers']['openaiCompat'];

export function LocalCard({ settings, update }: { settings: Settings; update: Update }) {
  const o = settings.providers.openaiCompat;
  const set = (patch: Partial<O>) => update((s) => ({ ...s, providers: { ...s.providers, openaiCompat: { ...s.providers.openaiCompat, ...patch } } }));
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [models, setModels] = useState<string[]>([]);
  const [originOk, setOriginOk] = useState<boolean | null>(null);
  const [allUrls, setAllUrls] = useState<boolean | null>(null);
  const [searxngOk, setSearxngOk] = useState<boolean | null>(null);

  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(o.baseUrl);
  const isOpenAI = o.baseUrl.startsWith('https://api.openai.com');
  const preset = OPENAI_COMPAT_PRESETS.find((p) => p.baseUrl && o.baseUrl.startsWith(p.baseUrl))?.id ?? 'custom';

  useEffect(() => {
    void hasOrigin(o.baseUrl).then(setOriginOk);
    void hasAllUrls().then(setAllUrls);
    if (o.searchTool === 'searxng' && o.searxngUrl) void hasOrigin(o.searxngUrl).then(setSearxngOk);
  }, [o.baseUrl, o.searchTool, o.searxngUrl]);

  const test = async () => {
    setStatus({ kind: 'checking' });
    const r = await new OpenAICompatProvider({ baseUrl: o.baseUrl, apiKey: o.apiKey, model: o.model, search: createSearchBackend(o), fetchPages: true }).validate();
    if (r.ok) {
      setModels(r.models ?? []);
      setStatus({ kind: 'ok', text: `Connected · ${r.models?.length ?? 0} models` });
      if (!o.model && r.models?.[0]) void set({ model: r.models[0] });
    } else setStatus({ kind: 'bad', text: r.error });
  };

  const allow = async () => {
    const ok = await requestOrigin(o.baseUrl);
    setOriginOk(ok);
  };
  const allowAll = async () => setAllUrls(await requestAllUrls());
  const allowSearxng = async () => setSearxngOk(await requestOrigin(o.searxngUrl));

  const needsPermission = !isLocal && !isOpenAI && originOk === false;
  const title = isOpenAI ? 'OpenAI' : isLocal ? 'Local model (OpenAI-compatible)' : 'OpenAI-compatible endpoint';

  return (
    <ProviderCard
      icon={<Cpu size={16} />}
      title={title}
      subtitle={status.kind === 'ok' ? status.text : status.kind === 'bad' ? status.text : status.kind === 'checking' ? 'Connecting…' : o.model ? `${openaiCompatLabel(o.baseUrl)} · ${o.model}` : 'Ollama, LM Studio, llama.cpp, OpenAI or any OpenAI-style API'}
      subtitleTone={status.kind === 'ok' ? 'ok' : status.kind === 'bad' ? 'bad' : undefined}
      isDefault={settings.defaultProvider === 'openai-compat'}
      onMakeDefault={() => update((s) => ({ ...s, defaultProvider: 'openai-compat' }))}
    >
      <Row label="Server">
        <select
          className="wys-input h-8 w-auto max-w-[200px] text-[12px]"
          value={preset}
          onChange={(e) => {
            const p = OPENAI_COMPAT_PRESETS.find((x) => x.id === e.target.value);
            if (p && p.baseUrl) void set({ baseUrl: p.baseUrl });
          }}
        >
          {OPENAI_COMPAT_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Row>
      <div className="flex items-center gap-2">
        <label htmlFor="wys-ocurl" className="w-[70px] shrink-0 text-[13px]">
          Endpoint
        </label>
        <CommitInput id="wys-ocurl" value={o.baseUrl} onCommit={(v) => set({ baseUrl: v.replace(/\/+$/, '') })} placeholder="http://localhost:11434/v1" className="h-8 min-w-0 grow text-[12px]" />
      </div>
      {needsPermission && (
        <PermissionNote text={`Allow the extension to talk to ${new URL(o.baseUrl).host}`} onAllow={allow} />
      )}
      <div className="flex items-center gap-2">
        <label htmlFor="wys-ockey" className="w-[70px] shrink-0 text-[13px]">
          API key
        </label>
        <div className="min-w-0 grow">
          <SecretInput id="wys-ockey" value={o.apiKey} onCommit={(v) => set({ apiKey: v })} placeholder={isLocal ? 'Usually not needed locally' : 'sk-…'} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="wys-ocmodel" className="w-[70px] shrink-0 text-[13px]">
          Model
        </label>
        <CommitInput id="wys-ocmodel" list="wys-ocmodels" value={o.model} onCommit={(v) => set({ model: v })} placeholder={isLocal ? 'e.g. qwen3:8b' : 'e.g. gpt-5-mini'} className="h-8 min-w-0 grow text-[12px]" />
        <datalist id="wys-ocmodels">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <button className="wys-btn h-8 px-2.5 text-[12px]" onClick={test} disabled={status.kind === 'checking'}>
          {status.kind === 'checking' ? '…' : 'Test'}
        </button>
      </div>
      {isLocal && (
        <span className="text-[11px] leading-[15px] text-ink-2">
          Download a model with{' '}
          <a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer" className="font-semibold no-underline">
            Ollama
          </a>{' '}
          or{' '}
          <a href="https://lmstudio.ai" target="_blank" rel="noopener noreferrer" className="font-semibold no-underline">
            LM Studio
          </a>
          , start its server, then press Test. Ollama accepts extensions by default; LM Studio needs CORS enabled in its server settings.
        </span>
      )}

      <div className="flex gap-2 rounded-lg bg-warn-soft px-2.5 py-2">
        <Alert size={14} className="mt-0.5 shrink-0 text-warn" />
        <span className="text-[12px] leading-4 text-warn-ink">
          {o.searchTool === 'none'
            ? 'This model can’t search the web by itself. Pair it with a search tool so it can find sources; without one it answers from memory and says so.'
            : 'Search tool set — the model gets web_search and fetch_page tools and cites what they return.'}
        </span>
      </div>
      <Row label="Search tool">
        <select className="wys-input h-8 w-auto max-w-[200px] text-[12px]" value={o.searchTool} onChange={(e) => set({ searchTool: e.target.value as SearchToolId })}>
          <option value="none">None — answer from model only</option>
          <option value="searxng">SearXNG (self-hosted)</option>
          <option value="brave">Brave Search API</option>
          <option value="tavily">Tavily</option>
        </select>
      </Row>
      {o.searchTool === 'searxng' && (
        <>
          <div className="flex items-center gap-2">
            <label htmlFor="wys-searx" className="w-[70px] shrink-0 text-[13px]">
              SearXNG URL
            </label>
            <CommitInput id="wys-searx" value={o.searxngUrl} onCommit={(v) => set({ searxngUrl: v.replace(/\/+$/, '') })} placeholder="http://localhost:8888" className="h-8 min-w-0 grow text-[12px]" />
          </div>
          {o.searxngUrl && searxngOk === false && <PermissionNote text={`Allow the extension to reach ${hostOf(o.searxngUrl)}`} onAllow={allowSearxng} />}
          <span className="text-[11px] text-ink-2">Your instance must have the JSON format enabled (`search.formats: [html, json]`).</span>
        </>
      )}
      {o.searchTool === 'brave' && (
        <div className="flex items-center gap-2">
          <label htmlFor="wys-brave" className="w-[70px] shrink-0 text-[13px]">
            Brave key
          </label>
          <div className="min-w-0 grow">
            <SecretInput id="wys-brave" value={o.braveKey} onCommit={(v) => set({ braveKey: v })} placeholder="BSA…" />
          </div>
        </div>
      )}
      {o.searchTool === 'tavily' && (
        <div className="flex items-center gap-2">
          <label htmlFor="wys-tavily" className="w-[70px] shrink-0 text-[13px]">
            Tavily key
          </label>
          <div className="min-w-0 grow">
            <SecretInput id="wys-tavily" value={o.tavilyKey} onCommit={(v) => set({ tavilyKey: v })} placeholder="tvly-…" />
          </div>
        </div>
      )}
      {o.searchTool !== 'none' && (
        <Row label="Let the model read pages it finds" hint={allUrls ? 'Allowed for all sites' : 'Needs permission to fetch pages on your behalf'}>
          {allUrls ? (
            <span className="text-[12px] font-semibold text-ok">On</span>
          ) : (
            <button className="wys-btn h-8 px-2.5 text-[12px]" onClick={allowAll}>
              Allow
            </button>
          )}
        </Row>
      )}
    </ProviderCard>
  );
}

function PermissionNote({ text, onAllow }: { text: string; onAllow: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-accent-line bg-accent-wash px-2.5 py-2 text-[12px]">
      <span className="grow text-ink-2">{text}</span>
      <button className="wys-btn h-7 px-2.5 text-[12px]" onClick={onAllow}>
        Allow
      </button>
    </div>
  );
}

function hostOf(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}
