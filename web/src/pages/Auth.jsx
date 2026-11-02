import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase, fn, signIn } from '../supabase.js';
import { api, nextPath, signOut } from '../lib.js';
import { ErrorBox } from '../ui.jsx';
import { LegalLinks } from './Legal.jsx';
import { Aurora, Logo } from '../motion.jsx';

function Frame({ title, subtitle, children }) {
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-4">
      <Aurora />
      <div className="rise relative w-full max-w-[400px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="pop"><Logo size={64} draw /></span>
          <h1 className="mt-6 text-[32px] font-bold leading-tight tracking-display">{title}</h1>
          {subtitle && <p className="mt-2 text-[15px] text-muted">{subtitle}</p>}
        </div>
        <div className="card glass p-7 shadow-lift">{children}</div>
        <p className="mt-6 text-center text-xs text-muted">Housedge measures what AI assistants say about brands.<br />It never tries to change it.</p>
        <LegalLinks className="mt-4 flex flex-col items-center text-center" />
      </div>
    </div>
  );
}

function Form({ fields, submit, button, to = '/' }) {
  const [v, setV] = useState(() => Object.fromEntries(fields.filter(f => f.value != null).map(f => [f.name, f.value])));
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const go = async e => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await submit(v); window.location.href = to; } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <form onSubmit={go} className="flex flex-col gap-3">
      {fields.map(f => (
        <div key={f.name}>
          <label className="label" htmlFor={f.name}>{f.label}</label>
          <input id={f.name} className="input" type={f.type || 'text'} autoComplete={f.auto} required={!f.optional}
            value={v[f.name] ?? f.value ?? ''} disabled={f.disabled} onChange={e => setV({ ...v, [f.name]: e.target.value })} />
        </div>
      ))}
      <ErrorBox error={err} />
      <button className="btn-primary mt-2 w-full py-3 text-[15px]" disabled={busy}>{busy ? 'Please wait…' : button}</button>
    </form>
  );
}

const NEW_PASSWORD = 'Password (10+ characters, with A-Z, a-z and 0-9)';
const samePasswords = v => { if (v.password !== v.confirm) throw new Error('The two passwords do not match.'); };

export function Login() {
  return (
    <Frame title="Sign in" subtitle="Welcome back to Housedge.">
      <Form button="Sign in" to={nextPath()} submit={v => signIn(v.email, v.password)} fields={[
        { name: 'email', label: 'Email', type: 'email', auto: 'email' },
        { name: 'password', label: 'Password', type: 'password', auto: 'current-password' },
      ]} />
      <a href="/reset" className="mt-4 block text-center text-[13px] text-accent hover:underline">Forgot password?</a>
    </Frame>
  );
}

// The team's own sign-in. Same accounts as /login, but a client account is turned away and signed out again.
// (The admin pages and every admin request are also checked on the server; this page is not the only lock.)
export function AdminLogin() {
  return (
    <Frame title="Team sign in" subtitle="For the Housedge team only.">
      <Form button="Sign in" to="/admin" submit={async v => {
        await signIn(v.email, v.password);
        const s = await api('/auth/state');
        if (s.user?.role !== 'admin' && s.user?.role !== 'member') {
          await supabase.auth.signOut();
          throw new Error('This sign-in is for the Housedge team. Clients sign in at /login.');
        }
      }} fields={[
        { name: 'email', label: 'Email', type: 'email', auto: 'email' },
        { name: 'password', label: 'Password', type: 'password', auto: 'current-password' },
      ]} />
      <a href="/reset" className="mt-4 block text-center text-[13px] text-accent hover:underline">Forgot password?</a>
    </Frame>
  );
}

