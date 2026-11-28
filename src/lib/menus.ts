import {
  ASK_IDS,
  cleanCustomQuestion,
  cleanSavedQuestions,
  MAX_SAVED_QUESTIONS,
  normalizeAsk,
  type Ask,
  type AskId,
  type PresetAskId,
} from './pipeline/question';
import { truncate } from './util/url';

/**
 * The right-click menu: for each thing under the cursor (a selection, an image, a post, the page, a
 * link) one item per question, so the question is chosen in the same click as the content, then
 * the user's saved questions. Pure, with
 * no browser calls, so the list and the ids can be tested on their own.
 */
export const MENU_TARGETS = ['selection', 'image', 'post', 'page', 'link'] as const;
export type MenuTarget = (typeof MENU_TARGETS)[number];

/** The one item that is not a check in the panel: the selection, put to Google's own page. */
export const MENU_SELECTION_WEB = 'wys-selection-web';

export interface MenuItem {
  id: string;
  title?: string;
  type?: 'separator';
  /** Set on a saved question's row when two or more of them are grouped under "Your questions". */
  parentId?: string;
  contexts: ('selection' | 'image' | 'page' | 'link')[];
}

const CONTEXT: Record<MenuTarget, MenuItem['contexts'][number]> = {
  selection: 'selection',
  image: 'image',
  // Post and page only when nothing more specific (a selection, an image, a link) is under the cursor.
  post: 'page',
  page: 'page',
  link: 'link',
};

/** What each item is called, per question and target. The words after the verb name what will be checked. */
const NOUN: Record<MenuTarget, string> = {
  selection: 'selection',
  image: 'this image',
  post: 'this post',
  page: 'this article',
  link: 'linked page',
};
/** The same, after "about" in the group of saved questions ("Your questions about the selection"). */
const ABOUT: Record<MenuTarget, string> = {
  selection: 'the selection',
  image: 'this image',
  post: 'this post',
  page: 'this article',
  link: 'the linked page',
};
const TITLE: Record<PresetAskId, (noun: string) => string> = {
  factcheck: (n) => `Fact-check ${n}`,
  explain: (n) => `Explain ${n}`,
  summarize: (n) => `Summarize ${n === 'selection' ? 'the selection' : n}`,
  timeline: (n) => `Timeline behind ${n}`,
  flaws: (n) => `Find flaws and inaccuracies in ${n}`,
  sources: (n) => `Find more sources for ${n === 'selection' ? 'the selection' : n}`,
};

/** The presets each target offers, in display order. Summaries and more sources are for text, not images or bare links. */
export const MENU_PRESETS: Record<MenuTarget, readonly PresetAskId[]> = {
  selection: ['factcheck', 'explain', 'summarize', 'timeline', 'flaws', 'sources'],
  image: ['factcheck', 'explain', 'timeline', 'flaws'],
  post: ['factcheck', 'explain', 'summarize', 'timeline', 'flaws', 'sources'],
  page: ['factcheck', 'explain', 'summarize', 'timeline', 'flaws', 'sources'],
  link: ['factcheck', 'explain', 'timeline', 'flaws'],
};

/**
 * The user's own question, short enough for a menu row (cut without splitting an emoji). A menu
 * title treats `&` as an access-key marker (`&&` is a literal one) and replaces `%s` with the
 * selection, so both are neutralised: the row shows the words as typed.
 */
export function customTitle(custom: string, noun: string): string {
  const q = truncate(custom, 48).replaceAll('&', '&&').replaceAll('%s', '%⁠s');
  return `Ask about ${noun}: “${q}”`;
}

/** The raw `ask` object under the settings key (possibly absent or malformed). */
function storedAsk(stored: unknown): Record<string, unknown> {
  const ask = typeof stored === 'object' && stored !== null ? (stored as { ask?: unknown }).ask : undefined;
  return typeof ask === 'object' && ask !== null ? (ask as Record<string, unknown>) : {};
}

/** The custom question as stored under the settings key (raw storage value, possibly absent or malformed). */
export function storedCustomQuestion(stored: unknown): string {
  const custom = storedAsk(stored).custom;
  return cleanCustomQuestion(typeof custom === 'string' ? custom : undefined);
}

/**
 * The saved questions as stored under the settings key, read the way `mergeSettings` reads them: a
 * 1.2.x object (no `saved`) has its one custom question as the list.
 */
