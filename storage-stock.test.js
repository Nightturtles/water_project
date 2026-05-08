// Unit tests for the B1 stock-concentrate storage primitives.
//
// Covers the surface that B2 (settings UI) and B3 (calculator dispensing)
// will call into:
//   * loadStockConcentrateSpecs / saveStockConcentrateSpecs round-trip,
//     including cache invalidation and empty-input normalization.
//   * parseStockConcentrateId — accepts "stock:<slug>", rejects everything else.
//   * getStockSpec — returns the stored spec for a stock id, null otherwise.
//   * getStockMineralIds — flattens minerals[] with duplicate collapse and
//     defends against malformed entries.
//   * getAvailableMineralIds — enumerates minerals from selectedMinerals,
//     diy:* concentrates, AND every mineral inside enabled stock:* concentrates.
//
// Load order mirrors the browser: constants.js first (populates globalThis),
// then storage.js (adds its globals + module exports).

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
  };
}

global.window = global;
global.localStorage = makeFakeStorage();
global.sessionStorage = makeFakeStorage();

require("./constants.js");
const storage = require("./storage.js");

const {
  loadStockConcentrateSpecs,
  saveStockConcentrateSpecs,
  parseStockConcentrateId,
  getStockSpec,
  getStockMineralIds,
  computeStockMineralGramsPerL,
  importLibraryStockToPantry,
  loadSelectedConcentrates,
  saveSelectedConcentrates,
  getAvailableMineralIds,
  invalidateAllCaches,
} = storage;

function resetState() {
  global.localStorage.clear();
  global.sessionStorage.clear();
  // Force the in-memory caches to refresh from the cleared store.
  saveStockConcentrateSpecs({});
  saveSelectedConcentrates([]);
}

beforeEach(resetState);

describe("loadStockConcentrateSpecs / saveStockConcentrateSpecs", () => {
  test("round-trips a single stock spec verbatim", () => {
    const spec = {
      "rao-perger": {
        label: "Rao/Perger",
        bottleMl: 200,
        doseGramsPerL: 4,
        minerals: [
          { mineralId: "epsom-salt", grams: 5 },
          { mineralId: "magnesium-chloride", grams: 2 },
        ],
        createdFrom: "library:rao-perger",
      },
    };
    saveStockConcentrateSpecs(spec);
    expect(loadStockConcentrateSpecs()).toEqual(spec);
  });

  test("falsy / non-object input persists as empty map", () => {
    saveStockConcentrateSpecs(null);
    expect(loadStockConcentrateSpecs()).toEqual({});
    saveStockConcentrateSpecs(undefined);
    expect(loadStockConcentrateSpecs()).toEqual({});
  });

  test("array input is rejected (load returns {} not the array)", () => {
    // Defensive against legacy / malformed cloud payloads. The DB column is
    // typed jsonb but the application always treats it as a map.
    global.localStorage.setItem("cw_stock_concentrate_specs", JSON.stringify([]));
    expect(loadStockConcentrateSpecs()).toEqual({});
  });

  test("missing localStorage key reads as empty map", () => {
    global.localStorage.clear();
    expect(loadStockConcentrateSpecs()).toEqual({});
  });

  test("save invalidates the cache so subsequent loads see the new value", () => {
    saveStockConcentrateSpecs({ a: { label: "A", bottleMl: 200, doseGramsPerL: 4, minerals: [] } });
    expect(Object.keys(loadStockConcentrateSpecs())).toEqual(["a"]);
    saveStockConcentrateSpecs({ b: { label: "B", bottleMl: 100, doseGramsPerL: 2, minerals: [] } });
    expect(Object.keys(loadStockConcentrateSpecs())).toEqual(["b"]);
  });
});

describe("parseStockConcentrateId", () => {
  test("extracts slug from a well-formed stock id", () => {
    expect(parseStockConcentrateId("stock:rao-perger")).toBe("rao-perger");
    expect(parseStockConcentrateId("stock:my-custom-mix")).toBe("my-custom-mix");
  });

  test("rejects diy: and brand: ids", () => {
    expect(parseStockConcentrateId("diy:epsom-salt")).toBeNull();
    expect(parseStockConcentrateId("brand:lotus:calcium")).toBeNull();
  });

  test("rejects empty slug, non-strings, and undefined", () => {
    expect(parseStockConcentrateId("stock:")).toBeNull();
    expect(parseStockConcentrateId(null)).toBeNull();
    expect(parseStockConcentrateId(undefined)).toBeNull();
    expect(parseStockConcentrateId(42)).toBeNull();
  });
});

