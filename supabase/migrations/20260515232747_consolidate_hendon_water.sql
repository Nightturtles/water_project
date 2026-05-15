-- Consolidate duplicate Hendon Water entries in the library.
--
-- Two canonical rows target the same Christopher Hendon water profile, just
-- packaged differently:
--   * 'eaf-hendon-water'      — brew_method='filter', EAF direct-dosing per 10L.
--   * 'bh-simplified-hendon'  — brew_method='all',    Coffee ad Astra stock formula.
-- Numerical differences are <1% on every mineral (rounding noise between
-- publishers). Keep 'bh-simplified-hendon' as canonical (it carries the
-- stockFormula JSON, brew_method='all', and via:coffee-ad-astra provenance);
-- absorb the cleaner "Hendon Water" label; redirect any user references on
-- 'eaf-hendon-water' so nobody loses an active target or a saved rail entry.
--
-- Out of scope here (flagged as follow-ups): the 'hendon-espresso' data bug
-- (Na/SO4/HCO3 zeroed but description claims to match Hendon target), the
-- 'eaf-bh-water-4'/'bh-default' structural duplicate, and the Rao trio
-- naming overlap.

-- 1. Promote bh-simplified-hendon to the canonical Hendon row.
UPDATE target_profiles SET
  label = 'Hendon Water',
  description = 'Christopher Hendon''s Water for Coffee profile (Mg 24 / SO4 95 / KH 31 as CaCO3). High-magnesium, low-buffer hardness for vivid acidity in lighter roasts. Stock recipe (Coffee ad Astra via Barista Hustle): dose 4 g/L of a 200mL bottle containing 12.2g Epsom + 2.6g Baking Soda. Direct-dosing equivalent (Espresso Aficionados): 2.430g Epsom + 0.520g Baking Soda per 10L.',
  creator_display_name = 'Christopher Hendon',
  roast = '["light", "medium"]'::jsonb,
  tags  = '["Bright", "Clarity", "via:coffee-ad-astra"]'::jsonb
WHERE slug = 'bh-simplified-hendon' AND user_id IS NULL;

-- 2. Redirect any user_selections.target_preset pointing at the dupe.
UPDATE user_selections
SET target_preset = 'bh-simplified-hendon'
WHERE target_preset = 'eaf-hendon-water';

-- 3. Rewrite the slug inside added_target_presets (JSONB array). DISTINCT
--    collapses the case where the user happened to have both slugs in the
--    array.
UPDATE user_selections us
SET added_target_presets = (
  SELECT COALESCE(jsonb_agg(DISTINCT new_elem), '[]'::jsonb)
  FROM (
    SELECT CASE
      WHEN elem = '"eaf-hendon-water"'::jsonb THEN '"bh-simplified-hendon"'::jsonb
      ELSE elem
    END AS new_elem
    FROM jsonb_array_elements(us.added_target_presets) AS t(elem)
  ) sub
)
WHERE us.added_target_presets @> '["eaf-hendon-water"]'::jsonb;

-- 4. Strip the now-meaningless tombstone (was a tombstone for the deleted row).
UPDATE user_selections
SET deleted_target_presets = deleted_target_presets - 'eaf-hendon-water'
WHERE deleted_target_presets @> '["eaf-hendon-water"]'::jsonb;

-- 5. Delete the duplicate canonical row.
DELETE FROM target_profiles
WHERE slug = 'eaf-hendon-water' AND user_id IS NULL;

-- 6. Sanity check.
DO $$
DECLARE
  v_canonical integer;
  v_dupe      integer;
BEGIN
  SELECT count(*) INTO v_canonical
    FROM target_profiles WHERE slug = 'bh-simplified-hendon' AND user_id IS NULL;
  SELECT count(*) INTO v_dupe
    FROM target_profiles WHERE slug = 'eaf-hendon-water'     AND user_id IS NULL;
  IF v_canonical <> 1 OR v_dupe <> 0 THEN
    RAISE EXCEPTION 'consolidate_hendon_water failed: canonical=%, dupe=%', v_canonical, v_dupe;
  END IF;
END $$;
