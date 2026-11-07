import { defineContentScript } from '#imports';
import { browser } from 'wxt/browser';
import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import { clampSelection, INLINE_IMAGE_SENTINEL, LIMITS, MessageSchema, type SelectionInfo, type SnapshotPayload } from '@/lib/messaging/protocol';
import { extractPost } from '@/lib/post/extract';
import { shortcutLabelForPlatform } from '@/lib/shortcut';
import { DEFAULT_SETTINGS, mergeSettings, pageTriggerTarget, SETTINGS_KEY, type Settings } from '@/lib/storage/settings';

/**
 * Runs on every page, does three small things and nothing else:
 *  1. shows a floating "Check source" chip when text is selected (if enabled),
 *  2. answers "what is selected?" for the background/popup,
 *  3. captures a sanitized copy of the page for history when the side panel asks.
 * Nothing is sent anywhere until the user clicks.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main(ctx) {
    // XML, SVG and other non-HTML documents: no chip (attachShadow throws there) and nothing to snapshot.
    if (!(document instanceof HTMLDocument) || document.contentType === 'application/xml' || document.contentType === 'text/xml') return;
    // Only the public half of the settings (no API keys) is read here. (storage.onChanged still
    // delivers every change to this isolated world; the `secrets` key is ignored, never kept.)
    let settings: Settings = DEFAULT_SETTINGS;
    void browser.storage.local.get(SETTINGS_KEY).then((r) => {
      settings = mergeSettings(DEFAULT_SETTINGS, r[SETTINGS_KEY]);
    });
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[SETTINGS_KEY]) settings = mergeSettings(DEFAULT_SETTINGS, changes[SETTINGS_KEY].newValue);
    });

    const chip = createChip(() => {
      const sel = currentSelection();
      chip.hide();
      if (!sel) return;
      const type = pageTriggerTarget(settings) === 'webmode' ? 'wys:open-webmode' : 'wys:check';
      void browser.runtime.sendMessage({ type, input: { kind: 'text', ...sel } }).catch((e: unknown) => console.warn('[wys] could not reach the extension', e));
    });

    // A page can set a selection itself (getSelection().addRange) and park it under the pointer so a
    // click meant for the page lands on the chip. Only selections that follow real input count.
    let lastUserInput = 0;
    const noteInput = (e: Event) => {
      if (!e.isTrusted) return;
      lastUserInput = Date.now();
      // A slow drag-select ends with pointerup but no further selectionchange: re-evaluate now.
      if (e.type === 'pointerup' || e.type === 'keyup') schedule();
    };
    // pointerdown/keydown as well as the *up* events: a held shift+arrow repeats keydown for as long
    // as the user extends the selection, and a drag-select is a pointerdown long before its pointerup.
    for (const ev of ['pointerdown', 'pointerup', 'keydown', 'keyup'] as const) ctx.addEventListener(document, ev, noteInput, { capture: true, passive: true });

    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!chipAllowed()) return chip.hide();
        if (Date.now() - lastUserInput > 1500) return chip.hide();
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.toString().trim().length < 3) return chip.hide();
        if (chip.contains(sel.anchorNode)) return;
        if (isEditable(sel.anchorNode) || isEditable(sel.focusNode)) return chip.hide();
        const range = sel.getRangeAt(0);
        const rects = range.getClientRects();
        const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
        chip.show(last);
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
    // Remember what was under the cursor when the context menu opened, for "Check source of this post".
    let lastContextTarget: Element | null = null;
    ctx.addEventListener(document, 'contextmenu', (e) => {
      lastContextTarget = e.target instanceof Element ? e.target : null;
    });

    browser.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
      const parsed = MessageSchema.safeParse(raw);
      if (!parsed.success) return false;
      switch (parsed.data.type) {
        case 'wys:get-selection':
          sendResponse(currentSelection() ?? clampSelection({ text: '', pageUrl: location.href, pageTitle: document.title }));
          return false;
        case 'wys:capture-snapshot':
          try {
            sendResponse(captureSnapshot());
          } catch (e) {
            sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
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
          const src = parsed.data.srcUrl;
          // An oversized inline image is referenced by a sentinel; the right-clicked element is the image.
          const img =
            src === INLINE_IMAGE_SENTINEL
              ? (lastContextTarget?.closest('img') ?? lastContextTarget?.querySelector('img') ?? null)
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
      if (!settings.privacy.chip) return false;
      const host = location.hostname.replace(/^www\./, '');
      return !settings.privacy.disabledSites.some((s) => host === s || host.endsWith(`.${s}`));
    }
  },
});

/** Text the user is typing (inputs, textareas, contenteditable) is theirs, not something to check. */
function isEditable(node: Node | null): boolean {
  const el = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement;
  if (!el) return false;
  if (el.closest('input, textarea, select')) return true;
  return el.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

function currentSelection(): SelectionInfo | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return null;
  const text = sel.toString().replace(/\s+\n/g, '\n').trim();
  if (text.length < 3) return null;
  const node = sel.anchorNode;
  const el = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement;
  const block = el?.closest('p, li, blockquote, td, h1, h2, h3, h4, figcaption, article, section') ?? null;
  const surrounding = block?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 1200);
  return clampSelection({
    text,
    pageUrl: location.href,
    pageTitle: document.title,
    surrounding: surrounding && surrounding.length > text.length ? surrounding : undefined,
  });
}

