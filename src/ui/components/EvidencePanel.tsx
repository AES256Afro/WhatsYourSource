import type { CheckResult } from '@/lib/pipeline/schema';
import { Label } from './common';
import { Alert, Check, External, Shield } from './Icons';

/** Published fact-checks found for this claim: deterministic, from the ClaimReview index, shown above the model's verdict. */
export function FactCheckBanner({ checks }: { checks: NonNullable<CheckResult['factChecks']> }) {
  if (checks.length === 0) return null;
  const first = checks[0]!;
  const more = checks.slice(1, 4);
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-accent-line bg-accent-wash p-3" role="note" aria-label="Published fact-checks">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-accent uppercase">
        <Shield size={12} /> Already fact-checked
      </div>
      <a href={first.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 no-underline">
        <span className="flex min-w-0 grow flex-col gap-0.5">
          <span className="text-[13px] leading-[18px] font-semibold text-ink">
            {first.publisher}: <span className="text-accent">{first.rating}</span>
            {first.reviewDate ? <span className="font-normal text-ink-2"> · {first.reviewDate.slice(0, 10)}</span> : null}
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
              {c.reviewDate ? <span className="text-ink-2"> · {c.reviewDate.slice(0, 10)}</span> : null}
            </li>
          ))}
        </ul>
      )}
      <span className="text-[11px] leading-[15px] text-ink-2">
        From Google’s Fact Check Tools index of published fact-checks. Matches are by wording; read the check before relying on it.
      </span>
    </div>
  );
}

/** The case on each side, what is left out, and what would change the verdict. */
export function EvidencePanel({ result }: { result: CheckResult }) {
  const e = result.evidence;
  if (!e && !result.missingContext && !result.wouldChange) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Evidence</Label>
      <div className="wys-card flex flex-col gap-3 px-3 py-2.5">
        {e && e.for.length > 0 && <Side icon={<Check size={13} className="text-ok" />} title="For" items={e.for} />}
        {e && e.against.length > 0 && <Side icon={<Alert size={13} className="text-bad" />} title="Against" items={e.against} />}
        {result.missingContext && (
          <p className="wys-measure m-0 text-[12px] leading-4 text-ink-2">
            <span className="font-semibold text-ink">What it leaves out: </span>
            {result.missingContext}
          </p>
        )}
        {result.wouldChange && (
          <p className="wys-measure m-0 text-[12px] leading-4 text-ink-2">
            <span className="font-semibold text-ink">What would change this: </span>
            {result.wouldChange}
          </p>
        )}
      </div>
    </div>
  );
}

function Side({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-[12px] font-semibold">
        {icon} {title}
      </span>
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

/** "Checked with · what was sent": the transparency block at the bottom of a result. */
export function WhatWasSent({ result }: { result: CheckResult }) {
  const i = result.input;
  const sent =
    i.kind === 'text' ? i.text : i.kind === 'post' ? i.text : i.kind === 'page' ? i.url : `image (${i.srcUrl.startsWith('http') ? i.srcUrl : 'inline'})`;
  return (
    <details className="wys-card px-3 py-1.5 text-[12px]">
      <summary className="cursor-pointer py-1 text-ink-2">What was sent, and to whom</summary>
      <dl className="m-0 mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ink-2">
        <dt className="font-semibold text-ink">To</dt>
        <dd className="m-0">
          {result.provider.label} ({result.provider.model})
        </dd>
        <dt className="font-semibold text-ink">Content</dt>
        <dd className="m-0 line-clamp-4 break-words">{sent}</dd>
        {'pageUrl' in i && i.pageUrl ? (
          <>
            <dt className="font-semibold text-ink">Page</dt>
            <dd className="m-0 truncate">{i.pageUrl}</dd>
          </>
        ) : null}
        {result.searchQueries.length > 0 && (
          <>
            <dt className="font-semibold text-ink">Searches</dt>
            <dd className="m-0">{result.searchQueries.join(' · ')}</dd>
          </>
        )}
      </dl>
    </details>
  );
}
