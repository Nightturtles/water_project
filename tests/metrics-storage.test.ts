// Unit tests for src/lib/metrics.ts functions that read from storage (and
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
//
// Browser-global stubs (window, localStorage, isLoggedInSync, ...) come from
// vitest.setup.js; they're installed before these imports execute, which
// matters because storage.ts (imported directly and via metrics) touches
// localStorage at module-eval time.
import { describe, test, expect, beforeEach } from "vitest";
import {
  saveSelectedMinerals,
  saveSelectedConcentrates,
  saveDiyConcentrateSpecs,
  getEffectiveCalciumSources,
} from "../src/lib/storage";
import { MINERAL_DB } from "../src/lib/constants";
import * as metrics from "../src/lib/metrics";

const g: any = global;

function resetState() {
  g.localStorage.clear();
  g.sessionStorage.clear();
  // saveSelectedMinerals also clears the internal selectedMineralsCache.
  // Resetting to the 4-mineral default that loadSelectedMinerals would
  // return for an empty store keeps each test starting from the same
  // canonical baseline.
  saveSelectedMinerals(["calcium-chloride", "epsom-salt", "baking-soda", "potassium-bicarbonate"]);
  // Same for the selected-concentrates cache, so a concentrate enabled in one
  // test can't leak into the next.
  saveSelectedConcentrates([]);
  saveDiyConcentrateSpecs({});
}

beforeEach(resetState);

// ---------------------------------------------------------------------------
// getEffectiveCalciumSources — which calcium-chloride form fills the slot
// ---------------------------------------------------------------------------

describe("getEffectiveCalciumSources: calcium-chloride form", () => {
  test("dihydrate powder only → dihydrate", () => {
    expect(getEffectiveCalciumSources()).toEqual(["calcium-chloride"]);
  });

  test("dihydrate powder + anhydrous DIY concentrate → the concentrate's anhydrous form", () => {
    // Previously the dihydrate always won, so the anhydrous concentrate the
    // user enabled was never dosed (its calculator row didn't render).
    saveDiyConcentrateSpecs({
      "calcium-chloride-anhydrous": { bottleMl: 100, gramsPerBottle: 20 },
    });
    saveSelectedConcentrates(["diy:calcium-chloride-anhydrous"]);
    expect(getEffectiveCalciumSources()).toEqual(["calcium-chloride-anhydrous"]);
  });

  test("an anhydrous concentrate not configured yet leaves the dihydrate powder in the slot", () => {
    // Ticked before its bottle mL and grams are set, it can't dose anything;
    // taking the slot then meant no calcium at all.
    saveSelectedConcentrates(["diy:calcium-chloride-anhydrous"]);
    expect(getEffectiveCalciumSources()).toEqual(["calcium-chloride"]);
  });

  test("both forms as powders (no concentrate) → dihydrate, as before", () => {
    saveSelectedMinerals(["calcium-chloride", "calcium-chloride-anhydrous", "epsom-salt"]);
    expect(getEffectiveCalciumSources()).toEqual(["calcium-chloride"]);
  });

  test("concentrates in both forms → dihydrate, as before", () => {
    saveSelectedConcentrates(["diy:calcium-chloride-anhydrous", "diy:calcium-chloride"]);
    expect(getEffectiveCalciumSources()).toEqual(["calcium-chloride"]);
  });
});

