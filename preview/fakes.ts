/**
 * Dev-only harness: runs the side panel / popup outside the browser extension runtime.
 * `?scenario=` picks the seeded state: fresh (onboarding), home, result, history, popup, local.
 * Never shipped — only used by `npm run preview`.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';

const CANNED_ANSWER = `No: there is no evidence Einstein ever said this. The line is attributed to him all over the web, but it does not appear in his published writings. Quote Investigator traced the earliest print appearance to a 1981 Narcotics Anonymous text, and Wikiquote lists it under "Misattributed".

\`\`\`json
{
  "verdict": { "label": "Misattributed", "kind": "misattributed", "confidence": "high", "summary": "No evidence Einstein said or wrote this. Earliest known print appearance: 1981, in Narcotics Anonymous literature." },
  "originalSource": { "title": "Narcotics Anonymous, Basic Text (1981)", "url": "https://archive.org/details/na-basic-text-1981", "publisher": "Narcotics Anonymous", "date": "1981", "how": "Earliest print appearance found, phrased as \\"Insanity is repeating the same mistakes and expecting different results.\\"" },
  "claims": [
    { "text": "Einstein said this", "status": "disputed", "note": "Not found in Einstein's published writings; the attribution only appears from the 1980s onward.", "sourceUrls": ["https://quoteinvestigator.com/2017/03/23/same/", "https://en.wikiquote.org/wiki/Albert_Einstein"] },
    { "text": "It is \\"the definition of insanity\\"", "status": "misleading", "note": "A proverb, not a clinical or dictionary definition.", "sourceUrls": ["https://en.wikiquote.org/wiki/Albert_Einstein"] }
  ],
  "sources": [
    { "title": "Insanity Is Doing the Same Thing Over and Over Again and Expecting Different Results", "url": "https://quoteinvestigator.com/2017/03/23/same/", "date": "2017" },
    { "title": "Albert Einstein — Misattributed", "url": "https://en.wikiquote.org/wiki/Albert_Einstein", "date": null },
    { "title": "Narcotics Anonymous Basic Text, 1981 (scan)", "url": "https://archive.org/details/na-basic-text-1981", "date": "1981" }
  ],
  "notes": null
}
\`\`\``;

/** The image scenario gets an answer about a photo, not the quote: the store screenshot must show what an image check looks like. */
const IMAGE_ANSWER = `Older than claimed: this photo is real, but it is not from this week's storm. Its earliest appearance online is a 2019 wire-service gallery of flooding in Jakarta, and the metadata on the file carries no camera or edit history, which is normal for a reposted image.

\`\`\`json
{
  "verdict": { "label": "Older than claimed", "kind": "older-than-claimed", "confidence": "high", "summary": "A real photograph, first published in 2019 from Jakarta; the post presents it as this week's storm." },
  "originalSource": { "title": "Floods in Jakarta — photo gallery", "url": "https://www.reuters.com/pictures/jakarta-floods-2019", "publisher": "Reuters", "date": "2019-01-04", "how": "Earliest dated appearance; the same frame, uncropped, with the photographer's credit." },
  "claims": [
    { "text": "The photo shows this week's storm", "status": "disputed", "note": "The identical frame was published in January 2019.", "sourceUrls": ["https://www.reuters.com/pictures/jakarta-floods-2019"] },
    { "text": "The photo is genuine", "status": "supported", "note": "No signs of compositing; matches the 2019 original pixel for pixel.", "sourceUrls": ["https://www.reuters.com/pictures/jakarta-floods-2019", "https://www.snopes.com/fact-check/jakarta-flood-photo/"] }
  ],
  "sources": [
    { "title": "Floods in Jakarta — photo gallery", "url": "https://www.reuters.com/pictures/jakarta-floods-2019", "date": "2019" },
    { "title": "Is this a photo of this week's storm? No — it is from 2019", "url": "https://www.snopes.com/fact-check/jakarta-flood-photo/", "date": "2024" }
  ],
  "notes": null
}
\`\`\``;

