// ============================================
// Mineral sources: which salts a kit can dose from
// ============================================
// Pure: everything is worked out from the kit passed in, nothing is read from
// storage. storage.ts builds the kit from the browser's saved selections and
// delegates its getEffective*Sources() helpers here; the MCP server builds
// the same kit from the user's synced settings row. One copy of the rules.

import { BRAND_CONCENTRATES, LOTUS_DROPPER_ML } from "./constants";

/** The saved fields of a Mineral Concentrate that dosing needs. */
export interface DiySpecLike {
  bottleMl?: unknown;
  gramsPerBottle?: unknown;
  dropMl?: unknown;
}

/** MINERAL_DB id a single-mineral concentrate supplies (diy: or brand:), else null. */
export function concentrateMineralId(concentrateId: unknown): string | null {
  if (typeof concentrateId !== "string") return null;
  if (concentrateId.startsWith("diy:")) return concentrateId.slice(4) || null;
  const brand = BRAND_CONCENTRATES[concentrateId];
  return brand ? brand.mineralId : null;
}

/** Grams of salt per mL of a Mineral Concentrate; 0 until bottle mL and grams are both set. */
export function diyGramsPerMl(spec: DiySpecLike | null | undefined): number {
  const bottleMl = spec ? Number(spec.bottleMl) : 0;
  const gramsPerBottle = spec ? Number(spec.gramsPerBottle) : 0;
  if (!Number.isFinite(bottleMl) || !Number.isFinite(gramsPerBottle)) return 0;
  if (bottleMl <= 0 || gramsPerBottle <= 0) return 0;
  return gramsPerBottle / bottleMl;
}

/** Grams of equivalent salt per mL for a diy: or brand: concentrate; 0 when unknown. */
export function concentrateGramsPerMl(
  concentrateId: unknown,
  diySpecs: Record<string, DiySpecLike | undefined> | null | undefined,
): number {
  if (typeof concentrateId !== "string") return 0;
  if (concentrateId.startsWith("diy:")) {
    const mineralId = concentrateId.slice(4);
    return mineralId ? diyGramsPerMl(diySpecs && diySpecs[mineralId]) : 0;
  }
  const brand = BRAND_CONCENTRATES[concentrateId];
  if (brand && Number.isFinite(brand.gramsPerMl)) return brand.gramsPerMl;
  return 0;
}

// Dropper sizes are entered to the 1,000th of a mL (e.g. 0.045).
export const DROP_ML_DECIMALS = 3;

/**
 * Normalize a user-entered mL-per-drop value: a positive finite number
 * rounded to DROP_ML_DECIMALS, or null when blank / zero / invalid (null
 * means "no dropper set", so the concentrate stays mL-only). Values that
 * round to 0 are treated as unset.
 */
export function normalizeDropMl(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n) || n <= 0) return null;
  const factor = Math.pow(10, DROP_ML_DECIMALS);
  const rounded = Math.round(n * factor) / factor;
  return rounded > 0 ? rounded : null;
}

/** mL per drop of the selected Lotus dropper style (round when unknown). */
export function lotusDropMl(dropperType: unknown): number {
  const selectedMl = Number(LOTUS_DROPPER_ML[String(dropperType)]);
  if (Number.isFinite(selectedMl) && selectedMl > 0) return selectedMl;
  const fallbackMl = Number(LOTUS_DROPPER_ML.round);
  return Number.isFinite(fallbackMl) && fallbackMl > 0 ? fallbackMl : 0.0716;
}

/**
 * mL per drop for a concentrate, or 0 when it isn't dosed in drops. Lotus
 * brand concentrates use the selected Lotus dropper style; Mineral (diy:) and
 * Recipe (stock:) Concentrates use the dropper size saved on their spec.
 */
export function concentrateDropMl(
  concentrateId: unknown,
  saved: {
    lotusDropperType: unknown;
    diySpecs: Record<string, DiySpecLike | undefined> | null | undefined;
    stockSpecs: Record<string, { dropMl?: unknown } | undefined> | null | undefined;
  },
): number {
  if (typeof concentrateId !== "string") return 0;
  if (concentrateId.startsWith("brand:lotus:")) return lotusDropMl(saved.lotusDropperType);
  if (concentrateId.startsWith("diy:")) {
    const spec = saved.diySpecs && saved.diySpecs[concentrateId.slice(4)];
    return (spec && normalizeDropMl(spec.dropMl)) || 0;
  }
  if (concentrateId.startsWith("stock:")) {
    const spec = saved.stockSpecs && saved.stockSpecs[concentrateId.slice(6)];
    return (spec && normalizeDropMl(spec.dropMl)) || 0;
  }
  return 0;
}

/** A selected single-mineral concentrate (Mineral Concentrate or brand). */
export interface KitConcentrate {
  id: string;
  /** MINERAL_DB id the concentrate supplies, or null when unknown. */
  mineralId: string | null;
  /** Grams of that salt per mL; 0 when the bottle is not configured yet. */
  gramsPerMl: number;
}

/** A selected Recipe Concentrate, reduced to the salts inside it. */
export interface KitRecipeConcentrate {
  id: string;
  mineralIds: string[];
}

/** Everything the user has enabled to dose with. */
export interface MineralKit {
  /** Individually selected powders (MINERAL_DB ids). */
  minerals: string[];
  /** Selected single-mineral concentrates, in selection order. */
  concentrates: KitConcentrate[];
  /** Selected Recipe Concentrates whose spec exists, in selection order. */
  recipeConcentrates: KitRecipeConcentrate[];
}