// A Recipe Concentrate is mixed from powders, so the derived formula follows
// the calcium-chloride powder the user has, even when an enabled concentrate
// of the other form fills the calculator's calcium slot. Following the
// concentrate gave anhydrous grams, ~25% light for someone weighing dihydrate.
describe("deriveStockFormulaFromTarget: calcium-chloride form", () => {
  const target = { calcium: 40, magnesium: 10, alkalinity: 30 };
  const caIds = () =>
    metrics
      .deriveStockFormulaFromTarget(target)
      .minerals.map((m) => m.mineralId)
      .filter((id) => id.startsWith("calcium-chloride"));

  test("dihydrate powder + anhydrous concentrate → dihydrate grams", () => {
    saveSelectedConcentrates(["diy:calcium-chloride-anhydrous"]);
    expect(caIds()).toEqual(["calcium-chloride"]);
  });

  test("anhydrous powder only → anhydrous grams", () => {
    saveSelectedMinerals(["calcium-chloride-anhydrous", "epsom-salt", "baking-soda"]);
    expect(caIds()).toEqual(["calcium-chloride-anhydrous"]);
  });
});

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
    // "epsom-salt" fallback in pickBestCaMgSources' no-candidates branch.
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

  test("only anhydrous CaCl2 selected → picks anhydrous as the calcium source", () => {
    saveSelectedMinerals(["calcium-chloride-anhydrous", "epsom-salt", "baking-soda"]);
    const result = metrics.pickBestCaMgSources(
      { calcium: 0, magnesium: 0 },
      { chloride: 30, sulfate: 0 },
      40,
      10,
    );
    expect(result.caSource).toBe("calcium-chloride-anhydrous");
  });

  test("both CaCl2 forms selected → prefers the dihydrate (preserves prior behavior)", () => {
    saveSelectedMinerals([
      "calcium-chloride",
      "calcium-chloride-anhydrous",
      "epsom-salt",
      "baking-soda",
    ]);
    const result = metrics.pickBestCaMgSources(
      { calcium: 0, magnesium: 0 },
      { chloride: 30, sulfate: 0 },
      40,
      10,
    );
    expect(result.caSource).toBe("calcium-chloride");
  });
});

// ---------------------------------------------------------------------------
// deriveStockFormulaFromTarget — pure, but uses MINERAL_DB from constants.
// Calibration anchors are the Coffee ad Astra ground-truth recipes (seeded in
// supabase/migrations/20260506231724_add_coffee_ad_astra_recipes.sql).
// ---------------------------------------------------------------------------

