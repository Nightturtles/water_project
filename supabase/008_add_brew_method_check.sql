-- =============================================================================
-- Cafelytic — Supabase schema migration 008: brew_method canonical values
--
-- Introduces a CHECK constraint that restricts `brew_method` on library rows
-- (user_id IS NULL) to the canonical vocabulary: 'filter' | 'espresso' | 'all'.
-- The 'all' value is new in the recipe-browser spec v2 taxonomy — it means a
-- recipe genuinely works across both brewing methods (e.g. SCA target water,
-- some roaster-published waters). The client's targetProfileSupportsBrewMethod
-- short-circuits to true when brewMethod === 'all'.
--
-- Scoped to user_id IS NULL so user-owned recipes aren't constrained — users
-- can continue to store whatever brew_method values they had pre-v2. This
-- mirrors the same scoping pattern 006 applied to the tags CHECK after we
-- discovered 'Low TDS' on a user row would otherwise block migration apply.
--
-- No data changes. Re-tagging specific library rows to 'all' (SCA, Rao
-- candidates) is deferred to a separate editorial PR.
-- =============================================================================


ALTER TABLE target_profiles
  DROP CONSTRAINT IF EXISTS target_profiles_brew_method_check;

ALTER TABLE target_profiles
  ADD CONSTRAINT target_profiles_brew_method_check
  CHECK (
    user_id IS NOT NULL
    OR brew_method IN ('filter', 'espresso', 'all')
  );
