# Permission justifications (for store review)

Single purpose: check the origin and reliability of text, images and pages the user selects, using an AI provider the user configures.

| Permission | Why it is needed | When it is used |
|---|---|---|
| `contextMenus` | "Fact-check / Explain / Timeline behind / Find flaws and inaccuracies in" items for the selection, image, post, page or link in the right-click menu | Menu creation at install; clicks are user-initiated |
| `storage` | A small copy of the chip settings for the script on pages (`storage.local`; settings and API keys themselves are in the extension's own IndexedDB on this device, never synced) and the pending-job handoff between background and side panel (`storage.session`) | Always |
| `unlimitedStorage` | History keeps page snapshots in IndexedDB; a few hundred checks with snapshots exceed the default quota | When saving a check |
| `activeTab` | Read the selection and take a visible-area screenshot of the tab the user acted on (image fallback, snapshot) | Only after a user gesture on that tab (menu, shortcut, toolbar) |
| `scripting` | Read the selection in the frame the user right-clicked, or on pages loaded before the extension was installed; inject the page-copy script when a check runs | Only when a check is started |
| `sidePanel` (Chrome) / `sidebar_action` (Firefox) | The results UI lives in the side panel | On user action |
| `commands` | `Alt+Shift+S` to check the current selection | On key press |
| Host: `generativelanguage.googleapis.com`, `api.anthropic.com`, `api.openai.com`, `api.search.brave.com`, `api.tavily.com` | Direct calls to the AI / search providers the user may configure, with the user's own key | Only when the user presses Check with that provider selected |
| Host: `localhost`, `127.0.0.1` | Local models (Ollama, LM Studio, llama.cpp) run on the user's own machine | Only when the user configured a local endpoint |
| Host: `factchecktools.googleapis.com` | Look up published fact-checks (ClaimReview index) for the checked claim, with the user's own key | Only during a check, when the lookup is on and a key is set |
| Host: `web.archive.org` | Ask the Wayback Machine when the page and the original source were first archived | Only during a check, when the lookup is on |
| `omnibox` keyword `wys` | Type `wys <text or link>` in the address bar to check it | On Enter |
| **Optional** host: `<all_urls>` | (1) Download the file of an image the user right-clicked when it is on another site than the page; (2) let a local model read the pages its search tool found ("Allow all sites" in the local-model settings); (3) a custom API endpoint or self-hosted SearXNG instance | Requested per site (or all sites, for the local model's page reader), inside a click, with an explanation; declining falls back to a screenshot or search snippets |

The extension downloads a page or an image file itself only from the page the check was started on or from a site the user allowed: per site, or all sites for a local model's page reader. The code checks the grant (`permissions.contains`) before each such download. Without it, an image is read from a screenshot of the visible tab, with an "Allow <site> and check again" button on the result, and a local model works from search snippets only.

Content script (`<all_urls>`, `document_idle`): declared for all sites so the chip can appear on any page, which is why the browser shows access to all sites at install. Chromium also lets the extension's own pages fetch any site because of this declaration; the extension does not rely on that and checks the user's grant itself (above). The content script shows the floating *Check source* chip on text selection (can be disabled globally or per site), answers "what is selected?" when asked, and extracts the post under the cursor for the right-click "… this post" items. It does not read or send page content on its own, does not modify pages, and injects nothing except its own chip inside a closed shadow root. The sanitized copy of a page kept in history is produced by a separate script (`snapshot-capture.js`) injected with `scripting.executeScript` only into the tab a check was started from, at the moment of the check.

No remote code is loaded. No analytics, no telemetry, no third-party scripts.
