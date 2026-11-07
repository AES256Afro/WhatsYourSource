import type { CheckResult } from '@/lib/pipeline/schema';
import { domainOf, isHttpUrl } from '@/lib/util/url';
import { Label } from './common';
import { External, Shield } from './Icons';

/** ISO or RFC dates from the lookups, shown the way the rest of the panel shows dates. */
export function localeDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Published fact-checks found for this claim: deterministic, from the ClaimReview index, shown above
 * the model's verdict. Lives in a polite live region because it can arrive after focus has moved on.
 */
export function FactCheckBanner({ checks }: { checks: NonNullable<CheckResult['factChecks']> }) {
  if (checks.length === 0) return null;
  const first = checks[0]!;
  const more = checks.slice(1, 4);
  return (
    <section aria-live="polite" aria-labelledby="wys-factcheck-h" className="flex flex-col gap-1.5 rounded-xl border border-accent-line bg-accent-wash p-3">
      <h2 id="wys-factcheck-h" className="m-0 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-accent uppercase">
        <Shield size={12} /> Already fact-checked
      </h2>
      <a href={first.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 no-underline">
        <span className="flex min-w-0 grow flex-col gap-0.5">
          <span className="text-[13px] leading-[18px] font-semibold text-ink">
            {first.publisher}: <span className="text-accent">{first.rating}</span>
            {first.reviewDate ? <span className="font-normal text-ink-2"> · {localeDate(first.reviewDate)}</span> : null}
          </span>
          {first.claim && <span className="line-clamp-2 text-[12px] leading-4 text-ink-2">“{first.claim}”</span>}
        </span>
        <External size={13} className="mt-1 shrink-0 text-ink-3" />
      </a>
      {more.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[12px] leading-4">
          {more.map((c) => (
            <li key={c.url}>
              <a href={c.url} target="_blank" rel="noopener noreferrer" className="no-underline">
                {c.publisher}: {c.rating}
              </a>
              {c.reviewDate ? <span className="text-ink-2"> · {localeDate(c.reviewDate)}</span> : null}
            </li>
          ))}
        </ul>
      )}
      <span className="text-[11px] leading-[15px] text-ink-2">
        From Google’s Fact Check Tools index of published fact-checks. Matches are by wording; read the check before relying on it.
      </span>
    </section>
  );
}

/**
 * The case on each side, what is left out, and what would change the verdict. Headings say what the
 * list argues for (the claim being true / false), and carry no colour: under a "Misattributed"
 * verdict a green tick on "supports the claim" would read as the opposite of the verdict.
 */
export function EvidencePanel({ result }: { result: CheckResult }) {
  const e = result.evidence;
  if (!e && !result.missingContext && !result.wouldChange) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Evidence</Label>
      <div className="wys-card flex flex-col gap-3 px-3 py-2.5">
        {e && e.for.length > 0 && <Side title="Why it could be true" items={e.for} />}
        {e && e.against.length > 0 && <Side title="Why it may not be" items={e.against} />}
        {result.missingContext && <Note title="What it leaves out">{result.missingContext}</Note>}
        {result.wouldChange && <Note title="What would change this">{result.wouldChange}</Note>}
      </div>
    </div>
  );
}

function Side({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="m-0 text-[12px] font-semibold">{title}</h3>
      <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[12px] leading-4">
        {items.slice(0, 5).map((t, i) => (
          <li key={i} className="wys-measure">
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="m-0 text-[12px] font-semibold">{title}</h3>
      <p className="wys-measure m-0 text-[12px] leading-4 text-ink-2">{children}</p>
    </div>
  );
}

/** Everything that left the browser for this check, and what stayed. */
export function WhatWasSent({ result, searchTool, snapshotSaved }: { result: CheckResult; searchTool?: string; snapshotSaved?: boolean }) {
  const i = result.input;
  const content =
    i.kind === 'text'
      ? i.text
      : i.kind === 'post'
        ? i.text
        : i.kind === 'page'
          ? i.url
          : `the image itself (${isHttpUrl(i.srcUrl) ? domainOf(i.srcUrl) : 'inline'})`;
  const also: string[] = [];
  if (i.kind === 'text' && i.surrounding) also.push(`${i.surrounding.length.toLocaleString()} characters of surrounding text`);
  if ('pageTitle' in i && i.pageTitle) also.push('the page title');
  if (i.kind === 'image' && i.nearbyText) also.push('text near the image');
  if (i.kind === 'post' && (i.links.length || i.images.length))
    also.push(
      `${i.links.length} link${i.links.length === 1 ? '' : 's'} and ${i.images.length} image address${i.images.length === 1 ? '' : 'es'} from the post`,
    );
  const lookups: string[] = [];
  if (result.pageCapture) lookups.push('page address → web.archive.org');
  if (result.originalCapture) lookups.push('original source address → web.archive.org');
  if (result.factChecks) lookups.push('claim wording → Google Fact Check Tools');
  const searchedBy = result.searchQueries.length
    ? result.provider.id === 'gemini'
      ? 'Google (Gemini grounding)'
      : result.provider.id === 'anthropic'
        ? 'Anthropic web search'
        : (searchTool ?? 'the configured search tool')
    : null;
  return (
    <details className="wys-card px-3 py-1.5 text-[12px]">
      <summary className="cursor-pointer py-1 text-ink-2">What was sent, and to whom</summary>
      <dl className="m-0 mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ink-2">
        <dt className="font-semibold text-ink">To</dt>
        <dd className="m-0">
          {result.provider.label} ({result.provider.model})
        </dd>
        <dt className="font-semibold text-ink">Content</dt>
        <dd className="m-0 break-words">
          <details>
            <summary className="line-clamp-2 cursor-pointer">{content}</summary>
            <span className="whitespace-pre-line">{content}</span>
          </details>
        </dd>
        {'pageUrl' in i && i.pageUrl ? (
          <>
            <dt className="font-semibold text-ink">Page</dt>
            <dd className="m-0 truncate">{i.pageUrl}</dd>
          </>
        ) : null}
        {also.length > 0 && (
          <>
            <dt className="font-semibold text-ink">Also sent</dt>
            <dd className="m-0">{also.join(' · ')}</dd>
          </>
        )}
        {searchedBy && (
          <>
            <dt className="font-semibold text-ink">Searches</dt>
            <dd className="m-0">
              {result.searchQueries.join(' · ')} <span className="text-ink-3">· run by {searchedBy}</span>
            </dd>
          </>
        )}
        {lookups.length > 0 && (
          <>
            <dt className="font-semibold text-ink">Lookups</dt>
            <dd className="m-0">{lookups.join(' · ')}</dd>
          </>
        )}
        <dt className="font-semibold text-ink">Kept locally</dt>
        <dd className="m-0">{snapshotSaved ? 'this result and a copy of the page' : 'this result'}</dd>
      </dl>
    </details>
  );
}
