import { test, expect } from "@playwright/test";
import { stubLoggedIn } from "./_auth-stub";

// Verifies the calculator's dosing intelligence (index.html / script.js):
//   Stage 1 — scale each enabled Recipe Concentrate's dose to best-fit the
//             target, snapping to the prescribed dose when it matches.
//   Stage 2 — suggest individual-mineral supplements for the residual, with a
//             one-click "Enable {mineral}" for minerals not yet enabled.
//
// Recipe Concentrate specs are gated (Category B), so we pin the test user as
// logged in (stubLoggedIn). All other state (zero source water, a custom target
// profile set active, concentrate specs + selection, volume) is written to
// localStorage after the first load — that lets us derive an exact-fit
// concentrate via window.deriveStockFormulaFromTarget — then we reload so the
// page initializes from it.

const ZERO_SOURCE = {
  calcium: 0,
  magnesium: 0,
  potassium: 0,
  sodium: 0,
  sulfate: 0,
  chloride: 0,
  bicarbonate: 0,
};

const CAFELYTIC_ESPRESSO = {
  calcium: 2.16,
  magnesium: 8.65,
  potassium: 13.51,
  sodium: 0,
  sulfate: 0,
  chloride: 29.19,
  bicarbonate: 21.09,
};

interface SeedOpts {
  /** Custom target profile ion values (alkalinity derived from bicarbonate). */
  target: Record<string, number>;
  /** stock slug -> spec, OR a target to derive an exact-fit 4 g/L concentrate from. */
  concentrates: Array<{
    slug: string;
    label: string;
    deriveFrom?: Record<string, number>;
    minerals?: Array<{ mineralId: string; grams: number }>;
  }>;
  selectedMinerals?: string[];
  volumeL?: number;
}

const HCO3_TO_CACO3 = 50.045 / 61.017;

async function seedAndReload(page: import("@playwright/test").Page, opts: SeedOpts) {
  await page.goto("/index.html");
  await page.evaluate(
    (args) => {
      const { target, concentrates, selectedMinerals, volumeL, hco3ToCaco3, zeroSource } = args;
      localStorage.setItem("cw_source_preset", "custom");
      localStorage.setItem("cw_source_water", JSON.stringify(zeroSource));

      // Custom target profile, set active. Alkalinity (as CaCO3) is what the
      // calculator's visible input shows; derive it from the target bicarbonate.
      const slug = "calc-dosing-target";
      const profile: Record<string, unknown> = Object.assign({}, target, {
        label: "Calc Dosing Target",
        // Honor an explicit alkalinity (used by the bicarbonate-derivation
        // regression test, which sets alkalinity > 0 with bicarbonate = 0);
        // otherwise derive it from bicarbonate so the visible field matches.
        alkalinity:
          target.alkalinity != null
            ? target.alkalinity
            : Math.round((target.bicarbonate || 0) * hco3ToCaco3 * 100) / 100,
        brewMethod: "all",
        description: "",
      });
      localStorage.setItem("cw_custom_target_profiles", JSON.stringify({ [slug]: profile }));
      // cw_target_preset holds the raw slug (a transient string), not JSON.
      localStorage.setItem("cw_target_preset", slug);

      // Concentrate specs: derive an exact-fit 4 g/L formula when deriveFrom is
      // given (guarantees the snap-to-prescribed case), else use raw minerals.
      const specs: Record<string, unknown> = {};
      const selected: string[] = [];
      for (const c of concentrates) {
        let minerals = c.minerals || [];
        if (c.deriveFrom && typeof window.deriveStockFormulaFromTarget === "function") {
          const derived = window.deriveStockFormulaFromTarget(c.deriveFrom, {
            bottleMl: 200,
            doseGramsPerL: 4,
          });
          minerals = derived.minerals;
        }
        specs[c.slug] = { label: c.label, bottleMl: 200, doseGramsPerL: 4, minerals };
        selected.push("stock:" + c.slug);
      }
      localStorage.setItem("cw_stock_concentrate_specs", JSON.stringify(specs));
      localStorage.setItem("cw_selected_concentrates", JSON.stringify(selected));
      localStorage.setItem("cw_selected_minerals", JSON.stringify(selectedMinerals || []));
      localStorage.setItem(
        "cw_volume_calculator",
        JSON.stringify({ value: String(volumeL || 100), unit: "liters" }),
      );
      // Suppress the one-time welcome modal so it can't intercept clicks.
      localStorage.setItem("cw_calculator_welcome_dismissed", "true");
    },
    {
      target: opts.target,
      concentrates: opts.concentrates,
      selectedMinerals: opts.selectedMinerals || [],
      volumeL: opts.volumeL || 100,
      hco3ToCaco3: HCO3_TO_CACO3,
      zeroSource: ZERO_SOURCE,
    },
  );
  await page.reload();
}

function stockValue(page: import("@playwright/test").Page, slug: string) {
  return page.locator(`.result-item[data-stock="stock:${slug}"] .result-value`);
}

async function numericValue(locator: import("@playwright/test").Locator): Promise<number> {
  const text = (await locator.textContent()) || "";
  return parseFloat(text.replace(/[^0-9.]/g, "")) || 0;
}

