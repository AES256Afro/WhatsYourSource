import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { CheckInput, SelectionInfo } from '@/lib/messaging/protocol';
import { SelectionInfoSchema } from '@/lib/messaging/protocol';
import { PROVIDER_LABELS, openaiCompatLabel } from '@/lib/providers/registry';
import type { Settings } from '@/lib/storage/settings';
import { getTargetTab } from '@/lib/tabs';
import { domainOf, truncate } from '@/lib/util/url';
import { Label, ProviderBadge } from './common';
import { ChevronRight, Globe, Image, Logo } from './Icons';

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
  const [tab, setTab] = useState<{ id?: number; url: string; title: string } | null>(null);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [pasted, setPasted] = useState('');

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const t = await getTargetTab();
      if (!alive) return;
      setTab(t ? { id: t.id, url: t.url ?? '', title: t.title ?? '' } : null);
      if (t?.id == null) return setSelection(null);
      try {
        // The content script reports the page URL/title too; we don't hold the `tabs` permission.
        const reply = await browser.tabs.sendMessage(t.id, { type: 'wys:get-selection' });
        const parsed = SelectionInfoSchema.safeParse(reply);
        if (!alive) return;
        if (parsed.success) {
          setTab({ id: t.id, url: parsed.data.pageUrl || t.url || '', title: parsed.data.pageTitle || t.title || '' });
          setSelection(parsed.data.text.trim() ? parsed.data : null);
        } else setSelection(null);
      } catch {
        if (alive) setSelection(null);
      }
    };
    void refresh();
    const onActivated = () => void refresh();
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onActivated);
    return () => {
      alive = false;
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onActivated);
    };
  }, []);

  const providerLabel =
    settings.defaultProvider === 'gemini'
      ? `Google AI · ${settings.providers.gemini.model}`
      : settings.defaultProvider === 'openai-compat'
        ? `${openaiCompatLabel(settings.providers.openaiCompat.baseUrl)} · ${settings.providers.openaiCompat.model || 'no model'}`
        : settings.defaultProvider === 'anthropic'
          ? `Claude · ${settings.providers.anthropic.model}`
          : PROVIDER_LABELS[settings.defaultProvider];

  const pageInput: CheckInput | null = tab?.url && /^https?:/i.test(tab.url) ? { kind: 'page', url: tab.url, title: tab.title } : null;

  const submitPasted = () => {
    const t = pasted.trim();
    if (!t) return;
    if (/^https?:\/\/\S+$/i.test(t)) onCheck({ kind: 'page', url: t, title: '' });
    else onCheck({ kind: 'text', text: t, pageUrl: tab?.url ?? '', pageTitle: tab?.title ?? '' });
  };

  return (
    <div className="flex flex-col gap-3.5 p-3.5">
      <div className="flex items-center gap-2">
        <ProviderBadge label={providerLabel} />
        <span className="grow" />
        <button className="border-0 bg-transparent p-0 text-[12px] font-medium text-accent" onClick={onSettings}>
          Change
        </button>
      </div>

      {selection ? (
        <div className="flex flex-col gap-2 rounded-xl border border-accent-line bg-accent-wash p-3">
          <Label right={<span className="text-[12px] text-ink-2">{domainOf(selection.pageUrl)}</span>}>
            <span className="text-accent">Selected on this page</span>
          </Label>
          <p className="m-0 line-clamp-3 text-[13px] leading-[19px]">“{selection.text}”</p>
          <div className="flex gap-2">
            <button className="wys-btn wys-btn-primary grow" onClick={() => onCheck({ kind: 'text', ...selection })}>
              <Logo size={16} /> Check source
            </button>
            <button className="wys-btn" title="Open in Google AI Mode (new tab)" onClick={() => onWebMode({ kind: 'text', ...selection })}>
              <Globe size={15} /> AI Mode
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-line-2 p-3 text-[12px] leading-[17px] text-ink-2">
          Highlight text on the page and a <strong className="text-ink">Check source</strong> chip appears — or press{' '}
          <kbd className="rounded bg-surface-2 px-1 font-semibold text-ink">Ctrl+Shift+S</kbd>. Right-click an image to check it.
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label>Or check</Label>
        <button
          className="wys-card flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface disabled:opacity-50"
          disabled={!pageInput}
          onClick={() => pageInput && onCheck(pageInput)}
        >
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-surface-2 text-ink-2">
            <Globe size={18} />
          </span>
          <span className="flex min-w-0 grow flex-col">
            <span className="text-[13px] font-semibold">This page</span>
            <span className="truncate text-[12px] text-ink-2">{pageInput ? truncate(pageInput.url, 60) : 'Not available on this tab'}</span>
          </span>
          <ChevronRight size={16} className="text-ink-3" />
        </button>
        <div className="wys-card flex items-center gap-3 px-3 py-2.5 text-ink-2">
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-surface-2">
            <Image size={18} />
          </span>
          <span className="flex min-w-0 grow flex-col">
            <span className="text-[13px] font-semibold text-ink">An image</span>
            <span className="text-[12px]">Right-click any image → Check source of this image</span>
          </span>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submitPasted();
          }}
        >
          <label htmlFor="wys-paste" className="sr-only">
            Paste text or a link
          </label>
          <input
            id="wys-paste"
            className="wys-input"
            placeholder="Paste text or a link…"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          <button type="submit" className="wys-btn" disabled={!pasted.trim()}>
            Check
          </button>
        </form>
      </div>

      {recent}
    </div>
  );
}
