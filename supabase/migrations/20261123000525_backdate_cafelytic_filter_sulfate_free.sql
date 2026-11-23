-- Put '(Sulfate Free) Cafelytic Filter' after the house recipes in the
-- Cafelytic Originals carousel.
--
-- Library sections other than Intro to Water render in fetch order, which is
-- created_at DESC. Migration 20261122191254 inserted the sulfate-free row
-- without a created_at, so it took now() and sorts ahead of 'cafelytic-filter'
-- and 'cafelytic-espresso' (both created 2026-04-21 in the same statement).
--
-- Backdate it to one second before the row it was copied from. Ordering is a
-- property of the data, so installed apps pick this up without a release.

DO $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE target_profiles AS t
  SET created_at = src.created_at - interval '1 second'
  FROM target_profiles AS src
  WHERE t.user_id IS NULL
    AND t.slug = 'cafelytic-filter-sulfate-free'
    AND src.user_id IS NULL
    AND src.slug = 'cafelytic-filter';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'backdate_cafelytic_filter_sulfate_free: expected to update 1 row, got %', v_rows;
  END IF;
END $$;
