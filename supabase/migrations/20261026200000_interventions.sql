-- The work log: every real-world action taken for a client (a listicle placement, a review campaign, a new FAQ
-- page, schema on the site, a press article…), dated, so its effect on AI answers can be measured before vs after.
-- Across clients this becomes the dataset of what actually moves AI answers, and how fast.
create table public.interventions (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  project_id bigint not null references public.projects on delete cascade,
  kind text not null check (kind in ('listicle', 'review_site', 'community', 'press', 'own_page', 'site_technical', 'knowledge_graph', 'social', 'other')),
  title text not null check (length(title) between 1 and 300),
  url text check (length(url) <= 2000),
  target_domain text check (length(target_domain) <= 200), -- the site AI would read (from url), to spot it in citations
  done_on date not null,                                      -- the day it went live
  status text not null default 'live' check (status in ('planned', 'live', 'removed')),
  markets text[] not null default '{}' check (cardinality(markets) <= 20), -- empty = every market
  prompt_ids bigint[] not null default '{}' check (cardinality(prompt_ids) <= 200), -- empty = every question
  action_key text check (length(action_key) <= 200),          -- the suggested action it answers, if any
  notes text check (length(notes) <= 4000),
  created_by uuid references auth.users on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index interventions_project on public.interventions (project_id, done_on);
create index interventions_org on public.interventions (org_id);
create index interventions_created_by on public.interventions (created_by);
create trigger set_org before insert or update of project_id on public.interventions for each row execute function private.org_from_project();

alter table public.interventions enable row level security;
-- Shared between the client and our team: both may log work (we do most of it), both see it.
create policy "read own org" on public.interventions for select to authenticated using ((select private.is_staff()) or org_id in (select private.my_orgs()));
create policy "log work" on public.interventions for insert to authenticated with check ((select private.is_staff()) or org_id in (select private.my_orgs()));
create policy "edit work" on public.interventions for update to authenticated using ((select private.is_staff()) or org_id in (select private.my_orgs())) with check ((select private.is_staff()) or org_id in (select private.my_orgs()));
create policy "remove work" on public.interventions for delete to authenticated using ((select private.is_staff()) or org_id in (select private.my_orgs()));
revoke all on public.interventions from anon;

-- Before vs after for each logged action: answers in the same markets/questions in the p_window days before the
-- day it went live, and in the p_window days after (the day itself is left out). "named" = the client's own brand
-- is mentioned; "cited" = the answer cites the action's site (direct evidence AI read it).
create function public.intervention_results(p_project bigint, p_window int default 28)
returns table (id bigint, before_answers int, before_named int, after_answers int, after_named int,
               before_cited int, after_cited int, first_cited date, days_after int)
language sql stable security invoker set search_path = '' as $$
  with i as (select * from public.interventions where project_id = p_project and status <> 'planned'),
  own as (select b.id from public.brands b where b.project_id = p_project and b.is_own limit 1),
  a as (
    select i.id iid, ans.day, ans.day > i.done_on as after,
      exists (select 1 from public.mentions m where m.answer_id = ans.id and m.brand_id = (select own.id from own)) as named,
      (i.target_domain is not null and exists (select 1 from public.citations c where c.answer_id = ans.id
        and (c.domain = i.target_domain or c.domain like '%.' || i.target_domain))) as cited
    from i
    join public.answers ans on ans.project_id = p_project and ans.error is null and ans.text is not null
      and ans.day >= i.done_on - p_window and ans.day <= i.done_on + p_window and ans.day <> i.done_on
      and (cardinality(i.prompt_ids) = 0 or ans.prompt_id = any (i.prompt_ids))
      and (cardinality(i.markets) = 0 or exists (select 1 from public.prompts q where q.id = ans.prompt_id and q.country = any (i.markets)))
  )
  select i.id,
    (count(a.iid) filter (where not a.after))::int, (count(a.iid) filter (where not a.after and a.named))::int,
    (count(a.iid) filter (where a.after))::int, (count(a.iid) filter (where a.after and a.named))::int,
    (count(a.iid) filter (where not a.after and a.cited))::int, (count(a.iid) filter (where a.after and a.cited))::int,
    min(a.day) filter (where a.after and a.cited),
    least(p_window, greatest(0, current_date - i.done_on))::int
  from i left join a on a.iid = i.id
  group by i.id, i.done_on
$$;
grant execute on function public.intervention_results(bigint, int) to authenticated;

-- What works, across every client (team only): per kind of action, industry and market, how often the client's
-- mention rate rose, by how much on average, and how often AI started citing the site. Only actions whose 28-day
-- "after" window is complete and that have at least 5 answers on each side count.
create view public.intervention_learnings with (security_invoker = true) as
  with r as (
    select i.kind, coalesce(nullif(o.industry, ''), 'Unknown') as industry,
      case when cardinality(i.markets) = 1 then i.markets[1] else 'Several' end as market,
      x.before_answers, x.before_named, x.after_answers, x.after_named, x.before_cited, x.after_cited, x.first_cited, i.done_on
    from public.projects p
    join public.orgs o on o.id = p.org_id
    cross join lateral public.intervention_results(p.id) x
    join public.interventions i on i.id = x.id
    where (select private.is_staff()) and x.days_after >= 28 and x.before_answers >= 5 and x.after_answers >= 5
  )
  select kind, industry, market, count(*)::int as actions,
    round(avg(100.0 * after_named / after_answers - 100.0 * before_named / before_answers), 1) as avg_change_pts,
    (count(*) filter (where after_named * before_answers > before_named * after_answers))::int as improved,
    (count(*) filter (where after_cited > 0 and before_cited = 0))::int as newly_cited,
    percentile_cont(0.5) within group (order by first_cited - done_on) filter (where first_cited is not null) as median_days_to_citation
  from r group by 1, 2, 3;
grant select on public.intervention_learnings to authenticated;
