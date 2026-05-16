// Unit tests for sync.js payload builders + dirty-tracking helpers.
//
// Per CLAUDE.md "Supabase safety", three historic sync bugs (commits
// 6d8cd63, 6464fdb, 9f89a2e) cost users recipes. Until now the only
// regression catch was the credential-gated e2e/smoke-sync.spec.ts —
// contributor branches without .env.test had NO sync coverage. These unit
// tests cover the deterministic, pure parts of the sync pipeline:
//
//   * stableStringify — key-sorted JSON used for change detection.
//   * snapshotForCompare — strips updated_at before comparing rows.
//   * buildSourceRow / buildTargetRow — row shapes pushed to Supabase.
//   * buildSettingsPayload / buildSelectionsPayload — settings/selections
//     payloads composed from localStorage state.
//   * isDefaultData — first-login-merge decision.
//
// Full-flow sync (Realtime, push/pull, auth state changes) stays covered
// by e2e/smoke-sync.spec.ts — the IIFE captures Supabase + module-level
// state in lexical closures that don't lend themselves to Node stubbing.

// --- Environment stubs ---
//
// sync.js's IIFE registers visibilitychange/beforeunload/pagehide listeners,
// reads localStorage.length / localStorage.key(i) in collectVolumePreferences,
// and calls initSync() at the bottom (which calls
// window.supabaseClient.auth.getSession). The probe in PR #96's commit log
// confirmed: with these stubs the require succeeds, initSync logs one
// expected console.warn ("[sync] initSync failed: ... reading 'auth'"), and
// all 7 payload-builder functions are exposed via the UMD shim.

function makeFakeStorage() {
  let store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (i) => Object.keys(store)[i] || null,
    get _store() {
      return store;
    },
  };
}

global.window = global;
global.document = { addEventListener: () => {} };
global.window.addEventListener = () => {};
global.localStorage = makeFakeStorage();
global.sessionStorage = makeFakeStorage();
global.window.supabaseClient = undefined;

require("./constants.js");
const storage = require("./storage.js");
const sync = require("./sync.js");

const {
  stableStringify,
  snapshotForCompare,
  buildSourceRow,
  buildTargetRow,
  buildSettingsPayload,
  buildSelectionsPayload,
  isDefaultData,
} = sync;

const { invalidateAllCaches } = storage;

function resetState() {
  global.localStorage.clear();
  global.sessionStorage.clear();
  invalidateAllCaches();
}

beforeEach(resetState);

// ---------------------------------------------------------------------------
// stableStringify
// ---------------------------------------------------------------------------

