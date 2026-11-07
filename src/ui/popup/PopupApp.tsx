import { browser } from 'wxt/browser';
import { enqueueJob } from '@/lib/jobs';
import { openPanelSync } from '@/lib/panel';
import type { CheckInput } from '@/lib/messaging/protocol';
import { providerRunLabel } from '@/lib/providers/registry';
import { googleAiModeUrl } from '@/lib/googleAiMode';
import { useTargetSelection } from '../hooks/useTargetSelection';
import { domainOf } from '@/lib/util/url';
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
    void browser.tabs.create({ url: googleAiModeUrl(input, settings?.webmodeVariant ?? 'ai-mode') }).then(() => window.close());
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
        <div className="line-clamp-4 rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px] leading-[18px]">
          {selection ? `“${selection.text}”` : input ? tab?.title || tab?.url : 'Nothing to check on this tab. Highlight some text first.'}
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
                {settings ? `Uses ${providerRunLabel(settings.defaultProvider, settings)}` : 'Uses your configured provider'} · answer and sources appear in the
                panel · saved to history
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
            onChange={(e) => update((s) => ({ ...s, shortcutAction: e.target.value as 'panel' | 'webmode' }))}
          >
            <option value="panel">Check in the side panel</option>
            <option value="webmode">Open Google AI Mode</option>
          </select>
        </div>
      </div>
    </div>
  );
}
