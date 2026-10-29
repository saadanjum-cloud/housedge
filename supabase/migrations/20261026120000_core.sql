-- Housedge core schema on Supabase.
-- Tenancy: every client company is an org. Every data row carries org_id, so one rule protects everything:
--   your team (staff) sees all orgs; a client user sees only the orgs they are a member of.
-- Rows written by the AI pipeline (runs, answers, readings, spend) are written by Edge Functions with the
-- service role only; signed-in users can read them but never write them.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------- people and companies
create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 160),
  website text check (length(website) <= 200),
  country text check (length(country) <= 60),
  industry text check (length(industry) <= 120),
  monthly_budget numeric(10,2) not null default 0 check (monthly_budget >= 0 and monthly_budget <= 100000),
  fee numeric(12,2) check (fee >= 0),
  currency text not null default 'EUR' check (currency in ('EUR', 'USD', 'GBP', 'SEK')),
  onboarded_at timestamptz,
  created_at timestamptz not null default now()
);

-- Your team's private view of each client. Clients never see this table.
create table public.org_health (
  org_id uuid primary key references public.orgs on delete cascade,
  health text not null default 'good' check (health in ('good', 'at_risk', 'churning')),
  note text check (length(note) <= 2000),
  updated_by uuid references auth.users on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

create table public.staff (
  user_id uuid primary key references auth.users on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.orgs on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user on public.org_members (user_id);

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text check (length(full_name) <= 120),
  job_title text check (length(job_title) <= 120),
  created_at timestamptz not null default now()
);

-- Invite links: only a hash of the token is stored. org_id null = an invite to your own team.
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 200),
  org_id uuid references public.orgs on delete cascade,
  role text not null check (role in ('admin', 'member', 'owner')),
  invited_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz
);

-- ---------------------------------------------------------------- access helpers (not exposed through the API)
create function private.is_staff() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff where user_id = (select auth.uid()))
$$;
create function private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff where user_id = (select auth.uid()) and role = 'admin')
$$;
create function private.my_orgs() returns setof uuid language sql stable security definer set search_path = '' as $$
  select org_id from public.org_members where user_id = (select auth.uid())
$$;
-- Trusted backend: Edge Functions using the service role, or a direct database session (migrations, the
-- dashboard SQL editor). Requests from browsers always carry an authenticated/anon JWT and are never trusted.
create function private.is_trusted() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'role'), 'service_role') = 'service_role'
$$;
grant execute on function private.is_staff(), private.is_admin(), private.my_orgs(), private.is_trusted() to authenticated;

-- Child rows take org_id from their project, so a client can never file a row under another company.
create function private.org_from_project() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select org_id into new.org_id from public.projects where id = new.project_id;
  if new.org_id is null then raise exception 'Unknown project'; end if;
  return new;
end $$;

-- ---------------------------------------------------------------- projects (one tracked brand set per client project)
create table public.projects (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs on delete cascade,
  name text not null check (length(name) between 1 and 120),
  category text not null default 'business',
  data_mode text not null default 'live' check (data_mode in ('live', 'simulated')),
  engines text[] not null default '{chatgpt,gemini,perplexity,claude}' check (engines <@ array['chatgpt', 'gemini', 'perplexity', 'claude']),
  countries text[] not null default '{FI}' check (cardinality(countries) between 1 and 10),
  frequency text not null default 'weekly' check (frequency in ('daily', 'every3', 'weekly', 'manual')),
  discovery jsonb not null default '{}' check (length(discovery::text) <= 50000),
  created_at timestamptz not null default now(),
  last_run_at timestamptz
);
create index projects_org on public.projects (org_id);

create table public.brands (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs on delete cascade,
  project_id bigint not null references public.projects on delete cascade,
  name text not null check (length(name) between 1 and 120),
  domain text check (length(domain) <= 200),
  aliases text[] not null default '{}' check (cardinality(aliases) <= 20),
  is_own boolean not null default false,
  color text,
  created_at timestamptz not null default now()
);
create index brands_project on public.brands (project_id);
create unique index brands_one_own on public.brands (project_id) where is_own;

