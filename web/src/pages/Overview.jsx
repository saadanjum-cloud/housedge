import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Sparkles, Home, ArrowUpRight, ArrowDownRight, ChevronsUp, ChevronsDown, AlertTriangle } from 'lucide-react';
import { useApi, useFilters, api, fmtPct, fmtPos, COUNTRY_FLAGS } from '../lib.js';
import { useMeta, useProject } from '../ctx.js';
import { Card, Stat, Delta, Spinner, ErrorBox, SimBanner, Empty, Segmented, BrandDot, Bar, Sentiment, useToast } from '../ui.jsx';
import { TrendChart, ShareOfVoiceChart, VisibilitySentimentMap, Legend, smooth } from '../charts.jsx';
import FilterBar from './FilterBar.jsx';
import { CountUp } from '../motion.jsx';

export default function Overview() {
  const { project, reload, readOnly } = useProject();
  const { qs, f } = useFilters();
  const sum = useApi(`/projects/${project.id}/summary?${qs}`);
  const daily = useApi(`/projects/${project.id}/daily?${qs}`);
  const engines = useApi(`/projects/${project.id}/engines?${qs}`);
  const countries = useApi(`/projects/${project.id}/countries?${qs}`);
  const sugg = useApi(`/projects/${project.id}/suggestions?${qs}`);

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
      {own && <Headline s={s} own={own} days={f.days} />}
      {own && s.confusion?.answers > 0 && <Confusion c={s.confusion} prev={s.prevConfusion} own={own} />}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat i={0} label="Visibility" help="Share of AI answers that mention your brand at all." value={<CountUp value={own?.visibility} format={fmtPct} />}
          delta={<Delta now={own?.visibility} before={own?.prev?.visibility} />} sub={`of ${s.totalAnswers} answers`} />
        <Stat i={1} label="Position" help="Average rank when you are mentioned. 1 = named first. Lower is better." value={<CountUp value={own?.position} format={fmtPos} />}
          delta={<Delta now={own?.position} before={own?.prev?.position} invert unit="" />} />
        <Stat i={2} label="Sentiment" help="Tone of the sentences that mention you: 0 = very negative, 50 = neutral, 100 = very positive." value={<CountUp value={own?.sentiment} format={v => <Sentiment value={v} />} />}
          delta={<Delta now={own?.sentiment} before={own?.prev?.sentiment} digits={0} />} />
        <Stat i={3} label="Share of voice" help="Your mentions as a share of all mentions of tracked brands." value={<CountUp value={own?.sov} format={fmtPct} />}
          delta={<Delta now={own?.sov} before={own?.prev?.sov} />} sub={`rank #${own?.rank} of ${s.brands.length}`} />
      </div>
      <p className="mt-2 text-xs text-muted">Changes compare with the previous {f.days} days.</p>

      {!!sugg.data?.length && <Suggestions list={sugg.data.slice(0, 3)} projectId={project.id} onAdded={reload} readOnly={readOnly} />}

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-12">
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

function Suggestions({ list, projectId, onAdded, readOnly }) {
  const toast = useToast();
  const add = async name => { await api(`/projects/${projectId}/brands`, { method: 'POST', body: { name } }); toast(`${name} is now tracked. History was recounted.`); onAdded(); };
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
      <Sparkles size={15} className="text-accent" />
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

// Rank of a brand on one metric among all tracked brands (1 = best), now and in the previous period.
function rankOf(brands, id, get, lowerBetter) {
  const vals = brands.map(b => ({ id: b.id, v: get(b) })).filter(x => x.v != null);
  if (!vals.some(x => x.id === id)) return null;
  vals.sort((a, b) => lowerBetter ? a.v - b.v : b.v - a.v);
  return { rank: vals.findIndex(x => x.id === id) + 1, of: vals.length };
}

// One-line status at the top of the overview, with the client's rank on each metric.
function Headline({ s, own, days }) {
  const d = own.prev?.visibility != null && own.visibility != null ? Math.round((own.visibility - own.prev.visibility) * 10) / 10 : null;
  const poss = /s$/i.test(own.name) ? `${own.name}’` : `${own.name}’s`;
  const text = d == null ? `${own.name} is named in ${fmtPct(own.visibility)} of AI answers`
    : Math.abs(d) < 0.05 ? `${poss} visibility is unchanged vs the previous ${days} days`
    : `${poss} visibility is ${d > 0 ? 'up' : 'down'} ${Math.abs(d)} pts vs the previous ${days} days`;
  const metrics = [['Visibility', b => b.visibility, b => b.prev?.visibility, false], ['Sentiment', b => b.sentiment, b => b.prev?.sentiment, false], ['Position', b => b.position, b => b.prev?.position, true]];
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3 text-[13.5px]">
      <span className="flex min-w-0 items-center gap-2">
        <Home size={15} className="shrink-0 text-muted" />
        <span className="text-muted">Overview</span><span className="text-muted">·</span>
        <span className={`font-medium ${d > 0 ? 'text-good' : d < 0 ? 'text-bad' : ''}`}>{text}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted">
        {metrics.map(([label, now, before, lower]) => {
          const r = rankOf(s.brands, own.id, now, lower);
          const p = rankOf(s.brands, own.id, before, lower);
          const better = r && p ? p.rank - r.rank : 0;
          return (
            <span key={label} className="inline-flex items-center gap-1">
              {label}: <span className="font-semibold tnum text-ink">{r ? `${r.rank}/${r.of}` : 'n/a'}</span>
              {better > 0 && <ChevronsUp size={13} className="text-good" aria-label="rank improved" />}
              {better < 0 && <ChevronsDown size={13} className="text-bad" aria-label="rank dropped" />}
            </span>
          );
        })}
      </span>
    </div>
  );
}

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
                    <div className="text-[11px] text-muted tnum">pos {fmtPos(x?.position)} · tone {x?.sentiment ?? '—'}</div></td>;
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
