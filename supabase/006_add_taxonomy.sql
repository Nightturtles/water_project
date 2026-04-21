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
--
-- Added as NOT VALID so the constraint guards all *new* writes immediately,
-- but doesn't scan existing rows yet — the backfill UPDATEs below normalize
-- legacy pre-v2 tags (e.g. ["eaf", "direct-dosing"] from migration 002) onto
-- the canonical 6-set. The matching `VALIDATE CONSTRAINT` statement at the
-- bottom of this migration performs the existing-row scan only after the
-- backfill has run, so the migration can't fail on legacy data.
ALTER TABLE target_profiles
  DROP CONSTRAINT IF EXISTS target_profiles_tags_check;
ALTER TABLE target_profiles
  ADD CONSTRAINT target_profiles_tags_check
  CHECK (
    jsonb_typeof(tags) = 'array'
    AND tags <@ '["Full Body", "Balanced", "Bright", "Sweet", "Juicy", "Clarity"]'::jsonb
  ) NOT VALID;

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
-- Every UPDATE in this backfill block is gated on `user_id IS NULL` so a
-- user-owned row that happens to share a canonical slug can't be silently
-- rewritten (in practice the client's generateUniqueSlug prevents that
-- collision, but migrations must be data-safe regardless).

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light", "medium"]',
  tags  = '["Bright", "Clarity"]',
  creator_display_name = 'Espresso Aficionados'
WHERE slug = 'eaf-holy-water' AND user_id IS NULL;

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light", "medium"]',
  tags  = '["Balanced", "Bright"]',
  creator_display_name = 'Espresso Aficionados'
WHERE slug = 'eaf-melbourne-water' AND user_id IS NULL;

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light", "medium"]',
  tags  = '["Bright", "Clarity"]',
  creator_display_name = 'Christopher Hendon'
WHERE slug = 'eaf-hendon-water' AND user_id IS NULL;

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light", "medium"]',
  tags  = '["Balanced", "Sweet"]',
  creator_display_name = 'Barista Hustle'
WHERE slug = 'eaf-bh-water-4' AND user_id IS NULL;

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["medium", "dark"]',
  tags  = '["Full Body", "Sweet"]',
  creator_display_name = 'Third Wave Water'
WHERE slug = 'eaf-tww-espresso-inspired' AND user_id IS NULL;

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["all"]',
  tags  = '["Clarity"]',
  creator_display_name = 'Robert Pavlis'
WHERE slug = 'eaf-rpavlis' AND user_id IS NULL;

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light"]',
  tags  = '["Sweet", "Balanced"]',
  creator_display_name = 'Espresso Aficionados (Fam)'
WHERE slug = 'eaf-fam-29th-wave' AND user_id IS NULL;

-- Fam's 69th Wave: also flip filter -> espresso (the 60/90 hardness/buffer
-- framework matches the 29th Wave's espresso target; the 002 migration's
-- 'filter' assignment was the same oversight 004 corrected for the 29th).
UPDATE target_profiles SET
  brew_method = 'espresso',
  tray  = 'classic',
  roast = '["light", "medium"]',
  tags  = '["Full Body", "Balanced"]',
  creator_display_name = 'Espresso Aficionados (Fam)'
WHERE slug = 'eaf-fam-69th-wave' AND user_id IS NULL;

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["medium"]',
  tags  = '["Balanced"]',
  creator_display_name = 'Christopher Hendon'
WHERE slug = 'hendon-espresso' AND user_id IS NULL;


-- Roaster recipes ------------------------------------------------------------

UPDATE target_profiles SET
  tray  = 'roaster',
  roast = '["light"]',
  tags  = '["Balanced", "Clarity"]',
  creator_display_name = 'Aviary'
WHERE slug = 'aviary-filter' AND user_id IS NULL;

UPDATE target_profiles SET
  tray  = 'roaster',
  roast = '["light"]',
  tags  = '["Sweet", "Full Body"]',
  creator_display_name = 'Aviary'
WHERE slug = 'aviary-espresso' AND user_id IS NULL;

UPDATE target_profiles SET
  tray  = 'roaster',
  roast = '["light"]',
  tags  = '["Bright", "Clarity", "Juicy"]',
  creator_display_name = 'Sey Coffee'
WHERE slug = 'sey' AND user_id IS NULL;


-- Robert Asami Week 1 educational series (classic per user decision) ---------

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light"]',
  tags  = '["Bright", "Clarity"]',
  creator_display_name = 'Robert Asami'
WHERE slug = 'rasami-w1d1' AND user_id IS NULL;

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light"]',
  tags  = '["Sweet", "Clarity"]',
  creator_display_name = 'Robert Asami'
WHERE slug = 'rasami-w1d2' AND user_id IS NULL;

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light", "medium"]',
  tags  = '["Balanced"]',
  creator_display_name = 'Robert Asami'
WHERE slug = 'rasami-w1d3' AND user_id IS NULL;

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light", "medium"]',
  tags  = '["Sweet", "Full Body"]',
  creator_display_name = 'Robert Asami'
WHERE slug = 'rasami-w1d4' AND user_id IS NULL;

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light"]',
  tags  = '["Balanced", "Bright"]',
  creator_display_name = 'Robert Asami'
WHERE slug = 'rasami-w1d5' AND user_id IS NULL;

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light", "medium"]',
  tags  = '["Balanced", "Full Body"]',
  creator_display_name = 'Robert Asami'
WHERE slug = 'rasami-w1d6' AND user_id IS NULL;

UPDATE target_profiles SET
  tray  = 'classic',
  roast = '["light"]',
  tags  = '["Clarity", "Juicy"]',
  creator_display_name = 'Robert Asami'
WHERE slug = 'rasami-w1d7' AND user_id IS NULL;


-- ---------------------------------------------------------------------------
-- Now that every canonical row has been normalized onto the 6-tag canonical
-- set, validate the CHECK against existing rows. Paired with the NOT VALID
-- flag on the ADD CONSTRAINT above. If any row still violates the constraint
-- at this point, the migration fails here — which is the behavior we want
-- (a row with non-canonical tags after the backfill is an unknown-state bug
-- worth stopping on).
-- ---------------------------------------------------------------------------
ALTER TABLE target_profiles VALIDATE CONSTRAINT target_profiles_tags_check;


-- ---------------------------------------------------------------------------
-- New in-house Cafelytic recipes
-- ---------------------------------------------------------------------------

-- Idempotent upsert: ON CONFLICT targets the partial unique index
-- idx_target_profiles_system_slug (defined in 002_library_schema.sql) whose
-- predicate is `WHERE user_id IS NULL` — so re-running this migration
-- overwrites the existing canonical row's columns instead of failing. Apps
-- that want to preserve local edits on these rows should copy-to-custom first
-- (this is the pattern copyRecipeToMyProfiles implements in library-data.js).

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
   '["light"]')
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
   '["light", "medium"]')
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


-- ---------------------------------------------------------------------------
-- Indexes for tray-based and roast-based filtering on the landing page.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_target_profiles_tray
  ON target_profiles (tray) WHERE is_public = true;

-- GIN index on roast jsonb for "any of these roasts" queries.
CREATE INDEX IF NOT EXISTS idx_target_profiles_roast_gin
  ON target_profiles USING gin (roast) WHERE is_public = true;
