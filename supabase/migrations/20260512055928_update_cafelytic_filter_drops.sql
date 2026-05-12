-- Update the Cafelytic Filter starter recipe to the new dosing:
--   2 round drops CaCl2.2H2O + 9 round drops MgCl2.6H2O + 5 round drops KHCO3
-- per liter (Lotus round dropper, 0.0716 mL/drop).
--
-- Previous dosing was 1/10/5 straight drops (calibrated by direct gram
-- measurement: 0.007g/0.092g/0.023g per L). The new recipe lifts Ca from 2
-- to 7 mg/L and KH from 11 to 20 mg/L as CaCO3 so the profile sits within
-- preferred bands rather than firing a low-Ca warn.
--
-- The constants.js TARGET_PRESETS shim and this row must stay byte-identical
-- (see comment at constants.js TARGET_PRESETS).

DO $$
DECLARE
  v_rows_updated integer;
BEGIN
  UPDATE target_profiles
  SET
    calcium = 7,
    magnesium = 18,
    alkalinity = 20,
    potassium = 16,
    chloride = 63,
    bicarbonate = 24.39,
    description =
      'Cafelytic in-house light-roast filter recipe. Direct dosing per liter: '
      || '0.024g CaCl₂·2H₂O + 0.148g MgCl₂·6H₂O + 0.040g KHCO₃. '
      || 'Mg-dominant, Cl-heavy, sodium-free, sulfate-free.'
  WHERE user_id IS NULL
    AND slug = 'cafelytic-filter';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated <> 1 THEN
    RAISE EXCEPTION
      'update_cafelytic_filter_drops expected to update 1 row, got %',
      v_rows_updated;
  END IF;
END $$;
