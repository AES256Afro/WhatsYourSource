import { defineContentScript } from '#imports';
import { browser } from 'wxt/browser';
import { clampSelection, INLINE_IMAGE_SENTINEL, LIMITS } from '@/lib/messaging/limits';
import type { SelectionInfo } from '@/lib/messaging/protocol';
import { extractPost } from '@/lib/post/extract';
import { shortcutLabelForPlatform } from '@/lib/shortcut';
import { pageTriggerTarget, readPublicSettings, SETTINGS_KEY, SHORTCUT_KEY, type PublicSettings } from '@/lib/storage/publicSettings';

/**
 * Runs on every page, does three small things and nothing else:
 *  1. shows a floating "Check source" chip when text is selected (if enabled),
 *  2. answers "what is selected?" for the background/popup,
 *  3. extracts the post under the cursor for the right-click "… this post" items.
 * Page snapshots for history are a separate script (`snapshot-capture.ts`) injected only when a
 * check runs, so Readability and DOMPurify never load on pages that are merely being read.
 * Nothing is sent anywhere until the user clicks.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  // WXT's default announces the script to the page with window.postMessage (extension id included):
  // any site could read it. Nothing here needs it.
  noScriptStartedPostMessage: true,
  main(ctx) {
    // XML, SVG and other non-HTML documents: no chip (attachShadow throws there) and nothing to snapshot.
    if (!(document instanceof HTMLDocument) || document.contentType === 'application/xml' || document.contentType === 'text/xml') return;
    // Only the public half of the settings (no API keys) is read here. (storage.onChanged still
    // delivers every change to this isolated world; the `secrets` key is ignored, never kept.)
    let settings: PublicSettings = readPublicSettings(undefined);
    // The live key binding, as the background last read it (users rebind or remove it); null = unknown, '' = unbound.
    let binding: string | null = null;
    void browser.storage.local.get([SETTINGS_KEY, SHORTCUT_KEY]).then((r) => {
      settings = readPublicSettings(r[SETTINGS_KEY]);
      if (typeof r[SHORTCUT_KEY] === 'string') binding = r[SHORTCUT_KEY];
    });
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[SETTINGS_KEY]) settings = readPublicSettings(changes[SETTINGS_KEY].newValue);
      if (changes[SHORTCUT_KEY] && typeof changes[SHORTCUT_KEY].newValue === 'string') {
        binding = changes[SHORTCUT_KEY].newValue;
        chip.setShortcut(binding);
      }
    });

    const chip = createChip(
      () => binding,
      () => {
        const sel = currentSelection();
        window.clearTimeout(timer);
        chip.hide();
        if (!sel) return;
        const type = pageTriggerTarget(settings) === 'webmode' ? 'wys:open-webmode' : 'wys:check';
        try {
          void browser.runtime
            .sendMessage({ type, input: { kind: 'text', ...sel } })
            .catch((e: unknown) => console.warn('[wys] could not reach the extension', e));
        } catch {
          // The extension was updated or switched off while this page stayed open: this script is an
          // orphan and can reach nothing. Take the chip away for good.
          retire();
        }
      },
    );

    // After an update or a disable, Chrome leaves this script running in tabs that were already open.
    // It must then do nothing at all: no chip, no timers, nothing of ours left in the page.
    let retired = false;
    const retire = () => {
      retired = true;
      window.clearTimeout(timer);
      chip.destroy();
    };
    ctx.onInvalidated(retire);

    // A page can set a selection itself (getSelection().addRange) and park it under the pointer so a
    // click meant for the page lands on the chip. Only selections that follow real input count.
    let lastUserInput = 0;
    const noteInput = (e: Event) => {
      if (!e.isTrusted || retired) return;
      lastUserInput = Date.now();
      // A slow drag-select ends with pointerup but no further selectionchange: re-evaluate now.
      // Keyboard selection already fires selectionchange per move, so no key (and never a copy or
      // paste shortcut) schedules work here.
      // Not the click on the chip itself: that would bring the chip back 220 ms after it was used.
      if (e.type === 'pointerup' && !chip.contains(e.target as Node | null)) schedule();
    };
    // pointerdown/keydown as well as the *up* events: a held shift+arrow repeats keydown for as long
    // as the user extends the selection, and a drag-select is a pointerdown long before its pointerup.
    for (const ev of ['pointerdown', 'pointerup', 'keydown', 'keyup'] as const) ctx.addEventListener(document, ev, noteInput, { capture: true, passive: true });

    // Everything in here runs on the page's main thread after every selection change, so it must
    // stay cheap on any page: no serialising the selection (`toString()` of a select-all on a long
    // page is the whole page) and no geometry for the whole range (`getClientRects()` is one rect
    // per text fragment). Only the end of the selection is measured; the text is read on click.
    let timer: number | undefined;
    const schedule = () => {
      if (retired) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (ctx.isInvalid) return retire();
        if (!chipAllowed()) return chip.hide();
        if (Date.now() - lastUserInput > 1500) return chip.hide();
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return chip.hide();
        if (chip.contains(sel.anchorNode)) return;
        if (isEditable(sel.anchorNode) || isEditable(sel.focusNode)) return chip.hide();
        const range = sel.getRangeAt(0);
        // A select-all is a page, not a highlight: the panel's "This page" covers it, and the chip
        // would sit at the bottom of the document anyway.
        const top = selectionTop(range);
        if (top === document || top === document.documentElement || top === document.body) return chip.hide();
        if (!likelyLongEnough(range)) return chip.hide();
        chip.show(selectionEndRect(sel, range), settings.askName);
      }, 220);
    };

    ctx.addEventListener(document, 'selectionchange', schedule);
    ctx.addEventListener(window, 'scroll', () => chip.hide(), { capture: true, passive: true });
    ctx.addEventListener(window, 'resize', () => chip.hide());
    ctx.addEventListener(document, 'keydown', (e) => {
      if (e.key === 'Escape') chip.hide();
    });
    ctx.addEventListener(document, 'pointerdown', (e) => {
      if (!chip.contains(e.target as Node | null)) chip.hide();
    });
    // Remember what was under the cursor when the context menu opened, for the "… this post" items.
    // Capture phase (a site that stops propagation must not leave a stale target), real clicks only,
    // and the innermost element even when it sits inside a web component's open shadow root.
    let lastContextTarget: Element | null = null;
    ctx.addEventListener(
      document,
      'contextmenu',
      (e) => {
        if (!e.isTrusted) return;
        const inner = e.composedPath()[0] ?? e.target;
        lastContextTarget = inner instanceof Element ? inner : inner instanceof Node ? inner.parentElement : null;
      },
      { capture: true, passive: true },
    );

    browser.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
      // Only our own extension can message a content script; a plain shape check keeps zod out of every page.
      const msg = raw as { type?: unknown; srcUrl?: unknown } | null;
      const type = msg && typeof msg.type === 'string' ? msg.type : '';
      switch (type) {
        case 'wys:get-selection':
          try {
            sendResponse(currentSelection() ?? clampSelection({ text: '', pageUrl: location.href, pageTitle: pageTitle() }));
          } catch {
            sendResponse(clampSelection({ text: '', pageUrl: location.href, pageTitle: '' }));
          }
          return false;
        case 'wys:extract-post':
          try {
            sendResponse(extractPost(lastContextTarget));
          } catch (e) {
            sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
          }
          return false;
        case 'wys:locate-image': {
          const src = typeof msg?.srcUrl === 'string' ? msg.srcUrl : '';
          // An oversized inline image is referenced by a sentinel; the right-clicked element is the image.
          // The right-clicked image first: the same address can appear twice on a page (a hidden
          // preload, a carousel clone), and the first match is not always the one the user meant.
          const clicked = lastContextTarget?.closest('img') ?? null;
          const img =
            src === INLINE_IMAGE_SENTINEL
              ? (clicked ?? lastContextTarget?.querySelector('img') ?? null)
              : clicked && (clicked.currentSrc === src || clicked.src === src)
                ? clicked
                : (Array.from(document.images).find((i) => i.currentSrc === src || i.src === src) ?? null);
          if (!img) {
            sendResponse(null);
            return false;
          }
          const r = img.getBoundingClientRect();
          sendResponse({ rect: { x: r.x, y: r.y, width: r.width, height: r.height }, dpr: window.devicePixelRatio || 1 });
          return false;
        }
        default:
          return false;
      }
    });

    function chipAllowed(): boolean {
      if (!settings.chip) return false;
      const host = location.hostname.replace(/^www\./, '');
      return !settings.disabledSites.some((s) => host === s || host.endsWith(`.${s}`));
    }
  },
});

/** Not the gaps between blocks: line breaks, comments, scripts, styles, empty wrappers. */
function holdsContent(n: Node): boolean {
  if (n.nodeType === Node.TEXT_NODE) return !!(n as Text).data.trim() && !n.parentElement?.closest('script, style, noscript, template');
  if (n.nodeType === Node.ELEMENT_NODE) return /^(IMG|VIDEO|CANVAS|SVG|PICTURE|IFRAME|INPUT|TEXTAREA|SELECT|BUTTON|HR)$/i.test((n as Element).tagName);
  return false;
}

