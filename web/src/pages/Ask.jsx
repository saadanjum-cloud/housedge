// "Ask Housedge": the agent, as a full chat page (layout modelled on Claude / ChatGPT). It answers about the open
// client's data and, for clients, makes the changes they ask for (questions, competitors, actions, work log, checks)
// through the same tools as MCP. While it works, each tool call shows as a step and the reply streams in.
// The conversation is kept for this browser tab (sessionStorage), per project.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, ArrowRight, Check, ChevronDown, CircleAlert, Copy, Loader2, SquarePen, Wrench } from 'lucide-react';
import { apiStream } from '../lib.js';
import { useProject } from '../ctx.js';
import { Logo } from '../motion.jsx';

const STARTERS = [
  'How are we doing this month, in three bullet points?',
  'Which 3 websites should we try to get listed on first?',
  'What are competitors praised for that we are criticised for?',
  'Write a 5-line summary of this month for our CEO.',
];

// Pages the agent can send people to (same names as the server's open_page tool).
const PAGES = { overview: 'Overview', chats: 'Chats', prompts: 'Questions', competitors: 'Competitors', sources: 'Sources', actions: 'Suggested actions',
  outreach: 'Outreach', work: 'Work log', readiness: 'AI readiness', optimise: 'Optimise', reports: 'Reports', settings: 'Project settings', account: 'Your account' };
const pagePath = (id, page) => (page === 'account' ? '/account#connect' : `/p/${id}/${page}`);

const load = key => { try { return JSON.parse(sessionStorage.getItem(key)) || []; } catch { return []; } };
const save = (key, msgs) => { try { sessionStorage.setItem(key, JSON.stringify(msgs)); } catch { /* storage blocked */ } };

// Small, safe formatter for replies: headings, paragraphs, bullet and numbered lists, **bold**. No HTML is injected.
function Rich({ text }) {
  const inline = s => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (/^\*\*[^*]+\*\*$/.test(part) ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong> : part));
  const blocks = [];
  for (const line of String(text).split('\n')) {
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    const last = blocks[blocks.length - 1];
    if (/^#{1,6}\s/.test(line)) blocks.push({ type: 'h', text: line.replace(/^#+\s*/, '') });
    else if (bullet) {
      if (last?.type === 'list') last.items.push(bullet[1]); else blocks.push({ type: 'list', ordered: /^\s*\d/.test(line), items: [bullet[1]] });
    } else if (line.trim()) {
      if (last?.type === 'p') last.lines.push(line); else blocks.push({ type: 'p', lines: [line] });
    } else blocks.push({ type: 'gap' });
  }
  return (
    <div className="grid gap-3">
      {blocks.filter(b => b.type !== 'gap').map((b, i) => (b.type === 'h' ? <p key={i} className="pt-1 font-semibold text-ink">{inline(b.text)}</p>
        : b.type === 'list'
          ? (b.ordered ? <ol key={i} className="list-decimal space-y-1.5 pl-6">{b.items.map((x, k) => <li key={k} className="pl-1">{inline(x)}</li>)}</ol>
            : <ul key={i} className="list-disc space-y-1.5 pl-6">{b.items.map((x, k) => <li key={k} className="pl-1">{inline(x)}</li>)}</ul>)
          : <p key={i}>{b.lines.map((l, k) => <span key={k}>{k > 0 && <br />}{inline(l)}</span>)}</p>))}
    </div>
  );
}

