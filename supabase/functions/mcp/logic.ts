// Pure helpers for the MCP server: input checks, row building, and the views
// the tools return. Nothing here touches the network, so logic.test.ts covers
// it with plain `deno test`.
//
// Chemistry and naming rules come from app-core.gen.js, a bundle of the app's
// own modules (src/lib/mcp-core.ts), so the server cannot drift from the app.

import {
  BRAND_CONCENTRATES,
  buildDosingKit,
  CACO3_TO_HCO3,
  calculateIonPPMs,
  calculateSo4ClRatio,
  computeStockMineralGramsPerL,
  deriveStockFormulaFromTarget,
  evaluateWaterProfileRanges,
  HCO3_TO_CACO3,
  ION_FIELDS,
  MINERAL_DB,
  MINERAL_SOLUBILITY_G_PER_L_25C_APPROX,
  recipeMetricsSummary,
  RESERVED_LIBRARY_STOCK_SLUGS,
  RESERVED_TARGET_KEYS,
  slugify,
  SOURCE_PRESETS,
  validateProfileName,
} from "./app-core.gen.js";

export type IonName =
  | "calcium"
  | "magnesium"
  | "potassium"
  | "sodium"
  | "sulfate"
  | "chloride"
  | "bicarbonate";

export type Ions = Record<IonName, number>;

export const IONS = ION_FIELDS as readonly IonName[];

// Same limits as the app's own inputs (maxlength on the name and description
// fields in index.html and my-recipes-ui.ts).
export const NAME_MAX = 40;
export const DESCRIPTION_MAX = 200;

// Upper bounds in mg/L. They are deliberately far above any drinkable coffee
// water: the point is to refuse nonsense (a unit mix-up, grams typed as mg/L),
// not to judge a recipe. Judgement is the range findings returned with every
// write, which are the app's own.
export const ION_MAX: Ions = {
  calcium: 600,
  magnesium: 300,
  potassium: 500,
  sodium: 500,
  sulfate: 1500,
  chloride: 1000,
  bicarbonate: 2000,
};

export class ToolError extends Error {}

