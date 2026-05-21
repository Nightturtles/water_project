-- =============================================================================
-- Cafelytic — add drafts column to user_settings
--
-- Adds one jsonb column to hold all in-progress draft state across devices.
-- Previously the recipe builder's per-keystroke saves (mineral grams,
-- concentrate mL, stock grams, dispense mode) and target-ion edits on built-in
-- presets lived in localStorage only — a user starting work on their phone
-- and continuing on a laptop lost it. The Target Water section also silently
-- flipped the active preset to "custom" on any ion edit; persisting those
-- edits as a per-slug draft instead lets the active selection stay put.
--
-- Stored as a single jsonb blob (rather than per-key columns) since drafts
-- are an open-ended set tied to UI state, not schema-stable settings.
--
-- Shape:
--   {
--     "recipe_mineral_inputs":     { "<mineralId>": "<grams string>", ... },
--     "recipe_concentrate_inputs": { "<concentrateId>": "<mL string | { ml, drops }>", ... },
--     "recipe_stock_grams":        { "<stockId>": "<grams string>", ... },
--     "recipe_dispense_mode":      "manual" | "stock",
--     "target_draft_ions":         { "<slug>": { calcium, magnesium, alkalinity, ... }, ... }
--   }
--
-- Default '{}'::jsonb so existing rows get an empty map on first read; no
-- migration of existing data needed.
-- =============================================================================

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS drafts jsonb NOT NULL DEFAULT '{}'::jsonb;
