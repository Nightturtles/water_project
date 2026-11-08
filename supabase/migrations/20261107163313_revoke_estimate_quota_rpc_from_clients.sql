-- Lock increment_estimate_water_quota(uuid) down to the service role.
--
-- 20260519043445_estimate_water_daily_quota.sql ran
--   revoke all on function public.increment_estimate_water_quota(uuid) from public;
-- but Supabase's default privileges grant EXECUTE on new public-schema
-- functions to anon and authenticated *explicitly*, and revoking from the
-- PUBLIC pseudo-role does not remove those grants. Verified on a local stack
-- with every migration applied: proacl still listed anon=X and authenticated=X.
--
-- The function is SECURITY DEFINER and takes an arbitrary user id, so any
-- client holding the publishable key could POST
-- /rest/v1/rpc/increment_estimate_water_quota {p_user_id: <victim>} and burn
-- another user's daily "Estimate from my ZIP" quota (publisher user ids are
-- visible in the public library).
--
-- The estimate-water Edge Function calls it with the service-role key, which
-- keeps its grant, so behavior for real estimates is unchanged.
-- 20260618051513_add_support_submission_quota.sql already revokes from all
-- three roles for its function; this brings the older one in line.

revoke execute on function public.increment_estimate_water_quota(uuid) from anon, authenticated;
grant execute on function public.increment_estimate_water_quota(uuid) to service_role;
