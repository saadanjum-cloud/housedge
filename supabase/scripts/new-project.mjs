// Sets up an EMPTY Supabase project as a complete Housedge backend, from this repository:
//   1. database: every migration in supabase/migrations (tables, row-level security, functions, storage bucket, schedule)
//   2. server secrets: Anthropic key, app address, allowed origins, database pool URL, schedule secret, setup code
//   3. Vault secrets used by the hourly schedule: project_url and cron_secret
//   4. sign-in settings: no public sign-up, password rules, allowed redirect addresses
//   5. the three server functions: api, join, team
//   6. points vercel.json and web/.env.example at the new project
// Then copy the data across with copy-data.mjs (or create the first admin with the setup code on /setup).
//
// Usage (secrets come from the environment, never from the command line or this file):
//   NEW_ACCESS_TOKEN=sbp_...        personal access token of the account that owns the NEW project
//   NEW_REF=abcdefghijklmnop       the new project's reference id (Project settings → General)
//   [NEW_DB_PASSWORD=...]          the new project's database password (optional: without it, migrations run through the
//                                  Management API and the functions use the database address Supabase gives them)
//   ANTHROPIC_API_KEY=sk-ant-...   Claude key for Run now, Ask Housedge, drafts…
//   APP_URL=https://your-app.vercel.app
//   [SETUP_CODE=...]               only needed if you will NOT copy data (creates the first admin on /setup)
//   node supabase/scripts/new-project.mjs
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';

const env = process.env;
for (const k of ['NEW_ACCESS_TOKEN', 'NEW_REF', 'ANTHROPIC_API_KEY', 'APP_URL']) if (!env[k]) { console.error(`Missing ${k}. See the comment at the top of this file.`); process.exit(2); }
const ref = env.NEW_REF, token = env.NEW_ACCESS_TOKEN, appUrl = env.APP_URL.replace(/\/$/, '');
const OLD_REF = 'fnvfhxhccuntvewpwfnc'; // the project this repo was built on, replaced in vercel.json and web/.env.example
const hide = s => [env.NEW_DB_PASSWORD, env.ANTHROPIC_API_KEY, token].filter(Boolean).reduce((x, v) => x.split(v).join('[hidden]'), String(s));
const step = m => console.log(`\n== ${m}`);

async function mgmt(method, path, body) {
  const r = await fetch(`https://api.supabase.com/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: HTTP ${r.status} ${hide(text).slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const sql = query => mgmt('POST', `/projects/${ref}/database/query`, { query });
const quote = s => `'${String(s).replace(/'/g, "''")}'`;
const cli = args => execFileSync('npx', ['-y', 'supabase', ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, SUPABASE_ACCESS_TOKEN: token } }).toString();

step('Project');
const project = await mgmt('GET', `/projects/${ref}`);
console.log(`${project.name} (${project.region}), status ${project.status}`);
if ((await sql("select count(*)::int n from information_schema.tables where table_schema = 'public' and table_name = 'orgs'"))[0].n) {
  console.log('This project already has the Housedge tables; migrations that are already applied are skipped.');
}

step('Database migrations');
let transactionUrl = null;
if (env.NEW_DB_PASSWORD) {
  const poolers = await mgmt('GET', `/projects/${ref}/config/database/pooler`);
  const pooler = (Array.isArray(poolers) ? poolers : [poolers]).find(p => p.pool_mode === 'transaction') || poolers[0];
  const host = pooler.db_host, user = pooler.db_user || `postgres.${ref}`;
  const enc = encodeURIComponent(env.NEW_DB_PASSWORD);
  transactionUrl = `postgresql://${user}:${enc}@${host}:6543/postgres`; // the api function's pool
  console.log(hide(cli(['db', 'push', '--db-url', `postgresql://${user}:${enc}@${host}:5432/postgres`, '--yes'])).split('\n').filter(l => /Applying|Finished|up to date/i.test(l)).join('\n'));
} else {
  // Same result as `supabase db push`: each migration once, in order, recorded in supabase_migrations.
  await sql(`create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`);
  const done = new Set((await sql('select version from supabase_migrations.schema_migrations')).map(r => r.version));
  for (const file of fs.readdirSync('supabase/migrations').filter(f => /^\d+_.+\.sql$/.test(f)).sort()) {
    const [version, ...rest] = file.replace(/\.sql$/, '').split('_');
    if (done.has(version)) continue;
    const body = fs.readFileSync(`supabase/migrations/${file}`, 'utf8');
    await sql(`begin;\n${body}\ninsert into supabase_migrations.schema_migrations (version, name, statements) values (${quote(version)}, ${quote(rest.join('_'))}, array[${quote(body)}]);\ncommit;`);
    console.log(`Applied ${file}`);
  }
}

