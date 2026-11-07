import { useEffect, useState } from 'react';
import { hasAllUrls, hasOrigin, requestAllUrls, requestOrigin } from '@/lib/permissions';
import { OPENAI_COMPAT_PRESETS, openaiCompatLabel, presetFor, PROVIDER_LABELS } from '@/lib/providers/registry';
import { describeLocalModels, localServer, type LocalModelInfo } from '@/lib/providers/localModels';
import { OpenAICompatProvider } from '@/lib/providers/openaiCompat';
import { createSearchBackend } from '@/lib/search/backends';
import type { SearchToolId, Settings } from '@/lib/storage/settings';
import { hostOf } from '@/lib/util/url';
import { Alert, Cpu } from '../Icons';
import { PROVIDER_CARD_ID } from '../SettingsView';
import { CommitInput, ProviderCard, Row, SecretInput, StatusLine, type Status } from './primitives';
import { useProviderVerify } from './useProviderVerify';
import type { UpdateSettings } from '../../hooks/useSettings';

type O = Settings['providers']['openaiCompat'];

export function OpenAICompatCard({ settings, update }: { settings: Settings; update: UpdateSettings }) {
  const o = settings.providers.openaiCompat;
  const set = (patch: Partial<O>) => update((s) => ({ ...s, providers: { ...s.providers, openaiCompat: { ...s.providers.openaiCompat, ...patch } } }));
  const [info, setInfo] = useState<LocalModelInfo[]>([]);
  const [originOk, setOriginOk] = useState<boolean | null>(null);
  const [allUrls, setAllUrls] = useState<boolean | null>(null);
  const [searxngOk, setSearxngOk] = useState<boolean | null>(null);

  // Only plain http on this machine is covered by the built-in host permission; https://localhost needs an Allow.
  const isLocal = localServer(o.baseUrl).isLocal && /^http:/i.test(o.baseUrl);
  const isOpenAI = o.baseUrl.startsWith('https://api.openai.com');
  const preset = OPENAI_COMPAT_PRESETS.find((p) => p.baseUrl && o.baseUrl.startsWith(p.baseUrl))?.id ?? 'custom';

  useEffect(() => {
    void hasOrigin(o.baseUrl).then(setOriginOk);
    void hasAllUrls().then(setAllUrls);
    if (o.searchTool === 'searxng' && o.searxngUrl) void hasOrigin(o.searxngUrl).then(setSearxngOk);
  }, [o.baseUrl, o.searchTool, o.searxngUrl]);

  // Test asks LM Studio / Ollama what each model can do; the chosen model's answer is remembered so an
  // image check on a text-only model fails up front with a hint instead of a server error.
  const {
    status,
    models,
    verify: test,
  } = useProviderVerify(
    () => new OpenAICompatProvider({ baseUrl: o.baseUrl, apiKey: o.apiKey, model: o.model, search: createSearchBackend(o) }),
    `${o.baseUrl} ${o.apiKey} ${o.model}`,
    async (ids) => {
      const described = await describeLocalModels(o.baseUrl, ids);
      setInfo(described);
      const chosen = o.model || ids[0] || '';
      const me = described.find((m) => m.id === chosen);
      const loaded = described.filter((m) => m.loaded).length;
      await set({ model: chosen, modelVision: me?.vision ?? null, modelTools: me?.tools ?? null, modelContext: me?.contextLength ?? null });
      return `Connected · ${ids.length} model${ids.length === 1 ? '' : 's'}${loaded ? ` · ${loaded} loaded` : ''}${me?.vision === false ? ' · text only' : me?.vision ? ' · can see images' : ''}`;
    },
  );
  // What Verify learned about the chosen model, or what an earlier Verify stored in settings.
  const chosenInfo =
    info.find((m) => m.id === o.model) ??
    (o.model && (o.modelVision != null || o.modelTools != null || o.modelContext != null)
      ? { id: o.model, vision: o.modelVision ?? undefined, tools: o.modelTools ?? undefined, contextLength: o.modelContext ?? undefined }
      : undefined);
  const capsLine = [
    chosenInfo?.vision === true ? 'Can see images' : chosenInfo?.vision === false ? 'Text only (no image checks)' : null,
    chosenInfo?.tools === true ? 'Tool calling' : chosenInfo?.tools === false ? 'No tool calling (search runs up front instead)' : null,
    chosenInfo?.contextLength ? `${Math.round(chosenInfo.contextLength / 1024)}k context` : null,
    chosenInfo?.loaded === false ? 'Not loaded in the server yet' : null,
  ].filter(Boolean);

  const allow = async () => {
    const ok = await requestOrigin(o.baseUrl);
    setOriginOk(ok);
  };
  const allowAll = async () => setAllUrls(await requestAllUrls());
  // One real query through the configured backend: a SearXNG without JSON output or a bad key fails here, not mid-check.
  const [searchStatus, setSearchStatus] = useState<Status>({ kind: 'idle' });
  const testSearch = async () => {
    const backend = createSearchBackend(o);
    if (!backend) return;
    setSearchStatus({ kind: 'checking' });
    try {
      const hits = await backend.search('Wayback Machine first archived', AbortSignal.timeout(15000));
      setSearchStatus({ kind: 'ok', text: `${backend.label} works · ${hits.length} result${hits.length === 1 ? '' : 's'}` });
    } catch (e) {
      setSearchStatus({ kind: 'bad', text: e instanceof Error ? e.message : String(e) });
    }
  };
  const allowSearxng = async () => setSearxngOk(await requestOrigin(o.searxngUrl));

  const needsPermission = !isLocal && !isOpenAI && originOk === false;
  const cleartextKey = /^http:\/\//i.test(o.baseUrl) && !isLocal && o.apiKey.trim().length > 0;
  const title = PROVIDER_LABELS['openai-compat'];

  return (
    <ProviderCard
      id={PROVIDER_CARD_ID['openai-compat']}
      icon={<Cpu size={16} />}
      title={title}
      subtitle={
        status.kind === 'ok'
          ? status.text
          : status.kind === 'bad'
            ? status.text
            : status.kind === 'checking'
              ? 'Connecting…'
              : o.model
                ? `${openaiCompatLabel(o.baseUrl)} · ${o.model}`
                : 'Ollama or LM Studio on this device, or OpenAI and other OpenAI-style APIs'
      }
      subtitleTone={status.kind === 'ok' ? 'ok' : status.kind === 'bad' ? 'bad' : undefined}
      isDefault={settings.defaultProvider === 'openai-compat'}
      onMakeDefault={() => update((s) => ({ ...s, defaultProvider: 'openai-compat' }))}
    >
      <Row label="Server">
        {(id) => (
          <select
            aria-labelledby={id}
            className="wys-input h-8 w-auto max-w-[220px] text-[12px]"
            value={preset}
            onChange={(e) => {
              const p = OPENAI_COMPAT_PRESETS.find((x) => x.id === e.target.value);
              if (!p?.baseUrl) return;
              // A new server means a new model list; a key for a hosted API must not be sent to localhost (or vice versa).
              const wasLocal = presetFor(o.baseUrl)?.local ?? localServer(o.baseUrl).isLocal;
              void set({
                baseUrl: p.baseUrl,
                model: '',
                modelVision: null,
                modelTools: null,
                modelContext: null,
                ...(p.local !== wasLocal ? { apiKey: '' } : {}),
              });
            }}
          >
            {OPENAI_COMPAT_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        )}
      </Row>
      <div className="flex items-center gap-2">
        <label htmlFor="wys-ocurl" className="w-[70px] shrink-0 text-[13px] max-[359px]:basis-full">
          Endpoint
        </label>
        <CommitInput
          id="wys-ocurl"
          value={o.baseUrl}
          onCommit={(v) => set({ baseUrl: v.replace(/\/+$/, '') })}
          placeholder="http://localhost:11434/v1"
          className="h-8 min-w-0 grow text-[12px]"
        />
      </div>
      {cleartextKey && (
        <div className="flex gap-2 rounded-lg bg-bad-soft px-2.5 py-2 text-[12px] leading-4 text-bad-ink">
          <Alert size={14} className="mt-0.5 shrink-0 text-bad" />
          <span>
            This endpoint is plain http and not on this machine, so the API key travels unencrypted across the network. Use https, or leave the key empty.
          </span>
        </div>
      )}
      {needsPermission && <PermissionNote text="The model server is on another host" host={hostOf(o.baseUrl) || o.baseUrl} onAllow={allow} />}
      <div className="flex items-center gap-2">
        <label htmlFor="wys-ockey" className="w-[70px] shrink-0 text-[13px] max-[359px]:basis-full">
          API key
        </label>
        <div className="min-w-0 grow">
          <SecretInput id="wys-ockey" value={o.apiKey} onCommit={(v) => set({ apiKey: v })} placeholder={isLocal ? 'Usually not needed locally' : 'sk-…'} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="wys-ocmodel" className="w-[70px] shrink-0 text-[13px] max-[359px]:basis-full">
          Model
        </label>
        <CommitInput
          id="wys-ocmodel"
          list="wys-ocmodels"
          value={o.model}
          onCommit={(v) => set({ model: v })}
          placeholder={isLocal ? 'e.g. qwen3.5:9b' : 'e.g. gpt-5-mini'}
          className="h-8 min-w-0 grow text-[12px]"
        />
        <datalist id="wys-ocmodels">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <button className="wys-btn h-8 px-2.5 text-[12px]" aria-disabled={status.kind === 'checking'} onClick={() => status.kind !== 'checking' && void test()}>
          {status.kind === 'checking' ? '…' : 'Verify'}
        </button>
      </div>
      <StatusLine status={status} />
      {capsLine.length > 0 && <p className="m-0 text-[11px] leading-[15px] text-ink-2">{capsLine.join(' · ')}</p>}
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
          , start its server, then press Verify. Ollama works as is; in LM Studio turn on “Enable CORS” in the server settings.
        </span>
      )}

      <div className="flex gap-2 rounded-lg bg-warn-soft px-2.5 py-2">
        <Alert size={14} className="mt-0.5 shrink-0 text-warn" />
        <span className="text-[12px] leading-4 text-warn-ink">
          {o.searchTool === 'none'
            ? 'This model can’t search the web by itself. Pick a search tool below so it can find sources; without one it answers from memory and says so.'
            : 'With a search tool the model can search the web and read the pages it finds, and only those pages become links.'}
        </span>
      </div>
      <Row label="Search tool" hint="How the local model finds sources.">
        {(id) => (
          <select
            aria-labelledby={id}
            className="wys-input h-8 w-auto max-w-[220px] text-[12px]"
            value={o.searchTool}
            onChange={(e) => set({ searchTool: e.target.value as SearchToolId })}
          >
            <option value="none">None · no sources</option>
            <option value="searxng">SearXNG · self-hosted</option>
            <option value="brave">Brave Search · API key</option>
            <option value="tavily">Tavily · API key</option>
          </select>
        )}
      </Row>
      {o.searchTool !== 'none' && (
        <div className="flex items-center gap-2">
          <button
            className="wys-btn h-8 px-2.5 text-[12px]"
            aria-disabled={searchStatus.kind === 'checking'}
            onClick={() => searchStatus.kind !== 'checking' && void testSearch()}
          >
            {searchStatus.kind === 'checking' ? '…' : 'Test search'}
          </button>
          <StatusLine status={searchStatus} />
        </div>
      )}
      {o.searchTool === 'searxng' && (
        <>
          <div className="flex items-center gap-2">
            <label htmlFor="wys-searx" className="w-[70px] shrink-0 text-[13px] max-[359px]:basis-full">
              SearXNG URL
            </label>
            <CommitInput
              id="wys-searx"
              value={o.searxngUrl}
              onCommit={(v) => set({ searxngUrl: v.replace(/\/+$/, '') })}
              placeholder="http://localhost:8888"
              className="h-8 min-w-0 grow text-[12px]"
            />
          </div>
          {o.searxngUrl && searxngOk === false && (
            <PermissionNote text="The search server is on another host" host={hostOf(o.searxngUrl) || o.searxngUrl} onAllow={allowSearxng} />
          )}
          <span className="text-[11px] leading-[15px] text-ink-2">
            Your SearXNG must allow JSON results (in its settings.yml: <code className="rounded bg-surface-2 px-1">search.formats: [html, json]</code>). The
            repo’s docker folder has a ready-made one.
          </span>
        </>
      )}
      {o.searchTool === 'brave' && (
        <div className="flex items-center gap-2">
          <label htmlFor="wys-brave" className="w-[70px] shrink-0 text-[13px] max-[359px]:basis-full">
            Brave key
          </label>
          <div className="min-w-0 grow">
            <SecretInput id="wys-brave" value={o.braveKey} onCommit={(v) => set({ braveKey: v })} placeholder="BSA…" />
          </div>
        </div>
      )}
      {o.searchTool === 'tavily' && (
        <div className="flex items-center gap-2">
          <label htmlFor="wys-tavily" className="w-[70px] shrink-0 text-[13px] max-[359px]:basis-full">
            Tavily key
          </label>
          <div className="min-w-0 grow">
            <SecretInput id="wys-tavily" value={o.tavilyKey} onCommit={(v) => set({ tavilyKey: v })} placeholder="tvly-…" />
          </div>
        </div>
      )}
      {o.searchTool !== 'none' && (
        <Row label="Let the model read the pages it finds" hint={allUrls ? 'Allowed for all sites.' : 'Needs permission to fetch pages on your behalf.'}>
          {(id) =>
            allUrls ? (
              <span className="text-[12px] text-ink-2">Allowed</span>
            ) : (
              <button className="wys-btn h-8 px-2.5 text-[12px]" aria-describedby={id} onClick={() => void allowAll()}>
                Allow all sites
              </button>
            )
          }
        </Row>
      )}
    </ProviderCard>
  );
}

function PermissionNote({ text, host, onAllow }: { text: string; host: string; onAllow: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-accent-line bg-accent-wash px-2.5 py-2 text-[12px]">
      <span className="grow text-ink-2">{text}</span>
      <button className="wys-btn h-7 px-2.5 text-[12px]" onClick={onAllow}>
        Allow {host}
      </button>
    </div>
  );
}
