// Copies ALL Housedge data from one Supabase project to another that was prepared with new-project.mjs:
//   - user accounts (auth.users + auth.identities, including password hashes, so everyone keeps their login)
//   - every table in the public schema (clients, projects, answers, reports, work log, spend history…), in foreign-key
//     order, with ids kept, then id counters moved past the copied rows
//   - every uploaded client file (storage bucket client-files)
// Then it compares row counts table by table. Run with --dry-run first: it only reads and prints what it would copy.
// The target must be empty (except the defaults the migrations create); the script refuses otherwise.
//
// Usage (secrets from the environment only):
//   OLD_DB_URL=postgresql://postgres.<old-ref>:<pw>@<host>:5432/postgres   session pooler URL of the OLD project
//   NEW_DB_URL=postgresql://postgres.<new-ref>:<pw>@<host>:5432/postgres   session pooler URL of the NEW project
//   OLD_REF / NEW_REF and OLD_SERVICE_KEY / NEW_SERVICE_KEY                 (for files; Project settings → API keys → secret)
//   node supabase/scripts/copy-data.mjs --dry-run
//   node supabase/scripts/copy-data.mjs
import postgres from 'postgres';

const env = process.env;
const dry = process.argv.includes('--dry-run');
for (const k of ['OLD_DB_URL', 'NEW_DB_URL']) if (!env[k]) { console.error(`Missing ${k}. See the comment at the top of this file.`); process.exit(2); }
const opts = { prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} };
const src = postgres(env.OLD_DB_URL, opts);
const dst = postgres(env.NEW_DB_URL, opts);
const CHUNK = 300;

// Defaults the migrations insert in a fresh project; replaced by the copied rows.
const DEFAULT_ROWS = { settings: true, site_info: true };

async function columns(db, schema, table) {
  // Copyable columns: not generated (identity "always" columns are kept and inserted with OVERRIDING SYSTEM VALUE).
  return (await db`SELECT column_name, is_identity = 'YES' AS identity FROM information_schema.columns
    WHERE table_schema = ${schema} AND table_name = ${table} AND is_generated = 'NEVER' ORDER BY ordinal_position`);
}

// Public tables ordered so that every table comes after the tables it references.
async function tableOrder() {
  const tables = (await src`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'`).map(r => r.relname);
  const deps = await src`SELECT tc.relname child, pc.relname parent FROM pg_constraint k
    JOIN pg_class tc ON tc.oid = k.conrelid JOIN pg_namespace tn ON tn.oid = tc.relnamespace
    JOIN pg_class pc ON pc.oid = k.confrelid JOIN pg_namespace pn ON pn.oid = pc.relnamespace
    WHERE k.contype = 'f' AND tn.nspname = 'public' AND pn.nspname = 'public' AND tc.relname <> pc.relname`;
  const order = [], seen = new Set();
  const visit = (t, path = new Set()) => {
    if (seen.has(t)) return;
    if (path.has(t)) throw new Error(`Foreign-key cycle at ${t}`);
    path.add(t);
    for (const d of deps.filter(x => x.child === t)) visit(d.parent, path);
    seen.add(t); order.push(t);
  };
  for (const t of tables.sort()) visit(t);
  return order;
}

async function copyTable(tx, schema, table, label = table) {
  const srcCols = await columns(src, schema, table);
  const dstCols = new Set((await columns(dst, schema, table)).map(c => c.column_name));
  const cols = srcCols.filter(c => dstCols.has(c.column_name));
  const names = cols.map(c => c.column_name);
  const total = (await src.unsafe(`SELECT count(*)::int n FROM ${schema}.${table}`))[0].n;
  if (dry) { console.log(`  ${label.padEnd(28)} ${String(total).padStart(7)} rows`); return { table: label, total }; }
  const list = names.map(n => `"${n}"`).join(', ');
  const override = cols.some(c => c.identity) ? ' OVERRIDING SYSTEM VALUE' : '';
  // Rows are read in pages, so large tables never sit in memory at once.
  for (let offset = 0; offset < total; offset += CHUNK) {
    const rows = await src.unsafe(`SELECT ${list} FROM ${schema}.${table} ORDER BY 1 LIMIT ${CHUNK} OFFSET ${offset}`);
    if (!rows.length) break;
    const params = [], values = rows.map(r => `(${names.map(n => { params.push(r[n]); return `$${params.length}`; }).join(', ')})`);
    await tx.unsafe(`INSERT INTO ${schema}.${table} (${list})${override} VALUES ${values.join(', ')}`, params);
  }
  for (const c of cols.filter(x => x.identity)) {
    await tx.unsafe(`SELECT setval(pg_get_serial_sequence('${schema}.${table}', '${c.column_name}'), GREATEST((SELECT COALESCE(MAX("${c.column_name}"), 0) FROM ${schema}.${table}), 1))`);
  }
  console.log(`  ${label.padEnd(28)} ${String(total).padStart(7)} rows copied`);
  return { table: label, total };
}

