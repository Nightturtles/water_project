import { test, expect } from "@playwright/test";

// Smoke suite for library.html (the Wave D recipe browser). Covers the
// interactive filter bar (segmented controls, chip toggles, search debounce,
// URL round-trip), the hero + tray carousels, bookmark toggle, filter-driven
// render + empty state, and the load-bearing `applyFilters` predicate
// exercised in-page via evaluate().

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

test.describe("library.html — Wave D recipe browser", () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      consoleErrors.push(err.message);
    });

    await page.goto("/library.html");
  });

  // Every test (including the applyFilters group below) gets the same
  // zero-console-errors contract — a regression in any interaction path
  // should fail its own test, not silently pass.
  test.afterEach(() => {
    expect(consoleErrors).toEqual([]);
  });

  test("page loads with expected heading", async ({ page }) => {
    await expect(page.locator("h1")).toContainText("Recipe Library");
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
    await expect(page).toHaveURL(/\/library\.html$/);
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
    await page.goto("/library.html?method=espresso&roast=light&tags=Bright&mine=1&q=sey");

    await expect(page.locator('.rx-segmented-button[data-value="espresso"]')).toHaveClass(
      /is-active/,
    );
    await expect(page.locator('.rx-segmented-button[data-value="light"]')).toHaveClass(/is-active/);
    await expect(page.locator('.rx-chip[data-tag="Bright"]')).toHaveClass(/is-active/);
    await expect(page.locator(".rx-chip-my-recipes")).toHaveClass(/is-active/);
    await expect(page.locator(".rx-search-input")).toHaveValue("sey");
  });

  // Content region: hero + carousels (D3/D4) ---------------------------

  test("featured tray renders as a single-card carousel with the library card UX", async ({
    page,
  }) => {
    // Featured is now a one-card carousel with the same card component as
    // every other tray — star bookmark in the header, no Use/Save buttons.
    // May paint from the session cache OR after async fetch; toBeVisible retries.
    const featured = page.locator('.rx-carousel-section[data-tray="featured"]');
    await expect(featured).toBeVisible();
    await expect(featured.locator(".rx-recipe-card")).toHaveCount(1);
    await expect(featured.locator(".rx-card-title")).not.toBeEmpty();
    await expect(featured.locator(".rx-card-bookmark")).toBeVisible();
  });

  test("tray carousels render from production categories", async ({ page }) => {
    // Catalog currently has at least one recipe in each of these trays
    // (per supabase/recipe-catalog-decisions.csv + migration 010). Hidden
    // trays would be a content-drift signal worth investigating.
    await expect(page.locator('.rx-carousel-section[data-tray="original"]')).toBeVisible();
    await expect(page.locator('.rx-carousel-section[data-tray="intro-water"]')).toBeVisible();
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

  test("cafelytic-filter appears in Featured AND Cafelytic Originals (default filters)", async ({
    page,
  }) => {
    // After migration 010, Cafelytic Filter's DB row lives in the Originals
    // tray. The client also renders it as Featured based on the brew method
    // filter (default method=all → cafelytic-filter). Both surfaces should
    // show the same card.
    const featured = page.locator('.rx-carousel-section[data-tray="featured"] .rx-recipe-card');
    await expect(featured).toHaveCount(1);
    await expect(featured).toHaveAttribute("data-slug", "cafelytic-filter");

    const original = page
      .locator('.rx-carousel-section[data-tray="original"] .rx-recipe-card[data-slug="cafelytic-filter"]');
    await expect(original).toHaveCount(1);
  });

  test("taste.html ?preset=<slug> activates the matching preset", async ({ page }) => {
    // Smoke: navigate straight to taste.html with a known library slug and
    // confirm the matching preset button is marked active on load.
    // 'sca' is the SCA Target — a canonical library row with brew_method='all'
    // (migration 009), so passing method=filter surfaces it in the filter rail.
    await page.goto("/taste.html?preset=sca&method=filter");

    await expect(page.locator('.taste-preset-btn[data-preset="sca"]')).toHaveClass(/active/);
  });

  // Filter-drives-render + empty state (D5) ----------------------------

  test("toggling Method=espresso narrows rendered cards", async ({ page }) => {
    const allCards = page.locator(".rx-recipe-card");
    await expect(allCards.first()).toBeVisible();
    const totalCount = await allCards.count();

    await page.locator('.rx-segmented-button[data-value="espresso"]').first().click();

    // Card count should drop (most recipes are filter-only). Require strictly
    // fewer to catch a regression where filters fail to drive the render.
    await expect.poll(async () => allCards.count(), { timeout: 2000 }).toBeLessThan(totalCount);
  });

  test("unmatched search query shows the empty state with a clear-filters CTA", async ({
    page,
  }) => {
    const input = page.locator(".rx-search-input");
    await input.fill("zzzxyyxzzqwerty");

    const emptyState = page.locator(".rx-empty-state");
    await expect(emptyState).toBeVisible({ timeout: 2000 });
    await expect(emptyState.locator(".rx-empty-title")).toContainText("No recipes match");

    // No featured, no carousels while empty state is up.
    await expect(page.locator('.rx-carousel-section[data-tray="featured"]')).toHaveCount(0);
    await expect(page.locator(".rx-carousel-section")).toHaveCount(0);

    // Clear-filters CTA inside the empty state resets state + URL.
    await emptyState.locator(".rx-empty-clear").click();
    await expect(emptyState).toHaveCount(0);
    await expect(page.locator('.rx-carousel-section[data-tray="featured"]')).toBeVisible();
    await expect(input).toHaveValue("");
  });

  test("method=espresso swaps Featured to Cafelytic Espresso", async ({ page }) => {
    // Client-side FEATURED_PICKS maps espresso→cafelytic-espresso so the
    // Featured tray stays populated when the method filter would exclude
    // the default (Cafelytic Filter).
    await page.locator('.rx-segmented-button[data-value="espresso"]').first().click();

    const featured = page.locator(
      '.rx-carousel-section[data-tray="featured"] .rx-recipe-card',
    );
    await expect(featured).toHaveCount(1);
    await expect(featured).toHaveAttribute("data-slug", "cafelytic-espresso");
  });

  test("owner Edit/Unpublish buttons not rendered for anonymous visitors", async ({ page }) => {
    // Signed-out run — no card should have owner affordances. But the
    // my-recipes-ui module IS loaded, ready to activate once a session
    // resolves via the deferred currentUserId fetch.
    await expect(page.locator(".rx-recipe-card").first()).toBeVisible();
    await expect(page.locator(".rx-card-owner-actions")).toHaveCount(0);
    await expect(page.locator(".rx-card-owner-btn")).toHaveCount(0);

    const fns = await page.evaluate(() => ({
      edit: typeof (window as unknown as { openEditRecipeModal?: unknown }).openEditRecipeModal,
      unpublish: typeof (window as unknown as { confirmUnpublish?: unknown }).confirmUnpublish,
    }));
    expect(fns.edit).toBe("function");
    expect(fns.unpublish).toBe("function");
  });

  test("owner affordances propagate through carousel cards when a session is present", async ({
    browser,
  }) => {
    // Stub getUser BEFORE any script runs so recipe-browser.js picks up a
    // fake signed-in session on mount. Exercising the carousel → card
    // handler-propagation path — the original D5 restore shipped a bug
    // where createTrayCarousel narrowed handlers and owner buttons never
    // rendered for anyone. This regression catches that class of mistake.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Mirror the suite-wide console-error capture onto this custom page.
    // Without this, runtime errors in the stubbed-session flow pass
    // silently through afterEach and a regression could ride green CI.
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      consoleErrors.push(err.message);
    });

    await page.addInitScript(() => {
      // Freeze the stub so supabase-client.js's later `window.getUser = ...`
      // assignment silently no-ops (non-strict) instead of clobbering the
      // fixture. Without this, the real impl wins and the stub never fires.
      Object.defineProperty(window, "getUser", {
        value: () => Promise.resolve({ data: { user: { id: "stub-user-for-e2e" } } }),
        writable: false,
        configurable: false,
      });
    });

    // We also need at least one recipe in the cached library whose userId
    // matches our stub. Seed sessionStorage with a fake owned recipe before
    // navigation so the browser picks it up synchronously on load.
    await page.addInitScript(() => {
      const fake = [
        {
          id: "fake-owned-id",
          user_id: "stub-user-for-e2e",
          slug: "fake-owned",
          label: "Fake Owned Recipe",
          brew_method: "filter",
          calcium: 20,
          magnesium: 10,
          alkalinity: 30,
          potassium: 5,
          sodium: 8,
          sulfate: 12,
          chloride: 14,
          bicarbonate: 20,
          description: "Seeded for the owner-path e2e.",
          creator_display_name: "Stub User",
          tags: ["Bright"],
          category: "classic",
          roast: ["light"],
          created_at: new Date().toISOString(),
        },
      ];
      sessionStorage.setItem("cw_library_public_recipes", JSON.stringify(fake));
    });

    await page.goto("/library.html");

    const ownedCard = page.locator('.rx-recipe-card[data-slug="fake-owned"]');
    await expect(ownedCard).toBeVisible();
    await expect(ownedCard.locator(".rx-card-owner-actions")).toBeVisible();
    await expect(ownedCard.locator(".rx-card-owner-btn")).toHaveCount(2);
    await expect(ownedCard.locator(".rx-card-owner-btn").nth(0)).toContainText("Edit");
    await expect(ownedCard.locator(".rx-card-owner-btn").nth(1)).toContainText("Unpublish");

    // Clicking Edit opens the modal (wired through handlers.onEditRecipe).
    await ownedCard.locator(".rx-card-owner-btn").nth(0).click();
    await expect(page.locator(".rx-edit-overlay")).toBeVisible();
    await expect(page.locator(".rx-edit-input").first()).toHaveValue("Fake Owned Recipe");

    // Brew method row is multi-select. Fixture recipe has brewMethod='filter'
    // (single string) so the Filter checkbox should be active and Espresso
    // inactive.
    const methodBtns = page.locator(".rx-edit-method .rx-edit-check-btn");
    await expect(methodBtns).toHaveCount(2);
    await expect(methodBtns.filter({ hasText: "Filter" })).toHaveClass(/is-active/);
    await expect(methodBtns.filter({ hasText: "Espresso" })).not.toHaveClass(/is-active/);

    // Roast row is multi-select. Fixture roast=['light'] → only Light active.
    const roastBtns = page.locator(".rx-edit-roast .rx-edit-check-btn");
    await expect(roastBtns).toHaveCount(3);
    await expect(roastBtns.filter({ hasText: "Light" })).toHaveClass(/is-active/);
    await expect(roastBtns.filter({ hasText: "Medium" })).not.toHaveClass(/is-active/);
    await expect(roastBtns.filter({ hasText: "Dark" })).not.toHaveClass(/is-active/);

    // Toggling Espresso on flips its active state (visual confirmation of
    // the multi-select wiring). Supabase write isn't exercised here — we
    // don't have a signed-in session, just a stubbed user id.
    await methodBtns.filter({ hasText: "Espresso" }).click();
    await expect(methodBtns.filter({ hasText: "Espresso" })).toHaveClass(/is-active/);
    await expect(methodBtns.filter({ hasText: "Filter" })).toHaveClass(/is-active/);

    // Un-checking everything on the brew method row surfaces the validator.
    await methodBtns.filter({ hasText: "Filter" }).click();
    await methodBtns.filter({ hasText: "Espresso" }).click();
    await page.locator(".rx-edit-save").click();
    await expect(page.locator(".rx-edit-error")).toContainText("Select at least one brew method");

    await ctx.close();
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
