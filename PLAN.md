# WhatsYourSource — Build Plan

Browser extension (Chrome + Firefox) that answers "is this true, and where can I find the source of this topic?" for **highlighted text** first, then **images**, then whole **social posts**. Text is platform-agnostic and is the core of the product; images are "send a copy and ask"; post extraction is a later convenience. Defaults to **Google AI (Gemini)** with Google Search grounding; providers are pluggable (cloud APIs or a local model). Every check is kept in a local **history** together with a snapshot of the page it came from.

_UI mockups (11 screens): https://claude.ai/artifact/HQCWFXKpQx3Xy5oMZNP4jU_

_Written 2026-10-12. Model names, prices and store policies below were checked on that date — re-verify before each milestone that depends on them._

## Status (2026-10-12)

| Milestone | State | Notes |
|---|---|---|
| M0 Foundation | ✅ done | WXT 0.21, Chrome MV3 + Firefox MV3 builds, CI workflow, `npm run preview` UI harness |
| M1 Text check | ✅ done | Chip, context menu, shortcut, popup; Gemini grounding + URL context; streaming card |
| M2 History + snapshots | ✅ done | IndexedDB, Readability snapshots with highlight, screenshot, export, cap |
| M3 Provider plugins | ✅ done | OpenAI-compatible + tool loop (SearXNG/Brave/Tavily), Anthropic web search, fallback chain |
| M4 Image check | ✅ done | Fetch/screenshot capture, EXIF/XMP, PNG text, C2PA presence, pHash; C2PA *verification* still TODO |
| M5 Posts | 🔶 generic done | "Check source of this post" context-menu item extracts the post under the cursor on any site; injected per-post buttons and site-specific adapters not started |
| M6 Polish | 🔶 partial | Dark mode, onboarding, cost meter done; i18n and SW-lifecycle soak test pending |
| M7 Hardening | 🔶 partial | PRIVACY.md + PERMISSIONS.md written; Playwright e2e and manual QA matrix pending |
| M8 Store release | ⏳ | Needs real-key QA in Chrome and Firefox first |

Not yet exercised against a live Gemini key — the pipeline is unit-tested against recorded response shapes; first real-world run is the next QA step.

2026-10-18: every check now puts one question to the model and to the search engine, "Is this true, and where can I find the source of this topic?" (src/lib/pipeline/prompts.ts, src/lib/webmode.ts). The narrative answers the truth question first, then points to the source; the verdict card and the "Likely original source" card map to those two halves.

---

## 1. Product definition

### What the user does
| Priority | Trigger | Where | Result |
|---|---|---|---|
| **P0** | Highlight text → floating chip / right-click / `Alt+Shift+S` → **Check source** | any page | claim + source card in the side panel |
| **P0** | Toolbar icon | any page | popup: check the current selection in the side panel **or** open it in Google AI Mode (a google.com tab, no key needed) |
| **P0** | History | side panel | every past check with its result and a saved copy of the page |
| **P1** | Right-click an image → **Check source** | any page | a copy of the image is sent; provenance + earliest-match card |
| **P2** | **Check this post** button next to a post | Reddit, X, Facebook via adapters; generic fallback elsewhere | card for the whole post |

Two output modes, selectable per action and as a default:
- **In-panel** (default) — answer and sources render inside the add-on and are saved to history.
- **Google AI Mode** — hand the text to `google.com/search?udm=50&q=…` in a new tab. No API key needed, nothing captured, not in history. Useful as the "skip setup" path.

### What the result card contains
1. **Verdict & summary** — one line (e.g. "Misattributed", "Older than claimed", "Disputed") + confidence.
2. **Likely original source** — link, publisher, date, how it was found.
3. **Claims** — each claim in the text/post with status (supported / disputed / misleading / unverified) and citations.
4. **Provenance facts (images)** — C2PA Content Credentials, EXIF/XMP, AI-generator hints — checked locally and labelled as such.
5. **Reverse-image links** — Google Lens, TinEye, Bing, Yandex (one click, new tab).
6. **Google Search Suggestions** — required by Gemini grounding ToS whenever grounding fires.
7. **Transparency** — "what we sent" (exact text / thumbnail), model, searches, token cost; "Saved to history ✓".

