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
  saveSelectedConcentrates,
  getAvailableMineralIds,
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
