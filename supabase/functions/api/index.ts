// The app's data API on Supabase: the same requests and responses the current pages already use (port of
// server/index.js), so the pages themselves do not change. Each request runs as the signed-in person inside one
// transaction, and row level security decides what they can see and change. The few steps that need full rights
// (recounting history, removing people) run separately, only after the handler has checked the caller's role.
import { db as authDb, newToken, sha256, sameSecret } from '../_shared/util.ts';
import { asUser, asService, all, get, run, parseJSON } from './db.js';
import { v, InputError } from './validate.js';
import { BRAND_LIBRARY, PROMPT_LIBRARY, GENERAL_PROMPTS, CATEGORIES, COUNTRIES, LANGUAGES } from './library.js';
import { SOURCE_TYPES } from './analysis.js';
import { ENGINES, SUPPORTED_ENGINES, estimateAnswerCost } from './engines.js';
import * as M from './metrics.js';
import { computeActions, factReport } from './actions.js';
import { createReport, listReports, getReport, workflow, getProject } from './reports.js';
import { optimiseView, saveProfile } from './optimise.js';
import { reanalyzeProject } from './readings.js';
import { startRun, resumeIfStalled, EST_PER_QUESTION, RUN_MODEL } from './pipeline.js';
import { runSiteCheck } from './sitecheck.js';
import { prefillFromWebsite } from './prefill.js';
import { outreachView, addTarget, updateTarget, draftEmail } from './outreach.js';
import { askAssistant } from './assistant.js';
import { assertCanSpend } from './spend.js';
import { writeDraft, checkFacts } from './helpers-ai.js';
import Anthropic from 'npm:@anthropic-ai/sdk@0.133.0';
import { workLog, interventionInput, createIntervention, updateIntervention, KINDS, WINDOW_DAYS } from './interventions.js';

const APP_URL = (Deno.env.get('APP_URL') || 'http://localhost:5173').replace(/\/$/, '');
const ORIGINS = (Deno.env.get('APP_ORIGINS') || APP_URL).split(',').map(s => s.trim());
const MAX_ACTIVE_PROMPTS = 300, MAX_FACTS = 30, INVITE_DAYS = 7;
const FREQUENCIES = ['daily', 'every3', 'weekly', 'manual'];
const ACTIVITY_TYPES = ['call', 'meeting', 'email', 'task', 'report'];
const COMPANY_FIELDS = ['name', 'businessId', 'vatId', 'address', 'country', 'email', 'phone', 'website', 'representative'];

const fail = (msg, status = 400) => Object.assign(new Error(msg), { status, expose: true });
const notFound = () => fail('Not found', 404);
const countryOk = c => (COUNTRIES[c] ? c : undefined);
const langOk = l => (LANGUAGES[l] ? l : undefined);
const cleanDomain = d => (d || '').trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase() || null;

type Ctx = { params: Record<string, string>; query: Record<string, string>; body: any; user: any; role: string | null; after: (() => Promise<unknown>)[] };
type Handler = (c: Ctx) => Promise<unknown>;
const routes: { method: string; re: RegExp; handler: Handler; open?: boolean }[] = [];
const R = (method: string, pattern: string, handler: Handler, open = false) =>
  routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, open });

// The team has read-only access to client data. These are the only changes a team account may make: its own
// workspace (account settings, enquiries, the team, follow-ups) and the reports it writes for clients.
// Every other change is refused, whatever the page sends. The database enforces the same (team_read_only migration).
const TEAM_WRITES = [/^\/me(\/password)?$/, /^\/admin\//, /^\/enquiries(\/|$)/, /^\/settings(\/|$)/, /^\/backup$/, /^\/team(\/|$)/,
  /^\/activities\/\d+$/, /^\/projects\/\d+\/(activities|reports|interventions|outreach|assistant)$/, /^\/reports\/\d+$/, /^\/interventions\/\d+$/,
  /^\/outreach\/\d+(\/email)?$/];
const staffOnly = (c: Ctx) => { if (!c.role) throw fail('Only the Housedge team can do this.', 403); };
const adminOnly = (c: Ctx) => { if (c.role !== 'admin') throw fail('Only an admin can do this.', 403); };
async function projectOr404(id: unknown) { const p = await getProject(Number(id)); if (!p) throw notFound(); return p; }
const brandInput = (b: any, label: string) => ({
  name: v.str(b?.name, { max: 120, label }), domain: v.str(b?.domain, { max: 200, label: `${label} website` }),
  aliases: v.list(b?.aliases, { max: 20, label: `${label} other names`, item: (a: unknown) => v.str(a, { max: 80, label: 'Other name' }) }) || [],
});
const promptInput = (p: any) => ({
  text: v.str(p?.text, { max: 500, label: 'Question' }), topic: v.str(p?.topic, { max: 80, label: 'Topic' }) || null,
  country: countryOk(p?.country), language: langOk(p?.language),
  tags: v.list(p?.tags, { max: 10, label: 'Tags', item: (t: unknown) => v.str(t, { max: 40, label: 'Tag' }) }),
});
const activePrompts = async (id: number) => (await get('SELECT COUNT(*) n FROM prompts WHERE project_id = ? AND active', id)).n;
async function nextColor(projectId: number) {
  const used = new Set((await all('SELECT color FROM brands WHERE project_id = ?', projectId)).map((r: any) => Number(r.color)));
  for (let i = 2; i <= 9; i++) if (!used.has(i)) return String(i);
  return '9';
}
async function addBrand(projectId: number, { name, domain, aliases = [], is_own = false }: any) {
  const lib = BRAND_LIBRARY.find((b: any) => b.name.toLowerCase() === String(name).toLowerCase());
  return (await get('INSERT INTO brands (project_id, name, domain, aliases, is_own, color) VALUES (?,?,?,?,?,?) RETURNING id',
    projectId, name, domain ?? lib?.domain ?? null, aliases.length ? aliases : lib?.aliases || [], !!is_own, is_own ? '1' : await nextColor(projectId))).id;
}
const addPrompt = (projectId: number, p: any) => run('INSERT INTO prompts (project_id, text, topic, tags, country, language, active) VALUES (?,?,?,?,?,?,?)',
  projectId, p.text.trim(), p.topic || null, p.tags || [], p.country || 'GLOBAL', p.language || 'en', p.active !== false);

async function siteSetting(key: string, fallback: unknown = null) { const r = await get('SELECT value FROM settings WHERE key = ?', key); return r ? r.value : fallback; }

// ---------------------------------------------------------------- sign-in state (the app asks this on every load)
R('GET', '/auth/state', async c => {
  const needsSetup = (await asService(() => get('SELECT COUNT(*) n FROM staff'))).n === 0;
  if (!c.user) return { needsSetup, setupCodeRequired: true, user: null };
  const profile = await get('SELECT full_name, job_title FROM profiles WHERE id = ?', c.user.id);
  const orgs = await all('SELECT o.id, o.name, o.website, o.industry, o.country, o.monthly_budget, o.onboarded_at, m.role FROM org_members m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ? ORDER BY m.created_at', c.user.id);
  return { needsSetup, setupCodeRequired: true, user: { id: c.user.id, email: c.user.email, name: profile?.full_name || c.user.email, jobTitle: profile?.job_title || '', role: c.role || 'client', orgs } };
}, true);

// ---------------------------------------------------------------- the signed-in person and their company (client onboarding)
R('PATCH', '/me', async c => {
  await run('UPDATE profiles SET full_name = ?, job_title = ? WHERE id = ?', v.str(c.body.name, { max: 120, label: 'Your name', required: true }),
    v.str(c.body.jobTitle, { max: 120, label: 'Job title' }) || null, c.user.id);
  return { ok: true };
});
// Onboarding: draft the answers from the company's own website with a cheap model (nothing is saved here).
R('POST', '/orgs/:id/prefill', async c => {
  const org = await get('SELECT id FROM orgs WHERE id = ?', c.params.id); // visible = own company
  if (!org) throw notFound();
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) throw fail('Reading websites is not connected yet. Please fill in the steps yourself.', 503);
  const recent = await asService(() => get("SELECT COUNT(*) n FROM ai_spend WHERE org_id = ? AND kind = 'prefill' AND created_at > now() - interval '1 day'", org.id));
  if (recent.n >= 5) throw fail('The website was read 5 times today. Please fill in the rest yourself, or try again tomorrow.', 429);
  await assertCanSpend(org.id, 0.06); // site read + up to 4 web searches
  const r = await prefillFromWebsite(v.str(c.body.website, { max: 200, label: 'Website', required: true }), key);
  await asService(() => run("INSERT INTO ai_spend (org_id, kind, model, cost, in_tokens, out_tokens) VALUES (?, 'prefill', 'claude-haiku-5-5', ?, ?, ?)",
    org.id, r.cost, r.usage?.input_tokens || 0, r.usage?.output_tokens || 0));
  return { site: r.site, pages: r.pages, wizard: r.wizard };
});
R('PATCH', '/orgs/:id', async c => {
  const org = await get('SELECT id FROM orgs WHERE id = ?', c.params.id); // visible = own company (or the team)
  if (!org) throw notFound();
  const b = c.body;
  await run(`UPDATE orgs SET name = COALESCE(?, name), website = ?, industry = ?, country = ?, onboarded_at = CASE WHEN ? THEN COALESCE(onboarded_at, now()) ELSE onboarded_at END WHERE id = ?`,
    v.str(b.name, { max: 160, label: 'Company name' }) || null, v.str(b.website, { max: 200, label: 'Website' }) || null, v.str(b.industry, { max: 120, label: 'Industry' }) || null,
    v.str(b.country, { max: 60, label: 'Country' }) || null, b.onboarded === true, org.id);
  return { ok: true };
});

