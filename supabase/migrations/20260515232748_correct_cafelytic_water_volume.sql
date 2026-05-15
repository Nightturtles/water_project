-- Cafelytic Filter and Espresso target ppm values were inflated 1.85x because
-- the documented gram doses dissolve in 1.85 L of brew water, not 1 L as the
-- previous description claimed. Rescale every ppm field to the corrected
-- per-liter value (current value / 1.85) and update the description to
-- clarify the 1.85 L volume.
--
-- Ca/Mg/KH on the Filter snap to the user-stated integers (4 / 10 / 11) per
-- the corrected profile (GH 48 / KH 11 / TDS 69). Other fields use 2-decimal
-- precision per the house style. Espresso applies the same /1.85 rescale to
-- every field.
--
-- The constants.js TARGET_PRESETS shim and these rows must stay byte-
-- identical (see comment at constants.js TARGET_PRESETS).

DO $$
DECLARE
  v_rows integer;
BEGIN
  -- Filter
  UPDATE target_profiles
  SET
    calcium     = 4,
    magnesium   = 10,
    alkalinity  = 11,
    potassium   = 8.65,
    chloride    = 34.05,
    bicarbonate = 13.18,
    description =
      'Cafelytic in-house light-roast filter recipe. Direct dosing per 1.85L: '
      || '0.024g CaCl₂·2H₂O + 0.148g MgCl₂·6H₂O + 0.040g KHCO₃. '
      || 'Mg-dominant, Cl-heavy, sodium-free, sulfate-free.'
  WHERE user_id IS NULL AND slug = 'cafelytic-filter';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'correct_cafelytic_water_volume: Filter expected 1 row, got %', v_rows;
  END IF;

  -- Espresso
  UPDATE target_profiles
  SET
    calcium     = 2.16,
    magnesium   = 8.65,
    alkalinity  = 17.30,
    potassium   = 13.51,
    chloride    = 29.19,
    bicarbonate = 21.09,
    description =
      'Cafelytic in-house espresso companion to Cafelytic Filter. Direct dosing per 1.85L: '
      || '0.015g CaCl₂·2H₂O + 0.134g MgCl₂·6H₂O + 0.064g KHCO₃. '
      || 'Preserves the Cafelytic house character (Cl-heavy, no SO₄, sodium-free, K-buffered) at espresso concentrations.'
  WHERE user_id IS NULL AND slug = 'cafelytic-espresso';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'correct_cafelytic_water_volume: Espresso expected 1 row, got %', v_rows;
  END IF;
END $$;
