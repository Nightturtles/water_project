// Pins the storage-key registry. These keys are the contract between
// localStorage, the cloud-sync payloads, the anonymous->signed-in migration,
// and the logout wipe. Renaming one silently breaks sync or strands user data
// (the data-loss shape behind commits 6d8cd63 / 6464fdb / 9f89a2e), so the
// exact strings are pinned here. This also locks in the invariant that the
// logout wipe is exactly Category A + B + C and the transient set is exactly
// Category A — the drift this registry exists to prevent.
import { describe, test, expect } from "vitest";
import {
  KEYS,
  VOLUME_PREFIX,
  CATEGORY_A,
  CATEGORY_B,
  CATEGORY_C,
  USER_CONTENT_KEYS_EXACT,
  USER_CONTENT_KEYS_PREFIX,
  TRANSIENT_KEYS,
  TRANSIENT_KEYS_PREFIX,
} from "./src/lib/storage-keys";

// Ground-truth key strings (independent of the registry's own arrays).
const CATEGORY_A_EXPECTED = [
  "cw_source_water",
  "cw_source_preset",
  "cw_target_preset",
  "cw_brew_method",
  "cw_selected_minerals",
  "cw_selected_concentrates",
  "cw_lotus_dropper_type",
  "cw_lotus_concentrate_units",
  "cw_lotus_concentrate_unit",
  "cw_mineral_display_mode",
  "cw_mineral_selector_tab",
  "cw_recipe_mineral_inputs",
  "cw_recipe_concentrate_inputs",
  "cw_recipe_stock_grams",
  "cw_recipe_dispense_mode",
  "cw_target_draft_ions",
];
const CATEGORY_B_EXPECTED = [
  "cw_custom_profiles",
  "cw_custom_target_profiles",
  "cw_stock_concentrate_specs",
  "cw_diy_concentrate_specs",
  "cw_deleted_presets",
  "cw_deleted_target_presets",
  "cw_added_target_presets",
  "cw_creator_display_name",
];
const CATEGORY_C_EXPECTED = [
  "cw_last_pushed_settings",
  "cw_last_pushed_selections",
  "cw_last_pushed_source_profiles",
  "cw_last_pushed_target_profiles",
  "cw_synced_user_id",
  "cw_starter_migration_applied",
];

describe("storage-keys registry", () => {
  test("category arrays pin their exact key strings", () => {
    expect(CATEGORY_A).toEqual(CATEGORY_A_EXPECTED);
    expect(CATEGORY_B).toEqual(CATEGORY_B_EXPECTED);
    expect(CATEGORY_C).toEqual(CATEGORY_C_EXPECTED);
  });

  test("volume prefix is unchanged", () => {
    expect(VOLUME_PREFIX).toBe("cw_volume_");
    expect(USER_CONTENT_KEYS_PREFIX).toEqual([VOLUME_PREFIX]);
    expect(TRANSIENT_KEYS_PREFIX).toEqual([VOLUME_PREFIX]);
  });

  test("logout wipe is exactly Category A + B + C, in order", () => {
    expect(USER_CONTENT_KEYS_EXACT).toEqual([
      ...CATEGORY_A_EXPECTED,
      ...CATEGORY_B_EXPECTED,
      ...CATEGORY_C_EXPECTED,
    ]);
  });

  test("transient set is exactly Category A", () => {
    expect(TRANSIENT_KEYS).toEqual(CATEGORY_A_EXPECTED);
    // Defensive: a separate array instance, so callers can't mutate CATEGORY_A.
    expect(TRANSIENT_KEYS).not.toBe(CATEGORY_A);
  });

  test("transient keys are a subset of the logout wipe", () => {
    for (const k of TRANSIENT_KEYS) {
      expect(USER_CONTENT_KEYS_EXACT).toContain(k);
    }
  });

  test("no duplicate keys anywhere", () => {
    expect(new Set(USER_CONTENT_KEYS_EXACT).size).toBe(USER_CONTENT_KEYS_EXACT.length);
    const allKeyValues = Object.values(KEYS);
    expect(new Set(allKeyValues).size).toBe(allKeyValues.length);
  });

  test("every KEYS value is one of the categorized keys", () => {
    const categorized = new Set([...CATEGORY_A, ...CATEGORY_B, ...CATEGORY_C]);
    for (const v of Object.values(KEYS)) {
      expect(categorized.has(v)).toBe(true);
    }
  });
});
