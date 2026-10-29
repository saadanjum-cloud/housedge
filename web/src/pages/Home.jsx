// Public website, shown at "/" to visitors who are not signed in and at "/website" to everyone.
// Its job is to make a brand owner curious ("does AI name us?") and send them to sign up, without giving the product
// away: the answers are real-looking but the brands in them are redacted, and the unlock is the sign-up.
// Honest by design: no invented customers, quotes or numbers; sample artefacts are labelled as samples, and the only
// figures are from named research.
// Look: the Evergreen brand colours on dark, Figtree, white "printed" answer slips that we mark up, the assistants'
// own logos (web/public/logos/README.txt), and animated objects (a receipt that prints, a ranking that reorders, a
// to-do list that ticks itself) instead of pictures. The two photos are black and white with grain, and show no faces.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, animate, motion, useInView, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import '@fontsource-variable/figtree/wght-italic.css';
import { api } from '../lib.js';
import { EASE, Logo } from '../motion.jsx';
import { LegalLinks } from './Legal.jsx';

const SIGNUP = '/onboarding';
const ENGINES = ['ChatGPT', 'Gemini', 'Perplexity', 'Claude'];
const LOGO = { ChatGPT: '/logos/chatgpt.svg', Gemini: '/logos/gemini.svg', Perplexity: '/logos/perplexity.svg', Claude: '/logos/claude.svg' };
const QUESTIONS = [
  'best app to get paid in dollars as a freelancer?', 'which smart ring is best for sleep tracking?', 'best food delivery app in Helsinki?',
  'is this bank safe for my savings?', 'which CRM should a 10-person startup use?', 'cheapest way to send money to Lagos?',
  'which broker is FCA regulated?', 'best budgeting app for couples?', 'which project tool do agencies use?', 'online casino with fast payouts?',
];

// ---------- small pieces ----------
const Reveal = ({ children, delay = 0, className = '', y = 24 }) => (
  <motion.div className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.15 }} transition={{ duration: 0.55, ease: EASE, delay }}>
    {children}
  </motion.div>
);
const Wrap = ({ id, children, className = '' }) => <section id={id} className={`mx-auto max-w-[1240px] scroll-mt-20 px-5 sm:px-8 ${className}`}>{children}</section>;
const Label = ({ children, className = '', color = 'var(--hz-muted)' }) => <div className={`hz-label ${className}`} style={{ color }}>{children}</div>;
const Arrow = () => <span className="hz-arrow" aria-hidden>→</span>;
const Kicker = ({ n, children }) => <Label color="var(--hz-accent)">{n} — {children}</Label>;
const Engine = ({ name, size = 26 }) => (
  <span className="hz-engine" style={{ width: size, height: size }}><img src={LOGO[name]} alt={name} width={size * 0.58} height={size * 0.58} /></span>
);

// The Housedge mark: its bubbles pop in when it scrolls into view, then it floats gently; it spins a little on hover.
function LiveLogo({ size = 32, className = '' }) {
  const ref = useRef(null);
  const on = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  return (
    <motion.span ref={ref} className={`inline-block align-middle ${reduce ? '' : 'hz-float'} ${className}`} style={{ width: size, height: size }} whileHover={{ rotate: 25, scale: 1.08 }}>
      {on && <Logo size={size} draw />}
    </motion.span>
  );
}
// A rubber stamp that thumps onto a slip once the answer has been read.
const Stamp = ({ show }) => (
  <AnimatePresence>
    {show && (
      <motion.div className="absolute -right-3 -top-5 flex rotate-[-10deg] items-center gap-2 rounded-[6px] border-2 bg-white px-2.5 py-1.5" style={{ borderColor: '#0f7a4c', color: '#0f7a4c' }}
        initial={{ scale: 1.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 520, damping: 18 }} aria-hidden>
        <Logo size={20} /><span className="text-[10px] font-bold leading-tight tracking-[.12em]">READ &amp; KEPT<br />BY HOUSEDGE</span>
      </motion.div>
    )}
  </AnimatePresence>
);

function Mark({ children }) {
  const ref = useRef(null);
  const on = useInView(ref, { once: true, margin: '-15% 0px' });
  return <span ref={ref} className={`hz-mark ${on ? 'on' : ''}`}>{children}</span>;
}
// A hand-drawn loop around a word, drawn after the headline lands.
function Circled({ children, delay = 0.6 }) {
  return (
    <span className="relative inline-block">
      {children}
      <svg className="pointer-events-none absolute -left-[14%] -top-[8%] h-[122%] w-[128%] overflow-visible" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden>
        <motion.path d="M150 14C110 2 40 6 16 32 -4 56 30 92 100 94 170 96 202 66 190 38 180 16 140 8 96 12" fill="none" stroke="var(--hz-accent)" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: 'easeInOut', delay }} />
      </svg>
    </span>
  );
}
const Underline = ({ show }) => (
  <svg className="pointer-events-none absolute -bottom-2 left-0 h-3 w-full overflow-visible" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden>
    <motion.path d="M2 6C25 3 60 8 98 4" fill="none" stroke="var(--hz-accent)" strokeWidth="2.4" strokeLinecap="round" vectorEffect="non-scaling-stroke"
      initial={false} animate={{ pathLength: show ? 1 : 0, opacity: show ? 1 : 0 }} transition={{ duration: 0.45, ease: 'easeOut' }} />
  </svg>
);
// A brand we will not name: a solid bar the width of a word.
const Redact = ({ w = 4 }) => <span className="hz-redact" style={{ width: `${w * 0.62}em` }} role="img" aria-label="hidden brand" />;
// Sample text: {n} is a redacted brand of n letters, *…* is highlighted.
const marked = text => text.split(/(\{\d+\}|\*[^*]+\*)/).filter(Boolean).map((t, i) =>
  /^\{/.test(t) ? <Redact key={i} w={+t.slice(1, -1)} /> : t.startsWith('*') ? <span key={i} className="hz-mark on">{marked(t.slice(1, -1))}</span> : t);
// Counts up to `to` once visible.
function Count({ to, from = 0, decimals = 0, duration = 1, delay = 0, start = true }) {
  const reduce = useReducedMotion();
  const [n, setN] = useState(reduce ? to : from);
  useEffect(() => {
    if (!start || reduce) return;
    const c = animate(from, to, { duration, delay, ease: EASE, onUpdate: setN });
    return () => c.stop();
  }, [start, reduce, from, to, duration, delay]);
  return <>{n.toFixed(decimals)}</>;
}

// Parallax costs work on every scroll frame; phones and tablets get still photos.
const DESKTOP = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px) and (pointer: fine)').matches;
function Photo({ name, alt, className = '', speed = 0, eager = false }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const still = reduce || !speed || !DESKTOP;
  const y = useTransform(scrollYProgress, [0, 1], still ? ['0%', '0%'] : [`${-speed}%`, `${speed}%`]);
  return (
    <div ref={ref} className={`hz-photo ${className}`}>
      <motion.img src={`/photos/${name}.webp`} alt={alt} loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : 'auto'} decoding="async" style={{ y, scale: still ? 1 : 1.14 }} />
    </div>
  );
}

export default function Home({ signedIn }) {
  return (
    <div className="hz min-h-screen overflow-x-clip">
      <Header signedIn={signedIn} />
      <Hero />
      <Ticker />
      {[Statement, WhoAsks, FourAnswers, WhyNow, Ledger, Different, WhoFor, Faq, CtaPhoto, Contact].map((Section, i) => <Later key={i} i={i}><Section /></Later>)}
      <Later i={10}><Footer signedIn={signedIn} /></Later>
    </div>
  );
}

// Renders its section shortly after the first screen is drawn, one section per task (no long freeze on phones).
function Later({ i, children }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), 120 + i * 30); return () => clearTimeout(t); }, [i]);
  return on ? children : <div style={{ height: '100vh' }} aria-hidden />;
}

// ---------- header ----------
function Header({ signedIn }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on(); window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const links = [['#how', 'How it works'], ['#who', 'Who it is for'], ['#faq', 'Questions']];
  const solid = scrolled || open;
  return (
    <header className="sticky top-0 z-50 transition-colors duration-300" style={{ background: solid ? '#f5f7f3' : 'transparent', borderBottom: `1px solid ${solid ? 'var(--hz-rule)' : 'transparent'}` }}>
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-5 sm:px-8">
        <Link to="/website" className="hz-display flex items-center gap-2.5 text-[22px] leading-none" aria-label="Housedge home">
          <motion.span whileHover={{ rotate: 25, scale: 1.08 }} className="inline-block"><Logo size={30} draw /></motion.span>Housedge
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          {links.map(([h, t]) => <a key={h} href={h} className="hz-label transition-colors hover:!text-[var(--hz-accent)]" style={{ color: 'var(--hz-ink2)' }}>{t}</a>)}
        </nav>
        <div className="hidden items-center gap-6 md:flex">
          <Link to={signedIn ? '/' : '/login'} className="hz-link text-[15px] font-medium">{signedIn ? 'Open the app' : 'Sign in'}</Link>
          <Link to={SIGNUP} className="hz-btn hz-primary !py-2.5 !text-[14px]">Get my snapshot <Arrow /></Link>
        </div>
        <button className="hz-label md:hidden" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="hz-menu">{open ? 'Close ×' : 'Menu +'}</button>
      </div>
      {open && (
        <div id="hz-menu" className="border-t px-5 pb-6 md:hidden hz-rule">
          {links.map(([h, t]) => <a key={h} href={h} onClick={() => setOpen(false)} className="hz-display block border-b py-4 text-[26px] hz-rule">{t}</a>)}
          <div className="mt-5 flex items-center gap-5">
            <Link to={SIGNUP} className="hz-btn hz-primary flex-1">Get my snapshot <Arrow /></Link>
            <Link to={signedIn ? '/' : '/login'} className="hz-link font-medium">{signedIn ? 'Open the app' : 'Sign in'}</Link>
          </div>
        </div>
      )}
    </header>
  );
}

