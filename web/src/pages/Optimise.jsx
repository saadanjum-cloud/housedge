// Optimise: brand profile → ready-to-paste website code → AI-written drafts. The client publishes; we never do.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Check, Trash2, WandSparkles, Code, FileText, AlertTriangle } from 'lucide-react';
import { useApi, api, fmtDate } from '../lib.js';
import { useProject } from '../ctx.js';
import { PageHeader, Card, Spinner, ErrorBox, Badge, useToast } from '../ui.jsx';

const LONG = ['description', 'audience', 'products', 'pricing', 'trust'];

export default function Optimise() {
  const { project, readOnly } = useProject();
  const o = useApi(`/projects/${project.id}/optimise`);
  if (o.error) return <ErrorBox error={o.error} />;
  if (!o.data) return <Spinner />;
  return (
    <>
      <PageHeader title="Optimise" subtitle="Turn the findings into fixes you can publish: clear company facts, website code that AI can read, and draft pages. Housedge never publishes anything itself." />
      <div className="grid gap-5">
        <Profile project={project} data={o.data} reload={o.reload} readOnly={readOnly} />
        <WebsiteCode data={o.data} project={project} />
        <Drafts project={project} data={o.data} reload={o.reload} readOnly={readOnly} />
      </div>
    </>
  );
}

function Step({ n, title, subtitle, children, right }) {
  return (
    <Card title={<span className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-[12px] font-semibold text-white">{n}</span>{title}</span>} subtitle={subtitle} right={right}>
      {children}
    </Card>
  );
}

function Profile({ project, data, reload, readOnly }) {
  const toast = useToast();
  const [f, setF] = useState(() => ({ ...data.profile, profiles: (data.profile.profiles || []).join('\n') }));
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF({ ...data.profile, profiles: (data.profile.profiles || []).join('\n') }); }, [data.profile.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const body = Object.fromEntries(Object.keys(data.fields).map(k => [k, k === 'profiles' ? String(f.profiles || '').split('\n').map(s => s.trim()).filter(Boolean) : f[k] ?? '']));
      await api(`/projects/${project.id}/profile`, { method: 'PUT', body });
      toast('Brand profile saved'); reload();
    } catch (e) { setErr(e); }
    setBusy(false);
  };
  return (
    <Step n={1} title="Brand profile" subtitle="One source of truth for everything below. Use only facts you have confirmed — AI drafts never add facts that are not here.">
      <div className="grid gap-4 md:grid-cols-2">
        {Object.entries(data.fields).map(([k, def]) => (
          <div key={k} className={LONG.includes(k) || k === 'profiles' ? 'md:col-span-2' : ''}>
            <label className="label" htmlFor={`pf-${k}`}>{def.label}</label>
            {LONG.includes(k) || k === 'profiles'
              ? <textarea id={`pf-${k}`} className="input" rows={k === 'profiles' ? 3 : 3} value={f[k] || ''} readOnly={readOnly} onChange={e => setF({ ...f, [k]: e.target.value })}
                  placeholder={k === 'profiles' ? 'One per line, e.g. https://www.linkedin.com/company/…' : k === 'products' ? 'One per line' : ''} />
              : <input id={`pf-${k}`} className="input" value={f[k] || ''} readOnly={readOnly} onChange={e => setF({ ...f, [k]: e.target.value })}
                  placeholder={k === 'notConfusedWith' ? 'e.g. a company with a similar name' : k === 'logoUrl' ? 'https://…' : ''} />}
            {k === 'notConfusedWith' && <p className="mt-1 text-[11.5px] text-muted">AI answers about this company are counted separately as “confused”, not as mentions of your brand. Separate several names with a semicolon. Saving recounts past answers.</p>}
          </div>
        ))}
        <div className="md:col-span-2 text-xs text-muted">Website: {data.profile.website || <>not set — add it on the <Link className="text-accent underline" to={`/p/${project.id}/competitors`}>Competitors page</Link></>}</div>
      </div>
      <ErrorBox error={err} />
      {!readOnly && <button className="btn-primary mt-4" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>}
    </Step>
  );
}

function CodeBlock({ title, why, where, code, badge }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(code); setCopied(true); toast('Copied'); setTimeout(() => setCopied(false), 1500); } catch { toast('Copy failed — select the text instead'); } };
  return (
    <div className="rounded-xl border border-line">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold"><Code size={14} />{title}{badge}</div>
          <p className="mt-1 text-sm text-ink2">{why}</p>
          <p className="mt-1 text-xs text-muted"><span className="font-medium text-ink2">Where it goes: </span>{where}</p>
        </div>
        <button className="btn-ghost btn-sm" onClick={copy} disabled={!code}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre tabIndex={0} className="max-h-72 overflow-auto whitespace-pre-wrap break-words bg-raised p-4 text-[12px] leading-relaxed">{code || '—'}</pre>
    </div>
  );
}

