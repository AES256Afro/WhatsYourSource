import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { enforceSnapshotCap, saveCheck } from '@/lib/history/db';
import { captureFromTab } from '@/lib/history/snapshot';
import { ImageFetchError } from '@/lib/image/bytes';
import { prepareImage, type PreparedImage } from '@/lib/image/prepare';
import { requestOrigin } from '@/lib/permissions';
import { onJob, takeJob } from '@/lib/jobs';
import type { CheckInput } from '@/lib/messaging/protocol';
import { runCheck } from '@/lib/pipeline/runCheck';
import type { CheckResult } from '@/lib/pipeline/schema';
import { createProvider, providerDisplayName } from '@/lib/providers/registry';
import { providerOrder, providerReady, type Settings } from '@/lib/storage/settings';
import { googleAiModeUrl } from '@/lib/webmode';
import { CheckingView, type RunState } from './components/CheckingView';
import { DetailView } from './components/DetailView';
import { ErrorView, type RunError } from './components/ErrorView';
import { HistoryView } from './components/HistoryView';
import { HomeView } from './components/HomeView';
import { Onboarding } from './components/Onboarding';
import { External, Sliders } from './components/Icons';
import { RecentList } from './components/RecentList';
import { ResultView } from './components/ResultView';
import { SettingsView } from './components/SettingsView';
import { TopBar } from './components/TopBar';
import { useSettings } from './hooks/useSettings';

type View = 'home' | 'checking' | 'result' | 'error' | 'settings' | 'history' | 'detail';

/** Errors worth trying the next provider for. */
const FALLBACK_CODES = new Set(['no-key', 'auth', 'quota', 'network', 'server', 'bad-request']);

