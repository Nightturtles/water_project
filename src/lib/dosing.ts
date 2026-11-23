// ============================================
// Dosing: what to add to a source water to reach a target
// ============================================
// The Calculator page's dose math as one pure function. The page gathers its
// inputs (source water, target fields, volume, the user's kit) and renders the
// result; the MCP server's calculate_doses tool calls the same function with
// the user's synced settings. Nothing here reads storage or the DOM, so both
// get identical numbers from identical inputs.

import {
  MINERAL_DB,
  BRAND_CONCENTRATES,
  ION_FIELDS,
  HCO3_TO_CACO3,
  ALK_TO_BAKING_SODA,
  ALK_TO_POTASSIUM_BICARB,
} from "./constants";
import type { IonMap, IonName } from "./constants";
import {
  allocateCaMgDoses,
  calculateIonPPMs,
  displayedConcentrateMl,
  displayedGrams,
  solveCalculatorDosing,
  splitAlkalinityDelta,
  toStableBicarbonateFromAlkalinity,
} from "./metrics";
import {
  alkalinitySources as kitAlkalinitySources,
  calciumSources as kitCalciumSources,
  concentrateDropMl,
  concentrateGramsPerMl,
  concentrateMineralId,
  magnesiumSources as kitMagnesiumSources,
  singleCalciumSource,
  singleMagnesiumSource,
} from "./mineral-sources";
import type { DiySpecLike, MineralKit } from "./mineral-sources";
import { computeStockMineralGramsPerL, getStockMineralIds } from "./storage";
import type { StockConcentrateSpec } from "./storage";

/** How a concentrate's dose is shown: whole drops, or mL to 3 decimals. */
export type DoseUnit = "ml" | "drops";

/** A selected single-mineral concentrate (Mineral Concentrate or brand). */
export interface DosingConcentrate {
  id: string;
  /** MINERAL_DB id it supplies, or null when unknown (then it is ignored). */
  mineralId: string | null;
  /** Grams of that salt per mL; 0 when the bottle is not configured yet. */
  gramsPerMl: number;
  /** mL per drop of its dropper; 0 when it is dosed in mL only. */
  dropMl: number;
  unit: DoseUnit;
}

/** A selected Recipe Concentrate whose spec exists. */
export interface DosingRecipeConcentrate {
  id: string;
  spec: StockConcentrateSpec;
  dropMl: number;
  unit: DoseUnit;
}

/** Everything the user has enabled to dose with, in selection order. */
export interface DosingKit {
  minerals: string[];
  concentrates: DosingConcentrate[];
  recipeConcentrates: DosingRecipeConcentrate[];
}

/** The target as the Calculator reads it: seven ions plus alkalinity as CaCO3. */
export interface DosingTarget {
  calcium: number;
  magnesium: number;
  alkalinity: number;
  potassium: number;
  sodium: number;
  sulfate: number;
  chloride: number;
  bicarbonate: number;
}

export interface DosingInput {
  sourceWater: IonMap;
  target: DosingTarget;
  volumeL: number;
  kit: DosingKit;
  /** The recipe being dosed for, so its own Recipe Concentrate is recognised. */
  recipeSlug?: string | null;
}

