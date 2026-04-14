-- =============================================================================
-- Cafelytic — Supabase schema migration 004
-- Drops unused deleted_target_presets column from user_selections.
-- The feature was removed but the column was left behind.
-- =============================================================================

ALTER TABLE user_selections DROP COLUMN IF EXISTS deleted_target_presets;