### History & page snapshots
Every in-panel check is saved locally (IndexedDB via `idb`; `storage.local` is too small for snapshots):
- `check`: input, provider/model, result JSON, cost, timestamps, user note.
- `snapshot`: the page as it was when checked — canonical URL, title, extracted main content (Readability-style HTML, sanitized, scripts stripped, images rewritten to stored blobs ≤ 300 KB each), the highlight range so the checked passage is marked, plus a screenshot of the visible area (`tabs.captureVisibleTab`) as a fallback for pages that don't extract well.
- Views: list with search/filter (Text / Image / Post / With snapshot), detail with **Result / Saved page / Sources** tabs, "Re-check now" (sources drift), export (JSON, or HTML/PDF of one check), delete, clear all.
- Size cap with oldest-first eviction (default 200 MB), shown in settings. Nothing in history leaves the device unless the user exports it.

### Non-goals for v1
- Automatic scanning of feeds (everything is user-initiated — privacy + cost).
- Being a "truth oracle". We surface sources and evidence; the model's verdict is labelled as an AI opinion.
- Video.

---

## 2. Architecture

### Stack
- **TypeScript**, **WXT** framework (`wxt.dev`) — one codebase, `wxt build -b chrome` / `-b firefox`, auto-generates the right manifest (`background.service_worker` for Chrome, `background.scripts` event page for Firefox; `side_panel` vs `sidebar_action`), bundles `webextension-polyfill` so code uses the promise-based `browser.*` API everywhere.
- **React** (or Preact for bundle size) + Tailwind for the side panel / options UI. Type: IBM Plex Sans (per mockups).
- **Zod** for message + settings + AI-response schemas. **idb** for history.
- **vitest** (unit), **Playwright** (Chrome e2e, loads the unpacked extension), **web-ext** (Firefox run/lint/sign).
- GitHub Actions: lint → test → build both targets → upload zips as artifacts.

