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
- The keyboard shortcut lost the user gesture and opened a detached window instead of the side panel.
- One invalid stored setting no longer resets every other setting to its default.
- Pasted text is no longer attributed to the page that happened to be open.
- Progress row said "Searched Google" for every provider.

### Security
- API keys are stored apart from the settings the content script reads on web pages.
- The local-model `fetch_page` tool only reaches public hosts, never the user's own endpoints, and caps response bodies.
- Saved pages are never rendered from a `blob:` URL with the extension's origin; `data:` links are stripped from snapshots.
- Gemini Search Suggestions render under their own CSP.

## [0.1.0] - 2026-10-18

Initial development builds: text, image, post and page checks; Gemini, Google AI Mode, Anthropic and OpenAI-compatible providers; local history with page snapshots; on-device image provenance.
