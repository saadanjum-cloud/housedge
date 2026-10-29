// Optimise: brand profile and ready-to-paste website code. Port of the non-AI part of server/optimise.js
// (AI drafts move to the pipeline functions). Generators are unchanged.
import { all, get, run, parseJSON } from './db.js';
import { v, safeHttpUrl, InputError } from './validate.js';

export const PROFILE_FIELDS = {
  name: { label: 'Brand name', max: 120 },
  legalName: { label: 'Legal company name', max: 160 },
  tagline: { label: 'One-sentence description', max: 200 },
  description: { label: 'Short description', max: 1200 },
  category: { label: 'What kind of product or company', max: 120 },
  audience: { label: 'Who it is for', max: 400 },
  markets: { label: 'Countries / markets served', max: 400 },
  products: { label: 'Main products or features', max: 1500 },
  pricing: { label: 'Prices and fees', max: 1500 },
  trust: { label: 'Licences, partners, security', max: 1500 },
  notConfusedWith: { label: 'Not to be confused with', max: 300 },
  founded: { label: 'Founded (year)', max: 20 },
  headquarters: { label: 'Headquarters', max: 160 },
  logoUrl: { label: 'Logo address', max: 500, url: true },
  profiles: { label: 'Official profiles', list: true },
};
export const DRAFT_KINDS = { about: 'About page', faq: 'FAQ', comparison: 'Comparison outline', guide: 'How-to guide outline' };

export async function readProfile(projectId) {
  const row = await get('SELECT data FROM brand_profiles WHERE project_id = ?', projectId);
  const own = await get('SELECT name, domain FROM brands WHERE project_id = ? AND is_own', projectId);
  const data = parseJSON(row?.data, {});
  return { ...data, name: data.name || own?.name || '', website: own?.domain ? `https://${own.domain}` : '' };
}

export async function saveProfile(projectId, body) {
  const out = {};
  for (const [k, f] of Object.entries(PROFILE_FIELDS)) {
    if (body[k] === undefined) continue;
    if (f.list) {
      const items = (v.list(body[k], { max: 15, label: f.label }) || []).map(u => v.str(u, { max: 500, label: 'Profile address' })).filter(Boolean);
      for (const u of items) if (!safeHttpUrl(u)) throw new InputError(`"${u.slice(0, 60)}" is not a web address (it must start with https://).`);
      out[k] = items;
    } else {
      const s = v.str(body[k], { max: f.max, label: f.label }) || '';
      if (f.url && s && !safeHttpUrl(s)) throw new InputError(`${f.label} must be a web address starting with https://.`);
      out[k] = s;
    }
  }
  const merged = { ...parseJSON((await get('SELECT data FROM brand_profiles WHERE project_id = ?', projectId))?.data, {}), ...out };
  await run(`INSERT INTO brand_profiles (project_id, data, updated_at) VALUES (?, ?::jsonb, now())
    ON CONFLICT (project_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`, projectId, JSON.stringify(merged));
  return readProfile(projectId);
}

// JSON inside a <script> tag: escape "<" so text like "</script>" can never close the tag early.
const scriptJson = obj => JSON.stringify(obj, null, 2).replace(/</g, '\\u003c');
const clean = o => Object.fromEntries(Object.entries(o).filter(([, val]) => val !== '' && val != null && !(Array.isArray(val) && !val.length)));

export function organizationJsonLd(p) {
  const data = clean({
    '@context': 'https://schema.org', '@type': 'Organization',
    name: p.name, legalName: p.legalName, url: p.website, logo: p.logoUrl,
    slogan: p.tagline, description: p.description || p.tagline,
    disambiguatingDescription: p.notConfusedWith ? `${p.name}${p.category ? ` (${p.category})` : ''} is not affiliated with ${p.notConfusedWith}.` : '',
    foundingDate: /^\d{4}$/.test(p.founded || '') ? p.founded : '',
    location: p.headquarters, areaServed: p.markets, sameAs: p.profiles || [],
  });
  return `<script type="application/ld+json">\n${scriptJson(data)}\n</script>`;
}

export function faqJsonLd(items) {
  if (!items?.length) return '';
  return `<script type="application/ld+json">\n${scriptJson({
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: items.map(i => ({ '@type': 'Question', name: i.question, acceptedAnswer: { '@type': 'Answer', text: i.answer } })),
  })}\n</script>`;
}

const SEARCH_BOTS = ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Googlebot', 'Bingbot'];
export function robotsSnippet(p, siteCheck) {
  const blocked = (siteCheck?.checks || []).find(c => c.id === 'ai-search-bots' && c.status === 'fail');
  const lines = ['# Let AI assistants read the site when they answer questions', ...SEARCH_BOTS.flatMap(b => [`User-agent: ${b}`, 'Allow: /', ''])];
  if (p.website) lines.push(`Sitemap: ${p.website}/sitemap.xml`);
  return { text: lines.join('\n').trim() + '\n', needed: !!blocked || !siteCheck };
}

export function llmsTxt(p) {
  const md = [`# ${p.name || 'Company name'}`, ''];
  if (p.tagline) md.push(`> ${p.tagline}`, '');
  if (p.description) md.push(p.description, '');
  const facts = [['What it is', p.category], ['For', p.audience], ['Markets', p.markets], ['Company', p.legalName],
    ['Founded', p.founded], ['Headquarters', p.headquarters], ['Not to be confused with', p.notConfusedWith]].filter(([, val]) => val);
  if (facts.length) md.push('## Key facts', ...facts.map(([k, val]) => `- ${k}: ${val}`), '');
  if (p.products) md.push('## Products', ...p.products.split('\n').filter(Boolean).map(l => `- ${l.replace(/^[-*]\s*/, '')}`), '');
  if (p.pricing) md.push('## Pricing', p.pricing, '');
  if (p.trust) md.push('## Trust and security', p.trust, '');
  const links = [p.website && `- [Website](${p.website})`, ...(p.profiles || []).map(u => `- [${new URL(u).hostname.replace(/^www\./, '')}](${u})`)].filter(Boolean);
  if (links.length) md.push('## Links', ...links, '');
  return md.join('\n').trim() + '\n';
}

const withItems = d => (d.kind === 'faq' ? { ...d, items: parseJSON(d.body, []) } : d);
export const listDrafts = async projectId => (await all('SELECT * FROM drafts WHERE project_id = ? ORDER BY id DESC', projectId)).map(withItems);

export async function optimiseView(projectId) {
  const profile = await readProfile(projectId);
  const sc = await get('SELECT results FROM site_checks WHERE project_id = ? ORDER BY id DESC LIMIT 1', projectId);
  const siteCheck = sc ? parseJSON(sc.results, null) : null;
  const drafts = await listDrafts(projectId);
  const latestFaq = drafts.find(d => d.kind === 'faq');
  return {
    profile, fields: PROFILE_FIELDS, draftKinds: DRAFT_KINDS, drafts,
    code: {
      organization: profile.name ? organizationJsonLd(profile) : '',
      faq: latestFaq ? faqJsonLd(latestFaq.items) : '',
      robots: robotsSnippet(profile, siteCheck),
      llms: profile.name ? llmsTxt(profile) : '',
    },
    competitors: (await all('SELECT name FROM brands WHERE project_id = ? AND NOT is_own ORDER BY name', projectId)).map(r => r.name),
    questions: (await all('SELECT text FROM prompts WHERE project_id = ? AND active ORDER BY id', projectId)).map(r => r.text),
  };
}
