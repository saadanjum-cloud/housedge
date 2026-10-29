import { useEffect, useRef, useState } from 'react';
import { MetaCtx, useMeta, ProjectCtx, UserCtx, useUser } from './ctx.js';
import { motion } from 'framer-motion';
import { Logo, PageIn, Skeleton } from './motion.jsx';
import { Routes, Route, Navigate, NavLink, Outlet, useNavigate, useParams, Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, MessageSquareText, Link2, Users, ListChecks, FileText, Settings, Plus, FolderKanban,
  Sun, Moon, Monitor, LogOut, Check, Inbox, Globe, Play, Loader2, Download, Route as RouteIcon, ClipboardList, Lightbulb, ListTodo, Send, Menu, X, ShieldCheck, WandSparkles, Gauge,
} from 'lucide-react';
import { api, authHeaders, useApi, setTheme, useDark, useFilters, fmtDate, PREVIEW } from './lib.js';
import { supabase } from './supabase.js';
import { Spinner, SimBadge, Badge, ErrorBox, useToast, Segmented } from './ui.jsx';
import { Login, Setup, Invite, Reset, ResetPassword, AdminLogin, SignUp } from './pages/Auth.jsx';
import Onboarding from './pages/Onboarding.jsx';
import { AdminClients, AdminClient } from './pages/Admin.jsx';
import { Privacy, Terms, LegalNotice, LegalLinks } from './pages/Legal.jsx';
import Projects from './pages/Projects.jsx';
import Overview from './pages/Overview.jsx';
import Journey from './pages/Journey.jsx';
import Discovery from './pages/Discovery.jsx';
import Prompts from './pages/Prompts.jsx';
import Competitors from './pages/Competitors.jsx';
import Sources from './pages/Sources.jsx';
import Chats from './pages/Chats.jsx';
import Actions from './pages/Actions.jsx';
import Reports, { ReportView } from './pages/Reports.jsx';
import ProjectSettings from './pages/ProjectSettings.jsx';
import SettingsPage from './pages/Settings.jsx';
import Home from './pages/Home.jsx';
import Enquiries from './pages/Enquiries.jsx';
import Readiness from './pages/Readiness.jsx';
import ProjectSwitcher from './ProjectSwitcher.jsx';
import Optimise from './pages/Optimise.jsx';
import WorkLog from './pages/WorkLog.jsx';
import Account from './pages/Account.jsx';
import Outreach from './pages/Outreach.jsx';
import Assistant from './Assistant.jsx';


