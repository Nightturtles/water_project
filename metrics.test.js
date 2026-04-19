// Unit tests for metrics.js pure functions.
// describe/expect/test are injected via vitest globals: true.
// Load order mirrors the browser: constants.js populates globalThis first,
// then metrics.js can resolve MINERAL_DB, CA_TO_CACO3, etc. via global scope.
require("./constants.js");
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
