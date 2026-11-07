import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ArrowUp, ArrowDown, ArrowUpRight, ArrowDownRight, AlertTriangle, ArrowRight, Lightbulb } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, Tooltip } from 'recharts';
import { useApi, useFilters, useColors, api, fmtPct, fmtPos, fmtDate, COUNTRY_FLAGS, namesBrand } from '../lib.js';
import { useMeta, useProject } from '../ctx.js';
import { Card, Spinner, ErrorBox, SimBanner, Empty, Segmented, BrandDot, Bar, Sentiment, useToast, EngineLogo, engineName } from '../ui.jsx';
import { TrendChart, ShareOfVoiceChart, VisibilitySentimentMap, Legend, smooth } from '../charts.jsx';
import FilterBar from './FilterBar.jsx';
import { CountUp, stagger } from '../motion.jsx';

export default function Overview() {
  const { project, reload, readOnly } = useProject();
  const { qs, f } = useFilters();
  const sum = useApi(`/projects/${project.id}/summary?${qs}`);
  const daily = useApi(`/projects/${project.id}/daily?${qs}`);
  const engines = useApi(`/projects/${project.id}/engines?${qs}`);
  const countries = useApi(`/projects/${project.id}/countries?${qs}`);
  const sugg = useApi(`/projects/${project.id}/suggestions?${qs}`);
  const prompts = useApi(`/projects/${project.id}/prompts?${qs}`);
  const actions = useApi(`/projects/${project.id}/actions?${qs}`);

  if (sum.error) return <ErrorBox error={sum.error} />;
  if (!sum.data) return <><FilterBar /><Spinner /></>;
  const s = sum.data;
  const own = s.brands.find(b => b.is_own);
  const colorOf = Object.fromEntries(s.brands.map(b => [b.id, b.color]));

  if (!s.totalAnswers) return <><FilterBar /><Empty art title="No answers in this period yet" action={<Link className="btn-primary" to="../prompts">Check your questions</Link>}>Press "Run now" at the top to ask the AI assistants your questions, or choose a longer period. Results appear within minutes.</Empty></>;

  return (
    <>
      <FilterBar />
      <div className="mb-4"><SimBanner show={s.simulatedAnswers > 0} /></div>
      {own && s.confusion?.answers > 0 && <Confusion c={s.confusion} prev={s.prevConfusion} own={own} />}
      {own && (
        <div className="grid gap-4 xl:grid-cols-5">
          <Hero className="xl:col-span-3" s={s} own={own} daily={daily.data} days={f.days} unbranded={unbranded(prompts.data, project.brands.find(b => b.is_own) || own)} />
          <Standings className="xl:col-span-2" brands={s.brands} />
        </div>
      )}
      {own && <Engines data={engines.data} own={own} days={f.days} />}
      <NextActions list={actions.data} />
      {!!sugg.data?.length && <Suggestions list={sugg.data.slice(0, 3)} projectId={project.id} onAdded={reload} readOnly={readOnly} />}

      <div className="mt-10 border-t border-line pt-6">
        <h2 className="text-[17px] font-semibold tracking-title">Details</h2>
        <p className="mt-0.5 text-[13px] text-muted">Trends, competitors and the full numbers per engine and country.</p>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Trends className="xl:col-span-6" daily={daily.data} />
        <Ranking className="xl:col-span-6" brands={s.brands} />
      </div>
      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-2" title="Visibility vs sentiment" subtitle="Right = mentioned more often. Up = described more positively.">
          <VisibilitySentimentMap brands={s.brands} />
        </Card>
        <Card className="xl:col-span-3" title="Share of voice over time" subtitle="Each brand's share of all tracked-brand mentions, per day (7-day average).">
          {daily.data ? <>
            <ShareOfVoiceChart data={smooth(daily.data.series, daily.data.brands.map(b => `s_${b.id}`))} brands={daily.data.brands} />
            <div className="mt-2"><Legend brands={daily.data.brands} /></div>
          </> : <Spinner />}
        </Card>
      </div>
      <EngineTable data={engines.data} brands={s.brands} colorOf={colorOf} />
      <CountryTable data={countries.data} brands={s.brands} />
    </>
  );
}

