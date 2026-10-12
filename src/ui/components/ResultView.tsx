import { useState } from 'react';
import type { CheckResult } from '@/lib/pipeline/schema';
import { googleAiModeUrl } from '@/lib/webmode';
import { ClaimList } from './ClaimList';
import { Cite, Label, ProviderBadge, formatUsd, timeAgo } from './common';
import { Check, Copy, External, Refresh } from './Icons';
import { InputCard } from './InputCard';
import { Narrative } from './Narrative';
import { ProvenancePanel } from './ProvenancePanel';
import { SearchSuggestions } from './SearchSuggestions';
import { SourceList } from './SourceList';
import { VerdictBanner } from './VerdictBanner';

export function ResultView({
  result,
  onRecheck,
  saved,
  snapshotNote,
  embedded,
}: {
  result: CheckResult;
  onRecheck: () => void;
  saved?: boolean;
  snapshotNote?: string;
  /** Inside the history detail view: no action bar, no own scroll container. */
  embedded?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(toMarkdown(result));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const usd = formatUsd(result.usage?.estUsd);
  return (
    <div className={embedded ? 'flex flex-col' : 'flex h-full flex-col'}>
      <div className={`flex grow flex-col gap-3 p-3.5 ${embedded ? '' : 'overflow-y-auto'}`}>
        <InputCard input={result.input} when={timeAgo(result.createdAt)} />
        <VerdictBanner verdict={result.verdict} />
        {result.degraded && (
          <div className="rounded-[10px] border border-warn-line bg-warn-soft px-3 py-2 text-[12px] leading-[17px] text-warn-ink">
            The model answered in prose only, so the claims and verdict below are a best effort. Re-check to try again.
          </div>
        )}
        <Narrative text={result.narrative} />

        {result.input.kind === 'image' && result.provenance && <ProvenancePanel provenance={result.provenance} srcUrl={result.input.srcUrl} />}

        {result.originalSource && (
          <div className="flex flex-col gap-1.5">
            <Label>{result.input.kind === 'image' ? 'Earliest match found' : 'Likely original source'}</Label>
            <div className="flex gap-2.5 rounded-xl border border-accent-line bg-accent-wash p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-fill text-[13px] font-bold text-white">
                {initials(result.originalSource.publisher || result.originalSource.title)}
              </span>
              <div className="flex min-w-0 grow flex-col gap-1">
                <span className="text-[14px] leading-[19px] font-semibold">{result.originalSource.title}</span>
                {(result.originalSource.publisher || result.originalSource.date) && (
                  <span className="text-[12px] text-ink-2">
                    {[result.originalSource.publisher, result.originalSource.date].filter(Boolean).join(' · ')}
                  </span>
                )}
                {result.originalSource.how && <span className="text-[12px] leading-[17px] text-ink-2">{result.originalSource.how}</span>}
                <div className="mt-1 flex items-center gap-3.5">
                  {result.originalSource.url && (
                    <a
                      href={result.originalSource.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[12px] font-semibold no-underline"
                    >
                      Open source <External size={12} />
                    </a>
                  )}
                  {result.originalSource.sourceId && (
                    <span className="text-[12px] text-ink-2">
                      Source <Cite id={result.originalSource.sourceId} />
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <ClaimList claims={result.claims} />
        <SourceList sources={result.sources} />
        {result.notes && <p className="m-0 text-[12px] leading-[17px] text-ink-2">{result.notes}</p>}
        {result.searchSuggestionsHtml && <SearchSuggestions html={result.searchSuggestionsHtml} />}

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-2">
          <ProviderBadge label={result.provider.model || result.provider.label} />
          <span>
            {[
              result.searchQueries.length ? `${result.searchQueries.length} search${result.searchQueries.length === 1 ? '' : 'es'}` : null,
              result.usage?.inputTokens || result.usage?.outputTokens
                ? `${fmtK((result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0))} tokens`
                : null,
              usd,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <span className="grow" />
          {saved && (
            <span className="inline-flex items-center gap-1 font-semibold text-ok">
              <Check size={12} /> {snapshotNote ?? 'Saved to history'}
            </span>
          )}
        </div>
      </div>
      {!embedded && (
        <div className="flex shrink-0 gap-2 border-t border-line bg-paper px-3.5 py-2.5">
          <button className="wys-btn grow" onClick={copy}>
            {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy'}
          </button>
          <button className="wys-btn grow" onClick={onRecheck}>
            <Refresh size={15} /> Re-check
          </button>
          <a href={googleAiModeUrl(result.input)} target="_blank" rel="noopener noreferrer" className="wys-btn wys-btn-primary grow-[1.4] no-underline">
            Open in Google AI <External size={14} />
          </a>
        </div>
      )}
    </div>
  );
}

function initials(s: string): string {
  const words = s.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean);
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