function WebsiteCode({ data, project }) {
  const c = data.code;
  if (!data.profile.name) return <Step n={2} title="Website code" subtitle="Save the brand profile first." />;
  return (
    <Step n={2} title="Website code" subtitle="Free and instant. Send these to your web developer — each takes a few minutes to add.">
      <div className="grid gap-4">
        <CodeBlock title="Company facts (structured data)" code={c.organization}
          why="Tells search engines and AI exactly who the company is, what it does and which profiles are official — the single most useful fix for being recognised (and not confused with someone else)."
          where="Inside the <head> of the home page (or every page)." />
        <CodeBlock title="AI crawler access (robots.txt)" code={c.robots.text}
          badge={c.robots.needed ? <Badge tone="bad">Needed</Badge> : <Badge tone="good">Already OK</Badge>}
          why={c.robots.needed ? 'The website check found AI search crawlers blocked (or has not run yet). These lines let AI assistants read the site when answering questions.' : 'The latest website check found no blocked AI search crawlers. Keep these lines in mind if robots.txt changes.'}
          where="In the robots.txt file at the root of the website, above any existing rules." />
        <CodeBlock title="llms.txt summary" code={c.llms}
          why="A short plain-text summary for AI tools. Optional and new — major assistants have not confirmed they use it, but it is cheap to add."
          where="A file named llms.txt at the root of the website (e.g. example.com/llms.txt)." />
        {c.faq ? <CodeBlock title="FAQ (structured data)" code={c.faq}
          why="Marks up the FAQ answers (from the latest FAQ draft below) so search engines and AI can read them as questions and answers."
          where="Inside the <head> of the FAQ page, after the FAQ text itself is published on that page." />
          : <p className="text-sm text-muted">FAQ code appears here after you write an FAQ draft in step 3.</p>}
      </div>
      <p className="mt-3 text-xs text-muted">After the code is live, run the <Link className="text-accent underline" to={`/p/${project.id}/readiness`}>website check</Link> again to confirm.</p>
    </Step>
  );
}

function Drafts({ project, data, reload, readOnly }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);
  const [competitor, setCompetitor] = useState(data.competitors[0] || '');
  const [question, setQuestion] = useState(data.questions[0] || '');
  const ready = data.profile.name && (data.profile.tagline || data.profile.description);
  const write = async (kind, extra = {}) => {
    setBusy(kind); setErr(null);
    try { await api(`/projects/${project.id}/drafts`, { method: 'POST', body: { kind, ...extra } }); toast('Draft written'); reload(); }
    catch (e) { setErr(e); }
    setBusy('');
  };
  const remove = async d => { if (!confirm(`Delete the draft "${d.title}"?`)) return; await api(`/drafts/${d.id}`, { method: 'DELETE' }); reload(); };
  const Btn = ({ kind, label, extra, disabled }) => (
    <button className={`btn-primary btn-sm ${busy === kind ? 'shimmer' : ''}`} onClick={() => write(kind, extra)} disabled={!ready || !!busy || disabled}>
      <WandSparkles size={13} />{busy === kind ? 'Writing…' : label}
    </button>
  );
  return (
    <Step n={3} title="Draft pages" subtitle="Claude writes first drafts from the brand profile only (missing facts become [ADD: …] placeholders).">
      {!readOnly && !ready && <p className="mb-3 rounded-lg bg-warnBg px-3 py-2 text-xs text-warnInk">Fill in at least the brand name and the one-sentence description in step 1.</p>}
      {!readOnly && <div className="flex flex-wrap items-center gap-2">
        <Btn kind="about" label="About page" />
        <Btn kind="faq" label="FAQ" />
        <span className="flex items-center gap-1.5">
          <select className="input w-auto py-1.5 text-[13px]" value={competitor} onChange={e => setCompetitor(e.target.value)} aria-label="Competitor">{data.competitors.map(c => <option key={c}>{c}</option>)}</select>
          <Btn kind="comparison" label="Comparison" extra={{ competitor }} disabled={!competitor} />
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <select className="input w-auto max-w-[260px] py-1.5 text-[13px]" value={question} onChange={e => setQuestion(e.target.value)} aria-label="Question">{data.questions.map(q => <option key={q} value={q}>{q}</option>)}</select>
          <Btn kind="guide" label="Guide" extra={{ question }} disabled={!question} />
        </span>
      </div>}
      <ErrorBox error={err} />
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-line px-3 py-2 text-xs text-ink2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-muted" />
        Drafts are AI-written. Check every fact, fill the placeholders, and have regulated content (finance, gambling, health) approved by your compliance team before publishing.
      </div>
      {data.drafts.length > 0 && (
        <ul className="mt-4 grid gap-3">
          {data.drafts.map(d => <DraftItem key={d.id} d={d} kinds={data.draftKinds} onDelete={readOnly ? null : () => remove(d)} />)}
        </ul>
      )}
    </Step>
  );
}

function DraftItem({ d, kinds, onDelete }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const text = d.kind === 'faq' ? (d.items || []).map(i => `Q: ${i.question}\nA: ${i.answer}`).join('\n\n') : d.body;
  const copy = async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy failed'); } };
  return (
    <li className="rounded-xl border border-line">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4">
        <button className="flex min-w-0 items-center gap-2 text-left" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <FileText size={15} className="shrink-0 text-muted" />
          <span className="truncate text-sm font-medium">{d.title}</span>
          <Badge>{kinds[d.kind]}</Badge><Badge tone="warn">Draft</Badge>
        </button>
        <span className="flex items-center gap-2 text-xs text-muted">
          {fmtDate(d.created_at)}
          <button className="btn-ghost btn-sm" onClick={copy}><Copy size={13} />Copy</button>
          {onDelete && <button className="text-muted hover:text-ink" onClick={onDelete} aria-label="Delete draft"><Trash2 size={14} /></button>}
        </span>
      </div>
      {open && (d.kind === 'faq'
        ? <dl className="grid gap-3 border-t border-line p-4 text-sm">{(d.items || []).map(i => <div key={i.question}><dt className="font-medium">{i.question}</dt><dd className="mt-0.5 text-ink2">{i.answer}</dd></div>)}</dl>
        : <pre tabIndex={0} className="max-h-[480px] overflow-auto whitespace-pre-wrap border-t border-line p-4 font-sans text-sm leading-relaxed text-ink2">{d.body}</pre>)}
    </li>
  );
}
