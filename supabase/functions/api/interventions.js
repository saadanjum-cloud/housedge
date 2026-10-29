// The work log: real-world actions taken for a client, each measured against AI answers before and after it went
// live. Before/after is a comparison, not proof of cause, so every share comes with its Wilson interval and a
// change only counts as "clear" when the two intervals do not overlap.
import { all, get, run } from './db.js';
import { v, safeHttpUrl, InputError } from './validate.js';
import { domainOf } from './analysis.js';
import { wilson, changeIsReal } from './stats.js';

export const KINDS = {
  listicle: 'Listed on a comparison or "best of" page',
  review_site: 'Review site (Trustpilot, app stores, G2…)',
  community: 'Community (Reddit, forums, Facebook groups)',
  press: 'Press article or interview',
  own_page: 'New or updated page on our website',
  site_technical: 'Website technical fix (schema, title, robots.txt…)',
  knowledge_graph: 'Wikipedia / Wikidata',
  social: 'Social or video (YouTube, LinkedIn…)',
  other: 'Other',
};
export const WINDOW_DAYS = 28;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Checks a create/update body. `partial` allows leaving fields out (update).
export function interventionInput(b, project, { partial = false } = {}) {
  const out = {};
  if (!partial || b.kind !== undefined) { if (!KINDS[b.kind]) throw new InputError('Choose what kind of action this was.'); out.kind = b.kind; }
  if (!partial || b.title !== undefined) out.title = v.str(b.title, { max: 300, label: 'What was done', required: true });
  if (b.url !== undefined) {
    const raw = v.str(b.url, { max: 2000, label: 'Link' });
    const url = raw ? safeHttpUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) : null;
    if (raw && !url) throw new InputError('The link must be a web address (https://…).');
    out.url = url; out.target_domain = url ? domainOf(url) : null;
  }
  if (!partial || b.doneOn !== undefined) {
    const d = String(b.doneOn || '');
    if (!DATE.test(d) || Number.isNaN(Date.parse(d))) throw new InputError('Give the date it went live.');
    if (Date.parse(d) > Date.now() + 366 * 864e5) throw new InputError('That date is too far in the future.');
    out.done_on = d;
  }
  if (b.status !== undefined) { if (!['planned', 'live', 'removed'].includes(b.status)) throw new InputError('Unknown status.'); out.status = b.status; }
  if (b.markets !== undefined) out.markets = (v.list(b.markets, { max: 20, label: 'Markets' }) || []).filter(m => project.countries.includes(m) || m === 'GLOBAL');
  if (b.promptIds !== undefined) out.prompt_ids = (v.list(b.promptIds, { max: 200, label: 'Questions' }) || []).map(Number).filter(Number.isInteger);
  if (b.actionKey !== undefined) out.action_key = v.str(b.actionKey, { max: 200, label: 'Suggested action' }) || null;
  if (b.notes !== undefined) out.notes = v.str(b.notes, { max: 4000, label: 'Notes' }) || null;
  return out;
}

const COLS = { kind: 'kind', title: 'title', url: 'url', target_domain: 'target_domain', done_on: 'done_on', status: 'status', markets: 'markets', prompt_ids: 'prompt_ids', action_key: 'action_key', notes: 'notes' };

export async function createIntervention(projectId, data) {
  const keys = Object.keys(data).filter(k => COLS[k]);
  return (await get(`INSERT INTO interventions (project_id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')}) RETURNING id`,
    projectId, ...keys.map(k => data[k]))).id;
}

export async function updateIntervention(id, data) {
  const keys = Object.keys(data).filter(k => COLS[k]);
  if (keys.length) await run(`UPDATE interventions SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map(k => data[k]), id);
}

// Every logged action with its before/after result, plus the weekly mention rate for the chart.
export async function workLog(projectId) {
  const rows = await all(`SELECT i.*, p.full_name AS created_by_name, r.before_answers, r.before_named, r.after_answers, r.after_named,
      r.before_cited, r.after_cited, r.first_cited, r.days_after
    FROM interventions i LEFT JOIN profiles p ON p.id = i.created_by
    LEFT JOIN public.intervention_results(?, ?) r ON r.id = i.id
    WHERE i.project_id = ? ORDER BY i.done_on DESC, i.id DESC`, projectId, WINDOW_DAYS, projectId);
  const items = rows.map(r => {
    const before = wilson(r.before_named || 0, r.before_answers || 0), after = wilson(r.after_named || 0, r.after_answers || 0);
    const measuring = r.status !== 'planned' && (r.days_after ?? 0) < WINDOW_DAYS;
    const verdict = r.status === 'planned' ? 'planned'
      : !before.n || !after.n ? 'no_data'
        : changeIsReal(before, after) ? (after.p > before.p ? 'up' : 'down')
          : measuring ? 'measuring' : 'no_clear_change';
    return { ...r, before, after, measuring, verdict, citedSince: r.after_cited || 0, firstCited: r.first_cited };
  });
  const weekly = await all(`SELECT date_trunc('week', a.day)::date AS week, COUNT(*)::int AS answers,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM mentions m JOIN brands b ON b.id = m.brand_id WHERE m.answer_id = a.id AND b.is_own))::int AS named
    FROM answers a WHERE a.project_id = ? AND a.error IS NULL AND a.text IS NOT NULL GROUP BY 1 ORDER BY 1`, projectId);
  return { kinds: KINDS, windowDays: WINDOW_DAYS, items, weekly: weekly.map(w => ({ ...w, share: w.answers ? Math.round(1000 * w.named / w.answers) / 10 : null })) };
}
