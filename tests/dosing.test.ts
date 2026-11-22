// computeDoses (src/lib/dosing.ts) is the Calculator page's dose math, shared
// with the MCP server's calculate_doses tool. These tests cover:
//   - known answers worked out by hand from the mineral table;
//   - that it depends only on its arguments (the server has no browser state);
//   - that buildDosingKit, which the server uses to turn a synced settings row
//     into a kit, agrees with the storage getters the Calculator page uses;
//   - a committed table of doses for the canonical recipes, so a change that
//     moves any dose shows up as a reviewed diff.
// Update the table with: npx vitest run tests/dosing.test.ts -u

import { test, expect, beforeEach } from "vitest";
import fixture from "./fixtures/library-canonical-recipes.json";
import { buildDosingKit, computeDoses, STARTER_MINERALS } from "../src/lib/dosing";
import type { DosingKit, DosingTarget } from "../src/lib/dosing";
import { MINERAL_DB, HCO3_TO_CACO3, ALK_TO_BAKING_SODA } from "../src/lib/constants";
import {
  DEFAULT_SELECTED_MINERALS,
  getActiveStockSpecs,
  getConcentrateDropMl,
  getConcentrateGramsPerMl,
  getConcentrateMineralId,
  getEffectiveAlkalinitySources,
  getEffectiveCalciumSources,
  getEffectiveMagnesiumSources,
  loadDiyConcentrateSpecs,
  loadLotusConcentrateUnitFor,
  loadLotusConcentrateUnits,
  loadLotusDropperType,
  loadSelectedConcentrates,
  loadSelectedMinerals,
  loadStockConcentrateSpecs,
  loadValidSelectedConcentrates,
  saveDiyConcentrateSpecs,
  saveLotusConcentrateUnits,
  saveLotusDropperType,
  saveSelectedConcentrates,
  saveSelectedMinerals,
  saveStockConcentrateSpecs,
} from "../src/lib/storage";

const DISTILLED = {
  calcium: 0,
  magnesium: 0,
  potassium: 0,
  sodium: 0,
  sulfate: 0,
  chloride: 0,
  bicarbonate: 0,
};
const HARD_TAP = {
  calcium: 60,
  magnesium: 15,
  potassium: 2,
  sodium: 20,
  sulfate: 25,
  chloride: 30,
  bicarbonate: 120,
};
const TARGET: DosingTarget = {
  calcium: 20,
  magnesium: 10,
  alkalinity: 40,
  potassium: 0,
  sodium: 0,
  sulfate: 22,
  chloride: 20,
  bicarbonate: 49,
};
const powders = (minerals: string[]): DosingKit => ({
  minerals,
  concentrates: [],
  recipeConcentrates: [],
});
const HOUSE_SPEC = {
  label: "House",
  bottleMl: 200,
  doseGramsPerL: 4,
  dropMl: 0.05,
  minerals: [
    { mineralId: "epsom-salt", grams: 4.1 },
    { mineralId: "calcium-chloride", grams: 0.7 },
    { mineralId: "potassium-bicarbonate", grams: 1.1 },
  ],
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  saveSelectedMinerals(DEFAULT_SELECTED_MINERALS.slice());
  saveSelectedConcentrates([]);
  saveDiyConcentrateSpecs({});
  saveStockConcentrateSpecs({});
});

