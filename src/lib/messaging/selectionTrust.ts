import type { SelectionInfo } from './protocol';

/**
 * The browser's `selectionText` (context menu) is taken when the user right-clicks, so the page cannot
 * change it. The content script and the one-off frame reader read the live selection later, which a
 * page can swap, shrink or extend in between. Their reply is used only when it holds the same words.
 */

/** `selectionText` and the DOM's `toString()` differ only in whitespace (line breaks, runs of spaces). */
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Same words as the browser reported. Equality, not a prefix: a page can extend a selection past the user's text. */
export function sameSelection(menuText: string, candidate: string): boolean {
  const want = flat(menuText);
  return want.length > 0 && flat(candidate) === want;
}

/**
 * Of several frames' selections, the one to use. With the browser's text known, only a frame holding
 * those words; without it (the keyboard shortcut), the first frame that has a selection.
 */
export function pickFrameSelection(found: SelectionInfo[], menuText: string): SelectionInfo | null {
  if (flat(menuText)) return found.find((f) => sameSelection(menuText, f.text)) ?? null;
  return found[0] ?? null;
}
