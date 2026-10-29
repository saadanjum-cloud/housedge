-- Security hardening: least-privilege table rights, closed-by-default for new tables, money tables writable only by
-- the server, per-client data API keys, one running check per project, and spending caps in settings.
-- Row-level security still decides which rows a person sees; these grants decide what they may try at all.

-- ---------------------------------------------------------------- per-client data API keys (replace the global key)
create table public.api_tokens (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs on delete cascade,
  token_hash text not null unique,           -- sha-256 of the key; the key itself is shown once and never stored
  hint text not null check (length(hint) <= 8),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index api_tokens_org on public.api_tokens (org_id);
create index api_tokens_created_by on public.api_tokens (created_by);
alter table public.api_tokens enable row level security;
create policy "admins read keys" on public.api_tokens for select to authenticated using ((select private.is_admin()));
delete from public.settings where key = 'api_token'; -- the old global key opened every client's data

-- ---------------------------------------------------------------- table rights: least privilege
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;     -- rows still filtered by row-level security
grant select on public.site_info to anon;                         -- legal page details only
-- Writes only where a person (client, team or admin) changes rows. Answers, mentions, citations, readings, runs,
-- spend, confusions, checks, findings, drafts, sign-ups, invites and keys are written only by the server.
grant insert, update, delete on public.projects, public.prompts, public.brands, public.brand_profiles, public.project_facts,
  public.action_status, public.interventions, public.outreach, public.reports, public.activities, public.org_health,
  public.settings, public.staff, public.org_members, public.orgs to authenticated;
grant insert, update on public.report_ratings to authenticated;
grant insert, delete on public.staff_access to authenticated;
grant update, delete on public.enquiries to authenticated;
grant update (full_name, job_title) on public.profiles to authenticated;
grant update on public.site_info to authenticated;
create policy "admins update site info" on public.site_info for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- Functions: nobody signed out; signed-in people only (all are security invoker, so row-level security applies).
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

-- New tables, views and functions start closed; each migration grants what it needs.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------- settings: admins only (spending caps, prices)
alter policy "team reads settings" on public.settings using ((select private.is_admin()));

-- ---------------------------------------------------------------- one running check per project
-- Two "Run now" clicks at the same moment cannot start two paid checks.
create unique index runs_one_running on public.runs (project_id) where status = 'running';

-- ---------------------------------------------------------------- spending caps (Settings -> Costs & limits)
-- monthly_cap: all AI spend across every client this month. trial_daily_cap: all AI spend today by self-signed-up
-- clients without a fee (so bulk sign-ups cannot run up a bill). USD. Existing values are kept.
insert into public.settings (key, value) values ('monthly_cap', '300'::jsonb), ('trial_daily_cap', '20'::jsonb)
on conflict (key) do update set value = excluded.value where coalesce(nullif(settings.value #>> '{}', '')::numeric, 0) <= 0;
