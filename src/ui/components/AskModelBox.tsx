import { useId, useState } from 'react';
import { MAX_DIRECT_QUESTION } from '@/lib/messaging/limits';

/**
 * A box on Home for asking the model a question directly, with nothing selected on a page.
 *
 * Props:
 * - `onAsk(text)`: called with the trimmed question (1..MAX_DIRECT_QUESTION characters) when the
 *   user presses Ask or Enter. The box empties itself after calling it.
 * - `disabledReason`: when set, the box and the button are disabled and this plain sentence is shown
 *   under them (for example "Set up a model in Settings to ask a question."). Unset: usable.
 *
 * HomeView starts the check with:
 *   start({ kind: 'text', text, pageUrl: '', pageTitle: '', question: true, ask: { id: 'custom', custom: text } })
 * `isDirectQuestion(input)` (from '@/lib/messaging/protocol') then recognises it everywhere else.
 */
export function AskModelBox({ onAsk, disabledReason }: { onAsk: (text: string) => void; disabledReason?: string }) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const disabled = !!disabledReason;
  const text = draft.trim();
  const submit = () => {
    if (disabled || !text) return;
    onAsk(text.slice(0, MAX_DIRECT_QUESTION));
    setDraft('');
  };
  // The count only matters once the cap is in sight.
  const showCount = draft.length >= MAX_DIRECT_QUESTION - 60;
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={id} className="wys-label">
        Ask a question
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id={id}
          className="wys-input min-h-[38px] min-w-0 grow resize-none py-2 text-[13px] leading-[20px]"
          rows={2}
          value={draft}
          maxLength={MAX_DIRECT_QUESTION}
          disabled={disabled}
          placeholder="Ask anything; the answer comes with sources"
          aria-describedby={disabled ? `${id}-why` : showCount ? `${id}-count` : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="submit" className="wys-btn wys-btn-primary shrink-0" disabled={disabled || !text}>
          Ask
        </button>
      </div>
      {disabled ? (
        <span id={`${id}-why`} className="text-[11px] leading-[15px] text-ink-2">
          {disabledReason}
        </span>
      ) : (
        showCount && (
          <span id={`${id}-count`} className="self-end text-[11px] leading-[15px] text-ink-2">
            {draft.length} / {MAX_DIRECT_QUESTION}
          </span>
        )
      )}
    </form>
  );
}
