// Public website, shown at "/" to visitors who are not signed in and at "/website" to everyone.
// Its job is to make a brand owner curious ("does AI name us?") and send them to sign up, without giving the product
// away: the demo shows that the assistants answer, blurs WHO they name, and offers the unlock.
// Honest by design: no invented customers, quotes or numbers; the only figures are from named research.
// It has its own look (the .hz styles in styles.css), independent of the app's theme.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import {
  ArrowRight, Check, ChevronDown, Lock, Menu, X, Send, Search, BookOpenCheck, Hammer, Quote, GitCompareArrows, Users,
  Landmark, Smartphone, Dice5, Briefcase, ShieldCheck, Sparkles,
} from 'lucide-react';
import { api } from '../lib.js';
import { Logo, EASE } from '../motion.jsx';
import { LegalLinks } from './Legal.jsx';

// Official logos (web/public/logos/README.txt): only to say which assistants we track; same size, unaltered, trademark note below.
const ENGINES = [
  { name: 'ChatGPT', by: 'OpenAI', logo: '/logos/chatgpt.svg' }, { name: 'Gemini', by: 'Google', logo: '/logos/gemini.svg' },
  { name: 'Perplexity', by: 'Perplexity', logo: '/logos/perplexity.svg' }, { name: 'Claude', by: 'Anthropic', logo: '/logos/claude.svg' },
];
const QUESTIONS = [
  'What is the best app to get paid in dollars as a freelancer?', 'Which smart ring is best for sleep tracking?',
  'What are the best food delivery apps in Helsinki?', 'Is this bank safe to keep my savings in?',
  'Which CRM should a 10-person startup use?', 'Best online casino with fast payouts?', 'Which project management tool do agencies use?',
];
const SIGNUP = '/onboarding';

const Reveal = ({ children, delay = 0, className = '' }) => (
  <motion.div className={className} initial={{ opacity: 0, y: 22 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ duration: 0.6, ease: EASE, delay }}>
    {children}
  </motion.div>
);
const Section = ({ id, children, className = '' }) => <section id={id} className={`mx-auto max-w-6xl scroll-mt-24 px-4 sm:px-6 ${className}`}>{children}</section>;
const Heading = ({ eyebrow, title, sub, align = 'center' }) => (
  <Reveal className={`mb-12 max-w-2xl ${align === 'center' ? 'mx-auto text-center' : ''}`}>
    <div className="hz-eyebrow mb-3">{eyebrow}</div>
    <h2 className="text-[32px] font-extrabold leading-[1.05] tracking-[-0.035em] sm:text-[46px]">{title}</h2>
    {sub && <p className="mt-4 text-[17px] leading-relaxed" style={{ color: 'var(--hz-ink2)' }}>{sub}</p>}
  </Reveal>
);

export default function Home({ signedIn }) {
  return (
    <div className="hz min-h-screen overflow-x-clip">
      <Header signedIn={signedIn} />
      <Hero />
      <Engines />
      <Marquee />
      <Why />
      <HowItWorks />
      <Peek />
      <Different />
      <WhoFor />
      <Faq />
      <CtaBand />
      <Contact />
      <Footer signedIn={signedIn} />
    </div>
  );
}

