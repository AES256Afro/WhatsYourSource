import { useEffect, useRef, useState } from 'react';
import type { CheckInput } from '@/lib/messaging/protocol';
import { PROVIDER_LABELS, providerRunLabel } from '@/lib/providers/registry';
import { providerReady, type Settings } from '@/lib/storage/settings';
import { useShortcutLabel } from '../hooks/useShortcutLabel';
import { useTargetSelection } from '../hooks/useTargetSelection';
import { domainOf, truncate } from '@/lib/util/url';
import { Label, ProviderBadge, TextAction } from './common';
import { ChevronRight, External, Globe, Image, Logo } from './Icons';

export function HomeView({
  settings,
  onCheck,
  onWebMode,
  onSettings,
  recent,
}: {
  settings: Settings;
  onCheck: (input: CheckInput) => void;
  onWebMode: (input: CheckInput) => void;
  onSettings: () => void;
  recent?: React.ReactNode;
}) {
  const { tab, selection } = useTargetSelection(true);
  const [pasted, setPasted] = useState('');
  const [openedNote, setOpenedNote] = useState(false);
  const shortcut = useShortcutLabel();
  // Arriving here (New check, Finish setup, Escape) must not drop keyboard focus on <body>.
  const landing = useRef<HTMLElement>(null);
  useEffect(() => {
    landing.current?.focus();
  }, [selection !== null]); // eslint-disable-line react-hooks/exhaustive-deps -- once the selection state is known

  const webmode = settings.defaultProvider === 'webmode';
  const ready = providerReady(settings);
  const providerLabel = ready ? providerRunLabel(settings.defaultProvider, settings) : `${PROVIDER_LABELS[settings.defaultProvider]} · no key set`;

  const pageInput: CheckInput | null = tab?.url && /^https?:/i.test(tab.url) ? { kind: 'page', url: tab.url, title: tab.title } : null;

  /** With Google AI Mode as the default, every check leaves for a new tab; say so instead of changing nothing. */
  const run = (input: CheckInput) => {
    if (webmode) {
      onWebMode(input);
      setOpenedNote(true);
      setTimeout(() => setOpenedNote(false), 4000);
    } else onCheck(input);
  };

  const submitPasted = () => {
    const t = pasted.trim();
    if (!t) return;
    if (/^https?:\/\/\S+$/i.test(t)) run({ kind: 'page', url: t, title: '' });
    else run({ kind: 'text', text: t, pageUrl: '', pageTitle: '' });
  };

  return (
    <div className="flex flex-col gap-3.5 p-3.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0">
          <ProviderBadge label={providerLabel} />
        </span>
        <span className="grow" />
        <TextAction onClick={onSettings}>{ready ? 'Change' : 'Set up'}</TextAction>
      </div>
      {openedNote && (
        <p role="status" className="m-0 rounded-lg bg-accent-soft px-3 py-2 text-[12px] text-accent">
          Opened in a new Google AI Mode tab.
        </p>
      )}

      {selection ? (
        <div className="flex flex-col gap-2 rounded-xl border border-accent-line bg-accent-wash p-3">
          <Label right={<span className="text-[12px] text-ink-2">{domainOf(selection.pageUrl)}</span>}>
            <span className="text-accent">Selected on this page</span>
          </Label>
          <p className="m-0 line-clamp-3 text-[13px] leading-[18px]">“{selection.text}”</p>
          <div className="flex gap-2">
            <button
              ref={landing as React.RefObject<HTMLButtonElement>}
              className="wys-btn wys-btn-primary grow"
              onClick={() => run({ kind: 'text', ...selection })}
            >
              {webmode ? (
                <>
                  Open in Google AI Mode <External size={14} />
                </>
              ) : (
                <>
                  <Logo size={16} /> Check source
                </>
              )}
            </button>
            {!webmode && (
              <button
                className="wys-btn"
                title="Open in Google AI Mode (new tab)"
                aria-label="Open in Google AI Mode"
                onClick={() => onWebMode({ kind: 'text', ...selection })}
              >
                <Globe size={15} /> Google AI Mode <External size={13} />
              </button>
            )}
          </div>
        </div>
      ) : (
        <div
          ref={landing as React.RefObject<HTMLDivElement>}
          tabIndex={-1}
          className="rounded-xl border border-dashed border-line-strong p-3 text-[12px] leading-4 text-ink-2 outline-none"
        >
          Highlight text on the page and a <strong className="text-ink">Check source</strong> chip appears
          {shortcut ? (
            <>
              {' '}
              — or press <kbd className="rounded bg-surface-2 px-1 font-semibold text-ink">{shortcut}</kbd>
            </>
          ) : null}
          . Right-click an image to check it, or type <kbd className="rounded bg-surface-2 px-1 font-semibold text-ink">wys</kbd> and your text or link in the
          address bar.
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label>Or check</Label>
        <button
          className="wys-card flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface disabled:opacity-50"
          disabled={!pageInput}
          onClick={() => pageInput && run(pageInput)}
        >
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
            <Globe size={18} />
          </span>
          <span className="flex min-w-0 grow flex-col">
            <span className="text-[13px] font-semibold">This page</span>
            <span className="truncate text-[12px] text-ink-2">
              {pageInput ? (webmode ? `Opens in Google AI Mode ↗ · ${truncate(pageInput.url, 48)}` : truncate(pageInput.url, 60)) : 'Not available on this tab'}
            </span>
          </span>
          <ChevronRight size={16} className="text-ink-3" />
        </button>
        <p className="m-0 flex items-center gap-2 px-1 text-[12px] leading-4 text-ink-2">
          <Image size={14} className="shrink-0 text-ink-3" />
          <span>
            An image: right-click it on the page → <strong className="font-medium text-ink">Check source of this image</strong>
          </span>
        </p>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submitPasted();
          }}
        >
          <label htmlFor="wys-paste" className="wys-sr-only">
            Paste text or a link
          </label>
          <input id="wys-paste" className="wys-input" placeholder="Paste text or a link…" value={pasted} onChange={(e) => setPasted(e.target.value)} />
          <button type="submit" className="wys-btn" disabled={!pasted.trim()}>
            {webmode ? 'Open in AI Mode ↗' : 'Check source'}
          </button>
        </form>
      </div>

      {recent}
    </div>
  );
}
