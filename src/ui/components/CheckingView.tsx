import { useEffect, useRef, useState } from 'react';
import type { CheckInput } from '@/lib/messaging/protocol';
import type { RawSource } from '@/lib/providers/types';
import { InputCard } from './InputCard';
import { Label, ProviderBadge } from './common';
import { Check, Close, Search } from './Icons';
import { Narrative } from './Narrative';

export interface RunState {
  input: CheckInput;
  providerLabel: string;
  statuses: string[];
  text: string;
  queries: string[];
  sources: RawSource[];
  startedAt: number;
}

export function CheckingView({ run, onCancel }: { run: RunState; onCancel: () => void }) {
  const done = run.statuses;
  const current = done[done.length - 1] ?? 'Starting…';
  const earlier = done.slice(0, -1);
  // Keyboard users arrive here from the button they just pressed, which is gone; land them on the progress.
  const steps = useRef<HTMLDivElement>(null);
  useEffect(() => {
    steps.current?.focus();
  }, []);
  return (
    <div className="flex h-full flex-col">
      <div className="flex grow flex-col gap-3.5 overflow-y-auto p-3.5">
        <InputCard input={run.input} clamp />

        <div
          ref={steps}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          aria-atomic="false"
          className="wys-card flex flex-col px-3 py-1 outline-none focus-visible:ring-2 focus-visible:ring-accent-line"
        >
          {earlier.map((s, i) => (
            <StepRow key={i} done label={s} />
          ))}
          <StepRow active label={current} />
          {run.queries.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pb-2.5 pl-7">
              {run.queries.map((q) => (
                <span key={q} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2">
                  <Search size={11} /> {q}
                </span>
              ))}
            </div>
          )}
          {run.sources.length > 0 && (
            <div className="flex flex-col gap-1 pb-2.5 pl-7 text-[12px] text-ink-2">
              {run.sources.slice(0, 8).map((s) => (
                <span key={s.url} className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" /> {s.domain}
                </span>
              ))}
              {run.sources.length > 8 && <span>+{run.sources.length - 8} more</span>}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label>Assessment · streaming</Label>
          <Narrative text={run.text.split('```')[0] ?? ''} streaming />
          {!run.text && (
            <div className="mt-1 flex flex-col gap-2" aria-hidden="true">
              <div className="h-3 w-[94%] rounded-md bg-surface-2" />
              <div className="h-3 w-[82%] rounded-md bg-surface-2" />
              <div className="h-3 w-[58%] rounded-md bg-surface-2" />
            </div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line bg-paper px-3.5 py-2.5">
        <span className="min-w-0 max-w-[60%]">
          <ProviderBadge label={run.providerLabel} />
        </span>
        <Elapsed since={run.startedAt} />
        <span className="grow" />
        <button className="wys-btn h-9" onClick={onCancel}>
          <Close size={14} /> Cancel
        </button>
      </div>
    </div>
  );
}

function StepRow({ label, done, active }: { label: string; done?: boolean; active?: boolean }) {
  return (
    <div className="flex h-9 items-center gap-2.5">
      {done ? (
        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-ok-soft text-ok">
          <Check size={11} />
        </span>
      ) : active ? (
        <span className="wys-spin" />
      ) : (
        <span className="h-[18px] w-[18px] rounded-full border-2 border-line-2" />
      )}
      <span className={`text-[13px] ${active ? 'font-semibold text-ink' : 'text-ink-2'}`}>{label}</span>
    </div>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span className="text-[11px] text-ink-2">
      {String(Math.floor(s / 60)).padStart(2, '0')}:{String(s % 60).padStart(2, '0')}
    </span>
  );
}
