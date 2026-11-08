// Golden numbers for the calculator's dosing math.
//
// Records every dose the calculator would show for the Recipe Library's
// canonical recipes (a production snapshot in
// fixtures/library-canonical-recipes.json, plus any built-in preset not in it):
//
//   derive  the Recipe Concentrate formula derived from each recipe
//   single  each library and derived Recipe Concentrate dosed alone against
//           each recipe (the concentrate's own recipe included)
//   pair    each recipe's own concentrate dosed together with every other one
//
// The table is committed (__snapshots__/calc-golden.txt), so a change to
// metrics.ts that moves any of these numbers shows up as a reviewed diff
// instead of passing unnoticed. When a change is intended, update it with
//   npx vitest run tests/calc-golden.test.ts -u
// and explain the moved numbers in the PR.

import { test, expect, beforeEach } from "vitest";
import fixture from "./fixtures/library-canonical-recipes.json";
import {
  deriveStockFormulaFromTarget,
  solveCalculatorDosing,
  toStableBicarbonateFromAlkalinity,
} from "../src/lib/metrics";
import { TARGET_PRESETS } from "../src/lib/constants";
import {
  DEFAULT_SELECTED_MINERALS,
  saveSelectedMinerals,
  saveSelectedConcentrates,
} from "../src/lib/storage";

type Recipe = {
  slug: string;
  calcium?: number;
  magnesium?: number;
  alkalinity?: number;
  potassium?: number;
  sodium?: number;
  sulfate?: number;
  chloride?: number;
  bicarbonate?: number;
  stockFormula?: { bottleMl: number; doseGramsPerL: number; minerals: unknown[] };
};
type Spec = {
  bottleMl: number;
  doseGramsPerL: number;
  minerals: Array<{ mineralId: string; grams: number }>;
  createdFrom: string;
};
type Concentrate = { id: string; spec: Spec };

// Untyped so the same table can be generated against solver signatures that
// do and don't take the trailing options argument.
const solve = solveCalculatorDosing as unknown as (...args: unknown[]) => {
  concentrateGramsPerL: Record<string, number>;
};

const DISTILLED = {
  calcium: 0,
  magnesium: 0,
  potassium: 0,
  sodium: 0,
  sulfate: 0,
  chloride: 0,
  bicarbonate: 0,
};

beforeEach(() => {
  // A fresh device: default powders, no concentrates enabled.
  global.localStorage.clear();
  global.sessionStorage.clear();
  saveSelectedMinerals(DEFAULT_SELECTED_MINERALS.slice());
  saveSelectedConcentrates([]);
});

function recipes(): Recipe[] {
  const bySlug = new Map<string, Recipe>();
  for (const row of fixture as Recipe[]) bySlug.set(row.slug, row);
  for (const [slug, preset] of Object.entries(TARGET_PRESETS)) {
    if (!bySlug.has(slug)) bySlug.set(slug, { slug, ...(preset as Omit<Recipe, "slug">) });
  }
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

// What the calculator hands the solver: the recipe with bicarbonate derived
// from its alkalinity (script.ts computeStockDosingPlan).
function solverTarget(r: Recipe): Record<string, unknown> {
  return {
    ...r,
    bicarbonate: toStableBicarbonateFromAlkalinity(r.alkalinity ?? 0, r.bicarbonate ?? 0),
  };
}

const fmt = (n: number | undefined) => (Number.isFinite(n) ? (n as number) : 0).toFixed(2);

test("calculator doses for the canonical library recipes match the committed table", async () => {
  const all = recipes();
  const lines: string[] = [];
  const concentrates: Concentrate[] = [];
  const own = new Map<string, Concentrate>();

  for (const r of all) {
    if (r.stockFormula) {
      const c: Concentrate = {
        id: "stock:" + r.slug,
        spec: { ...(r.stockFormula as Spec), createdFrom: "library:" + r.slug },
      };
      concentrates.push(c);
      own.set(r.slug, c);
    }
  }
  for (const r of all) {
    const d = deriveStockFormulaFromTarget(r);
    const minerals = [...(d.minerals as Spec["minerals"])].sort((a, b) =>
      a.mineralId.localeCompare(b.mineralId),
    );
    lines.push(
      `derive ${r.slug}: dose ${fmt(d.doseGramsPerL)} bottle ${d.bottleMl} ` +
        (minerals.map((m) => `${m.mineralId} ${fmt(m.grams)}`).join(", ") || "(none)"),
    );
    if (minerals.length === 0) continue;
    const c: Concentrate = {
      id: "stock:" + r.slug + "-derived",
      spec: {
        bottleMl: d.bottleMl,
        doseGramsPerL: d.doseGramsPerL,
        minerals: d.minerals as Spec["minerals"],
        createdFrom: "derived:" + r.slug,
      },
    };
    concentrates.push(c);
    if (!own.has(r.slug)) own.set(r.slug, c);
  }
  concentrates.sort((a, b) => a.id.localeCompare(b.id));

  for (const r of all) {
    const target = solverTarget(r);
    for (const c of concentrates) {
      const x = solve(DISTILLED, target, [c], [], { recipeSlug: r.slug }).concentrateGramsPerL;
      lines.push(`single ${r.slug} <- ${c.id}: ${fmt(x[c.id])}`);
    }
  }

  for (const r of all) {
    const mine = own.get(r.slug);
    if (!mine) continue;
    const target = solverTarget(r);
    for (const c of concentrates) {
      if (c.id === mine.id) continue;
      const x = solve(DISTILLED, target, [mine, c], [], {
        recipeSlug: r.slug,
      }).concentrateGramsPerL;
      lines.push(`pair ${r.slug} <- ${mine.id} + ${c.id}: ${fmt(x[mine.id])} + ${fmt(x[c.id])}`);
    }
  }

  await expect(lines.join("\n") + "\n").toMatchFileSnapshot("./__snapshots__/calc-golden.txt");
});