test("the starter kit: one salt per slot, each delivering its delta exactly", () => {
  const r = computeDoses({
    sourceWater: DISTILLED,
    target: TARGET,
    volumeL: 2,
    kit: powders(STARTER_MINERALS),
  });
  expect(r.status).toBe("ok");
  expect(r.mode).toBe("minerals");
  const caFrac = MINERAL_DB["calcium-chloride"]!.ions.calcium!;
  const mgFrac = MINERAL_DB["epsom-salt"]!.ions.magnesium!;
  expect(r.mineralGrams["calcium-chloride"]).toBeCloseTo((20 / 1000 / caFrac) * 2, 10);
  expect(r.mineralGrams["epsom-salt"]).toBeCloseTo((10 / 1000 / mgFrac) * 2, 10);
  expect(r.mineralGrams["baking-soda"]).toBeCloseTo(((40 * ALK_TO_BAKING_SODA) / 1000) * 2, 10);
  // Rows show grams to 0.01, and the finished water is what those make.
  expect(r.shown.mineralGrams["calcium-chloride"]).toBe(
    Number(r.mineralGrams["calcium-chloride"]!.toFixed(2)),
  );
  expect(r.finalIons!.calcium).toBeCloseTo(20, 0);
  expect(r.finalIons!.magnesium).toBeCloseTo(10, 0);
  // 0.13 g of baking soda in 2 L: the 0.01 g step is worth about 1.5 mg/L here.
  expect(Math.abs(r.finalIons!.bicarbonate * HCO3_TO_CACO3 - 40)).toBeLessThan(1.5);
  expect(r.warnings).toEqual([]);
});

test("a source water already past the target doses nothing for that ion and says so", () => {
  const r = computeDoses({
    sourceWater: HARD_TAP,
    target: TARGET,
    volumeL: 1,
    kit: powders(STARTER_MINERALS),
  });
  expect(r.mineralGrams).toEqual({ "calcium-chloride": 0, "epsom-salt": 0 });
  expect(r.warnings).toHaveLength(3);
  expect(r.warnings.join(" ")).toMatch(/Calcium.*Magnesium.*Alkalinity/);
  expect(r.finalIons).toEqual(HARD_TAP);
});

test("no alkalinity source, and no volume, are reported instead of dosed", () => {
  const noAlk = computeDoses({
    sourceWater: DISTILLED,
    target: TARGET,
    volumeL: 1,
    kit: powders(["calcium-chloride", "epsom-salt"]),
  });
  expect(noAlk.status).toBe("no-alkalinity-source");
  expect(noAlk.finalIons).toBeNull();

  const noVolume = computeDoses({
    sourceWater: DISTILLED,
    target: TARGET,
    volumeL: 0,
    kit: powders(STARTER_MINERALS),
  });
  expect(noVolume.status).toBe("no-volume");
  expect(noVolume.mineralGrams).toEqual({
    "baking-soda": 0,
    "epsom-salt": 0,
    "calcium-chloride": 0,
  });
});

test("a concentrate carries its salt's dose, in whole drops when it has a dropper", () => {
  const kit: DosingKit = {
    minerals: STARTER_MINERALS,
    concentrates: [
      {
        id: "diy:epsom-salt",
        mineralId: "epsom-salt",
        gramsPerMl: 0.2,
        dropMl: 0.05,
        unit: "drops",
      },
    ],
    recipeConcentrates: [],
  };
  const r = computeDoses({ sourceWater: DISTILLED, target: TARGET, volumeL: 1, kit });
  const grams = 10 / 1000 / MINERAL_DB["epsom-salt"]!.ions.magnesium!;
  expect(r.concentrateMl["diy:epsom-salt"]).toBeCloseTo(grams / 0.2, 10);
  // The powder row of the same salt is zeroed: the concentrate doses it.
  expect(r.mineralGrams["epsom-salt"]).toBe(0);
  const drops = Math.round(grams / 0.2 / 0.05);
  expect(r.shown.concentrateMl["diy:epsom-salt"]).toBeCloseTo(drops * 0.05, 10);
  expect(r.warnings.join(" ")).toMatch(/both the normal and concentrate version/);
  // The readout is the water the whole drops make.
  expect(r.finalIons!.magnesium).toBeCloseTo(
    drops * 0.05 * 0.2 * MINERAL_DB["epsom-salt"]!.ions.magnesium! * 1000,
    6,
  );
});

