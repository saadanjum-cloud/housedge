// Recount history after a project's brands change (a competitor added, renamed or removed).
// Answers the AI reader already read are re-matched from the stored reading (free); the rest use word matching.
// Same logic as server/runner.reanalyzeProject + server/extract.applyReading. Runs with full rights (mentions are
// pipeline rows), so callers must first confirm the person can see the project.
import { all, run, parseJSON } from './db.js';
import { analyzeAnswer, classifySource } from './analysis.js';
import { resolve } from './extract.js';
import { lookalikeConfig, confusedWith } from './lookalike.js';

export const SENTIMENT_SCORE = { positive: 85, mixed: 50, neutral: null, negative: 15 };

export async function reanalyzeProject(projectId) {
  const brands = (await all('SELECT * FROM brands WHERE project_id = ?', projectId)).map(b => ({ ...b, aliases: parseJSON(b.aliases, []) }));
  await run('DELETE FROM mentions WHERE project_id = ?', projectId);
  await run('DELETE FROM other_brands WHERE project_id = ?', projectId);
  await run('DELETE FROM confusions WHERE project_id = ?', projectId);
  const answers = await all(`SELECT a.id, a.text, x.data reading, q.text prompt FROM answers a JOIN prompts q ON q.id = a.prompt_id
    LEFT JOIN extractions x ON x.answer_id = a.id WHERE a.project_id = ? AND a.error IS NULL`, projectId);
  const cfg = await lookalikeConfig(projectId);
  const own = cfg && brands.find(b => b.id === cfg.ownId);
  const domainsOf = new Map();
  if (cfg) for (const c of await all('SELECT answer_id, domain FROM citations WHERE project_id = ?', projectId)) domainsOf.set(c.answer_id, [...(domainsOf.get(c.answer_id) || []), c.domain]);
  const mentions = [], others = [], confusions = [];
  // An answer about a look-alike company (see lookalike.js) is a confusion, not a mention of the client.
  // `from`: index where this answer's mentions start in `mentions`.
  const checkConfusion = (a, from) => {
    if (!cfg) return;
    const aboutClient = mentions.slice(from).some(m => m[1] === cfg.ownId) || (own && analyzeAnswer(a.prompt, [own]).mentions.length > 0);
    const look = aboutClient ? confusedWith(cfg, a.text, domainsOf.get(a.id) || []) : null;
    if (!look) return;
    for (let i = mentions.length - 1; i >= from; i--) if (mentions[i][1] === cfg.ownId) mentions.splice(i, 1);
    confusions.push([a.id, look.slice(0, 120)]);
  };
  for (const a of answers) {
    const from = mentions.length;
    const reading = parseJSON(a.reading, null);
    if (reading) {
      for (const e of resolve(reading.entities || [], brands)) {
        if (e.brand_id) mentions.push([a.id, e.brand_id, e.rank ?? null, SENTIMENT_SCORE[e.sentiment] ?? null, String(e.quote || '').slice(0, 400)]);
        else if (e.kind !== 'other' && e.role !== 'passing') others.push([a.id, e.name]);
      }
      checkConfusion(a, from);
      continue;
    }
    const r = analyzeAnswer(a.text, brands);
    for (const m of r.mentions) mentions.push([a.id, m.brand_id, m.position, m.sentiment, m.snippet]);
    for (const o of r.others) others.push([a.id, o]);
    checkConfusion(a, from);
  }
  // Insert in chunks: one statement per few hundred rows instead of one per mention.
  for (let i = 0; i < mentions.length; i += 500) {
    const chunk = mentions.slice(i, i + 500);
    await run(`INSERT INTO mentions (project_id, answer_id, brand_id, position, sentiment, snippet) VALUES ${chunk.map(() => '(?,?,?,?,?,?)').join(',')}`, ...chunk.flatMap(m => [projectId, ...m]));
  }
  for (let i = 0; i < others.length; i += 500) {
    const chunk = others.slice(i, i + 500);
    await run(`INSERT INTO other_brands (project_id, answer_id, name) VALUES ${chunk.map(() => '(?,?,?)').join(',')}`, ...chunk.flatMap(o => [projectId, ...o]));
  }
  for (let i = 0; i < confusions.length; i += 500) {
    const chunk = confusions.slice(i, i + 500);
    await run(`INSERT INTO confusions (project_id, answer_id, lookalike) VALUES ${chunk.map(() => '(?,?,?)').join(',')}`, ...chunk.flatMap(c => [projectId, ...c]));
  }
  for (const c of await all('SELECT id, domain FROM citations WHERE project_id = ?', projectId)) {
    const cat = classifySource(c.domain, brands);
    await run('UPDATE citations SET category = ? WHERE id = ? AND category IS DISTINCT FROM ?', cat, c.id, cat);
  }
}
