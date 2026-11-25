import { useEffect, useRef, useState } from 'react';
import type { CheckInput } from '@/lib/messaging/protocol';
import { PROVIDER_LABELS, providerRunLabel } from '@/lib/providers/registry';
import { defaultAsk, providerReady, type Settings } from '@/lib/storage/settings';
import { useShortcutLabel } from '../hooks/useShortcutLabel';
import { useTargetSelection } from '../hooks/useTargetSelection';
import { domainOf, truncate } from '@/lib/util/url';
import { askIdLabel, normalizeAsk, type Ask, type AskId } from '@/lib/pipeline/question';
import { AskPicker } from './AskPicker';
import { Label, ProviderBadge, TextAction } from './common';
import { ChevronRight, External, Globe, Image, Logo } from './Icons';

export function HomeView({
  settings,
  onCheck,
  onWebMode,
  onSettings,
  onAskChange,
  picked: pickedHere,
  onPick,
  recent,
}: {
  settings: Settings;
  onCheck: (input: CheckInput) => void;
  onWebMode: (input: CheckInput) => void;
  onSettings: () => void;
  /** Save the custom question's text, or make a question the default for every way of starting a check. */
  onAskChange: (patch: Partial<Settings['ask']>) => void;
  /** The question picked here for checks started from this panel; null follows the default. */
  picked: AskId | null;
  onPick: (id: AskId | null) => void;
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

  // The question for checks started here. It starts as the default and can differ from it: picking
  // "Timeline" for one post must not quietly change what the chip and the shortcut ask.
  // Until the user picks here, it follows the default, including a change made in the popup or Settings.
  const picked = pickedHere ?? settings.ask.default;
  const [typedHere, setTypedHere] = useState<string | null>(null);
  const customText = typedHere ?? settings.ask.custom;
  /** Shown for a few seconds after "Always ask X", with the way back. */
  const [madeDefault, setMadeDefault] = useState<{ now: AskId; was: AskId } | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const makeDefault = (id: AskId, was: AskId) => {
    onAskChange({ default: id });
    onPick(null);
    setMadeDefault(was === id ? null : { now: id, was });
    // The line that held the action is gone; keep keyboard focus on the choice it applied to.
    setTimeout(() => pickerRef.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus(), 0);
  };
  useEffect(() => {
    if (!madeDefault) return;
    const t = setTimeout(() => setMadeDefault(null), 6000);
    return () => clearTimeout(t);
  }, [madeDefault]);
  const ask: Ask = normalizeAsk({ id: picked, custom: customText });
  // What the default really asks: "Ask your own" with no text written falls back to Fact-check.
  const effectiveDefault = defaultAsk(settings).id;
  /** A question's name inside a sentence. */
  const nameOf = (id: AskId) => (id === 'custom' ? 'your question' : askIdLabel(id));
  const webmode = settings.defaultProvider === 'webmode';
  const ready = providerReady(settings);
  const providerLabel = ready ? providerRunLabel(settings.defaultProvider, settings) : `${PROVIDER_LABELS[settings.defaultProvider]} · no key set`;

  const pageInput: CheckInput | null = tab?.url && /^https?:/i.test(tab.url) ? { kind: 'page', url: tab.url, title: tab.title } : null;

  /** With Google AI Mode as the default, every check leaves for a new tab; say so instead of changing nothing. */
  const run = (bare: CheckInput) => {
    const input = { ...bare, ask };
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

      <div ref={pickerRef} className="flex flex-col gap-1.5">
        <Label>Question</Label>
        <AskPicker
          selected={picked}
          custom={customText}
          onSelect={(id) => {
            setMadeDefault(null);
            onPick(id);
          }}
          onCustom={(text) => {
            setTypedHere(text);
            onAskChange({ custom: text });
          }}
          kind={selection ? 'text' : 'page'}
        />
        {picked !== effectiveDefault && ask.id === picked && (
          <span className="text-[11px] leading-[15px] text-ink-2">
            Only for checks you start in this panel. Highlighting, the shortcut and the address bar still ask {nameOf(effectiveDefault)}.{' '}
            <TextAction onClick={() => makeDefault(picked, effectiveDefault)}>Always ask {nameOf(picked)}</TextAction>
          </span>
        )}
        <span role="status" className="text-[11px] leading-[15px] text-ink-2 empty:hidden">
          {madeDefault && (
            <>
              {madeDefault.now === 'custom'
                ? 'Your question is now the default for highlighting, the shortcut and the address bar.'
                : `${askIdLabel(madeDefault.now)} is now the default for highlighting, the shortcut and the address bar.`}{' '}
              <TextAction onClick={() => makeDefault(madeDefault.was, madeDefault.was)}>Undo</TextAction>
            </>
          )}
        </span>
      </div>

      {selection ? (
        <div className="flex flex-col gap-2 rounded-xl border border-accent-line bg-accent-wash p-3">
          <Label right={<span className="text-[12px] text-ink-2">{domainOf(selection.pageUrl)}</span>}>
            <span className="text-accent">Selected on this page</span>
          </Label>
          <p dir="auto" className="m-0 line-clamp-3 text-[13px] leading-[18px] wrap-anywhere">
            “{selection.text}”
          </p>
          {!webmode && ready && (
            <span className="text-[11px] leading-[15px] text-ink-2">
              Sends the selection{selection.surrounding ? `, ${selection.surrounding.length.toLocaleString()} characters around it` : ''} and the page address
              to {providerLabel}.
            </span>
          )}
          <div className="flex flex-wrap gap-2">
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
                onClick={() => onWebMode({ kind: 'text', ...selection, ask })}
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
          {settings.privacy.chip ? (
            <>
              Highlight text on the page and a <strong className="text-ink">Check source</strong> chip appears
              {shortcut ? (
                <>
                  {' '}
                  — or press <kbd className="rounded bg-surface-2 px-1 font-semibold text-ink">{shortcut}</kbd>
                </>
              ) : null}
              .
            </>
          ) : (
            <>
              Highlight text on the page, then{' '}
              {shortcut ? (
                <>
                  press <kbd className="rounded bg-surface-2 px-1 font-semibold text-ink">{shortcut}</kbd> or right-click it
                </>
              ) : (
                'right-click it'
              )}
              . The <strong className="text-ink">Check source</strong> chip is off in Settings.
            </>
          )}{' '}
          Right-click an image to check it, or type <kbd className="rounded bg-surface-2 px-1 font-semibold text-ink">wys</kbd> and your text or link in the
          address bar.
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label>Or check</Label>
        <button
          className={`wys-card flex items-center gap-3 px-3 py-2.5 text-left ${pageInput ? 'hover:bg-surface' : 'opacity-60'}`}
          aria-disabled={!pageInput}
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
            An image: right-click it on the page → <strong className="font-medium text-ink">Fact-check this image</strong>
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
