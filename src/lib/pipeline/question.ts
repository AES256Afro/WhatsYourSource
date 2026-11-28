/**
 * The question a check asks, in the words put to the model, to the search engine and to Google AI
 * Mode. The user picks one of the presets below or writes their own; "fact-check" is the default.
 * Its own module, with no imports, so the popup and the background can use it cheaply.
 */
export const ASK_IDS = ['factcheck', 'explain', 'summarize', 'timeline', 'flaws', 'sources', 'custom'] as const;
export type AskId = (typeof ASK_IDS)[number];
export type PresetAskId = Exclude<AskId, 'custom'>;

/** Which question to ask; `custom` carries the user's own words when `id` is `'custom'`. */
export interface Ask {
  id: AskId;
  custom?: string;
}

export const DEFAULT_ASK: Ask = { id: 'factcheck' };
/** A custom question is one sentence or two, not a prompt. */
export const MAX_CUSTOM_QUESTION = 300;
/** How many questions of their own the user can keep (each one is a row on every right-click target). */
export const MAX_SAVED_QUESTIONS = 8;

export type AskKind = 'text' | 'image' | 'page' | 'post';

interface Preset {
  /** Short name on buttons and menus. */
  label: string;
  /** One line shown under the picker: what the answer will cover. */
  hint: string;
  /** The question itself, per kind of content. */
  question: Record<AskKind, string>;
  /** What to do beyond the question, put after it in the request. */
  detail: Record<AskKind, string>;
}

const same = (s: string): Record<AskKind, string> => ({ text: s, image: s, page: s, post: s });

export const ASK_PRESETS: Record<PresetAskId, Preset> = {
  factcheck: {
    label: 'Fact-check',
    hint: 'Checks whether it is accurate, what it leaves out, and where it first came from',
    question: {
      text: 'Is this accurate, what context is it missing, and where can I find the original source?',
      image: 'Is this image real, edited or AI-made, is it shown in its true context, and where can I find its original source?',
      page: 'Is what this page says accurate, what context is it missing, and where can I find the original source?',
      post: 'Is this post accurate, what context is it missing, and where can I find the source of what it claims?',
    },
    detail: {
      text: 'Specifically: do the claims in the highlighted text hold up, who originally said or wrote it (author, publication, date), and is the attribution right?',
      image:
        'Describe what it shows, say whether it is being presented accurately here, and find its earliest or original appearance online (publisher, date, original caption). Note any signs of editing or AI generation, but do not overclaim.',
      page: 'Who publishes it, is it an original source or a repost, and do its main claims hold up?',
      post: 'Identify the specific claims it makes, say whether they hold up, whether the linked material says what the post says it does, and where the claims originally come from (is this the original source or a repost?).',
    },
  },
  explain: {
    label: 'Explain it',
    hint: 'Explains what they are talking about, with the background needed to follow it',
    question: {
      text: 'What are they talking about? Explain it in plain terms, with the background needed to follow it.',
      image: 'What does this image show and what is it about? Explain it in plain terms, with the background needed to follow it.',
      page: 'What is this page talking about? Explain it in plain terms, with the background needed to follow it.',
      post: 'What is this post talking about? Explain it in plain terms, with the background needed to follow it.',
    },
    detail: same(
      'Explain it for someone meeting the topic for the first time: the background, the people and organisations involved, and the primary sources to read. Say plainly if any part of it is inaccurate, but the explanation comes first.',
    ),
  },
  summarize: {
    label: 'Summarize',
    hint: 'Sums up the main points, who is saying it and what they want you to take away',
    question: {
      text: 'Summarize this text: the main points, who is saying it and what they want the reader to take away.',
      image: 'Summarize what this image shows: the main points, who published it and what they want the viewer to take away.',
      page: 'Summarize this article: the main points, who is saying it and what they want the reader to take away.',
      post: 'Summarize this post: the main points, who is saying it and what they want the reader to take away.',
    },
    detail: same(
      'Summarize it faithfully first, in a few short points, without adding to it or arguing with it. Then, as always, say how far it can be trusted and where it comes from.',
    ),
  },
  timeline: {
    label: 'Timeline',
    hint: 'Lists the key events in date order, up to today',
    question: {
      text: 'What is the timeline behind this: when did it start, how has it developed, and where does it stand now?',
      image: 'What is the timeline of this image: when was it made, when did it first appear, and how has it been used since?',
      page: 'What is the timeline behind what this page describes: when did it start, how has it developed, and where does it stand now?',
      post: 'What is the timeline behind this post: when did the story start, how has it developed, and where does it stand now?',
    },
    detail: same(
      'Put the key events in order in the "timeline" field, earliest first, each with a date as precise as the sources allow and the source it comes from. Say what is established, what is still disputed, and whether the content describes the current state of things or an earlier one.',
    ),
  },
  flaws: {
    label: 'Find the flaws',
    hint: 'Picks it apart: errors, spin and weak reasoning, and what holds up',
    question: {
      text: 'What in this is wrong, misleading or badly argued, and what does it get right?',
      image: 'What about this image or the way it is presented is inaccurate or misleading, and what is genuine?',
      page: 'What on this page is wrong, misleading or badly argued, and what does it get right?',
      post: 'What in this post is wrong, misleading or badly argued, and what does it get right?',
    },
    detail: same(
      'Go through it part by part. List each inaccurate or misleading statement and each error of reasoning as its own claim, naming the error in plain words (for example: a cherry-picked number, a false comparison, a cause assumed from a coincidence), with the evidence. List what it gets right as well. Do not invent flaws: if it holds up, say so.',
    ),
  },
  sources: {
    label: 'Find more sources',
    hint: 'Finds other reporting, the original source, and what confirms or contradicts it',
    question: same('Find additional sources on this: other reporting, the original or primary source, and anything that confirms or contradicts it.'),
    detail: same(
      'List each source you found in the "sources" field and say in the answer what each one adds: whether it is the original, independent reporting, or a confirmation or contradiction. Then, as always, say how far the content can be trusted and where it comes from.',
    ),
  },
};

