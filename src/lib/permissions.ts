import { browser } from 'wxt/browser';

/** Optional host permissions are requested per origin, on demand, inside a user gesture. */
function originPattern(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    return `${u.origin}/*`;
  } catch {
    return null;
  }
}

export async function hasOrigin(url: string): Promise<boolean> {
  const p = originPattern(url);
  if (!p) return false;
  try {
    return await browser.permissions.contains({ origins: [p] });
  } catch {
    return false;
  }
}

/** Must be called from a click handler. */
export async function requestOrigin(url: string): Promise<boolean> {
  const p = originPattern(url);
  if (!p) return false;
  try {
    return await browser.permissions.request({ origins: [p] });
  } catch {
    return false;
  }
}

export async function hasAllUrls(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: ['<all_urls>'] });
  } catch {
    return false;
  }
}

export async function requestAllUrls(): Promise<boolean> {
  try {
    return await browser.permissions.request({ origins: ['<all_urls>'] });
  } catch {
    return false;
  }
}

/** Gives back "Allow all sites"; true when it is no longer granted. */
export async function removeAllUrls(): Promise<boolean> {
  try {
    await browser.permissions.remove({ origins: ['<all_urls>'] });
  } catch {
    /* reported through the re-read below */
  }
  return !(await hasAllUrls());
}

/**
 * Whether the user granted the extension access to this URL's site: that site, all sites, or one of
 * the manifest's fixed hosts (localhost, the provider APIs).
 *
 * The browser alone is not the gate here. Chromium counts the content script's `<all_urls>` match as
 * host access for the extension's own pages, so a fetch from the side panel reaches any site whether
 * or not the user granted it. `permissions.contains` does not count content-script matches (measured
 * in Chromium: false for a site and for `<all_urls>` until granted, true after), so it is the check
 * every extension-initiated page or image download goes through. Any error counts as "no access".
 */
export async function hasHostAccess(url: string): Promise<boolean> {
  const p = originPattern(url);
  if (!p) return false;
  try {
    if (await browser.permissions.contains({ origins: [p] })) return true;
    return await browser.permissions.contains({ origins: ['<all_urls>'] });
  } catch {
    return false;
  }
}
