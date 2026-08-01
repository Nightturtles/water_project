// ============================================
// Metrics — water chemistry calculations
// ============================================
// Constants and storage helpers come in by ES import; DerivedMetrics and
// MineralGrams are defined and exported here. Published onto window via
// legacy-globals.ts (Object.assign) for the inline page scripts
// (recipe/taste/minerals DOMContentLoaded blocks) and e2e page-context reads.

import {
  MINERAL_DB,
  MINERAL_SOLUBILITY_G_PER_L_25C_APPROX,
  ION_FIELDS,
  CA_TO_CACO3,
  MG_TO_CACO3,
  HCO3_TO_CACO3,
  CACO3_TO_HCO3,
  ALK_TO_BAKING_SODA,
  ALK_TO_POTASSIUM_BICARB,
  WATER_PROFILE_RANGE_BANDS,
  RANGE_SEVERITY_ORDER,
} from "./constants";
import type { IonName, IonMap, TargetProfile } from "./constants";
import {
  getEffectiveCalciumSources,
  getEffectiveMagnesiumSources,
  getEffectiveAlkalinitySources,
  getEffectiveCalciumSource,
  getEffectiveMagnesiumSource,
  getEffectiveAlkalinitySource,
  getSourceWaterByPreset,
  loadSourcePresetName,
  loadBrewMethod,
  computeStockMineralGramsPerL,
} from "./storage";
import type { StockConcentrateSpec } from "./storage";

/** Headline water metrics: GH / KH as mg/L CaCO3, TDS as mg/L. */
export interface DerivedMetrics {
  /** General hardness as CaCO3 (mg/L). */
  gh: number;
  /** Carbonate hardness / alkalinity as CaCO3 (mg/L). */
  kh: number;
  /** Total dissolved solids — sum of contributing ions (mg/L). */
  tds: number;
}

/** Grams of each mineral salt, keyed by MINERAL_DB id. */
export type MineralGrams = Record<string, number>;

type Severity = "danger" | "warn" | "info";

/**
 * Convert grams-per-liter of mineral salts into ion concentrations (mg/L).
 */
export function calculateIonPPMs(mineralGrams: MineralGrams): Record<IonName, number> {
  const ions: Record<IonName, number> = {
    calcium: 0,
    magnesium: 0,
    potassium: 0,
    sodium: 0,
    sulfate: 0,
    chloride: 0,
    bicarbonate: 0,
  };

  for (const [mineralId, grams] of Object.entries(mineralGrams)) {
    const mineral = MINERAL_DB[mineralId];
    if (!mineral) continue;
    for (const [ion, fraction] of Object.entries(mineral.ions)) {
      const key = ion as IonName;
      const frac = fraction ?? 0;
      ions[key] += grams * frac * 1000; // g/L * fraction * 1000 = mg/L
    }
  }

  return ions;
}

/**
 * Compute GH / KH / TDS from an ion map (CaCO3-equivalent for GH and KH).
 */
export function calculateMetrics(ions: IonMap): DerivedMetrics {
  const gh = (ions.calcium || 0) * CA_TO_CACO3 + (ions.magnesium || 0) * MG_TO_CACO3;
  const kh = (ions.bicarbonate || 0) * HCO3_TO_CACO3;
  const tds =
    (ions.calcium || 0) +
    (ions.magnesium || 0) +
    (ions.potassium || 0) +
    (ions.sodium || 0) +
    (ions.sulfate || 0) +
    (ions.chloride || 0) +
    (ions.bicarbonate || 0);
  return { gh, kh, tds };
}

/**
 * Headline water metrics for a recipe's display surfaces, rounded to integers:
 * GH and KH as mg/L CaCO3, TDS as mg/L (ppm). GH is the Ca + Mg hardness; KH
 * comes from the recipe's alkalinity (already CaCO3, so it equals carbonate
 * hardness), falling back to bicarbonate x HCO3_TO_CACO3 when alkalinity is
 * absent so both alkalinity-only rows (e.g. the SCA preset shim) and
 * bicarbonate-only rows report a correct KH. TDS is the sum of all
 * ion concentrations, matching calculateMetrics. Used by the slim cards (GH/KH)
 * and the library detail modal (GH/KH/TDS).
 */
export function recipeMetricsSummary(recipe?: {
  calcium?: number | null;
  magnesium?: number | null;
  alkalinity?: number | null;
  potassium?: number | null;
  sodium?: number | null;
  sulfate?: number | null;
  chloride?: number | null;
  bicarbonate?: number | null;
}): { gh: number; kh: number; tds: number } {
  recipe = recipe || {};
  const gh =
    (Number(recipe.calcium) || 0) * CA_TO_CACO3 + (Number(recipe.magnesium) || 0) * MG_TO_CACO3;
  // Prefer alkalinity (already CaCO3 = KH); fall back to deriving KH from
  // bicarbonate when alkalinity is absent, mirroring calculateMetrics.
  const alk = Number(recipe.alkalinity);
  const kh =
    recipe.alkalinity != null && Number.isFinite(alk)
      ? alk
      : (Number(recipe.bicarbonate) || 0) * HCO3_TO_CACO3;
  const tds =
    (Number(recipe.calcium) || 0) +
    (Number(recipe.magnesium) || 0) +
    (Number(recipe.potassium) || 0) +
    (Number(recipe.sodium) || 0) +
    (Number(recipe.sulfate) || 0) +
    (Number(recipe.chloride) || 0) +
    (Number(recipe.bicarbonate) || 0);
  return { gh: Math.round(gh), kh: Math.round(kh), tds: Math.round(tds) };
}

/**
 * SO4:Cl ratio, or null when chloride is absent/zero.
 * Defensive; accepts partial/malformed inputs from storage.
 */
export function calculateSo4ClRatio(ions: unknown): number | null {
  if (!ions || typeof ions !== "object") return null;
  const ionRecord = ions as Record<string, unknown>;
  const sulfate = Number(ionRecord.sulfate);
  const chloride = Number(ionRecord.chloride);
  if (!Number.isFinite(sulfate) || !Number.isFinite(chloride) || chloride <= 0) return null;
  return sulfate / chloride;
}

export function toStableBicarbonateFromAlkalinity(
  alkAsCaCO3: number | string | null | undefined,
  existingBicarbonate: number | string | null | undefined,
): number {
  const alkRounded = Math.round(parseFloat(String(alkAsCaCO3 ?? "")) || 0);
  const candidate = Math.round(alkRounded * CACO3_TO_HCO3 * 10) / 10;
  const existing = Math.round((parseFloat(String(existingBicarbonate ?? "")) || 0) * 10) / 10;
  const candidateAlk = Math.round(candidate * HCO3_TO_CACO3);
  const existingAlk = Math.round(existing * HCO3_TO_CACO3);
  if (existingAlk === alkRounded) return existing;
  if (candidateAlk === alkRounded) return candidate;
  return candidate;
}

/**
 * Pick the Ca/Mg salt combination whose side-effect ion additions best match
 * the target's chloride/sulfate.
 */
