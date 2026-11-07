import { useEffect, useRef, useState } from 'react';
import type { CheckResult } from '@/lib/pipeline/schema';
import { googleAiModeUrl } from '@/lib/webmode';
import { ClaimList } from './ClaimList';
import { EvidencePanel, FactCheckBanner, WhatWasSent } from './EvidencePanel';
import { savePageUrl } from '@/lib/evidence/wayback';
import { Cite, Label, ProviderBadge, TextAction, formatUsd, timeAgo } from './common';
import { Check, Copy, External, Logo, Refresh } from './Icons';
import { InputCard } from './InputCard';
import { Narrative } from './Narrative';
import { ProvenancePanel } from './ProvenancePanel';
import { SearchSuggestions } from './SearchSuggestions';
import { SourceList } from './SourceList';
import { VerdictBanner } from './VerdictBanner';

/**
 * Reading order answers the product's two questions in order: is it true (verdict), where is the
 * source (original-source card), then the reasoning, the claims and the full source list.
 */
export function ResultView({
  result,
  onRecheck,
  onNewCheck,
  saved,
  saveError,
  snapshotNote,
  embedded,
}: {
  result: CheckResult;
  onRecheck: () => void;
  onNewCheck?: () => void;
  saved?: boolean;
  /** Set when saving to history failed; shown where the "Saved" badge would be. */
  saveError?: string | null;
  snapshotNote?: string;
  /** Inside the history detail view: no action bar, no own scroll container, the header already names the subject. */
  embedded?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(toMarkdown(result));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const usd = formatUsd(result.usage?.estUsd);
  const verdictRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!embedded) verdictRef.current?.focus();
  }, [embedded, result.id]);
  const o = result.originalSource;
  const compare = (
    <TextAction href={googleAiModeUrl(result.input)}>
      Compare in Google AI Mode <span aria-hidden="true">↗</span>
    </TextAction>
  );

  return (
    <div className={embedded ? 'flex flex-col' : 'flex h-full flex-col'}>
      <div className={`flex grow flex-col gap-3.5 p-3.5 ${embedded ? '' : 'overflow-y-auto'}`}>
        {!embedded && <InputCard input={result.input} when={timeAgo(result.createdAt)} clamp />}
        {result.factChecks && <FactCheckBanner checks={result.factChecks} />}
        <VerdictBanner ref={verdictRef} verdict={result.verdict} />
        {result.degraded && (
          <div className="rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-[12px] leading-4 text-warn-ink">
            The model answered in prose only, so read the assessment below; claims and sources could not be extracted. Re-check to try again.
          </div>
        )}

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
                    {[o.publisher, o.date, result.originalCapture?.firstCaptured ? `first archived ${result.originalCapture.firstCaptured}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                )}
                {o.how && <span className="text-[12px] leading-4 text-ink-2">{o.how}</span>}
                <div className="mt-1 flex items-center gap-3.5">
                  {o.url && (
                    <a href={o.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold no-underline">
                      Open source <External size={12} />
                    </a>
                  )}
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

        <div className="flex flex-col gap-1.5">
          <Label>Assessment</Label>
          <Narrative text={result.narrative} />
        </div>
        <EvidencePanel result={result} />

        {result.input.kind === 'image' && result.provenance && <ProvenancePanel provenance={result.provenance} srcUrl={result.input.srcUrl} />}

        <ClaimList claims={result.claims} />
        <SourceList sources={result.sources} right={compare} credibility={result.credibility} notes={result.mixNotes} />
        {result.pageCapture && (
          <p className="m-0 text-[11px] leading-[15px] text-ink-2">
            {result.pageCapture.firstCaptured
              ? `This page was first archived by the Wayback Machine on ${result.pageCapture.firstCaptured}.`
              : 'The Wayback Machine has no capture of this page yet.'}{' '}
            <a href={savePageUrl(result.pageCapture.url)} target="_blank" rel="noopener noreferrer" className="font-medium no-underline">
              Archive it now ↗
            </a>
          </p>
        )}
        {result.sources.length === 0 && <div className="flex justify-end">{compare}</div>}
        {result.notes && <p className="wys-measure m-0 text-[12px] leading-4 text-ink-2">{result.notes}</p>}
        {result.searchSuggestionsHtml && <SearchSuggestions html={result.searchSuggestionsHtml} />}
        <WhatWasSent result={result} />

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-2">
          <ProviderBadge label={result.provider.model || result.provider.label} />
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
          <span className="grow" />
          <span role="status" aria-live="polite">
            {saved && (
              <span className="inline-flex items-center gap-1 font-medium">
                <Check size={12} /> {snapshotNote ?? 'Saved to history'}
              </span>
            )}
            {saveError && (
              <span className="font-semibold text-bad" title={saveError}>
                Couldn’t save to history
              </span>
            )}
          </span>
        </div>
      </div>
      {!embedded && (
        <div className="flex shrink-0 gap-2 border-t border-line bg-paper px-3.5 py-2.5">
          <button className="wys-btn wys-btn-narrow" onClick={() => void copy()} aria-label={copied ? 'Copied' : 'Copy as Markdown'}>
            {copied ? <Check size={15} /> : <Copy size={15} />} <span className="wys-btn-label">{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <button className="wys-btn wys-btn-narrow" onClick={onRecheck} aria-label="Re-check">
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

export function toMarkdown(r: CheckResult): string {
  const lines: string[] = [];
  const subject =
    r.input.kind === 'text'
      ? `> ${r.input.text}`
      : r.input.kind === 'image'
        ? `Image: ${r.input.srcUrl}`
        : r.input.kind === 'post'
          ? `Post on ${r.input.site}${r.input.author ? ` by ${r.input.author}` : ''}${r.input.permalink ? ` (${r.input.permalink})` : ''}:\n> ${r.input.text.replace(/\n/g, '\n> ')}`
          : `Page: ${r.input.url}`;
  lines.push(`**${r.verdict.label}** (${r.verdict.confidence} confidence) — ${r.verdict.summary}`, '', subject, '', r.narrative, '');
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
    for (const s of r.sources) lines.push(`${s.id}. ${s.title} — ${s.verified ? s.url : `${s.domain} (unverified)`}`);
    lines.push('');
  }
  lines.push(`_Checked with ${r.provider.label} (${r.provider.model}) via WhatsYourSource, ${new Date(r.createdAt).toISOString()}_`);
  return lines.join('\n');
}
