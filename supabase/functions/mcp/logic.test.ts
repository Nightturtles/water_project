// Unit tests for the MCP server's pure helpers.
// Run with: deno test --allow-env --no-check (inside supabase/functions/)
import { strict as assert } from "node:assert";
import {
  analyze,
  buildRecipeInsert,
  buildRecipePatch,
  buildSourcePatch,
  buildSourceValues,
  cleanDescription,
  cleanName,
  ionBalance,
  type Ions,
  likeLiteral,
  mergeSourceWaters,
  pickProfileKey,
  recipeReadOnlyReason,
  recipeSummary,
  resolveIons,
  type SourceRow,
  type TargetRow,
  ToolError,
} from "./logic.ts";

const ME = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function recipeRow(over: Partial<TargetRow> = {}): TargetRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    user_id: ME,
    slug: "my-recipe",
    label: "My Recipe",
    brew_method: "filter",
    calcium: 20,
    magnesium: 10,
    alkalinity: 40,
    potassium: 0,
    sodium: 18,
    sulfate: 40,
    chloride: 35,
    bicarbonate: 49,
    description: "",
    is_public: false,
    creator_display_name: "",
    creator_user_id: ME,
    tags: [],
    roast: ["all"],
    ...over,
  };
}

const ZERO: Ions = {
  calcium: 0,
  magnesium: 0,
  potassium: 0,
  sodium: 0,
  sulfate: 0,
  chloride: 0,
  bicarbonate: 0,
};

// ---------------------------------------------------------------------------
// Ion input
// ---------------------------------------------------------------------------

Deno.test("resolveIons: missing ions are 0, alkalinity derives bicarbonate", () => {
  const ions = resolveIons({ calcium: 20, alkalinity: 40 });
  assert.equal(ions.calcium, 20);
  assert.equal(ions.magnesium, 0);
  assert.equal(ions.alkalinity, 40);
  // 40 mg/L as CaCO3 is 48.77 mg/L bicarbonate.
  assert.ok(Math.abs(ions.bicarbonate - 48.77) < 0.01);
});

Deno.test("resolveIons: bicarbonate derives alkalinity", () => {
  const ions = resolveIons({ bicarbonate: 61.017 });
  assert.ok(Math.abs(ions.alkalinity - 50.045) < 0.001);
});

Deno.test("resolveIons: refuses negative, non-finite and absurd values", () => {
  assert.throws(() => resolveIons({ calcium: -1 }), ToolError);
  assert.throws(() => resolveIons({ calcium: Number.NaN }), ToolError);
  assert.throws(() => resolveIons({ calcium: 20000 }), /above the 600 mg\/L limit/);
  assert.throws(() => resolveIons({ alkalinity: 99999 }), ToolError);
});

Deno.test("resolveIons: bicarbonate and alkalinity must agree when both are sent", () => {
  assert.throws(() => resolveIons({ bicarbonate: 10, alkalinity: 40 }), /disagree/);
  const ok = resolveIons({ bicarbonate: 48.8, alkalinity: 40 });
  assert.equal(ok.alkalinity, 40);
});

Deno.test("resolveIons: a pair inside the tolerance comes out exactly consistent", () => {
  // Alkalinity is kept and bicarbonate derived from it, so the headline KH and
  // the KH the ranges are judged on cannot differ.
  const ions = resolveIons({ bicarbonate: 158, alkalinity: 131.5 });
  assert.equal(ions.alkalinity, 131.5);
  assert.ok(Math.abs(ions.bicarbonate * (50.045 / 61.017) - 131.5) < 1e-9);
  const { alkalinity, ...rest } = ions;
  const a = analyze(rest, "filter", alkalinity);
  assert.equal(a.kh, 132);
  assert.ok(a.findings.some((f) => /KH/.test(f.message)), "KH above 130 is flagged");
});

Deno.test("stored recipes round-trip through the input check", () => {
  // 10.49 / 10.5 used to store as 10 and 11, a pair this server then refused.
  const ions = resolveIons({ bicarbonate: 10.49, alkalinity: 10.5 });
  const row = buildRecipeInsert(ME, "k", "K", "filter", ions, "", "2026-01-01T00:00:00Z");
  assert.doesNotThrow(() =>
    resolveIons({ bicarbonate: row.bicarbonate, alkalinity: row.alkalinity })
  );
  // Every whole-number alkalinity stores a pair that passes.
  for (let alk = 0; alk <= 400; alk++) {
    const r = buildRecipeInsert(ME, "k", "K", "filter", resolveIons({ alkalinity: alk }), "", "t");
    resolveIons({ bicarbonate: r.bicarbonate, alkalinity: r.alkalinity });
  }
});

