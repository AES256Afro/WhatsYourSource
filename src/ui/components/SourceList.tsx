import { useState } from 'react';
import { browser } from 'wxt/browser';
import type { Source } from '@/lib/pipeline/schema';
import { Count, Label, TextAction } from './common';
import { Check, Copy, External } from './Icons';

export function SourceList({ sources, right }: { sources: Source[]; right?: React.ReactNode }) {
  if (sources.length === 0) return null;
  const verified = sources.filter((x) => x.verified);
  const openAll = () => {
    if (verified.length > 5 && !confirm(`Open ${verified.length} tabs?`)) return;
    for (const s of verified) void browser.tabs.create({ url: s.url, active: false });
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Label
        id="wys-sources"
        right={
          <span className="flex items-center gap-3">
            {right}
            {verified.length > 1 && (
              <TextAction onClick={openAll}>
                Open all {verified.length} <span aria-hidden="true">↗</span>
              </TextAction>
            )}
          </span>
        }
      >
        Sources <Count n={sources.length} />
      </Label>
      {sources.map((s) => (
        <SourceRow key={s.id} source={s} />
      ))}
    </div>
  );
}

export function SourceRow({ source: s }: { source: Source }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(s.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const cls = `flex items-start gap-2.5 rounded-lg border px-3 py-2.5 no-underline ${s.verified ? 'border-line bg-paper hover:bg-surface' : 'border-dashed border-line-strong bg-paper'}`;
  const number = (
    <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-accent-soft text-[11px] font-bold text-accent">{s.id}</span>
  );
  if (s.verified) {
    return (
      <a id={`src-${s.id}`} href={s.url} target="_blank" rel="noopener noreferrer" className={cls}>
        {number}
        <span className="flex min-w-0 grow flex-col gap-px">
          <span className="truncate text-[13px] leading-[18px] font-medium text-ink">{s.title || s.domain}</span>
          <span className="text-[12px] text-ink-2">
            {s.domain}
            {s.date ? ` · ${s.date}` : ''}
          </span>
        </span>
        <External size={14} className="mt-[3px] shrink-0 text-ink-3" />
      </a>
    );
  }
  // The model named this page but the search machinery never returned it: show the address as text, never a live link.
  return (
    <div id={`src-${s.id}`} className={cls}>
      {number}
      <span className="flex min-w-0 grow flex-col gap-px">
        <span className="truncate text-[13px] leading-[18px] font-medium text-ink">{s.title || s.domain}</span>
        <span className="truncate text-[12px] text-ink-2" title={s.url}>
          {s.url}
        </span>
        <span className="text-[11px] leading-[15px] text-ink-2">
          Cited by the model but not returned by the search, so it is not linked. Copy it to check yourself.
        </span>
      </span>
      <button
        type="button"
        className="wys-icon-btn h-8 w-8 shrink-0"
        aria-label={copied ? 'Copied' : `Copy address of source ${s.id}`}
        onClick={() => void copy()}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}
