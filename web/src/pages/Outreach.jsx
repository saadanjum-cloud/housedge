// Outreach: the websites AI cites where the client is missing, with a status per site and honest email drafts.
// Housedge never sends anything: people decide, write and send.
import { useEffect, useState } from 'react';
import { Plus, Trash2, Mail, Copy, ChevronDown, ChevronUp, ExternalLink, Info, WandSparkles } from 'lucide-react';
import { useApi, api, useFilters, fmtDate, safeHref } from '../lib.js';
import { useProject } from '../ctx.js';
import { PageHeader, Card, Spinner, ErrorBox, Empty, useToast } from '../ui.jsx';
import FilterBar from './FilterBar.jsx';

// Colour of the status picker, so the list can be scanned at a glance.
const STATUS_CLASS = { todo: '', contacted: 'pill-on', replied: 'pill-on', listed: '!bg-goodSoft !text-good', no_reply: '!bg-warnBg !text-warnInk', declined: '!bg-badSoft !text-bad' };

export default function Outreach() {
  const { project } = useProject();
  const { qs } = useFilters();
  const o = useApi(`/projects/${project.id}/outreach?${qs}`);
  const [view, setView] = useState(null);
  useEffect(() => { if (o.data) setView(o.data); }, [o.data]);
  if (o.error) return <><FilterBar /><ErrorBox error={o.error} /></>;
  if (!view) return <><FilterBar /><Spinner /></>;
  const call = async (path, opts) => { const next = await api(`${path}?${qs}`, opts); setView(next); return next; };
  return (
    <>
      <PageHeader title="Outreach" subtitle="AI assistants build answers from the websites they trust. These are the sites they cite where you are missing. Work through them one by one and track what happens." />
      <FilterBar />
      <div className="mb-5 flex items-start gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-ink2">
        <Info size={15} className="mt-0.5 shrink-0 text-muted" />
        Honest outreach only: ask to be considered or reviewed fairly. Never pay for listings or reviews, never post anonymously, and follow the advertising rules of your industry.
        Housedge never sends anything itself.
      </div>
      <StatusStrip view={view} />
      <div className="grid gap-5">
        <Targets view={view} call={call} projectId={project.id} />
        <List view={view} call={call} />
      </div>
    </>
  );
}

function StatusStrip({ view }) {
  return (
    <div className="mb-5 flex flex-wrap gap-2">
      {Object.entries(view.statuses).map(([k, label]) => (
        <span key={k} className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px]">
          <span className="text-muted">{label}</span><span className="tnum font-semibold">{view.counts[k] || 0}</span>
        </span>
      ))}
    </div>
  );
}

