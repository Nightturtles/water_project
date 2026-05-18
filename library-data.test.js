// Unit tests for library-data.js pure helpers.
//
// Until now these were only exercised via page.evaluate() in
// e2e/smoke-library.spec.ts:702-825 — slow and creds-adjacent. The pure
// predicates (recipeMatches, applyFilters, partitionByCategory,
// pickFeaturedFromFiltered) and the normalizer/slug helpers don't need
// a browser; testing them here gives a faster, deterministic catch.
//
// Load order mirrors the browser per library-merge.test.js: constants
// (populates RESERVED_TARGET_KEYS, TARGET_PRESETS), then storage (populates
// slugify, loadCustomTargetProfiles, etc.), then library-data (IIFE that
// assigns to window — requires the global stubs to exist first).

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
global.isLoggedInSync = () => true;
global._cachedAuthUserId = "test-user-id";

require("./constants.js");
const storage = require("./storage.js");
const library = require("./library-data.js");

const { saveCustomTargetProfiles, invalidateTargetPresetsCache } = storage;

const {
  normalizePublicRecipeRow: normalizeRow,
  recipeMatches,
  applyFilters,
  partitionByCategory,
  pickFeaturedFromFiltered,
  generateUniqueSlug: uniqueSlug,
} = library;

// Cache key used by library-data.getPublicRecipesSync. Tests that need the
// IIFE-local getPublicRecipesSync (e.g. generateUniqueSlug's library-row
// collision check) must seed sessionStorage with this key, because the IIFE
// captures getPublicRecipesSync lexically — overriding globalThis doesn't
// reach it.
const LIBRARY_CACHE_KEY = "cw_library_public_recipes_v4";

// Test-local stub for getPublicRecipesSync — same pattern as
// library-merge.test.js. This override is read by storage.js (which looks
// up the function via globalThis), but not by library-data.js's internal
// callers. Use seedLibraryRows() below for those.
let fakeLibraryRows = [];
globalThis.getPublicRecipesSync = () => fakeLibraryRows;

function seedLibraryRows(rows) {
  fakeLibraryRows = rows;
  global.sessionStorage.setItem(LIBRARY_CACHE_KEY, JSON.stringify(rows));
  library.invalidatePublicRecipesCache();
  // invalidatePublicRecipesCache also removes the sessionStorage entry,
  // so re-seed after invalidation.
  global.sessionStorage.setItem(LIBRARY_CACHE_KEY, JSON.stringify(rows));
}

function resetState() {
  global.localStorage.clear();
  global.sessionStorage.clear();
  fakeLibraryRows = [];
  library.invalidatePublicRecipesCache();
  saveCustomTargetProfiles({});
  invalidateTargetPresetsCache();
}

beforeEach(resetState);

// ---------------------------------------------------------------------------
// normalizePublicRecipeRow — accepts snake_case (DB shape) or camelCase
// (pre-deploy sessionStorage rehydrate). Always returns canonical camelCase.
// ---------------------------------------------------------------------------