// ---------------------------------------------------------------- admin console (team only)
R('GET', '/admin/clients', async c => { staffOnly(c); return all('SELECT * FROM admin_clients ORDER BY name'); });
R('GET', '/admin/clients/:id', async c => {
  staffOnly(c);
  const org = await get('SELECT * FROM admin_clients WHERE id = ?', c.params.id);
  if (!org) throw notFound();
  return {
    org,
    members: await all(`SELECT m.user_id, m.role, m.created_at, p.full_name, p.email, p.job_title FROM org_members m LEFT JOIN profiles p ON p.id = m.user_id WHERE m.org_id = ? ORDER BY m.created_at`, org.id),
    invites: await asService(() => all('SELECT id, email, role, created_at, expires_at FROM invites WHERE org_id = ? AND accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC', org.id)),
    projects: await all(`SELECT p.id, p.name, p.frequency, p.engines, p.last_run_at, (SELECT COUNT(*) FROM prompts q WHERE q.project_id = p.id AND q.active) questions,
      (SELECT COUNT(*) FROM answers a WHERE a.project_id = p.id AND a.error IS NULL) answers FROM projects p WHERE p.org_id = ? ORDER BY p.id`, org.id),
    usage: await all('SELECT * FROM org_usage(?::uuid, 3)', org.id),
    ratings: await all(`SELECT rr.rating, rr.comment, rr.created_at, r.id report_id, r.title, p.full_name, p.email FROM report_ratings rr JOIN reports r ON r.id = rr.report_id
      LEFT JOIN profiles p ON p.id = rr.user_id WHERE rr.org_id = ? ORDER BY rr.created_at DESC`, org.id),
  };
});
// Which team members can see this client. Admins always see every client (admins only).
const teamAccess = (orgId: string) => all(`SELECT s.user_id id, s.role, p.full_name name, p.email,
    (s.role = 'admin' OR EXISTS (SELECT 1 FROM staff_access a WHERE a.user_id = s.user_id AND a.org_id = ?)) "hasAccess"
  FROM staff s LEFT JOIN profiles p ON p.id = s.user_id ORDER BY s.role, p.full_name, p.email`, orgId);
