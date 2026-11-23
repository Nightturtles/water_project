-- MCP phase 2: let a connected AI app save ONE concentrate at a time
--
-- Concentrates live inside the user's single user_settings row, as two jsonb
-- maps: stock_concentrate_specs (Recipe Concentrates, keyed by slug) and
-- diy_concentrate_specs (Mineral Concentrates, keyed by mineral id). OAuth
-- clients may not write user_settings at all
-- (20261122200921_restrict_oauth_client_access.sql): a whole-row write from
-- outside would race the app's own whole-row upserts and could replace
-- everything in the row.
--
-- This function is the one narrow way in. It is SECURITY DEFINER, so it runs
-- past those policies, and it can only:
--   - act on the caller's own row (auth.uid());
--   - set ONE key in ONE of the two maps, in a single UPDATE that merges into
--     whatever the row holds at that moment (no read-then-write gap);
--   - store a spec it has rebuilt field by field from checked values, so no
--     arbitrary JSON reaches the row.
-- It cannot remove a concentrate, enable one (selected_concentrates), or touch
-- any other setting.
--
-- Known limit, documented in MCP.md: the app still saves this row whole. A
-- device holding unsynced settings changes can overwrite the row after this
-- function ran and drop the concentrate it added. Nothing the user already
-- had is at risk from that; only the newly saved concentrate is.
--
-- First-party sessions may call it too. It grants them nothing they lack:
-- they can already write the whole row.

