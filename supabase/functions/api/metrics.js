// Turns stored answers into the numbers shown on screen. Port of server/metrics.js to Postgres:
// same functions, same output shapes. Runs as the signed-in person, so only their own projects are visible.
import { all, get, parseJSON } from './db.js';
import { SOURCE_TYPES, normName, brandKeys } from './analysis.js';

const DAY = 86400000;
export const isoDay = d => new Date(d).toISOString().slice(0, 10);
const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

export async function brandsOf(projectId) {
  return (await all('SELECT * FROM brands WHERE project_id = ? ORDER BY is_own DESC, id', projectId)).map(b => ({ ...b, aliases: parseJSON(b.aliases, []) }));
}

// Filter = { from, to, engines: [], country, tag, topic }. Returns SQL that selects matching answer ids.
export function answerFilter(projectId, f = {}) {
  const where = ['a.project_id = ?', 'a.error IS NULL'];
  const params = [projectId];
  if (f.from) { where.push('a.day >= ?'); params.push(f.from); }
  if (f.to) { where.push('a.day <= ?'); params.push(f.to); }
  if (f.engines?.length) { where.push(`a.engine IN (${f.engines.map(() => '?').join(',')})`); params.push(...f.engines); }
  if (f.country) { where.push('p.country = ?'); params.push(f.country); }
  if (f.topic) { where.push('p.topic = ?'); params.push(f.topic); }
  if (f.tag) { where.push('? = ANY(p.tags)'); params.push(f.tag); }
  if (f.promptId) { where.push('a.prompt_id = ?'); params.push(f.promptId); }
  return { sql: `SELECT a.id FROM answers a JOIN prompts p ON p.id = a.prompt_id WHERE ${where.join(' AND ')}`, params };
}

const one = v => (Array.isArray(v) ? v[0] : v);
const text = (v, max = 80) => (typeof one(v) === 'string' ? one(v).slice(0, max) : '');
const dayOk = v => (/^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + 'T00:00:00Z')) ? v : '');
export function parseFilter(q = {}) {
  const days = Math.min(400, Math.max(1, Math.floor(Number(one(q.days))) || 30));
  const to = dayOk(text(q.to, 10)) || isoDay(Date.now());
  const from = dayOk(text(q.from, 10)) || isoDay(new Date(to + 'T00:00:00Z').getTime() - (days - 1) * DAY);
  return {
    from, to, days,
    engines: text(q.engines, 200).split(',').filter(e => /^[a-z]{2,20}$/.test(e)).slice(0, 10),
    country: text(q.country, 10), tag: text(q.tag), topic: text(q.topic),
  };
}
export function previousPeriod(f) {
  const len = Math.round((new Date(f.to) - new Date(f.from)) / DAY) + 1;
  const to = isoDay(new Date(f.from).getTime() - DAY);
  const from = isoDay(new Date(to).getTime() - (len - 1) * DAY);
  return { ...f, from, to };
}

async function brandStats(projectId, f) {
  const af = answerFilter(projectId, f);
  const total = (await get(`SELECT COUNT(*) n FROM (${af.sql}) x`, ...af.params)).n;
  const simulated = (await get(`SELECT COUNT(*) n FROM answers WHERE id IN (${af.sql}) AND simulated`, ...af.params)).n;
  const rows = await all(`SELECT brand_id, COUNT(DISTINCT answer_id) answers, COUNT(*) mentions, AVG(position) position, AVG(sentiment) sentiment
    FROM mentions WHERE answer_id IN (${af.sql}) GROUP BY brand_id`, ...af.params);
  const allMentions = rows.reduce((s, r) => s + r.mentions, 0);
  return { total, simulated, allMentions, map: new Map(rows.map(r => [r.brand_id, r])) };
}

