import { Calendar, Globe, Tag, Bot } from 'lucide-react';
import { useApi, useFilters, COUNTRY_FLAGS } from '../lib.js';
import { useMeta, useProject } from '../ctx.js';

// Compact filter pills along the top of every data page.
function SelectPill({ icon: Icon, value, onChange, label, children }) {
  return (
    <span className="relative inline-flex items-center">
      <Icon size={14} className="pointer-events-none absolute left-2.5 text-muted" aria-hidden />
      <select className={`pill pl-8 ${value ? 'pill-on' : ''}`} value={value} onChange={e => onChange(e.target.value)} aria-label={label}>{children}</select>
    </span>
  );
}

export default function FilterBar({ showDays = true }) {
  const meta = useMeta();
  const { project } = useProject();
  const { f, set } = useFilters();
  const opts = useApi(`/projects/${project.id}/filters`);
  const engines = opts.data?.engines || project.engines;
  const selected = f.engines ? f.engines.split(',') : [];
  const toggle = e => {
    const next = selected.includes(e) ? selected.filter(x => x !== e) : [...selected, e];
    set({ engines: next.length === engines.length ? '' : next.join(',') });
  };
  const label = id => meta.engines.find(e => e.id === id)?.label || id;
  return (
    <div className="no-print sticky top-3 z-20 mb-6 flex flex-wrap items-center gap-1.5 rounded-xl bg-surface p-1.5 shadow-card" style={{ border: '1px solid var(--line)' }}>
      {showDays && <SelectPill icon={Calendar} value={f.days} onChange={v => set({ days: v })} label="Period">
        <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
      </SelectPill>}
      <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="AI engines">
        <button className={`pill ${!selected.length ? 'pill-on' : ''}`} onClick={() => set({ engines: '' })}><Bot size={14} className="text-muted" />All engines</button>
        {engines.map(e => <button key={e} className={`pill ${selected.includes(e) ? 'pill-on' : ''}`} aria-pressed={selected.includes(e)} onClick={() => toggle(e)}>{label(e)}</button>)}
      </div>
      <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />
      <SelectPill icon={Globe} value={f.country} onChange={v => set({ country: v })} label="Country">
        <option value="">All countries</option>
        {(opts.data?.countries || []).map(c => <option key={c} value={c}>{COUNTRY_FLAGS[c]} {meta.countries[c] || c}</option>)}
      </SelectPill>
      <SelectPill icon={Tag} value={f.tag} onChange={v => set({ tag: v })} label="Tag">
        <option value="">All tags</option>
        {(opts.data?.tags || []).map(t => <option key={t} value={t}>{t}</option>)}
      </SelectPill>
      {(f.engines || f.country || f.tag) && <button className="ml-1 text-xs text-muted underline hover:text-ink" onClick={() => set({ engines: '', country: '', tag: '' })}>Clear filters</button>}
    </div>
  );
}
