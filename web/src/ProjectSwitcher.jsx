// Client switcher in the sidebar: a searchable popover instead of the browser's plain dropdown.
// Keyboard: ↑/↓ to move, Enter to open, Esc to close, type to filter.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronsUpDown, FolderKanban, Plus, Search } from 'lucide-react';
import { useMeta } from './ctx.js';
import { EASE } from './motion.jsx';

const TINTS = ['#0a84ff', '#bf5af2', '#30d158', '#ff9f0a', '#ff375f', '#64d2ff', '#5e5ce6', '#ffd60a'];
const tint = name => TINTS[[...String(name)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TINTS.length];

export function ProjectAvatar({ name, size = 28 }) {
  const c = tint(name);
  return (
    <span className="grid shrink-0 place-items-center rounded-[9px] font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.46, background: `linear-gradient(140deg, ${c}, ${c}cc)`, boxShadow: `inset 0 0 0 1px rgba(255,255,255,.18)` }} aria-hidden>
      {String(name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
}

// team: our own team sees "All clients" and "New client"; a client only switches between its own projects.
export default function ProjectSwitcher({ projects, currentId, team }) {
  const meta = useMeta();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const wrap = useRef(null), input = useRef(null), btn = useRef(null), pop = useRef(null);
  const [pos, setPos] = useState(null);
  const current = projects?.find(p => String(p.id) === String(currentId));

  // List: "All clients" first, then matching projects, then "New client".
  const items = useMemo(() => {
    const list = (projects || []).filter(p => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()));
    const own = list.map(p => ({ kind: 'project', p }));
    return team ? [{ kind: 'all' }, ...own, { kind: 'new' }] : own;
  }, [projects, q, team]);

  useEffect(() => { if (open) { setQ(''); setActive(Math.max(0, items.findIndex(i => i.p && String(i.p.id) === String(currentId)))); setTimeout(() => input.current?.focus(), 0); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setActive(a => Math.min(a, items.length - 1)); }, [items.length]);
  // The list floats above the page (not inside the scrolling sidebar), placed under the button.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(Math.max(r.width, 320), window.innerWidth - 16);
      setPos({ top: r.bottom + 8, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width, maxHeight: Math.max(200, window.innerHeight - r.bottom - 24) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (!wrap.current?.contains(e.target) && !pop.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const choose = item => {
    setOpen(false);
    if (item.kind === 'all') nav('/admin');
    else if (item.kind === 'new') nav('/admin?new=1');
    else nav(`/p/${item.p.id}/${team ? 'journey' : 'overview'}`);
    btn.current?.focus();
  };
  const onKey = e => {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + items.length) % items.length); }
    else if (e.key === 'Enter') { e.preventDefault(); items[active] && choose(items[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btn.current?.focus(); }
  };
  const optId = i => `proj-opt-${i}`;

  return (
    <div className="relative px-1" ref={wrap} onKeyDown={onKey}>
      <div className="label">{team ? 'Client' : 'Project'}</div>
      <button ref={btn} type="button" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-surface px-2.5 py-2 text-left shadow-thumb transition-colors hover:bg-raised focus:outline-none focus-visible:ring-4 focus-visible:ring-accentSoft">
        {current ? <ProjectAvatar name={current.name} /> : <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-fill text-ink2"><FolderKanban size={15} /></span>}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{current ? current.name : team ? 'All clients' : 'Your projects'}</span>
          <span className="block truncate text-[11px] text-muted">{!team ? (current ? 'Your brand' : `${projects?.length ?? 0} projects`) : current ? meta.categories[current.category] || 'Client' : `${projects?.length ?? 0} clients`}</span>
        </span>
        <ChevronsUpDown size={15} className="shrink-0 text-muted" />
      </button>

      {createPortal(<AnimatePresence>
        {open && pos && (
          <motion.div ref={pop} onKeyDown={onKey} initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: EASE }}
            style={{ transformOrigin: 'top left', position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
            className="z-[60] overflow-hidden rounded-2xl border border-line bg-surface shadow-lift">
            <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
              <Search size={14} className="text-muted" />
              <input ref={input} value={q} onChange={e => { setQ(e.target.value); setActive(1); }} placeholder="Find a client…"
                className="w-full bg-transparent text-[13px] text-ink placeholder:text-muted focus:outline-none"
                role="combobox" aria-expanded="true" aria-controls="proj-list" aria-activedescendant={optId(active)} aria-label="Find a client" />
            </div>
            <ul id="proj-list" role="listbox" aria-label="Clients" className="overflow-y-auto p-1.5" style={{ maxHeight: Math.min(pos.maxHeight - 60, 380) }}>
              {items.map((it, i) => {
                const selected = it.kind === 'project' ? String(it.p.id) === String(currentId) : it.kind === 'all' && !currentId;
                const cls = `flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-[13px] ${i === active ? 'bg-fill' : ''}`;
                return (
                  <li key={it.kind === 'project' ? it.p.id : it.kind} id={optId(i)} role="option" aria-selected={selected}
                    onMouseEnter={() => setActive(i)} onClick={() => choose(it)}
                    className={`${cls} ${it.kind === 'new' ? 'mt-1 border-t border-line pt-2 text-accent' : ''}`}>
                    {it.kind === 'all' && <><span className="grid h-7 w-7 place-items-center rounded-[9px] bg-fill text-ink2"><FolderKanban size={14} /></span><span className="flex-1 font-medium">All clients</span></>}
                    {it.kind === 'new' && <><span className="grid h-7 w-7 place-items-center rounded-[9px] bg-accentSoft"><Plus size={15} /></span><span className="flex-1 font-medium">New client</span></>}
                    {it.kind === 'project' && <>
                      <ProjectAvatar name={it.p.name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{it.p.name}</span>
                        {team && <span className="block truncate text-[11px] text-muted">{meta.categories[it.p.category] || 'Client'} · {it.p.data_mode === 'live' ? 'Live data' : 'Simulated'}</span>}
                      </span>
                    </>}
                    {selected && <Check size={15} className="shrink-0 text-accent" />}
                  </li>
                );
              })}
              {!items.some(i => i.kind === 'project') && q && <li className="px-2 py-3 text-center text-[12px] text-muted">No client matches "{q}"</li>}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </div>
  );
}
