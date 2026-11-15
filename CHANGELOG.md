# Changelog

All notable changes to WhatsYourSource. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.1.0] - 2026-11-15

Three bug sweeps and a follow-up check, three performance sweeps and three usability sweeps on top of 1.0.2; the ledger entry is in `docs/SWEEPS.md` (2026-11-15, second entry).

### Added
- Choose what to ask. Five questions: Fact-check (now "is it accurate, what context is it missing, where is the original source"), Explain it, Timeline, Find the flaws, or your own question in your own words. Pick one on the panel's home screen for the checks you start there, set the default in Settings or the popup for highlighting, the shortcut, right-click and the address bar; the same question goes to Google AI Mode. The on-page chip names the question when it is not a fact-check.
- "Ask instead" on every result and saved check: put a different question to the same content, with a link back to the earlier answer.
- Timeline: results can carry dated events with their sources; when a timeline was asked for it comes straight after the verdict. For any question other than a fact-check, the answer leads and published fact-checks follow it.
- Every check gets a short title and a topic from the same model call (no extra request), used in history search and exports.
- Spreadsheet export in History: one row per check (date, title, topic, what was checked, page address, question, verdict, summary, answer, timeline, claims, original source, sources, archived copy, note) as a CSV that Excel, Google Sheets and Numbers open directly. It follows the search and filter.
- "Copy as spreadsheet row" and "Copy column headings" on every result and saved check, for adding to a sheet you already keep.

### Fixed
- The popup's and Settings' dropdowns (default action, Google page type, and the new Question) did not save: the choice snapped back.
- Right-click items had disappeared inside embedded frames (webmail message bodies, widgets) in 1.0.2; they are back, and still absent on the extension's own pages.
- "Check source of this post" on sites that build posts as web components found nothing in 1.0.2.
- The chip no longer comes back a moment after it is clicked; a triple-clicked paragraph followed by a comment, script or empty block gets its chip.
- AI-generator hints: tool names written with a version or underscore ("Imagen3", "sdxl_turbo") are recognised again, and a Stable Diffusion parameters block is found even after a long prompt.
- A reply that is only a local model's reasoning is reported as empty instead of being turned into a verdict.
- A different model typed after Verify no longer inherits the previous model's "text only" flag.
- Outlet ratings appear with the result instead of waiting up to six seconds for the Wayback Machine. A slow claim-listing pass (a local model) is stopped after ten seconds and no longer drops the fact-check lookup.
- Provider settings fields no longer run off the edge of a 320-pixel panel; the History footer wraps.
- The backup pages through history instead of holding it all in memory.

### Changed
- The popup no longer loads every provider's code to show a label; the History view loads on first use.
- Store screenshots are plain captures of the panel (three side by side, no scene, no captions); the promo tiles are the icon and the name. The old images and the scene that produced them are removed.
- Store and privacy documents describe the chosen question.

## [1.0.2] - 2026-11-15

Five audits (in-page script, background, providers and network, panel and history, release readiness); the ledger entry is in `docs/SWEEPS.md`.

### Fixed
- Nothing of the extension stays in a page while the chip is hidden: the chip's element is added when it shows and removed when it goes, so it can never be part of a selection or a copy. Measured: what Chrome puts on the clipboard is byte-for-byte the same with and without the extension.
- After an update or after switching the extension off, tabs that were already open no longer keep a dead chip that does nothing when clicked; the old script retires itself.
- Text cut in the middle of an emoji no longer breaks "Open in Google AI Mode", the shortcut, or a finished result (which could land on "Something went wrong").
- Reading a selection is bounded: a selection with very long runs of spaces could block the tab for seconds; the context paragraph is the text around the selection, not the first 1,200 characters of its block, and a table cell holding the whole page is skipped.
- Saved pages keep `dir`, `lang`, `colspan`, `rowspan`, list numbering and image sizes (right-to-left pages rendered left-to-right, tables lost their spans).
- Evidence that arrives after a result is saved no longer wipes a note typed in the meantime or brings back a check you deleted.
- A check shows "Checking…" at once in single-pass mode and for images (it could sit on the home screen for up to 2.5 seconds).
- The first Test on a local server shows its result; Verify can no longer stay stuck on "Connecting…".
- "Check source of this post" uses the element you right-clicked even on sites that swallow the event or build posts as web components; links to sites whose name contains "t.co" (washingtonpost.com, reddit.com) are no longer dropped.
- A crashed view no longer survives navigation; a failed history open is retried instead of leaving "Loading…".
- Transparent images are sent on white, not black; the image size reported is the decoded one, not a tag inside the file.
- Copy as Markdown quotes every line of a multi-line selection and never puts a megabyte of inline image data on the clipboard.