/**
 * The node that contains the whole selection. A triple-click ends at offset 0 of the *next* block, so
 * the range's own common ancestor can be <body> for one paragraph; step the end back to where the
 * selected content really stops before asking. Cost: the depth of the tree, never its size.
 */
function selectionTop(range: Range): Node {
  if (range.endOffset !== 0 || range.endContainer === range.startContainer) return range.commonAncestorContainer;
  // The last node before the end that holds something (not the line breaks between blocks); a few steps at most.
  let last: Node | null = range.endContainer;
  for (let i = 0; i < 8 && last; i++) {
    let n: Node | null = last;
    while (n && !n.previousSibling) n = n.parentNode;
    last = n?.previousSibling ?? null;
    while (last?.lastChild) last = last.lastChild;
    if (last && holdsContent(last)) break;
  }
  if (!last) return range.commonAncestorContainer;
  try {
    const r = range.cloneRange();
    r.setEnd(last, last.nodeType === Node.TEXT_NODE ? (last as Text).length : last.childNodes.length);
    return r.collapsed ? range.commonAncestorContainer : r.commonAncestorContainer;
  } catch {
    return range.commonAncestorContainer;
  }
}

/** Three characters or more, judged without reading the selection: exact inside one text node, assumed otherwise. */
function likelyLongEnough(range: Range): boolean {
  if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
    return (range.startContainer as Text).data.slice(range.startOffset, range.endOffset).trim().length >= 3;
  }
  return true;
}

