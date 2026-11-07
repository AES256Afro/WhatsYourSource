# Sweep ledger

Rules (from `MILESTONES.md` §4): each sweep reads its whole surface, fixes what it finds, adds a regression test where possible, and logs here. A category leaves the loop after three consecutive clean sweeps.

## Decisions needed

- **Firefox chip behaviour.** Firefox refuses `sidebarAction.open()` from a message handler, so a chip click there opens a small panel *window* (now reused, not stacked) while the context menu and shortcut open the real sidebar. Options: accept (current), or make the chip on Firefox open Google AI Mode / show a hint to use the shortcut. Your call.
- **License.** I added an MIT `LICENSE` under the name "AES256Afro" because the stores and AMO's source submission require one. Change the name or the license if you want something else (Apache-2.0 adds a patent grant; GPL would force forks to stay open).

## Stage 1 status

| Category | Sweeps run | Consecutive clean | Retired |
|---|---|---|---|
| Code | 7 | 0 | no |
| Bug | 7 | 0 | no |
| Security | 7 | 2 | no |

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
- Chip/shortcut with Google AI Mode as the trigger or default opened an empty side panel *and* a google.com tab. New `pageTriggerTarget()` rule (web if either the trigger setting or the default provider is web mode); the content script sends `wys:open-webmode` and the background never opens the panel in that case. Context-menu items follow only the default-provider setting (the trigger setting is labelled as applying to the shortcut and the chip), corrected in sweep 7.
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
- `fetch_page` (the local-model tool) fetched any URL the model named from the extension origin, reachable by prompt injection from page content. New policy: public http(s) hosts only (no loopback, RFC1918, link-local, CGNAT, `.local`/`.internal`, bare names, numeric spellings, mapped IPv6), the user's own model and SearXNG hosts are blocked, redirects are not followed (sweep 4), bodies are capped at 2 MB (`isPublicHttpUrl`, `assertFetchAllowed`, `tests/unit/security.test.ts`). Residual risk noted: a public host that redirects to a private one is only detected after the response arrives; the body is then discarded.
- "Open snapshot in a tab" rendered stored HTML from a `blob:` URL carrying the extension origin → new `snapshot.html` page renders it in the same sandboxed, CSP'd frame as the panel.
- Snapshot sanitizer allowed `data:` as a link target → DOMPurify hook drops `data:` hrefs at capture; `buildSnapshotSrcdoc` also strips any non-http(s) href as a second line (covers old snapshots). `ping` attribute and `<math>` forbidden too.
- Gemini Search Suggestions frame had no CSP of its own → `default-src 'none'; img-src https: data:; style-src 'unsafe-inline'`.
- `LICENSE` (MIT) added; needed for AMO source submission and the store listings.

Checked and found fine: message validation with zod on every boundary; model output rendered as text only; `credentials: 'omit'` on image fetches; keys sent in headers not URLs; `anthropic-dangerous-direct-browser-access` is appropriate for a BYOK extension; no remote code; `npm audit` pending (next sweep).

`clean: no`

### 2026-11-07 · Live verification (part of bug sweep 2)

- Google AI Mode `udm=50`: works (AI Mode tab renders the question and streams an answer).
- Google Lens `lens.google.com/uploadbyurl?url=`: works (redirects to Lens results with Exact/Visual matches).
- TinEye `tineye.com/search?url=`: serves a Cloudflare browser check first in a headless pane; a normal browser passes it. Kept.
- Gemini models (aistudio.google.com/docs/models, 2026-11-07): `gemini-3.8-flash` current, `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite` stable, `gemini-4-argon` is the new flagship; 2.5 series deprecated and routed to 3.x from 2026-12-01; 2.0 series shut down. Menu updated (Argon added); the Verify button still lists whatever the key can use.
- Gemini pricing (aistudio.google.com/docs/pricing): the table in `pricing.ts` was double the current price for 3.8 Flash ($0.75/$3.75 per 1M, not $1.50/$7.50). Updated; longest-prefix matching so Flash-Lite is not priced as Flash; test added. Grounding: 5,000 free/month shared across Gemini 3+, then $14/1k — unchanged.
- `npm audit`: 0 vulnerabilities in production dependencies (what ships). 12 remain in dev-only tooling (web-ext's `fx-runner`/`shell-quote`, `sharp`'s libvips for the icon script, `minimatch`, `deepmerge`); none runs in the extension.

### 2026-11-07 · Code sweep 2

- `PanelApis` + open-the-panel logic duplicated in background and popup → `src/lib/panel.ts` `openPanelSync()`.
- `hostOf()` duplicated in `ErrorView` and `LocalCard` → `src/lib/util/url.ts`.
- `App.tsx`: `as { srcUrl: string }` cast replaced by narrowing.

`clean: no`

### 2026-11-07 · Bug sweep 2

