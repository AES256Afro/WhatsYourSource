import type { CheckResult } from '@/lib/pipeline/schema';
import { toneForVerdict, type Tone } from './common';
import { Alert, Check, Clock } from './Icons';

const STYLES: Record<Tone, { box: string; title: string; text: string; ring: string }> = {
  ok: { box: 'bg-ok-soft border-[#9BD6B0]', title: 'text-ok', text: 'text-ok', ring: 'border-[#6FBF8C] text-ok' },
  warn: { box: 'bg-warn-soft border-warn-line', title: 'text-warn', text: 'text-warn-ink', ring: 'border-[#E0B94A] text-warn' },
  bad: { box: 'bg-bad-soft border-bad-line', title: 'text-bad', text: 'text-bad-ink', ring: 'border-[#E39A9A] text-bad' },
  muted: { box: 'bg-surface-2 border-line-2', title: 'text-ink', text: 'text-ink-2', ring: 'border-line-2 text-ink-2' },
};

export function VerdictBanner({ verdict }: { verdict: CheckResult['verdict'] }) {
  const tone = toneForVerdict(verdict.kind);
  const s = STYLES[tone];
  const Icon = tone === 'ok' ? Check : verdict.kind === 'older-than-claimed' ? Clock : Alert;
  return (
    <div className={`flex gap-2.5 rounded-xl border p-3 ${s.box}`}>
      <Icon size={20} className={`mt-px shrink-0 ${s.title}`} />
      <div className="flex min-w-0 grow flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className={`text-[16px] font-bold ${s.title}`}>{verdict.label}</span>
          <span className="grow" />
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${s.ring}`}>
            {verdict.confidence === 'high' ? 'High' : verdict.confidence === 'low' ? 'Low' : 'Medium'} confidence
          </span>
        </div>
        {verdict.summary && <span className={`text-[13px] leading-[18px] ${s.text}`}>{verdict.summary}</span>}
      </div>
    </div>
  );
}
