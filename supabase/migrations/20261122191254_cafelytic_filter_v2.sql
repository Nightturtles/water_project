-- Cafelytic Filter 2.0 becomes the house filter recipe.
--
-- The canonical 'cafelytic-filter' row keeps its slug and label and takes the
-- 2.0 values in place. The slug has to stay: installed apps hardcode it as the
-- new-user default, the library hero and the front of the filter rail, so a
-- new slug would leave them presenting the old recipe as the flagship.
--
-- The previous (sulfate-free) recipe is preserved as a new canonical row,
-- 'cafelytic-filter-sulfate-free', in the Cafelytic Originals tray. It is not
-- a starter, so it is on nobody's rail by default; anyone who wants it back
-- adds it from the library.
--
-- The 'cafelytic-filter' values and description here must stay byte-identical
-- to the TARGET_PRESETS shim in src/lib/constants.ts.

DO $$
DECLARE
  v_rows integer;
BEGIN
  -- 1. Preserve the current recipe under its new slug, copying every column
  --    from the live row so nothing (tags, roast, creator) drifts.
  INSERT INTO target_profiles
    (user_id, slug, label, brew_method,
     calcium, magnesium, alkalinity, potassium, sodium, sulfate, chloride, bicarbonate,
     description, is_public, creator_display_name, tags, tray, roast, is_starter)
  SELECT
    NULL, 'cafelytic-filter-sulfate-free', '(Sulfate Free) Cafelytic Filter', brew_method,
    calcium, magnesium, alkalinity, potassium, sodium, sulfate, chloride, bicarbonate,
    'The original Cafelytic in-house light-roast filter recipe. Direct dosing per 1.85L: '
      || '0.024g CaCl₂·2H₂O + 0.148g MgCl₂·6H₂O + 0.040g KHCO₃. '
      || 'Mg-dominant, Cl-heavy, sodium-free, sulfate-free.',
    true, creator_display_name, tags, 'original', roast, false
  FROM target_profiles
  WHERE user_id IS NULL AND slug = 'cafelytic-filter';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'cafelytic_filter_v2: expected to insert 1 sulfate-free row, got %', v_rows;
  END IF;

  -- 2. Move the house recipe to the 2.0 values.
  UPDATE target_profiles
  SET
    calcium     = 4,
    magnesium   = 11,
    alkalinity  = 11,
    potassium   = 9,
    sodium      = 0,
    sulfate     = 16,
    chloride    = 26,
    bicarbonate = 13,
    description =
      'Cafelytic in-house light-roast filter recipe. '
      || 'Mg-dominant with a chloride and sulfate blend, sodium-free, K-buffered.',
    updated_at  = now()
  WHERE user_id IS NULL AND slug = 'cafelytic-filter';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'cafelytic_filter_v2: expected to update 1 cafelytic-filter row, got %', v_rows;
  END IF;
END $$;
