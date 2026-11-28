import type { StoredCheck } from '@/lib/history/db';
import { isDirectQuestion } from '@/lib/messaging/limits';
import { askLabel, normalizeAsk } from '@/lib/pipeline/question';
import { Pill, toneForVerdict } from './common';
import { Camera, Globe, Image, Lines, Post, Search } from './Icons';

/** One saved check in a list. Its own module so the home screen's recent list does not pull in the History view. */
export function HistoryRow({ check: c, onOpen, compact }: { check: StoredCheck; onOpen: () => void; compact?: boolean }) {
  // A question the user asked directly is not quoted text from somewhere: no quote marks, its own pill.
  const question = isDirectQuestion(c.result.input);
  const Icon = question ? Search : c.kind === 'text' ? Lines : c.kind === 'image' ? Image : c.kind === 'post' ? Post : Globe;
  const time = new Date(c.createdAt);
  // Two checks of the same text differ by what was asked; a fact-check is the unmarked case.
  const asked = question ? 'Question' : normalizeAsk(c.result.input.ask).id === 'factcheck' ? '' : askLabel(c.result.input.ask);
  return (
    <button className={`wys-card flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-surface ${compact ? 'border-0 px-2' : ''}`} onClick={onOpen}>
      {!compact && (
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
          <Icon size={15} />
        </span>
      )}
      <span className="flex min-w-0 grow flex-col gap-[3px]">
        <span className="truncate text-[13px] leading-[18px] font-medium">{c.kind === 'text' && !question ? `“${c.title}”` : c.title}</span>
        {!compact && c.result.verdict.summary && <span className="line-clamp-1 text-[12px] leading-4 text-ink-2">{c.result.verdict.summary}</span>}
        <span className="flex items-center gap-1.5 text-[11px] text-ink-2">
          <Pill tone={toneForVerdict(c.verdictKind)} className="px-[7px] py-px">
            {c.verdictLabel}
          </Pill>
          {asked && <span className="wys-pill shrink-0 border border-line-strong px-[7px] py-px text-ink-2">{asked}</span>}
          <span className="truncate">{[time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), c.site].filter(Boolean).join(' · ')}</span>
          {c.hasSnapshot && (
            <>
              <Camera size={12} className="shrink-0" />
              <span className="wys-sr-only">Has a saved page</span>
            </>
          )}
        </span>
      </span>
    </button>
  );
}
