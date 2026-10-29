// Once the real first admin exists the setup path is closed, so tests make their own admin the same way setup does:
// an Auth user (admin API, service key fetched with the management token), a profile and a staff row.
// The tests delete it again by email.
export async function makeTestAdmin({ url, mgmt, ref, email, password, sql }) {
  const keys = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${mgmt}` } })).json();
  const sk = keys.find(k => k.name === 'service_role')?.api_key;
  if (!sk) throw new Error('service_role key not available to this access token');
  const r = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: sk, Authorization: `Bearer ${sk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: 'Test Admin' } }) });
  const user = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(user));
  await sql(`insert into public.profiles (id, full_name, email) values ('${user.id}', 'Test Admin', '${email}');
    insert into public.staff (user_id, role) values ('${user.id}', 'admin');`);
}