// A client's data API key: create (replaces any old one, shown once), see when it was last used, revoke (admins only).
R('GET', '/admin/clients/:id/api-key', async c => {
  adminOnly(c);
  return (await get('SELECT hint, created_at, last_used_at FROM api_tokens WHERE org_id = ? ORDER BY id DESC LIMIT 1', c.params.id)) || null;
});
R('POST', '/admin/clients/:id/api-key', async c => {
  adminOnly(c);
  if (!(await get('SELECT 1 FROM orgs WHERE id = ?', c.params.id))) throw notFound();
  const key = 'hk_' + newToken().slice(0, 48);
  const hash = await sha256(key);
  await asService(async () => {
    await run('DELETE FROM api_tokens WHERE org_id = ?', c.params.id);
    await run('INSERT INTO api_tokens (org_id, token_hash, hint, created_by) VALUES (?,?,?,?)', c.params.id, hash, key.slice(-4), c.user.id);
  });
  return { key };
});
R('DELETE', '/admin/clients/:id/api-key', async c => {
  adminOnly(c);
  await asService(() => run('DELETE FROM api_tokens WHERE org_id = ?', c.params.id));
  return { ok: true };
});
R('GET', '/admin/clients/:id/team', async c => { adminOnly(c); return teamAccess(c.params.id); });
R('PUT', '/admin/clients/:id/team', async c => {
  adminOnly(c);
  if (!(await get('SELECT 1 FROM orgs WHERE id = ?', c.params.id))) throw notFound();
  const ids = (v.list(c.body.userIds, { max: 500, label: 'Team members' }) || []).map(x => v.str(x, { max: 40, label: 'Team member' }));
  await run('DELETE FROM staff_access WHERE org_id = ?', c.params.id);
  for (const id of new Set(ids)) {
    await run(`INSERT INTO staff_access (user_id, org_id, granted_by) SELECT user_id, ?, ? FROM staff WHERE user_id = ?::uuid AND role = 'member' ON CONFLICT DO NOTHING`, c.params.id, c.user.id, id);
  }
  return teamAccess(c.params.id);
});
R('PATCH', '/admin/clients/:id', async c => {
  staffOnly(c);
  const b = c.body;
  if (b.monthlyBudget !== undefined) await run('UPDATE orgs SET monthly_budget = ? WHERE id = ?', v.num(b.monthlyBudget, { min: 0, max: 100000, label: 'Monthly AI budget' }) ?? 0, c.params.id);
  if (b.fee !== undefined) await run('UPDATE orgs SET fee = ? WHERE id = ?', b.fee === '' || b.fee == null ? null : v.num(b.fee, { min: 0, max: 10_000_000, label: 'Fee' }), c.params.id);
  if (b.currency && ['EUR', 'USD', 'GBP', 'SEK'].includes(b.currency)) await run('UPDATE orgs SET currency = ? WHERE id = ?', b.currency, c.params.id);
  if (b.health !== undefined) {
    const health = v.oneOf(b.health, ['good', 'at_risk', 'churning'], 'Health');
    await run(`INSERT INTO org_health (org_id, health, note, updated_by, updated_at) VALUES (?,?,?,?, now())
      ON CONFLICT (org_id) DO UPDATE SET health = excluded.health, note = excluded.note, updated_by = excluded.updated_by, updated_at = now()`,
    c.params.id, health, v.str(b.healthNote, { max: 2000, label: 'Note' }) || null, c.user.id);
  }
  return { ok: true };
});
// Every answer with its cost, tokens and the AI reader's findings, so the team can check what clients are shown.
R('GET', '/admin/answers', async c => {
  staffOnly(c);
  const p = await projectOr404(c.query.project);
  const limit = 20, offset = Math.max(0, Number(c.query.offset) || 0);
  const where = ['a.project_id = ?'], params: unknown[] = [p.id];
  if (c.query.engine) { where.push('a.engine = ?'); params.push(c.query.engine); }
  if (c.query.flag === 'errors') where.push('a.error IS NOT NULL');
  if (c.query.flag === 'disagree') where.push('x.disagreement');
  if (c.query.flag === 'unread') where.push('x.answer_id IS NULL AND a.error IS NULL');
  const total = (await get(`SELECT COUNT(*) n FROM answers a LEFT JOIN extractions x ON x.answer_id = a.id WHERE ${where.join(' AND ')}`, ...params)).n;
  const rows = await all(`SELECT a.id, a.day, a.engine, a.model, a.text, a.error, a.cost, a.in_tokens, a.out_tokens, a.searches, a.created_at, q.text question, q.country,
      x.data reading, x.dropped, x.disagreement, x.version reader_version, x.model reader_model
    FROM answers a JOIN prompts q ON q.id = a.prompt_id LEFT JOIN extractions x ON x.answer_id = a.id WHERE ${where.join(' AND ')}
    ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  if (rows.length) {
    const marks = rows.map(() => '?').join(',');
    const ms = await all(`SELECT m.answer_id, m.position, m.sentiment, b.name, b.is_own FROM mentions m JOIN brands b ON b.id = m.brand_id WHERE m.answer_id IN (${marks})`, ...rows.map((r: any) => r.id));
    for (const r of rows) r.mentions = ms.filter((m: any) => m.answer_id === r.id);
  }
  return { total, rows, limit, offset };
});
// A client's rating of a report (1-5 and an optional comment).
R('GET', '/reports/:id/rating', async c => (await get('SELECT rating, comment FROM report_ratings WHERE report_id = ? AND user_id = ?', v.id(c.params.id), c.user.id)) || {});
R('PUT', '/reports/:id/rating', async c => {
  const rating = v.num(c.body.rating, { min: 1, max: 5, integer: true, label: 'Rating' });
  if (!rating) throw new InputError('Choose 1 to 5 stars.');
  await run(`INSERT INTO report_ratings (report_id, rating, comment) VALUES (?,?,?)
    ON CONFLICT (report_id, user_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment, created_at = now()`,
  v.id(c.params.id), rating, v.str(c.body.comment, { max: 2000, label: 'Comment' }) || null);
  return { ok: true };
});

// ---------------------------------------------------------------- public: legal details and the contact form
R('GET', '/legal', async () => {
  const info = await asService(() => get('SELECT company FROM site_info WHERE id = 1'));
  const updated = await asService(() => siteSetting('legal_updated', ''));
  return { company: { ...Object.fromEntries(COMPANY_FIELDS.map(k => [k, ''])), country: 'Finland', ...(info?.company || {}) },
    updated: [updated || '', '2026-10-26'].sort().pop(), hostingRegion: 'European Union (Dublin, Ireland)' };
}, true);

R('POST', '/enquiries/new', async c => {
  const b = c.body;
  if (b.website) return { ok: true }; // hidden field filled by a bot: pretend it worked, store nothing
  const clean = (val: unknown, max: number) => (typeof val === 'string' ? val : '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
  const e = { name: clean(b.name, 120), email: clean(b.email, 200).toLowerCase(), company: clean(b.company, 160), role: clean(b.role, 40), markets: clean(b.markets, 200), message: clean(b.message, 3000) };
  if (!e.name) throw fail('Please tell us your name.');
  const lastHour = await asService(() => get("SELECT COUNT(*)::int n FROM enquiries WHERE created_at > now() - interval '1 hour'"));
  if (lastHour.n >= 20) throw fail('We are receiving a lot of messages right now. Please email us instead, or try again in an hour.', 429);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email)) throw fail('Please enter a valid work email.');
  if (!e.company) throw fail('Please tell us your company.');
  if (!b.consent) throw fail('Please tick the box to agree to the privacy policy.');
  await asService(() => run('INSERT INTO enquiries (name, email, company, role, markets, message) VALUES (?,?,?,?,?,?)', e.name, e.email, e.company, e.role, e.markets, e.message));
  return { ok: true };
}, true);

R('GET', '/enquiries', async () => all('SELECT * FROM enquiries ORDER BY id DESC'));
R('PATCH', '/enquiries/:id', async c => {
  staffOnly(c);
  if (!['new', 'contacted', 'won', 'closed'].includes(c.body.status)) throw fail('Unknown status');
  await run('UPDATE enquiries SET status = ? WHERE id = ?', c.body.status, v.id(c.params.id));
  return { ok: true };
});
R('DELETE', '/enquiries/:id', async c => { adminOnly(c); await run('DELETE FROM enquiries WHERE id = ?', v.id(c.params.id)); return { ok: true }; });

// ---------------------------------------------------------------- reference data
R('GET', '/meta', async () => ({
  engines: Object.values(ENGINES).map((e: any) => ({ id: e.id, label: e.label, supported: e.supported, via: e.via, caveat: e.caveat, reason: e.reason, color: e.color })),
  categories: CATEGORIES, countries: COUNTRIES, languages: LANGUAGES, sourceTypes: SOURCE_TYPES,
  brandLibrary: BRAND_LIBRARY.filter((b: any) => b.featured), promptLibrary: PROMPT_LIBRARY, generalPrompts: GENERAL_PROMPTS, mode: 'live',
}));

// ---------------------------------------------------------------- projects
async function projectCard(p: any) {
  const f = M.parseFilter({ days: 30 });
  const s = await M.summary(p.id, f);
  const own = s.brands.find((b: any) => b.is_own);
  const wf = await workflow(p.id);
  const open = await all('SELECT * FROM activities WHERE project_id = ? AND done_at IS NULL ORDER BY due_at IS NULL, due_at', p.id);
  const now = new Date().toISOString();
  return {
    id: p.id, name: p.name, category: p.category, data_mode: p.data_mode, frequency: p.frequency, last_run_at: p.last_run_at, org_id: p.org_id,
    own: own ? { name: own.name, visibility: own.visibility, position: own.position, sentiment: own.sentiment, sov: own.sov, rank: own.rank } : null,
    totalAnswers: s.totalAnswers, stage: wf.stages[wf.current], stageIndex: wf.current, complete: wf.complete,
    competitors: s.brands.filter((b: any) => !b.is_own).length,
    running: !!(await get("SELECT 1 FROM runs WHERE project_id = ? AND status IN ('running','waiting') LIMIT 1", p.id)),
    prevVisibility: own?.prev?.visibility ?? null, fee: p.fee, currency: p.currency || 'EUR',
    spark: own ? (await M.daily(p.id, f)).series.map((d: any) => ({ day: d.day, v: d[`v_${own.id}`] })) : [],
    activities: { open: open.length, overdue: open.filter((a: any) => a.due_at && a.due_at < now).length, next: open[0] || null },
  };
}
R('GET', '/projects', async () => {
  const list = await all('SELECT p.*, o.fee, o.currency FROM projects p JOIN orgs o ON o.id = p.org_id ORDER BY p.id DESC');
  const out = [];
  for (const p of list) out.push(await projectCard(p));
  return out;
});

// The team creates a project for a new client (a new company is created for it), or a client adds one to its company.
R('POST', '/projects', async c => {
  const b = c.body;
  const own = brandInput(v.obj(b.own, { label: 'Brand' }) || {}, 'Brand name');
  if (!own.name) throw new InputError('Please enter the brand name.');
  const name = v.str(b.name, { max: 120, label: 'Project name' }) || own.name;
  const competitors = (v.list(b.competitors, { max: 30, label: 'Competitors' }) || []).map((x: any) => brandInput(x, 'Competitor'));
  const prompts = (v.list(b.prompts, { max: MAX_ACTIVE_PROMPTS, label: 'Questions' }) || []).map(promptInput);
  const countries = (v.list(b.countries, { max: 10, label: 'Countries' }) || ['FI']).filter(countryOk);
  const frequency = v.oneOf(b.frequency, FREQUENCIES, 'Frequency') || 'weekly';
  const discovery = v.obj(b.discovery, { label: 'Discovery notes' }) || {};
  const engines = (v.list(b.engines, { max: 10, label: 'Engines' }) || SUPPORTED_ENGINES).filter((e: string) => (ENGINES as any)[e]?.supported);
  let orgId = b.orgId ? v.str(b.orgId, { max: 40, label: 'Company' }) : null;
  if (!c.role) orgId = (await get('SELECT org_id FROM org_members WHERE user_id = ? LIMIT 1', c.user.id))?.org_id; // a client: always its own company
  else if (!orgId) {
    adminOnly(c); // a new client company: admins only (RLS enforces this too)
    orgId = (await get('INSERT INTO orgs (name, website) VALUES (?, ?) RETURNING id', name, cleanDomain(own.domain))).id;
    await run('INSERT INTO org_health (org_id) VALUES (?)', orgId);
  }
  if (!orgId) throw fail('Your account is not linked to a company.', 403);
  const id = (await get('INSERT INTO projects (org_id, name, category, data_mode, engines, countries, frequency, discovery) VALUES (?,?,?,?,?,?,?,?::jsonb) RETURNING id',
    orgId, name, CATEGORIES[b.category] ? b.category : 'business', 'live', engines.length ? engines : SUPPORTED_ENGINES,
    countries.length ? countries : ['FI'], frequency, JSON.stringify(discovery))).id;
  await addBrand(id, { name: own.name, domain: cleanDomain(own.domain), aliases: own.aliases, is_own: true });
  for (const x of competitors) if (x.name) await addBrand(id, { name: x.name, domain: cleanDomain(x.domain), aliases: x.aliases });
  for (const p of prompts) if (p.text) await addPrompt(id, p);
  return { id };
});

R('GET', '/projects/:id', async c => {
  const p = await projectOr404(c.params.id);
  const org = await get('SELECT fee, currency, monthly_budget, public.org_month_spend(id) spent FROM orgs WHERE id = ?', p.org_id);
  const promptCount = await activePrompts(p.id);
  return { ...p, fee: org?.fee ?? null, currency: org?.currency || 'EUR', brands: await M.brandsOf(p.id), workflow: await workflow(p.id),
    activeRun: await get("SELECT * FROM runs WHERE project_id = ? AND status IN ('running','waiting') ORDER BY id DESC LIMIT 1", p.id) || null,
    lastRun: await get('SELECT * FROM runs WHERE project_id = ? ORDER BY id DESC LIMIT 1', p.id) || null, promptCount,
    budget: { monthly: Number(org?.monthly_budget || 0), spent: Number(org?.spent || 0), runEstimate: promptCount * EST_PER_QUESTION } };
});

R('PATCH', '/projects/:id', async c => {
  const p = await projectOr404(c.params.id);
  const b = c.body;
  const name = v.str(b.name, { max: 120, label: 'Project name' });
  if (name !== undefined) await run('UPDATE projects SET name = ? WHERE id = ?', name || p.name, p.id);
  if (b.category && CATEGORIES[b.category]) await run('UPDATE projects SET category = ? WHERE id = ?', b.category, p.id);
  const engines = v.list(b.engines, { max: 10, label: 'Engines' });
  if (engines) await run('UPDATE projects SET engines = ? WHERE id = ?', engines.filter((e: string) => (ENGINES as any)[e]?.supported), p.id);
  const countries = v.list(b.countries, { max: 10, label: 'Countries' });
  if (countries) await run('UPDATE projects SET countries = ? WHERE id = ?', countries.filter(countryOk), p.id);
  const frequency = v.oneOf(b.frequency, FREQUENCIES, 'Frequency');
  if (frequency) await run('UPDATE projects SET frequency = ? WHERE id = ?', frequency, p.id);
  if (b.fee !== undefined) await run('UPDATE orgs SET fee = ? WHERE id = ?', b.fee === '' || b.fee == null ? null : v.num(b.fee, { min: 0, max: 10_000_000, label: 'Fee' }), p.org_id);
  if (b.currency && ['EUR', 'USD', 'GBP', 'SEK'].includes(b.currency)) await run('UPDATE orgs SET currency = ? WHERE id = ?', b.currency, p.org_id);
  const discovery = v.obj(b.discovery, { label: 'Discovery notes' });
  if (discovery) {
    const merged = { ...p.discovery, ...discovery };
    if (JSON.stringify(merged).length > 50_000) throw new InputError('Discovery notes are too long.');
    await run('UPDATE projects SET discovery = ?::jsonb WHERE id = ?', JSON.stringify(merged), p.id);
  }
  return { ok: true };
});

R('DELETE', '/projects/:id', async c => {
  adminOnly(c);
  const p = await projectOr404(c.params.id);
  if (c.query.confirm !== p.name) throw fail('To delete, type the project name exactly.');
  await run('DELETE FROM projects WHERE id = ?', p.id);
  return { ok: true };
});

R('POST', '/projects/:id/go-live', async c => {
  adminOnly(c);
  const p = await projectOr404(c.params.id);
  if (c.body.confirm !== true) throw fail('Please confirm.');
  c.after.push(() => asService(async () => {
    await run('DELETE FROM answers WHERE project_id = ? AND simulated', p.id);
    await run('DELETE FROM runs WHERE project_id = ? AND simulated', p.id);
    await run('DELETE FROM reports WHERE project_id = ? AND simulated', p.id);
    await run('DELETE FROM action_status WHERE project_id = ?', p.id);
    await run("UPDATE projects SET data_mode = 'live', last_run_at = NULL WHERE id = ?", p.id);
  }));
  return { ok: true, backup: 'Supabase daily backup' };
});

// ---------------------------------------------------------------- activities (your team's tasks per client)
R('GET', '/projects/:id/activities', async c => {
  const p = await projectOr404(c.params.id);
  return all('SELECT * FROM activities WHERE project_id = ? ORDER BY done_at IS NOT NULL, due_at IS NULL, due_at, id', p.id);
});
R('POST', '/projects/:id/activities', async c => {
  staffOnly(c);
  const p = await projectOr404(c.params.id);
  const title = v.str(c.body.title, { max: 200, label: 'Activity name' });
  if (!title) throw new InputError('Give the activity a short name.');
  const type = ACTIVITY_TYPES.includes(c.body.type) ? c.body.type : 'task';
  const due = c.body.due_at ? new Date(v.str(c.body.due_at, { max: 40, label: 'Date' })) : null;
  if (due && isNaN(due.getTime())) throw new InputError('That date is not valid.');
  return get('INSERT INTO activities (org_id, project_id, type, title, due_at, note) VALUES (?,?,?,?,?,?) RETURNING *',
    p.org_id, p.id, type, title, due ? due.toISOString() : null, v.str(c.body.note, { max: 2000, label: 'Note' }) || null);
});
R('PATCH', '/activities/:id', async c => {
  staffOnly(c);
  const a = await get('SELECT * FROM activities WHERE id = ?', v.id(c.params.id));
  if (!a) throw notFound();
  const b = c.body;
  let due = a.due_at;
  if (b.due_at !== undefined) {
    const d = b.due_at ? new Date(v.str(b.due_at, { max: 40, label: 'Date' })) : null;
    if (d && isNaN(d.getTime())) throw new InputError('That date is not valid.');
    due = d ? d.toISOString() : null;
  }
  return get('UPDATE activities SET title = ?, type = ?, due_at = ?, note = ?, done_at = ? WHERE id = ? RETURNING *',
    v.str(b.title, { max: 200, label: 'Activity name' }) || a.title, ACTIVITY_TYPES.includes(b.type) ? b.type : a.type, due,
    b.note === undefined ? a.note : v.str(b.note, { max: 2000, label: 'Note' }) || null,
    b.done === undefined ? a.done_at : b.done ? new Date().toISOString() : null, a.id);
});
R('DELETE', '/activities/:id', async c => { staffOnly(c); await run('DELETE FROM activities WHERE id = ?', v.id(c.params.id)); return { ok: true }; });

// ---------------------------------------------------------------- runs (AI checks move to the pipeline functions next)
R('POST', '/projects/:id/run', async c => startRun(await projectOr404(c.params.id), c.user.id));
R('GET', '/projects/:id/runs', async c => all('SELECT * FROM runs WHERE project_id = ? ORDER BY id DESC LIMIT 20', v.id(c.params.id)));
// A check and each of its questions: waiting, answered (with what was found) or failed. Polled by the progress screen.
R('GET', '/runs/:id', async c => {
  const r = await get('SELECT * FROM runs WHERE id = ?', v.id(c.params.id));
  if (!r) throw notFound();
  if (r.status === 'running') await resumeIfStalled(r.id);
  const items = await all(`SELECT q.id, q.text, a.id answer_id, a.error, a.searches, x.answer_id IS NOT NULL AS read,
      (SELECT COUNT(*) FROM citations s WHERE s.answer_id = a.id) sources,
      (SELECT COALESCE(json_agg(json_build_object('name', b.name, 'own', b.is_own, 'rank', m.position, 'sentiment', m.sentiment) ORDER BY b.is_own DESC, m.position NULLS LAST), '[]')
         FROM mentions m JOIN brands b ON b.id = m.brand_id WHERE m.answer_id = a.id) brands
    FROM prompts q LEFT JOIN answers a ON a.prompt_id = q.id AND a.run_id = ? LEFT JOIN extractions x ON x.answer_id = a.id
    WHERE q.project_id = ? AND (a.id IS NOT NULL OR (q.active AND q.created_at <= ?)) ORDER BY a.created_at NULLS LAST, q.id`, r.id, r.project_id, r.started_at);
  return { ...r, items };
});

// ---------------------------------------------------------------- AI readiness: website check and fact check
const latestSiteCheck = async (id: number) => { const r = await get('SELECT * FROM site_checks WHERE project_id = ? ORDER BY id DESC LIMIT 1', id); return r ? { ...r, results: parseJSON(r.results, {}) } : null; };
R('GET', '/projects/:id/site-check', async c => {
  const p = await projectOr404(c.params.id);
  const own = (await M.brandsOf(p.id)).find((b: any) => b.is_own);
  return { domain: own?.domain || null, latest: await latestSiteCheck(p.id) };
});
// Only the website saved for the client's own brand can be checked: no free-typed addresses. One check a minute.
R('POST', '/projects/:id/site-check', async c => {
  const p = await projectOr404(c.params.id);
  const domain = (await M.brandsOf(p.id)).find((b: any) => b.is_own)?.domain;
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new InputError("Add the brand's website on the Competitors page first (e.g. example.com).");
  if (await get("SELECT 1 FROM site_checks WHERE project_id = ? AND created_at > now() - interval '1 minute'", p.id)) throw fail('The website was just checked. Please wait a minute before checking again.', 429);
  const result = await runSiteCheck(`https://${domain}`);
  // Check results are system rows (read-only for people), saved once projectOr404 has confirmed access.
  await asService(() => run('INSERT INTO site_checks (project_id, url, score, results) VALUES (?,?,?,?::jsonb)', p.id, result.url, result.score, JSON.stringify(result)));
  return latestSiteCheck(p.id);
});
R('GET', '/projects/:id/facts', async c => factReport((await projectOr404(c.params.id)).id));
R('POST', '/projects/:id/facts', async c => {
  const p = await projectOr404(c.params.id);
  const text = v.str(c.body.text, { max: 300, label: 'Fact', required: true });
  if ((await get('SELECT COUNT(*) n FROM project_facts WHERE project_id = ?', p.id)).n >= MAX_FACTS) throw new InputError(`A project can have at most ${MAX_FACTS} facts.`);
  await run('INSERT INTO project_facts (project_id, text) VALUES (?,?)', p.id, text);
  return factReport(p.id);
});
R('DELETE', '/facts/:id', async c => {
  const f = await get('SELECT * FROM project_facts WHERE id = ?', v.id(c.params.id));
  if (!f) throw notFound();
  await run('DELETE FROM project_facts WHERE id = ?', f.id);
  return factReport(f.project_id);
});
R('POST', '/projects/:id/facts/check', async c => checkFacts(await projectOr404(c.params.id)));

// ---------------------------------------------------------------- Optimise
R('GET', '/projects/:id/optimise', async c => optimiseView((await projectOr404(c.params.id)).id));
R('PUT', '/projects/:id/profile', async c => {
  const p = await projectOr404(c.params.id);
  const before = (await get('SELECT data FROM brand_profiles WHERE project_id = ?', p.id))?.data?.notConfusedWith || '';
  const saved = await saveProfile(p.id, v.obj(c.body, { maxBytes: 20_000, label: 'Profile' }) || {});
  // A new "Not to be confused with" changes which answers count as mentions: recount history (look-alike filter).
  if ((saved.notConfusedWith || '') !== before) recount(c, p.id);
  return optimiseView(p.id);
});
R('POST', '/projects/:id/drafts', async c => ({ id: await writeDraft(await projectOr404(c.params.id), c.body || {}) }));
R('DELETE', '/drafts/:id', async c => {
  const d = await get('SELECT * FROM drafts WHERE id = ?', v.id(c.params.id)); // visible = allowed to remove
  if (!d) throw notFound();
  c.after.push(() => asService(() => run('DELETE FROM drafts WHERE id = ?', d.id)));
  return { ...(await optimiseView(d.project_id)), drafts: (await optimiseView(d.project_id)).drafts.filter((x: any) => x.id !== d.id) };
});

// ---------------------------------------------------------------- brands and suggestions
const recount = (c: Ctx, projectId: number) => c.after.push(() => asService(() => reanalyzeProject(projectId)));
R('POST', '/projects/:id/brands', async c => {
  const p = await projectOr404(c.params.id);
  const input = brandInput(c.body, 'Brand name');
  if (!input.name) throw new InputError('Please enter a name.');
  const existing = await M.brandsOf(p.id);
  if (existing.some((b: any) => b.name.toLowerCase() === input.name!.toLowerCase())) throw fail('That brand is already tracked.');
  if (existing.length >= 40) throw new InputError('A project can track at most 40 brands.');
  const id = await addBrand(p.id, { name: input.name, domain: cleanDomain(input.domain), aliases: input.aliases });
  recount(c, p.id);
  return { id };
});
R('PATCH', '/brands/:id', async c => {
  const b = await get('SELECT * FROM brands WHERE id = ?', v.id(c.params.id));
  if (!b) throw notFound();
  const input = brandInput(c.body, 'Brand name');
  await run('UPDATE brands SET name = ?, domain = ?, aliases = ? WHERE id = ?', input.name || b.name,
    c.body.domain !== undefined ? cleanDomain(input.domain) : b.domain, c.body.aliases !== undefined ? input.aliases.filter(Boolean) : b.aliases, b.id);
  recount(c, b.project_id);
  return { ok: true };
});
R('DELETE', '/brands/:id', async c => {
  const b = await get('SELECT * FROM brands WHERE id = ?', v.id(c.params.id));
  if (!b) throw notFound();
  if (b.is_own) throw fail('You cannot remove the project\'s own brand.');
  await run('DELETE FROM brands WHERE id = ?', b.id);
  recount(c, b.project_id);
  return { ok: true };
});
R('GET', '/projects/:id/suggestions', async c => M.suggestions((await projectOr404(c.params.id)).id, M.parseFilter(c.query)));
R('POST', '/projects/:id/suggestions/dismiss', async c => {
  const p = await projectOr404(c.params.id);
  const list = new Set(p.discovery.dismissedSuggestions || []);
  const name = v.str(c.body.name, { max: 120, label: 'Name', required: true });
  if (list.size >= 500) throw new InputError('Too many hidden suggestions.');
  list.add(name);
  await run('UPDATE projects SET discovery = ?::jsonb WHERE id = ?', JSON.stringify({ ...p.discovery, dismissedSuggestions: [...list] }), p.id);
  return { ok: true };
});

// ---------------------------------------------------------------- questions
R('GET', '/projects/:id/prompts', async c => M.promptTable((await projectOr404(c.params.id)).id, M.parseFilter(c.query)));
R('POST', '/projects/:id/prompts', async c => {
  const p = await projectOr404(c.params.id);
  const b = c.body;
  const raw = v.list(b.items, { max: 200, label: 'Questions' }) || v.str(b.text, { max: 50_000, label: 'Questions' })?.split('\n').map((text: string) => ({ text })) || [];
  if (raw.length > 200) throw new InputError('Add at most 200 questions at a time.');
  const shared = promptInput({ text: 'x', topic: b.topic, country: b.country, language: b.language, tags: b.tags });
  const lines = raw.map((l: any) => promptInput({ ...l, text: l?.text, topic: l?.topic ?? b.topic, country: l?.country ?? b.country, language: l?.language ?? b.language, tags: l?.tags ?? b.tags })).filter((x: any) => x.text);
  if (!lines.length) throw fail('Type at least one question (one per line).');
  if (await activePrompts(p.id) + lines.length > MAX_ACTIVE_PROMPTS) throw new InputError(`A project can have at most ${MAX_ACTIVE_PROMPTS} active questions.`);
  const existing = new Set((await all('SELECT text FROM prompts WHERE project_id = ?', p.id)).map((r: any) => r.text.toLowerCase()));
  let added = 0;
  for (const l of lines) {
    if (existing.has(l.text!.trim().toLowerCase())) continue;
    await addPrompt(p.id, { text: l.text, topic: l.topic ?? shared.topic, country: l.country ?? shared.country, language: l.language ?? shared.language, tags: l.tags ?? shared.tags ?? [] });
    added++;
  }
  return { added, skipped: lines.length - added };
});
R('PATCH', '/prompts/:id', async c => {
  const p = await get('SELECT * FROM prompts WHERE id = ?', v.id(c.params.id));
  if (!p) throw notFound();
  const b = promptInput(c.body);
  if (c.body.active && !p.active && await activePrompts(p.project_id) >= MAX_ACTIVE_PROMPTS) throw new InputError(`A project can have at most ${MAX_ACTIVE_PROMPTS} active questions.`);
  await run('UPDATE prompts SET text = ?, topic = ?, tags = ?, country = ?, language = ?, active = ? WHERE id = ?',
    b.text || p.text, c.body.topic !== undefined ? b.topic : p.topic, b.tags || p.tags, b.country ?? p.country, b.language ?? p.language,
    c.body.active === undefined ? p.active : !!c.body.active, p.id);
  return { ok: true };
});
R('POST', '/projects/:id/prompts/bulk', async c => {
  const p = await projectOr404(c.params.id);
  const ids = (v.list(c.body.ids, { max: 1000, label: 'Selection' }) || []).map(v.id);
  if (!ids.length) throw fail('Select at least one question.');
  if (c.body.action === 'resume' && await activePrompts(p.id) + ids.length > MAX_ACTIVE_PROMPTS) throw new InputError(`A project can have at most ${MAX_ACTIVE_PROMPTS} active questions.`);
  const marks = ids.map(() => '?').join(',');
  if (c.body.action === 'pause') await run(`UPDATE prompts SET active = false WHERE project_id = ? AND id IN (${marks})`, p.id, ...ids);
  else if (c.body.action === 'resume') await run(`UPDATE prompts SET active = true WHERE project_id = ? AND id IN (${marks})`, p.id, ...ids);
  else if (c.body.action === 'delete') {
    if (c.body.confirm !== true) throw fail('Please confirm deletion.');
    await run(`DELETE FROM prompts WHERE project_id = ? AND id IN (${marks})`, p.id, ...ids);
  } else if (c.body.action === 'tag') {
    const tag = v.str(c.body.tag, { max: 40, label: 'Tag' });
    if (tag) await run(`UPDATE prompts SET tags = (SELECT array_agg(DISTINCT t) FROM unnest(array_append(tags, ?)) t) WHERE project_id = ? AND id IN (${marks})`, tag, p.id, ...ids);
  } else throw fail('Unknown action');
  return { ok: true };
});

// ---------------------------------------------------------------- metrics
const metric = (fnc: (p: any, f: any, c: Ctx) => Promise<unknown>) => async (c: Ctx) => { const p = await projectOr404(c.params.id); return fnc(p, M.parseFilter(c.query), c); };
R('GET', '/projects/:id/summary', metric((p, f) => M.summary(p.id, f)));
R('GET', '/projects/:id/daily', metric((p, f) => M.daily(p.id, f)));
R('GET', '/projects/:id/engines', metric((p, f) => M.perEngine(p.id, f)));
R('GET', '/projects/:id/countries', metric((p, f) => M.visibilityByCountry(p.id, f)));
R('GET', '/projects/:id/sources', metric((p, f) => M.sources(p.id, f)));
R('GET', '/projects/:id/chats', metric((p, f, c) => M.chats(p.id, { ...f, promptId: Number(c.query.prompt) || undefined }, {
  limit: Math.min(100, Math.max(1, Math.floor(Number(c.query.limit)) || 20)), offset: Math.min(1e6, Math.max(0, Math.floor(Number(c.query.offset)) || 0)),
  brandId: Number(c.query.brand) || null, q: typeof c.query.q === 'string' ? c.query.q.slice(0, 200) : '',
})));
R('GET', '/projects/:id/filters', async c => {
  const id = (await projectOr404(c.params.id)).id;
  return {
    tags: (await all('SELECT DISTINCT unnest(tags) t FROM prompts WHERE project_id = ? ORDER BY 1', id)).map((r: any) => r.t),
    topics: (await all('SELECT DISTINCT topic FROM prompts WHERE project_id = ? AND topic IS NOT NULL ORDER BY topic', id)).map((r: any) => r.topic),
    countries: (await all('SELECT DISTINCT country FROM prompts WHERE project_id = ? ORDER BY country', id)).map((r: any) => r.country),
    engines: (await all('SELECT DISTINCT engine FROM answers WHERE project_id = ?', id)).map((r: any) => r.engine),
  };
});

// ---------------------------------------------------------------- actions
R('GET', '/projects/:id/actions', metric((p, f) => computeActions(p.id, f)));
R('POST', '/projects/:id/actions', async c => {
  const p = await projectOr404(c.params.id);
  if (!['open', 'planned', 'done', 'dismissed'].includes(c.body.status)) throw fail('Unknown status');
  const key = v.str(c.body.key, { max: 200, label: 'Action', required: true });
  const title = v.str(c.body.title, { max: 300, label: 'Title' });
  const note = v.str(c.body.note, { max: 2000, label: 'Note' });
  await run(`INSERT INTO action_status (project_id, key, title, status, note, updated_at) VALUES (?,?,?,?,?, now())
    ON CONFLICT (project_id, key) DO UPDATE SET status = excluded.status, note = COALESCE(excluded.note, action_status.note), updated_at = now()`,
  p.id, key, title || key, c.body.status, note ?? null);
  return { ok: true };
});

// ---------------------------------------------------------------- work log: actions taken and their measured effect
// The client and our team both log work here (the one client area the team may write to).
R('GET', '/projects/:id/interventions', async c => workLog((await projectOr404(c.params.id)).id));
R('POST', '/projects/:id/interventions', async c => {
  const p = await projectOr404(c.params.id);
  return { id: await createIntervention(p.id, interventionInput(c.body, p)) };
});
R('PATCH', '/interventions/:id', async c => {
  const row = await get('SELECT project_id FROM interventions WHERE id = ?', v.id(c.params.id));
  if (!row) throw notFound();
  await updateIntervention(v.id(c.params.id), interventionInput(c.body, await projectOr404(row.project_id), { partial: true }));
  return { ok: true };
});
R('DELETE', '/interventions/:id', async c => {
  const n = await all('DELETE FROM interventions WHERE id = ? RETURNING id', v.id(c.params.id));
  if (!n.length) throw notFound();
  return { ok: true };
});
// What works across every client: the dataset (team only).
R('GET', '/admin/learnings', async c => {
  staffOnly(c);
  return { kinds: KINDS, windowDays: WINDOW_DAYS, rows: await all('SELECT * FROM intervention_learnings ORDER BY actions DESC, avg_change_pts DESC NULLS LAST') };
});

// ---------------------------------------------------------------- outreach: websites AI cites where the client is missing
// The client and the team both work this list (like the Work log).
const outreachOr404 = async (id: unknown) => (await get('SELECT * FROM outreach WHERE id = ?', v.id(id))) || Promise.reject(notFound());
R('GET', '/projects/:id/outreach', async c => outreachView((await projectOr404(c.params.id)).id, M.parseFilter(c.query)));
R('POST', '/projects/:id/outreach', async c => {
  const p = await projectOr404(c.params.id);
  await addTarget(p.id, c.body.domain);
  return outreachView(p.id, M.parseFilter(c.query));
});
R('PUT', '/outreach/:id', async c => {
  const row = await outreachOr404(c.params.id);
  await updateTarget(row.id, v.obj(c.body, { maxBytes: 10_000, label: 'Outreach' }) || {});
  return outreachView(row.project_id, M.parseFilter(c.query));
});
R('DELETE', '/outreach/:id', async c => {
  const row = await outreachOr404(c.params.id);
  await run('DELETE FROM outreach WHERE id = ?', row.id);
  return outreachView(row.project_id, M.parseFilter(c.query));
});
R('POST', '/outreach/:id/email', async c => {
  const row = await outreachOr404(c.params.id);
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) throw fail('Email drafts are not connected yet.', 503);
  return draftEmail(row.id, key);
});

// ---------------------------------------------------------------- Ask Housedge: chat over one client's data (read-only)
R('POST', '/projects/:id/assistant', async c => {
  const p = await projectOr404(c.params.id);
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) throw fail('Ask Housedge is not connected yet.', 503);
  const r = await askAssistant(p, c.body.messages, { apiKey: key, userId: c.user.id });
  return { reply: r.reply, toolsUsed: [...new Set(r.toolsUsed)], cost: Math.round(r.cost * 10000) / 10000 };
});

