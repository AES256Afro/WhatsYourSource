import { ASK_PRESETS, cleanCustomQuestion, normalizeAsk, type Ask, type AskId, type PresetAskId } from './pipeline/question';

/**
 * The right-click menu: for each thing under the cursor (a selection, an image, a post, the page, a
 * link) one item per question, so the question is chosen in the same click as the content. Pure, with
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
  page: 'this page',
  link: 'linked page',
};
const TITLE: Record<PresetAskId, (noun: string) => string> = {
  factcheck: (n) => `Fact-check ${n}`,
  explain: (n) => `Explain ${n}`,
  timeline: (n) => `Timeline behind ${n}`,
  flaws: (n) => `Find flaws and inaccuracies in ${n}`,
};

/** The user's own question, short enough for a menu row. */
function customTitle(custom: string, noun: string): string {
  const q = custom.length > 48 ? `${custom.slice(0, 47).trimEnd()}…` : custom;
  return `Ask about ${noun}: “${q}”`;
}

export function menuId(target: MenuTarget, ask: AskId): string {
  return `wys-${target}:${ask}`;
}

/** Which target and question a clicked item stands for; null for anything that is not one of ours. */
export function parseMenuId(id: string | number): { target: MenuTarget; askId: AskId } | null {
  const m = /^wys-([a-z]+):([a-z]+)$/.exec(String(id));
  if (!m) return null;
  const target = MENU_TARGETS.find((t) => t === m[1]);
  const askId = ([...Object.keys(ASK_PRESETS), 'custom'] as AskId[]).find((a) => a === m[2]);
  return target && askId ? { target, askId } : null;
}

/** The question a clicked item asks. The custom one is read from settings at click time, never from the menu. */
export function askForMenu(askId: AskId, custom: string | undefined): Ask {
  return normalizeAsk(askId === 'custom' ? { id: 'custom', custom } : { id: askId });
}

/**
 * Every menu item, in display order. `custom` is the user's own question from Settings: when there
 * is one, each target also offers it.
 */
export function menuItems(custom: string | undefined): MenuItem[] {
  const own = cleanCustomQuestion(custom);
  const forTarget = (target: MenuTarget): MenuItem[] => [
    ...(Object.keys(ASK_PRESETS) as PresetAskId[]).map((ask) => ({
      id: menuId(target, ask),
      title: TITLE[ask](NOUN[target]),
      contexts: [CONTEXT[target]],
    })),
    ...(own ? [{ id: menuId(target, 'custom'), title: customTitle(own, NOUN[target]), contexts: [CONTEXT[target]] }] : []),
  ];
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