// Change chip that reads on the dark hero card.
function HeroDelta({ now, before, invert, digits = 1, unit = 'pts' }) {
  if (now == null || before == null) return null;
  const d = Math.round((now - before) * 10 ** digits) / 10 ** digits;
  if (Math.abs(d) < 0.05) return <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/70">no change</span>;
  const better = invert ? d < 0 : d > 0;
  const Icon = d > 0 ? ArrowUp : ArrowDown;
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold tnum" style={better ? { background: 'rgba(142,240,190,.18)', color: 'var(--mint)' } : { background: 'rgba(255,105,97,.2)', color: '#ffa39e' }}>
      <Icon size={11} strokeWidth={2.5} aria-hidden />{Math.abs(d)} {unit}<span className="sr-only">{better ? '(better)' : '(worse)'}</span>
    </span>
  );
}

// The one card that matters: how often AI names the client, with the trend and the verdict in a sentence.
function Hero({ s, own, daily, days, unbranded, className = '' }) {
  const named = Math.round((own.visibility || 0) * s.totalAnswers / 100);
  const rivals = s.brands.length - 1;
  const leader = [...s.brands].sort((a, b) => (b.visibility ?? 0) - (a.visibility ?? 0))[0];
  const verdict = own.rank === 1 ? `more than any of your ${rivals} competitors.` : `#${own.rank} of ${s.brands.length}: ${leader.name} is named most (${fmtPct(leader.visibility)}).`;
  const series = daily ? smooth(daily.series, [`v_${own.id}`]) : null;
  const secondary = [
    ['Position', fmtPos(own.position), <HeroDelta now={own.position} before={own.prev?.position} invert unit="" />, 'Average place in numbered lists (1 = first)'],
    ['Sentiment', own.sentiment == null ? '—' : `${own.sentiment}/100`, <HeroDelta now={own.sentiment} before={own.prev?.sentiment} digits={0} />, 'Tone of the sentences that mention you (50 = neutral)'],
    ['Share of voice', fmtPct(own.sov), <HeroDelta now={own.sov} before={own.prev?.sov} />, 'Your share of all tracked-brand mentions'],
    unbranded && ['Unbranded questions', fmtPct(unbranded.v), null, `Named in ${fmtPct(unbranded.v)} of ${unbranded.n} answers to the ${unbranded.open} questions that do not mention ${own.name}. The other ${unbranded.branded} name it almost automatically, so this is the number to grow.`],
  ].filter(Boolean);
  return (
    <section className={`rise relative overflow-hidden rounded-2xl bg-forest p-6 text-white shadow-card md:p-7 ${className}`}>
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-30 blur-3xl" style={{ background: 'var(--mint)' }} aria-hidden />
      <div className="relative">
        <div className="eyebrow !text-white/60">AI visibility · last {days} days</div>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <span className="text-[56px] font-bold leading-none tracking-display tnum md:text-[64px]"><CountUp value={own.visibility} format={fmtPct} /></span>
          <span className="mb-2"><HeroDelta now={own.visibility} before={own.prev?.visibility} /></span>
        </div>
        <p className="mt-3 max-w-md text-[15px] leading-snug text-white/80">
          {own.name} is named in <strong className="text-white">{named} of {s.totalAnswers}</strong> AI answers, {verdict}
        </p>
        <div className="mt-4 h-[96px] -mx-2">
          {series ? <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <defs><linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--mint)" stopOpacity={0.45} /><stop offset="100%" stopColor="var(--mint)" stopOpacity={0} /></linearGradient></defs>
              <Tooltip cursor={{ stroke: 'rgba(255,255,255,.3)' }} content={({ active, payload, label }) => active && payload?.[0] ? <div className="rounded-lg bg-black/70 px-2.5 py-1.5 text-xs text-white">{fmtDate(label)} · {payload[0].value}%</div> : null} />
              <Area type="monotone" dataKey={`v_${own.id}`} stroke="var(--mint)" strokeWidth={2} fill="url(#heroFill)" dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer> : null}
        </div>
        <dl className={`mt-4 grid gap-3 border-t border-white/10 pt-4 ${secondary.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
          {secondary.map(([label, value, delta, help]) => (
            <div key={label} title={help}>
              <dt className="text-[11.5px] font-medium text-white/55">{label}</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2"><span className="text-[20px] font-semibold leading-none tnum">{value}</span>{delta}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

// Every tracked brand as a bar, so the client sees the gap to each rival at a glance.
function Standings({ brands, className = '' }) {
  const c = useColors();
  const rows = [...brands].sort((a, b) => a.rank - b.rank);
  const max = Math.max(1, ...rows.map(b => b.visibility || 0));
  return (
    <Card className={`rise ${className}`} title="Where you stand" subtitle="Share of AI answers that name each brand." right={<Link to="../competitors" className="inline-flex items-center gap-1 text-[12.5px] text-accent hover:underline">Competitors<ArrowRight size={13} /></Link>}>
      <ol className="space-y-2.5">
        {rows.map(b => (
          <li key={b.id} className="grid grid-cols-[1.25rem_7rem_1fr_3rem] items-center gap-2 text-[13px]">
            <span className="tnum text-muted">{b.rank}</span>
            <span className={`truncate ${b.is_own ? 'font-semibold text-ink' : 'text-ink2'}`}>{b.name}</span>
            <span className="h-2 overflow-hidden rounded-full bg-fill" aria-hidden>
              <span className="block h-full rounded-full transition-[width] duration-700" style={{ width: `${100 * (b.visibility || 0) / max}%`, background: b.is_own ? 'var(--accent)' : c.brand(b.color), opacity: b.is_own ? 1 : 0.55 }} />
            </span>
            <span className={`text-right tnum ${b.is_own ? 'font-semibold' : 'text-ink2'}`}>{fmtPct(b.visibility)}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Ring({ value, size = 56, stroke = 5, color = 'var(--accent)' }) {
  const r = (size - stroke) / 2, len = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fill)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - Math.min(100, value || 0) / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset .9s cubic-bezier(.2,.7,.2,1)' }} />
    </svg>
  );
}

// One tile per AI assistant. Numbers on the tiles; the heading says which one to work on.
function Engines({ data, own, days }) {
  if (!data || data.length < 2) return null;
  const rows = data.map(e => {
    const sorted = [...e.brands].sort((a, b) => (b.visibility ?? 0) - (a.visibility ?? 0));
    const me = e.brands.find(b => b.is_own);
    return { engine: e.engine, answers: e.totalAnswers, vis: me?.visibility ?? 0, rank: sorted.findIndex(b => b.is_own) + 1, of: sorted.length, leader: sorted[0] };
  }).sort((a, b) => b.vis - a.vis);
  const best = rows[0], worst = rows[rows.length - 1];
  const gap = best.vis - worst.vis >= 15;
  const weakest = gap ? worst : rows.find(r => !r.leader?.is_own);
  return (
    <section className="mt-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-semibold tracking-title">By AI assistant</h2>
        <p className="text-[13px] text-muted">{weakest ? <>Weakest on <strong className="text-ink">{engineName(weakest.engine)}</strong>: start there.</> : `No competitor is named more than ${own.name} on any assistant.`}</p>
      </div>
      <div className={`grid gap-3 sm:grid-cols-2 ${rows.length >= 3 ? 'lg:grid-cols-3' : ''} ${rows.length >= 4 ? 'xl:grid-cols-4' : ''}`}>
        {rows.map((r, i) => (
          <Link key={r.engine} to={`../chats?engines=${r.engine}&days=${days}`} title={`Read what ${engineName(r.engine)} answers`} style={stagger(i + 2)}
            className={`card rise flex items-center gap-4 p-4 transition-colors hover:border-accent ${r === weakest ? 'ring-1 ring-warnInk/40' : ''}`}>
            <div className="relative grid place-items-center">
              <Ring value={r.vis} color={r === weakest ? 'var(--warn-ink)' : 'var(--accent)'} />
              <span className="absolute text-[13px] font-semibold tnum">{Math.round(r.vis)}%</span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2"><EngineLogo id={r.engine} size={16} /><span className="font-semibold">{engineName(r.engine)}</span>
                {r === weakest && <span className="rounded-full bg-warnBg px-2 py-0.5 text-[11px] font-semibold text-warnInk">Start here</span>}</div>
              <div className="mt-1 text-[12.5px] text-ink2">{r.leader?.is_own ? `#1 of ${r.of}` : `#${r.rank} of ${r.of} · ${r.leader?.name} leads with ${fmtPct(r.leader?.visibility)}`}</div>
              <div className="text-[11.5px] text-muted" title={r.answers < 20 ? `Few answers so far: the true share is within about ±${moe(r.vis, r.answers)} points.` : undefined}>{r.answers} answers{r.answers < 20 && ' · early'}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

// Visibility on the questions that do not name the brand: the honest measure of being recommended.
function unbranded(prompts, own) {
  if (!prompts) return null;
  const asked = prompts.filter(p => p.active && p.answers > 0);
  const branded = asked.filter(p => namesBrand(p.text, own));
  const open = asked.filter(p => !branded.includes(p));
  const n = open.reduce((t, p) => t + p.answers, 0);
  if (!branded.length || !n) return null;
  return { v: open.reduce((t, p) => t + (p.visibility || 0) * p.answers, 0) / n, n, open: open.length, branded: branded.length };
}

// The three most important open suggestions, so the overview always ends in something to do.
function NextActions({ list }) {
  const open = (list || []).filter(a => !a.status || a.status === 'open' || a.status === 'planned').slice(0, 3);
  if (!open.length) return null;
  return (
    <div className="card mt-4 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[14px] font-semibold"><Lightbulb size={15} className="text-accent" />What to do next</span>
        <Link to="../actions" className="inline-flex items-center gap-1 text-[12.5px] text-accent hover:underline">All suggested actions<ArrowRight size={13} /></Link>
      </div>
      <ol className="grid gap-2 md:grid-cols-3">
        {open.map((a, i) => (
          <li key={a.key}><Link to="../actions" className="block h-full rounded-lg bg-fill px-3 py-2.5 transition-colors hover:bg-raised">
            <div className="text-[11.5px] text-muted">{i + 1} · {a.priority === 'high' ? 'High' : a.priority === 'medium' ? 'Medium' : 'Low'} priority</div>
            <div className="mt-0.5 text-[13.5px] font-medium leading-snug">{a.title}</div>
            {a.why && <div className="mt-1 line-clamp-2 text-[12px] text-ink2">{a.why}</div>}
          </Link></li>
        ))}
      </ol>
    </div>
  );
}

function Suggestions({ list, projectId, onAdded, readOnly }) {
  const toast = useToast();
  const add = async name => { await api(`/projects/${projectId}/brands`, { method: 'POST', body: { name } }); toast(`${name} is now tracked. History was recounted.`); onAdded(); };
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
      <Lightbulb size={15} className="text-accent" />
      <span className="text-ink2">Often mentioned but not tracked:</span>
      {list.map(s => readOnly ? <span key={s.name} className="chip">{s.name} <span className="text-muted">{s.visibility}%</span></span> : (
        <button key={s.name} className="chip hover:border-accent" onClick={() => add(s.name)} title="Track this brand">
          <Plus size={12} />{s.name} <span className="text-muted">{s.visibility}%</span>
        </button>
      ))}
      <Link to="../competitors" className="ml-auto text-xs text-muted underline">See all</Link>
    </div>
  );
}

function Trends({ daily, className }) {
  const [metric, setMetric] = useState('v');
  const [hidden, setHidden] = useState(new Set());
  const data = useMemo(() => daily ? smooth(daily.series, daily.brands.map(b => `${metric}_${b.id}`), metric === 'p' || metric === 't' ? 1 : 7) : [], [daily, metric]);
  const toggle = id => setHidden(h => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <Card className={className} title="Trend" subtitle={metric === 'v' ? 'Visibility per day, 7-day average' : metric === 's' ? 'Share of voice per day, 7-day average' : metric === 'p' ? 'Average position per day (1 = top)' : 'Sentiment per day (0–100)'}
      right={<Segmented size="sm" value={metric} onChange={setMetric} options={[{ value: 'v', label: 'Visibility' }, { value: 's', label: 'Share of voice' }, { value: 'p', label: 'Position' }, { value: 't', label: 'Sentiment' }]} />}>
      {daily ? <>
        <TrendChart data={data} brands={daily.brands} prefix={metric} hidden={hidden} unit={metric === 'p' ? '' : metric === 't' ? '' : '%'} domain={metric === 'p' ? [1, 'auto'] : metric === 't' ? [0, 100] : [0, 'auto']} />
        <div className="mt-2"><Legend brands={daily.brands} hidden={hidden} onToggle={toggle} /></div>
        <p className="mt-1 text-[11px] text-muted">Click a name to hide or show it.</p>
      </> : <Spinner />}
    </Card>
  );
}

// Margin of error of a share measured on n answers, in points (95%): AI answers vary, so a share from few answers is rough.
const moe = (pct, n) => (pct == null || !n ? 0 : Math.round(196 * Math.sqrt((pct / 100) * (1 - pct / 100) / n)));

// AI described a look-alike company when asked about the client (see the brand profile's "Not to be confused with").
function Confusion({ c, prev, own }) {
  const names = (c.lookalikes || []).map(l => l.name).join(', ');
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-warnBg px-4 py-3 text-[13.5px] text-warnInk">
      <AlertTriangle size={16} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <strong>AI confused {own.name} with {names}</strong> in {c.answers} answer{c.answers === 1 ? '' : 's'} ({fmtPct(c.share)}).
        {' '}These are not counted in {/s$/i.test(own.name) ? `${own.name}’` : `${own.name}’s`} numbers.
        {prev && <span className="ml-1">Previous period: {fmtPct(prev.share)}.</span>}
      </span>
      <span className="flex gap-3 text-[12.5px] font-medium">
        <Link to="../chats" className="underline">See answers</Link>
        <Link to="../optimise" className="underline">How to fix</Link>
      </span>
    </div>
  );
}

