// Postgres access with the same small helpers the old server used (all / get / run with ? placeholders),
// so the ported logic reads like the original. Every request runs inside one transaction:
//   asUser(user, fn)  - as the signed-in person: row level security decides what is visible (the normal case)
//   asService(fn)     - with full rights, ONLY after the handler has checked who the caller is
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
const als = new AsyncLocalStorage();

// '?' placeholders -> $1, $2 ... (none of our queries use the jsonb '?' operator).
const conv = q => { let i = 0; return q.replace(/\?/g, () => '$' + ++i); };
const tx = () => {
  const t = als.getStore();
  if (!t) throw new Error('Database used outside a request transaction');
  return t;
};

export const all = (q, ...p) => tx().unsafe(conv(q), p);
export const get = async (q, ...p) => (await all(q, ...p))[0];
export const run = (q, ...p) => all(q, ...p);
export const parseJSON = (s, fb) => {
  if (s == null) return fb;
  if (typeof s !== 'string') return s; // jsonb and arrays arrive already parsed
  try { return JSON.parse(s); } catch { return fb; }
};

// Also returns the person's team role, read in the same round trip, so a request needs one connection.
export function asUser(user, fn) {
  return sql.begin(async t => {
    const [r] = await t.unsafe(`select (select role from public.staff where user_id = $3::uuid) role,
      set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('role', 'authenticated', true)`,
    [JSON.stringify({ sub: user.id, role: 'authenticated', email: user.email }), user.id, user.id]);
    return als.run(t, () => fn(r.role || null));
  });
}
export const asService = fn => sql.begin(t => als.run(t, fn));
