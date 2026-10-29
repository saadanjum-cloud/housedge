-- Checks run in the background on Supabase. The worker touches heartbeat_at after every answer; a running check
-- with no heartbeat for a few minutes has stopped (function time limit) and is picked up again where it left off.
alter table public.runs add column heartbeat_at timestamptz;