Deno.test("buildRecipePatch: writes only the fields that were sent", () => {
  const base = { ...ZERO, calcium: 20, magnesium: 10, bicarbonate: 49, alkalinity: 40 };
  const descOnly = buildRecipePatch({ description: "New" }, resolveIons({}, base), "t");
  assert.deepEqual(descOnly, { description: "New", updated_at: "t" });

  const mgOnly = buildRecipePatch({ magnesium: 14.4 }, resolveIons({ magnesium: 14.4 }, base), "t");
  assert.deepEqual(mgOnly, { magnesium: 14, updated_at: "t" });

  const sent = { alkalinity: 50, brew_method: "espresso" as const };
  const alk = buildRecipePatch(sent, resolveIons(sent, base), "t");
  assert.deepEqual(alk, {
    alkalinity: 50,
    bicarbonate: 61,
    brew_method: "espresso",
    updated_at: "t",
  });

  assert.throws(() => buildRecipePatch({}, resolveIons({}, base), "t"), /Nothing to change/);
});

Deno.test("buildSourcePatch: writes only the ions that were sent", () => {
  const base = { ...ZERO, calcium: 20, magnesium: 8, bicarbonate: 90, alkalinity: 0 };
  const { alkalinity: _a, ...mg } = resolveIons({ magnesium: 9.127 }, base);
  assert.deepEqual(buildSourcePatch({ magnesium: 9.127 }, mg, "t"), {
    magnesium: 9.13,
    updated_at: "t",
  });

  const { alkalinity: _b, ...alk } = resolveIons({ alkalinity: 50 }, base);
  assert.deepEqual(buildSourcePatch({ alkalinity: 50 }, alk, "t"), {
    bicarbonate: 60.96,
    updated_at: "t",
  });

  const { alkalinity: _c, ...none } = resolveIons({}, base);
  assert.throws(() => buildSourcePatch({}, none, "t"), /Nothing to change/);
});

Deno.test("resolveIons: an update keeps the fields that were not sent", () => {
  const base = { ...ZERO, calcium: 20, magnesium: 10, bicarbonate: 49, alkalinity: 40 };
  const next = resolveIons({ magnesium: 14 }, base);
  assert.equal(next.calcium, 20);
  assert.equal(next.magnesium, 14);
  assert.equal(next.bicarbonate, 49);
  assert.equal(next.alkalinity, 40);
});

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

Deno.test("analyze: GH / KH / TDS match the app's formulas", () => {
  const a = analyze({ ...ZERO, calcium: 20, magnesium: 10, bicarbonate: 48.77 }, "filter", 40);
  // GH = 20 * 2.497 + 10 * 4.118 = 91; KH is the alkalinity.
  assert.equal(a.gh, 91);
  assert.equal(a.kh, 40);
  assert.equal(a.tds, 79);
});

Deno.test("analyze: a harsh water raises the app's range findings", () => {
  const a = analyze({ ...ZERO, calcium: 300, magnesium: 100, bicarbonate: 600 }, "filter");
  assert.ok(a.findings.length > 0);
  assert.ok(a.findings.some((f) => f.severity === "danger" || f.severity === "warn"));
});

Deno.test("ionBalance: a profile made from real salts balances", () => {
  // 1 mmol/L CaCl2 + 1 mmol/L NaHCO3.
  const b = ionBalance({ ...ZERO, calcium: 40.078, chloride: 70.906, sodium: 22.99, bicarbonate: 61.017 });
  assert.equal(b.balanced, true);
  assert.equal(b.note, null);
});

Deno.test("ionBalance: cations with no anions do not balance", () => {
  const b = ionBalance({ ...ZERO, calcium: 40, magnesium: 20 });
  assert.equal(b.balanced, false);
  assert.match(String(b.note), /Cations exceed anions/);
});

// ---------------------------------------------------------------------------
// Read-only rules
// ---------------------------------------------------------------------------

Deno.test("recipeReadOnlyReason: only the user's own private creations are editable", () => {
  assert.equal(recipeReadOnlyReason(recipeRow(), ME), null);
  assert.match(String(recipeReadOnlyReason(recipeRow({ is_public: true }), ME)), /published/);
  assert.match(String(recipeReadOnlyReason(recipeRow({ user_id: null }), ME)), /Recipe Library/);
  assert.match(String(recipeReadOnlyReason(recipeRow({ user_id: OTHER }), ME)), /Recipe Library/);
  assert.match(
    String(recipeReadOnlyReason(recipeRow({ creator_user_id: OTHER }), ME)),
    /someone else's recipe/,
  );
  assert.match(String(recipeReadOnlyReason(recipeRow({ slug: "sca" }), ME)), /built-in/);
});

Deno.test("recipeSummary: owner and active flag", () => {
  const mine = recipeSummary(recipeRow(), ME, "my-recipe");
  assert.equal(mine.owner, "mine");
  assert.equal((mine as { active_in_app: boolean }).active_in_app, true);
  assert.equal(recipeSummary(recipeRow({ user_id: null }), ME).owner, "library");
  assert.equal(recipeSummary(recipeRow({ user_id: OTHER }), ME).owner, "community");
});

// ---------------------------------------------------------------------------
// Names and keys
// ---------------------------------------------------------------------------

const KEY_OPTS = {
  kind: "recipe" as const,
  reservedKeys: ["sca", "custom"],
  existingKeys: ["morning-cup"],
  existingLabels: ["Morning Cup", "Library Classic"],
  retiredKeys: ["old-recipe", "community-slug"],
};