export interface DosingResult {
  /**
   * ok: doses were computed. no-volume: the volume is zero or invalid (doses
   * are all zero). no-alkalinity-source: neither baking soda nor potassium
   * bicarbonate is enabled, so nothing is computed.
   */
  status: "ok" | "no-volume" | "no-alkalinity-source";
  /** recipe-concentrates when any Recipe Concentrate is enabled; they then replace the per-mineral rows. */
  mode: "minerals" | "recipe-concentrates";
  /** The salts the kit can dose from, per slot. */
  sources: { alkalinity: string[]; calcium: string[]; magnesium: string[] };
  /** Exact grams of each powder for the whole volume (0 for an enabled but unused source). */
  mineralGrams: Record<string, number>;
  /** Exact mL of each single-mineral concentrate for the whole volume. */
  concentrateMl: Record<string, number>;
  /** Exact mL of each Recipe Concentrate for the whole volume. */
  recipeConcentrateMl: Record<string, number>;
  /** Recipe-concentrate mode: g/L of each powder topping up what the concentrates leave short. */
  supplementGramsPerL: Record<string, number>;
  /** Recipe-concentrate mode: a shortfall that needs a mineral the user has not enabled. */
  enableSuggestions: Array<{ ion: string; mineralId: string }>;
  /**
   * The amounts as the rows display them (grams to 0.01, whole drops or mL to
   * 0.001). Only rows the Calculator shows appear. finalIons is the water
   * THESE amounts make, not the exact solve.
   */
  shown: {
    mineralGrams: Record<string, number>;
    concentrateMl: Record<string, number>;
    recipeConcentrateMl: Record<string, number>;
    supplementGrams: Record<string, number>;
  };
  warnings: string[];
  /** The finished water (source + displayed doses); null unless status is ok. */
  finalIons: Record<IonName, number> | null;
  /** The sources the range bands are judged with. */
  rangeSources: {
    alkalinitySources: string[];
    calciumSource: string | null;
    magnesiumSource: string | null;
  };
}

function nonNegative(value: unknown): number {
  return Math.max(0, parseFloat(String(value ?? "")) || 0);
}

/** mL a concentrate row displays: whole drops when it has a dropper and is set to drops, else mL. */
function shownConcentrateMl(ml: number, row: { dropMl: number; unit: DoseUnit }): number {
  if (row.dropMl > 0) return displayedConcentrateMl(ml, row.unit, row.dropMl);
  return displayedConcentrateMl(ml, "ml", 0);
}

function toMineralKit(kit: DosingKit): MineralKit {
  return {
    minerals: kit.minerals,
    concentrates: kit.concentrates
      .filter((c) => !!c.mineralId)
      .map((c) => ({ id: c.id, mineralId: c.mineralId, gramsPerMl: c.gramsPerMl })),
    recipeConcentrates: kit.recipeConcentrates.map((rc) => ({
      id: rc.id,
      mineralIds: getStockMineralIds(rc.spec),
    })),
  };
}

/** The single calcium source the kit doses from (storage's getEffectiveCalciumSource, for a kit). */
export function effectiveCalciumSource(kit: DosingKit): string | null {
  return singleCalciumSource(kitCalciumSources(toMineralKit(kit)));
}

function finalIonsFrom(
  sourceWater: IonMap,
  mineralGramsPerL: Record<string, number>,
): Record<IonName, number> {
  const added = calculateIonPPMs(mineralGramsPerL);
  const out = {} as Record<IonName, number>;
  ION_FIELDS.forEach((ion) => {
    out[ion] = (sourceWater[ion] || 0) + (added[ion] || 0);
  });
  return out;
}