function Targets({ view, call, projectId }) {
  const toast = useToast();
  const [domain, setDomain] = useState('');
  const [err, setErr] = useState(null);
  const add = async d => {
    setErr(null);
    try { await call(`/projects/${projectId}/outreach`, { method: 'POST', body: { domain: d } }); toast(`${d} added to the list`); setDomain(''); }
    catch (e) { setErr(e.message); }
  };
  return (
    <Card title="Suggested websites" subtitle="Cited by AI in this period, while you are named in less than half of those answers. Brand websites are left out." pad={false}>
      {view.targets.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead><tr className="border-y border-line"><th className="th pl-5">Website</th><th className="th">Cited in</th><th className="th">Client named</th><th className="th">AI names instead</th><th className="th">Suggested step</th><th className="th pr-5" /></tr></thead>
            <tbody>{view.targets.map(t => (
              <tr key={t.domain} className="border-b border-line last:border-0">
                <td className="td pl-5"><div className="font-medium">{t.domain}</div><div className="text-[11px] text-muted">{t.type}</div></td>
                <td className="td tnum">{t.share}%<div className="text-[11px] text-muted">{t.answers} answers</div></td>
                <td className="td tnum"><span className={t.withOwn / t.answers < 0.3 ? 'font-medium text-bad' : ''}>{Math.round((100 * t.withOwn) / t.answers)}%</span></td>
                <td className="td text-[12.5px] text-ink2">{t.competitors.join(', ') || '—'}</td>
                <td className="td max-w-[260px]"><div className="font-medium">{t.action.label}</div><div className="text-[11.5px] leading-snug text-muted">{t.action.tip}</div></td>
                <td className="td pr-5 text-right"><button className="btn-primary btn-sm" onClick={() => add(t.domain)}><Plus size={13} />Add</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="px-5 pb-2 text-sm text-muted">No new suggestions in this period. Run a check, choose a longer period, or add a website yourself below.</p>}
      <form className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-4" onSubmit={e => { e.preventDefault(); if (domain.trim()) add(domain.trim()); }}>
        <input className="input max-w-xs py-2" placeholder="Add a website, e.g. example.com" value={domain} onChange={e => setDomain(e.target.value)} aria-label="Website to add" />
        <button className="btn-ghost btn-sm" disabled={!domain.trim()}><Plus size={13} />Add website</button>
        <ErrorBox error={err} />
      </form>
    </Card>
  );
}

function List({ view, call }) {
  if (!view.items.length) return (
    <Card title="Your outreach list">
      <Empty title="Nothing on the list yet">Add websites from the suggestions above. Each one gets a status, contact details, notes and an email draft.</Empty>
    </Card>
  );
  return (
    <Card title="Your outreach list" subtitle="Update the status as you go. When a site lists you, Housedge compares how often AI cites it before and after, and adds it to the Work log." pad={false}>
      <ul className="divide-y divide-line border-t border-line">
        {view.items.map(i => <Item key={i.id} item={i} statuses={view.statuses} call={call} />)}
      </ul>
    </Card>
  );
}

function Item({ item, statuses, call }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(item);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState('');
  useEffect(() => setF(item), [item]);
  const save = async (patch = {}) => {
    setErr(null); setBusy('save');
    const body = { ...Object.fromEntries(['status', 'contact_name', 'contact_email', 'contact_url', 'listed_url', 'notes', 'next_step_at'].map(k => [k, f[k] ?? ''])), ...patch };
    try { await call(`/outreach/${item.id}`, { method: 'PUT', body }); toast('Saved'); }
    catch (e) { setErr(e.message); }
    setBusy('');
  };
  const email = async () => {
    setErr(null); setBusy('email');
    try { const d = await api(`/outreach/${item.id}/email`, { method: 'POST' }); setF(x => ({ ...x, email_subject: d.subject, email_body: d.body })); toast('Email drafted'); }
    catch (e) { setErr(e.message); }
    setBusy('');
  };
  const remove = async () => { if (confirm(`Remove ${item.domain} from the list?`)) await call(`/outreach/${item.id}`, { method: 'DELETE' }); };
  const copy = async () => { try { await navigator.clipboard.writeText(`Subject: ${f.email_subject}\n\n${f.email_body}`); toast('Copied'); } catch { toast('Copy failed'); } };
  const imp = item.impact;
  const field = (k, label, props = {}) => (
    <div><label className="label" htmlFor={`o-${item.id}-${k}`}>{label}</label>
      <input id={`o-${item.id}-${k}`} className="input py-2" value={f[k] || ''} onChange={e => setF({ ...f, [k]: e.target.value })} {...props} /></div>
  );
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen(x => !x)} aria-expanded={open}>
          {open ? <ChevronUp size={15} className="text-muted" /> : <ChevronDown size={15} className="text-muted" />}
          <span className="min-w-0"><span className="block truncate font-semibold">{item.domain}</span><span className="block text-[11.5px] text-muted">{item.type} · {item.action.label}</span></span>
        </button>
        {item.next_step_at && <span className="text-[12px] text-muted">Next step {fmtDate(item.next_step_at)}</span>}
        <select className={`pill ${STATUS_CLASS[item.status]}`} value={f.status} onChange={e => { setF({ ...f, status: e.target.value }); save({ status: e.target.value }); }} aria-label={`Status of ${item.domain}`}>
          {Object.entries(statuses).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      {imp && (
        <div className="mt-2 rounded-lg bg-goodSoft px-3 py-2 text-[12.5px] text-good">
          Listed since {fmtDate(imp.since)}. AI cited {item.domain} in {imp.before.cited} of {imp.before.answers} answers before and {imp.after.cited} of {imp.after.answers} since,
          naming the client in {imp.after.citedWithOwn} of those. AI answers change for many reasons; this is a sign, not proof.
        </div>
      )}
      {open && (
        <div className="mt-4 grid gap-4">
          <p className="text-[12.5px] text-ink2">{item.action.tip}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {field('contact_name', 'Contact name')}
            {field('contact_email', 'Contact email', { type: 'email' })}
            {field('contact_url', 'Contact page', { placeholder: 'https://…' })}
            {field('listed_url', 'Published page (once listed)', { placeholder: 'https://…' })}
            {field('next_step_at', 'Next step date', { type: 'date' })}
          </div>
          <div><label className="label" htmlFor={`o-${item.id}-notes`}>Notes</label>
            <textarea id={`o-${item.id}-notes`} className="input" rows={2} value={f.notes || ''} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary btn-sm" onClick={() => save()} disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
            <button className={`btn-ghost btn-sm ${busy === 'email' ? 'shimmer' : ''}`} onClick={email} disabled={!!busy}><WandSparkles size={13} />{busy === 'email' ? 'Writing…' : f.email_body ? 'Rewrite email' : 'Write email with Claude'}</button>
            {f.contact_url && <a className="btn-ghost btn-sm" href={safeHref(f.contact_url)} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} />Contact page</a>}
            <button className="ml-auto text-muted hover:text-bad" onClick={remove} aria-label={`Remove ${item.domain}`}><Trash2 size={15} /></button>
          </div>
          <ErrorBox error={err} />
          {f.email_body && (
            <div className="rounded-xl border border-line">
              <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                <span className="flex items-center gap-2 text-[13px] font-medium"><Mail size={14} />{f.email_subject}</span>
                <span className="flex gap-2">
                  <button className="btn-ghost btn-sm" onClick={copy}><Copy size={13} />Copy</button>
                  {f.contact_email && <a className="btn-ghost btn-sm" href={`mailto:${encodeURIComponent(f.contact_email)}?subject=${encodeURIComponent(f.email_subject)}&body=${encodeURIComponent(f.email_body)}`}><Mail size={13} />Open in email</a>}
                </span>
              </div>
              <pre tabIndex={0} className="whitespace-pre-wrap p-4 font-sans text-[13px] leading-relaxed text-ink2">{f.email_body}</pre>
              <p className="border-t border-line px-4 py-2 text-[11.5px] text-muted">AI-written draft. Check every fact, fill the [ADD: …] parts, and send it yourself. Costs a few cents and counts toward the monthly cap.</p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
