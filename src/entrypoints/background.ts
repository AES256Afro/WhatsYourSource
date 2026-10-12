import { defineBackground } from '#imports';
import { browser, type Browser } from 'wxt/browser';
import { enqueueJob } from '@/lib/jobs';
import { MessageSchema, PostInputSchema, SelectionInfoSchema, type CheckInput, type SelectionInfo } from '@/lib/messaging/protocol';
import { loadSettings } from '@/lib/storage/settings';
import { googleAiModeUrl } from '@/lib/webmode';

/**
 * The background is a router only: it owns the context menus and the keyboard command,
 * opens the side panel while the user gesture is still fresh, and hands the job over
 * through storage.session. All AI work happens in the side panel page.
 */
const MENU = {
  selection: 'wys-selection',
  selectionWeb: 'wys-selection-web',
  image: 'wys-image',
  post: 'wys-post',
  page: 'wys-page',
} as const;

type MaybeTab = Browser.tabs.Tab | undefined;

interface PanelApis {
  sidePanel?: { open(opts: { windowId?: number; tabId?: number }): Promise<void> };
  sidebarAction?: { open(): Promise<void> };
}

export default defineBackground(() => {
  function createMenus() {
    void browser.contextMenus.removeAll().then(() => {
      browser.contextMenus.create({ id: MENU.selection, title: 'Check source of selection', contexts: ['selection'] });
      browser.contextMenus.create({
        id: MENU.selectionWeb,
        title: 'Open selection in Google AI Mode',
        contexts: ['selection'],
      });
      browser.contextMenus.create({ id: MENU.image, title: 'Check source of this image', contexts: ['image'] });
      browser.contextMenus.create({ id: MENU.post, title: 'Check source of this post', contexts: ['page', 'link', 'image', 'selection'] });
      browser.contextMenus.create({ id: MENU.page, title: 'Check source of this page', contexts: ['page'] });
    });
  }

  browser.runtime.onInstalled.addListener(createMenus);
  // Firefox does not always run the event page on startup; register on both.
  browser.runtime.onStartup.addListener(createMenus);

  browser.contextMenus.onClicked.addListener((info, tab) => {
    const pageUrl = info.pageUrl ?? tab?.url ?? '';
    const pageTitle = tab?.title ?? '';
    switch (info.menuItemId) {
      case MENU.selection: {
        const text = (info.selectionText ?? '').trim();
        if (!text) return;
        openPanel(tab);
        void (async () => {
          const sel = await resolveSelection(tab, text);
          await enqueueJob({ kind: 'text', text: sel.text, pageUrl: sel.pageUrl || pageUrl, pageTitle: sel.pageTitle || pageTitle, surrounding: sel.surrounding }, tab?.id);
        })();
        return;
      }
      case MENU.selectionWeb: {
        const text = (info.selectionText ?? '').trim();
        if (!text) return;
        void browser.tabs.create({ url: googleAiModeUrl({ kind: 'text', text, pageUrl, pageTitle }) });
        return;
      }
      case MENU.image: {
        if (!info.srcUrl) return;
        openPanel(tab);
        void enqueueJob({ kind: 'image', srcUrl: info.srcUrl, pageUrl, pageTitle }, tab?.id);
        return;
      }
      case MENU.post: {
        openPanel(tab);
        void (async () => {
          let input: CheckInput = { kind: 'page', url: pageUrl, title: pageTitle };
          if (tab?.id != null) {
            try {
              const reply = await browser.tabs.sendMessage(tab.id, { type: 'wys:extract-post' });
              const parsed = PostInputSchema.safeParse(reply);
              if (parsed.success) input = parsed.data;
            } catch {
              /* no content script on this page */
            }
          }
          await enqueueJob(input, tab?.id);
        })();
        return;
      }
      case MENU.page: {
        openPanel(tab);
        void enqueueJob({ kind: 'page', url: pageUrl, title: pageTitle }, tab?.id);
        return;
      }
    }
  });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== 'check-selection') return;
    void (async () => {
      const settings = await loadSettings();
      const activeTab = tab ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0];
      if (settings.shortcutAction === 'panel') openPanel(activeTab);
      const sel = await resolveSelection(activeTab, '');
      const input: CheckInput = sel.text
        ? { kind: 'text', text: sel.text, pageUrl: sel.pageUrl, pageTitle: sel.pageTitle, surrounding: sel.surrounding }
        : { kind: 'page', url: activeTab?.url ?? '', title: activeTab?.title ?? '' };
      if (settings.shortcutAction === 'webmode') {
        await browser.tabs.create({ url: googleAiModeUrl(input) });
      } else {
        await enqueueJob(input, activeTab?.id);
      }
    })();
  });

  browser.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    const parsed = MessageSchema.safeParse(raw);
    if (!parsed.success) return false;
    const msg = parsed.data;
    switch (msg.type) {
      case 'wys:check': {
        openPanel(sender.tab);
        void enqueueJob(msg.input, sender.tab?.id).then(
          () => sendResponse({ ok: true }),
          (e: unknown) => sendResponse({ ok: false, error: String(e) }),
        );
        return true;
      }
      case 'wys:open-panel': {
        openPanel(sender.tab);
        sendResponse({ ok: true });
        return false;
      }
      default:
        return false;
    }
  });

  /**
   * Must be called synchronously inside the user-gesture handler (no await before it),
   * otherwise Chrome's sidePanel.open and Firefox's sidebarAction.open refuse.
   */
  function openPanel(tab: MaybeTab) {
    const apis = browser as unknown as PanelApis;
    const fallback = () =>
      browser.windows.create({ url: browser.runtime.getURL('/sidepanel.html'), type: 'popup', width: 420, height: 840 });
    try {
      if (apis.sidePanel?.open) {
        const opts = tab?.windowId != null ? { windowId: tab.windowId } : { tabId: tab?.id };
        apis.sidePanel.open(opts).catch((e: unknown) => {
          console.warn('[wys] sidePanel.open failed, opening a window instead', e);
          void fallback();
        });
        return;
      }
      if (apis.sidebarAction?.open) {
        apis.sidebarAction.open().catch((e: unknown) => {
          console.warn('[wys] sidebarAction.open failed, opening a window instead', e);
          void fallback();
        });
        return;
      }
    } catch (e) {
      console.warn('[wys] no side panel API', e);
    }
    void fallback();
  }

  /** Ask the content script for the richer selection (context paragraph); fall back to the menu's text. */
  async function resolveSelection(tab: MaybeTab, fallbackText: string): Promise<SelectionInfo> {
    const base: SelectionInfo = { text: fallbackText, pageUrl: tab?.url ?? '', pageTitle: tab?.title ?? '' };
    if (tab?.id == null) return base;
    try {
      const reply = await browser.tabs.sendMessage(tab.id, { type: 'wys:get-selection' });
      const parsed = SelectionInfoSchema.safeParse(reply);
      if (parsed.success && parsed.data.text.trim()) return parsed.data;
    } catch {
      // No content script on this page (loaded before install, or a restricted URL). Try injecting a one-off reader.
      try {
        const [r] = await browser.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const sel = window.getSelection();
            return {
              text: sel ? sel.toString().trim() : '',
              pageUrl: location.href,
              pageTitle: document.title,
            };
          },
        });
        const parsed = SelectionInfoSchema.safeParse(r?.result);
        if (parsed.success && parsed.data.text.trim()) return parsed.data;
      } catch {
        /* restricted page */
      }
    }
    return base;
  }
});
