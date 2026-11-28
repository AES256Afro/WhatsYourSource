import { useEffect, useId, useRef, useState } from 'react';
import {
  ASK_PRESETS,
  cleanCustomQuestion,
  CUSTOM_ASK_BUTTON,
  MAX_CUSTOM_QUESTION,
  MAX_SAVED_QUESTIONS,
  PRESET_ASK_IDS,
  askIdLabel,
  questionFor,
  type AskKind,
  type PresetAskId,
} from '@/lib/pipeline/question';

/** One option in the picker: a preset, one of the saved questions (by its words), or "Ask your own". */
export type AskChoice = { kind: 'preset'; id: PresetAskId } | { kind: 'saved'; text: string } | { kind: 'own' };

/** The option's key in the radio group: the preset id, `saved-<index>`, or `own`. */
function keyOf(choice: AskChoice, saved: readonly string[]): string {
  if (choice.kind === 'preset') return choice.id;
  if (choice.kind === 'saved') {
    const i = saved.indexOf(choice.text);
    return i >= 0 ? `saved-${i}` : 'own';
  }
  return 'own';
}

function choiceOf(key: string, saved: readonly string[]): AskChoice {
  if (key.startsWith('saved-')) return { kind: 'saved', text: saved[Number(key.slice(6))] ?? '' };
  if (key === 'own') return { kind: 'own' };
  return { kind: 'preset', id: key as PresetAskId };
}

/**
 * Picks the question a check asks: a preset, one of the user's saved questions, or new words typed
 * under "Ask your own". The owner decides what a choice means (the next check on the home screen).
 */
export function AskPicker({
  selected,
  saved,
  own,
  onSelect,
  onOwn,
  onSave,
  kind = 'text',
}: {
  selected: AskChoice;
  saved: readonly string[];
  /** The words under "Ask your own". */
  own: string;
  onSelect: (choice: AskChoice) => void;
  /** The words under "Ask your own" as typed, a moment after the last keystroke and on blur. */
  onOwn: (text: string) => void;
  /** When given, typed words can be kept as a saved question ("Save this question"). */
  onSave?: (text: string) => void;
  kind?: AskKind;
}) {
  const id = useId();
  // The draft is what is on screen; it is handed up shortly after typing stops, so a click on
  // "Check source" straight after typing asks what was typed.
  const [draft, setDraft] = useState(own);
  const sent = useRef(own);
  useEffect(() => {
    if (own !== sent.current) {
      sent.current = own;
      setDraft(own);
    }
  }, [own]);
  const commit = (text: string) => {
    if (text === sent.current) return;
    sent.current = text;
    onOwn(text);
  };
  useEffect(() => {
    const t = setTimeout(() => commit(draft), 300);
    return () => clearTimeout(t);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps -- only the draft restarts the timer

  const keys = [...PRESET_ASK_IDS, ...saved.map((_, i) => `saved-${i}`), 'own'];
  const current = keyOf(selected, saved);

  const box = useRef<HTMLTextAreaElement>(null);
  // Picking "Ask your own" puts the cursor in its box, once the box exists.
  const focusWanted = useRef(false);
  useEffect(() => {
    if (current === 'own' && focusWanted.current) {
      focusWanted.current = false;
      box.current?.focus();
    }
  }, [current]);
  const select = (key: string) => {
    focusWanted.current = key === 'own';
    if (key !== current) onSelect(choiceOf(key, saved));
    else if (key === 'own') box.current?.focus();
  };
  // Arrow keys move between the options, as in any radio group.
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step || (e.target as HTMLElement).getAttribute('role') !== 'radio') return;
    focusWanted.current = false; // arrowing through the options never jumps into the text box
    e.preventDefault();
    const next = keys[(keys.indexOf(current) + step + keys.length) % keys.length]!;
    if (next !== current) onSelect(choiceOf(next, saved));
    document.getElementById(`${id}-${next}`)?.focus();
  };

  const typed = cleanCustomQuestion(draft);
  const alreadySaved = !!typed && saved.includes(typed);
  const full = saved.length >= MAX_SAVED_QUESTIONS;

  return (
    <div className="flex flex-col gap-1.5">
      <div role="radiogroup" aria-label="Question to ask" className="flex flex-wrap gap-1.5" onKeyDown={onKey}>
        {keys.map((k) => {
          const on = k === current;
          const isSaved = k.startsWith('saved-');
          const text = isSaved ? (saved[Number(k.slice(6))] ?? '') : k === 'own' ? CUSTOM_ASK_BUTTON : askIdLabel(k as PresetAskId);
          return (
            <button
              key={k}
              id={`${id}-${k}`}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              title={isSaved ? text : undefined}
              className={`wys-btn h-8 min-w-0 px-2.5 text-[12px] ${isSaved ? 'max-w-full' : ''} ${on ? 'border-accent bg-accent-wash font-semibold text-accent' : ''}`}
              onClick={() => select(k)}
            >
              {isSaved ? <span className="block max-w-[220px] truncate">{text}</span> : text}
            </button>
          );
        })}
      </div>
      {current === 'own' ? (
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
          {onSave && typed && !alreadySaved && (
            <span className="flex flex-wrap items-center gap-2 text-[11px] leading-[15px] text-ink-2">
              <button
                type="button"
                className="wys-btn h-7 px-2 text-[12px]"
                disabled={full}
                onClick={() => {
                  commit(draft);
                  onSave(typed);
                }}
              >
                Save this question
              </button>
              <span>
                {full
                  ? `You have ${MAX_SAVED_QUESTIONS} saved questions, the most there can be. Remove one in Settings to save this one.`
                  : 'Saved questions appear on the right-click menu and here.'}
              </span>
            </span>
          )}
        </>
      ) : selected.kind === 'saved' ? (
        <span className="text-[12px] leading-4 text-ink-2 wrap-anywhere">Asks your saved question: “{selected.text}”</span>
      ) : selected.kind === 'preset' ? (
        <span className="text-[12px] leading-4 text-ink-2" title={`Asks: “${questionFor({ id: selected.id }, kind)}”`}>
          {ASK_PRESETS[selected.id].hint}.
        </span>
      ) : null}
    </div>
  );
}
