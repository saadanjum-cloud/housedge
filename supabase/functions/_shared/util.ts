// Shared by every Edge Function: CORS for the app's own origins, a service-role client, the signed-in caller,
// JSON in/out and readable errors. Secrets come from Supabase function secrets, never from the request.
import { createClient, type User } from 'npm:@supabase/supabase-js@2';

export const APP_URL = (Deno.env.get('APP_URL') || 'http://localhost:5173').replace(/\/$/, '');
const ORIGINS = (Deno.env.get('APP_ORIGINS') || APP_URL).split(',').map(s => s.trim()).filter(Boolean);

const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default;
export const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

export class Fail extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-region',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

// The signed-in user making the request, verified with Supabase Auth (null when signed out).
export async function caller(req: Request): Promise<User | null> {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const { data } = await db.auth.getUser(jwt);
  return data?.user ?? null;
}

export async function requireAdmin(req: Request): Promise<User> {
  const user = await caller(req);
  if (!user) throw new Fail('Please sign in.', 401);
  const { data } = await db.from('staff').select('role').eq('user_id', user.id).maybeSingle();
  if (data?.role !== 'admin') throw new Fail('Only a Housedge admin can do this.', 403);
  return user;
}

// A new client company with its owner (used by admin "New client", and by self sign-up once accepted).
export async function createClientOrg(fields: Record<string, unknown>, ownerId: string | null, by: string | null) {
  const { data: org, error } = await db.from('orgs').insert(fields).select('id').single();
  if (error) throw new Fail(error.message);
  await db.from('org_health').insert({ org_id: org.id, health: 'good', updated_by: by });
  if (ownerId) await db.from('org_members').insert({ org_id: org.id, user_id: ownerId, role: 'owner' });
  return org.id as string;
}

// Monthly AI budget (USD) a self-signed-up client starts with: enough for a first check. Admins change it per client.
export const STARTER_BUDGET = 10;

// How self sign-up on /onboarding behaves: auto (account works at once), approve (team accepts first), off.
export async function signupMode(): Promise<'auto' | 'approve' | 'off'> {
  const { data } = await db.from('settings').select('value').eq('key', 'signup_mode').maybeSingle();
  return ['auto', 'approve', 'off'].includes(data?.value) ? data!.value : 'auto';
}

const hex = (buf: ArrayBuffer | Uint8Array) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export const newToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
export function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Input checks (the database has its own checks too).
export const str = (v: unknown, max: number, label: string, required = false) => {
  if (v == null || v === '') { if (required) throw new Fail(`${label} is required.`); return null; }
  if (typeof v !== 'string') throw new Fail(`${label} must be text.`);
  const s = v.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (required && !s) throw new Fail(`${label} is required.`);
  if (s.length > max) throw new Fail(`${label} is too long (max ${max} characters).`);
  return s || null;
};
export const email = (v: unknown) => {
  const e = str(v, 200, 'Email', true)!.toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Fail('Please enter a valid email address.');
  return e;
};
// Same rule as the project's Auth settings: 10+ characters with upper case, lower case and a digit.
export const password = (v: unknown) => {
  if (typeof v !== 'string' || v.length < 10 || v.length > 72) throw new Fail('Password must be 10 to 72 characters.');
  if (!/[a-z]/.test(v) || !/[A-Z]/.test(v) || !/[0-9]/.test(v)) throw new Fail('Password needs an upper-case letter, a lower-case letter and a number.');
  return v;
};

export function serve(fn: (req: Request, body: Record<string, unknown>) => Promise<unknown>) {
  Deno.serve(async req => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
    if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
    try {
      const body = await req.json().catch(() => ({}));
      return json(await fn(req, body && typeof body === 'object' ? body : {}));
    } catch (e) {
      if (e instanceof Fail) return json({ error: e.message }, e.status);
      const ref = crypto.randomUUID().slice(0, 8);
      console.error(`[error ${ref}]`, e);
      return json({ error: `Something went wrong on our side. Reference: ${ref}` }, 500);
    }
  });
}
