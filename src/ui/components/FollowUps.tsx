import { useEffect, useId, useRef, useState } from 'react';
import { MAX_FOLLOW_UP_QUESTION } from '@/lib/pipeline/followUp';
import type { FollowUpThread } from '../hooks/useFollowUps';
import { Count, Label } from './common';
import { Narrative } from './Narrative';

/** The follow-up questions asked about a result, with their answers; the one in flight streams at the end. */
export function FollowUpList({ thread }: { thread: FollowUpThread }) {
  const { items, pending, error } = thread;
  const end = useRef<HTMLDivElement>(null);
  // A new question is asked from below the thread: bring its answer into view as it starts and when it lands.
  const active = pending?.question ?? null;
  const count = items.length;
  // Only an answer that arrived while this view was open is announced, not a thread loaded from history.
  const [countAtOpen] = useState(count);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [active, count, error]);
  if (!items.length && !pending && !error) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        Follow-up questions <Count n={items.length} />
      </Label>
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
        {items.map((f) => (
          <li key={f.id} className="wys-card flex flex-col gap-1.5 px-3 py-2.5">
            <span className="text-[13px] leading-[18px] font-semibold">{f.question}</span>
            <Narrative text={f.answer} />
            {f.sources.length > 0 && (
              <span className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] leading-4 text-ink-2">
                {f.sources.map((s) => (
                  <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="no-underline hover:underline" title={s.title}>
                    {s.domain || s.title} ↗
                  </a>
                ))}
              </span>
            )}
            <span className="text-[11px] text-ink-2">
              {f.provider.label} · {f.provider.model || '?'}
            </span>
          </li>
        ))}
        {pending && (
          <li className="wys-card flex flex-col gap-1.5 px-3 py-2.5">
            <span className="text-[13px] leading-[18px] font-semibold">{pending.question}</span>
            {pending.text ? <Narrative text={pending.text} streaming /> : <span className="text-[12px] text-ink-2">{pending.status || 'Asking…'}</span>}
          </li>
        )}
      </ol>
      <div role="status" aria-live="polite" className="wys-sr-only">
        {pending ? 'Answering your follow-up question' : count > countAtOpen ? 'Follow-up answered' : ''}
      </div>
      {error && (
        <p role="alert" className="m-0 rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-[12px] leading-4 text-warn-ink">
          The follow-up was not answered. {error}
        </p>
      )}
      <div ref={end} />
    </div>
  );
}

/** The box a follow-up is typed into. Enter sends; Shift+Enter starts a new line. */
export function FollowUpBox({ thread, onSettings }: { thread: FollowUpThread; onSettings?: () => void }) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const busy = !!thread.pending;
  const usable = !!thread.providerLabel;
  const send = async () => {
    const q = draft.trim();
    if (!q || busy || !usable) return;
    setDraft('');
    const ok = await thread.ask(q);
    // A question that got no answer goes back into the box, unless something new was typed meanwhile.
    if (!ok) setDraft((cur) => cur || q);
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-end gap-2">
        <label htmlFor={id} className="wys-sr-only">
          Ask a follow-up question
        </label>
        <textarea
          id={id}
          className="wys-input h-[38px] min-w-0 grow resize-none py-2 text-[13px] leading-[20px]"
          rows={1}
          value={draft}
          maxLength={MAX_FOLLOW_UP_QUESTION}
          disabled={!usable}
          placeholder={usable ? 'Ask a follow-up question…' : 'Set up a model to ask follow-up questions'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {busy ? (
          <button type="button" className="wys-btn shrink-0" onClick={thread.stop}>
            Stop
          </button>
        ) : usable || !onSettings ? (
          <button type="button" className="wys-btn wys-btn-primary shrink-0" disabled={!usable || !draft.trim()} onClick={() => void send()}>
            Ask
          </button>
        ) : (
          <button type="button" className="wys-btn shrink-0" onClick={onSettings}>
            Settings
          </button>
        )}
      </div>
      {thread.providerLabel && <span className="text-[11px] leading-[15px] text-ink-2">Answered by {thread.providerLabel}, with this result as context.</span>}
    </div>
  );
}
