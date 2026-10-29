// End-to-end test of the `api` function (the data behind the current pages) against the live project.
// Creates an admin (setup path, or directly once a real admin exists), two client companies, some answers, then
// checks responses and isolation. Cleans up everything it made and leaves other data alone.
import assert from 'node:assert/strict';
import { makeTestAdmin } from './admin.mjs';
const { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key, HOUSEDGE_SETUP_CODE: setupCode, SUPABASE_ACCESS_TOKEN: mgmt, SUPABASE_PROJECT_REF: ref } = process.env;
const run = Date.now().toString(36);
const pw = 'Test-pass-' + run.toUpperCase() + '9';
const emails = { admin: `t-admin-${run}@housedge.test`, a: `t-a-${run}@wolt.test`, b: `t-b-${run}@foodora.test` };

// Network on a laptop can drop a connection: retry, since each statement here is safe to repeat.
async function retry(f) { for (let i = 1; ; i++) { try { return await f(); } catch (e) { if (i >= 4 || e.name === 'AssertionError') throw e; await new Promise(r => setTimeout(r, 2000)); } } }
const sql = query => retry(async () => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${mgmt}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  const body = await r.json();
  if (!r.ok) throw Object.assign(new Error(JSON.stringify(body)), { name: 'AssertionError' });
  return body;
});
const fn = async (name, body, token) => (await fetch(`${url}/functions/v1/${name}`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })).json();
const signIn = async email => (await (await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) })).json()).access_token;
const api = async (token, path, { method = 'GET', body } = {}) => {
  // Only reads are retried; a write is sent once so a retry cannot apply it twice.
  const send = () => fetch(`${url}/functions/v1/api${path}`, { method, headers: { apikey: key, 'x-region': 'eu-central-1', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120000) });
  const r = method === 'GET' ? await retry(send) : await send();
  const type = r.headers.get('content-type') || '';
  return { status: r.status, body: type.includes('json') ? await r.json() : await r.text() };
};

const T = {};
const steps = [];
const step = (name, f) => steps.push([name, f]);