### Security
- The chip cannot be restyled by a page (stretched or made invisible to catch clicks), ignores scripted clicks, and the background accepts its messages only from a tab's top frame, at most one per 800 ms.
- "Likely original source" is a live link only when the provider actually retrieved that address; one the model merely wrote is shown as text.
- An API key no longer follows the endpoint to another host when you switch the OpenAI-style preset or edit the address.
- The Fact Check Tools key is sent in a header, not in the address. Local and private addresses are never sent to the Wayback Machine or into a Google AI Mode query.
- AI-generator hints are read only from the fields a tool writes about itself, with whole-word matches ("Imagen de archivo", a photo of fireflies).
- The content script no longer announces the extension's id to every page.
- The right-click items appear on web pages and local files only, not on the extension's own pages.

### Changed
- Store documents say 1.0.2 and describe what is sent, and when a page copy is kept, as the code does it. CI runs lint and the format check.

## [1.0.1] - 2026-11-12

### Fixed
- The six "Unchecked runtime.lastError: Cannot create item with duplicate id" entries that appeared under the extension on chrome://extensions after a Chrome or extension update: the context menus were being created twice at once; they are now created through one chain, with the result read.
- The on-page chip no longer does work that grows with the page after every selection change or key release: on very long pages a select-all or the copy shortcut cost up to a few hundred milliseconds in that tab. It now measures one character at the end of the selection, never serialises the selection until you click, and skips select-all.
- A check on a page with more than 25,000 elements no longer runs Readability over the whole document (seconds of blocking); the check is saved without a page copy.
- Two-pass checking and the repair pass were silently inert on Gemini and the hosted OpenAI-style presets: their native JSON mode answers without a code fence, which the parser did not accept.
- A result is now written to history the moment it is shown; starting another check (a second opinion, say) while the slow evidence lookups were still running used to lose it.
- A lookup finishing after you had opened History or Settings no longer pulls the panel back to the result.
- Right-click, chip and address-bar checks re-read the settings before deciding where to go; right after the background worker woke up they could use the defaults (panel instead of Google AI Mode, AI Mode instead of the Overview page).
- Queued checks older than a minute are dropped instead of running the next time a panel opens.

## [1.0.0] - 2026-11-07

First store release. Everything below was landed between the 0.1.0 development builds and this version, across one Stage 1 loop (code, bug and security audits, 8 sweeps) and one Stage 2 loop (readability, usability, visual, quality-of-life, feature and optimization sweeps, 3 each); the ledger is in `docs/SWEEPS.md`.

### Added
- Seen before: an image you have checked already is recognised by its on-device fingerprint, with a link to the earlier result.
- Right-click a link → "Check source of linked page".
- A second opinion links back to the result it answers.
- The claims found by the first pass show in the checking view while the main pass runs; the listing pass runs on the provider's cheapest model.
- Local models: "Test search" runs one real query through SearXNG, Brave or Tavily; a model the server says cannot call tools skips the tool round; reasoning (`<think>`) is stripped from Qwen3 / DeepSeek-style answers; requests carry `max_tokens` so JSON is not cut off.
- Home says what a check will send and to which provider; history search covers source domains, titles and the original source.
- The on-page chip shows the keyboard shortcut as it is actually bound, and no hint when it is unbound.
- Cancel lands at once on a quiet "Check cancelled" card.
- "What was sent, and to whom" now lists everything that left the browser, including lookups and search providers, and what was kept locally; Copy as Markdown includes fact-checks, evidence and outlet ratings.
- Archive dates link to the archived copy; a Verify button for the Fact Check Tools key.
- Second opinion: run the same check on another configured provider from the result.
- Two-pass checking: the claims are listed first on the provider’s cheapest model, each is looked up in the fact-check index, then all are verified in one pass; the claims show while you wait. Can be turned off in Settings.
- Local models: LM Studio and Ollama report which models can see images and call tools; text-only models decline image checks with a hint instead of a server error.
- More servers: Jan, vLLM, OpenRouter, Groq, Together AI presets; Google AI Overview as an alternative to AI Mode.
- Published fact-checks (Google Fact Check Tools index, free key) shown above the verdict and given to the AI; Wayback Machine first-archived dates for the page and the original source with an "Archive it now" link; outlet reputation pills from Wikipedia's perennial-sources list. All three can be switched off under Settings → Extra evidence.
- The strongest evidence for and against, what the content leaves out, and what would change the verdict, on every result.
- Address-bar keyword `wys`; a "What was sent, and to whom" block on every result.
- "New check" on every result; a "Checking…" pill in the top bar leads back to a check in progress; Escape goes back.
- Verify button for the Gemini key during first run; "Finish without a key" routes checks to Google AI Mode until a key is added.
- Unverified sources show their address with a copy button; "Open all N" confirms above five tabs.
- Screen-reader support: live progress and status announcements, real headings, labelled toggles and selects, keyboard-operable tabs; focus follows each step of a check.
- `MILESTONES.md`: the plan from the current state to store release.
- `docs/SWEEPS.md`: the audit ledger (Stage 1 code/bug/security sweeps, Stage 2 quality sweeps).
- MIT `LICENSE`.
- ESLint (typescript-eslint strict, react-hooks) and Prettier; `npm run lint`, `npm run format`.
- `snapshot.html`: saved pages open in their own tab inside a sandboxed frame.
- Shortcut labels follow the live key binding.

