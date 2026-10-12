import { useEffect, useState } from 'react';
import { listChecks, type StoredCheck } from '@/lib/history/db';
import { Label } from './common';
import { HistoryRow } from './HistoryView';

export function RecentList({ onOpen, onSeeAll, refreshKey }: { onOpen: (id: string) => void; onSeeAll: () => void; refreshKey?: number }) {
  const [items, setItems] = useState<StoredCheck[]>([]);
  useEffect(() => {
    let alive = true;
    void listChecks({ limit: 3 }).then((r) => alive && setItems(r));
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
      {items.map((c) => (
        <HistoryRow key={c.id} check={c} onOpen={() => onOpen(c.id)} />
      ))}
    </div>
  );
}
