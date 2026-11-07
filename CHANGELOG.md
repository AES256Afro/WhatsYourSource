# Changelog

All notable changes to WhatsYourSource. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `MILESTONES.md`: the plan from the current state to store release.
- `docs/SWEEPS.md`: the audit ledger (Stage 1 code/bug/security sweeps, Stage 2 quality sweeps).
- MIT `LICENSE`.
- ESLint (typescript-eslint strict, react-hooks) and Prettier; `npm run lint`, `npm run format`.
- `snapshot.html`: saved pages open in their own tab inside a sandboxed frame.
- Shortcut labels follow the live key binding.

### Changed
- Default shortcut is `Alt+Shift+S` (Firefox owns `Ctrl+Shift+S`; `Cmd+Shift+S` is taken on macOS).
- "Check source of this post / page" menu items appear only when no selection or image is under the cursor.
- The floating chip and the shortcut open Google AI Mode directly when that is the chosen trigger or default, without opening the side panel.

### Fixed
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
