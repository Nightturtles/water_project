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
  invalidateTargetPresetsCache,
  addDeletedTargetPreset,
  loadDeletedTargetPresets,
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

  test("library-only slug appears in rail (not in shim, not in custom)", () => {
    fakeLibraryRows = [
      {
        slug: "sey",
        label: "Sey",
        brewMethod: "filter",
        calcium: 20,
        magnesium: 15,
        alkalinity: 15,
      },
    ];
    invalidateTargetPresetsCache();
    const result = getAllTargetPresets();
    expect(result["sey"]).toBeDefined();
    expect(result["sey"].label).toBe("Sey");
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

describe("copyRecipeToMyProfiles: tombstone-lift vs. suffixed-copy", () => {
  test("non-tombstoned canonical row: creates suffixed custom copy", () => {
    // Canonical rows (user_id IS NULL) already live in the rail. Adding one
    // when it's *not* tombstoned means the user wants their own editable
    // version — copy-to-custom with a suffixed slug.
    const recipe = {
      slug: "sca",
      label: "SCA Standard",
      brewMethod: "filter",
      userId: null,
      calcium: 51,
      magnesium: 17,
      alkalinity: 40,
    };
    const returned = copyRecipeToMyProfiles(recipe);
    // Slug is derived from the label via slugify, not from the canonical slug.
    expect(returned).not.toBe("sca");
    expect(returned).toBe("sca-standard");
    const custom = loadCustomTargetProfiles();
    expect(custom[returned]).toBeDefined();
    expect(custom[returned].label).toBe("SCA Standard");
  });

  test("tombstoned canonical row: lifts tombstone, returns canonical slug (NO sca-2)", () => {
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
  test("canonical row (userId == null), not tombstoned → reports 'in profiles'", () => {
    const recipe = {
      slug: "sca",
      label: "SCA Standard",
      userId: null,
    };
    expect(isRecipeInMyProfiles(recipe)).toBe(true);
  });

  test("canonical row, tombstoned → reports 'not in profiles'", () => {
    addDeletedTargetPreset("sca");
    const recipe = {
      slug: "sca",
      label: "SCA Standard",
      userId: null,
    };
    expect(isRecipeInMyProfiles(recipe)).toBe(false);
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
