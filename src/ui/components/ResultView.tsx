import { useEffect, useRef, useState } from 'react';
import type { CheckResult, TimelineEvent } from '@/lib/pipeline/schema';
import { localStamp, resultToTsvRow, TABLE_HEADINGS_TSV } from '@/lib/history/row';
import type { ProviderId, Settings } from '@/lib/storage/settings';
import { googleAiModeUrl, type GoogleAiModeVariant } from '@/lib/googleAiMode';
import { ClaimList } from './ClaimList';
import { EvidencePanel, FactCheckBanner, localeDate, WhatWasSent } from './EvidencePanel';
import { savePageUrl } from '@/lib/lookups/wayback';
import { Cite, Count, Label, ProviderBadge, TextAction, formatUsd, timeAgo } from './common';
import { askLabel, normalizeAsk, questionFor, type Ask } from '@/lib/pipeline/question';
import { Check, Copy, External, Logo, Refresh } from './Icons';
import { InputCard } from './InputCard';
import { Narrative } from './Narrative';
import { ProvenancePanel } from './ProvenancePanel';
import { PROVIDER_LABELS, providerShortName } from '@/lib/providers/registry';
import { useSeenBefore } from '../hooks/useSeenBefore';
import type { PreviousResult } from '../hooks/useCheckRun';
import { useFollowUps } from '../hooks/useFollowUps';
import { FollowUpBox, FollowUpList } from './FollowUps';
import type { FollowUp } from '@/lib/pipeline/schema';
import { SearchSuggestions } from './SearchSuggestions';
import { SourceList } from './SourceList';
import { VerdictBanner } from './VerdictBanner';

/**
 * Reading order follows the question that was asked. A fact-check: verdict, original source,
 * reasoning, claims, sources. Any other question: verdict, then the answer (the timeline first when
 * one was asked for), then the original source and the rest.
 */
