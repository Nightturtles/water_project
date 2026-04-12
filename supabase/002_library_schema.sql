-- =============================================================================
-- Cafelytic — Supabase schema migration 002: Recipe Library
-- Adds full ion columns, public/library fields, and seed data.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- target_profiles: add missing ion columns
-- ---------------------------------------------------------------------------

ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS potassium   numeric DEFAULT 0;
ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS sodium      numeric DEFAULT 0;
ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS sulfate     numeric DEFAULT 0;
ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS chloride    numeric DEFAULT 0;
ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS bicarbonate numeric DEFAULT 0;


-- ---------------------------------------------------------------------------
-- target_profiles: add library / public-sharing columns
-- ---------------------------------------------------------------------------

ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS is_public            boolean DEFAULT false;
ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS creator_display_name text    DEFAULT '';
ALTER TABLE target_profiles ADD COLUMN IF NOT EXISTS tags                 jsonb   DEFAULT '[]';


-- Index for fast public recipe queries
CREATE INDEX IF NOT EXISTS idx_target_profiles_public
  ON target_profiles (is_public) WHERE is_public = true;


-- ---------------------------------------------------------------------------
-- RLS: allow any authenticated user to read public recipes
-- ---------------------------------------------------------------------------

CREATE POLICY "target_profiles: select public rows"
  ON target_profiles FOR SELECT
  USING (is_public = true);


-- ---------------------------------------------------------------------------
-- user_settings: add creator_display_name for publishing
-- ---------------------------------------------------------------------------

ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS creator_display_name text DEFAULT '';


-- ---------------------------------------------------------------------------
-- Seed: community recipes moved from built-in presets into the library.
-- Uses a dedicated system user so these recipes are owned and manageable.
-- Run after creating the system user in Supabase Auth (or replace the UUID).
-- ---------------------------------------------------------------------------

-- Create a system user placeholder.  Replace this UUID with the actual
-- system account's auth.users id after creating it in the Supabase dashboard.
-- Example: INSERT INTO auth.users (id, email, ...) or use the Admin API.
--
-- The INSERT statements below reference a variable; replace
-- '00000000-0000-0000-0000-000000000000' with the real system user UUID.

DO $$
DECLARE
  sys_uid uuid := '00000000-0000-0000-0000-000000000000';  -- REPLACE with real system user id
BEGIN

INSERT INTO target_profiles (user_id, slug, label, brew_method, calcium, magnesium, alkalinity, potassium, sodium, sulfate, chloride, bicarbonate, description, is_public, creator_display_name, tags)
VALUES
  (sys_uid, 'eaf-holy-water', 'Holy Water', 'filter',
   0, 15, 23, 18, 0, 59, 0, 28,
   'Espresso Aficionados direct dosing: 1.520g Epsom + 0.460g KHCO3 per 10L.',
   true, 'Cafelytic', '["eaf", "direct-dosing"]'),

  (sys_uid, 'eaf-melbourne-water', 'Melbourne Water', 'filter',
   0, 12, 20.2, 0, 9, 48, 0, 24.7,
   'Espresso Aficionados direct dosing: 1.220g Epsom + 0.340g Baking Soda per 10L.',
   true, 'Cafelytic', '["eaf", "direct-dosing"]'),

  (sys_uid, 'eaf-hendon-water', 'Hendon Water (Direct Dosing)', 'filter',
   0, 24, 31, 0, 14, 95, 0, 37.8,
   'Espresso Aficionados direct dosing: 2.430g Epsom + 0.520g Baking Soda per 10L.',
   true, 'Cafelytic', '["eaf", "direct-dosing"]'),

  (sys_uid, 'eaf-bh-water-4', 'Barista Hustle Water #4', 'filter',
   0, 19.4, 40, 0, 18, 77, 0, 48.7,
   'Espresso Aficionados direct dosing: 1.970g Epsom + 0.671g Baking Soda per 10L.',
   true, 'Cafelytic', '["eaf", "direct-dosing"]'),

  (sys_uid, 'eaf-tww-espresso-inspired', 'TWW Espresso Inspired', 'espresso',
   0, 38.9, 67.5, 53, 0, 154, 0, 82.3,
   'Espresso Aficionados direct dosing: 3.940g Epsom + 1.350g KHCO3 per 10L.',
   true, 'Cafelytic', '["eaf", "direct-dosing", "espresso"]'),

  (sys_uid, 'eaf-rpavlis', 'RPavlis', 'filter',
   0, 0, 50, 39, 0, 0, 0, 60.9,
   'Espresso Aficionados direct dosing: 1.000g KHCO3 per 10L.',
   true, 'Cafelytic', '["eaf", "direct-dosing"]'),

  (sys_uid, 'eaf-fam-29th-wave', 'Fam''s 29th Wave', 'filter',
   0, 4.9, 90, 0, 41, 19, 0, 109.7,
   'Espresso Aficionados direct dosing: 0.493g Epsom + 1.511g Baking Soda per 10L.',
   true, 'Cafelytic', '["eaf", "direct-dosing"]'),

  (sys_uid, 'eaf-fam-69th-wave', 'Fam''s 69th Wave', 'filter',
   0, 14.6, 90, 0, 41, 58, 0, 109.7,
   'Espresso Aficionados direct dosing: 1.478g Epsom + 1.511g Baking Soda per 10L.',
   true, 'Cafelytic', '["eaf", "direct-dosing"]'),

  (sys_uid, 'hendon-espresso', 'Hendon Water', 'espresso',
   0, 24, 31, 0, 0, 0, 0, 0,
   'Matches Espresso Aficionados Hendon Water target (GH 99 / KH 31 as CaCO3).',
   true, 'Cafelytic', '["espresso"]')

ON CONFLICT (user_id, slug) DO NOTHING;

END $$;
