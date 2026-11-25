/**
 * 64-bit perceptual hash (DCT of a 32×32 grayscale thumbnail, top-left 8×8, median threshold).
 * Used to recognise an image the user has checked before, regardless of re-encoding or resizing.
 *
 * Returns undefined for a degenerate image (see `isDegenerateHash`): a flat or fully transparent
 * image has no structure to recognise, and its hash would equal every other such image's.
 */
export function phashFromBitmap(bitmap: ImageBitmap): string | undefined {
  const N = 32;
  const canvas = new OffscreenCanvas(N, N);
  const ctx = canvas.getContext('2d')!;
  // Transparent pixels read as black (0,0,0,0); on white, black-on-transparent art keeps its shape.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, N, N);
  ctx.drawImage(bitmap, 0, 0, N, N);
  const { data } = ctx.getImageData(0, 0, N, N);
  const gray = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) gray[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
  const hash = phashFromGray(gray, N);
  return isDegenerateHash(hash) ? undefined : hash;
}

/**
 * True when the hash carries no picture: every AC bit is the same (a flat image hashes to
 * 0000000000000000, or 8000000000000000 when only the DC bit is set). Old history rows may hold such
 * hashes; they should not count as a match.
 */
export function isDegenerateHash(hash: string | undefined): boolean {
  if (!hash || !/^[0-9a-f]{16}$/i.test(hash)) return true;
  const ac = BigInt('0x' + hash) & ((1n << 63n) - 1n);
  return ac === 0n || ac === (1n << 63n) - 1n;
}

export function phashFromGray(gray: Float64Array, N: number): string {
  const cosTable: number[][] = [];
  for (let u = 0; u < 8; u++) {
    cosTable[u] = [];
    for (let x = 0; x < N; x++) cosTable[u]![x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N));
  }
  const dct = new Float64Array(64);
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let y = 0; y < N; y++) {
        const cy = cosTable[v]![y]!;
        for (let x = 0; x < N; x++) sum += gray[y * N + x]! * cosTable[u]![x]! * cy;
      }
      dct[v * 8 + u] = sum;
    }
  }
  // Exclude the DC term from the median.
  const ac = Array.from(dct.subarray(1)).sort((a, b) => a - b);
  const median = ac[Math.floor(ac.length / 2)]!;
  let bits = '';
  for (let i = 0; i < 64; i++) bits += dct[i]! > median ? '1' : '0';
  return BigInt('0b' + bits)
    .toString(16)
    .padStart(16, '0');
}

export function hammingDistance(a: string, b: string): number {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let d = 0;
  while (x) {
    d += Number(x & 1n);
    x >>= 1n;
  }
  return d;
}
