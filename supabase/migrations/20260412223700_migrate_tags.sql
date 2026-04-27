-- =============================================================================
-- Cafelytic — Migrate to predefined tags
-- Clears old free-text tags that don't match the new predefined set.
-- =============================================================================

UPDATE target_profiles SET tags = '[]'
  WHERE tags IS NOT NULL AND tags::text != '[]';
