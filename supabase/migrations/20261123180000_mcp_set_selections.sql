-- MCP phase 3: let a connected AI app change the user's active selections
--
-- Until now an OAuth client (an AI app connected through the MCP server) could
-- read user_settings and user_selections but write neither, apart from saving
-- one concentrate through public.mcp_save_concentrate. Both tables stay closed
-- to direct writes (20261122200921_restrict_oauth_client_access.sql): each is
-- one row per user that the app upserts whole, so a whole-row write from
-- outside could replace everything in it.
--
-- This migration adds three narrow ways in. Each is SECURITY DEFINER, acts
-- only on the caller's own row (auth.uid()), locks that row, and changes only
-- the fields named here in one UPDATE that keeps everything else as it is at
-- that moment:
--
--   mcp_set_enabled              switch ONE mineral or ONE concentrate on or
--                                off (user_settings.selected_minerals /
--                                selected_concentrates)
--   mcp_set_active_recipe        make one recipe the active one
--                                (user_selections.target_preset; adds a
--                                library recipe to the user's rail, and
--                                switches user_settings.brew_method when the
--                                recipe is for the other brew method, because
--                                the app only shows a recipe in its own mode)
--   mcp_set_active_source_water  make one source water the active one
--                                (user_selections.source_preset and the
--                                source_water values, always together)
--
-- mcp_set_enabled switches on only ids the app knows, and only a concentrate
-- that exists and is fully set up. None of them can delete anything, lift a delete (the deleted_* lists are
-- never written), change a concentrate's contents, or touch any other setting.
--
-- Known limit, documented in MCP.md: the app still saves each of these rows
-- whole. A device holding unsynced changes can write its copy back afterwards
-- and undo a switch made here. Nothing is lost by that; the selection simply
-- goes back to what that device had.
--
-- First-party sessions may call these too. They grant them nothing they lack.
--
-- These are the first abilities added after the list on the consent page was
-- versioned (20261123064216_mcp_write_quota_and_app_consent.sql), so this
-- migration raises that version to 2 and each function refuses, with SQLSTATE
-- MCA01, an app the user has not approved at version 2: one connected while
-- the page still said an app "cannot switch concentrates on". The user
-- approves the new abilities for such an app on the Connected apps page.
-- Every write here is also counted by that migration's daily quota trigger.
--
-- (IF branches, not CASE expressions, and \Z instead of a dollar anchor: see
-- 20261123013834_mcp_save_concentrate.sql.)

-- The consent page's ability list, version 2: version 1 plus switching
-- minerals and concentrates on or off and choosing the active recipe and
-- source water. Same signature and grants as before.
create or replace function public.mcp_abilities_version()
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select 2;
$fn$;

-- An approval is for the list the user was shown. The consent page now says
-- which version of the list it displayed, and an approval is refused, with
-- nothing written, when that is not the current version (SQLSTATE MCA02): a
-- page loaded before the list grew cannot approve abilities it never showed.
-- The page then asks the user to reload. A call without a version (a page
-- from before this migration) records the current version, as it did.
-- Replaces the one-argument function from
-- 20261123064216_mcp_write_quota_and_app_consent.sql.
drop function if exists public.mcp_record_app_consent(text);

create or replace function public.mcp_record_app_consent(
  p_client_id text,
  p_shown_version integer default null
)
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
  if p_shown_version is not null and p_shown_version <> v_version then
    raise exception 'the list of abilities has changed: reload the page' using errcode = 'MCA02';
  end if;
  insert into public.mcp_app_consent as c (user_id, client_id, abilities_version, approved_at)
  values (v_uid, p_client_id, v_version, now())
  on conflict (user_id, client_id)
  do update set abilities_version = excluded.abilities_version, approved_at = now();
  return v_version;
end;
$fn$;

