// Social: a guided flow. 1 Scan the platforms. 2 See what people say and where competitors are named without you.
// 3 Make the posts that fill the gap (the draft appears right under its idea). 4 Other drafts. At the bottom, for
// the curious: which social posts the AI engines already cite. Housedge never posts anything.
import { useEffect, useState } from 'react';
import { ExternalLink, WandSparkles, Copy, Trash2, FileText, Radar, ChevronDown } from 'lucide-react';
import { useApi, useFilters, api, apiStream, safeHref, fmtDate } from '../lib.js';
import { Logo } from '../motion.jsx';
import { useProject } from '../ctx.js';
import { Card, PageHeader, Spinner, ErrorBox, Badge, SimBanner, Segmented, Empty, EngineLogo, PlatformLogo, useToast } from '../ui.jsx';
import FilterBar from './FilterBar.jsx';

const SCAN_PLATFORMS = ['reddit', 'youtube', 'quora']; // LinkedIn cannot be searched (Nov 2026), so it is not shown
const SCAN_LABEL = { reddit: 'Reddit', linkedin: 'LinkedIn', youtube: 'YouTube', quora: 'Quora' };
const SENT = { positive: 'good', mixed: 'warn', negative: 'bad', neutral: 'default' };
const OWNER = { own: ['Yours', 'accent'], competitor: ['Competitor', 'bad'], third: ['Third party', 'default'] };
const same = (a, b) => String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '') === String(b || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const draftOf = (drafts, i) => drafts.find(x => x.platform === i.platform && x.question === i.topic);

const Step = ({ n, title, subtitle, right, children }) => (
  <section className="card p-5 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-[13px] font-bold text-white">{n}</span>
        <div><h2 className="text-[17px] font-semibold leading-7">{title}</h2>{subtitle && <p className="mt-0.5 max-w-3xl text-[13.5px] text-muted">{subtitle}</p>}</div>
      </div>
      {right}
    </div>
    <div className="mt-4">{children}</div>
  </section>
);

export default function Social() {
  const { project, readOnly } = useProject();
  const { qs } = useFilters();
  const s = useApi(`/projects/${project.id}/social?${qs}`);
  const toast = useToast();
  const own = project.brands.find(b => b.is_own)?.name || project.name;
  const [scanning, setScanning] = useState(null); // null, or { steps: { reddit: 'searching' | n | 'failed' }, reading }
  const [scanErr, setScanErr] = useState(null);
  const [plat, setPlat] = useState(''); // '' = every platform; else only this one, everywhere on the page
  const scan = async () => {
    setScanning({ steps: Object.fromEntries(SCAN_PLATFORMS.map(p => [p, 'searching'])), reading: false }); setScanErr(null);
    try {
      await apiStream(`/projects/${project.id}/social/scan`, {}, e => {
        if (e.t === 'platform') setScanning(x => x && ({ ...x, steps: { ...x.steps, [e.platform]: e.unavailable ? 'unavailable' : e.failed ? 'failed' : e.posts } }));
        if (e.t === 'reading') setScanning(x => x && ({ ...x, reading: true }));
      });
      toast('Scan finished'); s.reload();
    } catch (e) { setScanErr(e); }
    setScanning(null);
  };
  if (s.error) return <ErrorBox error={s.error} />;
  const d = s.data;
  const scanBtn = !readOnly && !scanning && <button className="btn-primary" onClick={scan}><Radar size={15} />{d?.scan ? 'Scan again' : 'Scan now'}</button>;
  const otherDrafts = d ? d.drafts.filter(x => !(d.scan?.ideas || []).some(i => draftOf([x], i))) : [];
  return (
    <>
      <PageHeader title="Social" subtitle={`Find the conversations about your market on Reddit, YouTube and Quora, see where competitors get recommended and ${own} does not, and publish posts that fill the gap.`}
        right={scanBtn} />
      {d && <PlatformBar scan={d.scan} own={own} plat={plat} setPlat={setPlat} />}
      <ErrorBox error={scanErr} />
      <SimBanner show={project.data_mode !== 'live'}>The posts below are made up for the demo.</SimBanner>
      {!d ? <Spinner /> : (
        <div className="grid gap-4">
          {scanning ? <ScanProgress own={own} competitors={project.brands.filter(b => !b.is_own).length} state={scanning} /> : (
            !d.scan && <Step n={1} title="Scan the platforms"
              subtitle={`Google Search looks through Reddit, YouTube and Quora for posts about your market, ${own} and your competitors, and Claude reads what it finds. About a minute. Nothing is posted anywhere.`}>
              {readOnly ? <p className="text-sm text-muted">The client runs the scan.</p> : <p className="text-sm text-ink2">No scan yet. Press <b>Scan now</b> to start.</p>}
            </Step>
          )}

          {d.scan && <Step n={1} title="What people say, and where you are missing" subtitle={`Scan of ${fmtDate(d.scan.at)}. What people keep asking, the posts found, who each post names, and how it talks about you.`}>
            <Platforms scan={d.scan} own={own} plat={plat} setPlat={setPlat} />
          </Step>}

          {d.scan && <Step n={2} title="Make these posts" subtitle="Where people ask something your competitors get recommended for, or misunderstand you. Most valuable first. Press “Write it for me”: the draft is written for your own account from your brand profile and confirmed facts only, and appears under the idea.">
            <Ideas project={project} ideas={d.scan.ideas.filter(i => !plat || i.platform === plat)} drafts={d.drafts} readOnly={readOnly} reload={s.reload} />
          </Step>}

          {otherDrafts.filter(x => !plat || x.platform === plat).length > 0 && <Step n={d.scan ? 3 : 1} title="Other drafts" subtitle="Drafts from earlier scans and from the questions below.">
            <ul className="grid gap-3">{otherDrafts.filter(x => !plat || x.platform === plat).map(x => <Draft key={x.id} d={x} readOnly={readOnly} reload={s.reload} />)}</ul>
          </Step>}

          <Cited d={d} project={project} readOnly={readOnly} reload={s.reload} plat={plat} />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- the platform bar: status of each platform, and a filter for the whole page
function PlatformBar({ scan, own, plat, setPlat }) {
  const rows = scan ? (scan.searched || scan.platforms.map(p => ({ platform: p.platform, label: p.label, posts: p.posts.length }))) : SCAN_PLATFORMS.map(p => ({ platform: p, label: SCAN_LABEL[p], posts: 0, none: true }));
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <button className={`chip ${!plat ? 'chip-on' : ''}`} onClick={() => setPlat('')}>All platforms</button>
      {rows.filter(r => !r.unavailable).map(r => {
        const p = scan?.platforms.find(x => x.platform === r.platform);
        const named = p ? p.posts.filter(x => x.brands.some(b => same(b, own))).length : 0;
        const missing = p ? p.posts.filter(x => x.brands.length && !x.brands.some(b => same(b, own))).length : 0;
        const status = r.none ? 'not scanned yet' : r.unavailable ? 'cannot be searched yet' : r.failed ? 'search failed' : !r.posts ? 'nothing found' : `${r.posts} posts · you in ${named}${missing ? ` · ${missing} without you` : ''}`;
        return (
          <button key={r.platform} className={`chip flex items-center gap-2 py-1.5 ${plat === r.platform ? 'chip-on' : ''}`} onClick={() => setPlat(plat === r.platform ? '' : r.platform)} title={r.unavailable || status} disabled={!r.posts && !p}>
            <PlatformLogo id={r.platform} size={14} />
            <span className="text-left leading-tight"><span className="block font-semibold">{r.label}</span><span className={`block text-[11px] ${missing ? 'text-bad' : 'text-muted'}`}>{status}</span></span>
          </button>
        );
      })}
    </div>
  );
}

function ScanProgress({ own, competitors, state }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => { const t = setInterval(() => setSecs(x => x + 1), 1000); return () => clearInterval(t); }, []);
  const live = SCAN_PLATFORMS.filter(p => state.steps[p] !== 'unavailable');
  const done = live.filter(p => state.steps[p] !== 'searching').length;
  const finished = done + (state.reading ? 0.5 : 0), total = live.length + 1;
  const Row = ({ status, logo, children }) => (
    <li className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: status === 'done' ? 'var(--fill)' : 'transparent' }}>
      <span className="grid h-5 w-5 shrink-0 place-items-center">
        {status === 'done' ? <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-[11px] font-bold text-white">✓</span>
          : status === 'failed' ? <span className="font-bold text-bad">×</span>
            : status === 'waiting' ? <span className="h-2 w-2 rounded-full bg-line" /> : <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />}
      </span>
      {logo}<span className="min-w-0 text-[14px]">{children}</span>
    </li>
  );
  return (
    <div className="card rise p-6 md:p-8">
      <div className="flex items-start gap-4">
        <span className="shrink-0 animate-pulse"><Logo size={44} /></span>
        <div className="min-w-0">
          <h2 className="text-[20px] font-bold tracking-display md:text-[22px]">Reading what people say about {own} on social media</h2>
          <p className="mt-1 max-w-3xl text-[14px] text-muted">Google Search is looking through Reddit, YouTube and Quora for posts about {own}'s market, {own} itself and its {competitors || ''} competitors. Claude then reads what was found, sums up each platform, and suggests the posts you should make. About a minute. Stay on this page.</p>
        </div>
      </div>
      <div className="mt-6 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-fill"><div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${Math.max(4, (100 * finished) / total)}%` }} /></div>
        <span className="text-[13px] font-semibold tnum">{done} of {live.length} platforms</span>
        <span className="text-[13px] text-muted tnum">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>
      </div>
      <ul className="mt-6 grid gap-1.5">
        {SCAN_PLATFORMS.filter(p => state.steps[p] !== 'unavailable').map(p => { const st = state.steps[p]; return (
          <Row key={p} status={st === 'searching' ? 'working' : st === 'failed' || st === 'unavailable' ? 'failed' : 'done'} logo={<PlatformLogo id={p} size={14} />}>
            <span className="font-medium">{SCAN_LABEL[p]}</span><span className="ml-2 text-muted">{st === 'searching' ? 'searching…' : st === 'unavailable' ? 'cannot be searched yet' : st === 'failed' ? 'the search failed' : st === 0 ? 'nothing relevant found' : `${st} posts found`}</span>
          </Row>); })}
        <Row status={state.reading ? 'working' : 'waiting'} logo={<EngineLogo id="claude" size={14} />}>
          <span className="font-medium">Claude</span><span className="ml-2 text-muted">{state.reading ? 'reading the posts and writing the post ideas…' : 'waits for the searches'}</span>
        </Row>
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- step 2
function Platforms({ scan, own, plat, setPlat }) {
  const [missing, setMissing] = useState(false);
  const open = plat && scan.platforms.some(p => p.platform === plat) ? plat : scan.platforms[0]?.platform || '';
  const setOpen = v => { setPlat(v); setMissing(false); };
  const cur = scan.platforms.find(p => p.platform === open);
  if (!cur) return <p className="text-sm text-muted">No posts were found on any platform. Add more questions or competitors and scan again.</p>;
  const lacking = cur.posts.filter(x => x.brands.length && !x.brands.some(b => same(b, own)));
  const named = cur.posts.filter(x => x.brands.some(b => same(b, own))).length;
  const shown = missing ? lacking : cur.posts;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented value={open} onChange={setOpen} options={scan.platforms.map(p => ({ value: p.platform, label: `${p.label} (${p.posts.length})` }))} />
        <span className="text-[13px] text-ink2">{own} is named in <b>{named}</b> of {cur.posts.length} posts{lacking.length > 0 && <>, and <b className="text-bad">{lacking.length}</b> name only competitors</>}.</span>
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <div className="label">In short</div>
          <p className="mt-1 text-[14px] text-ink2">{cur.summary}</p>
          {cur.themes.length > 0 && <>
            <div className="label mt-4">What people keep asking</div>
            <ul className="mt-1 grid gap-1 text-[13.5px]">{cur.themes.map(t => <li key={t} className="rounded-lg bg-fill px-3 py-1.5">{t}</li>)}</ul>
          </>}
        </div>
        <div className="lg:col-span-3">
          <div className="flex items-center justify-between gap-2">
            <div className="label">Posts found</div>
            {lacking.length > 0 && <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={missing} onChange={e => setMissing(e.target.checked)} />Only posts without {own} ({lacking.length})</label>}
          </div>
          <ul className="mt-1">
            {shown.map(p => (
              <li key={p.url} className="flex items-start justify-between gap-3 border-t border-line py-2.5 text-sm first:border-t-0">
                <div className="min-w-0">
                  <a href={safeHref(p.url)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-medium hover:underline"><span className="truncate">{p.title || p.url}</span><ExternalLink size={11} className="shrink-0 text-muted" /></a>
                  {p.what && <p className="mt-0.5 text-[13px] text-ink2">{p.what}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    {(p.author || p.community || p.handle) && <span>{p.author || p.community || `@${p.handle}`}</span>}
                    {p.brands.map(b => <Badge key={b} tone={same(b, own) ? 'accent' : 'bad'}>{b}</Badge>)}
                    {p.brands.length > 0 && !p.brands.some(b => same(b, own)) && <span className="text-bad">you are missing</span>}
                  </div>
                </div>
                {p.sentiment && p.sentiment !== 'neutral' && <Badge tone={SENT[p.sentiment]}>{p.sentiment === 'mixed' ? 'mixed on you' : `${p.sentiment} on you`}</Badge>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- step 3
function Ideas({ project, ideas, drafts, readOnly, reload }) {
  const toast = useToast();
  const [busy, setBusy] = useState(-1);
  const [err, setErr] = useState(null);
  const write = async (i, n) => {
    setBusy(n); setErr(null);
    try { await api(`/projects/${project.id}/social/posts`, { method: 'POST', body: { platform: i.platform, topic: i.topic, angle: `${i.title}. ${i.angle}` } }); toast('Draft written'); reload(); }
    catch (e) { setErr(e); }
    setBusy(-1);
  };
  if (!ideas.length) return <p className="text-sm text-muted">The scan found no gap worth a post yet.</p>;
  return (
    <>
      <ErrorBox error={err} />
      <ol className="grid gap-3">
        {ideas.map((i, n) => {
          const draft = draftOf(drafts, i);
          return (
            <li key={n} className={`rounded-xl border p-4 ${draft ? 'border-accent/40' : 'border-line'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted"><PlatformLogo id={i.platform} size={13} label /><span>· post {n + 1}</span>{draft && <Badge tone="good">Draft written</Badge>}</div>
                  <div className="mt-1 font-medium">{i.title}</div>
                  <p className="mt-1 text-[13.5px] text-ink2">{i.angle}</p>
                  <p className="mt-1.5 text-[12.5px] text-muted"><b className="text-ink2">Why:</b> {i.why}</p>
                </div>
                {!readOnly && !draft && <button className={`btn-primary btn-sm ${busy === n ? 'shimmer' : ''}`} disabled={busy >= 0} onClick={() => write(i, n)}><WandSparkles size={13} />{busy === n ? 'Writing…' : 'Write it for me'}</button>}
              </div>
              {draft && <ul className="mt-3"><Draft d={draft} readOnly={readOnly} reload={reload} /></ul>}
            </li>
          );
        })}
      </ol>
    </>
  );
}

