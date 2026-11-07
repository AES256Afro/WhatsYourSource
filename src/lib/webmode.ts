import type { CheckInput } from './messaging/protocol';
import { QUESTION } from './pipeline/prompts';
import { truncate } from './util/url';

/**
 * "Google AI Mode" = Google's own AI answer page, outside the add-on. No key, nothing captured.
 * `udm=50` selects AI Mode on google.com (observed 2025–2026; if Google changes it, only this file changes).
 * The query is the same question the in-panel check puts to the model: is it true, and where is the source?
 */
export type WebVariant = 'ai-mode' | 'overview';

/** The user's choice, set once from settings by whichever context builds these URLs. */
let defaultVariant: WebVariant = 'ai-mode';
export function configureWebMode(variant: WebVariant): void {
  defaultVariant = variant;
}

export function googleAiModeUrl(input: CheckInput, variant: WebVariant = defaultVariant): string {
  let q: string;
  switch (input.kind) {
    case 'text':
      q = `${QUESTION} "${truncate(input.text.replace(/\s+/g, ' ').trim(), 900)}"`;
      break;
    case 'image':
      q = /^https?:/i.test(input.srcUrl)
        ? `Is this image real, and where can I find its original source? Image: ${truncate(input.srcUrl, 500)} (seen on ${input.pageUrl})`
        : `Is the image on this page real, and where can I find its original source? ${input.pageUrl}`;
      break;
    case 'page':
      q = `Is what this page says true, and where can I find the source of this topic? ${input.url}`;
      break;
    case 'post':
      q = `Is this ${input.site} post true, and where can I find the source of what it claims? "${truncate(input.text.replace(/\s+/g, ' ').trim(), 800)}"`;
      break;
  }
  // udm=50 is AI Mode; a plain search shows the AI Overview above the results.
  return `https://www.google.com/search?${variant === 'ai-mode' ? 'udm=50&' : ''}q=${encodeURIComponent(q)}`;
}