describe("getStockSpec", () => {
  test("returns the spec when the id maps to a saved stock", () => {
    const spec = {
      "my-stock": {
        label: "My Stock",
        bottleMl: 200,
        doseGramsPerL: 4,
        minerals: [{ mineralId: "epsom-salt", grams: 5 }],
      },
    };
    saveStockConcentrateSpecs(spec);
    expect(getStockSpec("stock:my-stock")).toEqual(spec["my-stock"]);
  });

  test("returns null for unknown slug or non-stock id", () => {
    saveStockConcentrateSpecs({});
    expect(getStockSpec("stock:does-not-exist")).toBeNull();
    expect(getStockSpec("diy:epsom-salt")).toBeNull();
    expect(getStockSpec(null)).toBeNull();
  });
});

describe("getStockMineralIds", () => {
  test("flattens minerals[] to unique mineralIds in declaration order", () => {
    const spec = {
      minerals: [
        { mineralId: "epsom-salt", grams: 5 },
        { mineralId: "magnesium-chloride", grams: 2 },
        { mineralId: "calcium-chloride", grams: 1.5 },
      ],
    };
    expect(getStockMineralIds(spec)).toEqual([
      "epsom-salt",
      "magnesium-chloride",
      "calcium-chloride",
    ]);
  });

  test("collapses duplicates", () => {
    const spec = {
      minerals: [
        { mineralId: "epsom-salt", grams: 5 },
        { mineralId: "epsom-salt", grams: 3 },
      ],
    };
    expect(getStockMineralIds(spec)).toEqual(["epsom-salt"]);
  });

  test("ignores malformed entries", () => {
    const spec = {
      minerals: [
        { mineralId: "epsom-salt", grams: 5 },
        null,
        { mineralId: "", grams: 2 },
        { grams: 1 },
        "string-not-an-object",
        { mineralId: "baking-soda", grams: 1.7 },
      ],
    };
    expect(getStockMineralIds(spec)).toEqual(["epsom-salt", "baking-soda"]);
  });

  test("returns [] for null / missing / non-array minerals", () => {
    expect(getStockMineralIds(null)).toEqual([]);
    expect(getStockMineralIds(undefined)).toEqual([]);
    expect(getStockMineralIds({})).toEqual([]);
    expect(getStockMineralIds({ minerals: "not an array" })).toEqual([]);
  });
});

