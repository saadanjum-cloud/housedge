// Reads a company's website the way a careful researcher would, without running its JavaScript:
// - finds pages from the home page links, the sitemap (via robots.txt) and llms.txt
// - picks the pages that hold the facts (about, pricing, FAQ, product, trust, legal/imprint, contact), one per topic first
// - keeps what pages built with JavaScript still carry in their HTML: page titles and descriptions, structured data
//   (schema.org JSON-LD: legal name, founding date, address, official profiles…), the page data that frameworks such as
//   Next.js embed as JSON, and text meant for browsers without JavaScript
// Every request goes through safeGet (public addresses only, size and time limits).
import { safeGet } from './safefetch.js';

const TOPICS = [
  ['about', /\/(about|about-us|company|who-we-are|our-story|story|mission|team|meet-the-team)(\/|$)/i],
  ['pricing', /\/(pricing|prices|plans|fees|tariffs|rates|cost)(\/|$)/i],
  ['faq', /\/(faq|faqs|help|support|questions|help-center|helpcenter)(\/|$)/i],
  ['product', /\/(product|products|features|how-it-works|solutions|platform|services|what-we-do)(\/|$)/i],
  ['trust', /\/(security|trust|compliance|licen[cs]e|licensing|regulation|regulatory|safety|certifications)(\/|$)/i],
  ['legal', /\/(imprint|impressum|legal|legal-notice|terms|terms-of-service|terms-and-conditions|privacy|privacy-policy)(\/|$)/i],
  ['contact', /\/(contact|contact-us)(\/|$)/i],
];
const SKIP = /\.(png|jpe?g|gif|webp|svg|pdf|zip|mp4|mp3|css|js|json|xml|ico|woff2?)$|\/(blog|news|press-releases|careers|jobs|article|articles|posts?|tag|category|author|cart|checkout|login|signin|signup|register|account|search)(\/|$)/i;
const LOCALE = /^\/([a-z]{2})(-[a-z]{2})?(\/|$)/i;
const MAX_PAGES = 8;
// At most this many pages per topic; for legal, the imprint / legal notice (legal name, address, business ID) beats terms and privacy.
const PER_TOPIC = { about: 2, pricing: 1, faq: 1, product: 3, trust: 1, legal: 1, contact: 1 };
const LEGAL_BEST = /\/(imprint|impressum|legal-notice|legal)(\/|$)/i;
const BUDGET = { home: 14_000, page: 7_000, total: 60_000 };

