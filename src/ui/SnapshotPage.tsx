import { useEffect, useMemo, useState } from 'react';
import { getCheck, getSnapshot, type StoredCheck, type StoredSnapshot } from '@/lib/history/db';
import { buildSnapshotSrcdoc } from '@/lib/history/snapshot';
import { Logo } from './components/Icons';
import { Toggle } from './components/settings/primitives';

/**
 * A saved page in its own tab. The HTML is rendered inside a sandboxed frame with its own CSP, so a
 * stored page never runs with the extension's origin (which a blob: URL would have given it).
 */
export function SnapshotPage() {
  const id = new URLSearchParams(location.search).get('id') ?? '';
  const [check, setCheck] = useState<StoredCheck | null | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<StoredSnapshot | null | undefined>(undefined);
  const [loadImages, setLoadImages] = useState(false);

  useEffect(() => {
    let alive = true;
    void getCheck(id).then((c) => alive && setCheck(c ?? null));
    void getSnapshot(id).then((s) => alive && setSnapshot(s ?? null));
    return () => {
      alive = false;
    };
  }, [id]);

  const srcdoc = useMemo(() => (snapshot ? buildSnapshotSrcdoc(snapshot, { loadImages }) : ''), [snapshot, loadImages]);

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Wraps instead of clipping: in a narrow window the image switch and its IP warning drop to a line of their own. */}
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-line bg-paper px-4 py-2">
        <Logo size={22} className="shrink-0 text-accent" />
        <span className="shrink-0 text-[14px] font-semibold tracking-tight whitespace-nowrap">Saved page</span>
        {check && (
          <span dir="auto" className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
            · {check.title}
          </span>
        )}
        {snapshot && (
          <label className="ml-auto flex items-center gap-2 text-[12px] text-ink-2">
            Load images from the web (reveals your IP to those hosts)
            <Toggle checked={loadImages} onChange={setLoadImages} />
          </label>
        )}
      </div>
      {snapshot === undefined ? (
        <div className="p-4 text-[13px] text-ink-2">Loading…</div>
      ) : snapshot === null ? (
        <div className="p-4 text-[13px] text-ink-2">
          No saved page for this check: the page couldn’t be read, saving was off, or it was removed to free space.
        </div>
      ) : (
        <iframe title="Saved page" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={srcdoc} className="h-full w-full grow border-0 bg-paper" />
      )}
    </div>
  );
}