step('Server secrets');
const cronSecret = randomBytes(32).toString('hex');
const secrets = [
  { name: 'ANTHROPIC_API_KEY', value: env.ANTHROPIC_API_KEY },
  { name: 'APP_URL', value: appUrl },
  { name: 'APP_ORIGINS', value: `${appUrl},http://localhost:5173` },
  ...(transactionUrl ? [{ name: 'DB_POOL_URL', value: transactionUrl }] : []),
  { name: 'CRON_SECRET', value: cronSecret },
  ...(env.SETUP_CODE ? [{ name: 'SETUP_CODE', value: env.SETUP_CODE }] : []),
  ...['OPENAI_API_KEY', 'GEMINI_API_KEY', 'PERPLEXITY_API_KEY'].filter(k => env[k]).map(k => ({ name: k, value: env[k] })),
];
await mgmt('POST', `/projects/${ref}/secrets`, secrets);
console.log(`Set: ${secrets.map(s => s.name).join(', ')}`);

step('Vault secrets for the hourly schedule');
await sql(`delete from vault.secrets where name in ('project_url', 'cron_secret');
  select vault.create_secret(${quote(`https://${ref}.supabase.co`)}, 'project_url', 'This project''s API address, used by the schedule');
  select vault.create_secret(${quote(cronSecret)}, 'cron_secret', 'Shared secret for the hourly Housedge schedule');`);
console.log('Set: project_url, cron_secret');

step('Sign-in settings');
await mgmt('PATCH', `/projects/${ref}/config/auth`, {
  disable_signup: true, site_url: appUrl, uri_allow_list: `${appUrl}/**,http://localhost:5173/**`,
  password_min_length: 10, password_required_characters: 'abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789',
});
console.log(`Public sign-up off; passwords 10+ with a-z, A-Z, 0-9; redirects allowed to ${appUrl}`);

step('Server functions');
console.log(cli(['functions', 'deploy', 'api', 'join', 'team', '--project-ref', ref, '--use-api', '--no-verify-jwt']).split('\n').filter(l => /Deployed/i.test(l)).join('\n') || 'deployed');
const health = await fetch(`https://${ref}.supabase.co/functions/v1/api/legal`, { headers: { 'x-region': 'eu-central-1' } });
console.log(`api answers: HTTP ${health.status}`);

step('Front-end settings');
for (const f of ['vercel.json', 'web/.env.example']) {
  const s = fs.readFileSync(f, 'utf8');
  if (s.includes(OLD_REF)) { fs.writeFileSync(f, s.split(OLD_REF).join(ref)); console.log(`${f}: now points at ${ref}`); }
}
const keys = await mgmt('GET', `/projects/${ref}/api-keys?reveal=false`).catch(() => []);
const publishable = (keys || []).find(k => k.type === 'publishable')?.api_key || (keys || []).find(k => k.name === 'anon')?.api_key;
console.log(`\nDone. In Vercel → Settings → Environment Variables set, then redeploy:
  VITE_SUPABASE_URL=https://${ref}.supabase.co
  VITE_SUPABASE_PUBLISHABLE_KEY=${publishable || '(Project settings → API keys → publishable key)'}
Commit the changed vercel.json. Next: copy the data with supabase/scripts/copy-data.mjs${env.SETUP_CODE ? ', or open /setup to create the first admin' : ''}.`);