export default function App() {
  const [auth, setAuth] = useState(null);
  const loc = useLocation();
  useEffect(() => { api('/auth/state').then(setAuth).catch(() => setAuth({ user: null })); }, [loc.pathname === '/login']);
  if (!auth) return <Spinner />;
  return (
    <Routes>
      <Route path="/login" element={auth.needsSetup ? <Navigate to="/setup" /> : auth.user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/admin/login" element={auth.needsSetup ? <Navigate to="/setup" /> : auth.user && auth.user.role !== 'client' ? <Navigate to="/admin" /> : <AdminLogin />} />
      <Route path="/onboarding" element={auth.user ? <Navigate to="/" /> : <SignUp />} />
      <Route path="/website" element={<Home signedIn={!!auth.user} />} />
      <Route path="/reset" element={<Reset />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/join/:token" element={<Invite />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/legal" element={<LegalNotice />} />
      <Route path="/setup" element={auth.needsSetup ? <Setup codeRequired={auth.setupCodeRequired} /> : <Navigate to="/login" />} />
      <Route path="/invite/:token" element={<Invite />} />
      <Route path="/p/:id/reports/:rid/print" element={auth.user ? <Authed user={auth.user} bare><ReportView print /></Authed> : <Navigate to="/login" />} />
      <Route path="*" element={auth.user ? <Authed user={auth.user} /> : loc.pathname === '/' && !auth.needsSetup ? <Home />
        : <Navigate to={auth.needsSetup ? '/setup' : loc.pathname.startsWith('/admin') ? '/admin/login' : '/login'} />} />
    </Routes>
  );
}

function Authed({ user, bare, children }) {
  const meta = useApi('/meta');
  const loc = useLocation();
  if (!meta.data) return meta.error ? <div className="p-8"><ErrorBox error={meta.error} /></div> : <Spinner />;
  // A client's first sign-in: set up the company before anything else.
  const org = user.orgs?.[0];
  if (user.role === 'client' && org && !org.onboarded_at) {
    return <UserCtx.Provider value={user}><MetaCtx.Provider value={meta.data}>{loc.pathname === '/welcome' ? <Onboarding /> : <Navigate to="/welcome" replace />}</MetaCtx.Provider></UserCtx.Provider>;
  }
  if (user.role === 'client' && !org) return (
    <div className="mx-auto grid min-h-screen max-w-md content-center gap-4 p-8 text-center">
      <h1 className="text-[24px] font-bold tracking-display">Thanks, {user.name.split(' ')[0]}</h1>
      <p className="text-sm text-muted">Your account is waiting for the Housedge team to open it. We will be in touch at {user.email}. Then sign in again to set up your brand.</p>
      <button className="btn-ghost mx-auto" onClick={async () => { await supabase.auth.signOut(); window.location.href = '/login'; }}><LogOut size={14} />Sign out</button>
    </div>
  );
  const team = user.role !== 'client';
  return (
    <UserCtx.Provider value={user}>
      <MetaCtx.Provider value={{ ...meta.data, reload: meta.reload }}>
        {bare ? children : (
          <Routes>
            <Route element={<Shell user={user} />}>
              <Route path="/" element={team ? <Navigate to="/admin" replace /> : <ClientHome />} />
              {/* The team's own area lives under /admin; clients are sent back to their dashboard. */}
              <Route path="/account" element={<Account />} />
              <Route path="/admin" element={team ? <AdminClients /> : <Navigate to="/" replace />} />
              <Route path="/admin/clients" element={team ? <Projects /> : <Navigate to="/" replace />} />
              <Route path="/admin/new" element={<Navigate to={team ? '/admin?new=1' : '/'} replace />} />
              <Route path="/admin/enquiries" element={team ? <Enquiries /> : <Navigate to="/" replace />} />
              <Route path="/admin/settings" element={team ? <SettingsPage /> : <Navigate to="/" replace />} />
              <Route path="/admin/:orgId" element={team ? <AdminClient /> : <Navigate to="/" replace />} />
              {/* Old addresses, still used by links inside the existing pages. */}
              <Route path="/new" element={<MovedTo to="/admin/new" />} />
              <Route path="/settings" element={<MovedTo to="/admin/settings" />} />
              <Route path="/enquiries" element={<MovedTo to="/admin/enquiries" />} />
              <Route path="/p/:id" element={<ProjectLayout />}>
                <Route index element={<Navigate to={team ? 'journey' : 'overview'} replace />} />
                {/* Team-only CRM pages: a client opening them by address lands on its overview. */}
                <Route path="journey" element={team ? <Journey /> : <Navigate to="../overview" replace />} />
                <Route path="discovery" element={team ? <Discovery /> : <Navigate to="../overview" replace />} />
                <Route path="overview" element={<Overview />} />
                <Route path="prompts" element={<Prompts />} />
                <Route path="competitors" element={<Competitors />} />
                <Route path="sources" element={<Sources />} />
                <Route path="chats" element={<Chats />} />
                <Route path="actions" element={<Actions />} />
                <Route path="work" element={<WorkLog />} />
                <Route path="outreach" element={<Outreach />} />
                <Route path="readiness" element={<Readiness />} />
                <Route path="optimise" element={<Optimise />} />
                <Route path="reports" element={<Reports />} />
                <Route path="reports/:rid" element={<ReportView />} />
                <Route path="settings" element={<ProjectSettings />} />
              </Route>
              <Route path="*" element={<Navigate to="/" />} />
            </Route>
          </Routes>
        )}
      </MetaCtx.Provider>
    </UserCtx.Provider>
  );
}

// Redirect that keeps the #section (e.g. /settings#api).
function MovedTo({ to }) {
  const loc = useLocation();
  return <Navigate to={to + loc.hash} replace />;
}

// Clients skip the team's pipeline board and land on their own project.
function ClientHome() {
  const projects = useApi('/projects');
  if (projects.error) return <div className="p-8"><ErrorBox error={projects.error} /></div>;
  if (!projects.data) return <Spinner />;
  const first = projects.data[0];
  return first ? <Navigate to={`/p/${first.id}/overview`} replace />
    : <p className="mx-auto max-w-md py-16 text-center text-sm text-muted">Your company has no project yet. Your Housedge contact will set it up with you.</p>;
}

function ThemeSwitch() {
  useDark();
  const t = document.documentElement.getAttribute('data-theme') || 'system';
  return (
    <Segmented size="sm" value={t} onChange={setTheme} options={[
      { value: 'light', label: <Sun size={13} aria-label="Light" /> },
      { value: 'system', label: <Monitor size={13} aria-label="Same as computer" /> },
      { value: 'dark', label: <Moon size={13} aria-label="Dark" /> },
    ]} />
  );
}

function Shell({ user }) {
  const meta = useMeta();
  const { id } = useParams();
  const projects = useApi('/projects');
  const enquiries = useApi(user.role === 'admin' ? '/enquiries' : null);
  const newEnquiries = enquiries.data?.filter(e => e.status === 'new').length || 0;
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const pid = loc.pathname.match(/^\/p\/(\d+)/)?.[1];
  const logout = async () => { await supabase.auth.signOut(); window.location.href = '/login'; };
  const team = user.role !== 'client';

  // Grouped like the client workflow: look, analyse, improve, deliver. Team-only pages are hidden from clients.
  const projectNav = pid ? [
    { group: 'General', items: [
      { to: `/p/${pid}/overview`, label: 'Overview', icon: LayoutDashboard },
      { to: `/p/${pid}/journey`, label: 'Client journey', icon: RouteIcon },
      { to: `/p/${pid}/chats`, label: 'Chats', icon: MessageSquareText },
    ] },
    { group: 'Analyse', items: [
      { to: `/p/${pid}/prompts`, label: 'Questions', icon: ListChecks },
      { to: `/p/${pid}/competitors`, label: 'Competitors', icon: Users },
      { to: `/p/${pid}/sources`, label: 'Sources', icon: Link2 },
    ] },
    { group: 'Improve', items: [
      { to: `/p/${pid}/actions`, label: 'Suggested actions', icon: Lightbulb },
      { to: `/p/${pid}/outreach`, label: 'Outreach', icon: Send },
      { to: `/p/${pid}/work`, label: 'Work log', icon: ListTodo },
      { to: `/p/${pid}/readiness`, label: 'AI readiness', icon: ShieldCheck },
      { to: `/p/${pid}/optimise`, label: 'Optimise', icon: WandSparkles },
    ] },
    { group: 'Deliver', items: [
      { to: `/p/${pid}/reports`, label: 'Reports', icon: FileText },
      { to: `/p/${pid}/discovery`, label: 'Discovery notes', icon: ClipboardList },
      { to: `/p/${pid}/settings`, label: 'Project settings', icon: Settings },
    ] },
  ].map(g => ({ ...g, items: g.items.filter(n => team || !/\/(journey|discovery)$/.test(n.to)) })) : [];

  const sidebar = (
    <div className="flex h-full flex-col gap-5 px-3 py-5">
      <Link to="/" className="flex items-center gap-2.5 px-2">
        <Logo size={32} />
        <span className="text-[15px] font-semibold tracking-title">Housedge</span>
      </Link>
      {team && (meta.mode === 'demo' ? <Link to="/admin/settings" className="mx-1"><Badge tone="warn" className="w-full justify-center py-1.5">Demo mode · simulated answers</Badge></Link>
        : <Badge tone="good" className="mx-1 justify-center py-1.5">Live mode · real AI answers</Badge>)}
      <ProjectSwitcher projects={projects.data} currentId={pid} team={team} />
      <nav className="-mt-2 flex flex-col gap-0.5">
        {projectNav.map(g => <div key={g.group} className="flex flex-col gap-0.5">
          <div className="navgroup">{g.group}</div>
          {g.items.map(n => <NavItem key={n.to} {...n} />)}
        </div>)}
      </nav>
      <div className="mt-auto flex flex-col gap-0.5 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
        {team ? <>
          <NavItem to="/admin" end icon={Gauge} label="Admin console" />
          <NavItem to="/admin/clients" icon={FolderKanban} label="Clients" />
          <NavItem to="/admin?new=1" icon={Plus} label="New client" />
          {user.role === 'admin' && <NavItem to="/admin/enquiries" icon={Inbox} label="Enquiries" count={newEnquiries} />}
          <NavItem to="/website" icon={Globe} label="Website" />
          <NavItem to="/admin/settings" icon={Settings} label="Settings" />
        </> : <NavItem to="/" end icon={FolderKanban} label="Projects" />}
        <div className="mt-2 px-1"><ThemeSwitch /></div>
        <Link to="/account" className="truncate px-1 text-[11px] text-muted hover:text-ink hover:underline" title="Your account">{user.email}</Link>
        <button onClick={logout} className="btn-ghost btn-sm mt-1 justify-center"><LogOut size={14} />Sign out</button>
        <LegalLinks className="mt-2 px-1" />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen md:flex">
      <aside className="glass no-print hidden md:block w-64 shrink-0 sticky top-0 h-screen overflow-y-auto" style={{ borderRight: '1px solid var(--line)' }}>{sidebar}</aside>
      <div className="glass no-print md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
        <span className="flex items-center gap-2 text-sm font-semibold"><Logo size={24} />Housedge</span>
        <button onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={18} /></button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)}>
          <aside className="relative h-full w-72 bg-surface shadow-lift" onClick={e => e.stopPropagation()}>
            <button className="absolute right-3 top-3" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button>
            {sidebar}
          </aside>
        </div>
      )}
      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-10 print-full">
        {PREVIEW && <div className="no-print mx-auto mb-4 max-w-[1280px] rounded-2xl bg-accentSoft px-5 py-3 text-[13px] text-ink">
          <strong>Read-only preview.</strong> Click anything to look around. Saving, "Run now", downloads and some filters (country, tag, search) only work in the real app.</div>}
        <div className="mx-auto max-w-[1280px] print-full">
          <PageIn key={pid ? `p${pid}` : loc.pathname}><Outlet context={{ reloadProjects: projects.reload }} /></PageIn>
        </div>
      </main>
    </div>
  );
}

