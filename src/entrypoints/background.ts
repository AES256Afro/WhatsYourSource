import { defineBackground } from '#imports';
import { COMMAND_ID } from '@/lib/shortcut';
import { browser, type Browser } from 'wxt/browser';
import { enqueueJob } from '@/lib/jobs';
import { openPanelSync } from '@/lib/panel';
import { clampSelection, LIMITS, MessageSchema, PostInputSchema, SelectionInfoSchema, type CheckInput, type SelectionInfo } from '@/lib/messaging/protocol';
import {
  DEFAULT_SETTINGS,
  defaultAsk,
  loadSettingsWithoutSecrets,
  pageTriggerTarget,
  repairPublicMirror,
  serveSettingsMessage,
  type Settings,
} from '@/lib/storage/settings';
import { createSettingsRecord, readMenusBuiltFrom, writeMenusBuiltFrom } from '@/lib/storage/settingsStore';
import { PUBLIC_KEY, SHORTCUT_KEY } from '@/lib/storage/publicSettings';
import { googleAiModeUrl } from '@/lib/googleAiMode';
import { pickFrameSelection, sameSelection } from '@/lib/messaging/selectionTrust';
import { askForMenu, MENU_SELECTION_WEB, menuItems, parseMenuId, savedQuestionsChanged } from '@/lib/menus';
import type { AskId } from '@/lib/pipeline/question';

/**
 * The background is a router only: it owns the context menus and the keyboard command,
 * opens the side panel while the user gesture is still fresh, and hands the job over
 * through storage.session. All AI work happens in the side panel page.
 */
type MaybeTab = Browser.tabs.Tab | undefined;

