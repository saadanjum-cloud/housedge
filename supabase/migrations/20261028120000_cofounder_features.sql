-- Ports of features built on the old server (look-alike filter, outreach tracking, per-client team access).

-- ---------------------------------------------------------------- per-client access for team members
-- Admins see every client. A team member (staff role 'member') sees only the clients an admin gave them access to.
create table public.staff_access (
  user_id uuid not null references public.staff (user_id) on delete cascade,
  org_id uuid not null references public.orgs on delete cascade,
  granted_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);
create index staff_access_org on public.staff_access (org_id);
create index staff_access_granted_by on public.staff_access (granted_by);
alter table public.staff_access enable row level security;
create policy "read access" on public.staff_access for select to authenticated using ((select private.is_admin()) or user_id = (select auth.uid()));
create policy "admins grant access" on public.staff_access for insert to authenticated with check ((select private.is_admin()));
create policy "admins remove access" on public.staff_access for delete to authenticated using ((select private.is_admin()));
revoke all on public.staff_access from anon;

-- "My companies" now also covers the clients a team member was given.
create or replace function private.my_orgs() returns setof uuid language sql stable security definer set search_path = '' as $$
  select org_id from public.org_members where user_id = (select auth.uid())
  union
  select a.org_id from public.staff_access a join public.staff s on s.user_id = a.user_id where a.user_id = (select auth.uid())
$$;

-- Every rule "team, or the client's own company" becomes "admin, or a company you can see".
do $$ declare r record; q text; c text; begin
  for r in select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%private.is_staff()%'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%private.my_orgs()%' loop
    q := replace(r.qual, 'private.is_staff() AS is_staff', 'private.is_admin() AS is_admin');
    c := replace(r.with_check, 'private.is_staff() AS is_staff', 'private.is_admin() AS is_admin');
    execute format('alter policy %I on public.%I %s %s', r.policyname, r.tablename,
      case when q is not null then format('using (%s)', q) else '' end,
      case when c is not null then format('with check (%s)', c) else '' end);
  end loop;
end $$;

-- Team-only tables about a client: admins, or team members who can see that client.
alter policy "team activities" on public.activities
  using ((select private.is_admin()) or ((select private.is_staff()) and org_id in (select private.my_orgs())))
  with check ((select private.is_admin()) or ((select private.is_staff()) and org_id in (select private.my_orgs())));
alter policy "team manages health" on public.org_health
  using ((select private.is_admin()) or ((select private.is_staff()) and org_id in (select private.my_orgs())))
  with check ((select private.is_admin()) or ((select private.is_staff()) and org_id in (select private.my_orgs())));
alter policy "team creates reports" on public.reports
  with check ((select private.is_admin()) or ((select private.is_staff()) and org_id in (select private.my_orgs())));
alter policy "team updates reports" on public.reports
  using ((select private.is_admin()) or ((select private.is_staff()) and org_id in (select private.my_orgs())));
alter policy "team deletes reports" on public.reports
  using ((select private.is_admin()) or ((select private.is_staff()) and org_id in (select private.my_orgs())));

-- Nobody is locked out: existing team members keep seeing every current client until an admin narrows it.
insert into public.staff_access (user_id, org_id)
  select s.user_id, o.id from public.staff s cross join public.orgs o where s.role = 'member'
  on conflict do nothing;

-- ---------------------------------------------------------------- look-alike filter
-- An answer that is really about a similarly named company ("Not to be confused with" in the brand profile)
-- is recorded here and not counted as a mention of the client.
create table public.confusions (
  answer_id bigint primary key references public.answers on delete cascade,
  org_id uuid not null,
  project_id bigint not null references public.projects on delete cascade,
  lookalike text not null check (length(lookalike) <= 120)
);
create index confusions_project on public.confusions (project_id);
create index confusions_org on public.confusions (org_id);
create trigger set_org before insert or update of project_id on public.confusions for each row execute function private.org_from_project();
alter table public.confusions enable row level security;
create policy "read own org" on public.confusions for select to authenticated using ((select private.is_admin()) or org_id in (select private.my_orgs()));
revoke all on public.confusions from anon;

-- ---------------------------------------------------------------- outreach
-- Websites AI cites where the client is missing, worked as a list with a status per site. Both the client and
-- the team work it. When a site lists the client, a work-log entry is created so the effect is measured.
create table public.outreach (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  project_id bigint not null references public.projects on delete cascade,
  domain text not null check (length(domain) <= 253),
  category text not null default 'other' check (length(category) <= 40),
  status text not null default 'todo' check (status in ('todo', 'contacted', 'replied', 'listed', 'no_reply', 'declined')),
  contact_name text check (length(contact_name) <= 120),
  contact_email text check (length(contact_email) <= 200),
  contact_url text check (length(contact_url) <= 500),
  listed_url text check (length(listed_url) <= 500),
  notes text check (length(notes) <= 2000),
  next_step_at date,
  listed_at date,
  email_subject text check (length(email_subject) <= 200),
  email_body text check (length(email_body) <= 4000),
  intervention_id bigint references public.interventions on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, domain)
);
create index outreach_org on public.outreach (org_id);
create index outreach_intervention on public.outreach (intervention_id);
create trigger set_org before insert or update of project_id on public.outreach for each row execute function private.org_from_project();
alter table public.outreach enable row level security;
create policy "read own org" on public.outreach for select to authenticated using ((select private.is_admin()) or org_id in (select private.my_orgs()));
create policy "add own org" on public.outreach for insert to authenticated with check ((select private.is_admin()) or org_id in (select private.my_orgs()));
create policy "edit own org" on public.outreach for update to authenticated using ((select private.is_admin()) or org_id in (select private.my_orgs())) with check ((select private.is_admin()) or org_id in (select private.my_orgs()));
create policy "remove own org" on public.outreach for delete to authenticated using ((select private.is_admin()) or org_id in (select private.my_orgs()));
revoke all on public.outreach from anon;