describe("computeStockMineralGramsPerL", () => {
  // Convention: per-L brew water grams of each mineral =
  //   (mineral.grams / bottleMl) * doseGramsPerL
  // Same dilution math as scripts/compute-coffee-ad-astra-ions.cjs (200 mL
  // bottle / 4 g/L dose → divide author grams by 50 to get g/L brew).
  test("Rao/Perger formula matches the seed-script convention", () => {
    const spec = {
      bottleMl: 200,
      doseGramsPerL: 4,
      minerals: [
        { mineralId: "epsom-salt", grams: 5 },
        { mineralId: "magnesium-chloride", grams: 2 },
        { mineralId: "calcium-chloride", grams: 2 },
        { mineralId: "baking-soda", grams: 1.7 },
        { mineralId: "potassium-bicarbonate", grams: 2 },
      ],
    };
    const out = computeStockMineralGramsPerL(spec);
    expect(out["epsom-salt"]).toBeCloseTo(0.1, 6); // 5 / 50
    expect(out["magnesium-chloride"]).toBeCloseTo(0.04, 6); // 2 / 50
    expect(out["calcium-chloride"]).toBeCloseTo(0.04, 6);
    expect(out["baking-soda"]).toBeCloseTo(0.034, 6); // 1.7 / 50
    expect(out["potassium-bicarbonate"]).toBeCloseTo(0.04, 6);
  });

  test("empty / non-array minerals → {}", () => {
    expect(computeStockMineralGramsPerL(null)).toEqual({});
    expect(computeStockMineralGramsPerL(undefined)).toEqual({});
    expect(computeStockMineralGramsPerL({})).toEqual({});
    expect(
      computeStockMineralGramsPerL({ bottleMl: 200, doseGramsPerL: 4, minerals: "nope" }),
    ).toEqual({});
  });

  test("zero / missing bottleMl or doseGramsPerL → {}", () => {
    const minerals = [{ mineralId: "epsom-salt", grams: 5 }];
    expect(computeStockMineralGramsPerL({ bottleMl: 0, doseGramsPerL: 4, minerals })).toEqual({});
    expect(computeStockMineralGramsPerL({ bottleMl: 200, doseGramsPerL: 0, minerals })).toEqual({});
    expect(computeStockMineralGramsPerL({ doseGramsPerL: 4, minerals })).toEqual({});
    expect(computeStockMineralGramsPerL({ bottleMl: 200, minerals })).toEqual({});
    expect(computeStockMineralGramsPerL({ bottleMl: -100, doseGramsPerL: 4, minerals })).toEqual(
      {},
    );
  });

  test("malformed mineral entries are skipped", () => {
    const out = computeStockMineralGramsPerL({
      bottleMl: 200,
      doseGramsPerL: 4,
      minerals: [
        { mineralId: "epsom-salt", grams: 5 },
        null,
        { mineralId: "", grams: 2 },
        { mineralId: "magnesium-chloride" }, // missing grams
        { mineralId: "magnesium-chloride", grams: 0 }, // zero grams
        { mineralId: "magnesium-chloride", grams: -1 }, // negative grams
        "not-an-object",
        { grams: 1.7 }, // missing mineralId
        { mineralId: "baking-soda", grams: 1.7 },
      ],
    });
    expect(Object.keys(out).sort()).toEqual(["baking-soda", "epsom-salt"]);
    expect(out["epsom-salt"]).toBeCloseTo(0.1, 6);
    expect(out["baking-soda"]).toBeCloseTo(0.034, 6);
  });

  test("duplicate mineralIds sum together", () => {
    // Permits user-defined stocks that add the same salt across multiple lines.
    const out = computeStockMineralGramsPerL({
      bottleMl: 200,
      doseGramsPerL: 4,
      minerals: [
        { mineralId: "epsom-salt", grams: 3 },
        { mineralId: "epsom-salt", grams: 2 },
      ],
    });
    expect(out["epsom-salt"]).toBeCloseTo((3 + 2) / 50, 6);
  });

  test("dose scales linearly with doseGramsPerL", () => {
    const spec = {
      bottleMl: 200,
      doseGramsPerL: 8, // doubled from the canonical 4
      minerals: [{ mineralId: "epsom-salt", grams: 5 }],
    };
    expect(computeStockMineralGramsPerL(spec)["epsom-salt"]).toBeCloseTo(0.2, 6); // 5/200 * 8
  });
});

describe("invalidateAllCaches resets stockConcentrateSpecsCache", () => {
  // Regression guard: sync.js's pullFromCloud writes the new
  // cw_stock_concentrate_specs into localStorage and then calls
  // invalidateAllCaches() to force a re-read on next access. If the new
  // cache is omitted from invalidateAllCaches, same-tab pulls return
  // stale data until another path (save, cross-tab storage event,
  // page reload) happens to clear it.
  test("loadStockConcentrateSpecs sees fresh value after invalidateAllCaches() + localStorage update", () => {
    saveStockConcentrateSpecs({
      "old-stock": { label: "Old", bottleMl: 100, doseGramsPerL: 2, minerals: [] },
    });
    // Prime the cache.
    expect(Object.keys(loadStockConcentrateSpecs())).toEqual(["old-stock"]);

    // Simulate sync's pullFromCloud: write new value directly to
    // localStorage, bypassing saveStockConcentrateSpecs (which would
    // invalidate the cache itself).
    global.localStorage.setItem(
      "cw_stock_concentrate_specs",
      JSON.stringify({
        "new-stock": { label: "New", bottleMl: 200, doseGramsPerL: 4, minerals: [] },
      }),
    );

    // Without invalidateAllCaches, the next load returns stale "old-stock".
    invalidateAllCaches();

    expect(Object.keys(loadStockConcentrateSpecs())).toEqual(["new-stock"]);
  });
});

