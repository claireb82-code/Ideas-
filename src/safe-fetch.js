// A fetch wrapper for crawling third-party venue websites.
// - only http(s)
// - refuses private / loopback / link-local addresses (SSRF protection)
// - follows redirects manually so every hop is re-validated
// - hard timeout and body size cap
// - only reads HTML / text responses
import dns from 'node:dns/promises';
import net from 'node:net';

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    const mapped = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return l === '::1' || l === '::' || /^f[cd]/.test(l) || /^fe[89ab]/.test(l);
  }
  return true; // not an IP at all - treat as unsafe
}

async function assertPublicHost(hostname, lookup) {
  const bare = hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(bare) ? [{ address: bare }] : await lookup(bare, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('blocked non-public address');
}

export const DEFAULT_UA = 'GuinnessFinderBot/0.1 (menu check; low volume)';

/**
 * @param {string} url
 * @param {object} [o] { timeoutMs, maxBytes, maxRedirects, fetchImpl, lookup, allowPrivate }
 * @returns {Promise<{url:string, text:string}>}
 */
export async function safeFetch(url, o = {}) {
  const { timeoutMs = 8000, maxBytes = 1_500_000, maxRedirects = 3, fetchImpl = fetch, lookup = dns.lookup, allowPrivate = false } = o;
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const u = new URL(current);
    if (!/^https?:$/.test(u.protocol)) throw new Error('unsupported protocol');
    if (!allowPrivate) await assertPublicHost(u.hostname, lookup);

    const res = await fetchImpl(u, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': DEFAULT_UA, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9' },
    });

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), u).toString();
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (!/text\/|html|xml/i.test(type)) throw new Error(`unsupported content-type ${type || 'unknown'}`);

    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      chunks.push(value);
      if (size >= maxBytes) {
        await reader.cancel();
        break;
      }
    }
    return { url: current, text: Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8') };
  }
  throw new Error('too many redirects');
}
