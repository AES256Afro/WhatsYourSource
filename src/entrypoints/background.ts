import { defineBackground } from '#imports';
import { browser, type Browser } from 'wxt/browser';
import { enqueueJob } from '@/lib/jobs';
import { openPanelSync } from '@/lib/panel';
import { clampSelection, LIMITS, MessageSchema, PostInputSchema, SelectionInfoSchema, type CheckInput, type SelectionInfo } from '@/lib/messaging/protocol';
import { DEFAULT_SETTINGS, loadSettingsWithoutSecrets, mergeSettings, pageTriggerTarget, SETTINGS_KEY, type Settings } from '@/lib/storage/settings';
import { googleAiModeUrl } from '@/lib/googleAiMode';

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
  const adopt = (s: Settings) => {
    settings = s;
  };
  void loadSettingsWithoutSecrets().then(adopt);
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SETTINGS_KEY]) adopt(mergeSettings(DEFAULT_SETTINGS, changes[SETTINGS_KEY].newValue));
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

  /**
   * Where a context-menu check goes: the web tab when Google AI Mode is the default provider,
   * otherwise the panel (opened synchronously here, while the gesture is fresh) plus a queued job.
   * `resolve` may be slow (asking the page); the panel decision cannot wait for it.
   */
  function route(tab: MaybeTab, quick: CheckInput, resolve?: () => Promise<CheckInput>): void {
    if (settings.defaultProvider === 'webmode') {
      void (resolve ? resolve() : Promise.resolve(quick)).then((input) => browser.tabs.create({ url: googleAiModeUrl(input, settings.webmodeVariant) }));
      return;
    }
    openPanel(tab);
    void (resolve ? resolve() : Promise.resolve(quick)).then((input) => enqueueJob(input, tab?.id, tab?.windowId));
  }

  browser.contextMenus.onClicked.addListener((info, tab) => {
    const pageUrl = info.pageUrl ?? tab?.url ?? '';
    const pageTitle = tab?.title ?? '';
    switch (info.menuItemId) {
      case MENU.selection: {
        const text = (info.selectionText ?? '').trim();
        if (!text) return;
        const quick: CheckInput = { kind: 'text', text, pageUrl, pageTitle };
        route(tab, quick, async () => {
          const sel = await resolveSelection(tab, text, info.frameId);
          return { kind: 'text', text: sel.text, pageUrl: sel.pageUrl || pageUrl, pageTitle: sel.pageTitle || pageTitle, surrounding: sel.surrounding };
        });
        return;
      }
      case MENU.selectionWeb: {
        const text = (info.selectionText ?? '').trim();
        if (!text) return;
        void browser.tabs.create({ url: googleAiModeUrl({ kind: 'text', text, pageUrl, pageTitle }, settings.webmodeVariant) });
        return;
      }
      case MENU.image: {
        if (!info.srcUrl) return;
        route(tab, { kind: 'image', srcUrl: info.srcUrl, pageUrl, pageTitle });
        return;
      }
      case MENU.post: {
        const page: CheckInput = { kind: 'page', url: pageUrl, title: pageTitle };
        route(tab, page, async () => {
          if (tab?.id == null) return page;
          try {
            const reply: unknown = await browser.tabs.sendMessage(tab.id, { type: 'wys:extract-post' });
            const parsed = PostInputSchema.safeParse(reply);
            return parsed.success ? parsed.data : page;
          } catch {
            return page; // no content script on this page
          }
        });
        return;
      }
      case MENU.page: {
        route(tab, { kind: 'page', url: pageUrl, title: pageTitle });
        return;
      }
    }
  });

  // Address bar: "wys <text or link>". Enter is a user action, so the panel may open here.
  browser.omnibox.onInputEntered.addListener((text) => {
    const t = text.trim();
    if (!t) return;
    const input: CheckInput = /^https?:\/\/\S+$/i.test(t) ? { kind: 'page', url: t, title: '' } : { kind: 'text', text: t, pageUrl: '', pageTitle: '' };
    if (settings.defaultProvider === 'webmode') {
      void browser.tabs.create({ url: googleAiModeUrl(input, settings.webmodeVariant) });
      return;
    }
    void (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      openPanel(tab);
      await enqueueJob(input, undefined, tab?.windowId);
    })();
  });
  void browser.omnibox.setDefaultSuggestion({ description: 'Check whether this is true and find its source: %s' });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== 'check-selection') return;
    let target = pageTriggerTarget(settings);
    // Synchronously, while the gesture is fresh. Firefox passes the tab; Chrome may not.
    if (target === 'panel' && tab) openPanel(tab);
    void (async () => {
      // The in-memory copy may still be the defaults right after the worker woke up; re-read now
      // that we are async anyway. (The panel may have opened needlessly; harmless.)
      adopt(await loadSettingsWithoutSecrets());
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
        await browser.tabs.create({ url: googleAiModeUrl(input, settings.webmodeVariant) });
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
    void openPanelSync(tab);
  }

  /**
   * Ask the content script for the richer selection (context paragraph); fall back to the menu's text.
   * `frameId` (from the context menu) names the frame the user right-clicked; the top-frame script
   * cannot see selections in other frames.
   */
  async function resolveSelection(tab: MaybeTab, fallbackText: string, frameId?: number): Promise<SelectionInfo> {
    const base: SelectionInfo = clampSelection({ text: fallbackText, pageUrl: tab?.url ?? '', pageTitle: tab?.title ?? '' });
    if (tab?.id == null) return base;
    try {
      if (frameId) {
        // Right-clicked inside an iframe: read that frame, nothing else.
        const inFrame = await readSelectionFromFrames(tab.id, { frameIds: [frameId] }, fallbackText);
        if (inFrame) return inFrame;
      }
      const reply: unknown = await browser.tabs.sendMessage(tab.id, { type: 'wys:get-selection' });
      const parsed = SelectionInfoSchema.safeParse(reply);
      if (parsed.success && parsed.data.text.trim()) return parsed.data;
      // The top frame answered but has no selection: the selection may live in an iframe (a comments
      // widget, an embedded editor), which the content script does not run in. Ask every frame.
      const inFrame = await readSelectionFromFrames(tab.id, { allFrames: true }, fallbackText);
      if (inFrame)
        return {
          ...inFrame,
          pageUrl: parsed.success ? parsed.data.pageUrl : inFrame.pageUrl,
          pageTitle: parsed.success ? parsed.data.pageTitle : inFrame.pageTitle,
        };
    } catch {
      // No content script on this page (loaded before install, or a restricted URL). Try injecting a one-off reader.
      try {
        const r = await readSelectionFromFrames(tab.id, frameId ? { frameIds: [frameId] } : { allFrames: false }, fallbackText);
        if (r) return r;
      } catch {
        /* restricted page */
      }
    }
    return base;
  }

  /**
   * Inject a one-off selection reader. Selections persist per document, so when several frames have
   * one, the frame whose text matches what the browser reported (`prefer`) wins; else the first.
   */
  async function readSelectionFromFrames(tabId: number, where: { allFrames?: boolean; frameIds?: number[] }, prefer = ''): Promise<SelectionInfo | null> {
    const target: Browser.scripting.InjectionTarget = where.frameIds ? { tabId, frameIds: where.frameIds } : { tabId, allFrames: where.allFrames ?? false };
    const results = await browser.scripting.executeScript({
      target,
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
    const found: SelectionInfo[] = [];
    for (const r of results) {
      const parsed = SelectionInfoSchema.safeParse(r.result);
      if (parsed.success && parsed.data.text.trim()) found.push(parsed.data);
    }
    const want = prefer.replace(/\s+/g, ' ').trim();
    return found.find((f) => want && f.text.replace(/\s+/g, ' ').trim() === want) ?? found[0] ?? null;
  }
});
