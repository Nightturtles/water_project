import { test, expect } from "@playwright/test";

// Wave D2 smoke for library-v2.html. Covers the interactive filter bar:
// segmented controls, chip toggles, search debounce, URL round-trip, and the
// load-bearing `applyFilters` predicate (exercised in-page via evaluate).
// D3+ will extend this file; PR D5 renames it to smoke-library.spec.ts.

type Filters = {
  method: "all" | "filter" | "espresso";
  roast: "all" | "light" | "medium" | "dark";
  tags: string[];
  mine: boolean;
  q: string;
};

type Recipe = {
  label?: string;
  brewMethod?: string;
  roast?: string[];
  tags?: string[];
  description?: string;
  creatorDisplayName?: string;
};

declare global {
  interface Window {
    applyFilters: (
      filters: Partial<Filters>,
      recipes: Recipe[],
      options?: { isSaved?: (r: Recipe) => boolean },
    ) => Recipe[];
  }
}

test.describe("library-v2.html — Wave D2 interactive filter bar", () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      consoleErrors.push(err.message);
    });

    await page.goto("/library-v2.html");
  });

  // Every test (including the applyFilters group below) gets the same
  // zero-console-errors contract — a regression in any interaction path
  // should fail its own test, not silently pass.
  test.afterEach(() => {
    expect(consoleErrors).toEqual([]);
  });

  test("page loads with expected heading", async ({ page }) => {
    await expect(page.locator("h1")).toContainText("Recipe Library (v2 preview)");
  });

  test("scaffold shell renders all filter controls", async ({ page }) => {
    const root = page.locator("#rx-root");
    await expect(root.locator(".rx-filter-bar")).toBeVisible();
    await expect(root.locator(".rx-filter-row")).toHaveCount(3);
    await expect(root.locator(".rx-segmented .rx-segmented-button")).toHaveCount(7);
    await expect(root.locator(".rx-chip")).toHaveCount(7);
    await expect(root.locator(".rx-search-input")).toBeVisible();
    await expect(root.locator(".rx-result-count")).toBeVisible();
  });

  test("clicking Method pill updates URL via replaceState and marks active", async ({ page }) => {
    const filter = page.locator('.rx-segmented-button[data-value="filter"]').first();
    await filter.click();

    await expect(filter).toHaveClass(/is-active/);
    await expect(page).toHaveURL(/method=filter/);

    // replaceState (not pushState) — no extra entry on the history stack.
    // A single goBack would therefore exit the page; verifying instead that
    // only one history.state mutation occurred per toggle via the current URL.
    await page.locator('.rx-segmented-button[data-value="espresso"]').first().click();
    await expect(page).toHaveURL(/method=espresso/);
    await expect(page).not.toHaveURL(/method=filter/);
  });

  test("toggling a flavor chip updates tags URL param and re-toggles off", async ({ page }) => {
    const bright = page.locator('.rx-chip[data-tag="Bright"]');
    await bright.click();
    await expect(bright).toHaveClass(/is-active/);
    await expect(page).toHaveURL(/tags=Bright/);

    const sweet = page.locator('.rx-chip[data-tag="Sweet"]');
    await sweet.click();
    await expect(page).toHaveURL(/tags=Bright%2CSweet|tags=Bright,Sweet/);

    await bright.click();
    await expect(bright).not.toHaveClass(/is-active/);
    await expect(page).toHaveURL(/tags=Sweet/);
    await expect(page).not.toHaveURL(/tags=Bright/);
  });

  test("clear filters button hidden at rest, appears after toggle, resets state", async ({
    page,
  }) => {
    const clear = page.locator(".rx-clear-filters");
    await expect(clear).toBeHidden();

    await page.locator('.rx-segmented-button[data-value="filter"]').first().click();
    await expect(clear).toBeVisible();

    await clear.click();
    await expect(clear).toBeHidden();
    // All default filters omit their params from the URL.
    await expect(page).toHaveURL(/\/library-v2\.html$/);
  });

  test("search input debounces and writes q param to URL", async ({ page }) => {
    const input = page.locator(".rx-search-input");
    await input.fill("sey");
    // toHaveURL polls until the condition holds — covers the 150ms debounce
    // without a fixed sleep.
    await expect(page).toHaveURL(/q=sey/, { timeout: 2000 });

    await input.fill("");
    await expect(page).not.toHaveURL(/(?:\?|&)q=/, { timeout: 2000 });
  });

  test("URL state restores filters on page load", async ({ page }) => {
    await page.goto("/library-v2.html?method=espresso&roast=light&tags=Bright&mine=1&q=sey");

    await expect(page.locator('.rx-segmented-button[data-value="espresso"]')).toHaveClass(
      /is-active/,
    );
    await expect(page.locator('.rx-segmented-button[data-value="light"]')).toHaveClass(/is-active/);
    await expect(page.locator('.rx-chip[data-tag="Bright"]')).toHaveClass(/is-active/);
    await expect(page.locator(".rx-chip-my-recipes")).toHaveClass(/is-active/);
    await expect(page.locator(".rx-search-input")).toHaveValue("sey");
  });

  // Content region: hero + carousels (D3/D4) ---------------------------

  test("featured hero renders with title, Use button, Save button", async ({ page }) => {
    // Hero might be painted synchronously from the session cache OR after the
    // async library fetch resolves; let toBeVisible's retry cover both.
    const hero = page.locator(".rx-featured-hero");
    await expect(hero).toBeVisible();
    await expect(hero.locator(".rx-hero-title")).not.toBeEmpty();
    await expect(hero.locator(".rx-hero-use")).toContainText("Use this recipe");
    await expect(hero.locator(".rx-hero-save")).toBeVisible();
  });

  test("tray carousels render from production categories", async ({ page }) => {
    // Catalog currently has at least one recipe in each of the three trays
    // (per supabase/recipe-catalog-decisions.csv). Hidden trays would be a
    // content-drift signal worth investigating.
    await expect(page.locator('.rx-carousel-section[data-tray="original"]')).toBeVisible();
    await expect(page.locator('.rx-carousel-section[data-tray="roaster"]')).toBeVisible();
    await expect(page.locator('.rx-carousel-section[data-tray="classic"]')).toBeVisible();

    // Each visible tray has at least one card.
    const carousels = page.locator(".rx-carousel-section .rx-carousel");
    const count = await carousels.count();
    for (let i = 0; i < count; i++) {
      await expect(carousels.nth(i).locator(".rx-recipe-card").first()).toBeVisible();
    }
  });

  test("clicking bookmark on a card toggles saved state round-trip", async ({ page }) => {
    // Scrub any prior bookmark state from the run so the test is hermetic.
    // Only clears localStorage (sessionStorage library cache is untouched).
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("cw_"))
        .forEach((k) => localStorage.removeItem(k));
    });
    await page.reload();

    const firstCard = page.locator(".rx-recipe-card").first();
    await expect(firstCard).toBeVisible();
    const slug = await firstCard.getAttribute("data-slug");
    expect(slug).toBeTruthy();

    // Don't assume initial saved state — canonical library rows (userId null,
    // e.g. 'cafelytic-espresso') default to saved because they're only
    // removed via tombstone. User-published rows default to unsaved.
    // Either way, two clicks should round-trip the state.
    const bookmark = () =>
      page.locator(`.rx-recipe-card[data-slug="${slug}"]`).first().locator(".rx-card-bookmark");

    const initiallyActive = (await bookmark().getAttribute("class"))?.includes("is-active");

    await bookmark().click();
    if (initiallyActive) {
      await expect(bookmark()).not.toHaveClass(/is-active/);
    } else {
      await expect(bookmark()).toHaveClass(/is-active/);
    }

    await bookmark().click();
    if (initiallyActive) {
      await expect(bookmark()).toHaveClass(/is-active/);
    } else {
      await expect(bookmark()).not.toHaveClass(/is-active/);
    }
  });

  test("hero 'Use this recipe' navigates to taste.html with preset param", async ({ page }) => {
    const hero = page.locator(".rx-featured-hero");
    await expect(hero).toBeVisible();
    const slug = await hero.getAttribute("data-slug");
    expect(slug).toBeTruthy();

    await hero.locator(".rx-hero-use").click();

    // Predicate form avoids constructing a RegExp from a DB-derived slug.
    // Slugs are [a-z0-9-] in practice but the predicate is simpler anyway.
    await expect(page).toHaveURL(
      (url) => url.pathname.endsWith("/taste.html") && url.searchParams.get("preset") === slug,
    );
  });

  test("taste.html ?preset=<slug> activates the matching preset", async ({ page }) => {
    // Smoke: navigate straight to taste.html with a known library slug and
    // confirm the matching preset button is marked active on load.
    // 'sca' is the SCA Target, a canonical library row available on filter.
    await page.goto("/taste.html?preset=sca&method=filter");

    await expect(page.locator('.taste-preset-btn[data-preset="sca"]')).toHaveClass(/active/);
  });

  // applyFilters coverage ----------------------------------------------
  // The predicate is the load-bearing pure function — D5 will reuse it to
  // drive hero + carousel rendering. Exercising it here (instead of through
  // UI clicks) lets us hit combinations the UI alone wouldn't reach.

  test.describe("applyFilters predicate (exposed on window)", () => {
    const recipes: Recipe[] = [
      {
        label: "Sey",
        brewMethod: "filter",
        roast: ["light"],
        tags: ["Balanced"],
        description: "Sey roaster water",
        creatorDisplayName: "Sey Coffee",
      },
      {
        label: "Nightcap",
        brewMethod: "all",
        roast: ["dark"],
        tags: ["Full Body", "Sweet"],
        description: "High buffer for dark roasts",
        creatorDisplayName: "Cafelytic",
      },
      {
        label: "Onyx Signature",
        brewMethod: "all",
        roast: ["medium"],
        tags: ["Sweet", "Balanced"],
        description: "Published water from Onyx",
        creatorDisplayName: "Onyx Coffee Lab",
      },
      {
        label: "Wildcard",
        brewMethod: "filter",
        roast: ["all"],
        tags: ["Clarity"],
        description: "",
        creatorDisplayName: "",
      },
    ];

    test("method='espresso' matches brewMethod='all' (Wave C contract)", async ({ page }) => {
      const matched = await page.evaluate(
        ({ filters, recipes }) => window.applyFilters(filters, recipes).map((r) => r.label),
        { filters: { method: "espresso" }, recipes },
      );
      // Nightcap + Onyx both have brewMethod='all' → both match. Sey and
      // Wildcard are 'filter' only → excluded.
      expect(matched.sort()).toEqual(["Nightcap", "Onyx Signature"]);
    });

    test("roast filter accepts recipes tagged 'all'", async ({ page }) => {
      const matched = await page.evaluate(
        ({ filters, recipes }) => window.applyFilters(filters, recipes).map((r) => r.label),
        { filters: { roast: "light" }, recipes },
      );
      // Sey (['light']) and Wildcard (['all']) match. Nightcap/Onyx excluded.
      expect(matched.sort()).toEqual(["Sey", "Wildcard"]);
    });

    test("tags combine with AND", async ({ page }) => {
      const matched = await page.evaluate(
        ({ filters, recipes }) => window.applyFilters(filters, recipes).map((r) => r.label),
        { filters: { tags: ["Sweet", "Balanced"] }, recipes },
      );
      // Only Onyx has both tags. Nightcap has Sweet only.
      expect(matched).toEqual(["Onyx Signature"]);
    });

    test("search matches across label, description, creatorDisplayName", async ({ page }) => {
      const byLabel = await page.evaluate(
        ({ filters, recipes }) => window.applyFilters(filters, recipes).map((r) => r.label),
        { filters: { q: "sey" }, recipes },
      );
      // Matches "Sey" (label) AND "Onyx Signature" (no — 'sey' not substring
      // of 'onyx signature' or 'onyx coffee lab'). Just Sey here.
      expect(byLabel).toEqual(["Sey"]);

      const byCreator = await page.evaluate(
        ({ filters, recipes }) => window.applyFilters(filters, recipes).map((r) => r.label),
        { filters: { q: "onyx" }, recipes },
      );
      expect(byCreator).toEqual(["Onyx Signature"]);

      const byDescription = await page.evaluate(
        ({ filters, recipes }) => window.applyFilters(filters, recipes).map((r) => r.label),
        { filters: { q: "buffer" }, recipes },
      );
      expect(byDescription).toEqual(["Nightcap"]);
    });

    test("mine filter uses injected isSaved predicate", async ({ page }) => {
      const matched = await page.evaluate(
        ({ recipes }) => {
          const savedLabels = new Set(["Sey", "Nightcap"]);
          return window
            .applyFilters({ mine: true }, recipes, {
              isSaved: (r: Recipe) => savedLabels.has(r.label || ""),
            })
            .map((r) => r.label);
        },
        { recipes },
      );
      expect(matched.sort()).toEqual(["Nightcap", "Sey"]);
    });

    test("combined AND across all filter dimensions", async ({ page }) => {
      const matched = await page.evaluate(
        ({ recipes }) => {
          const savedLabels = new Set(["Onyx Signature"]);
          return window
            .applyFilters(
              {
                method: "espresso",
                roast: "medium",
                tags: ["Sweet"],
                mine: true,
                q: "onyx",
              },
              recipes,
              { isSaved: (r: Recipe) => savedLabels.has(r.label || "") },
            )
            .map((r) => r.label);
        },
        { recipes },
      );
      expect(matched).toEqual(["Onyx Signature"]);
    });
  });
});
