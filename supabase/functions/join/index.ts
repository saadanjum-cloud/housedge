// Public: accept an invite link (set a password), or create the very first admin with the setup code.
// Accounts are only ever created here, on the server; public sign-up is switched off in Auth settings.
import { db, Fail, serve, sha256, sameSecret, str, password, email, createClientOrg, signupMode, STARTER_BUDGET } from '../_shared/util.ts';

async function openInvite(token: unknown) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw new Fail('This invite link is not valid.', 404);
  const { data: inv } = await db.from('invites').select('id, email, org_id, role, expires_at, accepted_at, orgs(name)').eq('token_hash', await sha256(token)).maybeSingle();
  if (!inv || inv.accepted_at || new Date(inv.expires_at) < new Date()) throw new Fail('This invite link has expired or was already used. Ask for a new one.', 404);
  return inv as typeof inv & { orgs: { name: string } | null };
}

async function createAccount(emailAddr: string, pw: string, fullName: string | null) {
  const { data, error } = await db.auth.admin.createUser({ email: emailAddr, password: pw, email_confirm: true, user_metadata: { full_name: fullName } });
  if (error) {
    if (/already been registered|already exists/i.test(error.message)) throw new Fail('An account with this email already exists. Please sign in instead.', 409);
    throw new Fail(error.message);
  }
  await db.from('profiles').insert({ id: data.user.id, full_name: fullName, email: emailAddr });
  return data.user.id;
}

serve(async (_req, body) => {
  if (body.action === 'state') {
    const { count } = await db.from('staff').select('user_id', { count: 'exact', head: true });
    return { needsSetup: count === 0 };
  }

  // Self sign-up from /onboarding. The team decides in the admin console whether it is open, and whether
  // new accounts work at once (auto) or wait for approval. New companies start with the starter AI budget.
  if (body.action === 'signup-state') return { mode: await signupMode() };

  if (body.action === 'signup') {
    const mode = await signupMode();
    if (mode === 'off') throw new Fail('Sign-up is closed. Please contact us to get an account.', 403);
    if (body.website2) throw new Fail('Please try again.'); // hidden field only bots fill in
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await db.from('signups').select('id', { count: 'exact', head: true }).gte('created_at', since);
    if ((count ?? 0) >= 20) throw new Fail('Too many sign-ups right now. Please try again in an hour or contact us.', 429);
    const emailAddr = email(body.email);
    const fullName = str(body.fullName, 120, 'Your name', true);
    const company = str(body.company, 160, 'Company name', true)!;
    const website = str(body.website, 200, 'Company website');
    const userId = await createAccount(emailAddr, password(body.password), fullName);
    let orgId = null;
    if (mode === 'auto') orgId = await createClientOrg({ name: company, website, monthly_budget: STARTER_BUDGET }, userId, null);
    await db.from('signups').insert({ user_id: userId, email: emailAddr, full_name: fullName, company, website, org_id: orgId,
      status: mode === 'auto' ? 'approved' : 'pending', decided_at: mode === 'auto' ? new Date().toISOString() : null });
    return { ok: true, email: emailAddr, pending: mode !== 'auto' };
  }

  if (body.action === 'inspect') {
    const inv = await openInvite(body.token);
    return { email: inv.email, company: inv.orgs?.name ?? null, team: !inv.org_id, role: inv.role };
  }

  if (body.action === 'accept') {
    const inv = await openInvite(body.token);
    const pw = password(body.password);
    const fullName = str(body.fullName, 120, 'Your name', true);
    // Claim the invite first, so the same link cannot create two accounts at once.
    const { data: claimed } = await db.from('invites').update({ accepted_at: new Date().toISOString() }).eq('id', inv.id).is('accepted_at', null).select('id');
    if (!claimed?.length) throw new Fail('This invite link was already used.', 409);
    try {
      const userId = await createAccount(inv.email, pw, fullName);
      if (inv.org_id) await db.from('org_members').insert({ org_id: inv.org_id, user_id: userId, role: inv.role === 'owner' ? 'owner' : 'member' });
      else await db.from('staff').insert({ user_id: userId, role: inv.role === 'admin' ? 'admin' : 'member' });
    } catch (e) {
      await db.from('invites').update({ accepted_at: null }).eq('id', inv.id); // let them try again
      throw e;
    }
    return { ok: true, email: inv.email };
  }

  if (body.action === 'setup') {
    const code = Deno.env.get('SETUP_CODE') || '';
    if (code.length < 16) throw new Fail('Setup is switched off: no setup code is set on the server.', 503);
    const { count } = await db.from('staff').select('user_id', { count: 'exact', head: true });
    if (count !== 0) throw new Fail('Setup is already done. Please sign in.', 409);
    if (!sameSecret(String(body.setupCode || ''), code)) throw new Fail('Wrong setup code.', 403);
    const emailAddr = str(body.email, 200, 'Email', true)!.toLowerCase();
    const userId = await createAccount(emailAddr, password(body.password), str(body.fullName, 120, 'Your name', true));
    await db.from('staff').insert({ user_id: userId, role: 'admin' });
    return { ok: true, email: emailAddr };
  }

  throw new Fail('Unknown action.');
});