test.describe("index.html — calculator dosing intelligence", () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      consoleErrors.push(err.message);
    });
    await stubLoggedIn(page);
  });

  test.afterEach(() => {
    expect(consoleErrors).toEqual([]);
  });

  test("reproduction case: a matching concentrate snaps to its prescribed dose (400 g at 100 L)", async ({
    page,
  }) => {
    await seedAndReload(page, {
      target: CAFELYTIC_ESPRESSO,
      concentrates: [
        { slug: "cafelytic-espresso", label: "Cafelytic Espresso", deriveFrom: CAFELYTIC_ESPRESSO },
      ],
    });
    // Exact-fit concentrate dosed against its own recipe → prescribed 4 g/L
    // (= 400 g at 100 L), snapped — not a scaled approximation.
    await expect.poll(() => numericValue(stockValue(page, "cafelytic-espresso"))).toBe(400);
    // Nothing left to supplement.
    await expect(page.locator("#stock-supplements .result-section-heading")).toHaveCount(0);
    await expect(page.locator("#stock-supplements .result-enable-suggestion")).toHaveCount(0);
  });

  test("multi-concentrate best-fit: each non-matching concentrate is scaled to a nonzero dose", async ({
    page,
  }) => {
    // Two disjoint concentrates (Mg-only, alkalinity-only); a target wanting
    // both Mg and alkalinity uses both — neither alone matches the target.
    await seedAndReload(page, {
      target: {
        magnesium: 12,
        bicarbonate: 50,
        calcium: 0,
        potassium: 0,
        sodium: 0,
        sulfate: 0,
        chloride: 0,
      },
      concentrates: [
        { slug: "mg-only", label: "Mg Only", minerals: [{ mineralId: "epsom-salt", grams: 8 }] },
        { slug: "alk-only", label: "Alk Only", minerals: [{ mineralId: "baking-soda", grams: 8 }] },
      ],
    });
    await expect.poll(() => numericValue(stockValue(page, "mg-only"))).toBeGreaterThan(0);
    await expect.poll(() => numericValue(stockValue(page, "alk-only"))).toBeGreaterThan(0);
  });

  test("stocks-only gap: a needed unenabled mineral gets a one-click Enable row, then a dose", async ({
    page,
  }) => {
    // Concentrate supplies only alkalinity (baking soda); target also wants
    // calcium, which no enabled individual mineral can provide → Enable row.
    await seedAndReload(page, {
      target: {
        calcium: 40,
        bicarbonate: 50,
        magnesium: 0,
        potassium: 0,
        sodium: 0,
        sulfate: 0,
        chloride: 0,
      },
      concentrates: [
        { slug: "alk-only", label: "Alk Only", minerals: [{ mineralId: "baking-soda", grams: 8 }] },
      ],
      selectedMinerals: [],
    });
    const enableRow = page.locator('#stock-supplements [data-enable-mineral="calcium-chloride"]');
    await expect(enableRow).toBeVisible();
    await enableRow.locator("button.enable-mineral-btn").click();

    // Enabling persists the mineral and re-solves: a calcium-chloride dose row
    // appears with a nonzero amount, and the enable row is gone.
    await expect(
      page.locator('#stock-supplements [data-mineral="calcium-chloride"]'),
    ).toBeVisible();
    await expect
      .poll(() =>
        numericValue(
          page.locator('#stock-supplements [data-mineral="calcium-chloride"] .result-value'),
        ),
      )
      .toBeGreaterThan(0);
    await expect(
      page.locator('#stock-supplements [data-enable-mineral="calcium-chloride"]'),
    ).toHaveCount(0);
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("cw_selected_minerals") || "[]"),
    );
    expect(stored).toContain("calcium-chloride");
  });

  test("custom-profile alkalinity (bicarbonate field unset) still drives a buffer suggestion", async ({
    page,
  }) => {
    // Regression guard: the solver matches bicarbonate, but a custom target's
    // hidden bicarbonate field stays 0 (it isn't synced from the visible
    // Alkalinity input). The calculator must derive bicarbonate from
    // Alkalinity, so an alkalinity-free concentrate still surfaces a baking-soda
    // gap. Profile carries alkalinity=40 with bicarbonate=0 — exactly the
    // inconsistent custom-profile shape. If the solver read bicarbonate (0)
    // instead of deriving from alkalinity, no buffer gap would appear.
    await seedAndReload(page, {
      target: {
        calcium: 0,
        magnesium: 0,
        potassium: 0,
        sodium: 0,
        sulfate: 0,
        chloride: 0,
        alkalinity: 40,
        bicarbonate: 0,
      },
      concentrates: [
        // Calcium-only concentrate: provides no alkalinity.
        {
          slug: "ca-only",
          label: "Ca Only",
          minerals: [{ mineralId: "calcium-chloride", grams: 8 }],
        },
      ],
      // Baking soda enabled so the calculator has an alkalinity source (it
      // refuses to compute without one); the derived alkalinity demand then
      // produces a real baking-soda supplement.
      selectedMinerals: ["baking-soda"],
    });
    // If the solver had read the stale bicarbonate field (0) instead of
    // deriving from the Alkalinity input (40), there would be no alkalinity gap
    // and no baking-soda supplement. A nonzero baking-soda dose proves the
    // derivation path.
    await expect(page.locator('#stock-supplements [data-mineral="baking-soda"]')).toBeVisible();
    await expect
      .poll(() =>
        numericValue(page.locator('#stock-supplements [data-mineral="baking-soda"] .result-value')),
      )
      .toBeGreaterThan(0);
  });
});
