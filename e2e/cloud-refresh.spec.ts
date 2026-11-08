import { test, expect, type Page } from "@playwright/test";
import { stubLoggedIn } from "./_auth-stub";

// A cloud pull (another device's change) dispatches cw:cloud-data-changed and
// the pages re-read what they rendered from. These cover two ways that went
// wrong: a source-water edit still inside its 300 ms save debounce was
// reverted (and a pulled change to another field could be written back over),
// and the Recipe Builder reloaded while the user was typing in a field it
// didn't think of as a recipe field.
//
// The pull is simulated in the page: write storage the way a pull would, then
// dispatch the event. stubLoggedIn keeps sync inert, so nothing reaches
// Supabase (see e2e/_auth-stub.ts).

declare global {
  interface Window {
    __beforeReload?: boolean;
  }
}

test.describe("cloud pull refresh", () => {
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

  test("calculator: a source-water edit inside the save debounce survives a pull that changed another field", async ({
    page,
  }) => {
    await page.goto("/index.html");
    await page.evaluate(() => {
      const ca = document.getElementById("src-calcium") as HTMLInputElement;
      ca.value = "12";
      ca.dispatchEvent(new Event("input", { bubbles: true }));
      // Another device's change lands before the 300 ms save fires.
      // @ts-expect-error - globals from storage.ts
      saveSourceWater({ ...loadSourceWater(), magnesium: 7 });
      window.dispatchEvent(new CustomEvent("cw:cloud-data-changed"));
    });
    // Wait for the debounced save to land in storage.
    await expect
      .poll(() =>
        page.evaluate(() => {
          // @ts-expect-error - global from storage.ts
          return Number(loadSourceWater().calcium);
        }),
      )
      .toBe(12);
    const state = await page.evaluate(() => ({
      // @ts-expect-error - global from storage.ts
      stored: loadSourceWater() as Record<string, number>,
      ca: (document.getElementById("src-calcium") as HTMLInputElement).value,
      mg: (document.getElementById("src-magnesium") as HTMLInputElement).value,
    }));
    expect(Number(state.stored.calcium)).toBe(12);
    expect(Number(state.stored.magnesium)).toBe(7);
    expect(state.ca).toBe("12");
    expect(state.mg).toBe("7");
  });

  // Another device changed a recipe amount: write the draft key a pull writes
  // and announce it.
  async function pullDraftChange(page: Page): Promise<void> {
    await page.evaluate(() => {
      window.__beforeReload = true;
      // @ts-expect-error - global from storage.ts
      const raw = _getTransient("cw_recipe_mineral_inputs");
      const drafts = raw ? JSON.parse(raw) : {};
      // @ts-expect-error - global from storage.ts
      _setTransient(
        "cw_recipe_mineral_inputs",
        JSON.stringify({ ...drafts, "epsom-salt": "0.37" }),
      );
      window.dispatchEvent(new CustomEvent("cw:cloud-data-changed"));
    });
  }

  test("recipe builder: a pull that changed the drafts waits for focus to leave a source-water field, then reloads", async ({
    page,
  }) => {
    // Custom Starting Water: its values persist, so the reload keeps the edit.
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__seededCustomSource")) return;
      sessionStorage.setItem("__seededCustomSource", "1");
      localStorage.setItem("cw_source_preset", "custom");
    });
    await page.goto("/recipe.html");
    await page.locator("#src-calcium").fill("9");
    await pullDraftChange(page);
    // Still typing in a source field: no reload yet. The reload decision runs
    // synchronously on the event and its retries on setTimeout(0) after a
    // focus change or click, so 400 ms is far past any reload it would make.
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__beforeReload === true)).toBe(true);
    await expect(page.locator("#src-calcium")).toBeFocused();

    // Focus leaves the field: the page reloads to show the pulled drafts.
    await Promise.all([page.waitForEvent("load"), page.locator("h1").click()]);
    expect(await page.evaluate(() => window.__beforeReload === undefined)).toBe(true);
    const after = await page.evaluate(() => ({
      // @ts-expect-error - global from storage.ts
      calcium: Number(loadSourceWater().calcium),
      // @ts-expect-error - global from storage.ts
      epsom: JSON.parse(_getTransient("cw_recipe_mineral_inputs") || "{}")["epsom-salt"],
    }));
    expect(after.calcium).toBe(9);
    expect(after.epsom).toBe("0.37");
  });

  test("recipe builder: a closed dialog hidden with visibility (the native More sheet) doesn't hold the reload", async ({
    page,
  }) => {
    await page.goto("/recipe.html");
    // The native app's More sheet stays in the DOM when closed, hidden by
    // visibility + transform (style.css .more-sheet) rather than display.
    await page.evaluate(() => {
      const sheet = document.createElement("div");
      sheet.className = "more-sheet";
      sheet.setAttribute("role", "dialog");
      sheet.setAttribute("aria-modal", "true");
      sheet.textContent = "More";
      document.body.appendChild(sheet);
    });
    // The reload can tear down the page mid-evaluate; only that is expected.
    const reloadedMidEvaluate = (e: Error) => {
      if (!/Execution context was destroyed/.test(String(e && e.message))) throw e;
    };
    await Promise.all([
      page.waitForEvent("load"),
      pullDraftChange(page).catch(reloadedMidEvaluate),
    ]);
    expect(await page.evaluate(() => window.__beforeReload === undefined)).toBe(true);
  });

  test("recipe builder: unsaved edits to a named Starting Water preset hold the reload", async ({
    page,
  }) => {
    await page.goto("/recipe.html");
    await page.getByRole("button", { name: "Edit Starting Water" }).click();
    await page.locator("#src-calcium").fill("9");
    await pullDraftChange(page);
    // Focus leaves the field, but a reload would re-apply the preset and drop
    // the unsaved edit, so the page stays put.
    await page.locator("h1").click();
    // As above: any reload would already have happened by now.
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__beforeReload === true)).toBe(true);
    await expect(page.locator("#src-calcium")).toHaveValue("9");
  });

  test("taste: a pull that changed the selected preset shows it", async ({ page }) => {
    await page.goto("/taste.html");
    await expect(page.locator('#taste-presets [data-preset="cafelytic-filter"]')).toHaveClass(
      /active/,
    );
    await page.evaluate(() => {
      // Another device selected SCA; the pull stored it.
      // @ts-expect-error - global from storage.ts
      _setTransient("cw_target_preset", "sca");
      window.dispatchEvent(new CustomEvent("cw:cloud-data-changed"));
    });
    await expect(page.locator('#taste-presets [data-preset="sca"]')).toHaveClass(/active/);
  });
});
