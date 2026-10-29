-- The existing Clients board and Activities pages work per project; keep that link so those pages stay unchanged.
alter table public.activities add column project_id bigint references public.projects on delete cascade;
create index on public.activities (project_id);
