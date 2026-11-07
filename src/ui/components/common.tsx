import type { ReactNode } from 'react';
import { type ClaimStatus, type Tone } from '@/lib/pipeline/schema';
import { Sparkle } from './Icons';

export { toneForVerdict, type Tone } from '@/lib/pipeline/schema';

export function toneForClaim(status: ClaimStatus): Tone {
  switch (status) {
    case 'supported':
      return 'ok';
    case 'disputed':
      return 'bad';
    case 'misleading':
      return 'warn';
    default:
      return 'muted';
  }
}

const TONE_PILL: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  muted: 'bg-muted-soft text-ink-2',
};

export function Pill({ tone, children, className = '' }: { tone: Tone; children: ReactNode; className?: string }) {
  return <span className={`wys-pill ${TONE_PILL[tone]} ${className}`}>{children}</span>;
}

/** Section heading: a real heading so screen readers can jump between Verdict, Claims, Sources. */
export function Label({ children, right, id }: { children: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <div className="flex items-center gap-2">
      <h2 id={id} className="wys-label m-0 whitespace-nowrap">
        {children}
      </h2>
      {right !== undefined && (
        <>
          <span className="grow" />
          {right}
        </>
      )}
    </div>
  );
}

export function Count({ n }: { n: number }) {
  return <span className="shrink-0 rounded-full bg-muted-soft px-[7px] text-[11px] font-semibold text-ink-2">{n}</span>;
}

export function ProviderBadge({ label }: { label: string }) {
  return (
    <span
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent"
      title={label}
    >
      <Sparkle size={11} className="shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

export function Cite({ id }: { id: number }) {
  return (
    <a href={`#src-${id}`} className="wys-cite" aria-label={`Source ${id}`}>
      {id}
    </a>
  );
}

/** A quiet text action at the right of a section label ("Open all", "See all", "Change"). */
export function TextAction({ children, onClick, href }: { children: ReactNode; onClick?: () => void; href?: string }) {
  const cls = 'inline-block border-0 bg-transparent px-0 py-1 text-[12px] font-medium text-accent no-underline hover:underline';
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {children}
    </a>
  ) : (
    <button type="button" className={cls} onClick={onClick}>
      {children}
    </button>
  );
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(ts).toLocaleDateString();
}

export function formatUsd(v: number | undefined): string | null {
  if (v === undefined) return null;
  if (v < 0.005) return '< $0.01';
  return `≈ $${v.toFixed(2)}`;
}
