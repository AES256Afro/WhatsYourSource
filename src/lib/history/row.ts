import { isDirectQuestion } from '../messaging/limits';
import { askLabel, questionFor } from '../pipeline/question';
import type { CheckResult } from '../pipeline/schema';
import { truncate } from '../util/url';
import type { StoredCheck } from './db';

/**
 * One check as a row of a table (the spreadsheet export, and the row copied from a result). Apart
 * from `export.ts` so a result on screen can copy its row without loading the file exports.
 */

/** Column headings of the table export, in order. */
export const TABLE_COLUMNS = [
  'Date (local time)',
  'Title',
  'Topic',
  'What was checked',
  'Page address',
  'Content type',
  'Question type',
  'Question',
  'Verdict',
  'Confidence',
  'Verdict summary',
  'Answer',
  'Timeline',
  'Claims',
  'Original source',
  'Original source link',
  'Sources',
  'Archived copy',
  'Checked with',
  'Note',
] as const;

const KIND_NAME = { text: 'Text', image: 'Image', page: 'Page', post: 'Post' } as const;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pad = (n: number) => String(n).padStart(2, '0');
/** Local date and time, in a form every spreadsheet reads as a date. */
export function localStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The local calendar date as YYYY-MM-DD, for file names (the UTC date is already tomorrow on an American evening). */
export function localDay(ms = Date.now()): string {
  return localStamp(ms).slice(0, 10);
}

/** Never a formula: a leading = + - @ would be run by Excel and Sheets. */
export function defuse(v: string): string {
  const flat = v.replace(/\r\n?/g, '\n').replaceAll('\0', '');
  return /^[=+\-@\t]/.test(flat.trimStart()) ? `'${flat}` : flat;
}

/** The row of the table for one result: what was asked, about what, and what was found. */
export function resultToRow(r: CheckResult, note = ''): string[] {
  const i = r.input;
  const what =
    i.kind === 'text' || i.kind === 'post' ? i.text : i.kind === 'image' ? (/^https?:/i.test(i.srcUrl) ? i.srcUrl : i.alt || 'Inline image') : i.title || i.url;
  // A question asked directly: the question is what was asked, and there was no content or page.
  const question = isDirectQuestion(i);
  const where = i.kind === 'page' ? i.url : i.kind === 'post' ? i.permalink || i.pageUrl : i.pageUrl;
  const o = r.originalSource;
  // Only an address the provider actually retrieved goes out as the original source's link.
  const originalRetrieved = !!o?.sourceId && r.sources.some((s) => s.id === o.sourceId && s.verified);
  return [
    localStamp(r.createdAt),
    r.title || truncate(what.replace(/\s+/g, ' ').trim(), 90),
    r.topic ? capital(r.topic) : '',
    question ? '' : truncate(what, 2000),
    where,
    question ? 'Question' : KIND_NAME[i.kind],
    question ? 'Question' : askLabel(i.ask),
    question ? i.text.replace(/\s+/g, ' ').trim() : questionFor(i.ask, i.kind),
    r.verdict.label,
    capital(r.verdict.confidence),
    r.verdict.summary,
    // What was actually answered: for anything but a fact-check the verdict alone says little.
    truncate(r.narrative, 5000),
    (r.timeline ?? []).map((t) => `${t.date ? `${t.date}: ` : ''}${t.event}`).join('\n'),
    r.claims.map((c) => `${c.text} (${c.status})`).join('\n'),
    // A source the provider did not retrieve keeps its address as a lead, marked as such, and gets no link.
    o ? [o.title, o.publisher, o.date].filter(Boolean).join(', ') + (o.url && !originalRetrieved ? ` (link not retrieved: ${o.url})` : '') : '',
    originalRetrieved ? (o?.url ?? '') : '',
    r.sources
      .filter((s) => s.verified)
      .slice(0, 8)
      // Gemini's grounding links are opaque redirects that expire: name the source instead.
      .map((s) => (s.url.includes('grounding-api-redirect') ? `${s.domain}: ${s.title}` : s.url))
      .join('\n'),
    r.pageCapture?.archiveUrl ?? r.originalCapture?.archiveUrl ?? '',
    [r.provider.label.replace(/\s*\(your key\)/i, ''), r.provider.model].filter(Boolean).join(' · '),
    note,
  ];
}

export function checkToRow(check: StoredCheck): string[] {
  return resultToRow(check.result, check.note);
}

/**
 * One check as a single tab-separated line, in the same columns, for pasting under the last row of
 * a sheet the user already keeps. Tabs and line breaks inside a value would split the row, so they
 * become spaces and " | ".
 */
export function resultToTsvRow(r: CheckResult, note = ''): string {
  return (
    resultToRow(r, note)
      .map((v) => defuse(v).replace(/\t/g, ' ').replace(/\n+/g, ' | '))
      // A value with a double quote is quoted whole (quotes doubled): spreadsheets read a bare leading
      // quote in pasted text as the start of a quoted cell and merge the columns after it.
      .map((v) => (v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v))
      .join('\t')
  );
}

/** The heading row as one tab-separated line, for starting a new sheet that copied rows will go under. */
export const TABLE_HEADINGS_TSV = TABLE_COLUMNS.join('\t');
