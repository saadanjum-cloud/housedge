// "Run now" on Supabase: asks Claude each active question with live web search (as a customer would), stores the
// answer, then the AI reader (Haiku) lists the brands it names with verbatim evidence (see extract.js).
// It runs in the background after the request returns. Every write is its own short transaction, so the progress
// screen sees each answer the moment it lands. ChatGPT, Gemini and Perplexity follow once their keys are connected.
import Anthropic from 'npm:@anthropic-ai/sdk@0.133.0';
import { asService, all, get, run } from './db.js';
import { analyzeAnswer, classifySource, domainOf } from './analysis.js';
import { safeHttpUrl } from './validate.js';
import { SCHEMA, SYSTEM, EXTRACTOR_VERSION, verify, resolve, crossCheck } from './extract.js';
import { SENTIMENT_SCORE } from './readings.js';
import { brandsOf, isoDay } from './metrics.js';
import { autoReport } from './reports.js';
import { lookalikeConfig, markConfusion } from './lookalike.js';
import { assertCanSpend } from './spend.js';

export const RUN_MODEL = 'claude-sonnet-5-5'; // "Run now" uses Sonnet live (decided Oct 2026, for cost)
const READ_MODEL = 'claude-haiku-5-5';
// USD per million tokens [in, out], list prices Oct 2026, plus $0.01 per web search.
const PRICES = { 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5], 'claude-opus-5-5': [4, 20] };
const costOf = (model, u, searches = 0) => {
  const [i, o] = PRICES[model] || PRICES['claude-opus-5-5'];
  return ((u?.input_tokens || 0) * i + (u?.output_tokens || 0) * o) / 1e6 + searches * 0.01;
};
// Expected cost of one question (answer + reading), used to check the budget before a check starts.
export const EST_PER_QUESTION = 0.09;
const PARALLEL = 6;
const STALE_MS = 180_000; // longer than a function can live: no heartbeat for this long means the worker stopped
const MAX_ANSWER_CHARS = 60_000;
const COUNTRY_CODE = { FI: 'FI', SE: 'SE', UK: 'GB', DE: 'DE', US: 'US', PK: 'PK', IN: 'IN', NG: 'NG', PH: 'PH', AE: 'AE' };

const apiKey = () => Deno.env.get('ANTHROPIC_API_KEY');
const db = fn => asService(fn); // each call: its own transaction, committed straight away
const clean = e => String(e?.message || e).replaceAll(apiKey() || '\u0000', '[key]').slice(0, 500);

// Countries Claude's web search does not accept as a location (it answers 400). Their questions are asked
// without the location hint; market questions already name the country in the text ("…in Pakistan").
const NO_LOCATION = new Set();

// Same request as the old server's tested Claude adapter (server/engines/live.js).
async function askClaude(client, question, country) {
  const code = COUNTRY_CODE[country];
  try {
    return await askClaudeOnce(client, question, code && !NO_LOCATION.has(code) ? code : null);
  } catch (e) {
    if (!code || !/country code \w+ is not supported/i.test(String(e?.message))) throw e;
    NO_LOCATION.add(code);
    return askClaudeOnce(client, question, null);
  }
}

async function askClaudeOnce(client, question, code) {
  const tool = { type: 'web_search_20260209', name: 'web_search', max_uses: 5 };
  if (code) tool.user_location = { type: 'approximate', country: code };
  const messages = [{ role: 'user', content: question }];
  let r, inT = 0, outT = 0, searches = 0;
  for (let i = 0; i < 4; i++) {
    if (r?.stop_reason === 'pause_turn') messages.push({ role: 'assistant', content: r.content }); // long searches pause; continue
    else if (r) break;
    r = await client.beta.messages.create({ model: RUN_MODEL, max_tokens: 16000, messages, tools: [tool], output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    inT += r.usage?.input_tokens || 0; outT += r.usage?.output_tokens || 0; searches += r.usage?.server_tool_use?.web_search_requests || 0;
  }
  if (r.stop_reason === 'refusal') throw new Error('Claude declined to answer this question (safety filter).');
  const cited = [], found = [];
  let text = '';
  for (const b of r.content) {
    if (b.type === 'text') { text += b.text; for (const c of b.citations || []) if (c.url) cited.push({ url: c.url, title: c.title }); }
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const s of b.content) if (s.url) found.push({ url: s.url, title: s.title });
  }
  const seen = new Set();
  const citations = (cited.length ? cited : found).filter(c => !seen.has(c.url) && seen.add(c.url));
  return { text: text.slice(0, MAX_ANSWER_CHARS), citations, model: r.model || RUN_MODEL, searches, cost: costOf(RUN_MODEL, { input_tokens: inT, output_tokens: outT }, searches), inT, outT };
}

async function readAnswer(client, text) {
  const r = await client.beta.messages.create({
    model: READ_MODEL, max_tokens: 8000, system: SYSTEM,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: `<answer>\n${String(text).slice(0, 40_000)}\n</answer>` }],
  });
  if (r.stop_reason !== 'end_turn') throw new Error(`reader stopped: ${r.stop_reason}`);
  const data = JSON.parse(r.content.filter(b => b.type === 'text').map(b => b.text).join(''));
  return { ...verify(text, data), model: r.model || READ_MODEL, cost: costOf(READ_MODEL, r.usage), usage: r.usage };
}