export const decode = s => String(s).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
const squash = s => s.replace(/\s+/g, ' ').trim();
export const hrefs = html => [...String(html || '').matchAll(/href\s*=\s*["']([^"'#][^"']*)["']/gi)].map(m => decode(m[1]));
const attr = (tag, name) => decode(tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] || '');

// Prose-looking strings inside embedded JSON (several words, mostly letters; not code, class names or addresses).
function proseStrings(value, out, depth = 0) {
  if (depth > 40 || out.length > 400) return;
  if (typeof value === 'string') {
    const s = squash(value);
    if (s.length >= 24 && s.length <= 2000 && /\s/.test(s) && !/^(https?:|\/|\{|<)/.test(s) && (s.match(/[a-zA-ZÀ-ɏ]/g) || []).length / s.length > 0.6) out.push(s);
    return;
  }
  if (Array.isArray(value)) { for (const v of value) proseStrings(v, out, depth + 1); return; }
  if (value && typeof value === 'object') for (const v of Object.values(value)) proseStrings(v, out, depth + 1);
}

// schema.org facts, flattened to "Type.field: value" lines.
const LD_KEYS = /^(name|legalName|alternateName|description|slogan|foundingDate|foundingLocation|founder|founders|address|streetAddress|addressLocality|addressRegion|postalCode|addressCountry|areaServed|sameAs|email|telephone|vatID|taxID|leiCode|numberOfEmployees|offers|price|priceCurrency|lowPrice|highPrice|aggregateRating|ratingValue|reviewCount|brand|category|applicationCategory|operatingSystem|award|knowsAbout|parentOrganization|url|mainEntity|acceptedAnswer|text)$/;
function ldLines(node, prefix, out, depth = 0) {
  if (depth > 6 || out.length > 120 || node == null) return;
  if (Array.isArray(node)) { for (const n of node) ldLines(n, prefix, out, depth + 1); return; }
  if (typeof node !== 'object') { const s = squash(String(node)); if (s && s.length < 600) out.push(`${prefix}: ${s}`); return; }
  const type = [].concat(node['@type'] || []).join('/');
  for (const [k, v] of Object.entries(node)) {
    if (k === '@graph') { ldLines(v, prefix, out, depth + 1); continue; }
    if (!LD_KEYS.test(k)) continue;
    ldLines(v, `${type || prefix || 'Thing'}.${k}`, out, depth + 1);
  }
}

// Everything readable on one page, as text.
export function readPage(html, url) {
  html = String(html || '');
  const head = [];
  const title = squash(decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''));
  if (title) head.push(`Title: ${title}`);
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(m[0], 'name') || attr(m[0], 'property')).toLowerCase();
    const content = squash(attr(m[0], 'content'));
    if (content && /^(description|og:title|og:description|og:site_name|twitter:description|application-name)$/.test(key)) head.push(`${key}: ${content}`);
  }
  // Structured data and embedded page data, before scripts are removed.
  const facts = [], prose = [], profiles = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const type = attr(`<x ${m[1]}>`, 'type').toLowerCase(), id = attr(`<x ${m[1]}>`, 'id');
    const body = m[2].trim();
    if (!body) continue;
    if (type === 'application/ld+json') {
      try { const j = JSON.parse(body); ldLines(j, '', facts); for (const s of [].concat(...[j].flat().map(x => [].concat(x?.sameAs || [], ...(x?.['@graph'] || []).map(g => g?.sameAs || []))))) if (typeof s === 'string') profiles.push(s); } catch { /* broken JSON-LD */ }
    } else if (type === 'application/json' || id === '__NEXT_DATA__' || id === '__NUXT_DATA__') {
      try { proseStrings(JSON.parse(body), prose); } catch { /* not JSON */ }
    } else if (/self\.__next_f\.push/.test(body)) {
      // Next.js app-router payload: JSON-encoded strings that hold the page text.
      for (const p of body.matchAll(/self\.__next_f\.push\(\[\d+,\s*("(?:[^"\\]|\\.)*")\]\)/g)) {
        try { for (const run of JSON.parse(p[1]).matchAll(/"children":"([^"]{24,})"|"(?:text|title|description|content)":"([^"]{24,})"/g)) proseStrings((run[1] || run[2]).replace(/\\n/g, ' '), prose); } catch { /* skip */ }
      }
    }
  }
  const body = squash(decode(html
    .replace(/<(script|style|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<img\b[^>]*\balt\s*=\s*["']([^"']{4,200})["'][^>]*>/gi, ' $1 ')
    .replace(/<\/(p|div|li|h[1-6]|section|article|tr|dd|dt|br)>/gi, '. ')
    .replace(/<[^>]+>/g, ' ')))
    .replace(/(\.\s*){2,}/g, '. ');
  const seen = new Set(body.slice(0, 200_000).split(/(?<=[.!?])\s+/).map(s => s.trim()));
  const extra = [...new Set(prose)].filter(s => !seen.has(s) && !body.includes(s.slice(0, 60))).slice(0, 150);
  return {
    url, title,
    text: [head.join('\n'), facts.length ? `Structured data:\n${[...new Set(facts)].join('\n')}` : '', body, extra.length ? `Page data:\n${extra.join('\n')}` : ''].filter(Boolean).join('\n'),
    bodyChars: body.length + extra.join(' ').length,
    profiles,
  };
}

const sitemapLocs = xml => [...String(xml || '').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => decode(m[1]));
async function sitemapUrls(origin, robotsTxt) {
  const roots = [...String(robotsTxt || '').matchAll(/^\s*sitemap:\s*(\S+)/gim)].map(m => m[1]);
  if (!roots.length) roots.push(`${origin}/sitemap.xml`);
  const urls = [];
  for (const root of roots.slice(0, 2)) {
    let xml;
    try { const r = await safeGet(root, { timeoutMs: 6000, maxBytes: 3_000_000 }); if (r.status >= 400) continue; xml = r.body; } catch { continue; }
    if (/<sitemapindex/i.test(xml)) {
      // An index of sitemaps: read the few most likely to list company pages.
      const kids = sitemapLocs(xml).sort((a, b) => (/page|main|static|en\b|site/i.test(b) ? 1 : 0) - (/page|main|static|en\b|site/i.test(a) ? 1 : 0)).slice(0, 3);
      const got = await Promise.all(kids.map(k => safeGet(k, { timeoutMs: 6000, maxBytes: 3_000_000 }).then(r => (r.status < 400 ? sitemapLocs(r.body) : []), () => [])));
      urls.push(...got.flat());
    } else urls.push(...sitemapLocs(xml));
    if (urls.length > 5000) break;
  }
  return urls;
}

// Which pages to read: the best page per topic first (shortest, top-level, in the site's main language), then more.
function choosePages(origin, candidates, max) {
  const byPath = new Map();
  for (const raw of candidates) {
    let u; try { u = new URL(raw, origin); } catch { continue; }
    if (u.origin !== origin || SKIP.test(u.pathname)) continue;
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const loc = path.match(LOCALE)?.[0]?.replace(/\/$/, '');
    const bare = (loc ? path.slice(loc.length) : path) || '/'; // the same page in another language counts once
    if (bare === '/') continue;
    const depth = bare.split('/').length - 1;
    const topic = TOPICS.find(([, re]) => re.test(bare + '/'))?.[0];
    if (!topic) continue;
    const score = depth * 10 + (loc && !/^\/en(-|$)/i.test(loc) ? 25 : 0) + bare.length / 10 + (topic === 'legal' && !LEGAL_BEST.test(bare + '/') ? 30 : 0);
    const prev = byPath.get(bare);
    if (!prev || score < prev.score) byPath.set(bare, { url: u.origin + path, topic, score });
  }
  const ranked = [...byPath.values()].sort((a, b) => a.score - b.score);
  const picked = [];
  for (const [topic] of TOPICS) { const p = ranked.find(r => r.topic === topic); if (p) picked.push(p); }
  const count = t => picked.filter(p => p.topic === t).length;
  for (const r of ranked) { if (picked.length >= max) break; if (!picked.includes(r) && count(r.topic) < PER_TOPIC[r.topic]) picked.push(r); }
  return picked.slice(0, max);
}

export async function crawlSite(host) {
  const home = await safeGet(`https://${host}/`);
  if (home.status >= 400) throw Object.assign(new Error(`${host} answered with an error (${home.status}).`), { status: home.status });
  const origin = new URL(home.finalUrl).origin;
  const [robots, llms] = await Promise.all([
    safeGet(`${origin}/robots.txt`, { timeoutMs: 5000, maxBytes: 200_000 }).then(r => (r.status < 400 && !/<html/i.test(r.body) ? r.body : ''), () => ''),
    safeGet(`${origin}/llms.txt`, { timeoutMs: 5000, maxBytes: 300_000 }).then(r => (r.status < 400 && !/<html/i.test(r.body) ? r.body : ''), () => ''),
  ]);
  const fromSitemap = await sitemapUrls(origin, robots).catch(() => []);
  const fromLlms = [...llms.matchAll(/\]\((https?:[^)\s]+)\)/g)].map(m => m[1]);
  const chosen = choosePages(origin, [...hrefs(home.body), ...fromLlms, ...fromSitemap], MAX_PAGES);
  const fetched = await Promise.all(chosen.map(p => safeGet(p.url, { timeoutMs: 8000, maxBytes: 1_500_000 }).then(r => (r.status < 400 ? { ...p, html: r.body } : null), () => null)));

  const pages = [readPage(home.body, home.finalUrl), ...fetched.filter(Boolean).map(p => ({ ...readPage(p.html, p.url), topic: p.topic }))];
  let left = BUDGET.total;
  const corpus = [
    llms ? `<file url="${origin}/llms.txt">\n${squash(llms).slice(0, 6000)}\n</file>` : '',
    ...pages.map((p, i) => { const t = p.text.slice(0, Math.min(i ? BUDGET.page : BUDGET.home, Math.max(0, left))); left -= t.length; return t ? `<page url="${p.url}"${p.topic ? ` topic="${p.topic}"` : ''}>\n${t}\n</page>` : ''; }),
  ].filter(Boolean).join('\n');
  return {
    origin, corpus, pages: pages.map(p => ({ url: p.url, topic: p.topic || 'home', chars: p.bodyChars })),
    readable: pages.reduce((s, p) => s + p.bodyChars, 0) + llms.length,
    // Every link on the pages read, plus official profiles named in structured data (sameAs).
    links: [...new Set([...pages.flatMap(p => p.profiles), ...[home.body, ...fetched.filter(Boolean).map(p => p.html)].flatMap(hrefs)])],
    sitemap: fromSitemap.length, hasLlms: !!llms,
  };
}
