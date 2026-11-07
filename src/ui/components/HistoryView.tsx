import { useEffect, useMemo, useRef, useState } from 'react';
import { clearHistory, exportAll, listChecks, storageStats, type StoredCheck } from '@/lib/history/db';
import { downloadText } from '@/lib/history/export';
import type { CheckInput } from '@/lib/messaging/protocol';
import { Label, Pill, toneForVerdict } from './common';
import { Camera, Globe, Image, Lines, Post } from './Icons';

type KindFilter = CheckInput['kind'] | 'all';
const PAGE = 100;

export function HistoryView({ onOpen, refreshKey }: { onOpen: (id: string) => void; refreshKey?: number }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [withSnapshot, setWithSnapshot] = useState(false);
  const [items, setItems] = useState<StoredCheck[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const filterSeq = useRef(0);
  const [stats, setStats] = useState<{ checks: number; snapshotBytes: number } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    filterSeq.current++;
    void listChecks({ query, kind, withSnapshot, limit: PAGE + 1 }).then((r) => {
      if (!alive) return;
      setHasMore(r.length > PAGE);
      setItems(r.slice(0, PAGE));
    });
    void storageStats().then((s) => alive && setStats(s));
    return () => {
      alive = false;
    };
  }, [query, kind, withSnapshot, tick, refreshKey]);

  const loadMore = async () => {
    const last = items?.[items.length - 1];
    if (!last || loadingMore) return;
    const seq = filterSeq.current; // the filters this request belongs to
    setLoadingMore(true);
    try {
      const r = await listChecks({ query, kind, withSnapshot, limit: PAGE + 1, before: last.createdAt });
      if (seq !== filterSeq.current) return; // filters changed meanwhile; the effect replaced the list
      setHasMore(r.length > PAGE);
      setItems((cur) => [...(cur ?? []), ...r.slice(0, PAGE)]);
    } finally {
      setLoadingMore(false);
    }
  };

  const groups = useMemo(() => groupByDay(items ?? []), [items]);

  const clearAll = async () => {
    if (!confirm('Delete all saved checks and page snapshots? This cannot be undone.')) return;
    await clearHistory();
    setTick((t) => t + 1);
  };
  const exportJson = async () => {
    const data = await exportAll();
    downloadText(JSON.stringify(data, null, 2), `whatsyoursource-history-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex grow flex-col gap-2.5 overflow-y-auto p-3.5">
        <div className="flex items-center gap-2">
          <h1 className="m-0 text-[18px] font-bold">History</h1>
          <span className="grow" />
          {stats && (
            <span className="text-[12px] text-ink-2">
              {stats.checks} {stats.checks === 1 ? 'check' : 'checks'}
            </span>
          )}
        </div>
        <label htmlFor="wys-hsearch" className="sr-only">
          Search history
        </label>
        <input id="wys-hsearch" type="search" className="wys-input" placeholder="Search checks…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['all', 'All'],
              ['text', 'Text'],
              ['image', 'Image'],
              ['post', 'Post'],
              ['page', 'Page'],
            ] as [KindFilter, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              className={`h-7 rounded-full border px-2.5 text-[12px] font-medium ${kind === k ? 'border-accent bg-accent-soft text-accent' : 'border-line-2 bg-paper text-ink-2'}`}
              onClick={() => setKind(k)}
            >
              {label}
            </button>
          ))}
          <button
            className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[12px] font-medium ${withSnapshot ? 'border-accent bg-accent-soft text-accent' : 'border-line-2 bg-paper text-ink-2'}`}
            onClick={() => setWithSnapshot((v) => !v)}
            aria-pressed={withSnapshot}
          >
            <Camera size={12} /> With snapshot
          </button>
        </div>

        {items === null ? (
          <div className="text-[13px] text-ink-2">Loading…</div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-2 p-4 text-center text-[13px] text-ink-2">
            {query || kind !== 'all' || withSnapshot ? 'Nothing matches.' : 'No checks yet. Highlight some text and press Check source.'}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="flex flex-col gap-1.5">
              <Label>{g.label}</Label>
              {g.items.map((c) => (
                <HistoryRow key={c.id} check={c} onOpen={() => onOpen(c.id)} />
              ))}
            </div>
          ))
        )}
        {hasMore && (
          <button className="wys-btn" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? 'Loading…' : 'Load older checks'}
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2.5 border-t border-line bg-paper px-3.5 py-2.5 text-[11px] text-ink-2">
        <span>Stored on this device{stats ? ` · ${fmtBytes(stats.snapshotBytes)}` : ''}</span>
        <span className="grow" />
        <button className="wys-btn h-8 px-3 text-[12px]" onClick={exportJson} disabled={!items?.length}>
          Export
        </button>
        <button className="wys-btn h-8 px-3 text-[12px] text-bad" onClick={clearAll} disabled={!items?.length}>
          Clear all
        </button>
      </div>
    </div>
  );
}

export function HistoryRow({ check: c, onOpen, compact }: { check: StoredCheck; onOpen: () => void; compact?: boolean }) {
  const Icon = c.kind === 'text' ? Lines : c.kind === 'image' ? Image : c.kind === 'post' ? Post : Globe;
  const time = new Date(c.createdAt);
  return (
    <button className={`wys-card flex items-start gap-2.5 px-2.5 py-[9px] text-left hover:bg-surface ${compact ? 'border-0 px-2' : ''}`} onClick={onOpen}>
      {!compact && (
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
          <Icon size={15} />
        </span>
      )}
      <span className="flex min-w-0 grow flex-col gap-[3px]">
        <span className="truncate text-[13px] leading-[17px] font-medium">{c.kind === 'text' ? `“${c.title}”` : c.title}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-ink-2">
          <Pill tone={toneForVerdict(c.verdictKind)} className="px-[7px] py-px">
            {c.verdictLabel}
          </Pill>
          <span className="truncate">
            {c.site} · {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {c.hasSnapshot && <Camera size={12} className="shrink-0" />}
        </span>
      </span>
    </button>
  );
}

function groupByDay(items: StoredCheck[]): { label: string; items: StoredCheck[] }[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const y = new Date(today);
  y.setDate(y.getDate() - 1); // calendar day, so DST changes don't shift the boundary
  const yesterday = y.getTime();
  const groups = new Map<string, StoredCheck[]>();
  for (const c of items) {
    const d = new Date(c.createdAt);
    const label =
      c.createdAt >= today.getTime()
        ? 'Today'
        : c.createdAt >= yesterday
          ? 'Yesterday'
          : d.toLocaleDateString([], {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
            });
    groups.set(label, [...(groups.get(label) ?? []), c]);
  }
  return Array.from(groups, ([label, items]) => ({ label, items }));
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
