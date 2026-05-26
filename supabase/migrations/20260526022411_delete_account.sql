-- delete_account()
--
-- Apple Guideline 5.1.1(v) and Google Play's Data Deletion policy require any
-- app with account creation to expose account deletion inside the app, not
-- only via a web dashboard. This RPC wipes the calling user's row from
-- auth.users, which cascades through the FKs declared in:
--   20260412105500_schema.sql          -> user_settings, source_profiles,
--                                         target_profiles (user_id),
--                                         user_selections
--   20260519043445_estimate_water_daily_quota.sql -> estimate_water_quota
--
-- target_profiles.creator_user_id is intentionally NO ACTION on the FK (see
-- 20260417225300_add_creator_user_id.sql), so the cascade alone leaves
-- copied / shared recipes with dangling UID references. We null those out
-- here so no residue of the deleted user remains anywhere in the schema.
-- UI surfaces render the resulting null as "Anonymous User" via the
-- creatorDisplayLabel helper (src/lib/creator-display.ts).
--
-- SECURITY DEFINER lets the function delete from auth.users while still
-- being callable only by an authenticated user against their own row
-- (enforced via auth.uid()). search_path is pinned to a closed set so a
-- malicious schema can't shadow auth or public during the call.

create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Drop attribution on any recipe this user originated. Cascading would
  -- delete the recipe rows themselves; we want them to survive (other users
  -- may have saved/copied them) with the creator shown as "Anonymous User".
  update public.target_profiles
    set creator_user_id = null
    where creator_user_id = v_uid;

  -- Cascades clean user_settings, source_profiles, target_profiles (user-
  -- owned rows via user_id), user_selections, estimate_water_quota.
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
