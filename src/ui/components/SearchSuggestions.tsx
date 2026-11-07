import { useMemo } from 'react';
import { Label } from './common';

/**
 * Gemini's grounding ToS asks that the Search Suggestions it returns are shown with the answer.
 * The HTML is Google's; we render it in a sandboxed frame so it can't touch the panel. Google's
 * markup is one horizontally scrolling row of chips, so the frame is one row tall and scrolls sideways.
 */
export function SearchSuggestions({ html }: { html: string }) {
  const srcdoc = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https:; base-uri 'none'; form-action 'none'"><base target="_blank"><style>html,body{margin:0;padding:0;background:transparent;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}</style></head><body>${html}</body></html>`,
    [html],
  );
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Related searches · Google</Label>
      <div className="wys-card bg-paper p-2">
        <iframe
          title="Google Search suggestions"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          srcDoc={srcdoc}
          className="block h-[56px] w-full border-0"
        />
      </div>
    </div>
  );
}
