-- =============================================================================
-- Cafelytic — Supabase schema migration 006: New recipe taxonomy
--
-- Adds the new categorization model:
--   * tray   — exactly one of: featured | original | roaster | classic
--   * roast  — jsonb array, subset of: all | light | medium | dark
--   * tags   — re-tightened to the canonical 6 flavor tags
--              (Full Body | Balanced | Bright | Sweet | Juicy | Clarity)
--
-- Also:
--   * Re-attributes all library recipes to their actual sources
--     (the previous catch-all creator_display_name='Cafelytic' was misleading
--     once the 'original' tray got real meaning).
--   * Flips Fam's 69th Wave from filter to espresso (matches the 60/90
--     hardness/buffer framework — same oversight migration 004 fixed for
--     the 29th Wave).
--   * Inserts two new in-house recipes: Cafelytic Filter (featured) and
--     Cafelytic Espresso (original).
--
-- See recipe-catalog-decisions.csv at the repo root for per-row reasoning.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Schema: new columns + canonical-set CHECK constraints
-- ---------------------------------------------------------------------------

ALTER TABLE target_profiles
  ADD COLUMN IF NOT EXISTS tray  text  NOT NULL DEFAULT 'classic',
  ADD COLUMN IF NOT EXISTS roast jsonb NOT NULL DEFAULT '["all"]';

-- Tray must be one of the four trays.
ALTER TABLE target_profiles
  DROP CONSTRAINT IF EXISTS target_profiles_tray_check;
ALTER TABLE target_profiles
  ADD CONSTRAINT target_profiles_tray_check
  CHECK (tray IN ('featured', 'original', 'roaster', 'classic'));

-- Roast must be a non-empty array whose elements are all in the canonical set.
-- The <@ "is contained by" operator does subset validation in one shot.
ALTER TABLE target_profiles
  DROP CONSTRAINT IF EXISTS target_profiles_roast_check;
ALTER TABLE target_profiles
  ADD CONSTRAINT target_profiles_roast_check
  CHECK (
    jsonb_typeof(roast) = 'array'
    AND jsonb_array_length(roast) > 0
    AND roast <@ '["all", "light", "medium", "dark"]'::jsonb
  );

-- Tags (flavor tags) — same shape, canonical 6-set.
-- Empty array is allowed (legacy rows + recipes without curated tags).
ALTER TABLE target_profiles
  DROP CONSTRAINT IF EXISTS target_profiles_tags_check;
ALTER TABLE target_profiles
  ADD CONSTRAINT target_profiles_tags_check
  CHECK (
    jsonb_typeof(tags) = 'array'
    AND tags <@ '["Full Body", "Balanced", "Bright", "Sweet", "Juicy", "Clarity"]'::jsonb
  );

-- Featured uniqueness: at most one row may have tray='featured' at a time.
-- Application logic is responsible for re-assigning a recipe's "natural" tray
-- (typically the one it would otherwise live in — e.g. 'original' for
-- in-house Cafelytic recipes) when it leaves the featured slot.
DROP INDEX IF EXISTS idx_target_profiles_featured_unique;
CREATE UNIQUE INDEX idx_target_profiles_featured_unique
  ON target_profiles ((tray)) WHERE tray = 'featured';


-- ---------------------------------------------------------------------------
-- Backfill: per-recipe taxonomy + attribution updates
-- All existing library recipes (user_id IS NULL) get new tray/roast/tags
-- and a corrected creator_display_name pointing at the actual source.
-- ---------------------------------------------------------------------------

-- Espresso Aficionados / community classics ----------------------------------

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light", "medium"]',
  tags  = '["Bright", "Clarity"]',
  creator_display_name = 'Espresso Aficionados'
WHERE slug = 'eaf-holy-water';

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light", "medium"]',
  tags  = '["Balanced", "Bright"]',
  creator_display_name = 'Espresso Aficionados'
WHERE slug = 'eaf-melbourne-water';

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light", "medium"]',
  tags  = '["Bright", "Clarity"]',
  creator_display_name = 'Christopher Hendon'
WHERE slug = 'eaf-hendon-water';

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light", "medium"]',
  tags  = '["Balanced", "Sweet"]',
  creator_display_name = 'Barista Hustle'
WHERE slug = 'eaf-bh-water-4';

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["medium", "dark"]',
  tags  = '["Full Body", "Sweet"]',
  creator_display_name = 'Third Wave Water'
WHERE slug = 'eaf-tww-espresso-inspired';

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["all"]',
  tags  = '["Clarity"]',
  creator_display_name = 'Robert Pavlis'
WHERE slug = 'eaf-rpavlis';

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light"]',
  tags  = '["Sweet", "Balanced"]',
  creator_display_name = 'Espresso Aficionados (Fam)'
WHERE slug = 'eaf-fam-29th-wave';

-- Fam's 69th Wave: also flip filter -> espresso (the 60/90 hardness/buffer
-- framework matches the 29th Wave's espresso target; the 002 migration's
-- 'filter' assignment was the same oversight 004 corrected for the 29th).
UPDATE target_profiles SET
  brew_method = 'espresso',
  tray  = 'classic',
  roast = '["light", "medium"]',
  tags  = '["Full Body", "Balanced"]',
  creator_display_name = 'Espresso Aficionados (Fam)'