export interface TargetRow {
  id: string;
  user_id: string | null;
  slug: string;
  label: string;
  brew_method: string | null;
  calcium: number | null;
  magnesium: number | null;
  alkalinity: number | null;
  potassium: number | null;
  sodium: number | null;
  sulfate: number | null;
  chloride: number | null;
  bicarbonate: number | null;
  description: string | null;
  is_public: boolean | null;
  creator_display_name: string | null;
  creator_user_id: string | null;
  tags: unknown;
  roast: unknown;
  tray?: string | null;
  stock_formula?: unknown;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface SourceRow {
  id: string;
  user_id: string;
  slug: string;
  label: string;
  calcium: number | null;
  magnesium: number | null;
  potassium: number | null;
  sodium: number | null;
  sulfate: number | null;
  chloride: number | null;
  bicarbonate: number | null;
  updated_at?: string | null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// ---------------------------------------------------------------------------
// Ion input
// ---------------------------------------------------------------------------

export interface IonInput {
  calcium?: number;
  magnesium?: number;
  potassium?: number;
  sodium?: number;
  sulfate?: number;
  chloride?: number;
  bicarbonate?: number;
  /** Alkalinity as mg/L CaCO3; an alternative to bicarbonate. */
  alkalinity?: number;
}

function checkIon(name: string, value: number, max: number): void {
  if (!Number.isFinite(value)) throw new ToolError(`${name} must be a number.`);
  if (value < 0) throw new ToolError(`${name} cannot be negative.`);
  if (value > max) {
    throw new ToolError(
      `${name} of ${value} mg/L is above the ${max} mg/L limit. Values are mg/L (ppm) in the finished water.`,
    );
  }
}

/**
 * Resolve the bicarbonate / alkalinity pair. Either may be given, and the
 * other is derived. Both given must describe the same water (within 2 mg/L as
 * CaCO3) and are then both kept as sent: bicarbonate is the measured ion (it
 * feeds TDS, charge balance, and what a source water stores), alkalinity is
 * the KH (what `analyze` reports and judges against the ranges).
 */
export function resolveAlkalinity(
  input: IonInput,
  fallback?: { bicarbonate: number; alkalinity: number },
): { bicarbonate: number; alkalinity: number } {
  const hasBicarb = input.bicarbonate != null;
  const hasAlk = input.alkalinity != null;
  if (hasBicarb) checkIon("bicarbonate", Number(input.bicarbonate), ION_MAX.bicarbonate);
  if (hasAlk) {
    checkIon("alkalinity", Number(input.alkalinity), ION_MAX.bicarbonate * HCO3_TO_CACO3);
  }
  if (hasBicarb && hasAlk) {
    const implied = Number(input.bicarbonate) * HCO3_TO_CACO3;
    if (Math.abs(implied - Number(input.alkalinity)) > 2) {
      throw new ToolError(
        `bicarbonate (${input.bicarbonate} mg/L) and alkalinity (${input.alkalinity} mg/L as CaCO3) disagree: ` +
          `that bicarbonate is ${Math.round(implied)} mg/L as CaCO3. Send only one of them.`,
      );
    }
    return { bicarbonate: Number(input.bicarbonate), alkalinity: Number(input.alkalinity) };
  }
  if (hasBicarb) {
    const b = Number(input.bicarbonate);
    return { bicarbonate: b, alkalinity: b * HCO3_TO_CACO3 };
  }
  if (hasAlk) {
    const a = Number(input.alkalinity);
    return { bicarbonate: a * CACO3_TO_HCO3, alkalinity: a };
  }
  if (fallback) return fallback;
  return { bicarbonate: 0, alkalinity: 0 };
}

/** Validate a full ion set (missing ions are 0, or `base` when updating). */
export function resolveIons(
  input: IonInput,
  base?: Ions & { alkalinity: number },
): Ions & { alkalinity: number } {
  const out = {} as Ions & { alkalinity: number };
  for (const ion of IONS) {
    if (ion === "bicarbonate") continue;
    const given = input[ion];
    const value = given != null ? Number(given) : base ? base[ion] : 0;
    checkIon(ion, value, ION_MAX[ion]);
    out[ion] = value;
  }
  const alk = resolveAlkalinity(
    input,
    base ? { bicarbonate: base.bicarbonate, alkalinity: base.alkalinity } : undefined,
  );
  out.bicarbonate = alk.bicarbonate;
  out.alkalinity = alk.alkalinity;
  return out;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

// Equivalent weights (g per equivalent) for the charge-balance check.
const EQ_WEIGHT: Ions = {
  calcium: 40.078 / 2,
  magnesium: 24.305 / 2,
  potassium: 39.098,
  sodium: 22.99,
  sulfate: 96.06 / 2,
  chloride: 35.453,
  bicarbonate: 61.017,
};

/**
 * Cation vs anion charge, in meq/L. Real water is electrically neutral, and
 * every salt adds both a cation and an anion, so a profile whose charges do
 * not balance cannot be mixed from salts: the calculator will land near it,
 * not on it. The app derives a recipe's secondary ions from the salts and so
 * never produces one; an AI inventing seven numbers easily can.
 */
export function ionBalance(ions: Ions): {
  cations_meq: number;
  anions_meq: number;
  balanced: boolean;
  note: string | null;
} {
  const cations = (["calcium", "magnesium", "potassium", "sodium"] as const).reduce(
    (sum, ion) => sum + num(ions[ion]) / EQ_WEIGHT[ion],
    0,
  );
  const anions = (["sulfate", "chloride", "bicarbonate"] as const).reduce(
    (sum, ion) => sum + num(ions[ion]) / EQ_WEIGHT[ion],
    0,
  );
  const gap = Math.abs(cations - anions);
  const scale = Math.max(cations, anions);
  const balanced = gap <= 0.15 || (scale > 0 && gap / scale <= 0.1);
  return {
    cations_meq: round2(cations),
    anions_meq: round2(anions),
    balanced,
    note: balanced ? null : (cations > anions
      ? "Cations exceed anions: no combination of salts produces exactly this profile. Raise sulfate, chloride or bicarbonate, or lower a cation."
      : "Anions exceed cations: no combination of salts produces exactly this profile. Raise calcium, magnesium, potassium or sodium, or lower an anion."),
  };
}

// Same order the app's evaluator sorts findings in.
const SEVERITY_ORDER: Record<string, number> = { danger: 0, warn: 1, info: 2 };

export interface RangeSources {
  alkalinitySources: string[];
  calciumSource: string | null;
  magnesiumSource: string | null;
}

export function analyze(
  ions: Ions,
  brewMethod: string,
  alkalinity?: number | null,
  // The salts the water was made with, when known (calculate_doses). Some
  // bands depend on them: sodium is judged more leniently when baking soda
  // supplies the alkalinity. A bare profile has none.
  sources?: RangeSources,
): {
  gh: number;
  kh: number;
  tds: number;
  so4_cl_ratio: number | null;
  ion_balance: ReturnType<typeof ionBalance>;
  findings: { severity: string; message: string }[];
} {
  const summary = recipeMetricsSummary({ ...ions, alkalinity: alkalinity ?? null });
  // Sources are passed explicitly (none): the app's fallback reads which
  // minerals the browser has selected, which does not exist here.
  const options = {
    brewMethod,
    alkalinitySources: sources ? sources.alkalinitySources : [] as string[],
    calciumSource: sources ? sources.calciumSource : null,
    magnesiumSource: sources ? sources.magnesiumSource : null,
  };
  const ranges = evaluateWaterProfileRanges(ions, options);
  let findings: { severity: string; message: string }[] = ranges.findings;
  // The app's evaluator takes KH from bicarbonate. When an alkalinity is also
  // known and the two differ slightly, the headline KH (from alkalinity) and
  // the KH finding would be judged on different numbers. So the KH finding
  // alone is re-evaluated on the alkalinity; every other finding (TDS
  // included) stays on the real ions.
  if (alkalinity != null && Math.abs(alkalinity - ions.bicarbonate * HCO3_TO_CACO3) > 1e-6) {
    const onAlkalinity = evaluateWaterProfileRanges(
      { ...ions, bicarbonate: alkalinity * CACO3_TO_HCO3 },
      options,
    );
    const isKh = (f: { message: string }) => f.message.startsWith("KH ");
    findings = [...findings.filter((f) => !isKh(f)), ...onAlkalinity.findings.filter(isKh)]
      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
  }
  const ratio = calculateSo4ClRatio(ions);
  return {
    gh: summary.gh,
    kh: summary.kh,
    tds: summary.tds,
    so4_cl_ratio: ratio == null ? null : round2(ratio),
    ion_balance: ionBalance(ions),
    findings,
  };
}

// ---------------------------------------------------------------------------
// Doses
// ---------------------------------------------------------------------------

// The shapes src/lib/dosing.ts works with (the bundle carries no types).
export interface DosingKit {
  minerals: string[];
  concentrates: {
    id: string;
    mineralId: string | null;
    gramsPerMl: number;
    dropMl: number;
    unit: "ml" | "drops";
  }[];
  recipeConcentrates: {
    id: string;
    spec: { label?: string; doseGramsPerL?: number };
    dropMl: number;
    unit: "ml" | "drops";
  }[];
}

export interface DosingResult {
  status: "ok" | "no-volume" | "no-alkalinity-source";
  mode: "minerals" | "recipe-concentrates";
  enableSuggestions: { ion: string; mineralId: string }[];
  shown: {
    mineralGrams: Record<string, number>;
    concentrateMl: Record<string, number>;
    recipeConcentrateMl: Record<string, number>;
    supplementGrams: Record<string, number>;
  };
  warnings: string[];
  finalIons: Ions | null;
  rangeSources: RangeSources;
}

export const VOLUME_MAX_LITERS = 1000;

/** mg/L bicarbonate to mg/L alkalinity as CaCO3 (the app's constant). */
export const HCO3_TO_CACO3_FACTOR: number = HCO3_TO_CACO3;

/**
 * The user's dosing kit from their synced settings row (null when they have
 * never synced: the app's starter minerals, no concentrates). `minerals`
 * replaces the whole kit with just those powders, for "what if I only had".
 */
export function kitFromSettings(
  row: Record<string, unknown> | null,
  minerals?: string[] | null,
): DosingKit {
  if (minerals) {
    return buildDosingKit({
      selectedMinerals: minerals,
      selectedConcentrates: [],
      diySpecs: {},
      stockSpecs: {},
      lotusDropperType: null,
      concentrateUnits: {},
    }) as DosingKit;
  }
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  return buildDosingKit({
    selectedMinerals: row?.selected_minerals,
    selectedConcentrates: row?.selected_concentrates,
    diySpecs: obj(row?.diy_concentrate_specs),
    stockSpecs: obj(row?.stock_concentrate_specs),
    lotusDropperType: row?.lotus_dropper_type,
    concentrateUnits: obj(row?.lotus_concentrate_units),
  }) as DosingKit;
}

export interface DoseLine {
  type: "mineral" | "mineral_concentrate" | "brand_concentrate" | "recipe_concentrate";
  id: string;
  name: string;
  amount: number;
  unit: "g" | "mL" | "drops";
  /** For a dose given in drops: the mL those drops come to. */
  ml?: number;
  /** A powder topping up what the Recipe Concentrates leave short. */
  supplement?: true;
}

function mineralName(id: string): string {
  const mineral = (MINERAL_DB as Record<string, { name: string } | undefined>)[id];
  return mineral ? mineral.name : id;
}

function concentrateLine(
  type: DoseLine["type"],
  id: string,
  name: string,
  ml: number,
  row: { dropMl: number; unit: "ml" | "drops" },
): DoseLine {
  if (row.dropMl > 0 && row.unit === "drops") {
    return {
      type,
      id,
      name,
      amount: Math.round(ml / row.dropMl),
      unit: "drops",
      ml: Math.round(ml * 1000) / 1000,
    };
  }
  return { type, id, name, amount: ml, unit: "mL" };
}

/**
 * The doses as the Calculator's rows show them, one line per row with a
 * nonzero amount: grams to 0.01, concentrates in whole drops or mL to 0.001.
 */
export function doseLines(result: DosingResult, kit: DosingKit): DoseLine[] {
  const lines: DoseLine[] = [];
  // Rows print grams to 0.01. A smaller dose prints as "<0.01 g" in the app;
  // here it keeps two significant figures, so a real dose is never reported
  // as 0 (the finished water is computed with it).
  const grams = (g: number) => (g < 0.01 ? Number(g.toPrecision(2)) : Math.round(g * 100) / 100);
  if (result.mode === "recipe-concentrates") {
    for (const rc of kit.recipeConcentrates) {
      const ml = result.shown.recipeConcentrateMl[rc.id] || 0;
      if (ml > 0) {
        lines.push(concentrateLine("recipe_concentrate", rc.id, rc.spec.label || rc.id, ml, rc));
      }
    }
    for (const [id, g] of Object.entries(result.shown.supplementGrams)) {
      if (g > 0) {
        lines.push({
          type: "mineral",
          id,
          name: mineralName(id),
          amount: grams(g),
          unit: "g",
          supplement: true,
        });
      }
    }
    return lines;
  }
  for (const [id, g] of Object.entries(result.shown.mineralGrams)) {
    if (g > 0) lines.push({ type: "mineral", id, name: mineralName(id), amount: grams(g), unit: "g" });
  }
  for (const c of kit.concentrates) {
    const ml = result.shown.concentrateMl[c.id] || 0;
    if (!(ml > 0)) continue;
    const brand = (BRAND_CONCENTRATES as Record<string, { name: string } | undefined>)[c.id];
    lines.push(
      brand
        ? concentrateLine("brand_concentrate", c.id, brand.name, ml, c)
        : concentrateLine(
          "mineral_concentrate",
          c.id,
          mineralName(c.mineralId || c.id) + " concentrate",
          ml,
          c,
        ),
    );
  }
  return lines;
}

export interface PickedSource {
  id: string | null;
  key: string;
  name: string;
  ions: Ions;
  note: string | null;
}

/**
 * The source water to dose from when the caller names none: the one the app's
 * Calculator is using. The app syncs the values in its Starting Water fields
 * (user_selections.source_water) next to the selected profile's key, and those
 * are what it doses from, including edits not saved to the profile, a
 * hand-typed "custom" water, and a new profile whose own row has not synced
 * yet. A new account with no selection starts on distilled.
 */
export function pickDefaultSource(
  waters: ReturnType<typeof mergeSourceWaters>,
  sourcePreset: string | null,
  shownIons: unknown,
): PickedSource {
  const saved = sourcePreset ? waters.find((w) => w.key === sourcePreset) : undefined;
  if (shownIons && typeof shownIons === "object" && !Array.isArray(shownIons)) {
    const raw = shownIons as Record<string, unknown>;
    const ions = {} as Ions;
    for (const ion of IONS) {
      const v = Number(raw[ion]);
      ions[ion] = Number.isFinite(v) && v > 0 ? v : 0;
    }
    if (saved) {
      const edited = IONS.some((ion) => Math.abs(ions[ion] - saved.ions[ion]) > 1e-9);
      return {
        id: saved.id,
        key: saved.key,
        name: saved.name,
        ions,
        note: edited
          ? `"${saved.name}" has unsaved edits in the app. The edited values, which the app's calculator is using, were used here. Send source_water_id or source_water_key to use the saved profile.`
          : null,
      };
    }
    const key = sourcePreset || "custom";
    return {
      id: null,
      key,
      name: key === "custom" ? "Custom (values entered in the app)" : key,
      ions,
      note: key === "custom"
        ? "The app is set to hand-entered source water values; those were used."
        : `The source water selected in the app ("${key}") is not among the saved profiles yet, so the values the app is showing for it were used.`,
    };
  }
  if (saved) return { id: saved.id, key: saved.key, name: saved.name, ions: saved.ions, note: null };
  if (!sourcePreset) {
    const distilled = waters.find((w) => w.key === "distilled");
    if (distilled) {
      return { id: null, key: distilled.key, name: distilled.name, ions: distilled.ions, note: null };
    }
  }
  throw new ToolError(
    "The source water selected in the app could not be read. Send source_water_id or source_water_key (see list_source_waters).",
  );
}

/** What the kit holds, for the tool's reply. */
export function kitSummary(kit: DosingKit) {
  return {
    minerals: kit.minerals,
    concentrates: kit.concentrates.map((c) => c.id),
    recipe_concentrates: kit.recipeConcentrates.map((rc) => rc.id),
  };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export function rowIons(row: {
  calcium: number | null;
  magnesium: number | null;
  potassium: number | null;
  sodium: number | null;
  sulfate: number | null;
  chloride: number | null;
  bicarbonate: number | null;
}): Ions {
  const out = {} as Ions;
  for (const ion of IONS) out[ion] = num(row[ion]);
  return out;
}

export type RecipeOwner = "mine" | "library" | "community";

export function recipeOwner(row: TargetRow, userId: string): RecipeOwner {
  if (row.user_id === userId) return "mine";
  return row.user_id == null ? "library" : "community";
}

/** Why the MCP server will not edit this recipe, or null when it may. */
export function recipeReadOnlyReason(row: TargetRow, userId: string): string | null {
  if (row.user_id !== userId) {
    return "It belongs to the Recipe Library. Save your own version with create_recipe instead.";
  }
  if (row.is_public) {
    return "It is published to the public Recipe Library, and published recipes cannot be changed through an AI app. Save an adjusted private copy with create_recipe, or edit it in the Cafelytic app.";
  }
  if (RESERVED_TARGET_KEYS.has(row.slug)) {
    return "It is your edited version of a built-in recipe. Edit it in the Cafelytic app, or save a new recipe with create_recipe.";
  }
  if (row.creator_user_id !== userId) {
    return "It is your saved copy of someone else's recipe. Save your own version with create_recipe instead.";
  }
  return null;
}

export function recipeSummary(row: TargetRow, userId: string, activeSlug?: string | null) {
  const ions = rowIons(row);
  const metrics = recipeMetricsSummary(row);
  const owner = recipeOwner(row, userId);
  return {
    id: row.id,
    name: row.label,
    owner,
    brew_method: row.brew_method || "filter",
    ...(owner === "mine"
      ? {
        published: !!row.is_public,
        editable: recipeReadOnlyReason(row, userId) == null,
        active_in_app: !!activeSlug && activeSlug === row.slug,
      }
      : { creator: row.creator_display_name || null }),
    gh: metrics.gh,
    kh: metrics.kh,
    tds: metrics.tds,
    alkalinity: row.alkalinity == null ? metrics.kh : num(row.alkalinity),
    ions,
  };
}

export function recipeDetail(row: TargetRow, userId: string, activeSlug?: string | null) {
  const brew = row.brew_method === "espresso" ? "espresso" : "filter";
  const analysis = analyze(rowIons(row), brew, row.alkalinity);
  return {
    ...recipeSummary(row, userId, activeSlug),
    description: row.description || "",
    roast: asStringArray(row.roast),
    tags: asStringArray(row.tags),
    so4_cl_ratio: analysis.so4_cl_ratio,
    ion_balance: analysis.ion_balance,
    findings: analysis.findings,
    read_only_reason: recipeReadOnlyReason(row, userId),
    concentrate_formula: row.stock_formula ?? null,
    updated_at: row.updated_at ?? null,
  };
}

export function sourceWaterView(
  entry: { id: string | null; slug: string; label: string; builtin: boolean } & Ions,
  activeSlug?: string | null,
) {
  const ions = rowIons(entry);
  const metrics = recipeMetricsSummary(ions);
  return {
    id: entry.id,
    key: entry.slug,
    name: entry.label,
    kind: entry.builtin ? "built-in" : "saved",
    editable: !entry.builtin && entry.id != null,
    active_in_app: !!activeSlug && activeSlug === entry.slug,
    gh: metrics.gh,
    kh: metrics.kh,
    tds: metrics.tds,
    ions,
  };
}

/**
 * The source waters the app's picker shows: built-ins (minus the ones the user
 * removed, with the user's edited values where they saved over one) followed
 * by the user's own saved waters.
 */
export function mergeSourceWaters(
  rows: SourceRow[],
  deletedSlugs: string[],
  activeSlug?: string | null,
) {
  const deleted = new Set(deletedSlugs);
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const out: ReturnType<typeof sourceWaterView>[] = [];
  for (const [slug, preset] of Object.entries(SOURCE_PRESETS)) {
    if (slug === "custom" || deleted.has(slug)) continue;
    const override = bySlug.get(slug);
    const base = override ?? (preset as unknown as SourceRow);
    out.push(
      sourceWaterView(
        { id: null, slug, label: override?.label || preset.label, builtin: true, ...rowIons(base) },
        activeSlug,
      ),
    );
  }
  for (const row of rows) {
    if (isBuiltinSourceKey(row.slug) || deleted.has(row.slug)) continue;
    out.push(
      sourceWaterView(
        { id: row.id, slug: row.slug, label: row.label, builtin: false, ...rowIons(row) },
        activeSlug,
      ),
    );
  }
  return out;
}

export function isBuiltinSourceKey(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(SOURCE_PRESETS, slug);
}

// ---------------------------------------------------------------------------
// Names and keys
// ---------------------------------------------------------------------------

export function cleanName(raw: string): string {
  const name = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!name) throw new ToolError("A name is required.");
  if (name.length > NAME_MAX) {
    throw new ToolError(`The name is ${name.length} characters; the limit is ${NAME_MAX}.`);
  }
  return name;
}

export function cleanDescription(raw: string | undefined | null): string {
  const text = String(raw ?? "").trim();
  if (text.length > DESCRIPTION_MAX) {
    throw new ToolError(
      `The description is ${text.length} characters; the limit is ${DESCRIPTION_MAX}.`,
    );
  }
  return text;
}

/**
 * Pick the storage key for a new profile, with the app's own rules
 * (validateProfileName): a reserved or already-used name is refused, and a
 * key that was deleted before, or that a public recipe already uses, is never
 * reused (the profile gets "name-2" and keeps its typed name). Reusing a
 * deleted key matters most: every device still holding the old deletion
 * record would delete the new row on its next sync.
 */
// Keys that are property names on every JavaScript object ("constructor",
// "toString", ...). The app keeps profiles in plain objects and checks
// built-ins with a bare lookup, so a profile stored under one of these reads
// as a built-in and is dropped from the picker. Installed apps cannot be
// fixed after the fact, so the server never hands these keys out: the profile
// gets "constructor-2" and keeps its typed name.
const OBJECT_PROTOTYPE_KEYS = Object.getOwnPropertyNames(Object.prototype).map((k) =>
  k.toLowerCase()
);

/** LIKE / ILIKE pattern that matches `text` literally. */
export function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (c) => "\\" + c);
}

/**
 * pickProfileKey, plus a direct check of the key it picks. `isKeyTaken` asks
 * the database about ONE key, which no row cap can hide; the sets passed in
 * `opts` are a head start read in bulk and may be incomplete. A key found
 * taken is added to the retired set and the pick is repeated.
 */
export async function pickVerifiedProfileKey(
  name: string,
  opts: Parameters<typeof pickProfileKey>[1],
  isKeyTaken: (key: string) => Promise<boolean>,
): Promise<string> {
  const retired = new Set(opts.retiredKeys);
  for (let attempt = 0; attempt < 50; attempt++) {
    const key = pickProfileKey(name, { ...opts, retiredKeys: retired });
    if (!(await isKeyTaken(key))) return key;
    retired.add(key);
  }
  throw new ToolError(`Too many recipes are already named like "${name}". Choose a different name.`);
}

export function pickProfileKey(
  name: string,
  opts: {
    reservedKeys: Iterable<string>;
    existingKeys: Iterable<string>;
    existingLabels: Iterable<string>;
    retiredKeys: Iterable<string>;
    kind: "recipe" | "source water";
  },
): string {
  const result = validateProfileName(name, {
    builtinKeys: new Set(opts.reservedKeys),
    existingKeys: new Set(opts.existingKeys),
    existingLabels: new Set([...opts.existingLabels].map((l) => l.trim().toLowerCase())),
    retiredKeys: new Set([...opts.retiredKeys, ...OBJECT_PROTOTYPE_KEYS]),
    emptyMessage: "A name is required.",
    invalidMessage: "The name needs at least one letter or number.",
    reservedMessage: `"${name}" is a reserved name. Choose a different name.`,
    duplicateMessage: `A ${opts.kind} named "${name}" already exists. Choose a different name` +
      (opts.kind === "recipe" ? ", or change yours with update_recipe." : "."),
  });
  if (!result.ok || !result.key) {
    throw new ToolError(result.message || "That name cannot be used.");
  }
  return result.key;
}

// ---------------------------------------------------------------------------
// Rows to write
// ---------------------------------------------------------------------------

/**
 * A new private recipe row. Mirrors buildTargetRow in src/lib/sync.ts so the
 * row is indistinguishable from one the app saved: whole-number ions (as
 * buildStoredTargetProfile rounds them), private, attributed to the caller.
 */
/**
 * The whole-number pair to store. Alkalinity is rounded first and bicarbonate
 * is derived from the ROUNDED value: rounding the two independently can leave
 * a stored pair that this server's own input check would then refuse (10.49
 * and 10.5 would store as 10 and 11).
 */
export function storedAlkalinityPair(alkalinity: number): {
  alkalinity: number;
  bicarbonate: number;
} {
  const a = Math.round(alkalinity);
  return { alkalinity: a, bicarbonate: Math.round(a * CACO3_TO_HCO3) };
}

export function buildRecipeInsert(
  userId: string,
  slug: string,
  name: string,
  brewMethod: "filter" | "espresso",
  ions: Ions & { alkalinity: number },
  description: string,
  now: string,
) {
  return {
    user_id: userId,
    slug,
    label: name,
    brew_method: brewMethod,
    calcium: Math.round(ions.calcium),
    magnesium: Math.round(ions.magnesium),
    potassium: Math.round(ions.potassium),
    sodium: Math.round(ions.sodium),
    sulfate: Math.round(ions.sulfate),
    chloride: Math.round(ions.chloride),
    ...storedAlkalinityPair(ions.alkalinity),
    description,
    is_public: false,
    creator_display_name: "",
    creator_user_id: userId,
    tags: [],
    roast: ["all"],
    updated_at: now,
  };
}

const PLAIN_IONS = ["calcium", "magnesium", "potassium", "sodium", "sulfate", "chloride"] as const;

/**
 * The columns an update_recipe call changes: only what the caller sent. The
 * tool reads the row first (to validate and to refuse read-only recipes), but
 * writing that whole snapshot back would silently revert any field another
 * device changed in between. Bicarbonate and alkalinity move together, and
 * only when the caller sent one of them.
 */
export function buildRecipePatch(
  sent: IonInput & { brew_method?: "filter" | "espresso"; description?: string },
  resolved: Ions & { alkalinity: number },
  now: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const ion of PLAIN_IONS) {
    if (sent[ion] != null) patch[ion] = Math.round(resolved[ion]);
  }
  if (sent.bicarbonate != null || sent.alkalinity != null) {
    Object.assign(patch, storedAlkalinityPair(resolved.alkalinity));
  }
  if (sent.brew_method !== undefined) patch.brew_method = sent.brew_method;
  if (sent.description !== undefined) patch.description = cleanDescription(sent.description);
  if (Object.keys(patch).length === 0) {
    throw new ToolError("Nothing to change: send at least one field to update.");
  }
  patch.updated_at = now;
  return patch;
}