function captureSnapshot(): SnapshotPayload {
  const clone = document.cloneNode(true) as Document;
  let article: ReturnType<Readability['parse']> = null;
  try {
    article = new Readability(clone, { keepClasses: false }).parse();
  } catch {
    article = null;
  }
  const rawHtml = article?.content ?? (document.querySelector('main, article') ?? document.body).innerHTML;
  // `data:` is allowed so inline images survive, but never as a link target.
  const dropDataLinks = (node: Element, data: { attrName: string; attrValue: string; keepAttr: boolean }) => {
    if (data.attrName === 'href' && /^\s*data:/i.test(data.attrValue)) data.keepAttr = false;
  };
  DOMPurify.addHook('uponSanitizeAttribute', dropDataLinks);
  let html: string;
  try {
    html = DOMPurify.sanitize(rawHtml, {
      FORBID_TAGS: [
        'script',
        'style',
        'iframe',
        'object',
        'embed',
        'form',
        'input',
        'button',
        'video',
        'audio',
        'source',
        'link',
        'meta',
        'svg',
        'canvas',
        'math',
      ],
      FORBID_ATTR: ['style', 'srcset', 'sizes', 'loading', 'onerror', 'onload', 'class', 'id', 'ping'],
      ALLOWED_URI_REGEXP: /^(?:https?|data):/i,
    });
  } finally {
    DOMPurify.removeHook('uponSanitizeAttribute', dropDataLinks);
  }
  return {
    url: location.href.slice(0, LIMITS.url),
    title: (article?.title || document.title).slice(0, LIMITS.title),
    html: html.slice(0, 1_500_000),
    textLength: article?.textContent?.length ?? 0,
    capturedAt: Date.now(),
  };
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

function createChip(onClick: () => void) {
  const host = document.createElement('div');
  host.setAttribute('data-wys', 'chip');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
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
    svg { flex-shrink: 0; }
  `;
  const btn = document.createElement('button');
  btn.className = 'chip';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Check source of selected text');
  btn.append(logoSvg(), textSpan('Check source'), textSpan(shortcutLabelForPlatform(), 'kbd'));
  btn.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the selection alive
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  root.append(style, btn);
  (document.documentElement || document.body).appendChild(host);

  return {
    show(rect: DOMRect) {
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
      btn.classList.remove('on');
    },
    contains(node: Node | null | undefined): boolean {
      return !!node && (node === host || host.contains(node) || root.contains(node));
    },
  };
}