// /onboarding: a new client creates their account, then goes through setup. Whether this is open, and whether
// new accounts work at once or wait for the team, is set in the admin console.
export function SignUp() {
  const [mode, setMode] = useState(null);
  useEffect(() => { fn('join', { action: 'signup-state' }).then(r => setMode(r.mode), () => setMode('off')); }, []);
  if (!mode) return <Frame title="Create your account" subtitle="One moment…" />;
  if (mode === 'off') return (
    <Frame title="Accounts by invitation" subtitle="Housedge accounts are set up by our team.">
      <a href="/website#contact" className="btn-primary w-full justify-center py-3 text-[15px]">Contact us</a>
      <a href="/login" className="mt-4 block text-center text-[13px] text-accent hover:underline">Already have an account? Sign in</a>
    </Frame>
  );
  return (
    <Frame title="Create your account" subtitle={mode === 'approve' ? 'Our team reviews every new account before it opens.' : 'Then we set up your brand together, step by step.'}>
      <Form button="Create account" submit={async v => {
        samePasswords(v);
        await supabase.auth.signOut();
        await fn('join', { action: 'signup', fullName: v.name, email: v.email, company: v.company, website: v.website, password: v.password });
        await signIn(v.email, v.password);
      }} fields={[
        { name: 'name', label: 'Your name', auto: 'name' },
        { name: 'email', label: 'Work email', type: 'email', auto: 'email' },
        { name: 'company', label: 'Company name', auto: 'organization' },
        { name: 'website', label: 'Company website (optional)', auto: 'url', optional: true },
        { name: 'password', label: NEW_PASSWORD, type: 'password', auto: 'new-password' },
        { name: 'confirm', label: 'Repeat the password', type: 'password', auto: 'new-password' },
      ]} />
      <a href="/login" className="mt-4 block text-center text-[13px] text-accent hover:underline">Already have an account? Sign in</a>
    </Frame>
  );
}

// Forgotten password: resets are issued by a Housedge admin (Admin → client → People → Reset link).
export function Reset() {
  return (
    <Frame title="Reset password" subtitle="For your security, password resets are issued by your Housedge contact.">
      <p className="text-[14px] leading-relaxed text-ink2">Ask them for a reset link. It opens a page where you choose a new password, and it works once.</p>
      <a href="/login" className="mt-5 block text-center text-[13px] text-accent hover:underline">Back to sign in</a>
    </Frame>
  );
}

// Opened from a reset link: Supabase signs the person in from the link, then they choose a new password.
export function ResetPassword() {
  const [ready, setReady] = useState(null);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => { if (session) setReady(true); });
    const t = setTimeout(() => supabase.auth.getSession().then(({ data: d }) => setReady(!!d.session)), 1500);
    return () => { data.subscription.unsubscribe(); clearTimeout(t); };
  }, []);
  if (ready === null) return <Frame title="Opening your reset link…" />;
  if (!ready) return <Frame title="This link does not work" subtitle="It may have expired or been used already. Ask your Housedge contact for a new one."><a href="/login" className="block text-center text-[13px] text-accent hover:underline">Back to sign in</a></Frame>;
  return (
    <Frame title="Choose a new password">
      <Form button="Save and continue" submit={async v => { samePasswords(v); const { error } = await supabase.auth.updateUser({ password: v.password }); if (error) throw new Error(error.message); }} fields={[
        { name: 'password', label: NEW_PASSWORD, type: 'password', auto: 'new-password' },
        { name: 'confirm', label: 'Repeat the password', type: 'password', auto: 'new-password' },
      ]} />
    </Frame>
  );
}

export function Setup() {
  return (
    <Frame title="Create the first account" subtitle="This account will be the admin. You can invite colleagues afterwards.">
      <Form button="Create account" submit={async v => { samePasswords(v); await fn('join', { action: 'setup', setupCode: v.setupCode, fullName: v.name, email: v.email, password: v.password }); await signIn(v.email, v.password); }} fields={[
        { name: 'setupCode', label: 'Setup code (from the server settings)', type: 'password' },
        { name: 'name', label: 'Your name', auto: 'name' },
        { name: 'email', label: 'Email', type: 'email', auto: 'email' },
        { name: 'password', label: NEW_PASSWORD, type: 'password', auto: 'new-password' },
        { name: 'confirm', label: 'Repeat the password', type: 'password', auto: 'new-password' },
      ]} />
    </Frame>
  );
}