WHERE slug = 'eaf-fam-69th-wave';

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["medium"]',
  tags  = '["Balanced"]',
  creator_display_name = 'Christopher Hendon'
WHERE slug = 'hendon-espresso';


-- Roaster recipes ------------------------------------------------------------

UPDATE target_profiles SET
  tray  = 'roaster',
  roast = '["light"]',
  tags  = '["Balanced", "Clarity"]',
  creator_display_name = 'Aviary'
WHERE slug = 'aviary-filter';

UPDATE target_profiles SET
  tray  = 'roaster',
  roast = '["light"]',
  tags  = '["Sweet", "Full Body"]',
  creator_display_name = 'Aviary'
WHERE slug = 'aviary-espresso';

UPDATE target_profiles SET
  tray  = 'roaster',
  roast = '["light"]',
  tags  = '["Bright", "Clarity", "Juicy"]',
  creator_display_name = 'Sey Coffee'
WHERE slug = 'sey';


-- Robert Asami Week 1 educational series (classic per user decision) ---------

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light"]',
  tags  = '["Bright", "Clarity"]',
  creator_display_name = 'Robert Asami'
WHERE slug = 'rasami-w1d1';

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light"]',
  tags  = '["Sweet", "Clarity"]',
  creator_display_name = 'Robert Asami'
WHERE slug = 'rasami-w1d2';

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light", "medium"]',
  tags  = '["Balanced"]',
  creator_display_name = 'Robert Asami'
WHERE slug = 'rasami-w1d3';

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light", "medium"]',
  tags  = '["Sweet", "Full Body"]',
  creator_display_name = 'Robert Asami'
WHERE slug = 'rasami-w1d4';

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light"]',
  tags  = '["Balanced", "Bright"]',
  creator_display_name = 'Robert Asami'
WHERE slug = 'rasami-w1d5';

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light", "medium"]',
  tags  = '["Balanced", "Full Body"]',
  creator_display_name = 'Robert Asami'
WHERE slug = 'rasami-w1d6';

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light"]',
  tags  = '["Clarity", "Juicy"]',
  creator_display_name = 'Robert Asami'
WHERE slug = 'rasami-w1d7';


-- ---------------------------------------------------------------------------
-- New in-house Cafelytic recipes
-- ---------------------------------------------------------------------------

-- Cafelytic Filter — featured editorial spotlight at launch.
-- Distinctive: only low-TDS filter in the catalog with zero sulfate.
-- Mg-dominant + Cl-heavy + KHCO3 buffer = juicy/clean/sweet character
-- instead of the SO4-amplified brightness typical of light-roast filters.
-- Direct dosing per liter of distilled water:
--   0.007g CaCl2.2H2O + 0.092g MgCl2.6H2O + 0.023g KHCO3
-- (Lotus-compatible: matches Lotus Calcium and Lotus Magnesium drop chemistry.)
INSERT INTO target_profiles
  (user_id, slug, label, brew_method,
   calcium, magnesium, alkalinity, potassium, sodium, sulfate, chloride, bicarbonate,
   description, is_public, creator_display_name, tags, tray, roast)
VALUES
  (NULL, 'cafelytic-filter', 'Cafelytic Filter', 'filter',
   2, 11, 11, 9, 0, 0, 36, 13.41,
   'Cafelytic in-house light-roast filter recipe. Direct dosing per liter: 0.007g CaCl₂·2H₂O + 0.092g MgCl₂·6H₂O + 0.023g KHCO₃. Mg-dominant, Cl-heavy, sodium-free, sulfate-free.',
   true, 'Cafelytic',
   '["Juicy", "Clarity", "Sweet"]',
   'featured',
   '["light"]');

-- Cafelytic Espresso — companion to Cafelytic Filter, same house chemistry
-- scaled for espresso (higher Mg, low Ca, KHCO3 buffer at 32 ppm CaCO3).
-- Direct dosing per liter:
--   0.015g CaCl2.2H2O + 0.134g MgCl2.6H2O + 0.064g KHCO3
INSERT INTO target_profiles
  (user_id, slug, label, brew_method,
   calcium, magnesium, alkalinity, potassium, sodium, sulfate, chloride, bicarbonate,
   description, is_public, creator_display_name, tags, tray, roast)
VALUES
  (NULL, 'cafelytic-espresso', 'Cafelytic Espresso', 'espresso',
   4, 16, 32, 25, 0, 0, 54, 39.02,
   'Cafelytic in-house espresso companion to Cafelytic Filter. Direct dosing per liter: 0.015g CaCl₂·2H₂O + 0.134g MgCl₂·6H₂O + 0.064g KHCO₃. Preserves the Cafelytic house character (Cl-heavy, no SO₄, sodium-free, K-buffered) at espresso concentrations.',
   true, 'Cafelytic',
   '["Sweet", "Juicy", "Full Body"]',
   'original',
   '["light", "medium"]');


-- ---------------------------------------------------------------------------
-- Indexes for tray-based and roast-based filtering on the landing page.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_target_profiles_tray
  ON target_profiles (tray) WHERE is_public = true;

-- GIN index on roast jsonb for "any of these roasts" queries.
CREATE INDEX IF NOT EXISTS idx_target_profiles_roast_gin
  ON target_profiles USING gin (roast) WHERE is_public = true;