### Changed
- The panel loads Settings, History, Detail and first-run screens on first use, and the image-metadata reader only for image checks: about 150 KB less to parse before the first paint; streamed answers render at most 25 times a second.
- Escape stays inside a text field; notes are saved when you leave the detail view however you leave it.
- Page snapshots are captured by a script injected only at check time; the script that runs on every page shrank from 165 KB to 13 KB.
- Result layout answers the two questions in order: verdict first, likely original source second, then the assessment, claims and sources; "Compare in Google AI Mode" is a link, not the primary button.
- One vocabulary for the four ways to check (Gemini (your key), Google AI Mode (web), Claude (your key), Local or OpenAI-style model) across onboarding, settings, home and errors; settings copy rewritten in plain language.
- Verify/Test results appear under the button; error hints say what to do and open Settings at the failing provider.
- Dark mode: verdict banner and confidence rings use theme tokens; control borders meet the 3:1 contrast line; Google suggestion chips follow the theme.
- Narrower panels (320 px) keep every action reachable; onboarding fits without scrolling.
- Opening an old image check from History no longer contacts the image's host until you ask it to.
- History search is debounced and storage totals come from an index (no more loading every saved page to count bytes).
- JSON export is streamed, so very large histories export too.
- Default shortcut is `Alt+Shift+S` (Firefox owns `Ctrl+Shift+S`; `Cmd+Shift+S` is taken on macOS).
- "Check source of this post / page" menu items appear only when no selection or image is under the cursor.
- The floating chip and the shortcut open Google AI Mode directly when that is the chosen trigger or default, without opening the side panel.

### Fixed
- Manifest description fits the Chrome Web Store limit.
- Right-clicking a selection inside a frame checks that frame's selection, not an older one elsewhere.
- A failed save or export now says so instead of failing silently; a crashing view shows a recovery button instead of a blank panel.
- Selecting text inside an embedded frame (comment widgets, editors) is checked as a selection, not as the whole page.
- RSS, XML and SVG documents no longer break the extension's page script.
- The page-snapshot storage limit is now actually enforced (the eviction routine failed silently in real browsers).
- A check started before finishing first-run setup is shown, not hidden behind the welcome screen.
- Re-checking an inline image finds the page it was on; an empty model reply is reported as an error instead of an empty card.
- History pages through older checks instead of stopping at 300; links in exported saved pages open.
- Starting a new check while one was running no longer leaves the panel on "Cancelled".
- A check now runs in exactly one panel even when several panels (or the fallback window) are open.
- Streaming answers no longer lose text when a line break falls on a network chunk boundary.
- Very large inline images are checked via a screenshot instead of being dropped; partly scrolled images are cropped to what is on screen.
- Model answers with a missing source URL or an empty claim no longer fall back to the "prose only" banner.
- Post text from X, Reddit and similar keeps its line breaks instead of running together.
- Two quick settings edits can no longer overwrite each other; the storage-limit field no longer rewrites itself while typing.
- History groups and dates are correct across daylight-saving changes and across years.
- "Likely original source" links only when it is exactly that page.
- Local models on Firefox: the default MV3 content-security policy upgraded `http://localhost` calls to `https`, so Ollama and LM Studio never answered.
- The floating chip no longer appears while selecting text you are typing in a form field or editor.
- "Open all" sources opens every link, not just the first (popup blockers stopped the rest).
- Gemini price estimates were double the current list price for 3.8 Flash; `gemini-4-argon` added to the model menu.
- The keyboard shortcut lost the user gesture and opened a detached window instead of the side panel.
- One invalid stored setting no longer resets every other setting to its default.
- Pasted text is no longer attributed to the page that happened to be open.
- Progress row said "Searched Google" for every provider.

### Security
- Image metadata and every page-derived field (title, URL, author, time, links) are passed to the model as untrusted data; the untrusted delimiter can no longer be closed by content.
- A local model may only read pages that its own search returned, that the checked content linked, or the page the selection came from, and always at the address the search gave (no query-string payloads); redirects are never followed.
- Screenshots for snapshots and image checks are taken only while the checked page is still the active tab.
- Page snapshots are taken only of the page the check came from, never of whatever tab is active.
- The floating chip responds only to selections made by real input, and never inside form fields or editors.
- Plain-http endpoints off this machine show a warning before a key travels unencrypted.
- API keys are stored apart from the settings the content script reads on web pages.
- The local-model `fetch_page` tool only reaches public hosts, never the user's own endpoints, and caps response bodies.
- Saved pages are never rendered from a `blob:` URL with the extension's origin; `data:` links are stripped from snapshots.
- Gemini Search Suggestions render under their own CSP.

## [0.1.0] - 2026-10-18

Initial development builds: text, image, post and page checks; Gemini, Google AI Mode, Anthropic and OpenAI-compatible providers; local history with page snapshots; on-device image provenance.
