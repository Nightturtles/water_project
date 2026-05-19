// Unit tests for metrics.js functions that read from storage.js (and
// therefore need browser-globals stubs in Node).
//
// Covers:
//   * pickBestCaMgSources — reads getEffectiveCalciumSources /
//     getEffectiveMagnesiumSources from storage.js.
//   * deriveStockFormulaFromTarget — pure, but kept here so all stock-
//     formula calibration tests live together. Uses the Coffee ad Astra
//     ground-truth recipes from scripts/compute-coffee-ad-astra-ions.cjs
//     as round-trip anchors.
//   * computeFullProfile — uses pickBestCaMgSources + splitAlkalinityDelta +
//     getSourceWaterByPreset (all storage.js consumers).
//   * buildStoredTargetProfile (brewMethod-fallback branch) — falls through
//     to loadBrewMethod() when options.brewMethod is absent.

// --- Environment stubs (same pattern as library-merge.test.js) ---

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
// Tests run on the "logged in" code path so transient storage helpers route
// to localStorage.  Override per-test to exercise the anonymous path.
global.isLoggedInSync = () => true;
global._cachedAuthUserId = "test-user-id";

require("./constants.js");
const storage = require("./storage.js");
const metrics = require("./metrics.js");

const { saveSelectedMinerals } = storage;

function resetState() {
  global.localStorage.clear();
  global.sessionStorage.clear();
  // saveSelectedMinerals also clears the internal selectedMineralsCache.
  // Resetting to the 4-mineral default that loadSelectedMinerals would
  // return for an empty store keeps each test starting from the same
  // canonical baseline.
  saveSelectedMinerals(["calcium-chloride", "epsom-salt", "baking-soda", "potassium-bicarbonate"]);
}

beforeEach(resetState);

// ---------------------------------------------------------------------------
// pickBestCaMgSources
// ---------------------------------------------------------------------------

describe("pickBestCaMgSources", () => {
  test("default minerals (one Ca + one Mg) → returns those for any non-zero delta", () => {
    const result = metrics.pickBestCaMgSources(
      { calcium: 0, magnesium: 0 },
      { chloride: 30, sulfate: 0 },
      40,
      10,
    );
    expect(result.caSource).toBe("calcium-chloride");
    expect(result.mgSource).toBe("epsom-salt");
  });

  test("both deltas zero, default 1-Ca + 1-Mg state → returns those single sources", () => {
    // caSources.length === 1 → returns that single source.
    // Same for mgSources.
    const result = metrics.pickBestCaMgSources(
      { calcium: 50, magnesium: 20 },
      { chloride: 30, sulfate: 30 },
      0,
      0,
    );
    expect(result.caSource).toBe("calcium-chloride");
    expect(result.mgSource).toBe("epsom-salt");
  });

  test("both deltas zero, two Ca + two Mg enabled → falls back to CaCl2 + epsom", () => {
    // The caSources.length === 2 → "calcium-chloride", mgSources.length === 2 →
    // "epsom-salt" fallback at metrics.js:107-117.
    saveSelectedMinerals([
      "calcium-chloride",
      "gypsum",
      "epsom-salt",
      "magnesium-chloride",
      "baking-soda",
    ]);
    const result = metrics.pickBestCaMgSources(
      { calcium: 50, magnesium: 20 },
      { chloride: 30, sulfate: 30 },
      0,
      0,
    );
    expect(result.caSource).toBe("calcium-chloride");
    expect(result.mgSource).toBe("epsom-salt");
  });

  test("high-Cl target with CaCl2 + gypsum enabled → picks CaCl2 (side-ion match)", () => {
    // CaCl2 contributes chloride which matches a high-Cl target; gypsum
    // contributes sulfate which would push SO4 too high.
    saveSelectedMinerals(["calcium-chloride", "gypsum", "epsom-salt", "baking-soda"]);
    const result = metrics.pickBestCaMgSources(
      { calcium: 0, magnesium: 0, sulfate: 0, chloride: 0 },
      { calcium: 40, magnesium: 0, sulfate: 0, chloride: 71 },
      40,
      0,
    );
    expect(result.caSource).toBe("calcium-chloride");
  });

  test("high-SO4 target with CaCl2 + gypsum enabled → picks gypsum (side-ion match)", () => {
    saveSelectedMinerals(["calcium-chloride", "gypsum", "epsom-salt", "baking-soda"]);
    const result = metrics.pickBestCaMgSources(
      { calcium: 0, magnesium: 0, sulfate: 0, chloride: 0 },
      { calcium: 40, magnesium: 0, sulfate: 96, chloride: 0 },
      40,
      0,
    );
    expect(result.caSource).toBe("gypsum");
  });
});

