-- Advisor fixes: site_info already had an admins-only update rule ("admins edit site info"), so the one added in
-- security_hardening was a duplicate; and pg_net belongs in the extensions schema, not public.
drop policy if exists "admins update site info" on public.site_info;
drop extension if exists pg_net;
create extension pg_net with schema extensions;