export async function summary(projectId, f) {
  const brands = await brandsOf(projectId);
  const [cur, prev] = await Promise.all([brandStats(projectId, f), brandStats(projectId, previousPeriod(f))]);
  const make = (s, b) => {
    const r = s.map.get(b.id);
    return {
      visibility: s.total ? round(100 * (r?.answers || 0) / s.total) : null,
      position: r ? round(r.position) : null,
      sentiment: r?.sentiment == null ? null : Math.round(r.sentiment),
      sov: s.allMentions ? round(100 * (r?.mentions || 0) / s.allMentions) : null,
      mentions: r?.answers || 0,
    };
  };
  const list = brands.map(b => ({ id: b.id, name: b.name, is_own: !!b.is_own, color: b.color, domain: b.domain, ...make(cur, b), prev: prev.total ? make(prev, b) : null }));
  const ranked = [...list].sort((a, b) => (b.visibility ?? -1) - (a.visibility ?? -1) || (a.position ?? 99) - (b.position ?? 99));
  ranked.forEach((b, i) => { b.rank = i + 1; });
  const [confusion, prevConfusion] = await Promise.all([confusionStats(projectId, f, cur.total), prev.total ? confusionStats(projectId, previousPeriod(f), prev.total) : null]);
  return { totalAnswers: cur.total, simulatedAnswers: cur.simulated, prevTotal: prev.total, brands: list, filter: f, confusion, prevConfusion };
}

// Answers that were about a look-alike company instead of the client (see lookalike.js).
export async function confusionStats(projectId, f, total) {
  const af = answerFilter(projectId, f);
  const rows = await all(`SELECT lookalike, COUNT(*)::int n FROM confusions WHERE answer_id IN (${af.sql}) GROUP BY lookalike ORDER BY n DESC`, ...af.params);
  const answers = rows.reduce((a, r) => a + r.n, 0);
  return { answers, share: total ? round(100 * answers / total) : 0, lookalikes: rows.map(r => ({ name: r.lookalike, answers: r.n })) };
}

export async function daily(projectId, f) {
  const brands = await brandsOf(projectId);
  const af = answerFilter(projectId, f);
  const totals = await all(`SELECT day, COUNT(*) n FROM answers WHERE id IN (${af.sql}) GROUP BY day ORDER BY day`, ...af.params);
  const rows = await all(`SELECT a.day, m.brand_id, COUNT(DISTINCT m.answer_id) answers, COUNT(*) mentions, AVG(m.position) pos, AVG(m.sentiment) sent
    FROM mentions m JOIN answers a ON a.id = m.answer_id WHERE m.answer_id IN (${af.sql}) GROUP BY a.day, m.brand_id`, ...af.params);
  const byDay = new Map(totals.map(t => [t.day, { day: t.day, total: t.n, allMentions: 0 }]));
  for (const r of rows) { const d = byDay.get(r.day); if (d) d.allMentions += r.mentions; }
  for (const r of rows) {
    const d = byDay.get(r.day); if (!d) continue;
    d[`v_${r.brand_id}`] = round(100 * r.answers / d.total);
    d[`s_${r.brand_id}`] = d.allMentions ? round(100 * r.mentions / d.allMentions) : 0;
    d[`p_${r.brand_id}`] = round(r.pos);
    d[`t_${r.brand_id}`] = r.sent == null ? null : Math.round(r.sent);
  }
  const series = [...byDay.values()];
  for (const d of series) for (const b of brands) { d[`v_${b.id}`] ??= 0; d[`s_${b.id}`] ??= 0; }
  return { brands: brands.map(b => ({ id: b.id, name: b.name, color: b.color, is_own: !!b.is_own })), series };
}

export async function perEngine(projectId, f) {
  const brands = await brandsOf(projectId);
  const engines = (await all('SELECT DISTINCT engine FROM answers WHERE project_id = ?', projectId)).map(r => r.engine);
  const out = [];
  for (const engine of engines) {
    const s = await summary(projectId, { ...f, engines: [engine] });
    if (s.totalAnswers > 0) out.push({ engine, totalAnswers: s.totalAnswers, brands: s.brands, brandOrder: brands.map(b => b.id) });
  }
  return out;
}

