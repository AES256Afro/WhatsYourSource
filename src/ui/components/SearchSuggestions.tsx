import { useMemo } from 'react';
import { Label } from './common';

/**
 * Gemini's grounding ToS asks that the Search Suggestions it returns are shown with the answer.
 * The HTML is Google's; we render it in a sandboxed frame so it can't touch the panel.
 */
export function SearchSuggestions({ html }: { html: string }) {
  const srcdoc = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style></head><body>${html}</body></html>`,
    [html],
  );
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Related searches · Google</Label>
      <iframe
        title="Google Search suggestions"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        srcDoc={srcdoc}
        className="h-[72px] w-full border-0"
      />
    </div>
  );
}