export function pickBestCaMgSources(
  sourceWater: IonMap,
  targetProfile: Partial<TargetProfile> | Partial<Record<IonName, number>> | null | undefined,
  deltaCa: number,
  deltaMg: number,
): { caSource: string | null; mgSource: string | null } {
  const caSources = getEffectiveCalciumSources();
  const mgSources = getEffectiveMagnesiumSources();
  // caSources/mgSources are already empty arrays when no sources are enabled,
  // so the candidate lists are just the source lists. (The prior needCa/needMg
  // ternaries always resolved to the same value and were effectively dead.)
  const caCandidates = caSources;
  const mgCandidates = mgSources;

  if (caCandidates.length === 0 && mgCandidates.length === 0) {
    return {
      caSource:
        caSources.length === 1
          ? (caSources[0] ?? null)
          : caSources.length === 2
            ? (caSources.find((s) => s !== "gypsum") ?? caSources[0] ?? null)
            : null,
      mgSource:
        mgSources.length === 1
          ? (mgSources[0] ?? null)
          : mgSources.length === 2
            ? "epsom-salt"
            : null,
    };
  }

  const targetCl =
    targetProfile && Number.isFinite(Number(targetProfile.chloride))
      ? Number(targetProfile.chloride)
      : null;
  const targetSO4 =
    targetProfile && Number.isFinite(Number(targetProfile.sulfate))
      ? Number(targetProfile.sulfate)
      : null;
  const srcCl = (sourceWater && Number(sourceWater.chloride)) || 0;
  const srcSO4 = (sourceWater && Number(sourceWater.sulfate)) || 0;

  let best: { caSource: string | null; mgSource: string | null; error: number; tieBreak: number } =
    { caSource: null, mgSource: null, error: Infinity, tieBreak: Infinity };

  const caOpts: (string | null)[] = caCandidates.length ? caCandidates : [null];
  const mgOpts: (string | null)[] = mgCandidates.length ? mgCandidates : [null];

  for (const caSrc of caOpts) {
    for (const mgSrc of mgOpts) {
      const mineralGrams: MineralGrams = {};
      if (caSrc && deltaCa > 0) {
        const caFrac =
          MINERAL_DB[caSrc] && MINERAL_DB[caSrc].ions ? (MINERAL_DB[caSrc].ions.calcium ?? 0) : 0;
        if (caFrac > 0) mineralGrams[caSrc] = deltaCa / 1000 / caFrac;
      }
      if (mgSrc && deltaMg > 0) {
        const mgFrac =
          MINERAL_DB[mgSrc] && MINERAL_DB[mgSrc].ions ? (MINERAL_DB[mgSrc].ions.magnesium ?? 0) : 0;
        if (mgFrac > 0) mineralGrams[mgSrc] = deltaMg / 1000 / mgFrac;
      }
      const added = calculateIonPPMs(mineralGrams);
      const result: Record<IonName, number> = {
        calcium: 0,
        magnesium: 0,
        potassium: 0,
        sodium: 0,
        sulfate: 0,
        chloride: 0,
        bicarbonate: 0,
      };
      ION_FIELDS.forEach((ion) => {
        const src = sourceWater ? sourceWater[ion] : undefined;
        result[ion] = (src ? Number(src) : 0) + (added[ion] || 0);
      });
      let error;
      if (targetCl != null && targetSO4 != null) {
        error =
          Math.pow((result.chloride || 0) - targetCl, 2) +
          Math.pow((result.sulfate || 0) - targetSO4, 2);
      } else {
        error =
          Math.pow((result.chloride || 0) - srcCl, 2) + Math.pow((result.sulfate || 0) - srcSO4, 2);
      }
      const tieBreak = (caSrc === "gypsum" ? 1 : 0) + (mgSrc === "magnesium-chloride" ? 2 : 0);
      if (error < best.error || (error === best.error && tieBreak < best.tieBreak)) {
        best = { caSource: caSrc, mgSource: mgSrc, error, tieBreak };
      }
    }
  }

  return {
    caSource: best.caSource,
    mgSource: best.mgSource,
  };
}

/** Result of allocateCaMgDoses: per-salt doses plus a dominant source per slot. */
export interface CaMgAllocation {
  /** g/L of each dosed salt; only salts with a nonzero dose appear. */
  gramsPerL: Record<string, number>;
  /** Salt carrying the majority of the calcium delta (warnings / range bands). */
  caSource: string | null;
  /** Salt carrying the majority of the magnesium delta. */
  mgSource: string | null;
  /** True when either slot splits its delta across two salts. */
  blended: boolean;
}

/**
 * Dose the Ca/Mg deltas across the enabled salts so the added sulfate and
 * chloride land as close as possible (least squares) to the target profile's
 * SO4/Cl, while still delivering the Ca and Mg deltas exactly.
 *
 * Unlike pickBestCaMgSources (kept for its existing callers), a slot with
 * both of its salts enabled may SPLIT its delta — e.g. Mg 10 as epsom 2 +
 * MgCl2 8 — which is the only way to reach SO4:Cl ratios between the
 * all-sulfate and all-chloride corners. The solve reduces to one scalar:
 * every divalent cation pairs with one SO4²⁻ or two Cl⁻, so added sulfate
 * trades against added chloride at the fixed mass ratio κ = 96.06/70.906
 * regardless of which salt carries it. Least-squares over (SO4, Cl) is then
 * a 1-D quadratic in "total sulfate carried by the blendable slots", solved
 * in closed form and clamped to capacity.
 *
 * Tie-breaks (any split with the same sulfate total yields identical water):
 * sulfate rides Mg (epsom) before Ca (gypsum is solubility-limited and
 * disfavored, matching pickBestCaMgSources). A slot within 2% of a pure
 * corner snaps to it, so profiles without a meaningful SO4/Cl target keep
 * producing the classic single-salt dose. When the profile omits BOTH ions
 * (non-finite, e.g. a Ca/Mg/Alk-only partial profile) blending is skipped
 * entirely and the legacy least-added-anion corner is chosen.
 */
