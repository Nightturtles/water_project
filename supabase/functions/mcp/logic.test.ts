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
  doseLines,
  type DosingKit,
  type DosingResult,
  ionBalance,
  buildDiySpec,
  buildStockSpec,
  calciumChlorideFormFor,
  deriveFormula,
  diyView,
  kitFromSettings,
  pickDefaultSource,
  pickStockKey,
  saveConcentrateError,
  solubilityWarnings,
  stockKeyFromId,
  type StockSpec,
  stockView,
  type Ions,
  likeLiteral,
  mergeSourceWaters,
  pickProfileKey,
  pickVerifiedProfileKey,
  recipeReadOnlyReason,
  recipeSummary,
  resolveIons,
  type SourceRow,
  type TargetRow,
  ToolError,
} from "./logic.ts";
import { computeDoses } from "./app-core.gen.js";

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

Deno.test("a pair inside the tolerance: bicarbonate is kept, KH is judged on alkalinity", () => {
  const ions = resolveIons({ bicarbonate: 158, alkalinity: 131.5 });
  assert.equal(ions.bicarbonate, 158, "the supplied bicarbonate is not replaced");
  assert.equal(ions.alkalinity, 131.5);
  const { alkalinity, ...rest } = ions;
  const a = analyze(rest, "filter", alkalinity);
  // Headline KH and the KH finding agree (158 mg/L alone is KH 129.6, which
  // sits under the 130 line and would raise a milder finding or none).
  assert.equal(a.kh, 132);
  const onBicarbonate = analyze(rest, "filter");
  const kh = (r: typeof a) => JSON.stringify(r.findings.filter((f) => f.message.startsWith("KH ")));
  assert.notEqual(kh(a), kh(onBicarbonate), "the KH finding follows the alkalinity");
  assert.match(kh(a), /131\.5/);
  // Everything else is computed from the real ions.
  assert.equal(a.tds, 158);
  assert.deepEqual(a.ion_balance, onBicarbonate.ion_balance);
  assert.deepEqual(
    a.findings.filter((f) => !f.message.startsWith("KH ")),
    onBicarbonate.findings.filter((f) => !f.message.startsWith("KH ")),
  );
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

Deno.test("pickVerifiedProfileKey: finds a free key past what the bulk read returned", async () => {
  // 1,003 public keys share the prefix (bright, bright-2 ... bright-1003), but
  // the bulk read is capped at 1,000 rows and missed three of them, the base
  // key included.
  const taken = new Set(["bright"]);
  for (let i = 2; i <= 1003; i++) taken.add("bright-" + i);
  const missed = new Set(["bright", "bright-2", "bright-7"]);
  const seen = [...taken].filter((k) => !missed.has(k));
  assert.equal(seen.length, 1000);
  let lookups = 0;
  const key = await pickVerifiedProfileKey(
    "Bright",
    { ...KEY_OPTS, retiredKeys: seen },
    (k) => {
      lookups++;
      return Promise.resolve(taken.has(k));
    },
  );
  // Past "-999" the app's helper switches to a timestamp suffix; what matters
  // is that the key is free and starts from the name.
  assert.equal(taken.has(key), false, "the chosen key is not a public key");
  assert.match(key, /^bright-\d+$/);
  assert.equal(lookups, 4, "one direct check per candidate: three taken, one free");
});

Deno.test("pickVerifiedProfileKey: gives up with a clear message instead of looping", async () => {
  await assert.rejects(
    () => pickVerifiedProfileKey("Bright", KEY_OPTS, () => Promise.resolve(true)),
    /Choose a different name/,
  );
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

// ---------------------------------------------------------------------------
// Doses (calculate_doses)
// ---------------------------------------------------------------------------

const TARGET = { ...ZERO, calcium: 20, magnesium: 10, sulfate: 22, chloride: 20, bicarbonate: 49, alkalinity: 40 };

function doses(kit: DosingKit, volumeL = 1, sourceWater: Ions = ZERO): DosingResult {
  return computeDoses({ sourceWater, target: TARGET, volumeL, kit, recipeSlug: null }) as DosingResult;
}

Deno.test("kitFromSettings: no settings row means the app's starter minerals", () => {
  const kit = kitFromSettings(null);
  assert.deepEqual(kit.minerals, ["calcium-chloride", "epsom-salt", "baking-soda"]);
  assert.deepEqual(kit.concentrates, []);
  assert.deepEqual(kit.recipeConcentrates, []);
});

Deno.test("kitFromSettings: reads the synced row the way the app reads its storage", () => {
  const kit = kitFromSettings({
    selected_minerals: ["baking-soda"],
    selected_concentrates: ["diy:epsom-salt", "brand:lotus:calcium", "stock:house", "stock:gone", 7],
    diy_concentrate_specs: { "epsom-salt": { bottleMl: 59, gramsPerBottle: 13.5, dropMl: 0.072 } },
    stock_concentrate_specs: {
      house: {
        label: "House",
        bottleMl: 200,
        doseGramsPerL: 4,
        minerals: [{ mineralId: "calcium-chloride", grams: 1 }],
      },
    },
    lotus_dropper_type: "straight",
    lotus_concentrate_units: { "brand:lotus:calcium": "ml" },
  });
  assert.deepEqual(kit.minerals, ["baking-soda"]);
  assert.deepEqual(kit.concentrates.map((c) => [c.id, c.mineralId, c.dropMl, c.unit]), [
    ["diy:epsom-salt", "epsom-salt", 0.072, "drops"],
    ["brand:lotus:calcium", "calcium-chloride", 0.0386, "ml"],
  ]);
  assert.ok(Math.abs(kit.concentrates[0].gramsPerMl - 13.5 / 59) < 1e-12);
  // A selected Recipe Concentrate whose spec is gone is dropped, as in the app.
  assert.deepEqual(kit.recipeConcentrates.map((rc) => [rc.id, rc.dropMl, rc.unit]), [
    ["stock:house", 0, "ml"],
  ]);
});

Deno.test("kitFromSettings: a minerals list replaces the whole kit with those powders", () => {
  const kit = kitFromSettings(
    { selected_minerals: ["baking-soda"], selected_concentrates: ["brand:lotus:calcium"] },
    ["gypsum", "epsom-salt", "potassium-bicarbonate"],
  );
  assert.deepEqual(kit.minerals, ["gypsum", "epsom-salt", "potassium-bicarbonate"]);
  assert.deepEqual(kit.concentrates, []);
});

Deno.test("doseLines: powders in grams as the app's rows show them, zero rows left out", () => {
  const kit = kitFromSettings(null, [
    "calcium-chloride",
    "gypsum",
    "epsom-salt",
    "baking-soda",
  ]);
  const result = doses(kit, 2);
  assert.equal(result.status, "ok");
  const lines = doseLines(result, kit);
  assert.deepEqual(lines.map((l) => l.unit), lines.map(() => "g"));
  for (const line of lines) {
    assert.equal(line.amount, result.shown.mineralGrams[line.id]);
    assert.equal(line.amount, Number(line.amount.toFixed(2)), "two decimals, like the row");
    assert.ok(line.amount > 0);
  }
  assert.equal(lines.find((l) => l.id === "baking-soda")?.name, "Baking Soda");
});

Deno.test("doseLines: a concentrate with a dropper is given in whole drops, with the mL", () => {
  const kit = kitFromSettings({
    selected_minerals: ["baking-soda"],
    selected_concentrates: ["brand:lotus:calcium", "diy:epsom-salt"],
    diy_concentrate_specs: { "epsom-salt": { bottleMl: 100, gramsPerBottle: 20 } },
    lotus_dropper_type: "round",
  });
  const lines = doseLines(doses(kit), kit);
  const calcium = lines.find((l) => l.id === "brand:lotus:calcium");
  assert.equal(calcium?.type, "brand_concentrate");
  assert.equal(calcium?.unit, "drops");
  assert.equal(Number.isInteger(calcium?.amount), true);
  assert.ok(Math.abs((calcium?.ml ?? 0) - (calcium?.amount ?? 0) * 0.0716) < 0.001);
  // No dropper size saved: mL only.
  const epsom = lines.find((l) => l.id === "diy:epsom-salt");
  assert.equal(epsom?.type, "mineral_concentrate");
  assert.equal(epsom?.unit, "mL");
  assert.equal(epsom?.name, "Epsom Salt concentrate");
  assert.equal(epsom?.ml, undefined);
});

Deno.test("doseLines: Recipe Concentrate mode lists the concentrate and its top-up powders", () => {
  const kit = kitFromSettings({
    selected_minerals: ["baking-soda"],
    selected_concentrates: ["stock:house"],
    stock_concentrate_specs: {
      house: {
        label: "House",
        bottleMl: 200,
        doseGramsPerL: 4,
        minerals: [
          { mineralId: "epsom-salt", grams: 5 },
          { mineralId: "calcium-chloride", grams: 3.7 },
        ],
      },
    },
  });
  const result = doses(kit);
  assert.equal(result.mode, "recipe-concentrates");
  const lines = doseLines(result, kit);
  assert.equal(lines[0].type, "recipe_concentrate");
  assert.equal(lines[0].name, "House");
  assert.equal(lines[0].unit, "mL");
  const topUp = lines.find((l) => l.id === "baking-soda");
  assert.equal(topUp?.supplement, true, "alkalinity the concentrate lacks comes from the powder");
});

Deno.test("analyze: findings follow the salts the water was made with", () => {
  // Sodium 35 mg/L in filter water: a warning on a bare profile, acceptable
  // when baking soda supplies the alkalinity (the app's own band).
  const water = { ...ZERO, calcium: 20, magnesium: 10, sodium: 35, sulfate: 40, chloride: 35, bicarbonate: 49 };
  const sodium = (r: ReturnType<typeof analyze>) =>
    JSON.stringify(r.findings.filter((f) => /sodium/i.test(f.message)));
  const bare = analyze(water, "filter");
  const withBakingSoda = analyze(water, "filter", null, {
    alkalinitySources: ["baking-soda"],
    calciumSource: "calcium-chloride",
    magnesiumSource: "epsom-salt",
  });
  assert.match(sodium(bare), /"severity":"warn"/, "a bare profile gets the sodium warning");
  assert.equal(sodium(withBakingSoda), "[]", "with baking soda, 35 mg/L is inside the band");
});

Deno.test("doseLines: a dose under 0.01 g keeps a figure instead of rounding to 0", () => {
  // 10 mL of water wants about 0.00004 g of calcium chloride for 1 mg/L.
  const kit = kitFromSettings(null, ["calcium-chloride", "baking-soda"]);
  const result = computeDoses({
    sourceWater: ZERO,
    target: { ...ZERO, calcium: 1, alkalinity: 0 },
    volumeL: 0.01,
    kit,
    recipeSlug: null,
  }) as DosingResult;
  const line = doseLines(result, kit).find((l) => l.id === "calcium-chloride");
  assert.ok(line && line.amount > 0, "the dose is reported");
  assert.ok(Math.abs(line.amount - result.shown.mineralGrams["calcium-chloride"]) < 1e-6);
});

Deno.test("pickDefaultSource: the water the app's calculator is using", () => {
  const rows: SourceRow[] = [
    { id: "s1", user_id: ME, slug: "my-tap", label: "My Tap", ...ZERO, calcium: 30, bicarbonate: 90 },
  ];
  const waters = mergeSourceWaters(rows, [], "my-tap");
  const shown = { ...ZERO, calcium: 30, bicarbonate: 90 };

  // Selected profile, fields unchanged: the profile, no note.
  const plain = pickDefaultSource(waters, "my-tap", shown);
  assert.deepEqual([plain.id, plain.name, plain.ions.calcium, plain.note], ["s1", "My Tap", 30, null]);

  // Unsaved edits in the app: the edited values, and the reply says so.
  const edited = pickDefaultSource(waters, "my-tap", { ...shown, calcium: 44 });
  assert.equal(edited.ions.calcium, 44);
  assert.match(edited.note ?? "", /unsaved edits/);

  // Hand-typed water that was never saved.
  const custom = pickDefaultSource(waters, "custom", { ...ZERO, magnesium: 7 });
  assert.deepEqual([custom.key, custom.ions.magnesium], ["custom", 7]);
  assert.match(custom.note ?? "", /hand-entered/);

  // A newly saved profile whose own row has not synced yet: its values, not distilled.
  const pending = pickDefaultSource(waters, "new-well", { ...ZERO, calcium: 55 });
  assert.equal(pending.ions.calcium, 55);
  assert.match(pending.note ?? "", /not among the saved profiles yet/);

  // A new account with no selection starts on distilled, as the app does.
  const fresh = pickDefaultSource(waters, null, null);
  assert.deepEqual([fresh.key, fresh.note], ["distilled", null]);

  // Bad values are floored at 0, never passed through.
  const odd = pickDefaultSource(waters, "custom", { calcium: -5, magnesium: "x", sodium: 3 });
  assert.deepEqual([odd.ions.calcium, odd.ions.magnesium, odd.ions.sodium], [0, 0, 3]);

  // A selection that cannot be resolved at all is an error, not distilled.
  assert.throws(() => pickDefaultSource(waters, "gone", null), /could not be read/);
});

// ---------------------------------------------------------------------------
// Concentrates (phase 2)
// ---------------------------------------------------------------------------

const HOUSE: StockSpec = {
  label: "House",
  bottleMl: 200,
  doseGramsPerL: 4,
  dropMl: 0.05,
  minerals: [
    { mineralId: "epsom-salt", grams: 5 },
    { mineralId: "baking-soda", grams: 2 },
  ],
  createdFrom: "library:rao-perger",
  source: "Somewhere",
};

Deno.test("buildStockSpec: a new concentrate, checked and rounded like the app's editor", () => {
  const spec = buildStockSpec({
    name: "  Morning Bottle ",
    minerals: [{ mineral_id: "epsom-salt", grams: 4.126 }, { mineral_id: "gypsum", grams: 0.2 }],
    bottle_ml: 250,
    dose_ml_per_liter: 5,
    drop_ml: 0.04567,
  });
  assert.deepEqual(spec, {
    label: "Morning Bottle",
    bottleMl: 250,
    doseGramsPerL: 5,
    minerals: [{ mineralId: "epsom-salt", grams: 4.13 }, { mineralId: "gypsum", grams: 0.2 }],
    dropMl: 0.046,
  });
});

Deno.test("buildStockSpec: refuses bad input with a message the model can act on", () => {
  const base = {
    name: "X",
    minerals: [{ mineral_id: "epsom-salt", grams: 1 }],
    bottle_ml: 200,
    dose_ml_per_liter: 4,
  };
  assert.throws(() => buildStockSpec({ ...base, minerals: [] }), /at least one mineral/);
  assert.throws(
    () => buildStockSpec({ ...base, minerals: [{ mineral_id: "unobtainium", grams: 1 }] }),
    /not a mineral Cafelytic knows/,
  );
  assert.throws(
    () => buildStockSpec({ ...base, minerals: [base.minerals[0], base.minerals[0]] }),
    /listed twice/,
  );
  assert.throws(() => buildStockSpec({ ...base, bottle_ml: 0.2 }), /bottle_ml must be between/);
  assert.throws(
    () => buildStockSpec({ ...base, dose_ml_per_liter: 4000 }),
    /dose_ml_per_liter must be between/,
  );
  assert.throws(() => buildStockSpec({ ...base, drop_ml: 5 }), /drop_ml must be between/);
  assert.throws(() => buildStockSpec({ ...base, name: "   " }), ToolError);
  assert.throws(() => buildStockSpec({ minerals: base.minerals }), /name is required/);
});

Deno.test("buildStockSpec: an update changes only what was sent and keeps the origin", () => {
  assert.deepEqual(buildStockSpec({ dose_ml_per_liter: 3 }, HOUSE), { ...HOUSE, doseGramsPerL: 3 });
  // null removes the dropper size; leaving it out keeps it.
  const { dropMl: _d, ...noDropper } = HOUSE;
  assert.deepEqual(buildStockSpec({ drop_ml: null }, HOUSE), noDropper);
  const renamed = buildStockSpec(
    { name: "Renamed", minerals: [{ mineral_id: "gypsum", grams: 0.3 }] },
    HOUSE,
  );
  assert.equal(renamed.label, "Renamed");
  assert.deepEqual(renamed.minerals, [{ mineralId: "gypsum", grams: 0.3 }]);
  assert.equal(renamed.createdFrom, "library:rao-perger");
  assert.equal(renamed.source, "Somewhere");
});

Deno.test("buildDiySpec: new needs both values; an update keeps what was not sent", () => {
  assert.deepEqual(buildDiySpec({ bottle_ml: 59, grams_per_bottle: 13.5 }), {
    bottleMl: 59,
    gramsPerBottle: 13.5,
  });
  assert.throws(() => buildDiySpec({ bottle_ml: 59 }), /both required/);
  // A concentrate ticked in the app before its bottle was set up counts as new.
  assert.throws(
    () => buildDiySpec({ bottle_ml: 59 }, { bottleMl: 0, gramsPerBottle: 0 }),
    /both required/,
  );
  const existing = { bottleMl: 59, gramsPerBottle: 13.5, dropMl: 0.072 };
  assert.deepEqual(buildDiySpec({ grams_per_bottle: 17 }, existing), {
    bottleMl: 59,
    gramsPerBottle: 17,
    dropMl: 0.072,
  });
  assert.deepEqual(buildDiySpec({ drop_ml: null }, existing), { bottleMl: 59, gramsPerBottle: 13.5 });
});

Deno.test("pickStockKey: the app's key rule, and names must be new", () => {
  const existing = { "house": { label: "House" }, "house-2": { label: "House Two" } };
  assert.equal(pickStockKey("Morning", existing), "morning");
  assert.equal(pickStockKey("House!", { house: { label: "Something Else" } }), "house-2");
  assert.throws(() => pickStockKey("  house ", existing), /already exists/);
  // A library concentrate's key is never taken by a user concentrate.
  assert.equal(pickStockKey("Rao Perger", {}), "rao-perger-2");
  assert.equal(pickStockKey("Constructor", {}), "constructor-2");
  assert.equal(pickStockKey("!!!", {}), "stock");
  assert.equal(stockKeyFromId("stock:house"), "house");
  assert.equal(stockKeyFromId("house"), "house");
});

Deno.test("stockView: what the concentrate adds per liter at its dose, and solubility warnings", () => {
  const view = stockView("house", HOUSE, true);
  assert.equal(view.id, "stock:house");
  assert.equal(view.enabled_in_app, true);
  assert.equal(view.made_from, "library:rao-perger");
  // 5 g epsom in 200 mL at 4 mL/L is 0.1 g/L: 9.86 mg/L magnesium.
  assert.ok(Math.abs(view.adds_per_liter_at_dose.ions.magnesium - 9.86) < 0.02);
  assert.ok(view.adds_per_liter_at_dose.ions.sodium > 0);
  assert.deepEqual(view.warnings, []);
  // Gypsum dissolves to about 2 g/L: 1 g in 200 mL is 5 g/L.
  const warnings = solubilityWarnings([{ mineralId: "gypsum", grams: 1 }], 200);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Gypsum.*may not dissolve/);
  assert.equal(diyView("gypsum", { bottleMl: 200, gramsPerBottle: 1 }).warnings.length, 1);
  assert.equal(diyView("epsom-salt", { bottleMl: 59, gramsPerBottle: 13.5 }).grams_per_ml, 0.2288);
});

Deno.test("deriveFormula: the app's formula for a recipe, weighed in the user's calcium chloride", () => {
  const target = {
    ...ZERO,
    calcium: 20,
    magnesium: 10,
    sulfate: 40,
    chloride: 35,
    sodium: 18,
    bicarbonate: 49,
    alkalinity: 40,
  };
  const dihydrate = deriveFormula(target, {
    bottleMl: 200,
    doseMlPerLiter: 4,
    calciumChlorideId: "calcium-chloride",
  });
  assert.equal(dihydrate.bottleMl, 200);
  assert.equal(dihydrate.doseGramsPerL, 4);
  assert.ok(dihydrate.minerals.some((m) => m.mineralId === "calcium-chloride"));
  // Dosed back at 4 mL/L it lands on the recipe's calcium and magnesium.
  const made = stockView("x", { label: "x", ...dihydrate }).adds_per_liter_at_dose.ions;
  assert.ok(Math.abs(made.calcium - 20) < 1.5);
  assert.ok(Math.abs(made.magnesium - 10) < 1.5);

  const anhydrous = deriveFormula(target, {
    bottleMl: 200,
    doseMlPerLiter: 4,
    calciumChlorideId: "calcium-chloride-anhydrous",
  });
  assert.ok(anhydrous.minerals.some((m) => m.mineralId === "calcium-chloride-anhydrous"));

  assert.equal(
    calciumChlorideFormFor(["calcium-chloride-anhydrous", "epsom-salt"]),
    "calcium-chloride-anhydrous",
  );
  assert.equal(
    calciumChlorideFormFor(["calcium-chloride", "calcium-chloride-anhydrous"]),
    "calcium-chloride",
  );
  assert.equal(calciumChlorideFormFor(["epsom-salt"]), "calcium-chloride");
  assert.equal(calciumChlorideFormFor(null), "calcium-chloride");
});

Deno.test("saveConcentrateError: database refusals become clear messages", () => {
  const msg = (code: string, message = "x") => saveConcentrateError({ code, message }).message;
  assert.match(msg("42501"), /does not allow/);
  assert.match(msg("23505"), /different name/);
  assert.match(
    msg("P0002", "no settings yet: open the Cafelytic app once while signed in"),
    /open the Cafelytic app/,
  );
  assert.match(msg("P0002", "no concentrate with that key"), /no longer exists/);
  assert.match(msg("54000"), /maximum number/);
  assert.ok(
    saveConcentrateError({ code: "22023", message: "bottleMl out of range" }) instanceof ToolError,
  );
  // Anything else is an internal error, not shown to the model verbatim.
  assert.equal(saveConcentrateError({ code: "XX000", message: "boom" }) instanceof ToolError, false);
});
