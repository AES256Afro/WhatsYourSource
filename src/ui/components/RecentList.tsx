import { useEffect, useState } from 'react';
import { listChecks, type StoredCheck } from '@/lib/history/db';
import { Label } from './common';
import { HistoryRow } from './HistoryRow';

/**
 * The calendar day a check belongs to, as History heads its groups: "Today", "Yesterday", "Wed 12 Nov"
 * (with the year when it is not this year). Calendar days, so DST changes don't shift the boundary.
 */
export function dayLabel(ts: number, now = new Date()): string {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (ts >= today.getTime()) return 'Today';
  if (ts >= y.getTime()) return 'Yesterday';
  const d = new Date(ts);
  return d.toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function RecentList({ onOpen, onSeeAll, refreshKey }: { onOpen: (id: string) => void; onSeeAll: () => void; refreshKey?: number }) {
  const [items, setItems] = useState<StoredCheck[]>([]);
  useEffect(() => {
    let alive = true;
    // A failed read leaves the list out; History says why when it is opened.
    listChecks({ limit: 3 }).then(
      (r) => alive && setItems(r),
      (e: unknown) => console.warn('[wys] could not read recent checks', e),
    );
    return () => {
      alive = false;
    };
  }, [refreshKey]);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <Label
        right={
          <button className="border-0 bg-transparent p-0 text-[12px] font-medium text-accent" onClick={onSeeAll}>
            See all
          </button>
        }
      >
        Recent
      </Label>
      {items.map((c, i) => {
        // The rows show a clock time only; a check from another day is headed by its day, so a
        // three-week-old verdict never reads as this afternoon's.
        const day = dayLabel(c.createdAt);
        const heading = day !== 'Today' && (i === 0 || dayLabel(items[i - 1]!.createdAt) !== day);
        return (
          <div key={c.id} className="flex flex-col gap-1">
            {heading && <span className="text-[11px] font-medium text-ink-2">{day}</span>}
            <HistoryRow check={c} onOpen={() => onOpen(c.id)} />
          </div>
        );
      })}
    </div>
  );
}
