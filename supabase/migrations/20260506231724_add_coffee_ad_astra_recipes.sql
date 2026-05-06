-- =============================================================================
-- Cafelytic — seed Coffee ad Astra recipe catalog
--
-- Inserts 12 multi-mineral stock recipes catalogued in the 2018 Coffee ad Astra
-- "Water for Coffee Extraction" blog post by Jonathan Gagné. Each recipe
-- attributes its original author (Rao, Perger, Eils, Barista Hustle, etc.)
-- and links its dispensing formula via stock_formula jsonb.
--
-- Per-row source: scripts/compute-coffee-ad-astra-ions.cjs computes the
-- resulting brew-water ion targets from the stock formula. Re-run that script
-- if the source recipes ever change.
--
-- Existing 'rao' slug (Scott Rao's filter target — Ca 20.9 / Mg 8.5 / Alk 40)
-- is unrelated to 'rao-perger' below; the two coexist intentionally.
-- =============================================================================

INSERT INTO target_profiles
  (user_id, slug, label, brew_method,
   calcium, magnesium, alkalinity, potassium, sodium, sulfate, chloride, bicarbonate,
   description, is_public, creator_display_name, tags, tray, roast,
   stock_formula)
VALUES
  -- Author's #1 — Scott Rao + Matt Perger five-mineral stock. Bright,
  -- well-balanced; both sulfate and chloride contributions.
  (NULL, 'rao-perger', 'Rao/Perger', 'all',
   10.9, 14.6, 40.2, 15.6, 9.3, 39, 33.2, 49.1,
   'Scott Rao and Matt Perger''s five-mineral stock. Bright, well-balanced multi-mineral profile with both sulfate and chloride contributions. The author''s #1 in blind tests.',
   true, 'Scott Rao',
   '["Balanced","Bright"]',
   'classic',
   '["all"]',
   '{"bottleMl":200,"doseGramsPerL":4,"minerals":[{"mineralId":"epsom-salt","grams":5},{"mineralId":"magnesium-chloride","grams":2},{"mineralId":"calcium-chloride","grams":2},{"mineralId":"baking-soda","grams":1.7},{"mineralId":"potassium-bicarbonate","grams":2}],"source":"Scott Rao","via":"Coffee ad Astra (Jonathan Gagné, Dec 2018)"}'::jsonb),

  -- Sulfate-free three-mineral stock. K-buffered; chloride-only extraction.
  (NULL, 'dan-eils', 'Dan Eils', 'all',
   27.3, 12, 50, 39.1, 0, 0, 83.1, 60.9,
   'Dan Eils'' sulfate-free recipe. Magnesium chloride + calcium chloride extraction with potassium-buffered alkalinity.',
   true, 'Dan Eils',
   '["Sweet","Balanced"]',
   'classic',
   '["all"]',
   '{"bottleMl":200,"doseGramsPerL":4,"minerals":[{"mineralId":"magnesium-chloride","grams":5},{"mineralId":"calcium-chloride","grams":5},{"mineralId":"potassium-bicarbonate","grams":5}],"source":"Dan Eils","via":"Coffee ad Astra (Jonathan Gagné, Dec 2018)"}'::jsonb),

  -- Two-mineral epsom + NaHCO3. Magnesium-only extraction, sodium-buffered.
  (NULL, 'matt-perger', 'Matt Perger', 'all',
   0, 19.7, 40.5, 0, 18.6, 77.9, 0, 49.4,
   'Matt Perger''s two-mineral stock. Epsom + baking soda; magnesium-only extraction, sodium-buffered alkalinity.',
   true, 'Matt Perger',
   '["Bright"]',
   'classic',
   '["all"]',
   '{"bottleMl":200,"doseGramsPerL":4,"minerals":[{"mineralId":"epsom-salt","grams":10},{"mineralId":"baking-soda","grams":3.4}],"source":"Matt Perger","via":"Coffee ad Astra (Jonathan Gagné, Dec 2018)"}'::jsonb),

  -- Earlier (2013-era) Rao recipe: Mg + Ca chloride extraction, sodium-buffered.
  (NULL, 'rao-2013', 'Rao 2013', 'all',
   21.8, 9.6, 40.5, 0, 18.6, 0, 66.5, 49.4,
   'Earlier Rao recipe with magnesium chloride and calcium chloride extraction, sodium-buffered alkalinity. No sulfate.',
   true, 'Scott Rao',
   '["Sweet"]',
   'classic',
   '["all"]',
   '{"bottleMl":200,"doseGramsPerL":4,"minerals":[{"mineralId":"magnesium-chloride","grams":4},{"mineralId":"calcium-chloride","grams":4},{"mineralId":"baking-soda","grams":3.4}],"source":"Scott Rao","via":"Coffee ad Astra (Jonathan Gagné, Dec 2018)"}'::jsonb),

  -- Ultra-soft from the 2013 Melbourne WBC. Low TDS for delicate light roasts.
  (NULL, 'melbourne-2013-wbc', 'Melbourne 2013 WBC', 'all',
   0, 5.7, 11.9, 0, 5.5, 22.6, 0, 14.5,
   'Ultra-soft profile from the 2013 Melbourne World Barista Championship. Low TDS for sensitive lighter roasts.',
   true, 'World Barista Championship 2013',
   '["Bright","Clarity"]',
   'classic',
   '["light"]',
   '{"bottleMl":200,"doseGramsPerL":4,"minerals":[{"mineralId":"epsom-salt","grams":2.9},{"mineralId":"baking-soda","grams":1}],"source":"World Barista Championship 2013","via":"Coffee ad Astra (Jonathan Gagné, Dec 2018)"}'::jsonb),

  -- Two-mineral WoC Budapest. Same epsom+NaHCO3 family as Matt Perger.
  (NULL, 'world-of-coffee-budapest', 'World of Coffee Budapest', 'all',
   0, 12.2, 40.5, 0, 18.6, 48.3, 0, 49.4,
   'Two-mineral epsom + baking soda recipe used at the World of Coffee Budapest competition.',
   true, 'World of Coffee Budapest',
   '["Balanced"]',
   'classic',
   '["all"]',
   '{"bottleMl":200,"doseGramsPerL":4,"minerals":[{"mineralId":"epsom-salt","grams":6.2},{"mineralId":"baking-soda","grams":3.4}],"source":"World of Coffee Budapest","via":"Coffee ad Astra (Jonathan Gagné, Dec 2018)"}'::jsonb),

  -- Barista Hustle "simplified" series — escalating epsom + NaHCO3 ratios
  -- forming a soft → Hard AF spectrum. Same two-mineral family.
  (NULL, 'bh-simplified-sca-optimal', 'BH Simplified SCA Optimal', 'all',
   0, 16.6, 40.5, 0, 18.6, 65.5, 0, 49.4,
   'Barista Hustle''s two-mineral approximation of the SCA optimal target. Epsom + baking soda only.',
   true, 'Barista Hustle',
   '["Balanced"]',
   'classic',
   '["all"]',
   '{"bottleMl":200,"doseGramsPerL":4,"minerals":[{"mineralId":"epsom-salt","grams":8.4},{"mineralId":"baking-soda","grams":3.4}],"source":"Barista Hustle","via":"Coffee ad Astra (Jonathan Gagné, Dec 2018)"}'::jsonb),

  (NULL, 'bh-default', 'Barista Hustle (default)', 'all',
   0, 19.3, 40.5, 0, 18.6, 76.4, 0, 49.4,
   'Barista Hustle''s default two-mineral filter recipe.',
   true, 'Barista Hustle',
   '["Balanced"]',
   'classic',
   '["all"]',
   '{"bottleMl":200,"doseGramsPerL":4,"minerals":[{"mineralId":"epsom-salt","grams":9.8},{"mineralId":"baking-soda","grams":3.4}],"source":"Barista Hustle","via":"Coffee ad Astra (Jonathan Gagné, Dec 2018)"}'::jsonb),

  (NULL, 'bh-simplified-rao-2008', 'BH Simplified Rao 2008', 'all',
   0, 18.1, 50, 0, 23, 71.7, 0, 61,
   'Barista Hustle''s two-mineral simplification of Scott Rao''s 2008 recipe.',
   true, 'Barista Hustle',
   '["Sweet"]',
   'classic',
   '["all"]',
   '{"bottleMl":200,"doseGramsPerL":4,"minerals":[{"mineralId":"epsom-salt","grams":9.2},{"mineralId":"baking-soda","grams":4.2}],"source":"Barista Hustle","via":"Coffee ad Astra (Jonathan Gagné, Dec 2018)"}'::jsonb),

  (NULL, 'bh-simplified-hendon', 'BH Simplified Hendon', 'all',
   0, 24.1, 31, 0, 14.2, 95.1, 0, 37.8,
   'Barista Hustle''s two-mineral take on Christopher Hendon''s Water for Coffee profile. Higher hardness, lower buffer.',
   true, 'Barista Hustle',
   '["Bright"]',
   'classic',
   '["all"]',
   '{"bottleMl":200,"doseGramsPerL":4,"minerals":[{"mineralId":"epsom-salt","grams":12.2},{"mineralId":"baking-soda","grams":2.6}],"source":"Barista Hustle","via":"Coffee ad Astra (Jonathan Gagné, Dec 2018)"}'::jsonb),

  (NULL, 'bh-hard', 'BH Hard', 'all',
   0, 30.4, 34.6, 0, 15.9, 120, 0, 42.1,
   'Barista Hustle''s hard-water recipe — high magnesium, low buffer, for vivid acidity.',
   true, 'Barista Hustle',
   '["Bright"]',
   'classic',
   '["light"]',
   '{"bottleMl":200,"doseGramsPerL":4,"minerals":[{"mineralId":"epsom-salt","grams":15.4},{"mineralId":"baking-soda","grams":2.9}],"source":"Barista Hustle","via":"Coffee ad Astra (Jonathan Gagné, Dec 2018)"}'::jsonb),

  (NULL, 'bh-hard-af', 'BH Hard AF', 'all',
   0, 42.4, 45.3, 0, 20.8, 167.6, 0, 55.2,
   'Barista Hustle''s most extreme hard-water profile ("Hard as Falcon"). Use for very low-yield extractions.',
   true, 'Barista Hustle',
   '["Bright"]',
   'classic',
   '["light"]',
   '{"bottleMl":200,"doseGramsPerL":4,"minerals":[{"mineralId":"epsom-salt","grams":21.5},{"mineralId":"baking-soda","grams":3.8}],"source":"Barista Hustle","via":"Coffee ad Astra (Jonathan Gagné, Dec 2018)"}'::jsonb);


-- Assert all 12 rows landed. Catches catalog drift loudly (e.g. if someone
-- edits this migration to drop a row or a slug collides on rerun).
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM target_profiles
  WHERE user_id IS NULL
    AND slug IN (
      'rao-perger', 'dan-eils', 'matt-perger', 'rao-2013',
      'melbourne-2013-wbc', 'world-of-coffee-budapest',
      'bh-simplified-sca-optimal', 'bh-default', 'bh-simplified-rao-2008',
      'bh-simplified-hendon', 'bh-hard', 'bh-hard-af'
    );

  IF v_count <> 12 THEN
    RAISE EXCEPTION
      'add_coffee_ad_astra_recipes expected 12 rows, got %',
      v_count;
  END IF;
END $$;
