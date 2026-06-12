// Pins the behavior of formatStockSpec, which consolidates two previously
// drifted implementations:
//   - recipe-browser.js formatStockFormula  (labelMode:"short", includeBottleDose:true)
//   - script.js formatStockResultDetail     (labelMode:"formula", includeBottleDose:false)
//
// constants.js is required first so MINERAL_DB is available in the module
// body (same pattern as sync.test.js which also needs MINERAL_DB at call time).
require("./constants.js");

import { describe, test, expect } from "vitest";
import { formatStockSpec, STOCK_MINERAL_SHORT } from "./src/lib/stock-format";

// ---------------------------------------------------------------------------
// STOCK_MINERAL_SHORT
// ---------------------------------------------------------------------------
describe("STOCK_MINERAL_SHORT", () => {
  test("has expected entries", () => {
    expect(STOCK_MINERAL_SHORT["epsom-salt"]).toBe("epsom");
    expect(STOCK_MINERAL_SHORT["baking-soda"]).toBe("NaHCO₃");
    expect(STOCK_MINERAL_SHORT["potassium-bicarbonate"]).toBe("KHCO₃");
    expect(STOCK_MINERAL_SHORT["calcium-chloride"]).toBe("CaCl₂·2H₂O");
  });
});

// ---------------------------------------------------------------------------
// short mode (replaces recipe-browser.js formatStockFormula)
// ---------------------------------------------------------------------------
describe("formatStockSpec — labelMode:short", () => {
  const opts = { labelMode: "short" as const, includeBottleDose: true };

  test("empty minerals array returns empty string", () => {
    expect(formatStockSpec({ minerals: [] }, opts)).toBe("");
  });

  test("null spec returns empty string", () => {
    expect(formatStockSpec(null, opts)).toBe("");
  });

  test("undefined spec returns empty string", () => {
    expect(formatStockSpec(undefined, opts)).toBe("");
  });

  test("multi-mineral with bottle and dose", () => {
    const spec = {
      minerals: [
        { mineralId: "epsom-salt", grams: 5 },
        { mineralId: "baking-soda", grams: 3 },
      ],
      bottleMl: 500,
      doseGramsPerL: 2,
    };
    expect(formatStockSpec(spec, opts)).toBe("5 g epsom · 3 g NaHCO₃ in 500 mL - 2 g/L");
  });

  test("zero-gram entry is KEPT (not filtered out)", () => {
    const spec = {
      minerals: [
        { mineralId: "epsom-salt", grams: 0 },
        { mineralId: "baking-soda", grams: 3 },
      ],
    };
    expect(formatStockSpec(spec, opts)).toBe("0 g epsom · 3 g NaHCO₃");
  });

  test("unknown mineralId falls back to the id itself", () => {
    const spec = {
      minerals: [{ mineralId: "unknown-salt", grams: 2 }],
    };
    expect(formatStockSpec(spec, opts)).toBe("2 g unknown-salt");
  });

  test("prototype-chain ids (e.g. 'toString') fall back to the raw id, not Object.prototype members", () => {
    const spec = {
      minerals: [{ mineralId: "toString", grams: 2 }],
    };
    expect(formatStockSpec(spec, opts)).toBe("2 g toString");
  });

  test("missing mineralId falls back to '?'", () => {
    const spec = {
      minerals: [{ grams: 2 }],
    };
    expect(formatStockSpec(spec, opts)).toBe("2 g ?");
  });

  test("non-finite grams entry is skipped", () => {
    const spec = {
      minerals: [
        { mineralId: "epsom-salt", grams: NaN },
        { mineralId: "baking-soda", grams: 3 },
      ],
    };
    expect(formatStockSpec(spec, opts)).toBe("3 g NaHCO₃");
  });

  test("all non-finite → empty string", () => {
    const spec = {
      minerals: [{ mineralId: "epsom-salt", grams: Infinity }],
    };
    expect(formatStockSpec(spec, opts)).toBe("");
  });

  test("bottle and dose omitted when zero", () => {
    const spec = {
      minerals: [{ mineralId: "epsom-salt", grams: 5 }],
      bottleMl: 0,
      doseGramsPerL: 0,
    };
    expect(formatStockSpec(spec, opts)).toBe("5 g epsom");
  });

  test("bottle and dose omitted when includeBottleDose is false", () => {
    const spec = {
      minerals: [{ mineralId: "epsom-salt", grams: 5 }],
      bottleMl: 500,
      doseGramsPerL: 2,
    };
    expect(formatStockSpec(spec, { labelMode: "short", includeBottleDose: false })).toBe(
      "5 g epsom",
    );
  });

  test("single mineral, no bottle/dose", () => {
    const spec = {
      minerals: [{ mineralId: "gypsum", grams: 1.5 }],
    };
    expect(formatStockSpec(spec, opts)).toBe("1.5 g gypsum");
  });
});

