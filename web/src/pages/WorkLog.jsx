// Work log: every real-world action taken to change what AI says about the brand (a listing, reviews, a new page,
// press…), dated, with what changed in AI answers over the 28 days before vs after. The client and the Housedge
// team both log work here. Before/after shows what changed, not proof of why; ranges are 95% Wilson intervals.
import { useState } from 'react';
import { Plus, ExternalLink, Trash2 } from 'lucide-react';
import { api, useApi, fmtDate, COUNTRY_FLAGS } from '../lib.js';
import { useMeta, useProject } from '../ctx.js';
import { Card, PageHeader, Spinner, ErrorBox, Badge, Empty, Modal, useToast } from '../ui.jsx';
import { WorkLogChart } from '../charts.jsx';

const VERDICT = {
  up: ['Clear rise', 'good'], down: ['Clear fall', 'bad'], measuring: ['Measuring', 'accent'],
  no_clear_change: ['No clear change', 'default'], no_data: ['Not enough answers yet', 'default'], planned: ['Planned', 'default'],
};
const today = () => new Date().toISOString().slice(0, 10);
const range = s => (s?.n ? `${s.p}% (${s.lo}–${s.hi}%)` : '—');

export default function WorkLog() {
  const { project } = useProject();
  const meta = useMeta();
  const toast = useToast();
  const log = useApi(`/projects/${project.id}/interventions`);
  const [form, setForm] = useState(null);
  const [del, setDel] = useState(null);
  const [err, setErr] = useState(null);
  const own = project.brands.find(b => b.is_own)?.name || project.name;
  const blank = { kind: 'listicle', title: '', url: '', doneOn: today(), status: 'live', markets: [], notes: '' };

  const save = async () => {
    setErr(null);
    try { await api(`/projects/${project.id}/interventions`, { method: 'POST', body: form }); toast('Action logged'); setForm(null); log.reload(); }
    catch (e) { setErr(e.message); }
  };
  const patch = async (id, body) => { try { await api(`/interventions/${id}`, { method: 'PATCH', body }); log.reload(); } catch (e) { toast(e.message); } };
  const remove = async () => { try { await api(`/interventions/${del.id}`, { method: 'DELETE' }); setDel(null); toast('Removed'); log.reload(); } catch (e) { toast(e.message); } };

  if (log.error) return <ErrorBox error={log.error} />;
  if (!log.data) return <Spinner />;
  const { items, weekly, kinds, windowDays } = log.data;
  return (
    <>
      <PageHeader title="Work log" subtitle={`Everything done to change what AI says about ${own}, and what changed after. Each action is compared over the ${windowDays} days before and after it went live.`}
        right={<button className="btn-primary" onClick={() => { setErr(null); setForm(blank); }}><Plus size={15} />Log an action</button>} />

      {weekly.length > 0 && (
        <Card title={`How often AI names ${own}, per week`} subtitle="Share of all answers that mention you. A dashed line marks the week an action went live." className="mb-4">
          <WorkLogChart weekly={weekly} actions={items} />
        </Card>
      )}

      {!items.length ? (
        <Empty art title="Nothing logged yet" action={<button className="btn-primary" onClick={() => setForm(blank)}>Log the first action</button>}>
          When something goes live (a listing on a comparison site, a review campaign, a new FAQ page, a press article), log it here with its date. Housedge then compares AI answers before and after, so you can see what actually moved them.
        </Empty>
      ) : (
        <div className="grid gap-3">
          {items.map(i => {
            const [label, tone] = VERDICT[i.verdict] || VERDICT.no_data;
            return (
              <div key={i.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[12px] text-muted">{fmtDate(i.done_on)} · {kinds[i.kind]}{i.markets?.length ? ` · ${i.markets.map(m => COUNTRY_FLAGS[m] || m).join(' ')}` : ''}{i.created_by_name ? ` · logged by ${i.created_by_name}` : ''}</div>
                    <div className="mt-0.5 text-[15px] font-semibold">{i.title}</div>
                    {i.url && <a className="mt-0.5 inline-flex items-center gap-1 text-[13px] text-accent hover:underline" href={i.url} target="_blank" rel="noopener noreferrer nofollow">{i.target_domain}<ExternalLink size={12} /></a>}
                    {i.notes && <p className="mt-1 whitespace-pre-line text-[13px] text-ink2">{i.notes}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={tone}>{label}{i.verdict === 'measuring' ? ` · ${windowDays - (i.days_after || 0)} days left` : ''}</Badge>
                    {i.status === 'planned' && <button className="btn-ghost btn-sm" onClick={() => patch(i.id, { status: 'live', doneOn: today() })}>Went live today</button>}
                    <button className="btn-ghost btn-sm" aria-label="Remove" onClick={() => setDel(i)}><Trash2 size={13} /></button>
                  </div>
                </div>
                {i.status !== 'planned' && (
                  <div className="mt-4 grid gap-3 rounded-xl bg-fill p-3.5 text-[13px] sm:grid-cols-3">
                    <div><div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Before</div>
                      <div className="mt-0.5">{own} named in {i.before.n ? `${i.before_named} of ${i.before.n} answers` : 'no answers yet'}</div><div className="text-muted tnum">{range(i.before)}</div></div>
                    <div><div className="text-[11px] font-semibold uppercase tracking-wide text-muted">After{i.measuring ? ' (so far)' : ''}</div>
                      <div className="mt-0.5">{own} named in {i.after.n ? `${i.after_named} of ${i.after.n} answers` : 'no answers yet'}</div><div className="text-muted tnum">{range(i.after)}</div></div>
                    <div><div className="text-[11px] font-semibold uppercase tracking-wide text-muted">AI read it?</div>
                      <div className="mt-0.5">{!i.target_domain ? 'No link logged' : i.citedSince ? `${i.target_domain} cited in ${i.citedSince} answer${i.citedSince === 1 ? '' : 's'} since (${i.before_cited || 0} before)` : `${i.target_domain} not cited yet`}</div>
                      {i.firstCited && <div className="text-muted">First cited {fmtDate(i.firstCited)}</div>}</div>
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-xs text-muted">A change counts as clear only when the before and after ranges do not overlap. Before/after shows what changed, not proof of why: other things happen at the same time. The more answers on each side, the narrower the ranges.</p>
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title="Log an action">
        {form && (
          <div className="grid gap-3">
            <label className="block"><span className="label">What kind of action</span>
              <select className="input" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>{Object.entries(kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="block"><span className="label">What was done</span>
              <input className="input" maxLength={300} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Listed in nsave's “Best USD accounts for freelancers”" /></label>
            <label className="block"><span className="label">Link (optional)</span>
              <input className="input" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://…" />
              <span className="mt-1 block text-xs text-muted">The page where it lives. We watch whether AI starts citing this site.</span></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="label">Went live on</span>
                <input className="input" type="date" value={form.doneOn} onChange={e => setForm({ ...form, doneOn: e.target.value })} /></label>
              <label className="block"><span className="label">Status</span>
                <select className="input" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}><option value="live">Live</option><option value="planned">Planned</option></select></label>
            </div>
            {project.countries.length > 1 && (
              <div><span className="label">Which markets should it affect? (none chosen = all)</span>
                <div className="flex flex-wrap gap-2">{project.countries.map(m => { const on = form.markets.includes(m); return (
                  <button key={m} className={`chip ${on ? 'chip-on' : ''}`} aria-pressed={on} onClick={() => setForm({ ...form, markets: on ? form.markets.filter(x => x !== m) : [...form.markets, m] })}>{COUNTRY_FLAGS[m]} {meta.countries[m] || m}</button>); })}</div></div>
            )}
            <label className="block"><span className="label">Notes (optional)</span>
              <textarea className="input min-h-[72px]" maxLength={4000} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
            <ErrorBox error={err} />
            <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn-primary" disabled={!form.title.trim()} onClick={save}>Save</button></div>
          </div>
        )}
      </Modal>
      <Modal open={!!del} onClose={() => setDel(null)} title="Remove this action?">
        <p className="text-sm text-ink2">"{del?.title}" is removed from the work log. AI answers are not affected.</p>
        <div className="mt-5 flex justify-end gap-2"><button className="btn-ghost" onClick={() => setDel(null)}>Cancel</button><button className="btn-danger" onClick={remove}>Remove</button></div>
      </Modal>
    </>
  );
}