function Header({ signedIn }) {
  const [open, setOpen] = useState(false);
  const links = [['#how', 'How it works'], ['#why', 'Why now'], ['#who', 'Who it is for'], ['#faq', 'FAQ']];
  return (
    <header className="sticky top-0 z-40" style={{ background: 'rgba(10,11,15,.7)', backdropFilter: 'blur(16px)', borderBottom: '1px solid var(--hz-line)' }}>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="#top" className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.025em]"><Logo size={28} />Housedge</a>
        <nav className="hidden items-center gap-7 text-[14px] md:flex" style={{ color: 'var(--hz-ink2)' }}>
          {links.map(([h, l]) => <a key={h} href={h} className="transition-colors hover:text-white">{l}</a>)}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <Link to={signedIn ? '/' : '/login'} className="hz-btn hz-ghost !py-2 !text-[14px]">{signedIn ? 'Open the app' : 'Sign in'}</Link>
          <Link to={SIGNUP} className="hz-btn hz-primary !py-2 !text-[14px]">Get my snapshot</Link>
        </div>
        <button className="md:hidden" onClick={() => setOpen(o => !o)} aria-label={open ? 'Close menu' : 'Open menu'}>{open ? <X size={22} /> : <Menu size={22} />}</button>
      </div>
      {open && (
        <div className="px-4 pb-5 md:hidden" style={{ borderTop: '1px solid var(--hz-line)' }}>
          {links.map(([h, l]) => <a key={h} href={h} onClick={() => setOpen(false)} className="block py-2.5 text-[15px]">{l}</a>)}
          <div className="mt-3 flex gap-2">
            <Link to={signedIn ? '/' : '/login'} className="hz-btn hz-ghost flex-1">{signedIn ? 'Open the app' : 'Sign in'}</Link>
            <Link to={SIGNUP} className="hz-btn hz-primary flex-1">Get my snapshot</Link>
          </div>
        </div>
      )}
    </header>
  );
}

function Hero() {
  return (
    <div id="top" className="relative overflow-hidden">
      <div className="hz-grid absolute inset-0" aria-hidden />
      <div className="hz-orb" style={{ width: 520, height: 520, top: -180, left: '50%', marginLeft: -560, background: 'var(--hz-accent)', opacity: .22 }} aria-hidden />
      <div className="hz-orb" style={{ width: 460, height: 460, top: -120, right: -140, background: 'var(--hz-cyan)', opacity: .16, animationDelay: '-9s' }} aria-hidden />
      <Section className="relative pb-20 pt-20 text-center sm:pt-28">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }}>
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px]" style={{ background: 'rgba(255,255,255,.06)', border: '1px solid var(--hz-line)', color: 'var(--hz-ink2)' }}>
            <Sparkles size={14} style={{ color: 'var(--hz-accent)' }} />Your customers now ask AI before they ask Google
          </div>
          <h1 className="mx-auto max-w-4xl text-[42px] font-extrabold leading-[1.02] tracking-[-0.04em] sm:text-[72px]">
            Your customers ask AI.<br /><span className="hz-grad">Does it name you?</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed sm:text-[19px]" style={{ color: 'var(--hz-ink2)' }}>
            Every week, Housedge asks ChatGPT, Gemini, Perplexity and Claude the questions your customers ask, in your markets.
            It shows who they recommend, why, and what to change so the answer includes you.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link to={SIGNUP} className="hz-btn hz-primary !px-7 !py-3.5 !text-[16px]">Get my free snapshot <ArrowRight size={17} /></Link>
            <a href="#how" className="hz-btn hz-ghost !px-6 !py-3.5 !text-[16px]">See how it works</a>
          </div>
          <p className="mt-4 text-[13px]" style={{ color: 'var(--hz-muted)' }}>Takes a few minutes. We read your website and fill in the setup for you.</p>
        </motion.div>
        <motion.div className="mx-auto mt-16 max-w-3xl" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: EASE, delay: 0.25 }}>
          <LiveDemo />
        </motion.div>
      </Section>
    </div>
  );
}