export function allocateCaMgDoses(
  sourceWater: IonMap | null | undefined,
  targetProfile: Partial<TargetProfile> | Partial<Record<IonName, number>> | null | undefined,
  deltaCa: number,
  deltaMg: number,
): CaMgAllocation {
  const caSources = getEffectiveCalciumSources();
  const mgSources = getEffectiveMagnesiumSources();
  const caCl2Form = caSources.find((s) => s !== "gypsum") ?? null;
  const hasGypsum = caSources.includes("gypsum");
  const hasEpsom = mgSources.includes("epsom-salt");
  const hasMgCl2 = mgSources.includes("magnesium-chloride");

  // mg of anion delivered per mg of cation for a given salt.
  const yieldOf = (mineralId: string, anion: IonName, cation: IonName): number => {
    const ions = MINERAL_DB[mineralId] ? MINERAL_DB[mineralId].ions : null;
    const anionFrac = (ions && ions[anion]) || 0;
    const cationFrac = (ions && ions[cation]) || 0;
    return cationFrac > 0 ? anionFrac / cationFrac : 0;
  };
  const so4PerMg = yieldOf("epsom-salt", "sulfate", "magnesium");
  const clPerMg = yieldOf("magnesium-chloride", "chloride", "magnesium");
  const so4PerCa = yieldOf("gypsum", "sulfate", "calcium");
  const clPerCa = yieldOf(caCl2Form ?? "calcium-chloride", "chloride", "calcium");

  const dCa = Math.max(0, Number(deltaCa) || 0);
  const dMg = Math.max(0, Number(deltaMg) || 0);

  const srcSO4 = (sourceWater && Number(sourceWater.sulfate)) || 0;
  const srcCl = (sourceWater && Number(sourceWater.chloride)) || 0;
  const tSO4 = targetProfile ? Number(targetProfile.sulfate) : NaN;
  const tCl = targetProfile ? Number(targetProfile.chloride) : NaN;
  const hasAnionTarget = Number.isFinite(tSO4) || Number.isFinite(tCl);
  // Added-anion goals. A finite 0 is an expressed preference ("as little as
  // possible", blend allowed); when BOTH fields are absent the profile has no
  // SO4/Cl opinion at all and the corner search below keeps the legacy
  // single-salt-per-slot outcome (computeFullProfile's partial-profile
  // fallback reaches that path).
  const wantS = Number.isFinite(tSO4) ? Math.max(0, tSO4 - srcSO4) : 0;
  const wantC = Number.isFinite(tCl) ? Math.max(0, tCl - srcCl) : 0;

  // A slot is free (blendable) when both of its salts are enabled and there
  // is a delta to place; otherwise its anion side effect is fixed by the
  // single enabled salt.
  const mgFree = dMg > 0 && hasEpsom && hasMgCl2;
  const caFree = dCa > 0 && caCl2Form != null && hasGypsum;
  let fixedS = 0;
  let fixedC = 0;
  if (dMg > 0 && !mgFree) {
    if (hasEpsom) fixedS += dMg * so4PerMg;
    else if (hasMgCl2) fixedC += dMg * clPerMg;
  }
  if (dCa > 0 && !caFree) {
    if (caCl2Form) fixedC += dCa * clPerCa;
    else if (hasGypsum) fixedS += dCa * so4PerCa;
  }

  // Free-slot capacities. κ is salt-independent (see docstring), so a single
  // scalar S — total sulfate carried by the free slots — describes every
  // reachable water: addedSO4 = fixedS + S, addedCl = fixedC + Ufree - S/κ.
  const capSMg = mgFree ? dMg * so4PerMg : 0;
  const capSCa = caFree ? dCa * so4PerCa : 0;
  const sMax = capSMg + capSCa;
  const uFree = (mgFree ? dMg * clPerMg : 0) + (caFree ? dCa * clPerCa : 0);
  const kappa = uFree > 0 ? sMax / uFree : 0;

  let sOnMg = 0;
  let sOnCa = 0;
  if (sMax > 0 && kappa > 0) {
    if (!hasAnionTarget) {
      // No SO4/Cl opinion: evaluate only the pure corners so a free slot
      // never splits, and break ties like pickBestCaMgSources (CaCl2 over
      // gypsum, then epsom over MgCl2).
      let best: { sMg: number; sCa: number; err: number; tie: number } | null = null;
      for (const smg of mgFree ? [capSMg, 0] : [0]) {
        for (const sca of caFree ? [0, capSCa] : [0]) {
          const so4 = fixedS + smg + sca;
          const cl = fixedC + uFree - (smg + sca) / kappa;
          const err = so4 * so4 + cl * cl;
          const tie = (sca > 0 ? 1 : 0) + (mgFree && smg === 0 ? 2 : 0);
          if (!best || err < best.err || (err === best.err && tie < best.tie)) {
            best = { sMg: smg, sCa: sca, err, tie };
          }
        }
      }
      sOnMg = best ? best.sMg : 0;
      sOnCa = best ? best.sCa : 0;
    } else {
      const a = wantS - fixedS; // sulfate still wanted from the free slots
      const b = fixedC + uFree - wantC; // chloride overshoot if the free slots add none of it as sulfate
      let s = (kappa * (kappa * a + b)) / (kappa * kappa + 1);
      s = Math.min(sMax, Math.max(0, s));
      // Sulfate rides Mg (epsom) first, then Ca (gypsum).
      sOnMg = Math.min(s, capSMg);
      sOnCa = Math.min(s - sOnMg, capSCa);
    }
  }

  // Cation mass carried by the sulfate salt in each free slot, snapped so
  // near-pure allocations collapse to the classic single salt.
  const SNAP_SHARE = 0.02;
  const snapShare = (cationOnSulfate: number, delta: number): number => {
    if (delta <= 0) return 0;
    if (cationOnSulfate < SNAP_SHARE * delta) return 0;
    if (cationOnSulfate > (1 - SNAP_SHARE) * delta) return delta;
    return cationOnSulfate;
  };
  let mgOnEpsom = 0;
  if (mgFree) mgOnEpsom = snapShare(so4PerMg > 0 ? sOnMg / so4PerMg : 0, dMg);
  else if (dMg > 0 && hasEpsom) mgOnEpsom = dMg;
  const mgOnMgCl2 = hasMgCl2 ? Math.max(0, dMg - mgOnEpsom) : 0;
  let caOnGypsum = 0;
  if (caFree) caOnGypsum = snapShare(so4PerCa > 0 ? sOnCa / so4PerCa : 0, dCa);
  else if (dCa > 0 && hasGypsum && !caCl2Form) caOnGypsum = dCa;
  const caOnCaCl2 = caCl2Form ? Math.max(0, dCa - caOnGypsum) : 0;

  const gramsPerL: Record<string, number> = {};
  const addSalt = (mineralId: string | null, cationMgL: number, cation: IonName): void => {
    if (!mineralId || cationMgL <= 0) return;
    const frac = (MINERAL_DB[mineralId] && MINERAL_DB[mineralId].ions[cation]) || 0;
    if (frac > 0) gramsPerL[mineralId] = (gramsPerL[mineralId] || 0) + cationMgL / frac / 1000;
  };
  addSalt("epsom-salt", mgOnEpsom, "magnesium");
  addSalt("magnesium-chloride", mgOnMgCl2, "magnesium");
  addSalt("gypsum", caOnGypsum, "calcium");
  addSalt(caCl2Form, caOnCaCl2, "calcium");

  // Dominant source per slot; the zero-delta fallbacks mirror
  // pickBestCaMgSources so range guidance keeps rendering.
  let mgSource: string | null = null;
  if (mgOnEpsom > 0 || mgOnMgCl2 > 0) {
    mgSource = mgOnEpsom >= mgOnMgCl2 ? "epsom-salt" : "magnesium-chloride";
  } else if (mgSources.length > 0) {
    mgSource = mgSources.length === 1 ? (mgSources[0] ?? null) : "epsom-salt";
  }
  let caSource: string | null = null;
  if (caOnGypsum > 0 || caOnCaCl2 > 0) {
    caSource = caOnCaCl2 >= caOnGypsum ? (caCl2Form ?? "gypsum") : "gypsum";
  } else if (caSources.length > 0) {
    caSource = caCl2Form ?? caSources[0] ?? null;
  }

  return {
    gramsPerL,
    caSource,
    mgSource,
    blended: (mgOnEpsom > 0 && mgOnMgCl2 > 0) || (caOnGypsum > 0 && caOnCaCl2 > 0),
  };
}