// ---------------------------------------------------------------------------
// formula mode (replaces script.js formatStockResultDetail)
// ---------------------------------------------------------------------------
describe("formatStockSpec — labelMode:formula", () => {
  const opts = { labelMode: "formula" as const, includeBottleDose: false };

  test("empty minerals array returns empty string", () => {
    expect(formatStockSpec({ minerals: [] }, opts)).toBe("");
  });

  test("null spec returns empty string", () => {
    expect(formatStockSpec(null, opts)).toBe("");
  });

  test("zero-gram entry is DROPPED", () => {
    const spec = {
      minerals: [
        { mineralId: "epsom-salt", grams: 0 },
        { mineralId: "calcium-chloride", grams: 3 },
      ],
    };
    // epsom-salt at 0g is dropped; calcium-chloride uses MINERAL_DB formula
    expect(formatStockSpec(spec, opts)).toBe("3g CaCl₂·2H₂O");
  });

  test("multi-mineral uses MINERAL_DB formula labels, no spaces before 'g'", () => {
    const spec = {
      minerals: [
        { mineralId: "epsom-salt", grams: 5 },
        { mineralId: "calcium-chloride", grams: 2 },
      ],
      bottleMl: 500,
      doseGramsPerL: 2,
    };
    // bottle/dose never appended in formula mode
    expect(formatStockSpec(spec, opts)).toBe("5g MgSO₄·7H₂O · 2g CaCl₂·2H₂O");
  });

  test("entry without mineralId is skipped", () => {
    const spec = {
      minerals: [{ grams: 5 }, { mineralId: "calcium-chloride", grams: 3 }],
    };
    expect(formatStockSpec(spec, opts)).toBe("3g CaCl₂·2H₂O");
  });

  test("unknown mineralId falls back to the id itself (no formula in MINERAL_DB)", () => {
    const spec = {
      minerals: [{ mineralId: "mystery-salt", grams: 4 }],
    };
    expect(formatStockSpec(spec, opts)).toBe("4g mystery-salt");
  });

  test("all entries dropped → empty string", () => {
    const spec = {
      minerals: [{ mineralId: "epsom-salt", grams: 0 }],
    };
    expect(formatStockSpec(spec, opts)).toBe("");
  });

  test("negative grams entry is dropped", () => {
    const spec = {
      minerals: [
        { mineralId: "epsom-salt", grams: -1 },
        { mineralId: "baking-soda", grams: 2 },
      ],
    };
    expect(formatStockSpec(spec, opts)).toBe("2g NaHCO₃");
  });

  test("bottle/dose never appended even when includeBottleDose is true", () => {
    // formula mode ignores includeBottleDose
    const spec = {
      minerals: [{ mineralId: "epsom-salt", grams: 5 }],
      bottleMl: 500,
      doseGramsPerL: 2,
    };
    expect(formatStockSpec(spec, { labelMode: "formula", includeBottleDose: true })).toBe(
      "5g MgSO₄·7H₂O",
    );
  });
});
