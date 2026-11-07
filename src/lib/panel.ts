import { browser } from 'wxt/browser';

interface PanelApis {
  sidePanel?: { open(opts: { windowId?: number; tabId?: number }): Promise<void> };
  sidebarAction?: { open(): Promise<void> };
}

/**
 * Open the side panel (Chrome) or sidebar (Firefox) for a tab. Must be called synchronously inside
 * a user-gesture handler, with no `await` before it, or both browsers refuse. Falls back to a
 * detached popup window when neither API exists or the call is rejected.
 */
export function openPanelSync(tab: { id?: number; windowId?: number } | undefined, onNoApi?: () => void): Promise<void> {
  const apis = browser as unknown as PanelApis;
  const fallback = async () => {
    // Reuse a panel window we already opened rather than stacking a new one per click.
    const url = browser.runtime.getURL('/sidepanel.html');
    try {
      const wins = await browser.windows.getAll({ populate: true, windowTypes: ['popup'] });
      const mine = wins.find((w) => w.tabs?.some((t) => t.url?.startsWith(url)));
      if (mine?.id != null) {
        await browser.windows.update(mine.id, { focused: true });
        return;
      }
    } catch {
      /* fall through */
    }
    await browser.windows.create({ url, type: 'popup', width: 420, height: 840 });
  };
  try {
    if (apis.sidePanel?.open) {
      const opts = tab?.windowId != null ? { windowId: tab.windowId } : { tabId: tab?.id };
      return apis.sidePanel.open(opts).catch((e: unknown) => {
        console.warn('[wys] sidePanel.open failed, opening a window instead', e);
        return fallback();
      });
    }
    if (apis.sidebarAction?.open) {
      return apis.sidebarAction.open().catch((e: unknown) => {
        console.warn('[wys] sidebarAction.open failed, opening a window instead', e);
        return fallback();
      });
    }
  } catch (e) {
    console.warn('[wys] no side panel API', e);
  }
  if (onNoApi) {
    onNoApi();
    return Promise.resolve();
  }
  return fallback();
}
