-- Email on the profile, written when the account is created (by the join function), so the team can see who is who
-- without a privileged function over auth.users. Same visibility as the profile: yourself, your company, the team.
alter table public.profiles add column email text check (length(email) <= 200);
-- A person cannot change their recorded email from the browser (only the name and job title).
revoke update on public.profiles from authenticated;
grant update (full_name, job_title) on public.profiles to authenticated;