export function evaluateWaterProfileRanges(
  ions: IonMap | null | undefined,
  options: {
    includeAdvanced?: boolean;
    alkalinitySources?: string[];
    calciumSource?: string | null;
    magnesiumSource?: string | null;
    brewMethod?: string | null;
  } = {},
): {
  findings: { severity: Severity; message: string }[];
  metrics: DerivedMetrics;
  ratio: number | null;
} {
  const normalized: Record<IonName, number> = {
    calcium: 0,
    magnesium: 0,
    potassium: 0,
    sodium: 0,
    sulfate: 0,
    chloride: 0,
    bicarbonate: 0,
  };
  ION_FIELDS.forEach((ion) => {
    const raw = ions ? ions[ion] : undefined;
    normalized[ion] = Number.isFinite(Number(raw)) ? Number(raw) : 0;
  });
  const metrics = calculateMetrics(normalized);
  const ratio = calculateSo4ClRatio(normalized);
  const includeAdvanced = options.includeAdvanced !== false;
  const alkalinitySources =
    options.alkalinitySources !== undefined
      ? options.alkalinitySources
      : (() => {
          const s = getEffectiveAlkalinitySource();
          return s ? [s] : [];
        })();
  const calciumSource =
    options.calciumSource !== undefined ? options.calciumSource : getEffectiveCalciumSource();
  const magnesiumSource =
    options.magnesiumSource !== undefined ? options.magnesiumSource : getEffectiveMagnesiumSource();
  const brewMethod = options.brewMethod === "espresso" ? "espresso" : "filter";
  const methodBands = WATER_PROFILE_RANGE_BANDS[brewMethod] || WATER_PROFILE_RANGE_BANDS.filter;
  const findings: { severity: Severity; message: string }[] = [];

  function addFinding(severity: Severity, message: string) {
    findings.push({ severity, message });
  }

  function formatBand(min: number | null, max: number | null, unit?: string) {
    if (min != null && max != null) return `${min}-${max}${unit ? " " + unit : ""}`;
    if (min != null) return `>=${min}${unit ? " " + unit : ""}`;
    if (max != null) return `<=${max}${unit ? " " + unit : ""}`;
    return "n/a";
  }

  function addBandFinding(
    label: string,
    value: number,
    unit: string,
    preferredMin: number | null,
    preferredMax: number | null,
    warnMin: number | null,
    warnMax: number | null,
    dangerMin: number | null,
    dangerMax: number | null,
  ) {
    if (!Number.isFinite(value)) return;
    const rounded = Math.round(value * 10) / 10;
    const valueText = `${rounded}${unit ? " " + unit : ""}`;
    const preferredBand = formatBand(preferredMin, preferredMax, unit);
    const direction =
      (preferredMin != null && value < preferredMin) ||
      (warnMin != null && value < warnMin) ||
      (dangerMin != null && value < dangerMin)
        ? "low"
        : "high";
    if ((dangerMin != null && value < dangerMin) || (dangerMax != null && value > dangerMax)) {
      addFinding(
        "danger",
        `${label} is too ${direction} at ${valueText} (recommended ${preferredBand}).`,
      );
      return;
    }
    if ((warnMin != null && value < warnMin) || (warnMax != null && value > warnMax)) {
      addFinding(
        "warn",
        `${label} is too ${direction} at ${valueText} (recommended ${preferredBand}).`,
      );
    }
  }

  function addBandFindingFromConfig(
    label: string,
    value: number,
    unit: string,
    band: {
      preferredMin?: number | null;
      preferredMax?: number | null;
      warnMin?: number | null;
      warnMax?: number | null;
      dangerMin?: number | null;
      dangerMax?: number | null;
    },
  ) {
    if (!band) return;
    addBandFinding(
      label,
      value,
      unit,
      band.preferredMin ?? null,
      band.preferredMax ?? null,
      band.warnMin ?? null,
      band.warnMax ?? null,
      band.dangerMin ?? null,
      band.dangerMax ?? null,
    );
  }

  addBandFindingFromConfig("TDS", metrics.tds, "mg/L", methodBands.tds);
  addBandFindingFromConfig("KH", metrics.kh, "mg/L as CaCO3", methodBands.kh);
  addBandFindingFromConfig("GH", metrics.gh, "mg/L as CaCO3", methodBands.gh);
  addBandFindingFromConfig("Calcium", normalized.calcium, "mg/L", methodBands.calcium);
  addBandFindingFromConfig("Magnesium", normalized.magnesium, "mg/L", methodBands.magnesium);

  const useBakingSodaSodiumLimits =
    Array.isArray(alkalinitySources) && alkalinitySources.includes("baking-soda");
  const sodiumBands = useBakingSodaSodiumLimits
    ? methodBands.sodium.bakingSoda
    : methodBands.sodium.default;
  addBandFinding(
    "Sodium",
    normalized.sodium,
    "mg/L",
    null,
    sodiumBands.preferredMax ?? null,
    null,
    sodiumBands.warnMax ?? null,
    null,
    sodiumBands.dangerMax ?? null,
  );

  if (includeAdvanced) {
    const chlorideHeavySource =
      calciumSource === "calcium-chloride" ||
      calciumSource === "calcium-chloride-anhydrous" ||
      magnesiumSource === "magnesium-chloride";
    const chlorideBands = chlorideHeavySource
      ? methodBands.chloride.chlorideHeavy
      : methodBands.chloride.default;
    addBandFinding(
      "Chloride",
      normalized.chloride,
      "mg/L",
      null,
      chlorideBands.preferredMax ?? null,
      null,
      chlorideBands.warnMax ?? null,
      null,
      chlorideBands.dangerMax ?? null,
    );

    const sulfateWarnMax =
      methodBands.sulfate && Number.isFinite(methodBands.sulfate.warnMax)
        ? methodBands.sulfate.warnMax
        : 150;
    if (normalized.sulfate > sulfateWarnMax) {
      addFinding(
        "warn",
        `Sulfate is too high at ${Math.round(normalized.sulfate * 10) / 10} mg/L (recommended <=${sulfateWarnMax} mg/L).`,
      );
    }
    const potassiumDangerMax =
      methodBands.potassium && Number.isFinite(methodBands.potassium.dangerMax)
        ? methodBands.potassium.dangerMax
        : 100;
    if (normalized.potassium > potassiumDangerMax) {
      addFinding(
        "danger",
        `Potassium is too high at ${Math.round(normalized.potassium * 10) / 10} mg/L (recommended <=${potassiumDangerMax} mg/L).`,
      );
    }
  }

  findings.sort((a, b) => {
    const sa = RANGE_SEVERITY_ORDER[a.severity] ?? 99;
    const sb = RANGE_SEVERITY_ORDER[b.severity] ?? 99;
    return sa - sb;
  });

  return { findings, metrics, ratio };
}

export function splitAlkalinityDelta(
  alkalinitySources: string[],
  deltaAlkAsCaCO3: number,
  sourceWater: IonMap | null | undefined,
  targetProfile: Partial<TargetProfile> | Partial<Record<IonName, number>> | null | undefined,
): Record<string, number> {
  const result: Record<string, number> = {};
  if (alkalinitySources.length === 0) return result;
  if (alkalinitySources.length === 1) {
    const firstSource = alkalinitySources[0];
    if (firstSource) result[firstSource] = deltaAlkAsCaCO3;
    return result;
  }
  // Both baking-soda and potassium-bicarbonate enabled: split by target sodium vs potassium if present
  const targetNa =
    targetProfile && Number.isFinite(Number(targetProfile.sodium))
      ? Number(targetProfile.sodium)
      : null;
  const targetK =
    targetProfile && Number.isFinite(Number(targetProfile.potassium))
      ? Number(targetProfile.potassium)
      : null;
  const sourceNa =
    sourceWater && Number.isFinite(Number(sourceWater.sodium)) ? Number(sourceWater.sodium) : 0;
  const sourceK =
    sourceWater && Number.isFinite(Number(sourceWater.potassium))
      ? Number(sourceWater.potassium)
      : 0;
  const deltaNa = targetNa != null ? Math.max(0, targetNa - sourceNa) : 0;
  const deltaK = targetK != null ? Math.max(0, targetK - sourceK) : 0;

  if (deltaNa > 0 && deltaK > 0) {
    const total = deltaNa + deltaK;
    result["baking-soda"] = (deltaAlkAsCaCO3 * deltaNa) / total;
    result["potassium-bicarbonate"] = (deltaAlkAsCaCO3 * deltaK) / total;
  } else if (deltaNa > 0) {
    result["baking-soda"] = deltaAlkAsCaCO3;
  } else {
    // deltaK > 0 or both absent: fall back to potassium bicarbonate per AC
    result["potassium-bicarbonate"] = deltaAlkAsCaCO3;
  }
  return result;
}

/**
 * Derive a multi-mineral stock concentrate formula from a recipe's per-ion
 * target profile. Returns "a" valid solution, not "the" canonical one — the
 * inverse problem is underdetermined (Mg can come from epsom or MgCl2, HCO3
 * from baking-soda or KHCO3, etc.), so the user reviews and tweaks the
 * derived list before saving.
 *
 * Greedy heuristic order:
 *   1. HCO3 split between baking-soda (Na carrier) and KHCO3 (K carrier)
 *      proportional to target Na and K (mirrors splitAlkalinityDelta).
 *   2. Mg → epsom-salt or magnesium-chloride based on target SO4/Cl ratio.
 *   3. Ca → the selected calcium-chloride form (dihydrate by default; anhydrous
 *      when that is the form the user has). Gypsum would match SO4-heavy targets
 *      but its ~2 g/L solubility cap (MINERAL_SOLUBILITY_G_PER_L_25C_APPROX,
 *      src/lib/constants.ts) is exceeded by even modest Ca
 *      targets at concentrate strengths.
 *   4. Residual K → potassium-chloride; residual Na → sodium-chloride.
 */
