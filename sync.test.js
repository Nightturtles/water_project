// Unit tests for sync.ts payload builders + dirty-tracking helpers.
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
// by e2e/smoke-sync.spec.ts — the module captures Supabase + module-level
// state in lexical closures that don't lend themselves to Node stubbing.
//
// Browser-global stubs (window, localStorage, isLoggedInSync, ...) are
// installed by vitest.setup.js BEFORE these imports execute. That ordering
// matters: storage.ts reads localStorage at module-eval time, and sync.ts's
// initSync() kickoff touches window.supabaseClient (undefined => one
// expected console.warn).

require("./constants.js");
import * as storage from "./src/lib/storage";
import {
  stableStringify,
  snapshotForCompare,
  buildSourceRow,
  buildTargetRow,
  buildSettingsPayload,
  buildSelectionsPayload,
  isDefaultData,
  migrateAnonTransientToLocal,
  enqueueSerialized,
} from "./src/lib/sync";

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
    // Default starter-kit selection (3 essentials; see DEFAULT_SELECTED_MINERALS).
    expect(payload.selected_minerals).toEqual(["calcium-chloride", "epsom-salt", "baking-soda"]);
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

  test("brand-new espresso user → target_preset defaults to cafelytic-espresso, not cafelytic-filter", () => {
    // Regression guard for PR (d.1) finding #1: buildSelectionsPayload used
    // to call loadTargetPresetName() with no arg, so the fallback always
    // returned cafelytic-filter even for espresso-first users. The bug
    // would seed cloud's target_preset with the wrong default and the next
    // pull would snap every device to filter.
    global.localStorage.setItem("cw_brew_method", "espresso");
    const payload = buildSelectionsPayload("u", "t");
    expect(payload.target_preset).toBe("cafelytic-espresso");
  });

  test("brand-new filter user → target_preset defaults to cafelytic-filter", () => {
    // Mirror of the espresso test above; documents that the filter default
    // is still preserved (loadBrewMethod() returns "filter" when unset).
    const payload = buildSelectionsPayload("u", "t");
    expect(payload.target_preset).toBe("cafelytic-filter");
  });

  test("explicit cw_target_preset always wins over the brew-method default", () => {
    // Once the user has interacted with the rail, cw_target_preset is set
    // and loadTargetPresetName returns it verbatim regardless of brew mode.
    global.localStorage.setItem("cw_brew_method", "espresso");
    global.localStorage.setItem("cw_target_preset", "rao");
    const payload = buildSelectionsPayload("u", "t");
    expect(payload.target_preset).toBe("rao");
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
      JSON.stringify(["baking-soda", "calcium-chloride", "epsom-salt"]),
    );
    expect(isDefaultData()).toBe(true);
  });

  // Created-artifact checks added in the sync-hardening pass: these used to be
  // missed, so a customized profile could be silently overwritten by cloud.
  test("DIY concentrate spec present → false", () => {
    global.localStorage.setItem(
      "cw_diy_concentrate_specs",
      JSON.stringify({ "diy:epsom-salt": { gramsPerLiter: 5 } }),
    );
    expect(isDefaultData()).toBe(false);
  });

  test("stock concentrate spec present → false", () => {
    global.localStorage.setItem(
      "cw_stock_concentrate_specs",
      JSON.stringify({ "stock:my-mix": { bottleMl: 200, doseGramsPerL: 1 } }),
    );
    expect(isDefaultData()).toBe(false);
  });

  test("selected concentrates present → false", () => {
    global.localStorage.setItem("cw_selected_concentrates", JSON.stringify(["diy:epsom-salt"]));
    expect(isDefaultData()).toBe(false);
  });

  test("added target preset present → false", () => {
    global.localStorage.setItem("cw_added_target_presets", JSON.stringify(["rao"]));
    expect(isDefaultData()).toBe(false);
  });

  test("creator display name present → false", () => {
    global.localStorage.setItem("cw_creator_display_name", "Kyle");
    expect(isDefaultData()).toBe(false);
  });

  test("recipe draft present → false", () => {
    global.localStorage.setItem(
      "cw_recipe_mineral_inputs",
      JSON.stringify({ "calcium-chloride": "0.5" }),
    );
    expect(isDefaultData()).toBe(false);
  });

  // Display/format preferences are deliberately NOT counted: this gates a
  // binary merge dialog whose "keep local" branch overwrites cloud, so a
  // trivial toggle must not put that destructive choice in front of the user.
  test("display/format preferences alone → still true (prefs excluded)", () => {
    global.localStorage.setItem("cw_brew_method", "espresso");
    global.localStorage.setItem("cw_mineral_display_mode", "advanced");
    global.localStorage.setItem("cw_lotus_dropper_type", "straight");
    global.localStorage.setItem("cw_source_preset", "evian");
    expect(isDefaultData()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// migrateAnonTransientToLocal — anonymous in-tab work survives sign-in
// ---------------------------------------------------------------------------

describe("migrateAnonTransientToLocal", () => {
  test("moves transient keys (incl. cw_volume_*) from sessionStorage to localStorage", () => {
    global.sessionStorage.setItem("cw_source_water", JSON.stringify({ calcium: 40 }));
    global.sessionStorage.setItem("cw_brew_method", "espresso");
    global.sessionStorage.setItem(
      "cw_volume_taste",
      JSON.stringify({ value: "2", unit: "liters" }),
    );
    // A non-transient key must be left untouched.
    global.sessionStorage.setItem("cw_unrelated", "keep-me");

    migrateAnonTransientToLocal();

    expect(global.localStorage.getItem("cw_source_water")).toBe(JSON.stringify({ calcium: 40 }));
    expect(global.localStorage.getItem("cw_brew_method")).toBe("espresso");
    expect(global.localStorage.getItem("cw_volume_taste")).toBe(
      JSON.stringify({ value: "2", unit: "liters" }),
    );
    // Migrated keys are cleared from sessionStorage.
    expect(global.sessionStorage.getItem("cw_source_water")).toBe(null);
    expect(global.sessionStorage.getItem("cw_brew_method")).toBe(null);
    expect(global.sessionStorage.getItem("cw_volume_taste")).toBe(null);
    // Non-transient key is untouched on both sides.
    expect(global.sessionStorage.getItem("cw_unrelated")).toBe("keep-me");
    expect(global.localStorage.getItem("cw_unrelated")).toBe(null);
  });

  test("no anonymous work → no-op", () => {
    migrateAnonTransientToLocal();
    expect(global.localStorage.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// enqueueSerialized — serialization gate for realtime-triggered pulls
// ---------------------------------------------------------------------------

describe("enqueueSerialized", () => {
  test("1. no overlap: task B does not start while task A is unresolved", async () => {
    let resolveA;
    const taskAPromise = new Promise((resolve) => {
      resolveA = resolve;
    });

    let bStarted = false;

    const aEnqueued = enqueueSerialized(function () {
      return taskAPromise;
    });
    const bEnqueued = enqueueSerialized(function () {
      bStarted = true;
      return Promise.resolve();
    });

    // Yield to the microtask queue — B should not have started yet.
    await Promise.resolve();
    expect(bStarted).toBe(false);

    // Resolve A, then await B.
    resolveA();
    await bEnqueued;

    expect(bStarted).toBe(true);
    await aEnqueued; // no unhandled-rejection
  });

  test("2. order preserved: three tasks execute in enqueue order", async () => {
    const order = [];

    const a = enqueueSerialized(function () {
      order.push(0);
      return Promise.resolve();
    });
    const b = enqueueSerialized(function () {
      order.push(1);
      return Promise.resolve();
    });
    const c = enqueueSerialized(function () {
      order.push(2);
      return Promise.resolve();
    });

    await c;
    expect(order).toEqual([0, 1, 2]);
    await a;
    await b;
  });

  test("3. rejection does not wedge the chain: task B still runs after task A rejects", async () => {
    let bRan = false;

    const aEnqueued = enqueueSerialized(function () {
      return Promise.reject(new Error("task A failed"));
    });
    // Catch A so vitest doesn't flag an unhandled rejection.
    aEnqueued.catch(function () {});

    const bEnqueued = enqueueSerialized(function () {
      bRan = true;
      return Promise.resolve();
    });

    await bEnqueued;
    expect(bRan).toBe(true);
  });

  test("4. return value passthrough: resolves with the task's resolved value", async () => {
    const result = await enqueueSerialized(function () {
      return Promise.resolve(42);
    });
    expect(result).toBe(42);
  });
});