Deno.test("pickProfileKey: a fresh name gets its slug", () => {
  assert.equal(pickProfileKey("Bright Filter", KEY_OPTS), "bright-filter");
});

Deno.test("pickProfileKey: reserved and duplicate names are refused", () => {
  assert.throws(() => pickProfileKey("SCA", KEY_OPTS), /reserved/);
  assert.throws(() => pickProfileKey("morning cup", KEY_OPTS), /already exists/);
  assert.throws(() => pickProfileKey("library classic", KEY_OPTS), /already exists/);
  assert.throws(() => pickProfileKey("!!!", KEY_OPTS), ToolError);
});

Deno.test("pickProfileKey: a deleted or library key is never reused", () => {
  // Reusing a deleted key would get the new row deleted by the next sync of
  // any device that still holds the deletion record.
  assert.equal(pickProfileKey("Old Recipe", KEY_OPTS), "old-recipe-2");
  assert.equal(pickProfileKey("Community Slug", KEY_OPTS), "community-slug-2");
});

Deno.test("pickProfileKey: object property names are never issued as keys", () => {
  // The app's plain-object lookups read these as built-ins and drop the row.
  assert.equal(pickProfileKey("Constructor", KEY_OPTS), "constructor-2");
  assert.equal(pickProfileKey("toString", KEY_OPTS), "tostring-2");
  assert.equal(pickProfileKey("valueOf", KEY_OPTS), "valueof-2");
});

Deno.test("likeLiteral: wildcards in a name match only themselves", () => {
  assert.equal(likeLiteral("50% off_now"), "50\\% off\\_now");
  assert.equal(likeLiteral("a\\b"), "a\\\\b");
  assert.equal(likeLiteral("Bright Cup"), "Bright Cup");
});

Deno.test("cleanName / cleanDescription: limits match the app's inputs", () => {
  assert.equal(cleanName("  Bright   Filter "), "Bright Filter");
  assert.throws(() => cleanName("   "), ToolError);
  assert.throws(() => cleanName("x".repeat(41)), /limit is 40/);
  assert.equal(cleanDescription(undefined), "");
  assert.throws(() => cleanDescription("x".repeat(201)), /limit is 200/);
});

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

Deno.test("buildRecipeInsert: always private, attributed to the caller, whole numbers", () => {
  const ions = resolveIons({ calcium: 20.4, magnesium: 10.6, alkalinity: 40 });
  const row = buildRecipeInsert(ME, "bright", "Bright", "filter", ions, "d", "2026-01-01T00:00:00Z");
  assert.equal(row.is_public, false);
  assert.equal(row.user_id, ME);
  assert.equal(row.creator_user_id, ME);
  assert.equal(row.calcium, 20);
  assert.equal(row.magnesium, 11);
  assert.equal(row.alkalinity, 40);
  assert.equal(row.bicarbonate, 49);
  assert.deepEqual(row.roast, ["all"]);
  // No tray / is_starter: the database defaults apply, and the restrictive
  // policy refuses anything else from an AI-app login.
  assert.equal("tray" in row, false);
  assert.equal("is_starter" in row, false);
});

Deno.test("buildSourceValues: two decimals", () => {
  assert.equal(buildSourceValues({ ...ZERO, calcium: 31.256 }).calcium, 31.26);
});

Deno.test("mergeSourceWaters: built-ins, removed built-ins, overrides and saved waters", () => {
  const rows: SourceRow[] = [
    {
      id: "s1",
      user_id: ME,
      slug: "my-tap",
      label: "My Tap",
      calcium: 30,
      magnesium: 8,
      potassium: 0,
      sodium: 12,
      sulfate: 15,
      chloride: 20,
      bicarbonate: 90,
    },
    {
      id: "s2",
      user_id: ME,
      slug: "soft-tap",
      label: "Soft Tap Water",
      calcium: 99,
      magnesium: 0,
      potassium: 0,
      sodium: 0,
      sulfate: 0,
      chloride: 0,
      bicarbonate: 0,
    },
    {
      id: "s3",
      user_id: ME,
      slug: "gone",
      label: "Gone",
      calcium: 1,
      magnesium: 0,
      potassium: 0,
      sodium: 0,
      sulfate: 0,
      chloride: 0,
      bicarbonate: 0,
    },
  ];
  const waters = mergeSourceWaters(rows, ["distilled", "gone"], "my-tap");
  const byKey = new Map(waters.map((w) => [w.key, w]));
  assert.equal(byKey.has("distilled"), false, "a removed built-in is hidden");
  assert.equal(byKey.has("gone"), false, "a deleted saved water is hidden");
  assert.equal(byKey.has("custom"), false);
  assert.equal(byKey.get("soft-tap")?.ions.calcium, 99, "the user's edit of a built-in wins");
  assert.equal(byKey.get("soft-tap")?.editable, false);
  assert.equal(byKey.get("my-tap")?.kind, "saved");
  assert.equal(byKey.get("my-tap")?.editable, true);
  assert.equal(byKey.get("my-tap")?.active_in_app, true);
});