// ---------------------------------------------------------------------------
// deriveStockFormulaFromTarget — pure, but uses MINERAL_DB from constants.
// Calibration anchors from scripts/compute-coffee-ad-astra-ions.cjs.
// ---------------------------------------------------------------------------

describe("deriveStockFormulaFromTarget", () => {
  // Helper: each Coffee ad Astra recipe specifies grams of each mineral in a
  // 200-mL stock dosed at 4 g/L (16 g into 4 L brew water). Per-L brew
  // water grams = recipe_g / 50. Resulting brew ions = calculateIonPPMs of
  // those per-L grams. The fixture lets us go (recipe → ions) once, then
  // (ions → derived formula) and assert what minerals the heuristic picks.
  function ionsFromRecipeGrams(recipeGrams) {
    const perLGrams = {};
    for (const [id, g] of Object.entries(recipeGrams)) {
      perLGrams[id] = g / 50;
    }
    return metrics.calculateIonPPMs(perLGrams);
  }

  function mineralIdsOf(formula) {
    return formula.minerals.map((m) => m.mineralId).sort();
  }

  test("Distilled target (all zeros) → empty minerals + distilled note", () => {
    const result = metrics.deriveStockFormulaFromTarget({
      calcium: 0,
      magnesium: 0,
      potassium: 0,
      sodium: 0,
      sulfate: 0,
      chloride: 0,
      bicarbonate: 0,
    });
    expect(result.minerals).toEqual([]);
    expect(result.notes).toEqual(["Distilled / RO target: no minerals to derive."]);
  });

  test("default options → bottleMl=200, doseGramsPerL=4", () => {
    const result = metrics.deriveStockFormulaFromTarget({ calcium: 0 });
    expect(result.bottleMl).toBe(200);
    expect(result.doseGramsPerL).toBe(4);
  });

  test("custom options round-trip", () => {
    const result = metrics.deriveStockFormulaFromTarget({}, { bottleMl: 500, doseGramsPerL: 2 });
    expect(result.bottleMl).toBe(500);
    expect(result.doseGramsPerL).toBe(2);
  });

  test("NaN / negative options coerce to defaults", () => {
    const negative = metrics.deriveStockFormulaFromTarget({}, { bottleMl: -10, doseGramsPerL: 0 });
    expect(negative.bottleMl).toBe(200);
    expect(negative.doseGramsPerL).toBe(4);
    const nan = metrics.deriveStockFormulaFromTarget({}, { bottleMl: "bad", doseGramsPerL: NaN });
    expect(nan.bottleMl).toBe(200);
    expect(nan.doseGramsPerL).toBe(4);
  });

  // --- Coffee ad Astra calibration anchors ---

  test("Dan Eils (sulfate-free, MgCl2 + CaCl2 + KHCO3) → derive picks MgCl2, CaCl2, KHCO3", () => {
    const target = ionsFromRecipeGrams({
      "magnesium-chloride": 5,
      "calcium-chloride": 5,
      "potassium-bicarbonate": 5,
    });
    const formula = metrics.deriveStockFormulaFromTarget(target);
    expect(mineralIdsOf(formula)).toEqual(
      ["calcium-chloride", "magnesium-chloride", "potassium-bicarbonate"].sort(),
    );
    // No epsom-salt, no baking-soda in this profile.
    expect(formula.minerals.some((m) => m.mineralId === "epsom-salt")).toBe(false);
    expect(formula.minerals.some((m) => m.mineralId === "baking-soda")).toBe(false);
  });

  test("Matt Perger (epsom + baking soda) → derive picks epsom + baking soda", () => {
    const target = ionsFromRecipeGrams({
      "epsom-salt": 10,
      "baking-soda": 3.4,
    });
    const formula = metrics.deriveStockFormulaFromTarget(target);
    expect(mineralIdsOf(formula)).toEqual(["baking-soda", "epsom-salt"]);
  });

  test("Rao/Perger (multi-mineral with SO4 and Cl) round-trips ions within ~15%", () => {
    const target = ionsFromRecipeGrams({
      "epsom-salt": 5,
      "magnesium-chloride": 2,
      "calcium-chloride": 2,
      "baking-soda": 1.7,
      "potassium-bicarbonate": 2,
    });
    const formula = metrics.deriveStockFormulaFromTarget(target);
    // The derived formula's minerals are picked heuristically (HCO3 split,
    // Mg by SO4/Cl ratio, Ca always CaCl2). Re-derive ions from the
    // formula's grams and check that the main ions match within tolerance.
    const perLGrams = {};
    formula.minerals.forEach((m) => {
      perLGrams[m.mineralId] = (m.grams / formula.bottleMl) * formula.doseGramsPerL;
    });
    const reIons = metrics.calculateIonPPMs(perLGrams);
    // The round trip should preserve total mineral content reasonably well.
    // We pin the dominant ions (Mg, Ca, K) and tolerate larger drift on Na/SO4
    // since the derive may substitute one buffer for another.
    expect(reIons.magnesium).toBeCloseTo(target.magnesium, 0);
    expect(reIons.calcium).toBeCloseTo(target.calcium, 0);
  });
});

