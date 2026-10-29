# Architecture review: coupling, leaks, and the path to Supabase

Written for the CTO. Method: the same three questions the *modularity* review asks (which knowledge is
encapsulated, which leaks across boundaries, where a change cascades), done by hand on this codebase
because that plugin is licensed non-commercial. Facts come from reading every server module, the
front-end shell and API client, an import-cycle scan (`madge`), and the test suite (67 tests, all passing).

Scope: 3,400 lines of server code in 22 modules, 4,200 lines of React in 20 files, 79 HTTP routes,
56 distinct API paths called by the front end, one SQLite database with 20 tables.

## 1. Verdict in three lines

The code is small, readable and well tested, and its security layer is better than most early products.
Its structure is a **single-process monolith**: in-memory job state, in-memory rate limits, a scheduler on
`setInterval`, one 636-line route file, and SQL spread across 13 modules. None of that survives serverless.
The move to Supabase is therefore a restructuring, not a port, and the restructuring should start in the
current repo *before* any Supabase code is written, because it de-risks the migration and is useful on its own.

## 2. Findings, ranked by how far a change cascades

| # | Finding | Where | Cascade risk | Fix |
|---|---|---|---|---|
| 1 | **Four import cycles** through `runner.js`: `runner → extract → claude → runner`, `factcheck → runner`, `actions → factcheck → runner → reports`, `runner → reports`. Root cause: the spending cap (`monthSpend`, `reserved`) lives inside the runner, and every paid helper imports it; the runner then dynamic-imports the helpers back to run them after a check. | `runner.js` 54-64, 176-185; `claude.js` 6; `factcheck.js` 7 | High. Any change to the cap or to post-run hooks touches five modules; load order is fragile; a serverless worker cannot hold `reserved` in memory at all. | Move the cap to `spend.js` (nothing imports the runner for it). Make post-run steps an explicit list wired in `index.js`. In Postgres the cap becomes one SQL function with a row lock. |
| 2 | **Schema knowledge in 13 files.** Raw SQL in every module; 65 SQLite-specific idioms (`datetime('now')`, `json_each`, `group_concat`, `lastInsertRowid`, `rowid`, `VACUUM INTO`). | all of `server/` | High. A column rename is a repo-wide edit. The Postgres move touches every file. | Not an ORM. Group queries by aggregate into data modules (`answers.js`, `projects.js`, `readings.js`, `settings.js`) so the dialect lives in one layer. Do this in SQLite first; swap the layer second. |
| 3 | **The `settings` key/value table is untyped global state.** 11 keys read ad hoc; `prices` read in 7 places, `monthly_cap` in 6. AI keys stored here in plaintext. No validation on read. | `db.js` `getSetting`, callers everywhere | Medium-high. A renamed key fails silently (returns the fallback). Secrets sit in the same row family as the company address. | One `settings.js` with named, validated getters. Secrets leave the table entirely (host env now; Supabase Vault / function secrets later). |
| 4 | **`index.js` is a god module.** 66 routes + input validators + CSV export + project-card assembly + settings view + migrations call + scheduler start in one file. | `index.js` | Medium. Every feature edits the same file; review diffs are noisy; it cannot be split into functions later without first being split into files now. | Split by resource: `routes/projects.js`, `prompts.js`, `brands.js`, `metrics.js`, `exports.js`, `settings.js`, `public.js`. Each file later maps to one Edge Function or one RPC group. |
| 5 | **Two readings write the same column with two meanings.** `mentions.position` is "order of first mention" when written by `analysis.js` and "rank in a ranked list, else null" when written by `extract.js`. Dashboards average it. | `runner.storeAnalysis`, `extract.applyReading`, `metrics.brandStats` | Medium while both run. Averages mix incompatible numbers. | After the answer-key test passes: make the extractor the only writer, keep `analysis.nameRegex` only as the cross-check, delete the word lists and the brand library. Until then, show which reading produced a project's numbers. |
| 6 | **Industry knowledge leaks into the analysis layer.** `analysis.js` imports the iGaming `BRAND_LIBRARY`; `DOMAIN_TYPES` hard-codes casino review sites; `CASE_SENSITIVE_ALIASES` names specific brands. | `analysis.js` 2, 22, 145-160 | Medium. "Open to any business" is a product claim the code does not yet keep for source classification and competitor suggestions. | Extractor already removes the brand library from mention detection. Source classification: one cached AI call per new domain (`domain_types` table), same algorithm for every industry. |
| 7 | **Everything assumes one process.** `running` Map, `reserved` counter, three in-memory rate limiters, `setInterval` scheduler, backups via `VACUUM INTO` on the same disk. | `runner.js`, `security.js`, `index.js` 630-633 | High for the migration; low today. | Replace with tables: `runs` + `run_jobs` as the queue, `rate_limits` table or Supabase's built-in auth limits, `pg_cron` for the schedule. Backups: Supabase's own (Pro). |
| 8 | **Reports freeze an undeclared shape.** `reports.data` stores whatever `metrics.summary()` returned at the time, with no schema version. | `reports.js`, `index.js` 452-457 reads `r.data.summary.brands` | Medium, grows with time. Any change to `summary()` can make a year-old report unreadable in the UI. | Add `schema_version` to report data; keep a reader per version. Cheap now, painful later. (I read `reports.js` only partially; confirm.) |
| 9 | **Front end binds to 56 endpoint shapes with no contract.** `api(path)` returns untyped JSON; each page knows its response shape. | `web/src/lib.js`, every page | Medium. Fine for one team; in the Supabase move most reads become views/RPC, so pages change anyway. | Define the read models first (§4), then point pages at them. One change, not two. |
| 10 | **Prompt-dependent engine adapters.** `live.js` per-engine code is cleanly separated; the pricing and model names live in `engines/index.js`. | `engines/` | Low. This is the best-shaped module; keep it as is. | Port as a shared Deno library. |

