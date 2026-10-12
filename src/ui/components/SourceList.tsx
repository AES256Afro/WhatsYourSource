import type { Source } from '@/lib/pipeline/schema';
import { Count, Label } from './common';
import { External } from './Icons';

export function SourceList({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return null;
  const openAll = () => {
    for (const s of sources.filter((x) => x.verified)) window.open(s.url, '_blank', 'noopener');
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Label
        right={
          sources.some((s) => s.verified) && (
            <button className="border-0 bg-transparent p-0 text-[12px] font-medium text-accent" onClick={openAll}>
              Open all
            </button>
          )
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
  const inner = (
    <>
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-accent-soft text-[11px] font-bold text-accent">
        {s.id}
      </span>
      <span className="flex min-w-0 grow flex-col gap-px">
        <span className="truncate text-[13px] leading-[17px] font-medium text-ink">{s.title || s.domain}</span>
        <span className="text-[12px] text-ink-2">
          {s.domain}
          {s.date ? ` · ${s.date}` : ''}
          {!s.verified && <span className="ml-1.5 rounded bg-surface-2 px-1 text-[10px] font-semibold text-ink-3">cited by model · link unverified</span>}
        </span>
      </span>
      {s.verified && <External size={14} className="mt-[3px] shrink-0 text-ink-3" />}
    </>
  );
  const cls = `flex items-start gap-2.5 rounded-[10px] border px-2.5 py-[9px] no-underline ${
    s.verified ? 'border-line bg-paper hover:bg-surface' : 'border-dashed border-line-2 bg-paper'
  }`;
  return s.verified ? (
    <a id={`src-${s.id}`} href={s.url} target="_blank" rel="noopener noreferrer" className={cls}>
      {inner}
    </a>
  ) : (
    <div id={`src-${s.id}`} className={cls} title={s.url}>
      {inner}
    </div>
  );
}
