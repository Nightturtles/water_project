-- =============================================================================
-- Cafelytic — backfill via:coffee-ad-astra traceability tag
--
-- Two changes:
--   1. Widen the target_profiles_tags_check whitelist to allow
--      'via:coffee-ad-astra' on library rows (user_id IS NULL). The original
--      whitelist (migration 20260421154300) restricts library tags to the
--      6 flavor tags surfaced in LIBRARY_TAGS — a deliberate guardrail
--      against curatorial drift. Adding 'via:coffee-ad-astra' to the
--      whitelist is a strict relaxation (existing rows remain valid) so we
--      can drop+re-add the constraint with no NOT VALID/VALIDATE dance.
--   2. Append 'via:coffee-ad-astra' to the tags JSONB array on the 12 Coffee
--      ad Astra rows seeded by 20260506231724_add_coffee_ad_astra_recipes.sql.
--      The tag identifies which catalogued source the recipe came from for
--      future analytics / admin reporting (mirrors stock_formula.via, but
--      surfaced on every row in a queryable column). The 'via:' prefix is the
--      convention; the client filters tags matching /^via:/ from chip
--      rendering (recipe-browser.js) so this stays metadata, not user-facing
--      display.
--
-- Idempotent on re-run: the NOT (tags @> ...) guard makes the UPDATE a no-op
-- on already-tagged rows; DROP IF EXISTS + ADD makes the constraint swap
-- safe to replay.
-- =============================================================================

ALTER TABLE target_profiles
  DROP CONSTRAINT IF EXISTS target_profiles_tags_check;
ALTER TABLE target_profiles
  ADD CONSTRAINT target_profiles_tags_check
  CHECK (
    user_id IS NOT NULL
    OR (
      jsonb_typeof(tags) = 'array'
      AND tags <@ '["Full Body", "Balanced", "Bright", "Sweet", "Juicy", "Clarity", "via:coffee-ad-astra"]'::jsonb
    )
  );

UPDATE target_profiles
SET tags = COALESCE(tags, '[]'::jsonb) || '["via:coffee-ad-astra"]'::jsonb
WHERE user_id IS NULL
  AND slug IN (
    'rao-perger',
    'dan-eils',
    'matt-perger',
    'rao-2013',
    'melbourne-2013-wbc',
    'world-of-coffee-budapest',
    'bh-simplified-sca-optimal',
    'bh-default',
    'bh-simplified-rao-2008',
    'bh-simplified-hendon',
    'bh-hard',
    'bh-hard-af'
  )
  AND NOT COALESCE(tags @> '["via:coffee-ad-astra"]'::jsonb, false);

-- Sanity check: the 12 Coffee ad Astra rows must all carry the tag now,
-- whether this migration just wrote it or a prior run already did. Hard-fail
-- if not — unexpected drift in the canonical library is worth a loud signal.
DO $$
DECLARE
  expected_count integer := 12;
  actual_count integer;
BEGIN
  SELECT COUNT(*) INTO actual_count
  FROM target_profiles
  WHERE user_id IS NULL
    AND slug IN (
      'rao-perger', 'dan-eils', 'matt-perger', 'rao-2013',
      'melbourne-2013-wbc', 'world-of-coffee-budapest',
      'bh-simplified-sca-optimal', 'bh-default',
      'bh-simplified-rao-2008', 'bh-simplified-hendon',
      'bh-hard', 'bh-hard-af'
    )
    AND COALESCE(tags @> '["via:coffee-ad-astra"]'::jsonb, false);
  IF actual_count <> expected_count THEN
    RAISE EXCEPTION 'Expected % Coffee ad Astra rows tagged via:coffee-ad-astra, found %', expected_count, actual_count;
  END IF;
END $$;