export function deriveStockFormulaFromTarget(
  target:
    | TargetProfile
    | Partial<Record<IonName, number | string | null | undefined>>
    | null
    | undefined,
  options?: { bottleMl?: number; doseGramsPerL?: number; calciumChlorideId?: string },
): {
  bottleMl: number;
  doseGramsPerL: number;
  minerals: Array<{ mineralId: string; grams: number }>;
  notes: string[];
} {
  options = options || {};
  let bottleMl = Number(options.bottleMl);
  let doseGramsPerL = Number(options.doseGramsPerL);
  if (!Number.isFinite(bottleMl) || bottleMl <= 0) bottleMl = 200;
  if (!Number.isFinite(doseGramsPerL) || doseGramsPerL <= 0) doseGramsPerL = 4;

  const notes: string[] = [];
  let minerals: Array<{ mineralId: string; grams: number }> = [];

  function num(field: string) {
    if (!target) return 0;
    const v = Number((target as Record<string, unknown>)[field]);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  const tCa = num("calcium");
  const tMg = num("magnesium");
  const tK = num("potassium");
  const tNa = num("sodium");
  const tSO4 = num("sulfate");
  const tCl = num("chloride");
  const tHCO3 = num("bicarbonate");

  if (tCa + tMg + tK + tNa + tSO4 + tCl + tHCO3 === 0) {
    notes.push("Distilled / RO target: no minerals to derive.");
    return { bottleMl: bottleMl, doseGramsPerL: doseGramsPerL, minerals: minerals, notes: notes };
  }

  // grams of salt to put in the bottle so that dosing at doseGramsPerL produces
  // mgPerL of the target ion in brew water:
  //   grams = (mgPerL × bottleMl) / (1000 × ion_fraction × doseGramsPerL)
  function gramsForIon(mineralId: string, ionName: string, mgPerL: number) {
    const entry = MINERAL_DB[mineralId];
    if (!entry || !entry.ions) return 0;
    const frac = (entry.ions as Record<string, number | undefined>)[ionName] || 0;
    if (frac <= 0 || mgPerL <= 0) return 0;
    return (mgPerL * bottleMl) / (1000 * frac * doseGramsPerL);
  }

  /**
   * mg/L of side-ion produced when the mineral is sized to deliver primaryMgPerL
   * of the primary ion. = primaryMgPerL × (sideFrac / primaryFrac).
   */
  function sideIonProduced(
    mineralId: string,
    primaryIon: string,
    primaryMgPerL: number,
    sideIon: string,
  ) {
    const entry = MINERAL_DB[mineralId];
    if (!entry || !entry.ions) return 0;
    const ionsRec = entry.ions as Record<string, number | undefined>;
    const primaryFrac = ionsRec[primaryIon] || 0;
    const sideFrac = ionsRec[sideIon] || 0;
    if (primaryFrac <= 0 || sideFrac <= 0 || primaryMgPerL <= 0) return 0;
    return primaryMgPerL * (sideFrac / primaryFrac);
  }

  let producedNa = 0;
  let producedK = 0;
  let producedSO4 = 0;
  let _producedCl = 0;

  // --- 1. Bicarbonate split ---
  if (tHCO3 > 0) {
    let hcoNa = 0;
    let hcoK = 0;
    if (tNa > 0 && tK > 0) {
      // Try sizing each buffer for its respective monovalent target ion. When
      // the recipe's Na/K/HCO3 numbers are internally consistent (the common
      // case — recipe authors typically derive HCO3 from the buffer salts they
      // chose), the resulting HCO3 falls within tolerance of the target and we
      // hit both Na and K exactly. Eliminates the K-overshoot the proportional
      // split produced on recipes like Lotus Simple Sweet. Falls back to the
      // proportional split when targets aren't aligned.
      const bakingDb = MINERAL_DB["baking-soda"];
      const khcoDb = MINERAL_DB["potassium-bicarbonate"];
      const bakingNaFrac = (bakingDb && bakingDb.ions && bakingDb.ions.sodium) || 0;
      const bakingHCO3Frac = (bakingDb && bakingDb.ions && bakingDb.ions.bicarbonate) || 0;
      const khcoKFrac = (khcoDb && khcoDb.ions && khcoDb.ions.potassium) || 0;
      const khcoHCO3Frac = (khcoDb && khcoDb.ions && khcoDb.ions.bicarbonate) || 0;
      const directNaHCO3 = bakingNaFrac > 0 ? tNa * (bakingHCO3Frac / bakingNaFrac) : 0;
      const directKHCO3 = khcoKFrac > 0 ? tK * (khcoHCO3Frac / khcoKFrac) : 0;
      const directTotalHCO3 = directNaHCO3 + directKHCO3;
      const tolerance = Math.max(1, tHCO3 * 0.1);
      if (Math.abs(directTotalHCO3 - tHCO3) <= tolerance) {
        hcoNa = directNaHCO3;
        hcoK = directKHCO3;
      } else {
        const sumNaK = tNa + tK;
        hcoNa = (tHCO3 * tNa) / sumNaK;
        hcoK = (tHCO3 * tK) / sumNaK;
      }
    } else if (tNa > 0) {
      hcoNa = tHCO3;
    } else {
      // K-driven, or both 0 — match splitAlkalinityDelta's KHCO3 default.
      hcoK = tHCO3;
    }
    if (hcoNa > 0) {
      const gBaking = gramsForIon("baking-soda", "bicarbonate", hcoNa);
      if (gBaking > 0) {
        minerals.push({ mineralId: "baking-soda", grams: gBaking });
        producedNa += sideIonProduced("baking-soda", "bicarbonate", hcoNa, "sodium");
      }
    }
    if (hcoK > 0) {
      const gKHCO3 = gramsForIon("potassium-bicarbonate", "bicarbonate", hcoK);
      if (gKHCO3 > 0) {
        minerals.push({ mineralId: "potassium-bicarbonate", grams: gKHCO3 });
        producedK += sideIonProduced("potassium-bicarbonate", "bicarbonate", hcoK, "potassium");
      }
    }
  }

  // --- 2. Magnesium ---
  // - tCl === 0 (whether or not SO4 specified): epsom keeps Cl out of the
  //   resulting brew water. Important when SO4 and Cl are both unspecified
  //   (e.g. SCA-style Ca/Mg/Alk-only profiles): the Ca source is already
  //   pinned to CaCl2 (gypsum is insoluble at concentrate strengths) which
  //   contributes its own Cl, so defaulting Mg to epsom keeps the side-ion
  //   spread balanced rather than compounding Cl.
  // - tSO4 === 0 with tCl > 0: MgCl2 (Mg side matches the recipe's Cl target).
  // - Both > 0: pick by SO4/Cl ratio.
  if (tMg > 0) {
    let mgPick;
    if (tCl === 0) {
      mgPick = "epsom-salt";
    } else if (tSO4 === 0) {
      mgPick = "magnesium-chloride";
    } else if (tSO4 / Math.max(tCl, 1) > 1) {
      mgPick = "epsom-salt";
    } else {
      mgPick = "magnesium-chloride";
    }
    const gMg = gramsForIon(mgPick, "magnesium", tMg);
    if (gMg > 0) {
      minerals.push({ mineralId: mgPick, grams: gMg });
      if (mgPick === "epsom-salt") {
        producedSO4 += sideIonProduced("epsom-salt", "magnesium", tMg, "sulfate");
      } else {
        _producedCl += sideIonProduced("magnesium-chloride", "magnesium", tMg, "chloride");
      }
    }
  }

  // --- 3. Calcium (CaCl2 default; gypsum is impractical at concentrate strength) ---
  if (tCa > 0) {
    // Both calcium-chloride forms add the same Ca:Cl ratio, so only the gram
    // weight differs. Use whichever form the user has (dihydrate by default).
    const caForm = getEffectiveCalciumSource();
    // Trust calciumChlorideId only if it names a known CaCl2 form; otherwise
    // fall back to the user's effective source so a bad id can't silently
    // skip calcium addition for a non-zero target.
    const requestedCaId = options.calciumChlorideId;
    const caId =
      requestedCaId === "calcium-chloride" || requestedCaId === "calcium-chloride-anhydrous"
        ? requestedCaId
        : caForm === "calcium-chloride-anhydrous"
          ? "calcium-chloride-anhydrous"
          : "calcium-chloride";
    if (tSO4 > 0 && tSO4 / Math.max(tCl, 1) > 1) {
      notes.push(
        "Used calcium-chloride for Ca even though target favors sulfate; gypsum's ~2 g/L solubility limit makes it impractical at concentrate strengths.",
      );
    }
    const gCa = gramsForIon(caId, "calcium", tCa);
    if (gCa > 0) {
      minerals.push({ mineralId: caId, grams: gCa });
      _producedCl += sideIonProduced(caId, "calcium", tCa, "chloride");
    }
  }

  // --- 4. Residual K → KCl, residual Na → NaCl ---
  const residK = Math.max(0, tK - producedK);
  const residNa = Math.max(0, tNa - producedNa);
  if (residK > 0) {
    const gKCl = gramsForIon("potassium-chloride", "potassium", residK);
    if (gKCl > 0) {
      minerals.push({ mineralId: "potassium-chloride", grams: gKCl });
      _producedCl += sideIonProduced("potassium-chloride", "potassium", residK, "chloride");
    }
  }
  if (residNa > 0) {
    const gNaCl = gramsForIon("sodium-chloride", "sodium", residNa);
    if (gNaCl > 0) {
      minerals.push({ mineralId: "sodium-chloride", grams: gNaCl });
      _producedCl += sideIonProduced("sodium-chloride", "sodium", residNa, "chloride");
    }
  }

  // Leftover SO4 the chosen sources can't supply (no salt in MINERAL_DB
  // produces SO4 except gypsum + epsom; if Mg is on Cl side, we'd need gypsum
  // to fill in, which isn't viable here).
  const residSO4 = tSO4 - producedSO4;
  if (residSO4 > 1) {
    notes.push(
      "Target sulfate of " +
        Math.round(tSO4) +
        " mg/L exceeds what the chosen Mg source supplies (~" +
        Math.round(producedSO4) +
        " mg/L). Gypsum could close the gap but isn't soluble at concentrate strengths.",
    );
  }

  // Round grams to 0.1 g and drop rows that round to 0.
  minerals = minerals
    .map(function (m) {
      return { mineralId: m.mineralId, grams: Math.round(m.grams * 10) / 10 };
    })
    .filter(function (m) {
      return m.grams > 0;
    });

  // Solubility check on bottle concentration (g/L) of each rounded entry.
  minerals.forEach(function (m) {
    const cap = MINERAL_SOLUBILITY_G_PER_L_25C_APPROX[m.mineralId];
    if (!cap) return;
    const concentrationGperL = m.grams / (bottleMl / 1000);
    if (concentrationGperL > cap) {
      const entry = MINERAL_DB[m.mineralId];
      const name = (entry && entry.name) || m.mineralId;
      notes.push(
        name +
          " in bottle (" +
          concentrationGperL.toFixed(1) +
          " g/L) exceeds approximate solubility (" +
          cap +
          " g/L); try a larger bottle or lower dose.",
      );
    }
  });

  return { bottleMl: bottleMl, doseGramsPerL: doseGramsPerL, minerals: minerals, notes: notes };
}

/**
 * Compute the full 7-ion profile from a Ca/Mg/Alk target. Uses the same
 * pickBestCaMgSources and splitAlkalinityDelta logic as the Calculator so ion
 * math stays consistent across pages. Accepts any TargetProfile subset — only
 * the ion fields and alkalinity are read.
 */
export function computeFullProfile(target: Partial<TargetProfile>): Record<IonName, number> {
  const hasExplicitIons =
    target &&
    ION_FIELDS.every(function (ion) {
      return Number.isFinite(Number(target[ion]));
    });
  if (hasExplicitIons) {
    const explicit: Record<IonName, number> = {
      calcium: 0,
      magnesium: 0,
      potassium: 0,
      sodium: 0,
      sulfate: 0,
      chloride: 0,
      bicarbonate: 0,
    };
    ION_FIELDS.forEach(function (ion) {
      explicit[ion] = Math.round(Number(target[ion]) || 0);
    });
    return explicit;
  }

  const sourceWater = getSourceWaterByPreset(loadSourcePresetName());
  const alkalinitySources = getEffectiveAlkalinitySources();

  const sourceAlk = (sourceWater.bicarbonate || 0) * HCO3_TO_CACO3;
  const deltaCa = Math.max(0, (target.calcium || 0) - (sourceWater.calcium || 0));
  const deltaMg = Math.max(0, (target.magnesium || 0) - (sourceWater.magnesium || 0));
  const deltaAlk = Math.max(0, (target.alkalinity || 0) - sourceAlk);

  // Use same Ca/Mg dose allocation as Calculator (may blend two salts per
  // slot to match the target's SO4/Cl).
  const allocation = allocateCaMgDoses(sourceWater, target, deltaCa, deltaMg);

  // Use same alkalinity split logic as Calculator
  const alkAllocation = splitAlkalinityDelta(alkalinitySources, deltaAlk, sourceWater, target);

  const result: Record<IonName, number> = {
    calcium: sourceWater.calcium || 0,
    magnesium: sourceWater.magnesium || 0,
    potassium: sourceWater.potassium || 0,
    sodium: sourceWater.sodium || 0,
    sulfate: sourceWater.sulfate || 0,
    chloride: sourceWater.chloride || 0,
    bicarbonate: sourceWater.bicarbonate || 0,
  };

  const caMgIons = calculateIonPPMs(allocation.gramsPerL);
  ION_FIELDS.forEach(function (ion) {
    result[ion] += caMgIons[ion] || 0;
  });

  // Apply each alkalinity source from the split allocation
  (["baking-soda", "potassium-bicarbonate"] as const).forEach(function (alkId) {
    const alkDelta = alkAllocation[alkId];
    const alkMineral = MINERAL_DB[alkId];
    if (!alkDelta || alkDelta <= 0 || !alkMineral) return;
    let mgL_buffer;
    if (alkId === "potassium-bicarbonate") {
      mgL_buffer = alkDelta * ALK_TO_POTASSIUM_BICARB;
    } else {
      mgL_buffer = alkDelta * ALK_TO_BAKING_SODA;
    }
    for (const [ionAlk, frac] of Object.entries(alkMineral.ions)) {
      const key = ionAlk as IonName;
      result[key] += mgL_buffer * (frac ?? 0);
    }
  });

  ION_FIELDS.forEach(function (ion) {
    result[ion] = Math.round(result[ion]);
  });
  return result;
}

/**
 * Build a stored target profile from ions. Kept consistent across pages so
 * round-trip reads/writes don't drift.
 */
export function buildStoredTargetProfile(
  label: string,
  ions: Record<string, number | string | undefined | null>,
  description?: string | null,
  options?: { brewMethod?: string; alkalinity?: number | null },
): TargetProfile {
  options = options || {};
  const brewMethod =
    options.brewMethod === "espresso"
      ? "espresso"
      : options.brewMethod === "filter"
        ? "filter"
        : loadBrewMethod();
  const normalized: Record<IonName, number> = {
    calcium: 0,
    magnesium: 0,
    potassium: 0,
    sodium: 0,
    sulfate: 0,
    chloride: 0,
    bicarbonate: 0,
  };
  ION_FIELDS.forEach(function (ion) {
    const raw = ions[ion];
    normalized[ion] = Math.round(
      parseFloat(typeof raw === "number" ? String(raw) : (raw ?? "")) || 0,
    );
  });
  const metrics = calculateMetrics(normalized);
  return {
    label: label,
    calcium: normalized.calcium,
    magnesium: normalized.magnesium,
    alkalinity:
      options.alkalinity != null ? Math.round(options.alkalinity) : Math.round(metrics.kh),
    potassium: normalized.potassium,
    sodium: normalized.sodium,
    sulfate: normalized.sulfate,
    chloride: normalized.chloride,
    bicarbonate: normalized.bicarbonate,
    description: description || "",
    brewMethod: brewMethod,
  };
}

/**
 * Mineral ids whose combined g/L in the brew water exceeds the approximate
 * solubility cap from MINERAL_SOLUBILITY_G_PER_L_25C_APPROX. Used by the
 * recipe builder to warn when any single mineral's total contribution (summed
 * across all Recipe Concentrates, Mineral Concentrates, and manual inputs)
 * would precipitate out. Per-Recipe-Concentrate solubility checks in Settings
 * are unchanged; this is the combined-in-brew-water check.
 */
export function getRecipeOverLimitMineralIds(
  mineralGramsPerLiter: Record<string, number> | null | undefined,
): string[] {
  const out: string[] = [];
  if (!mineralGramsPerLiter || typeof mineralGramsPerLiter !== "object") return out;
  for (const [mineralId, gPerLraw] of Object.entries(mineralGramsPerLiter)) {
    const cap = MINERAL_SOLUBILITY_G_PER_L_25C_APPROX[mineralId];
    if (!Number.isFinite(cap) || cap == null || cap <= 0) continue;
    const gPerL = Number(gPerLraw);
    if (!Number.isFinite(gPerL) || gPerL <= 0) continue;
    if (gPerL >= cap) out.push(mineralId);
  }
  return out;
}

// ============================================
// NNLS inverse solver — used by the calculator
// ============================================
// Given an over-determined system Ax = b (more ions than dosing variables, or
// dosing variables that can't satisfy every ion exactly), find the
// non-negative x that minimizes ||Ax - b||². Used to pick optimal doses of
// the user's enabled Recipe Concentrates and mineral salts to fit a target
// ion profile.
//
// Implementation: active-set NNLS via repeated unconstrained least squares
// with negative-variable pruning. Not strictly Lawson-Hanson, but converges
// to the NNLS solution for the small (≤10 variables, 7 equations)
// well-conditioned systems that the calculator generates. The math sequence:
//   1. Solve A·x = b on the active set (currently-positive variables) via
//      the normal equations AᵀA·x = Aᵀb with Gaussian elimination.
//   2. If any solved x is < 0, drop those variables from the active set and
//      re-solve.
//   3. Repeat until every solved x ≥ 0.
//
// For up to ~10 variables this terminates in a handful of iterations.

/**
 * Transpose an m×n matrix to n×m.
 */
function _matTranspose(A: number[][]): number[][] {
  if (!A || A.length === 0) return [];
  const m = A.length;
  const firstRow = A[0];
  const n = firstRow ? firstRow.length : 0;
  const out: number[][] = [];
  for (let j = 0; j < n; j++) {
    const row: number[] = [];
    for (let i = 0; i < m; i++) {
      const ai = A[i];
      row.push((ai && ai[j]) || 0);
    }
    out.push(row);
  }
  return out;
}

/**
 * Multiply matrix A (m×n) by matrix B (n×p), returning an m×p matrix.
 */
function _matMul(A: number[][], B: number[][]): number[][] {
  const m = A.length;
  const n = A[0]?.length || 0;
  const p = B[0]?.length || 0;
  const out: number[][] = [];
  for (let i = 0; i < m; i++) {
    const rowA = A[i];
    const row: number[] = new Array(p).fill(0);
    if (!rowA) {
      out.push(row);
      continue;
    }
    for (let k = 0; k < n; k++) {
      const aik = rowA[k] || 0;
      if (aik === 0) continue;
      const rowB = B[k];
      if (!rowB) continue;
      for (let j = 0; j < p; j++) row[j] = (row[j] || 0) + aik * (rowB[j] || 0);
    }
    out.push(row);
  }
  return out;
}

/**
 * Multiply matrix A (m×n) by vector x (n), returning a vector of length m.
 */
function _matVec(A: number[][], x: number[]): number[] {
  const m = A.length;
  const n = A[0]?.length || 0;
  const out: number[] = new Array(m).fill(0);
  for (let i = 0; i < m; i++) {
    const row = A[i];
    if (!row) continue;
    let s = 0;
    for (let j = 0; j < n; j++) s += (row[j] || 0) * (x[j] || 0);
    out[i] = s;
  }
  return out;
}

/**
 * Solve an n×n linear system Mx = c via Gaussian elimination with partial
 * pivoting. Returns null if the system is singular (no unique solution).
 * Mutates copies of M and c; the inputs are not modified.
 */
function _solveLinear(M: number[][], c: number[]): number[] | null {
  const n = M.length;
  if (n === 0) return [];
  // Build augmented matrix [M | c] working copies. Defensive about undefined
  // entries even though callers pass dense matrices — TS strict-index-access
  // can't prove that from inside.
  const aug: number[][] = M.map((row, i) => (row || []).concat([c[i] || 0]));
  for (let col = 0; col < n; col++) {
    // Pivot on the row with the largest absolute value in this column.
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      const augRow = aug[row];
      const augPivot = aug[pivot];
      const a = (augRow && augRow[col]) || 0;
      const p = (augPivot && augPivot[col]) || 0;
      if (Math.abs(a) > Math.abs(p)) pivot = row;
    }
    const augPivotRow = aug[pivot];
    const pivotVal = (augPivotRow && augPivotRow[col]) || 0;
    if (Math.abs(pivotVal) < 1e-12) return null; // Singular
    if (pivot !== col) {
      const tmp = aug[col] || [];
      const pRow = aug[pivot] || [];
      aug[col] = pRow;
      aug[pivot] = tmp;
    }
    // Eliminate below the pivot.
    const colRow = aug[col];
    if (!colRow) continue;
    const colDiag = colRow[col] || 0;
    if (colDiag === 0) continue;
    for (let row = col + 1; row < n; row++) {
      const rowVec = aug[row];
      if (!rowVec) continue;
      const factor = (rowVec[col] || 0) / colDiag;
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) {
        rowVec[k] = (rowVec[k] || 0) - factor * (colRow[k] || 0);
      }
    }
  }
  // Back-substitute.
  const x: number[] = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    const augRow = aug[row];
    if (!augRow) continue;
    let s = augRow[n] || 0;
    for (let col = row + 1; col < n; col++) s -= (augRow[col] || 0) * (x[col] || 0);
    const diag = augRow[row] || 0;
    x[row] = diag === 0 ? 0 : s / diag;
  }
  return x;
}

