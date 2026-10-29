-- Dashboard numbers, computed next to the data. All run with the caller's rights (security invoker),
-- so row level security decides what each person sees: a client only ever gets its own projects.

-- Per brand for the last p_days: visibility (% of answers naming it), average rank (only where the answer ranked it),
-- sentiment, share of voice, plus the previous period's visibility for the change arrow.
create function public.project_overview(p_project bigint, p_days int default 30) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with cur as (select id from public.answers where project_id = p_project and error is null and day > current_date - p_days),
  prev as (select id from public.answers where project_id = p_project and error is null and day <= current_date - p_days and day > current_date - 2 * p_days),
  m as (select brand_id, count(distinct answer_id) answers, count(*) mentions, avg(position) pos, avg(sentiment) sent
        from public.mentions where answer_id in (select id from cur) group by brand_id),
  pm as (select brand_id, count(distinct answer_id) answers from public.mentions where answer_id in (select id from prev) group by brand_id),
  n as (select (select count(*) from cur) cur, (select count(*) from prev) prev, (select coalesce(sum(mentions), 0) from m) mentions)
  select jsonb_build_object(
    'answers', n.cur, 'prevAnswers', n.prev, 'days', p_days,
    'brands', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'name', b.name, 'own', b.is_own, 'color', b.color, 'domain', b.domain,
        'answersWith', coalesce(m.answers, 0),
        'visibility', case when n.cur > 0 then round(100.0 * coalesce(m.answers, 0) / n.cur, 1) end,
        'prevVisibility', case when n.prev > 0 then round(100.0 * coalesce(pm.answers, 0) / n.prev, 1) end,
        'position', round(m.pos, 1), 'sentiment', round(m.sent),
        'sov', case when n.mentions > 0 then round(100.0 * coalesce(m.mentions, 0) / n.mentions, 1) end)
      order by b.is_own desc, coalesce(m.answers, 0) desc, b.name)
      from public.brands b left join m on m.brand_id = b.id left join pm on pm.brand_id = b.id where b.project_id = p_project), '[]'::jsonb))
  from n
$$;

-- Daily visibility per brand (for the trend chart).
create function public.project_daily(p_project bigint, p_days int default 30) returns table (day date, brand_id bigint, visibility numeric)
language sql stable security invoker set search_path = '' as $$
  with a as (select id, day from public.answers where project_id = p_project and error is null and day > current_date - p_days),
  tot as (select day, count(*) n from a group by day)
  select t.day, b.id, round(100.0 * (select count(distinct m.answer_id) from public.mentions m join a on a.id = m.answer_id where a.day = t.day and m.brand_id = b.id) / t.n, 1)
  from tot t cross join public.brands b where b.project_id = p_project order by t.day, b.id
$$;

-- Usage per month, split by what spent it: each engine's answers and each helper (readings, fact checks...).
-- Tokens and cost are what the admin console and the client's usage page show.
create function public.org_usage(p_org uuid, p_months int default 3) returns table (month date, source text, model text, calls bigint, tokens bigint, cost numeric)
language sql stable security invoker set search_path = '' as $$
  select date_trunc('month', created_at)::date, 'answers: ' || engine, model, count(*), coalesce(sum(coalesce(in_tokens, 0) + coalesce(out_tokens, 0)), 0), coalesce(sum(cost), 0)
  from public.answers where org_id = p_org and created_at >= date_trunc('month', now()) - make_interval(months => p_months - 1) group by 1, 2, 3
  union all
  select date_trunc('month', created_at)::date, kind, model, count(*), coalesce(sum(coalesce(in_tokens, 0) + coalesce(out_tokens, 0)), 0), coalesce(sum(cost), 0)
  from public.ai_spend where org_id = p_org and created_at >= date_trunc('month', now()) - make_interval(months => p_months - 1) group by 1, 2, 3
  order by 1 desc, 6 desc
$$;

revoke all on function public.project_overview(bigint, int), public.project_daily(bigint, int), public.org_usage(uuid, int) from anon, public;
grant execute on function public.project_overview(bigint, int), public.project_daily(bigint, int), public.org_usage(uuid, int) to authenticated;
