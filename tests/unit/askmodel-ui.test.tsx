import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredCheck } from '@/lib/history/db';
import { MAX_DIRECT_QUESTION, type CheckInput } from '@/lib/messaging/protocol';
import type { CheckResult } from '@/lib/pipeline/schema';
import { AskModelBox } from '@/ui/components/AskModelBox';
import { HistoryRow } from '@/ui/components/HistoryRow';
import { InputCard } from '@/ui/components/InputCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Q = 'Did the Eiffel Tower ever have a restaurant on the second floor?';
const direct: CheckInput = { kind: 'text', text: Q, pageUrl: '', pageTitle: '', question: true, ask: { id: 'custom', custom: Q } };
const pasted: CheckInput = { kind: 'text', text: 'The bridge opened in 1932.', pageUrl: '', pageTitle: '' };

let root: Root;
let el: HTMLDivElement;
beforeEach(() => {
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => {
  act(() => root.unmount());
  el.remove();
});

const render = (node: React.ReactNode) => act(() => root.render(node));
const textarea = () => el.querySelector('textarea')!;
const button = () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Ask')!;
/** Type into a React-controlled textarea. */
function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(textarea(), value);
    textarea().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const key = (k: string, init: KeyboardEventInit = {}) => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  act(() => void textarea().dispatchEvent(ev));
  return ev;
};

describe('AskModelBox', () => {
  it('Enter asks with the trimmed question and empties the box; Shift+Enter does not', () => {
    const onAsk = vi.fn();
    render(<AskModelBox onAsk={onAsk} />);
    expect(el.querySelector('label')?.textContent).toBe('Ask a question');
    expect(textarea().placeholder).toBe('Ask anything; the answer comes with sources');
    expect(button().disabled).toBe(true);
    type(`  ${Q}  `);
    expect(button().disabled).toBe(false);
    const shift = key('Enter', { shiftKey: true });
    expect(shift.defaultPrevented).toBe(false);
    expect(onAsk).not.toHaveBeenCalled();
    const enter = key('Enter');
    expect(enter.defaultPrevented).toBe(true);
    expect(onAsk).toHaveBeenCalledWith(Q);
    expect(textarea().value).toBe('');
  });

  it('Enter on an empty box does nothing; the Ask button submits', () => {
    const onAsk = vi.fn();
    render(<AskModelBox onAsk={onAsk} />);
    key('Enter');
    expect(onAsk).not.toHaveBeenCalled();
    type('Who built it?');
    act(() => button().click());
    expect(onAsk).toHaveBeenCalledWith('Who built it?');
  });

  it('shows the character count only near the cap', () => {
    render(<AskModelBox onAsk={() => undefined} />);
    expect(textarea().maxLength).toBe(MAX_DIRECT_QUESTION);
    type('short');
    expect(el.textContent).not.toContain(`/ ${MAX_DIRECT_QUESTION}`);
    type('x'.repeat(MAX_DIRECT_QUESTION - 10));
    expect(el.textContent).toContain(`${MAX_DIRECT_QUESTION - 10} / ${MAX_DIRECT_QUESTION}`);
  });

  it('is disabled with the reason shown when no provider is set up', () => {
    const onAsk = vi.fn();
    render(<AskModelBox onAsk={onAsk} disabledReason="Set up a model in Settings to ask a question." />);
    expect(textarea().disabled).toBe(true);
    expect(button().disabled).toBe(true);
    expect(el.textContent).toContain('Set up a model in Settings to ask a question.');
    key('Enter');
    expect(onAsk).not.toHaveBeenCalled();
  });
});

describe('labels for a direct question', () => {
  it('InputCard shows "Your question" with the question unquoted; pasted text keeps its label', () => {
    render(<InputCard input={direct} />);
    expect(el.textContent).toContain('Your question');
    expect(el.textContent).toContain(Q);
    expect(el.textContent).not.toContain(`“${Q}”`);
    expect(el.textContent).not.toContain('Checked text');
    render(<InputCard input={pasted} />);
    expect(el.textContent).toContain('Checked text');
    expect(el.textContent).toContain('“The bridge opened in 1932.”');
  });

  it('HistoryRow shows the question unquoted with a "Question" pill', () => {
    const result = {
      input: direct,
      verdict: { label: 'Well documented', kind: 'supported', confidence: 'high', summary: 'Le Jules Verne, since 1983.' },
    } as unknown as CheckResult;
    const check = {
      id: 'c',
      createdAt: Date.now(),
      kind: 'text',
      title: Q,
      site: '',
      verdictLabel: 'Well documented',
      verdictKind: 'supported',
      hasSnapshot: false,
      result,
    } as unknown as StoredCheck;
    render(<HistoryRow check={check} onOpen={() => undefined} />);
    expect(el.textContent).toContain(Q);
    expect(el.textContent).not.toContain(`“${Q}”`);
    expect(el.textContent).toContain('Question');
    expect(el.textContent).not.toContain('Your question');
  });
});