/**
 * Non-negative least squares. Find x ≥ 0 minimizing ||A·x - b||².
 *
 * Active-set algorithm: start with all variables active, solve the
 * unconstrained problem on the active set, drop any variable whose solved
 * value is negative (clamp to 0), and re-solve. Converges in O(n) iterations
 * for the small problems the calculator generates.
 *
 * @param A — m×n matrix
 * @param b — m-vector
 * @returns x — n-vector, all entries ≥ 0
 */
export function solveNNLS(A: number[][], b: number[]): number[] {
  if (!A || A.length === 0) return [];
  const n = A[0]?.length || 0;
  if (n === 0) return [];

  const active = new Set<number>();
  for (let j = 0; j < n; j++) active.add(j);

  const x: number[] = new Array(n).fill(0);

  // Cap iterations defensively — convergence is fast for well-posed
  // problems but a malformed input shouldn't hang the UI.
  for (let iter = 0; iter < 100; iter++) {
    const activeIdx = [...active].sort((a, b) => a - b);
    if (activeIdx.length === 0) break;

    // Build A_active: m × |active| by picking columns.
    const A_active: number[][] = A.map((row) => activeIdx.map((j) => (row && row[j]) || 0));
    const At = _matTranspose(A_active);
    const AtA = _matMul(At, A_active);
    const Atb = _matVec(At, b);
    const solved = _solveLinear(AtA, Atb);
    if (solved === null) {
      // Singular normal equations — drop the last variable and retry.
      const lastIdx = activeIdx[activeIdx.length - 1];
      if (lastIdx === undefined) break;
      active.delete(lastIdx);
      x[lastIdx] = 0;
      continue;
    }

    // Check for negative components in the solved active-set values.
    let droppedAny = false;
    for (let i = 0; i < activeIdx.length; i++) {
      if ((solved[i] || 0) < 0) {
        const idx = activeIdx[i];
        if (idx === undefined) continue;
        active.delete(idx);
        x[idx] = 0;
        droppedAny = true;
      }
    }

    if (!droppedAny) {
      for (let i = 0; i < activeIdx.length; i++) {
        const idx = activeIdx[i];
        if (idx === undefined) continue;
        x[idx] = Math.max(0, solved[i] || 0);
      }
      return x;
    }
  }
  return x;
}

