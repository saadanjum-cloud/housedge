-- Fixes from the Supabase security and performance advisors on the core schema.

-- Spend runs with the caller's rights: row level security already limits a client to its own rows,
-- so no elevated function is exposed through the API. (Edge Functions use the service role and see all.)
create or replace function public.org_month_spend(p_org uuid) returns numeric language sql stable security invoker set search_path = '' as $$
  select coalesce((select sum(cost) from public.answers where org_id = p_org and created_at >= date_trunc('month', now() at time zone 'utc')), 0)
    + coalesce((select sum(cost) from public.ai_spend where org_id = p_org and created_at >= date_trunc('month', now() at time zone 'utc')), 0)
    + coalesce((select sum(est_cost) from public.batches where org_id = p_org and status = 'pending'), 0)
$$;

-- Indexes on foreign keys (faster joins and deletes).
create index on public.activities (created_by);
create index on public.activities (org_id);
create index on public.ai_spend (project_id);
create index on public.answers (prompt_id);
create index on public.answers (run_id);
create index on public.batches (org_id);
create index on public.batches (project_id);
create index on public.batches (run_id);
create index on public.brands (org_id);
create index on public.drafts (project_id);
create index on public.fact_findings (fact_id);
create index on public.invites (invited_by);
create index on public.invites (org_id);
create index on public.mentions (brand_id);
create index on public.org_health (updated_by);
create index on public.other_brands (answer_id);
create index on public.project_facts (project_id);
create index on public.prompts (org_id);
create index on public.report_ratings (org_id);
create index on public.report_ratings (user_id);
create index on public.reports (org_id);
create index on public.runs (org_id);
create index on public.runs (requested_by);
create index on public.site_checks (project_id);

alter table public.other_brands add column id bigint generated always as identity primary key;

-- One permissive policy per action: replace "for all" policies that overlapped the read policies.
do $$ declare t text; begin
  foreach t in array array['brands', 'prompts', 'project_facts', 'brand_profiles', 'action_status'] loop
    execute format('drop policy "edit own org" on public.%I', t);
    execute format('create policy "insert own org" on public.%I for insert to authenticated with check ((select private.is_staff()) or org_id in (select private.my_orgs()))', t);
    execute format('create policy "update own org" on public.%I for update to authenticated using ((select private.is_staff()) or org_id in (select private.my_orgs())) with check ((select private.is_staff()) or org_id in (select private.my_orgs()))', t);
    execute format('create policy "delete own org" on public.%I for delete to authenticated using ((select private.is_staff()) or org_id in (select private.my_orgs()))', t);
  end loop;
end $$;

drop policy "team manages reports" on public.reports;
create policy "team creates reports" on public.reports for insert to authenticated with check ((select private.is_staff()));
create policy "team updates reports" on public.reports for update to authenticated using ((select private.is_staff()));
create policy "team deletes reports" on public.reports for delete to authenticated using ((select private.is_staff()));

drop policy "admins manage members" on public.org_members;
create policy "admins add members" on public.org_members for insert to authenticated with check ((select private.is_admin()));
create policy "admins change members" on public.org_members for update to authenticated using ((select private.is_admin()));
create policy "admins remove members" on public.org_members for delete to authenticated using ((select private.is_admin()));

drop policy "admins write settings" on public.settings;
create policy "admins add settings" on public.settings for insert to authenticated with check ((select private.is_admin()));
create policy "admins change settings" on public.settings for update to authenticated using ((select private.is_admin()));
create policy "admins remove settings" on public.settings for delete to authenticated using ((select private.is_admin()));

drop policy "admins manage staff" on public.staff;
create policy "admins add staff" on public.staff for insert to authenticated with check ((select private.is_admin()));
create policy "admins change staff" on public.staff for update to authenticated using ((select private.is_admin()));
create policy "admins remove staff" on public.staff for delete to authenticated using ((select private.is_admin()));
