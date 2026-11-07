# Chrome Web Store developer dashboard — every field, ready to paste (1.0.0)

Dashboard: https://chrome.google.com/webstore/devconsole → **New item**. Files come from the [v1.0.0 release](https://github.com/AES256Afro/WhatsYourSource/releases/tag/v1.0.0) and the `store/` folder of this repo. Work through the tabs in the order below; the dashboard will not let you submit until every tab shows a tick.

---

## 1. Package

| Field | Entry |
|---|---|
| Upload | `whatsyoursource-1.0.0-chrome.zip` (from the GitHub release, or `npm run zip`) |

The dashboard reads the name, version (1.0.0), description and icon from the manifest inside the zip.

---

## 2. Store listing

### Product details

| Field | Entry |
|---|---|
| **Title** | *(from the manifest)* WhatsYourSource |
| **Summary** | *(from the manifest, 109 characters)* Check the source of highlighted text, images and posts: Google AI by default, your own key, or a local model. |
| **Description** | *(paste the block below; 16,000-character limit, plain text with line breaks)* |
| **Category** | Productivity → **Tools** |
| **Language** | English |

**Description — paste exactly this:**

```
WhatsYourSource answers one question about anything you read online: is this true, and where can I find the source?

HOW IT WORKS
1. Highlight a sentence, a quote or a statistic. A small "Check source" chip appears (or press Alt+Shift+S, or right-click).
2. The side panel opens and the AI you chose searches the web, reads the sources and writes a short assessment.
3. You get a verdict with its confidence, the likely original source (who said it first, where, when), each claim marked supported / disputed / misleading / unverified, and the actual links that were read. Only links the search engine returned are clickable; anything the model merely "remembers" is labelled as unverified.

CHECK MORE THAN TEXT
• Images: right-click → Check source of this image. Metadata (EXIF, Content Credentials, AI-generator hints) is read on your device first, then the image is checked for its earliest appearance. One-click reverse image search on Google Lens, TinEye, Bing and Yandex. Images you have checked before are recognised.
• Posts: right-click anywhere in a social post → Check source of this post. The post's text, links and images are checked together.
• Links and pages: right-click a link → Check source of linked page; check the page you are on; or paste any text or link into the panel.

EVIDENCE THAT DOES NOT DEPEND ON THE AI
• Already fact-checked? Published fact-checks from PolitiFact, Snopes, AFP, Full Fact and hundreds more appear above the verdict (free Google Fact Check Tools key).
• When was it first seen? Wayback Machine dates for the page and the original source.
• Who is the outlet? Reputation ratings from Wikipedia's perennial-sources list, shipped inside the extension.
• The case on each side: the strongest evidence for and against, what the post leaves out, and what would change the verdict.

YOU CHOOSE THE AI
• Google AI (Gemini) with your own free key — Google Search grounding; answers and sources appear in the panel. Default.
• Google AI Mode on the web — no key, no setup: your selection opens on google.com.
• Your own frontier model — Claude, GPT or any OpenAI-compatible API key.
• A local model on your device — Ollama or LM Studio, paired with a search tool (SearXNG, Brave, Tavily) so it can find sources. Nothing leaves your machine except the searches you allow.
You can set a default and a fallback, ask a second provider for a second opinion, and switch any time.

YOUR HISTORY, ON YOUR DEVICE
Every check is saved locally with a copy of the page as it was when you checked it, with your highlight marked. Search your history, add notes, re-check when sources change, export a check as a self-contained HTML file.

PRIVACY
• Nothing is sent anywhere until you press Check. Then only the selection (or image, or page URL) goes to the one provider you configured, with your own key. Every result shows exactly what was sent, and to whom.
• No accounts, no servers of our own, no analytics, no telemetry.
• API keys are stored locally, never synced, and never read by the script that runs on web pages.
• The chip can be turned off globally or per site.

Open source (MIT): https://github.com/AES256Afro/WhatsYourSource
```

### Graphic assets

| Field | Entry |
|---|---|
| **Store icon** (128×128) | *(taken from the manifest)* `public/icon/128.png` if the dashboard asks for it separately |
| **Screenshots** (1280×800, up to five) | In this order: `store/01-result.png`, `store/02-chip.png`, `store/03-image.png`, `store/05-providers.png`, `store/04-saved-page.png`. (`06-onboarding.png` and `07-result-dark.png` are spares.) |
| **Small promo tile** (440×280) | `store/promo-440x280.png` |
| **Marquee promo tile** (1400×560, optional) | `store/promo-1400x560.png` |
| **Global promo video** | leave empty |

### Additional fields

| Field | Entry |
|---|---|
| **Official URL** | leave empty (needs a verified domain; GitHub pages cannot be verified) |
| **Homepage URL** | https://github.com/AES256Afro/WhatsYourSource |
| **Support URL** | https://github.com/AES256Afro/WhatsYourSource/issues |
| **Mature content** | No |
| **Google Analytics ID** | leave empty |

---

## 3. Privacy practices

### Single purpose

```
WhatsYourSource has one purpose: to check the origin and reliability of content the user explicitly selects (highlighted text, an image, a social post, a link or the current page) by sending it to the AI provider the user configured with the user's own key, and showing the verdict, the likely original source and the sources that were read. It does not read pages on its own, does not modify pages beyond its own selection chip, and collects no data for the developer.
```

### Permission justifications

Paste one per box; the dashboard lists exactly the permissions in the manifest.