export function ResultView({
  result,
  onRecheck,
  onNewCheck,
  saved,
  saveError,
  notSaved,
  snapshotNote,
  embedded,
  webmodeVariant,
  searchTool,
  secondOpinions,
  onSecondOpinion,
  otherAsks,
  onAsk,
  note,
  previous,
  onOpenDetail,
  settings,
  onSettings,
}: {
  result: CheckResult;
  onRecheck: () => void;
  onNewCheck?: () => void;
  saved?: boolean;
  /** Set when saving to history failed; shown where the "Saved" badge would be. */
  saveError?: string | null;
  /** Set when the check was deliberately not saved (a private window); shown where the "Saved" badge would be. */
  notSaved?: string;
  snapshotNote?: string;
  /** Inside the history detail view: no action bar, no own scroll container, the header already names the subject. */
  embedded?: boolean;
  /** Which Google page "Compare in Google AI Mode" opens. */
  webmodeVariant: GoogleAiModeVariant;
  /** Name of the local model's search tool, for the transparency block. */
  searchTool?: string;
  /** Other configured providers that could give a second opinion on the same input. */
  secondOpinions?: { id: ProviderId; label: string }[];
  onSecondOpinion?: (id: ProviderId) => void;
  /** The user's note on the saved check, for the spreadsheet row. */
  note?: string;
  /** Other questions the same content could be asked, and the way to ask one. */
  otherAsks?: Ask[];
  onAsk?: (ask: Ask) => void;
  /** The earlier result this one follows: the answer a second opinion responds to, or the answer to the question asked before. */
  previous?: PreviousResult;
  /** Opens a saved check (the previous result, an earlier check of the same image). */
  onOpenDetail?: (id: string) => void;
  /** With settings, the result takes follow-up questions (they name the model that answers). */
  settings?: Settings;
  onSettings?: () => void;
}) {
  const seenBefore = useSeenBefore(result);
  const thread = useFollowUps(result, settings);
  // Copy outcome goes into the footer's live region, so it is announced and survives a failed clipboard write.
  const [copyNote, setCopyNote] = useState<{ ok: boolean; text: string } | null>(null);
  const copyText = async (text: string, done: string, failed: string, ms = 3500) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyNote({ ok: true, text: done });
    } catch {
      setCopyNote({ ok: false, text: failed });
    }
    setTimeout(() => setCopyNote(null), ms);
  };
  // Plain text only, and no NUL characters (some applications stop reading a paste at the first one).
  const copy = () => copyText(toMarkdown(result, thread.items).replaceAll('\0', ''), 'Copied as Markdown', 'Couldn’t copy — select the text instead', 2500);
  // One tab-separated row, in the columns of the History export: paste it under the last row of a
  // sheet in Excel, Google Sheets or Numbers to add this check to a log you already keep.
  const copyRow = () => copyText(resultToTsvRow(result, note ?? ''), 'Row copied — paste it under the last row of your sheet', 'Couldn’t copy the row');
  const copyHeadings = () => copyText(TABLE_HEADINGS_TSV, 'Headings copied — paste them into row 1 of a new sheet', 'Couldn’t copy the headings');
  const usd = formatUsd(result.usage?.estUsd);
  const verdictRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!embedded) verdictRef.current?.focus();
  }, [embedded, result.id]);
  const o = result.originalSource;
  const askId = normalizeAsk(result.input.ask).id;
  // A fact-check reads verdict, source, reasoning. Any other question was not "is it true?", so its answer leads.
  const answerFirst = askId !== 'factcheck';
  const answer = (
    <div className="flex flex-col gap-1.5">
      <Label>{answerFirst ? 'Answer' : 'Assessment'}</Label>
      <Narrative text={result.narrative} />
    </div>
  );
  // Retrieved by the provider's search, not merely written by the model.
  const originalRetrieved = !!o?.sourceId && result.sources.some((s) => s.id === o.sourceId && s.verified);
  const compare = (
    <TextAction href={googleAiModeUrl(result.input, webmodeVariant)}>
      Compare in Google AI Mode <span aria-hidden="true">↗</span>
    </TextAction>
  );

  return (
    <div className={embedded ? 'flex flex-col' : 'flex h-full flex-col'}>
      <div className={`flex grow flex-col gap-3.5 p-3.5 ${embedded ? '' : 'overflow-y-auto'}`}>
        {!embedded && <InputCard input={result.input} when={timeAgo(result.createdAt)} clamp />}
        <div className="flex flex-col gap-1.5">
          <p className="m-0 text-[12px] leading-4 text-ink-2">
            <span className="font-semibold text-ink">{askLabel(result.input.ask)}:</span> “{questionFor(result.input.ask, result.input.kind)}”
          </p>
          {otherAsks && otherAsks.length > 0 && onAsk && (
            <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink-2" role="group" aria-label="Ask instead">
              <span aria-hidden="true">Ask instead:</span>
              {otherAsks.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="wys-btn h-7 px-2 text-[12px]"
                  title={questionFor(a, result.input.kind)}
                  aria-label={`Ask instead: ${questionFor(a, result.input.kind)}`}
                  onClick={() => onAsk(a)}
                >
                  {askLabel(a)}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Published fact-checks lead a fact-check; for any other question they follow the answer. */}
        {!answerFirst && result.factChecks && <FactCheckBanner checks={result.factChecks} />}
        {answerFirst && <Label>How far to trust it</Label>}
        <VerdictBanner ref={verdictRef} verdict={result.verdict} />
        {previous && (
          <p className="m-0 text-[12px] leading-4 text-ink-2">
            {previous.label}: <span className="font-semibold text-ink">{previous.verdict}</span>
            {onOpenDetail && (
              <>
                {' '}
                <TextAction onClick={() => onOpenDetail(previous.id)}>
                  Open that result <span aria-hidden="true">↗</span>
                </TextAction>
              </>
            )}
          </p>
        )}
        {result.degraded && (
          <div className="rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-[12px] leading-4 text-warn-ink">
            {result.truncated
              ? 'The answer stopped before it was finished, so parts may be missing. Press Re-check below to try again.'
              : 'The model answered in prose only, so read the assessment below; claims and sources could not be extracted. Press Re-check below to try again.'}
          </div>
        )}

        {/* The answer to the question that was asked comes straight after the verdict. */}
        {askId === 'timeline' && <Timeline events={result.timeline} />}
        {answerFirst && answer}
        {answerFirst && result.factChecks && <FactCheckBanner checks={result.factChecks} />}
        {o && (
          <div className="flex flex-col gap-1.5">
            <Label>{result.input.kind === 'image' ? 'Earliest match found' : 'Likely original source'}</Label>
            <div className="flex gap-2.5 rounded-xl border border-accent-line bg-accent-wash p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-[13px] font-bold text-accent">
                {initials(o.publisher || o.title)}
              </span>
              <div className="flex min-w-0 grow flex-col gap-1">
                <span className="text-[14px] leading-[18px] font-semibold">{o.title}</span>
                {(o.publisher || o.date || result.originalCapture?.firstCaptured) && (
                  <span className="text-[12px] text-ink-2">
                    {[o.publisher, o.date].filter(Boolean).join(' · ')}
                    {result.originalCapture?.firstCaptured && result.originalCapture.archiveUrl && (
                      <>
                        {o.publisher || o.date ? ' · ' : ''}
                        <a href={result.originalCapture.archiveUrl} target="_blank" rel="noopener noreferrer" className="no-underline">
                          first archived {localeDate(result.originalCapture.firstCaptured)} ↗
                        </a>
                      </>
                    )}
                  </span>
                )}
                {o.how && <span className="text-[12px] leading-4 text-ink-2">{o.how}</span>}
                <div className="mt-1 flex items-center gap-3.5">
                  {/* A live link only for an address the provider actually retrieved; one the model merely wrote is shown as text. */}
                  {o.url && originalRetrieved && (
                    <a href={o.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold no-underline">
                      Open source <External size={12} />
                    </a>
                  )}
                  {o.url && !originalRetrieved && <span className="text-[12px] break-all text-ink-2">Not retrieved: {o.url}</span>}
                  {o.sourceId && (
                    <span className="text-[12px] text-ink-2">
                      Source <Cite id={o.sourceId} />
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {!answerFirst && answer}
        {askId !== 'timeline' && <Timeline events={result.timeline} />}
        <EvidencePanel result={result} />

        {result.input.kind === 'image' && result.provenance && <ProvenancePanel provenance={result.provenance} srcUrl={result.input.srcUrl} />}
        {seenBefore && (
          <p className="m-0 rounded-lg bg-accent-soft px-3 py-2 text-[12px] leading-4 text-accent">
            You checked this image before, on {new Date(seenBefore.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}:{' '}
            <span className="font-semibold">{seenBefore.verdictLabel}</span>
            {onOpenDetail && (
              <>
                {' '}
                <TextAction onClick={() => onOpenDetail(seenBefore.id)}>
                  Open it <span aria-hidden="true">↗</span>
                </TextAction>
              </>
            )}
          </p>
        )}

        <ClaimList claims={result.claims} />
        <SourceList sources={result.sources} credibility={result.credibility} notes={result.mixNotes} />
        {result.pageCapture && (
          <p className="m-0 text-[12px] leading-4 text-ink-2">
            {result.pageCapture.firstCaptured && result.pageCapture.archiveUrl ? (
              <>
                Wayback Machine: first archived {localeDate(result.pageCapture.firstCaptured)} —{' '}
                <a href={result.pageCapture.archiveUrl} target="_blank" rel="noopener noreferrer" className="font-medium no-underline">
                  view that copy ↗
                </a>{' '}
                ·{' '}
                <a href={savePageUrl(result.pageCapture.url)} target="_blank" rel="noopener noreferrer" className="font-medium no-underline">
                  save today’s version ↗
                </a>
              </>
            ) : (
              <>
                The Wayback Machine has no copy of this page.{' '}
                <a href={savePageUrl(result.pageCapture.url)} target="_blank" rel="noopener noreferrer" className="font-medium no-underline">
                  Save one now ↗
                </a>
              </>
            )}
          </p>
        )}
        {result.notes && <p className="wys-measure m-0 text-[12px] leading-4 text-ink-2">{result.notes}</p>}
        {result.searchSuggestionsHtml && <SearchSuggestions html={result.searchSuggestionsHtml} />}
        {!embedded && secondOpinions && secondOpinions.length > 0 && onSecondOpinion && (
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-2" role="group" aria-label="Second opinion">
            <span aria-hidden="true">Second opinion:</span>
            {secondOpinions.map((p) => (
              <button
                key={p.id}
                type="button"
                className="wys-btn h-8 px-2.5 text-[12px]"
                aria-label={`Second opinion from ${p.label}`}
                onClick={() => onSecondOpinion(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        <WhatWasSent result={result} searchTool={searchTool} snapshotSaved={saved && snapshotNote?.includes('snapshot')} />

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-2">
          <ProviderBadge
            label={`${providerShortName(result.provider.id, undefined) === PROVIDER_LABELS['openai-compat'] ? result.provider.label : providerShortName(result.provider.id)} · ${result.provider.model || '?'}`}
          />
          <span>
            {[
              result.searchQueries.length ? `${result.searchQueries.length} search${result.searchQueries.length === 1 ? '' : 'es'}` : null,
              result.usage?.inputTokens || result.usage?.outputTokens
                ? `${fmtK((result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0))} tokens`
                : null,
              usd ? (result.searchQueries.length ? `${usd} if past the free search allowance` : usd) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] text-ink-2">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {compare}
            <TextAction onClick={() => void copyRow()}>Copy as spreadsheet row</TextAction>
            <TextAction onClick={() => void copyHeadings()}>Copy column headings</TextAction>
          </span>
          <span role="status" aria-live="polite">
            {copyNote && <span className={copyNote.ok ? 'font-medium' : 'font-semibold text-bad'}>{copyNote.text}</span>}
            {!copyNote && saved && (
              <span className="inline-flex items-center gap-1 font-medium">
                <Check size={12} /> {snapshotNote ?? 'Saved to history'}
              </span>
            )}
            {!copyNote && notSaved && <span className="font-medium">{notSaved}</span>}
            {saveError && (
              <span className="font-semibold text-bad" title={saveError}>
                Couldn’t save to history
              </span>
            )}
          </span>
        </div>
        {/* Last in the scroll, so the thread sits just above the box it is asked from. */}
        <FollowUpList thread={thread} />
        {embedded && settings && <FollowUpBox thread={thread} onSettings={onSettings} />}
      </div>
      {!embedded && settings && (
        <div className="shrink-0 border-t border-line bg-paper px-3.5 pt-2.5">
          <FollowUpBox thread={thread} onSettings={onSettings} />
        </div>
      )}
      {!embedded && (
        <div className={`flex shrink-0 gap-2 bg-paper px-3.5 py-2.5 ${settings ? '' : 'border-t border-line'}`}>
          {/* The outcome shows on the button itself: the status line is far down the scrolled result. */}
          <button className="wys-btn wys-btn-narrow" onClick={() => void copy()} aria-label="Copy as Markdown" title="Copy as Markdown">
            {copyNote?.ok ? <Check size={15} /> : <Copy size={15} />} <span className="wys-btn-label">{copyNote?.ok ? 'Copied' : 'Copy'}</span>
          </button>
          <button className="wys-btn wys-btn-narrow" onClick={onRecheck} aria-label="Re-check" title="Re-check">
            <Refresh size={15} /> <span className="wys-btn-label">Re-check</span>
          </button>
          {onNewCheck && (
            <button className="wys-btn wys-btn-primary grow" onClick={onNewCheck}>
              <Logo size={15} /> New check
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Dated events, earliest first, as the model ordered them. */
function Timeline({ events }: { events?: TimelineEvent[] }) {
  if (!events?.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        Timeline <Count n={events.length} />
      </Label>
      <ol className="wys-card m-0 flex list-none flex-col gap-2 px-3 py-2.5">
        {events.map((t, i) => (
          <li key={i} className="flex flex-col gap-0.5 border-l-2 border-accent-line pl-2.5">
            {t.date && <span className="text-[12px] font-semibold">{t.date}</span>}
            <span className="text-[12px] leading-[17px] text-ink-2">
              {t.event} {t.sourceId && <Cite id={t.sourceId} />}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function initials(s: string): string {
  const words = s
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase();
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase();
}

function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function toMarkdown(r: CheckResult, followUps: FollowUp[] = r.followUps ?? []): string {
  const lines: string[] = [];
  const subject =
    r.input.kind === 'text'
      ? `> ${r.input.text.replace(/\n/g, '\n> ')}`
      : r.input.kind === 'image'
        ? // An inline image can be over a megabyte of base64: name it, never put it on the clipboard.
          `Image: ${/^https?:/i.test(r.input.srcUrl) ? r.input.srcUrl : `inline image on ${r.input.pageUrl}`}`
        : r.input.kind === 'post'
          ? `Post on ${r.input.site}${r.input.author ? ` by ${r.input.author}` : ''}${r.input.permalink ? ` (${r.input.permalink})` : ''}:\n> ${r.input.text.replace(/\n/g, '\n> ')}`
          : `Page: ${r.input.url}`;
  lines.push(`**${r.verdict.label}** (${r.verdict.confidence} confidence) — ${r.verdict.summary}`, '', subject, '');
  lines.push(`Question: ${questionFor(r.input.ask, r.input.kind)}`, '', r.narrative, '');
  if (r.timeline?.length) {
    lines.push('Timeline:');
    for (const t of r.timeline) lines.push(`- ${t.date ? `${t.date}: ` : ''}${t.event}${t.sourceId ? ` [${t.sourceId}]` : ''}`);
    lines.push('');
  }
  if (r.factChecks?.length) {
    lines.push('**Already fact-checked**');
    for (const f of r.factChecks.slice(0, 4)) lines.push(`- ${f.publisher}: ${f.rating}${f.reviewDate ? ` (${f.reviewDate.slice(0, 10)})` : ''} — ${f.url}`);
    lines.push('');
  }
  if (r.originalSource) {
    lines.push(
      `**Likely original source:** ${r.originalSource.title}${r.originalSource.publisher ? ` — ${r.originalSource.publisher}` : ''}${r.originalSource.date ? ` (${r.originalSource.date})` : ''}${r.originalSource.url ? ` ${r.originalSource.url}` : ''}`,
      '',
    );
  }
  if (r.claims.length) {
    lines.push('**Claims**');
    for (const c of r.claims) lines.push(`- ${c.text} — ${c.status}${c.note ? `: ${c.note}` : ''}${c.sourceIds.length ? ` [${c.sourceIds.join(', ')}]` : ''}`);
    lines.push('');
  }
  if (r.sources.length) {
    lines.push('**Sources**');
    for (const s of r.sources) {
      // Grounding links are opaque redirects; the domain says more than the redirect URL does.
      const where = !s.verified ? `${s.domain} (unverified)` : s.url.includes('grounding-api-redirect') ? `${s.domain} — ${s.url}` : s.url;
      const rating = r.credibility?.[s.domain];
      lines.push(`${s.id}. ${s.title} — ${where}${rating ? ` [Wikipedia: ${rating.statusLabel}]` : ''}`);
    }
    lines.push('');
  }
  if (r.evidence?.for.length || r.evidence?.against.length || r.missingContext || r.wouldChange) {
    lines.push('**Evidence**');
    for (const t of r.evidence?.for ?? []) lines.push(`- Why it could be true: ${t}`);
    for (const t of r.evidence?.against ?? []) lines.push(`- Why it may not be: ${t}`);
    if (r.missingContext) lines.push(`- What it leaves out: ${r.missingContext}`);
    if (r.wouldChange) lines.push(`- What would change this: ${r.wouldChange}`);
    lines.push('');
  }
  if (followUps.length) {
    lines.push('**Follow-up questions**');
    for (const f of followUps)
      lines.push(`Q: ${f.question}`, '', f.answer, ...(f.sources.length ? ['', `Sources: ${f.sources.map((s) => s.url).join(' , ')}`] : []), '');
  }
  if (r.pageCapture?.firstCaptured) lines.push(`_Page first archived by the Wayback Machine on ${r.pageCapture.firstCaptured}._`, '');
  // Local time, as every other place the check's time is shown (an evening check is not dated tomorrow).
  lines.push(`_Checked with ${r.provider.label} (${r.provider.model}) via WhatsYourSource, ${localStamp(r.createdAt)}_`);
  return lines.join('\n');
}

export { toMarkdown as resultToMarkdown };
