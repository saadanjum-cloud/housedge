// "Ask Housedge": a chat panel that answers questions about the open client's data (read-only, via Claude).
// The conversation lives only in this browser tab; each question costs a few cents and counts toward the cap.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X, Send, RotateCcw, Loader2 } from 'lucide-react';
import { api } from './lib.js';

const STARTERS = [
  'How are we doing this month, in three bullet points?',
  'Why are competitors named more often than us?',
  'Which 3 websites should we try to get listed on first?',
  'What do AI assistants say about us that is wrong?',
  'Write a 5-line summary of this month for our CEO.',
];

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

export default function Assistant({ project }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const end = useRef(null);
  const input = useRef(null);
  // A new client starts a new conversation.
  useEffect(() => { setMsgs([]); setErr(null); }, [project.id]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy]);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 50); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const ask = async q => {
    const question = (q ?? text).trim();
    if (!question || busy) return;
    const next = [...msgs, { role: 'user', content: question }];
    setMsgs(next); setText(''); setErr(null); setBusy(true);
    try {
      const r = await api(`/projects/${project.id}/assistant`, { method: 'POST', body: { messages: next.map(({ role, content }) => ({ role, content })) } });
      setMsgs(m => [...m, { role: 'assistant', content: r.reply, cost: r.cost, tools: r.toolsUsed }]);
    } catch (e) { setErr(e.message); setMsgs(m => m.slice(0, -1)); setText(question); }
    setBusy(false);
  };

  return createPortal(
    <div className="no-print">
      {!open && (
        <button onClick={() => setOpen(true)} className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full px-4 py-3 text-[14px] font-semibold shadow-lift transition-transform hover:-translate-y-0.5"
          style={{ background: 'var(--btn)', color: 'var(--btn-ink)' }} aria-label={`Ask Housedge about ${project.name}`}>
          <Sparkles size={17} />Ask Housedge
        </button>
      )}
      {open && (
        <section role="dialog" aria-label={`Ask Housedge about ${project.name}`} className="fixed inset-x-0 bottom-0 z-50 flex h-[85vh] flex-col border-line bg-surface shadow-lift sm:inset-x-auto sm:bottom-5 sm:right-5 sm:h-[min(680px,calc(100vh-40px))] sm:w-[420px] sm:rounded-2xl sm:border"
          style={{ borderTop: '1px solid var(--line)' }}>
          <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[15px] font-bold"><Sparkles size={16} className="text-accent" />Ask Housedge</div>
              <div className="truncate text-[11.5px] text-muted">About {project.name} only · reads data, changes nothing</div>
            </div>
            <span className="flex items-center gap-1">
              {msgs.length > 0 && <button className="rounded-lg p-2 text-muted hover:bg-fill hover:text-ink" onClick={() => { setMsgs([]); setErr(null); }} aria-label="New conversation" title="New conversation"><RotateCcw size={15} /></button>}
              <button className="rounded-lg p-2 text-muted hover:bg-fill hover:text-ink" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button>
            </span>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-4 text-[14px] leading-relaxed" aria-live="polite">
            {!msgs.length && (
              <div>
                <p className="text-ink2">Ask anything about {/s$/i.test(project.name) ? `${project.name}’` : `${project.name}’s`} AI visibility. I look at the tracked answers, sources, actions and outreach before I reply.</p>
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
                    <div className="rounded-2xl rounded-bl-md bg-raised px-3.5 py-3 text-ink"><Rich text={m.content} /></div>
                    <div className="mt-1 pl-1 text-[11px] text-muted">Looked at: {(m.tools || []).map(t => t.replace(/^get_|_/g, ' ').trim()).join(', ') || 'conversation only'}{m.cost ? ` · about $${m.cost.toFixed(3)}` : ''}</div>
                  </div>))}
              {busy && <div className="flex items-center gap-2 text-[13px] text-muted"><Loader2 size={14} className="animate-spin" />Looking at the data…</div>}
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
        </section>
      )}
    </div>,
    document.body,
  );
}
