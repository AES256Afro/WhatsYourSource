# Changelog

All notable changes to WhatsYourSource. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Security
- A right-click check uses the words the browser reported when the menu opened. The page's own copy of the selection (its line breaks and the surrounding paragraph) is used only when it holds exactly those words. Before, a page could swap, extend or (in a frame) replace the selection after the right-click and have its own text checked under the user's pick.
- The "Check source" chip sends only the selection it was shown for. A selection the page changes while the chip is up takes the chip away, and one swapped in as the chip is pressed is refused.
- The chip refuses a click when the page has moved, faded, filtered or zoomed it or the page root, and is thrown away when the page touches its element. In Chromium it also refuses when anything covers it, including a click-through overlay in the top layer.
- A page can no longer switch the chip off by sending WXT's "newer script started" event; only an extension that has been updated or disabled retires it.

## [1.3.1] - 2026-11-27

### Security
- API keys and settings no longer live in `browser.storage.local`, which the script that runs on web pages can read and write. They are in the extension's own IndexedDB database (`wys-settings`), which pages and that script cannot open. Before, a compromised page process could read every key, receive them on each save, and rewrite the model endpoint so later checks and the key went to another server (reproduced against 1.3.0 in Chromium; the same attack finds nothing on this build).
- The page script now gets a small public copy with only the chip settings (on/off, blocked sites, what the chip opens, the default question's name) and a change counter; no keys, endpoints or question texts. A forged copy is put back, and nothing trusted reads it as settings.
- Existing settings and keys move to the new database the first time the new version starts (once, even with several panels open), and the old `settings` and `secrets` entries are deleted. A fresh install creates its settings record at install time, so nothing is ever read from `storage.local`.
- Firefox private windows reach settings through the background, which answers only the extension's own pages.

## [1.3.0] - 2026-11-27

### Added
- Ask the model a question directly: a box on the side panel's home screen sends a question with nothing selected, and the answer comes with sources, is saved to history and takes follow-up questions like any check. In Google AI Mode it opens a search for the question.
- Saved questions: add, edit and remove up to eight questions of your own in Settings → Your questions, or save the one typed under "Ask your own" on the home screen. Each appears on the right-click menu (under "Your questions about …" when there are two or more), on the home screen's picker and in the popup, and any of them can be the default. A question saved in 1.2.x becomes the first one.
- Two new questions: **Summarize** (selection, post, article) and **Find more sources** (selection, post, article: other reporting, the original or primary source, and what confirms or contradicts it).

### Changed
- **Explain it** now asks what they are talking about and explains it in plain terms with the background needed to follow it.
- Right-click items for a whole page say "this article" (for example "Fact-check this article", "Summarize this article").
- Source links are stored, shown, copied and exported without tracking parameters (`utm_*`, `fbclid`, `gclid`, `msclkid`, mail and analytics ids, YouTube and Spotify share ids), and common redirect wrappers (Google, Facebook, Instagram, LinkedIn, YouTube) are unwrapped to the real address. Checks already in history are cleaned when read. Gemini's grounding links are redirect tokens and stay as they are.
- The local model's page reader is called "Page reader" in Settings, shows whether it is allowed, and can be removed.
- Privacy policy, permissions document and store texts describe host access as it now works, and the privacy policy covers direct questions and follow-ups.

### Fixed
- Host access is enforced by the extension. The content script runs on every site so the chip can appear, and Chrome treats that as access for the extension's own pages too, so the optional "all sites" permission gated nothing. Now a local model reads pages only after you allow the page reader (otherwise it works from search snippets), and an image file is downloaded only from the page's own site or a site you allowed; otherwise the image is read from a screenshot and the result offers "Allow <site> and check again".
- The "Ask instead" buttons under a result list every saved question by its own words.
- The privacy line in Settings no longer mentions a Check button that does not exist, and says the Extra evidence lookups also send the claim or address.

## [1.2.1] - 2026-11-27

### Added
- `THIRD_PARTY_NOTICES.txt` ships in every build: the licence of each bundled package (React, ReactDOM, scheduler, zod, idb, DOMPurify, Readability, exifr, Tailwind CSS, WXT) and the CC BY-SA 4.0 attribution for the Wikipedia outlet ratings. `npm run notices` regenerates it.

### Changed
- The outlet-ratings note under Sources links to the Wikipedia page it is adapted from and to the CC BY-SA 4.0 licence. README and LICENSE say that data file is CC BY-SA 4.0, not MIT.
- Outlet rating pills are outlined instead of filled; "Reliable" no longer uses the green of a "Supported" claim. Finished progress steps have a neutral tick.
- Wording: the home screen and the popup no longer say right-click asks the default question; the popup says when no key or model is set up; the home hint does not promise the chip when it is off.
- `engines.node` is `^22.12.0 || ^24.0.0 || >=26.0.0`.

### Fixed
- Base element styles (link colour, `font: inherit` on controls) sat outside any cascade layer and overrode button and text utilities; they are in the base layer now.
- Dark mode uses dark scrollbars and native controls; placeholder text meets 4.5:1 in light mode.
- Buttons marked unavailable look unavailable and do not change on hover; disabled inputs look disabled.
- With "reduce motion" set in the system, the spinners, caret and loading placeholders stop moving.
- In forced-colours (High Contrast) mode, switches have a border and show on/off; the selected question, filter and tab are outlined.
- Model text, claims and the selection follow their own writing direction (right-to-left text is laid out right to left), and a long URL in an answer wraps instead of scrolling the result sideways.
- The top bar keeps History and Settings inside a narrow or zoomed panel; progress rows grow with a long status line.
- The saved-page tab's header wraps instead of clipping the image-loading warning, and the saved page's text is at most 72 characters wide.
- Tailwind scans only `src/`, so text in docs or other build output no longer adds CSS to the build.
- `npm run screenshots` checks the preview is running before it changes anything, and replaces `store/` only after every image is made.
- Checks started in a private window are not saved to history, and no page copy or screenshot is taken ("Not saved: private window").
- "Fact-check this page/post" does nothing on `file:`, `about:` and `view-source:` pages, and no prompt carries a non-web address (a local file path, with the user name in it, was sent to the provider).
- The Wayback Machine lookup sends only the page's scheme, host and path, never its query string or fragment.
- The image type a server or `data:` URL declares no longer reaches the "measured locally" facts given to the model or shown in the panel; only known image types are named.
- Search results and pages read by a local model, and the up-front search block, are passed to the model as untrusted content; a local-model check makes at most 12 tool calls.
- Gemini calls set an output-token limit; reasoning (`<think>`) text is stripped in linear time, so a very long answer no longer freezes the panel.
- An answer that stopped early (token limit, content filter) is marked incomplete instead of being accepted; a refusal is reported as declined, not as an empty answer.
- Error codes: a wrong or expired Gemini key is reported as a key problem; 402, 408 and other client errors map to quota, server and bad request; errors that arrive mid-answer keep their real code, so fallback works.
- Model answers with a wrongly typed optional field, upper-case verdict words, a four-backtick fence or braces inside strings are read instead of costing a repair call; a repaired answer no longer shows raw JSON as the assessment; the claim list uses the same repair.
- Image downloads go only to public hosts, follow no redirects and time out after 15 s; cancelling during a download no longer falls back to a screenshot; images over 40 megapixels (read from the file header for every supported format) are refused before decoding.
- Transparent and flat images no longer share one fingerprint, so "You checked this image before" stops matching unrelated logos; EXIF dates keep their local time; unread WebP metadata is reported as not read rather than absent.
- Published fact-check queries no longer stop at abbreviations such as "U.S."; queries in Chinese, Japanese or Thai are capped by length.
- Outlet ratings: entries with a path (for example Rolling Stone politics) and `www.` entries now match, and the rating no longer depends on file order (CNET, Free Beacon).
- The right-click items follow a cleared or reworded custom question; `&` and `%s` in it display correctly.
- Export HTML on a saved check includes follow-ups asked since it was opened; at 30 follow-ups a new one is refused instead of deleting the first.
- History and Settings stay usable while a check runs (the panel no longer jumps back on every progress update).
- "Try again" after a failed second opinion retries that provider; a new check no longer cancels the previous result's archive and fact-check lookups.
- History, a saved check and Recent show an error with Try again when the database cannot be read, instead of "Loading…" forever; Recent shows the day for older checks.
- Dates without a time (archive dates, fact-check reviews, post dates) show the right day in every time zone; exported file names use the local date; Markdown copies use local time.
- "Never show the chip on these sites" matches entries typed with capitals, a port, `www.` or a full address.
- Changing the server address on the first-run screen clears the old key and model, as Settings does.
- Two panels saving at once no longer delete twice the saved pages the storage cap needs.
- With a fallback panel window open, a check started in a normal window runs in that window's side panel.
- Development builds go to `.output/*-dev` folders, so they never replace the release build that README, the e2e tests and `lint:firefox` load.
- History's "Backup" button is "Export all (JSON)" and says the file cannot be imported back yet.

### Corrections to earlier entries
- 1.1.0 said the right-click items are "still absent on the extension's own pages". They are shown there and do nothing when picked.

## [1.2.0] - 2026-11-19

### Added
- Follow-up questions. Every result and saved check has a box at the bottom: ask anything further and the model that answered the check (hosted or local) replies with the content, its earlier answer and the thread so far as context, searching again when it can. Answers stream in under the result, list the pages retrieved, are saved with the check, and go into Copy as Markdown and the HTML export.
- The right-click menu offers every question for what is under the cursor: Fact-check, Explain, Timeline behind, Find flaws and inaccuracies in — for the selection, an image, the post, the page or a link — and your own question once you have written one in Settings.

### Changed
- Right-click items name their question, so they no longer follow the default question from Settings (the chip, the shortcut and the address bar still do). "Check source of …" is now "Fact-check …".

### Security
- Build tooling: sharp upgraded to 0.35.5 (development dependency, used only to make icons and screenshots; nothing shipped in the extension changes).

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
