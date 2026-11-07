// Self-check of brand matching (no database): run with  deno run -A --node-modules-dir=none --no-lock supabase/tests/extract.mjs
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'x'); Deno.env.set('SUPABASE_DB_URL', 'postgres://u:p@127.0.0.1:1/db');
const root = new URL('../..', import.meta.url).href.replace(/\/$/, '');
const { resolve } = await import(`${root}/supabase/functions/api/extract.js`);
const assert = (c, m) => { if (!c) throw new Error('FAIL ' + m); console.log('ok', m); };
const brands = [{ id: 1, name: 'Oura', domain: 'ouraring.com', aliases: [], is_own: true }, { id: 2, name: 'Samsung', domain: 'samsung.com', aliases: ['Samsung Galaxy Ring'] },
  { id: 3, name: 'RingConn', domain: 'ringconn.com', aliases: [] }];
const id = name => resolve([{ name }], brands)[0].brand_id;
assert(id('Oura') === 1, 'exact name');
assert(id('Oura Ring 5') === 1, 'product line "Oura Ring 5" is Oura');
assert(id('Oura Ring Gen 4') === 1, 'product line with generation');
assert(id('Samsung Galaxy Ring') === 2, 'alias');
assert(id('Galaxy Ring') === null, 'short form without the brand is not matched');
assert(id('RingConn Gen 2') === 3, 'another product line');
assert(id('Ourasome') === null, 'a different word that starts the same is not matched');
assert(id('Amazfit Helio Ring') === null, 'untracked brand stays untracked');
console.log('all good');
Deno.exit(0);
