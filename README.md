# Housedge

Housedge shows brands what AI assistants (ChatGPT, Claude, Gemini, Perplexity) tell their customers about them, who gets recommended instead and why, and what to change. It measures and advises; it never tries to manipulate answers.

Live: https://www.housedge.eu · App: https://www.housedge.eu/login · Team: https://www.housedge.eu/admin/login

## How it is built

| Part | Where | Runs on |
|---|---|---|
| Web app (React + Vite + Tailwind) | `web/` | Vercel, deployed automatically on every push to `main` |
| Public info pages (plain HTML, no JavaScript needed) | `web/public/*.html` | Vercel, same deploy |
| API, AI checks, MCP server | `supabase/functions/api/` | Supabase Edge Function `api` (eu-west-1) |
| Sign-up, invites, first setup | `supabase/functions/join/` | Supabase Edge Function `join` |
| Admin-only account actions | `supabase/functions/team/` | Supabase Edge Function `team` |
| Database schema, row-level security, schedule | `supabase/migrations/` | Supabase Postgres |

The browser calls `/api/...`; Vercel forwards that to the `api` function (see `vercel.json`). Every request runs as the signed-in person inside one database transaction, and row-level security decides what they can see. AI keys live only as Supabase function secrets.

## Run it locally

Prerequisites: Node 20+, a Supabase account with access to the project, `gh` (optional, for pushing).

```bash
git clone https://github.com/saadanjum-cloud/housedge.git && cd housedge
npm install
cp web/.env.example web/.env.local     # fill in the two public values
cp .env.example .env                   # fill in the server-side values (never commit this file)
npm run dev                            # http://localhost:5173, talking to the real backend
```

`web/.env.local` holds the Supabase URL and the publishable key (both public by design). `.env` holds the values the deploy and test scripts need; ask an admin for them, and keep them out of chat, screenshots and git. `.gitignore` already excludes both files.

The web app in development talks to the **production** backend, so sign in with a test account, not a client's.

## Deploy

The web app deploys itself: push to `main` and Vercel builds `web/` into `dist/`. `main` has a pull-request rule; repo owners can bypass it, everyone else opens a PR.

Backend changes are deployed by hand:

```bash
set -a; . ./.env; set +a
# database change (a new file in supabase/migrations/, applied once, in order)
node supabase/tests/run.mjs supabase/migrations/<file>.sql
# functions (only the ones you changed)
npx -y supabase functions deploy api  --project-ref $SUPABASE_PROJECT_REF --use-api --no-verify-jwt
npx -y supabase functions deploy join --project-ref $SUPABASE_PROJECT_REF --use-api --no-verify-jwt
npx -y supabase functions deploy team --project-ref $SUPABASE_PROJECT_REF --use-api --no-verify-jwt
```

`--no-verify-jwt` is intended: the functions check the sign-in token themselves (public routes such as the contact form and the sign-in state need no token). Secrets are set in Supabase → Edge Functions → Secrets, never in code.

## Tests

```bash
set -a; . ./.env; set +a
npm run test:rls      # row-level security: who can read and change what (runs in a transaction, rolls back)
npm run test:api      # API routes end to end against the live backend
npm run test:auth     # sign-up, invite and sign-in flows
deno run -A --node-modules-dir=none --no-lock supabase/tests/mcp.mjs   # MCP server protocol check, no database needed
```

Run `test:rls` after any migration that touches policies.

## Connected apps (MCP)

`https://www.housedge.eu/mcp` is an MCP server: clients use their Housedge data inside Claude, ChatGPT, Cursor and Claude Code. Sign-in is OAuth through Supabase Auth; the approval page is `/oauth/consent`. Tokens issued to connected apps work only on `/mcp`. Tool list and rules: `supabase/functions/api/mcp.js`.

## Working rules

- Never commit `.env`, `web/.env.local`, keys, passwords or client data. Templates are `.env.example` and `web/.env.example`.
- Every route that changes data goes through the API's own checks and the spending locks in `supabase/functions/api/spend.js`; do not add direct database writes from the browser.
- Collected AI answers are untrusted text: keep them inside `<untrusted_ai_answer>` when they reach a model.
- No emojis in the product. Recommend only honest actions to clients.
