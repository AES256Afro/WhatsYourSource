import type { CheckInput } from './messaging/protocol';
import { QUESTION } from './pipeline/prompts';
import { truncate } from './util/url';

/**
 * "Google AI Mode" = Google's own AI answer page, outside the add-on. No key, nothing captured.
 * In settings this is the `'webmode'` entry of PROVIDER_IDS: chosen like a provider, never an LLM call.
 * `udm=50` selects AI Mode on google.com (observed 2025–2026; if Google changes it, only this file changes).
 * The query is the same question the in-panel check puts to the model: is it true, and where is the source?
 */
export type GoogleAiModeVariant = 'ai-mode' | 'overview';

/** `variant` is `settings.webmodeVariant`: AI Mode (conversational) or a normal search with its AI Overview. */
export function googleAiModeUrl(input: CheckInput, variant: GoogleAiModeVariant = 'ai-mode'): string {
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
