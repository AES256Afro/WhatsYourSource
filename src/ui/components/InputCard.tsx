import { useState } from 'react';
import type { CheckInput } from '@/lib/messaging/protocol';
import { INLINE_IMAGE_SENTINEL } from '@/lib/messaging/limits';
import { domainOf, isHttpUrl } from '@/lib/util/url';
import { Globe, Image, Lines, Link as LinkIcon } from './Icons';

function ImageFrame({ href, children }: { href?: string; children: React.ReactNode }) {
  const cls = 'block overflow-hidden rounded-lg border border-line bg-surface-2';
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {children}
    </a>
  ) : (
    <div className={cls}>{children}</div>
  );
}

function displayUrl(u: string): string {
  if (u === INLINE_IMAGE_SENTINEL) return 'inline image (large)';
  if (u.startsWith('data:')) return `inline image (${Math.round((u.length * 3) / 4 / 1024)} KB)`;
  if (u.startsWith('blob:')) return 'in-page image';
  return u.length > 120 ? `${u.slice(0, 117)}…` : u;
}

function formatWhen(s: string): string {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * What was checked. Deliberately quiet (no fill, small type) so the verdict below it is the first
 * thing the eye lands on; long text is clamped with a "Show all" toggle.
 */
export function InputCard({ input, when, clamp, deferImages }: { input: CheckInput; when?: string; clamp?: boolean; deferImages?: boolean }) {
  const [showImage, setShowImage] = useState(!deferImages);
  const [expanded, setExpanded] = useState(false);
  const site = input.kind === 'post' ? input.site : domainOf(input.kind === 'page' ? input.url : input.pageUrl);
  const label = input.kind === 'text' ? 'Checked text' : input.kind === 'image' ? 'Checked image' : input.kind === 'post' ? 'Checked post' : 'Checked page';
  const meta = [label, site, when].filter(Boolean).join(' · ');
  const long = input.kind === 'text' ? input.text.length > 280 : input.kind === 'post' ? input.text.length > 360 : false;
  const clamped = !expanded && (clamp || long);
  const Icon = input.kind === 'text' ? Lines : input.kind === 'image' ? Image : input.kind === 'post' ? LinkIcon : Globe;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-ink-2 uppercase">
        <Icon size={12} className="shrink-0 text-ink-3" />
        <span className="truncate">{meta}</span>
      </div>
      {input.kind === 'post' ? (
        <div className="flex flex-col gap-1 rounded-lg border border-line px-3 py-2">
          {(input.author || input.postedAt) && (
            <div className="flex items-center gap-1.5 text-[12px] text-ink-2">
              {input.author && <span className="font-semibold text-ink">{input.author}</span>}
              {input.author && input.postedAt && <span>·</span>}
              {input.postedAt && <span>{formatWhen(input.postedAt)}</span>}
            </div>
          )}
          <p className={`m-0 min-w-0 text-[13px] leading-[18px] whitespace-pre-line wrap-break-word ${clamped ? 'line-clamp-4' : ''}`}>{input.text}</p>
          {(input.images.length > 0 || input.links.length > 0 || input.permalink) && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-2">
              {input.images.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5">
                  <Image size={11} /> {input.images.length} image{input.images.length === 1 ? '' : 's'}
                </span>
              )}
              {input.links.slice(0, 2).map((l) => (
                <a
                  key={l}
                  href={l}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-[180px] items-center gap-1 truncate rounded-full border border-line bg-paper px-2 py-0.5 no-underline"
                >
                  <LinkIcon size={11} /> {domainOf(l)}
                </a>
              ))}
              {input.permalink && (
                <a href={input.permalink} target="_blank" rel="noopener noreferrer" className="ml-auto font-medium no-underline">
                  Open post
                </a>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className={`m-0 min-w-0 text-[13px] leading-[18px] text-ink-2 wrap-break-word ${clamped ? 'line-clamp-3' : ''}`}>
          {input.kind === 'text' && <span className="text-ink">{/^["“]/.test(input.text) ? input.text : `“${input.text}”`}</span>}
          {input.kind === 'image' && (input.alt ? `${input.alt} — ${displayUrl(input.srcUrl)}` : displayUrl(input.srcUrl))}
          {input.kind === 'page' && (input.title ? `${input.title} — ${input.url}` : input.url)}
        </p>
      )}
      {long && (
        <button
          type="button"
          className="self-start border-0 bg-transparent p-0 text-[12px] font-medium text-accent"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'Show all'}
        </button>
      )}
      {input.kind === 'image' &&
        /^(https?:|data:image\/|blob:)/i.test(input.srcUrl) &&
        (showImage || !isHttpUrl(input.srcUrl) ? (
          <ImageFrame href={isHttpUrl(input.srcUrl) ? input.srcUrl : undefined}>
            <img src={input.srcUrl} alt={input.alt ?? 'The checked image'} className="block max-h-[120px] w-full object-contain" loading="lazy" />
          </ImageFrame>
        ) : (
          // Opening an old check must not quietly contact the image's host; the user opts in, as for snapshot images.
          <button className="wys-btn h-9 self-start text-[12px]" onClick={() => setShowImage(true)}>
            Show image (loads it from {domainOf(input.srcUrl)})
          </button>
        ))}
    </div>
  );
}
