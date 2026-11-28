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
    // Filter the raw query by key, keeping each kept pair exactly as written: going through
    // searchParams would re-encode the query only when a tracker was removed, so two spellings of
    // one page would compare unequal.
    const kept = u.search
      .slice(1)
      .split('&')
      .filter((pair) => pair && !/^(utm_|fbclid|gclid|ref$|ref_|igshid|mc_)/i.test(decodeKey(pair.split('=')[0] ?? '')));
    u.search = kept.length ? `?${kept.join('&')}` : '';
    u.hostname = u.hostname.replace(/\.+$/, '');
    // Percent-escapes compare case-insensitively (%ed = %ED).
    let s = u.toString().replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase());
    // Trailing slashes of the path only (all of them, so the result normalises to itself), never of the query.
    if (!u.search) s = s.replace(/\/+$/, '');
    // One scheme and no www for comparison; only the host is case-insensitive (video ids and short links are not).
    return s.replace(/^https?:\/\/(www\.)*[^/?#]*/i, (m) => m.toLowerCase().replace(/^https?:\/\/(www\.)*/, 'https://'));
  } catch {
    return input.trim().toLowerCase();
  }
}

/**
 * Query keys that only identify the click, the campaign or the sharer. `ref` is not here: on many
 * sites (GitHub, docs) it selects content. `si` and `feature` are removed only on the hosts that use
 * them as share trackers (see SHARE_TRACKER_HOSTS).
 */
const TRACKING_KEY =
  /^(utm_[a-z_]*|fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|yclid|twclid|ttclid|li_fat_id|igshid|igsh|mc_cid|mc_eid|mkt_tok|_hsenc|_hsmi|__hssc|__hstc|__hsfp|hsctatracking|vero_conv|vero_id|oly_anon_id|oly_enc_id|_ga|_gl|_openstat|ref_src|ref_url|s_cid|cmpid|ocid|spm|scm|wickedid|trk|trkcampaign|sr_share|rcm|ito|xtor|at_medium|at_campaign|ns_campaign|ns_mchannel|ns_source|ns_linkname|ns_fee|cvid|smid|smtyp)$/i;

const SHARE_TRACKER_HOSTS = /(^|\.)(youtube\.com|youtu\.be|spotify\.com|music\.apple\.com|podcasts\.apple\.com)$/i;

/**
 * Wrappers that only bounce the click through a tracking redirect: the real address is a query
 * value. Each entry: host pattern, path pattern, the parameter that holds the target.
 */
const REDIRECT_WRAPPERS: [RegExp, RegExp, string][] = [
  [/(^|\.)google\.[a-z.]+$/i, /^\/url$/, 'q'],
  [/(^|\.)google\.[a-z.]+$/i, /^\/url$/, 'url'],
  [/^l[m]?\.facebook\.com$/i, /^\/l\.php$/, 'u'],
  [/^l\.instagram\.com$/i, /^\/$/, 'u'],
  [/^l\.messenger\.com$/i, /^\/l\.php$/, 'u'],
  [/^out\.reddit\.com$/i, /^\/[^/]+$/, 'url'],
  [/^(www\.)?linkedin\.com$/i, /^\/redir\/redirect\/?$/, 'url'],
  [/^href\.li$/i, /^\/$/, ''],
  [/^(www\.)?youtube\.com$/i, /^\/redirect$/, 'q'],
  [/^slack-redir\.net$/i, /^\/link$/, 'url'],
];

/**
 * The address with tracking removed, for links shown, stored, copied or exported: known redirect
 * wrappers are unwrapped to their target, tracking query keys are dropped, and everything else
 * (other keys exactly as written, the fragment) is kept, so the link opens the same page. Returns
 * the input unchanged when it is not an http(s) URL.
 */
export function stripTracking(input: string): string {
  let url = input;
  for (let hops = 0; hops < 3; hops++) {
    const target = unwrapRedirect(url);
    if (!target) break;
    url = target;
  }
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return input;
    const shareHost = SHARE_TRACKER_HOSTS.test(u.hostname);
    const kept = u.search
      .slice(1)
      .split('&')
      .filter((pair) => {
        if (!pair) return false;
        const key = decodeKey(pair.split('=')[0] ?? '');
        if (TRACKING_KEY.test(key)) return false;
        if (shareHost && /^(si|feature|pp)$/i.test(key)) return false;
        return true;
      });
    u.search = kept.length ? `?${kept.join('&')}` : '';
    return u.toString();
  } catch {
    return input;
  }
}

function unwrapRedirect(url: string): string | null {
  try {
    const u = new URL(url);
    for (const [host, path, param] of REDIRECT_WRAPPERS) {
      if (!host.test(u.hostname) || !path.test(u.pathname)) continue;
      // href.li puts the whole target after the "?".
      const target = param ? u.searchParams.get(param) : decodeURIComponent(u.search.slice(1));
      if (target && /^https?:\/\//i.test(target)) return target;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

function decodeKey(k: string): string {
  try {
    return decodeURIComponent(k.replace(/\+/g, ' '));
  } catch {
    return k;
  }
}

/** host[:port] of a URL, or '' when it is not one. */
export function hostOf(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return '';
  }
}

export function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  // toWellFormed: a cut through an emoji leaves half a surrogate pair, which encodeURIComponent rejects.
  let head = s.slice(0, max - 1);
  const lastUnit = head.charCodeAt(head.length - 1);
  if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) head = head.slice(0, -1); // half an emoji
  return head.toWellFormed().trimEnd() + '…';
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
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    /\.(internal|home\.arpa|lan|home|corp|intranet|localdomain)$/.test(host)
  )
    return false;
  if (!host.includes('.') && !host.startsWith('[')) return false; // bare intranet names
  if (host.startsWith('[') || host.includes(':')) return !isPrivateIpv6(host.replace(/^\[|\]$/g, ''));
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) return isPublicIpv4(Number(v4[1]), Number(v4[2]), Number(v4[3]));
  if (/^\d+$/.test(host) || /^0x/i.test(host)) return false; // odd numeric spellings of an address
  return true;
}

function isPublicIpv4(a: number, b: number, c: number): boolean {
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false; // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

/** Private, loopback, link-local, or an embedding of a private IPv4 (mapped, 6to4, NAT64). */
function isPrivateIpv6(h: string): boolean {
  const x = h.toLowerCase();
  if (x === '::1' || x === '::') return true;
  if (x.startsWith('fc') || x.startsWith('fd')) return true; // unique local
  if (/^fe[89ab]/.test(x)) return true; // link-local
  const g = expandIpv6(x);
  if (!g) return true; // unparseable: refuse
  const embedded = (hi: number, lo: number) => isPublicIpv4(hi >> 8, hi & 0xff, lo >> 8);
  if (g.slice(0, 5).every((v) => v === 0) && g[5] === 0xffff) return !embedded(g[6]!, g[7]!); // ::ffff:a.b.c.d
  if (g[0] === 0x2002) return !embedded(g[1]!, g[2]!); // 6to4
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((v) => v === 0)) return !embedded(g[6]!, g[7]!); // NAT64
  return false;
}

/** Eight 16-bit groups, or null when the text is not an IPv6 address. */
function expandIpv6(s: string): number[] | null {
  let t = s;
  // Trailing dotted IPv4 (e.g. ::ffff:127.0.0.1) → two hex groups.
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(t);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
    t = t.slice(0, dotted.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const halves = t.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const parts = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (parts.length !== 8) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(p)) return null;
    out.push(parseInt(p, 16));
  }
  return out;
}