/** Every salt the kit can supply: powders, concentrates, and Recipe Concentrate contents. */
export function availableMineralIds(kit: MineralKit): string[] {
  const out = new Set(kit.minerals);
  for (const c of kit.concentrates) {
    if (c.mineralId) out.add(c.mineralId);
  }
  for (const rc of kit.recipeConcentrates) {
    for (const mid of rc.mineralIds) out.add(mid);
  }
  return Array.from(out);
}

/**
 * The salts of one slot (alkalinity, calcium or magnesium) the kit can dose
 * from. A single-mineral concentrate whose bottle isn't configured can't dose
 * anything, so it only counts when the slot has nothing else: counted
 * alongside a working source it drew part (or all) of the slot's dose onto a
 * salt nobody could add, and that mineral was left out of the water. Alone,
 * it keeps the slot so its row shows with the "set bottle mL" prompt.
 */
function slotMineralIds(kit: MineralKit, slot: string[]): string[] {
  const usable = new Set(kit.minerals);
  for (const c of kit.concentrates) {
    if (c.mineralId && c.gramsPerMl > 0) usable.add(c.mineralId);
  }
  for (const rc of kit.recipeConcentrates) {
    for (const mid of rc.mineralIds) usable.add(mid);
  }
  const fromUsable = slot.filter((id) => usable.has(id));
  if (fromUsable.length > 0) return fromUsable;
  const all = availableMineralIds(kit);
  return slot.filter((id) => all.includes(id));
}

export const ALKALINITY_SLOT = ["baking-soda", "potassium-bicarbonate"];
export const CALCIUM_SLOT = ["calcium-chloride", "calcium-chloride-anhydrous", "gypsum"];
export const MAGNESIUM_SLOT = ["epsom-salt", "magnesium-chloride"];

/** Enabled alkalinity sources (baking-soda and/or potassium-bicarbonate). */
export function alkalinitySources(kit: MineralKit): string[] {
  const selected = slotMineralIds(kit, ALKALINITY_SLOT);
  const hasBakingSoda = selected.includes("baking-soda");
  const hasPotBicarb = selected.includes("potassium-bicarbonate");
  if (!hasBakingSoda && !hasPotBicarb) return [];
  if (hasBakingSoda && hasPotBicarb) return ["baking-soda", "potassium-bicarbonate"];
  if (hasBakingSoda) return ["baking-soda"];
  return ["potassium-bicarbonate"];
}

/**
 * The two calcium-chloride forms (dihydrate `calcium-chloride` and anhydrous
 * `calcium-chloride-anhydrous`) are chemically interchangeable: same Ca:Cl
 * ratio, differing only in grams per dose. The derivation logic treats them as
 * a single calcium-source slot, so collapse them to one representative here.
 * When both are enabled the dihydrate wins, unless the anhydrous form comes
 * from a configured single-mineral concentrate and the dihydrate doesn't.
 */
function calciumChlorideForm(kit: MineralKit, selected: string[]): string | null {
  if (selected.includes("calcium-chloride") && selected.includes("calcium-chloride-anhydrous")) {
    // Both forms available. A form backed by an enabled single-mineral
    // concentrate (DIY / brand) wins over a powder of the other form, matching
    // the calculator's "concentrate beats powder" conflict rule. Without this,
    // an anhydrous CaCl2 concentrate next to the default dihydrate starter kit
    // was never dosed at all (its row didn't render). Only a configured
    // concentrate counts: one ticked before its bottle mL and grams are set
    // can't dose anything, and letting it take the slot dropped the powder's
    // calcium entirely.
    const concentrateForms = new Set(
      kit.concentrates
        .filter((c) => c.gramsPerMl > 0)
        .map((c) => c.mineralId)
        .filter((id): id is string => !!id),
    );
    if (
      concentrateForms.has("calcium-chloride-anhydrous") &&
      !concentrateForms.has("calcium-chloride")
    ) {
      return "calcium-chloride-anhydrous";
    }
    return "calcium-chloride";
  }
  if (selected.includes("calcium-chloride")) return "calcium-chloride";
  if (selected.includes("calcium-chloride-anhydrous")) return "calcium-chloride-anhydrous";
  return null;
}

/** Enabled calcium sources (a calcium-chloride form and/or gypsum). */
export function calciumSources(kit: MineralKit): string[] {
  const selected = slotMineralIds(kit, CALCIUM_SLOT);
  const out: string[] = [];
  const cacl2 = calciumChlorideForm(kit, selected);
  if (cacl2) out.push(cacl2);
  if (selected.includes("gypsum")) out.push("gypsum");
  return out;
}

/** Enabled magnesium sources (epsom-salt and/or magnesium-chloride). */
export function magnesiumSources(kit: MineralKit): string[] {
  const selected = slotMineralIds(kit, MAGNESIUM_SLOT);
  const out: string[] = [];
  if (selected.includes("epsom-salt")) out.push("epsom-salt");
  if (selected.includes("magnesium-chloride")) out.push("magnesium-chloride");
  return out;
}

/** One calcium source for range bands: the calcium-chloride form wins over gypsum. */
export function singleCalciumSource(sources: string[]): string | null {
  if (sources.length === 0) return null;
  if (sources.length === 1) return sources[0] ?? null;
  return sources.find((s) => s !== "gypsum") ?? sources[0] ?? null;
}

/** One magnesium source for range bands: epsom-salt wins when both are enabled. */
export function singleMagnesiumSource(sources: string[]): string | null {
  if (sources.length === 0) return null;
  if (sources.length === 1) return sources[0] ?? null;
  return "epsom-salt";
}
