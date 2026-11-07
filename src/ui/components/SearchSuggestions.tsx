import { useMemo } from 'react';
import { Label } from './common';

/**
 * Gemini's grounding ToS asks that the Search Suggestions it returns are shown with the answer.
 * The HTML is Google's; we render it in a sandboxed frame so it can't touch the panel. Google's
 * markup is one horizontally scrolling row of chips, so the frame is one row tall and scrolls sideways.
 */
/** Google's markup carries a script tag; the frame's CSP blocks it anyway, but silently is better than a console error per result. */
function withoutScripts(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const el of doc.querySelectorAll('script, iframe, object, embed')) el.remove();
  return doc.body.innerHTML;
}

export function SearchSuggestions({ html }: { html: string }) {
  const srcdoc = useMemo(
    () =>
      // Google's chips bring their own light-theme colours, so the frame stays a light tile in dark mode too.
      `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https:; base-uri 'none'; form-action 'none'"><base target="_blank"><style>html,body{margin:0;padding:0;background:#fff;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}</style></head><body>${withoutScripts(html)}</body></html>`,
    [html],
  );
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Related searches · Google</Label>
      <div className="wys-card rounded-xl bg-white p-2 focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-paper">
        <iframe
          title="Google Search suggestions"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          srcDoc={srcdoc}
          className="block h-[60px] w-full border-0"
        />
      </div>
    </div>
  );
}
