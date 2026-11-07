import exifr from 'exifr';
import type { LocalProvenance } from '../pipeline/schema';

/**
 * Facts read from the file itself, on the user's device. These are shown separately from the AI's
 * opinion and also handed to the model as trustworthy context.
 */
export async function readProvenance(bytes: Uint8Array, mime: string): Promise<LocalProvenance> {
  const out: LocalProvenance = { mime, bytes: bytes.length };
  out.c2pa = { present: detectC2PA(bytes, mime) };
  if (out.c2pa.present) out.c2pa.summary = 'Content Credentials data found (not yet verified)';

  const fields: Record<string, string> = {};
  try {
    const parsed = (await exifr.parse(bytes, { tiff: true, exif: true, gps: true, xmp: true, iptc: true, icc: false, interop: false, ihdr: true })) as
      Record<string, unknown> | undefined;
    if (parsed) {
      pick(fields, parsed, 'Make', 'Camera make');
      pick(fields, parsed, 'Model', 'Camera model');
      pick(fields, parsed, 'Software', 'Software');
      pick(fields, parsed, 'CreatorTool', 'Creator tool');
      pick(fields, parsed, 'DateTimeOriginal', 'Taken');
      pick(fields, parsed, 'CreateDate', 'Created');
      pick(fields, parsed, 'ModifyDate', 'Modified');
      pick(fields, parsed, 'Artist', 'Artist');
      pick(fields, parsed, 'Creator', 'Creator');
      pick(fields, parsed, 'Copyright', 'Copyright');
      pick(fields, parsed, 'Credit', 'Credit');
      pick(fields, parsed, 'Source', 'Source');
      pick(fields, parsed, 'ImageDescription', 'Description');
      pick(fields, parsed, 'DigitalSourceType', 'Digital source type');
      pick(fields, parsed, 'digitalSourceType', 'Digital source type');
      if (parsed.latitude != null && parsed.longitude != null) fields.GPS = `${Number(parsed.latitude).toFixed(4)}, ${Number(parsed.longitude).toFixed(4)}`;
      if (typeof parsed.ImageWidth === 'number' && typeof parsed.ImageHeight === 'number') {
        out.width = parsed.ImageWidth;
        out.height = parsed.ImageHeight;
      }
    }
  } catch {
    /* no metadata, or a format exifr doesn't read */
  }
  if (mime === 'image/png') {
    for (const [k, v] of pngTextChunks(bytes)) {
      if (/^(parameters|prompt|comment|software|description|title|author|copyright|source)$/i.test(k)) fields[k] = v.slice(0, 300);
    }
  }
  if (Object.keys(fields).length) out.exif = fields;
  out.aiHints = aiHints(fields);
  return out;
}

/** Facts the extension measured itself. Safe to present to the model as reliable. */
export function provenanceFacts(p: LocalProvenance): string {
  const bits: string[] = [];
  if (p.width && p.height) bits.push(`${p.width}x${p.height} ${p.mime ?? ''}`.trim());
  if (p.bytes) bits.push(`${Math.round(p.bytes / 1024)} KB`);
  bits.push(p.c2pa?.present ? 'a C2PA Content Credentials manifest is present (not verified)' : 'no C2PA Content Credentials');
  bits.push(
    p.exif && Object.keys(p.exif).length ? `${Object.keys(p.exif).length} metadata fields present` : 'no EXIF/XMP metadata (typical after social-media upload)',
  );
  if (p.aiHints?.length) bits.push('metadata names an AI generator: ' + p.aiHints.join('; '));
  return bits.join('. ');
}

