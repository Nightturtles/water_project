-- =============================================================================
-- Cafelytic — Supabase schema migration 010: library refresh
--
-- Seven library-page updates bundled into one migration because they all
-- touch the canonical target_profiles catalog and share the same scoping
-- guarantee (user_id IS NULL). The client-side changes that pair with this
-- migration live in recipe-browser.js and constants.js (not sql).
--
-- 1. Delete test recipes that leaked into the public catalog
--    (SmokeWaterCreated, SmokeTest, "666 test 3", Cafelytic Water). Scoped
--    by is_public=true so private user drafts with the same labels — if any
--    exist — are untouched. No row-count assert: these may not exist in
--    every env (e.g. staging that was never polluted), which is fine.
--
-- 2. Extend the tray CHECK constraint to include 'intro-water' for the new
--    RAsami onboarding tray. 'featured' stays in the enum for back-compat
--    (cached clients still validate) even though we stop writing it.
--
-- 3. Drop the partial unique index on tray='featured'. The client now picks
--    the featured recipe by slug per brew method (FEATURED_PICKS in
--    recipe-browser.js) instead of by tray value, so no catalog row needs
--    tray='featured'. Index becomes dead weight and blocks step 4.
--
-- 4. Re-tag Cafelytic Filter from tray='featured' to tray='original'. Its
--    natural home is the Cafelytic Originals tray; the client renders it
--    as Featured independently of this column. Asserts 1 row updated.
--
-- 5. Re-tag RAsami Week 1 Days 1–7 from tray='classic' to tray='intro-water'.
--    Pairs with the new "Intro to Water" tray the client renders between
--    Cafelytic Originals and Roaster Recipes. Asserts 7 rows updated so a
--    missing/duplicated RAsami row fails the migration loudly.
--
-- All scoped to user_id IS NULL — canonical-library rows only.
-- =============================================================================


-- 1. Delete test recipes leaked into the public catalog ----------------------

DELETE FROM target_profiles
WHERE is_public = true
  AND user_id IS NULL
  AND label IN ('SmokeWaterCreated', 'SmokeTest', '666 test 3', 'Cafelytic Water');


-- 2. Extend tray CHECK constraint --------------------------------------------

ALTER TABLE target_profiles
  DROP CONSTRAINT IF EXISTS target_profiles_tray_check;
ALTER TABLE target_profiles
  ADD CONSTRAINT target_profiles_tray_check
  CHECK (tray IN ('featured', 'original', 'roaster', 'classic', 'intro-water'));


-- 3. Drop featured-uniqueness partial index ----------------------------------

DROP INDEX IF EXISTS idx_target_profiles_featured_unique;


-- 4. Re-tag Cafelytic Filter from featured to original -----------------------

DO $$
DECLARE
  v_rows_updated integer;
BEGIN
  UPDATE target_profiles
  SET tray = 'original'
  WHERE user_id IS NULL
    AND slug = 'cafelytic-filter';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated <> 1 THEN
    RAISE EXCEPTION
      'migration 010 expected to update 1 cafelytic-filter row, got %',
      v_rows_updated;
  END IF;
END $$;


-- 5. Re-tag RAsami Week 1 Days 1–7 into the Intro to Water tray --------------

DO $$
DECLARE
  v_rows_updated integer;
BEGIN
  UPDATE target_profiles
  SET tray = 'intro-water'
  WHERE user_id IS NULL
    AND slug IN (
      'rasami-w1d1', 'rasami-w1d2', 'rasami-w1d3', 'rasami-w1d4',
      'rasami-w1d5', 'rasami-w1d6', 'rasami-w1d7'
    );

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated <> 7 THEN
    RAISE EXCEPTION
      'migration 010 expected to update 7 rasami week-1 rows, got %',
      v_rows_updated;
  END IF;
END $$;
