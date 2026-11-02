-- Fixes from the November 2026 security review of the row-level security rules.

-- 1. Deleting a question used to delete its answers, and with them the money they cost: a client could reset its
--    monthly spend by deleting answered questions. Answers now outlive their question (the question link is cleared).
alter table public.answers alter column prompt_id drop not null;
alter table public.answers drop constraint answers_prompt_id_fkey,
  add constraint answers_prompt_id_fkey foreign key (prompt_id) references public.prompts on delete set null;

-- 2. A rating could be moved onto another company's report (the update had no check on the new row).
alter policy "change own rating" on public.report_ratings
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and org_id in (select private.client_orgs()));

-- 3. The guard on projects only ran on update: a client could create a project already marked simulated or checked.
alter policy "client creates own" on public.projects
  with check (org_id in (select private.client_orgs()) and data_mode = 'live' and last_run_at is null);

-- 4. org_id is always derived from the project, also when an update changes only org_id (a person in two
--    companies could re-file a row under the other one).
do $$ declare t text; begin
  foreach t in array array['brands','prompts','runs','answers','mentions','other_brands','citations','extractions','batches','reports',
    'site_checks','fact_findings','drafts','project_facts','brand_profiles','action_status','interventions','confusions','outreach'] loop
    execute format('drop trigger if exists set_org on public.%I', t);
    execute format('create trigger set_org before insert or update on public.%I for each row execute function private.org_from_project()', t);
  end loop;
end $$;