/** The columns an update_source_water call changes: only the ions sent. */
export function buildSourcePatch(
  sent: IonInput,
  resolved: Ions,
  now: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const ion of PLAIN_IONS) {
    if (sent[ion] != null) patch[ion] = round2(resolved[ion]);
  }
  if (sent.bicarbonate != null || sent.alkalinity != null) {
    patch.bicarbonate = round2(resolved.bicarbonate);
  }
  if (Object.keys(patch).length === 0) {
    throw new ToolError("Nothing to change: send at least one ion to update.");
  }
  patch.updated_at = now;
  return patch;
}

export function buildSourceValues(ions: Ions) {
  const out = {} as Ions;
  for (const ion of IONS) out[ion] = round2(ions[ion]);
  return out;
}

// ---------------------------------------------------------------------------
// Concentrates (phase 2)
// ---------------------------------------------------------------------------
// Saved through public.mcp_save_concentrate, which merges ONE concentrate into
// the user's settings row and re-checks everything below in the database.

/** A Recipe Concentrate as the app stores it (user_settings.stock_concentrate_specs). */
export interface StockSpec {
  label: string;
  bottleMl: number;
  doseGramsPerL: number;
  minerals: { mineralId: string; grams: number }[];
  dropMl?: number;
  createdFrom?: string;
  source?: string;
}

