// Unit tests for the taxonomy-v2 merge + tombstone-lift invariants.
//
// Covers:
//   * storage.getAllTargetPresets — 3-tier merge (shim | library | custom) and
//     uniform tombstone application.
//   * library-data.copyRecipeToMyProfiles — canonical-slug lift vs. suffixed
//     copy branches.
//   * library-data.isRecipeInMyProfiles — canonical-vs-user-published regimes.
//
// Load order mirrors the browser: constants.js first (populates globalThis),
// then storage.js (adds its globals + module exports), then library-data.js
// (IIFE that assigns to window; requires a stub so `window` exists in Node).
//
// The tombstone-lift tests pin the *invariant* (canonical slug is preserved
// on re-add, no suffixed copy created) rather than internal bookkeeping —
// the spec-aligned "My Recipes" refactor may replace the copy-to-custom
// model with a bookmark set, so tests written to the invariant survive.

// --- Environment stubs ---

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
    get _store() {
      return store;
    },
  };
}

global.window = global;
global.localStorage = makeFakeStorage();
global.sessionStorage = makeFakeStorage();

// Load in browser order. constants.js populates TARGET_PRESETS etc. on
// globalThis; storage.js does the same for its helpers; library-data.js
// assigns to window (= global here).
require("./constants.js");
const storage = require("./storage.js");
const library = require("./library-data.js");

const {
  getAllTargetPresets,
  getTargetProfileByKey,
  getTargetPresetsForBrewMethod,
  targetProfileSupportsBrewMethod,
  invalidateTargetPresetsCache,
  addDeletedTargetPreset,
  loadDeletedTargetPresets,
  loadAddedTargetPresets,
  addAddedTargetPreset,
  saveCustomTargetProfiles,
  loadCustomTargetProfiles,
  getExistingTargetProfileLabels,
} = storage;

const { copyRecipeToMyProfiles, isRecipeInMyProfiles } = library;

// --- Test-local helper: stub `getPublicRecipesSync` with a canned library. ---
//
// library-data.js exports its real getPublicRecipesSync, but in tests we want
// to inject specific library rows. Override on globalThis so storage.js's
// `typeof getPublicRecipesSync === "function"` resolves to our stub.
let fakeLibraryRows = [];
globalThis.getPublicRecipesSync = () => fakeLibraryRows;

function resetState() {
  global.localStorage.clear();
  global.sessionStorage.clear();
  fakeLibraryRows = [];
  // Clearing localStorage alone does NOT clear storage.js's in-memory
  // customTargetProfilesCache — tests that called loadCustomTargetProfiles()
  // would otherwise observe stale rows and make the suite order-dependent.
  // saveCustomTargetProfiles sets customTargetProfilesCache = null internally.
  saveCustomTargetProfiles({});
  invalidateTargetPresetsCache();
}

beforeEach(resetState);

// ---------------------------------------------------------------------------
// 1.4 — getAllTargetPresets 3-tier merge
// ---------------------------------------------------------------------------