### Manifest V3 everywhere
Chrome removed MV2 (store purge 2026-08-31); Firefox supports MV3 (and still MV2, which we don't need). Single MV3 manifest with per-browser tweaks handled by WXT.

### Process layout
```
┌─────────────────────┐   runtime.sendMessage    ┌──────────────────────────┐
│ Content script      │ ───────────────────────▶ │ Background (SW / event   │
│ · selection chip    │                          │ page) — ROUTER ONLY      │
│ · page extraction   │ ◀─────────────────────── │ · context menus          │
│   for snapshots     │   scripting.executeScript│ · commands               │
│ · post adapters(P2) │                          │ · opens side panel       │
└─────────────────────┘                          │ · forwards job           │
                                                 └───────────┬──────────────┘
                                                             │ runtime.connect port
                                                 ┌───────────▼──────────────┐
                                                 │ Side panel page          │
                                                 │ (long-lived while open)  │
                                                 │ · runs the PIPELINE      │
                                                 │ · streams provider output│
                                                 │ · provenance (C2PA/EXIF) │
                                                 │ · history (IndexedDB)    │
                                                 └──────────────────────────┘
```
**Why the pipeline runs in the side panel, not the background:** Chrome's MV3 service worker can be terminated when idle; long streaming AI calls + WASM (C2PA) are safer in an extension page that stays alive while visible. Background stays tiny and stateless. Firefox's event page behaves the same way. Fallback when no side panel is available: a popup window (`windows.create({type:'popup'})`).

### Repo layout
```
whatsyoursource/
├─ wxt.config.ts  package.json  tsconfig.json  tailwind.config.ts
├─ src/
│  ├─ entrypoints/
│  │  ├─ background.ts            # menus, commands, routing
│  │  ├─ content.ts               # selection chip + snapshot extraction (+ adapters later)
│  │  ├─ sidepanel/               # index.html, App.tsx
│  │  ├─ popup/                   # "check in panel" / "open in Google AI Mode"
│  │  └─ options/                 # providers, privacy, history settings
│  ├─ lib/
│  │  ├─ providers/               # Provider interface; gemini.ts, openaiCompat.ts, anthropic.ts, openai.ts
│  │  ├─ search/                  # search-tool backends for non-searching models: searxng.ts brave.ts tavily.ts
│  │  ├─ pipeline/                # text.ts image.ts post.ts page.ts prompts.ts schema.ts toolLoop.ts
│  │  ├─ history/                 # db.ts (idb) snapshot.ts export.ts
│  │  ├─ adapters/                # reddit.ts twitter.ts facebook.ts generic.ts registry.ts   (P2)
│  │  ├─ provenance/              # c2pa.ts exif.ts reverseLinks.ts phash.ts
│  │  ├─ capture/                 # fetchImageBytes.ts screenshotCrop.ts
│  │  ├─ storage/                 # settings.ts (browser.storage.local)
│  │  └─ messaging/               # typed protocol (zod) for content↔bg↔panel
│  └─ ui/                         # ResultCard, ClaimList, SourceList, ProvenancePanel, HistoryList…
├─ tests/
│  ├─ unit/                       # pipeline, providers, schema, snapshot extraction
│  ├─ fixtures/                   # saved HTML pages/posts (sanitized)
│  └─ e2e/                        # Playwright (Chrome) + web-ext smoke (Firefox)
├─ docs/  PRIVACY.md  STORE_LISTING.md  PERMISSIONS.md  ARCHITECTURE.md
└─ .github/workflows/ci.yml
```

### Permissions (keep minimal — both stores scrutinise this)
| Permission | Why |
|---|---|
| `contextMenus` | selection / image / page menu items |
| `storage` | settings (API keys never in `storage.sync`) |
| `unlimitedStorage` | history snapshots in IndexedDB |
| `activeTab` + `scripting` | read selection / extract page / screenshot on user gesture only |
| `sidePanel` (Chrome) / `sidebar_action` (Firefox) | result UI |
| `commands` | `Alt+Shift+S` |
| `host_permissions`: `https://generativelanguage.googleapis.com/*`, `http://localhost/*`, `http://127.0.0.1/*` | Gemini API; local model endpoints |
| `optional_host_permissions`: `<all_urls>` | requested **per site, on demand** to fetch image bytes cross-origin or to let the search tool fetch pages for a local model; user can decline → screenshot fallback |
| content script `matches` | `<all_urls>` at `document_idle` for the selection chip (toggleable); adapters only on their sites |

MV3 forbids remote code; **remote data is fine** → post-adapter selectors ship as JSON that can be refreshed from the repo.

---

## 3. Provider layer

```ts
interface SourceCheckProvider {
  id: 'gemini' | 'openai-compat' | 'anthropic' | 'openai';
  label: string;
  capabilities: { image: boolean; webSearch: boolean; urlContext: boolean; streaming: boolean; toolCalling: boolean };
  check(input: CheckInput, opts: CheckOptions, signal: AbortSignal): AsyncIterable<CheckEvent>;
  validate(config: ProviderConfig): Promise<{ ok: boolean; models?: string[]; error?: string }>;
}
type CheckInput =
  | { kind: 'text'; text: string; pageUrl: string; pageTitle: string; surrounding?: string }
  | { kind: 'image'; bytes: Uint8Array; mime: string; srcUrl?: string; alt?: string; pageUrl: string; nearbyText?: string }
  | { kind: 'post'; site: string; permalink: string; author?: string; postedAt?: string; text: string; images: ImageRef[]; links: string[] }
  | { kind: 'page'; url: string; title: string; excerpt: string };
type CheckEvent =
  | { type: 'status'; message: string }                       // "Searching Google · 2 queries", "Reading quoteinvestigator.com"
  | { type: 'delta'; text: string }
  | { type: 'result'; result: CheckResult }                    // zod-validated structured JSON
  | { type: 'searchSuggestions'; html: string }                // Gemini: must render when present
  | { type: 'usage'; tokens: number; searches: number; estUsd?: number }
  | { type: 'error'; error: ProviderError };
```

### Gemini (default)
- **Endpoint:** `generativelanguage.googleapis.com` REST, called directly from the side panel with the user's **own API key** (BYOK, from Google AI Studio). Key stored in `browser.storage.local`, shown masked, never logged, never synced.
- **Models (as of 2026-10-12):** default `gemini-3.8-flash` (quality), "fast/cheap" `gemini-3.5-flash-lite`, user-selectable; model list fetched at runtime. **Do not use 2.5-series** — scheduled shutdown 2026-10-16.
- **Tools:** `google_search` (grounding) + `url_context` (up to 20 URLs; **doesn't** do login-walled/paywalled pages, YouTube, private hosts). Both can be combined in one request.
- **Images:** sent inline (base64). Downscale longest side to 1536 px client-side before upload; keep original bytes for local provenance checks.
- **Structured output:** request JSON matching `CheckResult`; stream text deltas for the narrative, parse the final JSON block; validate with zod; on failure retry once with a repair prompt, else show raw text.
- **Citations:** map grounding citations → `sources[]`; only cited URLs become links. Render **Google Search Suggestions** HTML in a sandboxed `<iframe srcdoc>` (extension CSP blocks inline styles otherwise).
- **Cost notes surfaced in settings:** grounding is billed per search query on Gemini 3+ (first 5,000/month free per key, then $14/1k); free-tier keys may have traffic used to improve Google products → said plainly in onboarding.
- **Prompt-injection defence:** all page-derived content goes in delimited "UNTRUSTED CONTENT" blocks; system instruction treats it as data; output rendered as sanitized markdown (never HTML); the model gets no tools that act on the browser.

### Local and other providers (same interface, in v1)
- **OpenAI-compatible endpoint** — covers Ollama, LM Studio, llama.cpp server, vLLM and most hosted APIs: base URL + model + optional key. A local Qwen/Llama-class model works here (`http://localhost:11434/v1`). Extension pages are `chrome-extension://` / `moz-extension://` origins, so plain-http localhost is fine with the host permission above; Ollama allows extension origins by default, LM Studio needs CORS enabled in its server settings.
- **Search tool for models that can't search** — `pipeline/toolLoop.ts` runs a small tool-calling loop: `search(query)` → `fetch(url)` → answer, with a user-chosen backend: **SearXNG** (self-hosted), **Brave Search API**, **Tavily**, or **none** (answer from the model's own knowledge, labelled "no web search"). Fetching happens through the extension's own `fetch` (optional host permission), so the local model never needs network access itself. Models without native tool calling get a constrained JSON-action prompt instead.
- **Anthropic** (built-in web search tool) and **OpenAI** as key-based providers.
- Capability flags drive the UI: no `webSearch` → "pair with a search tool" warning; no `image` → image checks greyed out for that provider.
- **Fallback chain** (opt-in): if the default provider errors or is over quota, try the next configured one.

### Optional hosted mode (post-v1)
Cloudflare Worker proxy holding a Gemini key, Turnstile + per-install token, rate limits, no content logging — a keyless trial. BYOK stays the privacy-maximal default.

---

## 4. Deterministic provenance layer (images; doesn't depend on the LLM)
Runs in parallel with the AI call; results merged into the card and also given to the model as context.

| Check | How | Notes |
|---|---|---|
| **C2PA / Content Credentials** | `c2pa-js` (WASM) in the side panel, lazy-loaded | Open standard; present on many camera/Adobe/OpenAI/Google outputs. Absence ≠ fake — say so in the UI. |
| **EXIF / XMP / IPTC** | `exifr` | camera, software, GPS, created/modified, AI-generator tags. Usually stripped by social sites — say so. |
| **AI-watermark hints** | metadata only in v1 | SynthID detection isn't publicly available to third-party devs; don't promise it. |
| **Reverse image** | links to Google Lens / TinEye / Bing / Yandex | No official Lens API; scraping actors are fragile/ToS-risky → links only. Optional paid provider later: **Cloud Vision Web Detection**. |
| **Image fingerprint** | pHash locally | history dedupe and "you've seen this before". |

---

## 5. Site adapters (P2 — post extraction)
```ts
interface SiteAdapter {
  id: 'reddit' | 'twitter' | 'facebook' | 'generic';
  matches(url: URL): boolean;
  findPosts(root: Document): HTMLElement[];           // where to inject the button
  extract(postEl: HTMLElement): PostPayload;          // text, images, links, permalink, author, time
}
```
- **Generic first**: nearest `article` / `[role=article]` / largest text block around the click + `og:` metadata + canonical URL. This alone covers most sites and is what ships in v1.
- Reddit, X, Facebook adapters come after the text/history/provider work is solid; selectors as remote-updatable JSON; fixture tests; graceful degradation to "selection + page URL".

---

## 6. Image capture strategy
1. `srcUrl` from context menu → normalise (srcset largest, strip size params, resolve lazy-load `data-src`).
2. Fetch bytes from the side panel **if** we hold host permission for that origin; otherwise prompt once via `permissions.request` for the site.
3. Fallback: `tabs.captureVisibleTab` + element bounding box crop (works for canvas, CSS backgrounds, protected/expiring URLs).
4. Downscale for upload, compute pHash, run EXIF/C2PA on the **original** bytes.

---

## 7. UX & privacy rules
- **First run presents four ways to check, as equals** (mockup 11): Google AI with your own free key (recommended) · Google AI Mode on the web (no key, no setup) · your own frontier model (Claude / GPT / any API key) · a local model on your device (Ollama / LM Studio, e.g. Qwen, paired with a search tool). Switchable any time in Settings → AI providers, and mixable (default + fallback).
- Nothing leaves the browser until the user clicks **Check**; first run shows a one-screen consent ("this sends the text/image + page URL to the provider you chose, using your key").
- Per-site "never offer here" list; the floating chip is toggleable; incognito respects browser rules (no history).
- History and snapshots are local only; export is explicit.
- Result card always distinguishes **facts checked locally** (C2PA, EXIF, matches) from **AI assessment**.
- Accessibility: keyboard-reachable chip, real buttons/links, ARIA on icon buttons, 4.5:1 contrast, respects `prefers-color-scheme`.
- i18n-ready strings (`_locales/`) even if v1 ships English only.

---

## 8. Milestones

One developer, part-time (~10–15 h/week). Each milestone ends with a tagged build that installs in both browsers.

### M0 — Foundation (week 1)
- Repo init, WXT + TS + React + Tailwind + zod + idb, ESLint/Prettier, vitest, CI building Chrome + Firefox zips.
- Manifest with minimal permissions; side panel on Chrome, sidebar on Firefox, popup fallback.
- Typed messaging; settings storage; options page with API key entry + "validate" (cheap `models.list` call).
- **Spike:** one hard-coded Gemini call with `google_search` from the side panel; confirm streaming, citations and search-suggestion HTML in a sandboxed iframe on both browsers.
- Exit: `npm run build` loads in Chrome & Firefox; key validates; spike answers "who said X?" with citations.

### M1 — Text source check (the product) (weeks 2–3)
- Selection → floating chip + context menu + `Alt+Shift+S` → side panel; popup with "Check in side panel" / "Open in Google AI Mode".
- `pipeline/text.ts` with prompt + `CheckResult` schema; streaming progress ("Searching Google · 2 queries", "Reading 3 sources"), structured card (verdict, original source, claims, sources, suggestions, cost meter).
- Error states: no key, quota, network, safety block, schema failure, cancel.
- Exit: 20 hand-picked quotes/claims (misattributed quotes, viral stats, news claims) produce a sensible card with ≥1 clickable source each; works on both browsers.

### M2 — History + page snapshots (weeks 4–5)
- IndexedDB store; auto-save every in-panel check.
- Snapshot capture in the content script: Readability-style extraction, sanitization, image inlining with caps, highlight range, visible-area screenshot fallback.
- History list (search, filters), detail with Result / Saved page / Sources tabs, notes, re-check, export (JSON + single-check HTML/PDF), delete/clear, size cap + eviction.
- Exit: 50 checks across 20 different sites reopen correctly a week later with the highlight marked; store stays under cap; export/import round-trips.

### M3 — Provider plugins (weeks 6–7)
- Provider registry + settings UI (default, fallback chain, per-provider capabilities).
- OpenAI-compatible provider (Ollama/LM Studio) + search-tool loop with SearXNG / Brave / Tavily / none; Anthropic and OpenAI providers.
- Exit: the same 20 test claims run on a local Qwen-class model + SearXNG and produce cited cards; switching providers mid-session is one click; a provider failure falls back cleanly.

### M4 — Image check (weeks 8–9)
- Context menu on images; capture strategy (§6) incl. optional host-permission flow and screenshot fallback.
- EXIF/XMP via `exifr`; C2PA via `c2pa-js`; pHash; reverse-image link bar.
- `pipeline/image.ts`: image + nearby text + page URL → grounding prompt; card gains Provenance + Earliest match.
- Exit: 30-image test set (camera originals with C2PA, AI-generated with/without credentials, stock, memes, screenshots) — provenance facts 100% correct where metadata exists; AI section cites a plausible origin for known images.

### M5 — Posts: generic + Reddit/X/Facebook (weeks 10–11)
- Generic article/post extraction + "Check this post" button; adapters for the three sites with JSON selectors and fixture tests; `pipeline/post.ts` (text + up to 4 images + links via URL context).
- Exit: button appears on ≥95% of posts in feed/comments views; extraction fixtures pass; broken-selector fallback verified.

### M6 — Polish, resilience, performance (week 12)
- Streaming skeletons, cancel/retry, "what we sent" panel, copy/share as markdown, dark mode.
- Service-worker lifecycle hardening (Chrome), event-page startup quirks (Firefox `onInstalled` + `onStartup`).
- Bundle size budget (< 1.5 MB incl. WASM, lazy-load C2PA).
- Exit: no console errors over a 30-minute browsing session on both browsers.

### M7 — Security, privacy & QA hardening (week 13)
- Threat review: prompt injection, XSS from model/markdown and from snapshots, CSP, key handling, permission minimisation, untrusted image parsing.
- Consent flow, incognito handling, PRIVACY.md, PERMISSIONS.md (justifications for store review).
- Playwright e2e for text/history/image flows; `web-ext lint` clean; manual QA matrix (Win/macOS/Linux × Chrome/Edge/Brave/Firefox).
- Exit: all tests green in CI; security checklist signed off; docs complete.

### M8 — Store release (weeks 14–15)
- Chrome Web Store: developer account, listing, screenshots, privacy disclosures, permission justifications, single-purpose statement; expect 1–2 review rounds.
- Firefox AMO: `web-ext sign`, **source code submission** with reproducible build instructions (required because the bundle is minified).
- Edge Add-ons (same Chrome build). Beta channel (unlisted) → 1–2 weeks feedback → public.
- Exit: live on both stores; GitHub release with changelog; README install instructions.

### M9 — Post-launch (ongoing)
- Hosted/proxy mode (Cloudflare Worker + Turnstile) for keyless trial.
- More adapters: Instagram, Threads, Bluesky, Mastodon, TikTok (text), YouTube comments.
- Cloud Vision Web Detection as optional paid reverse-image provider; SynthID when a public detector exists.
- Telemetry: **opt-in only**, counts not content.

---

## 9. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Snapshots bloat storage or break on heavy SPAs | content caps + eviction; screenshot fallback; extraction fixture tests on 20 site types. |
| Social sites change DOM frequently (P2) | JSON selectors updatable without store review; generic fallback; fixture tests. |
| Chrome review pushback on `<all_urls>` | keep it **optional**, request per site with a clear reason; document in PERMISSIONS.md. |
| Gemini model/API churn (2.5 shutdown Oct 2026; grounding response shapes vary by model) | model list fetched at runtime; provider adapter isolates response parsing; nightly live integration test. |
| Small local models hallucinate sources | search-tool loop only lets cited fetched URLs become links; "no web search" badge when none is configured. |
| Grounding cost surprises for BYOK users | per-check cost estimate + monthly counter against the 5,000 free searches. |
| Prompt injection via page content / snapshots | delimiters + system instruction + no browser-affecting tools + sanitized rendering; snapshots rendered in a sandboxed iframe. |
| Users expect a "fake/real" oracle | wording: "evidence found", confidence bands, never a bare "FAKE". |

---

## 10. Definition of done (v1)
- Text check works on any page in Chrome and Firefox with identical results; image check works; generic post check works.
- Every in-panel check is in History with a working saved page.
- At least two providers (Gemini + a local OpenAI-compatible model with a search tool) produce cited cards.
- No permission beyond the table in §2 without a user gesture.
- All AI claims carry citations or are labelled unverified; local provenance facts shown separately.
- CI green; both store listings approved; PRIVACY.md published.