- **Firefox local models were broken**: Firefox's MV3 default extension CSP is `script-src 'self'; upgrade-insecure-requests`, which rewrites `http://localhost:11434` to `https://` and every Ollama/LM Studio call fails. Explicit `content_security_policy.extension_pages` set for both browsers (`wxt.config.ts`).
- Chip appeared while selecting text inside inputs, textareas and contenteditable editors (the user's own typing) → suppressed.
- Home view subscribed to `tabs.onUpdated` for every tab and every change, sending a message each time → only a completed load of the active tab.
- "Open all" sources used `window.open` in a loop, which popup blockers stop after the first → `tabs.create` with `active: false`.

`clean: no`

### 2026-11-07 · Security sweep 2

- Extension pages CSP now also `object-src 'none'; base-uri 'none'; frame-ancestors 'none'` (Chrome's default allowed `object-src 'self'`).
- Reviewed and fine: generated manifests for both browsers (no `web_accessible_resources`, `<all_urls>` optional, `storage.session` not exposed to content scripts, `sidebar_action.open_at_install` off); the Gemini key is sent only as a header to `generativelanguage.googleapis.com`; the popup and panel validate every tab reply.

`clean: no`

### 2026-11-07 · Sweep 3 (code, bug, security) — with two independent read-only audits

Two fresh-context auditors (one bug lens, one security lens) read the whole tree. Everything they found was fixed in this sweep; their "checked and sound" lists are kept as regression intent.

**Process finding (code)**: the sweep-2 patch script aborted midway and four fixes logged as done had never landed (CSP, chip-in-editable-fields, `tabs.onUpdated` filter, open-all via `tabs.create`). Caught by the security auditor. Re-applied, and the ledger now only records a fix after the build that contains it is green. A CSP presence check is part of the manifest review below.

**Security**
- Image metadata (EXIF/XMP/IPTC/PNG text, author-controlled) was handed to the model as "trustworthy facts" → split into measured facts (dimensions, format, C2PA presence, field count) and an `untrusted('metadata')` block; the system prompt says attributes are data too. Test: `prompts.test.ts` "page-derived fields".
- `fetch_page` could be steered by injected page text to any public URL carrying the checked content (exfiltration) and the fetched page was then shown as a *verified* source → the tool now only reads URLs that this run's `web_search` returned or that the checked content itself linked; anything else is refused with a hint to search first.
- Pasted text, re-checks and popup/shortcut checks snapshotted *whatever tab was active* (a bank page could land in history) → `captureFromTab` requires the input's page URL and refuses when the content script reports a different URL; pasted text never snapshots.
- Page-derived strings (title, URL, site, author, time, permalink, image and link lists) sat outside the untrusted block and some were unbounded (`<time datetime>` of any length) → all moved inside `untrusted()` blocks or attributes; `LIMITS` in the protocol bound every field, producers truncate first; `permalink`, `images[]`, `links[]` must be http(s).
- The untrusted delimiter could be closed by content (`</untrusted_content>` in a selection) → delimiters in body and attributes are defanged; attribute quotes escaped. Test in `security.test.ts`.
- Raw search/grounding URLs were not scheme-checked before becoming links; `absolute()` in the extractor accepted `javascript:` permalinks → `buildSources` filters with `isHttpUrl`, the extractor returns only http(s), `InputCard` links only http(s) and only renders http/data-image/blob sources.
- A page could create a selection under the pointer so a click meant for the page landed on the chip → the chip shows only within 1.5 s of a trusted `pointerup`/`keyup`, and never inside editable elements.
- Plain-http non-local endpoints sent the API key in cleartext without a word → red warning in the Local card.
- `isPublicHttpUrl` gaps: 192.0.0.0/24, 198.18.0.0/15, 6to4 and NAT64 embeddings; mapped IPv4 was blocked by accident (serialized as `::ffff:7f00:1`) → proper IPv6 expansion; tests for all forms.
- Accepted risk, documented: DNS rebinding (public name resolving to a private address) cannot be detected from an extension page.

**Bugs**
- Starting a check while another streamed left the UI on "Cancelled" for the whole new run (the aborted run's error landed after the new run's view change) → every run carries a token; a superseded run never writes to state again.
- One job ran in every open panel (per-window side panels/sidebars + the fallback window): double provider calls, double history rows → jobs carry `windowId`; panels take only their own.
- The fallback popup window stacked a new window per chip click (Firefox: `sidebarAction.open` cannot be called from a message handler, so the chip always falls back; Chrome sometimes) → an existing panel window is focused instead. Firefox users get a window from the chip and the sidebar from the menu/shortcut; noted in README.
- Model JSON with a `null` source URL or an empty claim text failed the whole parse, triggered the repair pass and then "degraded" → nulls and empties are dropped per item; `label`/`summary` default.
- `visibleText` used `innerText` on a detached clone (= `textContent`, no line breaks) so SPA posts glued author, time and paragraphs together → a walker inserts breaks after block elements. Test in `post.test.ts`.
- Background settings copy is defaults right after a service-worker restart → the shortcut handler re-reads settings in its async half and routes to web mode correctly; empty-page inputs (restricted tabs) are dropped.
- `updateSettings` read-modify-write raced (blur-commit + click) → serialized through a promise chain. Test in `settings-storage.test.ts`.
- Snapshot storage limit input rewrote itself on every keystroke ("5" → 10 → "100") → draft input, committed on blur/Enter.
- Gemini status said "with Google Search" when only URL context was on; auth hint mentioned "AIza" for every provider; settings copy said "only to the default provider" (false with fallback or a search tool); "not set" shortcut rendered as "press not set"; cost footer showed a search charge free-tier users never pay → all reworded (now "up to ≈ $x" with a tooltip).
- Original-source card could link to a *different* page on the same domain through a grounding redirect → links only on an exact URL match.
- Inline (`data:`) images produced a multi-megabyte google.com URL and dead reverse-image links → AI Mode gets a description, reverse-image row explains and hides.
- History "Yesterday" was off by an hour after DST; dates older than a year lacked the year → calendar arithmetic, year shown when it differs.
- `https://localhost` counted as local but has no host permission → only `http://` localhost is "local"; https gets the Allow note.
- Parking a check behind "needs setup" never ran it after the key was entered → "Check now" button appears once a provider is ready.
- SearXNG forced `language=en` → removed.
- `repairJson` replaced smart quotes inside string values, making a near-valid block worse → tried last.

`clean: no` (all three categories)

### 2026-11-07 · Sweep 4 (code, bug, security) — fresh-context review of everything changed since `fe50500`

A reviewer who had not seen the earlier sweeps read the full diff. Findings were all consequences of sweep-3 fixes, which is exactly what this pass is for.

- **Regression (bug, confirmed)**: the per-window job filter dropped every job delivered to the fallback panel *window* (the normal chip path on Firefox; Chrome when the gesture expired), because that window has its own window id → a panel that is itself a tab (the fallback window) now accepts any job; side panels and sidebars still take only their window's.
- **Regression (bug, confirmed)**: the new `LIMITS` were enforced by the schema but tab titles/URLs from the browser were never truncated (an X status title runs past 300 characters) → the job was silently rejected. `clampInput()` at `enqueueJob`, `clampSelection()` for selection replies and the injected reader; test added.
- **Regression (bug, confirmed)**: the chip's trusted-input window hid it after a drag-select slower than 1.5 s (pointerup fires no `selectionchange`) → pointerup/keyup re-evaluate; pointerdown/keydown also count.
- Incomplete fix (bug): `originalSource.title: null` still failed the whole parse → nullish like its siblings; test added.
- Incomplete fix (security): `author` from a page's `author` attribute was unclamped → clamped; test added.
- Too strict (bug): a local model could never `fetch_page` the page the selection came from, and an `http` hit requested as `https` was refused → the page URL is readable, keys are scheme-insensitive.
- Security: `redirect: 'follow'` still *sent* a request to a redirect target before the policy check → `redirect: 'manual'`; a redirecting page is reported to the model as moved. Ledger wording corrected: redirects are not followed.
- `minimum_chrome_version: 116` (sidePanel needs 114, `AbortSignal.any` 116) so Chrome 114–115 users get a clear install refusal rather than a misleading network error.
- Comment accuracy: `storage.onChanged` still delivers the `secrets` change payload to the content script's isolated world; it is ignored, never kept, and the comment now says so.

Verified sound by the reviewer (kept as regression intent): run tokens in `App.tsx`; lenient per-field settings merge and the secrets migration; serialized updates; no double-open between the chip's web-mode path and the panel; snapshot URL matching tolerates fragments, trailing slashes, `www.` and tracking params; `isPublicHttpUrl` on mapped/6to4/NAT64/odd spellings; `untrusted()` framing; schema preprocessing types; the text walker; `ownHosts`; e2e and preview fixtures still consistent.

`clean: no` (bug, security); `clean: no` (code: one comment)

### 2026-11-07 · Sweep 5 (code, bug, security) — fresh-context whole-tree audit, confirmed-only bar

- **Security (confirmed)**: the `fetch_page` allow-list compared URLs after tracking-parameter stripping, so `hit?utm_content=<the selection>` matched the stored hit and was fetched verbatim: an exfiltration channel. The readable set is now a map from identity to the URL *as the search returned it*, and that stored URL is what gets fetched and cited; the model's spelling is never used. Test: `security.test.ts` "fetch_page readable set".
- **Security/privacy (confirmed)**: both screenshot paths captured the window's *active* tab after an `await`, so a tab switch during capture could store a screenshot of another page → both verify the active tab is still the job's tab first.
- **Bug (confirmed)**: a sidebar and a fallback panel window for the same browser window both ran the same job → jobs are claimed (write claim, wait, confirm) before running; at most one panel runs.
- **Bug (confirmed)**: the SSE parser normalised CRLF per chunk, so a `\r\n\r\n` split across chunks merged two events and both were lost → normalised on the accumulated buffer; test added.
- **Bug (confirmed)**: the content script's "nothing selected" reply was unclamped → clamped (long X titles no longer blank the "This page" card).
- **Bug (confirmed)**: an inline `data:` image over the schema limit was enqueued and silently dropped → clamped to a sentinel; the screenshot path locates the right-clicked element; test added.
- **Bug (confirmed)**: the screenshot crop used the image's full height even when part of it was scrolled off, sending neighbouring page pixels as "the image" → crop intersected with the viewport.
- **Bug (confirmed)**: inside the fallback panel window `getTargetTab()` returned the panel's own tab, so "This page" and the selection card never appeared there → falls back to the last focused normal window's active tab.
- **Code (confirmed)**: a `hostOf` duplicate survived in `LocalCard` (the sweep-2 patch for that file had failed); import added, duplicate removed.

Verified sound by the auditor: clamping at every producer; untrusted framing; `isPublicHttpUrl`; `fetchPageText` policy; snapshot sanitising and sandboxing; secrets split and migration; run tokens; `jobIsForWindow` across contexts; Anthropic/Gemini/OpenAI parsers; sources merge; pricing; eviction; privacy/permission docs vs the manifests.

`clean: no` (all three)

### 2026-11-07 · Sweep 6 (code, bug, security) — fresh-context whole-tree audit, confirmed-only bar

**Security: 0 confirmed findings — first clean security sweep.** Verified again: framing, URL policy, snapshot sandboxing, suggestion-frame CSP, link filtering, secrets, docs vs manifests.

**Bugs**
- `enforceSnapshotCap` awaited a read on another store while an IndexedDB cursor was open; real browsers auto-commit the cursor's transaction, so `cursor.continue()` threw `TransactionInactiveError` every time and the storage cap was never enforced (the call site swallows rejections; fake-indexeddb in tests does not auto-commit, so the test passed). Rewritten as three separate passes; comment explains why they must stay separate.
- The first-run screen replaced *every* view except settings, so a check started before "Finish setup" ran invisibly (tokens spent, result saved, nothing shown) → the gate now only covers the home view; running a check with a working provider marks onboarding done; "Finish setup" keeps a provider configured in Settings when the radio was not touched.
- Re-checking an inline, blob or screenshot-sourced image from a result or history could never work and the error pointed at a screenshot path that was never tried → the page's tab is resolved through its content script and used; if the page is not open, a clear "open the page and re-check from there" error.
- An empty model reply (Ollama past its context window, Gemini thoughts-only at MAX_TOKENS) was saved as a verdict card whose summary referred to an assessment that was not there → reported as "The provider returned nothing" with a hint; the fallback chain applies. Test added.
- Links inside the exported saved page never opened (`sandbox=""` plus `target="_blank"`) → `allow-popups`, scripts still blocked.

**Code**
- History was hard-capped at 300 rows while the header counted all checks → paged by `createdAt` ("Load older checks"), `listChecks({ before })`; test added.

`clean: no` (bug, code); `clean: yes` (security, 1 of 3)

### 2026-11-07 · Sweep 7 (code, bug, security) — fresh-context whole-tree audit, confirmed-only bar

**Security: 0 confirmed (clean, 2 of 3).**

**Bugs**
- History "Load older checks" could run twice at once or append a page from the previous filter after the filter changed → in-flight guard and a filter token; stale results dropped.
- An empty model reply (`unknown` code) never reached the fallback provider although the sweep-6 note said it would → its own `empty` code, in the fallback set, with its own hint; the unreachable default in `App.tsx` removed.
- The content script crashed on every XML, SVG, RSS and sitemap document (`attachShadow` throws outside the HTML namespace), and because the chip was built before the message listener, those pages never answered selection or snapshot requests → the script returns early on non-HTML documents.
- A selection inside an iframe (comment widgets, embedded editors) was silently turned into a whole-page check: the content script runs in the top frame only → when the top frame reports no selection, a one-off reader is injected into all frames and the first frame with a selection wins (context menu, shortcut, popup and home view all go through it).
- The popup closed itself before the side panel (or its fallback window) had opened, so a rejected open left the job waiting for whatever panel came next → `openPanelSync` returns a promise and the popup waits for it.

**Code**
- Ledger said context-menu items honour the trigger setting; they follow the default provider, which matches the settings label. Ledger corrected.

`clean: no` (bug, code); `clean: yes` (security)
