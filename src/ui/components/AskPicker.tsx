import { useEffect, useId, useRef, useState } from 'react';
import { ASK_IDS, ASK_PRESETS, MAX_CUSTOM_QUESTION, askIdLabel, questionFor, type AskId, type AskKind } from '@/lib/pipeline/question';

/**
 * Picks the question a check asks: one of the presets or the user's own words. `selected` and
 * `custom` are what is shown; the owner decides what a change means (the next check on the home
 * screen, the default in Settings).
 */
export function AskPicker({
  selected,
  custom,
  onSelect,
  onCustom,
  kind = 'text',
}: {
  selected: AskId;
  custom: string;
  onSelect: (id: AskId) => void;
  /** The custom question as typed, a moment after the last keystroke and on blur. */
  onCustom: (text: string) => void;
  kind?: AskKind;
}) {
  const id = useId();
  // The draft is what is on screen; it is handed up shortly after typing stops, so a click on
  // "Check source" straight after typing asks what was typed.
  const [draft, setDraft] = useState(custom);
  const sent = useRef(custom);
  useEffect(() => {
    if (custom !== sent.current) {
      sent.current = custom;
      setDraft(custom);
    }
  }, [custom]);
  const commit = (text: string) => {
    if (text === sent.current) return;
    sent.current = text;
    onCustom(text);
  };
  useEffect(() => {
    const t = setTimeout(() => commit(draft), 300);
    return () => clearTimeout(t);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps -- only the draft restarts the timer

  const box = useRef<HTMLTextAreaElement>(null);
  // Picking "Ask your own" puts the cursor in its box. The box only exists once `selected` has
  // changed, which in Settings is after a storage round trip, so the focus waits for it.
  const focusWanted = useRef(false);
  useEffect(() => {
    if (selected === 'custom' && focusWanted.current) {
      focusWanted.current = false;
      box.current?.focus();
    }
  }, [selected]);
  const select = (next: AskId) => {
    focusWanted.current = next === 'custom';
    if (next !== selected) onSelect(next);
    else if (next === 'custom') box.current?.focus();
  };
  // Arrow keys move between the options, as in any radio group.
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    focusWanted.current = false; // arrowing through the options never jumps into the text box
    e.preventDefault();
    const next = ASK_IDS[(ASK_IDS.indexOf(selected) + step + ASK_IDS.length) % ASK_IDS.length]!;
    if (next !== selected) onSelect(next);
    document.getElementById(`${id}-${next}`)?.focus();
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div role="radiogroup" aria-label="Question to ask" className="flex flex-wrap gap-1.5" onKeyDown={onKey}>
        {ASK_IDS.map((a) => {
          const on = a === selected;
          return (
            <button
              key={a}
              id={`${id}-${a}`}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              className={`wys-btn h-8 px-2.5 text-[12px] ${on ? 'border-accent bg-accent-wash font-semibold text-accent' : ''}`}
              onClick={() => select(a)}
            >
              {askIdLabel(a)}
            </button>
          );
        })}
      </div>
      {selected === 'custom' ? (
        <>
          <label htmlFor={`${id}-custom`} className="wys-sr-only">
            Your question
          </label>
          <textarea
            ref={box}
            id={`${id}-custom`}
            className="wys-input h-16 resize-none py-2 text-[12px]"
            value={draft}
            maxLength={MAX_CUSTOM_QUESTION}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(draft)}
            placeholder="e.g. Who is behind this, and who pays for it?"
          />
          <span className="flex gap-2 text-[11px] leading-[15px] text-ink-2">
            <span className="grow">
              {draft.trim()
                ? 'Asked in your words. The answer still comes with a verdict and the original source.'
                : `Type a question. Until you do, checks use ${askIdLabel('factcheck')}.`}
            </span>
            <span className="shrink-0 tabular-nums">
              {draft.length}/{MAX_CUSTOM_QUESTION}
            </span>
          </span>
        </>
      ) : (
        <span className="text-[12px] leading-4 text-ink-2" title={`Asks: “${questionFor({ id: selected }, kind)}”`}>
          {ASK_PRESETS[selected].hint}.
        </span>
      )}
    </div>
  );
}