describe("importLibraryStockToPantry", () => {
  // Canonical Coffee ad Astra row shape — mirrors what library-data.js
  // normalizes from public_recipes.stock_formula.
  const RAO_PERGER = {
    slug: "rao-perger",
    label: "Rao/Perger",
    stockFormula: {
      bottleMl: 200,
      doseGramsPerL: 4,
      minerals: [
        { mineralId: "epsom-salt", grams: 5 },
        { mineralId: "magnesium-chloride", grams: 2 },
        { mineralId: "calcium-chloride", grams: 2 },
        { mineralId: "baking-soda", grams: 1.7 },
        { mineralId: "potassium-bicarbonate", grams: 2 },
      ],
      source: "Rao & Perger",
      via: "Coffee ad Astra (Jonathan Gagné, Dec 2018)",
    },
  };

  test("imports a fresh library row keyed on slug with createdFrom set", () => {
    const result = importLibraryStockToPantry(RAO_PERGER);
    expect(result).toEqual({ status: "imported", slug: "rao-perger" });

    const specs = loadStockConcentrateSpecs();
    expect(specs["rao-perger"]).toEqual({
      label: "Rao/Perger",
      bottleMl: 200,
      doseGramsPerL: 4,
      minerals: [
        { mineralId: "epsom-salt", grams: 5 },
        { mineralId: "magnesium-chloride", grams: 2 },
        { mineralId: "calcium-chloride", grams: 2 },
        { mineralId: "baking-soda", grams: 1.7 },
        { mineralId: "potassium-bicarbonate", grams: 2 },
      ],
      createdFrom: "library:rao-perger",
      source: "Rao & Perger",
    });
  });

  test("does NOT auto-enable the stock in cw_selected_concentrates", () => {
    saveSelectedConcentrates([]);
    importLibraryStockToPantry(RAO_PERGER);
    // User has to flip the checkbox in Settings explicitly — re-importing
    // should never silently enable a stock the user hadn't opted in to.
    expect(loadSelectedConcentrates()).toEqual([]);
  });

  test("idempotent: re-import is a no-op that preserves existing edits", () => {
    importLibraryStockToPantry(RAO_PERGER);
    // Simulate the user editing the bottle volume in Settings to match the
    // bottle they actually have on hand.
    const specs = loadStockConcentrateSpecs();
    specs["rao-perger"].bottleMl = 250;
    saveStockConcentrateSpecs(specs);

    const result = importLibraryStockToPantry(RAO_PERGER);
    expect(result).toEqual({ status: "already-present", slug: "rao-perger" });
    // The user's edit must survive — re-import must not overwrite. The path
    // to refresh from library values is the "Reset to library values" link
    // in Settings (minerals.html), not re-clicking on a library card.
    expect(loadStockConcentrateSpecs()["rao-perger"].bottleMl).toBe(250);
  });

  test("falls back to slug when label is missing", () => {
    importLibraryStockToPantry({ slug: "no-name", stockFormula: RAO_PERGER.stockFormula });
    expect(loadStockConcentrateSpecs()["no-name"].label).toBe("no-name");
  });

  test("omits source when the formula has none", () => {
    const noSource = Object.assign({}, RAO_PERGER, {
      stockFormula: Object.assign({}, RAO_PERGER.stockFormula, { source: undefined }),
    });
    importLibraryStockToPantry(noSource);
    const spec = loadStockConcentrateSpecs()["rao-perger"];
    expect("source" in spec).toBe(false);
  });

  test("filters malformed mineral entries during import", () => {
    importLibraryStockToPantry({
      slug: "messy",
      label: "Messy",
      stockFormula: {
        bottleMl: 200,
        doseGramsPerL: 4,
        minerals: [
          { mineralId: "epsom-salt", grams: 5 },
          null,
          { mineralId: "", grams: 2 },
          { grams: 1.7 }, // missing mineralId
          "string",
          { mineralId: "baking-soda", grams: 1.7 },
        ],
      },
    });
    expect(loadStockConcentrateSpecs()["messy"].minerals).toEqual([
      { mineralId: "epsom-salt", grams: 5 },
      { mineralId: "baking-soda", grams: 1.7 },
    ]);
  });

  test("coerces non-numeric bottleMl / doseGramsPerL to 0", () => {
    // Mirrors the existing minerals.html reset-library handler's permissive
    // Number(...) || 0 coercion. Downstream (computeStockMineralGramsPerL)
    // already returns {} for zero/missing values, so a malformed library row
    // produces an inert spec rather than throwing.
    importLibraryStockToPantry({
      slug: "garbage",
      label: "Garbage",
      stockFormula: {
        bottleMl: "abc",
        doseGramsPerL: null,
        minerals: [{ mineralId: "epsom-salt", grams: 5 }],
      },
    });
    const spec = loadStockConcentrateSpecs()["garbage"];
    expect(spec.bottleMl).toBe(0);
    expect(spec.doseGramsPerL).toBe(0);
  });

  test("rejects null / non-object recipe", () => {
    expect(importLibraryStockToPantry(null)).toEqual({ status: "invalid", slug: null });
    expect(importLibraryStockToPantry(undefined)).toEqual({ status: "invalid", slug: null });
    expect(importLibraryStockToPantry("string")).toEqual({ status: "invalid", slug: null });
  });

  test("rejects recipe with missing slug or stockFormula", () => {
    expect(importLibraryStockToPantry({ label: "no slug" })).toEqual({
      status: "invalid",
      slug: null,
    });
    expect(importLibraryStockToPantry({ slug: "x", label: "no formula" })).toEqual({
      status: "invalid",
      slug: null,
    });
    expect(importLibraryStockToPantry({ slug: "x", stockFormula: { bottleMl: 200 } })).toEqual({
      status: "invalid",
      slug: null,
    });
    expect(importLibraryStockToPantry({ slug: "x", stockFormula: { minerals: [] } })).toEqual({
      status: "invalid",
      slug: null,
    });
  });

  test("written spec lights up calculator dispensing math end-to-end", () => {
    // Sanity check that B3a + B3 hand-off works: import a library row, enable
    // it as a selected concentrate, and the per-L mineral grams come out the
    // same as the seed-script convention (verifying nothing got mangled
    // during the normalize → save → load round-trip).
    importLibraryStockToPantry(RAO_PERGER);
    saveSelectedConcentrates(["stock:rao-perger"]);
    const spec = getStockSpec("stock:rao-perger");
    const perL = computeStockMineralGramsPerL(spec);
    expect(perL["epsom-salt"]).toBeCloseTo(0.1, 6); // 5 / 50
    expect(perL["potassium-bicarbonate"]).toBeCloseTo(0.04, 6); // 2 / 50
  });
});