const CUSTOM_DETAIL =
  'Answer that question first and directly, from what you can find. Then, as always, say how far the content can be trusted and where it comes from.';

/** A custom question as it will be sent: one line, bounded, or '' when there is nothing usable. */
export function cleanCustomQuestion(s: string | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CUSTOM_QUESTION);
}

/** The ask to use: the one given, unless it is a custom ask with no text (then the default). */
export function normalizeAsk(ask: Ask | undefined | null): Ask {
  if (!ask || !ASK_IDS.includes(ask.id)) return DEFAULT_ASK;
  if (ask.id !== 'custom') return { id: ask.id };
  const custom = cleanCustomQuestion(ask.custom);
  return custom ? { id: 'custom', custom } : DEFAULT_ASK;
}

/** The question in the user's words, for this kind of content. */
export function questionFor(ask: Ask | undefined | null, kind: AskKind): string {
  const a = normalizeAsk(ask);
  return a.id === 'custom' ? (a.custom ?? '') : ASK_PRESETS[a.id].question[kind];
}

/** What the model should do beyond answering the question. */
export function detailFor(ask: Ask | undefined | null, kind: AskKind): string {
  const a = normalizeAsk(ask);
  return a.id === 'custom' ? CUSTOM_DETAIL : ASK_PRESETS[a.id].detail[kind];
}

/** The picker's button for writing a question. An action, so never used as the name of a question that was asked. */
export const CUSTOM_ASK_BUTTON = 'Ask your own';
/** What a question the user wrote is called once it exists (results, history, the chip, exports). */
export const CUSTOM_ASK_NAME = 'Your question';

/** The name of a question that was or will be asked ("Fact-check", "Timeline", "Your question"). */
export function askLabel(ask: Ask | undefined | null): string {
  const a = normalizeAsk(ask);
  return a.id === 'custom' ? CUSTOM_ASK_NAME : ASK_PRESETS[a.id].label;
}

/** The label of an option in the picker, where the custom one is an invitation ("Ask your own"). */
export function askIdLabel(id: AskId): string {
  return id === 'custom' ? CUSTOM_ASK_BUTTON : ASK_PRESETS[id].label;
}