describe("getAllTargetPresets: 3-tier merge (shim | library | custom)", () => {
  test("empty library + no custom → rail is shim + '+ Add Custom'", () => {
    const result = getAllTargetPresets();
    // Shim contains 5 entries (constants.js TARGET_PRESETS).
    expect(Object.keys(result)).toContain("sca");
    expect(Object.keys(result)).toContain("cafelytic-filter");
    // Ion values come from the shim row verbatim.
    expect(result["sca"].calcium).toBe(51);
    // "+ Add Custom" always present.
    expect(result["custom"]).toBeDefined();
    expect(result["custom"].label).toBe("+ Add Custom");
  });

  test("library row overrides shim at the same slug", () => {
    fakeLibraryRows = [
      {
        slug: "sca",
        label: "SCA from library",
        brewMethod: "filter",
        calcium: 999, // deliberately diverges from shim's 51
        magnesium: 17,
        alkalinity: 40,
        description: "from library",
        userId: null,
        isStarter: true,
      },
    ];
    invalidateTargetPresetsCache();
    const result = getAllTargetPresets();
    expect(result["sca"].label).toBe("SCA from library");
    expect(result["sca"].calcium).toBe(999);
  });

  test("custom row overrides library at the same slug", () => {
    fakeLibraryRows = [
      {
        slug: "sca",
        label: "SCA from library",
        brewMethod: "filter",
        calcium: 999,
        magnesium: 17,
        alkalinity: 40,
        description: "from library",
        userId: null,
        isStarter: true,
      },
    ];
    saveCustomTargetProfiles({
      sca: {
        label: "My SCA",
        calcium: 42,
        magnesium: 17,
        alkalinity: 40,
      },
    });
    invalidateTargetPresetsCache();
    const result = getAllTargetPresets();
    expect(result["sca"].label).toBe("My SCA");
    expect(result["sca"].calcium).toBe(42);
  });

  test("starter library-only slug appears in rail (not in shim, not in custom)", () => {
    fakeLibraryRows = [
      {
        slug: "sey",
        label: "Sey",
        brewMethod: "filter",
        calcium: 20,
        magnesium: 15,
        alkalinity: 15,
        userId: null,
        isStarter: true,
      },
    ];
    invalidateTargetPresetsCache();
    const result = getAllTargetPresets();
    expect(result["sey"]).toBeDefined();
    expect(result["sey"].label).toBe("Sey");
  });

  test("non-starter library slug is hidden by default but appears when explicitly added (migration 011)", () => {
    fakeLibraryRows = [
      {
        slug: "rasami-w1d3",
        label: "RAsami W1D3",
        brewMethod: "filter",
        calcium: 10,
        magnesium: 5,
        alkalinity: 10,
        userId: null,
        isStarter: false,
      },
    ];
    invalidateTargetPresetsCache();
    expect(getAllTargetPresets()["rasami-w1d3"]).toBeUndefined();

    addAddedTargetPreset("rasami-w1d3");
    invalidateTargetPresetsCache();
    expect(getAllTargetPresets()["rasami-w1d3"]).toBeDefined();
  });

  test("tombstone hides a shim slug", () => {
    addDeletedTargetPreset("sca");
    invalidateTargetPresetsCache();
    const result = getAllTargetPresets();
    expect(result["sca"]).toBeUndefined();
  });

  test("tombstone hides a library slug", () => {
    fakeLibraryRows = [
      {
        slug: "sey",
        label: "Sey",
        brewMethod: "filter",
        calcium: 20,
        magnesium: 15,
        alkalinity: 15,
        userId: null,
        isStarter: true,
      },
    ];
    addDeletedTargetPreset("sey");
    invalidateTargetPresetsCache();
    const result = getAllTargetPresets();
    expect(result["sey"]).toBeUndefined();
  });

  test("tombstone hides a custom slug", () => {
    saveCustomTargetProfiles({
      "my-recipe": { label: "Mine", calcium: 10, magnesium: 5, alkalinity: 10 },
    });
    addDeletedTargetPreset("my-recipe");
    invalidateTargetPresetsCache();
    const result = getAllTargetPresets();
    expect(result["my-recipe"]).toBeUndefined();
  });

  test("cache invalidation: tombstone added after first read is reflected on next read", () => {
    const first = getAllTargetPresets();
    expect(first["sca"]).toBeDefined();
    addDeletedTargetPreset("sca");
    invalidateTargetPresetsCache();
    const second = getAllTargetPresets();
    expect(second["sca"]).toBeUndefined();
  });

  test("getTargetProfileByKey resolves library-only slugs via the merged map", () => {
    // Regression guard for CodeRabbit finding: before the fix, this function
    // only checked loadCustomTargetProfiles + TARGET_PRESETS shim, so a
    // library-only slug (e.g. 'sey') returned null despite rendering in the
    // rail — every caller downstream (script.js × 5, taste.html × 1) broke.
    fakeLibraryRows = [
      {
        slug: "sey",
        label: "Sey",
        brewMethod: "filter",
        calcium: 20,
        magnesium: 15,
        alkalinity: 15,
        description: "Sey roaster's water.",
        userId: null,
        isStarter: true,
      },
    ];
    invalidateTargetPresetsCache();
    const profile = getTargetProfileByKey("sey");
    expect(profile).not.toBeNull();
    expect(profile.label).toBe("Sey");
    expect(profile.calcium).toBe(20);
  });

  test("getTargetProfileByKey returns null for 'custom' sentinel", () => {
    expect(getTargetProfileByKey("custom")).toBeNull();
  });

  test("getTargetProfileByKey returns null for tombstoned slug", () => {
    addDeletedTargetPreset("sca");
    invalidateTargetPresetsCache();
    expect(getTargetProfileByKey("sca")).toBeNull();
  });

  test("getExistingTargetProfileLabels includes library labels (duplicate-name guard)", () => {
    fakeLibraryRows = [
      {
        slug: "some-library",
        label: "Unique Library Label",
        brewMethod: "filter",
        calcium: 10,
        magnesium: 5,
        alkalinity: 10,
      },
    ];
    const labels = getExistingTargetProfileLabels();
    expect(labels.has("unique library label")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 1.5 — copyRecipeToMyProfiles tombstone-lift vs. suffixed-copy
// ---------------------------------------------------------------------------

describe("copyRecipeToMyProfiles: canonical-identity preservation + starter-vs-added branching", () => {
  test("non-tombstoned canonical starter row: returns canonical slug, no suffixed copy", () => {
    // Post-migration-011 invariant: canonical rows always stay at their
    // canonical slug — we never fork them into custom profiles, even when
    // the user hits "Save" on an already-visible row. For a starter that
    // isn't tombstoned, this is a no-op that returns the canonical slug.
    const recipe = {
      slug: "sca",
      label: "SCA Standard",
      brewMethod: "filter",
      userId: null,
      isStarter: true,
      calcium: 51,
      magnesium: 17,
      alkalinity: 40,
    };
    const returned = copyRecipeToMyProfiles(recipe);
    expect(returned).toBe("sca");
    const custom = loadCustomTargetProfiles();
    expect(custom["sca"]).toBeUndefined();
    expect(custom["sca-standard"]).toBeUndefined();
  });

  test("tombstoned canonical starter row: lifts tombstone, returns canonical slug (NO sca-2)", () => {
    // The invariant under test: × remove → Add round-trips to the canonical
    // slug. This prevents a "sca-2"-style dangling custom row after
    // remove-then-re-add.
    addDeletedTargetPreset("sca");
    expect(loadDeletedTargetPresets()).toContain("sca");
    const recipe = {
      slug: "sca",
      label: "SCA Standard",
      brewMethod: "filter",
      userId: null,
      isStarter: true,
      calcium: 51,
      magnesium: 17,
      alkalinity: 40,
    };
    const returned = copyRecipeToMyProfiles(recipe);
    expect(returned).toBe("sca");
    expect(loadDeletedTargetPresets()).not.toContain("sca");
    // No suffixed copy created.
    const custom = loadCustomTargetProfiles();
    expect(custom["sca"]).toBeUndefined();
    expect(custom["sca-2"]).toBeUndefined();
    // And the canonical row is now visible in the rail again.
    // (fakeLibraryRows is empty here, so the shim-sca row shows up.)
    invalidateTargetPresetsCache();
    const rail = getAllTargetPresets();
    expect(rail["sca"]).toBeDefined();
  });

  test("non-starter canonical row: adds to added list, returns canonical slug", () => {
    // Migration 011: non-starter canonical rows are hidden by default.
    // copyRecipeToMyProfiles records an explicit add in the added list so
    // getAllTargetPresets's filter picks the row up on next render — no
    // tombstone touch, no suffixed copy.
    const recipe = {
      slug: "rasami-w1d3",
      label: "RAsami W1D3",
      brewMethod: "filter",
      userId: null,
      isStarter: false,
      calcium: 10,
      magnesium: 5,
      alkalinity: 10,
    };
    const returned = copyRecipeToMyProfiles(recipe);
    expect(returned).toBe("rasami-w1d3");
    expect(loadAddedTargetPresets()).toContain("rasami-w1d3");
    expect(loadDeletedTargetPresets()).not.toContain("rasami-w1d3");
    const custom = loadCustomTargetProfiles();
    expect(custom["rasami-w1d3"]).toBeUndefined();
  });

  test("user-published row with a non-tombstoned slug: copies to custom with new slug", () => {
    // User-published rows in practice never collide with canonical slugs
    // (generateUniqueSlug + the partial unique index prevent that), so the
    // realistic branch is: non-matching slug → copy-to-custom path.
    const recipe = {
      slug: "some-users-recipe",
      label: "A Published Recipe",
      brewMethod: "filter",
      userId: "some-user-uuid",
      calcium: 30,
      magnesium: 15,
      alkalinity: 20,
    };
    const returned = copyRecipeToMyProfiles(recipe);
    expect(returned).toBeTruthy();
    const custom = loadCustomTargetProfiles();
    expect(custom[returned]).toBeDefined();
    expect(custom[returned].label).toBe("A Published Recipe");
    expect(custom[returned].calcium).toBe(30);
  });
});

describe("isRecipeInMyProfiles: canonical vs. user-published regimes", () => {
  test("canonical starter row, not tombstoned → reports 'in profiles'", () => {
    const recipe = {
      slug: "sca",
      label: "SCA Standard",
      userId: null,
      isStarter: true,
    };
    expect(isRecipeInMyProfiles(recipe)).toBe(true);
  });

  test("canonical starter row, tombstoned → reports 'not in profiles'", () => {
    addDeletedTargetPreset("sca");
    const recipe = {
      slug: "sca",
      label: "SCA Standard",
      userId: null,
      isStarter: true,
    };
    expect(isRecipeInMyProfiles(recipe)).toBe(false);
  });

  test("canonical non-starter row, NOT in added list → reports 'not in profiles'", () => {
    const recipe = {
      slug: "rasami-w1d3",
      label: "RAsami W1D3",
      userId: null,
      isStarter: false,
    };
    expect(isRecipeInMyProfiles(recipe)).toBe(false);
  });

  test("canonical non-starter row, in added list → reports 'in profiles'", () => {
    addAddedTargetPreset("rasami-w1d3");
    const recipe = {
      slug: "rasami-w1d3",
      label: "RAsami W1D3",
      userId: null,
      isStarter: false,
    };
    expect(isRecipeInMyProfiles(recipe)).toBe(true);
  });

  test("user-published row, matching label in customs → reports 'in profiles'", () => {
    saveCustomTargetProfiles({
      "user-copy": {
        label: "Custom Copy Label",
        calcium: 10,
        magnesium: 5,
        alkalinity: 10,
      },
    });
    const recipe = {
      slug: "user-recipe",
      label: "Custom Copy Label",
      userId: "some-user-uuid",
    };
    expect(isRecipeInMyProfiles(recipe)).toBe(true);
  });

  test("user-published row, no matching label → reports 'not in profiles'", () => {
    const recipe = {
      slug: "user-recipe",
      label: "Brand New Recipe",
      userId: "some-user-uuid",
    };
    expect(isRecipeInMyProfiles(recipe)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2.7 — brew_method='all' support (migration 008)
// ---------------------------------------------------------------------------

describe("brewMethod='all' cross-method support", () => {
  test("targetProfileSupportsBrewMethod: 'all' profile matches filter mode", () => {
    const profile = {
      label: "Cross-method recipe",
      brewMethod: "all",
      calcium: 30,
      magnesium: 15,
      alkalinity: 30,
    };
    expect(targetProfileSupportsBrewMethod("cross", profile, "filter")).toBe(true);
  });

  test("targetProfileSupportsBrewMethod: 'all' profile matches espresso mode", () => {
    const profile = {
      label: "Cross-method recipe",
      brewMethod: "all",
      calcium: 30,
      magnesium: 15,
      alkalinity: 30,
    };
    expect(targetProfileSupportsBrewMethod("cross", profile, "espresso")).toBe(true);
  });

  test("targetProfileSupportsBrewMethod: single-method profile doesn't match the other mode", () => {
    const filterOnly = { label: "Filter only", brewMethod: "filter" };
    expect(targetProfileSupportsBrewMethod("f", filterOnly, "filter")).toBe(true);
    expect(targetProfileSupportsBrewMethod("f", filterOnly, "espresso")).toBe(false);
  });

  test("getTargetPresetsForBrewMethod: 'all'-tagged library rows appear in both rails", () => {
    fakeLibraryRows = [
      {
        slug: "cross-method",
        label: "Cross Method Water",
        brewMethod: "all",
        calcium: 30,
        magnesium: 15,
        alkalinity: 30,
        userId: null,
        isStarter: true,
      },
      {
        slug: "filter-only",
        label: "Filter Only",
        brewMethod: "filter",
        calcium: 40,
        magnesium: 20,
        alkalinity: 25,
        userId: null,
        isStarter: true,
      },
      {
        slug: "espresso-only",
        label: "Espresso Only",
        brewMethod: "espresso",
        calcium: 80,
        magnesium: 40,
        alkalinity: 40,
        userId: null,
        isStarter: true,
      },
    ];
    invalidateTargetPresetsCache();
    const filterRail = getTargetPresetsForBrewMethod("filter");
    const espressoRail = getTargetPresetsForBrewMethod("espresso");
    // cross-method shows up in both
    expect(filterRail["cross-method"]).toBeDefined();
    expect(espressoRail["cross-method"]).toBeDefined();
    // single-method rows only show in their own rail
    expect(filterRail["filter-only"]).toBeDefined();
    expect(filterRail["espresso-only"]).toBeUndefined();
    expect(espressoRail["filter-only"]).toBeUndefined();
    expect(espressoRail["espresso-only"]).toBeDefined();
  });

  test("getTargetPresetsForBrewMethod: tombstone still hides 'all'-tagged rows", () => {
    fakeLibraryRows = [
      {
        slug: "cross-method",
        label: "Cross Method Water",
        brewMethod: "all",
        calcium: 30,
        magnesium: 15,
        alkalinity: 30,
        userId: null,
        isStarter: true,
      },
    ];
    addDeletedTargetPreset("cross-method");
    invalidateTargetPresetsCache();
    const filterRail = getTargetPresetsForBrewMethod("filter");
    const espressoRail = getTargetPresetsForBrewMethod("espresso");
    expect(filterRail["cross-method"]).toBeUndefined();
    expect(espressoRail["cross-method"]).toBeUndefined();
  });
});
