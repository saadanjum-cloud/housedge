-- Row level security tests. Runs in one transaction and rolls back: nothing is left behind.
-- Each block signs in as a test user (by setting the JWT claims PostgREST would set) and checks what it can do.
-- Run: node supabase/tests/run.mjs supabase/tests/rls.sql
begin;

create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; end $$;
-- Runs `stmt` as `who` and returns the error message, or null if it succeeded.
create function pg_temp.try(who uuid, stmt text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', case when who is null then 'anon' else 'authenticated' end)::text, true);
  execute case when who is null then 'set local role anon' else 'set local role authenticated' end;
  begin execute stmt; exception when others then execute 'reset role'; return sqlerrm; end;
  execute 'reset role';
  return null;
end $$;
-- Returns the first column of the first row of `q` as text, run as `who`.
create function pg_temp.val(who uuid, q text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', case when who is null then 'anon' else 'authenticated' end)::text, true);
  execute case when who is null then 'set local role anon' else 'set local role authenticated' end;
  execute q into r;
  execute 'reset role';
  return r;
end $$;

-- ---------------------------------------------------------------- fixtures (as the database owner)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'teammate@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', 'client1@wolt.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'client2@foodora.test'),
  ('00000000-0000-0000-0000-0000000000ff', 'stranger@test.local');
insert into public.staff values ('00000000-0000-0000-0000-00000000000a', 'admin'), ('00000000-0000-0000-0000-00000000000b', 'member');
insert into public.orgs (id, name, monthly_budget) values ('10000000-0000-0000-0000-000000000001', 'Wolt', 50), ('10000000-0000-0000-0000-000000000002', 'Foodora', 20);
-- The team member was given Wolt only (per-client access); the admin sees every client.
insert into public.staff_access (user_id, org_id) values ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001');
insert into public.org_health (org_id, health, note) values ('10000000-0000-0000-0000-000000000001', 'at_risk', 'Unhappy with last report');
insert into public.org_members values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'owner'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c2', 'member');
insert into public.profiles (id, full_name) values ('00000000-0000-0000-0000-0000000000c1', 'Client One'), ('00000000-0000-0000-0000-0000000000c2', 'Client Two');
insert into public.projects (org_id, name) values ('10000000-0000-0000-0000-000000000001', 'Wolt FI'), ('10000000-0000-0000-0000-000000000002', 'Foodora FI');
create temp table ids as select
  (select id from public.projects where name = 'Wolt FI') p1, (select id from public.projects where name = 'Foodora FI') p2;
grant select on ids to authenticated, anon;
insert into public.prompts (project_id, text) select p1, 'Best delivery app?' from ids union all select p2, 'Best delivery app?' from ids;
insert into public.answers (project_id, prompt_id, engine, day, text, cost, in_tokens, out_tokens)
  select p.project_id, p.id, 'claude', current_date, 'Wolt is the main choice.', 0.2, 30000, 1500 from public.prompts p;
insert into public.reports (project_id, title, data) select p1, 'Wolt report', '{}'::jsonb from ids union all select p2, 'Foodora report', '{}'::jsonb from ids;
insert into public.activities (org_id, title) values ('10000000-0000-0000-0000-000000000001', 'Call client');
insert into public.enquiries (name, email) values ('Lead', 'lead@test.local');
insert into public.settings values ('monthly_cap', '100') on conflict (key) do update set value = excluded.value;

-- trigger: org_id always comes from the project, whatever was sent
select pg_temp.ok((select count(*) = 1 from public.answers a, ids where a.project_id = ids.p1 and a.org_id = '10000000-0000-0000-0000-000000000001'), 'answers get org_id from project');

do $$
declare
  admin uuid := '00000000-0000-0000-0000-00000000000a'; mate uuid := '00000000-0000-0000-0000-00000000000b';
  c1 uuid := '00000000-0000-0000-0000-0000000000c1'; c2 uuid := '00000000-0000-0000-0000-0000000000c2';
  x uuid := '00000000-0000-0000-0000-0000000000ff';
  wolt uuid := '10000000-0000-0000-0000-000000000001'; foodora uuid := '10000000-0000-0000-0000-000000000002';
  p1 bigint := (select ids.p1 from ids); p2 bigint := (select ids.p2 from ids);
  err text;
begin
  -- ---- anonymous visitor
  perform pg_temp.ok(pg_temp.try(null, 'select * from public.projects') is not null, 'anon cannot read projects');
  perform pg_temp.ok(pg_temp.try(null, 'select * from public.orgs') is not null, 'anon cannot read orgs');
  perform pg_temp.ok(pg_temp.val(null, 'select count(*) from public.site_info') = '1', 'anon can read legal page details');
  perform pg_temp.ok(pg_temp.try(null, 'select public.org_month_spend(''10000000-0000-0000-0000-000000000001'')') is not null, 'anon cannot read spend');

  -- ---- signed-in stranger with no company
  perform pg_temp.ok(pg_temp.val(x, 'select count(*) from public.orgs') = '0', 'stranger sees no orgs');
  perform pg_temp.ok(pg_temp.val(x, 'select count(*) from public.answers') = '0', 'stranger sees no answers');
  perform pg_temp.ok(pg_temp.val(x, 'select count(*) from public.admin_clients') = '0', 'stranger sees no admin overview');

  -- ---- client 1 (Wolt owner)
  perform pg_temp.ok(pg_temp.val(c1, 'select string_agg(name, '','') from public.orgs') = 'Wolt', 'client sees only own org');
  perform pg_temp.ok(pg_temp.val(c1, 'select count(*) from public.projects') = '1', 'client sees only own project');
  perform pg_temp.ok(pg_temp.val(c1, 'select count(*) from public.answers') = '1', 'client sees only own answers');
  perform pg_temp.ok(pg_temp.val(c1, 'select count(*) from public.reports') = '1', 'client sees only own reports');
  perform pg_temp.ok(pg_temp.val(c1, 'select count(*) from public.org_health') = '0', 'client cannot see health notes');
  perform pg_temp.ok(pg_temp.val(c1, 'select count(*) from public.admin_clients') = '0', 'client cannot see admin overview');
  perform pg_temp.ok(pg_temp.val(c1, 'select count(*) from public.activities') = '0', 'client cannot see team activities');
  perform pg_temp.ok(pg_temp.val(c1, 'select count(*) from public.enquiries') = '0', 'client cannot see enquiries');
  perform pg_temp.ok(pg_temp.val(c1, 'select count(*) from public.settings') = '0', 'client cannot see settings');
  perform pg_temp.ok(pg_temp.val(c1, 'select count(*) from public.invites') = '0', 'client cannot see invites');
  perform pg_temp.ok(pg_temp.val(c1, 'select count(*) from public.staff') = '0', 'client cannot list the team');
  perform pg_temp.ok(pg_temp.val(c1, 'select string_agg(full_name, '','') from public.profiles') = 'Client One', 'client sees only own company people');
  perform pg_temp.ok(pg_temp.val(c1, format('select public.org_month_spend(%L)', wolt)) = '0.200000', 'client sees own spend');
  perform pg_temp.ok(pg_temp.val(c1, format('select public.org_month_spend(%L)', foodora))::numeric = 0, 'client cannot see another org spend');

  -- client edits its own setup ("view and edit everything")
  perform pg_temp.ok(pg_temp.try(c1, format('insert into public.prompts (project_id, text) values (%s, %L)', p1, 'New question')) is null, 'client adds a question');
  perform pg_temp.ok(pg_temp.try(c1, format('insert into public.brands (project_id, name) values (%s, %L)', p1, 'Uber Eats')) is null, 'client adds a competitor');
  perform pg_temp.ok(pg_temp.try(c1, format('update public.projects set name = %L where id = %s', 'Wolt Finland', p1)) is null, 'client renames own project');
  perform pg_temp.ok(pg_temp.try(c1, format('update public.orgs set website = %L where id = %L', 'wolt.com', wolt)) is null, 'client edits own company details');
  perform pg_temp.ok(pg_temp.try(c1, format('insert into public.projects (org_id, name) values (%L, %L)', wolt, 'Wolt SE')) is null, 'client creates a project in own org');
  -- ... but never another company's
  err := pg_temp.try(c1, format('insert into public.prompts (project_id, text) values (%s, %L)', p2, 'Sneaky'));
  perform pg_temp.ok(err is not null, 'client cannot add a question to another org');
  perform pg_temp.ok(pg_temp.try(c1, format('insert into public.prompts (project_id, org_id, text) values (%s, %L, %L)', p1, foodora, 'Forged org')) is null, 'forged org_id is ignored');
  perform pg_temp.ok((select org_id from public.prompts where text = 'Forged org') = wolt, 'forged org_id replaced by the real one');
  perform pg_temp.ok(pg_temp.try(c1, format('insert into public.projects (org_id, name) values (%L, %L)', foodora, 'Sneaky')) is not null, 'client cannot create a project in another org');
  perform pg_temp.ok(pg_temp.val(c1, format('with u as (update public.projects set name = %L where id = %s returning 1) select count(*) from u', 'Hacked', p2)) = '0', 'client cannot edit another org project');
  perform pg_temp.ok(pg_temp.val(c1, format('with d as (delete from public.prompts where project_id = %s returning 1) select count(*) from d', p2)) = '0', 'client cannot delete another org questions');
  -- ... and never the protected fields
  perform pg_temp.ok(pg_temp.try(c1, format('update public.orgs set monthly_budget = 9999 where id = %L', wolt)) like '%budget%', 'client cannot raise own budget');
  perform pg_temp.ok(pg_temp.try(c1, format('update public.projects set data_mode = %L where id = %s', 'simulated', p1)) like '%team%', 'client cannot change data mode');
  perform pg_temp.ok(pg_temp.try(c1, format('insert into public.answers (project_id, prompt_id, engine, day, text) values (%s, (select id from public.prompts where project_id = %s limit 1), %L, current_date, %L)', p1, p1, 'claude', 'fake')) is not null, 'client cannot write answers');
  perform pg_temp.ok(pg_temp.try(c1, format('insert into public.ai_spend (org_id, kind, cost) values (%L, %L, -100)', wolt, 'x')) is not null, 'client cannot write spend');
  perform pg_temp.ok(pg_temp.try(c1, format('insert into public.org_health (org_id, health) values (%L, %L)', wolt, 'good')) is not null, 'client cannot mark itself healthy');
  perform pg_temp.ok(pg_temp.try(c1, format('insert into public.org_members values (%L, %L, %L)', foodora, c1, 'owner')) is not null, 'client cannot join another org');
  perform pg_temp.ok(pg_temp.try(c1, format('insert into public.staff values (%L, %L)', c1, 'admin')) is not null, 'client cannot make itself staff');
  perform pg_temp.ok(pg_temp.val(c1, format('with d as (delete from public.projects where id = %s returning 1) select count(*) from d', p1)) = '0', 'client cannot delete projects');
  -- ratings
  perform pg_temp.ok(pg_temp.try(c1, format('insert into public.report_ratings (report_id, rating, comment) values ((select id from public.reports where project_id = %s), 4, %L)', p1, 'Useful')) is null, 'client rates own report');
  perform pg_temp.ok(pg_temp.try(c1, format('insert into public.report_ratings (report_id, rating) values ((select id from public.reports where project_id = %s), 1)', p2)) is not null, 'client cannot rate another org report');
  -- (separate statements: subqueries in the same expression would run before the insert)
  err := pg_temp.try(c1, format('insert into public.report_ratings (report_id, user_id, rating) values ((select id from public.reports where project_id = %s), %L, 5)
      on conflict (report_id, user_id) do update set rating = excluded.rating', p1, c2));
  perform pg_temp.ok(err is null, 'client changes own rating');
  perform pg_temp.ok((select count(*) from public.report_ratings where user_id = c2) = 0, 'rating never recorded under another user');
  perform pg_temp.ok((select rating from public.report_ratings where user_id = c1) = 5, 'rating recorded as the signed-in user');

  -- read models obey the same rules
  perform pg_temp.ok(pg_temp.val(c1, format('select public.project_overview(%s) ->> ''answers''', p1)) = '1', 'client reads own overview');
  perform pg_temp.ok(pg_temp.val(c1, format('select public.project_overview(%s) ->> ''answers''', p2)) = '0', 'client gets nothing from another org overview');
  perform pg_temp.ok(pg_temp.val(c1, format('select jsonb_array_length(public.project_overview(%s) -> ''brands'')', p2)) = '0', 'client sees no brands of another org');
  perform pg_temp.ok(pg_temp.val(c1, format('select count(*) from public.org_usage(%L)', foodora)) = '0', 'client cannot read another org usage');
  perform pg_temp.ok(pg_temp.val(c1, format('select sum(tokens) from public.org_usage(%L)', wolt)) = '31500', 'client reads own usage');

  -- ---- client 2 cannot see client 1's new data
  perform pg_temp.ok(pg_temp.val(c2, 'select count(*) from public.prompts where text = ''New question''') = '0', 'other client cannot see new question');
  perform pg_temp.ok(pg_temp.val(c2, 'select count(*) from public.report_ratings') = '0', 'other client cannot see ratings');

  -- ---- team member (not admin)
  perform pg_temp.ok(pg_temp.val(mate, format('select count(*) from public.orgs where id in (%L, %L)', wolt, foodora)) = '1', 'team member sees only the clients they were given');
  perform pg_temp.ok(pg_temp.val(mate, format('select count(*) from public.admin_clients where id in (%L, %L)', wolt, foodora)) = '1', 'team member sees admin overview of their clients only');
  perform pg_temp.ok(pg_temp.val(mate, format('select count(*) from public.answers where project_id = %s', p2)) = '0', 'team member cannot see answers of a client they were not given');
  perform pg_temp.ok(pg_temp.val(admin, format('select count(*) from public.answers where project_id = %s', p2)) = '1', 'admin sees every client');
  perform pg_temp.ok(pg_temp.try(mate, format('insert into public.staff_access (user_id, org_id) values (%L, %L)', mate, foodora)) is not null, 'team member cannot give themselves access');
  perform pg_temp.ok(pg_temp.val(mate, format('select count(*) from public.org_health where org_id = %L', foodora)) = '0', 'team member cannot see health of other clients');
  perform pg_temp.ok(pg_temp.val(mate, 'select health from public.admin_clients where name = ''Wolt''') = 'at_risk', 'team member sees health');
  perform pg_temp.ok(pg_temp.val(mate, 'select avg_rating from public.admin_clients where name = ''Wolt''') = '5.0', 'admin overview shows the (changed) rating');
  perform pg_temp.ok(pg_temp.val(mate, 'select tokens_month from public.admin_clients where name = ''Wolt''') = '31500', 'admin overview shows tokens');
  perform pg_temp.ok(pg_temp.try(mate, format('update public.orgs set monthly_budget = 80 where id = %L', wolt)) is null, 'team member sets a client budget');
  perform pg_temp.ok(pg_temp.try(mate, format('insert into public.staff values (%L, %L)', x, 'admin')) is not null, 'team member cannot add staff');
  perform pg_temp.ok(pg_temp.val(mate, format('with d as (delete from public.projects where id = %s returning 1) select count(*) from d', p2)) = '0', 'team member cannot delete projects');
  perform pg_temp.ok(pg_temp.try(mate, format('insert into public.orgs (name) values (%L)', 'New client')) is not null, 'team member cannot create client orgs');
  -- Read-only access to client data: the team sees it but cannot change it.
  perform pg_temp.ok(pg_temp.val(mate, format('with u as (update public.prompts set active = false where project_id = %s returning 1) select count(*) from u', p1)) = '0', 'team member cannot change client questions');
  perform pg_temp.ok(pg_temp.try(mate, format('insert into public.prompts (project_id, text) values (%s, %L)', p1, 'team question')) is not null, 'team member cannot add client questions');
  perform pg_temp.ok(pg_temp.val(mate, format('with u as (update public.projects set name = %L where id = %s returning 1) select count(*) from u', 'renamed', p1)) = '0', 'team member cannot change a client project');
  perform pg_temp.ok(pg_temp.val(admin, format('with u as (update public.brands set name = %L where project_id = %s returning 1) select count(*) from u', 'renamed', p2)) = '0', 'admin cannot change client competitors');
  perform pg_temp.ok(pg_temp.try(admin, format('insert into public.projects (org_id, name) values (%L, %L)', foodora, 'admin project')) is not null, 'admin cannot create projects for a client');
  -- Work log: the client and the team both log work; nobody else sees it; the cross-client dataset is team-only.
  perform pg_temp.ok(pg_temp.try(c1, format('insert into public.interventions (project_id, kind, title, done_on) values (%s, %L, %L, current_date)', p1, 'listicle', 'Listed on a comparison page')) is null, 'client logs work on its own project');
  perform pg_temp.ok(pg_temp.try(c1, format('insert into public.interventions (project_id, kind, title, done_on) values (%s, %L, %L, current_date)', p2, 'listicle', 'Sneaky')) is not null, 'client cannot log work for another company');
  perform pg_temp.ok(pg_temp.try(mate, format('insert into public.interventions (project_id, kind, title, done_on) values (%s, %L, %L, current_date)', p1, 'press', 'Press article')) is null, 'team member logs work for a client');
  perform pg_temp.ok(pg_temp.try(mate, format('insert into public.interventions (project_id, kind, title, done_on) values (%s, %L, %L, current_date)', p2, 'press', 'x')) is not null, 'team member cannot log work for a client they were not given');
  -- Outreach list: client and team work it, each only for companies they can see.
  perform pg_temp.ok(pg_temp.try(c1, format('insert into public.outreach (project_id, domain) values (%s, %L)', p1, 'nsave.com')) is null, 'client adds an outreach site');
  perform pg_temp.ok(pg_temp.try(c1, format('insert into public.outreach (project_id, domain) values (%s, %L)', p2, 'nsave.com')) is not null, 'client cannot add outreach for another company');
  perform pg_temp.ok(pg_temp.try(mate, format('update public.outreach set status = %L where project_id = %s', 'contacted', p1)) is null, 'team member works the outreach list');
  perform pg_temp.ok(pg_temp.val(c2, format('select count(*) from public.outreach where project_id = %s', p1)) = '0', 'other client cannot see the outreach list');
  perform pg_temp.ok(pg_temp.try(c1, format('insert into public.confusions (answer_id, project_id, lookalike) select id, project_id, %L from public.answers where project_id = %s', 'Kay Jewelers', p1)) is not null, 'clients cannot write look-alike results');
  perform pg_temp.ok(pg_temp.val(x, 'select count(*) from public.interventions') = '0', 'stranger sees no work log');
  perform pg_temp.ok(pg_temp.val(c2, format('select count(*) from public.interventions where project_id = %s', p1)) = '0', 'other client cannot see the work log');
  perform pg_temp.ok(pg_temp.val(c1, 'select count(*) from public.intervention_learnings') = '0', 'client cannot see the cross-client dataset');
  perform pg_temp.ok(pg_temp.try(c1, format('insert into public.interventions (project_id, kind, title, done_on) values (%s, %L, %L, current_date)', p1, 'bribe', 'x')) is not null, 'unknown kind of action refused');

  -- ---- money tables and keys: only the server writes them, whatever a signed-in person sends
  perform pg_temp.ok(pg_temp.try(c1, format('insert into public.ai_spend (org_id, kind, cost) values (%L, %L, -100)', wolt, 'refund')) is not null, 'client cannot write AI spend (e.g. a negative cost)');
  perform pg_temp.ok(pg_temp.try(c1, format('insert into public.runs (project_id, trigger, status) values (%s, %L, %L)', p1, 'manual', 'done')) is not null, 'client cannot create check runs');
  perform pg_temp.ok(pg_temp.try(c1, format('update public.answers set cost = 0 where project_id = %s', p1)) is not null, 'client cannot change answer costs');
  perform pg_temp.ok(pg_temp.try(c1, format('delete from public.ai_spend where org_id = %L', wolt)) is not null, 'client cannot delete spend records');
  perform pg_temp.ok(pg_temp.try(mate, format('insert into public.ai_spend (org_id, kind, cost) values (%L, %L, 0)', wolt, 'x')) is not null, 'team member cannot write AI spend');
  perform pg_temp.ok(pg_temp.try(admin, format('update public.ai_spend set cost = 0 where org_id = %L', wolt)) is not null, 'not even an admin can edit spend records directly');
  perform pg_temp.ok(pg_temp.try(c1, format('insert into public.api_tokens (org_id, token_hash, hint) values (%L, %L, %L)', wolt, 'x', 'x')) is not null, 'client cannot create data API keys');
  perform pg_temp.ok(pg_temp.try(c1, 'truncate public.answers') is not null, 'client cannot wipe a table');
  perform pg_temp.ok(pg_temp.val(c1, 'select count(*) from public.api_tokens') = '0', 'client cannot read data API keys');
  perform pg_temp.ok(pg_temp.val(mate, 'select count(*) from public.settings') = '0', 'team member cannot read settings (caps, prices)');
  perform pg_temp.ok(pg_temp.val(admin, 'select count(*) from public.settings') <> '0', 'admin reads settings');
  perform pg_temp.ok(pg_temp.val(c1, 'with u as (update public.site_info set company = ''{}''::jsonb returning 1) select count(*) from u') = '0', 'client cannot change company details');
  perform pg_temp.ok(pg_temp.val(admin, 'with u as (update public.site_info set company = company returning 1) select count(*) from u') = '1', 'admin can save company details');
  perform pg_temp.ok(pg_temp.try(c1, format('update public.orgs set fee = 0 where id = %L', wolt)) is not null, 'client cannot change its own fee');
  perform pg_temp.ok(pg_temp.try(c1, format('update public.projects set last_run_at = now() where id = %s', p1)) is not null, 'client cannot fake check dates');
  perform pg_temp.ok(pg_temp.try(null, format('select * from public.intervention_results(%s)', p1)) is not null, 'signed-out visitors cannot call functions');
  perform pg_temp.ok(pg_temp.try(null, 'select * from public.intervention_learnings') is not null, 'signed-out visitors cannot read the dataset');

  -- ---- admin
  perform pg_temp.ok(pg_temp.try(admin, format('insert into public.orgs (name) values (%L)', 'New client')) is null, 'admin creates a client org');
  perform pg_temp.ok(pg_temp.try(admin, format('insert into public.settings values (%L, %L)', 'run_hour_utc', '5')) is null, 'admin writes settings');
  perform pg_temp.ok(pg_temp.val(admin, format('with d as (delete from public.projects where id = %s returning 1) select count(*) from d', p2)) = '1', 'admin deletes a project');
end $$;

-- ---- structure: every table, view and function, including ones added later
select pg_temp.ok(not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 'every table has row-level security on');
select pg_temp.ok(not exists (select 1 from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'
  and not (table_name = 'site_info' and privilege_type = 'SELECT')), 'signed-out visitors can only read the legal page details');
select pg_temp.ok(not exists (select 1 from information_schema.role_table_grants where grantee in ('anon', 'authenticated') and table_schema = 'public'
  and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')), 'nobody can wipe tables or add triggers');
select pg_temp.ok(not exists (select 1 from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public'
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE') and table_name in ('answers', 'mentions', 'citations', 'extractions', 'runs', 'ai_spend', 'confusions',
  'other_brands', 'batches', 'site_checks', 'fact_findings', 'drafts', 'signups', 'invites', 'api_tokens', 'admin_clients', 'intervention_learnings')),
  'results, spend, runs, keys, invites and sign-ups are writable only by the server');
select pg_temp.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef),
  'no public function runs with raised rights');
select pg_temp.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  and has_function_privilege('anon', p.oid, 'execute')), 'signed-out visitors cannot call any function');
select pg_temp.ok(not exists (select 1 from pg_policies where schemaname = 'public' and (qual = 'true' or with_check = 'true') and tablename <> 'site_info'),
  'no rule lets everyone in (except reading the legal page details)');
select pg_temp.ok(not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v'
  and not coalesce(c.reloptions::text like '%security_invoker=true%', false)), 'every view applies the reader''s own rights');

select 'ALL RLS TESTS PASSED' as result;
rollback;
