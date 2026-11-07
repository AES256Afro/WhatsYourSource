import { browser, type Browser } from 'wxt/browser';

/**
 * The tab the user means. Normally the active tab of the current window. When one of our own
 * pages is itself the active tab (popup or panel opened as a tab), pick the most recently used
 * other tab. We deliberately don't hold the `tabs` permission, so `url`/`title` may be missing
 * here; callers get those from the content script's reply instead.
 */
export async function getTargetTab(): Promise<Browser.tabs.Tab | undefined> {
  const [active] = await browser.tabs.query({ active: true, currentWindow: true });
  let self: Browser.tabs.Tab | undefined;
  try {
    self = await browser.tabs.getCurrent();
  } catch {
    self = undefined;
  }
  if (!active || self?.id == null || active.id !== self.id) return active;
  const all = await browser.tabs.query({ currentWindow: true });
  const others = all.filter((t) => t.id !== self.id);
  if (others.length === 0) {
    // Alone in a popup window (the fallback panel): the user's page is in the last focused normal window.
    try {
      const win = await browser.windows.getLastFocused({ windowTypes: ['normal'], populate: true });
      const t = win.tabs?.find((x) => x.active);
      if (t) return t;
    } catch {
      /* no normal window */
    }
    return active;
  }
  others.sort((a, b) => ((b as { lastAccessed?: number }).lastAccessed ?? 0) - ((a as { lastAccessed?: number }).lastAccessed ?? 0));
  return others[0] ?? active;
}
