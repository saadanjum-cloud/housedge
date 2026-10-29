# Housedge — developer handover & security review brief

Prepared for an independent developer asked to review the app before it handles paying clients' data.
The owner is non-technical; please write findings in plain English with a severity and a suggested fix.
**No secrets are in this document or in the repository.** Ask the owner for access, never for values in chat.

---

## 1. What the product does

Housedge tracks what AI assistants (ChatGPT, Gemini, Perplexity, Claude) say about a company's brand.
The team creates a **client project** (brand, competitors, questions, markets), the app asks each question
through the providers' **official APIs** on a schedule, stores the answers, and calculates visibility,
position, sentiment, share of voice and cited sources. It also offers a website "AI readiness" check and a
fact check. It is run by the owner as a **done-for-you service**: clients do not log in.

- Public marketing site at `/` (plus `/privacy`, `/terms`, `/legal`), with a contact form.
- Private app behind sign-in for the owner's team.
- Production: Railway, single service + one persistent volume. Auto-deploys on push to the deploy branch.

## 2. Stack

| Part | Technology |
|---|---|
| Runtime | Node.js 22 (ESM), Express 4 |
| Database | SQLite via built-in `node:sqlite` (`DatabaseSync`), WAL mode, file on the volume (`DATA_DIR`) |
| Front end | React 18, Vite 6, Tailwind 3, Recharts 2, framer-motion, react-router-dom 7 |
| AI SDKs | `openai`, `@google/genai`, `@anthropic-ai/sdk`; Perplexity via `fetch` |
| Tests | `node --test` (`npm test`), Playwright used ad hoc for browser checks |
| Hosting | Railway, `Dockerfile` (node:22-slim), `railway.json` (health check `/healthz`) |

No other runtime dependencies (`npm ls --omit=dev` shows 5 packages). No external CDNs, fonts or analytics.

## 3. Repository map

```
server/
  index.js        Express app: middleware order, all API routes, CSV exports, static files, startup
  auth.js         Sessions (hashed tokens), login/setup/reset, invites, team routes, requireAuth/requireAdmin
  security.js     Security headers, https redirect, same-origin check, rate limiter, input validators, error handling
  config.js       Environment variable list, startup check (fail closed in production), redact()
  db.js           Schema (CREATE TABLE IF NOT EXISTS), small column migrations, helpers, backups (VACUUM INTO)
  migrations.js   One-time data migrations guarded by settings flags (token hashing, demo removal, seeding clients)
  runner.js       Runs checks: calls engines, stores answers, monthly spending cap, scheduler
  engines/        index.js (registry + price estimates), live.js (provider adapters), simulated.js (demo answers)
  analysis.js     Brand mention / position / sentiment detection (rule-based), source classification
  metrics.js      Aggregations for dashboards; parseFilter() validates query-string filters
  actions.js      "Suggested actions" built from metrics + readiness results
  reports.js      Frozen report snapshots
  sitecheck.js    Website AI-readiness check (reads 4 public files of the client's own site)
  safefetch.js    SSRF-safe HTTP GET used by sitecheck
  factcheck.js    Compares stored answers with client facts using Claude (structured JSON output)
  seed/           Question and brand libraries, demo data (only with SEED_DEMO=1)
  tests/          analysis, live (fake provider server), security, security-unit, geo
web/src/          React app (App.jsx routes, pages/*, lib.js API client, ui.jsx components)
docs/             GOING_LIVE.md, SECURITY.md (rotation runbook), this file
```

## 4. Running it locally

```
npm ci
npm run build
SETUP_CODE=<any 16+ chars> DATA_DIR=./data PORT=3000 npm start      # open http://localhost:3000
SEED_DEMO=1 ...                                                       # optional simulated demo clients
npm test                                                              # 50 tests, all passing at handover
```

Tests start throwaway servers with temporary databases. No network or real API keys are needed:
provider calls are tested against a local fake server, and fact checks use an injected fake client.

## 5. Configuration (names only)

Listed in `.env.example` and checked at startup by `server/config.js` (logs `NAME=set|missing|invalid`, never values).

