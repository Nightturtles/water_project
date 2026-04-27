-- =============================================================================
-- Cafelytic — Add recipes from robertasami.com
-- Adds Aviary (filter & espresso) and RAsami Week 1 series.
-- Updates Fam's 29th Wave brew_method to espresso.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Fix: Fam's 29th Wave should be espresso, not filter
-- ---------------------------------------------------------------------------

UPDATE target_profiles
  SET brew_method = 'espresso',
      tags = '["Balanced"]'
  WHERE slug = 'eaf-fam-29th-wave';


-- ---------------------------------------------------------------------------
-- New recipes (ion values calculated from compound g/L on robertasami.com)
-- ---------------------------------------------------------------------------

INSERT INTO target_profiles (user_id, slug, label, brew_method, calcium, magnesium, alkalinity, potassium, sodium, sulfate, chloride, bicarbonate, description, is_public, creator_display_name, tags)
VALUES
  -- Aviary Filter: 0.081g epsom + 0.028g CaCl₂ + 0.045g NaHCO₃ per liter
  (NULL, 'aviary-filter', 'Aviary Filter', 'filter',
   7.63, 7.99, 26.80, 0, 12.32, 31.57, 13.50, 32.68,
   '58 GH / 27 KH. Direct dosing: 0.081g Epsom + 0.028g CaCl₂ + 0.045g NaHCO₃ per liter.',
   true, 'Cafelytic', '["Balanced"]'),

  -- Aviary Espresso: 0.028g epsom + 0.010g CaCl₂ + 0.100g NaHCO₃ per liter
  (NULL, 'aviary-espresso', 'Aviary Espresso', 'espresso',
   2.73, 2.76, 59.57, 0, 27.37, 10.91, 4.82, 72.63,
   '20 GH / 60 KH. Direct dosing: 0.028g Epsom + 0.010g CaCl₂ + 0.100g NaHCO₃ per liter.',
   true, 'Cafelytic', '["Round"]'),

  -- RAsami Week 1 Day 1: 0.150g epsom + 0.025g NaHCO₃ per liter
  (NULL, 'rasami-w1d1', 'RAsami Week 1 Day 1', 'filter',
   0, 14.79, 14.89, 0, 6.84, 58.46, 0, 18.16,
   '60 GH / 15 KH. Starter recipe based on Holy Water. 0.150g Epsom + 0.025g NaHCO₃ per liter.',
   true, 'Cafelytic', '["Bright", "Clarity"]'),

  -- RAsami Week 1 Day 2: 0.044g CaCl₂ + 0.025g NaHCO₃ per liter
  (NULL, 'rasami-w1d2', 'RAsami Week 1 Day 2', 'filter',
   12.00, 0, 14.89, 0, 6.84, 0, 21.22, 18.16,
   '40 GH / 15 KH. Calcium-only hardness for lighter washed coffees. 0.044g CaCl₂ + 0.025g NaHCO₃ per liter.',
   true, 'Cafelytic', '["Sweet", "Delicate"]'),

  -- RAsami Week 1 Day 3: 0.100g epsom + 0.022g CaCl₂ + 0.025g NaHCO₃ per liter
  (NULL, 'rasami-w1d3', 'RAsami Week 1 Day 3', 'filter',
   6.00, 9.86, 14.89, 0, 6.84, 38.97, 10.61, 18.16,
   '60 GH / 15 KH. Introduces Mg+Ca blending. 0.100g Epsom + 0.022g CaCl₂ + 0.025g NaHCO₃ per liter.',
   true, 'Cafelytic', '["Balanced"]'),

  -- RAsami Week 1 Day 4: 0.050g epsom + 0.044g CaCl₂ + 0.025g NaHCO₃ per liter
  (NULL, 'rasami-w1d4', 'RAsami Week 1 Day 4', 'filter',
   12.00, 4.93, 14.89, 0, 6.84, 19.49, 21.22, 18.16,
   '60 GH / 15 KH. Calcium-leaning variant of Day 3. 0.050g Epsom + 0.044g CaCl₂ + 0.025g NaHCO₃ per liter.',
   true, 'Cafelytic', '["Sweet", "Full Body"]'),

  -- RAsami Week 1 Day 5: 0.074g epsom + 0.033g CaCl₂ + 0.030g KHCO₃ per liter
  (NULL, 'rasami-w1d5', 'RAsami Week 1 Day 5', 'filter',
   9.00, 7.30, 14.99, 11.72, 0, 28.84, 15.92, 18.28,
   '60 GH / 15 KH. Introduces KHCO₃ as alternative buffer. 0.074g Epsom + 0.033g CaCl₂ + 0.030g KHCO₃ per liter.',
   true, 'Cafelytic', '["Balanced", "Bright"]'),

  -- RAsami Week 1 Day 6: 0.030g MgCl₂ + 0.037g epsom + 0.017g CaCl₂ + 0.017g NaHCO₃ + 0.010g KHCO₃ + 0.015g NaCl per liter
  (NULL, 'rasami-w1d6', 'RAsami Week 1 Day 6', 'filter',
   4.63, 7.24, 15.12, 3.91, 10.55, 14.42, 27.76, 18.44,
   '40 GH / 15 KH + 15ppm NaCl. Complex multi-mineral blend. 0.030g MgCl₂ + 0.037g Epsom + 0.017g CaCl₂ + 0.017g NaHCO₃ + 0.010g KHCO₃ + 0.015g NaCl per liter.',
   true, 'Cafelytic', '["Balanced", "Full Body"]'),

  -- RAsami Week 1 Day 7: 0.037g epsom + 0.017g CaCl₂ + 0.008g NaHCO₃ + 0.010g KHCO₃ + 0.020g NaCl per liter
  (NULL, 'rasami-w1d7', 'RAsami Week 1 Day 7', 'filter',
   4.63, 3.65, 9.76, 3.91, 10.06, 14.42, 20.33, 11.90,
   '30 GH / 10 KH + 20ppm NaCl. Low-mineral with salt enhancement. 0.037g Epsom + 0.017g CaCl₂ + 0.008g NaHCO₃ + 0.010g KHCO₃ + 0.020g NaCl per liter.',
   true, 'Cafelytic', '["Delicate", "Clarity"]'),

  -- Sey: Ca 20 (CaCl₂ → Cl 35.39), Mg 15 (Epsom → SO₄ 59.29), KH 15 (KHCO₃ → K 11.72, HCO₃ 18.29)
  (NULL, 'sey', 'Sey', 'filter',
   20, 15, 15, 11.72, 0, 59.29, 35.39, 18.29,
   'Sey roaster''s water. 20ppm Ca (CaCl₂), 15ppm Mg (Epsom), 15 KH via KHCO₃.',
   true, 'Cafelytic', '["Balanced"]');