export default defineBackground(() => {
  /**
   * `sidePanel.open` must run synchronously inside the user-gesture handler, so the decision
   * "panel or web tab?" cannot wait for storage. Keep a copy of the settings (keys blanked) in
   * memory, loaded from the settings database (which also migrates 1.3.0 storage on first run).
   * Until the first load resolves we assume the panel, which is the common case.
   */
  let settings: Settings = DEFAULT_SETTINGS;
  const adopt = (s: Settings) => {
    settings = s;
  };
  void loadSettingsWithoutSecrets().then(adopt, (e: unknown) => console.warn('[wys] settings unreadable', e));
  // Every save rewrites the public mirror in storage.local; that change (which also wakes this worker)
  // is the signal to reload from the database. The mirror's content is never trusted: a page can
  // write it too, which only costs a reload, and it is put back to what the database says.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(PUBLIC_KEY in changes)) return;
    void repairPublicMirror(changes[PUBLIC_KEY]?.newValue).catch((e: unknown) => console.warn('[wys] settings mirror', e));
    // The menu offers the user's own questions by their words and place; any change to the list needs new items.
    createMenus(false);
  });
  // An upgrade or a page may have left the mirror out of step while the worker was not running.
  void browser.storage.local
    .get(PUBLIC_KEY)
    .then((r) => repairPublicMirror(r[PUBLIC_KEY]))
    .catch(() => undefined);

  // onInstalled and onStartup can both fire in one worker start (an update applied at launch); the
  // second removeAll must wait for the first chain or the creates interleave into duplicate ids.
  let menus: Promise<void> = Promise.resolve();
  /**
   * Builds the context menu, or with `force` false only when the saved questions differ from the
   * list it was last built from. That list is kept in the settings database, never compared with
   * the in-memory copy (which may still be the defaults right after a wake).
   */
  function createMenus(force = true) {
    menus = menus
      // The items name the user's own question, so the settings are read first (the in-memory copy
      // may still be the defaults when this runs at install or startup).
      .then(() => loadSettingsWithoutSecrets().then(adopt, () => undefined))
      .then(async () => {
        if (!force && !savedQuestionsChanged(settings.ask.saved, await readMenusBuiltFrom())) return;
        await browser.contextMenus.removeAll();
        const builtFrom = [...settings.ask.saved];
        const items = menuItems(builtFrom) as Browser.contextMenus.CreateProperties[];
        // Each create takes a callback that reads lastError: a duplicate id (two registrations in one
        // worker start) is then a handled condition, not an "Unchecked runtime.lastError" entry.
        for (const item of items)
          browser.contextMenus.create(item, () => {
            // Reading it is what marks the error handled; a duplicate id means the other chain already made the item.
            if (browser.runtime.lastError) return;
          });
        await writeMenusBuiltFrom(builtFrom);
      })
      .catch((e: unknown) => console.warn('[wys] context menus', e));
  }

  // A fresh install has nothing to migrate: create the settings record from defaults at once, so the
  // migration from storage.local never runs and a page cannot plant old-format keys for it to adopt.
  // (No content script exists yet: Chrome and Firefox do not inject into tabs open before install.)
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason !== 'install') return;
    void createSettingsRecord(DEFAULT_SETTINGS)
      .then(() => browser.storage.local.get(PUBLIC_KEY))
      .then((s) => repairPublicMirror(s[PUBLIC_KEY]))
      .catch((e: unknown) => console.warn('[wys] first settings record', e));
  });
  browser.runtime.onInstalled.addListener(() => createMenus());
  // The chip on pages cannot ask the commands API; publish the live binding whenever the worker starts.
  const publishShortcut = () =>
    void browser.commands
      .getAll()
      .then(async (all) => {
        // Only when it changed: a write wakes the storage listener in every open tab's content script.
        const shortcut = all.find((c) => c.name === COMMAND_ID)?.shortcut ?? '';
        const stored = await browser.storage.local.get(SHORTCUT_KEY);
        if (stored[SHORTCUT_KEY] !== shortcut) await browser.storage.local.set({ [SHORTCUT_KEY]: shortcut });
      })
      .catch(() => undefined);
  publishShortcut();
  browser.runtime.onInstalled.addListener(publishShortcut);
  browser.runtime.onStartup.addListener(publishShortcut);
  // Firefox does not always run the event page on startup; register on both.
  browser.runtime.onStartup.addListener(() => createMenus());

  /**
   * Where a context-menu check goes: the web tab when Google AI Mode is the default provider,
   * otherwise the panel (opened synchronously here, while the gesture is fresh) plus a queued job.
   * `resolve` may be slow (asking the page); the panel decision cannot wait for it.
   * `askId` (and `index` for a saved question) is the question the clicked item names: the user's
   * choice, so it goes on the input here. A saved question removed since the menu was built is not
   * asked: the click is dropped (the panel may already be open, which is harmless).
   */
  function route(tab: MaybeTab, item: { askId: AskId; index?: number }, quick: CheckInput, resolve?: () => Promise<CheckInput>): void {
    // The in-memory copy may still be the defaults right after the worker woke up: decide the panel
    // synchronously from it (the gesture cannot wait), then re-read before anything irreversible.
    const panelOpened = settings.defaultProvider !== 'webmode';
    let surface = panelOpened ? openPanel(tab) : null;
    void (async () => {
      adopt(await loadSettingsWithoutSecrets());
      const ask = askForMenu(item.askId, settings.ask.saved, item.index);
      if (!ask) return;
      const input: CheckInput = { ...(resolve ? await resolve() : quick), ask };
      if (settings.defaultProvider === 'webmode') {
        await browser.tabs.create({ url: googleAiModeUrl(input, settings.webmodeVariant, defaultAsk(settings)) });
        return;
      }
      surface ??= openPanel(tab); // the stale copy said web mode; a late panel is better than a lost check
      await enqueueJob(input, tab?.id, tab?.windowId, { incognito: tab?.incognito, surface: await surface });
    })().catch((e: unknown) => console.warn('[wys] could not route the check', e));
  }

  browser.contextMenus.onClicked.addListener((info, tab) => {
    // Not on the extension's own pages (a result in the side panel, the options tab): a check there
    // would open a second panel and queue a chrome-extension:// address. Decided here rather than with
    // documentUrlPatterns, which would also hide the items inside about:srcdoc and blob: frames.
    // (pageUrl as well as frameUrl: the saved-page frame inside our own pages is about:srcdoc.)
    const own = browser.runtime.getURL('');
    if ((info.pageUrl ?? '').startsWith(own) || (info.frameUrl ?? '').startsWith(own)) return;
    const pageUrl = info.pageUrl ?? tab?.url ?? '';
    const pageTitle = tab?.title ?? '';
    if (info.menuItemId === MENU_SELECTION_WEB) {
      const text = (info.selectionText ?? '').trim();
      if (!text) return;
      // Re-read first: right after the worker wakes, the in-memory copy may still be the defaults.
      void loadSettingsWithoutSecrets()
        .then(adopt, () => undefined)
        .then(() => browser.tabs.create({ url: googleAiModeUrl({ kind: 'text', text, pageUrl, pageTitle }, settings.webmodeVariant, defaultAsk(settings)) }))
        .catch((e: unknown) => console.warn('[wys] could not open Google AI Mode', e));
      return;
    }
    const item = parseMenuId(info.menuItemId);
    if (!item) return;
    const pick = { askId: item.askId, index: item.index };
    switch (item.target) {
      case 'selection': {
        const text = (info.selectionText ?? '').trim();
        if (!text) return;
        const quick: CheckInput = { kind: 'text', text, pageUrl, pageTitle };
        route(tab, pick, quick, async () => {
          const sel = await resolveSelection(tab, text, info.frameId);
          return { kind: 'text', text: sel.text, pageUrl: sel.pageUrl || pageUrl, pageTitle: sel.pageTitle || pageTitle, surrounding: sel.surrounding };
        });
        return;
      }
      case 'image': {
        if (!info.srcUrl) return;
        route(tab, pick, { kind: 'image', srcUrl: info.srcUrl, pageUrl, pageTitle });
        return;
      }
      case 'post': {
        // Only a web page has a post or a page to check: a file:, about: or view-source: address would
        // send a local path (with the user's name in it) to the provider and check nothing.
        if (!/^https?:/i.test(pageUrl)) return;
        const page: CheckInput = { kind: 'page', url: pageUrl, title: pageTitle };
        route(tab, pick, page, async () => {
          if (tab?.id == null) return page;
          try {
            const reply: unknown = await browser.tabs.sendMessage(tab.id, { type: 'wys:extract-post' });
            const parsed = PostInputSchema.safeParse(reply);
            // The question is the user's, never the page's: drop anything a page-side script put there.
            return parsed.success ? { ...parsed.data, ask: undefined } : page;
          } catch {
            return page; // no content script on this page
          }
        });
        return;
      }
      case 'page': {
        if (!/^https?:/i.test(pageUrl)) return; // as for 'post': nothing on the web to check
        route(tab, pick, { kind: 'page', url: pageUrl, title: pageTitle });
        return;
      }
      case 'link': {
        if (!info.linkUrl || !/^https?:/i.test(info.linkUrl)) return;
        route(tab, pick, { kind: 'page', url: info.linkUrl, title: '' });
        return;
      }
    }
  });

  // Address bar: "wys <text or link>". Enter is a user action, so the panel may open here.
  browser.omnibox.onInputEntered.addListener((text) => {
    const t = text.trim();
    if (!t) return;
    // "example.com/post" is a link too; give it a scheme rather than checking it as text.
    const asLink = /^https?:\/\/\S+$/i.test(t) ? t : /^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(t) ? `https://${t}` : null;
    const input: CheckInput = asLink ? { kind: 'page', url: asLink, title: '' } : { kind: 'text', text: t, pageUrl: '', pageTitle: '' };
    void (async () => {
      adopt(await loadSettingsWithoutSecrets());
      if (settings.defaultProvider === 'webmode') {
        await browser.tabs.create({ url: googleAiModeUrl(input, settings.webmodeVariant, defaultAsk(settings)) });
        return;
      }
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const surface = await openPanel(tab);
      await enqueueJob(input, undefined, tab?.windowId, { incognito: tab?.incognito, surface });
    })().catch((e: unknown) => console.warn('[wys] omnibox check failed', e));
  });
  void browser.omnibox.setDefaultSuggestion({ description: 'Check whether this is true and find its source: %s' });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== COMMAND_ID) return;
    let target = pageTriggerTarget(settings);
    // Synchronously, while the gesture is fresh. Firefox passes the tab; Chrome may not.
    let surface = target === 'panel' && tab ? openPanel(tab) : null;
    void (async () => {
      // The in-memory copy may still be the defaults right after the worker woke up; re-read now
      // that we are async anyway. (The panel may have opened needlessly; harmless.)
      adopt(await loadSettingsWithoutSecrets());
      target = pageTriggerTarget(settings);
      const activeTab = tab ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0];
      if (target === 'panel' && !tab) surface = openPanel(activeTab);
      const sel = await resolveSelection(activeTab, '');
      const pageUrl = sel.pageUrl || activeTab?.url || '';
      if (!sel.text && !/^https?:/i.test(pageUrl)) return; // nothing selected, on a page we cannot read
      // With nothing selected the panel is enough: its home view offers "This page" as an explicit
      // button, so the shortcut never spends a provider call the user did not see coming.
      if (!sel.text && target === 'panel') return;
      const input: CheckInput = sel.text
        ? { kind: 'text', text: sel.text, pageUrl: sel.pageUrl, pageTitle: sel.pageTitle, surrounding: sel.surrounding }
        : { kind: 'page', url: pageUrl, title: sel.pageTitle || activeTab?.title || '' };
      if (target === 'webmode') {
        await browser.tabs.create({ url: googleAiModeUrl(input, settings.webmodeVariant, defaultAsk(settings)) });
      } else {
        await enqueueJob(input, activeTab?.id, activeTab?.windowId, { incognito: activeTab?.incognito, surface: (await surface) ?? undefined });
      }
    })().catch((e: unknown) => console.warn('[wys] shortcut check failed', e));
  });

  // Page-triggered messages come from the chip in a tab's top frame, at human speed. Anything else
  // (no tab, a sub-frame, a burst) is not a click on the chip.
  const lastPageTrigger = new Map<number, number>();
  const fromChip = (sender: Browser.runtime.MessageSender): boolean => {
    const id = sender.tab?.id;
    if (id == null || (sender.frameId ?? 0) !== 0) return false;
    const now = Date.now();
    if (now - (lastPageTrigger.get(id) ?? 0) < 800) return false;
    lastPageTrigger.set(id, now);
    if (lastPageTrigger.size > 200) lastPageTrigger.clear();
    return true;
  };

  browser.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    // Settings for the extension's own pages in a Firefox private window (see `viaBackground` in
    // storage/settings.ts). Refused for anyone else, content scripts included.
    const settingsReply = serveSettingsMessage(raw, sender);
    if (settingsReply) {
      void settingsReply.then(sendResponse);
      return true;
    }
    const parsed = MessageSchema.safeParse(raw);
    if (!parsed.success) return false;
    const msg = parsed.data;
    // The question is the user's, never the page's: a content script cannot choose it.
    // Nor can it claim its text is the user's own question.
    if ('input' in msg) msg.input = { ...msg.input, ask: undefined, ...(msg.input.kind === 'text' ? { question: undefined } : {}) };
    switch (msg.type) {
      case 'wys:check': {
        if (!fromChip(sender)) return false;
        const tab = sender.tab;
        void openPanel(tab)
          .then((surface) => enqueueJob(msg.input, tab?.id, tab?.windowId, { incognito: tab?.incognito, surface }))
          .then(
            () => sendResponse({ ok: true }),
            (e: unknown) => sendResponse({ ok: false, error: String(e) }),
          );
        return true;
      }
      case 'wys:open-webmode': {
        if (!fromChip(sender)) return false;
        void loadSettingsWithoutSecrets()
          .then((fresh) => {
            adopt(fresh);
            return browser.tabs.create({ url: googleAiModeUrl(msg.input, settings.webmodeVariant, defaultAsk(settings)) });
          })
          .then(
            () => sendResponse({ ok: true }),
            (e: unknown) => sendResponse({ ok: false, error: String(e) }),
          );
        return true;
      }
      case 'wys:open-panel': {
        void openPanel(sender.tab);
        sendResponse({ ok: true });
        return false;
      }
      default:
        return false;
    }
  });

  /**
   * Opens the panel (synchronously, inside the gesture) and resolves to where it went: the window's
   * side panel, or the fallback popup window `openPanelSync` focuses or opens when the side panel is
   * refused. The job records it, so a fallback window left open never takes a side panel's job.
   */
  function openPanel(tab: MaybeTab): Promise<'side' | 'window'> {
    return openPanelSync(tab).then(
      () => fallbackWindowFocused().then((fallback) => (fallback ? 'window' : 'side')),
      () => 'side' as const,
    );
  }

  /** The fallback ends with its popup `sidepanel.html` window focused; a side panel leaves the user's window focused. */
  async function fallbackWindowFocused(): Promise<boolean> {
    try {
      const win = await browser.windows.getLastFocused({ populate: true });
      const url = browser.runtime.getURL('/sidepanel.html');
      return win.type === 'popup' && !!win.tabs?.some((t) => t.url?.startsWith(url));
    } catch {
      return false;
    }
  }

  /**
   * Ask the content script for the richer selection (context paragraph); fall back to the menu's text.
   * `frameId` (from the context menu) names the frame the user right-clicked; the top-frame script
   * cannot see selections in other frames. With the menu's text known, a reply that does not hold the
   * same words is the page's choice, not the user's, and is ignored (see selectionTrust.ts).
   */
  async function resolveSelection(tab: MaybeTab, menuText: string, frameId?: number): Promise<SelectionInfo> {
    const base: SelectionInfo = clampSelection({ text: menuText, pageUrl: tab?.url ?? '', pageTitle: tab?.title ?? '' });
    if (tab?.id == null) return base;
    try {
      if (frameId) {
        // Right-clicked inside an iframe: read that frame, nothing else.
        // The page is still the tab's page, not the frame's own address (about:srcdoc, an embed URL).
        const inFrame = await readSelectionFromFrames(tab.id, { frameIds: [frameId] }, menuText);
        if (inFrame) return { ...inFrame, pageUrl: base.pageUrl || inFrame.pageUrl, pageTitle: base.pageTitle || inFrame.pageTitle };
      }
      const reply: unknown = await browser.tabs.sendMessage(tab.id, { type: 'wys:get-selection' });
      const parsed = SelectionInfoSchema.safeParse(reply);
      if (parsed.success && parsed.data.text.trim() && (!menuText || sameSelection(menuText, parsed.data.text))) return parsed.data;
      // The top frame has no selection (or not the one the menu reported): the selection may live in
      // an iframe (a comments widget, an embedded editor), which the content script does not run in.
      const inFrame = await readSelectionFromFrames(tab.id, { allFrames: true }, menuText);
      if (inFrame)
        return {
          ...inFrame,
          pageUrl: parsed.success ? parsed.data.pageUrl : inFrame.pageUrl,
          pageTitle: parsed.success ? parsed.data.pageTitle : inFrame.pageTitle,
        };
    } catch {
      // No content script on this page (loaded before install, or a restricted URL). Try injecting a one-off reader.
      try {
        const r = await readSelectionFromFrames(tab.id, frameId ? { frameIds: [frameId] } : { allFrames: false }, menuText);
        if (r) return frameId ? { ...r, pageUrl: base.pageUrl || r.pageUrl, pageTitle: base.pageTitle || r.pageTitle } : r;
      } catch {
        /* restricted page */
      }
    }
    return base;
  }

  /**
   * Inject a one-off selection reader. Selections persist per document, so when several frames have
   * one, only the frame whose text matches what the browser reported (`menuText`) counts; with no
   * reported text (the shortcut), the first.
   */
  async function readSelectionFromFrames(tabId: number, where: { allFrames?: boolean; frameIds?: number[] }, menuText = ''): Promise<SelectionInfo | null> {
    const target: Browser.scripting.InjectionTarget = where.frameIds ? { tabId, frameIds: where.frameIds } : { tabId, allFrames: where.allFrames ?? false };
    const results = await browser.scripting.executeScript({
      target,
      func: (limits: { text: number; url: number; title: number }) => {
        const sel = window.getSelection();
        return {
          text: sel ? sel.toString().trim().slice(0, limits.text) : '',
          pageUrl: location.href.slice(0, limits.url),
          pageTitle: (typeof document.title === 'string' ? document.title : '').slice(0, limits.title),
        };
      },
      args: [{ text: LIMITS.text, url: LIMITS.url, title: LIMITS.title }],
    });
    const found: SelectionInfo[] = [];
    for (const r of results) {
      const parsed = SelectionInfoSchema.safeParse(r.result);
      if (parsed.success && parsed.data.text.trim()) found.push(parsed.data);
    }
    return pickFrameSelection(found, menuText);
  }
});
