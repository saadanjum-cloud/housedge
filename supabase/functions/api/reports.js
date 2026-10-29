// Reports are frozen snapshots, so you can prove later what the numbers were at that time. Port of server/reports.js.
import { all, get, run, parseJSON } from './db.js';
import { summary, sources, perEngine, isoDay } from './metrics.js';
import { computeActions } from './actions.js';
import { outreachSummary } from './outreach.js';

export async function getProject(id) {
  const p = await get('SELECT * FROM projects WHERE id = ?', id);
  return p ? { ...p, engines: parseJSON(p.engines, []), countries: parseJSON(p.countries, []), discovery: parseJSON(p.discovery, {}) } : null;
}

async function buildReport(projectId, { days = 30, to, title, auto = false } = {}) {
  const project = await getProject(projectId);
  const end = to || isoDay(Date.now());
  const f = { from: isoDay(new Date(end).getTime() - (days - 1) * 86400000), to: end, engines: [] };
  const s = await summary(projectId, f);
  if (!s.totalAnswers) throw Object.assign(new Error('There are no answers in this period yet. Run a check first.'), { status: 400 });
  const previous = await get(`SELECT * FROM reports WHERE project_id = ? AND (period_end < ?${auto ? ' OR (period_end = ? AND NOT auto)' : ''})
    ORDER BY period_end DESC, id DESC LIMIT 1`, projectId, end, ...(auto ? [end] : []));
  const kind = previous ? 'periodic' : 'first';
  const prevData = previous ? parseJSON(previous.data, null) : null;
  const doneSince = previous ? await all(`SELECT key, title, status, note, updated_at FROM action_status WHERE project_id = ? AND status = 'done'
    AND updated_at::date > ?::date AND updated_at::date <= ?::date ORDER BY updated_at`, projectId, previous.period_end, end) : [];
  const src = await sources(projectId, f, 15);
  const data = {
    project: { name: project.name, category: project.category }, filter: f, summary: s,
    engines: (await perEngine(projectId, f)).map(e => ({ engine: e.engine, totalAnswers: e.totalAnswers, brands: e.brands })),
    sources: { byType: src.byType, top: src.domains.slice(0, 12) },
    actions: (await computeActions(projectId, f)).slice(0, 8),
    previous: prevData ? { id: previous.id, title: previous.title, period_end: previous.period_end, summary: prevData.summary } : null,
    actionsDone: doneSince,
    outreach: await outreachSummary(projectId),
  };
  const name = title || (kind === 'first' ? `First report — ${project.name}`
    : auto ? `Check report — ${new Date(end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : `Progress report — ${new Date(end).toLocaleString('en-GB', { month: 'long', year: 'numeric' })}`);
  return { name, kind, f, simulated: s.simulatedAnswers > 0, data };
}

export async function createReport(projectId, opts = {}) {
  const r = await buildReport(projectId, opts);
  return (await get('INSERT INTO reports(project_id, title, kind, period_start, period_end, simulated, data) VALUES (?,?,?,?,?,?,?::jsonb) RETURNING id',
    projectId, r.name, r.kind, r.f.from, r.f.to, r.simulated, JSON.stringify(r.data))).id;
}

// One automatic report per day after checks; reports made by hand are never touched.
export async function autoReport(projectId) {
  const end = isoDay(Date.now());
  const today = await get('SELECT id, title FROM reports WHERE project_id = ? AND auto AND period_end = ?', projectId, end);
  const r = await buildReport(projectId, { to: end, auto: true, title: today?.title });
  if (today) {
    await run('UPDATE reports SET kind = ?, period_start = ?, simulated = ?, data = ?::jsonb, created_at = now() WHERE id = ?', r.kind, r.f.from, r.simulated, JSON.stringify(r.data), today.id);
    return today.id;
  }
  return (await get('INSERT INTO reports(project_id, title, kind, period_start, period_end, simulated, data, auto) VALUES (?,?,?,?,?,?,?::jsonb,true) RETURNING id',
    projectId, r.name, r.kind, r.f.from, r.f.to, r.simulated, JSON.stringify(r.data))).id;
}

export const listReports = projectId => all(`SELECT id, title, kind, period_start, period_end, CASE WHEN simulated THEN 1 ELSE 0 END simulated,
  CASE WHEN auto THEN 1 ELSE 0 END auto, created_at FROM reports WHERE project_id = ? ORDER BY period_end DESC NULLS LAST, id DESC`, projectId);

export async function getReport(id) {
  const r = await get('SELECT * FROM reports WHERE id = ?', id);
  return r ? { ...r, simulated: r.simulated ? 1 : 0, data: parseJSON(r.data, {}) } : null;
}

// The six client stages, worked out from what exists in the project.
export async function workflow(projectId) {
  const p = await getProject(projectId);
  const d = p.discovery || {};
  const brands = await get('SELECT COUNT(*) FILTER (WHERE is_own) own, COUNT(*) FILTER (WHERE NOT is_own) comps FROM brands WHERE project_id = ?', projectId);
  const prompts = (await get('SELECT COUNT(*) n FROM prompts WHERE project_id = ?', projectId)).n;
  const answers = (await get('SELECT COUNT(*) n FROM answers WHERE project_id = ? AND error IS NULL', projectId)).n;
  const reports = (await get('SELECT COUNT(*) n FROM reports WHERE project_id = ?', projectId)).n;
  const reviewed = (await get("SELECT COUNT(*) n FROM action_status WHERE project_id = ? AND status IN ('planned','done','dismissed')", projectId)).n;
  const discoveryDone = !!(String(d.competitors || '').trim() && d.markets?.length && String(d.questions || '').trim());
  const stages = [
    { key: 'discovery', title: 'Discovery', desc: 'Record the client\'s real competitors, priority markets and example customer questions.', done: discoveryDone, to: 'discovery' },
    { key: 'setup', title: 'Project setup', desc: 'Brand, competitors and questions loaded into the project.', done: !!(brands?.own && brands?.comps && prompts), to: 'competitors', detail: `${brands?.comps || 0} competitors · ${prompts} questions` },
    { key: 'first_run', title: 'First run', desc: 'Ask the AI engines every question and collect the first answers.', done: answers > 0, to: 'overview', detail: `${answers} answers collected` },
    { key: 'first_report', title: 'First report', desc: 'The "reveal": client vs competitors on visibility, position, sentiment and the sources behind the gap.', done: reports > 0, to: 'reports' },
    { key: 'recommendations', title: 'Recommendations', desc: 'Agree a short, prioritised action list tied to the evidence.', done: reviewed > 0, to: 'actions', detail: `${reviewed} actions reviewed` },
    { key: 'tracking', title: 'Ongoing tracking', desc: 'Automatic runs plus monthly progress reports that show whether the numbers moved after actions.', done: reports > 1 && p.frequency !== 'manual', to: 'reports', detail: `${reports} reports · runs ${p.frequency}` },
  ];
  const current = stages.findIndex(s => !s.done);
  return { stages, current: current < 0 ? stages.length - 1 : current, complete: current < 0 };
}