/** The free text inside the file. Whoever made or edited the file wrote it, so it is a claim, not a fact. */
export function provenanceMetadata(p: LocalProvenance): string {
  if (!p.exif) return '';
  return Object.entries(p.exif)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

/** One-line summary for the UI and history. */
export function provenanceSummary(p: LocalProvenance): string {
  const meta = provenanceMetadata(p);
  return provenanceFacts(p) + (meta ? `. Metadata: ${meta.replace(/\n/g, '; ')}` : '');
}

function pick(out: Record<string, string>, src: Record<string, unknown>, key: string, label: string) {
  const v = src[key];
  if (v == null || v === '') return;
  if (out[label]) return;
  if (v instanceof Date) out[label] = v.toISOString().replace('T', ' ').slice(0, 19);
  else if (typeof v === 'object') {
    const s = JSON.stringify(v);
    if (s.length < 120) out[label] = s;
  } else if (typeof v === 'string') out[label] = v.trim().slice(0, 200);
  else if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') out[label] = String(v);
}

const AI_PATTERNS: [RegExp, string][] = [
  [/trainedAlgorithmicMedia/i, 'IPTC digital source type = trained algorithmic media'],
  [/firefly/i, 'Adobe Firefly'],
  [/dall[- ]?e/i, 'DALL·E'],
  [/midjourney/i, 'Midjourney'],
  [/stable ?diffusion|sdxl|comfyui|automatic1111|invokeai|novelai/i, 'Stable Diffusion tooling'],
  [/imagen|gemini|nano banana|synthid/i, 'Google image model'],
  [/flux\.?1|black forest/i, 'FLUX'],
  [/ideogram|leonardo\.ai|runway|pika|kling/i, 'AI image service'],
  [/^(Steps|Sampler|CFG scale|Seed):/im, 'Stable Diffusion parameters block'],
];

export function aiHints(fields: Record<string, string>): string[] {
  const hits = new Set<string>();
  for (const [k, v] of Object.entries(fields)) {
    const hay = `${k}: ${v}`;
    for (const [re, label] of AI_PATTERNS) if (re.test(hay)) hits.add(label);
  }
  return Array.from(hits);
}

/**
 * Presence check for C2PA manifests (JUMBF). JPEG carries them in APP11 segments, PNG in a
 * `caBX` chunk, WebP in a `C2PA` chunk, HEIF/AVIF in a `jumb`/`uuid` box. Verification is a later step.
 */
export function detectC2PA(b: Uint8Array, mime: string): boolean {
  if (mime === 'image/png') return pngChunks(b).some((c) => c.type === 'caBX');
  if (mime === 'image/webp') return riffChunks(b).some((c) => c === 'C2PA');
  if (mime === 'image/jpeg') {
    let i = 2;
    while (i + 4 < b.length && b[i] === 0xff) {
      const marker = b[i + 1]!;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      if (marker === 0xda || marker === 0xd9) break; // start of scan / end
      const len = (b[i + 2]! << 8) | b[i + 3]!;
      if (marker === 0xeb) {
        // APP11: "JP" + box; look for the jumb box type / c2pa label in the segment.
        const seg = b.subarray(i + 4, Math.min(b.length, i + 2 + len));
        if (indexOfAscii(seg, 'jumb') !== -1 || indexOfAscii(seg, 'c2pa') !== -1) return true;
      }
      i += 2 + len;
    }
    return false;
  }
  // ISO BMFF (HEIC/AVIF) and anything else: a cheap scan for the manifest box label.
  return indexOfAscii(b, 'c2pa.manifest') !== -1 || (indexOfAscii(b, 'jumb') !== -1 && indexOfAscii(b, 'c2pa') !== -1);
}

export function pngChunks(b: Uint8Array): { type: string; data: Uint8Array }[] {
  const out: { type: string; data: Uint8Array }[] = [];
  if (b.length < 8) return out;
  let i = 8;
  while (i + 8 <= b.length) {
    const len = ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    const data = b.subarray(i + 8, Math.min(b.length, i + 8 + len));
    out.push({ type, data });
    if (type === 'IEND') break;
    i += 12 + len;
  }
  return out;
}

/** tEXt / iTXt chunks (uncompressed) as [keyword, text]. This is where Stable Diffusion writes its "parameters". */
export function pngTextChunks(b: Uint8Array): [string, string][] {
  const out: [string, string][] = [];
  const dec = new TextDecoder('latin1');
  const utf8 = new TextDecoder('utf-8');
  for (const c of pngChunks(b)) {
    if (c.type === 'tEXt') {
      const nul = c.data.indexOf(0);
      if (nul > 0) out.push([dec.decode(c.data.subarray(0, nul)), dec.decode(c.data.subarray(nul + 1))]);
    } else if (c.type === 'iTXt') {
      const nul = c.data.indexOf(0);
      if (nul <= 0) continue;
      const keyword = dec.decode(c.data.subarray(0, nul));
      const compressed = c.data[nul + 1] === 1;
      if (compressed) continue;
      // skip compression method, language tag, translated keyword
      let p = nul + 3;
      p = c.data.indexOf(0, p) + 1;
      p = c.data.indexOf(0, p) + 1;
      if (p > 0 && p < c.data.length) out.push([keyword, utf8.decode(c.data.subarray(p))]);
    }
  }
  return out;
}

function riffChunks(b: Uint8Array): string[] {
  const out: string[] = [];
  if (b.length < 12) return out;
  let i = 12;
  while (i + 8 <= b.length) {
    const type = String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!);
    const len = (b[i + 4]! | (b[i + 5]! << 8) | (b[i + 6]! << 16) | (b[i + 7]! << 24)) >>> 0;
    out.push(type);
    i += 8 + len + (len & 1);
  }
  return out;
}

function indexOfAscii(b: Uint8Array, s: string): number {
  const first = s.charCodeAt(0);
  outer: for (let i = 0; i <= b.length - s.length; i++) {
    if (b[i] !== first) continue;
    for (let j = 1; j < s.length; j++) if (b[i + j] !== s.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}
