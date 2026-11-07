import { useState } from 'react';
import type { CheckInput } from '@/lib/messaging/protocol';
import { domainOf, isHttpUrl } from '@/lib/util/url';
import { Label } from './common';
import { Globe, Image, Lines, Link as LinkIcon } from './Icons';

function ImageFrame({ href, children }: { href?: string; children: React.ReactNode }) {
  const cls = 'block overflow-hidden rounded-[10px] border border-line bg-surface-2';
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {children}
    </a>
  ) : (
    <div className={cls}>{children}</div>
  );
}

function displayUrl(u: string): string {
  if (u.startsWith('inline:')) return 'inline image (large)';
  if (u.startsWith('data:')) return `inline image (${Math.round((u.length * 3) / 4 / 1024)} KB)`;
  if (u.startsWith('blob:')) return 'in-page image';
  return u.length > 120 ? `${u.slice(0, 117)}…` : u;
}

function formatWhen(s: string): string {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function InputCard({ input, when, clamp, deferImages }: { input: CheckInput; when?: string; clamp?: boolean; deferImages?: boolean }) {
  const [showImage, setShowImage] = useState(!deferImages);
  const site = input.kind === 'post' ? input.site : domainOf(input.kind === 'page' ? input.url : input.pageUrl);
  const label = input.kind === 'text' ? 'Checked text' : input.kind === 'image' ? 'Checked image' : input.kind === 'post' ? 'Checked post' : 'Checked page';
  if (input.kind === 'post') {
    return (
      <div className="flex flex-col gap-1.5">
        <Label right={<span className="text-[12px] text-ink-2">{[site, when].filter(Boolean).join(' · ')}</span>}>{label}</Label>
        <div className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-surface px-3 py-2.5">
          {(input.author || input.postedAt) && (
            <div className="flex items-center gap-1.5 text-[12px] text-ink-2">
              {input.author && <span className="font-semibold text-ink">{input.author}</span>}
              {input.author && input.postedAt && <span>·</span>}
              {input.postedAt && <span>{formatWhen(input.postedAt)}</span>}
            </div>
          )}
          <p className={`m-0 min-w-0 text-[13px] leading-[18px] whitespace-pre-line wrap-break-word ${clamp ? 'line-clamp-4' : 'line-clamp-[12]'}`}>
            {input.text}
          </p>
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
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Label right={<span className="text-[12px] text-ink-2">{[site, when].filter(Boolean).join(' · ')}</span>}>{label}</Label>
      <div className="flex gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-2.5">
        {input.kind === 'text' && <Lines size={16} className="mt-0.5 shrink-0 text-ink-3" />}
        {input.kind === 'image' && <Image size={16} className="mt-0.5 shrink-0 text-ink-3" />}
        {input.kind === 'page' && <Globe size={16} className="mt-0.5 shrink-0 text-ink-3" />}
        <p className={`m-0 min-w-0 text-[13px] leading-[19px] wrap-break-word ${clamp ? 'line-clamp-3' : ''}`}>
          {input.kind === 'text' && `“${input.text}”`}
          {input.kind === 'image' && (input.alt ? `${input.alt} — ${displayUrl(input.srcUrl)}` : displayUrl(input.srcUrl))}
          {input.kind === 'page' && (input.title ? `${input.title} — ${input.url}` : input.url)}
        </p>
      </div>
      {input.kind === 'image' &&
        /^(https?:|data:image\/|blob:)/i.test(input.srcUrl) &&
        (showImage || !isHttpUrl(input.srcUrl) ? (
          <ImageFrame href={isHttpUrl(input.srcUrl) ? input.srcUrl : undefined}>
            <img src={input.srcUrl} alt={input.alt ?? 'The checked image'} className="block max-h-[180px] w-full object-contain" loading="lazy" />
          </ImageFrame>
        ) : (
          // Opening an old check must not quietly contact the image's host; the user opts in, as for snapshot images.
          <button className="wys-btn h-9 text-[12px]" onClick={() => setShowImage(true)}>
            Show image (loads it from {domainOf(input.srcUrl)})
          </button>
        ))}
    </div>
  );
}