// ---------------------------------------------------------------- schedule (called every hour by the database's pg_cron)
// Only the database knows the secret (kept in Supabase Vault and as the CRON_SECRET function secret). Each tick:
// resumes checks that stopped (time limit) and starts due checks, each through the same spending locks as Run now.
// Projects are scheduled only after their first check was started by a person, so nothing spends by surprise.
R('POST', '/cron/tick', async c => {
  const secret = Deno.env.get('CRON_SECRET') || '';
  if (secret.length < 32 || !sameSecret(String(c.body?.secret || ''), secret)) throw notFound();
  const stalled = await asService(() => all("SELECT id FROM runs WHERE status = 'running' AND (heartbeat_at IS NULL OR heartbeat_at < now() - interval '3 minutes') ORDER BY id LIMIT 10"));
  for (const r of stalled) await resumeIfStalled(r.id);
  const due = await asService(() => all(`SELECT p.id FROM projects p WHERE p.frequency IN ('daily', 'every3', 'weekly') AND p.data_mode = 'live'
      AND p.last_run_at IS NOT NULL AND p.last_run_at < now() - (CASE p.frequency WHEN 'daily' THEN interval '1 day' WHEN 'every3' THEN interval '3 days' ELSE interval '7 days' END)
      AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.project_id = p.id AND r.status = 'running')
    ORDER BY p.last_run_at LIMIT 2`));
  const started = [], skipped = [];
  for (const d of due) {
    try { started.push((await asService(async () => startRun(await getProject(d.id), null, 'scheduled'))).runId); }
    catch (e: any) { skipped.push({ project: d.id, reason: String(e?.message || e).slice(0, 120) }); }
  }
  return { resumed: stalled.length, started, skipped };
}, true);