step('admin and two client companies set up', async () => {
  if ((await fn('join', { action: 'state' })).needsSetup) assert.equal((await fn('join', { action: 'setup', setupCode, email: emails.admin, password: pw, fullName: 'Test Admin' })).ok, true);
  else await makeTestAdmin({ url, mgmt, ref, email: emails.admin, password: pw, sql });
  T.admin = await signIn(emails.admin);
  for (const [k, name] of [['a', `Wolt ${run}`], ['b', `Foodora ${run}`]]) {
    const r = await fn('team', { action: 'create-client', name, ownerEmail: emails[k], monthlyBudget: 20 }, T.admin);
    T[`org_${k}`] = r.orgId;
    await fn('join', { action: 'accept', token: r.invite.link.split('/').pop(), password: pw, fullName: `Client ${k}` });
    T[k] = await signIn(emails[k]);
  }
  assert.ok(T.a && T.b);
});
step('auth state reports roles', async () => {
  assert.equal((await api(null, '/auth/state')).body.user, null);
  assert.equal((await api(T.admin, '/auth/state')).body.user.role, 'admin');
  assert.equal((await api(T.a, '/auth/state')).body.user.role, 'client');
});
step('client A creates its project (current Quickstart request shape)', async () => {
  const r = await api(T.a, '/projects', { method: 'POST', body: { name: 'Wolt FI', own: { name: 'Wolt', domain: 'https://wolt.com/' },
    competitors: [{ name: 'Foodora', domain: 'foodora.fi' }, { name: 'Uber Eats' }], prompts: [{ text: 'Best food delivery apps in Finland?', country: 'FI', tags: ['core'] }, { text: 'Is Wolt any good?' }],
    countries: ['FI'], engines: ['chatgpt', 'claude'], frequency: 'weekly', discovery: { offer: 'food delivery apps' } } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); T.pa = r.body.id;
  const own = await sql(`select org_id from projects where id = ${T.pa}`);
  assert.equal(own[0].org_id, T.org_a, 'project filed under the client\'s own company');
});
step('client B creates its project; the admin cannot create or change client projects', async () => {
  const body = { name: 'Foodora FI', own: { name: 'Foodora' }, competitors: [{ name: 'Wolt' }], prompts: [{ text: 'Cheapest delivery app?' }] };
  assert.equal((await api(T.admin, '/projects', { method: 'POST', body: { ...body, orgId: T.org_b } })).status, 403, 'admin is read-only');
  const r = await api(T.b, '/projects', { method: 'POST', body });
  assert.equal(r.status, 200, JSON.stringify(r.body)); T.pb = r.body.id;
  assert.equal((await api(T.admin, `/projects/${T.pb}/prompts`, { method: 'POST', body: { text: 'admin question' } })).status, 403);
  assert.equal((await api(T.admin, `/projects/${T.pb}`, { method: 'PATCH', body: { name: 'renamed' } })).status, 403);
  assert.equal((await api(T.admin, `/projects/${T.pb}/run`, { method: 'POST' })).status, 403);
  assert.equal((await api(T.admin, `/projects/${T.pb}/summary?days=30`)).status, 200, 'admin can still read');
});
step('pipeline-shaped answers inserted (as the backend would)', async () => {
  const day = new Date().toISOString().slice(0, 10);
  await sql(`
    with p as (select id from prompts where project_id = ${T.pa} order by id limit 1),
    a as (insert into answers (project_id, prompt_id, engine, day, text, model, cost, in_tokens, out_tokens)
          select ${T.pa}, p.id, e, '${day}', '1. Wolt is the main choice. 2. Uber Eats is new. Foodora has left Finland.', 'test', 0.1, 1000, 200 from p, unnest(array['chatgpt','claude']) e returning id)
    insert into mentions (project_id, answer_id, brand_id, position, sentiment, snippet)
      select ${T.pa}, a.id, b.id, case b.name when 'Wolt' then 1 when 'Uber Eats' then 2 else null end, case b.name when 'Foodora' then 15 else 85 end, 'x'
      from a cross join brands b where b.project_id = ${T.pa};
    insert into citations (project_id, answer_id, url, domain, title, category) select ${T.pa}, id, 'https://yle.fi/a', 'yle.fi', 'Yle', 'news' from answers where project_id = ${T.pa};
    insert into other_brands (project_id, answer_id, name) select ${T.pa}, id, 'K-Ruoka' from answers where project_id = ${T.pa};`);
});
step('client A sees its dashboards (summary, daily, engines, sources, chats, prompts, actions, filters, workflow)', async () => {
  const s = await api(T.a, `/projects/${T.pa}/summary?days=30`);
  assert.equal(s.status, 200, JSON.stringify(s.body)); assert.equal(s.body.totalAnswers, 2);
  const wolt = s.body.brands.find(b => b.name === 'Wolt');
  assert.equal(wolt.visibility, 100); assert.equal(wolt.position, 1); assert.equal(wolt.is_own, true);
  assert.equal(s.body.brands.find(b => b.name === 'Foodora').sentiment, 15);
  const d = await api(T.a, `/projects/${T.pa}/daily?days=30`);
  assert.equal(d.body.series.length, 1); assert.equal(d.body.series[0][`v_${wolt.id}`], 100);
  assert.equal((await api(T.a, `/projects/${T.pa}/engines?days=30`)).body.length, 2);
  const src = await api(T.a, `/projects/${T.pa}/sources?days=30`);
  assert.equal(src.body.domains[0].domain, 'yle.fi'); assert.equal(src.body.urls[0].n, 2);
  const ch = await api(T.a, `/projects/${T.pa}/chats?days=30&q=main choice`);
  assert.equal(ch.body.total, 2); assert.equal(ch.body.rows[0].mentions.length, 3); assert.deepEqual(ch.body.rows[0].others, ['K-Ruoka']);
  const pr = await api(T.a, `/projects/${T.pa}/prompts?days=30`);
  assert.equal(pr.body.length, 2); assert.equal(pr.body[0].answers, 2); assert.deepEqual(pr.body[0].tags, ['core']);
  assert.equal((await api(T.a, `/projects/${T.pa}/actions?days=30`)).status, 200);
  assert.deepEqual((await api(T.a, `/projects/${T.pa}/filters`)).body.tags, ['core']);
  assert.equal((await api(T.a, `/projects/${T.pa}/workflow`)).body.stages.length, 6);
  const filtered = await api(T.a, `/projects/${T.pa}/summary?days=30&tag=core&engines=claude`);
  assert.equal(filtered.body.totalAnswers, 1);
});
step('client A cannot reach client B in any way', async () => {
  for (const p of [`/projects/${T.pb}`, `/projects/${T.pb}/summary`, `/projects/${T.pb}/chats`, `/projects/${T.pb}/prompts`, `/projects/${T.pb}/export/answers`]) {
    assert.equal((await api(T.a, p)).status, 404, p);
  }
  assert.deepEqual((await api(T.a, '/projects')).body.map(p => p.id), [T.pa], 'project list shows only own');
  assert.equal((await api(T.a, `/projects/${T.pb}/prompts`, { method: 'POST', body: { text: 'sneaky' } })).status, 404);
  assert.equal((await api(T.b, `/projects/${T.pa}/summary`)).status, 404);
});
step('client edits its setup; protected things are refused', async () => {
  assert.equal((await api(T.a, `/projects/${T.pa}/prompts`, { method: 'POST', body: { text: 'Which app is fastest?\nIs Wolt safe?' } })).body.added, 2);
  assert.equal((await api(T.a, `/projects/${T.pa}/brands`, { method: 'POST', body: { name: 'K-Ruoka' } })).status, 200);
  assert.equal((await api(T.a, `/projects/${T.pa}`, { method: 'PATCH', body: { fee: 999 } })).status, 400, 'fee is team-only');
  assert.equal((await api(T.a, '/settings')).status, 403);
  assert.equal((await api(T.a, '/team')).status, 403);
  assert.equal((await api(T.a, `/projects/${T.pa}/reports`, { method: 'POST', body: {} })).status, 403);
  assert.deepEqual((await api(T.a, '/enquiries')).body, []);
});
step('adding a competitor recounted history from the answers', async () => {
  const s = await api(T.a, `/projects/${T.pa}/summary?days=30`);
  assert.equal(s.body.brands.length, 4);
  assert.ok(s.body.brands.find(b => b.name === 'K-Ruoka'), 'new brand present');
  assert.equal(s.body.brands.find(b => b.name === 'Wolt').visibility, 100, 'existing counts kept by the recount');
});
step('work log: actions are measured before and after, and the dataset is team-only', async () => {
  // The answers inserted above are dated today, mention Wolt and cite yle.fi.
  const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const after = await api(T.admin, `/projects/${T.pa}/interventions`, { method: 'POST', body: { kind: 'press', title: 'Yle article', url: 'https://yle.fi/a/123', doneOn: day(-1) } });
  assert.equal(after.status, 200, JSON.stringify(after.body));
  const before = await api(T.a, `/projects/${T.pa}/interventions`, { method: 'POST', body: { kind: 'listicle', title: 'Planned listing', url: 'yle.fi/list', doneOn: day(1) } });
  assert.equal(before.status, 200, JSON.stringify(before.body));
  assert.equal((await api(T.a, `/projects/${T.pa}/interventions`, { method: 'POST', body: { kind: 'press', title: 'x', url: 'javascript:alert(1)', doneOn: day(0) } })).status, 400, 'unsafe link refused');
  assert.equal((await api(T.b, `/projects/${T.pa}/interventions`, { method: 'POST', body: { kind: 'press', title: 'x', doneOn: day(0) } })).status, 404, 'other client cannot log work here');
  const log = (await api(T.a, `/projects/${T.pa}/interventions`)).body;
  const a = log.items.find(i => i.id === after.body.id), b = log.items.find(i => i.id === before.body.id);
  assert.equal(a.target_domain, 'yle.fi');
  assert.deepEqual([a.before_answers, a.after_answers, a.after_named, a.after_cited], [0, 2, 2, 2], 'answers after the action counted, with yle.fi cited');
  assert.deepEqual([b.before_answers, b.before_named, b.before_cited, b.after_answers], [2, 2, 2, 0], 'answers before the action counted');
  assert.equal(a.verdict, 'no_data', 'no verdict without answers on both sides');
  assert.equal(log.weekly.at(-1).share, 100);
  assert.equal((await api(T.a, '/admin/learnings')).status, 403, 'dataset is team-only');
  assert.equal((await api(T.admin, '/admin/learnings')).status, 200);
  assert.equal((await api(T.admin, `/interventions/${before.body.id}`, { method: 'PATCH', body: { status: 'live', notes: 'Went live' } })).status, 200, 'team can update work');
  assert.equal((await api(T.a, `/interventions/${before.body.id}`, { method: 'DELETE' })).status, 200);
});
step('outreach: a listed site becomes a Work log entry; look-alike data and team access', async () => {
  const add = await api(T.a, `/projects/${T.pa}/outreach`, { method: 'POST', body: { domain: 'https://www.yle.fi/news' } });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  const item = add.body.items.find(i => i.domain === 'yle.fi');
  assert.ok(item, 'site added, address cleaned');
  assert.equal((await api(T.a, `/projects/${T.pa}/outreach`, { method: 'POST', body: { domain: 'yle.fi' } })).status, 400, 'no duplicates');
  assert.equal((await api(T.b, `/outreach/${item.id}`, { method: 'PUT', body: { status: 'contacted' } })).status, 404, 'other client cannot touch it');
  const listed = await api(T.admin, `/outreach/${item.id}`, { method: 'PUT', body: { status: 'listed', listed_url: 'https://yle.fi/a/123' } });
  assert.equal(listed.status, 200, 'the team works the outreach list too');
  const row = listed.body.items.find(i => i.id === item.id);
  assert.ok(row.listed_at && row.intervention_id && row.impact, 'listing dated, measured, linked to the Work log');
  const log = (await api(T.a, `/projects/${T.pa}/interventions`)).body.items;
  assert.ok(log.some(i => i.id === row.intervention_id && i.target_domain === 'yle.fi'), 'Work log entry created');
  const s = (await api(T.a, `/projects/${T.pa}/summary?days=30`)).body;
  assert.deepEqual(s.confusion, { answers: 0, share: 0, lookalikes: [] }, 'look-alike stats in the summary');
  assert.equal((await api(T.a, `/projects/${T.pa}/assistant`, { method: 'POST', body: { messages: [] } })).status, 400, 'assistant needs a question (no AI called)');
  assert.equal((await api(T.a, `/admin/clients/${T.org_a}/team`)).status, 403, 'clients cannot see team access');
  const team = await api(T.admin, `/admin/clients/${T.org_a}/team`);
  assert.equal(team.status, 200);
  assert.ok(team.body.some(u => u.role === 'admin' && u.hasAccess), 'admins always have access');
});
step('admin sees everything and makes a report the client can read', async () => {
  const ids = (await api(T.admin, '/projects')).body.map(p => p.id);
  assert.ok(ids.includes(T.pa) && ids.includes(T.pb), 'admin sees both clients\' projects');
  const r = await api(T.admin, `/projects/${T.pa}/reports`, { method: 'POST', body: { days: 30 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const rep = await api(T.a, `/reports/${r.body.id}`);
  assert.equal(rep.status, 200); assert.equal(rep.body.data.summary.totalAnswers, 2);
  assert.equal((await api(T.b, `/reports/${r.body.id}`)).status, 404);
  assert.equal((await api(T.admin, '/settings')).status, 200);
  const team = await api(T.admin, '/team');
  assert.ok(team.body.users.some(u => u.email === emails.admin));
  assert.match((await api(T.admin, '/team/invite', { method: 'POST', body: { email: `mate-${run}@housedge.test` } })).body.token, /^[0-9a-f]{64}$/);
});
step('CSV export; the data API key opens one client only; spending locks', async () => {
  const raw = await fetch(`${url}/functions/v1/api/projects/${T.pa}/export/answers?days=30`, { headers: { apikey: key, Authorization: `Bearer ${T.a}`, 'x-region': 'eu-central-1' } });
  const bytes = new Uint8Array(await raw.arrayBuffer());
  assert.equal(raw.status, 200);
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'starts with the marker that makes Excel read accents correctly');
  assert.match(new TextDecoder().decode(bytes), /^id,day,engine/);
  assert.match(raw.headers.get('content-disposition'), /attachment; filename="Wolt-FI-answers\.csv"/);
  // Data API keys belong to one client.
  assert.equal((await api(null, '/v1/projects?key=wrong')).status, 401);
  assert.equal((await api(T.a, `/admin/clients/${T.org_a}/api-key`, { method: 'POST', body: {} })).status, 403, 'clients cannot make keys');
  const k = (await api(T.admin, `/admin/clients/${T.org_a}/api-key`, { method: 'POST', body: {} })).body.key;
  assert.match(k, /^hk_[0-9a-f]{48}$/);
  const list = await api(null, `/v1/projects?key=${k}`);
  assert.deepEqual(list.body.map(p => p.id), [T.pa], "the key lists only its own client's projects");
  const v1 = await api(null, `/v1/projects/${T.pa}/daily.csv?days=30&key=${k}`);
  assert.equal(v1.status, 200); assert.match(v1.body, /^day,brand/);
  assert.equal((await api(null, `/v1/projects/${T.pb}/summary?key=${k}`)).status, 404, "another client's project is not reachable");
  assert.equal((await api(T.admin, `/admin/clients/${T.org_a}/api-key`)).body.hint, k.slice(-4), 'only the last 4 characters are kept to show');
  assert.equal((await sql(`select count(*)::int n from public.api_tokens where token_hash = '${k}'`))[0].n, 0, 'the key itself is never stored');
  await api(T.admin, `/admin/clients/${T.org_a}/api-key`, { method: 'DELETE' });
  assert.equal((await api(null, `/v1/projects?key=${k}`)).status, 401, 'a revoked key stops working');
  // Spending locks: no budget = no AI call at all; a second click while a check runs starts nothing.
  await api(T.admin, `/admin/clients/${T.org_b}`, { method: 'PATCH', body: { monthlyBudget: 0 } });
  const blocked = await api(T.b, `/projects/${T.pb}/run`, { method: 'POST' });
  assert.equal(blocked.status, 402, JSON.stringify(blocked.body));
  await sql(`insert into public.runs (project_id, trigger, status, total) values (${T.pb}, 'manual', 'running', 1)`);
  assert.equal((await api(T.b, `/projects/${T.pb}/run`, { method: 'POST' })).body.already, true, 'an already running check is returned, nothing new starts');
  const dup = await sql(`insert into public.runs (project_id, trigger, status, total) values (${T.pb}, 'manual', 'running', 1)`).then(() => null, e => String(e.message));
  assert.match(dup || '', /runs_one_running/, 'the database refuses a second running check for the same project');
  await sql(`update public.runs set status = 'failed' where project_id = ${T.pb}`);
});
step('account, drafts, fact check and engine test: access and checks before any AI call', async () => {
  assert.equal((await api(T.a, '/me/password', { method: 'POST', body: { current: 'wrong-Password1', next: 'New-password-123' } })).status, 400, 'wrong current password refused');
  assert.equal((await api(T.a, '/me/password', { method: 'POST', body: { current: pw, next: 'short' } })).status, 400, 'weak new password refused');
  assert.equal((await api(T.a, '/me', { method: 'PATCH', body: { name: 'Client A', jobTitle: 'CMO' } })).status, 200, 'client edits own name');
  assert.equal((await api(T.b, `/projects/${T.pa}/drafts`, { method: 'POST', body: { kind: 'about' } })).status, 404, 'other client cannot write drafts here');
  const d = await api(T.a, `/projects/${T.pa}/drafts`, { method: 'POST', body: { kind: 'about' } });
  assert.equal(d.status, 400, 'no draft (and no AI call) without a brand profile: ' + JSON.stringify(d.body));
  assert.equal((await api(T.admin, `/projects/${T.pa}/drafts`, { method: 'POST', body: { kind: 'about' } })).status, 403, 'team is read-only');
  assert.equal((await api(T.a, `/projects/${T.pa}/facts/check`, { method: 'POST' })).status, 400, 'no fact check without facts');
  assert.equal((await api(T.b, `/projects/${T.pa}/facts/check`, { method: 'POST' })).status, 404);
  assert.equal((await api(T.a, '/settings/test/claude', { method: 'POST' })).status, 403, 'engine test is admin-only');
  assert.equal((await api(T.admin, '/settings/test/chatgpt', { method: 'POST' })).status, 400, 'not connected engine: no call');
});
step('public website requests work signed out', async () => {
  assert.equal((await api(null, '/legal')).status, 200);
  assert.equal((await api(null, '/enquiries/new', { method: 'POST', body: { name: 'Lead', email: `lead-${run}@x.test`, company: 'X', consent: true } })).status, 200);
  assert.equal((await api(null, '/projects')).status, 401);
  assert.equal((await api(null, '/cron/tick', { method: 'POST', body: { secret: 'guess' } })).status, 404, 'the schedule cannot be triggered without its secret');
});

let failed = 0;
for (const [name, f] of steps) {
  try { await f(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message.slice(0, 400)); break; }
}
await sql(`delete from public.orgs where name in ('Wolt ${run}', 'Foodora ${run}'); delete from public.invites where email like '%${run}%';
  delete from public.enquiries where email = 'lead-${run}@x.test';
  delete from auth.users where email like '%${run}%';`);
console.log('cleanup:', JSON.stringify((await sql('select (select count(*) from auth.users) users, (select count(*) from public.orgs) orgs, (select count(*) from public.projects) projects'))[0]));
console.log(failed ? 'API TEST FAILED' : 'API TEST PASSED');
process.exit(failed ? 1 : 0);
