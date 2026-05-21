-- Per-user daily quota for the estimate-water Edge Function.
--
-- One row per (user_id, day). The Edge Function calls
-- `increment_estimate_water_quota(user_id)` before invoking Anthropic,
-- which atomically inserts or increments the count and returns the new
-- value. If the returned count > the daily limit, the function returns
-- 429 daily_limit and skips the upstream call.
--
-- Cache hits live entirely client-side (localStorage), so they never
-- touch this table — the count only reflects calls that incurred real
-- Anthropic cost.
--
-- Daily reset happens implicitly: a new day means a new
-- (user_id, current_date) row, starting at 1.
--
-- RLS is enabled with no policies, so client roles cannot read or
-- write the table directly. The Edge Function uses the service-role
-- key to bypass RLS.

create table public.estimate_water_quota (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

comment on table public.estimate_water_quota is
  'Per-user daily call count for the estimate-water Edge Function. Written exclusively via increment_estimate_water_quota() by the Edge Function (service role).';

alter table public.estimate_water_quota enable row level security;
-- No policies = no access for anon/authenticated roles. Only the
-- service role (used by the Edge Function) can read or write.

create or replace function public.increment_estimate_water_quota(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  insert into estimate_water_quota (user_id, day, count, updated_at)
  values (p_user_id, current_date, 1, now())
  on conflict (user_id, day)
  do update set count = estimate_water_quota.count + 1, updated_at = now()
  returning count into new_count;
  return new_count;
end;
$$;

comment on function public.increment_estimate_water_quota(uuid) is
  'Atomically increment today''s estimate-water call count for the given user and return the new count. Called by the estimate-water Edge Function via the service role.';

-- Lock the function down: only the service role may execute it. The
-- function is SECURITY DEFINER and the table denies all client access,
-- so even if a client somehow obtained the function name, the grants
-- would refuse the call.
revoke all on function public.increment_estimate_water_quota(uuid) from public;
grant execute on function public.increment_estimate_water_quota(uuid) to service_role;
