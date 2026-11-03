// "Ask Housedge": the agent chat, docked on the right. It answers about the open client's data and, for clients,
// makes the changes they ask for (questions, competitors, actions, work log, checks) through the same tools as MCP.
// While it works, every tool call shows as a step and the reply streams in. Opened from the sidebar ("Ask Housedge")
// or by firing the "housedge:ask" event. The conversation lives only in this browser tab.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { BotMessageSquare, X, Send, RotateCcw, Loader2, ArrowRight, Check, CircleAlert } from 'lucide-react';
import { apiStream } from './lib.js';

export const OPEN_EVENT = 'housedge:ask';
export const openAssistant = () => window.dispatchEvent(new Event(OPEN_EVENT));

const STARTERS = [
  'How are we doing this month, in three bullet points?',
  'Why are competitors named more often than us?',
  'Which 3 websites should we try to get listed on first?',
  'What do AI assistants say about us that is wrong?',
  'What are competitors praised for that we are criticised for?',
  'Write a 5-line summary of this month for our CEO.',
  'How do I add a competitor?',
  'Where do I get the code for our website?',
];

// Pages Ask Housedge can send people to (same names as the server's open_page tool).
const PAGES = { overview: 'Overview', chats: 'Chats', prompts: 'Questions', competitors: 'Competitors', sources: 'Sources', actions: 'Suggested actions',
  outreach: 'Outreach', work: 'Work log', readiness: 'AI readiness', optimise: 'Optimise', reports: 'Reports', settings: 'Project settings', account: 'Your account' };
const pagePath = (id, page) => (page === 'account' ? '/account#connect' : `/p/${id}/${page}`);

// Small, safe formatter for the reply: paragraphs, bullet and numbered lists, **bold**. No HTML is injected.
function Rich({ text }) {
  const inline = s => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (/^\*\*[^*]+\*\*$/.test(part) ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
  const blocks = [];
  for (const line of String(text).split('\n')) {
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    const last = blocks[blocks.length - 1];
    if (bullet) {
      if (last?.type === 'list') last.items.push(bullet[1]); else blocks.push({ type: 'list', ordered: /^\s*\d/.test(line), items: [bullet[1]] });
    } else if (line.trim()) {
      if (last?.type === 'p') last.lines.push(line.replace(/^#+\s*/, '')); else blocks.push({ type: 'p', lines: [line.replace(/^#+\s*/, '')] });
    } else blocks.push({ type: 'gap' });
  }
  return (
    <div className="grid gap-2">
      {blocks.filter(b => b.type !== 'gap').map((b, i) => (b.type === 'list'
        ? (b.ordered ? <ol key={i} className="list-decimal space-y-1 pl-5">{b.items.map((x, k) => <li key={k}>{inline(x)}</li>)}</ol>
          : <ul key={i} className="list-disc space-y-1 pl-5">{b.items.map((x, k) => <li key={k}>{inline(x)}</li>)}</ul>)
        : <p key={i}>{b.lines.map((l, k) => <span key={k}>{k > 0 && <br />}{inline(l)}</span>)}</p>))}
    </div>
  );
}

// What the agent did for one reply: each tool call with its outcome, and anything it said between calls.
function Steps({ steps, live }) {
  if (!steps.length) return null;
  return (
    <ol className="mb-2 grid gap-1 text-[12.5px] text-muted">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-2">
          {s.note ? <span className="w-[14px] shrink-0" />
            : s.ok == null ? <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-accent" />
              : s.ok ? <Check size={14} className="mt-0.5 shrink-0 text-good" /> : <CircleAlert size={14} className="mt-0.5 shrink-0 text-bad" />}
          <span className={s.note ? 'italic' : ''}>{s.note || s.title}{s.ok === false ? ' · failed' : ''}</span>
        </li>))}
      {live && steps.every(s => s.ok != null) && !steps[steps.length - 1].note && <li className="flex items-center gap-2"><Loader2 size={14} className="animate-spin text-accent" />Thinking…</li>}
    </ol>
  );
}

