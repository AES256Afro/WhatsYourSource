import type { ReactNode } from 'react';
import type { ClaimStatus, VerdictKind } from '@/lib/pipeline/schema';
import { Sparkle } from './Icons';

export type Tone = 'ok' | 'warn' | 'bad' | 'muted';

export function toneForVerdict(kind: VerdictKind): Tone {
  switch (kind) {
    case 'supported':
    case 'authentic':
      return 'ok';
    case 'disputed':
    case 'ai-generated':
      return 'bad';
    case 'misleading':
    case 'misattributed':
    case 'older-than-claimed':
    case 'mixed':
    case 'satire':
      return 'warn';
    default:
      return 'muted';
  }
}

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

export function Label({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="wys-label">{children}</span>
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
  return <span className="rounded-full bg-muted-soft px-[7px] text-[11px] font-semibold text-ink-2">{n}</span>;
}

export function ProviderBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
      <Sparkle size={11} />
      {label}
    </span>
  );
}

export function Cite({ id }: { id: number }) {
  return (
    <a href={`#src-${id}`} className="wys-cite">
      {id}
    </a>
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
