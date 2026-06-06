-- =============================================================================
-- Cafelytic — recategorize RPavlis + rename "and" recipes to "&"
--
-- Two pure-data edits to the canonical library (user_id IS NULL). No schema,
-- RLS, or is_starter changes — the 8-row starter set is unchanged (RPavlis was
-- and remains a starter; only its brew method moves).
--
-- 1. eaf-rpavlis: brew_method 'filter' -> 'espresso'. RPavlis is a buffer-only
--    no-scale water that belongs in the espresso rail.
--
-- 2. Canonical recipes whose label uses the word "and" -> "&". Five rows today:
--    lotus-light-bright ("Light and Bright"), lotus-simple-sweet
--    ("Simple and Sweet"), their two espresso variants, and the library-only
--    lotus-bright-juicy ("Bright and Juicy"). The UPDATE touches only the
--    `label` column (descriptions keep their prose "and"), and LIKE '% and %'
--    matches the standalone word — not substrings like "Sandbox".
--
-- Both UPDATEs are scoped to user_id IS NULL so user-published rows are never
-- touched, and each asserts its ROW_COUNT so the migration fails loudly on
-- catalog drift (a missing slug, an unexpected extra "and" label) instead of
-- silently doing the wrong thing. The reset-free shape is safe to re-run:
-- re-applying maps 'espresso'->'espresso' (still 1 row by slug) and
-- ' & '-containing labels no longer match '% and %' (so the second assert would
-- catch a re-run against an already-migrated catalog — see note below).
--
-- NOTE: this migration is NOT idempotent by design — the count-5 assert is a
-- drift guard, not a re-run guard. It is applied exactly once via `db push`.
-- Keep the constants.js TARGET_PRESETS shim byte-identical to the post-migration
-- rows (brewMethod + labels).
-- =============================================================================

DO $$
DECLARE
  v_rows integer;
BEGIN
  -- 1. RPavlis: filter -> espresso
  UPDATE target_profiles
  SET brew_method = 'espresso'
  WHERE user_id IS NULL AND slug = 'eaf-rpavlis';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'expected to recategorize exactly 1 row (eaf-rpavlis), got %', v_rows;
  END IF;

  -- 2. Rename canonical recipes whose label uses the word "and" -> "&".
  UPDATE target_profiles
  SET label = REPLACE(label, ' and ', ' & ')
  WHERE user_id IS NULL AND label LIKE '% and %';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 5 THEN
    RAISE EXCEPTION
      'expected to rename exactly 5 canonical "and" labels, got %', v_rows;
  END IF;
END $$;
