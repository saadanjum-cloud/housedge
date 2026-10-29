// End-to-end account flow against the deployed Edge Functions and Supabase Auth, then cleans up everything it made.
// The one-time setup steps run only while no real admin exists; after that the test makes its own admin directly.
// Usage: node supabase/tests/auth-flow.mjs   (reads SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, HOUSEDGE_SETUP_CODE,
//        SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF from the environment)
import assert from 'node:assert/strict';
import { makeTestAdmin } from './admin.mjs';
const { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key, HOUSEDGE_SETUP_CODE: setupCode, SUPABASE_ACCESS_TOKEN: mgmt, SUPABASE_PROJECT_REF: ref } = process.env;
const run = Date.now().toString(36);
const adminEmail = `test-admin-${run}@housedge.test`, clientEmail = `test-client-${run}@wolt.test`;
const strong = 'Test-pass-' + run.toUpperCase() + '9';

const fn = async (name, body, token) => {
  const r = await fetch(`${url}/functions/v1/${name}`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const signIn = async (email, password) => {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return { status: r.status, body: await r.json() };
};
const rest = async (path, token) => (await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${token}` } })).json();
const sql = async query => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${mgmt}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })).json();

const steps = [];
const step = (name, fnc) => steps.push([name, fnc]);
let admin, client, orgId, link;
const setupOpen = (await fn('join', { action: 'state' })).body.needsSetup;

if (setupOpen) {
  step('setup is open and refuses a wrong code', async () => {
    const r = await fn('join', { action: 'setup', setupCode: 'wrong-code-wrong-code', email: adminEmail, password: strong, fullName: 'Test Admin' });
    assert.equal(r.status, 403);
  });
  step('weak password refused', async () => {
    const r = await fn('join', { action: 'setup', setupCode, email: adminEmail, password: 'short', fullName: 'Test Admin' });
    assert.equal(r.status, 400); assert.match(r.body.error, /10 to 72/);
  });
  step('first admin created with the setup code, then setup closes', async () => {
    assert.equal((await fn('join', { action: 'setup', setupCode, email: adminEmail, password: strong, fullName: 'Test Admin' })).status, 200);
    assert.equal((await fn('join', { action: 'state' })).body.needsSetup, false);
    assert.equal((await fn('join', { action: 'setup', setupCode, email: 'x' + adminEmail, password: strong, fullName: 'X' })).status, 409);
  });
} else {
  step('setup stays closed once an admin exists (even with a guessed code)', async () => {
    assert.equal((await fn('join', { action: 'setup', setupCode: 'wrong-code-wrong-code', email: adminEmail, password: strong, fullName: 'X' })).status, 409);
    await makeTestAdmin({ url, mgmt, ref, email: adminEmail, password: strong, sql });
  });
}
step('public sign-up is switched off', async () => {
  const r = await fetch(`${url}/auth/v1/signup`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `x-${run}@x.test`, password: strong }) });
  assert.ok(r.status >= 400, `signup status ${r.status}`);
});
step('admin signs in and onboards a client company', async () => {
  const s = await signIn(adminEmail, strong);
  assert.equal(s.status, 200); admin = s.body.access_token;
  const r = await fn('team', { action: 'create-client', name: `Wolt test ${run}`, website: 'wolt.com', monthlyBudget: 25, ownerEmail: clientEmail }, admin);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  orgId = r.body.orgId; link = r.body.invite.link;
  assert.match(link, /\/join\/[0-9a-f]{64}$/);
});
step('anonymous and wrong tokens cannot use admin actions', async () => {
  assert.equal((await fn('team', { action: 'invite', email: 'a@b.test', orgId })).status, 401);
  assert.equal((await fn('team', { action: 'invite', email: 'a@b.test', orgId }, 'not-a-jwt')).status, 401);
});
step('client opens the invite and sets a password', async () => {
  const token = link.split('/').pop();
  const info = await fn('join', { action: 'inspect', token });
  assert.equal(info.body.email, clientEmail); assert.equal(info.body.company, `Wolt test ${run}`);
  assert.equal((await fn('join', { action: 'inspect', token: 'f'.repeat(64) })).status, 404);
  assert.equal((await fn('join', { action: 'accept', token, password: 'alllowercase1', fullName: 'Client Person' })).status, 400, 'weak password refused, link not used up');
  assert.equal((await fn('join', { action: 'accept', token, password: strong, fullName: 'Client Person' })).status, 200);
  assert.equal((await fn('join', { action: 'accept', token, password: strong, fullName: 'Again' })).status, 404, 'link works once');
});
step('client signs in and sees only its own company', async () => {
  const s = await signIn(clientEmail, strong);
  assert.equal(s.status, 200); client = s.body.access_token;
  const orgs = await rest('orgs?select=name', client);
  assert.deepEqual(orgs.map(o => o.name), [`Wolt test ${run}`]);
  assert.deepEqual(await rest('admin_clients?select=id', client), []);
  assert.deepEqual(await rest('org_health?select=org_id', client), []);
});
step('client cannot use admin actions', async () => {
  assert.equal((await fn('team', { action: 'invite', email: 'a@b.test', orgId }, client)).status, 403);
  assert.equal((await fn('team', { action: 'create-client', name: 'X', ownerEmail: 'a@b.test' }, client)).status, 403);
});
step('admin sees the client in the overview and can issue a reset link', async () => {
  const rows = await rest(`admin_clients?select=name,members,monthly_budget,health&id=eq.${orgId}`, admin);
  assert.equal(rows[0].members, 1); assert.equal(Number(rows[0].monthly_budget), 25); assert.equal(rows[0].health, 'good');
  const uid = (await sql(`select id from auth.users where email = '${clientEmail}'`))[0].id;
  const r = await fn('team', { action: 'reset-link', userId: uid }, admin);
  assert.equal(r.status, 200); assert.match(r.body.link, /^https:\/\/.+recovery/);
});

let failed = 0;
for (const [name, f] of steps) {
  try { await f(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message); break; }
}
// Clean up everything this test created (users cascade to staff, members, profiles).
await sql(`delete from public.orgs where name = 'Wolt test ${run}'; delete from public.invites where email in ('${clientEmail}'); delete from auth.users where email in ('${adminEmail}', '${clientEmail}');`);
const left = await sql(`select (select count(*) from auth.users) users, (select count(*) from public.staff) staff, (select count(*) from public.orgs) orgs`);
console.log('cleanup:', JSON.stringify(left[0]));
console.log(failed ? 'AUTH FLOW FAILED' : 'AUTH FLOW PASSED');
process.exit(failed ? 1 : 0);
