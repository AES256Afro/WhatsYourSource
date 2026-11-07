# WhatsYourSource — Milestones to publish

_Written 2026-11-07 after a full read of the repository at commit `fe50500`. This is the working plan for the sweeps; `PLAN.md` stays as the original architecture document._

## 0. Where it stands

What is already built and sound:

- One codebase (WXT, React, Tailwind, zod, idb) that produces Chrome MV3 and Firefox MV3 builds, with CI that type-checks, unit-tests, builds both, lints the Firefox build, runs a Playwright end-to-end test and uploads zips.
- Four ways to check: highlighted text (chip, right-click, shortcut), an image (right-click), a post (right-click anywhere in it, generic extractor), the whole page, plus a paste box in the panel.
- Four providers behind one interface: Gemini with Google Search grounding and URL context (default), Google AI Mode on the web (no key), Anthropic with built-in web search, and any OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp, OpenAI, custom) with a tool loop over SearXNG / Brave / Tavily and a page fetcher. Fallback chain between configured providers.
- A result card that separates the AI's verdict from verified sources (links only for URLs the search machinery actually returned), claim-by-claim statuses, a "likely original source" card, Gemini's required Search Suggestions, and a cost meter.
- Local-only history in IndexedDB with sanitized page snapshots, highlight marking, screenshots, notes, re-check, HTML export, JSON export, size cap with eviction.
- Image provenance read on-device: EXIF/XMP/IPTC, PNG text chunks, C2PA presence, AI-generator hints, perceptual hash, reverse-image links.
- Prompt-injection defences (untrusted-content delimiters, no HTML rendering of model output, sandboxed frames with CSP for anything third-party), onboarding, dark mode, privacy and permission docs.

What the read-through turned up (this is the seed list for Stage 1; the sweeps will find more):

| Area | Finding |
|---|---|
| Bug | `Ctrl+Shift+S` handler awaits `loadSettings()` before `openPanel()`, which loses the user gesture; Chrome then refuses `sidePanel.open` and the code falls back to a detached popup window. |
| Bug | Clicking the chip when the default provider is Google AI Mode opens the side panel (empty) *and* a google.com tab, because the background opens the panel before it knows the provider. |
| Bug | One invalid field in stored settings (e.g. `history.maxMb` out of range) makes `mergeSettings` discard *everything* and show defaults, so the user's keys vanish from the UI. Needs per-field leniency and a migration path (`version` is a literal). |
| Bug | The paste box sends the current tab's URL as the "page" of pasted text, so the model is told the text came from a page it didn't. |
| Bug | Right-click menus overlap: on a selection the user sees "Check source of selection", "Open selection in Google AI Mode", "Check source of this post" and "Check source of this page" as four top-level items. |
| Bug | Firefox already binds `Ctrl+Shift+S` to Take Screenshot; the shortcut is dead there. |
| Security | The content script loads the whole `settings` object on every page, including API keys. Isolated world, but keys should live under their own storage key that the content script never reads. |
| Security | The `fetch_page` tool fetches any URL the model asks for from the extension origin. A page that prompt-injects a local model can make it read `http://localhost:…` or LAN addresses. Needs a public-host-only policy and a block on the provider's own endpoints. |
| Security | "Open snapshot in a tab" renders stored HTML from a `blob:` URL that carries the extension's origin. Safe today only because of the meta CSP; should be served through the sandboxed page instead. |
| Security | No `LICENSE` file, which AMO's source-submission step and the Chrome listing both need. |
| Perf | `storageStats()` and `exportAll()` cursor over every snapshot and pull the full HTML and screenshot blob into memory just to sum byte counts; the History screen does this on every open. |
| Perf | Readability and DOMPurify are bundled into the content script that runs on every page; they are only needed when a snapshot is taken. |
| Code | No ESLint/Prettier config although the plan calls for them; one file has an `import` in the middle; a few dead expressions (`?? undefined` after a non-nullable). |
| Code | No `_locales`, no CHANGELOG, no release workflow, version `0.1.0`. |
| Unverified | The Gemini model IDs, the `udm=50` AI Mode parameter, the Google Lens `uploadbyurl` URL and the pricing table were checked on 2026-10-12 and must be re-verified live before release. Anything that no longer works gets removed, per your rule. |

