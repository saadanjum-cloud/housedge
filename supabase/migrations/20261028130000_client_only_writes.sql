-- Per-client team access must stay read-only: my_orgs() now also lists clients a team member was given, so the
-- rules that only the client may change things use client_orgs() (the person's own company memberships) instead.
create function private.client_orgs() returns setof uuid language sql stable security definer set search_path = '' as $$
  select org_id from public.org_members where user_id = (select auth.uid())
$$;
grant execute on function private.client_orgs() to authenticated;

do $$ declare t text; begin
  foreach t in array array['brands', 'prompts', 'project_facts', 'brand_profiles', 'action_status'] loop
    execute format('alter policy "client inserts own" on public.%I with check (org_id in (select private.client_orgs()))', t);
    execute format('alter policy "client updates own" on public.%I using (org_id in (select private.client_orgs())) with check (org_id in (select private.client_orgs()))', t);
    execute format('alter policy "client deletes own" on public.%I using (org_id in (select private.client_orgs()))', t);
  end loop;
end $$;
alter policy "client creates own" on public.projects with check (org_id in (select private.client_orgs()));
alter policy "client edits own" on public.projects using (org_id in (select private.client_orgs())) with check (org_id in (select private.client_orgs()));
alter policy "rate own reports" on public.report_ratings with check (org_id in (select private.client_orgs()) and user_id = (select auth.uid()));

-- Client files: the team (admins, or members given the client) can open them; only the client adds or removes them.
create function private.file_client_ok(object_name text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.client_orgs() o(id) where o.id::text = (storage.foldername(object_name))[1]);
$$;
grant execute on function private.file_client_ok(text) to authenticated;
create or replace function private.file_org_ok(object_name text) returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() or exists (select 1 from private.my_orgs() o(id) where o.id::text = (storage.foldername(object_name))[1]);
$$;
alter policy "client files: add to own company" on storage.objects with check (bucket_id = 'client-files' and private.file_client_ok(name));
alter policy "client files: remove own company" on storage.objects using (bucket_id = 'client-files' and private.file_client_ok(name));
