// Look-alike filter (port of the cofounder's server/lookalike.js): spots answers that are really about a different
// company with a similar name (the brand profile's "Not to be confused with"), so they are recorded as confusions
// and not counted as mentions of the client. Rule-based and free: no AI call. An answer counts as confused when it
// names the look-alike (or cites its site) and shows no sign of being about the client (the client's website, or an
// explicit "not to be confused with").
import { get, run, parseJSON } from './db.js';
import { analyzeAnswer } from './analysis.js';
const fold = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const squash = s => fold(s).replace(/[^a-z0-9]+/g, '');
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DISAMBIGUATION = /not\s+(?:to\s+be\s+)?confused\s+with|not\s+(?:affiliated|related|connected)\s+(?:with|to)|(?:different|separate)\s+(?:company|business|brand)\s+from/i;

// "Kay Jewelers (a US jewellery retailer); Kays Bank" -> ["Kay Jewelers", "Kays Bank"]
export function lookalikeNames(text) {
  return String(text || '').split(/[,;\n]|\s+or\s+/i)
    .map(s => s.replace(/\(.*?\)/g, '').replace(/["“”]/g, '').trim())
    .filter(s => s.length >= 3 && s.length <= 80)
    .slice(0, 5);
}

// What the filter needs for one project, or null when no look-alike is set.
export async function lookalikeConfig(projectId) {
  const profile = parseJSON((await get('SELECT data FROM brand_profiles WHERE project_id = ?', projectId))?.data, {});
  const names = lookalikeNames(profile.notConfusedWith);
  const own = await get('SELECT id, domain FROM brands WHERE project_id = ? AND is_own', projectId);
  if (!names.length || !own) return null;
  return { names, ownId: own.id, ownDomain: String(own.domain || '').replace(/^www\./, '').toLowerCase() };
}

// True when a website is about the look-alike (e.g. "kay-jewelers.pissedconsumer.com"): never an outreach target.
export function isLookalikeSite(cfg, domain) {
  if (!cfg) return false;
  const d = squash(domain);
  return cfg.names.some(n => squash(n).length >= 5 && d.includes(squash(n)));
}

// The look-alike's name if this answer is about it rather than the client, otherwise null.
export function confusedWith(cfg, text, domains = []) {
  if (!cfg) return null;
  const t = String(text || '');
  const lower = t.toLowerCase();
  const doms = domains.map(d => String(d || '').toLowerCase().replace(/^www\./, ''));
  const aboutClient = (cfg.ownDomain && (lower.includes(cfg.ownDomain) || doms.some(d => d === cfg.ownDomain || d.endsWith('.' + cfg.ownDomain))))
    || DISAMBIGUATION.test(t);
  if (aboutClient) return null;
  for (const name of cfg.names) {
    const inText = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, 'iu').test(t);
    const key = squash(name);
    const inSources = key.length >= 5 && doms.some(d => squash(d).includes(key));
    if (inText || inSources) return name;
  }
  return null;
}

// After an answer's mentions are stored: if it is really about the look-alike, drop the client's mention and
// record the confusion. Checked when the answer names the client, or when the question did (the answer may only
// name the look-alike). Runs inside the caller's transaction.
export async function markConfusion(cfg, { answerId, projectId, text, domains = [], promptText = '', brands }) {
  if (!cfg) return null;
  const own = brands.find(b => b.id === cfg.ownId);
  const named = await get('SELECT 1 FROM mentions WHERE answer_id = ? AND brand_id = ?', answerId, cfg.ownId);
  const aboutClient = !!named || (own && analyzeAnswer(promptText, [own]).mentions.length > 0);
  const look = aboutClient ? confusedWith(cfg, text, domains) : null;
  if (!look) { await run('DELETE FROM confusions WHERE answer_id = ?', answerId); return null; }
  await run('DELETE FROM mentions WHERE answer_id = ? AND brand_id = ?', answerId, cfg.ownId);
  await run('INSERT INTO confusions (answer_id, project_id, lookalike) VALUES (?,?,?) ON CONFLICT (answer_id) DO UPDATE SET lookalike = excluded.lookalike', answerId, projectId, look.slice(0, 120));
  return look;
}