Baseline on 2026-11-07 (clean install, Node 26): type-check clean, 55 unit tests in 9 files pass, Chrome and Firefox builds succeed. Firefox build totals 815 KB; the content script alone is 164 KB, which confirms the lazy-loading item above. The Playwright end-to-end test and a live run against real keys are not yet exercised here.

## 1. Quality we can add (the honest list)

You asked me to say what you might be missing. Ranked by how much it changes what a user gets, not by effort.

1. **A real fact-checking pipeline, not one prompt.** Today one request does everything. The accurate way is: extract the atomic claims first, search each one separately (fact-check sites, primary sources, the exact phrase), then synthesize. Precision goes up a lot, and every claim gets its own evidence instead of a shared pile. See §2.
2. **Published fact-checks before the AI speaks.** Google's Fact Check Tools API (ClaimReview) is free and returns verdicts from PolitiFact, Snopes, AFP, Full Fact, Reuters and hundreds more. If a claim has already been checked, the card should lead with "PolitiFact rated this False on 2025-03-02" and link it. Deterministic, no model, works with every provider including the local one.
3. **Dating evidence from the Wayback Machine.** The CDX API (free, no key) answers "when did this URL first appear" and "did this page say this a year ago". That is the mechanism behind "older than claimed" and "the article was edited"; today the model guesses.
4. **Source credibility shown, not implied.** Ship Wikipedia's Reliable Sources list (CC BY-SA) as JSON and tag every source with "generally reliable / no consensus / deprecated". Flag when all sources are secondary or all come from one outlet.
5. **Nuance in the verdict itself.** Add "strongest evidence for", "strongest evidence against", "context the post leaves out" and "what would change this verdict" to the schema and the card. A bare "Misleading" pill is what makes people distrust fact-checkers; the evidence split is what makes them trust one.
6. **Annotate the page.** After a check, underline each claim in the original post in green/amber/red with a hover card. The user asked to "look at something and find out"; this puts the answer where they are looking.
7. **Per-post Check buttons on X, Reddit, Facebook, Bluesky, Mastodon, Threads, YouTube comments** (the unfinished half of the original M5), with selectors as remote-updatable JSON.
8. **Second opinion.** Run two configured providers (e.g. Gemini and the local model) and show where they agree and disagree. Disagreement is itself useful information.
9. **Native structured output.** Gemini `responseSchema`, OpenAI `response_format`, Anthropic tool-use for the result shape. Kills the repair pass and the "degraded" banner for most runs. (Gemini can't combine grounding and JSON mode in one call, so the two-call shape stays there; the second call becomes a cheap Flash-Lite call.)
10. **Provider polish for local models**: LM Studio and Ollama native APIs for model listing and capability detection (vision yes/no, tool calling yes/no, context length), multiple saved endpoints instead of one slot, presets for OpenRouter/Groq/Together/Jan/vLLM, streaming during the tool loop, and a "thinking" toggle.
11. **Google AI Overview as well as AI Mode.** You mentioned both. AI Mode (`udm=50`) is wired; a plain search tab that surfaces an AI Overview is a one-line addition and is what many users mean by "Google AI".
12. **C2PA verification**, not just presence, via `c2pa-js` (lazy-loaded WASM): who signed it, which tool, whether the signature validates.
13. **Keyless hosted trial** (a Cloudflare Worker holding a Gemini key, with Turnstile and rate limits) so the first check works before any setup. Post-launch.
14. **Quality-of-life**: "what will be sent" preview before Check, a two-button chip (Check / AI Mode), omnibox keyword, history analytics per site, share-as-image card, i18n scaffolding, keyboard and screen-reader pass, live region for streaming status.

## 2. The best way to fact-check a post or a highlight

You asked for the best way with no effort ceiling. Here it is, as a pipeline. Each stage is independent, degrades gracefully, and works with every provider.

```
selection / post
   │
   ├─ 1. CLAIM EXTRACTION  (model, cheap, no search)
   │      → 2–6 atomic, checkable claims; quotes marked as quotes; numbers and dates kept exact
   │
   ├─ 2. DETERMINISTIC LOOKUPS  (no model, parallel, free)
   │      ├─ Google Fact Check Tools (ClaimReview) per claim
   │      ├─ Wayback CDX: earliest capture of the page / permalink / linked URLs
   │      ├─ Exact-phrase search for quotes (search backend / grounding) + Wikiquote
   │      └─ Credibility tags for every domain involved
   │
   ├─ 3. EVIDENCE GATHERING  (provider's search: grounding / web_search / tool loop)
   │      one search per claim, phrased for truth ("fact check", "evidence") and for origin ("original source")
   │
   ├─ 4. SYNTHESIS  (model, structured output)
   │      per claim: status, evidence for, evidence against, best source, confidence
   │      overall: verdict, what the post leaves out, likely original source, what would change the verdict
   │
   └─ 5. PRESENTATION
          card in the panel  +  claim underlines on the page  +  "already fact-checked" banner on top
```

Options I considered and where they land:

| Option | Verdict |
|---|---|
| Keep one prompt, improve wording | Cheapest, but it's why precision is capped today. Keep as the fallback for providers without tool calling. |
| Claim-first pipeline (above) | **Recommended.** This is how ClaimBuster, Full Fact's and Google's own systems are structured. Roughly doubles calls per check; cost stays cents with Flash-Lite for extraction. |
| Google Fact Check Tools API | **Do it.** Free, key from Google Cloud console, pure HTTP, huge payoff on viral claims. |
| Wayback CDX / Save Page Now | **Do it.** Free, no key. Also lets "re-check" compare against the archived page. |
| Wikipedia Reliable Sources list as credibility tags | **Do it.** Shipped as JSON, refreshed from the repo without a store review. |
| Second-opinion from a second provider | Do it as an option; it's two checks in parallel through the existing pipeline. |
| X Community Notes | Only a bulk dataset exists, no live API. Skip. |
| Paid reverse-image APIs (Bing Visual Search, TinEye) | Later, as an optional key. Links stay the default. |
| SynthID / watermark detection | No public detector for third parties. Don't promise it. |
| Video and YouTube transcripts | Post-launch; captions API makes claim extraction possible, the rest of the pipeline is reused. |

## 3. Milestones

Each milestone ends with a tagged build that installs in Chrome and Firefox and a green CI. Order matters: Stage 1 hardens what exists before features land on it; features land before Stage 2 so the sweeps cover them.

### M1 — Stage 1: Code, Bug, Security audit loop — DONE 2026-11-07 (8 sweeps, ~70 fixes; see docs/SWEEPS.md)

Three categories run as independent sweeps. A sweep reads the whole relevant surface, fixes what it finds, adds a regression test where one is possible, and logs every finding in `docs/SWEEPS.md`. A category leaves the loop after **three consecutive sweeps with zero findings**. Stage 1 ends when all three have left.

- **Code audit**: dead code, duplicated logic, wrong abstractions, missing types, lint rules (add ESLint + Prettier + `typescript-eslint` strict), import hygiene, test gaps, docs drift.
- **Bug audit**: every entrypoint and view exercised in the preview harness and the real extension (Chrome and Firefox), every error path, service-worker lifecycle, Firefox event-page quirks, the seed list in §0. Live re-verification of model IDs, AI Mode URL, Lens URL, pricing. Anything dead gets removed.
- **Security audit**: key storage, message validation, CSP for every HTML surface, fetch policy for the tool loop, snapshot sandboxing, permission minimisation, dependency audit, prompt-injection cases against the local-model tool loop, review of what the HTML export can carry.

Exit: `docs/SWEEPS.md` shows three clean sweeps per category; CI green; `LICENSE` and `CHANGELOG.md` exist.

### M2 — The checking pipeline (features from §2) — items 2, 3, 4, 5 landed 2026-11-07 (features sweep 1); 1, 6, 7 pending

1. Claim extraction stage with its own cheap call and schema.
2. Google Fact Check Tools lookup with an optional key field in settings; "already fact-checked" banner.
3. Wayback CDX lookups: first capture date for the page and for linked URLs; "archive now" action; shown in the original-source card.
4. Credibility tags from a shipped JSON list; "all sources secondary / single outlet" flags.
5. Schema and card gain evidence-for / evidence-against / what's-missing / what-would-change-it.
6. Native structured output per provider; the repair pass becomes a rare fallback.
7. Second-opinion option.

Exit: the 20-claim test set from the original plan (misattributed quotes, viral statistics, news claims, satire, old-photo-new-event) produces per-claim evidence with ≥1 verified source each on Gemini and on a local Qwen-class model with SearXNG.

### M3 — Providers and local models

1. Google AI Overview option alongside AI Mode.
2. Multiple saved OpenAI-compatible endpoints; presets for LM Studio, Ollama, llama.cpp, Jan, vLLM, OpenRouter, Groq, Together, OpenAI, custom.
3. LM Studio and Ollama native model listing with capability detection (vision, tools, context length); the UI greys out image checks for a text-only model instead of failing.
4. Streaming inside the tool loop; thinking toggle; per-provider temperature and max tokens where they matter.
5. Connection doctor: a Test button that tells the user exactly what is wrong (server down, CORS, no model loaded, model lacks tools) with the fix.

Exit: the same test set runs on LM Studio and Ollama out of the box after pressing Test once; a first-time user with LM Studio open gets a working check in under two minutes.

### M4 — On-page experience

1. Claim underlines on the checked post with hover cards; toggle in settings.
2. Per-post Check buttons via site adapters (X, Reddit, Facebook, Bluesky, Mastodon, Threads, YouTube comments) with JSON selectors and fixture tests; generic extractor stays as the fallback.
3. Two-button chip (Check / AI Mode), configurable; omnibox keyword.
4. "What will be sent" preview.

Exit: adapters pass fixtures; button appears on ≥95% of posts in feed and thread views on the seven sites; underlines survive scrolling and virtualised feeds.

### M5 — Images

1. C2PA verification with `c2pa-js` (lazy WASM), signer and tool shown.
2. "Seen before" via pHash against history.
3. Re-verify every reverse-image link; replace any that died.

Exit: 30-image test set from the original plan; provenance facts correct wherever metadata exists.

### M6 — Stage 2: Readability, usability, visual, QoL, features, optimization sweeps

Six categories, each run **at least three times**, each leaving the loop after three consecutive clean sweeps:

- **Readability** (code and UI copy): naming, comments that explain why, UX copy that says what happens, error messages that say what to do.
- **Usability**: first-run to first-check time, every flow by keyboard, screen-reader labels, focus management, empty and error states, side panel at 320 px and 600 px, Firefox sidebar.
- **Visual**: spacing rhythm, contrast in both themes, iconography, loading and streaming states, the result card's hierarchy.
- **Quality of life**: the items in §1.14 and whatever the usability sweeps surface.
- **Features that should be part of the platform**: the remaining §1 items not yet landed, judged against the single-purpose statement; anything that doesn't fit is written down and declined.
- **Optimization**: bundle size budget (< 1.5 MB per target, content script < 60 KB), lazy loading, IndexedDB access patterns, memory during image checks, startup time of the panel, token cost per check.

Exit: `docs/SWEEPS.md` shows three clean sweeps per category; no console errors across a 30-minute session on both browsers.

### M7 — Publish

1. Version bump to 1.0.0; CHANGELOG; GitHub release with both zips; `npm run zip` reproducible from a clean clone (AMO requires source + build instructions).
2. Chrome Web Store: developer account, listing copy, five screenshots and a promo tile, privacy disclosures, permission justifications from `docs/PERMISSIONS.md`, single-purpose statement. Expect one or two review rounds; `<all_urls>` optional permission is the likely question.
3. Firefox AMO: `web-ext sign`, source submission, data-collection disclosure already in the manifest.
4. Edge Add-ons from the Chrome build.
5. Unlisted beta on both stores for one to two weeks, then public.
6. Post-launch queue: keyless hosted trial, video/transcript checks, more adapters, opt-in counts-only telemetry.

Exit: live on Chrome Web Store and AMO; README install links; release tagged.

## 4. Sweep protocol

- Every sweep appends a dated section to `docs/SWEEPS.md`: category, sweep number, findings (file:line, what, fix commit), and a `clean: yes/no` line.
- A finding that needs a decision from you (removing a feature, changing a permission, a cost trade-off) is listed under **Decisions needed** at the top of that file and does not block the other sweeps.
- Commits are small and per finding or per feature; CI must be green before a sweep closes.
- Nothing is published or pushed anywhere until you say so in M7.