/** A Mineral Concentrate as the app stores it (user_settings.diy_concentrate_specs). */
export interface DiySpec {
  bottleMl: number;
  gramsPerBottle: number;
  dropMl?: number;
}

// Bounds on what an AI app may save. Wide enough for any real bottle; they
// exist to refuse unit mix-ups (liters typed as mL, mg typed as g).
export const BOTTLE_ML_MIN = 5;
export const BOTTLE_ML_MAX = 20000;
export const DOSE_ML_PER_L_MIN = 0.05;
export const DOSE_ML_PER_L_MAX = 100;
export const MINERAL_GRAMS_MAX = 5000;
export const DROP_ML_MIN = 0.001;
export const DROP_ML_MAX = 1;
export const STOCK_MINERALS_MAX = 12;

const SOLUBILITY = MINERAL_SOLUBILITY_G_PER_L_25C_APPROX as Record<string, number | undefined>;
const MINERALS = MINERAL_DB as Record<string, { name: string } | undefined>;

function inRange(name: string, value: unknown, min: number, max: number, unit: string): number {
  const n = Number(value);
  if (typeof value !== "number" || !Number.isFinite(n)) {
    throw new ToolError(`${name} must be a number.`);
  }
  if (n < min || n > max) {
    throw new ToolError(`${name} must be between ${min} and ${max} ${unit}.`);
  }
  return n;
}