// Menu item; the grey highlight slides to the page you open.
function NavItem({ to, icon: Icon, label, end, count }) {
  return (
    <NavLink to={to} end={end} className="navlink relative">
      {({ isActive }) => <>
        {isActive && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-lg bg-fill" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
        <Icon size={15} className="relative" /><span className="relative">{label}</span>
        {count > 0 && <span className="relative ml-auto rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">{count}</span>}
      </>}
    </NavLink>
  );
}

function ProjectLayout() {
  const { id } = useParams();
  const loc = useLocation();
  const p = useApi(`/projects/${id}`, [id]);
  const toast = useToast();
  const readOnly = useUser().role !== 'client'; // the team views client dashboards; only the client changes them
  const [runId, setRunId] = useState(null);
  const [runState, setRunState] = useState(null);
  const [err, setErr] = useState(null);
  const [version, setVersion] = useState(0);
  const timer = useRef();

  useEffect(() => { if (p.data?.activeRun) setRunId(p.data.activeRun.id); }, [p.data?.activeRun?.id]);
  useEffect(() => {
    if (!runId) return;
    const poll = async () => {
      const r = await api(`/runs/${runId}`).catch(() => null);
      setRunState(r);
      if (r && r.status !== 'running') {
        setRunId(null);
        toast(r.status === 'done' ? `Check finished: ${r.done} answers collected.` : `Check finished with notes: ${r.message || r.status}`);
        p.reload(); setVersion(v => v + 1);
      } else timer.current = setTimeout(poll, 2000);
    };
    poll();
    return () => clearTimeout(timer.current);
  }, [runId]);

  if (!p.data) return p.error ? <ErrorBox error={p.error} /> : <Skeleton />;
  const project = p.data;
  const runNow = async () => {
    setErr(null);
    try { const r = await api(`/projects/${id}/run`, { method: 'POST' }); setRunId(r.runId); }
    catch (e) { setErr(e.message); }
  };
  const running = !!runId;

  return (
    <ProjectCtx.Provider value={{ project, reload: () => { p.reload(); setVersion(v => v + 1); }, refreshHeader: p.reload, version, running, readOnly }}>
      <div className="no-print rise mb-7 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[22px] md:text-[26px] font-bold tracking-display">{project.name}</h1>
            {project.data_mode === 'live' ? <Badge tone="good">Live data</Badge> : <SimBadge />}
          </div>
          <p className="mt-1 text-[13px] text-muted">
            {project.brands.find(b => b.is_own)?.name} vs {project.brands.filter(b => !b.is_own).length} competitors · {project.promptCount} active questions ·
            {' '}last check {project.last_run_at ? fmtDate(project.last_run_at) : 'never'} · runs {({ daily: 'daily', every3: 'every 3 days', weekly: 'weekly', manual: 'only when you press Run' })[project.frequency]}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu id={id} />
          {!readOnly && <button className={`btn-primary ${running ? 'shimmer' : ''}`} onClick={runNow} disabled={running}>
            {running ? <><Loader2 size={15} className="animate-spin" />Checking… {runState ? `${runState.done}/${runState.total}` : ''}</> : <><Play size={15} />Run now</>}
          </button>}
        </div>
      </div>
      {readOnly && (
        <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-accentSoft px-4 py-2.5 text-[13px] text-ink2">
          <span><strong>Read only.</strong> You are viewing {project.name}'s dashboard as the Housedge team. Only the client can change it or run checks.</span>
          <Link className="font-semibold text-accent hover:underline" to={`/admin/${project.org_id}`}>← Back to the admin console</Link>
        </div>
      )}
      {running && runState && (
        <div className="no-print mb-5 h-1 overflow-hidden rounded-full bg-fill">
          <div className="h-full bg-accent transition-all" style={{ width: `${runState.total ? (100 * (runState.done + runState.failed)) / runState.total : 5}%` }} />
        </div>
      )}
      {err && <div className="mb-4"><ErrorBox error={err} /></div>}
      {project.lastRun?.message && !running && project.lastRun.status !== 'done' && (
        // A failed check is an error; a partial one (e.g. some AI services not connected) is only a note. Never printed in reports.
        project.lastRun.status === 'failed'
          ? <div className="no-print mb-4"><ErrorBox error={`Last check (${fmtDate(project.lastRun.started_at)}): ${project.lastRun.message}`} /></div>
          : <div className="no-print mb-4 rounded-xl bg-warnBg px-4 py-2.5 text-[13px] text-warnInk">Last check ({fmtDate(project.lastRun.started_at)}): {project.lastRun.message}</div>
      )}
      {running ? <Research run={runState} project={project} />
        : !project.last_run_at && loc.pathname.endsWith('/overview') ? <FirstCheck project={project} onStart={runNow} readOnly={readOnly} />
          : <PageIn key={`${loc.pathname}-${version}`}><Outlet /></PageIn>}
      <Assistant project={project} />
    </ProjectCtx.Provider>
  );
}

const money = n => `$${Number(n || 0).toFixed(2)}`;

// A project that has never been checked: what will happen, what it costs, and the button to start.
function FirstCheck({ project, onStart, readOnly }) {
  const [busy, setBusy] = useState(false);
  const own = project.brands.find(b => b.is_own)?.name || project.name;
  const rivals = project.brands.filter(b => !b.is_own).map(b => b.name);
  const b = project.budget || {};
  const steps = [
    ['Ask', `Claude answers your ${project.promptCount} questions the way a customer would, searching the web live.`],
    ['Read', `Every answer is read to find which brands it recommends, in what order and how, with the exact quote as proof.`],
    ['Report', `Your dashboard fills in and your first report is ready, with ${own} compared against ${rivals.slice(0, 3).join(', ') || 'your competitors'}.`],
  ];
  return (
    <div className="card rise p-6 md:p-10">
      <div className="mx-auto max-w-2xl text-center">
        <span className="pop inline-block"><Logo size={56} draw /></span>
        <h2 className="mt-5 text-[26px] font-bold tracking-display">Ready for the first AI check</h2>
        <p className="mt-2 text-[15px] text-muted">See what AI assistants tell your customers about {own} today.</p>
      </div>
      <div className="mx-auto mt-8 grid max-w-3xl gap-3 md:grid-cols-3">
        {steps.map(([t, d], i) => (
          <div key={t} className="rounded-2xl bg-fill p-4">
            <div className="text-[12px] font-semibold text-muted">Step {i + 1}</div>
            <div className="mt-0.5 text-[15px] font-semibold">{t}</div>
            <p className="mt-1 text-[13px] text-ink2">{d}</p>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-8 max-w-xl text-center">
        {readOnly
          ? <p className="rounded-2xl bg-accentSoft px-5 py-4 text-[14px] text-ink2">The client has not run a check yet. Monthly AI budget: {money(b.monthly)} ({money(b.spent)} used); a check costs about {money(b.runEstimate)}. You can change the budget in the <Link className="underline" to={`/admin/${project.org_id}`}>admin console</Link>.</p>
          : b.monthly ? <>
            <p className="text-[13px] text-muted">Takes about one to three minutes. Estimated AI cost about {money(b.runEstimate)} of your {money(b.monthly)} monthly budget ({money(b.spent)} used).</p>
            <button className="btn-primary mt-4 px-6 py-3 text-[15px]" disabled={busy} onClick={async () => { setBusy(true); await onStart(); setBusy(false); }}>
              {busy ? <><Loader2 size={15} className="animate-spin" />Starting…</> : <><Play size={15} />Start the first check</>}
            </button>
          </> : <p className="rounded-2xl bg-accentSoft px-5 py-4 text-[14px] text-ink2">Your Housedge contact opens your monthly AI budget before the first check. You will see the results here as soon as it has run.</p>}
      </div>
    </div>
  );
}

// While a check runs: every question, live. Waiting, being answered, being read, done (with what was found), or failed.
function Research({ run, project }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const own = project.brands.find(b => b.is_own)?.name || project.name;
  const items = run?.items || [];
  const total = run?.total || project.promptCount;
  const finished = (run?.done || 0) + (run?.failed || 0);
  const secs = run ? Math.max(0, Math.round((now - new Date(run.started_at)) / 1000)) : 0;
  let asking = 0;
  return (
    <div className="card rise p-6 md:p-8">
      <div className="flex items-start gap-4">
        <span className="shrink-0 animate-pulse"><Logo size={44} /></span>
        <div className="min-w-0">
          <h2 className="text-[20px] font-bold tracking-display md:text-[22px]">Researching what AI tells your customers about {own}</h2>
          <p className="mt-1 max-w-3xl text-[14px] text-muted">Claude is searching the web and answering {total} questions the way a customer would ask them. Each answer is then read to find which brands it recommends, in what order, and why. This usually takes one to three minutes. You can leave this page; the check keeps going.</p>
        </div>
      </div>
      <div className="mt-6 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-fill">
          <div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${Math.max(3, (100 * finished) / (total || 1))}%` }} />
        </div>
        <span className="text-[13px] font-semibold tnum">{finished} of {total}</span>
        <span className="text-[13px] text-muted tnum">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>
      </div>
      <ul className="mt-6 grid gap-1.5">
        {(items.length ? items : Array.from({ length: total }, (_, i) => ({ id: i, text: '' }))).map(q => {
          const state = !q.answer_id ? (asking++ < 6 ? 'asking' : 'waiting') : q.error ? 'failed' : q.read ? 'done' : 'reading';
          const me = (q.brands || []).find(x => x.own);
          const others = (q.brands || []).filter(x => !x.own).map(x => x.name);
          return (
            <li key={q.id} className="flex items-start gap-3 rounded-xl px-3 py-2.5" style={{ background: state === 'done' ? 'var(--fill)' : 'transparent' }}>
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center">
                {state === 'done' ? <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-white"><Check size={12} /></span>
                  : state === 'failed' ? <X size={15} className="text-bad" />
                    : state === 'waiting' ? <span className="h-2 w-2 rounded-full bg-line" /> : <Loader2 size={15} className="animate-spin text-accent" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-[14px] ${state === 'waiting' ? 'text-muted' : 'font-medium'}`}>{q.text || <span className="skeleton inline-block h-3 w-64 align-middle" />}</div>
                <div className="mt-0.5 text-[12px] text-muted">
                  {state === 'asking' && 'Asking Claude and searching the web…'}
                  {state === 'waiting' && 'Waiting'}
                  {state === 'reading' && 'Answered. Reading which brands it names…'}
                  {state === 'failed' && 'Could not be answered this time.'}
                  {state === 'done' && <>
                    <span className={me ? 'font-semibold text-ink' : ''}>{me ? `${own} mentioned${me.rank ? ` · #${me.rank}` : ''}` : `${own} not mentioned`}</span>
                    {others.length > 0 && <> · also {others.slice(0, 4).join(', ')}{others.length > 4 ? ` +${others.length - 4}` : ''}</>}
                    {' '}· {q.searches || 0} searches · {q.sources || 0} sources
                  </>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Downloads a CSV with the sign-in token (a plain link cannot carry it).
async function download(url) {
  const res = await fetch(url, { headers: await authHeaders() });
  if (!res.ok) return alert((await res.json().catch(() => ({}))).error || 'Download failed.');
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'export.csv';
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: name });
  a.click();
  URL.revokeObjectURL(a.href);
}

function ExportMenu({ id }) {
  const [open, setOpen] = useState(false);
  const { qs } = useFilters();
  const items = [
    ['summary', 'Headline numbers (CSV)'], ['daily', 'Daily trend (CSV)'], ['answers', 'All answers (CSV)'],
    ['sources', 'Sources (CSV)'], ['prompts', 'Questions (CSV)'],
  ];
  return (
    <div className="relative">
      <button className="btn-ghost" onClick={() => setOpen(o => !o)} aria-expanded={open}><Download size={15} />Export</button>
      {open && (
        <div className="glass rise absolute right-0 z-30 mt-2 w-64 rounded-2xl p-1.5 shadow-lift" style={{ border: '1px solid var(--line)' }} onMouseLeave={() => setOpen(false)}>
          {items.map(([k, label]) => (
            <a key={k} className="block rounded-xl px-3 py-2 text-[13px] hover:bg-fill" href={`/api/projects/${id}/export/${k}?${qs}`} onClick={e => { e.preventDefault(); setOpen(false); download(`/api/projects/${id}/export/${k}?${qs}`); }}>{label}</a>
          ))}
          <Link className="block rounded-xl px-3 py-2 text-[13px] hover:bg-fill" to={`/p/${id}/reports`} onClick={() => setOpen(false)}>Printable report…</Link>
          <Link className="block rounded-xl px-3 py-2 text-[13px] hover:bg-fill" to="/admin/settings#api" onClick={() => setOpen(false)}>API, Google Sheets, Looker Studio…</Link>
        </div>
      )}
    </div>
  );
}