create or replace function public.mcp_save_concentrate(
  p_kind text,   -- 'stock' (Recipe Concentrate) or 'diy' (Mineral Concentrate)
  p_key  text,   -- stock: the concentrate's slug. diy: the mineral id.
  p_spec jsonb,
  p_mode text    -- 'create': the key must be new. 'update': it must exist.
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid       uuid := auth.uid();
  v_specs     jsonb;
  v_diy_specs jsonb;
  v_found     boolean;
  v_max       int;
  v_existing  jsonb;
  v_clean     jsonb;
  v_minerals  jsonb := '[]'::jsonb;
  v_mineral   jsonb;
  v_label     text;
  v_bottle    numeric;
  v_dose      numeric;
  v_grams     numeric;
  v_drop      numeric;
  v_created   text;
  -- Far above anything a person would keep; the point is a bounded row.
  c_max_stock constant int := 50;
  c_max_diy   constant int := 20;
  -- \Z is end of string. It keeps dollar signs out of this dollar-quoted body.
  c_key_re    constant text := '^[a-z0-9][a-z0-9-]{0,59}\Z';
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('stock', 'diy') then
    raise exception 'kind must be stock or diy' using errcode = '22023';
  end if;
  if p_mode is null or p_mode not in ('create', 'update') then
    raise exception 'mode must be create or update' using errcode = '22023';
  end if;
  if p_key is null or p_key !~ c_key_re then
    raise exception 'invalid concentrate key' using errcode = '22023';
  end if;
  if p_spec is null or jsonb_typeof(p_spec) <> 'object' then
    raise exception 'spec must be an object' using errcode = '22023';
  end if;

  -- Lock the caller's row for the rest of the transaction: the existence and
  -- count checks below and the write then see one consistent row.
  -- (IF branches, not CASE expressions: with a CASE ... END in this body the
  -- CLI cut the statement short and the migration failed to apply.)
  select s.stock_concentrate_specs, s.diy_concentrate_specs
    into v_specs, v_diy_specs
    from public.user_settings s
   where s.user_id = v_uid
     for update;
  v_found := found;
  if p_kind = 'diy' then
    v_specs := v_diy_specs;
    v_max := c_max_diy;
  else
    v_max := c_max_stock;
  end if;
  if not v_found then
    -- No row yet means the app has never synced for this account. Creating
    -- one here would seed every other setting with column defaults, which a
    -- device would then adopt as if the user had chosen them.
    raise exception 'no settings yet: open the Cafelytic app once while signed in'
      using errcode = 'P0002';
  end if;
  if v_specs is null or jsonb_typeof(v_specs) <> 'object' then
    v_specs := '{}'::jsonb;
  end if;
  v_existing := v_specs -> p_key;

  if p_mode = 'create' and v_existing is not null then
    raise exception 'a concentrate with that key already exists' using errcode = '23505';
  end if;
  if p_mode = 'update' and v_existing is null then
    raise exception 'no concentrate with that key' using errcode = 'P0002';
  end if;
  if p_mode = 'create'
     and (select count(*) from jsonb_object_keys(v_specs)) >= v_max then
    raise exception 'too many concentrates' using errcode = '54000';
  end if;

  -- ---- Shared fields -------------------------------------------------------
  if jsonb_typeof(p_spec -> 'bottleMl') is distinct from 'number' then
    raise exception 'bottleMl must be a number' using errcode = '22023';
  end if;
  v_bottle := (p_spec ->> 'bottleMl')::numeric;
  if v_bottle <= 0 or v_bottle > 100000 then
    raise exception 'bottleMl out of range' using errcode = '22023';
  end if;

  -- Optional dropper size, mL per drop. The app stores it to 0.001 mL.
  if p_spec ? 'dropMl' and jsonb_typeof(p_spec -> 'dropMl') <> 'null' then
    if jsonb_typeof(p_spec -> 'dropMl') <> 'number' then
      raise exception 'dropMl must be a number' using errcode = '22023';
    end if;
    v_drop := round((p_spec ->> 'dropMl')::numeric, 3);
    if v_drop < 0.001 or v_drop > 10 then
      raise exception 'dropMl out of range' using errcode = '22023';
    end if;
  end if;

  if p_kind = 'diy' then
    -- ---- Mineral Concentrate: { bottleMl, gramsPerBottle, dropMl? } ---------
    if jsonb_typeof(p_spec -> 'gramsPerBottle') is distinct from 'number' then
      raise exception 'gramsPerBottle must be a number' using errcode = '22023';
    end if;
    v_grams := (p_spec ->> 'gramsPerBottle')::numeric;
    if v_grams <= 0 or v_grams > 100000 then
      raise exception 'gramsPerBottle out of range' using errcode = '22023';
    end if;
    v_clean := jsonb_build_object('bottleMl', v_bottle, 'gramsPerBottle', v_grams);
  else
    -- ---- Recipe Concentrate: { label, bottleMl, doseGramsPerL, minerals[],
    --      dropMl?, createdFrom?, source? } ------------------------------------
    if jsonb_typeof(p_spec -> 'label') is distinct from 'string' then
      raise exception 'label must be text' using errcode = '22023';
    end if;
    v_label := btrim(p_spec ->> 'label');
    if char_length(v_label) < 1 or char_length(v_label) > 60 then
      raise exception 'label must be 1 to 60 characters' using errcode = '22023';
    end if;

    if jsonb_typeof(p_spec -> 'doseGramsPerL') is distinct from 'number' then
      raise exception 'doseGramsPerL must be a number' using errcode = '22023';
    end if;
    v_dose := (p_spec ->> 'doseGramsPerL')::numeric;
    if v_dose <= 0 or v_dose > 1000 then
      raise exception 'doseGramsPerL out of range' using errcode = '22023';
    end if;

    if jsonb_typeof(p_spec -> 'minerals') is distinct from 'array'
       or jsonb_array_length(p_spec -> 'minerals') < 1
       or jsonb_array_length(p_spec -> 'minerals') > 12 then
      raise exception 'minerals must list 1 to 12 entries' using errcode = '22023';
    end if;
    for v_mineral in select * from jsonb_array_elements(p_spec -> 'minerals') loop
      if jsonb_typeof(v_mineral) <> 'object'
         or jsonb_typeof(v_mineral -> 'mineralId') is distinct from 'string'
         or (v_mineral ->> 'mineralId') !~ c_key_re
         or jsonb_typeof(v_mineral -> 'grams') is distinct from 'number' then
        raise exception 'each mineral needs a mineralId and grams' using errcode = '22023';
      end if;
      v_grams := (v_mineral ->> 'grams')::numeric;
      if v_grams <= 0 or v_grams > 100000 then
        raise exception 'mineral grams out of range' using errcode = '22023';
      end if;
      v_minerals := v_minerals || jsonb_build_array(
        jsonb_build_object('mineralId', v_mineral ->> 'mineralId', 'grams', v_grams));
    end loop;

    v_clean := jsonb_build_object(
      'label', v_label,
      'bottleMl', v_bottle,
      'doseGramsPerL', v_dose,
      'minerals', v_minerals);

    -- Where the concentrate came from. The app uses it to recognise the
    -- concentrate made for a recipe, and for its "reset to library values"
    -- link. An update keeps whatever is stored; a new one may only say it was
    -- derived from a recipe.
    if p_mode = 'update' then
      if jsonb_typeof(v_existing -> 'createdFrom') = 'string' then
        v_clean := v_clean || jsonb_build_object('createdFrom', v_existing -> 'createdFrom');
      end if;
      if jsonb_typeof(v_existing -> 'source') = 'string' then
        v_clean := v_clean || jsonb_build_object('source', v_existing -> 'source');
      end if;
    elsif p_spec ? 'createdFrom' and jsonb_typeof(p_spec -> 'createdFrom') <> 'null' then
      v_created := p_spec ->> 'createdFrom';
      if jsonb_typeof(p_spec -> 'createdFrom') <> 'string'
         or v_created !~ '^derived:[a-z0-9][a-z0-9-]{0,79}\Z' then
        raise exception 'createdFrom must be derived:<recipe key>' using errcode = '22023';
      end if;
      v_clean := v_clean || jsonb_build_object('createdFrom', v_created);
    end if;
  end if;

  if v_drop is not null then
    v_clean := v_clean || jsonb_build_object('dropMl', v_drop);
  end if;

  -- One statement, merging into the row as it is now.
  if p_kind = 'stock' then
    update public.user_settings s
       set stock_concentrate_specs =
             coalesce(nullif(s.stock_concentrate_specs, 'null'::jsonb), '{}'::jsonb)
             || jsonb_build_object(p_key, v_clean),
           updated_at = now()
     where s.user_id = v_uid;
  else
    update public.user_settings s
       set diy_concentrate_specs =
             coalesce(nullif(s.diy_concentrate_specs, 'null'::jsonb), '{}'::jsonb)
             || jsonb_build_object(p_key, v_clean),
           updated_at = now()
     where s.user_id = v_uid;
  end if;

  return jsonb_build_object('kind', p_kind, 'key', p_key, 'spec', v_clean, 'previous', v_existing);
end;
$fn$;

revoke all on function public.mcp_save_concentrate(text, text, jsonb, text) from public, anon;
grant execute on function public.mcp_save_concentrate(text, text, jsonb, text) to authenticated;
