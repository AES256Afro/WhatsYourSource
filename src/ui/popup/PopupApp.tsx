import { browser } from 'wxt/browser';
import { enqueueJob } from '@/lib/jobs';
import { openPanelSync } from '@/lib/panel';
import type { CheckInput } from '@/lib/messaging/protocol';
import { providerRunLabel } from '@/lib/providers/labels';
import { googleAiModeUrl } from '@/lib/googleAiMode';
import { askLabel, availableAsks, DEFAULT_ASK, questionFor, type AskId } from '@/lib/pipeline/question';
import { defaultAsk, providerReady } from '@/lib/storage/settings';
import { useTargetSelection } from '../hooks/useTargetSelection';
import { domainOf, truncate } from '@/lib/util/url';
import { useSettings } from '../hooks/useSettings';
import { useShortcutLabel } from '../hooks/useShortcutLabel';
import { External, Logo, Sliders, Sparkle } from '../components/Icons';
import { Label } from '../components/common';

export function PopupApp() {
  const { settings, update } = useSettings();
  const { tab, selection } = useTargetSelection();
  const shortcut = useShortcutLabel();

  const input: CheckInput | null = selection
    ? { kind: 'text', ...selection }
    : tab?.url && /^https?:/i.test(tab.url)
      ? { kind: 'page', url: tab.url, title: tab.title }
      : null;
  const webmode = settings?.defaultProvider === 'webmode';
  const ask = settings ? defaultAsk(settings) : DEFAULT_ASK;
  const saved = settings?.ask.saved ?? [];
  // The select's value: a preset id, or `saved-<index>` for a saved question ('own' for a custom default not in the list).
  const askValue = ask.id !== 'custom' ? ask.id : saved.includes(ask.custom ?? '') ? `saved-${saved.indexOf(ask.custom ?? '')}` : 'own';

  /** Open the panel synchronously (user gesture), then hand over the job. */
  const checkInPanel = () => {
    if (!input) return;
    // Don't close the popup until the panel (or its fallback window) is actually open, or the job
    // would sit in storage until some later panel picks it up.
    const opened = openPanelSync(tab ?? undefined, () => void browser.runtime.sendMessage({ type: 'wys:open-panel' }));
    void Promise.all([opened.catch(() => undefined), enqueueJob(input, tab?.id, tab?.windowId)]).then(() => window.close());
  };

  const openWeb = () => {
    if (!input) return;
    void browser.tabs.create({ url: googleAiModeUrl(input, settings?.webmodeVariant ?? 'ai-mode', ask) }).then(() => window.close());
  };

  return (
    <div className="flex w-[340px] flex-col bg-paper">
      <div className="flex h-12 items-center gap-2 border-b border-line pr-2 pl-3.5">
        <Logo size={22} className="text-accent" />
        <span className="text-[14px] font-semibold tracking-tight">WhatsYourSource</span>
        <span className="grow" />
        <button className="wys-icon-btn" aria-label="Settings" onClick={() => browser.runtime.openOptionsPage()}>
          <Sliders size={18} />
        </button>
      </div>
      <div className="flex flex-col gap-3 p-3.5">
        <Label right={<span className="text-[12px] text-ink-2">{tab ? domainOf(tab.url) : ''}</span>}>
          {selection ? 'Selected on this page' : 'This page'}
        </Label>
        <div dir="auto" className="line-clamp-4 rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px] leading-[18px] wrap-anywhere">
          {selection ? `“${selection.text}”` : input ? tab?.title || tab?.url : 'Nothing to check on this tab. Highlight some text first.'}
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <label htmlFor="wys-default-ask" className="text-[13px]">
              Default question
            </label>
            <span className="grow" />
            <select
              id="wys-default-ask"
              className="wys-input h-8 w-auto max-w-[200px] text-[12px]"
              value={askValue}
              onChange={(e) => {
                // Read now: by the time the updater runs, React has put the old value back in the control.
                const v = e.target.value;
                if (v === 'own') return;
                void update((s) => {
                  if (!v.startsWith('saved-')) return { ...s, ask: { ...s.ask, default: v as AskId } };
                  const q = s.ask.saved[Number(v.slice(6))];
                  return q ? { ...s, ask: { ...s.ask, default: 'custom', custom: q } } : s;
                });
              }}
            >
              {availableAsks(saved).map((a, i) => (
                <option key={a.id === 'custom' ? `saved-${i}` : a.id} value={a.id === 'custom' ? `saved-${saved.indexOf(a.custom ?? '')}` : a.id}>
                  {a.id === 'custom' ? truncate(a.custom ?? '', 60) : askLabel(a)}
                </option>
              ))}
              {askValue === 'own' && <option value="own">{truncate(ask.custom ?? '', 60)}</option>}
            </select>
          </div>
          <span className="px-1 text-[11px] leading-[15px] text-ink-2">
            Asks: “{questionFor(ask, input?.kind ?? 'text')}” Used by these buttons, the chip, the shortcut and the address bar; right-click items name their
            own question. To add your own questions, open Settings.
          </span>
        </div>

        {webmode ? (
          <div className="flex flex-col gap-1.5">
            <button className="wys-btn wys-btn-primary h-11 text-[14px]" disabled={!input} onClick={openWeb}>
              Open in Google AI Mode <External size={15} />
            </button>
            <span className="px-1 text-[11px] leading-[15px] text-ink-2">
              Your default is Google AI Mode: opens google.com in a new tab, no key needed, not saved to history. Add a key in Settings to get answers inside
              the panel.
            </span>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <button className="wys-btn wys-btn-primary h-11 text-[14px]" disabled={!input} onClick={checkInPanel}>
                <Sparkle size={15} /> Check in side panel
              </button>
              <span className="px-1 text-[11px] leading-[15px] text-ink-2">
                {settings && !providerReady(settings)
                  ? 'No key or model set yet. The panel will ask you to set one up, or use Google AI Mode below (no key).'
                  : `${settings ? `Uses ${providerRunLabel(settings.defaultProvider, settings)}` : 'Uses your configured provider'} · answer and sources appear in the panel · saved to history`}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <button className="wys-btn h-11 text-[14px]" disabled={!input} onClick={openWeb}>
                Open in Google AI Mode <External size={15} />
              </button>
              <span className="px-1 text-[11px] leading-[15px] text-ink-2">
                Opens google.com in a new tab with your text · no API key needed · not saved to history
              </span>
            </div>
          </>
        )}

        <div className="h-px bg-line" />
        <div className="flex items-center gap-2">
          <label htmlFor="wys-default-action" className="text-[13px]">
            Default for {shortcut ?? 'the shortcut'} and the chip
          </label>
          <span className="grow" />
          <select
            id="wys-default-action"
            className="wys-input h-8 w-auto text-[12px]"
            value={settings?.shortcutAction ?? 'panel'}
            onChange={(e) => {
              const action = e.target.value as 'panel' | 'webmode';
              void update((s) => ({ ...s, shortcutAction: action }));
            }}
          >
            <option value="panel">Check in the side panel</option>
            <option value="webmode">Open Google AI Mode</option>
          </select>
        </div>
      </div>
    </div>
  );
}
