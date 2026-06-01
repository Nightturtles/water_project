// ============================================
// Storage keys — single source of truth
// ============================================
// Every localStorage/sessionStorage key the app persists, plus the auth-gating
// categories that drive cloud sync and logout. Both storage.ts and sync.ts
// import from here so a key string is written in exactly one place.
//
// Before this module, sync.ts maintained USER_CONTENT_KEYS_EXACT and
// TRANSIENT_KEYS as two hand-edited lists (whose Category-A entries had to stay
// byte-identical), and storage.ts repeated the same literals inline. Adding a
// field meant updating several lists by hand; forgetting one silently broke
// sync, the anonymous->signed-in migration, or the logout wipe. Now you add the
// key to KEYS once and to the right CATEGORY_* array, and the derived lists
// below update automatically.
//
// Categories (see sync.ts for the full behavioral rationale):
//   A — transient state; routed to sessionStorage while anonymous, migrated to
//       localStorage on sign-in, cloud-synced when logged in.
//   B — named artifacts; refused (read null / write no-op) while anonymous.
//   C — sync tracking; only meaningful while logged in.
//   D — NEVER cleared and NOT cloud-content: cw_theme, the banner-dismissal
//       flags, cafelytic_no_analytics, cw_estimate_cache_v1:*, and the
//       sb-*-auth-token. Listed here only for reference; intentionally absent
//       from every array below so clearLocalUserContent leaves them intact.

export const KEYS = {
  // --- Category A: transient ---
  SOURCE_WATER: "cw_source_water",
  SOURCE_PRESET: "cw_source_preset",
  TARGET_PRESET: "cw_target_preset",
  BREW_METHOD: "cw_brew_method",
  SELECTED_MINERALS: "cw_selected_minerals",
  SELECTED_CONCENTRATES: "cw_selected_concentrates",
  LOTUS_DROPPER_TYPE: "cw_lotus_dropper_type",
  LOTUS_CONCENTRATE_UNITS: "cw_lotus_concentrate_units",
  LOTUS_CONCENTRATE_UNIT: "cw_lotus_concentrate_unit",
  MINERAL_DISPLAY_MODE: "cw_mineral_display_mode",
  MINERAL_SELECTOR_TAB: "cw_mineral_selector_tab",
  RECIPE_MINERAL_INPUTS: "cw_recipe_mineral_inputs",
  RECIPE_CONCENTRATE_INPUTS: "cw_recipe_concentrate_inputs",
  RECIPE_STOCK_GRAMS: "cw_recipe_stock_grams",
  RECIPE_DISPENSE_MODE: "cw_recipe_dispense_mode",
  RECIPE_SUPPLEMENT_PANEL_OPEN: "cw_recipe_supplement_panel_open",
  TARGET_DRAFT_IONS: "cw_target_draft_ions",
  // --- Category B: named artifacts ---
  CUSTOM_PROFILES: "cw_custom_profiles",
  CUSTOM_TARGET_PROFILES: "cw_custom_target_profiles",
  STOCK_CONCENTRATE_SPECS: "cw_stock_concentrate_specs",
  DIY_CONCENTRATE_SPECS: "cw_diy_concentrate_specs",
  DELETED_PRESETS: "cw_deleted_presets",
  DELETED_TARGET_PRESETS: "cw_deleted_target_presets",
  ADDED_TARGET_PRESETS: "cw_added_target_presets",
  CREATOR_DISPLAY_NAME: "cw_creator_display_name",
  // --- Category C: sync tracking ---
  LAST_PUSHED_SETTINGS: "cw_last_pushed_settings",
  LAST_PUSHED_SELECTIONS: "cw_last_pushed_selections",
  LAST_PUSHED_SOURCE_PROFILES: "cw_last_pushed_source_profiles",
  LAST_PUSHED_TARGET_PROFILES: "cw_last_pushed_target_profiles",
  SYNCED_USER_ID: "cw_synced_user_id",
  STARTER_MIGRATION_APPLIED: "cw_starter_migration_applied",
} as const;

// Prefix for the per-page volume preferences (cw_volume_<pageKey>). Category A.
export const VOLUME_PREFIX = "cw_volume_";

// Category A — transient. Routed to sessionStorage when anonymous; migrated to
// localStorage on sign-in (migrateAnonTransientToLocal); cloud-synced otherwise.
export const CATEGORY_A: string[] = [
  KEYS.SOURCE_WATER,
  KEYS.SOURCE_PRESET,
  KEYS.TARGET_PRESET,
  KEYS.BREW_METHOD,
  KEYS.SELECTED_MINERALS,
  KEYS.SELECTED_CONCENTRATES,
  KEYS.LOTUS_DROPPER_TYPE,
  KEYS.LOTUS_CONCENTRATE_UNITS,
  KEYS.LOTUS_CONCENTRATE_UNIT,
  KEYS.MINERAL_DISPLAY_MODE,
  KEYS.MINERAL_SELECTOR_TAB,
  KEYS.RECIPE_MINERAL_INPUTS,
  KEYS.RECIPE_CONCENTRATE_INPUTS,
  KEYS.RECIPE_STOCK_GRAMS,
  KEYS.RECIPE_DISPENSE_MODE,
  KEYS.RECIPE_SUPPLEMENT_PANEL_OPEN,
  KEYS.TARGET_DRAFT_IONS,
];

// Category B — named artifacts (custom profiles, concentrate specs, tombstones,
// curated rail, creator name).
export const CATEGORY_B: string[] = [
  KEYS.CUSTOM_PROFILES,
  KEYS.CUSTOM_TARGET_PROFILES,
  KEYS.STOCK_CONCENTRATE_SPECS,
  KEYS.DIY_CONCENTRATE_SPECS,
  KEYS.DELETED_PRESETS,
  KEYS.DELETED_TARGET_PRESETS,
  KEYS.ADDED_TARGET_PRESETS,
  KEYS.CREATOR_DISPLAY_NAME,
];

// Category C — sync tracking (last-pushed snapshots, synced user id, the
// starter-rail migration flag).
export const CATEGORY_C: string[] = [
  KEYS.LAST_PUSHED_SETTINGS,
  KEYS.LAST_PUSHED_SELECTIONS,
  KEYS.LAST_PUSHED_SOURCE_PROFILES,
  KEYS.LAST_PUSHED_TARGET_PROFILES,
  KEYS.SYNCED_USER_ID,
  KEYS.STARTER_MIGRATION_APPLIED,
];

// Wiped from both localStorage and sessionStorage on logout
// (clearLocalUserContent). Category A + B + C.
export const USER_CONTENT_KEYS_EXACT: string[] = [...CATEGORY_A, ...CATEGORY_B, ...CATEGORY_C];

// Prefix-matched keys also wiped on logout.
export const USER_CONTENT_KEYS_PREFIX: string[] = [VOLUME_PREFIX];

// Category A only — the keys that route to sessionStorage while anonymous and
// migrate to localStorage on sign-in. A fresh copy so callers can't mutate
// CATEGORY_A through it.
export const TRANSIENT_KEYS: string[] = [...CATEGORY_A];
export const TRANSIENT_KEYS_PREFIX: string[] = [VOLUME_PREFIX];