/** Dropper size to the app's 0.001 mL, or undefined when none is given. */
function cleanDropMl(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = inRange("drop_ml", value, DROP_ML_MIN, DROP_ML_MAX, "mL per drop");
  return Math.round(n * 1000) / 1000;
}

export interface MineralEntryInput {
  mineral_id: string;
  grams: number;
}

function cleanMinerals(minerals: MineralEntryInput[]): StockSpec["minerals"] {
  if (!Array.isArray(minerals) || minerals.length === 0) {
    throw new ToolError("A Recipe Concentrate needs at least one mineral.");
  }
  if (minerals.length > STOCK_MINERALS_MAX) {
    throw new ToolError(`A Recipe Concentrate can hold at most ${STOCK_MINERALS_MAX} minerals.`);
  }
  const seen = new Set<string>();
  return minerals.map((m) => {
    if (!m || !MINERALS[m.mineral_id]) {
      throw new ToolError(`"${m && m.mineral_id}" is not a mineral Cafelytic knows. Use list_minerals.`);
    }
    if (seen.has(m.mineral_id)) {
      throw new ToolError(`${MINERALS[m.mineral_id]!.name} is listed twice. List each mineral once.`);
    }
    seen.add(m.mineral_id);
    const grams = inRange(
      `Grams of ${MINERALS[m.mineral_id]!.name}`,
      m.grams,
      0.01,
      MINERAL_GRAMS_MAX,
      "g",
    );
    // The app's editor works in hundredths of a gram.
    return { mineralId: m.mineral_id, grams: Math.round(grams * 100) / 100 };
  });
}

