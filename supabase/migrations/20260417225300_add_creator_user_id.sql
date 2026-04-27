-- =============================================================================
-- Cafelytic — creator_user_id
-- Tracks the ORIGINAL creator of a recipe, distinct from user_id (the owner
-- of this particular row).  When a user copies a library recipe into their
-- own profiles, the copy's user_id is the copier, but creator_user_id stays
-- pointed at the original author — so the app can distinguish "my recipe"
-- from "someone else's recipe I use" and only offer the share-updates
-- prompt to genuine creators.
-- =============================================================================


ALTER TABLE target_profiles
  ADD COLUMN IF NOT EXISTS creator_user_id uuid references auth.users(id);


-- Backfill: for existing user-owned rows, the owner IS the creator.
-- System recipes (user_id IS NULL, Cafelytic-seeded) stay NULL.
UPDATE target_profiles
SET creator_user_id = user_id
WHERE creator_user_id IS NULL AND user_id IS NOT NULL;
