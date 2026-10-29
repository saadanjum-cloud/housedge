-- The Housedge team has read-only access to client data: only the client changes its own project setup
-- (questions, competitors, brand profile, facts, actions). The team still manages accounts (orgs, budget, health),
-- reports, activities, enquiries and settings. The api function enforces the same rule; this is the second lock.
do $$ declare t text; begin
  foreach t in array array['brands', 'prompts', 'project_facts', 'brand_profiles', 'action_status'] loop
    execute format('drop policy "insert own org" on public.%I', t);
    execute format('drop policy "update own org" on public.%I', t);
    execute format('drop policy "delete own org" on public.%I', t);
    execute format('create policy "client inserts own" on public.%I for insert to authenticated with check (org_id in (select private.my_orgs()))', t);
    execute format('create policy "client updates own" on public.%I for update to authenticated using (org_id in (select private.my_orgs())) with check (org_id in (select private.my_orgs()))', t);
    execute format('create policy "client deletes own" on public.%I for delete to authenticated using (org_id in (select private.my_orgs()))', t);
  end loop;
end $$;

drop policy "create in own org" on public.projects;
drop policy "edit own org" on public.projects;
create policy "client creates own" on public.projects for insert to authenticated with check (org_id in (select private.my_orgs()));
create policy "client edits own" on public.projects for update to authenticated using (org_id in (select private.my_orgs())) with check (org_id in (select private.my_orgs()));