async function copyFiles() {
  const files = await src`SELECT name, metadata->>'mimetype' AS type FROM storage.objects WHERE bucket_id = 'client-files' ORDER BY name`;
  if (dry || !files.length) { console.log(`  client-files: ${files.length} files${dry ? '' : ' (nothing to copy)'}`); return files.length; }
  for (const k of ['OLD_REF', 'NEW_REF', 'OLD_SERVICE_KEY', 'NEW_SERVICE_KEY']) if (!env[k]) throw new Error(`Missing ${k} (needed to copy ${files.length} uploaded files).`);
  const auth = key => ({ apikey: key, Authorization: `Bearer ${key}` });
  for (const f of files) {
    const path = f.name.split('/').map(encodeURIComponent).join('/');
    const down = await fetch(`https://${env.OLD_REF}.supabase.co/storage/v1/object/client-files/${path}`, { headers: auth(env.OLD_SERVICE_KEY) });
    if (!down.ok) throw new Error(`Download failed for ${f.name}: HTTP ${down.status}`);
    const up = await fetch(`https://${env.NEW_REF}.supabase.co/storage/v1/object/client-files/${path}`, {
      method: 'POST', headers: { ...auth(env.NEW_SERVICE_KEY), 'Content-Type': f.type || 'application/octet-stream', 'x-upsert': 'true' }, body: await down.arrayBuffer() });
    if (!up.ok) throw new Error(`Upload failed for ${f.name}: HTTP ${up.status} ${(await up.text()).slice(0, 200)}`);
  }
  console.log(`  client-files: ${files.length} files copied`);
  return files.length;
}

try {
  const order = await tableOrder();
  console.log(dry ? 'DRY RUN: nothing is written.\n' : 'Copying.\n');
  if (!dry) {
    const busy = [];
    for (const t of order) if (!DEFAULT_ROWS[t] && (await dst.unsafe(`SELECT EXISTS (SELECT 1 FROM public.${t}) AS x`))[0].x) busy.push(t);
    if ((await dst`SELECT EXISTS (SELECT 1 FROM auth.users) AS x`)[0].x) busy.push('auth.users');
    if (busy.length) throw new Error(`The new project already has data in: ${busy.join(', ')}. Copy only into a freshly prepared project.`);
  }
  const results = [];
  console.log('User accounts');
  const runCopy = async tx => {
    // Triggers are switched off for the copy: rows arrive exactly as they were (org ids, ratings' authors, dates).
    if (!dry) await tx`SET LOCAL session_replication_role = replica`;
    results.push(await copyTable(tx, 'auth', 'users', 'auth.users'));
    results.push(await copyTable(tx, 'auth', 'identities', 'auth.identities'));
    console.log('Tables');
    for (const t of Object.keys(DEFAULT_ROWS)) if (!dry) await tx.unsafe(`DELETE FROM public.${t}`);
    for (const t of order) results.push(await copyTable(tx, 'public', t));
  };
  if (dry) await runCopy(src); else await dst.begin(runCopy); // one transaction: all of it or nothing
  console.log('Files');
  await copyFiles();
  if (!dry) {
    console.log('\nChecking row counts');
    let bad = 0;
    for (const r of results) {
      const [schema, table] = r.table.includes('.') ? r.table.split('.') : ['public', r.table];
      const n = (await dst.unsafe(`SELECT count(*)::int n FROM ${schema}.${table}`))[0].n;
      if (n !== r.total) { bad++; console.log(`  MISMATCH ${r.table}: ${r.total} in the old project, ${n} in the new one`); }
    }
    console.log(bad ? `\n${bad} table(s) differ. Check the messages above.` : `\nAll ${results.length} tables match. Everyone keeps their login; sessions on the old site need a fresh sign-in.`);
    process.exitCode = bad ? 1 : 0;
  }
} catch (e) {
  console.error(`\nStopped: ${e.message}${dry ? '' : '\nNothing was written (the copy runs in one transaction).'}`);
  process.exitCode = 1;
} finally {
  await src.end(); await dst.end();
}