/** Where the selection ends on screen, measured from one character, so the cost does not grow with the selection. */
function selectionEndRect(sel: Selection, range: Range): DOMRect {
  let node = sel.focusNode ?? range.endContainer;
  let offset = sel.focusNode ? sel.focusOffset : range.endOffset;
  // A triple-click ends the selection at offset 0 of the *next* block; measuring there would put the
  // chip over the following paragraph. Measure where the selection began instead.
  if (offset === 0 && node === range.endContainer && node !== range.startContainer) {
    node = range.startContainer;
    offset = range.startOffset + 1;
  }
  try {
    offset = Math.min(offset, node.nodeType === Node.TEXT_NODE ? (node as Text).length : offset);
    const r = document.createRange();
    if (node.nodeType === Node.TEXT_NODE) {
      r.setStart(node, Math.max(0, offset - 1));
      r.setEnd(node, Math.max(offset, Math.min(1, (node as Text).length)));
    } else {
      r.selectNodeContents(node);
      r.collapse(false);
    }
    const rect = r.getBoundingClientRect();
    if (rect.width || rect.height || rect.x || rect.y) return rect;
  } catch {
    /* fall through to the element's box */
  }
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.getBoundingClientRect() ?? new DOMRect(8, 8, 0, 0);
}

/** Text the user is typing (inputs, textareas, contenteditable) is theirs, not something to check. */
function isEditable(node: Node | null): boolean {
  const el = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement;
  if (!el) return false;
  if (el.closest('input, textarea, select')) return true;
  return el.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

/** `document.title` can be shadowed by a page element named "title" (`<form name="title">`); never trust its type. */
function pageTitle(): string {
  const t: unknown = document.title;
  return typeof t === 'string' ? t : '';
}

/** Blocks larger than this (a layout table cell holding the whole page) are not read for context. */
const MAX_CONTEXT_BLOCK = 20_000;

function currentSelection(): SelectionInfo | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return null;
  // Cut to the limit first, and only collapse horizontal whitespace before a newline: `\s+\n` on an
  // unbounded string is quadratic on long runs of spaces (padded <pre> blocks).
  const text = sel
    .toString()
    .slice(0, LIMITS.text * 2)
    .replace(/[^\S\n]+\n/g, '\n')
    .trim();
  if (text.length < 3) return null;
  const node = sel.anchorNode;
  const el = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement;
  // Small blocks only: `article`/`section` would mean serialising a whole page for 1,200 characters of context.
  const block = el?.closest('p, li, blockquote, td, h1, h2, h3, h4, figcaption') ?? null;
  return clampSelection({
    text,
    pageUrl: location.href,
    pageTitle: pageTitle(),
    surrounding: surroundingText(block, text),
  });
}