create table public.prompts (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs on delete cascade,
  project_id bigint not null references public.projects on delete cascade,
  text text not null check (length(text) between 1 and 500),
  topic text check (length(topic) <= 80),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  country text not null default 'GLOBAL',
  language text not null default 'en',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index prompts_project on public.prompts (project_id);

-- ---------------------------------------------------------------- AI pipeline output (service role writes only)
create table public.runs (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs on delete cascade,
  project_id bigint not null references public.projects on delete cascade,
  trigger text not null check (trigger in ('manual', 'scheduled', 'first')),
  status text not null default 'running' check (status in ('running', 'waiting', 'done', 'partial', 'failed')),
  simulated boolean not null default false,
  started_at timestamptz not null default now(), finished_at timestamptz,
  total int not null default 0, done int not null default 0, failed int not null default 0,
  cost numeric(12,6) not null default 0, message text,
  requested_by uuid references auth.users on delete set null
);
create index runs_project on public.runs (project_id, id desc);

create table public.answers (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs on delete cascade,
  project_id bigint not null references public.projects on delete cascade,
  run_id bigint references public.runs on delete cascade,
  prompt_id bigint not null references public.prompts on delete cascade,
  engine text not null, day date not null, text text, model text,
  simulated boolean not null default false,
  cost numeric(12,6) not null default 0, in_tokens int, out_tokens int, searches int,
  error text, created_at timestamptz not null default now()
);
create index answers_project_day on public.answers (project_id, day);
create index answers_org_created on public.answers (org_id, created_at);

create table public.mentions (
  id bigint generated always as identity primary key,
  org_id uuid not null, project_id bigint not null,
  answer_id bigint not null references public.answers on delete cascade,
  brand_id bigint not null references public.brands on delete cascade,
  position int, sentiment int, snippet text
);
create index mentions_answer on public.mentions (answer_id);
create index mentions_project_brand on public.mentions (project_id, brand_id);

create table public.other_brands (
  org_id uuid not null, project_id bigint not null,
  answer_id bigint not null references public.answers on delete cascade,
  name text not null
);
create index other_brands_project on public.other_brands (project_id, name);

create table public.citations (
  id bigint generated always as identity primary key,
  org_id uuid not null, project_id bigint not null,
  answer_id bigint not null references public.answers on delete cascade,
  url text, domain text, title text, category text
);
create index citations_answer on public.citations (answer_id);
create index citations_project_domain on public.citations (project_id, domain);

create table public.extractions (
  answer_id bigint primary key references public.answers on delete cascade,
  org_id uuid not null, project_id bigint not null,
  version int not null, model text, data jsonb not null,
  dropped int not null default 0, disagreement boolean not null default false,
  cost numeric(12,6) not null default 0, in_tokens int, out_tokens int,
  created_at timestamptz not null default now()
);

create table public.batches (
  id text primary key,
  org_id uuid not null references public.orgs on delete cascade,
  project_id bigint not null references public.projects on delete cascade,
  run_id bigint not null references public.runs on delete cascade,
  engine text not null, model text not null, day date not null, questions jsonb not null,
  est_cost numeric(12,6) not null, status text not null default 'pending' check (status in ('pending', 'done')),
  created_at timestamptz not null default now(), finished_at timestamptz
);

-- Money spent on AI calls that are not answers (readings, fact checks, drafts, key tests). org_id null = company overhead.
create table public.ai_spend (
  id bigint generated always as identity primary key,
  org_id uuid references public.orgs on delete cascade,
  project_id bigint references public.projects on delete cascade,
  kind text not null, model text, cost numeric(12,6) not null default 0, in_tokens int, out_tokens int,
  created_at timestamptz not null default now()
);
create index ai_spend_org_created on public.ai_spend (org_id, created_at);

create table public.reports (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs on delete cascade,
  project_id bigint not null references public.projects on delete cascade,
  title text not null, kind text not null default 'periodic', auto boolean not null default false,
  period_start date, period_end date, simulated boolean not null default false,
  schema_version int not null default 1, data jsonb not null,
  created_at timestamptz not null default now()
);
create index reports_project on public.reports (project_id, created_at desc);

create table public.report_ratings (
  report_id bigint not null references public.reports on delete cascade,
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  org_id uuid not null references public.orgs on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text check (length(comment) <= 2000),
  created_at timestamptz not null default now(),
  primary key (report_id, user_id)
);

create table public.site_checks (
  id bigint generated always as identity primary key,
  org_id uuid not null, project_id bigint not null references public.projects on delete cascade,
  url text not null, score int, results jsonb not null, created_at timestamptz not null default now()
);

create table public.fact_findings (
  answer_id bigint not null references public.answers on delete cascade,
  fact_id bigint not null,
  org_id uuid not null, project_id bigint not null,
  verdict text not null check (verdict in ('contradicts', 'supports', 'not_mentioned')),
  quote text, explanation text, checked_at timestamptz not null default now(),
  primary key (answer_id, fact_id)
);

create table public.drafts (
  id bigint generated always as identity primary key,
  org_id uuid not null, project_id bigint not null references public.projects on delete cascade,
  kind text not null, title text, body text, model text, cost numeric(12,6), created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- client-editable project details
create table public.project_facts (
  id bigint generated always as identity primary key,
  org_id uuid not null, project_id bigint not null references public.projects on delete cascade,
  text text not null check (length(text) between 1 and 300),
  created_at timestamptz not null default now()
);
alter table public.fact_findings add foreign key (fact_id) references public.project_facts on delete cascade;

create table public.brand_profiles (
  project_id bigint primary key references public.projects on delete cascade,
  org_id uuid not null,
  data jsonb not null default '{}' check (length(data::text) <= 20000),
  updated_at timestamptz not null default now()
);

create table public.action_status (
  org_id uuid not null, project_id bigint not null references public.projects on delete cascade,
  key text not null check (length(key) <= 200), title text check (length(title) <= 300),
  status text not null check (status in ('open', 'planned', 'done', 'dismissed')),
  note text check (length(note) <= 2000), updated_at timestamptz not null default now(),
  primary key (project_id, key)
);

-- ---------------------------------------------------------------- your team only
create table public.activities (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs on delete cascade,
  type text not null default 'task' check (type in ('call', 'meeting', 'email', 'task', 'report')),
  title text not null check (length(title) between 1 and 200),
  due_at timestamptz, done_at timestamptz, note text check (length(note) <= 2000),
  created_by uuid references auth.users on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.enquiries (
  id bigint generated always as identity primary key,
  name text not null, email text not null, company text, role text, markets text, message text,
  status text not null default 'new' check (status in ('new', 'contacted', 'won', 'closed')),
  created_at timestamptz not null default now()
);

-- Global settings (models, prices, run hour). AI provider keys are NOT stored here: they are Edge Function secrets.
create table public.settings (key text primary key, value jsonb not null);

-- Company details shown on the public legal pages: readable by anyone.
create table public.site_info (id int primary key default 1 check (id = 1), company jsonb not null default '{}', updated_at timestamptz not null default now());
insert into public.site_info default values;

-- ---------------------------------------------------------------- org_id is always derived from the project
do $$ declare t text; begin
  foreach t in array array['brands', 'prompts', 'runs', 'answers', 'mentions', 'other_brands', 'citations', 'extractions', 'batches',
    'reports', 'site_checks', 'fact_findings', 'drafts', 'project_facts', 'brand_profiles', 'action_status'] loop
    execute format('create trigger set_org before insert or update of project_id on public.%I for each row execute function private.org_from_project()', t);
  end loop;
end $$;

-- report_ratings take org_id from the report
create function private.org_from_report() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select org_id into new.org_id from public.reports where id = new.report_id;
  if new.org_id is null then raise exception 'Unknown report'; end if;
  new.user_id := (select auth.uid());
  return new;
end $$;
create trigger set_org before insert or update on public.report_ratings for each row execute function private.org_from_report();

-- Columns only your team may change.
create function private.guard_org() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not (private.is_staff() or private.is_trusted()) and (new.monthly_budget is distinct from old.monthly_budget
     or new.fee is distinct from old.fee or new.currency is distinct from old.currency) then
    raise exception 'Only the Housedge team can change the budget or fee.';
  end if;
  return new;
end $$;
create trigger guard before update on public.orgs for each row execute function private.guard_org();

create function private.guard_project() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not (private.is_staff() or private.is_trusted()) and (new.org_id is distinct from old.org_id or new.data_mode is distinct from old.data_mode or new.last_run_at is distinct from old.last_run_at) then
    raise exception 'Only the Housedge team can change this.';
  end if;
  return new;
end $$;
create trigger guard before update on public.projects for each row execute function private.guard_project();

-- ---------------------------------------------------------------- row level security
do $$ declare t text; begin
  foreach t in array array['orgs', 'org_health', 'staff', 'org_members', 'profiles', 'invites', 'projects', 'brands', 'prompts', 'runs', 'answers', 'mentions',
    'other_brands', 'citations', 'extractions', 'batches', 'ai_spend', 'reports', 'report_ratings', 'site_checks', 'fact_findings', 'drafts',
    'project_facts', 'brand_profiles', 'action_status', 'activities', 'enquiries', 'settings', 'site_info'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Read: your team sees everything; a client sees its own orgs' rows.
do $$ declare t text; begin
  foreach t in array array['projects', 'brands', 'prompts', 'runs', 'answers', 'mentions', 'other_brands', 'citations', 'extractions',
    'batches', 'ai_spend', 'reports', 'report_ratings', 'site_checks', 'fact_findings', 'drafts', 'project_facts', 'brand_profiles', 'action_status'] loop
    execute format('create policy "read own org" on public.%I for select to authenticated using ((select private.is_staff()) or org_id in (select private.my_orgs()))', t);
  end loop;
end $$;

-- Write: clients edit their own project setup ("view and edit everything"); your team edits anything.
do $$ declare t text; begin
  foreach t in array array['brands', 'prompts', 'project_facts', 'brand_profiles', 'action_status'] loop
    execute format('create policy "edit own org" on public.%I for all to authenticated using ((select private.is_staff()) or org_id in (select private.my_orgs())) with check ((select private.is_staff()) or org_id in (select private.my_orgs()))', t);
  end loop;
end $$;
create policy "create in own org" on public.projects for insert to authenticated with check ((select private.is_staff()) or org_id in (select private.my_orgs()));
create policy "edit own org" on public.projects for update to authenticated using ((select private.is_staff()) or org_id in (select private.my_orgs()));
create policy "team deletes projects" on public.projects for delete to authenticated using ((select private.is_admin()));
create policy "rate own reports" on public.report_ratings for insert to authenticated with check (org_id in (select private.my_orgs()) and user_id = (select auth.uid()));
create policy "change own rating" on public.report_ratings for update to authenticated using (user_id = (select auth.uid()));
create policy "team manages reports" on public.reports for all to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));

-- Orgs: clients see and edit their own company (budget/fee/health guarded by trigger); the team sees all; admins create/delete.
create policy "read orgs" on public.orgs for select to authenticated using ((select private.is_staff()) or id in (select private.my_orgs()));
create policy "edit orgs" on public.orgs for update to authenticated using ((select private.is_staff()) or id in (select private.my_orgs()));
create policy "admins create orgs" on public.orgs for insert to authenticated with check ((select private.is_admin()));
create policy "admins delete orgs" on public.orgs for delete to authenticated using ((select private.is_admin()));

-- Memberships and people: see your own company's members; the team sees all.
create policy "read members" on public.org_members for select to authenticated using ((select private.is_staff()) or org_id in (select private.my_orgs()));
create policy "admins manage members" on public.org_members for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "read profiles" on public.profiles for select to authenticated using (
  id = (select auth.uid()) or (select private.is_staff())
  or id in (select m.user_id from public.org_members m where m.org_id in (select private.my_orgs())));
create policy "edit own profile" on public.profiles for update to authenticated using (id = (select auth.uid()));
create policy "read staff" on public.staff for select to authenticated using ((select private.is_staff()) or user_id = (select auth.uid()));
create policy "admins manage staff" on public.staff for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- Team-only tables.
create policy "team manages health" on public.org_health for all to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy "team reads invites" on public.invites for select to authenticated using ((select private.is_admin()));
create policy "team activities" on public.activities for all to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy "team enquiries" on public.enquiries for select to authenticated using ((select private.is_staff()));
create policy "team updates enquiries" on public.enquiries for update to authenticated using ((select private.is_staff()));
create policy "admins delete enquiries" on public.enquiries for delete to authenticated using ((select private.is_admin()));
create policy "team reads settings" on public.settings for select to authenticated using ((select private.is_staff()));
create policy "admins write settings" on public.settings for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "anyone reads site info" on public.site_info for select to anon, authenticated using (true);
create policy "admins edit site info" on public.site_info for update to authenticated using ((select private.is_admin()));

-- Pipeline tables (runs, answers, readings, spend, batches...) have NO insert/update/delete policies:
-- only Edge Functions using the service role (which bypasses RLS) can write them.

-- ---------------------------------------------------------------- spending
-- What an org spent this calendar month (UTC), including batches still being answered.
create function public.org_month_spend(p_org uuid) returns numeric language sql stable security definer set search_path = '' as $$
  select case when (select private.is_trusted()) or (select private.is_staff()) or p_org in (select private.my_orgs()) then
    coalesce((select sum(cost) from public.answers where org_id = p_org and created_at >= date_trunc('month', now() at time zone 'utc')), 0)
    + coalesce((select sum(cost) from public.ai_spend where org_id = p_org and created_at >= date_trunc('month', now() at time zone 'utc')), 0)
    + coalesce((select sum(est_cost) from public.batches where org_id = p_org and status = 'pending'), 0)
  end
$$;

-- ---------------------------------------------------------------- admin overview (one row per client company)
-- Team only: the where clause returns nothing to client users even though they can read their own org row.
create view public.admin_clients with (security_invoker = true) as
select o.id, o.name, o.website, coalesce(h.health, 'good') as health, h.note as health_note, h.updated_at as health_updated_at,
  o.monthly_budget, o.fee, o.currency, o.onboarded_at, o.created_at,
  (select count(*) from public.org_members m where m.org_id = o.id) as members,
  (select count(*) from public.projects p where p.org_id = o.id) as projects,
  (select count(*) from public.prompts q where q.org_id = o.id and q.active) as active_questions,
  (select count(*) from public.answers a where a.org_id = o.id and a.error is null and a.created_at >= date_trunc('month', now() at time zone 'utc')) as answers_month,
  public.org_month_spend(o.id) as spend_month,
  (select coalesce(sum(a.in_tokens), 0) + coalesce(sum(a.out_tokens), 0) from public.answers a where a.org_id = o.id and a.created_at >= date_trunc('month', now() at time zone 'utc'))
    + (select coalesce(sum(s.in_tokens), 0) + coalesce(sum(s.out_tokens), 0) from public.ai_spend s where s.org_id = o.id and s.created_at >= date_trunc('month', now() at time zone 'utc')) as tokens_month,
  (select coalesce(sum(a.cost), 0) from public.answers a where a.org_id = o.id) + (select coalesce(sum(s.cost), 0) from public.ai_spend s where s.org_id = o.id) as spend_total,
  (select max(r.started_at) from public.runs r where r.org_id = o.id) as last_run_at,
  (select round(avg(rr.rating), 1) from public.report_ratings rr where rr.org_id = o.id) as avg_rating,
  (select count(*) from public.report_ratings rr where rr.org_id = o.id) as ratings,
  (select rr.comment from public.report_ratings rr where rr.org_id = o.id and rr.comment is not null order by rr.created_at desc limit 1) as last_comment
from public.orgs o left join public.org_health h on h.org_id = o.id
where (select private.is_staff());

-- ---------------------------------------------------------------- grants: anonymous visitors get nothing but the legal page details
revoke all on all tables in schema public from anon;
grant select on public.site_info to anon;
revoke all on function public.org_month_spend(uuid) from anon, public;
grant execute on function public.org_month_spend(uuid) to authenticated;