test("Recipe Concentrates replace the per-mineral rows; powders top up the shortfall", () => {
  const kit: DosingKit = {
    minerals: ["baking-soda"],
    concentrates: [],
    recipeConcentrates: [{ id: "stock:house", spec: HOUSE_SPEC, dropMl: 0, unit: "ml" }],
  };
  const r = computeDoses({
    sourceWater: DISTILLED,
    target: { ...TARGET, alkalinity: 60, bicarbonate: 73 },
    volumeL: 1,
    kit,
    recipeSlug: "anything",
  });
  expect(r.mode).toBe("recipe-concentrates");
  expect(r.recipeConcentrateMl["stock:house"]).toBeGreaterThan(0);
  expect(r.mineralGrams).toEqual({});
  // Alkalinity left short by the concentrate is topped up with the enabled powder.
  expect(r.supplementGramsPerL["baking-soda"]).toBeGreaterThan(0);
  // Calcium is short too, but no calcium powder is enabled.
  expect(r.enableSuggestions).toContainEqual({ ion: "calcium", mineralId: "calcium-chloride" });
});

test("doses depend only on the arguments, never on this browser's saved selection", () => {
  const input = {
    sourceWater: DISTILLED,
    target: TARGET,
    volumeL: 1,
    kit: powders(["gypsum", "magnesium-chloride", "potassium-bicarbonate"]),
  };
  saveSelectedMinerals(["calcium-chloride", "epsom-salt", "baking-soda"]);
  const before = computeDoses(input);
  saveSelectedMinerals(["gypsum", "epsom-salt", "magnesium-chloride", "potassium-bicarbonate"]);
  saveSelectedConcentrates(["brand:lotus:calcium"]);
  const after = computeDoses(input);
  expect(after).toEqual(before);
  expect(Object.keys(before.mineralGrams).sort()).toEqual([
    "gypsum",
    "magnesium-chloride",
    "potassium-bicarbonate",
  ]);
});

test("STARTER_MINERALS is the app's default selection", () => {
  expect(STARTER_MINERALS).toEqual(DEFAULT_SELECTED_MINERALS);
  expect(buildDosingKit({} as never).minerals).toEqual(DEFAULT_SELECTED_MINERALS);
});

test("buildDosingKit agrees with the storage getters the Calculator page uses", () => {
  saveSelectedMinerals(["gypsum", "epsom-salt", "baking-soda", "calcium-chloride"]);
  saveDiyConcentrateSpecs({
    "epsom-salt": { bottleMl: 59, gramsPerBottle: 13.5, dropMl: 0.0724 },
    "calcium-chloride-anhydrous": { bottleMl: 100, gramsPerBottle: 10 },
    "magnesium-chloride": { bottleMl: 0, gramsPerBottle: 5 },
  } as never);
  saveStockConcentrateSpecs({ house: HOUSE_SPEC, plain: { ...HOUSE_SPEC, dropMl: undefined } });
  saveSelectedConcentrates([
    "diy:epsom-salt",
    "brand:lotus:calcium",
    "stock:house",
    "diy:calcium-chloride-anhydrous",
    "diy:magnesium-chloride",
    "stock:plain",
    "stock:orphan",
    "brand:unknown:thing",
    "junk",
  ]);
  saveLotusDropperType("straight");
  saveLotusConcentrateUnits({ "brand:lotus:calcium": "ml", "stock:house": "drops" });

  const kit = buildDosingKit({
    selectedMinerals: loadSelectedMinerals(),
    selectedConcentrates: loadSelectedConcentrates(),
    diySpecs: loadDiyConcentrateSpecs(),
    stockSpecs: loadStockConcentrateSpecs(),
    lotusDropperType: loadLotusDropperType(),
    concentrateUnits: loadLotusConcentrateUnits(),
  });

  expect(kit.minerals).toEqual(loadSelectedMinerals());
  const single = loadValidSelectedConcentrates().filter((id) => !id.startsWith("stock:"));
  expect(kit.concentrates.map((c) => c.id)).toEqual(single);
  for (const c of kit.concentrates) {
    expect(c.mineralId).toBe(getConcentrateMineralId(c.id));
    expect(c.gramsPerMl).toBe(getConcentrateGramsPerMl(c.id));
    const dropMl = getConcentrateDropMl(c.id);
    expect(c.dropMl).toBe(dropMl);
    expect(c.unit).toBe(dropMl > 0 ? loadLotusConcentrateUnitFor(c.id) : "ml");
  }
  const stocks = getActiveStockSpecs(loadValidSelectedConcentrates());
  expect(kit.recipeConcentrates.map((rc) => ({ id: rc.id, spec: rc.spec }))).toEqual(stocks);
  for (const rc of kit.recipeConcentrates) {
    const dropMl = getConcentrateDropMl(rc.id);
    expect(rc.dropMl).toBe(dropMl);
    expect(rc.unit).toBe(dropMl > 0 ? loadLotusConcentrateUnitFor(rc.id) : "ml");
  }
  // Spot checks, so the comparison above cannot pass on two wrong answers.
  expect(kit.concentrates.find((c) => c.id === "diy:epsom-salt")).toMatchObject({
    gramsPerMl: 13.5 / 59,
    dropMl: 0.072,
    unit: "drops",
  });
  expect(kit.concentrates.find((c) => c.id === "brand:lotus:calcium")).toMatchObject({
    dropMl: 0.0386,
    unit: "ml",
  });
  expect(kit.recipeConcentrates.map((rc) => rc.id)).toEqual(["stock:house", "stock:plain"]);

  // And the sources computeDoses derives from that kit are the page's.
  const r = computeDoses({ sourceWater: DISTILLED, target: TARGET, volumeL: 1, kit });
  expect(r.sources).toEqual({
    alkalinity: getEffectiveAlkalinitySources(),
    calcium: getEffectiveCalciumSources(),
    magnesium: getEffectiveMagnesiumSources(),
  });
});

