import { browser } from 'wxt/browser';

/** Optional host permissions are requested per origin, on demand, inside a user gesture. */
export function originPattern(url: string): string | null {
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
