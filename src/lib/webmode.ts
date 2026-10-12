import type { CheckInput } from './messaging/protocol';
import { truncate } from './util/url';

/**
 * "Google AI Mode" = Google's own AI answer page, outside the add-on. No key, nothing captured.
 * `udm=50` selects AI Mode on google.com (observed 2025–2026; if Google changes it, only this file changes).
 */
export function googleAiModeUrl(input: CheckInput): string {
  let q: string;
  switch (input.kind) {
    case 'text':
      q = `Where does this text originally come from, who said it, and is it accurate? "${truncate(input.text.replace(/\s+/g, ' ').trim(), 900)}"`;
      break;
    case 'image':
      q = `What is the original source of the image at ${input.srcUrl} and is it presented accurately on ${input.pageUrl}?`;
      break;
    case 'page':
      q = `Who is behind ${input.url}, is it an original source, and do its main claims hold up?`;
      break;
    case 'post':
      q = `Is this ${input.site} post accurate and where do its claims originally come from? "${truncate(input.text.replace(/\s+/g, ' ').trim(), 800)}"`;
      break;
  }
  return `https://www.google.com/search?udm=50&q=${encodeURIComponent(q)}`;
}
