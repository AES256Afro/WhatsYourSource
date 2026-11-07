import { defineBackground } from '#imports';
import { browser, type Browser } from 'wxt/browser';
import { enqueueJob } from '@/lib/jobs';
import { openPanelSync } from '@/lib/panel';
import { clampSelection, LIMITS, MessageSchema, PostInputSchema, SelectionInfoSchema, type CheckInput, type SelectionInfo } from '@/lib/messaging/protocol';
import { DEFAULT_SETTINGS, loadPublicSettings, mergeSettings, pageTriggerTarget, SETTINGS_KEY, type Settings } from '@/lib/storage/settings';
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

export default defineBackground(() => {
  /**
   * `sidePanel.open` must run synchronously inside the user-gesture handler, so the decision
   * "panel or web tab?" cannot wait for storage. Keep a copy of the public settings in memory.
   * Until the first load resolves we assume the panel, which is the common case.
   */
  let settings: Settings = DEFAULT_SETTINGS;
  void loadPublicSettings().then((s) => (settings = s));
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SETTINGS_KEY]) settings = mergeSettings(DEFAULT_SETTINGS, changes[SETTINGS_KEY].newValue);
  });

  function createMenus() {
    void browser.contextMenus.removeAll().then(() => {
      browser.contextMenus.create({ id: MENU.selection, title: 'Check source of selection', contexts: ['selection'] });
      browser.contextMenus.create({ id: MENU.selectionWeb, title: 'Open selection in Google AI Mode', contexts: ['selection'] });
      browser.contextMenus.create({ id: MENU.image, title: 'Check source of this image', contexts: ['image'] });
      // Post and page only when nothing more specific (a selection, an image) is under the cursor.
      browser.contextMenus.create({ id: MENU.post, title: 'Check source of this post', contexts: ['page', 'link'] });
      browser.contextMenus.create({ id: MENU.page, title: 'Check source of this page', contexts: ['page', 'link'] });
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
        if (settings.defaultProvider === 'webmode') {
          void browser.tabs.create({ url: googleAiModeUrl({ kind: 'text', text, pageUrl, pageTitle }) });
          return;
        }
        openPanel(tab);
        void (async () => {
          const sel = await resolveSelection(tab, text);
          await enqueueJob(
            { kind: 'text', text: sel.text, pageUrl: sel.pageUrl || pageUrl, pageTitle: sel.pageTitle || pageTitle, surrounding: sel.surrounding },
            tab?.id,
            tab?.windowId,
          );
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
        if (settings.defaultProvider === 'webmode') {
          void browser.tabs.create({ url: googleAiModeUrl({ kind: 'image', srcUrl: info.srcUrl, pageUrl, pageTitle }) });
          return;
        }
        openPanel(tab);
        void enqueueJob({ kind: 'image', srcUrl: info.srcUrl, pageUrl, pageTitle }, tab?.id, tab?.windowId);
        return;
      }
      case MENU.post: {
        if (settings.defaultProvider !== 'webmode') openPanel(tab);
        void (async () => {
          let input: CheckInput = { kind: 'page', url: pageUrl, title: pageTitle };
          if (tab?.id != null) {
            try {
              const reply: unknown = await browser.tabs.sendMessage(tab.id, { type: 'wys:extract-post' });
              const parsed = PostInputSchema.safeParse(reply);
              if (parsed.success) input = parsed.data;
            } catch {
              /* no content script on this page */
            }
          }
          if (settings.defaultProvider === 'webmode') await browser.tabs.create({ url: googleAiModeUrl(input) });
          else await enqueueJob(input, tab?.id, tab?.windowId);
        })();
        return;
      }
      case MENU.page: {
        const input: CheckInput = { kind: 'page', url: pageUrl, title: pageTitle };
        if (settings.defaultProvider === 'webmode') {
          void browser.tabs.create({ url: googleAiModeUrl(input) });
          return;
        }
        openPanel(tab);
        void enqueueJob(input, tab?.id, tab?.windowId);
        return;
      }
    }
  });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== 'check-selection') return;
    let target = pageTriggerTarget(settings);
    // Synchronously, while the gesture is fresh. Firefox passes the tab; Chrome may not.
    if (target === 'panel' && tab) openPanel(tab);
    void (async () => {
      // The in-memory copy may still be the defaults right after the worker woke up; re-read now
      // that we are async anyway. (The panel may have opened needlessly; harmless.)
      settings = await loadPublicSettings();
      target = pageTriggerTarget(settings);
      const activeTab = tab ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0];
      if (target === 'panel' && !tab) openPanel(activeTab);
      const sel = await resolveSelection(activeTab, '');
      const pageUrl = sel.pageUrl || activeTab?.url || '';
      if (!sel.text && !/^https?:/i.test(pageUrl)) return; // nothing selected, on a page we cannot read
      const input: CheckInput = sel.text
        ? { kind: 'text', text: sel.text, pageUrl: sel.pageUrl, pageTitle: sel.pageTitle, surrounding: sel.surrounding }
        : { kind: 'page', url: pageUrl, title: sel.pageTitle || activeTab?.title || '' };
      if (target === 'webmode') {
        await browser.tabs.create({ url: googleAiModeUrl(input) });
      } else {
        await enqueueJob(input, activeTab?.id, activeTab?.windowId);
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
        void enqueueJob(msg.input, sender.tab?.id, sender.tab?.windowId).then(
          () => sendResponse({ ok: true }),
          (e: unknown) => sendResponse({ ok: false, error: String(e) }),
        );
        return true;
      }
      case 'wys:open-webmode': {
        void browser.tabs.create({ url: googleAiModeUrl(msg.input) }).then(
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

  function openPanel(tab: MaybeTab) {
    openPanelSync(tab);
  }

  /** Ask the content script for the richer selection (context paragraph); fall back to the menu's text. */
  async function resolveSelection(tab: MaybeTab, fallbackText: string): Promise<SelectionInfo> {
    const base: SelectionInfo = clampSelection({ text: fallbackText, pageUrl: tab?.url ?? '', pageTitle: tab?.title ?? '' });
    if (tab?.id == null) return base;
    try {
      const reply: unknown = await browser.tabs.sendMessage(tab.id, { type: 'wys:get-selection' });
      const parsed = SelectionInfoSchema.safeParse(reply);
      if (parsed.success && parsed.data.text.trim()) return parsed.data;
    } catch {
      // No content script on this page (loaded before install, or a restricted URL). Try injecting a one-off reader.
      try {
        const [r] = await browser.scripting.executeScript({
          target: { tabId: tab.id },
          func: (limits: { text: number; url: number; title: number }) => {
            const sel = window.getSelection();
            return {
              text: sel ? sel.toString().trim().slice(0, limits.text) : '',
              pageUrl: location.href.slice(0, limits.url),
              pageTitle: document.title.slice(0, limits.title),
            };
          },
          args: [{ text: LIMITS.text, url: LIMITS.url, title: LIMITS.title }],
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