describe("getAvailableMineralIds — stock concentrate enumeration", () => {
  test("includes every mineral inside an enabled stock", () => {
    saveStockConcentrateSpecs({
      "rao-perger": {
        label: "Rao/Perger",
        bottleMl: 200,
        doseGramsPerL: 4,
        minerals: [
          { mineralId: "epsom-salt", grams: 5 },
          { mineralId: "magnesium-chloride", grams: 2 },
          { mineralId: "calcium-chloride", grams: 2 },
          { mineralId: "baking-soda", grams: 1.7 },
          { mineralId: "potassium-bicarbonate", grams: 2 },
        ],
      },
    });
    saveSelectedConcentrates(["stock:rao-perger"]);

    const ids = getAvailableMineralIds().sort();
    // Expect every mineral in the stock formula to surface, plus whatever
    // the default selectedMinerals list contains. Defaults from
    // loadSelectedMinerals(): calcium-chloride, epsom-salt, baking-soda,
    // potassium-bicarbonate. Stock adds magnesium-chloride.
    expect(ids).toContain("epsom-salt");
    expect(ids).toContain("magnesium-chloride");
    expect(ids).toContain("calcium-chloride");
    expect(ids).toContain("baking-soda");
    expect(ids).toContain("potassium-bicarbonate");
  });

  test("does NOT surface minerals from a stock that is defined but not selected", () => {
    saveStockConcentrateSpecs({
      "unused-stock": {
        label: "Unused",
        bottleMl: 200,
        doseGramsPerL: 4,
        // gypsum is NOT in the default selectedMinerals; if enumeration
        // accidentally pulled from all defined stocks instead of just
        // the selected ones, gypsum would leak in here.
        minerals: [{ mineralId: "gypsum", grams: 5 }],
      },
    });
    saveSelectedConcentrates([]);

    expect(getAvailableMineralIds()).not.toContain("gypsum");
  });

  test("survives a stock id whose spec was deleted (orphan id)", () => {
    saveStockConcentrateSpecs({});
    saveSelectedConcentrates(["stock:no-longer-exists"]);

    // Should not throw; just returns the default minerals.
    expect(() => getAvailableMineralIds()).not.toThrow();
    const ids = getAvailableMineralIds();
    expect(Array.isArray(ids)).toBe(true);
  });
});
