import type { LocalProvenance } from '@/lib/pipeline/schema';
import { Label } from './common';
import { External, Shield } from './Icons';

/** Facts read from the image file itself, on the user's device — kept visually separate from the AI's opinion. */
export function ProvenancePanel({ provenance: p, srcUrl }: { provenance: LocalProvenance; srcUrl: string }) {
  const rows: Array<[string, string]> = [];
  rows.push(['Content Credentials (C2PA)', p.c2pa ? (p.c2pa.present ? p.c2pa.summary || 'Present' : 'None found') : 'Not checked']);
  const exifKeys = p.exif ? Object.keys(p.exif) : [];
  rows.push(['EXIF / XMP metadata', exifKeys.length ? exifKeys.map((k) => `${k}: ${p.exif![k]}`).join(' · ') : 'None (usually stripped by platforms)']);
  rows.push(['AI-generation hints', p.aiHints?.length ? p.aiHints.join(' · ') : 'None in metadata']);
  if (p.phash) rows.push(['Fingerprint (pHash)', p.phash]);
  if (p.width && p.height) rows.push(['Dimensions', `${p.width} × ${p.height}${p.mime ? ` · ${p.mime.replace('image/', '').toUpperCase()}` : ''}${p.bytes ? ` · ${Math.round(p.bytes / 1024)} KB` : ''}`]);

  const enc = encodeURIComponent(srcUrl);
  const reverse = [
    ['Lens', `https://lens.google.com/uploadbyurl?url=${enc}`],
    ['TinEye', `https://tineye.com/search?url=${enc}`],
    ['Bing', `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${enc}`],
    ['Yandex', `https://yandex.com/images/search?rpt=imageview&url=${enc}`],
  ] as const;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label
          right={
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ok">
              <Shield size={12} /> checked on your device
            </span>
          }
        >
          Provenance
        </Label>
        <div className="wys-card flex flex-col px-3 py-0.5">
          {rows.map(([k, v], i) => (
            <div key={k} className={`flex min-h-[34px] items-center gap-2 py-1.5 text-[13px] ${i < rows.length - 1 ? 'border-b border-surface-2' : ''}`}>
              <span className="grow">{k}</span>
              <span className="max-w-[55%] text-right text-[12px] text-ink-2">{v}</span>
            </div>
          ))}
        </div>
        <span className="text-[11px] leading-[15px] text-ink-2">Missing credentials don’t mean the image is fake — most platforms strip metadata on upload.</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Reverse image search</Label>
        <div className="grid grid-cols-4 gap-1.5">
          {reverse.map(([name, url]) => (
            <a key={name} href={url} target="_blank" rel="noopener noreferrer" className="wys-btn h-9 px-2 text-[12px] no-underline">
              {name} <External size={11} className="text-ink-3" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
