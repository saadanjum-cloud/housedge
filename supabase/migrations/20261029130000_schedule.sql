-- Hourly schedule: the database calls the api function's /cron/tick, which resumes stopped checks and starts due
-- ones (daily / every 3 days / weekly), each through the same spending locks as Run now. The shared secret lives in
-- Supabase Vault (name 'cron_secret') and as the CRON_SECRET function secret; it is never written in this file.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('housedge-tick') where exists (select 1 from cron.job where jobname = 'housedge-tick');
select cron.schedule('housedge-tick', '7 * * * *', $job$
  select net.http_post(
    url := 'https://fnvfhxhccuntvewpwfnc.supabase.co/functions/v1/api/cron/tick',
    headers := '{"Content-Type": "application/json", "x-region": "eu-central-1"}'::jsonb,
    body := jsonb_build_object('secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    timeout_milliseconds := 10000
  );
$job$);