// Starts a check (or returns the one already running). Throws a readable error when it cannot start.
export async function startRun(project, userId, trigger = 'manual') {
  const active = await db(() => get("SELECT id FROM runs WHERE project_id = ? AND status = 'running'", project.id));
  if (active) return { runId: active.id, already: true };
  if (!apiKey()) throw Object.assign(new Error('AI checks are not connected yet. Please contact the Housedge team.'), { expose: true, status: 503 });
  if (!project.engines.includes('claude')) throw Object.assign(new Error('Choose Claude under Project settings → AI assistants first. (ChatGPT, Gemini and Perplexity are being connected.)'), { expose: true });
  const prompts = await db(() => all('SELECT id FROM prompts WHERE project_id = ? AND active', project.id));
  if (!prompts.length) throw Object.assign(new Error('Add at least one question first.'), { expose: true });
  await assertCanSpend(project.org_id, prompts.length * EST_PER_QUESTION); // client budget, platform cap, trial cap
  let runId;
  try {
    runId = (await db(() => get("INSERT INTO runs (project_id, trigger, status, total, requested_by, heartbeat_at) VALUES (?, ?, 'running', ?, ?, now()) RETURNING id",
      project.id, trigger, prompts.length, userId))).id;
  } catch (e) {
    // Two clicks at the same moment: the database allows one running check per project (runs_one_running).
    if (e?.code !== '23505') throw e;
    return { runId: (await db(() => get("SELECT id FROM runs WHERE project_id = ? AND status = 'running'", project.id))).id, already: true };
  }
  inBackground(processRun(runId));
  return { runId };
}

// A running check that stopped sending heartbeats (the function hit its time limit) is continued from where it was.
export async function resumeIfStalled(runId) {
  const claimed = await db(() => get(`UPDATE runs SET heartbeat_at = now() WHERE id = ? AND status = 'running'
    AND (heartbeat_at IS NULL OR heartbeat_at < now() - make_interval(secs => ?)) RETURNING id`, runId, STALE_MS / 1000));
  if (claimed) inBackground(processRun(runId));
}

function inBackground(promise) {
  // @ts-ignore EdgeRuntime is provided by Supabase: keeps the function alive after the response until this finishes.
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(promise); else promise.catch(() => {});
}

