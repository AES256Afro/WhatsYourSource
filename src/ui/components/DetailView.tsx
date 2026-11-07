import { useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { deleteCheck, getCheck, getSnapshot, setNote, type StoredCheck, type StoredSnapshot } from '@/lib/history/db';
import { checkToStandaloneHtml, downloadText, safeFilename } from '@/lib/history/export';
import { buildSnapshotSrcdoc } from '@/lib/history/snapshot';
import type { CheckInput } from '@/lib/messaging/protocol';
import { Label, Pill, toneForVerdict } from './common';
import { Camera, Download, External, Refresh, Trash } from './Icons';
import { ResultView } from './ResultView';
import { Toggle } from './settings/primitives';

type Tab = 'result' | 'page';
const TABS: { id: Tab; label: string; icon?: React.ReactNode }[] = [
  { id: 'result', label: 'Result' },
  { id: 'page', label: 'Saved page', icon: <Camera size={13} /> },
];

export function DetailView({ id, onRecheck, onDeleted }: { id: string; onRecheck: (input: CheckInput) => void; onDeleted: () => void }) {
  const [check, setCheck] = useState<StoredCheck | null | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<StoredSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>('result');
  const [loadImages, setLoadImages] = useState(false);
  const [note, setNoteText] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let alive = true;
    void getCheck(id).then((c) => {
      if (!alive) return;
      setCheck(c ?? null);
      setNoteText(c?.note ?? '');
      // Focus the title once loaded, so keyboard users don't land on <body> after opening a row.
      setTimeout(() => title.current?.focus(), 0);
    });
    void getSnapshot(id).then((s) => alive && setSnapshot(s ?? null));
    return () => {
      alive = false;
    };
  }, [id]);

  const srcdoc = useMemo(() => (snapshot ? buildSnapshotSrcdoc(snapshot, { loadImages }) : ''), [snapshot, loadImages]);

  if (check === undefined) return <div className="p-3.5 text-[13px] text-ink-2">Loading…</div>;
  if (check === null) return <div className="p-3.5 text-[13px] text-ink-2">This check was deleted.</div>;

  const openSnapshotTab = () => {
    void browser.tabs.create({ url: `${browser.runtime.getURL('/snapshot.html')}?id=${encodeURIComponent(check.id)}` });
  };
  const guard = (label: string, fn: () => Promise<void> | void) => async () => {
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const exportHtml = guard('Export', () =>
    downloadText(checkToStandaloneHtml(check, snapshot), `${safeFilename(check.verdictLabel + ' ' + check.title)}.html`),
  );
  const remove = guard('Delete', async () => {
    if (!confirm('Delete this check and its saved page?')) return;
    await deleteCheck(check.id);
    onDeleted();
  });
  const saveNote = guard('Saving the note', async () => {
    if (note === check.note) return;
    await setNote(check.id, note);
    setCheck({ ...check, note });
  });
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!;
    setTab(next.id);
    document.getElementById(`wys-tab-${next.id}`)?.focus();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 px-3.5 pt-3.5">
        <div className="flex items-center gap-2">
          <Pill tone={toneForVerdict(check.verdictKind)}>{check.verdictLabel}</Pill>
          <span className="text-[12px] text-ink-2">Checked {new Date(check.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
        </div>
        <h1 ref={title} tabIndex={-1} className="m-0 line-clamp-2 text-[14px] leading-[18px] font-semibold outline-none">
          {check.kind === 'text' ? `“${check.title}”` : check.title}
        </h1>
        <div role="tablist" aria-label="Saved check sections" className="mt-1 flex border-b border-line" onKeyDown={onTabKey}>
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`wys-tab-${t.id}`}
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`wys-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className={`inline-flex h-9 items-center gap-1.5 border-0 border-b-2 bg-transparent px-3 text-[13px] ${tab === t.id ? 'border-accent font-semibold text-accent' : 'border-transparent font-medium text-ink-2'}`}
              onClick={() => setTab(t.id)}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 grow overflow-y-auto" role="tabpanel" id={`wys-panel-${tab}`}>
        {tab === 'result' && (
          <>
            <ResultView
              result={check.result}
              onRecheck={() => onRecheck(check.result.input)}
              saved
              snapshotNote={check.hasSnapshot ? 'Saved with page snapshot' : 'Saved'}
              embedded
            />
            <div className="flex flex-col gap-1.5 px-3.5 pb-3.5">
              <Label>Your note</Label>
              <label htmlFor="wys-note" className="wys-sr-only">
                Your note
              </label>
              <textarea
                id="wys-note"
                className="wys-input h-16 resize-none py-2"
                placeholder="Add a note for later…"
                value={note}
                onChange={(e) => setNoteText(e.target.value)}
                onBlur={() => void saveNote()}
              />
            </div>
          </>
        )}
        {tab === 'page' && (
          <div className="flex flex-col gap-2.5 p-3.5">
            {snapshot ? (
              <>
                <div className="wys-card flex items-start gap-2.5 bg-surface px-3 py-2.5">
                  <div className="flex min-w-0 grow flex-col gap-[3px]">
                    <span className="truncate text-[13px] font-medium">{snapshot.title || snapshot.url}</span>
                    <span className="text-[11px] text-ink-2">
                      Captured when you checked · {Math.round(snapshot.bytes / 1024)} KB{snapshot.highlight ? ' · your highlight is marked' : ''}
                    </span>
                    <div className="mt-[3px] flex gap-3.5">
                      <a
                        href={snapshot.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[12px] font-semibold no-underline"
                      >
                        Open live page <External size={12} />
                      </a>
                      <button className="border-0 bg-transparent p-0 text-[12px] font-semibold text-accent" onClick={openSnapshotTab}>
                        Open snapshot in a tab
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[12px] text-ink-2">
                  <span id="wys-loadimages">Load images from the web (reveals your IP to those hosts)</span>
                  <span className="grow" />
                  <Toggle checked={loadImages} onChange={setLoadImages} labelledBy="wys-loadimages" />
                </div>
                {snapshot.screenshot && <Screenshot blob={snapshot.screenshot} />}
                <iframe
                  title="Saved page"
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  srcDoc={srcdoc}
                  className="h-[520px] w-full rounded-lg border border-line-2 bg-paper"
                />
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-line-strong p-4 text-center text-[13px] text-ink-2">
                No saved page for this check: the page couldn’t be read, saving was off, or it was removed to free space.
              </div>
            )}
            <div className="wys-card flex items-center gap-2.5 px-3 py-2.5">
              <Refresh size={16} className="shrink-0 text-ink-2" />
              <span className="grow text-[12px] leading-4 text-ink-2">Sources may have changed since this check.</span>
              <button className="wys-btn h-8 px-3 text-[12px]" onClick={() => onRecheck(check.result.input)}>
                Re-check now
              </button>
            </div>
          </div>
        )}
      </div>

      {actionError && (
        <p role="alert" className="m-0 border-t border-line px-3.5 py-1.5 text-[11px] text-bad">
          {actionError}
        </p>
      )}
      <div className="flex shrink-0 gap-2 border-t border-line bg-paper px-3.5 py-2.5">
        <button className="wys-btn wys-btn-narrow grow" onClick={() => void exportHtml()} aria-label="Export this check as an HTML file">
          <Download size={15} /> <span className="wys-btn-label">Export HTML</span>
        </button>
        <button className="wys-btn wys-btn-narrow grow" onClick={() => onRecheck(check.result.input)} aria-label="Re-check">
          <Refresh size={15} /> <span className="wys-btn-label">Re-check</span>
        </button>
        <button className="wys-btn w-11 shrink-0 px-0 text-bad" aria-label="Delete this check" onClick={() => void remove()}>
          <Trash size={16} />
        </button>
      </div>
    </div>
  );
}

function Screenshot({ blob }: { blob: Blob }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <details className="wys-card overflow-hidden">
      <summary className="cursor-pointer px-3 py-2 text-[12px] font-medium text-ink-2">Screenshot of the visible area at check time</summary>
      <img src={url} alt="Screenshot of the page as it looked when checked" className="block w-full" />
    </details>
  );
}
