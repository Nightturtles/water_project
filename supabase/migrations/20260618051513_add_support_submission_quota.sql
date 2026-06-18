-- Per-IP daily quota for the public submit-support Edge Function.
-- submit-support is verify_jwt = false; there is no user id to rate-limit on,
-- so we bucket by a SHA-256 hash of the client IP. One row per (ip_hash, day).
-- The Edge Function calls increment_support_quota(ip_hash) after input
-- validation and before the Resend send; if the returned count exceeds the
-- daily limit, it returns 429 and does not send. IP hashing keeps raw IPs out
-- of the table. Coarse abuse speed bump only: x-forwarded-for can be spoofed
-- and shared NAT/CGNAT IPs share a bucket. RLS enabled + no policies =
-- service-role-only.

create table public.support_submission_quota (
  ip_hash text not null,
  day date not null default current_date,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (ip_hash, day)
);

comment on table public.support_submission_quota is
  'Per-IP daily submit count for the submit-support Edge Function. Written exclusively via increment_support_quota() by the Edge Function (service role).';

alter table public.support_submission_quota enable row level security;
-- No policies = no access for anon/authenticated. Service role only.

create or replace function public.increment_support_quota(p_ip_hash text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  insert into support_submission_quota (ip_hash, day, count, updated_at)
  values (p_ip_hash, current_date, 1, now())
  on conflict (ip_hash, day)
  do update set count = support_submission_quota.count + 1, updated_at = now()
  returning count into new_count;
  return new_count;
end;
$$;

comment on function public.increment_support_quota(text) is
  'Atomically increment today''s submit-support count for the given IP hash and return the new count. Called by the submit-support Edge Function via the service role.';

revoke all on function public.increment_support_quota(text) from public, anon, authenticated;
grant execute on function public.increment_support_quota(text) to service_role;