export interface StockInput {
  name?: string;
  minerals?: MineralEntryInput[];
  bottle_ml?: number;
  dose_ml_per_liter?: number;
  /** A number sets the dropper size; null removes it; left out keeps what is there. */
  drop_ml?: number | null;
}

/**
 * The spec to store for a Recipe Concentrate. With `existing` this is an
 * update: fields left out keep their stored values, and the origin fields
 * (createdFrom, source) are carried over untouched.
 */
export function buildStockSpec(input: StockInput, existing?: StockSpec | null): StockSpec {
  const label = input.name !== undefined ? cleanName(input.name) : existing?.label;
  if (!label) throw new ToolError("A name is required.");
  const minerals = input.minerals !== undefined
    ? cleanMinerals(input.minerals)
    : existing?.minerals;
  if (!minerals || minerals.length === 0) {
    throw new ToolError("A Recipe Concentrate needs at least one mineral.");
  }
  const bottleMl = input.bottle_ml !== undefined
    ? inRange("bottle_ml", input.bottle_ml, BOTTLE_ML_MIN, BOTTLE_ML_MAX, "mL")
    : Number(existing?.bottleMl);
  const doseGramsPerL = input.dose_ml_per_liter !== undefined
    ? inRange("dose_ml_per_liter", input.dose_ml_per_liter, DOSE_ML_PER_L_MIN, DOSE_ML_PER_L_MAX, "mL per liter")
    : Number(existing?.doseGramsPerL);
  if (!(bottleMl > 0) || !(doseGramsPerL > 0)) {
    throw new ToolError("bottle_ml and dose_ml_per_liter are required.");
  }
  const spec: StockSpec = { label, bottleMl, doseGramsPerL, minerals };
  const dropMl = input.drop_ml === undefined ? existing?.dropMl : cleanDropMl(input.drop_ml);
  if (dropMl !== undefined && dropMl !== null && Number(dropMl) > 0) spec.dropMl = Number(dropMl);
  if (existing?.createdFrom) spec.createdFrom = existing.createdFrom;
  if (existing?.source) spec.source = existing.source;
  return spec;
}

