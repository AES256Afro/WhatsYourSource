import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { googleAiModeUrl } from '@/lib/googleAiMode';
import { onJob, takeJob, type Job } from '@/lib/jobs';
import type { CheckInput } from '@/lib/messaging/protocol';
import { providerDisplayName } from '@/lib/providers/registry';
import { providerOrder, providerReady, type ProviderId, type Settings } from '@/lib/storage/settings';
import { requestOrigin } from '@/lib/permissions';
import { CheckingView } from './components/CheckingView';
import { DetailView } from './components/DetailView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ErrorView } from './components/ErrorView';
import { HistoryView } from './components/HistoryView';
import { HomeView } from './components/HomeView';
import { Onboarding } from './components/Onboarding';
import { External, Sliders } from './components/Icons';
import { RecentList } from './components/RecentList';
import { ResultView } from './components/ResultView';
import { SettingsView } from './components/SettingsView';
import { TopBar } from './components/TopBar';
import { useCheckRun } from './hooks/useCheckRun';
import { useSettings } from './hooks/useSettings';

type View = 'home' | 'checking' | 'result' | 'error' | 'settings' | 'history' | 'detail';

/** The panel: which view is up, and the check run that drives the checking/result/error views. */
export function App() {
  const { settings, update } = useSettings();
  const [view, setView] = useState<View>('home');
  const [focusProvider, setFocusProvider] = useState<ProviderId | undefined>(undefined);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const seenJobs = useRef(new Set<string>());
  const settingsRef = useRef<Settings | null>(null);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const openGoogleAiMode = useCallback((input: CheckInput) => {
    void browser.tabs.create({ url: googleAiModeUrl(input, settingsRef.current?.webmodeVariant) });
  }, []);

  const { phase, start, cancel, clearSetup, busy } = useCheckRun({
    settings: () => settingsRef.current,
    // Each transition of the run moves the panel to the matching view (the user may navigate away in between).
    onPhase: (p) => setView(p.phase === 'setup' ? 'settings' : p.phase === 'idle' ? 'home' : p.phase),
    openGoogleAiMode,
    onOnboarded: () => void update((cur) => ({ ...cur, onboarded: true })),
    onSaved: () => setHistoryTick((t) => t + 1),
  });

  // Jobs from the background (context menu, shortcut, chip, popup, address bar).
  const ready = settings !== null;
  useEffect(() => {
    if (!ready) return;
    const handle = (job: Job) => {
      if (seenJobs.current.has(job.id)) return;
      seenJobs.current.add(job.id);
      void start(job.input, job.tabId);
    };
    const off = onJob(handle);
    void takeJob().then((job) => job && handle(job));
    return off;
  }, [ready, start]);

  const openDetail = (id: string) => {
    setDetailId(id);
    setView('detail');
  };
  const openSettings = (provider?: ProviderId) => {
    setFocusProvider(provider);
    setView('settings');
  };
  const running = busy && view !== 'checking';
  /** Where "back" goes from a secondary view: the running check, else home. */
  const primary: View = running ? 'checking' : 'home';

  // Escape = back, everywhere a back makes sense.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (view === 'detail') setView('history');
      else if (view === 'settings' || view === 'history') setView(primary);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [view, primary]);

  if (!settings) return <div className="p-4 text-[13px] text-ink-2">Loading…</div>;

  // The first-run screen only replaces the home view: a check in progress, a result, settings or
  // history must stay visible even before "Finish setup" was pressed.
  if (!settings.onboarded && view === 'home') {
    return (
      <div className="flex h-full flex-col bg-paper">
        <Onboarding settings={settings} update={update} onDone={() => setView('home')} onOpenSettings={(p) => openSettings(p)} />
      </div>
    );
  }

  const needsSetup = phase.phase === 'setup' ? phase.input : null;
  const body = (() => {
    switch (view) {
      case 'checking':
        return phase.phase === 'checking' ? <CheckingView run={phase.run} onCancel={cancel} /> : null;
      case 'result':
        if (phase.phase !== 'result') return null;
        return (
          <ResultView
            result={phase.result}
            onRecheck={() => void start(phase.result.input)}
            secondOpinions={(['gemini', 'anthropic', 'openai-compat'] as const)
              .filter((id) => id !== phase.result.provider.id && providerReady(settings, id))
              .map((id) => ({ id, label: providerDisplayName(id, settings) }))}
            onSecondOpinion={(id) => void start(phase.result.input, undefined, id)}
            onNewCheck={() => setView('home')}
            searchTool={settings.providers.openaiCompat.searchTool !== 'none' ? settings.providers.openaiCompat.searchTool : undefined}
            saved={phase.save.status === 'saved'}
            saveError={phase.save.status === 'failed' ? phase.save.message : null}
            snapshotNote={phase.save.status === 'saved' && phase.save.withSnapshot ? 'Saved with page snapshot' : 'Saved to history'}
          />
        );
      case 'error':
        if (phase.phase !== 'error') return null;
        return (
          <ErrorView
            input={phase.input}
            error={phase.error}
            onRetry={() => void start(phase.input)}
            onSettings={openSettings}
            onAllowHost={
              phase.error.code === 'image-permission' && phase.input.kind === 'image'
                ? async () => {
                    const ok = await requestOrigin(phase.input.kind === 'image' ? phase.input.srcUrl : '');
                    if (ok) void start(phase.input);
                  }
                : undefined
            }
          />
        );
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
                  {providerOrder(settings).some((id) => providerReady(settings, id)) ? (
                    <button className="wys-btn wys-btn-primary grow" onClick={() => void start(needsSetup)}>
                      Check now
                    </button>
                  ) : (
                    <button className="wys-btn wys-btn-primary grow" onClick={() => openGoogleAiMode(needsSetup)}>
                      Open in Google AI Mode <External size={13} />
                    </button>
                  )}
                  <button className="wys-btn" onClick={clearSetup}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}
            <SettingsView settings={settings} update={update} focusProvider={focusProvider} />
          </>
        );
      case 'history':
        return <HistoryView onOpen={openDetail} refreshKey={historyTick} />;
      case 'detail':
        return detailId ? (
          <DetailView
            id={detailId}
            onRecheck={(input) => void start(input)}
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
            onCheck={(i) => void start(i)}
            onWebMode={openGoogleAiMode}
            onSettings={() => openSettings()}
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
        onHome={() => setView(primary)}
        onHistory={() => setView(view === 'history' ? primary : 'history')}
        onSettings={() => (view === 'settings' ? setView(primary) : openSettings())}
        checking={running}
      />
      <div className="min-h-0 grow overflow-y-auto">
        <ErrorBoundary onReset={() => setView('home')}>{body}</ErrorBoundary>
      </div>
    </div>
  );
}