// ---------------------------------------------------------------- a draft
function Draft({ d, readOnly, reload, startOpen = false }) {
  const toast = useToast();
  const [open, setOpen] = useState(startOpen);
  const copy = async () => { try { await navigator.clipboard.writeText(`${d.title}\n\n${d.body}`); toast('Copied'); } catch { toast('Copy failed'); } };
  const remove = async () => { if (!confirm(`Delete the draft "${d.title}"?`)) return; await api(`/drafts/${d.id}`, { method: 'DELETE' }); reload(); };
  return (
    <li className="rounded-xl border border-line bg-fill/40">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <button className="flex min-w-0 items-center gap-2 text-left" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <FileText size={15} className="shrink-0 text-muted" /><span className="truncate text-sm font-medium">{d.title}</span>
          <PlatformLogo id={d.platform} size={13} label /><Badge tone="warn">Draft</Badge>
          <span className="text-xs text-accent">{open ? 'Hide' : 'Open the draft'}</span>
        </button>
        <span className="flex items-center gap-2 text-xs text-muted">
          {fmtDate(d.created_at)}
          <button className="btn-ghost btn-sm" onClick={copy}><Copy size={13} />Copy</button>
          {!readOnly && <button className="text-muted hover:text-ink" onClick={remove} aria-label="Delete draft"><Trash2 size={14} /></button>}
        </span>
      </div>
      {open && (
        <div className="grid gap-3 border-t border-line p-4 text-sm">
          <p className="rounded-lg bg-warnBg px-3 py-2 text-xs text-warnInk">Before you publish: check every fact, fill the [ADD: …] placeholders, post as yourself and say who you work for, and follow the community's rules. Then log it in the Work log so Housedge measures whether AI starts citing it.</p>
          {d.where && <div><span className="label">Where to post</span><p className="text-ink2">{d.where}</p></div>}
          <pre tabIndex={0} className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-lg bg-surface p-3 font-sans leading-relaxed text-ink2">{d.body}</pre>
          {d.keywords?.length > 0 && <div><span className="label">Search phrases it covers</span><div className="mt-1 flex flex-wrap gap-1.5">{d.keywords.map(k => <Badge key={k}>{k}</Badge>)}</div></div>}
          {d.notes?.length > 0 && <div><span className="label">Before posting</span><ul className="mt-1 list-disc pl-5 text-[13px] text-ink2">{d.notes.map(n => <li key={n}>{n}</li>)}</ul></div>}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- for the curious: what the AI engines cite from social
function Cited({ d, project, readOnly, reload, plat }) {
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState('');
  const ownName = project.brands.find(b => b.is_own)?.name;
  return (
    <section className="card p-5 md:p-6">
      <button className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <div><h2 className="text-[17px] font-semibold">Which social posts the AI engines already cite</h2>
          <p className="mt-0.5 text-[13.5px] text-muted">From your AI checks: {d.socialAnswers} of {d.totalAnswers} answers cite a social post. Open to see which platforms, which posts, and who those answers name.</p></div>
        <ChevronDown size={18} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="mt-4 grid gap-4">
        <FilterBar />
        {!d.socialAnswers ? <Empty title="No social posts cited yet">None of the answers in this period cite a social or community site. Try a longer period.</Empty> : <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">Platform</th><th className="th">Answers citing it</th>{d.engines.map(e => <th key={e} className="th"><EngineLogo id={e} /></th>)}<th className="th">{ownName} named</th><th className="th">Competitor named most</th></tr></thead>
              <tbody>{d.platforms.filter(p => !plat || p.platform === plat).map(p => { const you = p.brands.find(b => b.own), top = p.brands.find(b => !b.own); return (
                <tr key={p.platform}>
                  <td className="td font-medium"><PlatformLogo id={p.platform} label /></td>
                  <td className="td tnum">{p.share}% <span className="text-muted">({p.answers})</span></td>
                  {d.engines.map(e => <td key={e} className={`td tnum ${p.byEngine[e] ? '' : 'text-muted'}`}>{p.byEngine[e]}%</td>)}
                  <td className={`td tnum ${top && you && you.rate < top.rate ? 'font-medium text-bad' : ''}`}>{you ? `${you.rate}%` : '—'}</td>
                  <td className="td text-sm">{top?.rate ? <>{top.name} <span className="tnum text-muted">{top.rate}%</span></> : '—'}</td>
                </tr>); })}</tbody>
            </table>
          </div>
          {d.ideas.length > 0 && <div>
            <div className="label">Questions where AI leans on a platform and names a competitor more than you</div>
            <CitedIdeas project={project} ideas={d.ideas.filter(i => !plat || i.platform === plat)} readOnly={readOnly} reload={reload} />
          </div>}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="label">Most-cited social posts</div>
              <Segmented size="sm" value={owner} onChange={setOwner} options={[{ value: '', label: 'All' }, { value: 'own', label: 'Yours' }, { value: 'competitor', label: 'Competitors' }, { value: 'third', label: 'Others' }]} /></div>
            <ul className="mt-1 max-h-[480px] overflow-auto">
              {d.posts.filter(p => (!owner || p.owner === owner) && (!plat || p.platform === plat)).map(p => (
                <li key={p.url} className="flex items-center justify-between gap-3 border-t border-line py-2.5 text-sm">
                  <div className="min-w-0">
                    <a href={safeHref(p.url)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 truncate hover:underline"><span className="truncate">{p.title || p.url}</span><ExternalLink size={11} className="shrink-0 text-muted" /></a>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <PlatformLogo id={p.platform} size={12} /><Badge>{p.label} {p.kind}</Badge><Badge tone={OWNER[p.owner][1]}>{OWNER[p.owner][0]}</Badge>
                      {p.community && <span>{p.community}</span>}{p.handle && <span>@{p.handle}</span>}
                      <span>{fmtDate(p.first)}{p.last !== p.first && ` – ${fmtDate(p.last)}`}</span>
                      {p.brands.length > 0 && <span>· names {p.brands.map(b => `${b.name} ${b.rate}%`).join(', ')}</span>}
                    </div>
                  </div>
                  <span className="flex shrink-0 items-center gap-1.5">{p.engines.map(e => <EngineLogo key={e} id={e} size={13} />)}<span className="tnum w-8 text-right text-xs text-ink2">{p.cited}×</span></span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted">Housedge asks the engines through their APIs, which can cite differently from the ChatGPT, Gemini and Perplexity apps. AI also reads many social posts it never cites, so these numbers show the visible part.</p>
        </>}
      </div>}
    </section>
  );
}

function CitedIdeas({ project, ideas, readOnly, reload }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);
  const write = async i => {
    const k = `${i.promptId}|${i.platform}`;
    setBusy(k); setErr(null);
    try { await api(`/projects/${project.id}/social/posts`, { method: 'POST', body: { promptId: i.promptId, platform: i.platform } }); toast('Draft written: see Other drafts'); reload(); }
    catch (e) { setErr(e); }
    setBusy('');
  };
  return (
    <>
      <ErrorBox error={err} />
      <ul className="mt-1 grid gap-2">
        {ideas.slice(0, 8).map(i => { const k = `${i.promptId}|${i.platform}`; return (
          <li key={k} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[13px]"><PlatformLogo id={i.platform} size={13} label /><span className="inline-flex gap-1">{i.engines.map(e => <EngineLogo key={e} id={e} size={11} />)}</span></div>
              <div className="mt-1 text-sm font-medium">{i.question}</div>
              <p className="text-[13px] text-ink2">{i.answers} of {i.ofAnswers} answers cite {i.label}{i.top ? <> and name <b>{i.top.name}</b> in {i.top.rate}% of them, you in {i.ownRate}%</> : <>, you are named in {i.ownRate}%</>}.</p>
            </div>
            {!readOnly && <button className={`btn-primary btn-sm ${busy === k ? 'shimmer' : ''}`} disabled={!!busy} onClick={() => write(i)}><WandSparkles size={13} />{busy === k ? 'Writing…' : 'Write it for me'}</button>}
          </li>); })}
      </ul>
    </>
  );
}