// ---------- hero ----------
const SAMPLES = [
  { engine: 'ChatGPT', q: 'What is the best app to get paid in dollars as a freelancer?',
    a: 'Most freelancers use {6}, {7} or {5}. *{6} is usually recommended first because reviewers mention its low fees and fast payouts.* {5} is popular in the US.', named: false },
  { engine: 'Perplexity', q: 'Which smart ring is best for sleep tracking?',
    a: 'The most accurate options are {4}, {7} and yours. *Sleep researchers cite {4} most often, and it leads most independent comparisons.* Yours costs less.', named: true },
  { engine: 'Gemini', q: 'What are the best food delivery apps in Helsinki?',
    a: 'In Helsinki, {5} and {4} cover most restaurants. *{5} is the usual pick because more local restaurants list on it.* {7} is newer.', named: false },
];
// Types an answer out; a redacted brand counts as one character, highlights keep their marker.
function Typed({ text, start, onDone, speed = 75 }) {
  const reduce = useReducedMotion();
  const tokens = text.split(/(\{\d+\}|\*)/).filter(Boolean);
  const total = tokens.reduce((s, t) => s + (/^\{/.test(t) ? 1 : t === '*' ? 0 : t.length), 0);
  const [n, setN] = useState(reduce ? total : 0);
  useEffect(() => {
    if (!start) return;
    if (reduce) { setN(total); onDone?.(); return; }
    setN(0);
    const c = animate(0, total, { duration: total / speed, ease: 'linear', onUpdate: v => setN(Math.floor(v)), onComplete: () => onDone?.() });
    return () => c.stop();
  }, [text, start]); // eslint-disable-line react-hooks/exhaustive-deps
  let left = n, inMark = false;
  const out = [];
  tokens.forEach((t, i) => {
    if (t === '*') { inMark = !inMark; return; }
    if (left <= 0) return;
    let node;
    if (/^\{/.test(t)) { node = <Redact key={i} w={+t.slice(1, -1)} />; left -= 1; }
    else { node = <span key={i}>{t.slice(0, left)}</span>; left -= t.length; }
    out.push(inMark ? <span key={`m${i}`} className="hz-mark on">{node}</span> : node);
  });
  return <>{out}{n < total && <span className="hz-caret" aria-hidden />}</>;
}

function AnswerSlip() {
  const [i, setI] = useState(0);
  const [done, setDone] = useState(false);
  const ref = useRef(null);
  const visible = useInView(ref, { margin: '-10% 0px' });
  const s = SAMPLES[i];
  useEffect(() => {
    if (!done || !visible) return;
    const t = setTimeout(() => { setDone(false); setI(v => (v + 1) % SAMPLES.length); }, 4200);
    return () => clearTimeout(t);
  }, [done, visible]);
  return (
    <div ref={ref} className="hz-slip hz-light relative w-full max-w-[460px] -rotate-[1.2deg] p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2"><Engine name={s.engine} size={24} /><Label color="var(--hz-ink)">{s.engine} · answer kept</Label></span>
        <Label>Sample</Label>
      </div>
      <p className="mt-4 text-[21px] font-medium italic leading-snug tracking-[-0.02em]">“{s.q}”</p>
      <p className="mt-3 min-h-[128px] text-[15px] leading-[1.65]" style={{ color: 'var(--hz-ink2)' }}><Typed text={s.a} start={visible} onDone={() => setDone(true)} /></p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-dashed pt-3 hz-rule">
        <span className="hz-label" style={{ color: s.named ? 'var(--hz-good)' : 'var(--hz-bad)' }}>{s.named ? '● Your brand: named third' : '✗ Your brand: not named'}</span>
        <Link to={SIGNUP} className="hz-label hz-link" style={{ color: 'var(--hz-ink)' }}>Who are the others? ↗</Link>
      </div>
      <Stamp show={done} />
      <div className="absolute -right-4 top-[44%] hidden translate-x-full rotate-[4deg] xl:block" aria-hidden>
        <span className="block w-[150px] text-[16px] font-medium italic leading-tight" style={{ color: 'var(--hz-accent)' }}>← this sentence decides who gets named</span>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <Wrap className="pb-16 pt-10 sm:pt-16">
      <div className="grid items-start gap-12 lg:grid-cols-12">
        <div className="lg:col-span-7 lg:pt-20">
          <Label color="var(--hz-accent)" className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--hz-accent)' }} />The new word of mouth</Label>
          <h1 className="hz-display mt-6 text-[clamp(46px,6.4vw,96px)] leading-[0.98]">
            Your customers ask AI. <span className="block">Does it name <Circled delay={0.6}><em>you</em></Circled>?</span>
          </h1>
          <div>
            <p className="mt-8 max-w-[560px] text-[19px] leading-[1.55]" style={{ color: 'var(--hz-ink2)' }}>
              Every week Housedge asks ChatGPT, Gemini, Perplexity and Claude the questions your customers ask, keeps every answer, and shows you who gets recommended, why, and what to change.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-6">
              <Link to={SIGNUP} className="hz-btn hz-primary !px-7 !py-4 !text-[16px]">Get my free snapshot <Arrow /></Link>
              <a href="#answers" className="hz-link text-[16px] font-medium">See four answers ↓</a>
            </div>
            <Label className="mt-6">Free · set up in minutes · data kept in the EU</Label>
          </div>
        </div>
        <div className="relative lg:col-span-5">
          <Photo name="hands-phone-hoehne" alt="Hands holding a phone" className="ml-auto aspect-[4/5] w-[86%] rounded-[6px] sm:w-[66%] lg:w-[88%]" speed={6} eager />
          <motion.div className="relative z-10 -mt-[36%] sm:-mt-[26%] lg:-ml-[16%]" initial={{ opacity: 0, y: 40, rotate: 2 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ duration: 0.9, ease: EASE, delay: 0.5 }}>
            <AnswerSlip />
          </motion.div>
        </div>
      </div>
      {/* The assistants we read. Logos per web/public/logos/README.txt: same small size, with the trademark note under them. */}
      <Reveal delay={0.4} className="mt-20 border-t pt-6 hz-rule">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <span className="flex items-center gap-2.5"><LiveLogo size={28} /><Label color="var(--hz-ink)">Housedge reads the answers of</Label></span>
          {ENGINES.map(e => <span key={e} className="flex items-center gap-2.5 text-[15px] font-medium"><Engine name={e} size={28} />{e}</span>)}
        </div>
        <p className="mt-3 text-[11px]" style={{ color: 'var(--hz-muted)' }}>ChatGPT, Gemini, Perplexity and Claude are trademarks of OpenAI, Google, Perplexity AI and Anthropic. Housedge is independent of all four.</p>
      </Reveal>
    </Wrap>
  );
}

// ---------- ticker of questions ----------
function Ticker() {
  const ref = useRef(null);
  const live = useInView(ref);
  const row = (list, rev) => (
    <div className="hz-ticker-wrap hz-fade-x overflow-hidden">
      <div className={`hz-ticker ${rev ? 'rev' : ''} ${live ? '' : 'paused'}`}>
        {[...list, ...list].map((q, i) => (
          <span key={i} className="flex shrink-0 items-center whitespace-nowrap pl-10 text-[26px] font-medium italic tracking-[-0.03em] sm:text-[34px]">
            “{q}”<span className="ml-10 not-italic opacity-90"><Engine name={ENGINES[i % 4]} size={34} /></span>
          </span>
        ))}
      </div>
    </div>
  );
  return (
    <div ref={ref} className="hz-dark py-10">
      <Label className="mb-6 px-5 text-center">Questions buyers put to AI assistants every day</Label>
      <div className="grid gap-4" aria-label="Example questions">{row(QUESTIONS.slice(0, 5))}{row(QUESTIONS.slice(5), true)}</div>
    </div>
  );
}

// ---------- statement that lights up as you scroll ----------
const STATEMENT = 'When someone asks an assistant what to buy, it names two or three brands. The rest do not exist. Housedge reads those answers every week and shows you';
function InkWord({ word, i, n, progress }) {
  const opacity = useTransform(progress, [i / n * 0.8, (i + 1) / n * 0.8], [0.14, 1]);
  return <motion.span style={{ opacity }}>{word} </motion.span>;
}
function Statement() {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.85', 'end 0.5'] });
  const words = STATEMENT.split(' ');
  return (
    <Wrap className="py-28 sm:py-40">
      <div ref={ref} className="grid gap-8 lg:grid-cols-12">
        <Label className="lg:col-span-2 lg:pt-4">What we do</Label>
        <p className="text-[30px] font-semibold leading-[1.2] tracking-[-0.035em] sm:text-[46px] lg:col-span-10">
          {reduce ? `${STATEMENT} ` : words.map((w, i) => <InkWord key={i} word={w} i={i} n={words.length} progress={scrollYProgress} />)}
          <em className="font-medium" style={{ color: 'var(--hz-accent)' }}><Mark>the exact sentence that decided who got named.</Mark></em>
        </p>
      </div>
    </Wrap>
  );
}

// ---------- who is asking: a phone running a real-looking assistant chat, market by market ----------
// Each answer: a short intro, then a numbered list; a number is a redacted brand of that many letters, 'you' is your brand.
const CHATS = [
  { code: 'US', market: 'United States', engine: 'ChatGPT', q: 'Which CRM should a 10-person startup use?', intro: 'Good picks for a small team:',
    items: [[7, 'easiest to set up'], [6, 'best free plan'], [8, 'most integrations']], sources: ['g2.com', 'reddit.com'], you: ['✗', 'Not named'] },
  { code: 'FI', market: 'Finland', engine: 'ChatGPT', q: 'Mikä on paras ruoan kotiinkuljetus Helsingissä?', intro: 'Helsingissä suosituimmat ovat:',
    items: [[5, 'eniten ravintoloita'], [4, 'nopein toimitus'], [7, 'edullisin']], sources: ['hs.fi', 'reddit.com'], you: ['✗', 'Not named'] },
  { code: 'UK', market: 'United Kingdom', engine: 'Claude', q: 'Which bank app is safest for my savings?', intro: 'The most trusted options in the UK:',
    items: [[6, 'deposit protected, strong reviews'], [7, 'highest savings rate'], ['you', 'popular, but fewer reviews']], sources: ['which.co.uk', 'moneysavingexpert.com'], you: ['●', 'Named third'] },
  { code: 'PK', market: 'Pakistan', engine: 'Perplexity', q: 'Best way to receive dollars as a freelancer?', intro: 'Freelancers in Pakistan mostly use:',
    items: [[7, 'fastest transfers'], [5, 'lowest fees'], [6, 'works with most banks']], sources: ['reddit.com', 'propakistani.pk'], you: ['✗', 'Not named'] },
  { code: 'NG', market: 'Nigeria', engine: 'Gemini', q: 'Cheapest way to send money to Lagos?', intro: 'Usually the cheapest are:',
    items: [[5, 'lowest fees'], ['you', 'good rate, but a 3% fee']], sources: ['nairametrics.com', 'reddit.com'], you: ['◐', 'Named, with an old price'] },
];
const verdictColor = mark => (mark === '●' ? 'var(--hz-good)' : mark === '◐' ? 'var(--hz-warn)' : 'var(--hz-bad)');
// Small line icons drawn the way chat apps draw them.
const Ico = ({ d, size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
const ICON = {
  menu: 'M4 8h16M4 16h10', edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z', plus: 'M12 5v14M5 12h14', up: 'M12 19V5M5 12l7-7 7 7',
  copy: 'M9 9h10v10H9zM5 15V5h10', up2: 'M7 11v9H4v-9h3zm0 0l4-8a2 2 0 012 2v4h6a2 2 0 012 2l-2 7a2 2 0 01-2 1H7',
  down: 'M17 13V4h3v9h-3zm0 0l-4 8a2 2 0 01-2-2v-4H5a2 2 0 01-2-2l2-7a2 2 0 012-1h10', redo: 'M4 12a8 8 0 0114-5.3L20 9M20 4v5h-5M20 12a8 8 0 01-14 5.3L4 15M4 20v-5h5',
};
function Phone() {
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState(0); // 0 typing the question, 1 searching, 2 answering, 3 done
  const [typed, setTyped] = useState(0);
  const [shown, setShown] = useState(0);
  const ref = useRef(null);
  const visible = useInView(ref, { amount: 0.3 });
  const reduce = useReducedMotion();
  const c = CHATS[i];
  const go = k => { setI(k); setPhase(reduce ? 3 : 0); setTyped(0); setShown(reduce ? CHATS[k].items.length : 0); };
  useEffect(() => { if (reduce) { setPhase(3); setShown(c.items.length); } }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!visible || reduce) return;
    if (phase === 0) {
      const a = animate(0, c.q.length, { duration: c.q.length / 38, ease: 'linear', onUpdate: v => setTyped(Math.round(v)), onComplete: () => setTimeout(() => setPhase(1), 250) });
      return () => a.stop();
    }
    if (phase === 1) { const t = setTimeout(() => setPhase(2), 1100); return () => clearTimeout(t); }
    if (phase === 2) {
      if (shown >= c.items.length) { const t = setTimeout(() => setPhase(3), 200); return () => clearTimeout(t); }
      const t = setTimeout(() => setShown(n => n + 1), shown === 0 ? 300 : 420);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => go((i + 1) % CHATS.length), 3600);
    return () => clearTimeout(t);
  }, [visible, phase, shown, i, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const sent = phase > 0;
  return (
    <div ref={ref} className="grid items-center gap-10 sm:grid-cols-[auto_1fr]">
      <div className="relative mx-auto">
        <div className="relative h-[560px] w-[290px] rounded-[46px] p-[10px]" style={{ background: '#0b0f0d', boxShadow: '0 0 0 1px rgba(0,0,0,.2), 0 50px 90px -40px rgba(14,43,34,.6)' }}>
          <div className="relative flex h-full flex-col overflow-hidden rounded-[36px] bg-white text-[#0d0d0d]">
            <div className="flex items-center justify-between px-6 pt-3 text-[11px] font-semibold"><span>9:41</span><span className="h-[22px] w-[86px] rounded-full bg-[#0b0f0d]" /><span className="tracking-[.1em]">●●●</span></div>
            <div className="flex items-center justify-between px-4 py-2.5 text-[#5d5d5d]">
              <Ico d={ICON.menu} size={18} />
              <AnimatePresence mode="wait">
                <motion.span key={c.engine} className="flex items-center gap-1.5 text-[14px] font-semibold text-[#0d0d0d]" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.25 }}>
                  <Engine name={c.engine} size={20} />{c.engine}<span className="text-[#9b9b9b]">›</span>
                </motion.span>
              </AnimatePresence>
              <Ico d={ICON.edit} size={17} />
            </div>
            <div className="flex flex-1 flex-col gap-3 overflow-hidden px-4 pb-2 pt-3 text-[13px] leading-[1.5]">
              {!sent && (
                <motion.div key={`e${i}`} className="m-auto grid place-items-center gap-3 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <Engine name={c.engine} size={36} />
                  <span className="text-[17px] font-semibold tracking-[-0.02em]">What can I help with?</span>
                </motion.div>
              )}
              <AnimatePresence mode="popLayout">
                {sent && (
                  <motion.div key={`q${i}`} layout initial={{ opacity: 0, y: 40, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -20 }} transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                    className="ml-auto max-w-[82%] rounded-[20px] bg-[#f1f1f1] px-3.5 py-2">{c.q}</motion.div>
                )}
                {phase === 1 && (
                  <motion.div key={`s${i}`} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                    <Engine name={c.engine} size={20} /><span className="hz-shimmer text-[13px] font-medium">Searching the web</span>
                  </motion.div>
                )}
                {phase >= 2 && (
                  <motion.div key={`a${i}`} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }} className="grid gap-2">
                    <span className="flex items-center gap-2"><Engine name={c.engine} size={20} /><span>{c.intro}</span></span>
                    <ol className="grid gap-1.5 pl-1">
                      {c.items.slice(0, shown).map(([w, why], k) => (
                        <motion.li key={k} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="flex gap-2">
                          <span className="text-[#8e8e8e]">{k + 1}.</span>
                          <span><b className="font-semibold">{w === 'you' ? <span className="hz-mark on">Your brand</span> : <Redact w={w} />}</b> — {why}</span>
                        </motion.li>
                      ))}
                    </ol>
                    {phase === 3 && (
                      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="grid gap-2">
                        <div className="flex flex-wrap gap-1.5">
                          {c.sources.map(src => <span key={src} className="flex items-center gap-1 rounded-full bg-[#f4f4f4] py-0.5 pl-0.5 pr-2 text-[10.5px] text-[#5d5d5d]"><span className="grid h-4 w-4 place-items-center rounded-full bg-white text-[8px] font-bold uppercase">{src[0]}</span>{src}</span>)}
                        </div>
                        <div className="flex gap-3 text-[#8e8e8e]"><Ico d={ICON.copy} size={14} /><Ico d={ICON.up2} size={14} /><Ico d={ICON.down} size={14} /><Ico d={ICON.redo} size={14} /></div>
                      </motion.div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="mx-3 mb-3 flex items-center gap-2 rounded-[24px] border border-[#e5e5e5] bg-white py-2 pl-3 pr-2 shadow-[0_2px_10px_rgba(0,0,0,.05)]">
              <span className="text-[#5d5d5d]"><Ico d={ICON.plus} size={17} /></span>
              <span className="min-h-[18px] flex-1 truncate text-[13px]" style={{ color: !sent && typed ? '#0d0d0d' : '#9b9b9b' }}>
                {!sent && typed ? <>{c.q.slice(0, typed)}<span className="hz-caret" aria-hidden /></> : 'Ask anything'}
              </span>
              <span className="grid h-7 w-7 place-items-center rounded-full text-white transition-colors" style={{ background: !sent && typed ? '#0d0d0d' : '#d4d4d4' }}><Ico d={ICON.up} size={15} /></span>
            </div>
            <div className="mx-auto mb-2 h-1 w-24 rounded-full bg-[#0d0d0d]" />
          </div>
        </div>
        {/* Housedge's note on the answer */}
        <div className="relative z-10 mx-auto -mt-10 h-[104px] w-[250px] sm:absolute sm:-right-24 sm:bottom-28 sm:mt-0 sm:h-auto">
        <AnimatePresence>
          {phase === 3 && (
            <motion.div key={`n${i}`} className="hz-slip hz-light p-3.5"
              initial={{ opacity: 0, x: 30, rotate: 4 }} animate={{ opacity: 1, x: 0, rotate: -2 }} exit={{ opacity: 0, x: 20 }} transition={{ type: 'spring', stiffness: 300, damping: 24 }}>
              <span className="flex items-center gap-2"><Logo size={22} /><Label color="var(--hz-ink)">Housedge read this</Label></span>
              <div className="mt-2 text-[13px] font-semibold" style={{ color: verdictColor(c.you[0]) }}>{c.you[0]} Your brand: {c.you[1]}</div>
              <div className="mt-1 text-[12px]" style={{ color: 'var(--hz-muted)' }}>{c.engine} · {c.market} · sources kept</div>
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </div>
      <div className="grid gap-1 sm:pl-16">
        {CHATS.map((m, k) => (
          <button key={m.code} onClick={() => go(k)} className="group flex items-center gap-4 border-b py-3 text-left hz-rule">
            <span className="hz-label w-8 transition-colors" style={{ color: k === i ? 'var(--hz-accent)' : 'var(--hz-muted)' }}>{m.code}</span>
            <span className="text-[20px] font-semibold tracking-[-0.02em] transition-opacity" style={{ opacity: k === i ? 1 : 0.35 }}>{m.market}</span>
            {k === i && <motion.span layoutId="hz-market" className="ml-auto h-2 w-2 rounded-full" style={{ background: 'var(--hz-accent)' }} />}
          </button>
        ))}
        <Label className="mt-4">Sample conversations · brand names hidden</Label>
      </div>
    </div>
  );
}
function WhoAsks() {
  return (
    <Wrap className="pb-28 sm:pb-36">
      <div className="grid items-center gap-x-10 gap-y-14 lg:grid-cols-12">
        <Reveal className="lg:col-span-5">
          <Kicker n="01">Who is asking</Kicker>
          <h2 className="hz-display mt-5 text-[42px] leading-[1.02] sm:text-[60px]">Real people, asking a machine <em>who to trust.</em></h2>
          <p className="mt-6 max-w-[440px] text-[17px] leading-relaxed" style={{ color: 'var(--hz-ink2)' }}>
            On the train, at a café, behind the counter. The question that used to go to a search box, or a friend, now goes to an assistant, and it answers with a short list. In every country, in its own language, with its own favourites.
          </p>
        </Reveal>
        <Reveal className="lg:col-span-7" delay={0.1}><Phone /></Reveal>
      </div>
    </Wrap>
  );
}

// ---------- same question, four answers ----------
const FOUR = [
  { engine: 'ChatGPT', text: 'For freelancers paid in dollars, {6} and {7} are the most recommended. {6} has the lowest fees.', you: ['✗', 'Not named', 'var(--hz-bad)'] },
  { engine: 'Gemini', text: 'Popular choices include {7}, {6} and *your brand*, which is known for fast payouts in Pakistan.', you: ['●', 'Named third', 'var(--hz-good)'] },
  { engine: 'Perplexity', text: 'According to reddit.com and nerdwallet.com, {5} and {6} are the top picks this year.', you: ['✗', 'Not named · it reads reddit.com', 'var(--hz-bad)'] },
  { engine: 'Claude', text: '{6} is a solid option. *Your brand* is also used, though it charges a 3% fee on every transfer.', you: ['◐', 'Named, with last year’s price', 'var(--hz-warn)'] },
];
// Pinned while you scroll through it: each quarter of the scroll brings the next assistant's answer to the top.
function FourAnswers() {
  const ref = useRef(null);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  useMotionValueEvent(scrollYProgress, 'change', p => setActive(Math.min(3, Math.max(0, Math.floor(p * 4)))));
  const bar = useTransform(scrollYProgress, [0, 1], [0, 1]);
  const jump = i => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + (el.offsetHeight - window.innerHeight) * ((i + 0.5) / 4), behavior: 'smooth' });
  };
  return (
    <div id="answers" ref={ref} className="relative h-[340vh] scroll-mt-0 border-y hz-rule" style={{ background: 'var(--hz-band)' }}>
      <div className="sticky top-0 flex h-[100svh] items-center overflow-hidden pt-16">
        <Wrap className="w-full">
          <div className="grid items-center gap-8 sm:gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <Kicker n="02">Not every assistant agrees</Kicker>
              <h2 className="hz-display mt-4 text-[34px] leading-[1.02] sm:mt-5 sm:text-[58px]">One question. <em>Four different answers.</em></h2>
              <p className="mt-6 hidden max-w-[440px] text-[17px] leading-relaxed sm:block" style={{ color: 'var(--hz-ink2)' }}>
                Each assistant reads a different part of the web. You can be first in one and missing in another, or named with a price you changed last year.
              </p>
              <div className="mt-6 flex flex-wrap gap-x-5 gap-y-3 sm:mt-10 sm:gap-x-7 sm:gap-y-4" role="tablist" aria-label="Assistants">
                {ENGINES.map((e, i) => (
                  <button key={e} role="tab" aria-selected={active === i} onClick={() => jump(i)}
                    className="relative flex items-center gap-2 text-[16px] font-semibold transition-opacity duration-300 sm:text-[19px]" style={{ opacity: active === i ? 1 : 0.4 }}>
                    <Engine name={e} size={24} />{e}<Underline show={active === i} />
                  </button>
                ))}
              </div>
              <div className="mt-6 h-[3px] w-full max-w-[440px] overflow-hidden rounded-full sm:mt-8" style={{ background: 'var(--hz-rule)' }}>
                <motion.div className="h-full origin-left rounded-full" style={{ scaleX: bar, background: 'var(--hz-accent)' }} />
              </div>
              <Label className="mt-4">Keep scrolling · brand names hidden until you sign up</Label>
            </div>
            <div className="relative h-[300px] lg:col-span-7">
              {FOUR.map((f, i) => {
                const depth = (i - active + 4) % 4;
                return (
                  <motion.div key={f.engine} className="hz-slip hz-light absolute left-0 top-0 flex min-h-[250px] w-[88%] flex-col p-5 sm:min-h-[236px] sm:w-[80%] sm:p-7" style={{ zIndex: 4 - depth, willChange: 'transform' }}
                    animate={{ x: depth * 16, y: depth * 14, rotate: [-1.5, 1.2, -0.6, 2][depth], scale: 1 - depth * 0.02 }} transition={{ type: 'spring', stiffness: 220, damping: 28 }}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2"><Engine name={f.engine} size={24} /><Label color="var(--hz-ink)">{f.engine}</Label></span>
                      <Label className="truncate">“Best app to get paid in dollars?”</Label>
                    </div>
                    <p className="mt-4 text-[16px] leading-[1.7] sm:mt-5 sm:text-[17px]" style={{ color: 'var(--hz-ink2)' }}>{marked(f.text)}</p>
                    <div className="mt-auto border-t border-dashed pt-3 hz-rule"><span className="hz-label" style={{ color: f.you[2] }}>{f.you[0]} Your brand: {f.you[1]}</span></div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </Wrap>
      </div>
    </div>
  );
}

// ---------- why now ----------
function Stat({ value, suffix = '', decimals = 0, label, source }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  return (
    <div ref={ref} className="border-t pt-6 lg:border-l lg:border-t-0 lg:px-8 lg:pt-0 first:lg:border-l-0 first:lg:pl-0 hz-rule">
      <div className="hz-display text-[84px] leading-none tracking-[-0.06em] sm:text-[108px]"><Count to={value} decimals={decimals} start={inView} /><span style={{ color: 'var(--hz-accent)' }}>{suffix}</span></div>
      <p className="mt-5 max-w-[320px] text-[16px] leading-relaxed" style={{ color: 'var(--hz-ink2)' }}>{label}</p>
      <Label className="mt-4">Source: {source}</Label>
    </div>
  );
}
const SectionHead = ({ n, kicker, children }) => (
  <div className="grid gap-6 border-t-2 pt-8 lg:grid-cols-12 lg:gap-10" style={{ borderColor: 'var(--hz-ink)' }}>
    <div className="lg:col-span-3"><Kicker n={n}>{kicker}</Kicker></div>
    <Reveal className="lg:col-span-9"><h2 className="hz-display text-[42px] leading-[1.02] sm:text-[62px]">{children}</h2></Reveal>
  </div>
);
function WhyNow() {
  return (
    <Wrap className="hz-cv py-28 sm:py-36">
      <SectionHead n="03" kicker="Why now">AI answers are the new first page. <em>Most brands have never read theirs.</em></SectionHead>
      <div className="mt-16 grid gap-12 lg:grid-cols-3 lg:gap-0">
        <Stat value={0.66} decimals={2} label="Correlation between how often a brand is mentioned across the web and how often it appears in Google's AI answers. Backlinks matter far less." source="Ahrefs, 75,000 brands, 2025" />
        <Stat value={41} suffix="%" label="More visibility in AI answers for pages that quote their sources. Adding statistics adds 31%. Keyword stuffing loses 8%." source="Aggarwal et al., KDD 2024" />
        <Stat value={4} label="Assistants, each reading a different web. A brand can be the top pick in one and absent from another." source="Peec AI, 30M citations, 2026" />
      </div>
    </Wrap>
  );
}

// ---------- how it works: five animated objects, with a ledger that follows you ----------
const STEPS = [
  ['Ask', 'We put your customers’ questions to all four assistants, in each of your markets, every week. Real answers, with the web searches behind them.'],
  ['Read', 'Every answer is read the same way: which brands it names, in what order, in what tone, and which websites it relied on. Every finding keeps its quote.'],
  ['Show', 'You see your share of answers against your competitors, per assistant and per market. A number that goes up or down, not an opinion.'],
  ['Fix', 'A short list of what moves the answer for you: the sites to be on, the facts to publish, the pages to fix. Most of it we can do with you.'],
  ['Measure', 'Every change is dated. We compare the weeks before and after, so you learn what actually works.'],
];
function StepPanel({ i, setActive, children }) {
  const ref = useRef(null);
  const inView = useInView(ref, { margin: '-45% 0px -45% 0px' });
  useEffect(() => { if (inView) setActive(i); }, [inView, i, setActive]);
  return (
    <div ref={ref} className="flex flex-col justify-center py-12 lg:min-h-[78vh]">
      <div className="mb-8 lg:hidden">
        <Label color="var(--hz-accent)">Step {i + 1}</Label>
        <h3 className="hz-display mt-2 text-[38px] leading-none">{STEPS[i][0]}</h3>
        <p className="mt-3 text-[16px] leading-relaxed" style={{ color: 'var(--hz-ink2)' }}>{STEPS[i][1]}</p>
      </div>
      <Reveal>{children}</Reveal>
    </div>
  );
}
const Row = ({ k, v, strong }) => <div className="flex items-end"><span>{k}</span><span className="hz-leader" /><span className={strong ? 'font-semibold' : ''}>{v}</span></div>;

// §1 One question travels to four assistants; each answer comes back ticked.
function FanOut() {
  const ref = useRef(null);
  const on = useInView(ref, { once: true, amount: 0.3 });
  const live = useInView(ref);
  const ys = [40, 120, 200, 280];
  const path = y => `M210 160 C 300 160, 320 ${y}, 400 ${y}`;
  return (
    <div ref={ref}>
    {/* Phone: the question on top, the four assistants answering underneath. */}
    <div className="sm:hidden">
      <div className="hz-slip hz-light p-4">
        <span className="flex items-center gap-2"><Logo size={22} draw={on} /><Label color="var(--hz-ink)">Housedge asks · UK</Label></span>
        <p className="mt-2 text-[16px] font-semibold">“Best app to get paid in dollars?”</p>
      </div>
      <div className="ml-6 h-6 border-l-2 border-dashed" style={{ borderColor: 'var(--hz-accent)', opacity: 0.5 }} />
      <div className="grid grid-cols-2 gap-2.5">
        {ENGINES.map((e, k) => (
          <motion.div key={e} className="flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 hz-rule" style={{ background: 'var(--hz-surface)' }}
            initial={{ opacity: 0, y: 10 }} animate={on ? { opacity: 1, y: 0 } : {}} transition={{ delay: 0.15 + k * 0.08, ease: EASE }}>
            <Engine name={e} size={24} /><span className="text-[13px] font-semibold">{e}</span>
            <motion.span className="ml-auto text-[13px] font-bold" style={{ color: 'var(--hz-accent)' }} initial={{ opacity: 0, scale: 0 }} animate={on ? { opacity: 1, scale: 1 } : {}} transition={{ delay: 0.6 + k * 0.15, type: 'spring', stiffness: 500, damping: 18 }}>✓</motion.span>
          </motion.div>
        ))}
      </div>
    </div>
    <div className="relative mx-auto hidden aspect-[600/320] w-full max-w-[640px] sm:block">
      <svg viewBox="0 0 600 320" className="absolute inset-0 h-full w-full" aria-hidden>
        {ys.map((y, k) => (
          <g key={y}>
            <motion.path d={path(y)} fill="none" stroke="var(--hz-accent)" strokeOpacity=".45" strokeWidth="1.5" strokeDasharray="4 5"
              initial={{ pathLength: 0 }} animate={on ? { pathLength: 1 } : {}} transition={{ duration: 0.5, delay: 0.1 + k * 0.08 }} />
            {on && live && <circle r="4" fill="var(--hz-accent)"><animateMotion dur={`${1.6 + k * 0.25}s`} repeatCount="indefinite" path={path(y)} /></circle>}
          </g>
        ))}
      </svg>
      <div className="hz-slip hz-light absolute left-0 top-1/2 w-[36%] -translate-y-1/2 p-3 sm:p-4">
        <span className="flex items-center gap-2">
          <span className="relative inline-grid place-items-center">
            {on && <motion.span className="absolute inset-0 rounded-full" style={{ border: '2px solid var(--hz-accent)' }} animate={{ scale: [1, 1.9], opacity: [0.7, 0] }} transition={{ duration: 1.6, repeat: Infinity }} />}
            <Logo size={22} draw={on} />
          </span>
          <Label color="var(--hz-ink)">Housedge asks · UK</Label>
        </span>
        <p className="mt-2 text-[12px] font-semibold leading-snug sm:text-[15px]">“Best app to get paid in dollars?”</p>
      </div>
      {ENGINES.map((e, k) => (
        <motion.div key={e} className="absolute left-[67%] flex -translate-y-1/2 items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 hz-rule" style={{ top: `${ys[k] / 3.2}%`, background: 'var(--hz-surface)' }}
          initial={{ opacity: 0, x: 20 }} animate={on ? { opacity: 1, x: 0 } : {}} transition={{ delay: 0.25 + k * 0.1, ease: EASE }}>
          <Engine name={e} size={24} /><span className="text-[12px] font-semibold sm:text-[14px]">{e}</span>
          <motion.span className="text-[13px] font-bold" style={{ color: 'var(--hz-accent)' }} initial={{ opacity: 0, scale: 0 }} animate={on ? { opacity: 1, scale: 1 } : {}} transition={{ delay: 0.8 + k * 0.18, type: 'spring', stiffness: 500, damping: 18 }}>✓</motion.span>
        </motion.div>
      ))}
    </div>
    </div>
  );
}

// §2 A scanner passes over the answer, then the findings fill in.
function ReadSlip() {
  const ref = useRef(null);
  const on = useInView(ref, { once: true, amount: 0.3 });
  const rows = [['Brands named', '2'], ['Named first', 'hidden'], ['Your brand', 'not named'], ['Source it relied on', 'nerdwallet.com']];
  return (
    <div ref={ref} className="hz-slip hz-light relative max-w-[560px] overflow-hidden p-7">
      {on && <motion.div className="pointer-events-none absolute inset-x-0 h-16" style={{ background: 'linear-gradient(180deg, transparent, rgba(142,240,190,.45), transparent)' }} initial={{ top: '-15%' }} animate={{ top: '110%' }} transition={{ duration: 0.9, ease: 'easeInOut' }} />}
      <div className="flex justify-between"><span className="flex items-center gap-2"><Engine name="ChatGPT" size={22} /><Label color="var(--hz-ink)">ChatGPT · read</Label></span><Label>Sample</Label></div>
      <p className="mt-5 text-[18px] leading-[1.7]" style={{ color: 'var(--hz-ink2)' }}>
        Most freelancers use <Redact w={6} /> or <Redact w={7} />. <Mark>Reviewers on nerdwallet.com say <Redact w={6} /> has the lowest fees</Mark>, so it is usually the first choice.
      </p>
      <div className="mt-6 grid gap-1.5 border-t border-dashed pt-4 text-[14px] hz-rule" style={{ color: 'var(--hz-ink2)' }}>
        {rows.map(([k, v], n) => (
          <motion.div key={k} initial={{ opacity: 0, x: -10 }} animate={on ? { opacity: 1, x: 0 } : {}} transition={{ delay: 0.6 + n * 0.12 }}><Row k={k} v={v} strong={k === 'Your brand'} /></motion.div>
        ))}
      </div>
    </div>
  );
}

// §3 The ranking reorders itself: your brand climbs from fifth to third, and back, on a loop.
const BEFORE = [['A', 7, 61], ['B', 6, 47], ['C', 5, 33], ['D', 8, 21], ['You', 0, 12]];
const AFTER = [['A', 7, 58], ['B', 6, 44], ['You', 0, 38], ['C', 5, 29], ['D', 8, 12]];
function Ranking() {
  const ref = useRef(null);
  const on = useInView(ref, { margin: '-20% 0px' });
  const [after, setAfter] = useState(false);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setAfter(a => !a), 3200);
    return () => clearInterval(t);
  }, [on]);
  const rows = after ? AFTER : BEFORE;
  return (
    <div ref={ref} className="hz-slip hz-light p-6 sm:p-8">
      <div className="flex items-center justify-between">
        <Label color="var(--hz-ink)">Share of answers · 4 assistants</Label>
        <AnimatePresence mode="wait"><motion.span key={after ? 'a' : 'b'} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} className="hz-label rounded-full px-2.5 py-1" style={{ background: after ? '#e0f5e9' : '#edf1ea', color: after ? 'var(--hz-good)' : 'var(--hz-muted)' }}>{after ? 'Week 6 · sample' : 'Week 1 · sample'}</motion.span></AnimatePresence>
      </div>
      <div className="mt-4">
        {rows.map(([id, w, share], k) => (
          <motion.div key={id} layout transition={{ type: 'spring', stiffness: 260, damping: 28 }} className="grid grid-cols-[34px_1fr_52px] items-center gap-3 border-b py-3 last:border-0 hz-rule sm:grid-cols-[44px_130px_1fr_56px]">
            <span className="text-[28px] font-semibold leading-none tracking-[-0.04em]">{k + 1}</span>
            <span className="text-[16px] font-semibold">{id === 'You' ? <span className="hz-mark on px-1">Your brand</span> : <Redact w={w} />}</span>
            <span className="hidden h-[6px] overflow-hidden rounded-full sm:block" style={{ background: '#edf1ea' }}>
              <motion.span className="block h-full origin-left rounded-full" style={{ background: id === 'You' ? '#0f7a4c' : '#0e1f18' }} animate={{ scaleX: share / 61 }} transition={{ duration: 0.8, ease: EASE }} />
            </span>
            <span className="text-right text-[15px] font-semibold tabular-nums">{share}%</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// §4 The to-do list ticks itself; the old sentence is struck out and the new one highlighted.
function FixList() {
  const ref = useRef(null);
  const on = useInView(ref, { once: true, amount: 0.3 });
  const todo = ['Get onto the comparison page ChatGPT reads most.', 'Publish your fees as a table on your pricing page.', 'Answer “is it safe?” with your licence number.'];
  return (
    <div ref={ref} className="grid gap-6 sm:grid-cols-2">
      <div className="hz-slip hz-light -rotate-[1deg] p-6">
        <Label color="var(--hz-ink)">To do this week</Label>
        <ol className="mt-4 grid gap-4 text-[15px] leading-snug">
          {todo.map((t, k) => (
            <li key={t} className="flex gap-3">
              <span className="relative mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px] border-2" style={{ borderColor: '#0e1f18' }}>
                <motion.svg viewBox="0 0 12 12" className="h-3 w-3" initial={false}>
                  <motion.path d="M2 6.5 5 9 10 3" fill="none" stroke="#0f7a4c" strokeWidth="2.2" strokeLinecap="round" initial={{ pathLength: 0 }} animate={on ? { pathLength: 1 } : {}} transition={{ delay: 0.2 + k * 0.28, duration: 0.3 }} />
                </motion.svg>
              </span>
              <motion.span initial={{ opacity: 1 }} animate={on ? { opacity: 0.45 } : {}} transition={{ delay: 0.35 + k * 0.28 }}>{t}</motion.span>
            </li>
          ))}
        </ol>
      </div>
      <div className="hz-slip hz-light rotate-[1.2deg] p-6">
        <Label color="var(--hz-ink)">Your pricing page · before → after</Label>
        <p className="mt-4 text-[16px] leading-[1.8]" style={{ color: 'var(--hz-ink2)' }}>
          Transfers{' '}
          <span className="relative whitespace-nowrap">charge a 3% fee
            <motion.span className="absolute left-0 top-1/2 h-[2px] w-full origin-left" style={{ background: '#c9302c' }} initial={{ scaleX: 0 }} animate={on ? { scaleX: 1 } : {}} transition={{ delay: 0.9, duration: 0.35 }} />
          </span>{' '}
          <motion.span initial={{ opacity: 0 }} animate={on ? { opacity: 1 } : {}} transition={{ delay: 1.15 }}><span className={`hz-mark ${on ? 'on' : ''}`} style={{ transitionDelay: '1.2s' }}>are free up to $1,000 a month, then 1%</span></motion.span>. Licensed by the regulator in each market we serve.
        </p>
      </div>
    </div>
  );
}

// §5 A receipt prints out of a slot, line by line, and the chart draws the change.
function Receipt() {
  const ref = useRef(null);
  const on = useInView(ref, { once: true, amount: 0.3 });
  const lines = [['QUESTIONS ASKED', 120], ['ANSWERS READ', 480]];
  const line = n => ({ initial: { opacity: 0, y: -6 }, animate: on ? { opacity: 1, y: 0 } : {}, transition: { delay: 0.45 + n * 0.12 } });
  return (
    <div ref={ref} className="flex flex-wrap items-start gap-10">
      <div className="w-[310px]">
        <div className="relative z-10 h-4 rounded-full" style={{ background: '#030806', boxShadow: 'inset 0 -2px 0 rgba(255,255,255,.08)' }} />
        <div className="-mt-2 overflow-hidden px-[5px]">
          <motion.div className="hz-light hz-receipt px-6 pb-9 pt-8 text-[13px]" initial={{ y: '-100%' }} animate={on ? { y: 0 } : {}} transition={{ duration: 1.1, ease: [0.45, 0, 0.25, 1] }}>
            <div className="flex flex-col items-center gap-2"><Logo size={30} draw={on} /><span className="text-[15px] font-bold tracking-[.24em]">HOUSEDGE</span></div>
            <div className="mt-1 text-center text-[11px] font-semibold tracking-[.12em]" style={{ color: 'var(--hz-muted)' }}>WEEKLY READING · SAMPLE</div>
            <div className="my-4 border-t border-dashed hz-rule" />
            <div className="grid gap-1.5 font-medium">
              {lines.map(([k, v], n) => <motion.div key={k} {...line(n)}><Row k={k} v={<Count to={v} start={on} delay={0.45 + n * 0.12} />} /></motion.div>)}
              <motion.div {...line(2)}><Row k="YOU WERE NAMED" v={<>38 → <Count from={38} to={51} start={on} delay={0.8} /></>} strong /></motion.div>
              <motion.div {...line(3)}><Row k="CHANGE" v={<span style={{ color: 'var(--hz-good)' }}>+<Count to={13} start={on} delay={0.9} /></span>} strong /></motion.div>
              <motion.div {...line(4)}><Row k="NEW SOURCE" v="reddit.com" /></motion.div>
            </div>
            <div className="my-4 border-t border-dashed hz-rule" />
            <motion.div {...line(5)} className="text-[11px] font-semibold leading-relaxed tracking-[.06em]">DONE THIS MONTH:<br />✓ FEES TABLE PUBLISHED<br />✓ ON 2 COMPARISON SITES</motion.div>
            <motion.div {...line(6)} className="mt-4 text-center text-[11px] tracking-[.1em]" style={{ color: 'var(--hz-muted)' }}>* THANK YOU FOR READING *</motion.div>
          </motion.div>
        </div>
      </div>
      <div className="w-full max-w-[300px] pt-16">
        <svg viewBox="0 0 240 120" className="w-full overflow-visible" role="img" aria-label="Sample chart: mentions rising after a change">
          <line x1="0" y1="100" x2="240" y2="100" stroke="var(--hz-rule)" />
          <motion.line x1="120" y1="0" x2="120" y2="100" stroke="var(--hz-accent)" strokeDasharray="3 4" initial={{ opacity: 0 }} animate={on ? { opacity: 1 } : {}} transition={{ delay: 0.5 }} />
          <motion.path d="M0 78 L30 80 L60 74 L90 79 L120 75 L150 58 L180 46 L210 40 L240 28" fill="none" stroke="var(--hz-ink)" strokeWidth="2.5" strokeLinejoin="round"
            initial={{ pathLength: 0 }} animate={on ? { pathLength: 1 } : {}} transition={{ duration: 1.1, ease: 'easeInOut', delay: 0.2 }} />
          <motion.circle cx="240" cy="28" r="5" fill="var(--hz-accent)" initial={{ scale: 0 }} animate={on ? { scale: 1 } : {}} transition={{ delay: 1.25, type: 'spring', stiffness: 500, damping: 15 }} />
          <motion.text x="232" y="14" textAnchor="end" fontSize="13" fontWeight="700" fill="var(--hz-accent)" initial={{ opacity: 0, y: 6 }} animate={on ? { opacity: 1, y: 0 } : {}} transition={{ delay: 1.35 }}>+13 mentions</motion.text>
        </svg>
        <div className="mt-2 flex justify-between"><Label>28 days before</Label><Label>after</Label></div>
        <p className="mt-4 text-[19px] font-medium italic leading-snug tracking-[-0.02em]" style={{ color: 'var(--hz-accent)' }}>The change on the 14th, and what it did.</p>
      </div>
    </div>
  );
}

function Ledger() {
  const [active, setActive] = useState(0);
  return (
    <Wrap id="how" className="pb-24">
      <SectionHead n="04" kicker="How it works">Five steps, every week. <em>One number that goes up.</em></SectionHead>
      <div className="mt-4 grid gap-10 lg:grid-cols-12">
        <div className="hidden lg:col-span-5 lg:block">
          <div className="sticky top-24 pt-14">
            {STEPS.map(([t, d], i) => (
              <div key={t} className="border-b py-4 transition-opacity duration-500 hz-rule" style={{ opacity: active === i ? 1 : 0.3 }}>
                <div className="flex items-baseline gap-4">
                  <span className="hz-label w-8" style={{ color: 'var(--hz-accent)' }}>{String(i + 1).padStart(2, '0')}</span>
                  <span className="hz-display text-[42px] leading-none">{t}</span>
                  <span className="ml-auto text-[18px] transition-opacity duration-300" style={{ color: 'var(--hz-accent)', opacity: active === i ? 1 : 0 }} aria-hidden>◂</span>
                </div>
              </div>
            ))}
            <div className="relative mt-6 h-[110px] pl-12">
              {STEPS.map(([t, d], i) => (
                <p key={t} className="absolute inset-x-0 top-0 max-w-[420px] pl-12 text-[16px] leading-relaxed transition-[opacity,transform] duration-500"
                  style={{ color: 'var(--hz-ink2)', opacity: active === i ? 1 : 0, transform: `translateY(${active === i ? 0 : 8}px)` }} aria-hidden={active !== i}>{d}</p>
              ))}
            </div>
          </div>
        </div>
        <div className="lg:col-span-7">
          <StepPanel i={0} setActive={setActive}><FanOut /></StepPanel>
          <StepPanel i={1} setActive={setActive}><ReadSlip /></StepPanel>
          <StepPanel i={2} setActive={setActive}><Ranking /></StepPanel>
          <StepPanel i={3} setActive={setActive}><FixList /></StepPanel>
          <StepPanel i={4} setActive={setActive}><Receipt /></StepPanel>
        </div>
      </div>
    </Wrap>
  );
}

// ---------- what makes it different ----------
function Different() {
  const items = [
    ['Proof, not scores', 'Every brand we find in an answer comes with the sentence that proves it. If the quote is not in the answer, the finding is thrown out.'],
    ['Actions linked to results', 'Every action is dated and measured: how often AI named you in the 28 days before, and the 28 days after. You learn what actually works.'],
    ['Done with you', 'A dashboard shows the gap. Our team closes it: the listings, the pages, the facts, the outreach. Then the numbers show whether it worked.'],
  ];
  return (
    <div className="hz-dark hz-cv">
      <Wrap className="py-28 sm:py-36">
        <div className="grid gap-6 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-3"><Kicker n="05">Not another dashboard</Kicker><LiveLogo size={56} className="mt-8 hidden lg:inline-block" /></div>
          <Reveal className="lg:col-span-9">
            <h2 className="hz-display text-[42px] leading-[1.02] sm:text-[70px]">Anyone can ask ChatGPT once. <em>That is not the point.</em></h2>
            <p className="mt-6 max-w-[620px] text-[18px] leading-relaxed" style={{ color: 'var(--hz-ink2)' }}>One answer is a snapshot. Dozens of answers a week, read the same way, with the sources kept, is a measurement. And a measurement is something you can move.</p>
          </Reveal>
        </div>
        <div className="mt-20 grid gap-12 md:grid-cols-3 md:gap-0">
          {items.map(([t, d], i) => (
            <Reveal key={t} delay={i * 0.1} className="border-t pt-6 hz-rule md:border-l md:border-t-0 md:px-8 md:pt-0 first:md:border-l-0 first:md:pl-0">
              <span className="hz-display text-[60px] leading-none" style={{ color: 'var(--hz-accent)' }}>{String(i + 1).padStart(2, '0')}</span>
              <h3 className="mt-6 text-[23px] font-semibold tracking-[-0.02em]">{t}</h3>
              <p className="mt-3 text-[16px] leading-relaxed" style={{ color: 'var(--hz-ink2)' }}>{d}</p>
            </Reveal>
          ))}
        </div>
      </Wrap>
    </div>
  );
}

// ---------- who it is for: pick an industry, see the kind of answer we read ----------
const INDUSTRIES = [
  { t: 'Fintech and money apps', d: '“Is it safe?” and “which app pays faster?” are asked to AI first. A missing licence line or review page costs you the answer.',
    q: 'Is this money app safe to keep my salary in?', a: '{6} and {7} are licensed and widely reviewed. *{6} is mentioned most for safety.*', you: 'Not named' },
  { t: 'Consumer apps and brands', d: 'Comparison questions, in every market you sell in. Different assistants, different answers, one measurement.',
    q: 'Which smart ring is best for sleep tracking?', a: 'Most comparisons rank {4} first, then *your brand*, then {7}.', you: 'Named second' },
  { t: 'Regulated industries', d: 'iGaming, health, finance: only honest, compliant actions, with the evidence to show your compliance team.',
    q: 'Which online casinos are licensed in Finland?', a: 'Licensed operators include {5} and {7}. *Always check the licence number on the site.*', you: 'Not named' },
  { t: 'Agencies', d: 'Track your clients, show proof, and give them a monthly report that is a chart instead of a slide.',
    q: 'Which agency is best for fintech marketing in Europe?', a: '{6} and {8} are often recommended. *{6} publishes the most case studies.*', you: 'Not named' },
];
function WhoFor() {
  const [i, setI] = useState(0);
  const [hover, setHover] = useState(false);
  const ref = useRef(null);
  const on = useInView(ref, { margin: '-20% 0px' });
  useEffect(() => {
    if (hover || !on) return;
    const t = setInterval(() => setI(v => (v + 1) % INDUSTRIES.length), 4200);
    return () => clearInterval(t);
  }, [hover, on]);
  const x = INDUSTRIES[i];
  return (
    <Wrap id="who" className="hz-cv py-28 sm:py-36">
      <div ref={ref} className="grid gap-14 lg:grid-cols-12" onMouseLeave={() => setHover(false)}>
        <div className="lg:col-span-7">
          <Reveal>
            <Kicker n="06">Who it is for</Kicker>
            <h2 className="hz-display mt-5 text-[42px] leading-[1.02] sm:text-[62px]">Built for brands <em>people ask AI about.</em></h2>
          </Reveal>
          <div className="mt-12 border-t hz-rule">
            {INDUSTRIES.map((r, k) => (
              <button key={r.t} onMouseEnter={() => { setI(k); setHover(true); }} onClick={() => setI(k)} className="grid w-full grid-cols-[52px_1fr] gap-5 border-b py-6 text-left hz-rule sm:grid-cols-[72px_1fr]" aria-pressed={i === k}>
                <span className="hz-display text-[34px] leading-none transition-colors sm:text-[42px]" style={{ color: i === k ? 'var(--hz-accent)' : 'var(--hz-muted)' }}>{String(k + 1).padStart(2, '0')}</span>
                <span>
                  <span className="hz-display block text-[26px] leading-tight transition-opacity sm:text-[32px]" style={{ opacity: i === k ? 1 : 0.5 }}>{r.t}</span>
                  <span className="block max-w-[520px] pt-2 text-[16px] leading-relaxed transition-opacity duration-300" style={{ color: 'var(--hz-ink2)', opacity: i === k ? 1 : 0.55 }}>{r.d}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="lg:col-span-5 lg:pt-28">
          <div className="lg:sticky lg:top-28">
            <div className="hz-slip hz-light relative min-h-[290px] overflow-hidden p-6 sm:p-7">
              <div className="flex items-center justify-between"><span className="flex items-center gap-2"><Engine name={ENGINES[i]} size={24} /><Label color="var(--hz-ink)">{ENGINES[i]} · sample</Label></span>
                <div className="flex gap-1">{INDUSTRIES.map((_, k) => <span key={k} className="h-1.5 w-5 rounded-full transition-colors" style={{ background: k === i ? '#0f7a4c' : '#dfe6df' }} />)}</div>
              </div>
              <AnimatePresence mode="wait">
                <motion.div key={i} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -24 }} transition={{ duration: 0.45, ease: EASE }}>
                  <p className="mt-6 text-[21px] font-semibold italic leading-snug tracking-[-0.02em]">“{x.q}”</p>
                  <p className="mt-4 text-[16px] leading-[1.7]" style={{ color: 'var(--hz-ink2)' }}>{marked(x.a)}</p>
                  <div className="mt-6 border-t border-dashed pt-3 hz-rule"><span className="hz-label" style={{ color: x.you === 'Not named' ? 'var(--hz-bad)' : 'var(--hz-good)' }}>{x.you === 'Not named' ? '✗' : '●'} Your brand: {x.you}</span></div>
                </motion.div>
              </AnimatePresence>
            </div>
            <Link to={SIGNUP} className="hz-link mt-5 inline-block text-[15px] font-medium">See the answers in your industry ↗</Link>
          </div>
        </div>
      </div>
    </Wrap>
  );
}

// ---------- questions ----------
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
    <div className="hz-cv border-t hz-rule" style={{ background: 'var(--hz-band)' }}>
      <Wrap id="faq" className="py-28 sm:py-36">
        <div className="grid gap-12 lg:grid-cols-12">
          <Reveal className="lg:col-span-4">
            <Kicker n="07">Questions</Kicker>
            <h2 className="hz-display mt-5 text-[42px] leading-[1.02] sm:text-[58px]">Questions people <em>ask us.</em></h2>
          </Reveal>
          <div className="border-t lg:col-span-8" style={{ borderColor: 'var(--hz-ink)' }}>
            {qa.map(([q, a], i) => (
              <div key={q} className="border-b hz-rule">
                <button className="flex w-full items-baseline gap-5 py-6 text-left" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
                  <span className="hz-label w-6 shrink-0" style={{ color: 'var(--hz-muted)' }}>{String(i + 1).padStart(2, '0')}</span>
                  <span className="flex-1 text-[22px] font-semibold leading-snug tracking-[-0.025em] sm:text-[26px]">{q}</span>
                  <span className="w-6 shrink-0 text-[28px] font-light leading-none transition-transform duration-300" style={{ color: 'var(--hz-accent)', transform: open === i ? 'rotate(45deg)' : 'none' }} aria-hidden>+</span>
                </button>
                <motion.div initial={false} animate={{ height: open === i ? 'auto' : 0, opacity: open === i ? 1 : 0 }} transition={{ duration: 0.35, ease: EASE }} className="overflow-hidden">
                  <p className="max-w-[640px] pb-7 pl-11 text-[16px] leading-relaxed" style={{ color: 'var(--hz-ink2)' }}>{a}</p>
                </motion.div>
              </div>
            ))}
          </div>
        </div>
      </Wrap>
    </div>
  );
}

// ---------- closing call, over a photograph ----------
function CtaPhoto() {
  return (
    <section className="hz-dark relative isolate overflow-hidden">
      <Photo name="city-dusk-uranwang" alt="" className="!absolute inset-0 -z-10 h-full w-full" speed={8} />
      <div className="absolute inset-0 -z-10" style={{ background: 'linear-gradient(180deg, rgba(14,43,34,.8), rgba(14,43,34,.5) 45%, rgba(14,43,34,.94))' }} />
      <div className="mx-auto max-w-[1240px] px-5 py-36 text-center sm:px-8 sm:py-48">
        <Reveal>
          <LiveLogo size={64} className="mb-8" />
          <Label color="var(--hz-ink2)">Tonight, someone will ask about your category</Label>
          <h2 className="hz-display mx-auto mt-6 max-w-[14ch] text-[50px] leading-[1] sm:text-[90px]">See what AI says about you <em>this week.</em></h2>
          <p className="mx-auto mt-6 max-w-[520px] text-[18px] leading-relaxed" style={{ color: 'var(--hz-ink2)' }}>Your first snapshot is free. If you like what you learn, we do the work to change it.</p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-6">
            <Link to={SIGNUP} className="hz-btn hz-primary !px-7 !py-4 !text-[16px]">Get my free snapshot <Arrow /></Link>
            <a href="#contact" className="hz-link text-[16px] font-medium">Or talk to us first</a>
          </div>
          <Label className="mt-8">No card needed · data kept in the EU</Label>
        </Reveal>
      </div>
    </section>
  );
}

// ---------- contact ----------
const Field = ({ id, label, children }) => <div><label className="hz-label mb-1 block" style={{ color: 'var(--hz-muted)' }} htmlFor={id}>{label}</label>{children}</div>;

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
    <Wrap id="contact" className="hz-cv py-28 sm:py-36">
      <div className="grid gap-14 lg:grid-cols-12">
        <Reveal className="lg:col-span-5">
          <Kicker n="08">Prefer to talk first?</Kicker>
          <h2 className="hz-display mt-5 text-[42px] leading-[1.02] sm:text-[58px]">Tell us about <em>your brand.</em></h2>
          <p className="mt-6 max-w-[420px] text-[17px] leading-relaxed" style={{ color: 'var(--hz-ink2)' }}>We will come back with a short call and a first look at what AI says about you in your markets.</p>
          <ul className="mt-8 grid gap-3 text-[16px]" style={{ color: 'var(--hz-ink2)' }}>
            {['Your brand against your main competitors', 'Four assistants, your markets, real answers', 'The first actions worth taking'].map(t => <li key={t} className="flex gap-3"><span style={{ color: 'var(--hz-accent)' }} aria-hidden>→</span>{t}</li>)}
          </ul>
        </Reveal>
        <Reveal className="lg:col-span-7" delay={0.1}>
          {state.done ? (
            <div className="hz-panel grid min-h-[420px] place-items-center p-10 text-center">
              <div>
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 15 }} className="text-[64px] font-bold leading-none" style={{ color: 'var(--hz-accent)' }} aria-hidden>✓</motion.div>
                <h3 className="hz-display mt-4 text-[32px]">Thank you, {f.name.split(' ')[0]}.</h3>
                <p className="mt-2" style={{ color: 'var(--hz-ink2)' }}>We have your message and will get back to you at {f.email}.</p>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="hz-panel relative grid gap-7 p-7 sm:p-10">
              <div className="grid gap-7 sm:grid-cols-2">
                <Field id="c-name" label="Your name"><input id="c-name" className="hz-input" required value={f.name} onChange={set('name')} autoComplete="name" /></Field>
                <Field id="c-email" label="Work email"><input id="c-email" type="email" className="hz-input" required value={f.email} onChange={set('email')} autoComplete="email" /></Field>
                <Field id="c-company" label="Company"><input id="c-company" className="hz-input" required value={f.company} onChange={set('company')} autoComplete="organization" /></Field>
                <Field id="c-role" label="You are"><select id="c-role" className="hz-input" value={f.role} onChange={set('role')}><option value="">Choose…</option>{['Brand / company', 'Agency', 'iGaming operator', 'iGaming supplier', 'Other'].map(r => <option key={r}>{r}</option>)}</select></Field>
              </div>
              <Field id="c-markets" label="Markets you care about"><input id="c-markets" className="hz-input" placeholder="e.g. Finland, Pakistan" value={f.markets} onChange={set('markets')} /></Field>
              <Field id="c-msg" label="Anything else? (optional)"><textarea id="c-msg" rows={2} className="hz-input resize-none" value={f.message} onChange={set('message')} /></Field>
              {/* Hidden from people; bots fill it in and get ignored. */}
              <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label></div>
              <label className="flex items-start gap-3 text-[14px]" style={{ color: 'var(--hz-ink2)' }}>
                <input type="checkbox" className="mt-0.5 h-4 w-4" style={{ accentColor: '#0f7a4c' }} checked={f.consent} onChange={set('consent')} required />
                <span>I agree that you store these details to answer my enquiry, as described in the <Link to="/privacy" className="hz-link">privacy policy</Link>.</span>
              </label>
              {state.error && <div className="border-l-2 py-1 pl-3 text-[14px]" style={{ borderColor: 'var(--hz-bad)', color: 'var(--hz-bad)' }}>{state.error}</div>}
              <button className="hz-btn hz-primary justify-self-start !px-7" disabled={state.busy}>{state.busy ? 'Sending…' : <>Send <Arrow /></>}</button>
            </form>
          )}
        </Reveal>
      </div>
    </Wrap>
  );
}

// ---------- footer ----------
function Footer({ signedIn }) {
  return (
    <footer className="hz-dark hz-cv">
      <div className="mx-auto max-w-[1240px] px-5 pt-14 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-3">
          <p className="hz-display text-[22px] leading-tight"><span className="mb-4 block"><LiveLogo size={44} /></span>See what AI says.<br /><em>Change it. Prove it.</em></p>
          <div className="grid content-start gap-2 text-[15px]">
            <Link to={SIGNUP} className="hz-link w-fit">Get a free snapshot</Link>
            <Link to={signedIn ? '/' : '/login'} className="hz-link w-fit">{signedIn ? 'Open the app' : 'Sign in'}</Link>
            <a href="#contact" className="hz-link w-fit">Contact</a>
          </div>
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--hz-muted)' }}>
            ChatGPT, Gemini, Perplexity and Claude are trademarks of OpenAI, Google, Perplexity AI and Anthropic. Housedge is independent of all four.
            Photographs from Unsplash by Joshua Hoehne and Uran Wang.
          </p>
        </div>
        <div className="hz-display mt-16 select-none whitespace-nowrap text-[clamp(60px,17vw,250px)] leading-[0.8] tracking-[-0.06em]" aria-hidden>
          Housedge<span style={{ color: 'var(--hz-accent)' }}>.</span>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t py-6 text-[12px] hz-rule" style={{ color: 'var(--hz-muted)' }}>
          <LegalLinks />
          <span className="hz-label">Data kept in the EU</span>
        </div>
      </div>
    </footer>
  );
}