| Variable | Notes |
|---|---|
| `SETUP_CODE` | **Required in production, ≥16 chars.** Creates the first admin; resets passwords. App refuses to start without it. |
| `KEY_OPENAI`, `KEY_GEMINI`, `KEY_PERPLEXITY`, `KEY_ANTHROPIC` | Optional; keys can instead be saved in Settings (stored in the DB — see §8). DB value wins over env. |
| `DATA_DIR` | Volume path (`/data` in Docker). |
| `NODE_ENV`, `PORT` | `production` set by the Dockerfile. |
| `SESSION_DAYS`, `REVOKE_SESSIONS_BEFORE`, `API_RATE_LIMIT_PER_MIN`, `ALLOWED_ORIGINS`, `SEED_DEMO` | Optional tuning / rotation. |
| `*_BASE_URL` (OpenAI/Anthropic/Gemini/Perplexity), `SITE_CHECK_ALLOW_PRIVATE` | **Test-only.** Production refuses to start if set (key exfiltration / SSRF risk). |

## 6. Data model (SQLite)

`users`, `sessions` (sha256 of token), `invites` (sha256 of token, 7-day expiry), `settings` (JSON key/values,
includes AI keys if saved in the UI, the data-API token, monthly cap, company details),
`projects`, `brands`, `prompts`, `runs`, `answers` (AI answer text, cost), `mentions`, `other_brands`,
`citations`, `reports`, `action_status`, `activities`, `enquiries` (public contact form: name, email, company,
message — personal data), `site_checks`, `project_facts`, `fact_findings`, `ai_spend`.

Personal data held: team accounts (name, email, password hash), website enquiries, anything users type into notes.
Retention rules are stated on `/privacy`.

## 7. Security model and controls in place

**Trust model.** One organisation. Every signed-in user sees every project (by design; no per-client tenancy).
Roles: `admin` and `member`. Admin-only: settings, AI keys, API token, invites/removals, backups, deleting
projects, go-live, "sign out everyone", key tests. The public can only reach: auth endpoints, `/api/legal`,
`/api/enquiries/new`, static files, `/healthz`.

**Middleware order** (`server/index.js`): startup check → `/healthz` → https redirect (prod) → security headers →
`/robots.txt` → same-origin check on `/api` → global API rate limit → JSON body parser (100 kB) →
cookie parser → auth wall → routes → `/api` 404 → error handler.

| Area | Control |
|---|---|
| Passwords | scrypt (salted), 8–200 chars, constant-time compare, dummy hash for unknown emails |
| Sessions | 32-byte random token in `sid` cookie (HttpOnly, SameSite=Strict, Secure in prod); DB stores sha256 only; 14-day expiry; password change ends other sessions; admin "sign out everyone"; `REVOKE_SESSIONS_BEFORE` |
| Brute force | per-IP 20/15 min on auth routes, per-account 8/15 min on login (in-memory limiter, swept every minute) |
| Setup / reset | require `SETUP_CODE` (timing-safe); setup only when no users exist |
| Authorization | `requireAdmin` on admin routes; invite links never listed (members see none; admins see ids only) |
| CSRF / CORS | no `Access-Control-Allow-*` headers; non-GET requests with a foreign `Origin` or `Sec-Fetch-Site: cross-site` rejected |
| Headers | CSP (`default-src 'self'`, no inline scripts, `object-src 'none'`, `frame-ancestors 'none'`), HSTS (prod), XFO DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP/CORP, `Cache-Control: no-store` on API |
| Input | `security.js` validators (type, length, enums, list sizes) on all write routes; query filters validated in `metrics.parseFilter` |
| SQL | parameterised statements everywhere; dynamic `IN (...)` lists built from placeholders only |
| Errors | own messages shown; unexpected errors (TypeError, SQLite, 5xx) logged with a reference id and hidden |
| Secrets in output | `redact()` strips key-like strings from logs, stored run messages and provider errors; startup log shows names only |
| AI cost | monthly cap enforced per request, counting in-flight requests (`reserved`); 20 runs/hour/user; 10 key tests/hour; fact checks count toward the cap and never re-check the same answer/fact |
| AI output | treated as untrusted: only http(s) citation URLs stored and rendered (`safeHttpUrl`, front-end `safeHref`); answers rendered as React text (no `dangerouslySetInnerHTML`); CSV formula injection escaped |
| Prompt injection | analysis is rule-based (no LLM acting on answers); fact check passes answers inside `<answer>` tags with a system instruction, JSON-schema output, **no tools** |
| SSRF | `safefetch.js`: http/https, ports 80/443, addresses validated at connect time via custom `lookup` (blocks private, loopback, link-local, CGNAT, multicast, reserved, IPv6 ULA/link-local, mapped v4), redirects re-validated, 10 s / 2 MB limits; site check only targets the domain saved on the client's own brand. Gemini redirect resolution only contacts `vertexaisearch.cloud.google.com` |
| Contact form | honeypot field, 5/hour per IP, length limits, consent required |