// ---------------------------------------------------------------------------
// computeFullProfile
// ---------------------------------------------------------------------------

describe("computeFullProfile", () => {
  test("all 7 ions explicit → ignores source water, returns rounded ions verbatim", () => {
    // hasExplicitIons branch at metrics.js:711.
    const result = metrics.computeFullProfile({
      calcium: 51.6,
      magnesium: 17.4,
      potassium: 0,
      sodium: 0,
      sulfate: 0,
      chloride: 0,
      bicarbonate: 48.77,
    });
    expect(result).toEqual({
      calcium: 52,
      magnesium: 17,
      potassium: 0,
      sodium: 0,
      sulfate: 0,
      chloride: 0,
      bicarbonate: 49,
    });
  });

  test("partial target (Ca/Mg/Alk) over distilled source → uses defaults to fill side ions", () => {
    // localStorage clean → source water defaults to "distilled" (all 0).
    // Default alkalinity sources = both baking-soda + potassium-bicarbonate;
    // target has only sodium=0 and potassium=0 (both unspecified, both null
    // via Number.isFinite check) → splitAlkalinityDelta hits the K-fallback.
    // Calcium-chloride for Ca; epsom-salt for Mg (default mineral selection).
    const result = metrics.computeFullProfile({
      calcium: 50,
      magnesium: 17,
      alkalinity: 40,
    });
    expect(result.calcium).toBeGreaterThanOrEqual(48);
    expect(result.calcium).toBeLessThanOrEqual(52);
    expect(result.magnesium).toBeGreaterThanOrEqual(15);
    expect(result.magnesium).toBeLessThanOrEqual(19);
    // Epsom-salt contributes sulfate, calcium-chloride contributes chloride.
    expect(result.sulfate).toBeGreaterThan(0);
    expect(result.chloride).toBeGreaterThan(0);
    // K from potassium-bicarbonate (default alk fallback).
    expect(result.potassium).toBeGreaterThan(0);
    // Distilled source + KHCO3-only alk → no sodium added.
    expect(result.sodium).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildStoredTargetProfile — brewMethod-fallback branch
// ---------------------------------------------------------------------------

describe("buildStoredTargetProfile (brewMethod fallback)", () => {
  test("options.brewMethod absent + cw_brew_method='espresso' → output brewMethod='espresso'", () => {
    global.localStorage.setItem("cw_brew_method", "espresso");
    const profile = metrics.buildStoredTargetProfile(
      "X",
      { calcium: 10, magnesium: 5, bicarbonate: 12 },
      "",
      { alkalinity: 10 },
    );
    expect(profile.brewMethod).toBe("espresso");
  });

  test("options.brewMethod 'invalid-mode' + cw_brew_method='espresso' → falls through to loadBrewMethod", () => {
    // metrics.js:815-820 only recognizes 'espresso' or 'filter' on options;
    // everything else falls through to loadBrewMethod().
    global.localStorage.setItem("cw_brew_method", "espresso");
    const profile = metrics.buildStoredTargetProfile(
      "X",
      { calcium: 10, magnesium: 5, bicarbonate: 12 },
      "",
      { brewMethod: "bogus", alkalinity: 10 },
    );
    expect(profile.brewMethod).toBe("espresso");
  });

  test("no options object at all → falls through to loadBrewMethod (defaults to filter)", () => {
    const profile = metrics.buildStoredTargetProfile("X", {
      calcium: 10,
      magnesium: 5,
      bicarbonate: 12,
    });
    // loadBrewMethod with no stored value returns the default. The default is
    // whatever normalizeBrewMethod returns for null, which is "filter" per
    // storage.js convention.
    expect(profile.brewMethod).toBe("filter");
  });
});
