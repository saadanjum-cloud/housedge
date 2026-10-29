// A client's first sign-in: short steps that collect everything we need: company, brand, business details,
// competitors, questions, goals and contacts, files, and the schedule.
// Uses the same requests as the rest of the app (/projects, /orgs, /me), so security rules apply as everywhere else.
import { useMemo, useRef, useState } from 'react';
import { Check, Plus, Trash2, Upload, FileText, Sparkles, Loader2 } from 'lucide-react';
import { api } from '../lib.js';
import { supabase } from '../supabase.js';
import { useMeta, useUser } from '../ctx.js';
import { ErrorBox } from '../ui.jsx';
import { Logo } from '../motion.jsx';
import { PROFILE_QUESTIONS, DISCOVERY_QUESTIONS, PROFILES_QUESTION, FILE_TYPES, FILE_BUCKET, MAX_FILE_MB, toHttps } from '../intake.js';

const STEPS = ['Company', 'Your brand', 'About your business', 'Competitors', 'Questions', 'Goals & contacts', 'Files', 'AI assistants', 'Review'];
const ENGINES = { chatgpt: ['ChatGPT', 'OpenAI with web search'], gemini: ['Gemini', 'Google with Search grounding'], perplexity: ['Perplexity', 'Perplexity Sonar'], claude: ['Claude', 'Anthropic with web search'] };
// Expected cost per answer (USD) to show the monthly estimate. Claude measured Oct 2026 in scheduled half-price batches.
const COST = { chatgpt: 0.01, gemini: 0.02, perplexity: 0.01, claude: 0.12 };
const RUNS = { weekly: 4.3, every3: 10, daily: 30 };
const FREQ = { weekly: 'Every week', every3: 'Every 3 days', daily: 'Every day' };
const cleanDomain = d => (d || '').trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
const money = n => `$${n < 10 ? n.toFixed(2) : Math.round(n)}`;

function Field({ label, hint, value, onChange, multi, ...rest }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {multi ? <textarea className="input min-h-[84px]" value={value} onChange={e => onChange(e.target.value)} {...rest} />
        : <input className="input" value={value} onChange={e => onChange(e.target.value)} {...rest} />}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

// One block of written questions (business details, or goals and contacts).
function Answers({ questions, values, onChange }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {questions.map(([k, label, hint, max, multi]) => (
        <div key={k} className={multi ? 'sm:col-span-2' : ''}>
          <Field label={label} hint={hint} value={values[k] || ''} maxLength={max} multi={multi} onChange={v => onChange({ ...values, [k]: v })} />
        </div>
      ))}
    </div>
  );
}

// Files go straight to the client's own private folder; only they and the Housedge team can open them.
function Files({ orgId, files, setFiles }) {
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef();
  const add = async list => {
    setErr(null); setBusy(true);
    try {
      for (const file of list) {
        if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`${file.name} is larger than ${MAX_FILE_MB} MB.`);
        const path = `${orgId}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, '_').slice(-120)}`;
        const { error } = await supabase.storage.from(FILE_BUCKET).upload(path, file, { contentType: file.type || undefined });
        if (error) throw new Error(`${file.name}: ${error.message}`);
        setFiles(fs => [...fs, { path, name: file.name, size: file.size }]);
      }
    } catch (e) { setErr(e.message); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const remove = async f => {
    const { error } = await supabase.storage.from(FILE_BUCKET).remove([f.path]);
    if (error) return setErr(error.message);
    setFiles(fs => fs.filter(x => x.path !== f.path));
  };
  return (
    <div className="grid gap-3">
      <label className={`card flex cursor-pointer flex-col items-center gap-2 border-dashed p-8 text-center ${busy ? 'opacity-60' : ''}`}
        onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); add([...e.dataTransfer.files]); }}>
        <Upload size={22} className="text-muted" />
        <span className="text-sm font-semibold">{busy ? 'Uploading…' : 'Drop files here or click to choose'}</span>
        <span className="text-xs text-muted">PDF, images, Word, Excel, PowerPoint, CSV or ZIP, up to {MAX_FILE_MB} MB each.</span>
        <input ref={input} type="file" multiple accept={FILE_TYPES} className="sr-only" disabled={busy} onChange={e => add([...e.target.files])} />
      </label>
      {files.length > 0 && <div className="card overflow-hidden">{files.map((f, i) => (
        <div key={f.path} className="flex items-center gap-3 px-4 py-2.5 text-sm" style={{ borderTop: i ? '1px solid var(--line)' : 0 }}>
          <FileText size={15} className="text-muted" /><span className="flex-1 truncate">{f.name}</span>
          <span className="text-xs text-muted tnum">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
          <button className="btn-ghost btn-sm" aria-label={`Remove ${f.name}`} onClick={() => remove(f)}><Trash2 size={13} /></button>
        </div>))}</div>}
      <ErrorBox error={err} />
    </div>
  );
}

