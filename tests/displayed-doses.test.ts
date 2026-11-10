import { describe, it, expect } from "vitest";
import {
  calculateIonPPMs,
  calculateMetrics,
  displayedConcentrateMl,
  displayedDrops,
  displayedGrams,
} from "../src/lib/metrics";

// The Calculator's readout is built from the doses its rows display, not the
// exact solve. These helpers are that conversion.

describe("displayedGrams", () => {
  it("rounds to the 2 decimals the row prints", () => {
    expect(displayedGrams(0.1234)).toBe(0.12);
    expect(displayedGrams(0.126)).toBe(0.13);
    expect(displayedGrams(1)).toBe(1);
  });

  it("passes sub-0.01 g doses through (shown as '<0.01 g', no figure to follow)", () => {
    expect(displayedGrams(0.004)).toBe(0.004);
  });

  it("is 0 for zero, negative, and non-finite input", () => {
    expect(displayedGrams(0)).toBe(0);
    expect(displayedGrams(-1)).toBe(0);
    expect(displayedGrams(NaN)).toBe(0);
    expect(displayedGrams(Infinity)).toBe(0);
  });
});

describe("displayedDrops / displayedConcentrateMl", () => {
  it("rounds to whole drops", () => {
    expect(displayedDrops(0.12, 0.05)).toBe(2);
    expect(displayedDrops(0.13, 0.05)).toBe(3);
    expect(displayedDrops(0.02, 0.05)).toBe(0);
  });

  it("returns whole drops times the dropper size in drops mode", () => {
    expect(displayedConcentrateMl(0.12, "drops", 0.05)).toBeCloseTo(0.1, 12);
    expect(displayedConcentrateMl(0.13, "drops", 0.05)).toBeCloseTo(0.15, 12);
    expect(displayedConcentrateMl(0.02, "drops", 0.05)).toBe(0);
  });

  it("returns the 3-decimal mL figure in mL mode", () => {
    expect(displayedConcentrateMl(0.12345, "ml", 0.05)).toBe(0.123);
    expect(displayedConcentrateMl(0.12345, "ml", 0)).toBe(0.123);
  });

  it("is 0 for unusable input", () => {
    expect(displayedConcentrateMl(0, "drops", 0.05)).toBe(0);
    expect(displayedConcentrateMl(-1, "ml", 0.05)).toBe(0);
    expect(displayedConcentrateMl(NaN, "drops", 0.05)).toBe(0);
    expect(displayedConcentrateMl(0.12, "drops", 0)).toBe(0);
    expect(displayedConcentrateMl(0.12, "drops", NaN)).toBe(0);
    expect(displayedDrops(0.12, 0)).toBe(0);
  });
});

describe("readout from displayed doses", () => {
  // An Epsom concentrate at 0.1 g/mL, 0.05 mL dropper, solved for 0.11 g/L.
  const GRAMS_PER_ML = 0.1;
  const DROP_ML = 0.05;
  const SOLVED_G_PER_L = 0.11;

  function shownGramsPerL(volumeL: number, unit: "drops" | "ml"): number {
    const solvedMl = (SOLVED_G_PER_L * volumeL) / GRAMS_PER_ML;
    return (displayedConcentrateMl(solvedMl, unit, DROP_ML) * GRAMS_PER_ML) / volumeL;
  }

  it("same drop count in more water reads proportionally more dilute", () => {
    // Two volumes that share a drop count: 0.26 L -> 5.72 (6), 0.28 L -> 6.16 (6).
    const a = 0.26;
    const b = 0.28;
    const dropsA = displayedDrops((SOLVED_G_PER_L * a) / GRAMS_PER_ML, DROP_ML);
    const dropsB = displayedDrops((SOLVED_G_PER_L * b) / GRAMS_PER_ML, DROP_ML);
    expect(dropsA).toBe(dropsB);

    const ionsA = calculateIonPPMs({ "epsom-salt": shownGramsPerL(a, "drops") });
    const ionsB = calculateIonPPMs({ "epsom-salt": shownGramsPerL(b, "drops") });
    expect(ionsB.magnesium).toBeLessThan(ionsA.magnesium);
    expect(ionsB.magnesium / ionsA.magnesium).toBeCloseTo(a / b, 10);
    expect(calculateMetrics(ionsB).gh / calculateMetrics(ionsA).gh).toBeCloseTo(a / b, 10);
  });

  it("mL mode stays within display rounding of the exact solve", () => {
    const exact = calculateIonPPMs({ "epsom-salt": SOLVED_G_PER_L }).magnesium;
    const shown = calculateIonPPMs({ "epsom-salt": shownGramsPerL(2, "ml") }).magnesium;
    expect(Math.abs(shown - exact) / exact).toBeLessThan(0.001);
  });

  it("grams rows stay within display rounding of the exact solve", () => {
    const volumeL = 2;
    const shown = displayedGrams(SOLVED_G_PER_L * volumeL) / volumeL;
    expect(Math.abs(shown - SOLVED_G_PER_L)).toBeLessThanOrEqual(0.005 / volumeL + 1e-12);
  });
});
