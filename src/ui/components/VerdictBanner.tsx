import { forwardRef } from 'react';
import type { CheckResult } from '@/lib/pipeline/schema';
import { toneForVerdict, type Tone } from './common';
import { Alert, Check, Clock, Info } from './Icons';

/** Box and ring borders come from tokens so dark mode gets its own values. */
const STYLES: Record<Tone, { box: string; title: string; text: string; ring: string }> = {
  ok: { box: 'bg-ok-soft border-ok-line', title: 'text-ok', text: 'text-ok', ring: 'border-ok-line text-ok' },
  warn: { box: 'bg-warn-soft border-warn-line', title: 'text-warn', text: 'text-warn-ink', ring: 'border-warn-line text-warn' },
  bad: { box: 'bg-bad-soft border-bad-line', title: 'text-bad', text: 'text-bad-ink', ring: 'border-bad-line text-bad' },
  muted: { box: 'bg-surface-2 border-line-2', title: 'text-ink', text: 'text-ink-2', ring: 'border-line-strong text-ink-2' },
};

const CONFIDENCE = { high: 'High', medium: 'Medium', low: 'Low' } as const;

/** The first thing on a result. Focusable so the panel can move the keyboard user here when a check finishes. */
export const VerdictBanner = forwardRef<HTMLDivElement, { verdict: CheckResult['verdict'] }>(function VerdictBanner({ verdict }, ref) {
  const tone = toneForVerdict(verdict.kind);
  const s = STYLES[tone];
  const Icon = tone === 'ok' ? Check : verdict.kind === 'older-than-claimed' ? Clock : tone === 'muted' ? Info : Alert;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className={`flex gap-2.5 rounded-xl border p-3 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper ${s.box}`}
    >
      <Icon size={20} className={`mt-px shrink-0 ${s.title}`} />
      <div className="flex min-w-0 grow flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 className={`m-0 text-[16px] leading-[20px] font-semibold ${s.title}`}>{verdict.label}</h2>
          <span className="grow" />
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${s.ring}`}>
            {CONFIDENCE[verdict.confidence]} confidence
          </span>
        </div>
        {verdict.summary && <p className={`wys-measure m-0 text-[13px] leading-[18px] ${s.text}`}>{verdict.summary}</p>}
      </div>
    </div>
  );
});
