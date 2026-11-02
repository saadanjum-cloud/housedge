// Postgres access with the same small helpers the old server used (all / get / run with ? placeholders),
// so the ported logic reads like the original. Every request runs inside one transaction:
//   asUser(user, fn)  - as the signed-in person: row level security decides what is visible (the normal case)
//   asService(fn)     - with full rights, ONLY after the handler has checked who the caller is
// An asService block inside a request stays on the request's own connection (it switches the role for the block
// and switches back): a request never needs a second connection from the pool, so a handful of requests at the
// same time cannot deadlock the worker. Outside a request (background work after the response) it opens its own.
import postgres from 'npm:postgres@3.4.5';
import { AsyncLocalStorage } from 'node:async_hooks';

// The connection pooler (transaction mode) is the recommended way in from functions; fall back to the direct URL.
const sql = postgres(Deno.env.get('DB_POOL_URL') || Deno.env.get('SUPABASE_DB_URL'), {
  prepare: false, max: 4, idle_timeout: 20, connect_timeout: 10, // fail fast instead of hanging on a bad connection
  types: {
    int8: { to: 20, from: [20], serialize: x => String(x), parse: x => Number(x) }, // ids and counts as numbers
    numeric: { to: 1700, from: [1700], serialize: x => String(x), parse: x => Number(x) }, // money as numbers
    date: { to: 1082, from: [1082], serialize: x => x, parse: x => x }, // days stay 'YYYY-MM-DD'
    timestamptz: { to: 1184, from: [1184], serialize: x => x, parse: x => new Date(x).toISOString() },
  },
});
// Store: { t: transaction, open: boolean, user: { claims, sub } | null (null = full rights) }
const als = new AsyncLocalStorage();

// '?' placeholders -> $1, $2 ... (none of our queries use the jsonb '?' operator).
const conv = q => { let i = 0; return q.replace(/\?/g, () => '$' + ++i); };
const tx = () => {
  const s = als.getStore();
  if (!s?.open) throw new Error('Database used outside a request transaction');
  return s.t;
};

export const all = (q, ...p) => tx().unsafe(conv(q), p);
export const get = async (q, ...p) => (await all(q, ...p))[0];
export const run = (q, ...p) => all(q, ...p);
export const parseJSON = (s, fb) => {
  if (s == null) return fb;
  if (typeof s !== 'string') return s; // jsonb and arrays arrive already parsed
  try { return JSON.parse(s); } catch { return fb; }
};

const inTx = (user, fn) => sql.begin(async t => {
  const store = { t, open: true, user };
  try { return await als.run(store, fn); } finally { store.open = false; }
});
const asPerson = (t, { claims, sub }) => t.unsafe(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('role', 'authenticated', true)`, [claims, sub]);
// Back to the connection's own role (the table owner, trusted): no claims, so private.is_trusted() is true.
const asOwner = t => t.unsafe(`select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true), set_config('role', 'postgres', true)`);

// Also returns the person's team role, read in the same round trip, so a request needs one connection.
export function asUser(user, fn) {
  const claims = JSON.stringify({ sub: user.id, role: 'authenticated', email: user.email });
  return inTx({ claims, sub: user.id }, async () => {
    const [r] = await tx().unsafe(`select (select role from public.staff where user_id = $1::uuid) role, set_config('request.jwt.claims', $2, true),
      set_config('request.jwt.claim.sub', $1, true), set_config('role', 'authenticated', true)`, [user.id, claims]);
    return fn(r.role || null);
  });
}
export async function asService(fn) {
  const s = als.getStore();
  if (!s?.open) return inTx(null, fn);
  if (!s.user) return fn(); // already running with full rights
  await asOwner(s.t);
  try { return await fn(); } finally { await asPerson(s.t, s.user); }
}
