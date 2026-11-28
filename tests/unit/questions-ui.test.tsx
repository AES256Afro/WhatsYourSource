import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '@/lib/storage/settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const wait = async (ms = 10, n = 6) => {
  for (let i = 0; i < n; i++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
};
/** Types into a React-controlled field the way a user would. */
const typeInto = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const button = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === text)!;

let root: Root;
let el: HTMLDivElement;
beforeEach(() => {
  fakeBrowser.reset();
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => {
  act(() => root.unmount());
  el.remove();
});

async function renderSettings(ask: Settings['ask']) {
  await saveSettings({ ...DEFAULT_SETTINGS, ask });
  const { SettingsView } = await import('@/ui/components/SettingsView');
  const { useSettings } = await import('@/ui/hooks/useSettings');
  function Harness() {
    const { settings, update } = useSettings();
    return settings ? <SettingsView settings={settings} update={update} /> : null;
  }
  await act(async () => root.render(<Harness />));
  await wait();
}

describe('Settings: your questions', () => {
  it('adds, edits and removes saved questions, and the default follows', async () => {
    await renderSettings({ default: 'custom', custom: 'Who pays?', saved: ['Who pays?'] });
    expect(el.textContent).toContain('Saved questions appear on the right-click menu and the Home picker.');
    expect(el.querySelector('[aria-label="Question 1"]')).not.toBeNull();
    expect(el.textContent).toContain('Default');

    // Add
    const input = el.querySelector<HTMLInputElement>('#wys-new-question')!;
    expect(el.querySelector('label[for="wys-new-question"]')?.textContent).toBe('New question');
    await act(async () => typeInto(input, '  Who gains?  '));
    await act(async () => button(el, 'Add').click());
    await wait();
    expect((await loadSettings()).ask.saved).toEqual(['Who pays?', 'Who gains?']);

    // The default select lists the presets and both questions
    const select = [...el.querySelectorAll('select')].find((s) => s.querySelector('option[value="saved-1"]'))!;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Fact-check',
      'Explain it',
      'Summarize',
      'Timeline',
      'Find the flaws',
      'Find more sources',
      'Who pays?',
      'Who gains?',
    ]);

    // Edit the default in place: the default follows
    const first = el.querySelector<HTMLInputElement>('[aria-label="Question 1"]')!;
    await act(async () => typeInto(first, 'Who really pays?'));
    await act(async () => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await wait();
    let s = await loadSettings();
    expect(s.ask).toEqual({ default: 'custom', custom: 'Who really pays?', saved: ['Who really pays?', 'Who gains?'] });

    // Remove the default: back to the fact-check, with an Undo
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Remove question 1: Who really pays?"]')!.click());
    await wait();
    s = await loadSettings();
    expect(s.ask).toEqual({ default: 'factcheck', custom: '', saved: ['Who gains?'] });
    expect(el.textContent).toContain('Removed “Who really pays?”');
    await act(async () => button(el, 'Undo').click());
    await wait();
    expect((await loadSettings()).ask).toEqual({ default: 'custom', custom: 'Who really pays?', saved: ['Who really pays?', 'Who gains?'] });
  });

  it('turns Add off at 8 questions, with a note', async () => {
    await renderSettings({ default: 'factcheck', custom: '', saved: Array.from({ length: 8 }, (_, i) => `Question ${i + 1}?`) });
    expect(el.querySelector<HTMLInputElement>('#wys-new-question')!.disabled).toBe(true);
    expect(button(el, 'Add').disabled).toBe(true);
    expect(el.textContent).toContain('You can keep up to 8 questions');
    expect(el.querySelectorAll('[aria-label^="Remove question"]')).toHaveLength(8);
  });

  it('an edit to empty words or to another saved question is undone', async () => {
    await renderSettings({ default: 'factcheck', custom: '', saved: ['A?', 'B?'] });
    const second = el.querySelector<HTMLInputElement>('[aria-label="Question 2"]')!;
    await act(async () => typeInto(second, 'A?'));
    await act(async () => second.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await wait();
    expect(second.value).toBe('B?');
    expect((await loadSettings()).ask.saved).toEqual(['A?', 'B?']);
  });
});

describe('Home picker: saved questions and "Save this question"', () => {
  it('lists the saved questions and offers to save typed words', async () => {
    const { AskPicker } = await import('@/ui/components/AskPicker');
    const saves: string[] = [];
    let selected: Parameters<typeof AskPicker>[0]['selected'] = { kind: 'own' };
    const render = (saved: string[]) =>
      root.render(
        <AskPicker selected={selected} saved={saved} own="" onSelect={(c) => (selected = c)} onOwn={() => undefined} onSave={(t) => void saves.push(t)} />,
      );
    await act(async () => render(['Who pays?']));
    const radios = [...el.querySelectorAll('[role="radio"]')].map((r) => r.textContent);
    expect(radios).toEqual(['Fact-check', 'Explain it', 'Summarize', 'Timeline', 'Find the flaws', 'Find more sources', 'Who pays?', 'Ask your own']);
    const box = el.querySelector('textarea')!;
    await act(async () => typeInto(box, 'Who wrote it?'));
    await act(async () => button(el, 'Save this question').click());
    expect(saves).toEqual(['Who wrote it?']);
    // Full list: the button is off and says why.
    await act(async () => render(Array.from({ length: 8 }, (_, i) => `Q${i}`)));
    expect(button(el, 'Save this question').disabled).toBe(true);
    expect(el.textContent).toContain('Remove one in Settings');
  });
});