export function App() {
  const { settings, update } = useSettings();
  const [view, setView] = useState<View>('home');
  const [run, setRun] = useState<RunState | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedWithSnapshot, setSavedWithSnapshot] = useState(false);
  const [error, setError] = useState<{ input: CheckInput; error: RunError } | null>(null);
  const [needsSetup, setNeedsSetup] = useState<CheckInput | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const seenJobs = useRef(new Set<string>());
  const settingsRef = useRef<Settings | null>(null);
  settingsRef.current = settings;

  const openWebMode = useCallback((input: CheckInput) => {
    void browser.tabs.create({ url: googleAiModeUrl(input) });
  }, []);

  const startCheck = useCallback(
    async (input: CheckInput, tabId?: number) => {
      const s = settingsRef.current;
      if (!s) return;
      abortRef.current?.abort();
      setError(null);
      setResult(null);
      setSavedId(null);
      setSavedWithSnapshot(false);

      if (s.defaultProvider === 'webmode') {
        openWebMode(input);
        setView('home');
        return;
      }
      const order = providerOrder(s).filter((id) => providerReady(s, id));
      if (order.length === 0) {
        setNeedsSetup(input);
        setView('settings');
        return;
      }

      // Capture the page as it is *now*, in parallel with the AI call.
      const snapshotPromise = s.privacy.snapshots ? captureFromTab(tabId, input.kind === 'text' ? input.text : undefined) : Promise.resolve(null);

      const controller = new AbortController();
      abortRef.current = controller;
      let lastError: RunError | null = null;

      // Images: get the bytes and the local provenance facts before any provider runs.
      let image: PreparedImage | undefined;
      if (input.kind === 'image') {
        const prep: RunState = { input, providerLabel: 'Preparing image', statuses: [], text: '', queries: [], sources: [], startedAt: Date.now() };
        setRun({ ...prep });
        setView('checking');
        try {
          image = await prepareImage(
            input,
            tabId,
            (m) => {
              prep.statuses = [...prep.statuses, m];
              setRun({ ...prep });
            },
            controller.signal,
          );
        } catch (e) {
          const err = e instanceof ImageFetchError ? e : null;
          setError({
            input,
            error: {
              code: err?.kind === 'permission' ? 'image-permission' : 'image',
              message: err?.kind === 'permission' ? 'The image host blocked a direct download.' : err?.kind === 'not-image' ? 'That link is not an image.' : 'Could not load the image.',
              details: err?.message ?? String(e),
            },
          });
          setView('error');
          return;
        }
      }

      for (const id of order) {
        const provider = createProvider(id, s);
        if (!provider) continue;
        const state: RunState = {
          input,
          providerLabel: `${providerDisplayName(id, s)} · ${provider.model}`,
          statuses: [],
          text: '',
          queries: [],
          sources: [],
          startedAt: Date.now(),
        };
        setRun({ ...state });
        setView('checking');
        let finished: CheckResult | null = null;
        let failed: RunError | null = null;

        for await (const ev of runCheck(input, provider, controller.signal, image ? { image } : {})) {
          if (controller.signal.aborted) break;
          switch (ev.type) {
            case 'status':
              if (!ev.done) state.statuses = [...state.statuses, ev.message];
              break;
            case 'delta':
              state.text += ev.text;
              break;
            case 'searchQueries':
              state.queries = ev.queries;
              state.statuses = [
                ...state.statuses.filter((x) => !x.startsWith('Searched')),
                `Searched Google · ${ev.queries.length} ${ev.queries.length === 1 ? 'query' : 'queries'}`,
              ];
              break;
            case 'sources':
              state.sources = [...state.sources, ...ev.sources];
              break;
            case 'result':
              finished = ev.result;
              break;
            case 'error':
              failed = { code: ev.code, message: ev.message, details: ev.details };
              break;
          }
          setRun({ ...state });
          if (finished || failed) break;
        }

        if (controller.signal.aborted) {
          setError({ input, error: { code: 'cancelled', message: 'Cancelled.' } });
          setView('error');
          return;
        }
        if (finished) {
          setResult(finished);
          setView('result');
          try {
            const snap = await snapshotPromise;
            await saveCheck(finished, snap);
            setSavedId(finished.id);
            setSavedWithSnapshot(!!snap);
            setHistoryTick((t) => t + 1);
            void enforceSnapshotCap(s.history.maxMb * 1024 * 1024);
          } catch (e) {
            console.warn('[wys] could not save to history', e);
          }
          return;
        }
        lastError = failed ?? { code: 'unknown', message: 'The provider returned nothing.' };
        if (!FALLBACK_CODES.has(lastError.code) || !s.fallback) break;
      }
      setError({ input, error: lastError ?? { code: 'unknown', message: 'Unknown error.' } });
      setView('error');
    },
    [openWebMode],
  );

  // Jobs from the background (context menu, shortcut, chip, popup).
  useEffect(() => {
    if (!settings) return;
    const handle = (job: { id: string; input: CheckInput; tabId?: number }) => {
      if (seenJobs.current.has(job.id)) return;
      seenJobs.current.add(job.id);
      void startCheck(job.input, job.tabId);
    };
    const off = onJob(handle);
    void takeJob().then((job) => job && handle(job));
    return off;
  }, [settings === null, startCheck]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = () => abortRef.current?.abort();
  const openDetail = (id: string) => {
    setDetailId(id);
    setView('detail');
  };

  if (!settings) return <div className="p-4 text-[13px] text-ink-2">Loading…</div>;

  if (!settings.onboarded && view !== 'settings') {
    return (
      <div className="flex h-full flex-col bg-paper">
        <Onboarding settings={settings} update={update} onDone={() => setView('home')} onOpenSettings={() => setView('settings')} />
      </div>
    );
  }

  const body = (() => {
    switch (view) {
      case 'checking':
        return run ? <CheckingView run={run} onCancel={cancel} /> : null;
      case 'result':
        return result ? (
          <ResultView result={result} onRecheck={() => startCheck(result.input)} saved={!!savedId} snapshotNote={savedWithSnapshot ? 'Saved with page snapshot' : 'Saved to history'} />
        ) : null;
      case 'error':
        return error ? (
          <ErrorView
            input={error.input}
            error={error.error}
            onRetry={() => startCheck(error.input)}
            onSettings={() => setView('settings')}
            onAllowHost={
              error.error.code === 'image-permission' && error.input.kind === 'image'
                ? async () => {
                    const ok = await requestOrigin((error.input as { srcUrl: string }).srcUrl);
                    if (ok) void startCheck(error.input);
                  }
                : undefined
            }
          />
        ) : null;
      case 'settings':
        return (
          <>
            {needsSetup && (
              <div className="m-3.5 mb-0 flex flex-col gap-2 rounded-xl border border-accent-line bg-accent-wash p-3 text-[13px] leading-[18px]">
                <span className="flex items-center gap-1.5 font-semibold text-accent">
                  <Sliders size={15} /> Pick how to check sources
                </span>
                <span className="text-ink-2">Add a Google AI key below (free), or open this check on Google’s AI Mode page — no key needed.</span>
                <div className="flex gap-2">
                  <button className="wys-btn wys-btn-primary grow" onClick={() => openWebMode(needsSetup)}>
                    Open in Google AI Mode <External size={13} />
                  </button>
                  <button className="wys-btn" onClick={() => setNeedsSetup(null)}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}
            <SettingsView settings={settings} update={update} />
          </>
        );
      case 'history':
        return <HistoryView onOpen={openDetail} refreshKey={historyTick} />;
      case 'detail':
        return detailId ? (
          <DetailView
            id={detailId}
            onRecheck={(input) => void startCheck(input)}
            onDeleted={() => {
              setHistoryTick((t) => t + 1);
              setView('history');
            }}
          />
        ) : null;
      default:
        return (
          <HomeView
            settings={settings}
            onCheck={(i) => void startCheck(i)}
            onWebMode={openWebMode}
            onSettings={() => setView('settings')}
            recent={<RecentList onOpen={openDetail} onSeeAll={() => setView('history')} refreshKey={historyTick} />}
          />
        );
    }
  })();

  return (
    <div className="flex h-full flex-col bg-paper">
      <TopBar
        view={view}
        title={view === 'detail' ? 'Saved check' : undefined}
        onBack={view === 'detail' ? () => setView('history') : undefined}
        onHome={() => setView(result ? 'result' : 'home')}
        onHistory={() => setView(view === 'history' ? (result ? 'result' : 'home') : 'history')}
        onSettings={() => setView(view === 'settings' ? (result ? 'result' : 'home') : 'settings')}
      />
      <div className="min-h-0 grow overflow-y-auto">{body}</div>
    </div>
  );
}
