import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { SelectionInfoSchema, type SelectionInfo } from '@/lib/messaging/protocol';
import { getTargetTab } from '@/lib/tabs';

export interface TargetTab {
  id?: number;
  windowId?: number;
  url: string;
  title: string;
}

/**
 * The tab a check would apply to and whatever is selected in it. The content script reports the page
 * URL and title too, because the extension does not hold the `tabs` permission. With `watchTabs`, the
 * answer follows tab switches and page loads (the side panel stays open; the popup does not).
 */
export function useTargetSelection(watchTabs = false): { tab: TargetTab | null; selection: SelectionInfo | null } {
  const [tab, setTab] = useState<TargetTab | null>(null);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);

  useEffect(() => {
    let alive = true;
    // Refreshes overlap (a tab switch while the previous tab is slow to answer); only the latest may
    // write, or a late reply from the tab the user left would replace the one now shown.
    let latest = 0;
    const refresh = async () => {
      const mine = ++latest;
      const current = () => alive && mine === latest;
      const t = await getTargetTab();
      if (!current()) return;
      setTab(t ? { id: t.id, windowId: t.windowId, url: t.url ?? '', title: t.title ?? '' } : null);
      if (t?.id == null) return setSelection(null);
      try {
        const reply: unknown = await browser.tabs.sendMessage(t.id, { type: 'wys:get-selection' });
        const parsed = SelectionInfoSchema.safeParse(reply);
        if (!current()) return;
        if (parsed.success) {
          setTab({ id: t.id, windowId: t.windowId, url: parsed.data.pageUrl || t.url || '', title: parsed.data.pageTitle || t.title || '' });
          setSelection(parsed.data.text.trim() ? parsed.data : null);
        } else setSelection(null);
      } catch {
        // No content script on this page (restricted, or loaded before the extension was installed).
        if (current()) setSelection(null);
      }
    };
    void refresh();
    if (!watchTabs) {
      return () => {
        alive = false;
      };
    }
    const onActivated = () => void refresh();
    // onUpdated fires for every tab on every change; only a finished load of the active tab matters here.
    const onUpdated = (_id: number, info: { status?: string }, t: { active?: boolean }) => {
      if (info.status === 'complete' && t.active) void refresh();
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      alive = false;
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [watchTabs]);

  return { tab, selection };
}