/**
 * The saved questions as kept: each one cleaned, empty ones and repeats dropped, at most
 * `MAX_SAVED_QUESTIONS`. Anything that is not a list of strings counts as no questions.
 */
export function cleanSavedQuestions(saved: unknown): string[] {
  if (!Array.isArray(saved)) return [];
  const out: string[] = [];
  for (const raw of saved) {
    const q = typeof raw === 'string' ? cleanCustomQuestion(raw) : '';
    if (q && !out.includes(q)) out.push(q);
    if (out.length === MAX_SAVED_QUESTIONS) break;
  }
  return out;
}

/** The user's saved questions as asks, in their order. */
export function savedAsks(saved: readonly string[] | undefined): Ask[] {
  return cleanSavedQuestions(saved).map((custom): Ask => ({ id: 'custom', custom }));
}

/** The preset ids, in display order. */
export const PRESET_ASK_IDS = ASK_IDS.filter((id): id is PresetAskId => id !== 'custom');

/**
 * Every question on offer: the presets, then the user's saved questions. A single string is read as
 * a list of one (the 1.2.x single custom question).
 */
export function availableAsks(saved: readonly string[] | string | undefined): Ask[] {
  const list = typeof saved === 'string' ? [saved] : (saved ?? []);
  return [...PRESET_ASK_IDS.map((id): Ask => ({ id })), ...savedAsks(list)];
}

/** The question settings as kept in storage (`Settings['ask']`), without the schema library. */
export interface AskSettings {
  default: AskId;
  /** The custom question used as the default when `default` is `'custom'`; '' otherwise. */
  custom: string;
  /** The user's own questions, offered on the right-click menu, the Home picker and the popup. */
  saved: string[];
}

/**
 * The question settings made consistent: the saved list cleaned; a custom default that is not saved
 * is added to the list when there is room; a custom question that is not the default and not saved
 * is dropped; a custom default with no words falls back to the fact-check.
 */
export function normalizeAskSettings(ask: AskSettings): AskSettings {
  const saved = cleanSavedQuestions(ask.saved);
  let custom = cleanCustomQuestion(ask.custom);
  let def = ask.default;
  if (def === 'custom') {
    if (!custom) def = 'factcheck';
    else if (!saved.includes(custom) && saved.length < MAX_SAVED_QUESTIONS) saved.push(custom);
  } else if (!saved.includes(custom)) custom = '';
  return { default: def, custom, saved };
}

/** Adds a question to the end of the saved list (unchanged when it is empty, already saved, or the list is full). */
export function addSavedQuestion(ask: AskSettings, text: string): AskSettings {
  const q = cleanCustomQuestion(text);
  if (!q || ask.saved.includes(q) || ask.saved.length >= MAX_SAVED_QUESTIONS) return ask;
  return { ...ask, saved: [...ask.saved, q] };
}

/**
 * Rewords the saved question at `index`. The default follows the edit. Empty words, a missing index
 * or the words of another saved question leave everything as it was.
 */
export function editSavedQuestion(ask: AskSettings, index: number, text: string): AskSettings {
  const q = cleanCustomQuestion(text);
  const old = ask.saved[index];
  if (old === undefined || !q || q === old || ask.saved.includes(q)) return ask;
  const saved = ask.saved.map((s, i) => (i === index ? q : s));
  return { ...ask, saved, custom: ask.custom === old ? q : ask.custom };
}

/** Removes the saved question at `index`. When it was the default, the default goes back to the fact-check. */
export function removeSavedQuestion(ask: AskSettings, index: number): AskSettings {
  const old = ask.saved[index];
  if (old === undefined) return ask;
  const saved = ask.saved.filter((_, i) => i !== index);
  if (ask.custom !== old) return { ...ask, saved };
  return { default: ask.default === 'custom' ? 'factcheck' : ask.default, custom: '', saved };
}

/** The default question for each kind, kept under their old names for the places that only ever fact-check. */
export const QUESTION = ASK_PRESETS.factcheck.question.text;
export const IMAGE_QUESTION = ASK_PRESETS.factcheck.question.image;
export const PAGE_QUESTION = ASK_PRESETS.factcheck.question.page;
export const POST_QUESTION = ASK_PRESETS.factcheck.question.post;
