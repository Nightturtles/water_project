-- Restrict what OAuth clients (AI apps connected through the MCP server) can do
--
-- Supabase Auth's OAuth 2.1 server issues a normal user JWT to third-party
-- clients, with one extra claim: `client_id`. First-party sessions (the web
-- app and the native apps) carry no `client_id`. That token is accepted by
-- PostgREST directly, so the limits the MCP server applies in its tool code
-- (supabase/functions/mcp) could be skipped by anyone who takes their token
-- and calls the REST API themselves. The limits therefore live here too.
--
-- Every policy below is RESTRICTIVE: it is AND-ed with the existing permissive
-- "own row" policies and can only remove access. Each one passes untouched
-- when `client_id` is absent, so first-party behavior (every app version
-- already installed included) is unchanged.
--
-- What an OAuth client may do after this migration:
--   target_profiles  read own + public rows; insert / update own PRIVATE rows
--                    in the ordinary tray; never publish, never edit a
--                    published row, never delete
--   source_profiles  read / insert / update own rows; never delete
--   user_settings    read only (phase 2 adds a narrow RPC for concentrates)
--   user_selections  read only
--   delete_account() refused
--
-- Publishing stays a manual action in the app on purpose: the public Recipe
-- Library must not be fillable by an automated client.

-- ---------------------------------------------------------------------------
-- Helper: true when the current request is from an OAuth client
-- ---------------------------------------------------------------------------
-- STABLE + wrapped in (select ...) at the call sites so Postgres evaluates it
-- once per statement (an initplan), not once per row.

create or replace function public.is_oauth_client()
returns boolean
language sql
stable
set search_path = ''
as $$
  select (auth.jwt() ->> 'client_id') is not null;
$$;

revoke all on function public.is_oauth_client() from public;
grant execute on function public.is_oauth_client() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- target_profiles
-- ---------------------------------------------------------------------------

-- Insert: private rows only, attributed to the caller, in the default tray.
-- `tray` is pinned because idx_target_profiles_featured_unique is global: a
-- row inserted with tray = 'featured' would take the one featured slot.
create policy "target_profiles: oauth clients insert private rows only"
  on public.target_profiles
  as restrictive
  for insert
  to authenticated
  with check (
    not (select public.is_oauth_client())
    or (
      is_public is not true
      and creator_user_id = (select auth.uid())
      and tray = 'classic'
      and is_starter is not true
    )
  );

-- Update: USING hides published rows from the update (so they cannot be
-- edited), WITH CHECK refuses a result that is public or re-attributed.
create policy "target_profiles: oauth clients update private rows only"
  on public.target_profiles
  as restrictive
  for update
  to authenticated
  using (
    not (select public.is_oauth_client())
    or is_public is not true
  )
  with check (
    not (select public.is_oauth_client())
    or (
      is_public is not true
      and tray = 'classic'
      and is_starter is not true
    )
  );

create policy "target_profiles: oauth clients cannot delete"
  on public.target_profiles
  as restrictive
  for delete
  to authenticated
  using (not (select public.is_oauth_client()));

-- ---------------------------------------------------------------------------
-- source_profiles
-- ---------------------------------------------------------------------------

create policy "source_profiles: oauth clients cannot delete"
  on public.source_profiles
  as restrictive
  for delete
  to authenticated
  using (not (select public.is_oauth_client()));

-- ---------------------------------------------------------------------------
-- user_settings / user_selections: read only for OAuth clients
-- ---------------------------------------------------------------------------
-- Both are single rows per user that every device upserts whole
-- (src/lib/sync.ts), with no per-key merge. An outside writer would race those
-- upserts, so OAuth clients get no write path here at all.

create policy "user_settings: oauth clients cannot insert"
  on public.user_settings
  as restrictive
  for insert
  to authenticated
  with check (not (select public.is_oauth_client()));

create policy "user_settings: oauth clients cannot update"
  on public.user_settings
  as restrictive
  for update
  to authenticated
  using (not (select public.is_oauth_client()))
  with check (not (select public.is_oauth_client()));

create policy "user_selections: oauth clients cannot insert"
  on public.user_selections
  as restrictive
  for insert
  to authenticated
  with check (not (select public.is_oauth_client()));

create policy "user_selections: oauth clients cannot update"
  on public.user_selections
  as restrictive
  for update
  to authenticated
  using (not (select public.is_oauth_client()))
  with check (not (select public.is_oauth_client()));

-- ---------------------------------------------------------------------------
-- delete_account(): refuse OAuth clients
-- ---------------------------------------------------------------------------
-- Same body as 20260526022411_delete_account.sql plus the client check. The
-- function is SECURITY DEFINER, so RLS above does not cover it.

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

  if public.is_oauth_client() then
    raise exception 'account deletion is not available to connected apps'
      using errcode = '42501';
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
