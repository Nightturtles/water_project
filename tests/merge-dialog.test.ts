// Unit tests for the first-sign-in merge prompt's wording (src/lib/merge-dialog.ts).
//
// The dialog tells the user what each choice adds, replaces or removes, so the
// diff and the sentences built from it are pinned here. They describe what
// handleFirstLoginMerge does for each choice; if that changes, these change.

import { describe, test, expect } from "vitest";
import { summarizeMerge, describeMergeOptions } from "../src/lib/merge-dialog";
import type { MergeItem } from "../src/lib/merge-dialog";

function item(key: string, name: string, fingerprint = "v1"): MergeItem {
  return { key, name, fingerprint };
}

const EMPTY_LOCAL = {
  recipes: [],
  waters: [],
  concentrates: [],
  deletedRecipeKeys: [],
  deletedWaterKeys: [],
};
const EMPTY_CLOUD = { recipes: [], waters: [], concentrates: [] };

describe("summarizeMerge", () => {
  test("sorts items into device-only, account-only and differing", () => {
    const summary = summarizeMerge(
      {
        ...EMPTY_LOCAL,
        recipes: [item("a", "Alpha"), item("b", "Bravo", "local"), item("c", "Charlie")],
      },
      {
        ...EMPTY_CLOUD,
        recipes: [item("b", "Bravo", "cloud"), item("c", "Charlie"), item("d", "Delta")],
      },
    );
    expect(summary.recipes).toEqual({
      localOnly: ["Alpha"],
      cloudOnly: ["Delta"],
      differing: ["Bravo"],
      deletedHere: [],
    });
  });

  test("an account item deleted on this device is reported as deleted, not account-only", () => {
    const summary = summarizeMerge(
      { ...EMPTY_LOCAL, deletedWaterKeys: ["tap"] },
      { ...EMPTY_CLOUD, waters: [item("tap", "Tap"), item("well", "Well")] },
    );
    expect(summary.waters.deletedHere).toEqual(["Tap"]);
    expect(summary.waters.cloudOnly).toEqual(["Well"]);
  });

  test("a stale local entry that is also tombstoned is not counted as device-only", () => {
    const summary = summarizeMerge(
      { ...EMPTY_LOCAL, recipes: [item("old", "Old")], deletedRecipeKeys: ["old"] },
      EMPTY_CLOUD,
    );
    expect(summary.recipes.localOnly).toEqual([]);
  });
});

describe("describeMergeOptions", () => {
  test("names what each choice adds, replaces and removes", () => {
    const copy = describeMergeOptions(
      summarizeMerge(
        {
          ...EMPTY_LOCAL,
          recipes: [item("a", "Alpha"), item("b", "Bravo", "local")],
          concentrates: [item("diy:epsom-salt", "Epsom Salt")],
        },
        {
          ...EMPTY_CLOUD,
          recipes: [item("b", "Bravo", "cloud")],
          waters: [item("fremont", "Fremont")],
        },
      ),
    );
    expect(copy.keepBoth).toEqual([
      "Adds to your account: 1 recipe (Alpha); 1 concentrate (Epsom Salt).",
      "Adds to this device: 1 starting water (Fremont).",
      "Replaces your account's version with this device's: 1 recipe (Bravo).",
      expect.stringMatching(/^This device's settings replace your account's/),
    ]);
    expect(copy.accountOnly).toEqual([
      "Removes from this device: 1 recipe (Alpha); 1 concentrate (Epsom Salt). This can't be undone.",
      "Replaces this device's version with your account's: 1 recipe (Bravo).",
      "Loads everything saved in your account onto this device.",
      expect.stringMatching(/^Your account's settings replace this device's/),
    ]);
  });

  test("says nothing is removed when the two sides only add to each other", () => {
    const copy = describeMergeOptions(
      summarizeMerge(
        { ...EMPTY_LOCAL, recipes: [item("a", "Alpha")] },
        { ...EMPTY_CLOUD, recipes: [item("d", "Delta")] },
      ),
    );
    expect(copy.keepBoth).toContain("Nothing saved on either side is removed.");
  });

  test("says so when nothing is saved only on this device", () => {
    const copy = describeMergeOptions(
      summarizeMerge(EMPTY_LOCAL, { ...EMPTY_CLOUD, recipes: [item("d", "Delta")] }),
    );
    expect(copy.accountOnly[0]).toBe(
      "No recipe, starting water or concentrate is removed from this device.",
    );
  });

  test("warns about deletes that Keep both carries to the account", () => {
    const copy = describeMergeOptions(
      summarizeMerge(
        { ...EMPTY_LOCAL, deletedRecipeKeys: ["d"] },
        { ...EMPTY_CLOUD, recipes: [item("d", "Delta")] },
      ),
    );
    expect(copy.keepBoth[0]).toBe(
      "Deletes from your account, because you deleted them on this device: 1 recipe (Delta).",
    );
  });

  test("truncates long name lists", () => {
    const recipes = ["A", "B", "C", "D", "E", "F"].map((n) => item(n, n));
    const copy = describeMergeOptions(summarizeMerge({ ...EMPTY_LOCAL, recipes }, EMPTY_CLOUD));
    expect(copy.keepBoth[0]).toBe("Adds to your account: 6 recipes (A, B, C, D, and 2 more).");
  });

  test("concentrates the account has no list for are added by Keep both and kept by Use account only", () => {
    const copy = describeMergeOptions(
      summarizeMerge(
        { ...EMPTY_LOCAL, concentrates: [item("diy:epsom-salt", "Epsom Salt")] },
        { ...EMPTY_CLOUD, keptLocalConcentrateKeys: ["diy:epsom-salt"] },
      ),
    );
    expect(copy.keepBoth[0]).toBe("Adds to your account: 1 concentrate (Epsom Salt).");
    expect(copy.accountOnly[0]).toBe(
      "No recipe, starting water or concentrate is removed from this device.",
    );
  });

  test("drafts: Keep both replaces them outright, Use account only just where the account has one", () => {
    const copy = describeMergeOptions(summarizeMerge(EMPTY_LOCAL, EMPTY_CLOUD));
    expect(copy.keepBoth[copy.keepBoth.length - 1]).toMatch(
      /Recipe Library picks, and unsaved drafts\.$/,
    );
    expect(copy.accountOnly[copy.accountOnly.length - 1]).toMatch(
      /replaced only where your account has one too\.$/,
    );
  });

  test("falls back to general wording when the account could not be read", () => {
    const copy = describeMergeOptions(null);
    expect(copy.keepBoth.join(" ")).toMatch(/this device's version replaces your account's/);
    expect(copy.accountOnly[0]).toMatch(/saved only on this device are removed/);
  });

  test("user-facing copy has no em-dashes", () => {
    const all = [
      describeMergeOptions(null),
      describeMergeOptions(summarizeMerge(EMPTY_LOCAL, EMPTY_CLOUD)),
    ]
      .flatMap((c) => c.keepBoth.concat(c.accountOnly))
      .join(" ");
    expect(all).not.toMatch(/—/);
  });
});