// The teaser: a question is typed, the four assistants answer, and who they name is blurred behind the unlock.
function LiveDemo() {
  const reduce = useReducedMotion();
  const [qi, setQi] = useState(0);
  const [typed, setTyped] = useState(reduce ? QUESTIONS[0] : '');
  const [phase, setPhase] = useState(reduce ? 'answered' : 'typing'); // typing -> thinking -> answered -> (next question)
  useEffect(() => {
    if (reduce) return;
    const q = QUESTIONS[qi];
    let t;
    if (phase === 'typing') {
      if (typed.length < q.length) t = setTimeout(() => setTyped(q.slice(0, typed.length + 1)), 28 + Math.random() * 40);
      else t = setTimeout(() => setPhase('thinking'), 400);
    } else if (phase === 'thinking') t = setTimeout(() => setPhase('answered'), 1300);
    else t = setTimeout(() => { setTyped(''); setQi(i => (i + 1) % QUESTIONS.length); setPhase('typing'); }, 6500);
    return () => clearTimeout(t);
  }, [phase, typed, qi, reduce]);
  const rows = [
    { e: ENGINES[0], widths: [52, 36, 44], you: false }, { e: ENGINES[1], widths: [40, 58, 30], you: true },
    { e: ENGINES[2], widths: [48, 34, 52], you: false }, { e: ENGINES[3], widths: [38, 46, 42], you: false },
  ];
  return (
    <div className="hz-card hz-ring overflow-hidden text-left">
      <div className="flex items-center gap-2 px-5 py-3 text-[12px]" style={{ borderBottom: '1px solid var(--hz-line)', color: 'var(--hz-muted)' }}>
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#ff5f57' }} /><span className="h-2.5 w-2.5 rounded-full" style={{ background: '#febc2e' }} /><span className="h-2.5 w-2.5 rounded-full" style={{ background: '#28c840' }} />
        <span className="ml-2">A question your customer asks · this week</span>
      </div>
      <div className="px-5 py-5 sm:px-7">
        <div className="flex items-start gap-3">
          <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,.08)' }}><Search size={15} /></span>
          <p className="min-h-[2.2em] text-[17px] font-medium leading-snug sm:text-[20px]">{typed}{phase === 'typing' && !reduce && <span className="hz-caret" />}</p>
        </div>
        <div className="relative mt-5 grid gap-2.5">
          {rows.map(({ e, widths, you }, i) => (
            <motion.div key={e.name} className="flex items-center gap-3 rounded-xl px-3.5 py-3" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid var(--hz-line)' }}
              initial={false} animate={{ opacity: phase === 'typing' ? 0.35 : 1 }} transition={{ duration: 0.4, delay: phase === 'answered' ? i * 0.12 : 0 }}>
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white"><img src={e.logo} alt="" width="16" height="16" /></span>
              <span className="w-[86px] shrink-0 text-[13px] font-semibold">{e.name}</span>
              <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px]" style={{ color: 'var(--hz-ink2)' }}>
                {phase === 'answered' ? <>
                  <span className="hidden sm:inline">recommends</span>
                  {widths.map((w, j) => <span key={j} className="hz-redact" style={{ width: w + 12, opacity: 1 - j * 0.22 }} />)}
                </> : phase === 'thinking' ? <span className="hz-dots"><span /><span /><span /></span> : <span className="opacity-40">waiting for the question…</span>}
              </span>
              {phase === 'answered' && (
                <motion.span initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 + i * 0.12 }}
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={you ? { background: 'rgba(201,245,79,.15)', color: 'var(--hz-accent)' } : { background: 'rgba(255,107,107,.15)', color: 'var(--hz-bad)' }}>
                  {you ? 'you · #3' : 'you · not named'}
                </motion.span>
              )}
            </motion.div>
          ))}
          <motion.div className="hz-lock absolute inset-x-0 -bottom-5 top-[42%] flex items-end justify-center rounded-b-xl pb-1" initial={false} animate={{ opacity: phase === 'answered' ? 1 : 0 }} transition={{ delay: 0.9 }} style={{ pointerEvents: phase === 'answered' ? 'auto' : 'none' }}>
            <Link to={SIGNUP} className="hz-btn hz-primary !py-2.5 !text-[14px]"><Lock size={14} />See who AI names instead of you</Link>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function Engines() {
  return (
    <Section className="pb-6 pt-4">
      <Reveal className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-10">
        <span className="text-[13px]" style={{ color: 'var(--hz-muted)' }}>We ask the assistants your customers use</span>
        <div className="flex flex-wrap items-center justify-center gap-6">
          {ENGINES.map(e => (
            <span key={e.name} className="flex items-center gap-2 text-[14px] font-medium" style={{ color: 'var(--hz-ink2)' }}>
              <span className="grid h-7 w-7 place-items-center rounded-full bg-white"><img src={e.logo} alt="" width="16" height="16" /></span>{e.name}
            </span>
          ))}
        </div>
      </Reveal>
      <p className="mt-3 text-center text-[11px]" style={{ color: 'var(--hz-muted)' }}>ChatGPT, Gemini, Perplexity and Claude are trademarks of OpenAI, Google, Perplexity AI and Anthropic. Housedge is independent of all four.</p>
    </Section>
  );
}

