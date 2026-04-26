-- =============================================================================
-- Cafelytic — Supabase schema migration 013: brand tray + Empirical profiles
--
-- 1) Adds 'brand' to the tray CHECK constraint, alongside the existing
--    {featured, original, roaster, classic, intro-water}. The new tray
--    holds recipes from coffee-water-mineral companies (Lotus, TWW,
--    Empirical) — distinct from 'roaster' (coffee-roaster house water,
--    e.g. Aviary, Sey) and 'classic' (community formulas, e.g. Holy
--    Water, RPavlis, Hendon).
--
-- 2) Moves 6 existing rows from tray='classic' to tray='brand':
--      - lotus-light-bright, lotus-simple-sweet, lotus-bright-juicy
--        (Lotus filter; bright-juicy seeded in migration 007)
--      - lotus-light-bright-espresso, lotus-simple-sweet-espresso (Lotus
--        espresso)
--      - eaf-tww-espresso-inspired (Third Wave Water profile)
--    Asserts 6 rows updated so a missing/duplicated row fails loudly.
--    Slugs unchanged (preserves user-copied rows that reference them
--    via copyRecipeToMyProfiles).
--
-- 3) Inserts two new library rows for Empirical Water's named filter
--    profiles published on empiricalwater.com/pages/mineral-composition:
--      - empirical-glacial  (35 GH / 24 KH, TDS 61) — clarity-forward
--      - empirical-spring   (65 GH / 23 KH, TDS 86) — body-forward
--    Both light-roast intent per Empirical's "default for light roast"
--    copy. tray='brand'.
--
-- 4) Refreshes aviary-filter ion values to Empirical's published
--    commercial-concentrate spec. The row in migration 004 was
--    reverse-computed from a direct-dosing recipe approximation; same
--    58 GH / 27 KH target but Ca/Mg/Cl/SO4 differ by 11-15%. Empirical's
--    commercial product (the actual concentrate Aviary roastery uses) is
--    the source-of-truth. Slug, brew_method, tray='roaster', roast,
--    tags, creator_display_name preserved (set in migration 006).
--    Aviary Espresso is a separate recipe (no Empirical equivalent),
--    not modified.
-- =============================================================================


-- 1. Extend tray CHECK constraint with 'brand' ------------------------------

ALTER TABLE target_profiles
  DROP CONSTRAINT IF EXISTS target_profiles_tray_check;
ALTER TABLE target_profiles
  ADD CONSTRAINT target_profiles_tray_check
  CHECK (tray IN ('featured', 'original', 'roaster', 'classic', 'intro-water', 'brand'));


-- 2. Move 5 rows from classic → brand ---------------------------------------

DO $$
DECLARE
  v_rows_updated integer;
BEGIN
  UPDATE target_profiles
  SET tray = 'brand'
  WHERE user_id IS NULL
    AND slug IN (
      'lotus-light-bright',
      'lotus-simple-sweet',
      'lotus-bright-juicy',
      'lotus-light-bright-espresso',
      'lotus-simple-sweet-espresso',
      'eaf-tww-espresso-inspired'
    );

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated <> 6 THEN
    RAISE EXCEPTION
      'migration 013 expected to retag 6 rows to brand tray, got %',
      v_rows_updated;
  END IF;
END $$;


-- 3. New rows: Empirical Glacial + Empirical Spring -------------------------
-- Upsert pattern (per migration 006) for re-runnability.

INSERT INTO target_profiles
  (user_id, slug, label, brew_method,
   calcium, magnesium, alkalinity, potassium, sodium, sulfate, chloride, bicarbonate,
   description, is_public, creator_display_name, tags, tray, roast)
VALUES
  (NULL, 'empirical-glacial', 'Empirical Glacial', 'filter',
   9.25, 2.81, 23.95, 0.60, 3.40, 8.77, 6.90, 29.20,
   'Empirical Water Glacial profile. 35 GH / 24 KH, TDS 61 mg/L. Harmonious and lively, emphasizing clarity and complexity. Default for light-roast filter per Empirical.',
   true, 'Empirical Water',
   '["Bright", "Clarity"]',
   'brand',
   '["light"]')
ON CONFLICT (slug) WHERE user_id IS NULL DO UPDATE SET
  label = EXCLUDED.label, brew_method = EXCLUDED.brew_method,
  calcium = EXCLUDED.calcium, magnesium = EXCLUDED.magnesium,
  alkalinity = EXCLUDED.alkalinity, potassium = EXCLUDED.potassium,
  sodium = EXCLUDED.sodium, sulfate = EXCLUDED.sulfate,
  chloride = EXCLUDED.chloride, bicarbonate = EXCLUDED.bicarbonate,
  description = EXCLUDED.description, is_public = EXCLUDED.is_public,
  creator_display_name = EXCLUDED.creator_display_name,
  tags = EXCLUDED.tags, tray = EXCLUDED.tray, roast = EXCLUDED.roast;

INSERT INTO target_profiles
  (user_id, slug, label, brew_method,
   calcium, magnesium, alkalinity, potassium, sodium, sulfate, chloride, bicarbonate,
   description, is_public, creator_display_name, tags, tray, roast)
VALUES
  (NULL, 'empirical-spring', 'Empirical Spring', 'filter',
   17.49, 5.24, 22.55, 0, 0, 20.71, 14.96, 27.50,
   'Empirical Water Spring profile. 65 GH / 23 KH, TDS 86 mg/L. Resonant and concentrated, emphasizing body and richness. Default for light-roast filter per Empirical.',
   true, 'Empirical Water',
   '["Full Body", "Sweet"]',
   'brand',
   '["light"]')
ON CONFLICT (slug) WHERE user_id IS NULL DO UPDATE SET
  label = EXCLUDED.label, brew_method = EXCLUDED.brew_method,
  calcium = EXCLUDED.calcium, magnesium = EXCLUDED.magnesium,
  alkalinity = EXCLUDED.alkalinity, potassium = EXCLUDED.potassium,
  sodium = EXCLUDED.sodium, sulfate = EXCLUDED.sulfate,
  chloride = EXCLUDED.chloride, bicarbonate = EXCLUDED.bicarbonate,
  description = EXCLUDED.description, is_public = EXCLUDED.is_public,
  creator_display_name = EXCLUDED.creator_display_name,
  tags = EXCLUDED.tags, tray = EXCLUDED.tray, roast = EXCLUDED.roast;


-- 4. Refresh aviary-filter to Empirical's published spec --------------------
-- Idempotent: setting absolute values, safe to re-run.

UPDATE target_profiles
SET
  calcium     = 8.75,
  magnesium   = 8.89,
  alkalinity  = 27.02,
  sodium      = 12.42,
  sulfate     = 35.13,
  chloride    = 15.48,
  bicarbonate = 32.95,
  description = 'Aviary Coffee Water by Christopher Feran (Empirical Water concentrate). 58 GH / 27 KH, TDS 114 mg/L. Roastery''s house water for very-light Nordic-style coffees, targeting cup clarity and articulation. Approx. direct-dosing equivalent (within ~15% on Ca/Mg/Cl/SO₄): 0.081g Epsom + 0.028g CaCl₂·2H₂O + 0.045g NaHCO₃ per liter.'
WHERE slug = 'aviary-filter' AND user_id IS NULL;