describe("deriveStockFormulaFromTarget", () => {
  // Helper: each Coffee ad Astra recipe specifies grams of each mineral in a
  // 200-mL stock dosed at 4 g/L (16 g into 4 L brew water). Per-L brew
  // water grams = recipe_g / 50. Resulting brew ions = calculateIonPPMs of
  // those per-L grams. The fixture lets us go (recipe → ions) once, then
  // (ions → derived formula) and assert what minerals the heuristic picks.
  function ionsFromRecipeGrams(recipeGrams: Record<string, number>) {
    const perLGrams: Record<string, number> = {};
    for (const [id, grams] of Object.entries(recipeGrams)) {
      perLGrams[id] = grams / 50;
    }
    return metrics.calculateIonPPMs(perLGrams);
  }

  function mineralIdsOf(formula: any) {
    return formula.minerals.map((m: any) => m.mineralId).sort();
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
    const nan = metrics.deriveStockFormulaFromTarget(
      {},
      { bottleMl: "bad" as unknown as number, doseGramsPerL: NaN },
    );
    expect(nan.bottleMl).toBe(200);
    expect(nan.doseGramsPerL).toBe(4);
  });

  test("calciumChlorideId option → anhydrous CaCl2 needs ~25% less mass than the dihydrate", () => {
    const target = { calcium: 40 };
    const dihydrate = metrics.deriveStockFormulaFromTarget(target, {
      calciumChlorideId: "calcium-chloride",
    });
    const anhydrous = metrics.deriveStockFormulaFromTarget(target, {
      calciumChlorideId: "calcium-chloride-anhydrous",
    });
    const dCa = dihydrate.minerals.find((m: any) => m.mineralId === "calcium-chloride");
    const aCa = anhydrous.minerals.find((m: any) => m.mineralId === "calcium-chloride-anhydrous");
    expect(dCa).toBeTruthy();
    expect(aCa).toBeTruthy();
    // Anhydrous is more concentrated: less mass for the same Ca, scaling by the
    // CaCl2 MW ratio (110.98 / 147.01 ≈ 0.755). Output grams are rounded, so
    // compare the ratio loosely rather than to full precision.
    expect(aCa!.grams).toBeLessThan(dCa!.grams);
    expect(aCa!.grams / dCa!.grams).toBeCloseTo(110.98 / 147.01, 1);
  });

  test("only anhydrous CaCl2 selected (no override) → derive uses anhydrous via effective source", () => {
    saveSelectedMinerals(["calcium-chloride-anhydrous", "epsom-salt", "baking-soda"]);
    const formula = metrics.deriveStockFormulaFromTarget({ calcium: 40 });
    expect(formula.minerals.some((m: any) => m.mineralId === "calcium-chloride-anhydrous")).toBe(
      true,
    );
    expect(formula.minerals.some((m: any) => m.mineralId === "calcium-chloride")).toBe(false);
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
    expect(formula.minerals.some((m: any) => m.mineralId === "epsom-salt")).toBe(false);
    expect(formula.minerals.some((m: any) => m.mineralId === "baking-soda")).toBe(false);
  });

  test("Matt Perger (epsom + baking soda) → derive picks epsom + baking soda", () => {
    const target = ionsFromRecipeGrams({
      "epsom-salt": 10,
      "baking-soda": 3.4,
    });
    const formula = metrics.deriveStockFormulaFromTarget(target);
    expect(mineralIdsOf(formula)).toEqual(["baking-soda", "epsom-salt"]);
  });

  function ionsMadeBy(formula: any) {
    const perLGrams: Record<string, number> = {};
    formula.minerals.forEach((m: any) => {
      perLGrams[m.mineralId] = (m.grams / formula.bottleMl) * formula.doseGramsPerL;
    });
    return metrics.calculateIonPPMs(perLGrams);
  }

  test("Rao/Perger (epsom AND MgCl2 in the original bottle) → derive recovers the bottle", () => {
    const bottle = {
      "epsom-salt": 5,
      "magnesium-chloride": 2,
      "calcium-chloride": 2,
      "baking-soda": 1.7,
      "potassium-bicarbonate": 2,
    };
    const target = ionsFromRecipeGrams(bottle);
    const formula = metrics.deriveStockFormulaFromTarget(target);
    // The recipe names both sulfate and chloride, so the magnesium is split
    // between the two salts. Picking one salt by the SO4/Cl ratio used to put
    // it all on epsom: sulfate 58 for a recipe at 39, chloride 19 for 33.
    const derived = Object.fromEntries(formula.minerals.map((m: any) => [m.mineralId, m.grams]));
    expect(derived).toEqual(bottle);
    const reIons = ionsMadeBy(formula);
    for (const ion of ["calcium", "magnesium", "sulfate", "chloride", "sodium", "potassium"]) {
      expect(reIons[ion as "calcium"]).toBeCloseTo(target[ion as "calcium"], 0);
    }
    expect(formula.notes).toEqual([]);
  });

  test("a recipe with both sulfate and chloride gets both: Cafelytic Filter 2.0", () => {
    const target = {
      calcium: 4,
      magnesium: 11,
      alkalinity: 11,
      potassium: 9,
      sodium: 0,
      sulfate: 16,
      chloride: 26,
      bicarbonate: 13,
    };
    const formula = metrics.deriveStockFormulaFromTarget(target, {
      calciumChlorideId: "calcium-chloride",
    });
    expect(mineralIdsOf(formula)).toEqual(
      [
        "calcium-chloride",
        "epsom-salt",
        "magnesium-chloride",
        "potassium-bicarbonate",
        "potassium-chloride",
      ].sort(),
    );
    const made = ionsMadeBy(formula);
    // Was sulfate 0 / chloride 40 when all the magnesium rode on MgCl2.
    expect(Math.abs(made.sulfate - 16)).toBeLessThan(1.5);
    expect(Math.abs(made.chloride - 26)).toBeLessThan(1.5);
    expect(made.magnesium).toBeCloseTo(11, 0);
    expect(made.calcium).toBeCloseTo(4, 0);
  });

  test("the magnesium split is clamped: a recipe wanting more sulfate than its magnesium can carry", () => {
    const formula = metrics.deriveStockFormulaFromTarget(
      { calcium: 20, magnesium: 5, sulfate: 80, chloride: 10 },
      { calciumChlorideId: "calcium-chloride" },
    );
    // All magnesium on epsom (5 mg/L carries about 20 mg/L sulfate), none on
    // MgCl2, and the shortfall is reported.
    expect(mineralIdsOf(formula)).toEqual(["calcium-chloride", "epsom-salt"]);
    expect(formula.notes.some((n: string) => /Target sulfate of 80/.test(n))).toBe(true);
  });

  test("a split within 2% of a single salt uses the single salt", () => {
    // Chloride far above what the calcium salt brings and a trace of sulfate:
    // the fit puts under 2% of the magnesium on epsom, which is dropped.
    const formula = metrics.deriveStockFormulaFromTarget(
      { calcium: 10, magnesium: 20, sulfate: 0.5, chloride: 76 },
      { calciumChlorideId: "calcium-chloride" },
    );
    expect(mineralIdsOf(formula)).toEqual(["calcium-chloride", "magnesium-chloride"]);
  });

  test("recipes naming only one of sulfate / chloride keep a single magnesium salt", () => {
    const sulfateOnly = metrics.deriveStockFormulaFromTarget({ magnesium: 10, sulfate: 40 });
    expect(mineralIdsOf(sulfateOnly)).toEqual(["epsom-salt"]);
    const chlorideOnly = metrics.deriveStockFormulaFromTarget({ magnesium: 10, chloride: 29 });
    expect(mineralIdsOf(chlorideOnly)).toEqual(["magnesium-chloride"]);
    // Spec-style (neither named): epsom, so chloride comes only from the calcium salt.
    const neither = metrics.deriveStockFormulaFromTarget(
      { calcium: 51, magnesium: 17, alkalinity: 40 },
      { calciumChlorideId: "calcium-chloride" },
    );
    expect(mineralIdsOf(neither)).toEqual(
      ["calcium-chloride", "epsom-salt", "potassium-bicarbonate"].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// computeFullProfile
// ---------------------------------------------------------------------------

describe("computeFullProfile", () => {
  test("all 7 ions explicit → ignores source water, returns rounded ions verbatim", () => {
    // computeFullProfile's hasExplicitIons branch.
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
    g.localStorage.setItem("cw_brew_method", "espresso");
    const profile = metrics.buildStoredTargetProfile(
      "X",
      { calcium: 10, magnesium: 5, bicarbonate: 12 },
      "",
      { alkalinity: 10 },
    );
    expect(profile.brewMethod).toBe("espresso");
  });

  test("options.brewMethod 'invalid-mode' + cw_brew_method='espresso' → falls through to loadBrewMethod", () => {
    // buildStoredTargetProfile only recognizes 'espresso' or 'filter' on
    // options; everything else falls through to loadBrewMethod().
    g.localStorage.setItem("cw_brew_method", "espresso");
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

// ---------------------------------------------------------------------------
// allocateCaMgDoses — SO4/Cl blend allocation (reads mineral selection from
// storage like pickBestCaMgSources)
// ---------------------------------------------------------------------------

describe("allocateCaMgDoses", () => {
  const DISTILLED = { calcium: 0, magnesium: 0, sulfate: 0, chloride: 0 };

  function addedIons(allocation: { gramsPerL: Record<string, number> }) {
    return metrics.calculateIonPPMs(allocation.gramsPerL);
  }

  test("κ invariant: SO4-vs-Cl mass trade is identical for the Mg and Ca salt pairs", () => {
    // The closed-form 1-D solve relies on every divalent cation pairing with
    // one SO4²⁻ or two Cl⁻, making sulfate-per-chloride-displaced a single
    // constant. Guards MINERAL_DB edits that would break that reduction.
    const kMg =
      MINERAL_DB["epsom-salt"]!.ions.sulfate! /
      MINERAL_DB["epsom-salt"]!.ions.magnesium! /
      (MINERAL_DB["magnesium-chloride"]!.ions.chloride! /
        MINERAL_DB["magnesium-chloride"]!.ions.magnesium!);
    const kCa =
      MINERAL_DB["gypsum"]!.ions.sulfate! /
      MINERAL_DB["gypsum"]!.ions.calcium! /
      (MINERAL_DB["calcium-chloride"]!.ions.chloride! /
        MINERAL_DB["calcium-chloride"]!.ions.calcium!);
    expect(kMg).toBeCloseTo(kCa, 6);
  });

  test("balanced profile (SO4 8 / Cl 29), no gypsum → splits Mg across epsom + MgCl2", () => {
    // The motivating regression: a saved recipe of epsom + MgCl2 whose ratio
    // (0.28) is unreachable by any single Mg salt. Expect Mg ≈ 2.19 mg/L via
    // epsom and ≈ 7.81 via MgCl2, landing added SO4/Cl at ≈ (8.64, 29.87).
    saveSelectedMinerals(["calcium-chloride", "epsom-salt", "magnesium-chloride", "baking-soda"]);
    const result = metrics.allocateCaMgDoses(DISTILLED, { sulfate: 8, chloride: 29 }, 4, 10);
    expect(result.blended).toBe(true);
    expect(result.gramsPerL["epsom-salt"]).toBeCloseTo(0.02218, 4);
    expect(result.gramsPerL["magnesium-chloride"]).toBeCloseTo(0.06535, 4);
    expect(result.gramsPerL["calcium-chloride"]).toBeCloseTo(0.01467, 4);
    const ions = addedIons(result);
    expect(ions.calcium).toBeCloseTo(4, 2);
    expect(ions.magnesium).toBeCloseTo(10, 2);
    expect(ions.sulfate).toBeCloseTo(8.64, 1);
    expect(ions.chloride).toBeCloseTo(29.87, 1);
    // MgCl2 carries the larger share → dominant source for range bands.
    expect(result.mgSource).toBe("magnesium-chloride");
    expect(result.caSource).toBe("calcium-chloride");
  });

  test("SCA-scale zeros target with all four salts → snaps to the classic epsom + CaCl2", () => {
    // Legacy-compat: the unconstrained optimum leaves 0.6% of Mg on MgCl2;
    // the 2% snap collapses it so Ca 51 / Mg 17 profiles keep the classic
    // single-salt dose from pickBestCaMgSources.
    saveSelectedMinerals([
      "calcium-chloride",
      "gypsum",
      "epsom-salt",
      "magnesium-chloride",
      "baking-soda",
    ]);
    const result = metrics.allocateCaMgDoses(DISTILLED, { sulfate: 0, chloride: 0 }, 51, 17);
    expect(result.blended).toBe(false);
    expect(result.gramsPerL["magnesium-chloride"]).toBeUndefined();
    expect(result.gramsPerL["gypsum"]).toBeUndefined();
    const ions = addedIons(result);
    expect(ions.calcium).toBeCloseTo(51, 2);
    expect(ions.magnesium).toBeCloseTo(17, 2);
    expect(result.caSource).toBe("calcium-chloride");
    expect(result.mgSource).toBe("epsom-salt");
  });

  test("sulfate-heavy target (SO4 40 / Cl 7) → all Mg on epsom", () => {
    saveSelectedMinerals(["calcium-chloride", "epsom-salt", "magnesium-chloride", "baking-soda"]);
    const result = metrics.allocateCaMgDoses(DISTILLED, { sulfate: 40, chloride: 7 }, 4, 10);
    expect(result.blended).toBe(false);
    expect(result.gramsPerL["magnesium-chloride"]).toBeUndefined();
    const ions = addedIons(result);
    expect(ions.sulfate).toBeCloseTo(39.52, 1);
    expect(ions.chloride).toBeCloseTo(7.08, 1);
    expect(result.mgSource).toBe("epsom-salt");
  });

  test("chloride-heavy target (SO4 0 / Cl 140) at SCA deltas → all MgCl2 + CaCl2", () => {
    saveSelectedMinerals([
      "calcium-chloride",
      "gypsum",
      "epsom-salt",
      "magnesium-chloride",
      "baking-soda",
    ]);
    const result = metrics.allocateCaMgDoses(DISTILLED, { sulfate: 0, chloride: 140 }, 51, 17);
    expect(result.blended).toBe(false);
    expect(result.gramsPerL["epsom-salt"]).toBeUndefined();
    expect(result.gramsPerL["gypsum"]).toBeUndefined();
    const ions = addedIons(result);
    expect(ions.chloride).toBeCloseTo(139.82, 1);
    expect(ions.sulfate).toBeCloseTo(0, 2);
    expect(result.mgSource).toBe("magnesium-chloride");
  });

  test("single enabled salt per slot ignores SO4/Cl targets entirely", () => {
    // resetState default: calcium-chloride + epsom-salt only. Even a target
    // demanding all-chloride water cannot move the dose off the enabled salts.
    const result = metrics.allocateCaMgDoses(DISTILLED, { sulfate: 0, chloride: 200 }, 4, 10);
    expect(result.blended).toBe(false);
    expect(result.gramsPerL["epsom-salt"]).toBeGreaterThan(0);
    expect(result.gramsPerL["calcium-chloride"]).toBeGreaterThan(0);
    expect(result.gramsPerL["magnesium-chloride"]).toBeUndefined();
    const ions = addedIons(result);
    expect(ions.magnesium).toBeCloseTo(10, 2);
    expect(ions.calcium).toBeCloseTo(4, 2);
  });

  test("unreachably high sulfate target clamps to full epsom + gypsum", () => {
    saveSelectedMinerals([
      "calcium-chloride",
      "gypsum",
      "epsom-salt",
      "magnesium-chloride",
      "baking-soda",
    ]);
    const result = metrics.allocateCaMgDoses(DISTILLED, { sulfate: 300, chloride: 0 }, 4, 10);
    expect(result.blended).toBe(false);
    expect(result.gramsPerL["magnesium-chloride"]).toBeUndefined();
    expect(result.gramsPerL["calcium-chloride"]).toBeUndefined();
    expect(result.gramsPerL["gypsum"]).toBeCloseTo(0.01718, 4);
    const ions = addedIons(result);
    expect(ions.sulfate).toBeCloseTo(49.11, 1);
    expect(ions.chloride).toBeCloseTo(0, 2);
    expect(result.caSource).toBe("gypsum");
  });

  test("zero deltas → no doses, but dominant sources fall back like pickBestCaMgSources", () => {
    const result = metrics.allocateCaMgDoses(DISTILLED, { sulfate: 8, chloride: 29 }, 0, 0);
    expect(Object.keys(result.gramsPerL)).toEqual([]);
    expect(result.caSource).toBe("calcium-chloride");
    expect(result.mgSource).toBe("epsom-salt");
    expect(result.blended).toBe(false);
  });

  test("SO4/Cl absent from the profile → legacy single-salt corner, never a split", () => {
    // CodeRabbit's PR-217 case: Ca 51 / Mg 1 with all four salts and NO
    // sulfate/chloride fields would have split Ca ≈ 16.9 gypsum + 34.1 CaCl2
    // under the closed form. Absent-both must corner-pick like
    // pickBestCaMgSources (here: epsom + CaCl2 minimizes added anions).
    saveSelectedMinerals([
      "calcium-chloride",
      "gypsum",
      "epsom-salt",
      "magnesium-chloride",
      "baking-soda",
    ]);
    const result = metrics.allocateCaMgDoses(DISTILLED, { calcium: 51, magnesium: 1 }, 51, 1);
    expect(result.blended).toBe(false);
    expect(result.gramsPerL["gypsum"]).toBeUndefined();
    expect(result.gramsPerL["magnesium-chloride"]).toBeUndefined();
    const ions = addedIons(result);
    expect(ions.calcium).toBeCloseTo(51, 2);
    expect(ions.magnesium).toBeCloseTo(1, 2);
    expect(result.caSource).toBe("calcium-chloride");
    expect(result.mgSource).toBe("epsom-salt");
  });

  test("explicit SO4/Cl zeros are an expressed preference → blend still allowed", () => {
    // Contrast with the absent-both case above: a profile that STORES 0/0
    // (small deltas, no gypsum) gets the least-squares blend, which beats
    // either pure corner for total added anions.
    saveSelectedMinerals(["calcium-chloride", "epsom-salt", "magnesium-chloride", "baking-soda"]);
    const result = metrics.allocateCaMgDoses(DISTILLED, { sulfate: 0, chloride: 0 }, 4, 10);
    expect(result.blended).toBe(true);
    expect(result.gramsPerL["epsom-salt"]).toBeGreaterThan(0);
    expect(result.gramsPerL["magnesium-chloride"]).toBeGreaterThan(0);
    const ions = addedIons(result);
    expect(ions.sulfate).toBeCloseTo(17.32, 1);
    expect(ions.chloride).toBeCloseTo(23.46, 1);
  });
});
