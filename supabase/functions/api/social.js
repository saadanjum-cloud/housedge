// Social: which social and community posts AI engines cite, who is named when they do, and which posts the client
// should write. Built only from the citations every answer already stores: no scraping, no platform APIs
// (Reddit and LinkedIn forbid it; see the Nov 2026 research). Runs as the signed-in person.
import { all, parseJSON } from './db.js';
import { answerFilter, brandsOf } from './metrics.js';
import { normName } from './analysis.js';

export const PLATFORMS = {
  reddit: { label: 'Reddit', hosts: ['reddit.com', 'redd.it'] },
  youtube: { label: 'YouTube', hosts: ['youtube.com', 'youtu.be'] },
  linkedin: { label: 'LinkedIn', hosts: ['linkedin.com'] },
  quora: { label: 'Quora', hosts: ['quora.com'] },
  facebook: { label: 'Facebook', hosts: ['facebook.com', 'fb.com'] },
  instagram: { label: 'Instagram', hosts: ['instagram.com'] },
  tiktok: { label: 'TikTok', hosts: ['tiktok.com'] },
  x: { label: 'X', hosts: ['x.com', 'twitter.com'] },
  medium: { label: 'Medium', hosts: ['medium.com'] },
  substack: { label: 'Substack', hosts: ['substack.com'] },
  threads: { label: 'Threads', hosts: ['threads.net', 'threads.com'] },
  pinterest: { label: 'Pinterest', hosts: ['pinterest.com'] },
};
const HOST_RE = `(^|\\.)(${Object.values(PLATFORMS).flatMap(p => p.hosts).map(h => h.replace(/\./g, '\\.')).join('|')})$`;

// What a social URL points at, from the address alone: { platform, kind, community, handle }.
export function socialOf(url) {
  let u; try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const platform = Object.keys(PLATFORMS).find(k => PLATFORMS[k].hosts.some(h => host === h || host.endsWith('.' + h)));
  if (!platform) return null;
  const p = u.pathname.split('/').filter(Boolean).map(s => decodeURIComponent(s).toLowerCase());
  const sub = host.split('.').length > 2 && !/^(m|old|new|mobile|[a-z]{2})\./.test(host) ? host.split('.')[0] : null; // name.medium.com
  let kind = 'page', community = null, handle = null;
  if (platform === 'reddit') {
    if (p[0] === 'r') { community = `r/${p[1]}`; kind = p[2] === 'comments' ? 'thread' : 'community'; }
    else if (p[0] === 'user' || p[0] === 'u') { kind = 'profile'; handle = p[1]; }
    else if (host === 'redd.it') kind = 'thread';
  } else if (platform === 'youtube') {
    if (p[0] === 'watch' || host === 'youtu.be' || p[0] === 'live') kind = 'video';
    else if (p[0] === 'shorts') kind = 'short';
    else if (p[0]?.startsWith('@')) { kind = 'channel'; handle = p[0].slice(1); }
    else if (['channel', 'c', 'user'].includes(p[0])) { kind = 'channel'; handle = p[1]; }
  } else if (platform === 'linkedin') {
    if (p[0] === 'pulse') kind = 'article';
    else if (p[0] === 'posts') { kind = 'post'; handle = p[1]?.split('_')[0]; }
    else if (p[0] === 'company' || p[0] === 'showcase') { kind = 'company page'; handle = p[1]; }
    else if (p[0] === 'in') { kind = 'profile'; handle = p[1]; }
    else if (p[0] === 'feed' || p[0] === 'newsletters') kind = p[0] === 'feed' ? 'post' : 'newsletter';
  } else if (platform === 'x') {
    handle = p[0]; kind = p[1] === 'status' ? 'post' : 'profile';
  } else if (platform === 'tiktok') {
    handle = p[0]?.replace(/^@/, ''); kind = p[1] === 'video' ? 'video' : 'profile';
  } else if (platform === 'facebook' || platform === 'instagram' || platform === 'threads') {
    handle = p[0]?.replace(/^@/, ''); kind = p.length > 1 ? 'post' : 'profile';
    if (['groups'].includes(p[0])) { kind = 'group'; community = p[1]; handle = null; }
  } else if (platform === 'quora') {
    kind = p[0] === 'profile' ? 'profile' : 'answer'; if (kind === 'profile') handle = p[1];
  } else if (platform === 'medium' || platform === 'substack') {
    handle = sub || p[0]?.replace(/^@/, ''); kind = p.length > (sub ? 0 : 1) ? 'article' : 'profile';
  }
  return { platform, kind, community, handle };
}