// What the agent did: a one-line summary that opens into each tool call (open while it works, closed afterwards).
function Steps({ steps, live }) {
  const [open, setOpen] = useState(!!live);
  const tools = steps.filter(s => !s.note);
  if (!live && !tools.length) return null;
  const current = [...tools].reverse().find(s => s.ok == null);
  const failed = tools.filter(s => s.ok === false).length;
  const label = live ? (current ? `${current.title}…` : 'Thinking…') : `Used ${tools.length} tool${tools.length === 1 ? '' : 's'}${failed ? ` · ${failed} failed` : ''}`;
  return (
    <div className="mb-3">
      <button type="button" onClick={() => setOpen(o => !o)} disabled={!steps.length}
        className="inline-flex items-center gap-2 rounded-lg py-1 text-[13.5px] text-muted transition-colors hover:text-ink disabled:hover:text-muted">
        {live ? <Loader2 size={15} className="animate-spin text-accent" /> : <Wrench size={14} />}
        <span className={live ? 'animate-pulse' : ''}>{label}</span>
        {steps.length > 0 && <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>
      {open && steps.length > 0 && (
        <ol className="ml-[7px] mt-1.5 grid gap-2 border-l border-line pl-4 text-[13px]">
          {steps.map((s, i) => (s.note
            ? <li key={i} className="text-ink2">{s.note}</li>
            : <li key={i} className="flex items-center gap-2 text-muted">
                {s.ok == null ? <Loader2 size={13} className="animate-spin text-accent" /> : s.ok ? <Check size={13} className="text-good" /> : <CircleAlert size={13} className="text-bad" />}
                {s.title}{s.ok === false ? ' · failed' : ''}
              </li>))}
        </ol>
      )}
    </div>
  );
}

function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" aria-label="Copy reply" title="Copy" className="rounded-lg p-1.5 text-muted transition-colors hover:bg-fill hover:text-ink"
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>
      {done ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}

function Composer({ value, onChange, onSend, busy, placeholder, autoFocus }) {
  const ref = useRef(null);
  useEffect(() => { const el = ref.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 220)}px`; }, [value]);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  return (
    <form onSubmit={e => { e.preventDefault(); onSend(); }}
      className="rounded-[22px] border border-line bg-surface px-4 pb-3 pt-3.5 shadow-lift">
      <textarea ref={ref} rows={1} value={value} maxLength={2000} placeholder={placeholder} aria-label="Your question"
        onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
        className="block w-full resize-none bg-transparent text-[15px] leading-6 text-ink outline-none placeholder:text-muted" />
      <div className="mt-2 flex items-center justify-between">
        <span className="hidden text-[12px] text-muted sm:inline">Agent · reads your data, makes changes when you ask</span>
        <button disabled={busy || !value.trim()} aria-label="Send"
          className="grid h-9 w-9 place-items-center rounded-full transition-opacity disabled:opacity-30" style={{ background: 'var(--btn)', color: 'var(--btn-ink)' }}>
          {busy ? <Loader2 size={17} className="animate-spin" /> : <ArrowUp size={18} strokeWidth={2.4} />}
        </button>
      </div>
    </form>
  );
}

export default function Ask() {
  const { project } = useProject();
  const key = `ask:${project.id}`;
  const [msgs, setMsgs] = useState(() => load(key));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(null); // { steps, draft } while a reply is being produced
  const [err, setErr] = useState(null);
  const end = useRef(null);
  useEffect(() => { save(key, msgs); }, [key, msgs]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, live]);

  const ask = async q => {
    const question = (q ?? text).trim();
    if (!question || busy) return;
    const next = [...msgs, { role: 'user', content: question }];
    const state = { steps: [], draft: '' };
    setMsgs(next); setText(''); setErr(null); setBusy(true); setLive({ ...state });
    try {
      const r = await apiStream(`/projects/${project.id}/assistant`, { messages: next.map(({ role, content }) => ({ role, content })) }, e => {
        if (e.t === 'text') state.draft += e.d;
        else if (e.t === 'step') {
          // Text written before a tool call is the agent thinking aloud; it goes with the steps, not into the answer.
          if (state.draft.trim()) state.steps.push({ note: state.draft.trim() });
          state.draft = ''; state.steps.push({ name: e.name, title: e.title, ok: null });
        } else if (e.t === 'step_done') { const s = [...state.steps].reverse().find(x => x.name === e.name && x.ok == null); if (s) s.ok = e.ok; }
        else return;
        setLive({ steps: [...state.steps], draft: state.draft });
      });
      setMsgs(m => [...m, { role: 'assistant', content: r.reply, cost: r.cost, steps: state.steps, changed: r.changed || [], pages: (r.pages || []).filter(x => PAGES[x]) }]);
    } catch (e) { setErr(e.message); setMsgs(m => m.slice(0, -1)); setText(question); }
    setLive(null); setBusy(false);
  };

  const possessive = /s$/i.test(project.name) ? `${project.name}’` : `${project.name}’s`;
  const empty = !msgs.length && !live;

  return (
    // Fills the window: cancels the page padding of the app shell (mobile has a 49px top bar).
    <div className="-mx-4 -mb-24 -mt-6 flex h-[calc(100dvh-49px)] flex-col md:-mx-10 md:-mb-24 md:-mt-10 md:h-dvh">
      <header className="flex items-center justify-between gap-3 px-4 py-3 md:px-6">
        <div className="min-w-0 truncate text-[14px]"><span className="font-semibold">Ask Housedge</span><span className="text-muted"> · {project.name}</span></div>
        {msgs.length > 0 && (
          <button type="button" disabled={busy} onClick={() => { setMsgs([]); setErr(null); }}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-ink2 transition-colors hover:bg-fill hover:text-ink disabled:opacity-40">
            <SquarePen size={15} />New chat</button>
        )}
      </header>

      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-16">
          <div className="w-full max-w-[720px]">
            <div className="mb-7 flex flex-col items-center text-center">
              <Logo size={40} />
              <h1 className="mt-4 text-[26px] font-semibold tracking-display md:text-[30px]">What would you like to know about {project.name}?</h1>
              <p className="mt-2 max-w-[520px] text-[14px] text-muted">I read {possessive} tracked AI answers, sources, actions and outreach before I reply, and you can watch each step.</p>
            </div>
            <Composer value={text} onChange={setText} onSend={() => ask()} busy={busy} placeholder={`Ask about ${project.name}…`} autoFocus />
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {STARTERS.map(s => (
                <button key={s} type="button" onClick={() => ask(s)}
                  className="rounded-2xl border border-line px-4 py-3 text-left text-[13.5px] text-ink2 transition-colors hover:bg-fill hover:text-ink">{s}</button>
              ))}
            </div>
            {err && <div className="mt-4 rounded-xl bg-badSoft px-4 py-2.5 text-[13px] text-bad">{err}</div>}
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-4" aria-live="polite">
            <div className="mx-auto grid w-full max-w-[720px] gap-8 pb-6 pt-4 text-[15px] leading-7 text-ink">
              {msgs.map((m, i) => (m.role === 'user'
                ? <div key={i} className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-3xl bg-fill px-4 py-2.5">{m.content}</div>
                : <div key={i}>
                    <Steps steps={m.steps || []} />
                    <Rich text={m.content} />
                    {m.changed?.length > 0 && (
                      <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-accentSoft px-3 py-1 text-[12.5px] font-medium text-accent">
                        <Check size={13} />Changed: {m.changed.map(t => t.replace(/_/g, ' ')).join(', ')}</div>
                    )}
                    {m.pages?.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{m.pages.map(x => (
                      <Link key={x} to={pagePath(project.id, x)}
                        className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:border-accent hover:text-accent">
                        Open {PAGES[x]}<ArrowRight size={13} /></Link>))}</div>}
                    <div className="mt-2 flex items-center gap-1 text-[12px] text-muted">
                      <CopyButton text={m.content} />{m.cost ? <span className="pl-1">about ${m.cost.toFixed(3)}</span> : null}
                    </div>
                  </div>))}
              {live && (
                <div>
                  <Steps steps={live.steps} live />
                  {live.draft && <div><Rich text={live.draft} /><span className="ml-0.5 inline-block h-[1.1em] w-[2px] animate-pulse bg-ink align-[-0.2em]" /></div>}
                </div>
              )}
              <div ref={end} />
            </div>
          </div>
          <div className="px-4 pb-4">
            <div className="mx-auto w-full max-w-[720px]">
              {err && <div className="mb-2 rounded-xl bg-badSoft px-4 py-2.5 text-[13px] text-bad">{err}</div>}
              <Composer value={text} onChange={setText} onSend={() => ask()} busy={busy} placeholder="Reply…" autoFocus />
              <p className="mt-2 text-center text-[11.5px] text-muted">Written by AI from your data and can be wrong. Check important numbers in the app.</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
