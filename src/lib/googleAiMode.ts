import type { CheckInput } from './messaging/protocol';
import { questionFor, type Ask } from './pipeline/question';
import { truncate } from './util/url';

/**
 * "Google AI Mode" = Google's own AI answer page, outside the add-on. No key, nothing captured.
 * In settings this is the `'webmode'` entry of PROVIDER_IDS: chosen like a provider, never an LLM call.
 * `udm=50` selects AI Mode on google.com (observed 2025–2026; if Google changes it, only this file changes).
 * The query is the same question the in-panel check puts to the model (the user's choice; see pipeline/question.ts).
 */
export type GoogleAiModeVariant = 'ai-mode' | 'overview';

/** `variant` is `settings.webmodeVariant`: AI Mode (conversational) or a normal search with its AI Overview. */
/** `fallbackAsk` is the default question from settings, used when the input does not carry its own. */
export function googleAiModeUrl(input: CheckInput, variant: GoogleAiModeVariant, fallbackAsk?: Ask): string {
  const ask = input.ask ?? fallbackAsk;
  let q: string;
  switch (input.kind) {
    case 'text':
      q = `${questionFor(ask, 'text')} "${truncate(input.text.replace(/\s+/g, ' ').trim(), 900)}"`;
      break;
    case 'image':
      q = /^https?:/i.test(input.srcUrl)
        ? `${questionFor(ask, 'image')} Image: ${truncate(input.srcUrl, 500)} (seen on ${webOnly(input.pageUrl)})`
        : `${questionFor(ask, 'image')} It is on this page: ${webOnly(input.pageUrl)}`;
      break;
    case 'page':
      q = `${questionFor(ask, 'page')} ${webOnly(input.url)}`;
      break;
    case 'post':
      q = `${questionFor(ask, 'post').replace('this post', `this ${input.site} post`)} "${truncate(input.text.replace(/\s+/g, ' ').trim(), 800)}"`;
      break;
  }
  // udm=50 is AI Mode; a plain search shows the AI Overview above the results.
  return `https://www.google.com/search?${variant === 'ai-mode' ? 'udm=50&' : ''}q=${encodeURIComponent(q.toWellFormed())}`;
}

/** Only web addresses go into a Google query: never a `file:` path or an extension page. */
function webOnly(url: string): string {
  return /^https?:\/\//i.test(url) ? url : '';
}
