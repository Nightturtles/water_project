-- MCP, before it is offered to the public: write quotas, and a record of what
-- each connected app was approved for
--
-- Both live in the database for the same reason the access rules do
-- (20261122200921_restrict_oauth_client_access.sql): an OAuth client's token
-- is accepted by PostgREST directly, so a limit that only the MCP server's
-- tool code applied could be skipped by calling the REST API.
--
-- Nothing here changes what a first-party session (the web app, the native
-- apps, every version already installed) can do: each check passes untouched
-- when the request carries no `client_id` claim.

-- ===========================================================================
-- 1. Write quota for OAuth clients
-- ===========================================================================
-- One row per (user, UTC day), counting every row that a connected AI app's
-- request wrote for that user, across all of that user's connected apps:
-- recipes and source waters (direct writes RLS allows), and the settings row
-- (reachable only through SECURITY DEFINER functions such as
-- mcp_save_concentrate; auth.jwt() is still the caller's inside them, so the
-- trigger sees those writes as an OAuth client's too). A later function that
-- writes user_settings or user_selections for a connected app is counted with
-- no further work.
--
-- A write that fails, including one refused by the limit itself, rolls back
-- with its statement and is not counted.

create table public.mcp_write_quota (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  day        date        not null,
  count      integer     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

comment on table public.mcp_write_quota is
  'Per-user daily count of rows written by connected AI apps (OAuth clients). Written only by the mcp_count_oauth_write() trigger.';

alter table public.mcp_write_quota enable row level security;
-- No policies: no access for anon / authenticated. The trigger function is
-- SECURITY DEFINER and is the only writer.

create or replace function public.mcp_count_oauth_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid   uuid;
  v_count integer;
  v_rows  integer;
  -- Roomy for a person working with an assistant; stops a runaway or abusive
  -- client within a day.
  c_daily       constant integer := 100;
  -- Far above normal use; bounds how far an account can be filled through an
  -- AI app. The user can still add more in the app itself.
  c_max_recipes constant integer := 500;
  c_max_sources constant integer := 100;
begin
  if not public.is_oauth_client() then
    return new;
  end if;
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Counted first: the row lock on today's counter makes one user's
  -- concurrent writes take turns, so the ceiling checks below see each
  -- other's committed rows.
  insert into public.mcp_write_quota as q (user_id, day, count, updated_at)
  values (v_uid, (now() at time zone 'utc')::date, 1, now())
  on conflict (user_id, day)
  do update set count = q.count + 1, updated_at = now()
  returning q.count into v_count;
  if v_count > c_daily then
    raise exception 'daily save limit for connected apps reached' using errcode = 'MCQ01';
  end if;

  if tg_op = 'INSERT' and tg_table_name = 'target_profiles' then
    select count(*) into v_rows from public.target_profiles t where t.user_id = v_uid;
    if v_rows >= c_max_recipes then
      raise exception 'recipe limit for connected apps reached' using errcode = 'MCQ02';
    end if;
  end if;
  if tg_op = 'INSERT' and tg_table_name = 'source_profiles' then
    select count(*) into v_rows from public.source_profiles s where s.user_id = v_uid;
    if v_rows >= c_max_sources then
      raise exception 'source water limit for connected apps reached' using errcode = 'MCQ02';
    end if;
  end if;

  return new;
end;
$fn$;

revoke all on function public.mcp_count_oauth_write() from public, anon, authenticated;

create trigger mcp_count_oauth_write
  before insert or update on public.target_profiles
  for each row execute function public.mcp_count_oauth_write();

create trigger mcp_count_oauth_write
  before insert or update on public.source_profiles
  for each row execute function public.mcp_count_oauth_write();

create trigger mcp_count_oauth_write
  before insert or update on public.user_settings
  for each row execute function public.mcp_count_oauth_write();

create trigger mcp_count_oauth_write
  before insert or update on public.user_selections
  for each row execute function public.mcp_count_oauth_write();

-- ===========================================================================
-- 2. What each connected app was approved for
-- ===========================================================================
-- Supabase Auth records THAT a user approved an app, not WHAT the consent
-- page listed when they did. Without more, an app connected today silently
-- gains every ability shipped later.
--
-- The list of abilities on the consent page is versioned. Version 1 is
-- everything shipped up to this migration (reads, private recipes and source
-- waters, concentrates). The consent page records the version it showed when
-- the user approved an app. A later ability is gated in its own database
-- function with mcp_app_allows(<its version>), which is false for an app the
-- user has not approved at that version yet; the user approves the new
-- abilities for that app from the Connected apps page.
--
-- An app with no row here was approved before this table existed, or by a
-- page that could not record it. It is treated as version 1, which every
-- approval covers, so nothing that works today is gated.

create table public.mcp_app_consent (
  user_id           uuid        not null references auth.users(id) on delete cascade,
  client_id         text        not null,
  abilities_version integer     not null,
  approved_at       timestamptz not null default now(),
  primary key (user_id, client_id)
);

comment on table public.mcp_app_consent is
  'The version of the consent page''s ability list each user approved for each connected app (OAuth client). Written only by mcp_record_app_consent() / mcp_forget_app_consent(), which refuse OAuth clients.';

alter table public.mcp_app_consent enable row level security;

-- The Connected apps page reads the user's own rows. A connected app has no
-- business reading them.
create policy "mcp_app_consent: users read own rows"
  on public.mcp_app_consent
  for select
  to authenticated
  using (user_id = (select auth.uid()) and not (select public.is_oauth_client()));
-- No insert / update / delete policies: the two functions below are the only
-- writers.

-- The version of the ability list the consent page currently shows. Raise it
-- in the same migration that ships a new ability, and update the page's list
-- (oauth/consent.html) in the same change.
create or replace function public.mcp_abilities_version()
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select 1;
$fn$;

revoke all on function public.mcp_abilities_version() from public;
grant execute on function public.mcp_abilities_version() to anon, authenticated, service_role;

-- Called by the consent page when the user approves an app (or approves new
-- abilities for one). Always records the CURRENT version: the page shows the
-- current list. An app can never approve itself.
create or replace function public.mcp_record_app_consent(p_client_id text)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_version integer := public.mcp_abilities_version();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_oauth_client() then
    raise exception 'a connected app cannot approve abilities' using errcode = '42501';
  end if;
  if p_client_id is null or char_length(p_client_id) < 1 or char_length(p_client_id) > 200 then
    raise exception 'invalid client id' using errcode = '22023';
  end if;
  insert into public.mcp_app_consent as c (user_id, client_id, abilities_version, approved_at)
  values (v_uid, p_client_id, v_version, now())
  on conflict (user_id, client_id)
  do update set abilities_version = excluded.abilities_version, approved_at = now();
  return v_version;
end;
$fn$;

revoke all on function public.mcp_record_app_consent(text) from public, anon;
grant execute on function public.mcp_record_app_consent(text) to authenticated;

-- Called by the Connected apps page after the user disconnects an app, so a
-- later reconnect starts from what the user approves then.
create or replace function public.mcp_forget_app_consent(p_client_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_oauth_client() then
    raise exception 'a connected app cannot change approvals' using errcode = '42501';
  end if;
  delete from public.mcp_app_consent c
   where c.user_id = v_uid and c.client_id = p_client_id;
end;
$fn$;

revoke all on function public.mcp_forget_app_consent(text) from public, anon;
grant execute on function public.mcp_forget_app_consent(text) to authenticated;

-- The gate for an ability added at p_min_version. True for a first-party
-- session, and for version 1 (see above). For a later version, true only when
-- the user approved this app (the token's client_id) at that version or
-- later. SECURITY DEFINER because a connected app cannot read the table.
create or replace function public.mcp_app_allows(p_min_version integer)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_client text := auth.jwt() ->> 'client_id';
begin
  if v_client is null then
    return true;
  end if;
  if p_min_version is null then
    return false;
  end if;
  if p_min_version <= 1 then
    return true;
  end if;
  return exists (
    select 1
      from public.mcp_app_consent c
     where c.user_id = auth.uid()
       and c.client_id = v_client
       and c.abilities_version >= p_min_version
  );
end;
$fn$;

revoke all on function public.mcp_app_allows(integer) from public, anon;
grant execute on function public.mcp_app_allows(integer) to authenticated;