export interface DiyInput {
  bottle_ml?: number;
  grams_per_bottle?: number;
  drop_ml?: number | null;
}

/** The spec to store for a Mineral Concentrate; fields left out keep the stored values. */
export function buildDiySpec(input: DiyInput, existing?: DiySpec | null): DiySpec {
  const stored = (v: unknown) => (Number(v) > 0 ? Number(v) : undefined);
  const bottle = input.bottle_ml ?? stored(existing?.bottleMl);
  const grams = input.grams_per_bottle ?? stored(existing?.gramsPerBottle);
  if (bottle === undefined || grams === undefined) {
    throw new ToolError("bottle_ml and grams_per_bottle are both required for a new Mineral Concentrate.");
  }
  const spec: DiySpec = {
    bottleMl: inRange("bottle_ml", bottle, BOTTLE_ML_MIN, BOTTLE_ML_MAX, "mL"),
    gramsPerBottle: inRange("grams_per_bottle", grams, 0.01, MINERAL_GRAMS_MAX, "g"),
  };
  const dropMl = input.drop_ml === undefined ? existing?.dropMl : cleanDropMl(input.drop_ml);
  if (dropMl !== undefined && dropMl !== null && Number(dropMl) > 0) spec.dropMl = Number(dropMl);
  return spec;
}

/**
 * A new Recipe Concentrate's key: the app's own rule (stock-editor.ts
 * uniqueStockSlug): the name's slug, never a library concentrate's slug,
 * suffixed -2, -3 when taken. Names already in use are refused, so two
 * concentrates cannot look identical in the app.
 */
export function pickStockKey(
  label: string,
  existing: Record<string, { label?: string } | undefined>,
): string {
  const wanted = label.trim().toLowerCase();
  for (const [key, spec] of Object.entries(existing)) {
    if (((spec && spec.label) || key).trim().toLowerCase() === wanted) {
      throw new ToolError(
        `A Recipe Concentrate named "${label}" already exists. Choose a different name, or change it with update_recipe_concentrate.`,
      );
    }
  }
  const taken = new Set([
    ...Object.keys(existing),
    ...(RESERVED_LIBRARY_STOCK_SLUGS as readonly string[]),
    ...OBJECT_PROTOTYPE_KEYS,
  ]);
  const base = slugify(label) || "stock";
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(base + "-" + i)) i++;
  return base + "-" + i;
}