/** The part of the block around the selection (not simply its first characters), or nothing when the block adds nothing. */
function surroundingText(block: Element | null, text: string): string | undefined {
  const raw = block?.textContent ?? '';
  if (!raw || raw.length > MAX_CONTEXT_BLOCK) return undefined;
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (flat.length <= text.length) return undefined;
  const max = LIMITS.surroundingForPrompt;
  if (flat.length <= max) return flat;
  const at = flat.indexOf(text.replace(/\s+/g, ' ').slice(0, 60));
  const start = at < 0 ? 0 : Math.max(0, Math.min(at - Math.floor(max / 4), flat.length - max));
  return flat.slice(start, start + max);
}

function textSpan(text: string, className?: string): HTMLSpanElement {
  const s = document.createElement('span');
  if (className) s.className = className;
  s.textContent = text;
  return s;
}

function logoSvg(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({
    width: '16',
    height: '16',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: '#8FC1F2',
    'stroke-width': '2.4',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  }))
    svg.setAttribute(k, v);
  const circle = document.createElementNS(NS, 'circle');
  circle.setAttribute('cx', '10.5');
  circle.setAttribute('cy', '10.5');
  circle.setAttribute('r', '6.5');
  const handle = document.createElementNS(NS, 'path');
  handle.setAttribute('d', 'M20 20l-4.5-4.5');
  const tick = document.createElementNS(NS, 'path');
  tick.setAttribute('d', 'M8 10.5l1.8 1.8 3.2-3.6');
  svg.append(circle, handle, tick);
  return svg;
}