export async function sources(projectId, f, limit = 100) {
  const af = answerFilter(projectId, f);
  const own = await get('SELECT id FROM brands WHERE project_id = ? AND is_own', projectId);
  const total = (await get(`SELECT COUNT(*) n FROM (${af.sql}) x`, ...af.params)).n;
  const domains = await all(`SELECT c.domain, MAX(c.category) category, COUNT(DISTINCT c.answer_id) answers, COUNT(*) citations,
      COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM mentions m WHERE m.answer_id = c.answer_id AND m.brand_id = ?) THEN c.answer_id END) with_own
    FROM citations c WHERE c.answer_id IN (${af.sql}) GROUP BY c.domain ORDER BY answers DESC LIMIT ?`, own?.id ?? -1, ...af.params, limit);
  const byType = (await all(`SELECT category, COUNT(DISTINCT answer_id) answers, COUNT(*) citations FROM citations
    WHERE answer_id IN (${af.sql}) GROUP BY category ORDER BY citations DESC`, ...af.params)).map(r => ({ ...r, label: SOURCE_TYPES[r.category] || r.category }));
  const urls = await all(`SELECT url, MAX(title) title, MAX(domain) domain, MAX(category) category, COUNT(*) n FROM citations WHERE answer_id IN (${af.sql})
    GROUP BY url ORDER BY n DESC LIMIT 50`, ...af.params);
  return { totalAnswers: total, byType, domains: domains.map(d => ({ ...d, label: SOURCE_TYPES[d.category], share: total ? round(100 * d.answers / total) : 0 })), urls };
}

// Brands the answers name that are not tracked. Spellings merged; product lines of a tracked brand skipped.
export async function suggestions(projectId, f) {
  const af = answerFilter(projectId, f);
  const total = (await get(`SELECT COUNT(*) n FROM (${af.sql}) x`, ...af.params)).n;
  const tracked = (await brandsOf(projectId)).flatMap(brandKeys);
  const dismissed = new Set(parseJSON((await get('SELECT discovery FROM projects WHERE id = ?', projectId))?.discovery, {}).dismissedSuggestions || []);
  const groups = new Map();
  for (const r of await all(`SELECT name, answer_id FROM other_brands WHERE answer_id IN (${af.sql})`, ...af.params)) {
    const key = normName(r.name);
    if (!key || tracked.some(t => key === t || key.startsWith(t + ' '))) continue;
    const g = groups.get(key) || { answers: new Set(), names: new Map() };
    g.answers.add(r.answer_id);
    g.names.set(r.name, (g.names.get(r.name) || 0) + 1);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(g => ({ name: [...g.names].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0], answers: g.answers.size }))
    .filter(r => r.answers >= 2 && !dismissed.has(r.name))
    .sort((a, b) => b.answers - a.answers).slice(0, 25)
    .map(r => ({ ...r, visibility: total ? round(100 * r.answers / total) : 0 }));
}

export async function promptTable(projectId, f) {
  const own = await get('SELECT id FROM brands WHERE project_id = ? AND is_own', projectId);
  const prompts = await all('SELECT * FROM prompts WHERE project_id = ? ORDER BY id', projectId);
  const af = answerFilter(projectId, f);
  const counts = new Map((await all(`SELECT prompt_id, COUNT(*) n FROM answers WHERE id IN (${af.sql}) GROUP BY prompt_id`, ...af.params)).map(r => [r.prompt_id, r.n]));
  const ownRows = new Map((await all(`SELECT a.prompt_id, COUNT(DISTINCT m.answer_id) n, AVG(m.position) pos, AVG(m.sentiment) sent FROM mentions m
    JOIN answers a ON a.id = m.answer_id WHERE m.brand_id = ? AND m.answer_id IN (${af.sql}) GROUP BY a.prompt_id`, own?.id ?? -1, ...af.params)).map(r => [r.prompt_id, r]));
  const top = await all(`SELECT a.prompt_id, b.name, COUNT(DISTINCT m.answer_id) n FROM mentions m JOIN answers a ON a.id = m.answer_id
    JOIN brands b ON b.id = m.brand_id WHERE m.answer_id IN (${af.sql}) GROUP BY a.prompt_id, m.brand_id, b.name ORDER BY n DESC`, ...af.params);
  const topBy = new Map();
  for (const t of top) if (!topBy.has(t.prompt_id)) topBy.set(t.prompt_id, t);
  return prompts.map(p => {
    const n = counts.get(p.id) || 0, o = ownRows.get(p.id), t = topBy.get(p.id);
    return {
      ...p, active: p.active ? 1 : 0, tags: parseJSON(p.tags, []), answers: n,
      visibility: n ? round(100 * (o?.n || 0) / n) : null, position: o ? round(o.pos) : null, sentiment: o?.sent == null ? null : Math.round(o.sent),
      topBrand: t ? { name: t.name, visibility: n ? round(100 * t.n / n) : 0 } : null,
    };
  });
}