/** "stock:my-key" or "my-key" -> "my-key". */
export function stockKeyFromId(id: string): string {
  return id.startsWith("stock:") ? id.slice(6) : id;
}

/** Warnings for salts dissolved past their approximate solubility (the app's own check). */
export function solubilityWarnings(
  minerals: { mineralId: string; grams: number }[],
  bottleMl: number,
): string[] {
  const out: string[] = [];
  if (!(bottleMl > 0)) return out;
  for (const m of minerals) {
    const cap = SOLUBILITY[m.mineralId];
    if (!cap) continue;
    const gPerL = m.grams / (bottleMl / 1000);
    if (gPerL >= cap) {
      out.push(
        `${MINERALS[m.mineralId]?.name || m.mineralId} at ${
          Math.round(gPerL * 10) / 10
        } g/L is at or past its approximate solubility (${cap} g/L) and may not dissolve. Use a larger bottle or less of it.`,
      );
    }
  }
  return out;
}

/** mg/L of each ion one liter of water gets from the concentrate at its dose. */
export function stockAddsPerLiter(spec: StockSpec): Ions {
  const added = calculateIonPPMs(computeStockMineralGramsPerL(spec)) as Ions;
  const out = {} as Ions;
  for (const ion of IONS) out[ion] = round2(num(added[ion]));
  return out;
}

export function stockView(key: string, spec: StockSpec, selected?: boolean) {
  const adds = stockAddsPerLiter(spec);
  const metrics = recipeMetricsSummary(adds);
  return {
    id: "stock:" + key,
    name: spec.label || key,
    bottle_ml: spec.bottleMl ?? null,
    dose_ml_per_liter: spec.doseGramsPerL ?? null,
    drop_ml: spec.dropMl ?? null,
    minerals: (Array.isArray(spec.minerals) ? spec.minerals : []).map((m) => ({
      mineral_id: m.mineralId,
      name: MINERALS[m.mineralId]?.name || m.mineralId,
      grams: m.grams,
    })),
    made_from: spec.createdFrom ?? null,
    ...(selected === undefined ? {} : { enabled_in_app: selected }),
    adds_per_liter_at_dose: { ions: adds, gh: metrics.gh, kh: metrics.kh, tds: metrics.tds },
    warnings: solubilityWarnings(Array.isArray(spec.minerals) ? spec.minerals : [], spec.bottleMl),
  };
}

export function diyView(mineralId: string, spec: DiySpec, selected?: boolean) {
  const bottleMl = Number(spec.bottleMl) || 0;
  const grams = Number(spec.gramsPerBottle) || 0;
  return {
    id: "diy:" + mineralId,
    mineral_id: mineralId,
    name: (MINERALS[mineralId]?.name || mineralId) + " concentrate",
    bottle_ml: spec.bottleMl ?? null,
    grams_per_bottle: spec.gramsPerBottle ?? null,
    drop_ml: spec.dropMl ?? null,
    grams_per_ml: bottleMl > 0 && grams > 0 ? Math.round((grams / bottleMl) * 10000) / 10000 : null,
    ...(selected === undefined ? {} : { enabled_in_app: selected }),
    warnings: solubilityWarnings([{ mineralId, grams }], bottleMl),
  };
}

/**
 * The calcium chloride form a derived formula should weigh: the form the user
 * has as a powder, dihydrate when both or neither (the rule in
 * deriveStockFormulaFromTarget, applied to the synced selection).
 */
export function calciumChlorideFormFor(selectedMinerals: unknown): string {
  const powders = Array.isArray(selectedMinerals) ? selectedMinerals : null;
  if (powders && !powders.includes("calcium-chloride") && powders.includes("calcium-chloride-anhydrous")) {
    return "calcium-chloride-anhydrous";
  }
  return "calcium-chloride";
}

/** The app's "make a concentrate from this recipe" formula. */
export function deriveFormula(
  target: Ions & { alkalinity: number },
  opts: { bottleMl: number; doseMlPerLiter: number; calciumChlorideId: string },
) {
  const derived = deriveStockFormulaFromTarget(target, {
    bottleMl: opts.bottleMl,
    doseGramsPerL: opts.doseMlPerLiter,
    calciumChlorideId: opts.calciumChlorideId,
  }) as {
    bottleMl: number;
    doseGramsPerL: number;
    minerals: { mineralId: string; grams: number }[];
    notes: string[];
  };
  return derived;
}

/** Turn a mcp_save_concentrate failure into a message the model can act on. */
export function saveConcentrateError(error: { code?: string; message: string }): ToolError | Error {
  switch (error.code) {
    case "42501":
      return new ToolError("Cafelytic does not allow that change from an AI app.");
    case "23505":
      return new ToolError("A concentrate with that name was just created. Choose a different name.");
    case "P0002":
      return new ToolError(
        /no settings yet/.test(error.message)
          ? "This account has no synced settings yet. The user needs to open the Cafelytic app once while signed in, then try again."
          : "That concentrate no longer exists. It may have been removed in the app.",
      );
    case "54000":
      return new ToolError(
        "This account already has the maximum number of concentrates. The user can remove some in the app's Settings.",
      );
    case "22023":
      return new ToolError("Cafelytic refused that concentrate: " + error.message + ".");
    default:
      return new Error(error.message);
  }
}