function createChip(binding: () => string | null, onClick: () => void) {
  // Nothing touches the page's DOM until the first selection that deserves a chip: most page views never get one.
  let built: { host: HTMLDivElement; root: ShadowRoot; btn: HTMLButtonElement; kbd: HTMLSpanElement; ask: HTMLSpanElement } | null = null;
  let shown = false;
  const build = () => {
    const host = document.createElement('div');
    host.setAttribute('data-wys', 'chip');
    // Every declaration is !important: a page stylesheet must not be able to restyle the host (a
    // transform or opacity on it would stretch an invisible chip over the page).
    host.style.cssText =
      'all:initial!important;position:fixed!important;top:0!important;left:0!important;width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important;opacity:1!important;transform:none!important;filter:none!important;user-select:none!important;-webkit-user-select:none!important;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
    :host { all: initial; }
    .chip { position: fixed; display: none; align-items: center; gap: 8px; padding: 7px 11px 7px 9px;
      background: #15181C; color: #fff; border-radius: 999px; box-shadow: 0 6px 18px rgba(0,0,0,.28), 0 0 0 1px rgba(255,255,255,.14);
      font: 600 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; cursor: pointer; pointer-events: auto;
      border: 0; white-space: nowrap; user-select: none; -webkit-user-select: none; }
    .chip.on { display: inline-flex; }
    .chip:hover { background: #0F5FA8; }
    .chip:focus-visible { outline: 2px solid #8FC1F2; outline-offset: 2px; }
    .kbd { font-size: 11px; font-weight: 600; padding: 2px 5px; border-radius: 4px; background: rgba(255,255,255,.18); color: #E5E7EB; }
    .ask { font-weight: 500; color: #C9D2DC; }
    .ask:empty { display: none; }
    svg { flex-shrink: 0; }
  `;
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Check source of selected text');
    const kbd = textSpan('', 'kbd');
    const ask = textSpan('', 'ask');
    btn.append(logoSvg(), textSpan('Check source'), ask, kbd);
    built = { host, root, btn, kbd, ask };
    setKbd(binding());
    btn.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the selection alive
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Only a real click on a chip that looks like one: not a scripted click, and not a chip the
      // page has managed to stretch or hide.
      if (!e.isTrusted) return;
      const r = btn.getBoundingClientRect();
      if (r.width > 420 || r.height > 80 || getComputedStyle(host).opacity !== '1') return;
      onClick();
    });
    root.append(style, btn);
    return built;
  };
  // The host is in the page only while the chip is visible. Hidden, nothing of ours is in the DOM,
  // so nothing of ours can end up inside a selection, a copy, or a page's own DOM walk.
  const attach = (host: HTMLDivElement) => {
    if (!host.isConnected) (document.documentElement || document.body).appendChild(host);
  };
  /** '' = the user unbound the command (no hint); null = not known yet (show the default). */
  const setKbd = (b: string | null) => {
    if (!built) return;
    built.kbd.textContent = b === '' ? '' : shortcutLabelForPlatform(b ?? undefined);
    built.kbd.style.display = b === '' ? 'none' : '';
  };

  return {
    show(rect: DOMRect, askName = '') {
      const { btn, host, ask } = built ?? build();
      // The chip says what it will ask when that is not the ordinary fact-check.
      ask.textContent = askName ? `· ${askName}` : '';
      btn.setAttribute('aria-label', askName ? `Check source of selected text (${askName})` : 'Check source of selected text');
      attach(host);
      shown = true;
      btn.classList.add('on');
      const w = btn.offsetWidth || 180;
      const h = btn.offsetHeight || 32;
      let left = rect.right - w;
      let top = rect.bottom + 8;
      if (left < 8) left = 8;
      if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
      if (top + h > window.innerHeight - 8) top = rect.top - h - 8;
      if (top < 8) top = 8;
      btn.style.left = `${Math.round(left)}px`;
      btn.style.top = `${Math.round(top)}px`;
    },
    hide() {
      if (!shown || !built) return; // scroll fires constantly; nothing to do while hidden
      shown = false;
      built.btn.classList.remove('on');
      built.host.remove();
    },
    destroy() {
      shown = false;
      built?.host.remove();
      built = null;
    },
    setShortcut(b: string | null) {
      setKbd(b);
    },
    contains(node: Node | null | undefined): boolean {
      return !!node && !!built && (node === built.host || built.host.contains(node) || built.root.contains(node));
    },
  };
}