export function computeDoses(input: DosingInput): DosingResult {
  const { sourceWater, target, kit } = input;
  const volumeL = Number(input.volumeL) || 0;
  const mineralKit = toMineralKit(kit);
  const alkalinitySources = kitAlkalinitySources(mineralKit);
  const caSourceIds = kitCalciumSources(mineralKit);
  const mgSourceIds = kitMagnesiumSources(mineralKit);
  const stockEntries = kit.recipeConcentrates;
  const mode: DosingResult["mode"] = stockEntries.length > 0 ? "recipe-concentrates" : "minerals";

  const result: DosingResult = {
    status: "ok",
    mode,
    sources: { alkalinity: alkalinitySources, calcium: caSourceIds, magnesium: mgSourceIds },
    mineralGrams: {},
    concentrateMl: {},
    recipeConcentrateMl: {},
    supplementGramsPerL: {},
    enableSuggestions: [],
    shown: { mineralGrams: {}, concentrateMl: {}, recipeConcentrateMl: {}, supplementGrams: {} },
    warnings: [],
    finalIons: null,
    rangeSources: {
      alkalinitySources,
      calciumSource: singleCalciumSource(caSourceIds),
      magnesiumSource: singleMagnesiumSource(mgSourceIds),
    },
  };

  // Guard against divide-by-zero / nonsense volume
  if (!volumeL || volumeL <= 0) {
    result.status = "no-volume";
    alkalinitySources.forEach((id) => (result.mineralGrams[id] = 0));
    mgSourceIds.forEach((id) => (result.mineralGrams[id] = 0));
    caSourceIds.forEach((id) => (result.mineralGrams[id] = 0));
    for (const { id } of stockEntries) result.recipeConcentrateMl[id] = 0;
    return result;
  }

  if (alkalinitySources.length === 0) {
    result.status = "no-alkalinity-source";
    return result;
  }

  // Convert source bicarbonate to alkalinity as CaCO3
  const sourceAlkAsCaCO3 = (sourceWater.bicarbonate || 0) * HCO3_TO_CACO3;

  const targetCaMgL = nonNegative(target.calcium);
  const targetMgMgL = nonNegative(target.magnesium);
  const targetAlkAsCaCO3 = nonNegative(target.alkalinity);

  // Mineral deltas (target - source), floored at 0 further down
  const rawDeltaCa = targetCaMgL - (sourceWater.calcium || 0);
  const rawDeltaMg = targetMgMgL - (sourceWater.magnesium || 0);
  const rawDeltaAlk = targetAlkAsCaCO3 - sourceAlkAsCaCO3;

  // Active Recipe Concentrates: bypass the per-mineral picker entirely.
  if (stockEntries.length > 0) {
    // The solver matches on bicarbonate (ION_FIELDS), but the user edits the
    // Alkalinity input and the hidden bicarbonate field isn't synced from it.
    // Derive a consistent bicarbonate so a hand-typed custom Alkalinity isn't
    // read as zero.
    const solverTarget = Object.assign({}, target, {
      bicarbonate: toStableBicarbonateFromAlkalinity(targetAlkAsCaCO3, target.bicarbonate),
    });

    // Stage 1: best-fit concentrate doses (snapped). No mineral variables: the
    // concentrate is the primary, minerals only top up the residual in Stage 2.
    const solve = solveCalculatorDosing(sourceWater, solverTarget, stockEntries, [], {
      recipeSlug: input.recipeSlug ?? null,
    });
    const residualIons: Record<string, number> = solve.residualIons;

    // Stage 2: residual after the concentrate contribution, gap-filled with
    // individually-enabled minerals.
    const SUPP_THRESHOLD = 1; // mg/L; ignore sub-1 residual noise
    const residualCa = Math.max(0, residualIons.calcium || 0);
    const residualMg = Math.max(0, residualIons.magnesium || 0);
    const residualAlkAsCaCO3 = Math.max(0, (residualIons.bicarbonate || 0) * HCO3_TO_CACO3);

    // "Enabled" must mean individually selected: the kit's sources also
    // include minerals that live INSIDE an active concentrate.
    const selectedMinerals = kit.minerals;
    const supplementGramsPerL = result.supplementGramsPerL;
    const enableSuggestions = result.enableSuggestions;

    if (residualCa > SUPP_THRESHOLD) {
      const caId = ["calcium-chloride", "calcium-chloride-anhydrous", "gypsum"].find((id) =>
        selectedMinerals.includes(id),
      );
      if (caId) {
        const frac = MINERAL_DB[caId]?.ions?.calcium || 0;
        if (frac > 0) supplementGramsPerL[caId] = residualCa / frac / 1000;
      } else {
        enableSuggestions.push({ ion: "calcium", mineralId: "calcium-chloride" });
      }
    }

    if (residualMg > SUPP_THRESHOLD) {
      const mgId = ["epsom-salt", "magnesium-chloride"].find((id) => selectedMinerals.includes(id));
      if (mgId) {
        const frac = MINERAL_DB[mgId]?.ions?.magnesium || 0;
        if (frac > 0) supplementGramsPerL[mgId] = residualMg / frac / 1000;
      } else {
        enableSuggestions.push({ ion: "magnesium", mineralId: "epsom-salt" });
      }
    }

    if (residualAlkAsCaCO3 > SUPP_THRESHOLD) {
      const enabledAlk = ["baking-soda", "potassium-bicarbonate"].filter((id) =>
        selectedMinerals.includes(id),
      );
      if (enabledAlk.length > 0) {
        const alloc = splitAlkalinityDelta(
          enabledAlk,
          residualAlkAsCaCO3,
          sourceWater,
          solverTarget,
        );
        if ((alloc["baking-soda"] || 0) > 0) {
          supplementGramsPerL["baking-soda"] = (alloc["baking-soda"]! * ALK_TO_BAKING_SODA) / 1000;
        }
        if ((alloc["potassium-bicarbonate"] || 0) > 0) {
          supplementGramsPerL["potassium-bicarbonate"] =
            (alloc["potassium-bicarbonate"]! * ALK_TO_POTASSIUM_BICARB) / 1000;
        }
      } else {
        enableSuggestions.push({ ion: "bicarbonate", mineralId: "baking-soda" });
      }
    }

    // Each concentrate's solved/snapped dose x volume. The readout describes
    // the water the DISPLAYED doses make (whole drops, rounded mL / grams),
    // not the exact solve: see displayedGrams.
    const combinedStockMineralGramsPerL: Record<string, number> = {};
    for (const entry of stockEntries) {
      const ml = (solve.concentrateGramsPerL[entry.id] || 0) * volumeL;
      result.recipeConcentrateMl[entry.id] = ml;
      const shownMl = shownConcentrateMl(ml, entry);
      result.shown.recipeConcentrateMl[entry.id] = shownMl;
      const gPerL = shownMl / volumeL;
      const dosePerL = Number(entry.spec.doseGramsPerL) || 0;
      if (dosePerL > 0 && gPerL > 0) {
        const perLAtPrescribed = computeStockMineralGramsPerL(entry.spec);
        const scale = gPerL / dosePerL;
        for (const mid of Object.keys(perLAtPrescribed)) {
          combinedStockMineralGramsPerL[mid] =
            (combinedStockMineralGramsPerL[mid] || 0) + perLAtPrescribed[mid]! * scale;
        }
      }
    }

    // Fold supplement minerals into the final ion profile too.
    for (const [mid, gPerL] of Object.entries(supplementGramsPerL)) {
      if (gPerL > 0) {
        const shownGrams = displayedGrams(gPerL * volumeL);
        result.shown.supplementGrams[mid] = shownGrams;
        combinedStockMineralGramsPerL[mid] =
          (combinedStockMineralGramsPerL[mid] || 0) + shownGrams / volumeL;
      }
    }

    // Overshoot warnings: a negative residual means source + concentrate
    // already exceed the target for that ion. These stay on the exact solve
    // on purpose: they explain a limit of the concentrate against the target,
    // and must not appear or vanish because a dose rounded to a whole drop.
    const OVERSHOOT_TOL = 1; // mg/L
    if ((residualIons.calcium || 0) < -OVERSHOOT_TOL) {
      const achieved = Math.round(targetCaMgL - (residualIons.calcium || 0));
      result.warnings.push(
        `Source water + Recipe Concentrate already exceed the target for Calcium (${achieved} vs ${targetCaMgL} mg/L).`,
      );
    }
    if ((residualIons.magnesium || 0) < -OVERSHOOT_TOL) {
      const achieved = Math.round(targetMgMgL - (residualIons.magnesium || 0));
      result.warnings.push(
        `Source water + Recipe Concentrate already exceed the target for Magnesium (${achieved} vs ${targetMgMgL} mg/L).`,
      );
    }
    const alkResidAsCaCO3 = (residualIons.bicarbonate || 0) * HCO3_TO_CACO3;
    if (alkResidAsCaCO3 < -OVERSHOOT_TOL) {
      const achieved = Math.round(targetAlkAsCaCO3 - alkResidAsCaCO3);
      result.warnings.push(
        `Source water + Recipe Concentrate already exceed the target for Alkalinity (${achieved} vs ${targetAlkAsCaCO3} mg/L as CaCO₃).`,
      );
    }

    result.finalIons = finalIonsFrom(sourceWater, combinedStockMineralGramsPerL);
    return result;
  }

  const deltaCa = Math.max(0, rawDeltaCa);
  const deltaMg = Math.max(0, rawDeltaMg);
  const deltaAlkAsCaCO3 = Math.max(0, rawDeltaAlk);

  // May split a slot's delta across both of its enabled salts (e.g. epsom +
  // MgCl2) to match the target's SO4/Cl; caSource/mgSource carry the
  // dominant salt for warnings and range bands.
  const allocation = allocateCaMgDoses(sourceWater, target, deltaCa, deltaMg, {
    calcium: caSourceIds,
    magnesium: mgSourceIds,
  });
  result.rangeSources = {
    alkalinitySources,
    calciumSource: allocation.caSource,
    magnesiumSource: allocation.mgSource,
  };

  // Warn when source exceeds target or when we need a source but none is enabled
  const warnings = result.warnings;
  const selectedMinerals = kit.minerals;
  const conflictMineralIds = new Set<string>();
  // The two calcium-chloride forms fill one calcium slot, so a dihydrate
  // powder plus an anhydrous concentrate (or vice versa) is the same
  // "both versions" conflict; the concentrate's form wins (calciumSources).
  const CACL2_FORMS = ["calcium-chloride", "calcium-chloride-anhydrous"];
  kit.concentrates.forEach((c) => {
    const mineralId = c.mineralId;
    if (!mineralId) return;
    const sameSlot = CACL2_FORMS.includes(mineralId)
      ? CACL2_FORMS.some((form) => selectedMinerals.includes(form))
      : selectedMinerals.includes(mineralId);
    if (sameSlot) conflictMineralIds.add(mineralId);
  });
  if (conflictMineralIds.size > 0) {
    warnings.push(
      "You’ve selected both the normal and concentrate version of a mineral. We will default to using the concentrate.",
    );
  }
  if (rawDeltaCa < 0)
    warnings.push(
      `Your source water already exceeds the target for Calcium (${sourceWater.calcium || 0} vs ${targetCaMgL} mg/L).`,
    );
  if (rawDeltaMg < 0)
    warnings.push(
      `Your source water already exceeds the target for Magnesium (${sourceWater.magnesium || 0} vs ${targetMgMgL} mg/L).`,
    );
  if (rawDeltaAlk < 0)
    warnings.push(
      `Your source water already exceeds the target for Alkalinity (${Math.round(sourceAlkAsCaCO3)} vs ${targetAlkAsCaCO3} mg/L as CaCO₃).`,
    );
  if (mgSourceIds.length === 0 && deltaMg > 0)
    warnings.push("You need an enabled magnesium source (Epsom Salt or Magnesium Chloride).");
  if (caSourceIds.length === 0 && deltaCa > 0)
    warnings.push("You need an enabled calcium source (Calcium Chloride or Gypsum).");

  // Salt doses (g/L) from the allocator; a blended slot yields two entries.
  const caMgGramsPerL = allocation.gramsPerL;

  // Alkalinity: one source or split between baking soda and potassium bicarbonate
  const alkAllocation = splitAlkalinityDelta(
    alkalinitySources,
    deltaAlkAsCaCO3,
    sourceWater,
    target,
  );
  const bufferGramsPerL: Record<string, number> = {};
  if (alkAllocation["baking-soda"] != null && alkAllocation["baking-soda"] > 0) {
    bufferGramsPerL["baking-soda"] = (alkAllocation["baking-soda"] * ALK_TO_BAKING_SODA) / 1000;
  }
  if (
    alkAllocation["potassium-bicarbonate"] != null &&
    alkAllocation["potassium-bicarbonate"] > 0
  ) {
    bufferGramsPerL["potassium-bicarbonate"] =
      (alkAllocation["potassium-bicarbonate"] * ALK_TO_POTASSIUM_BICARB) / 1000;
  }

  // Warn when both alkalinity sources are enabled but the split is entirely one-sided
  if (alkalinitySources.length === 2 && deltaAlkAsCaCO3 > 0) {
    const usedSources = Object.keys(alkAllocation).filter((k) => alkAllocation[k]! > 0);
    if (usedSources.length === 1) {
      const usedName = usedSources[0] === "baking-soda" ? "Baking Soda" : "Potassium Bicarbonate";
      // Say why the split is one-sided: the unused buffer's ion is either
      // already met by the source water, absent from the target, or neither
      // ion is targeted at all.
      const targetNa = Number(target && target.sodium) || 0;
      const targetK = Number(target && target.potassium) || 0;
      const usedSodium = usedSources[0] === "baking-soda";
      const unusedIon = usedSodium ? "potassium" : "sodium";
      const unusedTarget = usedSodium ? targetK : targetNa;
      const usedTarget = usedSodium ? targetNa : targetK;
      const reason =
        unusedTarget > 0
          ? "your source water already meets the " + unusedIon + " target"
          : usedTarget > 0
            ? "the target profile only calls for " + (usedSodium ? "sodium" : "potassium")
            : "the target profile has no Na/K targets to guide the split";
      warnings.push(
        "Both alkalinity sources are enabled, but " + reason + ": using only " + usedName + ".",
      );
    }
  }

  // Total grams for the full volume; 0 for undosed Ca/Mg sources so the rows
  // show which were used.
  const resultValues: Record<string, number> = {};
  for (const [id, gPerL] of Object.entries(bufferGramsPerL)) {
    resultValues[id] = gPerL * volumeL;
  }
  for (const [id, gPerL] of Object.entries(caMgGramsPerL)) {
    resultValues[id] = gPerL * volumeL;
  }
  mgSourceIds.forEach((id) => {
    if (resultValues[id] == null) resultValues[id] = 0;
  });
  caSourceIds.forEach((id) => {
    if (resultValues[id] == null) resultValues[id] = 0;
  });

  // A salt that also has a concentrate enabled is dosed by the concentrate.
  const mineralGrams: Record<string, number> = { ...resultValues };
  conflictMineralIds.forEach((mineralId) => {
    mineralGrams[mineralId] = 0;
  });
  result.mineralGrams = mineralGrams;

  // The rows the Calculator shows: a powder row for each dosing source the
  // user selected as a powder, and a concentrate row for each concentrate
  // whose salt is one of the dosing sources.
  const rowSources = new Set([...mgSourceIds, ...alkalinitySources, ...caSourceIds]);
  for (const [mineralId, grams] of Object.entries(mineralGrams)) {
    if (selectedMinerals.includes(mineralId) && MINERAL_DB[mineralId]) {
      result.shown.mineralGrams[mineralId] = displayedGrams(grams);
    }
  }

  // Each salt's dose is delivered once. When two enabled concentrates map to
  // the same salt (e.g. Lotus Calcium + a DIY calcium-chloride concentrate),
  // the first usable one carries the whole dose and the rest show 0; giving
  // every one of them the full dose doubled the salt for anyone following
  // the rows (the ion summary below only ever counted it once).
  const dosedByConcentrate: Record<string, string> = {};
  const sharedSaltNames = new Set<string>();
  kit.concentrates.forEach((c) => {
    const mineralId = c.mineralId;
    if (!mineralId) return;
    const grams = resultValues[mineralId] != null ? Number(resultValues[mineralId]) : 0;
    const gramsPerMl = c.gramsPerMl;
    if (!Number.isFinite(gramsPerMl) || gramsPerMl <= 0) {
      result.concentrateMl[c.id] = 0;
      if (grams > 0 && !dosedByConcentrate[mineralId])
        warnings.push("Set bottle mL and grams per bottle in Settings to use this concentrate.");
      return;
    }
    if (dosedByConcentrate[mineralId]) {
      result.concentrateMl[c.id] = 0;
      if (grams > 0) sharedSaltNames.add(MINERAL_DB[mineralId]?.name || mineralId);
      return;
    }
    dosedByConcentrate[mineralId] = c.id;
    result.concentrateMl[c.id] = Math.max(0, grams / gramsPerMl);
  });
  sharedSaltNames.forEach((name) => {
    warnings.push(
      "More than one enabled concentrate supplies " +
        name +
        ". Only the first one is dosed; use just that one.",
    );
  });
  for (const c of kit.concentrates) {
    if (!c.mineralId || !rowSources.has(c.mineralId)) continue;
    if (!BRAND_CONCENTRATES[c.id] && !MINERAL_DB[c.mineralId]) continue;
    result.shown.concentrateMl[c.id] = shownConcentrateMl(result.concentrateMl[c.id] || 0, c);
  }

  // Resulting ions (mg/L) from the doses the rows DISPLAY (whole drops,
  // rounded mL / grams), not the exact solve, so the readout is the water the
  // user actually mixes: the same drop count in more water reads more dilute.
  // Range bands follow it too, since they judge that water.
  const mineralGramsPerL: Record<string, number> = {};
  for (const [id, grams] of Object.entries(result.shown.mineralGrams)) {
    if (grams > 0) mineralGramsPerL[id] = grams / volumeL;
  }
  for (const c of kit.concentrates) {
    const ml = result.shown.concentrateMl[c.id];
    if (!c.mineralId || ml == null || !(ml > 0) || !(c.gramsPerMl > 0)) continue;
    mineralGramsPerL[c.mineralId] =
      (mineralGramsPerL[c.mineralId] || 0) + (ml * c.gramsPerMl) / volumeL;
  }
  result.finalIons = finalIonsFrom(sourceWater, mineralGramsPerL);
  return result;
}