export function Invite() {
  const { token } = useParams();
  const [inv, setInv] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { fn('join', { action: 'inspect', token }).then(setInv).catch(e => setErr(e.message)); }, [token]);
  if (err) return <Frame title="Invite"><ErrorBox error={err} /></Frame>;
  if (!inv) return <Frame title="Opening your invite…" />;
  return (
    <Frame title={inv.team ? 'Join your team' : `Join ${inv.company} on Housedge`} subtitle={`You were invited as ${inv.email}.`}>
      <Form button="Create my account" submit={async v => { samePasswords(v); await supabase.auth.signOut(); await fn('join', { action: 'accept', token, fullName: v.name, password: v.password }); await signIn(inv.email, v.password); }} fields={[
        { name: 'name', label: 'Your name', auto: 'name' },
        { name: 'password', label: NEW_PASSWORD, type: 'password', auto: 'new-password' },
        { name: 'confirm', label: 'Repeat the password', type: 'password', auto: 'new-password' },
      ]} />
    </Frame>
  );
}

// Claude, ChatGPT or another app asks to use this Housedge account (OAuth through Supabase Auth). The person sees who
// is asking and where they will be sent back, and approves or cancels. Anyone can register an app with any name, so
// the return address is shown too. Signed out: sign in first, then come back here.
export function Consent({ user }) {
  const id = new URLSearchParams(window.location.search).get('authorization_id') || '';
  const [req, setReq] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!user || !id) return;
    supabase.auth.oauth.getAuthorizationDetails(id).then(({ data, error }) => {
      if (error) return setErr(error.message);
      if (!data.authorization_id) return window.location.replace(data.redirect_url); // approved before
      setReq(data);
    });
  }, [user, id]);
  if (!user) { window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`); return null; }
  const decide = async approve => {
    setBusy(true); setErr(null);
    const { data, error } = await (approve ? supabase.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true }) : supabase.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true }));
    if (error) { setErr(error.message); setBusy(false); return; }
    window.location.replace(data.redirect_url);
  };
  const host = (() => { try { return new URL(req?.redirect_uri).host; } catch { return req?.redirect_uri; } })();
  // Any app can register itself under any name, so the name proves nothing: the return address does. Known AI apps
  // return to their own sites (Claude Code and other local tools return to this computer).
  const known = /(^|\.)(claude\.ai|claude\.com|anthropic\.com|chatgpt\.com|openai\.com|cursor\.com)$/i.test(host?.replace(/:\d+$/, '') || '') || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host || '');
  return (
    <Frame title="Connect an app" subtitle={req ? `${req.client.name} wants to use your Housedge account.` : 'Checking the request…'}>
      {!id ? <ErrorBox error="This link is missing its request. Start connecting again from the app you were using." /> : <>
        {req && <div className="grid gap-4 text-[14px]">
          <div className="rounded-xl bg-fill px-4 py-3">
            <div className="font-semibold">{req.client.name}</div>
            <div className="mt-0.5 break-all text-[12.5px] text-muted">Sends you back to <strong className="text-ink">{host}</strong></div>
          </div>
          {!known && <div className="rounded-xl bg-warnBg px-4 py-3 text-[13px] text-warnInk">
            <strong>Check before you allow.</strong> This app is not one we recognise. Only continue if you started this yourself from an app at <strong>{host}</strong>. Housedge never asks you to connect an app by email or chat message.
          </div>}
          <div>
            <div className="font-semibold">It will be able to</div>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-ink2">
              <li>read your AI visibility data: answers, competitors, sources, actions, reports</li>
              <li>with your go-ahead in the chat: run checks, add questions and competitors, update actions and the work log</li>
            </ul>
            <p className="mt-2 text-[12.5px] text-muted">It works as you ({user.email}) and sees only what you can see. It cannot change your password, people or billing.</p>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary flex-1 py-3" disabled={busy} onClick={() => decide(true)}>Allow</button>
            <button className="btn-ghost flex-1 py-3" disabled={busy} onClick={() => decide(false)}>Cancel</button>
          </div>
          <button className="text-center text-[12.5px] text-muted hover:underline" onClick={signOut}>Not {user.email}? Sign out</button>
        </div>}
        <ErrorBox error={err} />
      </>}
    </Frame>
  );
}
