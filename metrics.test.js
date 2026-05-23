// Unit tests for metrics.js pure functions.
// describe/expect/test are injected via vitest globals: true.
// Load order mirrors the browser: constants.js populates globalThis first,
// then storage.js (so metrics.js's solveCalculatorDosing can resolve
// computeStockMineralGramsPerL via global scope), then metrics.js.
// Storage shims mirror storage-stock.test.js — solveCalculatorDosing reads
// stock spec data but doesn't touch persisted state, so a minimal shim
// suffices.
function _makeFakeStorage() {
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
global.localStorage = _makeFakeStorage();
global.sessionStorage = _makeFakeStorage();
global.isLoggedInSync = () => true;
global._cachedAuthUserId = "test-user-id";

require("./constants.js");
require("./storage.js");
const metrics = require("./metrics.js");

describe("calculateIonPPMs", () => {
  test("empty input → all ions at zero", () => {
    expect(metrics.calculateIonPPMs({})).toEqual({
      calcium: 0,
      magnesium: 0,
      potassium: 0,
      sodium: 0,
      sulfate: 0,
      chloride: 0,
      bicarbonate: 0,
    });
  });

  test("1 g/L baking soda → ~273.67 mg/L sodium and ~726.33 mg/L bicarbonate", () => {
    // NaHCO3, MW 84.007. Per-g contributions: Na 22.99/84.007, HCO3 61.017/84.007.
    // 1 g/L × fraction × 1000 = mg/L.
    const ions = metrics.calculateIonPPMs({ "baking-soda": 1 });
    expect(ions.sodium).toBeCloseTo(273.67, 1);
    expect(ions.bicarbonate).toBeCloseTo(726.33, 1);
    expect(ions.calcium).toBe(0);
    expect(ions.chloride).toBe(0);
  });

  test("ignores unknown mineral ids without throwing", () => {
    const ions = metrics.calculateIonPPMs({ "not-a-real-mineral": 5 });
    expect(ions.calcium).toBe(0);
    expect(ions.sodium).toBe(0);
  });
});

describe("calculateMetrics", () => {
  test("GH = Ca*CA_TO_CACO3 + Mg*MG_TO_CACO3; KH = HCO3*HCO3_TO_CACO3", () => {
    const { gh, kh, tds } = metrics.calculateMetrics({
      calcium: 40,
      magnesium: 10,
      bicarbonate: 61,
    });
    // CA_TO_CACO3 = 100.09/40.078 ≈ 2.497, MG_TO_CACO3 = 100.09/24.305 ≈ 4.118
    expect(gh).toBeCloseTo(40 * (100.09 / 40.078) + 10 * (100.09 / 24.305), 3);
    // HCO3_TO_CACO3 = 50.045/61.017 ≈ 0.8202
    expect(kh).toBeCloseTo(61 * (50.045 / 61.017), 3);
    // TDS is sum of all contributing ions (missing ones treated as 0 via `|| 0`)
    expect(tds).toBe(40 + 10 + 61);
  });

  test("missing ion fields default to 0 via `|| 0`", () => {
    const { gh, kh, tds } = metrics.calculateMetrics({});
    expect(gh).toBe(0);
    expect(kh).toBe(0);
    expect(tds).toBe(0);
  });
});

describe("calculateSo4ClRatio", () => {
  test("returns sulfate / chloride for positive values", () => {
    expect(metrics.calculateSo4ClRatio({ sulfate: 100, chloride: 50 })).toBe(2);
    expect(metrics.calculateSo4ClRatio({ sulfate: 30, chloride: 60 })).toBe(0.5);
  });

  test("returns null on zero or negative chloride", () => {
    expect(metrics.calculateSo4ClRatio({ sulfate: 100, chloride: 0 })).toBeNull();
    expect(metrics.calculateSo4ClRatio({ sulfate: 100, chloride: -5 })).toBeNull();
  });

  test("returns null on non-finite or non-object input", () => {
    expect(metrics.calculateSo4ClRatio(null)).toBeNull();
    expect(metrics.calculateSo4ClRatio({ sulfate: "oops", chloride: 50 })).toBeNull();
    expect(metrics.calculateSo4ClRatio("not an object")).toBeNull();
  });
});

describe("toStableBicarbonateFromAlkalinity", () => {
  test("converts alkalinity-as-CaCO3 to bicarbonate when existing doesn't round-trip", () => {
    // 50 mg/L as CaCO3 × CACO3_TO_HCO3 (≈1.2193) ≈ 60.96 → rounded to 61.0
    const result = metrics.toStableBicarbonateFromAlkalinity(50, 0);
    expect(result).toBeCloseTo(61.0, 1);
  });

  test("preserves existing bicarbonate when it already round-trips to the same alkalinity", () => {
    // If existing 61.0 mg/L HCO3 converts back to 50 mg/L CaCO3 exactly, keep it.
    const result = metrics.toStableBicarbonateFromAlkalinity(50, 61.0);
    expect(result).toBe(61.0);
  });

  test("falsy / non-numeric inputs treated as 0", () => {
    expect(metrics.toStableBicarbonateFromAlkalinity(0, 0)).toBe(0);
    expect(metrics.toStableBicarbonateFromAlkalinity(null, undefined)).toBe(0);
  });
});

describe("evaluateWaterProfileRanges — preset calibration", () => {
  // These cases pin the calibration: known recipes (SCA, RPavlis, Cafelytic
  // Filter) must produce the expected severity profile. SCA and Cafelytic
  // Filter sit cleanly within bands; RPavlis is an extreme recipe and must
  // fire warn-tier findings (low GH/Ca/Mg) that explain why the water is
  // unusual — never danger. No band finding may emit `info` (info tier was
  // removed for credibility).
  const noSources = { alkalinitySources: [], calciumSource: null, magnesiumSource: null };

  test("SCA Standard (Ca=51, Mg=17, alk≈40) produces zero findings", () => {
    const ions = { calcium: 51, magnesium: 17, bicarbonate: 48.77 };
    const { findings } = metrics.evaluateWaterProfileRanges(ions, noSources);
    expect(findings).toEqual([]);
  });

  test("RPavlis (no Ca/Mg/SO4, K=39) fires three warns and zero dangers", () => {
    const ions = { potassium: 39, bicarbonate: 60.9 };
    const { findings } = metrics.evaluateWaterProfileRanges(ions, noSources);
    const warns = findings.filter((f) => f.severity === "warn");
    expect(warns.map((f) => f.message)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^GH is too low/),
        expect.stringMatching(/^Calcium is too low/),
        expect.stringMatching(/^Magnesium is too low/),
      ]),
    );
    expect(warns).toHaveLength(3);
    expect(findings.filter((f) => f.severity === "danger")).toEqual([]);
  });

  test("Cafelytic Filter (Ca=7, Mg=18, KH=20) sits within all bands", () => {
    const ions = { calcium: 7, magnesium: 18, potassium: 16, chloride: 63, bicarbonate: 24.39 };
    const { findings } = metrics.evaluateWaterProfileRanges(ions, {
      alkalinitySources: ["potassium-bicarbonate"],
      calciumSource: "calcium-chloride",
      magnesiumSource: "magnesium-chloride",
    });
    expect(findings.filter((f) => f.severity === "danger")).toEqual([]);
    expect(findings.filter((f) => f.severity === "warn")).toEqual([]);
  });

  test("no preset emits an info-tier band finding (info tier removed)", () => {
    const samples = [
      { calcium: 51, magnesium: 17, bicarbonate: 48.77 }, // SCA
      { potassium: 39, bicarbonate: 60.9 }, // RPavlis
      { calcium: 7, magnesium: 18, potassium: 16, chloride: 63, bicarbonate: 24.39 }, // Cafelytic Filter
    ];
    for (const ions of samples) {
      const { findings } = metrics.evaluateWaterProfileRanges(ions, noSources);
      expect(findings.filter((f) => f.severity === "info")).toEqual([]);
    }
  });

  test("dangerous extremes still trigger danger (regression guard)", () => {
    // Very high TDS and potassium should still fire danger so the credibility
    // recalibration doesn't accidentally silence genuine over-mineralization.
    const ions = { calcium: 200, magnesium: 100, sodium: 100, potassium: 200, bicarbonate: 300 };
    const { findings } = metrics.evaluateWaterProfileRanges(ions, noSources);
    const dangers = findings.filter((f) => f.severity === "danger").map((f) => f.message);
    expect(dangers.some((m) => /^TDS/.test(m))).toBe(true);
    expect(dangers.some((m) => /^Potassium/.test(m))).toBe(true);
  });
});