test("doses for the canonical library recipes match the committed table", async () => {
  type Recipe = Partial<DosingTarget> & { slug: string };
  const recipes = [...(fixture as Recipe[])].sort((a, b) => a.slug.localeCompare(b.slug));
  const kits: Record<string, DosingKit> = {
    starter: powders(STARTER_MINERALS),
    all: powders([
      "calcium-chloride",
      "gypsum",
      "epsom-salt",
      "magnesium-chloride",
      "baking-soda",
      "potassium-bicarbonate",
    ]),
    lotus: buildDosingKit({
      selectedMinerals: [],
      selectedConcentrates: [
        "brand:lotus:calcium",
        "brand:lotus:magnesium",
        "brand:lotus:sodium-bicarbonate",
        "brand:lotus:potassium-bicarbonate",
      ],
      diySpecs: {},
      stockSpecs: {},
      lotusDropperType: "round",
      concentrateUnits: {},
    }),
  };
  const waters = { distilled: DISTILLED, hard: HARD_TAP };
  const n = (v: number | undefined) => Number(v ?? 0);
  const lines: string[] = [];
  for (const recipe of recipes) {
    const target: DosingTarget = {
      calcium: n(recipe.calcium),
      magnesium: n(recipe.magnesium),
      alkalinity: n(recipe.alkalinity),
      potassium: n(recipe.potassium),
      sodium: n(recipe.sodium),
      sulfate: n(recipe.sulfate),
      chloride: n(recipe.chloride),
      bicarbonate: n(recipe.bicarbonate),
    };
    for (const [waterName, sourceWater] of Object.entries(waters)) {
      for (const [kitName, kit] of Object.entries(kits)) {
        const r = computeDoses({ sourceWater, target, volumeL: 1, kit, recipeSlug: recipe.slug });
        const doses = [
          ...Object.entries(r.shown.mineralGrams).map(([id, g]) => `${id} ${g.toFixed(2)}g`),
          ...Object.entries(r.shown.concentrateMl).map(([id, ml]) => `${id} ${ml.toFixed(4)}mL`),
        ];
        const ions = r.finalIons
          ? Object.values(r.finalIons)
              .map((v) => v.toFixed(1))
              .join("/")
          : "-";
        lines.push(
          `${recipe.slug} | ${waterName} | ${kitName}: ${doses.join(", ") || "(none)"} => ${ions}` +
            (r.warnings.length ? ` [${r.warnings.length} warning(s)]` : ""),
        );
      }
    }
  }
  await expect(lines.join("\n") + "\n").toMatchFileSnapshot("./__snapshots__/dosing-golden.txt");
});