export async function chats(projectId, f, { limit = 30, offset = 0, brandId, q } = {}) {
  const af = answerFilter(projectId, f);
  const extra = [];
  const params = [...af.params];
  if (brandId) { extra.push('EXISTS (SELECT 1 FROM mentions m WHERE m.answer_id = a.id AND m.brand_id = ?)'); params.push(brandId); }
  if (q) { extra.push('(a.text ILIKE ? OR p.text ILIKE ?)'); const like = `%${q.replace(/[%_\\]/g, m => '\\' + m)}%`; params.push(like, like); }
  const where = `a.id IN (${af.sql})` + (extra.length ? ' AND ' + extra.join(' AND ') : '');
  const total = (await get(`SELECT COUNT(*) n FROM answers a JOIN prompts p ON p.id = a.prompt_id WHERE ${where}`, ...params)).n;
  const rows = await all(`SELECT a.id, a.engine, a.day, a.text, a.model, CASE WHEN a.simulated THEN 1 ELSE 0 END simulated, p.text prompt, p.country, p.language, p.topic
    FROM answers a JOIN prompts p ON p.id = a.prompt_id WHERE ${where} ORDER BY a.day DESC, a.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  if (rows.length) {
    const ids = rows.map(r => r.id);
    const marks = ids.map(() => '?').join(',');
    const [ms, cs, os, cf] = await Promise.all([
      all(`SELECT m.answer_id, m.brand_id, m.position, m.sentiment, b.name, b.is_own, b.color FROM mentions m JOIN brands b ON b.id = m.brand_id WHERE m.answer_id IN (${marks}) ORDER BY m.position NULLS LAST`, ...ids),
      all(`SELECT answer_id, url, title, domain, category FROM citations WHERE answer_id IN (${marks})`, ...ids),
      all(`SELECT answer_id, name FROM other_brands WHERE answer_id IN (${marks})`, ...ids),
      all(`SELECT answer_id, lookalike FROM confusions WHERE answer_id IN (${marks})`, ...ids),
    ]);
    for (const r of rows) {
      r.mentions = ms.filter(m => m.answer_id === r.id).map(({ answer_id, ...m }) => ({ ...m, is_own: m.is_own ? 1 : 0 })); // eslint-disable-line no-unused-vars
      r.citations = cs.filter(c => c.answer_id === r.id).map(({ answer_id, ...c }) => c); // eslint-disable-line no-unused-vars
      r.others = os.filter(o => o.answer_id === r.id).map(o => o.name);
      r.confusedWith = cf.find(c => c.answer_id === r.id)?.lookalike || null;
    }
  }
  return { total, rows };
}

export async function visibilityByCountry(projectId, f) {
  const countries = (await all('SELECT DISTINCT country FROM prompts WHERE project_id = ?', projectId)).map(r => r.country);
  const out = [];
  for (const c of countries) {
    const s = await summary(projectId, { ...f, country: c });
    if (s.totalAnswers > 0) out.push({ country: c, totalAnswers: s.totalAnswers, brands: s.brands });
  }
  return out;
}