describe("evaluateWaterProfileRanges — brew method dependent bands", () => {
  const sourceAwareOptions = {
    alkalinitySources: ["potassium-bicarbonate"],
    calciumSource: "calcium-chloride",
    magnesiumSource: "magnesium-chloride",
  };

  test("same ions can warn in filter mode but stay silent in espresso mode", () => {
    const ions = { calcium: 2, magnesium: 11, potassium: 9, chloride: 36, bicarbonate: 13.41 };
    const filterEval = metrics.evaluateWaterProfileRanges(ions, {
      ...sourceAwareOptions,
      brewMethod: "filter",
    });
    const espressoEval = metrics.evaluateWaterProfileRanges(ions, {
      ...sourceAwareOptions,
      brewMethod: "espresso",
    });
    expect(filterEval.findings.some((f) => /^Calcium is too low/.test(f.message))).toBe(true);
    expect(espressoEval.findings.some((f) => /^Calcium is too low/.test(f.message))).toBe(false);
  });

  test("missing/invalid brew method falls back to filter bands", () => {
    const ions = { calcium: 2, magnesium: 11, potassium: 9, chloride: 36, bicarbonate: 13.41 };
    const filterEval = metrics.evaluateWaterProfileRanges(ions, {
      ...sourceAwareOptions,
      brewMethod: "filter",
    });
    const invalidEval = metrics.evaluateWaterProfileRanges(ions, {
      ...sourceAwareOptions,
      brewMethod: "not-a-mode",
    });
    expect(invalidEval.findings).toEqual(filterEval.findings);
  });

  test("high KH warns in filter mode but triggers danger in espresso mode (scale risk)", () => {
    // KH ≈ 160 mg/L as CaCO3 (bicarbonate 195 × 0.8202).
    // Filter dangerMax=200 / warnMax=130 → warn only.
    // Espresso dangerMax=150 / warnMax=100 → danger (scale risk to boiler).
    // Ca=35, Mg=5 keeps GH and ion findings out of the way.
    const ions = { calcium: 35, magnesium: 5, bicarbonate: 195 };
    const noSources = { alkalinitySources: [], calciumSource: null, magnesiumSource: null };
    const filterEval = metrics.evaluateWaterProfileRanges(ions, {
      ...noSources,
      brewMethod: "filter",
    });
    const espressoEval = metrics.evaluateWaterProfileRanges(ions, {
      ...noSources,
      brewMethod: "espresso",
    });
    const filterKh = filterEval.findings.find((f) => /^KH is too high/.test(f.message));
    const espressoKh = espressoEval.findings.find((f) => /^KH is too high/.test(f.message));
    expect(filterKh?.severity).toBe("warn");
    expect(espressoKh?.severity).toBe("danger");
  });

  test("high GH triggers danger in espresso but only warn in filter (scale risk)", () => {
    // GH ≈ 277 mg/L as CaCO3 (Ca 70×2.497 + Mg 25×4.118).
    // Filter dangerMax=300 / warnMax=250 → warn only.
    // Espresso dangerMax=260 / warnMax=240 → danger.
    const ions = { calcium: 70, magnesium: 25, bicarbonate: 48.77 };
    const noSources = { alkalinitySources: [], calciumSource: null, magnesiumSource: null };
    const filterEval = metrics.evaluateWaterProfileRanges(ions, {
      ...noSources,
      brewMethod: "filter",
    });
    const espressoEval = metrics.evaluateWaterProfileRanges(ions, {
      ...noSources,
      brewMethod: "espresso",
    });
    const filterGh = filterEval.findings.find((f) => /^GH is too high/.test(f.message));
    const espressoGh = espressoEval.findings.find((f) => /^GH is too high/.test(f.message));
    expect(filterGh?.severity).toBe("warn");
    expect(espressoGh?.severity).toBe("danger");
  });
});