What is already right and should be kept: parameterised SQL everywhere; `security.js` validators at every
write; the SSRF guard; the test style (fake providers, temp databases); readings stored separately from
their resolution (new); the honest handling of unsupported engines.

## 3. Target architecture on Supabase + Vercel

```
Vercel (static React)  ──supabase-js──►  Supabase
                                          ├─ Auth (email+password, MFA)      ← replaces auth.js
                                          ├─ Postgres + RLS                  ← replaces db.js, metrics.js (as views/RPC)
                                          │    tables: orgs, members, projects, brands, prompts, runs, run_jobs,
                                          │            answers, answer_readings, mentions, citations, reports,
                                          │            site_checks, facts, fact_findings, drafts, enquiries,
                                          │            org_settings, api_tokens, rate_limits, domain_types
                                          ├─ pg_cron  ─► enqueue due runs    ← replaces startScheduler
                                          ├─ Edge Functions (Deno)
                                          │    run-worker   (claims N jobs, calls engines, stores, re-invokes until empty)
                                          │    read-answer  (extractor; or inside run-worker)
                                          │    fact-check, site-check, write-draft, key-test
                                          │    export       (CSV + token API for Google Sheets)
                                          │    enquiry      (public contact form)
                                          └─ Vault / function secrets         ← AI keys, never in a table
```

Key design rules:

- **`org_id` on every table from day one**, even with one org. Client logins later become an RLS policy,
  not a schema migration. Policies now: members of the org read everything in it; `admin` role writes
  settings, keys, deletes; `service_role` (functions) bypasses.
- **The spending cap is one SQL function** (`reserve_spend(org, estimate) returns boolean`) that locks the
  org's spend row, so parallel workers cannot overshoot. Same logic as today's `reserved`, but durable.
- **Jobs, not runs, are the unit of work.** `run_jobs(run_id, prompt_id, engine, status, claimed_at,
  attempts)`. A worker claims up to ~20 jobs with `FOR UPDATE SKIP LOCKED`, finishes within the function
  time limit (150 s free, 400 s Pro), then re-invokes itself if jobs remain. Crash-safe: a claimed job
  older than 10 minutes is reclaimed.
- **Metrics become SQL.** `summary`, `daily`, `sources`, `prompt_table` are joins and group-bys today;
  as Postgres functions they run next to the data and return the same JSON. The React pages keep their
  shapes. Wilson intervals (`stats.js`) are two lines of SQL.
- **SSRF guard must be rebuilt for Deno.** `safefetch.js` validates addresses at connect time through a
  custom DNS lookup; Deno's `fetch` has no hook for that. Resolve with `Deno.resolveDns`, reject private
  ranges, then connect to the IP with a `Host` header, and re-check on every redirect. This is the one
  security control that does not port by translation.
- **Exports keep the token-in-URL path** (Google Sheets needs it) but tokens move to an `api_tokens`
  table (hashed, per org, revocable), checked inside the `export` function.
- **Rate limits**: auth limits are Supabase's own; the contact form and run-now use a small
  `rate_limits(key, window_start, count)` table. In-memory limiters go.

What stays as-is in spirit: engine adapters, extractor, fact check, site check, optimise generators,
report snapshots (with a schema version), the React pages.

## 4. Order of work

Each phase ships on its own and reduces the risk of the next.

| Phase | Work | Why first | Size |
|---|---|---|---|
| 0. Untangle in place | `spend.js`; `settings.js` with named getters; split `index.js` by resource; data modules per aggregate; `schema_version` on reports; secrets out of `settings` | Breaks the cycles and gathers the SQL into one layer. All tests keep passing. Useful even if Supabase never happens. | 2-3 days |
| 1. Schema + RLS + tests | Supabase project (local CLI first), tables with `org_id`, policies, `reserve_spend`, `claim_jobs`; tests that act as anonymous, member, admin and try forbidden reads/writes | Security is proven before any feature code depends on it | 3-4 days |
| 2. Auth | Supabase Auth, `members` table with role, invite via Auth, MFA on for admins; retire `auth.js` | Everything else needs a user id and role | 2 days |
| 3. Read models | Views/RPC for summary, daily, engines, countries, sources, chats, prompt table, project card; React pages read them through supabase-js | Dashboards work on the new DB before any AI call is moved | 3-4 days |
| 4. Worker + schedule | `run-worker`, `pg_cron`, cap, key-test | The paid path, now durable and crash-safe | 3-4 days |
| 5. Helpers | extractor, fact check, site check (new SSRF guard), drafts, export, enquiry, legal | Independent functions, one at a time | 3-4 days |
| 6. Cut over | Script copies SQLite → Postgres (ids preserved); run both for a week; compare numbers; switch DNS; keep the Railway volume backup for 90 days | A measured switch, with a way back | 2 days + 1 week dual run |

Roughly four working weeks for one person who knows the code, not counting the accuracy answer key
(separate track, see `ACCURACY.md`). Estimates assume Supabase Pro (free pauses after 7 idle days and
has no backups, which rules it out for client data).

## 5. Decisions needed from the owners

1. **Supabase plan**: Pro ($25/month) before any client data. Free for building only.
2. **Front-end host**: Vercel Hobby forbids commercial use as far as I know; budget the Pro plan or use
   Cloudflare Pages / Netlify, whose free plans allow it.
3. **Client logins, yes or no, and when.** Changes nothing in Phase 1 if `org_id` is in from the start;
   changes the RLS policies and adds a client role later.
4. **Who labels the 150-answer key** (the accuracy track runs in parallel and is the longer pole for
   the product claim).
