import { describe, expect, it } from 'vitest';
import { bytesToBase64, sniffMime } from '@/lib/image/bytes';
import { hammingDistance, phashFromGray } from '@/lib/image/phash';
import { aiHints, detectC2PA, pngChunks, pngTextChunks, provenanceSummary } from '@/lib/image/provenance';

function pngWith(chunks: Array<[string, Uint8Array]>): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const parts: number[] = [...sig];
  for (const [type, data] of chunks) {
    parts.push((data.length >>> 24) & 255, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255);
    parts.push(...type.split('').map((c) => c.charCodeAt(0)));
    parts.push(...data);
    parts.push(0, 0, 0, 0); // crc (not checked)
  }
  return new Uint8Array(parts);
}
const ascii = (s: string) => new Uint8Array(s.split('').map((c) => c.charCodeAt(0)));

describe('image sniffing', () => {
  it('detects common formats from magic bytes', () => {
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image/jpeg');
    expect(sniffMime(pngWith([]))).toBe('image/png');
    expect(sniffMime(ascii('RIFF....WEBPVP8 '))).toBe('image/webp');
    expect(sniffMime(ascii('hello world!'))).toBeNull();
  });
  it('base64 encodes', () => {
    expect(bytesToBase64(ascii('hi'))).toBe('aGk=');
  });
});

describe('PNG chunks and AI hints', () => {
  it('reads tEXt chunks and spots Stable Diffusion parameters', () => {
    const png = pngWith([
      ['IHDR', new Uint8Array(13)],
      ['tEXt', new Uint8Array([...ascii('parameters'), 0, ...ascii('a cat\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: 1')])],
      ['IEND', new Uint8Array(0)],
    ]);
    const chunks = pngChunks(png).map((c) => c.type);
    expect(chunks).toEqual(['IHDR', 'tEXt', 'IEND']);
    const text = pngTextChunks(png);
    expect(text[0]?.[0]).toBe('parameters');
    const hints = aiHints(Object.fromEntries(text));
    expect(hints).toContain('Stable Diffusion parameters block');
  });
  it('flags generator names and IPTC source types in metadata', () => {
    expect(aiHints({ Software: 'Adobe Firefly 2026' })).toEqual(['Adobe Firefly']);
    expect(aiHints({ 'Digital source type': 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia' })).toHaveLength(1);
    expect(aiHints({ 'Camera make': 'Canon', 'Camera model': 'EOS R6' })).toEqual([]);
  });
});

describe('C2PA detection', () => {
  it('finds a caBX chunk in PNG', () => {
    expect(detectC2PA(pngWith([['caBX', ascii('jumbc2pa')]]), 'image/png')).toBe(true);
    expect(detectC2PA(pngWith([['IEND', new Uint8Array(0)]]), 'image/png')).toBe(false);
  });
  it('finds APP11 JUMBF in JPEG and ignores other segments', () => {
    const app11 = ascii('JP\u0000\u0001....jumbc2pa');
    const seg = [0xff, 0xeb, (app11.length + 2) >> 8, (app11.length + 2) & 255, ...app11];
    const jpeg = new Uint8Array([0xff, 0xd8, ...seg, 0xff, 0xda, 0, 2]);
    expect(detectC2PA(jpeg, 'image/jpeg')).toBe(true);
    const plain = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xda, 0, 2]);
    expect(detectC2PA(plain, 'image/jpeg')).toBe(false);
  });
  it('finds a C2PA chunk in WebP', () => {
    const webp = new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii('C2PA'), 2, 0, 0, 0, 1, 2]);
    expect(detectC2PA(webp, 'image/webp')).toBe(true);
  });
});

describe('phash', () => {
  it('is stable and distinguishes different images', () => {
    const N = 32;
    // A textured image (not a flat gradient, which has degenerate all-zero coefficients).
    const textured = new Float64Array(N * N).map((_, i) => {
      const x = i % N;
      const y = Math.floor(i / N);
      return 128 + 90 * Math.sin(x / 2.7) * Math.cos(y / 4.1) + x * 1.5 - y;
    });
    const checker = new Float64Array(N * N).map((_, i) => ((Math.floor(i / N) + (i % N)) % 2 ? 255 : 0));
    const a = phashFromGray(textured, N);
    // Brightness/contrast changes must not move the hash much.
    const b = phashFromGray(textured.map((v) => v * 0.8 + 20), N);
    const c = phashFromGray(checker, N);
    expect(a).toHaveLength(16);
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(4);
    expect(hammingDistance(a, c)).toBeGreaterThan(10);
  });
});

describe('provenance summary', () => {
  it('reads like something a model can use', () => {
    const s = provenanceSummary({ width: 10, height: 20, mime: 'image/jpeg', c2pa: { present: false }, aiHints: [] });
    expect(s).toContain('10x20 image/jpeg');
    expect(s).toContain('no C2PA');
    expect(s).toContain('no EXIF');
  });
});
