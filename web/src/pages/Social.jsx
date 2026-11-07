// Social: the social and community posts AI engines cite, who they name, and posts worth writing. Built from the
// citations of real answers; Claude drafts posts for the client's own accounts. Housedge never posts anything.
import { useState } from 'react';
import { ExternalLink, WandSparkles, Copy, Trash2, FileText, AlertTriangle, Radar } from 'lucide-react';
import { useApi, useFilters, api, safeHref, fmtDate } from '../lib.js';
import { useProject } from '../ctx.js';
import { Card, PageHeader, Spinner, ErrorBox, Badge, SimBanner, Segmented, Stat, Empty, EngineLogo, useToast } from '../ui.jsx';
import FilterBar from './FilterBar.jsx';

const OWNER = { own: ['Yours', 'accent'], competitor: ['Competitor', 'bad'], third: ['Third party', 'default'] };

export default function Social() {
  const { project, readOnly } = useProject();
  const { qs } = useFilters();
  const s = useApi(`/projects/${project.id}/social?${qs}`);
  const [owner, setOwner] = useState('');
  const toast = useToast();
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState(null);
  const scan = async () => {
    setScanning(true); setScanErr(null);
    try { await api(`/projects/${project.id}/social/scan`, { method: 'POST' }); toast('Scan finished'); s.reload(); }
    catch (e) { setScanErr(e); }
    setScanning(false);
  };
  if (s.error) return <ErrorBox error={s.error} />;
  const d = s.data;
  const ownPosts = d?.posts.filter(p => p.owner === 'own').length || 0;
  return (
    <>
      <PageHeader title="Social" subtitle="What people say about your market on Reddit, LinkedIn, YouTube and Quora, the posts you should make, and which social posts AI engines already cite."
        right={!readOnly && <button className={`btn-primary ${scanning ? 'shimmer' : ''}`} onClick={scan} disabled={scanning}><Radar size={15} />{scanning ? 'Scanning… about a minute' : d?.scan ? 'Scan again' : 'Scan social'}</button>} />
      <ErrorBox error={scanErr} />
      <div className="mb-4"><SimBanner show={project.data_mode !== 'live'}>The posts below are made up for the demo.</SimBanner></div>
      {!d ? <Spinner /> : <>
        {d.scan ? <Scan scan={d.scan} project={project} readOnly={readOnly} reload={s.reload} />
          : <Card className="mb-4" title="Scan the social platforms" subtitle="Searches Reddit, LinkedIn, YouTube and Quora for what people ask and say about your market, your brand and your competitors, then suggests the posts you should make. Separate from the AI check: this reads the platforms, the check reads the AI engines.">
              {readOnly ? <p className="text-sm text-muted">The client runs the scan.</p> : <button className={`btn-primary ${scanning ? 'shimmer' : ''}`} onClick={scan} disabled={scanning}><Radar size={15} />{scanning ? 'Scanning… about a minute' : 'Scan social'}</button>}
            </Card>}
        <Drafts drafts={d.drafts} readOnly={readOnly} reload={s.reload} />
        <h2 className="mt-8 mb-1 text-lg font-semibold">What AI engines cite</h2>
        <p className="mb-3 text-sm text-muted">From the answers of your AI checks: which social posts the engines cite and who they name.</p>
        <FilterBar />
        {!d.socialAnswers ? <Empty title="No social posts cited yet">None of the answers in this period cite a social or community site. Try a longer period.</Empty> : <>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat i={0} label="Answers citing social" value={`${Math.round((100 * d.socialAnswers) / Math.max(1, d.totalAnswers))}%`} sub={`${d.socialAnswers} of ${d.totalAnswers} answers`} />
          <Stat i={1} label="Most-cited platform" value={d.platforms[0]?.label || '—'} sub={d.platforms[0] && `in ${d.platforms[0].share}% of answers`} />
          <Stat i={2} label="Your own posts cited" value={ownPosts} help="Posts on your official profiles (Optimise > Brand profile) or accounts with your brand's name." />
        </div>

        <Card className="mt-4" pad={false} title="Platforms AI cites" subtitle="Share of each engine's answers that cite the platform, and who those answers name.">
          <div className="overflow-x-auto px-2 pb-2">
            <table className="w-full">
              <thead><tr>
                <th className="th">Platform</th><th className="th">All</th>
                {d.engines.map(e => <th key={e} className="th"><EngineLogo id={e} /></th>)}
                <th className="th">You named</th><th className="th">Top competitor</th>
              </tr></thead>
              <tbody>
                {d.platforms.map(p => {
                  const you = p.brands.find(b => b.own), top = p.brands.find(b => !b.own);
                  return (
                    <tr key={p.platform}>
                      <td className="td font-medium">{p.label}</td>
                      <td className="td tnum">{p.share}%</td>
                      {d.engines.map(e => <td key={e} className={`td tnum ${p.byEngine[e] ? '' : 'text-muted'}`}>{p.byEngine[e]}%</td>)}
                      <td className={`td tnum ${top && you && you.rate < top.rate ? 'font-medium text-bad' : ''}`}>{you ? `${you.rate}%` : '—'}</td>
                      <td className="td text-sm">{top?.rate ? <>{top.name} <span className="tnum text-muted">{top.rate}%</span></> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Ideas project={project} ideas={d.ideas} readOnly={readOnly} reload={s.reload} />

        <Card className="mt-4" pad={false} title="Most-cited social posts" subtitle="Individual posts and pages, most cited first. Yours, a tracked competitor's, or a third party's."
          right={<Segmented size="sm" value={owner} onChange={setOwner} options={[{ value: '', label: 'All' }, { value: 'own', label: 'Yours' }, { value: 'competitor', label: 'Competitors' }, { value: 'third', label: 'Others' }]} />}>
          <ul className="max-h-[600px] overflow-auto px-2 pb-2">
            {d.posts.filter(p => !owner || p.owner === owner).map(p => <Post key={p.url} p={p} />)}
          </ul>
        </Card>
        <p className="mt-4 text-xs text-muted">Housedge asks the engines through their APIs, which can cite differently from the ChatGPT, Gemini and Perplexity apps. AI also reads many social posts it never cites, so these numbers show the visible part.</p>
        </>}
      </>}
    </>
  );
}

const SENT = { positive: 'good', mixed: 'warn', negative: 'bad', neutral: 'default' };

function Scan({ scan, project, readOnly, reload }) {
  const toast = useToast();
  const [busy, setBusy] = useState(-1);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(scan.platforms[0]?.platform || '');
  const write = async (i, n) => {
    setBusy(n); setErr(null);
    try { await api(`/projects/${project.id}/social/posts`, { method: 'POST', body: { platform: i.platform, topic: i.topic, angle: `${i.title}. ${i.angle}` } }); toast('Post written'); reload(); }
    catch (e) { setErr(e); }
    setBusy(-1);
  };
  const cur = scan.platforms.find(p => p.platform === open);
  return (
    <>
      <Card className="mb-4" title="Posts you should make" subtitle={`From the scan of ${fmtDate(scan.at)}: where people ask things your competitors get recommended for, or misunderstand you.`}>
        <ErrorBox error={err} />
        {!scan.ideas.length ? <p className="text-sm text-muted">The scan found nothing worth posting about yet.</p> : (
          <ol className="grid gap-3">
            {scan.ideas.map((i, n) => (
              <li key={n} className="rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><Badge tone="accent">{i.label}</Badge><span className="text-xs text-muted">#{n + 1}</span></div>
                    <div className="mt-1.5 font-medium">{i.title}</div>
                    <p className="mt-1 text-[13px] text-ink2">{i.angle}</p>
                    <p className="mt-1 text-xs text-muted">Why: {i.why}</p>
                  </div>
                  {!readOnly && <button className={`btn-primary btn-sm ${busy === n ? 'shimmer' : ''}`} disabled={busy >= 0} onClick={() => write(i, n)}>
                    <WandSparkles size={13} />{busy === n ? 'Writing…' : 'Write post'}
                  </button>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Card className="mb-4" pad={false} title="What people say" subtitle={scan.failed?.length ? `${scan.failed.join(', ')}: the search failed this time.` : 'Trends and posts found on each platform.'}
        right={<Segmented size="sm" value={open} onChange={setOpen} options={scan.platforms.map(p => ({ value: p.platform, label: p.label }))} />}>
        {cur && <div className="px-5 pb-4">
          <p className="pt-4 text-sm text-ink2">{cur.summary}</p>
          {cur.themes.length > 0 && <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">{cur.themes.map(t => <li key={t} className="rounded-lg bg-fill px-3 py-1.5">{t}</li>)}</ul>}
          <ul className="mt-3">
            {cur.posts.map(p => (
              <li key={p.url} className="flex items-start justify-between gap-3 border-t border-line py-2.5 text-sm">
                <div className="min-w-0">
                  <a href={safeHref(p.url)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:underline"><span className="truncate">{p.title || p.url}</span><ExternalLink size={11} className="shrink-0 text-muted" /></a>
                  {p.what && <p className="mt-0.5 text-[13px] text-ink2">{p.what}</p>}
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <Badge>{p.kind}</Badge>{p.community && <span>{p.community}</span>}{p.handle && <span>@{p.handle}</span>}
                    {p.brands.length > 0 && <span>· names {p.brands.join(', ')}</span>}
                  </div>
                </div>
                {p.sentiment && <Badge tone={SENT[p.sentiment]}>{p.sentiment}</Badge>}
              </li>
            ))}
          </ul>
        </div>}
      </Card>
    </>
  );
}

function Post({ p }) {
  return (
    <li className="flex items-center justify-between gap-3 border-t border-line px-3 py-2.5 text-sm">
      <div className="min-w-0">
        <a href={safeHref(p.url)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 truncate hover:underline">
          <span className="truncate">{p.title || p.url}</span><ExternalLink size={11} className="shrink-0 text-muted" />
        </a>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <Badge>{p.label} {p.kind}</Badge><Badge tone={OWNER[p.owner][1]}>{OWNER[p.owner][0]}</Badge>
          {p.community && <span>{p.community}</span>}{p.handle && <span>@{p.handle}</span>}
          <span>{fmtDate(p.first)}{p.last !== p.first && ` – ${fmtDate(p.last)}`}</span>
          {p.brands.length > 0 && <span>· names {p.brands.map(b => `${b.name} ${b.rate}%`).join(', ')}</span>}
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-1.5">
        {p.engines.map(e => <EngineLogo key={e} id={e} size={13} />)}
        <span className="tnum w-8 text-right text-xs text-ink2">{p.cited}×</span>
      </span>
    </li>
  );
}

function Ideas({ project, ideas, readOnly, reload }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);
  const write = async i => {
    const k = `${i.promptId}|${i.platform}`;
    setBusy(k); setErr(null);
    try { await api(`/projects/${project.id}/social/posts`, { method: 'POST', body: { promptId: i.promptId, platform: i.platform } }); toast('Post written'); reload(); }
    catch (e) { setErr(e); }
    setBusy('');
  };
  return (
    <Card className="mt-4" title="Posts to write" subtitle="Questions where AI leans on a platform, names a competitor more often than you, and has no post of yours to cite. Highest impact first.">
      <ErrorBox error={err} />
      {!ideas.length ? <p className="text-sm text-muted">No gaps found in this period.</p> : (
        <ul className="grid gap-3">
          {ideas.map(i => (
            <li key={`${i.promptId}|${i.platform}`} className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><Badge tone="accent">{i.label}</Badge><span className="text-xs text-muted">impact {i.score}</span></div>
                  <div className="mt-1.5 font-medium">{i.question}</div>
                  <p className="mt-1 text-[13px] text-ink2">
                    {i.answers} of {i.ofAnswers} answers cite {i.label}
                    {i.top ? <> · they name <b>{i.top.name}</b> in {i.top.rate}% and you in {i.ownRate}%</> : <> · you are named in {i.ownRate}%</>}
                    <span className="ml-1.5 inline-flex translate-y-0.5 gap-1">{i.engines.map(e => <EngineLogo key={e} id={e} size={12} />)}</span>
                  </p>
                </div>
                {!readOnly && <button className={`btn-primary btn-sm ${busy === `${i.promptId}|${i.platform}` ? 'shimmer' : ''}`} disabled={!!busy} onClick={() => write(i)}>
                  <WandSparkles size={13} />{busy === `${i.promptId}|${i.platform}` ? 'Writing…' : 'Write post'}
                </button>}
              </div>
              {i.examples.length > 0 && <ul className="mt-2 grid gap-1 text-xs">
                {i.examples.map(e => (
                  <li key={e.url} className="flex min-w-0 items-center gap-1.5 text-muted">
                    <Badge tone={OWNER[e.owner][1]}>{OWNER[e.owner][0]}</Badge>
                    <a href={safeHref(e.url)} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">{e.title || e.url}</a>
                  </li>
                ))}
              </ul>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Drafts({ drafts, readOnly, reload }) {
  if (!drafts.length) return null;
  const remove = async d => { if (!confirm(`Delete the draft "${d.title}"?`)) return; await api(`/drafts/${d.id}`, { method: 'DELETE' }); reload(); };
  return (
    <Card className="mt-4" title="Your post drafts" subtitle="Written by Claude from your brand profile and confirmed facts only. Publish them yourself, on your own accounts.">
      <div className="mb-3 flex items-start gap-2 rounded-lg border border-line px-3 py-2 text-xs text-ink2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-muted" />
        Check every fact and fill the [ADD: …] placeholders. Post as yourself and say who you work for: never as a fake customer, and follow each community's rules. After posting, log it in the Work log so Housedge measures whether AI starts citing it.
      </div>
      <ul className="grid gap-3">{drafts.map(d => <Draft key={d.id} d={d} onDelete={readOnly ? null : () => remove(d)} />)}</ul>
    </Card>
  );
}

function Draft({ d, onDelete }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(`${d.title}\n\n${d.body}`); toast('Copied'); } catch { toast('Copy failed'); } };
  return (
    <li className="rounded-xl border border-line">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4">
        <button className="flex min-w-0 items-center gap-2 text-left" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <FileText size={15} className="shrink-0 text-muted" />
          <span className="truncate text-sm font-medium">{d.title}</span>
          <Badge>{d.platform}</Badge><Badge tone="warn">Draft</Badge>
        </button>
        <span className="flex items-center gap-2 text-xs text-muted">
          {fmtDate(d.created_at)}
          <button className="btn-ghost btn-sm" onClick={copy}><Copy size={13} />Copy</button>
          {onDelete && <button className="text-muted hover:text-ink" onClick={onDelete} aria-label="Delete draft"><Trash2 size={14} /></button>}
        </span>
      </div>
      {open && (
        <div className="grid gap-3 border-t border-line p-4 text-sm">
          <div className="text-xs text-muted">Answers: “{d.question}”</div>
          {d.where && <div><span className="label">Where to post</span><p className="text-ink2">{d.where}</p></div>}
          <pre tabIndex={0} className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-lg bg-fill p-3 font-sans leading-relaxed text-ink2">{d.body}</pre>
          {d.keywords?.length > 0 && <div className="flex flex-wrap gap-1.5">{d.keywords.map(k => <Badge key={k}>{k}</Badge>)}</div>}
          {d.notes?.length > 0 && <ul className="list-disc pl-5 text-[13px] text-ink2">{d.notes.map(n => <li key={n}>{n}</li>)}</ul>}
        </div>
      )}
    </li>
  );
}
