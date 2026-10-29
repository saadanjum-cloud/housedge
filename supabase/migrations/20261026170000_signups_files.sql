-- Self sign-up from /onboarding, and files clients attach during onboarding.

-- One row per self sign-up. Accounts are still only created on the server (the `join` function);
-- this records who asked, and whether the team let them in (settings key 'signup_mode': auto | approve | off).
create table public.signups (
  id bigint generated always as identity primary key,
  user_id uuid unique references auth.users on delete set null,
  email text not null check (length(email) <= 200),
  full_name text check (length(full_name) <= 120),
  company text not null check (length(company) between 1 and 160),
  website text check (length(website) <= 200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  org_id uuid references public.orgs on delete set null,
  decided_by uuid references auth.users on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index signups_status_created on public.signups (status, created_at desc);
create index signups_org on public.signups (org_id);
create index signups_decided_by on public.signups (decided_by);
alter table public.signups enable row level security;
create policy "team reads signups" on public.signups for select to authenticated using ((select private.is_staff()));
revoke all on public.signups from anon, authenticated;
grant select on public.signups to authenticated;

-- Private bucket; every file sits in a folder named after its company: <org id>/<file>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-files', 'client-files', false, 26214400, array[
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint', 'application/zip'])
on conflict (id) do nothing;

-- The folder name must be a company the person belongs to (or they are on the team).
create function private.file_org_ok(object_name text) returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_staff() or exists (
    select 1 from private.my_orgs() o(id) where o.id::text = (storage.foldername(object_name))[1]
  );
$$;
grant execute on function private.file_org_ok(text) to authenticated;

create policy "client files: read own company" on storage.objects for select to authenticated
  using (bucket_id = 'client-files' and private.file_org_ok(name));
create policy "client files: add to own company" on storage.objects for insert to authenticated
  with check (bucket_id = 'client-files' and private.file_org_ok(name));
create policy "client files: remove own company" on storage.objects for delete to authenticated
  using (bucket_id = 'client-files' and private.file_org_ok(name));
