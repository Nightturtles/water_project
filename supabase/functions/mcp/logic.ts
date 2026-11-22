// Pure helpers for the MCP server: input checks, row building, and the views
// the tools return. Nothing here touches the network, so logic.test.ts covers
// it with plain `deno test`.
//
// Chemistry and naming rules come from app-core.gen.js, a bundle of the app's
// own modules (src/lib/mcp-core.ts), so the server cannot drift from the app.

import {
  CACO3_TO_HCO3,
  calculateSo4ClRatio,
  evaluateWaterProfileRanges,
  HCO3_TO_CACO3,
  ION_FIELDS,
  recipeMetricsSummary,
  RESERVED_TARGET_KEYS,
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
 * Resolve the bicarbonate / alkalinity pair. Either may be given. Both given
 * must describe the same water (within 2 mg/L as CaCO3); alkalinity is then
 * the one kept and bicarbonate is derived from it, so the pair that comes out
 * is always exactly consistent. Alkalinity wins because the app reads a
 * recipe's KH from it. Without this, a pair inside the tolerance could report
 * one KH in the headline and classify another against the ranges.
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
    const a = Number(input.alkalinity);
    return { bicarbonate: a * CACO3_TO_HCO3, alkalinity: a };
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

export function analyze(
  ions: Ions,
  brewMethod: string,
  alkalinity?: number | null,
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
  const ranges = evaluateWaterProfileRanges(ions, {
    brewMethod,
    alkalinitySources: [],
    calciumSource: null,
    magnesiumSource: null,
  });
  const ratio = calculateSo4ClRatio(ions);
  return {
    gh: summary.gh,
    kh: summary.kh,
    tds: summary.tds,
    so4_cl_ratio: ratio == null ? null : round2(ratio),
    ion_balance: ionBalance(ions),
    findings: ranges.findings,
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