// Small change marker next to a number: green when better, red when worse.
function MiniDelta({ now, before, invert, digits = 1, unit = '' }) {
  if (now == null || before == null) return null;
  const d = Math.round((now - before) * 10 ** digits) / 10 ** digits;
  if (Math.abs(d) < 0.05) return null;
  const better = invert ? d < 0 : d > 0;
  const Icon = d > 0 ? ArrowUpRight : ArrowDownRight;
  return <span className={`inline-flex items-center gap-0.5 text-[11.5px] font-medium tnum ${better ? 'text-good' : 'text-bad'}`}><Icon size={12} strokeWidth={2.5} aria-hidden />{Math.abs(d)}{unit}<span className="sr-only">{better ? '(better)' : '(worse)'}</span></span>;
}

const toneColor = v => v == null ? 'var(--muted)' : v >= 60 ? 'var(--good)' : v >= 40 ? '#ff9f0a' : 'var(--bad)';

function Ranking({ brands, className }) {
  const rows = [...brands].sort((a, b) => a.rank - b.rank);
  return (
    <Card className={className} title="Competitor ranking" subtitle="Sorted by visibility. Arrows compare with the previous period." pad={false}>
      {/* relative: keeps the screen-reader-only labels inside the scroll area on small screens */}
      <div className="relative overflow-x-auto">
        <table className="w-full text-[13.5px]">
          <thead><tr className="border-y border-line"><th className="th pl-5">#</th><th className="th">Brand</th><th className="th">Visibility</th><th className="th">Sentiment</th><th className="th pr-5">Position</th></tr></thead>
          <tbody>
            {rows.map(b => (
              <tr key={b.id} className={`border-b border-line last:border-0 ${b.is_own ? 'bg-accentSoft' : ''}`}>
                <td className="td pl-5 tnum text-muted">{b.rank}</td>
                <td className="td"><span className="flex items-center gap-2 whitespace-nowrap"><BrandDot slot={b.color} /><span className={b.is_own ? 'font-semibold' : 'font-medium'}>{b.name}</span></span></td>
                <td className="td"><span className="flex items-center gap-2 whitespace-nowrap"><span className="tnum">{fmtPct(b.visibility)}</span><MiniDelta now={b.visibility} before={b.prev?.visibility} /></span></td>
                <td className="td"><span className="flex items-center gap-2 whitespace-nowrap">
                  <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-line bg-surface px-1.5 tnum text-[12.5px]" title={b.sentiment == null ? 'Not enough signal' : `${b.sentiment}/100`}>
                    <span className="h-3 w-[3px] rounded-full" style={{ background: toneColor(b.sentiment) }} />{b.sentiment ?? '—'}
                  </span><MiniDelta now={b.sentiment} before={b.prev?.sentiment} digits={0} /></span></td>
                <td className="td pr-5"><span className="flex items-center gap-2 whitespace-nowrap">
                  <span className="inline-flex h-6 items-center rounded-md border border-line bg-surface px-1.5 tnum text-[12.5px]"><span className="text-muted">#</span>{b.position == null ? '—' : Number(b.position).toFixed(1)}</span>
                  <MiniDelta now={b.position} before={b.prev?.position} invert /></span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function EngineTable({ data, brands }) {
  const meta = useMeta();
  if (!data) return null;
  return (
    <Card className="mt-4" title="By AI engine" subtitle="Visibility of each brand on each engine. Engines answer differently, so this shows where you are strong or weak." pad={false}>
      <div className="overflow-x-auto px-2 pb-2">
        <table className="w-full">
          <thead><tr><th className="th">Brand</th>{data.map(e => <th key={e.engine} className="th">{meta.engines.find(x => x.id === e.engine)?.label || e.engine}<div className="font-normal">{e.totalAnswers} answers</div></th>)}</tr></thead>
          <tbody>
            {brands.map(b => (
              <tr key={b.id} className={b.is_own ? 'bg-accentSoft' : ''}>
                <td className="td"><span className="flex items-center gap-2 whitespace-nowrap"><BrandDot slot={b.color} /><span className={b.is_own ? 'font-semibold' : ''}>{b.name}</span></span></td>
                {data.map(e => {
                  const x = e.brands.find(y => y.id === b.id);
                  return <td key={e.engine} className="td"><div className="flex items-center gap-2"><span className="tnum w-11">{fmtPct(x?.visibility)}</span><Bar value={x?.visibility} slot={b.color} /></div>
                    <div className="text-[11px] text-muted tnum">{x?.position != null ? `pos ${fmtPos(x.position)}` : x?.visibility > 0 ? 'not in a list' : 'pos —'} · tone {x?.sentiment ?? '—'}</div></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CountryTable({ data, brands }) {
  const meta = useMeta();
  if (!data || data.length < 2) return null;
  return (
    <Card className="mt-4" title="By country" subtitle="Visibility per market, based on the country tag of each question." pad={false}>
      <div className="overflow-x-auto px-2 pb-2">
        <table className="w-full">
          <thead><tr><th className="th">Brand</th>{data.map(c => <th key={c.country} className="th">{COUNTRY_FLAGS[c.country]} {meta.countries[c.country] || c.country}</th>)}</tr></thead>
          <tbody>
            {brands.map(b => (
              <tr key={b.id} className={b.is_own ? 'bg-accentSoft' : ''}>
                <td className="td"><span className="flex items-center gap-2 whitespace-nowrap"><BrandDot slot={b.color} /><span className={b.is_own ? 'font-semibold' : ''}>{b.name}</span></span></td>
                {data.map(c => { const x = c.brands.find(y => y.id === b.id); return <td key={c.country} className="td tnum">{fmtPct(x?.visibility)}</td>; })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