revoke all on function public.mcp_record_app_consent(text, integer) from public, anon;
grant execute on function public.mcp_record_app_consent(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Helper: is this jsonb value a number above zero?
-- ---------------------------------------------------------------------------
-- The app has stored concentrate fields both as numbers and as numeric text,
-- and reads them with Number(). Internal: not callable through the API.

create or replace function public.mcp_is_positive(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_text text;
begin
  if p_value is null or jsonb_typeof(p_value) not in ('number', 'string') then
    return false;
  end if;
  v_text := btrim(p_value #>> '{}');
  if v_text !~ '^[0-9]{1,9}(\.[0-9]{1,9})?\Z' then
    return false;
  end if;
  return v_text::numeric > 0;
end;
$fn$;

revoke all on function public.mcp_is_positive(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- mcp_set_enabled: one mineral or one concentrate, on or off
-- ---------------------------------------------------------------------------

create or replace function public.mcp_set_enabled(
  p_kind    text,     -- 'mineral' or 'concentrate'
  p_id      text,     -- mineral id, or stock:<key> / diy:<mineral id> / brand:<id>
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid       uuid := auth.uid();
  v_minerals  jsonb;
  v_concs     jsonb;
  v_stock     jsonb;
  v_diy       jsonb;
  v_list      jsonb;
  v_new       jsonb;
  v_spec      jsonb;
  v_was_on    boolean;
  -- Far above anything the app offers; the point is a bounded row.
  c_max       constant int := 60;
  -- The ids the app knows (MINERAL_DB and BRAND_CONCENTRATES in
  -- src/lib/constants.ts). They live in the app's code, so they are repeated
  -- here; tests/mcp-selection-ids.test.ts fails when the two drift apart. A new
  -- mineral or brand concentrate needs a migration that re-creates this
  -- function with the longer list before an AI app can switch it on.
  c_mineral_ids constant text[] := array[
    'calcium-chloride', 'calcium-chloride-anhydrous', 'epsom-salt', 'baking-soda',
    'potassium-bicarbonate', 'magnesium-chloride', 'gypsum', 'potassium-chloride',
    'sodium-chloride'];
  c_brand_ids constant text[] := array[
    'brand:lotus:calcium', 'brand:lotus:magnesium', 'brand:lotus:sodium-bicarbonate',
    'brand:lotus:potassium-bicarbonate'];
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.mcp_app_allows(2) then
    raise exception 'this app has not been approved for this ability' using errcode = 'MCA01';
  end if;
  if p_kind is null or p_kind not in ('mineral', 'concentrate') then
    raise exception 'kind must be mineral or concentrate' using errcode = '22023';
  end if;
  if p_enabled is null then
    raise exception 'enabled must be true or false' using errcode = '22023';
  end if;
  if p_id is null or char_length(p_id) < 1 or char_length(p_id) > 80 then
    raise exception 'invalid id' using errcode = '22023';
  end if;

  select s.selected_minerals, s.selected_concentrates,
         s.stock_concentrate_specs, s.diy_concentrate_specs
    into v_minerals, v_concs, v_stock, v_diy
    from public.user_settings s
   where s.user_id = v_uid
     for update;
  if not found then
    -- No row yet means the app has never synced for this account. Creating
    -- one here would seed every other setting with column defaults.
    raise exception 'no settings yet: open the Cafelytic app once while signed in'
      using errcode = 'P0002';
  end if;

  if p_kind = 'mineral' then
    if v_minerals is null or jsonb_typeof(v_minerals) <> 'array' then
      -- Treating a missing list as empty would drop the starter minerals.
      raise exception 'no settings yet: open the Cafelytic app once while signed in'
        using errcode = 'P0002';
    end if;
    v_list := v_minerals;
  else
    if v_concs is null or jsonb_typeof(v_concs) <> 'array' then
      v_concs := '[]'::jsonb;
    end if;
    v_list := v_concs;
  end if;
  v_was_on := v_list ? p_id;

  if p_enabled and not v_was_on then
    -- Switching on: the id must be something that can be dosed.
    if p_kind = 'mineral' then
      if not (p_id = any (c_mineral_ids)) then
        raise exception 'unknown mineral id' using errcode = '22023';
      end if;
    elsif p_id like 'stock:%' then
      if v_stock is null or jsonb_typeof(v_stock) <> 'object' then
        v_stock := '{}'::jsonb;
      end if;
      v_spec := v_stock -> substr(p_id, 7);
      if v_spec is null or jsonb_typeof(v_spec) <> 'object' then
        raise exception 'no concentrate with that id' using errcode = 'P0002';
      end if;
      if not public.mcp_is_positive(v_spec -> 'bottleMl')
         or not public.mcp_is_positive(v_spec -> 'doseGramsPerL')
         or jsonb_typeof(v_spec -> 'minerals') is distinct from 'array'
         or jsonb_array_length(v_spec -> 'minerals') < 1 then
        raise exception 'that concentrate is not fully set up' using errcode = '55000';
      end if;
    elsif p_id like 'diy:%' then
      if v_diy is null or jsonb_typeof(v_diy) <> 'object' then
        v_diy := '{}'::jsonb;
      end if;
      v_spec := v_diy -> substr(p_id, 5);
      if v_spec is null or jsonb_typeof(v_spec) <> 'object' then
        raise exception 'no concentrate with that id' using errcode = 'P0002';
      end if;
      if not public.mcp_is_positive(v_spec -> 'bottleMl')
         or not public.mcp_is_positive(v_spec -> 'gramsPerBottle') then
        raise exception 'that concentrate is not fully set up' using errcode = '55000';
      end if;
    elsif not (p_id = any (c_brand_ids)) then
      raise exception 'unknown concentrate id' using errcode = '22023';
    end if;

    if jsonb_array_length(v_list) >= c_max then
      raise exception 'too many selected' using errcode = '54000';
    end if;
    v_new := v_list || jsonb_build_array(p_id);
  elsif not p_enabled and v_was_on then
    -- Switching off removes that exact id, whatever it is (an entry whose
    -- concentrate was deleted included), and keeps the order of the rest.
    select coalesce(jsonb_agg(e.value order by e.ord), '[]'::jsonb)
      into v_new
      from jsonb_array_elements(v_list) with ordinality as e(value, ord)
     where e.value <> to_jsonb(p_id);
  else
    v_new := v_list;
  end if;

  if v_new is distinct from v_list then
    if p_kind = 'mineral' then
      update public.user_settings s
         set selected_minerals = v_new, updated_at = now()
       where s.user_id = v_uid;
    else
      update public.user_settings s
         set selected_concentrates = v_new, updated_at = now()
       where s.user_id = v_uid;
    end if;
  end if;

  return jsonb_build_object(
    'kind', p_kind,
    'id', p_id,
    'enabled', p_enabled,
    'changed', v_new is distinct from v_list,
    'selected', v_new);
end;
$fn$;

revoke all on function public.mcp_set_enabled(text, text, boolean) from public, anon;
grant execute on function public.mcp_set_enabled(text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- mcp_set_active_recipe
-- ---------------------------------------------------------------------------
-- The recipe must be one the app can show on this account's recipe rail: the
-- caller's own (private or published), or an official library recipe. Another
-- user's community recipe is refused: the app only puts those on the rail as a
-- saved copy, and saving a copy is the user's action.

create or replace function public.mcp_set_active_recipe(p_recipe_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid        uuid := auth.uid();
  v_slug       text;
  v_owner      uuid;
  v_starter    boolean;
  v_brew       text;
  v_need       text;
  v_prev       text;
  v_deleted    jsonb;
  v_added      jsonb;
  v_added_now  boolean := false;
  v_prev_brew  text;
  v_brew_now   boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.mcp_app_allows(2) then
    raise exception 'this app has not been approved for this ability' using errcode = 'MCA01';
  end if;
  if p_recipe_id is null then
    raise exception 'recipe id is required' using errcode = '22023';
  end if;

  select t.slug, t.user_id, coalesce(t.is_starter, false), t.brew_method
    into v_slug, v_owner, v_starter, v_brew
    from public.target_profiles t
   where t.id = p_recipe_id
     and (t.user_id = v_uid or (t.user_id is null and t.is_public is true));
  if not found then
    raise exception 'no recipe with that id that this account can make active'
      using errcode = 'P0002';
  end if;

  select s.target_preset, s.deleted_target_presets, s.added_target_presets
    into v_prev, v_deleted, v_added
    from public.user_selections s
   where s.user_id = v_uid
     for update;
  if not found then
    raise exception 'no settings yet: open the Cafelytic app once while signed in'
      using errcode = 'P0002';
  end if;
  if v_deleted is null or jsonb_typeof(v_deleted) <> 'array' then
    v_deleted := '[]'::jsonb;
  end if;
  if v_added is null or jsonb_typeof(v_added) <> 'array' then
    v_added := '[]'::jsonb;
  end if;

  -- The app hides a recipe the user removed, and this function never lifts a
  -- delete: bringing it back is the user's action in the app.
  if v_deleted ? v_slug then
    raise exception 'that recipe was removed in the app' using errcode = '55000';
  end if;

  if v_owner is null then
    -- The app shows the user's own recipe in place of a library recipe with
    -- the same key, so making the library one active would show theirs.
    if exists (select 1 from public.target_profiles o
                where o.user_id = v_uid and o.slug = v_slug) then
      raise exception 'this account has its own version of that recipe: use its id'
        using errcode = '55000';
    end if;
    -- A library recipe outside the starter set shows only once it is on the
    -- user's rail. Adding it is what the app's "Add" button does.
    if not v_starter and not (v_added ? v_slug) then
      v_added := v_added || jsonb_build_array(v_slug);
      v_added_now := true;
    end if;
  end if;

  -- The app lists a recipe only in its own brew method ('all' shows in both),
  -- and falls back to another recipe when the active one is not listed.
  if v_brew = 'espresso' then
    v_need := 'espresso';
  elsif v_brew = 'all' then
    v_need := null;
  else
    v_need := 'filter';
  end if;
  if v_need is not null then
    select s.brew_method into v_prev_brew
      from public.user_settings s
     where s.user_id = v_uid
       for update;
    if not found then
      raise exception 'no settings yet: open the Cafelytic app once while signed in'
        using errcode = 'P0002';
    end if;
    -- The app reads anything but 'espresso' as filter.
    if v_prev_brew is distinct from 'espresso' then
      v_prev_brew := 'filter';
    end if;
    if v_prev_brew <> v_need then
      update public.user_settings s
         set brew_method = v_need, updated_at = now()
       where s.user_id = v_uid;
      v_brew_now := true;
    end if;
  end if;

  if v_prev is distinct from v_slug or v_added_now then
    update public.user_selections s
       set target_preset = v_slug,
           added_target_presets = v_added,
           updated_at = now()
     where s.user_id = v_uid;
  end if;

  return jsonb_build_object(
    'target_preset', v_slug,
    'previous', v_prev,
    'changed', v_prev is distinct from v_slug,
    'added_to_rail', v_added_now,
    'brew_method', v_need,
    'brew_method_changed', v_brew_now);
end;
$fn$;

revoke all on function public.mcp_set_active_recipe(uuid) from public, anon;
grant execute on function public.mcp_set_active_recipe(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- mcp_set_active_source_water
-- ---------------------------------------------------------------------------
-- The app keeps the active source water as a key plus the seven ion values its
-- Starting Water fields hold. They are always written together here.
--
-- A key that is one of the caller's saved source waters takes its values from
-- that row; p_ions is ignored. Any other key is one of the app's built-in
-- waters, whose values live in the app's code, not in the database, so the
-- caller sends them and they are checked and rebuilt field by field. The MCP
-- server only ever sends a real built-in's own values. Used directly, the
-- most this allows is what typing numbers into the Starting Water fields does.

create or replace function public.mcp_set_active_source_water(
  p_key  text,
  p_ions jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_prev     text;
  v_deleted  jsonb;
  v_water    jsonb := '{}'::jsonb;
  v_saved    boolean := false;
  v_ion      text;
  v_value    numeric;
  r_row      record;
  c_key_re   constant text := '^[a-z0-9][a-z0-9-]{0,59}\Z';
  c_ions     constant text[] := array[
    'calcium', 'magnesium', 'potassium', 'sodium', 'sulfate', 'chloride', 'bicarbonate'];
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.mcp_app_allows(2) then
    raise exception 'this app has not been approved for this ability' using errcode = 'MCA01';
  end if;
  -- 'custom' is the app's hand-typed water, not a source water to select.
  if p_key is null or p_key !~ c_key_re or p_key = 'custom' then
    raise exception 'invalid source water key' using errcode = '22023';
  end if;

  select s.source_preset, s.deleted_source_presets
    into v_prev, v_deleted
    from public.user_selections s
   where s.user_id = v_uid
     for update;
  if not found then
    raise exception 'no settings yet: open the Cafelytic app once while signed in'
      using errcode = 'P0002';
  end if;
  if v_deleted is not null and jsonb_typeof(v_deleted) = 'array' and v_deleted ? p_key then
    raise exception 'that source water was removed in the app' using errcode = '55000';
  end if;

  select p.calcium, p.magnesium, p.potassium, p.sodium, p.sulfate, p.chloride, p.bicarbonate
    into r_row
    from public.source_profiles p
   where p.user_id = v_uid and p.slug = p_key;
  if found then
    v_saved := true;
    v_water := jsonb_build_object(
      'calcium', coalesce(r_row.calcium, 0),
      'magnesium', coalesce(r_row.magnesium, 0),
      'potassium', coalesce(r_row.potassium, 0),
      'sodium', coalesce(r_row.sodium, 0),
      'sulfate', coalesce(r_row.sulfate, 0),
      'chloride', coalesce(r_row.chloride, 0),
      'bicarbonate', coalesce(r_row.bicarbonate, 0));
  else
    if p_ions is null or jsonb_typeof(p_ions) <> 'object' then
      raise exception 'no saved source water with that key' using errcode = 'P0002';
    end if;
    foreach v_ion in array c_ions loop
      if not (p_ions ? v_ion) or jsonb_typeof(p_ions -> v_ion) = 'null' then
        v_value := 0;
      elsif jsonb_typeof(p_ions -> v_ion) <> 'number' then
        raise exception 'ion values must be numbers' using errcode = '22023';
      else
        v_value := (p_ions ->> v_ion)::numeric;
        if v_value < 0 or v_value > 10000 then
          raise exception 'ion value out of range' using errcode = '22023';
        end if;
      end if;
      v_water := v_water || jsonb_build_object(v_ion, v_value);
    end loop;
  end if;

  update public.user_selections s
     set source_preset = p_key,
         source_water = v_water,
         updated_at = now()
   where s.user_id = v_uid;

  return jsonb_build_object(
    'source_preset', p_key,
    'previous', v_prev,
    'changed', v_prev is distinct from p_key,
    'from_saved_row', v_saved,
    'source_water', v_water);
end;
$fn$;

revoke all on function public.mcp_set_active_source_water(text, jsonb) from public, anon;
grant execute on function public.mcp_set_active_source_water(text, jsonb) to authenticated;
