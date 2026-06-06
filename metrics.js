// @ts-check
// ============================================
// Metrics — water chemistry calculations
// ============================================
// Shared types and cross-file globals live in globals.d.ts
// (IonName, IonMap, MineralEntry, DerivedMetrics, MineralGrams, etc.).

/**
 * Convert grams-per-liter of mineral salts into ion concentrations (mg/L).
 * @param {MineralGrams} mineralGrams
 * @returns {Record<IonName, number>}
 */
function calculateIonPPMs(mineralGrams) {
  /** @type {Record<IonName, number>} */
  const ions = {
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
      const key = /** @type {IonName} */ (ion);
      const frac = fraction ?? 0;
      ions[key] += grams * frac * 1000; // g/L * fraction * 1000 = mg/L
    }
  }

  return ions;
}

/**
 * Compute GH / KH / TDS from an ion map (CaCO3-equivalent for GH and KH).
 * @param {IonMap} ions
 * @returns {DerivedMetrics}
 */
function calculateMetrics(ions) {
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
 * comes from the recipe's alkalinity, which is already CaCO3 and therefore
 * equals carbonate hardness (reading alkalinity rather than the bicarbonate
 * path in calculateMetrics means rows that carry alkalinity but no bicarbonate,
 * e.g. the SCA preset shim, still report a correct KH). TDS is the sum of all
 * ion concentrations, matching calculateMetrics. Used by the slim cards (GH/KH)
 * and the library detail modal (GH/KH/TDS).
 * @param {{ calcium?: number | null, magnesium?: number | null, alkalinity?: number | null, potassium?: number | null, sodium?: number | null, sulfate?: number | null, chloride?: number | null, bicarbonate?: number | null }} [recipe]
 * @returns {{ gh: number, kh: number, tds: number }}
 */
function recipeMetricsSummary(recipe) {
  recipe = recipe || {};
  var gh =
    (Number(recipe.calcium) || 0) * CA_TO_CACO3 + (Number(recipe.magnesium) || 0) * MG_TO_CACO3;
  var kh = Number(recipe.alkalinity) || 0;
  var tds =
    (Number(recipe.calcium) || 0) +
    (Number(recipe.magnesium) || 0) +
    (Number(recipe.potassium) || 0) +
    (Number(recipe.sodium) || 0) +
    (Number(recipe.sulfate) || 0) +
    (Number(recipe.chloride) || 0) +
    (Number(recipe.bicarbonate) || 0);
  return { gh: Math.round(gh), kh: Math.round(kh), tds: Math.round(tds) };
}

if (typeof window !== "undefined") {
  // Bridge to window so the bundled ES module src/components/recipe-card.ts
  // (slim cards) can reach it; the classic UI scripts (recipe-browser.js,
  // library-picker.js) read window.recipeMetricsSummary the same way.
  window.recipeMetricsSummary = recipeMetricsSummary;
}

/**
 * @param {unknown} ions — defensive; accepts partial/malformed inputs from storage.
 * @returns {number | null}
 */
function calculateSo4ClRatio(ions) {
  if (!ions || typeof ions !== "object") return null;
  const ionRecord = /** @type {Record<string, unknown>} */ (ions);
  const sulfate = Number(ionRecord.sulfate);
  const chloride = Number(ionRecord.chloride);
  if (!Number.isFinite(sulfate) || !Number.isFinite(chloride) || chloride <= 0) return null;
  return sulfate / chloride;
}

/**
 * @param {number | string | null | undefined} alkAsCaCO3
 * @param {number | string | null | undefined} existingBicarbonate
 * @returns {number}
 */
function toStableBicarbonateFromAlkalinity(alkAsCaCO3, existingBicarbonate) {
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
 * @param {IonMap} sourceWater
 * @param {TargetProfile | null | undefined} targetProfile
 * @param {number} deltaCa
 * @param {number} deltaMg
 * @returns {{ caSource: string | null, mgSource: string | null }}
 */
function pickBestCaMgSources(sourceWater, targetProfile, deltaCa, deltaMg) {
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

  /** @type {{ caSource: string | null, mgSource: string | null, error: number, tieBreak: number }} */
  let best = { caSource: null, mgSource: null, error: Infinity, tieBreak: Infinity };

  /** @type {(string | null)[]} */
  const caOpts = caCandidates.length ? caCandidates : [null];
  /** @type {(string | null)[]} */
  const mgOpts = mgCandidates.length ? mgCandidates : [null];

  for (const caSrc of caOpts) {
    for (const mgSrc of mgOpts) {
      /** @type {MineralGrams} */
      const mineralGrams = {};
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
      /** @type {Record<IonName, number>} */
      const result = {
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

/**
 * @param {IonMap | null | undefined} ions
 * @param {{
 *   includeAdvanced?: boolean,
 *   alkalinitySources?: string[],
 *   calciumSource?: string | null,
 *   magnesiumSource?: string | null,
 *   brewMethod?: string | null,
 * }} [options]
 */
function evaluateWaterProfileRanges(ions, options = {}) {
  /** @type {Record<IonName, number>} */
  const normalized = {
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
  /** @typedef {"danger" | "warn" | "info"} Severity */
  /** @type {{ severity: Severity, message: string }[]} */
  const findings = [];

  /** @param {Severity} severity @param {string} message */
  function addFinding(severity, message) {
    findings.push({ severity, message });
  }

  /**
   * @param {number | null} min
   * @param {number | null} max
   * @param {string} [unit]
   */
  function formatBand(min, max, unit) {
    if (min != null && max != null) return `${min}-${max}${unit ? " " + unit : ""}`;
    if (min != null) return `>=${min}${unit ? " " + unit : ""}`;
    if (max != null) return `<=${max}${unit ? " " + unit : ""}`;
    return "n/a";
  }

  /**
   * @param {string} label
   * @param {number} value
   * @param {string} unit
   * @param {number | null} preferredMin
   * @param {number | null} preferredMax
   * @param {number | null} warnMin
   * @param {number | null} warnMax
   * @param {number | null} dangerMin
   * @param {number | null} dangerMax
   */
  function addBandFinding(
    label,
    value,
    unit,
    preferredMin,
    preferredMax,
    warnMin,
    warnMax,
    dangerMin,
    dangerMax,
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

  /**
   * @param {string} label
   * @param {number} value
   * @param {string} unit
   * @param {{
   *   preferredMin?: number | null,
   *   preferredMax?: number | null,
   *   warnMin?: number | null,
   *   warnMax?: number | null,
   *   dangerMin?: number | null,
   *   dangerMax?: number | null,
   * }} band
   */
  function addBandFindingFromConfig(label, value, unit, band) {
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

/**
 * @param {string[]} alkalinitySources
 * @param {number} deltaAlkAsCaCO3
 * @param {IonMap | null | undefined} sourceWater
 * @param {TargetProfile | null | undefined} targetProfile
 * @returns {Record<string, number>}
 */
function splitAlkalinityDelta(alkalinitySources, deltaAlkAsCaCO3, sourceWater, targetProfile) {
  /** @type {Record<string, number>} */
  var result = {};
  if (alkalinitySources.length === 0) return result;
  if (alkalinitySources.length === 1) {
    const firstSource = alkalinitySources[0];
    if (firstSource) result[firstSource] = deltaAlkAsCaCO3;
    return result;
  }
  // Both baking-soda and potassium-bicarbonate enabled: split by target sodium vs potassium if present
  var targetNa =
    targetProfile && Number.isFinite(Number(targetProfile.sodium))
      ? Number(targetProfile.sodium)
      : null;
  var targetK =
    targetProfile && Number.isFinite(Number(targetProfile.potassium))
      ? Number(targetProfile.potassium)
      : null;
  var sourceNa =
    sourceWater && Number.isFinite(Number(sourceWater.sodium)) ? Number(sourceWater.sodium) : 0;
  var sourceK =
    sourceWater && Number.isFinite(Number(sourceWater.potassium))
      ? Number(sourceWater.potassium)
      : 0;
  var deltaNa = targetNa != null ? Math.max(0, targetNa - sourceNa) : 0;
  var deltaK = targetK != null ? Math.max(0, targetK - sourceK) : 0;

  if (deltaNa > 0 && deltaK > 0) {
    var total = deltaNa + deltaK;
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
 *      but its ~2 g/L solubility cap (constants.js
 *      MINERAL_SOLUBILITY_G_PER_L_25C_APPROX) is exceeded by even modest Ca
 *      targets at concentrate strengths.
 *   4. Residual K → potassium-chloride; residual Na → sodium-chloride.
 *
 * @param {Partial<Record<IonName, number | string | null | undefined>> | null | undefined} target
 * @param {{ bottleMl?: number, doseGramsPerL?: number, calciumChlorideId?: "calcium-chloride" | "calcium-chloride-anhydrous" }} [options]
 * @returns {{ bottleMl: number, doseGramsPerL: number, minerals: Array<{ mineralId: string, grams: number }>, notes: string[] }}
 */
function deriveStockFormulaFromTarget(target, options) {
  options = options || {};
  var bottleMl = Number(options.bottleMl);
  var doseGramsPerL = Number(options.doseGramsPerL);
  if (!Number.isFinite(bottleMl) || bottleMl <= 0) bottleMl = 200;
  if (!Number.isFinite(doseGramsPerL) || doseGramsPerL <= 0) doseGramsPerL = 4;

  /** @type {string[]} */
  var notes = [];
  /** @type {Array<{ mineralId: string, grams: number }>} */
  var minerals = [];

  /** @param {string} field */
  function num(field) {
    if (!target) return 0;
    var v = Number(/** @type {Record<string, unknown>} */ (target)[field]);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  var tCa = num("calcium");
  var tMg = num("magnesium");
  var tK = num("potassium");
  var tNa = num("sodium");
  var tSO4 = num("sulfate");
  var tCl = num("chloride");
  var tHCO3 = num("bicarbonate");

  if (tCa + tMg + tK + tNa + tSO4 + tCl + tHCO3 === 0) {
    notes.push("Distilled / RO target: no minerals to derive.");
    return { bottleMl: bottleMl, doseGramsPerL: doseGramsPerL, minerals: minerals, notes: notes };
  }

  // grams of salt to put in the bottle so that dosing at doseGramsPerL produces
  // mgPerL of the target ion in brew water:
  //   grams = (mgPerL × bottleMl) / (1000 × ion_fraction × doseGramsPerL)
  /**
   * @param {string} mineralId
   * @param {string} ionName
   * @param {number} mgPerL
   */
  function gramsForIon(mineralId, ionName, mgPerL) {
    var entry = MINERAL_DB[mineralId];
    if (!entry || !entry.ions) return 0;
    var frac = /** @type {Record<string, number | undefined>} */ (entry.ions)[ionName] || 0;
    if (frac <= 0 || mgPerL <= 0) return 0;
    return (mgPerL * bottleMl) / (1000 * frac * doseGramsPerL);
  }

  /**
   * mg/L of side-ion produced when the mineral is sized to deliver primaryMgPerL
   * of the primary ion. = primaryMgPerL × (sideFrac / primaryFrac).
   * @param {string} mineralId
   * @param {string} primaryIon
   * @param {number} primaryMgPerL
   * @param {string} sideIon
   */
  function sideIonProduced(mineralId, primaryIon, primaryMgPerL, sideIon) {
    var entry = MINERAL_DB[mineralId];
    if (!entry || !entry.ions) return 0;
    var ionsRec = /** @type {Record<string, number | undefined>} */ (entry.ions);
    var primaryFrac = ionsRec[primaryIon] || 0;
    var sideFrac = ionsRec[sideIon] || 0;
    if (primaryFrac <= 0 || sideFrac <= 0 || primaryMgPerL <= 0) return 0;
    return primaryMgPerL * (sideFrac / primaryFrac);
  }

  var producedNa = 0;
  var producedK = 0;
  var producedSO4 = 0;
  var producedCl = 0;

  // --- 1. Bicarbonate split ---
  if (tHCO3 > 0) {
    var hcoNa = 0;
    var hcoK = 0;
    if (tNa > 0 && tK > 0) {
      // Try sizing each buffer for its respective monovalent target ion. When
      // the recipe's Na/K/HCO3 numbers are internally consistent (the common
      // case — recipe authors typically derive HCO3 from the buffer salts they
      // chose), the resulting HCO3 falls within tolerance of the target and we
      // hit both Na and K exactly. Eliminates the K-overshoot the proportional
      // split produced on recipes like Lotus Simple Sweet. Falls back to the
      // proportional split when targets aren't aligned.
      var bakingDb = MINERAL_DB["baking-soda"];
      var khcoDb = MINERAL_DB["potassium-bicarbonate"];
      var bakingNaFrac = (bakingDb && bakingDb.ions && bakingDb.ions.sodium) || 0;
      var bakingHCO3Frac = (bakingDb && bakingDb.ions && bakingDb.ions.bicarbonate) || 0;
      var khcoKFrac = (khcoDb && khcoDb.ions && khcoDb.ions.potassium) || 0;
      var khcoHCO3Frac = (khcoDb && khcoDb.ions && khcoDb.ions.bicarbonate) || 0;
      var directNaHCO3 = bakingNaFrac > 0 ? tNa * (bakingHCO3Frac / bakingNaFrac) : 0;
      var directKHCO3 = khcoKFrac > 0 ? tK * (khcoHCO3Frac / khcoKFrac) : 0;
      var directTotalHCO3 = directNaHCO3 + directKHCO3;
      var tolerance = Math.max(1, tHCO3 * 0.1);
      if (Math.abs(directTotalHCO3 - tHCO3) <= tolerance) {
        hcoNa = directNaHCO3;
        hcoK = directKHCO3;
      } else {
        var sumNaK = tNa + tK;
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
      var gBaking = gramsForIon("baking-soda", "bicarbonate", hcoNa);
      if (gBaking > 0) {
        minerals.push({ mineralId: "baking-soda", grams: gBaking });
        producedNa += sideIonProduced("baking-soda", "bicarbonate", hcoNa, "sodium");
      }
    }
    if (hcoK > 0) {
      var gKHCO3 = gramsForIon("potassium-bicarbonate", "bicarbonate", hcoK);
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
    var mgPick;
    if (tCl === 0) {
      mgPick = "epsom-salt";
    } else if (tSO4 === 0) {
      mgPick = "magnesium-chloride";
    } else if (tSO4 / Math.max(tCl, 1) > 1) {
      mgPick = "epsom-salt";
    } else {
      mgPick = "magnesium-chloride";
    }
    var gMg = gramsForIon(mgPick, "magnesium", tMg);
    if (gMg > 0) {
      minerals.push({ mineralId: mgPick, grams: gMg });
      if (mgPick === "epsom-salt") {
        producedSO4 += sideIonProduced("epsom-salt", "magnesium", tMg, "sulfate");
      } else {
        producedCl += sideIonProduced("magnesium-chloride", "magnesium", tMg, "chloride");
      }
    }
  }

  // --- 3. Calcium (CaCl2 default; gypsum is impractical at concentrate strength) ---
  if (tCa > 0) {
    // Both calcium-chloride forms add the same Ca:Cl ratio, so only the gram
    // weight differs. Use whichever form the user has (dihydrate by default).
    var caForm =
      typeof getEffectiveCalciumSource === "function" ? getEffectiveCalciumSource() : null;
    // Trust calciumChlorideId only if it names a known CaCl2 form; otherwise
    // fall back to the user's effective source so a bad id can't silently
    // skip calcium addition for a non-zero target.
    var requestedCaId = options.calciumChlorideId;
    var caId =
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
    var gCa = gramsForIon(caId, "calcium", tCa);
    if (gCa > 0) {
      minerals.push({ mineralId: caId, grams: gCa });
      producedCl += sideIonProduced(caId, "calcium", tCa, "chloride");
    }
  }

  // --- 4. Residual K → KCl, residual Na → NaCl ---
  var residK = Math.max(0, tK - producedK);
  var residNa = Math.max(0, tNa - producedNa);
  if (residK > 0) {
    var gKCl = gramsForIon("potassium-chloride", "potassium", residK);
    if (gKCl > 0) {
      minerals.push({ mineralId: "potassium-chloride", grams: gKCl });
      producedCl += sideIonProduced("potassium-chloride", "potassium", residK, "chloride");
    }
  }
  if (residNa > 0) {
    var gNaCl = gramsForIon("sodium-chloride", "sodium", residNa);
    if (gNaCl > 0) {
      minerals.push({ mineralId: "sodium-chloride", grams: gNaCl });
      producedCl += sideIonProduced("sodium-chloride", "sodium", residNa, "chloride");
    }
  }

  // Leftover SO4 the chosen sources can't supply (no salt in MINERAL_DB
  // produces SO4 except gypsum + epsom; if Mg is on Cl side, we'd need gypsum
  // to fill in, which isn't viable here).
  var residSO4 = tSO4 - producedSO4;
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
  if (typeof MINERAL_SOLUBILITY_G_PER_L_25C_APPROX !== "undefined") {
    var solubility = /** @type {Record<string, number | undefined>} */ (
      MINERAL_SOLUBILITY_G_PER_L_25C_APPROX
    );
    minerals.forEach(function (m) {
      var cap = solubility[m.mineralId];
      if (!cap) return;
      var concentrationGperL = m.grams / (bottleMl / 1000);
      if (concentrationGperL > cap) {
        var entry = MINERAL_DB[m.mineralId];
        var name = (entry && entry.name) || m.mineralId;
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
  }

  return { bottleMl: bottleMl, doseGramsPerL: doseGramsPerL, minerals: minerals, notes: notes };
}

/**
 * Compute the full 7-ion profile from a Ca/Mg/Alk target. Uses the same
 * pickBestCaMgSources and splitAlkalinityDelta logic as the Calculator so ion
 * math stays consistent across pages.
 * @param {TargetProfile} target
 * @returns {Record<IonName, number>}
 */
function computeFullProfile(target) {
  var hasExplicitIons =
    target &&
    ION_FIELDS.every(function (ion) {
      return Number.isFinite(Number(target[ion]));
    });
  if (hasExplicitIons) {
    /** @type {Record<IonName, number>} */
    var explicit = {
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

  var sourceWater = getSourceWaterByPreset(loadSourcePresetName());
  var alkalinitySources = getEffectiveAlkalinitySources();

  var sourceAlk = (sourceWater.bicarbonate || 0) * HCO3_TO_CACO3;
  var deltaCa = Math.max(0, (target.calcium || 0) - (sourceWater.calcium || 0));
  var deltaMg = Math.max(0, (target.magnesium || 0) - (sourceWater.magnesium || 0));
  var deltaAlk = Math.max(0, (target.alkalinity || 0) - sourceAlk);

  // Use same Ca/Mg source optimization as Calculator
  var picked = pickBestCaMgSources(sourceWater, target, deltaCa, deltaMg);
  var caSource = picked.caSource;
  var mgSource = picked.mgSource;

  const caEntry = caSource ? MINERAL_DB[caSource] : null;
  const mgEntry = mgSource ? MINERAL_DB[mgSource] : null;
  var caFraction = caEntry ? caEntry.ions.calcium || 0 : 0;
  var mgFraction = mgEntry ? mgEntry.ions.magnesium || 0 : 0;
  var mgL_caSalt = caFraction > 0 ? deltaCa / caFraction : 0;
  var mgL_mgSalt = mgFraction > 0 ? deltaMg / mgFraction : 0;

  // Use same alkalinity split logic as Calculator
  var alkAllocation = splitAlkalinityDelta(alkalinitySources, deltaAlk, sourceWater, target);

  var result = {
    calcium: sourceWater.calcium || 0,
    magnesium: sourceWater.magnesium || 0,
    potassium: sourceWater.potassium || 0,
    sodium: sourceWater.sodium || 0,
    sulfate: sourceWater.sulfate || 0,
    chloride: sourceWater.chloride || 0,
    bicarbonate: sourceWater.bicarbonate || 0,
  };

  const caMineral = caSource ? MINERAL_DB[caSource] : null;
  if (caMineral && mgL_caSalt > 0) {
    for (const [ionCa, frac] of Object.entries(caMineral.ions)) {
      const key = /** @type {IonName} */ (ionCa);
      result[key] += mgL_caSalt * (frac ?? 0);
    }
  }

  const mgMineral = mgSource ? MINERAL_DB[mgSource] : null;
  if (mgMineral && mgL_mgSalt > 0) {
    for (const [ionMg, frac] of Object.entries(mgMineral.ions)) {
      const key = /** @type {IonName} */ (ionMg);
      result[key] += mgL_mgSalt * (frac ?? 0);
    }
  }

  // Apply each alkalinity source from the split allocation
  /** @type {const} */ (["baking-soda", "potassium-bicarbonate"]).forEach(function (alkId) {
    var alkDelta = alkAllocation[alkId];
    const alkMineral = MINERAL_DB[alkId];
    if (!alkDelta || alkDelta <= 0 || !alkMineral) return;
    var mgL_buffer;
    if (alkId === "potassium-bicarbonate") {
      mgL_buffer = alkDelta * ALK_TO_POTASSIUM_BICARB;
    } else {
      mgL_buffer = alkDelta * ALK_TO_BAKING_SODA;
    }
    for (const [ionAlk, frac] of Object.entries(alkMineral.ions)) {
      const key = /** @type {IonName} */ (ionAlk);
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
 * @param {string} label
 * @param {Record<string, number | string | undefined | null>} ions
 * @param {string | null | undefined} description
 * @param {{ brewMethod?: string, alkalinity?: number | null }} [options]
 */
function buildStoredTargetProfile(label, ions, description, options) {
  options = options || {};
  const brewMethod =
    options.brewMethod === "espresso"
      ? "espresso"
      : options.brewMethod === "filter"
        ? "filter"
        : loadBrewMethod();
  /** @type {Record<IonName, number>} */
  const normalized = {
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
 * @param {Record<string, number> | null | undefined} mineralGramsPerLiter
 * @returns {string[]}
 */
function getRecipeOverLimitMineralIds(mineralGramsPerLiter) {
  /** @type {string[]} */
  const out = [];
  if (!mineralGramsPerLiter || typeof mineralGramsPerLiter !== "object") return out;
  if (typeof MINERAL_SOLUBILITY_G_PER_L_25C_APPROX === "undefined") return out;
  const solubility = /** @type {Record<string, number | undefined>} */ (
    MINERAL_SOLUBILITY_G_PER_L_25C_APPROX
  );
  for (const [mineralId, gPerLraw] of Object.entries(mineralGramsPerLiter)) {
    const cap = solubility[mineralId];
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
 * @param {number[][]} A
 * @returns {number[][]}
 */
function _matTranspose(A) {
  if (!A || A.length === 0) return [];
  const m = A.length;
  const firstRow = A[0];
  const n = firstRow ? firstRow.length : 0;
  /** @type {number[][]} */
  const out = [];
  for (let j = 0; j < n; j++) {
    /** @type {number[]} */
    const row = [];
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
 * @param {number[][]} A
 * @param {number[][]} B
 * @returns {number[][]}
 */
function _matMul(A, B) {
  const m = A.length;
  const n = A[0]?.length || 0;
  const p = B[0]?.length || 0;
  /** @type {number[][]} */
  const out = [];
  for (let i = 0; i < m; i++) {
    const rowA = A[i];
    /** @type {number[]} */
    const row = new Array(p).fill(0);
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
 * @param {number[][]} A
 * @param {number[]} x
 * @returns {number[]}
 */
function _matVec(A, x) {
  const m = A.length;
  const n = A[0]?.length || 0;
  /** @type {number[]} */
  const out = new Array(m).fill(0);
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
 * @param {number[][]} M
 * @param {number[]} c
 * @returns {number[] | null}
 */
function _solveLinear(M, c) {
  const n = M.length;
  if (n === 0) return [];
  // Build augmented matrix [M | c] working copies. Defensive about undefined
  // entries even though callers pass dense matrices — TS strict-index-access
  // can't prove that from inside.
  /** @type {number[][]} */
  const aug = M.map((row, i) => (row || []).concat([c[i] || 0]));
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
  /** @type {number[]} */
  const x = new Array(n).fill(0);
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
 * @param {number[][]} A — m×n matrix
 * @param {number[]} b — m-vector
 * @returns {number[]} x — n-vector, all entries ≥ 0
 */
function solveNNLS(A, b) {
  if (!A || A.length === 0) return [];
  const n = A[0]?.length || 0;
  if (n === 0) return [];

  /** @type {Set<number>} */
  const active = new Set();
  for (let j = 0; j < n; j++) active.add(j);

  /** @type {number[]} */
  const x = new Array(n).fill(0);

  // Cap iterations defensively — convergence is fast for well-posed
  // problems but a malformed input shouldn't hang the UI.
  for (let iter = 0; iter < 100; iter++) {
    const activeIdx = [...active].sort((a, b) => a - b);
    if (activeIdx.length === 0) break;

    // Build A_active: m × |active| by picking columns.
    /** @type {number[][]} */
    const A_active = A.map((row) => activeIdx.map((j) => (row && row[j]) || 0));
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
 *
 * @param {IonMap | null | undefined} sourceWater
 * @param {Partial<Record<IonName, number | null | undefined>> | null | undefined} target
 * @param {Array<{ id: string, spec: StockConcentrateSpec }>} concentrateEntries
 * @param {string[]} mineralIds
 * @returns {{
 *   concentrateGramsPerL: Record<string, number>,
 *   mineralGramsPerL: Record<string, number>,
 *   residualIons: Record<IonName, number>,
 *   maxResidualIon: { ion: IonName, residual: number } | null,
 * }}
 */
function solveCalculatorDosing(sourceWater, target, concentrateEntries, mineralIds) {
  const entries = Array.isArray(concentrateEntries) ? concentrateEntries : [];
  const mins = Array.isArray(mineralIds) ? mineralIds : [];

  // b = target - source per ion, in row order matching ION_FIELDS.
  /** @type {number[]} */
  const b = [];
  ION_FIELDS.forEach((ion) => {
    const tgt = target && target[ion] != null ? Number(target[ion]) : 0;
    const src = sourceWater && sourceWater[ion] != null ? Number(sourceWater[ion]) : 0;
    b.push(Number.isFinite(tgt) && Number.isFinite(src) ? tgt - src : 0);
  });

  // Columns of A: each concentrate's ion contribution per gram-per-liter,
  // then each mineral's ion contribution per gram-per-liter.
  /** @type {number[][]} */
  const A = ION_FIELDS.map(() => []);

  /** @type {string[]} */
  const concentrateOrder = [];
  for (const entry of entries) {
    if (!entry || !entry.spec) continue;
    // computeStockMineralGramsPerL returns per-liter grams of each mineral
    // when dispensing at the prescribed dose. To get the column "ions per
    // gram-per-liter of CONCENTRATE", normalize by doseGramsPerL.
    const dosePerL = Number(entry.spec.doseGramsPerL) || 0;
    if (dosePerL <= 0) continue;
    const perLAtPrescribed = computeStockMineralGramsPerL(entry.spec);
    /** @type {Record<string, number>} */
    const perGramOfConcentrate = {};
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

  /** @type {string[]} */
  const mineralOrder = [];
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
  /** @type {number[]} */
  let x = [];
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

  /** @type {Record<string, number>} */
  const concentrateGramsPerL = {};
  /** @type {Record<string, number>} */
  const mineralGramsPerL = {};
  concentrateOrder.forEach((id, k) => {
    concentrateGramsPerL[id] = Math.max(0, x[k] || 0);
  });
  mineralOrder.forEach((id, k) => {
    mineralGramsPerL[id] = Math.max(0, x[concentrateOrder.length + k] || 0);
  });

  // Residual diagnostic: what ions are still under-/over-target after the
  // solver picks the best non-negative combination.
  const Ax = _matVec(A, x);
  /** @type {Record<string, number>} */
  const residualIons = {};
  /** @type {{ ion: IonName, residual: number } | null} */
  let maxResidualIon = null;
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

// --- Node/Vitest UMD shim (harmless in browsers) ---
// See constants.js for the pattern. Assumes constants.js has already loaded
// and populated globalThis (both in browser script-scope and in tests that
// require constants.js first).
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    calculateIonPPMs,
    calculateMetrics,
    recipeMetricsSummary,
    calculateSo4ClRatio,
    toStableBicarbonateFromAlkalinity,
    pickBestCaMgSources,
    evaluateWaterProfileRanges,
    splitAlkalinityDelta,
    deriveStockFormulaFromTarget,
    computeFullProfile,
    buildStoredTargetProfile,
    getRecipeOverLimitMineralIds,
    solveNNLS,
    solveCalculatorDosing,
  };
}