describe("normalizePublicRecipeRow", () => {
  test("snake_case row maps to canonical camelCase shape", () => {
    const row = {
      id: 1,
      user_id: "abc",
      slug: "sca",
      label: "SCA Standard",
      brew_method: "filter",
      calcium: 51,
      magnesium: 17,
      alkalinity: 40,
      potassium: 0,
      sodium: 0,
      sulfate: 0,
      chloride: 0,
      bicarbonate: 48.8,
      description: "SCA",
      creator_display_name: "SCA",
      tags: ["Balanced"],
      tray: "classic",
      roast: ["all"],
      created_at: "2025-01-01",
      is_starter: true,
      stock_formula: { bottleMl: 200, doseGramsPerL: 4, minerals: [] },
    };
    const result = normalizeRow(row);
    expect(result.userId).toBe("abc");
    expect(result.brewMethod).toBe("filter");
    expect(result.creatorDisplayName).toBe("SCA");
    expect(result.category).toBe("classic");
    expect(result.isStarter).toBe(true);
    expect(result.createdAt).toBe("2025-01-01");
    expect(result.stockFormula).toEqual({
      bottleMl: 200,
      doseGramsPerL: 4,
      minerals: [],
    });
  });

  test("camelCase row (rehydrated from prior-deploy snapshot) round-trips unchanged", () => {
    const row = {
      id: 2,
      userId: "xyz",
      slug: "custom-1",
      label: "Custom",
      brewMethod: "espresso",
      creatorDisplayName: "Me",
      category: "original",
      isStarter: false,
      createdAt: "2025-02-01",
      stockFormula: null,
    };
    const result = normalizeRow(row);
    expect(result.userId).toBe("xyz");
    expect(result.brewMethod).toBe("espresso");
    expect(result.creatorDisplayName).toBe("Me");
    expect(result.category).toBe("original");
    expect(result.isStarter).toBe(false);
    expect(result.createdAt).toBe("2025-02-01");
    expect(result.stockFormula).toBeNull();
  });

  test("missing brew_method defaults to 'filter'", () => {
    const result = normalizeRow({ slug: "x", label: "X" });
    expect(result.brewMethod).toBe("filter");
  });

  test("missing tray/category defaults to 'classic'", () => {
    const result = normalizeRow({ slug: "x", label: "X" });
    expect(result.category).toBe("classic");
  });

  test("non-array tags becomes []", () => {
    const result = normalizeRow({ slug: "x", label: "X", tags: "not-array" });
    expect(result.tags).toEqual([]);
  });

  test("missing tags becomes []", () => {
    const result = normalizeRow({ slug: "x", label: "X" });
    expect(result.tags).toEqual([]);
  });

  test("non-array roast becomes ['all']", () => {
    const result = normalizeRow({ slug: "x", label: "X", roast: "bad" });
    expect(result.roast).toEqual(["all"]);
  });

  test("missing roast becomes ['all']", () => {
    const result = normalizeRow({ slug: "x", label: "X" });
    expect(result.roast).toEqual(["all"]);
  });

  test("isStarter takes precedence over is_starter when both present", () => {
    const result = normalizeRow({
      slug: "x",
      label: "X",
      isStarter: true,
      is_starter: false,
    });
    expect(result.isStarter).toBe(true);
  });

  test("is_starter is read when isStarter is absent", () => {
    const result = normalizeRow({ slug: "x", label: "X", is_starter: true });
    expect(result.isStarter).toBe(true);
  });

  test("missing both starter fields → isStarter false", () => {
    const result = normalizeRow({ slug: "x", label: "X" });
    expect(result.isStarter).toBe(false);
  });

  test("stock_formula and stockFormula both surface as stockFormula", () => {
    const snake = normalizeRow({
      slug: "x",
      label: "X",
      stock_formula: { a: 1 },
    });
    expect(snake.stockFormula).toEqual({ a: 1 });
    const camel = normalizeRow({
      slug: "x",
      label: "X",
      stockFormula: { b: 2 },
    });
    expect(camel.stockFormula).toEqual({ b: 2 });
  });

  test("description defaults to empty string", () => {
    const result = normalizeRow({ slug: "x", label: "X" });
    expect(result.description).toBe("");
  });
});

// ---------------------------------------------------------------------------
// recipeMatches — pure predicate behind applyFilters.
// ---------------------------------------------------------------------------

