// Runs a SQL file against the Supabase project through the Management API (no psql or Docker needed).
// Usage: SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... node supabase/tests/run.mjs supabase/tests/rls.sql
import fs from 'node:fs';
const [file] = process.argv.slice(2);
const { SUPABASE_ACCESS_TOKEN: token, SUPABASE_PROJECT_REF: ref } = process.env;
if (!file || !token || !ref) { console.error('usage: SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... node supabase/tests/run.mjs <file.sql>'); process.exit(2); }
// Retries a dropped connection (the SQL runs in one transaction, so a failed attempt changed nothing).
let res;
for (let i = 1; ; i++) {
  try {
    res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: fs.readFileSync(file, 'utf8') }), signal: AbortSignal.timeout(120000),
    });
    break;
  } catch (e) { if (i >= 3) throw e; console.error(`connection failed (${e.cause?.code || e.message}), retrying…`); }
}
const body = await res.text();
console.log(res.ok ? body : `HTTP ${res.status}: ${body}`);
process.exit(res.ok && /PASSED/.test(body) ? 0 : 1);
