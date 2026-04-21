-- =============================================================================
-- Cafelytic — Supabase schema migration 007: Seed built-in TARGET_PRESETS
--
-- Moves the seven built-in target presets out of constants.js and into the
-- target_profiles library table, so that:
--
--   1. Built-ins can be re-added from the Library after a user removes them
--      (constants.js-only rows can't be, because the Library reads target_profiles).
--   2. Built-ins participate in the new taxonomy (tray, roast, tags) alongside
--      community recipes.
--
-- Slugs match the existing TARGET_PRESETS keys in constants.js exactly. The
-- follow-up constants.js cleanup (Piece B) will collapse the full preset
-- definitions to a tiny fallback shim for use before Supabase data loads.
--
-- Ion values are copied verbatim from constants.js TARGET_PRESETS. Taxonomy
-- (tray/roast/tags/method) matches supabase/recipe-catalog-decisions.csv.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Seed rows — user_id = NULL indicates an official Cafelytic library recipe.
-- These are canonical reference formulas, so all land in tray='classic'.
-- ---------------------------------------------------------------------------

INSERT INTO target_profiles
  (user_id, slug, label, brew_method,
   calcium, magnesium, alkalinity, potassium, sodium, sulfate, chloride, bicarbonate,
   description, is_public, creator_display_name, tags, tray, roast)
VALUES

  -- SCA Standard — canonical industry reference (Ca 51 / Mg 17 / Alk 40).
  -- Target spec only: no K/Na/SO4/Cl/HCO3 prescribed, so all zero to match
  -- constants.js. Designed to work across roast levels (roast='["all"]').
  (NULL, 'sca', 'SCA Standard', 'filter',
   51, 17, 40, 0, 0, 0, 0, 0,
   'SCA recommended range for brewing water. Balanced body and clarity.',
   true, 'Specialty Coffee Association',
   '["Balanced"]',
   'classic',
   '["all"]'),

  -- Rao's Recipe — Scott Rao's filter target (Ca 20.9 / Mg 8.5 / Alk 40).
  -- Lotus-style sweetness/structure over brightness amplification.
  (NULL, 'rao', 'Rao''s Recipe', 'filter',
   20.9, 8.5, 40, 0, 0, 0, 0, 0,
   'Lotus-style Rao recipe target with balanced sweetness and structure.',
   true, 'Scott Rao',
   '["Balanced", "Sweet"]',
   'classic',
   '["light", "medium"]'),

  -- Lotus Light and Bright (filter) — Ca/Cl-heavy, Mg-free, low buffer.
  -- Sodium-free, clarity-forward. Classed classic to match TWW precedent.
  (NULL, 'lotus-light-bright', 'Light and Bright', 'filter',
   22.832, 0, 24.245, 18.941, 0, 0, 40.395, 29.56,
   'Lotus recipe emphasizing high clarity and acidity for lighter coffees.',
   true, 'Lotus Coffee Water',
   '["Bright", "Clarity"]',
   'classic',
   '["light"]'),

  -- Lotus Simple and Sweet (filter) — adds Mg + Na for rounded sweetness.
  -- Higher buffer makes this more roast-flexible than Light and Bright.
  (NULL, 'lotus-simple-sweet', 'Simple and Sweet', 'filter',
   22.832, 7.882, 40.476, 12.628, 11.169, 0, 63.389, 49.35,
   'Lotus balanced profile with added sweetness and approachable acidity.',
   true, 'Lotus Coffee Water',
   '["Sweet", "Balanced"]',
   'classic',
   '["light", "medium"]'),

  -- Lotus Light and Bright (espresso) — clarity-forward espresso: no Ca,
  -- sodium-free, K-buffered via KHCO3.
  (NULL, 'lotus-light-bright-espresso', 'Light and Bright (espresso)', 'espresso',
   0, 3.941, 44.449, 34.726, 0, 0, 11.497, 54.194,
   'Lotus espresso profile for clarity-forward shots with restrained hardness.',
   true, 'Lotus Coffee Water',
   '["Bright", "Clarity"]',
   'classic',
   '["light"]'),

  -- Lotus Simple and Sweet (espresso) — high buffer + sodium → rounder shots.
  -- Old 'Round' tag mapped to Full Body per new taxonomy.
  (NULL, 'lotus-simple-sweet-espresso', 'Simple and Sweet (espresso)', 'espresso',
   0, 3.941, 56.73, 0, 26.061, 0, 11.497, 69.167,
   'Lotus espresso profile with higher buffer for sweeter, rounder shots.',
   true, 'Lotus Coffee Water',
   '["Sweet", "Full Body"]',
   'classic',
   '["medium"]'),

  -- Lotus Bright and Juicy (filter) — low buffer for vivid acidity,
  -- fruit-forward cups, high clarity per Lotus description.
  (NULL, 'lotus-bright-juicy', 'Bright and Juicy', 'filter',
   13.047, 7.882, 16.186, 6.314, 3.723, 0, 46.077, 19.734,
   'Lotus profile tuned for vivid acidity, fruit-forward cups, and high clarity.',
   true, 'Lotus Coffee Water',
   '["Bright", "Juicy"]',
   'classic',
   '["light"]')
-- Idempotent upsert: ON CONFLICT targets the partial unique index
-- idx_target_profiles_system_slug (from 002_library_schema.sql) whose predicate
-- is `WHERE user_id IS NULL`. Re-running this migration overwrites the existing
-- canonical rows' columns instead of failing. All seven VALUES rows above share
-- this clause since ON CONFLICT applies to the whole multi-row INSERT.
ON CONFLICT (slug) WHERE user_id IS NULL DO UPDATE SET
  label = EXCLUDED.label,
  brew_method = EXCLUDED.brew_method,
  calcium = EXCLUDED.calcium, magnesium = EXCLUDED.magnesium,
  alkalinity = EXCLUDED.alkalinity, potassium = EXCLUDED.potassium,
  sodium = EXCLUDED.sodium, sulfate = EXCLUDED.sulfate,
  chloride = EXCLUDED.chloride, bicarbonate = EXCLUDED.bicarbonate,
  description = EXCLUDED.description,
  is_public = EXCLUDED.is_public,
  creator_display_name = EXCLUDED.creator_display_name,
  tags = EXCLUDED.tags,
  tray = EXCLUDED.tray,
  roast = EXCLUDED.roast;
