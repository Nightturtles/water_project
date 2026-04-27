-- =============================================================================
-- Cafelytic — Supabase schema migration 011: starter kit data model
--
-- Pairs with the client-side rail filter that limits the taste-page preset
-- rail to 8 starter recipes by default. The full catalog still lives in
-- Supabase and remains reachable via library.html, but a new user no longer
-- sees 28 recipes in their rail on first load.
--
-- Two schema changes:
--
-- 1. target_profiles.is_starter (BOOLEAN) — canonical-row flag. The client's
--    getAllTargetPresets filter includes a library row if
--      (is_starter AND NOT tombstoned) OR (slug in user.added_target_presets)
--    The 8 rows flagged here match the TARGET_PRESETS shim in constants.js.
--    Non-canonical rows (user_id IS NOT NULL) keep the default FALSE and are
--    unaffected — they follow the existing user-publish/save flow.
--
-- 2. user_selections.added_target_presets (JSONB array of slugs) — mirror of
--    deleted_target_presets. Records which non-starter canonical slugs the
--    user has explicitly added from library.html. Symmetric with tombstones:
--    tombstones subtract from the default rail, added adds to it.
--
-- Scoped updates hit user_id IS NULL only. The DO block resets every
-- canonical row to is_starter=false first, then flags the 8 starter slugs.
-- Two asserts guard the final state:
--   (a) the UPDATE flagged exactly 8 rows (catches a missing starter slug)
--   (b) the catalog now has exactly 8 is_starter=true canonical rows
--       (catches drift: a stray is_starter=true row on some other canonical
--       slug that wasn't caught by the UPDATE because we matched by slug).
-- Without (b), ROW_COUNT could pass while the rail ends up with more than
-- eight starters. The reset step makes the migration safe to re-run.
-- =============================================================================


-- 1. target_profiles.is_starter ----------------------------------------------

ALTER TABLE target_profiles
  ADD COLUMN IF NOT EXISTS is_starter boolean NOT NULL DEFAULT false;

DO $$
DECLARE
  v_rows_updated integer;
  v_total_starters integer;
BEGIN
  -- Reset canonicals first so the final set is exactly what the UPDATE
  -- below flags, regardless of prior state on this column.
  UPDATE target_profiles
  SET is_starter = false
  WHERE user_id IS NULL
    AND is_starter = true;

  UPDATE target_profiles
  SET is_starter = true
  WHERE user_id IS NULL
    AND slug IN (
      'sca',
      'eaf-rpavlis',
      'cafelytic-filter',
      'cafelytic-espresso',
      'lotus-light-bright',
      'lotus-simple-sweet',
      'lotus-light-bright-espresso',
      'lotus-simple-sweet-espresso'
    );

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated <> 8 THEN
    RAISE EXCEPTION
      'migration 011 expected to flag 8 starter rows, got %',
      v_rows_updated;
  END IF;

  SELECT COUNT(*) INTO v_total_starters
  FROM target_profiles
  WHERE user_id IS NULL AND is_starter = true;

  IF v_total_starters <> 8 THEN
    RAISE EXCEPTION
      'migration 011 expected catalog to have 8 is_starter canonical rows after update, got %',
      v_total_starters;
  END IF;
END $$;


-- 2. user_selections.added_target_presets ------------------------------------

ALTER TABLE user_selections
  ADD COLUMN IF NOT EXISTS added_target_presets jsonb NOT NULL DEFAULT '[]';
