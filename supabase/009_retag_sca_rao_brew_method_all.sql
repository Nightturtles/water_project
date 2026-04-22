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
-- migration is pure data: two UPDATE statements, no schema change.
--
-- Scoped to user_id IS NULL so only the canonical seeded rows get touched
-- even if a user has coincidentally created a custom profile slugged 'sca'
-- or 'rao' (extremely unlikely but cheap to guard against).
-- =============================================================================


UPDATE target_profiles
SET brew_method = 'all'
WHERE user_id IS NULL
  AND slug IN ('sca', 'rao');
