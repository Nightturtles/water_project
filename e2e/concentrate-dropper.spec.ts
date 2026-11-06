import { test, expect, type Page } from "@playwright/test";
import { stubLoggedIn } from "./_auth-stub";

// Custom dropper size for Mineral Concentrates (DIY single-mineral specs).
// A spec's optional dropMl (mL per drop, to 3 decimals) makes that concentrate
// "drops-capable": the calculator result and the recipe builder input get the
// same drops/mL toggle Lotus concentrates have, using the user's dropper size.
// A spec without dropMl stays mL-only.
//
// Concentrate specs are gated (Category B), so the test user is pinned as
// logged in (stubLoggedIn); state is seeded into localStorage, then reloaded.

const DROP_ML = 0.05;
// 10 g Epsom salt in a 100 mL bottle -> 0.1 g/mL.
const EPSOM_SPEC = { bottleMl: 100, gramsPerBottle: 10, dropMl: DROP_ML };
const BAKING_SODA_SPEC = { bottleMl: 100, gramsPerBottle: 5 };

async function seed(page: Page, path: string) {
  await page.goto(path);
  await page.evaluate(
    (args) => {
      localStorage.setItem("cw_source_preset", "custom");
      localStorage.setItem(
        "cw_source_water",
        JSON.stringify({
          calcium: 0,
          magnesium: 0,
          potassium: 0,
          sodium: 0,
          sulfate: 0,
          chloride: 0,
          bicarbonate: 0,
        }),
      );
      const slug = "dropper-target";
      localStorage.setItem(
        "cw_custom_target_profiles",
        JSON.stringify({
          [slug]: {
            label: "Dropper Target",
            calcium: 0,
            magnesium: 20,
            alkalinity: 40,
            potassium: 0,
            sodium: 0,
            sulfate: 0,
            chloride: 0,
            bicarbonate: 48.77,
            brewMethod: "all",
            description: "",
          },
        }),
      );
      localStorage.setItem("cw_target_preset", slug);
      localStorage.setItem(
        "cw_diy_concentrate_specs",
        JSON.stringify({ "epsom-salt": args.epsom, "baking-soda": args.bakingSoda }),
      );
      localStorage.setItem(
        "cw_selected_concentrates",
        JSON.stringify(["diy:epsom-salt", "diy:baking-soda"]),
      );
      localStorage.setItem("cw_selected_minerals", JSON.stringify([]));
      localStorage.setItem("cw_volume_calculator", JSON.stringify({ value: "10", unit: "liters" }));
      localStorage.setItem("cw_calculator_welcome_dismissed", "true");
    },
    { epsom: EPSOM_SPEC, bakingSoda: BAKING_SODA_SPEC },
  );
  await page.reload();
}

test.describe("custom dropper size for Mineral Concentrates", () => {
  test.beforeEach(async ({ page }) => {
    await stubLoggedIn(page);
  });

  test("calculator shows drops for a concentrate with a dropper size, mL otherwise", async ({
    page,
  }) => {
    await seed(page, "/index.html");

    const epsomRow = page.locator('.result-item[data-concentrate="diy:epsom-salt"]');
    const epsomUnit = epsomRow.locator("select[data-lotus-unit-for]");
    const epsomValue = epsomRow.locator(".result-value");
    await expect(epsomUnit).toHaveValue("drops");
    await expect(epsomValue).not.toHaveText("0");
    const drops = Number(await epsomValue.textContent());

    await epsomUnit.selectOption("ml");
    await expect(epsomValue).toHaveText(/^\d+\.\d{3}$/);
    const ml = Number(await epsomValue.textContent());
    expect(ml).toBeGreaterThan(0);
    expect(drops).toBe(Math.round(ml / DROP_ML));

    // No dropper size -> mL-only, no toggle.
    const sodaRow = page.locator('.result-item[data-concentrate="diy:baking-soda"]');
    await expect(sodaRow.locator("select[data-lotus-unit-for]")).toHaveCount(0);
    await expect(sodaRow.locator(".result-value")).toHaveText(/ mL$/);
  });

  test("recipe builder accepts drops and converts with the dropper size", async ({ page }) => {
    await seed(page, "/recipe.html");

    const row = page.locator('.mineral-input-row[data-concentrate-id="diy:epsom-salt"]');
    await expect(row).toHaveAttribute("data-drops-capable", "true");
    await expect(row.locator('select[data-lotus-unit-select="true"]')).toHaveValue("drops");
    await row.locator('input[data-concentrate-field="lotus-value"]').fill("20");

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("cw_recipe_concentrate_inputs") || "{}")[
              "diy:epsom-salt"
            ],
        ),
      )
      .toEqual({ ml: 20 * DROP_ML, drops: 20 });

    const sodaRow = page.locator('.mineral-input-row[data-concentrate-id="diy:baking-soda"]');
    await expect(sodaRow).not.toHaveAttribute("data-drops-capable", "true");
    await expect(sodaRow.locator('input[data-concentrate-field="ml"]')).toHaveCount(1);
  });

  test("minerals page edits keep the dropper size and round it to 3 decimals", async ({ page }) => {
    await seed(page, "/minerals.html");

    const row = page.locator(
      '.concentrate-item[data-mineral-id="epsom-salt"]:has(input[data-field="drop-ml"])',
    );
    const dropInput = row.locator('input[data-field="drop-ml"]');
    await expect(dropInput).toHaveValue(String(DROP_ML));

    const readSpec = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("cw_diy_concentrate_specs") || "{}")["epsom-salt"],
      );

    // Editing another field must not drop the saved dropper size.
    await row.locator('input[data-field="bottle-ml"]').fill("200");
    await expect.poll(readSpec).toEqual({ bottleMl: 200, gramsPerBottle: 10, dropMl: DROP_ML });

    await dropInput.fill("0.0456");
    await expect.poll(readSpec).toEqual({ bottleMl: 200, gramsPerBottle: 10, dropMl: 0.046 });

    // Clearing it returns the concentrate to mL-only.
    await dropInput.fill("");
    await expect.poll(readSpec).toEqual({ bottleMl: 200, gramsPerBottle: 10 });
  });
});
