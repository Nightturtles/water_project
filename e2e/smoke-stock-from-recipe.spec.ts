import { test, expect } from "@playwright/test";
import { stubLoggedIn } from "./_auth-stub";

// Verifies the Recipe -> Concentrate handoff on library.html (recipe-browser.js
// + stock-editor.js). Two production code paths exist:
//
//   IMPORT path (mode "new-import") — for recipes with a hand-authored
//     stockFormula (the Coffee ad Astra rows, seeded by migration
//     20260506231724). Clicking "+ Create Concentrate" opens the editor
//     pre-filled with label/bottleMl/doseGramsPerL/minerals and keyed
//     under recipe.slug. After save the card CTA flips to "✓ In your pantry"
//     (rendered as .rx-card-stock-imported, recipe-browser.js:230).
//     Cards that expose this path also render .rx-card-stock-formula.
//
//   DERIVE path (mode "new-derive") — for recipes without a stockFormula but
//     with a non-trivial ion profile. The formula is computed at click time via
//     deriveStockFormulaFromTarget; the saved spec carries
//     createdFrom: "derived:<slug>" (recipe-browser.js:1313). Cards on this
//     path do NOT render .rx-card-stock-formula.
//
// Selectors used, pinned to source lines:
//   .rx-card-stock-formula     recipe-browser.js:225  (import-path marker)
//   .rx-card-stock-add         recipe-browser.js:236,267 (button class)
//   .stock-editor-overlay      stock-editor.js:96     (modal overlay)
//   #stock-editor-label        stock-editor.js:185    (Name input)
//   #stock-editor-bottle-ml    stock-editor.js:194    (Bottle mL input)
//   .stock-editor-mineral-list stock-editor.js:203    (mineral rows wrapper)
//   [data-action="save"]       stock-editor.js:209    (Save button)
//   .stock-editor-error        stock-editor.js:215    (validation error region)
//   .rx-card-stock-imported    recipe-browser.js:230  ("✓ In your pantry" span)
//
// Auth gating: concentrate specs are Category B (gated). stubLoggedIn pins
// window._cachedAuthUserId / window.isLoggedInSync so applyAuthGate does not
// lock the button and the save handler writes through to localStorage.
// With a stubbed (not real) session, cloud pushes fail silently — nothing
// touches Supabase, no cleanup required.