function Marquee() {
  const items = [...QUESTIONS, ...QUESTIONS];
  return (
    <div className="relative mt-10 overflow-hidden py-5" style={{ borderTop: '1px solid var(--hz-line)', borderBottom: '1px solid var(--hz-line)' }}>
      <div className="hz-marquee">
        {items.map((q, i) => <span key={i} className="shrink-0 rounded-full px-4 py-2 text-[13px]" style={{ background: 'rgba(255,255,255,.05)', border: '1px solid var(--hz-line)', color: 'var(--hz-ink2)' }}>“{q}”</span>)}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24" style={{ background: 'linear-gradient(90deg, var(--hz-bg), transparent)' }} />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-24" style={{ background: 'linear-gradient(270deg, var(--hz-bg), transparent)' }} />
    </div>
  );
}

// Counts up when it scrolls into view.
function Stat({ value, suffix = '', label, source }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const reduce = useReducedMotion();
  const [n, setN] = useState(reduce ? value : 0);
  useEffect(() => {
    if (!inView || reduce) return;
    const t0 = performance.now(), ms = 1100;
    let raf;
    const tick = now => { const p = Math.min(1, (now - t0) / ms); setN(Math.round(value * (1 - Math.pow(1 - p, 3)) * 100) / 100); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, reduce]);
  return (
    <div ref={ref} className="hz-card hz-tilt p-6">
      <div className="text-[44px] font-extrabold leading-none tracking-[-0.04em]"><span className="hz-grad">{Number.isInteger(value) ? Math.round(n) : n.toFixed(2)}{suffix}</span></div>
      <div className="mt-3 text-[15px]" style={{ color: 'var(--hz-ink2)' }}>{label}</div>
      <div className="mt-2 text-[12px]" style={{ color: 'var(--hz-muted)' }}>{source}</div>
    </div>
  );
}

function Why() {
  return (
    <Section id="why" className="py-24">
      <Heading eyebrow="Why now" title="AI answers are the new first page. Most brands have never looked at theirs."
        sub="When someone asks an assistant what to buy, it names two or three options and the rest do not exist. Being one of them is earned, and it can be measured." />
      <div className="grid gap-4 md:grid-cols-3">
        <Reveal><Stat value={0.66} label="Correlation between brand mentions across the web and appearing in Google's AI answers. Backlinks matter far less." source="Ahrefs, 75,000 brands, 2025" /></Reveal>
        <Reveal delay={0.1}><Stat value={41} suffix="%" label="More visibility in AI answers for pages that quote sources. Statistics add 31%. Keyword stuffing loses 8%." source="Aggarwal et al., KDD 2024" /></Reveal>
        <Reveal delay={0.2}><Stat value={4} label="Assistants, each reading a different web. A brand can be a top pick in one and absent from another." source="Peec AI, 30M citations, 2026" /></Reveal>
      </div>
    </Section>
  );
}

function HowItWorks() {
  const steps = [
    { icon: Search, title: 'Ask', text: 'We ask the four assistants the questions your customers ask, in each of your markets, every week. Real answers, with the web searches behind them.' },
    { icon: BookOpenCheck, title: 'Read', text: 'Every answer is read the same way: which brands it recommends, in what order, in what tone, and which websites it relied on. Every finding comes with its proof.' },
    { icon: Hammer, title: 'Change the answer', text: 'You get the shortlist of what moves AI answers for you: the sites to be on, the facts to publish, the pages to fix. Then we measure what changed.' },
  ];
  return (
    <div style={{ background: 'var(--hz-bg2)', borderTop: '1px solid var(--hz-line)', borderBottom: '1px solid var(--hz-line)' }}>
      <Section id="how" className="py-24">
        <Heading eyebrow="How it works" title="Three steps. One number that goes up." sub="Share of answers that name you. Measured weekly, so progress is a chart, not an opinion." />
        <div className="grid gap-4 md:grid-cols-3">
          {steps.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.1}>
              <div className="hz-card hz-tilt h-full p-7">
                <div className="flex items-center justify-between">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl" style={{ background: 'rgba(201,245,79,.12)', color: 'var(--hz-accent)' }}><s.icon size={20} /></span>
                  <span className="text-[40px] font-extrabold leading-none tracking-[-0.04em]" style={{ color: 'rgba(255,255,255,.08)' }}>0{i + 1}</span>
                </div>
                <h3 className="mt-6 text-[22px] font-bold tracking-[-0.025em]">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed" style={{ color: 'var(--hz-ink2)' }}>{s.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>
    </div>
  );
}

// A glimpse of the dashboard: real layout, numbers blurred, one line readable. Enough to want it.
function Peek() {
  const bars = [['You', 0.38, true], ['Competitor A', 0.9, false], ['Competitor B', 0.74, false], ['Competitor C', 0.52, false]];
  return (
    <Section className="py-24">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <Reveal>
          <div className="hz-eyebrow mb-3">What you see</div>
          <h2 className="text-[32px] font-extrabold leading-[1.05] tracking-[-0.035em] sm:text-[44px]">Your brand, against the ones AI prefers.</h2>
          <ul className="mt-8 grid gap-4">
            {[['How often you are named', 'and how that compares with each competitor, per assistant and per market.'],
              ['The websites AI reads', 'to answer your customers, and which of them you are missing from.'],
              ['Why, with the proof', 'every finding is backed by the exact sentence from the answer.'],
              ['What to do first', 'a short list, in order of impact, measured before and after.']].map(([t, d]) => (
              <li key={t} className="flex gap-3 text-[15px]"><Check size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--hz-accent)' }} /><span><strong>{t}</strong> <span style={{ color: 'var(--hz-ink2)' }}>{d}</span></span></li>
            ))}
          </ul>
          <Link to={SIGNUP} className="hz-btn hz-primary mt-9">Show me mine <ArrowRight size={16} /></Link>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="hz-card hz-ring relative overflow-hidden p-5 sm:p-6">
            <div className="flex items-center justify-between text-[12px]" style={{ color: 'var(--hz-muted)' }}><span>Share of answers naming each brand · last 30 days</span><span>4 assistants · 2 markets</span></div>
            <div className="mt-5 grid gap-3">
              {bars.map(([name, w, you], i) => (
                <div key={name} className="flex items-center gap-3 text-[13px]">
                  <span className={`w-28 shrink-0 ${you ? 'font-semibold' : ''}`} style={you ? {} : { color: 'var(--hz-ink2)', filter: 'blur(3px)' }}>{name}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,.07)' }}>
                    <motion.div className="h-full rounded-full" style={{ background: you ? 'var(--hz-accent)' : 'rgba(255,255,255,.3)' }} initial={{ width: 0 }} whileInView={{ width: `${w * 100}%` }} viewport={{ once: true }} transition={{ duration: 1, ease: EASE, delay: 0.2 + i * 0.1 }} />
                  </div>
                  <span className="w-12 text-right tabular-nums" style={you ? {} : { filter: 'blur(4px)' }}>{Math.round(w * 100)}%</span>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-xl p-4 text-[13px]" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid var(--hz-line)' }}>
              <div className="flex items-center gap-2 font-semibold"><Quote size={14} style={{ color: 'var(--hz-accent)' }} />Proof behind a finding</div>
              <p className="mt-1.5 italic" style={{ color: 'var(--hz-ink2)' }}>“<span className="hz-redact" style={{ width: 90 }} /> is the most established option, while <span className="hz-redact" style={{ width: 70 }} /> is newer and cheaper…”</p>
            </div>
            <div className="hz-lock absolute inset-x-0 bottom-0 flex h-40 items-end justify-center pb-6">
              <Link to={SIGNUP} className="hz-btn hz-ghost !text-[14px]"><Lock size={14} />Unlock with your brand</Link>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

function Different() {
  const cards = [
    { icon: Quote, title: 'Proof, not scores', text: 'Every brand we find in an answer comes with the sentence that proves it. If the quote is not in the answer, the finding is thrown out.' },
    { icon: GitCompareArrows, title: 'Actions linked to results', text: 'Every action is dated and measured: how often AI named you in the 28 days before, and the 28 days after. You learn what actually works.' },
    { icon: Users, title: 'Done with you', text: 'A dashboard shows the gap. Our team closes it: the listings, the pages, the facts, the outreach. Then the numbers show whether it worked.' },
  ];
  return (
    <div style={{ background: 'var(--hz-bg2)', borderTop: '1px solid var(--hz-line)', borderBottom: '1px solid var(--hz-line)' }}>
      <Section className="py-24">
        <Heading eyebrow="Not another dashboard" title="Anyone can ask ChatGPT once. That is not the point." sub="One answer is a snapshot. Dozens of answers a week, read the same way, with the sources kept, is a measurement. And a measurement is something you can move." />
        <div className="grid gap-4 md:grid-cols-3">
          {cards.map((c, i) => (
            <Reveal key={c.title} delay={i * 0.1}>
              <div className="hz-card hz-tilt h-full p-7">
                <span className="grid h-11 w-11 place-items-center rounded-2xl" style={{ background: 'rgba(111,224,255,.12)', color: 'var(--hz-cyan)' }}><c.icon size={20} /></span>
                <h3 className="mt-5 text-[20px] font-bold tracking-[-0.025em]">{c.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed" style={{ color: 'var(--hz-ink2)' }}>{c.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>
    </div>
  );
}

function WhoFor() {
  const who = [
    { icon: Landmark, title: 'Fintech and money apps', text: '“Is it safe?” and “which app pays faster?” are asked to AI first. A missing licence line or review page costs you the answer.' },
    { icon: Smartphone, title: 'Consumer apps and brands', text: 'Comparison questions, in every market you sell in. Different assistants, different answers, one measurement.' },
    { icon: Dice5, title: 'Regulated industries', text: 'iGaming, health, finance: only honest, compliant actions, with the evidence to show your compliance team.' },
    { icon: Briefcase, title: 'Agencies', text: 'Track your clients, show proof, and give them a monthly report that is a chart instead of a slide.' },
  ];
  return (
    <Section id="who" className="py-24">
      <Heading eyebrow="Who it is for" title="Built for brands people ask AI about." />
      <div className="grid gap-4 sm:grid-cols-2">
        {who.map((w, i) => (
          <Reveal key={w.title} delay={i * 0.07}>
            <div className="hz-card hz-tilt flex h-full gap-4 p-6">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: 'rgba(255,255,255,.06)' }}><w.icon size={20} /></span>
              <div><h3 className="text-[18px] font-bold tracking-[-0.02em]">{w.title}</h3><p className="mt-1.5 text-[14px] leading-relaxed" style={{ color: 'var(--hz-ink2)' }}>{w.text}</p></div>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

function Faq() {
  const [open, setOpen] = useState(0);
  const qa = [
    ['Is this just SEO?', 'No. Search ranks pages; assistants write one answer and name a few brands. Being named depends on what the web says about you across many sites, how clearly your facts are published, and whether the assistant can verify you. Different levers, different measurement.'],
    ['Do you change AI answers directly?', 'Nobody can. We change what AI reads: the comparison pages you are on, the facts on your site, the reviews and communities where you are discussed. Then we measure whether the answers moved.'],
    ['What do I get in the free snapshot?', 'Your brand against your competitors on the questions your customers ask, across the four assistants, in your markets, with the first actions worth taking. Set-up takes a few minutes: we read your website and fill it in for you.'],
    ['Where is my data kept?', 'In the EU. Every client only ever sees its own data, enforced by the database itself, and we never use your data to train anything.'],
    ['Is it honest?', 'Yes. No paid or fake reviews, no anonymous posts, no promises of rankings. Every number comes with its evidence, and every action we suggest is one you could show to a regulator.'],
  ];
  return (
    <div style={{ background: 'var(--hz-bg2)', borderTop: '1px solid var(--hz-line)', borderBottom: '1px solid var(--hz-line)' }}>
      <Section id="faq" className="py-24">
        <Heading eyebrow="FAQ" title="Questions people ask us." />
        <div className="mx-auto max-w-3xl">
          {qa.map(([q, a], i) => (
            <Reveal key={q} delay={i * 0.04}>
              <div style={{ borderBottom: '1px solid var(--hz-line)' }}>
                <button className="flex w-full items-center justify-between gap-4 py-5 text-left text-[17px] font-semibold" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
                  {q}<ChevronDown size={18} className={`shrink-0 transition-transform ${open === i ? 'rotate-180' : ''}`} style={{ color: 'var(--hz-muted)' }} />
                </button>
                <motion.div initial={false} animate={{ height: open === i ? 'auto' : 0, opacity: open === i ? 1 : 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                  <p className="pb-5 text-[15px] leading-relaxed" style={{ color: 'var(--hz-ink2)' }}>{a}</p>
                </motion.div>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>
    </div>
  );
}

function CtaBand() {
  return (
    <Section className="py-24">
      <Reveal>
        <div className="hz-card relative overflow-hidden p-10 text-center sm:p-16" style={{ background: 'linear-gradient(135deg, rgba(201,245,79,.14), rgba(111,224,255,.08))' }}>
          <div className="hz-orb" style={{ width: 360, height: 360, top: -160, right: -100, background: 'var(--hz-accent)', opacity: .18 }} aria-hidden />
          <h2 className="relative text-[32px] font-extrabold leading-[1.05] tracking-[-0.035em] sm:text-[48px]">See what AI says about you this week.</h2>
          <p className="relative mx-auto mt-4 max-w-xl text-[17px]" style={{ color: 'var(--hz-ink2)' }}>Your first snapshot is free. If you like what you learn, we do the work to change it.</p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Link to={SIGNUP} className="hz-btn hz-primary !px-7 !py-3.5 !text-[16px]">Get my free snapshot <ArrowRight size={17} /></Link>
            <a href="#contact" className="hz-btn hz-ghost !px-6 !py-3.5 !text-[16px]">Talk to us</a>
          </div>
          <p className="relative mt-5 flex items-center justify-center gap-1.5 text-[13px]" style={{ color: 'var(--hz-muted)' }}><ShieldCheck size={14} />Data kept in the EU. No card needed.</p>
        </div>
      </Reveal>
    </Section>
  );
}

const Field = ({ id, label, children }) => <div><label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--hz-ink2)' }} htmlFor={id}>{label}</label>{children}</div>;

function Contact() {
  const [f, setF] = useState({ name: '', email: '', company: '', role: '', markets: '', message: '', consent: false, website: '' });
  const [state, setState] = useState({ busy: false, done: false, error: '' });
  const set = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = async e => {
    e.preventDefault();
    setState({ busy: true, done: false, error: '' });
    try { await api('/enquiries/new', { method: 'POST', body: f }); setState({ busy: false, done: true, error: '' }); }
    catch (err) { setState({ busy: false, done: false, error: err.message }); }
  };
  return (
    <div style={{ background: 'var(--hz-bg2)', borderTop: '1px solid var(--hz-line)' }}>
      <Section id="contact" className="py-24">
        <div className="grid gap-12 lg:grid-cols-2">
          <Reveal>
            <div className="hz-eyebrow mb-3">Prefer to talk first?</div>
            <h2 className="text-[32px] font-extrabold leading-[1.05] tracking-[-0.035em] sm:text-[44px]">Tell us about your brand.</h2>
            <p className="mt-4 text-[17px] leading-relaxed" style={{ color: 'var(--hz-ink2)' }}>We will come back with a short call and a first look at what AI says about you in your markets.</p>
            <ul className="mt-8 grid gap-3 text-[15px]" style={{ color: 'var(--hz-ink2)' }}>
              {['Your brand against your main competitors', 'Four assistants, your markets, real answers', 'The first actions worth taking'].map(t => <li key={t} className="flex gap-2.5"><Check size={17} className="mt-0.5 shrink-0" style={{ color: 'var(--hz-accent)' }} />{t}</li>)}
            </ul>
          </Reveal>
          <Reveal delay={0.1}>
            {state.done ? (
              <div className="hz-card grid min-h-[420px] place-items-center p-8 text-center">
                <div>
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 15 }} className="mx-auto grid h-14 w-14 place-items-center rounded-full" style={{ background: 'var(--hz-accent)', color: 'var(--hz-accent-ink)' }}><Check size={28} /></motion.div>
                  <h3 className="mt-5 text-[22px] font-bold tracking-[-0.025em]">Thank you, {f.name.split(' ')[0]}.</h3>
                  <p className="mt-2" style={{ color: 'var(--hz-ink2)' }}>We have your message and will get back to you at {f.email}.</p>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="hz-card grid gap-4 p-6 sm:p-8">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="c-name" label="Your name"><input id="c-name" className="hz-input" required value={f.name} onChange={set('name')} autoComplete="name" /></Field>
                  <Field id="c-email" label="Work email"><input id="c-email" type="email" className="hz-input" required value={f.email} onChange={set('email')} autoComplete="email" /></Field>
                  <Field id="c-company" label="Company"><input id="c-company" className="hz-input" required value={f.company} onChange={set('company')} autoComplete="organization" /></Field>
                  <Field id="c-role" label="You are"><select id="c-role" className="hz-input" value={f.role} onChange={set('role')}><option value="">Choose…</option>{['Brand / company', 'Agency', 'iGaming operator', 'iGaming supplier', 'Other'].map(r => <option key={r}>{r}</option>)}</select></Field>
                </div>
                <Field id="c-markets" label="Markets you care about"><input id="c-markets" className="hz-input" placeholder="e.g. Finland, Pakistan" value={f.markets} onChange={set('markets')} /></Field>
                <Field id="c-msg" label="Anything else? (optional)"><textarea id="c-msg" rows={3} className="hz-input" value={f.message} onChange={set('message')} /></Field>
                {/* Hidden from people; bots fill it in and get ignored. */}
                <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label></div>
                <label className="flex items-start gap-2.5 text-[13px]" style={{ color: 'var(--hz-ink2)' }}>
                  <input type="checkbox" className="mt-0.5 h-4 w-4" style={{ accentColor: 'var(--hz-accent)' }} checked={f.consent} onChange={set('consent')} required />
                  <span>I agree that you store these details to answer my enquiry, as described in the <Link to="/privacy" className="underline" style={{ color: 'var(--hz-accent)' }}>privacy policy</Link>.</span>
                </label>
                {state.error && <div className="rounded-xl px-3 py-2 text-[13px]" style={{ background: 'rgba(255,107,107,.12)', color: 'var(--hz-bad)' }}>{state.error}</div>}
                <button className="hz-btn hz-primary !py-3" disabled={state.busy}>{state.busy ? 'Sending…' : <>Send <Send size={15} /></>}</button>
              </form>
            )}
          </Reveal>
        </div>
      </Section>
    </div>
  );
}

function Footer({ signedIn }) {
  return (
    <footer style={{ borderTop: '1px solid var(--hz-line)' }}>
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-10 sm:flex-row sm:px-6">
        <div className="flex items-center gap-2.5 text-[13px]" style={{ color: 'var(--hz-ink2)' }}><Logo size={22} /><span><strong style={{ color: 'var(--hz-ink)' }}>Housedge.</strong> See what AI says. Change it. Prove it.</span></div>
        <div className="flex items-center gap-5 text-[13px]" style={{ color: 'var(--hz-ink2)' }}>
          <Link to={signedIn ? '/' : '/login'} className="hover:text-white">{signedIn ? 'Open the app' : 'Sign in'}</Link>
          <Link to={SIGNUP} className="hover:text-white">Get a snapshot</Link>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 pb-10 text-[12px] sm:px-6" style={{ color: 'var(--hz-muted)' }}><LegalLinks /></div>
    </footer>
  );
}