// ---------------------------------------------------------------- reports
R('GET', '/projects/:id/reports', async c => listReports((await projectOr404(c.params.id)).id));
R('POST', '/projects/:id/reports', async c => {
  staffOnly(c);
  const p = await projectOr404(c.params.id);
  return { id: await createReport(p.id, { days: v.num(c.body.days, { min: 1, max: 365, integer: true, label: 'Days' }) || 30, title: v.str(c.body.title, { max: 200, label: 'Title' }) }) };
});
R('GET', '/reports-batch', async c => {
  const out = [];
  for (const id of String(c.query.ids || '').split(',').slice(0, 50).map(Number).filter(Boolean)) {
    const r = await getReport(id);
    if (!r) continue;
    const own = r.data.summary?.brands?.find((b: any) => b.is_own);
    out.push({ id, period_end: r.period_end, own: own && { visibility: own.visibility, sov: own.sov, position: own.position, sentiment: own.sentiment }, actionsDone: r.data.actionsDone?.length || 0 });
  }
  return out;
});
R('GET', '/reports/:id', async c => (await getReport(v.id(c.params.id))) || Promise.reject(notFound()));
R('DELETE', '/reports/:id', async c => { staffOnly(c); await run('DELETE FROM reports WHERE id = ?', v.id(c.params.id)); return { ok: true }; });
R('GET', '/projects/:id/workflow', async c => workflow((await projectOr404(c.params.id)).id));

