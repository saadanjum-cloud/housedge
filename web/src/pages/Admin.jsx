// Admin console (Housedge team only): every client's usage, tokens, cost, ratings and health, their people,
// and every answer with the AI reader's findings so results can be verified before clients see them.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Copy, Plus, Star, Trash2, KeyRound, FileText } from 'lucide-react';
import { api, useApi, fmtDate } from '../lib.js';
import { fn, supabase } from '../supabase.js';
import { useUser } from '../ctx.js';
import { Badge, Card, Empty, ErrorBox, Modal, PageHeader, Segmented, Spinner, useToast } from '../ui.jsx';
import { PROFILE_QUESTIONS, DISCOVERY_QUESTIONS, FILE_BUCKET } from '../intake.js';

const usd = n => (n == null ? '—' : `$${Number(n) < 10 ? Number(n).toFixed(2) : Math.round(Number(n)).toLocaleString('en-GB')}`);
const num = n => (n == null ? '—' : Number(n).toLocaleString('en-GB'));
const compact = n => (n == null ? '—' : new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n)));
const ago = d => { if (!d) return 'never'; const s = (Date.now() - new Date(d).getTime()) / 1000; return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
const HEALTH = { good: ['Healthy', 'good'], at_risk: ['At risk', 'warn'], churning: ['Churning', 'bad'] };
const Health = ({ value }) => { const [label, tone] = HEALTH[value] || HEALTH.good; return <Badge tone={tone}>{label}</Badge>; };
const Stars = ({ value }) => (value == null ? <span className="text-muted">—</span> : <span className="inline-flex items-center gap-1 tnum"><Star size={13} className="text-warnInk" fill="currentColor" />{value}</span>);
const ENGINE = { chatgpt: 'ChatGPT', gemini: 'Gemini', perplexity: 'Perplexity', claude: 'Claude' };

function SpendBar({ spend, budget }) {
  const pct = budget ? Math.min(100, (100 * spend) / budget) : 0;
  return (
    <div className="min-w-[120px]">
      <div className="text-[13px] tnum">{usd(spend)} <span className="text-muted">/ {usd(budget)}</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-fill"><div className={`h-full rounded-full ${pct > 90 ? 'bg-bad' : 'bg-accent'}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function CopyLink({ link, note }) {
  const toast = useToast();
  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <input className="input font-mono text-xs" readOnly value={link} onFocus={e => e.target.select()} />
        <button className="btn-primary shrink-0" onClick={() => navigator.clipboard.writeText(link).then(() => toast('Link copied'))}><Copy size={14} />Copy</button>
      </div>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}

function Tabs({ value, onChange, options }) {
  return (
    <div className="mb-6 flex gap-1 overflow-x-auto" style={{ borderBottom: '1px solid var(--line)' }} role="tablist">
      {options.map(o => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold transition ${value === o.value ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
          {o.label}{o.count != null && <span className="ml-1.5 font-normal text-muted tnum">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ all clients
export function AdminClients() {
  const user = useUser();
  const nav = useNavigate();
  const list = useApi('/admin/clients');
  const [params, setParams] = useSearchParams();
  const creating = params.get('new') === '1'; // "New client" anywhere in the team area opens this form
  const setCreating = on => setParams(on ? { new: '1' } : {});
  if (user.role === 'client') return <Empty title="Not available">This page is for the Housedge team.</Empty>;
  const rows = list.data || [];
  const sum = k => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
  const rated = rows.filter(r => r.avg_rating != null);
  return (
    <>
      <PageHeader title="Admin console" subtitle="Every client at a glance: usage, cost, results and how happy they are." right={user.role === 'admin' && <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={15} />New client</button>} />
      <ErrorBox error={list.error} />
      {user.role === 'admin' && <Signups onChange={list.reload} />}
      {list.loading ? <Spinner /> : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[['Clients', rows.length, `${rows.filter(r => r.onboarded_at).length} onboarded`], ['AI spend this month', usd(sum('spend_month')), `${compact(sum('tokens_month'))} tokens`],
              ['Answers this month', num(sum('answers_month')), `${num(sum('active_questions'))} active questions`],
              ['Average rating', rated.length ? (rated.reduce((s, r) => s + Number(r.avg_rating), 0) / rated.length).toFixed(1) : '—', `${sum('ratings')} ratings`],
              ['Needs attention', rows.filter(r => r.health !== 'good').length, 'at risk or churning']].map(([label, value, sub]) => (
              <div key={label} className="card p-5"><div className="text-[13px] font-medium text-muted">{label}</div><div className="mt-1.5 text-[28px] font-semibold tracking-display tnum">{value}</div><div className="mt-1 text-xs text-muted">{sub}</div></div>
            ))}
          </div>
          {!rows.length ? <Empty title="No clients yet">Create the first client company and send its owner the invite link.</Empty> : (
            <Card pad={false}>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr><th className="th">Client</th><th className="th">Health</th><th className="th text-right">People</th><th className="th text-right">Questions</th><th className="th text-right">Answers (month)</th><th className="th text-right">Tokens (month)</th><th className="th">AI spend / budget</th><th className="th">Rating</th><th className="th">Last check</th></tr></thead>
                  <tbody>{rows.map(r => (
                    <tr key={r.id} className="cursor-pointer" onClick={() => nav(`/admin/${r.id}`)}>
                      <td className="td"><div className="font-semibold">{r.name}</div><div className="text-xs text-muted">{r.website || '—'}{!r.onboarded_at && <span className="ml-1.5"><Badge tone="warn">Not onboarded</Badge></span>}</div></td>
                      <td className="td"><Health value={r.health} /></td>
                      <td className="td text-right tnum">{r.members}</td>
                      <td className="td text-right tnum">{r.active_questions}</td>
                      <td className="td text-right tnum">{num(r.answers_month)}</td>
                      <td className="td text-right tnum">{compact(r.tokens_month)}</td>
                      <td className="td"><SpendBar spend={Number(r.spend_month)} budget={Number(r.monthly_budget)} /></td>
                      <td className="td"><Stars value={r.avg_rating} /> <span className="text-xs text-muted">{r.ratings ? `(${r.ratings})` : ''}</span></td>
                      <td className="td text-[13px] text-muted">{ago(r.last_run_at)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
      <Learnings />
      <NewClient open={creating} onClose={() => { setCreating(false); list.reload(); }} />
    </>
  );
}

// What works, across every client: the logged actions whose before/after window is complete, grouped by kind,
// industry and market. This is the dataset no chat or dashboard has; it grows with every action logged.
function Learnings() {
  const d = useApi('/admin/learnings');
  if (!d.data) return null;
  const { rows, kinds, windowDays } = d.data;
  return (
    <Card className="mt-6" title="What works, across all clients" pad={false}
      subtitle={`Every action logged in a client's Work log, measured ${windowDays} days before vs after it went live (only actions with a complete window and 5+ answers on each side).`}>
      {!rows.length ? <p className="px-6 pb-6 text-sm text-muted">Nothing measured yet. This fills in as clients' logged actions complete their {windowDays}-day window.</p> : (
        <div className="overflow-x-auto"><table className="w-full">
          <thead><tr><th className="th">Kind of action</th><th className="th">Industry</th><th className="th">Market</th><th className="th text-right">Actions</th><th className="th text-right">Improved</th><th className="th text-right">Avg change</th><th className="th text-right">AI started citing it</th><th className="th text-right">Days to first citation</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>
              <td className="td">{kinds[r.kind] || r.kind}</td><td className="td text-muted">{r.industry}</td><td className="td text-muted">{r.market}</td>
              <td className="td text-right tnum">{r.actions}</td><td className="td text-right tnum">{r.improved} of {r.actions}</td>
              <td className={`td text-right tnum ${r.avg_change_pts > 0 ? 'text-good' : r.avg_change_pts < 0 ? 'text-bad' : ''}`}>{r.avg_change_pts > 0 ? '+' : ''}{r.avg_change_pts} pts</td>
              <td className="td text-right tnum">{r.newly_cited} of {r.actions}</td><td className="td text-right tnum">{r.median_days_to_citation ?? '—'}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

// Self sign-up at /onboarding: open (accounts work at once), needs approval, or closed. Admins only.
function Signups({ onChange }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => fn('team', { action: 'signups' }).then(setD, e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const act = async (action, extra) => {
    if (action === 'reject-signup' && !window.confirm('Turn down this sign-up? Their login is deleted.')) return;
    setErr(null);
    try { await fn('team', { action, ...extra }); await load(); onChange(); } catch (e) { setErr(e.message); }
  };
  if (!d) return err ? <div className="mb-6"><ErrorBox error={err} /></div> : null;
  const pending = d.signups.filter(s => s.status === 'pending');
  const recent = d.signups.filter(s => s.status !== 'pending').slice(0, 5);
  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold">Self sign-up</div>
          <p className="mt-0.5 max-w-xl text-[13px] text-muted">New clients can create an account at <span className="font-mono">/onboarding</span>. They start with a $10 monthly AI budget (enough for a first check); change it per client under Account.</p>
        </div>
        <Segmented size="sm" value={d.mode} onChange={mode => act('signup-mode', { mode })} options={[
          { value: 'auto', label: 'Open' }, { value: 'approve', label: 'Needs approval' }, { value: 'off', label: 'Closed' }]} />
      </div>
      {(pending.length > 0 || recent.length > 0) && <table className="mt-4 w-full">
        <thead><tr><th className="th">Company</th><th className="th">Person</th><th className="th">Signed up</th><th className="th">Status</th><th className="th" /></tr></thead>
        <tbody>{[...pending, ...recent].map(s => (
          <tr key={s.id}>
            <td className="td"><div className="font-semibold">{s.company}</div><div className="text-xs text-muted">{s.website || '—'}</div></td>
            <td className="td text-[13px]">{s.full_name}<div className="text-xs text-muted">{s.email}</div></td>
            <td className="td text-[13px] text-muted">{ago(s.created_at)}</td>
            <td className="td">{s.status === 'pending' ? <Badge tone="warn">Waiting</Badge> : s.status === 'approved' ? <Badge tone="good">Open</Badge> : <Badge>Turned down</Badge>}</td>
            <td className="td text-right">{s.status === 'pending'
              ? <span className="inline-flex gap-2"><button className="btn-primary btn-sm" onClick={() => act('approve-signup', { id: s.id })}>Approve</button><button className="btn-ghost btn-sm" onClick={() => act('reject-signup', { id: s.id })}>Turn down</button></span>
              : s.org_id && <Link className="text-[13px] text-accent hover:underline" to={`/admin/${s.org_id}`}>Open client</Link>}</td>
          </tr>
        ))}</tbody>
      </table>}
      <ErrorBox error={err} />
    </Card>
  );
}

function NewClient({ open, onClose }) {
  const [f, setF] = useState({ name: '', website: '', industry: '', ownerEmail: '', monthlyBudget: '25', fee: '', currency: 'EUR' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const close = () => { setDone(null); setErr(null); setF({ name: '', website: '', industry: '', ownerEmail: '', monthlyBudget: '25', fee: '', currency: 'EUR' }); onClose(); };
  const create = async () => {
    setErr(null); setBusy(true);
    try { setDone(await fn('team', { action: 'create-client', ...f })); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={close} title={done ? 'Client created' : 'New client'}>
      {done ? (
        <div className="grid gap-4">
          <p className="text-sm text-ink2">Send this link to <strong>{done.invite.email}</strong>. They set a password and go through onboarding. The link works once and expires in {done.invite.expiresInDays} days.</p>
          <CopyLink link={done.invite.link} note="Only shown now. You can create a new link from the client's People tab." />
          <div className="flex justify-end"><button className="btn-ghost" onClick={close}>Done</button></div>
        </div>
      ) : (
        <div className="grid gap-3">
          {[['name', 'Company name'], ['website', 'Website'], ['industry', 'Industry'], ['ownerEmail', "Client contact's email (account owner)"]].map(([k, label]) => (
            <label key={k} className="block"><span className="label">{label}</span><input className="input" type={k === 'ownerEmail' ? 'email' : 'text'} value={f[k]} onChange={up(k)} /></label>
          ))}
          <div className="grid grid-cols-3 gap-3">
            <label className="block"><span className="label">AI budget / month ($)</span><input className="input" type="number" min="0" value={f.monthlyBudget} onChange={up('monthlyBudget')} /></label>
            <label className="block"><span className="label">Fee / month</span><input className="input" type="number" min="0" value={f.fee} onChange={up('fee')} /></label>
            <label className="block"><span className="label">Currency</span><select className="input" value={f.currency} onChange={up('currency')}>{['EUR', 'USD', 'GBP', 'SEK'].map(c => <option key={c}>{c}</option>)}</select></label>
          </div>
          <p className="text-xs text-muted">The AI budget caps what this client's checks can spend each month. Checks pause when it is reached.</p>
          <ErrorBox error={err} />
          <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={close}>Cancel</button><button className="btn-primary" disabled={busy || !f.name || !f.ownerEmail} onClick={create}>{busy ? 'Creating…' : 'Create and get invite link'}</button></div>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ one client
export function AdminClient() {
  const { orgId } = useParams();
  const user = useUser();
  const d = useApi(`/admin/clients/${orgId}`, [orgId]);
  const [tab, setTab] = useState('overview');
  if (user.role === 'client') return <Empty title="Not available">This page is for the Housedge team.</Empty>;
  if (d.loading && !d.data) return <Spinner />;
  if (d.error) return <ErrorBox error={d.error} />;
  const { org, members, invites, projects, usage, ratings } = d.data;
  return (
    <>
      <Link to="/admin" className="text-[13px] text-accent hover:underline">← Admin console</Link>
      <PageHeader title={org.name} subtitle={<span className="inline-flex flex-wrap items-center gap-2"><Health value={org.health} />{org.website || ''}{org.onboarded_at ? <span>· onboarded {fmtDate(org.onboarded_at)}</span> : <Badge tone="warn">Not onboarded yet</Badge>}</span>} />
      <Tabs value={tab} onChange={setTab} options={[
        { value: 'overview', label: 'Overview' }, { value: 'intake', label: 'Onboarding' }, { value: 'answers', label: 'Answers & findings' }, { value: 'usage', label: 'Usage' },
        { value: 'ratings', label: 'Ratings', count: ratings.length }, { value: 'people', label: 'People', count: members.length }, { value: 'account', label: 'Account' },
      ]} />
      {tab === 'overview' && <ClientOverview org={org} projects={projects} reload={d.reload} />}
      {tab === 'intake' && <Intake org={org} projects={projects} />}
      {tab === 'answers' && <Verify projects={projects} />}
      {tab === 'usage' && <Usage org={org} usage={usage} />}
      {tab === 'ratings' && <Ratings ratings={ratings} />}
      {tab === 'people' && <People org={org} members={members} invites={invites} reload={d.reload} />}
      {tab === 'account' && <Account org={org} reload={d.reload} />}
    </>
  );
}

// Everything the client told us during onboarding: business details (brand profile), goals and contacts
// (discovery notes) and the files they shared. Files open through short-lived private links.
function Intake({ org, projects }) {
  const pid = projects[0]?.id;
  const project = useApi(pid ? `/projects/${pid}` : null, [pid]);
  const opt = useApi(pid ? `/projects/${pid}/optimise` : null, [pid]);
  const [files, setFiles] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    supabase.storage.from(FILE_BUCKET).list(org.id, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })
      .then(({ data, error }) => (error ? setErr(error.message) : setFiles(data)));
  }, [org.id]);
  const open = async name => {
    const { data, error } = await supabase.storage.from(FILE_BUCKET).createSignedUrl(`${org.id}/${name}`, 300);
    if (error) return setErr(error.message);
    window.open(data.signedUrl, '_blank', 'noopener');
  };
  if (!pid) return <Empty title="Not onboarded yet">The client has not finished onboarding.</Empty>;
  if (!project.data || !opt.data) return <Spinner />;
  const disc = project.data.discovery || {};
  const profile = opt.data.profile || {};
  const rows = (qs, src) => qs.map(([k, label]) => (
    <div key={k} className="grid gap-1 px-5 py-3 sm:grid-cols-[240px_1fr] sm:gap-4" style={{ borderTop: '1px solid var(--line)' }}>
      <dt className="text-[13px] text-muted">{label}</dt><dd className="whitespace-pre-line text-sm">{src[k] || <span className="text-muted">—</span>}</dd>
    </div>
  ));
  return (
    <div className="grid gap-6">
      <Card title="About the business" subtitle="Saved as the brand profile (Optimise page)." pad={false}>
        <dl className="mt-2">{rows(PROFILE_QUESTIONS, profile)}{rows([['profiles', 'Official profiles']], { profiles: (profile.profiles || []).join('\n') })}</dl>
      </Card>
      <Card title="Goals and contacts" subtitle="Saved in the discovery notes." pad={false}>
        <dl className="mt-2">{rows(DISCOVERY_QUESTIONS, disc)}
          {rows([['offer', 'What they offer'], ['competitors', 'Competitors they named'], ['questions', 'Their own questions']], disc)}</dl>
      </Card>
      <Card title="Files" subtitle="Only this client and the Housedge team can open them." pad={false}>
        {!files ? <Spinner /> : !files.length ? <p className="px-5 pb-5 text-sm text-muted">No files shared.</p> : files.map(f => (
          <button key={f.name} onClick={() => open(f.name)} className="flex w-full items-center gap-3 px-5 py-3 text-left text-sm hover:bg-fill" style={{ borderTop: '1px solid var(--line)' }}>
            <FileText size={15} className="text-muted" /><span className="flex-1 truncate">{f.name.replace(/^\d+-/, '')}</span>
            <span className="text-xs text-muted tnum">{((f.metadata?.size || 0) / 1024 / 1024).toFixed(1)} MB · {fmtDate(f.created_at)}</span>
          </button>
        ))}
        <div className="px-5 pb-3"><ErrorBox error={err} /></div>
      </Card>
    </div>
  );
}

// Spend this month with the monthly AI budget editable in place.
function BudgetCard({ org, reload }) {
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);
  const save = async () => {
    setErr(null);
    try { await api(`/admin/clients/${org.id}`, { method: 'PATCH', body: { monthlyBudget: edit } }); toast('Budget saved'); setEdit(null); reload(); }
    catch (e) { setErr(e.message); }
  };
  return (
    <div className="card p-5">
      <div className="text-[13px] font-medium text-muted">AI spend this month</div>
      <div className="mt-1.5 text-[28px] font-semibold tracking-display tnum">{usd(org.spend_month)}</div>
      {edit == null ? (
        <div className="mt-1 text-xs text-muted">of {usd(org.monthly_budget)} budget · <button className="text-accent hover:underline" onClick={() => setEdit(String(org.monthly_budget ?? 0))}>Change</button></div>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-muted">$</span>
          <input className="input h-8 w-24 py-1" type="number" min="0" autoFocus value={edit} aria-label="Monthly AI budget in dollars"
            onChange={e => setEdit(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEdit(null); }} />
          <button className="btn-primary btn-sm" onClick={save}>Save</button>
          <button className="btn-ghost btn-sm" onClick={() => setEdit(null)}>Cancel</button>
        </div>
      )}
      {err && <div className="mt-2"><ErrorBox error={err} /></div>}
    </div>
  );
}

function ClientOverview({ org, projects, reload }) {
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <BudgetCard org={org} reload={reload} />
        {[['Tokens this month', compact(org.tokens_month), `${num(org.answers_month)} answers`],
          ['Rating', org.avg_rating ?? '—', org.ratings ? `${org.ratings} ratings` : 'no ratings yet'], ['Spent in total', usd(org.spend_total), org.fee ? `fee ${num(org.fee)} ${org.currency}/month` : 'no fee set']].map(([label, value, sub]) => (
          <div key={label} className="card p-5"><div className="text-[13px] font-medium text-muted">{label}</div><div className="mt-1.5 text-[28px] font-semibold tracking-display tnum">{value}</div><div className="mt-1 text-xs text-muted">{sub}</div></div>
        ))}
      </div>
      <Card title="Projects" subtitle="Open a project to see exactly what the client sees: overview, chats, sources, actions and reports." pad={false}>
        {!projects.length ? <p className="px-6 pb-6 text-sm text-muted">No project yet. The client creates one during onboarding.</p> : (
          <table className="w-full">
            <thead><tr><th className="th">Project</th><th className="th">Schedule</th><th className="th text-right">Questions</th><th className="th text-right">Answers</th><th className="th">Last check</th><th className="th" /></tr></thead>
            <tbody>{projects.map(p => (
              <tr key={p.id}>
                <td className="td font-semibold">{p.name}</td><td className="td text-muted">{p.frequency} · {p.engines.map(e => ENGINE[e] || e).join(', ')}</td>
                <td className="td text-right tnum">{p.questions}</td><td className="td text-right tnum">{num(p.answers)}</td><td className="td text-muted">{ago(p.last_run_at)}</td>
                <td className="td text-right whitespace-nowrap"><Link className="btn-ghost btn-sm" to={`/p/${p.id}/chats`}>Chats</Link></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

const ROLE = { recommended: ['Recommended', 'good'], listed: ['Listed', 'default'], compared: ['Compared', 'default'], warned_against: ['Warned against', 'bad'], passing: ['In passing', 'default'] };
function Verify({ projects }) {
  const [projectId, setProjectId] = useState(projects[0]?.id);
  const [flag, setFlag] = useState('');
  const [engine, setEngine] = useState('');
  const [offset, setOffset] = useState(0);
  const list = useApi(projectId ? `/admin/answers?project=${projectId}&offset=${offset}&flag=${flag}&engine=${engine}` : null, [projectId, offset, flag, engine]);
  if (!projects.length) return <Empty title="No answers yet">They appear after the client's first check.</Empty>;
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {projects.length > 1 && <select className="input w-auto" value={projectId} onChange={e => { setProjectId(Number(e.target.value)); setOffset(0); }}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        <select className="input w-auto" value={engine} onChange={e => { setEngine(e.target.value); setOffset(0); }}><option value="">All assistants</option>{Object.entries(ENGINE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="input w-auto" value={flag} onChange={e => { setFlag(e.target.value); setOffset(0); }}>
          <option value="">All answers</option><option value="disagree">Readers disagree (check)</option><option value="unread">Not read by the AI reader</option><option value="errors">Failed questions</option>
        </select>
      </div>
      <ErrorBox error={list.error} />
      {list.loading && !list.data ? <Spinner /> : !list.data?.rows.length ? <Empty title="Nothing here">No answers match these filters.</Empty> : (
        <div className="grid gap-3">
          {list.data.rows.map(a => <VerifyCard key={a.id} a={a} />)}
          <div className="flex items-center justify-between text-sm text-muted">
            <span>{num(list.data.total)} answers</span>
            <span className="flex gap-2"><button className="btn-ghost btn-sm" disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - list.data.limit))}>Previous</button>
              <button className="btn-ghost btn-sm" disabled={offset + list.data.limit >= list.data.total} onClick={() => setOffset(o => o + list.data.limit)}>Next</button></span>
          </div>
        </div>
      )}
    </>
  );
}

function VerifyCard({ a }) {
  const [open, setOpen] = useState(false);
  const reading = a.reading;
  return (
    <article className="card p-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <Badge tone="accent">{ENGINE[a.engine] || a.engine}</Badge><span>{fmtDate(a.day)}</span><span>· {a.model || '—'}</span>
        <span>· {usd(a.cost)}</span><span>· {compact((a.in_tokens || 0) + (a.out_tokens || 0))} tokens</span>{a.searches ? <span>· {a.searches} searches</span> : null}
        {a.disagreement && <Badge tone="bad">Readers disagree about the client</Badge>}
        {a.dropped > 0 && <Badge tone="warn">{a.dropped} invented name{a.dropped > 1 ? 's' : ''} rejected</Badge>}
        {!reading && !a.error && <Badge>Word-match only</Badge>}
      </div>
      <h3 className="mt-2 text-[15px] font-semibold">“{a.question}”</h3>
      {a.error ? <div className="mt-2"><ErrorBox error={a.error} /></div> : (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">{a.mentions.map((m, i) => <span key={i} className="chip">{m.name}{m.is_own && <Badge tone="accent">client</Badge>}{m.position != null && <span className="text-muted">#{m.position}</span>}{m.sentiment != null && <span className={m.sentiment >= 60 ? 'text-good' : m.sentiment <= 40 ? 'text-bad' : 'text-muted'}>{m.sentiment}</span>}</span>)}</div>
          <button className="btn-ghost btn-sm mt-3" onClick={() => setOpen(o => !o)}>{open ? 'Hide answer and findings' : 'Show answer and findings'}</button>
          {open && (
            <div className="mt-3 grid gap-3">
              <div className="whitespace-pre-wrap rounded-xl bg-raised p-4 text-sm leading-relaxed text-ink2">{String(a.text || '').replace(/\*\*/g, '')}</div>
              {reading ? (
                <div className="overflow-x-auto">
                  <div className="mb-1 text-xs text-muted">AI reader v{a.reader_version} · {a.reader_model} · answer shape: {String(reading.shape || '').replace('_', ' ')}{reading.weak ? ` · ${reading.weak} weak quote${reading.weak > 1 ? 's' : ''} replaced` : ''}</div>
                  <table className="w-full text-xs">
                    <thead><tr><th className="th">Brand</th><th className="th">Role</th><th className="th">Rank</th><th className="th">Tone</th><th className="th">Evidence (quoted from the answer)</th></tr></thead>
                    <tbody>{(reading.entities || []).map(e => { const [label, tone] = ROLE[e.role] || [e.role, 'default']; return (
                      <tr key={e.name}><td className="td font-medium">{e.name}</td><td className="td"><Badge tone={tone}>{label}</Badge></td><td className="td tnum">{e.rank ? `#${e.rank}` : '—'}</td><td className="td">{e.sentiment}</td>
                        <td className="td italic text-ink2">“{e.quote}”{e.evidence === 'fallback' && <span className="not-italic text-muted"> (fallback)</span>}</td></tr>); })}</tbody>
                  </table>
                  {reading.dropped_names?.length > 0 && <p className="mt-2 text-xs text-muted">Rejected, not in the answer: {reading.dropped_names.join(', ')}</p>}
                </div>
              ) : <p className="text-xs text-muted">Not read by the AI reader yet: numbers for this answer come from simple name matching.</p>}
            </div>
          )}
        </>
      )}
    </article>
  );
}

function Usage({ org, usage }) {
  if (!usage.length) return <Empty title="No usage yet">AI calls for this client appear here, with tokens and cost.</Empty>;
  return (
    <Card title="AI usage by month" subtitle={`This month: ${usd(org.spend_month)} of a ${usd(org.monthly_budget)} budget.`} pad={false}>
      <table className="w-full">
        <thead><tr><th className="th">Month</th><th className="th">What</th><th className="th">Model</th><th className="th text-right">Calls</th><th className="th text-right">Tokens</th><th className="th text-right">Cost</th></tr></thead>
        <tbody>{usage.map((u, i) => (
          <tr key={i}><td className="td">{new Date(u.month + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</td><td className="td">{u.source.replace('answers: ', 'Answers · ').replace(/^extract$/, 'AI reader')}</td>
            <td className="td text-muted">{u.model || '—'}</td><td className="td text-right tnum">{num(u.calls)}</td><td className="td text-right tnum">{compact(u.tokens)}</td><td className="td text-right tnum">{usd(u.cost)}</td></tr>
        ))}</tbody>
      </table>
    </Card>
  );
}

function Ratings({ ratings }) {
  if (!ratings.length) return <Empty title="No ratings yet">Clients rate each report from 1 to 5 stars, with an optional comment.</Empty>;
  return (
    <div className="grid gap-3">{ratings.map((r, i) => (
      <div key={i} className="card p-5">
        <div className="flex flex-wrap items-center gap-2 text-sm"><Stars value={r.rating} /><span className="font-semibold">{r.title}</span><span className="text-xs text-muted">· {r.full_name || r.email} · {fmtDate(r.created_at)}</span></div>
        {r.comment && <p className="mt-2 text-sm text-ink2">“{r.comment}”</p>}
      </div>
    ))}</div>
  );
}

function People({ org, members, invites, reload }) {
  const user = useUser();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [link, setLink] = useState(null);
  const [err, setErr] = useState(null);
  const admin = user.role === 'admin';
  const act = async f => { setErr(null); try { await f(); } catch (e) { setErr(e.message); } };
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <Card title="People at this client" pad={false}>
        <table className="w-full">
          <thead><tr><th className="th">Name</th><th className="th">Role</th><th className="th">Joined</th><th className="th" /></tr></thead>
          <tbody>
            {members.map(m => (
              <tr key={m.user_id}>
                <td className="td"><div className="font-semibold">{m.full_name || m.email}</div><div className="text-xs text-muted">{m.email}{m.job_title ? ` · ${m.job_title}` : ''}</div></td>
                <td className="td"><Badge>{m.role === 'owner' ? 'Owner' : 'Member'}</Badge></td><td className="td text-muted">{fmtDate(m.created_at)}</td>
                <td className="td text-right whitespace-nowrap">{admin && <>
                  <button className="btn-ghost btn-sm" title="Create a one-time password reset link" onClick={() => act(async () => setLink({ ...(await fn('team', { action: 'reset-link', userId: m.user_id })), kind: 'reset' }))}><KeyRound size={13} />Reset link</button>{' '}
                  <button className="btn-ghost btn-sm" aria-label={`Remove ${m.email}`} onClick={() => confirm(`Remove ${m.email}? They lose access immediately.`) && act(async () => { await fn('team', { action: 'remove-user', userId: m.user_id }); toast('Removed'); reload(); })}><Trash2 size={13} /></button>
                </>}</td>
              </tr>
            ))}
            {invites.map(i => <tr key={i.id}><td className="td text-muted">{i.email}</td><td className="td"><Badge tone="warn">Invited</Badge></td><td className="td text-muted">expires {fmtDate(i.expires_at)}</td><td className="td" /></tr>)}
          </tbody>
        </table>
      </Card>
      {admin && <Card title="Invite someone from this client" subtitle="They get their own login to this client's dashboard.">
        <div className="grid gap-3">
          <input className="input" type="email" placeholder="name@client.com" value={email} onChange={e => setEmail(e.target.value)} />
          <select className="input" value={role} onChange={e => setRole(e.target.value)}><option value="member">Member</option><option value="owner">Owner</option></select>
          <button className="btn-primary" disabled={!email} onClick={() => act(async () => { setLink({ ...(await fn('team', { action: 'invite', orgId: org.id, email, role })), kind: 'invite' }); setEmail(''); reload(); })}>Create invite link</button>
          <ErrorBox error={err} />
        </div>
      </Card>}
      {admin && <TeamAccess orgId={org.id} />}
      <Modal open={!!link} onClose={() => setLink(null)} title={link?.kind === 'reset' ? 'Password reset link' : 'Invite link'}>
        {link && <CopyLink link={link.link} note={link.kind === 'reset' ? `Send this to ${link.email}. It works once and opens a page to choose a new password.` : `Send this to ${link.email}. It works once and expires in 7 days.`} />}
      </Modal>
    </div>
  );
}

// Which Housedge team members can see this client. Admins always see every client; members only the clients ticked here.
function TeamAccess({ orgId }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api(`/admin/clients/${orgId}/team`).then(setRows).catch(e => setErr(e.message)); }, [orgId]);
  const toggle = async u => {
    const ids = rows.filter(r => r.role === 'member' && (r.id === u.id ? !r.hasAccess : r.hasAccess)).map(r => r.id);
    try { setRows(await api(`/admin/clients/${orgId}/team`, { method: 'PUT', body: { userIds: ids } })); toast(`${u.name || u.email}: ${u.hasAccess ? 'access removed' : 'access given'}`); }
    catch (e) { setErr(e.message); }
  };
  return (
    <Card title="Housedge team with access" subtitle="Admins see every client. Team members see only the clients you tick here (read-only), including Ask Housedge." className="lg:col-span-2">
      {!rows ? <ErrorBox error={err} /> : (
        <ul className="divide-y divide-line">
          {rows.map(u => (
            <li key={u.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0"><span className="block truncate text-sm font-medium">{u.name || u.email}</span><span className="block truncate text-xs text-muted">{u.email}</span></span>
              {u.role === 'admin'
                ? <Badge>Admin · always</Badge>
                : <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={u.hasAccess} onChange={() => toggle(u)} />Can see</label>}
            </li>
          ))}
          {!rows.some(u => u.role === 'member') && <li className="py-2.5 text-sm text-muted">No team members yet. Invite colleagues in Settings → Team.</li>}
        </ul>
      )}
      {rows && <ErrorBox error={err} />}
    </Card>
  );
}

// This client's data API key (Google Sheets, Looker Studio…). It opens only this client's data, is shown once,
// and only its last 4 characters are kept to recognise it. Admins only.
function ApiKey({ orgId }) {
  const toast = useToast();
  const [info, setInfo] = useState(undefined);
  const [fresh, setFresh] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => api(`/admin/clients/${orgId}/api-key`).then(setInfo, e => setErr(e.message));
  useEffect(() => { load(); }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = async () => {
    if (info && !confirm('Make a new key? The old key stops working immediately.')) return;
    try { setFresh((await api(`/admin/clients/${orgId}/api-key`, { method: 'POST', body: {} })).key); load(); } catch (e) { setErr(e.message); }
  };
  const revoke = async () => {
    if (!confirm('Revoke this key? Anything using it stops working.')) return;
    try { await api(`/admin/clients/${orgId}/api-key`, { method: 'DELETE' }); setFresh(null); load(); toast('Key revoked'); } catch (e) { setErr(e.message); }
  };
  return (
    <Card title="Data API key" subtitle="Lets the client's own tools (Google Sheets, Looker Studio) read this client's data only. Treat it like a password." className="lg:col-span-2">
      {fresh ? <CopyLink link={fresh} note="Shown only now. Send it to the client securely; Housedge keeps only a fingerprint." />
        : info === undefined ? <ErrorBox error={err} />
          : info ? <p className="text-sm text-ink2">A key ending in <code>…{info.hint}</code> exists, made {fmtDate(info.created_at)}, {info.last_used_at ? `last used ${ago(info.last_used_at)}` : 'never used yet'}.</p>
            : <p className="text-sm text-muted">No key yet.</p>}
      <div className="mt-3 flex gap-2">
        <button className="btn-ghost btn-sm" onClick={create}>{info ? 'Make a new key' : 'Create a key'}</button>
        {info && <button className="btn-ghost btn-sm" onClick={revoke}>Revoke</button>}
      </div>
      {info !== undefined && <ErrorBox error={err} />}
    </Card>
  );
}

function Account({ org, reload }) {
  const toast = useToast();
  const [f, setF] = useState({ health: org.health, healthNote: org.health_note || '', monthlyBudget: String(org.monthly_budget ?? ''), fee: org.fee == null ? '' : String(org.fee), currency: org.currency });
  const [err, setErr] = useState(null);
  const save = async () => { setErr(null); try { await api(`/admin/clients/${org.id}`, { method: 'PATCH', body: f }); toast('Saved'); reload(); } catch (e) { setErr(e.message); } };
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Health" subtitle="Your team's view of this relationship. Clients never see this.">
        <div className="grid gap-3">
          <div className="flex gap-2">{Object.entries(HEALTH).map(([k, [label]]) => <button key={k} className={`chip ${f.health === k ? 'chip-on' : ''}`} onClick={() => setF({ ...f, health: k })}>{label}</button>)}</div>
          <label className="block"><span className="label">Note</span><textarea className="input min-h-[96px]" value={f.healthNote} onChange={e => setF({ ...f, healthNote: e.target.value })} placeholder="e.g. Unhappy with the last report; call before renewal." /></label>
          {org.health_updated_at && <p className="text-xs text-muted">Last changed {fmtDate(org.health_updated_at)}</p>}
        </div>
      </Card>
      <Card title="Budget and fee">
        <div className="grid gap-3">
          <label className="block"><span className="label">Monthly AI budget ($)</span><input className="input" type="number" min="0" value={f.monthlyBudget} onChange={e => setF({ ...f, monthlyBudget: e.target.value })} /><span className="mt-1.5 block text-xs text-muted">Checks pause for this client when it is reached. This month so far: {usd(org.spend_month)}.</span></label>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <label className="block"><span className="label">Monthly fee</span><input className="input" type="number" min="0" value={f.fee} onChange={e => setF({ ...f, fee: e.target.value })} /></label>
            <label className="block"><span className="label">Currency</span><select className="input" value={f.currency} onChange={e => setF({ ...f, currency: e.target.value })}>{['EUR', 'USD', 'GBP', 'SEK'].map(c => <option key={c}>{c}</option>)}</select></label>
          </div>
        </div>
      </Card>
      <div className="lg:col-span-2"><ErrorBox error={err} /><button className="btn-primary mt-2" onClick={save}>Save changes</button></div>
      {useUser().role === 'admin' && <ApiKey orgId={org.id} />}
    </div>
  );
}