describe("MINERAL_DB integrity (constants.js sanity)", () => {
  test("every mineral has positive MW and at least one ion fraction in (0, 1]", () => {
    // Regression guard: if someone adds a mineral with mw=0, ion fractions become
    // NaN/Infinity and the calculator silently produces bad water.
    for (const [id, mineral] of Object.entries(globalThis.MINERAL_DB)) {
      expect(mineral.mw, `${id}.mw`).toBeGreaterThan(0);
      const fractions = Object.values(mineral.ions);
      expect(fractions.length, `${id} should declare at least one ion`).toBeGreaterThan(0);
      for (const f of fractions) {
        expect(f, `${id} fractions in (0, 1]`).toBeGreaterThan(0);
        expect(f).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// splitAlkalinityDelta — pure: caller passes the alkalinitySources array, so
// no storage stubs needed.
// ---------------------------------------------------------------------------

describe("splitAlkalinityDelta", () => {
  test("empty sources → empty object", () => {
    expect(metrics.splitAlkalinityDelta([], 50, null, null)).toEqual({});
  });

  test("single source 'baking-soda' → full delta assigned to baking-soda", () => {
    const result = metrics.splitAlkalinityDelta(["baking-soda"], 40, null, null);
    expect(result).toEqual({ "baking-soda": 40 });
  });

  test("single source 'potassium-bicarbonate' → full delta assigned to that source", () => {
    const result = metrics.splitAlkalinityDelta(["potassium-bicarbonate"], 40, null, null);
    expect(result).toEqual({ "potassium-bicarbonate": 40 });
  });

  test("both sources, target has only sodium → all delta to baking-soda", () => {
    const result = metrics.splitAlkalinityDelta(
      ["baking-soda", "potassium-bicarbonate"],
      30,
      { sodium: 0, potassium: 0 },
      { sodium: 20, potassium: 0 },
    );
    expect(result["baking-soda"]).toBe(30);
    expect(result["potassium-bicarbonate"]).toBeUndefined();
  });

  test("both sources, target has only potassium → all delta to potassium-bicarbonate", () => {
    const result = metrics.splitAlkalinityDelta(
      ["baking-soda", "potassium-bicarbonate"],
      30,
      { sodium: 0, potassium: 0 },
      { sodium: 0, potassium: 20 },
    );
    expect(result["potassium-bicarbonate"]).toBe(30);
    expect(result["baking-soda"]).toBeUndefined();
  });

  test("both sources, both Na and K positive → split proportional to deltas", () => {
    // deltaNa = 30 - 0 = 30, deltaK = 10 - 0 = 10, total = 40.
    // baking-soda gets 100 * 30/40 = 75, potassium-bicarbonate gets 100 * 10/40 = 25.
    const result = metrics.splitAlkalinityDelta(
      ["baking-soda", "potassium-bicarbonate"],
      100,
      { sodium: 0, potassium: 0 },
      { sodium: 30, potassium: 10 },
    );
    expect(result["baking-soda"]).toBeCloseTo(75, 5);
    expect(result["potassium-bicarbonate"]).toBeCloseTo(25, 5);
  });

  test("both sources, target Na/K both absent or zero → fallback to potassium-bicarbonate", () => {
    // The 'K-driven or both 0' branch at metrics.js:441-442.
    const result = metrics.splitAlkalinityDelta(
      ["baking-soda", "potassium-bicarbonate"],
      50,
      null,
      null,
    );
    expect(result).toEqual({ "potassium-bicarbonate": 50 });
  });

  test("source water Na/K subtract from target before splitting", () => {
    // targetNa=30, sourceNa=10 → deltaNa=20; targetK=20, sourceK=20 → deltaK=0.
    // deltaK is 0, so all the alk goes to baking-soda.
    const result = metrics.splitAlkalinityDelta(
      ["baking-soda", "potassium-bicarbonate"],
      40,
      { sodium: 10, potassium: 20 },
      { sodium: 30, potassium: 20 },
    );
    expect(result["baking-soda"]).toBe(40);
    expect(result["potassium-bicarbonate"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildStoredTargetProfile — pure when options.brewMethod is passed
// explicitly. The brewMethod-fallback branch (loadBrewMethod) is covered
// in metrics-storage.test.js.
// ---------------------------------------------------------------------------

describe("buildStoredTargetProfile", () => {
  test("ion round-trip with rounding and missing fields defaulted to 0", () => {
    const profile = metrics.buildStoredTargetProfile(
      "Test",
      { calcium: "51.4", magnesium: 17, bicarbonate: "48.77" },
      "Test desc",
      { brewMethod: "filter", alkalinity: 40 },
    );
    expect(profile.label).toBe("Test");
    expect(profile.calcium).toBe(51);
    expect(profile.magnesium).toBe(17);
    expect(profile.bicarbonate).toBe(49);
    expect(profile.alkalinity).toBe(40);
    // Missing ions default to 0.
    expect(profile.potassium).toBe(0);
    expect(profile.sodium).toBe(0);
    expect(profile.sulfate).toBe(0);
    expect(profile.chloride).toBe(0);
    expect(profile.description).toBe("Test desc");
    expect(profile.brewMethod).toBe("filter");
  });

  test("options.brewMethod 'espresso' is preserved", () => {
    const profile = metrics.buildStoredTargetProfile(
      "Espresso",
      { calcium: 50, magnesium: 20, bicarbonate: 60 },
      "",
      { brewMethod: "espresso", alkalinity: 50 },
    );
    expect(profile.brewMethod).toBe("espresso");
  });

  test("options.brewMethod 'filter' is preserved", () => {
    const profile = metrics.buildStoredTargetProfile(
      "Filter",
      { calcium: 50, magnesium: 20, bicarbonate: 60 },
      "",
      { brewMethod: "filter", alkalinity: 50 },
    );
    expect(profile.brewMethod).toBe("filter");
  });

  test("options.alkalinity passed → used verbatim (rounded)", () => {
    const profile = metrics.buildStoredTargetProfile(
      "X",
      { calcium: 0, magnesium: 0, bicarbonate: 100 },
      null,
      { brewMethod: "filter", alkalinity: 87.3 },
    );
    expect(profile.alkalinity).toBe(87);
  });

  test("options.alkalinity absent → derived from calculateMetrics.kh", () => {
    // 61 mg/L HCO3 × HCO3_TO_CACO3 (≈0.8202) ≈ 50.03 → rounds to 50.
    const profile = metrics.buildStoredTargetProfile(
      "X",
      { calcium: 0, magnesium: 0, bicarbonate: 61 },
      "",
      { brewMethod: "filter" },
    );
    expect(profile.alkalinity).toBe(50);
  });

  test("null description coerces to ''", () => {
    const profile = metrics.buildStoredTargetProfile(
      "X",
      { calcium: 10, magnesium: 5, bicarbonate: 12 },
      null,
      { brewMethod: "filter", alkalinity: 10 },
    );
    expect(profile.description).toBe("");
  });

  test("label passes through verbatim", () => {
    const profile = metrics.buildStoredTargetProfile(
      "My Custom Label",
      { calcium: 10, magnesium: 5, bicarbonate: 12 },
      "",
      { brewMethod: "filter", alkalinity: 10 },
    );
    expect(profile.label).toBe("My Custom Label");
  });
});

describe("getRecipeOverLimitMineralIds", () => {
  test("empty input → []", () => {
    expect(metrics.getRecipeOverLimitMineralIds({})).toEqual([]);
  });

  test("null / undefined / non-object input → []", () => {
    expect(metrics.getRecipeOverLimitMineralIds(null)).toEqual([]);
    expect(metrics.getRecipeOverLimitMineralIds(undefined)).toEqual([]);
    expect(metrics.getRecipeOverLimitMineralIds(42)).toEqual([]);
  });

  test("all minerals below their solubility caps → []", () => {
    // Caps: baking-soda 96, calcium-chloride 700, gypsum 2. All inputs well under.
    expect(
      metrics.getRecipeOverLimitMineralIds({
        "baking-soda": 0.5,
        "calcium-chloride": 1,
        gypsum: 0.5,
      }),
    ).toEqual([]);
  });

  test("flags any mineral whose g/L meets or exceeds its cap", () => {
    // gypsum cap is 2 g/L; 2.5 exceeds. baking-soda cap is 96; 50 is under.
    const over = metrics.getRecipeOverLimitMineralIds({
      gypsum: 2.5,
      "baking-soda": 50,
    });
    expect(over).toEqual(["gypsum"]);
  });

  test("multiple over-limit minerals are all returned", () => {
    const over = metrics.getRecipeOverLimitMineralIds({
      gypsum: 10,
      "baking-soda": 200,
      "calcium-chloride": 1,
    });
    expect(over.sort()).toEqual(["baking-soda", "gypsum"]);
  });

  test("unknown mineral id (no solubility entry) is ignored", () => {
    expect(metrics.getRecipeOverLimitMineralIds({ "not-a-real-mineral": 9999 })).toEqual([]);
  });

  test("zero or negative g/L values are ignored", () => {
    expect(
      metrics.getRecipeOverLimitMineralIds({
        gypsum: 0,
        "baking-soda": -5,
      }),
    ).toEqual([]);
  });
});

describe("solveNNLS", () => {
  test("identity 1×1 — trivial scaling", () => {
    // 2 * x = 6 → x = 3
    const x = metrics.solveNNLS([[2]], [6]);
    expect(x[0]).toBeCloseTo(3, 6);
  });

  test("over-determined, exact fit — solves to zero residual", () => {
    // x1 + x2 = 3, 2x1 - x2 = 0 → x1 = 1, x2 = 2.
    const x = metrics.solveNNLS(
      [
        [1, 1],
        [2, -1],
      ],
      [3, 0],
    );
    expect(x[0]).toBeCloseTo(1, 6);
    expect(x[1]).toBeCloseTo(2, 6);
  });

  test("returns non-negative solution — clamps a would-be negative", () => {
    // Unconstrained LS to fit b=[1,-1] with A=[[1,0],[0,1]] would be x=[1,-1].
    // NNLS must clamp the second component to 0 and refit x1, giving x=[1,0].
    const x = metrics.solveNNLS(
      [
        [1, 0],
        [0, 1],
      ],
      [1, -1],
    );
    expect(x[0]).toBeCloseTo(1, 6);
    expect(x[1]).toBe(0);
  });

  test("empty A returns empty x", () => {
    expect(metrics.solveNNLS([], [])).toEqual([]);
  });

  test("infeasible target — residual remains positive, no negative entries", () => {
    // Single column [1, 1]; b=[2, 0]. Best non-negative scaling is x≈[1].
    const x = metrics.solveNNLS([[1], [1]], [2, 0]);
    expect(x[0]).toBeGreaterThanOrEqual(0);
    expect(x[0]).toBeCloseTo(1, 6);
  });
});

describe("solveCalculatorDosing", () => {
  const distilled = {
    calcium: 0,
    magnesium: 0,
    potassium: 0,
    sodium: 0,
    sulfate: 0,
    chloride: 0,
    bicarbonate: 0,
  };

  // Synthetic single-mineral "unit concentrate" for testing — pick bottleMl
  // and grams so each gram of dispensed concentrate equals one gram of the
  // underlying salt in brew water. From computeStockMineralGramsPerL:
  //   g/L of mineral = (grams / bottleMl) * doseGramsPerL
  // So bottleMl=1, grams=1, doseGramsPerL=1 makes the math 1:1 — solver
  // expectations can be reasoned about as if the concentrate were the raw
  // mineral salt. Not a realistic concentrate (a 1 mL bottle is absurd) —
  // strictly a test fixture for clean unit-dose math.
  function unitCaConcentrate() {
    return {
      bottleMl: 1,
      doseGramsPerL: 1,
      minerals: [{ mineralId: "calcium-chloride", grams: 1 }],
    };
  }

  test("no concentrates and no minerals → zero doses, residual = target", () => {
    const result = metrics.solveCalculatorDosing(distilled, { calcium: 50 }, [], []);
    expect(result.concentrateGramsPerL).toEqual({});
    expect(result.mineralGramsPerL).toEqual({});
    expect(result.residualIons.calcium).toBeCloseTo(50, 6);
  });

  test("single concentrate is scaled by the solver — Ca target with matching Cl", () => {
    // 1 g/L of CaCl2 contributes ~272.7 mg/L Ca and ~482.6 mg/L Cl. With a
    // target that includes the Cl that CaCl2 produces (no overshoot penalty),
    // the solver picks x ≈ 50 / 272.7 ≈ 0.183 g/L to hit Ca exactly. This is
    // the "best case" where the target ion ratio matches the source's.
    const result = metrics.solveCalculatorDosing(
      distilled,
      { calcium: 50, chloride: 88.5 },
      [{ id: "stock:test", spec: unitCaConcentrate() }],
      [],
    );
    expect(result.concentrateGramsPerL["stock:test"]).toBeGreaterThan(0.15);
    expect(result.concentrateGramsPerL["stock:test"]).toBeLessThan(0.25);
    expect(Math.abs(result.residualIons.calcium)).toBeLessThan(1);
  });

  test("squared-error compromise when target ignores a side-ion", () => {
    // Target only specifies Ca; Cl is implicitly 0. Solver minimizes
    // ||A·x - b||² across all 7 ions, so dosing CaCl2 to hit Ca exactly
    // would incur a huge Cl-overshoot penalty. The optimal x balances the
    // two: x = (50·272.7) / (272.7² + 482.6²) ≈ 0.044 g/L.
    const result = metrics.solveCalculatorDosing(
      distilled,
      { calcium: 50 },
      [],
      ["calcium-chloride"],
    );
    expect(result.mineralGramsPerL["calcium-chloride"]).toBeGreaterThan(0.02);
    expect(result.mineralGramsPerL["calcium-chloride"]).toBeLessThan(0.07);
  });

  test("doses are never negative", () => {
    // Source already over target on Ca — solver should pick zero dose
    // rather than negative.
    const result = metrics.solveCalculatorDosing(
      { ...distilled, calcium: 100 },
      { calcium: 50 },
      [],
      ["calcium-chloride"],
    );
    expect(result.mineralGramsPerL["calcium-chloride"]).toBeGreaterThanOrEqual(0);
  });

  test("identifies the largest residual ion", () => {
    // No dosing options; residual = target. Largest residual is whichever
    // ion has the biggest target value.
    const result = metrics.solveCalculatorDosing(
      distilled,
      { calcium: 50, magnesium: 100 },
      [],
      [],
    );
    expect(result.maxResidualIon).not.toBeNull();
    expect(result.maxResidualIon.ion).toBe("magnesium");
    expect(result.maxResidualIon.residual).toBeCloseTo(100, 6);
  });
});
