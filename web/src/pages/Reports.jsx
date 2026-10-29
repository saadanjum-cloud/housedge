import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { FileText, Printer, Plus, Trash2, ArrowLeft, Check } from 'lucide-react';
import { useApi, api, fmtPct, fmtPos, fmtDate, PaperContext } from '../lib.js';
import { useMeta, useProject } from '../ctx.js';
import { Card, PageHeader, Spinner, ErrorBox, Badge, SimBadge, Empty, Delta, BrandDot, Bar, Sentiment, Modal, useToast } from '../ui.jsx';
import { VisibilitySentimentMap, HBars } from '../charts.jsx';
import { Logo } from '../motion.jsx';
import ReportRating from './ReportRating.jsx';

export default function Reports() {
  const { project, readOnly: team } = useProject(); // reports are the one thing the team writes; clients read them
  const list = useApi(`/projects/${project.id}/reports`);
  const nav = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [del, setDel] = useState(null);
  const create = async () => {
    setBusy(true); setErr(null);
    try { const r = await api(`/projects/${project.id}/reports`, { method: 'POST', body: { days: 30 } }); nav(`${r.id}`); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  const first = !list.data?.length;
  return (
    <>
      <PageHeader title="Reports" subtitle="A report freezes the numbers for the last 30 days, so you can show progress later. One is made automatically after every real check (one per day); you can also make one yourself at any time."
        right={team && <button className="btn-primary" onClick={create} disabled={busy}><Plus size={15} />{busy ? 'Creating…' : first ? 'Create first report' : 'Create progress report'}</button>} />
      <ErrorBox error={err} />
      {!list.data ? <Spinner /> : first ? (
        <Empty art title="No reports yet" action={team && <button className="btn-primary" onClick={create}>Create the first report</button>}>
          {team ? 'The first report compares the client with competitors on visibility, position and sentiment, and shows the sources behind the gap. It covers the last 30 days.'
            : 'Your first report is made automatically after your first check. It compares you with your competitors on visibility, position and sentiment.'}
        </Empty>
      ) : (
        <div className="card divide-y divide-line">
          {list.data.map(r => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <FileText size={16} className="text-muted" />
              <Link to={`${r.id}`} className="flex-1 min-w-0 font-medium hover:underline">{r.title}</Link>
              <span className="text-xs text-muted">{fmtDate(r.period_start)} – {fmtDate(r.period_end)}</span>
              {r.kind === 'first' && <Badge tone="accent">First report</Badge>}
              {!!r.auto && <Badge>Automatic</Badge>}
              {r.simulated ? <SimBadge /> : <Badge tone="good">Real data</Badge>}
              {team && <button className="btn-ghost btn-sm" onClick={() => setDel(r)} aria-label="Delete report"><Trash2 size={13} /></button>}
            </div>
          ))}
        </div>
      )}
      <Modal open={!!del} onClose={() => setDel(null)} title="Delete this report?">
        <p className="text-sm text-ink2">"{del?.title}" will be removed. The answers it was made from are kept, and a backup is made first.</p>
        <div className="mt-5 flex justify-end gap-2"><button className="btn-ghost" onClick={() => setDel(null)}>Cancel</button>
          <button className="btn-danger" onClick={async () => { await api(`/reports/${del.id}`, { method: 'DELETE' }); setDel(null); toast('Report deleted'); list.reload(); }}>Delete</button></div>
      </Modal>
    </>
  );
}

const SLOGAN = 'See what AI says. Fix it. Prove it.';
const cssText = t => String(t || '').replace(/["\\\n\r]/g, ' ').trim();
const BRAND_LINE = 'linear-gradient(90deg, #0e2b22 0 55%, #8ef0be 55% 100%)';

// Letterhead print layout (A4). The margin boxes Chrome uses for its own date/title/URL header and footer are
// filled, so those don't print. Page 1 carries the full letterhead; later pages a slim running header. All pages share one margin.
function printCss({ client, title, footer }) {
  const f = 'font: 400 7pt -apple-system, BlinkMacSystemFont, Figtree, "Helvetica Neue", sans-serif; color: #86868b;';
  const h = 'font: 600 7.5pt -apple-system, BlinkMacSystemFont, Figtree, "Helvetica Neue", sans-serif; color: #1d1d1f; letter-spacing: .08em;';
  return `@media print {
  @page { size: A4; margin: 18mm 18mm 20mm;
    @top-left { content: "HOUSEDGE"; ${h} vertical-align: bottom; padding-bottom: 4mm; }
    @top-center { content: " "; }
    @top-right { content: "${cssText(title)}  ·  ${cssText(client)}"; ${f} vertical-align: bottom; padding-bottom: 4mm; }
    @bottom-left { content: "${cssText(footer)}"; ${f} vertical-align: top; padding-top: 4mm; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); ${f} vertical-align: top; padding-top: 4mm; } }
  @page :first { @top-left { content: " "; } @top-right { content: " "; } }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .rp-wrap { padding: 0 !important; max-width: none !important; }
  .rp-paper { box-shadow: none !important; border: 0 !important; padding: 0 !important; border-radius: 0 !important; max-width: none !important; }
  .rp-keep { break-inside: avoid; }
  .rp-head { break-after: avoid; }
  .rp-wrap .grid > * { min-width: 0; }
  .rp-wrap .recharts-responsive-container { width: 100% !important; }
  .rp-wrap .recharts-wrapper, .rp-wrap svg.recharts-surface { width: 100% !important; max-width: 100%; height: auto; }
}`;
}

// The paper always uses the light palette, also when the app is in dark mode.
const PAPER_VARS = {
  '--surface': '#ffffff', '--raised': '#f7f7f9', '--fill': '#ececf0', '--ink': '#1d1d1f', '--ink2': '#424245', '--muted': '#86868b',
  '--line': 'rgba(0,0,0,0.09)', '--grid': '#ececef', '--axis': '#d2d2d7', '--accent': '#0f7a4c', '--accent-soft': '#e0f5e9',
  '--good': '#1d7d32', '--good-soft': '#e7f6ea', '--bad': '#c9302c', '--bad-soft': '#fdecec', '--warn-bg': '#fff6dc', '--warn-ink': '#7a5300',
  colorScheme: 'light', background: '#ffffff', color: '#1d1d1f',
};

function Letterhead({ client }) {
  const lines = [client.name, client.address, client.country].filter(Boolean);
  return (
    <header className="rp-keep">
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-center gap-3">
          <Logo size={44} />
          <div>
            <div className="text-[20px] font-semibold leading-none tracking-tight">Housedge</div>
            <div className="mt-1.5 text-[11px] text-muted">{SLOGAN}</div>
          </div>
        </div>
        <div className="text-right text-[11px] leading-[1.6] text-ink2">
          {lines.length ? <div className="font-semibold text-ink">{lines[0]}</div> : <div className="font-semibold text-ink">Housedge</div>}
          {lines.slice(1).length > 0 && <div>{lines.slice(1).join(', ')}</div>}
          {client.businessId && <div>Business ID {client.businessId}{client.vatId ? ` · VAT ${client.vatId}` : ''}</div>}
          {[client.email, client.phone].filter(Boolean).length > 0 && <div>{[client.email, client.phone].filter(Boolean).join(' · ')}</div>}
          {client.website && <div className="font-medium text-ink">{client.website}</div>}
        </div>
      </div>
      <div className="mt-5 h-[3px] w-full rounded-full" style={{ background: BRAND_LINE }} />
    </header>
  );
}

function H2({ n, children, sub }) {
  return (
    <div className="rp-head mb-3 mt-9">
      <h2 className="flex items-baseline gap-3 text-[17px] font-semibold tracking-tight">
        <span className="tnum text-[13px] font-semibold text-accent">{n}.</span>{children}
      </h2>
      {sub && <p className="mt-1 text-[12.5px] text-muted">{sub}</p>}
      <div className="mt-2.5 h-px bg-line" />
    </div>
  );
}

// Three to four plain-English findings, worked out from the frozen report data.
function keyFindings({ own, leader, data }) {
  const out = [];
  const c = data.summary.confusion;
  if (c?.answers && c.lookalikes?.length) out.push({ title: `AI confuses ${own.name} with ${c.lookalikes.map(l => l.name).join(', ')}.`,
    text: `In ${c.answers} of ${data.summary.totalAnswers} answers (${fmtPct(c.share)}), the AI described another company when asked about ${own.name}. These answers are not counted in ${/s$/i.test(own.name) ? `${own.name}’` : `${own.name}’s`} numbers.` });
  if (leader && (leader.visibility || 0) > (own.visibility || 0)) {
    const ratio = own.visibility ? leader.visibility / own.visibility : null;
    out.push({ title: ratio ? `${leader.name} is named ${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}× as often as ${own.name}.` : `${own.name} is missing where ${leader.name} appears.`,
      text: `${leader.name} appears in ${fmtPct(leader.visibility)} of AI answers; ${own.name} in ${fmtPct(own.visibility)}.` });
  } else {
    out.push({ title: `${own.name} leads on visibility.`, text: `${own.name} appears in ${fmtPct(own.visibility)} of AI answers, ahead of every tracked competitor.` });
  }
  const accuracy = data.actions.filter(a => a.type === 'accuracy');
  if (accuracy.length) out.push({ title: `AI contradicts ${accuracy.length} confirmed fact${accuracy.length > 1 ? 's' : ''} about ${own.name}.`, text: accuracy[0].why });
  const gap = data.sources.top.find(d => d.category !== 'own' && d.answers && d.with_own / d.answers < 0.3);
  if (gap) out.push({ title: `AI relies on ${gap.domain}, where ${own.name} is largely absent.`, text: `It is cited in ${gap.share}% of answers, yet ${own.name} is named in only ${Math.round((100 * gap.with_own) / gap.answers)}% of those.` });
  const fresh = a => a.type !== 'accuracy' && a.key !== `source:${gap?.domain}`;
  const next = data.actions.find(a => fresh(a) && a.priority === 'high') || data.actions.find(fresh);
  if (next) out.push({ title: 'Biggest opportunity.', text: next.title });
  return out.slice(0, 4);
}

function Meta({ label, children }) {
  return <div><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</div><div className="mt-0.5 text-[13px]">{children}</div></div>;
}

export function ReportView({ print }) {
  const { rid, id } = useParams();
  const meta = useMeta();
  const r = useApi(`/reports/${rid}`);
  const legal = useApi('/legal');
  const name = r.data?.data?.project?.name;
  useEffect(() => {
    if (!name) return;
    const before = document.title;
    // The PDF file name comes from the page title.
    document.title = `${name} — AI Visibility Report — ${fmtDate(r.data.period_end)} — Housedge`;
    return () => { document.title = before; };
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps
  if (r.error) return <ErrorBox error={r.error} />;
  if (!r.data) return <Spinner />;
  const { data, simulated } = r.data;
  const s = data.summary;
  const own = s.brands.find(b => b.is_own);
  const sorted = [...s.brands].sort((a, b) => a.rank - b.rank);
  const leader = sorted.find(b => !b.is_own);
  const prev = data.previous?.summary;
  const prevOf = bid => prev?.brands.find(b => b.id === bid);
  const engineLabel = e => meta.engines.find(x => x.id === e)?.label || e;
  const engines = data.engines.map(e => engineLabel(e.engine)).join(', ');
  const client = legal.data?.company || {};
  const findings = keyFindings({ own, leader, data });
  const docTitle = r.data.kind === 'first' ? 'AI Visibility Report' : 'AI Visibility Progress Report';
  const footer = [client.name || 'Housedge', client.address, client.businessId && `Business ID ${client.businessId}`, client.website].filter(Boolean).join('  ·  ');
  const ref = `HE-${String(r.data.period_end || '').replace(/-/g, '')}-${rid}`;
  const sec = (() => { let n = 0; return () => ++n; })();

  return (
    <PaperContext.Provider value={true}>
    <div className={`rp-wrap relative ${print ? 'mx-auto max-w-4xl p-8' : ''}`}>
      <style>{printCss({ client: data.project.name, title: docTitle, footer })}</style>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        {!print ? <Link to={`/p/${id}/reports`} className="btn-ghost btn-sm"><ArrowLeft size={13} />All reports</Link> : <span />}
        <span className="flex items-center gap-3">
          <span className="hidden text-xs text-muted sm:inline">Tip: in the print window, tick “Background graphics”.</span>
          <button className="btn-primary" onClick={() => window.print()}><Printer size={15} />Print / save as PDF</button>
        </span>
      </div>
      {!print && <ReportRating id={rid} />}

      <article className="rp-paper relative mx-auto max-w-[860px] overflow-hidden rounded-md border border-line p-8 shadow-lg sm:p-14" style={PAPER_VARS}>
        {simulated ? <div aria-hidden className="pointer-events-none absolute inset-0 z-0 grid place-items-center overflow-hidden">
          <div className="-rotate-[28deg] whitespace-nowrap text-[56px] font-bold uppercase tracking-widest text-warnInk opacity-10">Simulated data — not real</div>
        </div> : null}
        <div className="relative z-10">
          <Letterhead client={client} />

          <div className="rp-keep mt-10">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Confidential</div>
            <h1 className="mt-2 text-[30px] font-semibold leading-tight tracking-tight">{docTitle}</h1>
            <div className="mt-1 text-[17px] text-ink2">Prepared for <span className="font-semibold text-ink">{data.project.name}</span></div>
            <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-line py-4 sm:grid-cols-4">
              <Meta label="Date">{fmtDate(r.data.created_at)}</Meta>
              <Meta label="Period">{fmtDate(data.filter.from)} – {fmtDate(data.filter.to)}</Meta>
              <Meta label="Evidence">{s.totalAnswers} {simulated ? 'simulated' : 'real'} AI answers</Meta>
              <Meta label="Reference">{ref}</Meta>
            </div>
            {simulated ? <p className="mt-4 rounded bg-warnBg px-3 py-2 text-sm text-warnInk"><strong>Simulated data.</strong> This report was made from demo answers. It must not be presented as real results.</p> : null}
          </div>

          <H2 n={sec()}>Summary</H2>
          <p className="text-[15px] leading-[1.75]">
            This report shows how {engines} {engines.includes(',') ? 'describe' : 'describes'} <strong>{own.name}</strong> to customers, compared with {s.brands.length - 1} competitor{s.brands.length - 1 === 1 ? '' : 's'}.
            {' '}<strong>{own.name}</strong> was mentioned in <strong>{fmtPct(own.visibility)}</strong> of AI answers, ranking <strong>#{own.rank} of {s.brands.length}</strong> tracked brands.
            {leader && <> The most visible competitor, <strong>{leader.name}</strong>, appeared in <strong>{fmtPct(leader.visibility)}</strong>.</>}
            {' '}When {own.name} was mentioned, it was on average at position <strong>{fmtPos(own.position)}</strong>{own.sentiment == null ? <>; the answers did not use clearly positive or negative words about it, so tone could not be scored</> : <>, with a tone of <strong>{own.sentiment}/100</strong></>}.
          </p>

          <table className="rp-keep mt-5 w-full border-y border-line">
            <tbody><tr className="divide-x divide-[color:var(--line)]">
              {[['Visibility', fmtPct(own.visibility), <Delta key="v" now={own.visibility} before={prevOf(own.id)?.visibility} />],
                ['Average position', fmtPos(own.position), <Delta key="p" now={own.position} before={prevOf(own.id)?.position} invert unit="" />],
                ['Sentiment', own.sentiment == null ? 'n/a' : `${own.sentiment}/100`, <Delta key="s" now={own.sentiment} before={prevOf(own.id)?.sentiment} digits={0} />],
                ['Share of voice', fmtPct(own.sov), <Delta key="o" now={own.sov} before={prevOf(own.id)?.sov} />]].map(([l, v, d]) => (
                <td key={l} className="w-1/4 px-4 py-3 align-top first:pl-0">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{l}</div>
                  <div className="mt-1 text-[24px] font-semibold tracking-tight tnum">{v}</div>
                  <div className="mt-0.5 min-h-[20px]">{prev ? d : <span className="text-[11px] text-muted">baseline</span>}</div>
                </td>
              ))}
            </tr></tbody>
          </table>

          {findings.length > 0 && (
            <div className="rp-keep mt-6">
              <div className="mb-2 text-[13px] font-semibold">Key findings</div>
              <ol className="grid gap-2.5">
                {findings.map((f, i) => (
                  <li key={f.title} className="flex gap-3 text-[13.5px] leading-relaxed">
                    <span className="tnum w-5 shrink-0 font-semibold text-accent">{i + 1}.</span>
                    <span><strong>{f.title}</strong> <span className="text-ink2">{f.text}</span></span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="overflow-x-auto rp-keep">
          <H2 n={sec()} sub={prev ? `Change is against the previous report (${fmtDate(data.previous.period_end)}).` : 'This is the starting point (baseline) for tracking progress.'}>How {own.name} compares</H2>
            <table className="w-full text-[13px]">
              <thead><tr className="border-b border-line"><th className="th pl-0">#</th><th className="th">Brand</th><th className="th">Visibility</th><th className="th">Position</th><th className="th">Sentiment</th><th className="th">Share of voice</th></tr></thead>
              <tbody>{sorted.map(b => (
                <tr key={b.id} className={`border-b border-line ${b.is_own ? 'bg-accentSoft' : ''}`}>
                  <td className="td pl-0 tnum text-muted">{b.rank}</td>
                  <td className="td"><span className="flex items-center gap-2"><BrandDot slot={b.color} /><span className={b.is_own ? 'font-semibold' : ''}>{b.name}</span></span></td>
                  <td className="td"><div className="flex items-center gap-2"><span className="tnum w-12">{fmtPct(b.visibility)}</span><Bar value={b.visibility} slot={b.color} /></div>{prev && <Delta now={b.visibility} before={prevOf(b.id)?.visibility} short />}</td>
                  <td className="td tnum">{fmtPos(b.position)}</td><td className="td"><Sentiment value={b.sentiment} /></td><td className="td tnum">{fmtPct(b.sov)}</td>
                </tr>))}</tbody>
            </table>
          </div>
          <div className="mt-6 grid gap-8 sm:grid-cols-2">
            <div className="rp-keep">
              <div className="mb-2 text-[13px] font-semibold">Visibility vs sentiment</div>
              <VisibilitySentimentMap brands={s.brands} height={220} />
            </div>
            <div className="rp-keep">
              <div className="mb-2 text-[13px] font-semibold">By AI engine</div>
              <table className="w-full text-[13px]"><tbody>{data.engines.map(e => {
                const x = e.brands.find(b => b.is_own);
                const best = [...e.brands].sort((a, b) => (b.visibility || 0) - (a.visibility || 0))[0];
                return <tr key={e.engine} className="border-b border-line"><td className="td pl-0 font-medium">{engineLabel(e.engine)}</td><td className="td"><div className="flex items-center gap-2"><span className="tnum w-12">{fmtPct(x?.visibility)}</span><Bar value={x?.visibility} /></div></td>
                  <td className="td text-xs text-muted">Leader: {best.name} {fmtPct(best.visibility)}</td></tr>;
              })}</tbody></table>
            </div>
          </div>

          <div className="rp-keep">
          <H2 n={sec()} sub={`AI assistants build answers from the websites they read. These are the sites cited most, and how often ${own.name} appears in those same answers.`}>The sources behind the gap</H2>
          <div className="grid gap-8 sm:grid-cols-[2fr_3fr]">
            <div className="rp-keep"><div className="mb-2 text-[13px] font-semibold">By type of website</div>
              <HBars rows={data.sources.byType.map(t => ({ label: t.label, value: Math.round((1000 * t.answers) / Math.max(1, s.totalAnswers)) / 10 }))} /></div>
            <table className="w-full text-[13px] rp-keep"><thead><tr className="border-b border-line"><th className="th pl-0">Website</th><th className="th">Cited in</th><th className="th">With {own.name}</th></tr></thead>
              <tbody>{data.sources.top.filter(d => d.category !== 'own').slice(0, 10).map(d => (
                <tr key={d.domain} className="border-b border-line"><td className="td pl-0">{d.domain}<div className="text-[11px] text-muted">{d.label}</div></td><td className="td tnum">{d.share}%</td>
                  <td className="td tnum"><span className={d.answers && d.with_own / d.answers < 0.3 ? 'text-bad font-medium' : ''}>{d.answers ? Math.round((100 * d.with_own) / d.answers) : 0}%</span></td></tr>))}</tbody></table>
          </div>
          </div>

          <ol className="grid">
            {data.actions.map((a, i) => (
              <li key={a.key} className="rp-keep">
              {i === 0 && <H2 n={sec()} sub="Prioritised, each with the evidence behind it. These are recommendations; no AI result can be guaranteed.">Recommended actions</H2>}
              <div className={`flex gap-4 border-b border-line py-3.5 ${i === 0 ? 'pt-1' : ''}`}>
                <span className="tnum w-5 shrink-0 pt-px text-[13px] font-semibold text-accent">{i + 1}.</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-[14px] font-semibold">{a.title}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${a.priority === 'high' ? 'text-bad' : a.priority === 'medium' ? 'text-warnInk' : 'text-muted'}`}>{a.priority} priority</span>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink2">{a.why}</p>
                  <div className="mt-1 text-[12px] text-muted"><span className="font-medium text-ink2">Next step: </span>{a.steps[0]}</div>
                </div>
              </div>
              </li>
            ))}
          </ol>

          {data.outreach && (
            <div className="rp-keep">
              <H2 n={sec()} sub="The websites AI cites where the client was missing, and where outreach stands.">Outreach</H2>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
                {[['Websites on the list', data.outreach.total], ['Contacted', ['contacted', 'replied', 'no_reply', 'declined', 'listed'].reduce((n, k) => n + (data.outreach.counts?.[k] || 0), 0)],
                  ['Listed or published', data.outreach.counts?.listed || 0]].map(([l, n]) => (
                  <span key={l}><span className="text-muted">{l}: </span><strong className="tnum">{n}</strong></span>
                ))}
              </div>
              {data.outreach.listed?.length > 0 && (
                <ul className="mt-3 grid gap-1 text-[13px]">
                  {data.outreach.listed.map(l => <li key={l.domain} className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-good" /><span><strong>{l.domain}</strong>{l.since ? <span className="text-muted"> since {fmtDate(l.since)}</span> : null}</span></li>)}
                </ul>
              )}
            </div>
          )}

          {data.previous && (<>
            <H2 n={sec()} sub={`Compared with "${data.previous.title}".`}>Progress since the last report</H2>
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="text-[13px]">
                <div>Visibility: {fmtPct(prevOf(own.id)?.visibility)} → <strong>{fmtPct(own.visibility)}</strong> <Delta now={own.visibility} before={prevOf(own.id)?.visibility} /></div>
                <div className="mt-1">Share of voice: {fmtPct(prevOf(own.id)?.sov)} → <strong>{fmtPct(own.sov)}</strong> <Delta now={own.sov} before={prevOf(own.id)?.sov} /></div>
                <p className="mt-3 text-xs text-muted">AI answers change for many reasons. A rise after an action is a good sign, but it does not prove the action caused it.</p>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-muted">Actions completed since then</div>
                {data.actionsDone.length ? <ul className="grid gap-1 text-[13px]">{data.actionsDone.map(a => <li key={a.key} className="flex gap-2"><Check size={14} className="mt-0.5 text-good shrink-0" /><span>{a.title} <span className="text-xs text-muted">({fmtDate(a.updated_at)})</span></span></li>)}</ul>
                  : <p className="text-[13px] text-muted">None marked as done.</p>}
              </div>
            </div>
          </>)}

          <H2 n={sec()}>How this was measured</H2>
          <ul className="list-disc space-y-1.5 pl-5 text-[12.5px] leading-relaxed text-ink2">
            <li>{simulated ? 'SIMULATED: answers were generated by a demo engine, not by real AI services.' : `Each question was sent to ${engines} through their official APIs, with web search switched on.`}</li>
            <li>API answers come from the same AI models as the consumer apps, but can differ from what one person sees in the app (apps add personalisation and their own instructions).</li>
            <li>Visibility = share of answers that mention the brand. Position = order in which brands are first named (1 = first). Sentiment = tone of the sentences that mention the brand, scored by a word list (0 negative, 100 positive): a rough guide, not a perfect reading.</li>
            <li>Not covered: Microsoft Copilot, Google AI Mode and Google AI Overviews, because they have no official API.</li>
          </ul>

          <div className="rp-keep mt-12 flex flex-wrap items-end justify-between gap-6">
            <div className="text-[13px]">
              <div className="text-muted">Prepared by</div>
              <div className="mt-6 w-56 border-t border-ink/40 pt-1.5 font-semibold">{client.representative || 'Housedge'}</div>
              <div className="text-ink2">{client.name || 'Housedge'}</div>
            </div>
            <div className="max-w-sm text-right text-[11px] leading-relaxed text-muted">
              This report is confidential and prepared for {data.project.name}. It describes what AI assistants answered during the period shown; it is not legal or financial advice and no future AI result is guaranteed.
            </div>
          </div>
          <div className="mt-8 h-[3px] w-full rounded-full" style={{ background: BRAND_LINE }} />
        </div>
      </article>
    </div>
    </PaperContext.Provider>
  );
}