const SELECTION = {
  text: 'As Einstein put it, "the definition of insanity is doing the same thing over and over again and expecting different results."',
  pageUrl: 'https://medium.com/@author/why-we-keep-repeating-ourselves',
  pageTitle: 'Why we keep repeating ourselves',
  surrounding:
    'Most teams don’t fail because they lack ideas. They fail because they repeat the same plan with slightly different slides. As Einstein put it, "the definition of insanity is doing the same thing over and over again and expecting different results." The line gets a laugh in every kickoff meeting, and then the meeting proceeds exactly as before.',
};

const PAGE_HTML = `<h1>Why we keep repeating ourselves</h1><p><em>[Author name] · 6 min read</em></p><p>Most teams don’t fail because they lack ideas. They fail because they repeat the same plan with slightly different slides. As Einstein put it, "the definition of insanity is doing the same thing over and over again and expecting different results." The line gets a laugh in every kickoff meeting, and then the meeting proceeds exactly as before.</p><p>Repetition isn’t the problem — unexamined repetition is. The fix is not a better quote but a short, honest review of what actually changed between attempts.</p>`;

export async function installFakes(scenario: string) {
  fakeBrowser.reset();
  const b = fakeBrowser as unknown as Record<string, any>;

  // Pieces the fake doesn't implement.
  b.permissions = { contains: async () => true, request: async () => true };
  b.runtime.openOptionsPage = async () => alert('(options page)');
  b.runtime.id = 'preview';
  b.tabs.captureVisibleTab = async () => {
    throw new Error('no screenshot in preview');
  };
  b.tabs.sendMessage = async (_id: number, msg: { type: string }) => {
    if (msg.type === 'wys:get-selection') return scenario === 'nosel' ? { text: '', pageUrl: SELECTION.pageUrl, pageTitle: SELECTION.pageTitle } : SELECTION;
    return null;
  };
  const TAB = {
    id: 1,
    windowId: 1,
    index: 0,
    active: true,
    highlighted: true,
    pinned: false,
    incognito: false,
    url: SELECTION.pageUrl,
    title: SELECTION.pageTitle,
  };
  b.tabs.query = async () => [TAB];
  b.scripting = {
    executeScript: async () => [{ result: { url: SELECTION.pageUrl, title: SELECTION.pageTitle, html: PAGE_HTML, textLength: 500, capturedAt: Date.now() } }],
  };
  b.tabs.get = async () => TAB;
  b.tabs.create = async ({ url }: { url: string }) => {
    window.open(url, '_blank', 'noopener');
    return { ...TAB, id: 2, url };
  };

  const g = globalThis as unknown as { chrome: unknown; browser: unknown };
  g.chrome = fakeBrowser;
  g.browser = fakeBrowser;

  // Seed settings.
  const base = {
    version: 1,
    onboarded: scenario !== 'fresh',
    defaultProvider: scenario === 'local' ? 'openai-compat' : 'gemini',
    providers: {
      gemini: { apiKey: scenario === 'fresh' ? '' : 'AIzaPreviewKeyQ7x', model: 'gemini-3.8-flash', grounding: true, urlContext: true },
      openaiCompat: { baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen3:8b', searchTool: 'searxng', searxngUrl: 'http://localhost:8888' },
      anthropic: { apiKey: '', model: 'claude-sonnet-5-5' },
    },
    privacy: { snapshots: true, chip: true, disabledSites: ['example.com'] },
    lookups: { factChecks: true, factCheckKey: 'preview-key', archive: true, credibility: true },
  };
  await fakeBrowser.storage.local.set({ settings: base });

  // Image scenario: a generated PNG queued as a job, so the whole image path runs (fetch → provenance → model).
  if (scenario === 'image') {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 400;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 640, 400);
    grad.addColorStop(0, '#0F5FA8');
    grad.addColorStop(1, '#F5D77A');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 640, 400);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 42px system-ui';
    ctx.fillText('[photo in the post]', 120, 210);
    const srcUrl = canvas.toDataURL('image/png');
    await fakeBrowser.storage.session.set({
      pendingJob: {
        id: 'preview-image',
        createdAt: Date.now(),
        tabId: 1,
        input: { kind: 'image', srcUrl, pageUrl: 'https://x.com/someone/status/1', pageTitle: 'Post by @someone', alt: 'Photo attached to the post' },
      },
    });
  }

  // A canned, slowly streamed Gemini reply so the checking view is visible for a moment.
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('generativelanguage.googleapis.com') && url.includes('streamGenerateContent')) {
      return new Response(geminiStream(scenario === 'image' ? IMAGE_ANSWER : CANNED_ANSWER, scenario === 'image'), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    if (url.includes('generativelanguage.googleapis.com') && url.includes('/models')) {
      return new Response(JSON.stringify({ models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('factchecktools.googleapis.com') && scenario !== 'image') {
      return new Response(
        JSON.stringify({
          claims: [
            {
              text: 'Albert Einstein said the definition of insanity is doing the same thing over and over and expecting different results.',
              claimant: 'Viral image',
              claimDate: '2017-03-20T00:00:00Z',
              claimReview: [
                {
                  publisher: { name: 'Quote Investigator', site: 'quoteinvestigator.com' },
                  url: 'https://quoteinvestigator.com/2017/03/23/same/',
                  title: 'Insanity Is Doing the Same Thing…',
                  reviewDate: '2017-03-23T00:00:00Z',
                  textualRating: 'Misattributed',
                },
              ],
            },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.includes('web.archive.org/cdx')) {
      return new Response(JSON.stringify([['timestamp'], ['20150407100000']]), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('localhost:11434')) {
      return new Response(JSON.stringify({ error: { message: 'preview: no local server' } }), { status: 503 });
    }
    return realFetch(input, init);
  };
}

function geminiStream(answer: string, image = false): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const chunk = (o: unknown) => enc.encode(`data: ${JSON.stringify(o)}\n\n`);
  const words = answer.split(/(?<=\s)/);
  const queries = image
    ? ['jakarta flood photo 2019 reuters', 'storm photo reverse image earliest']
    : ['einstein insanity quote origin', 'definition of insanity earliest appearance'];
  const chunks = image
    ? [
        { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/1', title: 'reuters.com' } },
        { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/2', title: 'snopes.com' } },
      ]
    : [
        { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/1', title: 'quoteinvestigator.com' } },
        { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/2', title: 'en.wikiquote.org' } },
      ];
  return new ReadableStream({
    async start(controller) {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      await sleep(700);
      controller.enqueue(
        chunk({
          candidates: [
            {
              content: { parts: [] },
              groundingMetadata: { webSearchQueries: queries },
            },
          ],
        }),
      );
      await sleep(900);
      controller.enqueue(
        chunk({
          candidates: [
            {
              content: { parts: [] },
              groundingMetadata: {
                groundingChunks: chunks,
                searchEntryPoint: {
                  renderedContent:
                    '<div style="font-family:system-ui;display:flex;gap:6px;flex-wrap:wrap"><a style="border:1px solid #ddd;border-radius:999px;padding:5px 10px;font-size:12px;color:#222;text-decoration:none" href="https://www.google.com/search?q=einstein+insanity+quote+origin">einstein insanity quote origin</a><a style="border:1px solid #ddd;border-radius:999px;padding:5px 10px;font-size:12px;color:#222;text-decoration:none" href="https://www.google.com/search?q=narcotics+anonymous+1981+insanity">narcotics anonymous 1981 insanity</a></div>',
                },
              },
            },
          ],
        }),
      );
      for (let i = 0; i < words.length; i += 3) {
        await sleep(40);
        controller.enqueue(chunk({ candidates: [{ content: { parts: [{ text: words.slice(i, i + 3).join('') }] } }] }));
      }
      controller.enqueue(
        chunk({ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1480, candidatesTokenCount: 420 } }),
      );
      controller.close();
    },
  });
}