async function processRun(runId) {
  const client = new Anthropic({ apiKey: apiKey(), timeout: 120_000, maxRetries: 1 });
  try {
    const r = await db(() => get('SELECT r.*, p.org_id FROM runs r JOIN projects p ON p.id = r.project_id WHERE r.id = ?', runId));
    const projectId = r.project_id;
    const brands = await db(() => brandsOf(projectId));
    const cfg = await db(() => lookalikeConfig(projectId));
    // Questions not yet answered in this check (so a resumed worker skips what is done).
    const todo = await db(() => all(`SELECT q.id, q.text, q.country FROM prompts q WHERE q.project_id = ? AND q.active AND q.created_at <= ?
      AND NOT EXISTS (SELECT 1 FROM answers a WHERE a.run_id = ? AND a.prompt_id = q.id) ORDER BY q.id`, projectId, r.started_at, runId));
    const day = isoDay(Date.now());
    let stopped = null;
    const worker = async () => {
      while (todo.length && !stopped) {
        const q = todo.shift();
        // Checked before every question, so a check stops as soon as any spending lock would be crossed
        // (also when several checks of one company run at the same time).
        try { await assertCanSpend(r.org_id, EST_PER_QUESTION); } catch (e) { stopped = e.message; break; }
        await answerOne(client, { runId, projectId, orgId: r.org_id, q, day, brands, cfg });
        await db(() => run('UPDATE runs SET heartbeat_at = now() WHERE id = ?', runId));
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    await finish(runId, projectId, stopped);
  } catch (e) {
    console.error('[run]', runId, clean(e));
    await db(() => run("UPDATE runs SET status = 'failed', message = ?, finished_at = now() WHERE id = ? AND status = 'running'", clean(e), runId));
  }
}

async function answerOne(client, { runId, projectId, orgId, q, day, brands, cfg }) {
  let a;
  try {
    a = await askClaude(client, q.text, q.country);
  } catch (e) {
    await db(() => run(`INSERT INTO answers (run_id, project_id, prompt_id, engine, day, model, error) VALUES (?,?,?,'claude',?,?,?)`, runId, projectId, q.id, day, RUN_MODEL, clean(e)));
    await db(() => run('UPDATE runs SET failed = failed + 1 WHERE id = ?', runId));
    return;
  }
  // Store the answer with the quick word-match reading first, so it shows up at once.
  const answerId = await db(async () => {
    const id = (await get(`INSERT INTO answers (run_id, project_id, prompt_id, engine, day, text, model, cost, in_tokens, out_tokens, searches)
      VALUES (?,?,?,'claude',?,?,?,?,?,?,?) RETURNING id`, runId, projectId, q.id, day, a.text, a.model, a.cost, a.inT, a.outT, a.searches)).id;
    const { mentions, others } = analyzeAnswer(a.text, brands);
    for (const m of mentions) await run('INSERT INTO mentions (project_id, answer_id, brand_id, position, sentiment, snippet) VALUES (?,?,?,?,?,?)', projectId, id, m.brand_id, m.position, m.sentiment, m.snippet);
    for (const o of others) await run('INSERT INTO other_brands (project_id, answer_id, name) VALUES (?,?,?)', projectId, id, o);
    for (const c of a.citations.slice(0, 50)) {
      const url = safeHttpUrl(c.url);
      const domain = url && domainOf(url);
      if (domain) await run('INSERT INTO citations (project_id, answer_id, url, domain, title, category) VALUES (?,?,?,?,?,?)',
        projectId, id, url, domain, String(c.title || '').replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, 300), classifySource(domain, brands));
    }
    await markConfusion(cfg, { answerId: id, projectId, text: a.text, domains: a.citations.map(c => domainOf(c.url)).filter(Boolean), promptText: q.text, brands });
    await run('UPDATE runs SET done = done + 1, cost = cost + ? WHERE id = ?', a.cost, runId);
    return id;
  });
  // Then the AI reader replaces the word-match reading. If it fails, the word-match reading stays.
  try {
    const x = await readAnswer(client, a.text);
    await db(async () => {
      const resolved = resolve(x.entities, brands);
      await run('DELETE FROM mentions WHERE answer_id = ?', answerId);
      await run('DELETE FROM other_brands WHERE answer_id = ?', answerId);
      for (const e of resolved) {
        if (e.brand_id) await run('INSERT INTO mentions (project_id, answer_id, brand_id, position, sentiment, snippet) VALUES (?,?,?,?,?,?)',
          projectId, answerId, e.brand_id, e.rank, SENTIMENT_SCORE[e.sentiment], e.quote.slice(0, 400));
        else if (e.kind !== 'other' && e.role !== 'passing') await run('INSERT INTO other_brands (project_id, answer_id, name) VALUES (?,?,?)', projectId, answerId, e.name);
      }
      await markConfusion(cfg, { answerId, projectId, text: a.text, domains: a.citations.map(c => domainOf(c.url)).filter(Boolean), promptText: q.text, brands });
      await run(`INSERT INTO extractions (answer_id, project_id, version, model, data, dropped, disagreement, cost, in_tokens, out_tokens) VALUES (?,?,?,?,?::jsonb,?,?,?,?,?)
        ON CONFLICT (answer_id) DO NOTHING`, answerId, projectId, EXTRACTOR_VERSION, x.model,
      JSON.stringify({ shape: x.shape, entities: x.entities, weak: x.weak, dropped_names: x.droppedNames }), x.dropped, crossCheck(a.text, brands, resolved), x.cost, x.usage?.input_tokens || 0, x.usage?.output_tokens || 0);
      await run("INSERT INTO ai_spend (org_id, project_id, kind, model, cost, in_tokens, out_tokens) VALUES (?,?,'reading',?,?,?,?)",
        orgId, projectId, x.model, x.cost, x.usage?.input_tokens || 0, x.usage?.output_tokens || 0);
    });
  } catch (e) { console.error('[reader]', answerId, clean(e)); }
}

// "400 {…"message":"Country code NG is not supported."…}" -> "Country code NG is not supported."
const readable = e => String(e || '').match(/"message":"([^"]+)"/)?.[1] || String(e || '').slice(0, 200);

async function finish(runId, projectId, stopped = null) {
  const r = await db(() => get('SELECT done, failed, total FROM runs WHERE id = ?', runId));
  if (stopped) {
    await db(() => run("UPDATE runs SET status = ?, message = ?, finished_at = now() WHERE id = ? AND status = 'running'",
      r.done ? 'partial' : 'failed', `Stopped after ${r.done} of ${r.total} questions: ${stopped}`, runId));
    await db(() => run('UPDATE projects SET last_run_at = now() WHERE id = ?', projectId));
    if (r.done) { try { await db(() => autoReport(projectId)); } catch (e) { console.error('[report]', clean(e)); } }
    return;
  }
  const top = r.failed ? await db(() => get('SELECT error, COUNT(*) n FROM answers WHERE run_id = ? AND error IS NOT NULL GROUP BY error ORDER BY n DESC LIMIT 1', runId)) : null;
  const status = !r.done ? 'failed' : r.failed ? 'partial' : 'done';
  await db(() => run("UPDATE runs SET status = ?, message = ?, finished_at = now() WHERE id = ? AND status = 'running'",
    status, r.failed ? `${r.failed} of ${r.total} questions failed (Claude said: ${readable(top?.error)}). Run the check again to retry them. ChatGPT, Gemini and Perplexity are being connected; this check used Claude.` : null, runId));
  await db(() => run('UPDATE projects SET last_run_at = now() WHERE id = ?', projectId));
  if (r.done) { try { await db(() => autoReport(projectId)); } catch (e) { console.error('[report]', clean(e)); } }
}