export default function Assistant({ project }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(null); // { steps, draft } while a reply is being produced
  const [err, setErr] = useState(null);
  const end = useRef(null);
  const input = useRef(null);
  // A new client starts a new conversation.
  useEffect(() => { setMsgs([]); setErr(null); }, [project.id]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, live]);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 50); }, [open]);
  useEffect(() => {
    const show = () => setOpen(true);
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener(OPEN_EVENT, show); window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener(OPEN_EVENT, show); window.removeEventListener('keydown', onKey); };
  }, []);

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
          // Text written before a tool call is the agent thinking aloud; keep it with the steps, not as the answer.
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

  if (!open) return null;
  return createPortal(
    <section role="dialog" aria-label={`Ask Housedge about ${project.name}`}
      className="no-print fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-surface shadow-lift sm:w-[440px]" style={{ borderLeft: '1px solid var(--line)' }}>
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[15px] font-bold"><BotMessageSquare size={17} className="text-accent" />Ask Housedge</div>
          <div className="truncate text-[11.5px] text-muted">Agent for {project.name} · reads the data, makes changes when you ask</div>
        </div>
        <span className="flex items-center gap-1">
          {msgs.length > 0 && <button className="rounded-lg p-2 text-muted hover:bg-fill hover:text-ink" onClick={() => { setMsgs([]); setErr(null); }} aria-label="New conversation" title="New conversation"><RotateCcw size={15} /></button>}
          <button className="rounded-lg p-2 text-muted hover:bg-fill hover:text-ink" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button>
        </span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 text-[14px] leading-relaxed" aria-live="polite">
        {!msgs.length && (
          <div>
            <p className="text-ink2">Ask anything about {/s$/i.test(project.name) ? `${project.name}’` : `${project.name}’s`} AI visibility. I look at the tracked answers, sources, actions and outreach before I reply, and you see each step.</p>
            <div className="mt-4 grid gap-2">
              {STARTERS.map(s => (
                <button key={s} onClick={() => ask(s)} className="rounded-xl border border-line px-3 py-2 text-left text-[13px] text-ink2 transition-colors hover:border-accent hover:text-ink">{s}</button>
              ))}
            </div>
          </div>
        )}
        <div className="grid gap-3">
          {msgs.map((m, i) => (m.role === 'user'
            ? <div key={i} className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md px-3.5 py-2.5" style={{ background: 'var(--bubble)', color: 'var(--bubble-ink)' }}>{m.content}</div>
            : <div key={i} className="max-w-[95%]">
                <Steps steps={m.steps || []} />
                <div className="rounded-2xl rounded-bl-md bg-raised px-3.5 py-3 text-ink"><Rich text={m.content} /></div>
                {m.pages?.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{m.pages.map(x => (
                  <Link key={x} to={pagePath(project.id, x)} onClick={() => { if (x === 'account') setOpen(false); }}
                    className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:border-accent hover:text-accent">
                    Open {PAGES[x]}<ArrowRight size={13} /></Link>))}</div>}
                <div className="mt-1 pl-1 text-[11px] text-muted">{m.changed?.length ? <span className="text-accent">Changed: {m.changed.map(t => t.replace(/_/g, ' ')).join(', ')} · </span> : null}{(m.steps || []).filter(s => !s.note).length || 'no'} tool {(m.steps || []).filter(s => !s.note).length === 1 ? 'call' : 'calls'}{m.cost ? ` · about $${m.cost.toFixed(3)}` : ''}</div>
              </div>))}
          {live && (
            <div className="max-w-[95%]">
              <Steps steps={live.steps} live />
              {live.draft ? <div className="rounded-2xl rounded-bl-md bg-raised px-3.5 py-3 text-ink"><Rich text={live.draft} /><span className="ml-0.5 inline-block h-[1em] w-[2px] animate-pulse bg-accent align-middle" /></div>
                : !live.steps.length && <div className="flex items-center gap-2 text-[12.5px] text-muted"><Loader2 size={14} className="animate-spin text-accent" />Reading your question…</div>}
            </div>
          )}
          <div ref={end} />
        </div>
      </div>

      {err && <div className="mx-4 mb-2 rounded-lg bg-badSoft px-3 py-2 text-[12.5px] text-bad">{err}</div>}
      <form className="border-t border-line p-3" onSubmit={e => { e.preventDefault(); ask(); }}>
        <div className="flex items-end gap-2">
          <textarea ref={input} rows={1} value={text} maxLength={2000} placeholder={`Ask about ${project.name}…`} aria-label="Your question"
            onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
            className="input max-h-32 min-h-[42px] resize-none py-2.5" />
          <button className="btn-primary h-[42px] w-[42px] shrink-0 !px-0" disabled={busy || !text.trim()} aria-label="Send"><Send size={16} /></button>
        </div>
        <p className="mt-1.5 text-[10.5px] text-muted">AI-written from your data and can be wrong. Check important numbers in the app. Each question costs a few cents.</p>
      </form>
    </section>,
    document.body,
  );
}