Automated coverage: `server/tests/security.test.js`, `security-unit.test.js`, `geo.test.js`.

## 8. Known gaps and accepted risks (please assess)

1. **AI provider keys saved in Settings are stored in plaintext** in SQLite on the Railway volume. Encryption with an env-held key was judged low value because the env store was the breached component — reviewer's view welcome.
2. **Data-API token in query string** (`/api/v1/...?key=`) because Google Sheets `IMPORTDATA` cannot send headers. Read-only; rotatable.
3. **Rate limits are in-memory** (reset on restart; single instance only). `trust proxy` is `1` — please confirm this matches Railway's proxy chain so `req.ip` is the real client.
4. **No tenant isolation.** Fine for the current service model; must change before clients get logins.
5. **No in-app 2FA, no email** (password reset needs `SETUP_CODE`; no notifications).
6. **Backups** are `VACUUM INTO` copies on the same volume (20 kept). Railway volume backups should be enabled.
7. **No monitoring/alerting** beyond Railway logs.
8. **Container runs as root** (left as-is to avoid volume permission issues on Railway).
9. **Build-time npm advisories** (Tailwind 3 chain: braces, micromatch, postcss-selector-parser). Not shipped at runtime (`npm prune --omit=dev`); fixing requires Tailwind 4.
10. Sentiment and mention detection are heuristic (accuracy, not security).

## 9. Requested review scope

Please prioritise, and report each finding as *severity · what · where · how to fix*:

1. **Authentication & sessions** (`auth.js`): login, setup, reset, invites, cookie flags, session revocation, timing.
2. **Authorization**: every route in `index.js`/`auth.js` — anything a `member` or an anonymous visitor can do that they shouldn't.
3. **SSRF** (`safefetch.js`, `sitecheck.js`, Gemini redirect in `engines/live.js`): DNS rebinding, IPv6, redirects, oversized/slow responses.
4. **Injection & XSS**: SQL building in `metrics.js`/`index.js`, rendering of AI answer text and links (`Chats.jsx`, `Sources.jsx`, `Actions.jsx`, `Readiness.jsx`), CSV exports.
5. **Spend abuse**: can a signed-in user (or a crafted answer) make the app exceed the monthly cap? (`runner.js`, `factcheck.js`).
6. **Secrets handling**: logs, error responses, `/api/settings` output for members vs admins, startup check.
7. **Deployment**: Dockerfile, `railway.json`, `trust proxy`, health check, behaviour when `SETUP_CODE` is missing.
8. **Dependencies**: `npm audit --omit=dev` and anything notable in the lockfile.
9. Recommendations for the gaps in §8, in order of value for cost.

**Out of scope:** load/DoS testing against production, social engineering, anything touching real client data.
**Test against a local copy** (§4). Do not run active tests against production without the owner's written OK.

## 10. Practical notes

- **Access:** the owner will add you to the GitHub repository (read access is enough for a review).
  Production access (Railway) is not needed for the review.
- **Deploy flow:** pushing to the deploy branch auto-deploys. Work on a separate branch; the owner approves deploys.
- **Data migrations** run on startup and are guarded by `settings` flags (`migr_*`); they must stay idempotent.
- **Front end** is a single-page app served from `dist/` by Express; the CSP forbids inline scripts (the theme script lives in `web/public/theme.js`).
- Related docs: `docs/SECURITY.md` (key rotation runbook), `docs/GOING_LIVE.md` (hosting setup), `README.md`.
