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
-- Scoped updates hit user_id IS NULL only. Row-count assert = 8 so a
-- missing or duplicated starter slug fails the migration loudly instead of
-- silently leaving the rail under- or over-populated.
-- =============================================================================


-- 1. target_profiles.is_starter ----------------------------------------------

ALTER TABLE target_profiles
  ADD COLUMN IF NOT EXISTS is_starter boolean NOT NULL DEFAULT false;

DO $$
DECLARE
  v_rows_updated integer;
BEGIN
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
END $$;


-- 2. user_selections.added_target_presets ------------------------------------

ALTER TABLE user_selections
  ADD COLUMN IF NOT EXISTS added_target_presets jsonb NOT NULL DEFAULT '[]';
