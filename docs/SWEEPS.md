# Sweep ledger

Rules (from `MILESTONES.md` §4): each sweep reads its whole surface, fixes what it finds, adds a regression test where possible, and logs here. A category leaves the loop after three consecutive clean sweeps.

## Decisions needed

- **License.** I added an MIT `LICENSE` under the name "AES256Afro" because the stores and AMO's source submission require one. Change the name or the license if you want something else (Apache-2.0 adds a patent grant; GPL would force forks to stay open).

## Stage 1 status

| Category | Sweeps run | Consecutive clean | Retired |
|---|---|---|---|
| Code | 1 | 0 | no |
| Bug | 1 | 0 | no |
| Security | 1 | 0 | no |

## Stage 2 status

| Category | Sweeps run | Consecutive clean | Retired |
|---|---|---|---|
| Readability | 0 | 0 | no |
| Usability | 0 | 0 | no |
| Visual | 0 | 0 | no |
| Quality of life | 0 | 0 | no |
| Platform features | 0 | 0 | no |
| Optimization | 0 | 0 | no |

---

## Log

### 2026-11-07 · Code sweep 1

Surface: whole `src/`, `tests/`, configs. Tooling added first: ESLint (typescript-eslint strict + stylistic, type-checked; react-hooks) and Prettier; `npm run lint`, `npm run format`. First lint run: 94 problems, 39 auto-fixable.

Findings and fixes:
- `src/ui/App.tsx`: ref written during render (`settingsRef.current = settings`) → moved into an effect.
- `src/ui/components/CheckingView.tsx`: `import` in the middle of the file; `useState(Date.now())` evaluated every render → import hoisted, lazy initializer.
- `src/ui/components/settings/primitives.tsx`: "sync state from props" via `useEffect(setState)` in two inputs → shared `useDraft` derived-state hook; `Toggle.onChange` optional so disabled toggles need no no-op.
- `src/ui/components/DetailView.tsx`: object URL created inside an effect with setState → `useMemo` + cleanup effect.
- `src/ui/components/settings/GeminiCard.tsx`, `AnthropicCard.tsx`: "verified" status stuck to the key it was run for; status is now derived and resets when the key changes.
- Untyped `browser.tabs.sendMessage` replies in 5 places → `unknown` + zod (`LocateImageReplySchema` added to the protocol).
- `src/lib/image/provenance.ts`: `String(v)` on an unknown that could be an object → explicit primitive handling.
- `src/lib/pipeline/runCheck.ts`, `schema.ts`, `providers/openaiCompat.ts`: `JSON.parse` results typed `any` → `unknown` with narrowing; `String(args.query ?? '')` → `str()` helper.
- `src/lib/post/extract.ts`: dead `?? undefined` after a non-nullable expression.
- `tsconfig.json`: `playwright.config.ts` added to `include` so the type-aware linter can see it.
- Whole tree formatted with Prettier (one-time, separate commit).

`clean: no`

### 2026-11-07 · Bug sweep 1

Findings and fixes:
- `src/entrypoints/background.ts`: the keyboard command awaited `loadSettings()` before `openPanel()`, losing the user gesture so Chrome fell back to a detached window. The background now keeps a copy of the public settings in memory (loaded at start, updated on `storage.onChanged`) and decides synchronously.
- Chip/shortcut with Google AI Mode as the trigger or default opened an empty side panel *and* a google.com tab. New `pageTriggerTarget()` rule (web if either the trigger setting or the default provider is web mode); the content script sends `wys:open-webmode` and the background never opens the panel in that case. Context-menu items honour the same rule.
- `mergeSettings` discarded all settings on one invalid field → per-field reset guided by zod issue paths (`tests/unit/settings-storage.test.ts`).
- Paste box attributed pasted text to the current tab's URL → no page URL; prompt says "pasted text (origin unknown)" (`tests/unit/prompts.test.ts`).
- Context menus: "Check source of this post/page" also appeared on selections and images, giving four items → now only on `page` and `link` contexts.
- `Ctrl+Shift+S` is Firefox's screenshot shortcut and `Cmd+Shift+S` is taken on macOS → default is `Alt+Shift+S`; every label reads the live binding through `browser.commands.getAll()` (`src/lib/shortcut.ts`, `useShortcutLabel`).
- Progress row said "Searched Google" for every provider → "Searched".
- `fetchPage.ts`: abort listener leaked per call → `AbortSignal.any` + `AbortSignal.timeout`.

`clean: no`

### 2026-11-07 · Security sweep 1

Findings and fixes:
- API keys were inside the `settings` object that the content script loads on every page. Keys now live under a separate `secrets` storage key; the content script and background read only the public half (`loadPublicSettings`); old installs are migrated on first load (`tests/unit/settings-storage.test.ts`).
- `fetch_page` (the local-model tool) fetched any URL the model named from the extension origin, reachable by prompt injection from page content. New policy: public http(s) hosts only (no loopback, RFC1918, link-local, CGNAT, `.local`/`.internal`, bare names, numeric spellings, mapped IPv6), the user's own model and SearXNG hosts are blocked, redirects are re-checked against the policy after the fact, bodies are capped at 2 MB (`isPublicHttpUrl`, `assertFetchAllowed`, `tests/unit/security.test.ts`). Residual risk noted: a public host that redirects to a private one is only detected after the response arrives; the body is then discarded.
- "Open snapshot in a tab" rendered stored HTML from a `blob:` URL carrying the extension origin → new `snapshot.html` page renders it in the same sandboxed, CSP'd frame as the panel.
- Snapshot sanitizer allowed `data:` as a link target → DOMPurify hook drops `data:` hrefs at capture; `buildSnapshotSrcdoc` also strips any non-http(s) href as a second line (covers old snapshots). `ping` attribute and `<math>` forbidden too.
- Gemini Search Suggestions frame had no CSP of its own → `default-src 'none'; img-src https: data:; style-src 'unsafe-inline'`.
- `LICENSE` (MIT) added; needed for AMO source submission and the store listings.

Checked and found fine: message validation with zod on every boundary; model output rendered as text only; `credentials: 'omit'` on image fetches; keys sent in headers not URLs; `anthropic-dangerous-direct-browser-access` is appropriate for a BYOK extension; no remote code; `npm audit` pending (next sweep).

`clean: no`
