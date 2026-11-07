import { browser } from 'wxt/browser';

/**
 * The keyboard shortcut as the browser actually has it bound (users can rebind it), for labels.
 * `Alt+Shift+S` is the shipped default: Firefox owns Ctrl+Shift+S (screenshot) and Cmd+Shift+S
 * is taken on macOS in both browsers, so the old default was dead on half the installs.
 */
export const DEFAULT_SHORTCUT = 'Alt+Shift+S';
export const COMMAND_ID = 'check-selection';

function isMacLike(): boolean {
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform ?? navigator.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** Static label when the commands API is out of reach (content scripts). */
export function shortcutLabelForPlatform(binding = DEFAULT_SHORTCUT): string {
  if (!isMacLike()) return binding;
  return binding
    .replace(/MacCtrl/g, '⌃')
    .replace(/Ctrl|Command/g, '⌘')
    .replace(/Alt/g, '⌥')
    .replace(/Shift/g, '⇧')
    .replace(/\+/g, '');
}

/** The live binding from the browser, the default when it cannot be read, or null when the user unbound it. */
export async function getShortcutLabel(): Promise<string | null> {
  try {
    const all = await browser.commands.getAll();
    const cmd = all.find((c) => c.name === COMMAND_ID);
    if (cmd?.shortcut) return shortcutLabelForPlatform(cmd.shortcut);
    if (cmd && !cmd.shortcut) return null;
  } catch {
    /* no commands API here */
  }
  return shortcutLabelForPlatform();
}
