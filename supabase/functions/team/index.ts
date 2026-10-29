// Admins only: onboard a client company, invite people, issue a password-reset link, remove a user.
// Links are returned to the admin to send. (Supabase's built-in email only reaches your own Supabase team;
// add a custom SMTP provider later and these can be emailed automatically.)
import { APP_URL, db, Fail, newToken, requireAdmin, serve, sha256, str, email, createClientOrg, signupMode, STARTER_BUDGET } from '../_shared/util.ts';

async function invite(emailAddr: string, orgId: string | null, role: string, by: string) {
  const token = newToken();
  const { error } = await db.from('invites').insert({ token_hash: await sha256(token), email: emailAddr, org_id: orgId, role, invited_by: by });
  if (error) throw new Fail(error.message);
  return { link: `${APP_URL}/join/${token}`, email: emailAddr, expiresInDays: 7 };
}

const budget = (v: unknown) => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > 100000) throw new Fail('Monthly AI budget must be between 0 and 100000.');
  return Math.round(n * 100) / 100;
};

serve(async (req, body) => {
  const me = await requireAdmin(req);

  if (body.action === 'create-client') {
    const name = str(body.name, 160, 'Company name', true);
    const owner = email(body.ownerEmail);
    const orgId = await createClientOrg({
      name, website: str(body.website, 200, 'Website'), country: str(body.country, 60, 'Country'), industry: str(body.industry, 120, 'Industry'),
      monthly_budget: budget(body.monthlyBudget), fee: body.fee == null || body.fee === '' ? null : budget(body.fee),
      currency: ['EUR', 'USD', 'GBP', 'SEK'].includes(String(body.currency)) ? body.currency : 'EUR',
    }, null, me.id);
    return { orgId, invite: await invite(owner, orgId, 'owner', me.id) };
  }

  // Self sign-ups from /onboarding: list them, switch the mode, accept or turn down.
  if (body.action === 'signups') {
    const { data } = await db.from('signups').select('id, email, full_name, company, website, status, org_id, created_at, decided_at')
      .order('created_at', { ascending: false }).limit(50);
    return { mode: await signupMode(), signups: data || [] };
  }
  if (body.action === 'signup-mode') {
    const mode = String(body.mode);
    if (!['auto', 'approve', 'off'].includes(mode)) throw new Fail('Unknown sign-up mode.');
    await db.from('settings').upsert({ key: 'signup_mode', value: mode });
    return { mode };
  }
  if (body.action === 'approve-signup' || body.action === 'reject-signup') {
    const { data: s } = await db.from('signups').select('*').eq('id', Number(body.id)).maybeSingle();
    if (!s || s.status !== 'pending') throw new Fail('This sign-up was already handled.', 409);
    // Claim it first, so two admins clicking at once cannot create two companies.
    const { data: claimed } = await db.from('signups').update({ status: body.action === 'approve-signup' ? 'approved' : 'rejected', decided_by: me.id, decided_at: new Date().toISOString() })
      .eq('id', s.id).eq('status', 'pending').select('id');
    if (!claimed?.length) throw new Fail('This sign-up was already handled.', 409);
    if (body.action === 'reject-signup') {
      if (s.user_id) await db.auth.admin.deleteUser(s.user_id); // their login stops working
      return { ok: true };
    }
    if (!s.user_id) throw new Fail('This person deleted their account.', 409);
    const orgId = await createClientOrg({ name: s.company, website: s.website, monthly_budget: STARTER_BUDGET }, s.user_id, me.id);
    await db.from('signups').update({ org_id: orgId }).eq('id', s.id);
    return { ok: true, orgId };
  }

  if (body.action === 'invite') {
    const orgId = body.orgId == null ? null : str(body.orgId, 40, 'Company', true);
    if (orgId) {
      const { data } = await db.from('orgs').select('id').eq('id', orgId).maybeSingle();
      if (!data) throw new Fail('Unknown company.', 404);
    }
    const role = orgId ? (body.role === 'owner' ? 'owner' : 'member') : (body.role === 'admin' ? 'admin' : 'member');
    return invite(email(body.email), orgId, role, me.id);
  }

  if (body.action === 'reset-link') {
    const userId = str(body.userId, 40, 'User', true)!;
    const { data: u } = await db.auth.admin.getUserById(userId);
    if (!u?.user?.email) throw new Fail('Unknown user.', 404);
    const { data, error } = await db.auth.admin.generateLink({ type: 'recovery', email: u.user.email, options: { redirectTo: `${APP_URL}/reset-password` } });
    if (error) throw new Fail(error.message);
    return { link: data.properties.action_link, email: u.user.email };
  }

  if (body.action === 'remove-user') {
    const userId = str(body.userId, 40, 'User', true)!;
    if (userId === me.id) throw new Fail('You cannot remove yourself.');
    const { error } = await db.auth.admin.deleteUser(userId);
    if (error) throw new Fail(error.message);
    return { ok: true };
  }

  throw new Fail('Unknown action.');
});