// ---------------------------------------------------------------- CSV exports
const csvCell = (x: unknown) => {
  if (x == null) return '';
  const s = String(x);
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s; // stops spreadsheet formula injection
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csv = (rows: any[], cols: string[]) => [cols.join(','), ...rows.map(r => cols.map(k => csvCell(r[k])).join(','))].join('\n') + '\n';
async function exportData(p: any, kind: string, f: any) {
  const sim = p.data_mode !== 'live' ? 'yes' : 'no';
  if (kind === 'summary') {
    const s = await M.summary(p.id, f);
    return csv(s.brands.map((b: any) => ({ ...b, project: p.name, from: f.from, to: f.to, simulated: sim, own: b.is_own ? 'yes' : 'no' })), ['project', 'from', 'to', 'name', 'own', 'visibility', 'position', 'sentiment', 'sov', 'mentions', 'rank', 'simulated']);
  }
  if (kind === 'daily') {
    const d = await M.daily(p.id, f);
    return csv(d.series.flatMap((day: any) => d.brands.map((b: any) => ({ day: day.day, brand: b.name, own: b.is_own ? 'yes' : 'no', answers: day.total,
      visibility: day[`v_${b.id}`], share_of_voice: day[`s_${b.id}`], position: day[`p_${b.id}`], sentiment: day[`t_${b.id}`], simulated: sim }))), ['day', 'brand', 'own', 'answers', 'visibility', 'share_of_voice', 'position', 'sentiment', 'simulated']);
  }
  if (kind === 'answers') {
    const af = M.answerFilter(p.id, f);
    const rows = (await all(`SELECT a.id, a.day, a.engine, a.model, p.text question, p.country, p.language, p.topic, a.text answer, a.simulated,
      (SELECT string_agg(b.name || ' #' || COALESCE(m.position::text, '-'), '; ') FROM mentions m JOIN brands b ON b.id = m.brand_id WHERE m.answer_id = a.id) brands,
      (SELECT string_agg(url, ' ') FROM citations c WHERE c.answer_id = a.id) sources
      FROM answers a JOIN prompts p ON p.id = a.prompt_id WHERE a.id IN (${af.sql}) ORDER BY a.day, a.id`, ...af.params)).map((r: any) => ({ ...r, simulated: r.simulated ? 'yes' : 'no' }));
    return csv(rows, ['id', 'day', 'engine', 'model', 'question', 'country', 'language', 'topic', 'brands', 'sources', 'answer', 'simulated']);
  }
  if (kind === 'sources') return csv((await M.sources(p.id, f, 1000)).domains.map((d: any) => ({ ...d, simulated: sim })), ['domain', 'label', 'answers', 'share', 'citations', 'with_own', 'simulated']);
  if (kind === 'prompts') return csv((await M.promptTable(p.id, f)).map((r: any) => ({ ...r, tags: r.tags.join('|'), top_brand: r.topBrand?.name, active: r.active ? 'yes' : 'no', simulated: sim })),
    ['id', 'text', 'topic', 'tags', 'country', 'language', 'active', 'answers', 'visibility', 'position', 'sentiment', 'top_brand', 'simulated']);
  throw fail('Unknown export type');
}
R('GET', '/projects/:id/export/:kind', async c => {
  const p = await projectOr404(c.params.id);
  const body = await exportData(p, c.params.kind, M.parseFilter(c.query));
  return new Response('﻿' + body, { headers: { 'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${p.data_mode !== 'live' ? 'SIMULATED-DATA-' : ''}${p.name.replace(/[^a-z0-9]+/gi, '-')}-${c.params.kind}.csv"` } });
});

// Data API for Google Sheets / Looker Studio: a key in the address, because IMPORTDATA cannot send headers.
// Data API (Google Sheets, Looker Studio…): each key belongs to ONE client and opens only that client's projects.
// Keys are stored as a sha-256 fingerprint; the key itself is shown once when an admin creates it.
const v1Org = async (c: Ctx): Promise<string> => {
  const t = c.query.key;
  if (typeof t !== 'string' || !/^hk_[0-9a-f]{48}$/.test(t)) throw fail('Missing or wrong API key. Ask your Housedge contact for your data API key.', 401);
  const hash = await sha256(t);
  const row = await asService(() => get('UPDATE api_tokens SET last_used_at = now() WHERE token_hash = ? RETURNING org_id', hash));
  if (!row) throw fail('Missing or wrong API key. Ask your Housedge contact for your data API key.', 401);
  return row.org_id;
};
const v1Project = async (orgId: string, id: unknown) => {
  const p = await projectOr404(id);
  if (p.org_id !== orgId) throw notFound(); // another client's project: same answer as "does not exist"
  return p;
};
R('GET', '/v1/projects', async c => {
  const orgId = await v1Org(c);
  return asService(async () => (await all('SELECT id, name, category, data_mode FROM projects WHERE org_id = ? ORDER BY id', orgId)).map((p: any) => ({ ...p, simulated: p.data_mode !== 'live' })));
}, true);
R('GET', '/v1/projects/:id/summary', async c => {
  const orgId = await v1Org(c);
  return asService(async () => { const p = await v1Project(orgId, c.params.id); return { project: p.name, simulated: p.data_mode !== 'live', ...(await M.summary(p.id, M.parseFilter(c.query))) }; });
}, true);
R('GET', '/v1/projects/:id/:kind.csv', async c => {
  const orgId = await v1Org(c);
  const body = await asService(async () => exportData(await v1Project(orgId, c.params.id), c.params.kind, M.parseFilter(c.query)));
  return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
}, true);

// ---------------------------------------------------------------- settings, costs (team only; AI keys live in function secrets)
async function settingsView(isAdmin: boolean) {
  const prices = (await siteSetting('prices', {})) || {};
  const engines = [];
  for (const e of Object.values(ENGINES).filter((x: any) => x.supported) as any[]) {
    const key = Deno.env.get(e.secret);
    engines.push({ id: e.id, label: e.label, via: e.via, caveat: e.caveat, connected: !!key, keyHint: key && isAdmin ? `…${key.slice(-4)}` : null, fromEnv: !!key,
      model: e.id === 'claude' ? RUN_MODEL : e.defaultModel, secret: isAdmin ? e.secret : null, defaultModel: e.defaultModel, price: { ...e.price, ...(prices[e.id] || {}) }, perAnswer: estimateAnswerCost(e.id, prices) });
  }
  const month = await get(`SELECT COALESCE((SELECT SUM(cost) FROM answers WHERE created_at >= date_trunc('month', now())), 0)
    + COALESCE((SELECT SUM(cost) FROM ai_spend WHERE created_at >= date_trunc('month', now())), 0) s`);
  const byEngine = await all("SELECT engine, COUNT(*) answers, COALESCE(SUM(cost), 0) cost FROM answers WHERE NOT simulated AND created_at >= date_trunc('month', now()) GROUP BY engine");
  const info = await get('SELECT company FROM site_info WHERE id = 1');
  return {
    mode: 'live', monthly_cap: Number((await siteSetting('monthly_cap', 0)) || 0), trial_daily_cap: Number((await siteSetting('trial_daily_cap', 0)) || 0), run_hour_utc: Number((await siteSetting('run_hour_utc', 5)) ?? 5),
    company: { ...Object.fromEntries(COMPANY_FIELDS.map(k => [k, ''])), country: 'Finland', ...(info?.company || {}) },
    hosting_region: 'European Union (Dublin, Ireland)', engines, spend: month.s, spendByEngine: byEngine,
  };
}
const setSetting = (k: string, val: unknown) => run('INSERT INTO settings (key, value) VALUES (?, ?::jsonb) ON CONFLICT (key) DO UPDATE SET value = excluded.value', k, JSON.stringify(val));
R('GET', '/settings', async c => { staffOnly(c); return settingsView(c.role === 'admin'); });
R('PATCH', '/settings', async c => {
  adminOnly(c);
  const b = c.body;
  if (b.company) {
    const info = await get('SELECT company FROM site_info WHERE id = 1');
    const merged = { ...(info?.company || {}), ...Object.fromEntries(COMPANY_FIELDS.filter(k => b.company[k] !== undefined).map(k => [k, String(b.company[k]).trim().slice(0, 300)])) };
    await run('UPDATE site_info SET company = ?::jsonb, updated_at = now() WHERE id = 1', JSON.stringify(merged));
    await setSetting('legal_updated', new Date().toISOString().slice(0, 10));
  }
  if (b.monthly_cap !== undefined) await setSetting('monthly_cap', v.num(b.monthly_cap, { min: 0, max: 100_000, label: 'Monthly cap' }) || 0);
  if (b.trial_daily_cap !== undefined) await setSetting('trial_daily_cap', v.num(b.trial_daily_cap, { min: 0, max: 10_000, label: 'Trial daily cap' }) || 0);
  if (b.run_hour_utc !== undefined) await setSetting('run_hour_utc', v.num(b.run_hour_utc, { min: 0, max: 23, integer: true, label: 'Run hour' }) || 0);
  for (const e of Object.values(ENGINES).filter((x: any) => x.supported) as any[]) {
    if (b.keys?.[e.id]) throw new InputError('AI keys are now kept as server secrets, not in the app. Ask your developer to set them in Supabase.');
    const m = v.str(b.models?.[e.id], { max: 100, label: `${e.label} model` });
    if (m !== undefined) {
      if (m && !/^[A-Za-z0-9._:/-]+$/.test(m)) throw new InputError(`${e.label} model name is not valid.`);
      await setSetting(e.modelSetting, m || null);
    }
    const pr = b.prices?.[e.id];
    if (pr) {
      v.obj(pr, { maxBytes: 1000, label: 'Prices' });
      const allowed = ['inPerM', 'outPerM', 'perSearch', 'typicalIn', 'typicalOut', 'typicalSearches'];
      const prices = (await siteSetting('prices', {})) || {};
      prices[e.id] = Object.fromEntries(Object.entries(pr).filter(([k2, val]) => allowed.includes(k2) && val !== '' && val != null).map(([k2, val]) => [k2, v.num(val, { min: 0, max: 1_000_000, label: 'Price' })]));
      await setSetting('prices', prices);
    }
  }
  return settingsView(true);
});
// A tiny real request to check a connected engine works (admins; counts toward the platform cap only).
R('POST', '/settings/test/:engine', async c => {
  adminOnly(c);
  const e = (ENGINES as any)[c.params.engine];
  if (!e?.supported) throw notFound();
  const key = Deno.env.get(e.secret);
  if (!key) throw fail(`${e.label} is not connected. Set the ${e.secret} secret in Supabase.`, 400);
  if (c.params.engine !== 'claude') throw fail(`${e.label} answers are being connected; the key is stored.`, 400);
  const t0 = Date.now();
  const r = await new Anthropic({ apiKey: key, timeout: 30_000, maxRetries: 0 }).messages.create({ model: RUN_MODEL, max_tokens: 30, messages: [{ role: 'user', content: 'Reply with: Housedge connection OK' }] })
    .catch((x: any) => { throw fail(`Claude said: ${String(x?.message || x).replaceAll(key, '[key]')}`.slice(0, 300), 400); });
  await asService(() => run("INSERT INTO ai_spend (kind, model, cost, in_tokens, out_tokens) VALUES ('engine_test', ?, ?, ?, ?)", r.model, ((r.usage?.input_tokens || 0) * 2 + (r.usage?.output_tokens || 0) * 10) / 1e6, r.usage?.input_tokens || 0, r.usage?.output_tokens || 0));
  return { ms: Date.now() - t0, model: r.model, text: r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''), citations: [] };
});
R('POST', '/backup', async c => { adminOnly(c); return { file: 'Backups are made automatically by Supabase every day.' }; });
R('GET', '/costs/estimate', async c => {
  staffOnly(c);
  const prices = (await siteSetting('prices', {})) || {};
  const runsPerMonth: Record<string, number> = { daily: 30, every3: 10, weekly: 4.3, manual: 1 };
  const projects = [];
  for (const p of await all('SELECT * FROM projects ORDER BY id')) {
    const prompts = await activePrompts(p.id);
    const engines = parseJSON(p.engines, []).filter((e: string) => (ENGINES as any)[e]?.supported);
    const perRun = engines.reduce((s: number, e: string) => s + prompts * estimateAnswerCost(e, prices), 0);
    projects.push({ id: p.id, name: p.name, data_mode: p.data_mode, prompts, engines, frequency: p.frequency, perRun, monthly: perRun * (runsPerMonth[p.frequency] || 30),
      byEngine: engines.map((e: string) => ({ engine: e, monthly: prompts * estimateAnswerCost(e, prices) * (runsPerMonth[p.frequency] || 30) })) });
  }
  return { projects, liveTotal: projects.filter(p => p.data_mode === 'live').reduce((s, p) => s + p.monthly, 0) };
});

// ---------------------------------------------------------------- your team (people and invite links)
R('GET', '/team', async c => {
  staffOnly(c);
  return {
    users: await all('SELECT s.user_id id, p.email, COALESCE(p.full_name, p.email) name, s.role, s.created_at FROM staff s LEFT JOIN profiles p ON p.id = s.user_id ORDER BY s.created_at'),
    invites: c.role === 'admin' ? await all(`SELECT id, email, role, created_at FROM invites WHERE org_id IS NULL AND accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC`) : [],
  };
});
R('POST', '/team/invite', async c => {
  adminOnly(c);
  const email = String(c.body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) throw fail('Please enter a valid email address.');
  const token = newToken(); // the link is shown once; only its hash is kept
  const hash = await sha256(token);
  await asService(() => run('INSERT INTO invites (token_hash, email, org_id, role, invited_by) VALUES (?,?,NULL,?,?)', hash, email, c.body.role === 'admin' ? 'admin' : 'member', c.user.id));
  return { token, expiresInDays: INVITE_DAYS };
});
R('DELETE', '/team/invite/:id', async c => { adminOnly(c); await asService(() => run('DELETE FROM invites WHERE id = ?', c.params.id)); return { ok: true }; });
R('DELETE', '/team/user/:id', async c => {
  adminOnly(c);
  if (c.params.id === c.user.id) throw fail('You cannot remove yourself.');
  const { error } = await authDb.auth.admin.deleteUser(c.params.id);
  if (error) throw fail(error.message);
  return { ok: true };
});
// Change your own password (anyone signed in). /team/password is the older address for the same thing.
const changePassword = async (c: Ctx) => {
  const next = String(c.body.next || '');
  if (next.length < 10 || next.length > 72 || !/[a-z]/.test(next) || !/[A-Z]/.test(next) || !/[0-9]/.test(next)) throw fail('New password needs 10+ characters with upper case, lower case and a number.');
  const check = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/token?grant_type=password`, { method: 'POST',
    headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') || '', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: c.user.email, password: String(c.body.current || '') }) });
  if (!check.ok) throw fail('Current password is wrong.');
  const { error } = await authDb.auth.admin.updateUserById(c.user.id, { password: next });
  if (error) throw fail(error.message);
  return { ok: true };
};
R('POST', '/me/password', changePassword);
R('POST', '/team/password', changePassword);
// After a security problem: end every saved sign-in (open pages stop working within the hour, when their token expires).
R('POST', '/team/sign-out-everyone', async c => {
  adminOnly(c);
  const n = await asService(async () => { const r = await all('DELETE FROM auth.sessions RETURNING id'); return r.length; });
  return { ok: true, ended: n };
});

// ---------------------------------------------------------------- serving
function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  return { 'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0], 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-region',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS', Vary: 'Origin', 'Cache-Control': 'no-store' };
}

Deno.serve(async req => {
  const headers = cors(req);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/(functions\/v1\/)?api/, '') || '/';
  let route, params: Record<string, string> = {};
  for (const r of routes) { const m = r.method === req.method && path.match(r.re); if (m) { route = r; params = m.groups || {}; break; } }
  if (!route) return json({ error: 'Not found' }, 404);
  try {
    if (Number(req.headers.get('content-length') || 0) > 100_000) return json({ error: 'Request is too large.' }, 413);
    const body = ['GET', 'DELETE'].includes(req.method) ? {} : await req.json().catch(() => ({}));
    const t: number[] = [performance.now()];
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data } = jwt && jwt.split('.').length === 3 ? await authDb.auth.getUser(jwt) : { data: null };
    const user = data?.user ?? null;
    t.push(performance.now());
    if (!user && !route.open) return json({ error: 'Please log in.' }, 401);
    t.push(performance.now());
    const ctx: Ctx = { params, query: Object.fromEntries(url.searchParams), body: body && typeof body === 'object' ? body : {}, user, role: null, after: [] };
    const out = user ? await asUser(user, (role: string | null) => {
      ctx.role = role;
      if (role && req.method !== 'GET' && !TEAM_WRITES.some(re => re.test(path))) throw fail('Team accounts have read-only access to client dashboards.', 403);
      return route.handler(ctx);
    }) : await asService(() => route.handler(ctx));
    for (const f of ctx.after) await f();
    t.push(performance.now());
    headers['Server-Timing'] = `auth;dur=${(t[1] - t[0]).toFixed(0)}, role;dur=${(t[2] - t[1]).toFixed(0)}, work;dur=${(t[3] - t[2]).toFixed(0)}`;
    if (out instanceof Response) { for (const [k, val] of Object.entries(headers)) out.headers.set(k, val); return out; }
    return json(out ?? { ok: true });
  } catch (e: any) {
    if (e?.expose || e instanceof InputError) return json({ error: e.message }, e.status || 400);
    if (e?.code === '42501') return json({ error: 'You do not have access to this.' }, 403);
    if (e?.code === 'P0001') return json({ error: e.message }, 400); // our own database checks (e.g. budget is team-only)
    if (e?.code === '23505') return json({ error: 'That already exists.' }, 409);
    const ref = crypto.randomUUID().slice(0, 8);
    console.error(`[error ${ref}]`, e);
    return json({ error: `Something went wrong on our side. Reference: ${ref}` }, 500);
  }
});