test.describe("library.html — Recipe to Concentrate handoff", () => {
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
    await page.goto("/library.html");
    // Clear any prior concentrate state so cards always render the
    // "+ Create Concentrate" button rather than the "In your pantry" indicator.
    // Done after first load (not via addInitScript) so it doesn't re-run on
    // reload inside the reload-persistence test.
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("cw_stock") || k === "cw_selected_concentrates")
        .forEach((k) => localStorage.removeItem(k));
    });
    await page.reload();
  });

  test.afterEach(() => {
    expect(consoleErrors).toEqual([]);
  });

  test("IMPORT path — hand-authored stockFormula prefills editor and persists after save + reload", async ({
    page,
  }) => {
    // Wait for at least one card that has a hand-authored stockFormula —
    // those expose the import path and also render .rx-card-stock-formula.
    // The Coffee ad Astra tray (12 rows) guarantees a match.
    const card = page
      .locator(".rx-recipe-card", { has: page.locator(".rx-card-stock-formula") })
      .first();
    await expect(card).toBeVisible({ timeout: 10000 });
    const slug = await card.getAttribute("data-slug");
    expect(slug).toBeTruthy();

    // Click the import button — the editor must open in place (no navigation).
    const addBtn = card.locator(".rx-card-stock-add");
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // Editor opens with the overlay visible and the Name field pre-filled
    // from the library row's label.
    await expect(page.locator(".stock-editor-overlay")).toBeVisible();
    await expect(page.locator("#stock-editor-label")).toHaveValue(/.+/);

    // Overwrite the label so we can assert the stored value precisely.
    await page.locator("#stock-editor-label").fill("E2E Import Concentrate");

    // Save — the handler validates label/bottleMl/dose/minerals and then
    // calls saveStockConcentrateSpecs (src/lib/storage.ts:800).
    await page.locator('.stock-editor-form [data-action="save"]').click();

    // The overlay should close after a successful save.
    await expect(page.locator(".stock-editor-overlay")).toBeHidden();

    // Persistence: the spec is stored under the library slug.
    const spec = await page.evaluate((s) => {
      const raw = localStorage.getItem("cw_stock_concentrate_specs");
      return raw
        ? (JSON.parse(raw) as Record<string, { label: string; minerals: unknown[] }>)[s!]
        : null;
    }, slug);
    expect(spec).toBeTruthy();
    expect(spec!.label).toBe("E2E Import Concentrate");
    expect(Array.isArray(spec!.minerals)).toBe(true);
    expect(spec!.minerals.length).toBeGreaterThan(0);

    // The card CTA must flip from the add button to the pantry indicator
    // on the same page render (onSaved calls refetchAndRender).
    const importedCard = page.locator(`.rx-recipe-card[data-slug="${slug}"]`).first();
    await expect(importedCard.locator(".rx-card-stock-add")).toHaveCount(0);
    await expect(importedCard.locator(".rx-card-stock-imported")).toBeVisible();

    // After a full page reload the pantry state must still show (persisted to
    // localStorage, not in-memory only).
    await page.reload();
    await expect(page.locator(".rx-recipe-card").first()).toBeVisible({ timeout: 10000 });
    const reloadedCard = page.locator(`.rx-recipe-card[data-slug="${slug}"]`).first();
    await expect(reloadedCard.locator(".rx-card-stock-add")).toHaveCount(0);
    await expect(reloadedCard.locator(".rx-card-stock-imported")).toBeVisible();
  });

  test("DERIVE path — ion-derived formula opens editor + persists with createdFrom marker", async ({
    page,
  }) => {
    // Find the first card WITHOUT a hand-authored formula — those use the
    // derive flow (onDeriveStock calls deriveStockFormulaFromTarget at click
    // time). Identified by absence of .rx-card-stock-formula and presence of
    // .rx-card-stock-add. Library rows like Cafelytic Filter, Hendon, SCA all
    // qualify.
    const card = page
      .locator(".rx-recipe-card", {
        has: page.locator(".rx-card-stock-add"),
        hasNot: page.locator(".rx-card-stock-formula"),
      })
      .first();
    await expect(card).toBeVisible({ timeout: 10000 });
    const slug = await card.getAttribute("data-slug");
    expect(slug).toBeTruthy();

    const deriveBtn = card.locator(".rx-card-stock-add");
    await expect(deriveBtn).toHaveText("+ Create Concentrate");
    await deriveBtn.click();

    // Editor opens with the overlay visible and a derive-hint banner.
    await expect(page.locator(".stock-editor-overlay")).toBeVisible();
    await expect(page.locator(".stock-editor-form .stock-derive-hint")).toContainText(
      /Auto-derived from/,
    );

    // The derivation must have produced at least one mineral row and a
    // positive bottle volume.
    const mineralRows = page.locator(".stock-editor-form .stock-mineral-row");
    await expect(mineralRows).toHaveCount(await mineralRows.count());
    expect(await mineralRows.count()).toBeGreaterThan(0);

    const bottleMl = await page.locator("#stock-editor-bottle-ml").inputValue();
    expect(Number(bottleMl)).toBeGreaterThan(0);

    // Overwrite the label, then save.
    await page.locator("#stock-editor-label").fill("E2E Derived Concentrate");
    await page.locator('.stock-editor-form [data-action="save"]').click();

    await expect(page.locator(".stock-editor-overlay")).toBeHidden();

    // The spec is stored somewhere under cw_stock_concentrate_specs with
    // createdFrom: "derived:<slug>".
    const storedSpec = await page.evaluate((s) => {
      const raw = localStorage.getItem("cw_stock_concentrate_specs");
      if (!raw) return null;
      const all = JSON.parse(raw) as Record<
        string,
        { label: string; minerals: unknown[]; createdFrom?: string }
      >;
      const keys = Object.keys(all);
      return keys.map((k) => all[k]).find((v) => v.createdFrom === `derived:${s}`) ?? null;
    }, slug);
    expect(storedSpec).toBeTruthy();
    expect(storedSpec!.label).toBe("E2E Derived Concentrate");
    expect(storedSpec!.createdFrom).toBe(`derived:${slug}`);
    expect(Array.isArray(storedSpec!.minerals)).toBe(true);
    expect(storedSpec!.minerals.length).toBeGreaterThan(0);

    // Card CTA flips to the pantry indicator.
    const derivedCard = page.locator(`.rx-recipe-card[data-slug="${slug}"]`).first();
    await expect(derivedCard.locator(".rx-card-stock-add")).toHaveCount(0);
    await expect(derivedCard.locator(".rx-card-stock-imported")).toBeVisible();
  });

  test("VALIDATION guard — empty label blocks save and surfaces error", async ({ page }) => {
    // Open the editor via the first available import-path card (quickest to
    // reach; both paths share the same save handler and validation gates in
    // stock-editor.js:344-360).
    const card = page
      .locator(".rx-recipe-card", { has: page.locator(".rx-card-stock-formula") })
      .first();
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.locator(".rx-card-stock-add").click();
    await expect(page.locator(".stock-editor-overlay")).toBeVisible();

    // Clear the label and attempt to save.
    await page.locator("#stock-editor-label").fill("");
    await page.locator('.stock-editor-form [data-action="save"]').click();

    // The error region must appear with a non-empty message (stock-editor.js:345:
    // showError("Please enter a name.")).
    const errorEl = page.locator(".stock-editor-form .stock-editor-error");
    await expect(errorEl).toBeVisible();
    await expect(errorEl).not.toBeEmpty();

    // The overlay stays open — save was blocked.
    await expect(page.locator(".stock-editor-overlay")).toBeVisible();

    // Nothing was written to localStorage.
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem("cw_stock_concentrate_specs");
      return raw ? Object.keys(JSON.parse(raw)) : [];
    });
    expect(stored).toHaveLength(0);
  });
});