export default function Onboarding() {
  const user = useUser();
  const meta = useMeta();
  const org = user.orgs[0];
  const [step, setStep] = useState(0);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    company: org.name || '', website: org.website || '', industry: org.industry || '', country: org.country || 'Finland',
    name: user.name !== user.email ? user.name : '', jobTitle: user.jobTitle || '',
    brand: org.name || '', brandSite: cleanDomain(org.website), aliases: '', competitors: [{ name: '', domain: '' }],
    offer: '', markets: ['FI'], skipped: new Set(), extra: '', engines: Object.keys(ENGINES), frequency: 'weekly',
    profile: {}, links: '', disc: {}, files: [],
  });
  const up = patch => setF(x => ({ ...x, ...patch }));
  const setFiles = change => setF(x => ({ ...x, files: change(x.files) }));
  const [pre, setPre] = useState(null); // website prefill: { busy } | { note } | { err }

  // Fills empty answers from the company's own website (read by a cheap AI model). Nothing typed is overwritten.
  async function prefill() {
    setPre({ busy: true });
    try {
      const { wizard: w, site, pages } = await api(`/orgs/${org.id}/prefill`, { method: 'POST', body: { website: f.website } });
      const pick = (mine, theirs) => (String(mine ?? '').trim() || !String(theirs ?? '').trim() ? mine : theirs);
      setF(x => ({
        ...x,
        company: pick(x.company, w.company), industry: pick(x.industry, w.industry), country: pick(x.country, w.country),
        brand: pick(x.brand, w.brand), brandSite: pick(x.brandSite, w.brandSite), aliases: pick(x.aliases, w.aliases),
        offer: pick(x.offer, w.offer), extra: pick(x.extra, w.extra), links: pick(x.links, w.links),
        markets: w.markets.length ? w.markets : x.markets, skipped: new Set(),
        competitors: x.competitors.some(c => c.name.trim()) || !w.competitors.length ? x.competitors : w.competitors,
        profile: Object.fromEntries(Object.keys({ ...x.profile, ...w.profile }).map(k => [k, pick(x.profile[k], w.profile[k])])),
      }));
      setPre({ note: `Read ${pages} page${pages === 1 ? '' : 's'} of ${site} and filled in the answers it could. Please check every step: you know your business best, and nothing is saved until you finish.` });
    } catch (e) { setPre({ err: e.message }); }
  }
  const created = useRef(null); // project id, so pressing Finish again after an error does not create a second project

  const generated = useMemo(() => {
    const out = [], offer = f.offer.trim(), brand = f.brand.trim();
    for (const g of meta.generalPrompts) {
      if (g.brand) { if (brand) out.push({ topic: g.topic, country: 'GLOBAL', text: g.t.replace('{brand}', brand) }); continue; }
      if (!offer) continue;
      if (!g.t.includes('{where}')) { out.push({ topic: g.topic, country: 'GLOBAL', text: g.t.replace('{offer}', offer) }); continue; }
      for (const m of f.markets) out.push({ topic: g.topic, country: m, text: g.t.replace('{offer}', offer).replace('{where}', m === 'GLOBAL' ? '' : ` in ${meta.countries[m]}`) });
    }
    return out;
  }, [f.offer, f.brand, f.markets, meta]);
  const questions = [...generated.filter((_, i) => !f.skipped.has(i)),
    ...f.extra.split('\n').map(t => t.trim()).filter(Boolean).map(text => ({ text, topic: 'Custom', country: f.markets[0] || 'GLOBAL' }))];
  const monthly = questions.length * f.engines.reduce((s, e) => s + COST[e], 0) * RUNS[f.frequency];
  const budget = Number(org.monthly_budget || 0);

  const links = f.links.split('\n').map(s => s.trim()).filter(Boolean);
  const answered = obj => Object.values(obj).filter(x => String(x).trim()).length;
  const checks = [
    () => (!f.company.trim() ? 'Please enter your company name.' : !f.name.trim() ? 'Please enter your name.' : null),
    () => (!f.brand.trim() ? 'Please enter the brand name to track.' : null),
    () => (!f.profile.tagline?.trim() || !f.profile.description?.trim() ? 'Please describe your company (the first two questions).' : links.length > 15 ? 'Add at most 15 profile addresses.' : null),
    () => (f.competitors.filter(c => c.name.trim()).length > 15 ? 'Track at most 15 competitors to start.' : null),
    () => (!questions.length ? 'Describe what you offer, or add at least one question.' : questions.length > 100 ? 'Start with at most 100 questions.' : null),
    () => (!f.disc.goals?.trim() ? 'Please tell us what you want to achieve.' : !f.disc.contact?.trim() ? 'Please add a main contact for this project.' : null),
    () => null,
    () => (!f.engines.length ? 'Choose at least one AI assistant.' : null),
    () => null,
  ];
  const next = () => { const e = checks[step](); setErr(e); if (!e) setStep(s => s + 1); };

  async function finish() {
    setErr(null); setBusy(true);
    try {
      await api('/me', { method: 'PATCH', body: { name: f.name.trim(), jobTitle: f.jobTitle.trim() } });
      const trimmed = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, String(v).trim()]).filter(([, v]) => v));
      const competitors = f.competitors.filter(c => c.name.trim());
      created.current ??= (await api('/projects', { method: 'POST', body: {
        name: f.brand.trim(), category: 'business', countries: f.markets.length ? f.markets : ['GLOBAL'], engines: f.engines, frequency: f.frequency,
        own: { name: f.brand.trim(), domain: f.brandSite, aliases: f.aliases.split(',').map(a => a.trim()).filter(Boolean) },
        competitors: competitors.map(c => ({ name: c.name.trim(), domain: c.domain })),
        prompts: questions.map(x => ({ text: x.text.slice(0, 500), topic: x.topic, country: x.country })),
        // Also fills the team's "Discovery notes" page (competitors, markets, questions, goals, contact, notes).
        discovery: { ...trimmed(f.disc), offer: f.offer.trim(), markets: f.markets, competitors: competitors.map(c => c.name.trim()).join(', '),
          questions: f.extra.trim(), files: f.files.map(x => x.name), source: 'client onboarding' },
      } })).id;
      await api(`/projects/${created.current}/profile`, { method: 'PUT', body: { ...trimmed(f.profile), name: f.brand.trim(), profiles: links.map(toHttps) } });
      await api(`/orgs/${org.id}`, { method: 'PATCH', body: { name: f.company.trim(), website: f.website.trim(), industry: f.industry.trim(), country: f.country.trim(), onboarded: true } });
      window.location.href = '/';
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <span className="flex items-center gap-2.5"><Logo size={28} /><span className="text-[15px] font-semibold">Housedge</span></span>
        <button className="btn-ghost btn-sm" onClick={async () => { await supabase.auth.signOut(); window.location.href = '/login'; }}>Sign out</button>
      </header>
      <div className="mx-auto grid max-w-5xl gap-10 px-6 py-10 md:grid-cols-[200px_1fr]">
        <ol className="hidden content-start gap-1 md:grid" aria-label="Setup steps">
          {STEPS.map((label, i) => (
            <li key={label} className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium ${i === step ? 'bg-fill text-ink' : i < step ? 'text-ink2' : 'text-muted'}`}>
              <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${i < step ? 'bg-accent text-accentInk' : i === step ? 'bg-ink text-page' : 'bg-fill'}`}>{i < step ? <Check size={12} /> : i + 1}</span>{label}
            </li>
          ))}
        </ol>
        <main>
          <div className="eyebrow mb-1.5">Step {step + 1} of {STEPS.length}</div>
          {step === 0 && <Step title={`Welcome to Housedge${f.name ? `, ${f.name.split(' ')[0]}` : ''}`} text="We will ask about your company, your brand, your goals and your competitors. It takes about ten minutes, and you can change everything later.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company name" value={f.company} onChange={v => up({ company: v })} maxLength={160} />
              <Field label="Company website" value={f.website} onChange={v => up({ website: v })} placeholder="example.com" maxLength={200} />
              <Field label="Industry" value={f.industry} onChange={v => up({ industry: v })} placeholder="e.g. Food delivery" maxLength={120} />
              <Field label="Headquarters country" value={f.country} onChange={v => up({ country: v })} maxLength={60} />
              <Field label="Your full name" value={f.name} onChange={v => up({ name: v })} maxLength={120} />
              <Field label="Your job title" value={f.jobTitle} onChange={v => up({ jobTitle: v })} placeholder="e.g. Head of Marketing" maxLength={120} />
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl bg-accentSoft px-4 py-3">
              <Sparkles size={16} className="text-accent" />
              <span className="flex-1 text-[13px] text-ink2">Save time: we can read your website and fill in the next steps for you to check.</span>
              <button className="btn-primary btn-sm" disabled={!f.website.trim() || pre?.busy} onClick={prefill}>
                {pre?.busy ? <><Loader2 size={13} className="animate-spin" />Reading your website…</> : 'Fill in from our website'}
              </button>
            </div>
            {pre?.note && <p className="mt-2 text-[13px] text-good">{pre.note}</p>}
            {pre?.err && <div className="mt-2"><ErrorBox error={pre.err} /></div>}
          </Step>}
          {step === 1 && <Step title="Which brand should we track?" text="Usually your company or main product. Add other names people use for it, so every mention is recognised.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Brand name" value={f.brand} onChange={v => up({ brand: v })} maxLength={120} />
              <Field label="Brand website" value={f.brandSite} onChange={v => up({ brandSite: v })} placeholder="example.com" hint="Helps tell your brand apart from others with a similar name." />
              <div className="sm:col-span-2"><Field label="Other names (optional)" value={f.aliases} onChange={v => up({ aliases: v })} placeholder="e.g. Wolt Market, Wolt+" hint="Separate with commas." /></div>
            </div>
          </Step>}
          {step === 2 && <Step title="Tell us about your business" text="This becomes your brand profile: the facts we check AI answers against, and the basis of the website code we prepare for you. The first two questions are required.">
            <div className="grid gap-4">
              <Answers questions={PROFILE_QUESTIONS} values={f.profile} onChange={profile => up({ profile })} />
              <Field label={PROFILES_QUESTION[1]} hint={PROFILES_QUESTION[2]} value={f.links} multi onChange={v => up({ links: v })} placeholder="linkedin.com/company/your-company" />
            </div>
          </Step>}
          {step === 3 && <Step title="Who do you compete with?" text="We compare how often AI assistants recommend you against these brands. Three to seven is a good start; we will also suggest brands the AI names that you do not track yet.">
            <div className="grid gap-2">
              {f.competitors.map((c, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <input className="input" placeholder="Competitor name" value={c.name} maxLength={120} aria-label={`Competitor ${i + 1} name`} onChange={e => up({ competitors: f.competitors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <input className="input" placeholder="website.com (optional)" value={c.domain} aria-label={`Competitor ${i + 1} website`} onChange={e => up({ competitors: f.competitors.map((x, j) => (j === i ? { ...x, domain: e.target.value } : x)) })} />
                  <button className="btn-ghost" aria-label="Remove" onClick={() => up({ competitors: f.competitors.filter((_, j) => j !== i) })}><Trash2 size={15} /></button>
                </div>
              ))}
              <button className="btn-ghost w-fit" onClick={() => up({ competitors: [...f.competitors, { name: '', domain: '' }] })}><Plus size={14} />Add competitor</button>
            </div>
          </Step>}
          {step === 4 && <Step title="What do your customers ask AI?" text="Describe what you offer in your customers' words and choose your markets. We write starter questions; untick any that do not fit and add your own.">
            <div className="grid gap-4">
              <Field label="What do you offer?" value={f.offer} onChange={v => up({ offer: v, skipped: new Set() })} placeholder="e.g. food delivery apps" maxLength={120} hint={'Used in questions like "What are the best food delivery apps in Finland?"'} />
              <div><span className="label">Markets</span><div className="flex flex-wrap gap-2">
                {Object.entries(meta.countries).map(([code, name]) => { const on = f.markets.includes(code); return <button key={code} className={`chip ${on ? 'chip-on' : ''}`} aria-pressed={on} onClick={() => up({ markets: on ? f.markets.filter(m => m !== code) : [...f.markets, code], skipped: new Set() })}>{name}</button>; })}
              </div></div>
              {generated.length > 0 && <div className="card overflow-hidden">
                {generated.map((g, i) => (
                  <label key={i} className="flex cursor-pointer items-start gap-3 px-4 py-2.5 text-sm" style={{ borderTop: i ? '1px solid var(--line)' : 0 }}>
                    <input type="checkbox" className="mt-0.5" checked={!f.skipped.has(i)} onChange={() => { const n = new Set(f.skipped); n.has(i) ? n.delete(i) : n.add(i); up({ skipped: n }); }} />
                    <span className="flex-1">{g.text}</span><span className="text-xs text-muted">{g.topic}</span>
                  </label>
                ))}
              </div>}
              <label className="block"><span className="label">Your own questions (optional, one per line)</span>
                <textarea className="input min-h-[88px]" value={f.extra} onChange={e => up({ extra: e.target.value })} placeholder="e.g. Which app delivers groceries fastest in Helsinki?" /></label>
              <p className="text-sm text-muted">{questions.length} questions selected.</p>
            </div>
          </Step>}
          {step === 5 && <Step title="Goals and contacts" text="What success looks like for you, what AI gets wrong today, and who we work with. The first question and the main contact are required.">
            <Answers questions={DISCOVERY_QUESTIONS} values={f.disc} onChange={disc => up({ disc })} />
          </Step>}
          {step === 6 && <Step title="Share your files (optional)" text="Brand guidelines, logos, price lists, earlier reports, press releases: anything that helps us describe you correctly. Only you and the Housedge team can open them.">
            <Files orgId={org.id} files={f.files} setFiles={setFiles} />
          </Step>}
          {step === 7 && <Step title="Which AI assistants, and how often?" text="We ask each question to each assistant through their official services and keep every answer.">
            <div className="grid gap-4">
              <div className="grid gap-2 sm:grid-cols-2">{Object.entries(ENGINES).map(([id, [label, note]]) => { const on = f.engines.includes(id); return (
                <label key={id} className={`card flex cursor-pointer items-start gap-3 p-4 ${on ? 'ring-2 ring-accent' : ''}`}>
                  <input type="checkbox" className="mt-1" checked={on} onChange={() => up({ engines: on ? f.engines.filter(x => x !== id) : [...f.engines, id] })} />
                  <span><span className="block text-sm font-semibold">{label}</span><span className="text-xs text-muted">{note}</span></span>
                </label>); })}</div>
              <label className="block max-w-xs"><span className="label">How often</span>
                <select className="input" value={f.frequency} onChange={e => up({ frequency: e.target.value })}>{Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <div className={`rounded-2xl px-4 py-3 text-[13px] ${budget && monthly > budget ? 'bg-warnBg text-warnInk' : 'bg-accentSoft text-ink2'}`}>
                Expected AI usage: about <strong>{money(monthly)}</strong> a month for {questions.length} questions × {f.engines.length} assistants.{' '}
                {budget ? <>Your monthly allowance is <strong>{money(budget)}</strong>{monthly > budget ? '. Checks pause when it is reached: choose fewer questions or a lower frequency, or ask your Housedge contact to raise it.' : '.'}</> : 'Your Housedge contact sets your monthly allowance before the first check runs.'}
              </div>
            </div>
          </Step>}
          {step === 8 && <Step title="Ready to start" text="Check the summary. You can change everything later.">
            <dl className="card text-sm">
              {[['Company', f.company], ['Brand tracked', `${f.brand}${f.brandSite ? ` (${cleanDomain(f.brandSite)})` : ''}`],
                ['Business details', `${answered(f.profile)} of ${PROFILE_QUESTIONS.length} answered${links.length ? `, ${links.length} profile links` : ''}`],
                ['Goals & contacts', `${answered(f.disc)} of ${DISCOVERY_QUESTIONS.length} answered`],
                ['Files', f.files.length ? f.files.map(x => x.name).join(', ') : 'None'],
                ['Competitors', f.competitors.filter(c => c.name.trim()).map(c => c.name.trim()).join(', ') || 'None yet'],
                ['Markets', f.markets.map(m => meta.countries[m]).join(', ') || 'Global'], ['Questions', String(questions.length)],
                ['AI assistants', f.engines.map(e => ENGINES[e][0]).join(', ')], ['Schedule', FREQ[f.frequency]]].map(([k, v], i) => (
                <div key={k} className="grid grid-cols-[160px_1fr] gap-4 px-5 py-3" style={{ borderTop: i ? '1px solid var(--line)' : 0 }}><dt className="text-muted">{k}</dt><dd className="font-medium">{v}</dd></div>
              ))}
            </dl>
          </Step>}
          <div className="mt-5"><ErrorBox error={err} /></div>
          <div className="mt-6 flex justify-between">
            <button className="btn-ghost" disabled={step === 0 || busy} onClick={() => { setErr(null); setStep(s => s - 1); }}>Back</button>
            {step < STEPS.length - 1 ? <button className="btn-primary" onClick={next}>Continue</button>
              : <button className="btn-primary" disabled={busy} onClick={finish}>{busy ? 'Setting up…' : 'Finish setup'}</button>}
          </div>
        </main>
      </div>
    </div>
  );
}

const Step = ({ title, text, children }) => (
  <section className="rise">
    <h1 className="text-[28px] font-bold leading-tight tracking-display">{title}</h1>
    <p className="mb-6 mt-1.5 max-w-2xl text-[15px] text-muted">{text}</p>
    {children}
  </section>
);
