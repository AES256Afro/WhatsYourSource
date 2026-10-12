import type { CheckInput } from '@/lib/messaging/protocol';
import { domainOf } from '@/lib/util/url';
import { Label } from './common';
import { Globe, Image, Lines } from './Icons';

export function InputCard({ input, when, clamp }: { input: CheckInput; when?: string; clamp?: boolean }) {
  const site = domainOf(input.kind === 'page' ? input.url : input.pageUrl);
  const label = input.kind === 'text' ? 'Checked text' : input.kind === 'image' ? 'Checked image' : 'Checked page';
  return (
    <div className="flex flex-col gap-1.5">
      <Label right={<span className="text-[12px] text-ink-2">{[site, when].filter(Boolean).join(' · ')}</span>}>{label}</Label>
      <div className="flex gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-2.5">
        {input.kind === 'text' && <Lines size={16} className="mt-0.5 shrink-0 text-ink-3" />}
        {input.kind === 'image' && <Image size={16} className="mt-0.5 shrink-0 text-ink-3" />}
        {input.kind === 'page' && <Globe size={16} className="mt-0.5 shrink-0 text-ink-3" />}
        <p className={`m-0 min-w-0 text-[13px] leading-[19px] wrap-break-word ${clamp ? 'line-clamp-3' : ''}`}>
          {input.kind === 'text' && `“${input.text}”`}
          {input.kind === 'image' && (input.alt ? `${input.alt} — ${input.srcUrl}` : input.srcUrl)}
          {input.kind === 'page' && (input.title ? `${input.title} — ${input.url}` : input.url)}
        </p>
      </div>
    </div>
  );
}