export function storedSavedQuestions(stored: unknown): string[] {
  const ask = storedAsk(stored);
  if (ask.saved === undefined) {
    const custom = storedCustomQuestion(stored);
    return custom ? [custom] : [];
  }
  return cleanSavedQuestions(ask.saved);
}

/** 1.2.x check on the single custom question; kept for its tests. The background uses `savedQuestionsChanged`. */
export function customQuestionChanged(change: { oldValue?: unknown; newValue?: unknown }, builtFrom: string | null): boolean {
  return storedCustomQuestion(change.newValue) !== (builtFrom ?? storedCustomQuestion(change.oldValue));
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((q, i) => q === b[i]);

/**
 * Whether the menu needs rebuilding: the saved questions (words or order) differ from the list the
 * menu was last built from, as the background recorded it in the settings database (so the answer
 * survives a worker wake). Unknown (`null`, never recorded) means rebuild.
 */
export function savedQuestionsChanged(saved: readonly string[], builtFrom: readonly string[] | null): boolean {
  return builtFrom === null || !sameList(saved, builtFrom);
}

/** A preset's item id (`wys-page:timeline`), or a saved question's by its place in the list (`wys-page:custom-2`). */
export function menuId(target: MenuTarget, ask: AskId, index = 0): string {
  return ask === 'custom' ? `wys-${target}:custom-${index}` : `wys-${target}:${ask}`;
}

/**
 * Which target and question a clicked item stands for; null for anything that is not one of ours
 * (the "Your questions" parents included). A saved question comes with its index.
 */
export function parseMenuId(id: string | number): { target: MenuTarget; askId: AskId; index?: number } | null {
  const m = /^wys-([a-z]+):([a-z]+)(?:-(\d))?$/.exec(String(id));
  if (!m) return null;
  const target = MENU_TARGETS.find((t) => t === m[1]);
  const askId = ASK_IDS.find((a) => a === m[2]);
  if (!target || !askId) return null;
  if (askId !== 'custom') return m[3] === undefined ? { target, askId } : null;
  // `wys-<target>:custom` is the 1.2.x id of the one custom question, still on screen until the menu is rebuilt.
  const index = m[3] === undefined ? 0 : Number(m[3]);
  return index < MAX_SAVED_QUESTIONS ? { target, askId, index } : null;
}

/**
 * The question a clicked item asks. A saved question is read from settings at click time, never
 * from the menu; null when the item names one that is no longer there (removed since the menu was
 * built), and the click is then ignored.
 */
export function askForMenu(askId: AskId, saved: readonly string[], index = 0): Ask | null {
  if (askId !== 'custom') return { id: askId };
  const custom = cleanCustomQuestion(saved[index]);
  return custom ? normalizeAsk({ id: 'custom', custom }) : null;
}

/**
 * Every menu item, in display order. `saved` is the user's own questions from Settings: one is a row
 * of its own on each target; two or more go under a "Your questions about …" item. `presets` says
 * which presets each target offers.
 */
export function menuItems(saved: readonly string[] | string | undefined, presets: Record<MenuTarget, readonly PresetAskId[]> = MENU_PRESETS): MenuItem[] {
  const own = cleanSavedQuestions(typeof saved === 'string' ? [saved] : (saved ?? []));
  const forTarget = (target: MenuTarget): MenuItem[] => {
    const contexts = [CONTEXT[target]];
    const items: MenuItem[] = presets[target].map((ask) => ({ id: menuId(target, ask), title: TITLE[ask](NOUN[target]), contexts }));
    if (own.length === 1) items.push({ id: menuId(target, 'custom', 0), title: customTitle(own[0]!, NOUN[target]), contexts });
    else if (own.length > 1) {
      const parentId = `wys-${target}:yours`;
      items.push({ id: parentId, title: `Your questions about ${ABOUT[target]}`, contexts });
      own.forEach((q, i) => items.push({ id: menuId(target, 'custom', i), title: customTitle(q, NOUN[target]), parentId, contexts }));
    }
    return items;
  };
  return [
    ...forTarget('selection'),
    { id: MENU_SELECTION_WEB, title: 'Open selection in Google AI Mode', contexts: ['selection'] },
    ...forTarget('image'),
    ...forTarget('post'),
    // Post and page share the menu; a line keeps the two groups apart.
    { id: 'wys-sep-page', type: 'separator', contexts: ['page'] },
    ...forTarget('page'),
    ...forTarget('link'),
  ];
}
