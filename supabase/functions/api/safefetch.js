// Fetches a public web page safely for the website check (Deno port of server/safefetch.js).
// Stops the check from being pointed at internal addresses (SSRF):
// - only http/https on the standard ports, no passwords in the address
// - every address the name resolves to must be public (IP literals checked too)
// - redirects are followed by hand and each hop is checked again
// - small size and time limits
// ponytail: Deno's fetch resolves the name again itself, so a domain that changes its answer between our check and
// the fetch (DNS rebinding) is not caught. The functions run in Supabase's sandbox without access to our database
// network, and the check only returns page facts; pin the address with a custom client if that ever changes.
export const USER_AGENT = 'HousedgeSiteCheck/1.0 (website readiness check requested by the site owner)';
const fail = (message, code) => Object.assign(new Error(message), { code });

const v4ToInt = ip => ip.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([a, bits]) => [v4ToInt(a), bits]);
const isV4 = s => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
const isV6 = s => s.includes(':');

export function isBlockedAddress(ip) {
  if (isV4(ip)) { const n = v4ToInt(ip); return V4_BLOCKED.some(([base, bits]) => (n >>> (32 - bits)) === (base >>> (32 - bits))); }
  if (isV6(ip)) {
    const x = ip.toLowerCase();
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]);
    return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x) || x.startsWith('2001:db8') || x.startsWith('64:ff9b');
  }
  return true;
}

// All A/AAAA answers for a name: the runtime's resolver when it has one, else DNS over HTTPS.
async function resolveAll(host) {
  const out = [];
  for (const type of ['A', 'AAAA']) {
    try {
      if (typeof Deno?.resolveDns === 'function') out.push(...await Deno.resolveDns(host, type));
      else {
        const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000) });
        out.push(...((await r.json()).Answer || []).filter(a => a.type === (type === 'A' ? 1 : 28)).map(a => a.data));
      }
    } catch { /* no records of this type */ }
  }
  return out;
}

async function checkUrl(u) {
  const url = new URL(u);
  if (!['http:', 'https:'].includes(url.protocol)) throw fail('Only web addresses can be checked.', 'EBLOCKED');
  if (url.username || url.password) throw fail('Addresses with passwords are not allowed.', 'EBLOCKED');
  if (url.port && !['80', '443'].includes(url.port)) throw fail('Only standard web ports are allowed.', 'EBLOCKED');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const ips = isV4(host) || isV6(host) ? [host] : await resolveAll(host);
  if (!ips.length) throw fail('The address does not exist.', 'ENOTFOUND');
  if (ips.some(isBlockedAddress)) throw fail('That address is not allowed.', 'EBLOCKED');
  return url;
}

async function getOnce(url, { timeoutMs, maxBytes }) {
  let res;
  try {
    res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain,application/xml;q=0.9,*/*;q=0.5' } });
  } catch (e) {
    throw fail('', e?.name === 'TimeoutError' ? 'ETIMEDOUT' : /certificate/i.test(String(e?.message)) ? 'CERT_HAS_EXPIRED' : 'ECONNREFUSED');
  }
  const headers = Object.fromEntries([...res.headers].map(([k, v]) => [k.toLowerCase(), v]));
  const chunks = [];
  let size = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); break; }
      chunks.push(value);
    }
  }
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  const body = new TextDecoder().decode(all);
  return { status: res.status, headers, body };
}

// Returns { status, headers, body, finalUrl, ms } or throws an error with a `code` the website check explains.
export async function safeGet(input, { timeoutMs = 10_000, maxBytes = 2_000_000, maxRedirects = 3 } = {}) {
  let url = await checkUrl(input);
  const t0 = Date.now();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const r = await getOnce(url, { timeoutMs, maxBytes });
    if (r.status >= 300 && r.status < 400 && r.headers.location) { url = await checkUrl(new URL(r.headers.location, url).href); continue; }
    return { ...r, finalUrl: url.href, ms: Date.now() - t0 };
  }
  throw fail('Too many redirects.', 'EREDIRECT');
}