/** The saved settings a dosing kit is built from (a user_settings row, or this browser's storage). */
export interface KitSettings {
  /** Selected powders; anything but an array means "never chosen" and gets the starter kit. */
  selectedMinerals: unknown;
  selectedConcentrates: unknown;
  diySpecs: Record<string, DiySpecLike | undefined> | null | undefined;
  stockSpecs: Record<string, StockConcentrateSpec | undefined> | null | undefined;
  lotusDropperType: unknown;
  /** Per-concentrate display unit; a concentrate with a dropper shows drops unless set to "ml". */
  concentrateUnits: Record<string, unknown> | null | undefined;
}

/** The powders a new user starts with (storage.ts's DEFAULT_SELECTED_MINERALS). */
export const STARTER_MINERALS = ["calcium-chloride", "epsom-salt", "baking-soda"];

/**
 * The dosing kit for a set of saved settings: what the Calculator page would
 * dose with, and how it would display each concentrate, for a user whose
 * settings are these.
 */
export function buildDosingKit(settings: KitSettings): DosingKit {
  const minerals = Array.isArray(settings.selectedMinerals)
    ? settings.selectedMinerals.filter((id): id is string => typeof id === "string")
    : STARTER_MINERALS.slice();
  const selected = Array.isArray(settings.selectedConcentrates)
    ? settings.selectedConcentrates.filter(
        (id): id is string =>
          typeof id === "string" &&
          (id.startsWith("diy:") || id.startsWith("brand:") || id.startsWith("stock:")),
      )
    : [];
  const diySpecs = settings.diySpecs || {};
  const stockSpecs = settings.stockSpecs || {};
  const units = settings.concentrateUnits || {};
  const displayOf = (id: string): { dropMl: number; unit: DoseUnit } => {
    const dropMl = concentrateDropMl(id, {
      lotusDropperType: settings.lotusDropperType,
      diySpecs,
      stockSpecs,
    });
    if (!(dropMl > 0)) return { dropMl: 0, unit: "ml" };
    return { dropMl, unit: units[id] === "ml" ? "ml" : "drops" };
  };
  const kit: DosingKit = { minerals, concentrates: [], recipeConcentrates: [] };
  for (const id of selected) {
    if (id.startsWith("stock:")) {
      const spec = stockSpecs[id.slice(6)];
      if (spec) kit.recipeConcentrates.push({ id, spec, ...displayOf(id) });
      continue;
    }
    kit.concentrates.push({
      id,
      mineralId: concentrateMineralId(id),
      gramsPerMl: concentrateGramsPerMl(id, diySpecs),
      ...displayOf(id),
    });
  }
  return kit;
}
