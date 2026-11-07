export function domainOf(input: string): string {
  try {
    const u = new URL(input.includes('://') ? input : `https://${input}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return (
      input
        .replace(/^www\./, '')
        .toLowerCase()
        .split('/')[0] ?? ''
    );
  }
}

/** Strip tracking params, fragments and trailing slashes so two spellings of one page compare equal. */
export function normalizeUrl(input: string): string {
  try {
    const u = new URL(input);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$|ref_|igshid|mc_)/i.test(k)) u.searchParams.delete(k);
    }
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s.replace(/^https?:\/\/www\./, 'https://').toLowerCase();
  } catch {
    return input.trim().toLowerCase();
  }
}

export function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

/**
 * True for http(s) URLs whose host is a public name or address: nothing a model should be able to
 * point the extension at inside the user's machine or network.
 */
export function isPublicHttpUrl(input: string): boolean {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return false;
  if (!host.includes('.') && !host.startsWith('[')) return false; // bare intranet names
  if (host.startsWith('[') || host.includes(':')) return !isPrivateIpv6(host.replace(/^\[|\]$/g, ''));
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a >= 224) return false; // multicast, reserved, broadcast
    return true;
  }
  if (/^\d+$/.test(host) || /^0x/i.test(host)) return false; // odd numeric spellings of an address
  return true;
}

function isPrivateIpv6(h: string): boolean {
  const x = h.toLowerCase();
  if (x === '::1' || x === '::') return true;
  if (x.startsWith('fc') || x.startsWith('fd')) return true; // unique local
  if (x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb')) return true; // link-local
  if (x.startsWith('::ffff:')) return !isPublicHttpUrl(`http://${x.slice(7)}/`); // mapped IPv4
  return false;
}