/**
 * Inverse-solve dosing for the calculator's stock-active branch: given the
 * source water, target ion profile, list of enabled Recipe Concentrate
 * specs, and list of enabled mineral salt ids, find the per-source dose that
 * minimizes squared error against the target.
 *
 * For each Recipe Concentrate, the column of A is its per-gram ion
 * contribution at unit dose (i.e. 1 g/L of the concentrate). For each
 * mineral salt, the column is its per-gram ion contribution. b is
 * target − sourceWater per ion. Solver units are grams per liter of brew
 * water; multiply by volumeL outside to get displayed amounts.
 */
export function solveCalculatorDosing(
  sourceWater: IonMap | null | undefined,
  target:
    | Partial<Record<IonName, number | null | undefined>>
    | Record<string, unknown>
    | null
    | undefined,
  concentrateEntries: Array<{ id: string; spec: StockConcentrateSpec }>,
  mineralIds: string[],
): {
  concentrateGramsPerL: Record<string, number>;
  mineralGramsPerL: Record<string, number>;
  residualIons: Record<IonName, number>;
  maxResidualIon: { ion: IonName; residual: number } | null;
} {
  const entries = Array.isArray(concentrateEntries) ? concentrateEntries : [];
  const mins = Array.isArray(mineralIds) ? mineralIds : [];

  // b = target - source per ion, in row order matching ION_FIELDS.
  const b: number[] = [];
  ION_FIELDS.forEach((ion) => {
    const tgt = target && target[ion] != null ? Number(target[ion]) : 0;
    const src = sourceWater && sourceWater[ion] != null ? Number(sourceWater[ion]) : 0;
    b.push(Number.isFinite(tgt) && Number.isFinite(src) ? tgt - src : 0);
  });

  // Columns of A: each concentrate's ion contribution per gram-per-liter,
  // then each mineral's ion contribution per gram-per-liter.
  const A: number[][] = ION_FIELDS.map(() => []);

  const concentrateOrder: string[] = [];
  for (const entry of entries) {
    if (!entry || !entry.spec) continue;
    // computeStockMineralGramsPerL returns per-liter grams of each mineral
    // when dispensing at the prescribed dose. To get the column "ions per
    // gram-per-liter of CONCENTRATE", normalize by doseGramsPerL.
    const dosePerL = Number(entry.spec.doseGramsPerL) || 0;
    if (dosePerL <= 0) continue;
    const perLAtPrescribed = computeStockMineralGramsPerL(entry.spec);
    const perGramOfConcentrate: Record<string, number> = {};
    for (const [mid, g] of Object.entries(perLAtPrescribed)) {
      perGramOfConcentrate[mid] = g / dosePerL;
    }
    const ions = calculateIonPPMs(perGramOfConcentrate);
    ION_FIELDS.forEach((ion, i) => {
      const col = A[i];
      if (col) col.push(ions[ion] || 0);
    });
    concentrateOrder.push(entry.id);
  }

  const mineralOrder: string[] = [];
  for (const mid of mins) {
    if (!MINERAL_DB[mid]) continue;
    // calculateIonPPMs takes g/L; pass 1 to get the per-(gram-per-liter)
    // ion contribution.
    const ions = calculateIonPPMs({ [mid]: 1 });
    ION_FIELDS.forEach((ion, i) => {
      const col = A[i];
      if (col) col.push(ions[ion] || 0);
    });
    mineralOrder.push(mid);
  }

  // Skip the solve when there are no variables; downstream just sees zeros.
  let x: number[] = [];
  if (concentrateOrder.length + mineralOrder.length > 0) {
    x = solveNNLS(A, b);
  }

  // Snap pass: clean up two artifacts of NNLS on derived-from-target
  // concentrates.
  //
  // 1. Recipe Concentrates derived via deriveStockFormulaFromTarget have salt
  //    grams rounded to 0.1g, which shifts the squared-error optimum away
  //    from the prescribed dose by a few percent even when the concentrate
  //    is dosed at the recipe it was made for. When ONE concentrate is
  //    enabled this looks like "dose returned is 3.82 instead of 4"; when
  //    MULTIPLE concentrates are enabled the solver finds a marginally-better
  //    fit by using tiny doses of secondary concentrates, which pulls the
  //    dominant concentrate further off prescribed (e.g. to 3.70). Both
  //    cases are mathematically optimal but UX-wrong — the concentrate was
  //    designed for the recipe.
  //
  // 2. After snapping the dominant concentrate(s) to prescribed, very small
  //    "noise" doses on other concentrates (well below their prescribed
  //    amounts) should round to zero rather than render as "<0.01 g" hints
  //    that mislead the user into thinking the side concentrates are part
  //    of the recipe.
  //
  // The two passes are ordered: first zero out the tiny noise doses, then
  // snap the remaining doses to prescribed when close. This way the
  // dominant concentrate's snap doesn't have to fight the noise's
  // contribution to the residual.
  const SNAP_PRESCRIBED_REL = 0.1; // ≤10% from prescribed → snap to prescribed
  const SNAP_ZERO_REL = 0.1; // <10% of prescribed → snap to 0 (noise)

  // Whether any concentrate's solved dose lands within snap range of its
  // prescribed dose — i.e. there's a "dominant" concentrate the recipe was
  // (near enough) designed for. Computed from the raw solve, before snapping.
  const hasDominantConcentrate = concentrateOrder.some((id, k) => {
    const entry = entries.find((e) => e && e.id === id);
    if (!entry || !entry.spec) return false;
    const prescribed = Number(entry.spec.doseGramsPerL) || 0;
    if (prescribed <= 0) return false;
    const solved = x[k] || 0;
    return solved > 0 && Math.abs(solved - prescribed) / prescribed <= SNAP_PRESCRIBED_REL;
  });

  // Pass 1: zero-snap — only when a dominant concentrate is snapping to
  // prescribed. Without a dominant (a no-dominant multi-concentrate best fit,
  // i.e. the user blending several concentrates that match no single recipe),
  // every small dose is a genuine contributor and must NOT be silently
  // dropped — that is exactly the "how much of each gets closest" use case.
  if (hasDominantConcentrate) {
    concentrateOrder.forEach((id, k) => {
      const entry = entries.find((e) => e && e.id === id);
      if (!entry || !entry.spec) return;
      const prescribed = Number(entry.spec.doseGramsPerL) || 0;
      if (prescribed <= 0) return;
      const solved = x[k] || 0;
      if (solved > 0 && solved / prescribed < SNAP_ZERO_REL) {
        x[k] = 0;
      }
    });
  }

  // Pass 2: snap-to-prescribed.
  concentrateOrder.forEach((id, k) => {
    const entry = entries.find((e) => e && e.id === id);
    if (!entry || !entry.spec) return;
    const prescribed = Number(entry.spec.doseGramsPerL) || 0;
    if (prescribed <= 0) return;
    const solved = x[k] || 0;
    if (solved <= 0) return;
    if (Math.abs(solved - prescribed) / prescribed <= SNAP_PRESCRIBED_REL) {
      x[k] = prescribed;
    }
  });

  const concentrateGramsPerL: Record<string, number> = {};
  const mineralGramsPerL: Record<string, number> = {};
  concentrateOrder.forEach((id, k) => {
    concentrateGramsPerL[id] = Math.max(0, x[k] || 0);
  });
  mineralOrder.forEach((id, k) => {
    mineralGramsPerL[id] = Math.max(0, x[concentrateOrder.length + k] || 0);
  });

  // Residual diagnostic: what ions are still under-/over-target after the
  // solver picks the best non-negative combination.
  const Ax = _matVec(A, x);
  const residualIons: Record<IonName, number> = {
    calcium: 0,
    magnesium: 0,
    potassium: 0,
    sodium: 0,
    sulfate: 0,
    chloride: 0,
    bicarbonate: 0,
  };
  let maxResidualIon: { ion: IonName; residual: number } | null = null;
  ION_FIELDS.forEach((ion, i) => {
    const bi = b[i] || 0;
    const axi = Ax[i] || 0;
    const resid = bi - axi; // > 0 means under-target; < 0 means over-target.
    residualIons[ion] = resid;
    if (maxResidualIon === null || Math.abs(resid) > Math.abs(maxResidualIon.residual)) {
      maxResidualIon = { ion, residual: resid };
    }
  });

  return {
    concentrateGramsPerL,
    mineralGramsPerL,
    residualIons,
    maxResidualIon,
  };
}
