// Clients rate each report (1-5 stars and an optional comment). The team sees ratings in the admin console.
import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { api } from '../lib.js';
import { useUser } from '../ctx.js';
import { ErrorBox, useToast } from '../ui.jsx';

export default function ReportRating({ id }) {
  const user = useUser();
  const toast = useToast();
  const [r, setR] = useState(null);
  const [comment, setComment] = useState('');
  const [err, setErr] = useState(null);
  useEffect(() => { if (user.role === 'client') api(`/reports/${id}/rating`).then(x => { setR(x.rating || 0); setComment(x.comment || ''); }, () => setR(0)); }, [id, user.role]);
  if (user.role !== 'client' || r === null) return null;
  const save = async () => {
    setErr(null);
    try { await api(`/reports/${id}/rating`, { method: 'PUT', body: { rating: r, comment } }); toast('Thank you for your feedback'); } catch (e) { setErr(e.message); }
  };
  return (
    <div className="no-print card mb-4 flex flex-wrap items-center gap-4 p-5">
      <div className="text-[13px] font-semibold">How useful is this report?</div>
      <div className="flex" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map(i => (
          <button key={i} role="radio" aria-checked={r === i} aria-label={`${i} of 5`} onClick={() => setR(i)} className="rounded-md p-1 text-warnInk hover:bg-fill">
            <Star size={20} fill={i <= r ? 'currentColor' : 'none'} />
          </button>
        ))}
      </div>
      <input className="input min-w-[220px] flex-1" placeholder="What would make it more useful? (optional)" value={comment} maxLength={2000} onChange={e => setComment(e.target.value)} />
      <button className="btn-primary" disabled={!r} onClick={save}>Send</button>
      {err && <div className="w-full"><ErrorBox error={err} /></div>}
    </div>
  );
}