| Permission | Justification |
|---|---|
| **activeTab** | Reads the current selection and takes a visible-area screenshot of the tab the user acted on, only after the user's own gesture (context menu, keyboard shortcut, toolbar button). The screenshot is used when an image cannot be downloaded (host blocks cross-origin reads) and for the local page copy saved to the user's history. |
| **contextMenus** | Adds the right-click items "Check source of selection", "Check source of this image", "Check source of this post", "Check source of this page", "Check source of linked page" and "Open selection in Google AI Mode". |
| **scripting** | Injects a one-off script into the tab a check was started from, at the moment of the check, to produce the sanitised copy of the page that is saved locally with the result, and to read the selection on pages that were open before the extension was installed. Never runs without a user-initiated check on that tab. |
| **sidePanel** | The results, settings and history live in the side panel. |
| **storage** | Settings and the user's own API keys (stored locally, never synced) and the hand-off of a pending check between the background worker and the side panel (storage.session). |
| **unlimitedStorage** | The local history keeps a copy of each checked page in IndexedDB; a few hundred checks with page copies exceed the default quota. The user sets the cap and can clear it. |
| **Host permissions** (generativelanguage.googleapis.com, api.anthropic.com, api.openai.com, api.search.brave.com, api.tavily.com, factchecktools.googleapis.com, web.archive.org, localhost, 127.0.0.1) | Direct calls, with the user's own key, to the AI or search provider the user picked (Google Gemini, Anthropic, OpenAI, Brave Search, Tavily); the Google Fact Check Tools index for published fact-checks of the claim; the Wayback Machine for the first-archived date of the page and the original source; localhost / 127.0.0.1 for a local model server (Ollama, LM Studio). Each is contacted only during a check the user started, and only when that provider or lookup is configured. |
| **<all_urls>** (optional host permission) and the content script on all sites | The content script shows the "Check source" chip when text is selected, answers "what is selected?" when the panel asks, and extracts the post under the cursor; it does not read or send page content on its own, modifies nothing on the page, and can be turned off globally or per site. The optional all-sites permission is requested per origin, inside a click, with an explanation, for three cases: downloading an image the user right-clicked when its host blocks cross-origin reads; letting a local model fetch a page its own search returned; a custom API endpoint or self-hosted search server the user typed. Declining falls back to a screenshot or to search snippets. |

### Remote code

| Field | Entry |
|---|---|
| **Are you using remote code?** | No, I am not using remote code |
| Justification (if a box appears) | All code ships inside the package; no scripts are loaded from the network, no eval. Google Search suggestion chips returned by the Gemini API are rendered as static HTML inside a sandboxed frame with scripts stripped and a CSP that blocks them. |

### Data usage

**What user data do you plan to collect?** — owner's decision (2026-11-07): leave every box unticked.

The developer receives no data: there are no servers, no analytics, and the history stays on the device. Nothing is collected *by the developer*, which is what a visitor reads these boxes as, and the owner does not want the listing to suggest otherwise.

Known risk, so it is not a surprise later: Chrome's user-data policy counts "transmitting" as handling and asks for disclosure "even when data is processed or stored locally". When a user chooses a hosted provider, the selected text goes to Google, Anthropic or OpenAI with the user's own key; a reviewer may read that as "Website content" and "Authentication information" and ask for the boxes to be ticked. If that happens, tick those two, resubmit, and the store page will show them beside "not sold, not used for unrelated purposes" with no change to the extension. The privacy policy already describes the transfers, so the listing stays truthful either way.

| Data type | Tick |
|---|---|
| Personally identifiable information | ☐ |
| Health information | ☐ |
| Financial and payment information | ☐ |
| Authentication information | ☐ |
| Personal communications | ☐ |
| Location | ☐ |
| Web history | ☐ |
| User activity | ☐ |
| Website content | ☐ |

**Certifications** — tick all three:

- ✅ I do not sell or transfer user data to third parties, outside of the approved use cases
- ✅ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ✅ I do not use or transfer user data to determine creditworthiness or for lending purposes

| Field | Entry |
|---|---|
| **Privacy policy URL** | https://github.com/AES256Afro/WhatsYourSource/blob/main/docs/PRIVACY.md |

---

## 4. Distribution

| Field | Entry |
|---|---|
| **Payments** | Free of charge |
| **Visibility** | Public (or **Unlisted** for a one-to-two-week beta, then switch to Public; the listing URL works either way) |
| **Distribution regions** | All regions |

---

## 5. Account (one-time, under the gear icon → Account)

| Field | Entry |
|---|---|
| Developer display name | AES256Afro (or your name; this shows on the listing) |
| Contact email | your email; verify it when the dashboard sends the link |
| Trader / non-trader | Non-trader (free, no monetisation) unless you sell software commercially |
| Registration fee | one-time $5, paid once per developer account |

---

## 6. If the dashboard shows a "Notes for reviewer" or test-instructions field

```
The developer collects nothing: no servers, no analytics; settings, keys and history stay on the device. When the user picks a hosted AI provider, the text they selected is sent to that provider with the user's own key, as the privacy policy describes. No account is needed. To test a full check: Settings → Gemini (your key) → paste any free Google AI Studio key (https://aistudio.google.com/apikey), press Verify, then highlight text on any article and press the "Check source" chip or Alt+Shift+S. Without a key, choose "Google AI Mode (web)" on the first-run screen: a check then opens google.com in a new tab. The optional <all_urls> permission is only requested, inside a click, when an image host blocks cross-origin reads or a local model needs to fetch a page; declining falls back to a screenshot or search snippets. Nothing is sent before the user presses Check; every result shows "What was sent, and to whom".
```

---

## After submitting

- Review usually takes one to three days; the `<all_urls>` optional permission and the content script on all sites are the likely questions, and the justifications above answer them.
- Once approved, add the listing URL to the README **Install** section and to `docs/STORE_LISTING.md`.
- Updates: bump `version` in `package.json`, `npm run zip`, upload the new zip under **Package**; the listing fields are kept.
