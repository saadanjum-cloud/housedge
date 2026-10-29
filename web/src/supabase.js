// Supabase: sign-in and the account functions. Everything else still goes through api() in lib.js.
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);

// Functions run next to the database (Frankfurt is the nearest function region to Stockholm).
export const REGION = 'eu-central-1';

// Calls an account function (join / team) and returns its JSON, or throws its error message.
export async function fn(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body, region: REGION });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error || error.message);
  }
  return data;
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email: String(email || '').trim().toLowerCase(), password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
}