describe("recipeMatches", () => {
  const baseFilters = { method: "all", roast: "all", tags: [], mine: false, q: "" };

  test("null/undefined recipe → false", () => {
    expect(recipeMatches(null, baseFilters)).toBe(false);
    expect(recipeMatches(undefined, baseFilters)).toBe(false);
  });

  test("method='espresso' rejects filter recipes", () => {
    const recipe = { brewMethod: "filter", roast: ["all"], tags: [] };
    expect(recipeMatches(recipe, { ...baseFilters, method: "espresso" })).toBe(false);
  });

  test("method='espresso' accepts espresso recipes", () => {
    const recipe = { brewMethod: "espresso", roast: ["all"], tags: [] };
    expect(recipeMatches(recipe, { ...baseFilters, method: "espresso" })).toBe(true);
  });

  test("method='espresso' accepts brewMethod='all'", () => {
    const recipe = { brewMethod: "all", roast: ["all"], tags: [] };
    expect(recipeMatches(recipe, { ...baseFilters, method: "espresso" })).toBe(true);
  });

  test("roast='light' rejects ['dark']", () => {
    const recipe = { brewMethod: "filter", roast: ["dark"], tags: [] };
    expect(recipeMatches(recipe, { ...baseFilters, roast: "light" })).toBe(false);
  });

  test("roast='light' accepts ['light']", () => {
    const recipe = { brewMethod: "filter", roast: ["light"], tags: [] };
    expect(recipeMatches(recipe, { ...baseFilters, roast: "light" })).toBe(true);
  });

  test("roast='light' accepts roast containing 'all'", () => {
    const recipe = { brewMethod: "filter", roast: ["all"], tags: [] };
    expect(recipeMatches(recipe, { ...baseFilters, roast: "light" })).toBe(true);
  });

  test("tags filter is an AND combination (both required)", () => {
    const recipe = { brewMethod: "filter", roast: ["all"], tags: ["Sweet"] };
    const f = { ...baseFilters, tags: ["Sweet", "Balanced"] };
    expect(recipeMatches(recipe, f)).toBe(false);
    recipe.tags = ["Sweet", "Balanced", "Bright"];
    expect(recipeMatches(recipe, f)).toBe(true);
  });

  test("mine=true without options.isSaved predicate → false for everything", () => {
    const recipe = { brewMethod: "filter", roast: ["all"], tags: [] };
    expect(recipeMatches(recipe, { ...baseFilters, mine: true })).toBe(false);
  });

  test("mine=true with options.isSaved returning true → matches", () => {
    const recipe = { brewMethod: "filter", roast: ["all"], tags: [] };
    expect(recipeMatches(recipe, { ...baseFilters, mine: true }, { isSaved: () => true })).toBe(
      true,
    );
  });

  test("q matches label", () => {
    const recipe = {
      brewMethod: "filter",
      roast: ["all"],
      tags: [],
      label: "Onyx Coffee",
      description: "",
      creatorDisplayName: "",
    };
    expect(recipeMatches(recipe, { ...baseFilters, q: "onyx" })).toBe(true);
  });

  test("q matches description", () => {
    const recipe = {
      brewMethod: "filter",
      roast: ["all"],
      tags: [],
      label: "Foo",
      description: "Onyx light roast water",
      creatorDisplayName: "",
    };
    expect(recipeMatches(recipe, { ...baseFilters, q: "onyx" })).toBe(true);
  });

  test("q matches creatorDisplayName", () => {
    const recipe = {
      brewMethod: "filter",
      roast: ["all"],
      tags: [],
      label: "Foo",
      description: "",
      creatorDisplayName: "Onyx Coffee Lab",
    };
    expect(recipeMatches(recipe, { ...baseFilters, q: "onyx" })).toBe(true);
  });

  test("q is case-insensitive", () => {
    const recipe = {
      brewMethod: "filter",
      roast: ["all"],
      tags: [],
      label: "ONYX",
      description: "",
      creatorDisplayName: "",
    };
    expect(recipeMatches(recipe, { ...baseFilters, q: "onyx" })).toBe(true);
    expect(recipeMatches(recipe, { ...baseFilters, q: "ONYX" })).toBe(true);
  });

  test("q with no hit returns false", () => {
    const recipe = {
      brewMethod: "filter",
      roast: ["all"],
      tags: [],
      label: "Foo",
      description: "",
      creatorDisplayName: "",
    };
    expect(recipeMatches(recipe, { ...baseFilters, q: "onyx" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyFilters
// ---------------------------------------------------------------------------

describe("applyFilters", () => {
  const r1 = { slug: "a", brewMethod: "filter", roast: ["light"], tags: ["Bright"], label: "A" };
  const r2 = { slug: "b", brewMethod: "espresso", roast: ["dark"], tags: ["Sweet"], label: "B" };
  const r3 = { slug: "c", brewMethod: "all", roast: ["all"], tags: ["Balanced"], label: "C" };

  test("non-array recipes argument returns []", () => {
    expect(applyFilters({}, null)).toEqual([]);
    expect(applyFilters({}, undefined)).toEqual([]);
    expect(applyFilters({}, "not array")).toEqual([]);
  });

  test("null filters → defaults applied, returns all recipes", () => {
    const result = applyFilters(null, [r1, r2, r3]);
    expect(result).toHaveLength(3);
  });

  test("empty filters object → returns all recipes", () => {
    const result = applyFilters({}, [r1, r2, r3]);
    expect(result).toHaveLength(3);
  });

  test("method='espresso' returns only espresso and 'all'", () => {
    const result = applyFilters({ method: "espresso" }, [r1, r2, r3]);
    expect(result.map((r) => r.slug)).toEqual(["b", "c"]);
  });

  test("combined method + tags + roast intersection", () => {
    const recipes = [
      { slug: "1", brewMethod: "filter", roast: ["light"], tags: ["Sweet"], label: "X" },
      { slug: "2", brewMethod: "filter", roast: ["light"], tags: ["Sweet", "Bright"], label: "Y" },
      {
        slug: "3",
        brewMethod: "espresso",
        roast: ["light"],
        tags: ["Sweet", "Bright"],
        label: "Z",
      },
    ];
    const result = applyFilters(
      { method: "filter", roast: "light", tags: ["Sweet", "Bright"] },
      recipes,
    );
    expect(result.map((r) => r.slug)).toEqual(["2"]);
  });
});

// ---------------------------------------------------------------------------
// partitionByCategory
// ---------------------------------------------------------------------------

describe("partitionByCategory", () => {
  test("empty input → all buckets empty", () => {
    const result = partitionByCategory([]);
    expect(result).toEqual({
      original: [],
      "intro-water": [],
      roaster: [],
      brand: [],
      classic: [],
    });
  });

  test("non-array input → returns empty bucket shape", () => {
    const result = partitionByCategory(null);
    expect(result.classic).toEqual([]);
    expect(result.original).toEqual([]);
  });

  test("unknown category falls through to 'classic'", () => {
    const result = partitionByCategory([{ slug: "x", category: "mystery", label: "X" }]);
    expect(result.classic).toHaveLength(1);
    expect(result.classic[0].slug).toBe("x");
  });

  test("intro-water bucket is sorted by slug ascending", () => {
    const result = partitionByCategory([
      { slug: "rasami-w1d3", category: "intro-water", label: "D3" },
      { slug: "rasami-w1d1", category: "intro-water", label: "D1" },
      { slug: "rasami-w1d2", category: "intro-water", label: "D2" },
    ]);
    expect(result["intro-water"].map((r) => r.slug)).toEqual([
      "rasami-w1d1",
      "rasami-w1d2",
      "rasami-w1d3",
    ]);
  });

  test("other categories preserve insertion order", () => {
    const result = partitionByCategory([
      { slug: "z", category: "classic", label: "Z" },
      { slug: "a", category: "classic", label: "A" },
    ]);
    expect(result.classic.map((r) => r.slug)).toEqual(["z", "a"]);
  });
});

// ---------------------------------------------------------------------------
// pickFeaturedFromFiltered
// ---------------------------------------------------------------------------

describe("pickFeaturedFromFiltered", () => {
  const filtered = [
    { slug: "cafelytic-filter", label: "Cafelytic Filter" },
    { slug: "cafelytic-espresso", label: "Cafelytic Espresso" },
    { slug: "sca", label: "SCA" },
  ];

  test("method='espresso' returns cafelytic-espresso", () => {
    const result = pickFeaturedFromFiltered(filtered, "espresso");
    expect(result.slug).toBe("cafelytic-espresso");
  });

  test("method='filter' returns cafelytic-filter", () => {
    const result = pickFeaturedFromFiltered(filtered, "filter");
    expect(result.slug).toBe("cafelytic-filter");
  });

  test("method='all' returns cafelytic-filter", () => {
    const result = pickFeaturedFromFiltered(filtered, "all");
    expect(result.slug).toBe("cafelytic-filter");
  });

  test("unknown method falls through to FEATURED_PICKS.all", () => {
    const result = pickFeaturedFromFiltered(filtered, "bogus");
    expect(result.slug).toBe("cafelytic-filter");
  });

  test("featured slug not in filtered set → null (respects active search)", () => {
    const partial = [{ slug: "sca", label: "SCA" }];
    expect(pickFeaturedFromFiltered(partial, "filter")).toBeNull();
  });

  test("empty filtered set → null", () => {
    expect(pickFeaturedFromFiltered([], "filter")).toBeNull();
  });

  test("non-array filtered → null", () => {
    expect(pickFeaturedFromFiltered(null, "filter")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// generateUniqueSlug — collision detection against custom profiles,
// reserved/built-in keys, and the public-recipes library cache.
// ---------------------------------------------------------------------------

describe("generateUniqueSlug", () => {
  test("fresh state, no collisions → returns slugified base", () => {
    expect(uniqueSlug("My Recipe")).toBe("my-recipe");
  });

  test("empty base → 'recipe'", () => {
    expect(uniqueSlug("")).toBe("recipe");
    expect(uniqueSlug("   ")).toBe("recipe");
  });

  test("collision with custom profile slug → suffixed -2", () => {
    saveCustomTargetProfiles({
      "my-recipe": { label: "Mine", calcium: 10, magnesium: 5, alkalinity: 10 },
    });
    expect(uniqueSlug("My Recipe")).toBe("my-recipe-2");
  });

  test("collision with built-in shim key (sca) → suffixed", () => {
    // 'sca' is in TARGET_PRESETS → RESERVED_TARGET_KEYS.
    expect(uniqueSlug("SCA")).toBe("sca-2");
  });

  test("collision with reserved 'custom'/'library' sentinel → suffixed", () => {
    expect(uniqueSlug("custom")).toBe("custom-2");
    expect(uniqueSlug("library")).toBe("library-2");
  });

  test("collision with library row slug → suffixed", () => {
    seedLibraryRows([{ slug: "onyx", label: "Onyx" }]);
    expect(uniqueSlug("Onyx")).toBe("onyx-2");
  });

  test("multi-collision chain increments past the highest", () => {
    saveCustomTargetProfiles({
      "my-recipe": { label: "A", calcium: 0, magnesium: 0, alkalinity: 0 },
      "my-recipe-2": { label: "B", calcium: 0, magnesium: 0, alkalinity: 0 },
      "my-recipe-3": { label: "C", calcium: 0, magnesium: 0, alkalinity: 0 },
    });
    expect(uniqueSlug("My Recipe")).toBe("my-recipe-4");
  });
});