// Whose account a post is on: the client's (a handle from its official profiles, or its name), a tracked
// competitor's (handle contains its name or domain stem), or a third party.
// ponytail: name match on handles; store competitors' profile addresses if this misattributes.
function ownerOf(s, brands, ownHandles) {
  if (!s.handle) return 'third';
  const h = normName(s.handle).replace(/\s/g, '');
  if (ownHandles.has(`${s.platform}:${s.handle}`)) return 'own';
  const hit = brands.find(b => [b.name, (b.domain || '').split('.')[0]].some(n => { const k = normName(n || '').replace(/\s/g, ''); return k.length >= 4 && h.includes(k); }));
  return hit ? (hit.is_own ? 'own' : 'competitor') : 'third';
}

export async function socialView(projectId, f) {
  const af = answerFilter(projectId, f);
  const brands = await brandsOf(projectId);
  const own = brands.find(b => b.is_own);
  const profile = parseJSON((await all('SELECT data FROM brand_profiles WHERE project_id = ?', projectId))[0]?.data, {});
  const ownHandles = new Set((profile.profiles || []).map(socialOf).filter(s => s?.handle).map(s => `${s.platform}:${s.handle}`));
  const answers = await all(`SELECT a.id, a.engine, a.prompt_id, a.day FROM answers a WHERE a.id IN (${af.sql})`, ...af.params);
  const cites = await all(`SELECT c.answer_id, c.url, MAX(c.title) title FROM citations c
    WHERE c.answer_id IN (${af.sql}) AND c.domain ~* ? GROUP BY c.answer_id, c.url`, ...af.params, HOST_RE);
  const named = new Map(); // answer id -> brand ids named in it (only answers that cite social)
  for (const m of await all(`SELECT DISTINCT answer_id, brand_id FROM mentions WHERE answer_id IN (${af.sql})
      AND answer_id IN (SELECT answer_id FROM citations WHERE project_id = ? AND domain ~* ?)`, ...af.params, projectId, HOST_RE)) {
    if (!named.has(m.answer_id)) named.set(m.answer_id, new Set());
    named.get(m.answer_id).add(m.brand_id);
  }
  const byId = new Map(answers.map(a => [a.id, a]));
  const prompts = new Map((await all('SELECT id, text FROM prompts WHERE project_id = ? AND active', projectId)).map(p => [p.id, p.text]));
  const engines = [...new Set(answers.map(a => a.engine))].sort();
  const perEngine = Object.fromEntries(engines.map(e => [e, answers.filter(a => a.engine === e).length]));
  const perPrompt = new Map();
  for (const a of answers) perPrompt.set(a.prompt_id, (perPrompt.get(a.prompt_id) || 0) + 1);

  const plat = new Map(), posts = new Map(), combos = new Map(), socialAnswers = new Set();
  for (const c of cites) {
    const a = byId.get(c.answer_id), s = socialOf(c.url);
    if (!a || !s) continue;
    socialAnswers.add(a.id);
    const P = plat.get(s.platform) || plat.set(s.platform, { answers: new Set(), byEngine: {} }).get(s.platform);
    P.answers.add(a.id); (P.byEngine[a.engine] ||= new Set()).add(a.id);
    const post = posts.get(c.url) || posts.set(c.url, { url: c.url, title: c.title, ...s, owner: ownerOf(s, brands, ownHandles), answers: new Set(), engines: new Set(), prompts: new Set(), first: a.day, last: a.day }).get(c.url);
    post.answers.add(a.id); post.engines.add(a.engine); post.prompts.add(a.prompt_id);
    if (a.day < post.first) post.first = a.day; if (a.day > post.last) post.last = a.day;
    if (prompts.has(a.prompt_id)) {
      const k = `${a.prompt_id}|${s.platform}`;
      const C = combos.get(k) || combos.set(k, { promptId: a.prompt_id, platform: s.platform, answers: new Set(), engines: new Set(), urls: new Map() }).get(k);
      C.answers.add(a.id); C.engines.add(a.engine); C.urls.set(c.url, (C.urls.get(c.url) || 0) + 1);
    }
  }
  const rate = (ids, brandId) => (ids.size ? Math.round(100 * [...ids].filter(id => named.get(id)?.has(brandId)).length / ids.size) : 0);
  const brandRates = ids => brands.map(b => ({ id: b.id, name: b.name, own: !!b.is_own, rate: rate(ids, b.id) })).sort((x, y) => y.rate - x.rate);
  const label = k => PLATFORMS[k].label;

  const platforms = [...plat].map(([k, P]) => ({
    platform: k, label: label(k), answers: P.answers.size, share: answers.length ? Math.round(1000 * P.answers.size / answers.length) / 10 : 0,
    byEngine: Object.fromEntries(engines.map(e => [e, perEngine[e] ? Math.round(1000 * (P.byEngine[e]?.size || 0) / perEngine[e]) / 10 : 0])),
    brands: brandRates(P.answers),
  })).sort((a, b) => b.answers - a.answers);

  const postRow = p => ({ url: p.url, title: p.title, platform: p.platform, label: label(p.platform), kind: p.kind, community: p.community, handle: p.handle,
    owner: p.owner, cited: p.answers.size, engines: [...p.engines].sort(), first: p.first, last: p.last,
    namesOwn: own ? rate(p.answers, own.id) : 0, brands: brandRates(p.answers).filter(b => b.rate > 0).slice(0, 4) });

  // Post ideas: per tracked question and platform, how much AI leans on that platform for the question (reliance),
  // how far the client trails the best competitor in those answers (gap), and on how many engines (reach).
  // ponytail: a weighted product of three ratios; tune the weights once posts are measured in the work log.
  const ideas = [...combos.values()].map(C => {
    const reliance = C.answers.size / (perPrompt.get(C.promptId) || 1);
    const br = brandRates(C.answers), ownRate = br.find(b => b.own)?.rate || 0, top = br.find(b => !b.own);
    const gap = Math.max(0, (top?.rate || 0) - ownRate) / 100;
    const reach = C.engines.size / Math.max(1, engines.length);
    const examples = [...C.urls].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([u]) => postRow(posts.get(u)));
    const ownPost = examples.some(e => e.owner === 'own');
    return {
      promptId: C.promptId, question: prompts.get(C.promptId), platform: C.platform, label: label(C.platform),
      score: Math.round(100 * reliance * (0.4 + 0.6 * gap) * (0.6 + 0.4 * reach) * (ownPost ? 0.5 : 1)),
      answers: C.answers.size, ofAnswers: perPrompt.get(C.promptId) || 0, engines: [...C.engines].sort(), ownRate, top: top && top.rate ? top : null, examples,
    };
  }).filter(i => i.score > 0 && ((i.top && i.top.rate > i.ownRate) || i.ownRate < 50)).sort((a, b) => b.score - a.score).slice(0, 25); // only real gaps

  const drafts = (await all(`SELECT id, kind, title, body, created_at FROM drafts WHERE project_id = ? AND kind LIKE 'social\\_%' AND kind <> 'social_scan' ORDER BY id DESC LIMIT 50`, projectId))
    .map(d => ({ ...d, ...parseJSON(d.body, {}), platform: d.kind.slice(7), label: PLATFORMS[d.kind.slice(7)]?.label || d.kind.slice(7) }));
  return {
    totalAnswers: answers.length, socialAnswers: socialAnswers.size, engines, platforms, ideas, drafts,
    posts: [...posts.values()].sort((a, b) => b.answers.size - a.answers.size).slice(0, 60).map(postRow),
  };
}