describe("stableStringify", () => {
  test("null → 'null'", () => {
    expect(stableStringify(null)).toBe("null");
  });

  test("primitives round-trip via JSON.stringify", () => {
    expect(stableStringify(42)).toBe("42");
    expect(stableStringify("hello")).toBe('"hello"');
    expect(stableStringify(true)).toBe("true");
  });

  test("two objects with the same content but different key order produce identical strings", () => {
    // This is the whole reason this function exists: snapshot comparisons
    // against last-pushed payloads must not falsely detect a change just
    // because the rebuilt object had its keys in a different order.
    const a = stableStringify({ b: 1, a: 2, c: 3 });
    const b = stableStringify({ c: 3, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":3}');
  });

  test("recursive sort applies to nested objects", () => {
    const a = stableStringify({ outer: { z: 1, a: 2 } });
    const b = stableStringify({ outer: { a: 2, z: 1 } });
    expect(a).toBe(b);
  });

  test("arrays preserve insertion order (not sorted)", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  test("nested array of objects is stable", () => {
    const a = stableStringify([
      { b: 1, a: 2 },
      { d: 4, c: 3 },
    ]);
    const b = stableStringify([
      { a: 2, b: 1 },
      { c: 3, d: 4 },
    ]);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// snapshotForCompare
// ---------------------------------------------------------------------------

describe("snapshotForCompare", () => {
  test("identical payloads with different updated_at produce identical snapshots", () => {
    const a = { user_id: "u1", calcium: 50, updated_at: "2026-05-15T00:00:00Z" };
    const b = { user_id: "u1", calcium: 50, updated_at: "2026-05-16T01:00:00Z" };
    expect(snapshotForCompare(a)).toBe(snapshotForCompare(b));
  });

  test("user_id IS kept (per the comment at sync.js:168 — identifies the row)", () => {
    const a = { user_id: "u1", calcium: 50 };
    const b = { user_id: "u2", calcium: 50 };
    expect(snapshotForCompare(a)).not.toBe(snapshotForCompare(b));
  });

  test("other field changes produce different snapshots", () => {
    const a = { user_id: "u1", calcium: 50 };
    const b = { user_id: "u1", calcium: 60 };
    expect(snapshotForCompare(a)).not.toBe(snapshotForCompare(b));
  });
});

// ---------------------------------------------------------------------------
// buildSourceRow
// ---------------------------------------------------------------------------

describe("buildSourceRow", () => {
  test("returns the canonical 10-field shape", () => {
    const row = buildSourceRow("user-1", "my-tap", {
      label: "My Tap",
      calcium: 50,
      magnesium: 10,
      potassium: 5,
      sodium: 8,
      sulfate: 12,
      chloride: 30,
      bicarbonate: 60,
    });
    expect(Object.keys(row).sort()).toEqual(
      [
        "bicarbonate",
        "calcium",
        "chloride",
        "label",
        "magnesium",
        "potassium",
        "slug",
        "sodium",
        "sulfate",
        "user_id",
      ].sort(),
    );
    expect(row.user_id).toBe("user-1");
    expect(row.slug).toBe("my-tap");
    expect(row.label).toBe("My Tap");
    expect(row.calcium).toBe(50);
  });

  test("falsy label falls back to slug", () => {
    const row = buildSourceRow("u", "my-slug", { calcium: 0 });
    expect(row.label).toBe("my-slug");
  });

  test("non-numeric ion values coerce to 0 via Number()||0", () => {
    const row = buildSourceRow("u", "x", {
      label: "X",
      calcium: "not a number",
      magnesium: null,
      potassium: undefined,
      sodium: NaN,
    });
    expect(row.calcium).toBe(0);
    expect(row.magnesium).toBe(0);
    expect(row.potassium).toBe(0);
    expect(row.sodium).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildTargetRow
// ---------------------------------------------------------------------------

describe("buildTargetRow", () => {
  function full(userId = "user-1", slug = "my-target", overrides = {}) {
    return buildTargetRow(
      userId,
      slug,
      Object.assign(
        {
          label: "My Target",
          brewMethod: "filter",
          calcium: 50,
          magnesium: 10,
          alkalinity: 40,
          potassium: 5,
          sodium: 0,
          sulfate: 0,
          chloride: 30,
          bicarbonate: 49,
          description: "test",
          isPublic: false,
          creatorDisplayName: "Me",
          tags: ["Bright"],
          roast: ["light"],
        },
        overrides,
      ),
    );
  }

  test("returns all 16 expected columns", () => {
    const row = full();
    expect(Object.keys(row).sort()).toEqual(
      [
        "alkalinity",
        "bicarbonate",
        "brew_method",
        "calcium",
        "chloride",
        "creator_display_name",
        "creator_user_id",
        "description",
        "is_public",
        "label",
        "magnesium",
        "potassium",
        "roast",
        "slug",
        "sodium",
        "sulfate",
        "tags",
        "user_id",
      ].sort(),
    );
  });

  test("falsy brewMethod defaults to 'filter'", () => {
    expect(full("u", "s", { brewMethod: "" }).brew_method).toBe("filter");
    expect(full("u", "s", { brewMethod: undefined }).brew_method).toBe("filter");
    expect(full("u", "s", { brewMethod: null }).brew_method).toBe("filter");
  });

  test("creatorUserId === undefined defaults to userId", () => {
    const row = full("user-99", "s", { creatorUserId: undefined });
    expect(row.creator_user_id).toBe("user-99");
  });

  test("creatorUserId === null is preserved (library-copy attribution)", () => {
    const row = full("u", "s", { creatorUserId: null });
    expect(row.creator_user_id).toBeNull();
  });

  test("creatorUserId set to other user is preserved verbatim", () => {
    const row = full("me", "s", { creatorUserId: "other-user" });
    expect(row.creator_user_id).toBe("other-user");
  });

  test("non-array tags coerces to []", () => {
    expect(full("u", "s", { tags: undefined }).tags).toEqual([]);
    expect(full("u", "s", { tags: "Bright" }).tags).toEqual([]);
  });

  test("empty-array roast coerces to ['all']", () => {
    expect(full("u", "s", { roast: [] }).roast).toEqual(["all"]);
    expect(full("u", "s", { roast: undefined }).roast).toEqual(["all"]);
  });

  test("isPublic truthy/falsy round-trip as boolean", () => {
    expect(full("u", "s", { isPublic: true }).is_public).toBe(true);
    expect(full("u", "s", { isPublic: false }).is_public).toBe(false);
    expect(full("u", "s", { isPublic: 1 }).is_public).toBe(true);
    expect(full("u", "s", { isPublic: undefined }).is_public).toBe(false);
  });

  test("Number(x)||0 coercion on the 7 ions + alkalinity", () => {
    const row = full("u", "s", {
      calcium: "not a number",
      magnesium: null,
      alkalinity: undefined,
    });
    expect(row.calcium).toBe(0);
    expect(row.magnesium).toBe(0);
    expect(row.alkalinity).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildSettingsPayload
// ---------------------------------------------------------------------------

describe("buildSettingsPayload", () => {
  test("empty localStorage → output uses each loader's default", () => {
    const payload = buildSettingsPayload("user-1", "2026-05-15T00:00:00Z");
    expect(payload.user_id).toBe("user-1");
    expect(payload.updated_at).toBe("2026-05-15T00:00:00Z");
    // theme/mineral_display_mode/brew_method defaults from storage.js loaders.
    expect(payload.brew_method).toBe("filter");
    expect(payload.mineral_display_mode).toBe("standard");
    expect(payload.lotus_dropper_type).toBe("round");
    expect(payload.creator_display_name).toBe("");
    // Default 4-mineral selection.
    expect(payload.selected_minerals).toEqual([
      "calcium-chloride",
      "epsom-salt",
      "baking-soda",
      "potassium-bicarbonate",
    ]);
    // Empty volume_preferences when no cw_volume_* keys are present.
    expect(payload.volume_preferences).toEqual({});
  });

  test("volume_preferences strips the cw_volume_ prefix", () => {
    global.localStorage.setItem("cw_volume_taste", JSON.stringify({ value: "2", unit: "liters" }));
    global.localStorage.setItem(
      "cw_volume_recipe",
      JSON.stringify({ value: "1.85", unit: "liters" }),
    );
    // A non-volume key that happens to share the cw_ prefix MUST NOT leak in.
    global.localStorage.setItem("cw_brew_method", "filter");
    const payload = buildSettingsPayload("u", "t");
    expect(payload.volume_preferences).toEqual({
      taste: { value: "2", unit: "liters" },
      recipe: { value: "1.85", unit: "liters" },
    });
  });

  test("brew_method='espresso' from localStorage propagates to payload", () => {
    global.localStorage.setItem("cw_brew_method", "espresso");
    const payload = buildSettingsPayload("u", "t");
    expect(payload.brew_method).toBe("espresso");
  });

  test("user_id and updated_at pass through verbatim", () => {
    const payload = buildSettingsPayload("user-abc-123", "2026-05-16T01:23:45Z");
    expect(payload.user_id).toBe("user-abc-123");
    expect(payload.updated_at).toBe("2026-05-16T01:23:45Z");
  });
});

// ---------------------------------------------------------------------------
// buildSelectionsPayload
// ---------------------------------------------------------------------------

describe("buildSelectionsPayload", () => {
  test("empty localStorage → loader defaults", () => {
    const payload = buildSelectionsPayload("u", "t");
    expect(payload.user_id).toBe("u");
    expect(payload.updated_at).toBe("t");
    expect(payload.source_preset).toBe("distilled");
    expect(payload.source_water).toEqual({
      calcium: 0,
      magnesium: 0,
      potassium: 0,
      sodium: 0,
      sulfate: 0,
      chloride: 0,
      bicarbonate: 0,
    });
    expect(payload.deleted_source_presets).toEqual([]);
    expect(payload.deleted_target_presets).toEqual([]);
    expect(payload.added_target_presets).toEqual([]);
  });

  test("seeded source preset surfaces in payload", () => {
    global.localStorage.setItem("cw_source_preset", "evian");
    const payload = buildSelectionsPayload("u", "t");
    expect(payload.source_preset).toBe("evian");
  });
});

// ---------------------------------------------------------------------------
// isDefaultData
// ---------------------------------------------------------------------------

describe("isDefaultData", () => {
  test("fresh state (empty localStorage) → true", () => {
    expect(isDefaultData()).toBe(true);
  });

  test("non-zero source water field → false", () => {
    global.localStorage.setItem(
      "cw_source_water",
      JSON.stringify({ calcium: 50, magnesium: 0, bicarbonate: 0 }),
    );
    expect(isDefaultData()).toBe(false);
  });

  test("custom source profile present → false", () => {
    global.localStorage.setItem(
      "cw_custom_profiles",
      JSON.stringify({ "my-tap": { calcium: 30, label: "Tap" } }),
    );
    expect(isDefaultData()).toBe(false);
  });

  test("custom target profile present → false", () => {
    global.localStorage.setItem(
      "cw_custom_target_profiles",
      JSON.stringify({ "my-target": { calcium: 50, label: "T" } }),
    );
    expect(isDefaultData()).toBe(false);
  });

  test("deleted source preset present → false", () => {
    global.localStorage.setItem("cw_deleted_presets", JSON.stringify(["evian"]));
    expect(isDefaultData()).toBe(false);
  });

  test("deleted target preset present → false", () => {
    global.localStorage.setItem("cw_deleted_target_presets", JSON.stringify(["sca"]));
    expect(isDefaultData()).toBe(false);
  });

  test("non-default mineral selection → false", () => {
    global.localStorage.setItem(
      "cw_selected_minerals",
      JSON.stringify(["calcium-chloride", "gypsum", "epsom-salt"]),
    );
    expect(isDefaultData()).toBe(false);
  });

  test("default minerals in a different order → still true (order-insensitive)", () => {
    global.localStorage.setItem(
      "cw_selected_minerals",
      JSON.stringify(["baking-soda", "potassium-bicarbonate", "calcium-chloride", "epsom-salt"]),
    );
    expect(isDefaultData()).toBe(true);
  });
});
