# WhatsYourSource — Privacy

**Short version:** nothing leaves your browser until you press *Check*, and then only what you asked about goes to the AI provider *you* configured. The extension has no servers of its own and collects no telemetry.

## What is sent, and to whom

When you check something, the extension sends to your chosen provider:

- the highlighted text (plus the surrounding paragraph for context), **or** the image bytes (downscaled), **or** the page URL and title;
- the address and title of the page it came from;
- a fixed instruction prompt that asks "Is this true, and where can I find the source of this topic?".

Providers you can choose:

| Provider | Where data goes | Notes |
|---|---|---|
| Google AI (Gemini) | `generativelanguage.googleapis.com`, with your own API key | Google's free tier may use prompts to improve its products; a paid key does not. Grounded searches are run by Google. |
| Google AI Mode (web) | A new tab on `google.com` with your text as the query | Nothing is captured by the extension; this is ordinary browsing. |
| Anthropic (Claude) | `api.anthropic.com`, with your own key | Web searches are run by Anthropic. |
| OpenAI-compatible | The endpoint you typed (your own machine for Ollama/LM Studio, or e.g. `api.openai.com`) | A local model never sends anything off your device. If you add a search tool, your search queries go to that tool (SearXNG instance, Brave, Tavily), and pages the model asks to read are fetched by the extension. |

Two optional lookups run beside the AI during a check and can be turned off in Settings → Extra evidence:

| Lookup | Where data goes | What is sent |
|---|---|---|
| Published fact-checks | `factchecktools.googleapis.com`, with your own Google Cloud key | The first sentence (up to ~24 words) of the checked text |
| Wayback Machine dates | `web.archive.org` | The address of the page the content came from, and of the original source the AI found |

Outlet reputation ratings are shipped inside the extension (Wikipedia's perennial-sources list, CC BY-SA) and involve no network request.

The extension never sends data to any other party.

## What is stored, and where

- **Settings and API keys** — `browser.storage.local` on this device. Never synced through your browser account. Keys are kept under a separate storage key that only the extension's own pages read; the script that runs on web pages never loads them. Keys are only ever sent to the provider they belong to.
- **History** — IndexedDB on this device: each result card and, if enabled, a sanitized copy of the page's main content plus a screenshot of the visible area at the time of the check. Snapshots are capped (default 200 MB; oldest removed first). You can delete single checks or clear everything from the History screen. Nothing in history leaves your device unless you export it.
- Saved pages are shown in a sandboxed frame with scripts blocked and images disabled by default; turning images on fetches them from their original hosts, which reveals your IP address to those hosts like normal browsing would.

## What the extension can see

- The content script runs on pages to show the *Check source* chip and read your selection when asked. It does not read or transmit pages on its own.
- Host access to arbitrary sites (`<all_urls>`) is **optional** and requested only when needed: to download an image a site blocks, or so a local model can read pages it finds. You can decline; a screenshot of the visible image is used instead.
- `activeTab` lets the extension take a screenshot of the current tab for snapshots, and only after you clicked the extension's own menu or shortcut on that tab.

## Firefox data-collection disclosure

The manifest declares `websiteContent` as required data collection, because checking a selection inherently sends that selection to the AI provider you chose. No other category applies: no technical/interaction data, no browsing activity, no personal information is collected.

## Contact

Questions and reports: https://github.com/AES256Afro/WhatsYourSource/issues
