-- =============================================================================
-- Cafelytic — Supabase schema migration 009: editorial re-tag sca + rao
--
-- Promotes the SCA Standard and Rao's Recipe canonical library rows from
-- brew_method='filter' to brew_method='all'. Both are universally-applicable
-- water profiles (SCA target composition is the industry benchmark for any
-- brew method; Rao's Recipe is a balanced starting-point that Rao himself
-- documents using for both pour-over and espresso). Tagging them 'filter'
-- was an oversight in migration 007 — they should surface in both the
-- Filter and Espresso filter views of the recipe browser.
--
-- Wave C shipped the client-side semantics for brew_method='all' (the
-- targetProfileSupportsBrewMethod predicate short-circuits to true). The
-- CHECK constraint allowing 'all' on library rows landed in 008. This
-- migration is pure data: one UPDATE statement affecting two slugs, no
-- schema change.
--
-- Scoped to user_id IS NULL so only the canonical seeded rows get touched
-- even if a user has coincidentally created a custom profile slugged 'sca'
-- or 'rao' (extremely unlikely but cheap to guard against).
--
-- The DO block asserts the affected-row count so the migration fails loudly
-- if either canonical row is missing (e.g. running against an environment
-- where 007 wasn't applied) or somehow duplicated — surfaces catalog drift
-- instead of silently no-op'ing.
-- =============================================================================


DO $$
DECLARE
  v_rows_updated integer;
BEGIN
  UPDATE target_profiles
  SET brew_method = 'all'
  WHERE user_id IS NULL
    AND slug IN ('sca', 'rao');

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated <> 2 THEN
    RAISE EXCEPTION
      'migration 009 expected to update 2 canonical rows (sca, rao), got %',
      v_rows_updated;
  END IF;
END $$;
