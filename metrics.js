// ============================================
// Metrics — water chemistry calculations
// ============================================

// --- Ion calculation from grams of minerals ---
function calculateIonPPMs(mineralGrams) {
  const ions = {
    calcium: 0,
    magnesium: 0,
    potassium: 0,
    sodium: 0,
    sulfate: 0,
    chloride: 0,
    bicarbonate: 0
  };

  for (const [mineralId, grams] of Object.entries(mineralGrams)) {
    const mineral = MINERAL_DB[mineralId];
    if (!mineral) continue;
    for (const [ion, fraction] of Object.entries(mineral.ions)) {
      ions[ion] += grams * fraction * 1000; // g/L * fraction * 1000 = mg/L
    }
  }

  return ions;
}

// --- Derived water metrics ---
function calculateMetrics(ions) {
  const gh = (ions.calcium || 0) * CA_TO_CACO3 + (ions.magnesium || 0) * MG_TO_CACO3;
  const kh = (ions.bicarbonate || 0) * HCO3_TO_CACO3;
  const tds = (ions.calcium || 0) + (ions.magnesium || 0) + (ions.potassium || 0) +
              (ions.sodium || 0) + (ions.sulfate || 0) + (ions.chloride || 0) + (ions.bicarbonate || 0);
  return { gh, kh, tds };
}

function calculateSo4ClRatio(ions) {
  if (!ions || typeof ions !== "object") return null;
  const sulfate = Number(ions.sulfate);
  const chloride = Number(ions.chloride);
  if (!Number.isFinite(sulfate) || !Number.isFinite(chloride) || chloride <= 0) return null;
  return sulfate / chloride;
}

// --- Bicarbonate <-> Alkalinity conversion ---
function toStableBicarbonateFromAlkalinity(alkAsCaCO3, existingBicarbonate) {
  const alkRounded = Math.round(parseFloat(alkAsCaCO3) || 0);
  const candidate = Math.round(alkRounded * CACO3_TO_HCO3 * 10) / 10;
  const existing = Math.round((parseFloat(existingBicarbonate) || 0) * 10) / 10;
  const candidateAlk = Math.round(candidate * HCO3_TO_CACO3);
  const existingAlk = Math.round(existing * HCO3_TO_CACO3);
  if (existingAlk === alkRounded) return existing;
  if (candidateAlk === alkRounded) return candidate;
  return candidate;
}

// --- Best Ca/Mg source combination (minimize side-effect ion deltas; tie-break: Epsom, CaCl2) ---
function pickBestCaMgSources(sourceWater, targetProfile, deltaCa, deltaMg) {
  const caSources = getEffectiveCalciumSources();
  const mgSources = getEffectiveMagnesiumSources();
  const needCa = deltaCa > 0 && caSources.length > 0;
  const needMg = deltaMg > 0 && mgSources.length > 0;

  const caCandidates = needCa ? caSources : (caSources.length ? caSources : []);
  const mgCandidates = needMg ? mgSources : (mgSources.length ? mgSources : []);

  if (caCandidates.length === 0 && mgCandidates.length === 0) {
    return {
      caSource: caSources.length === 1 ? caSources[0] : (caSources.length === 2 ? "calcium-chloride" : null),
      mgSource: mgSources.length === 1 ? mgSources[0] : (mgSources.length === 2 ? "epsom-salt" : null)
    };
  }

  const targetCl = targetProfile && Number.isFinite(Number(targetProfile.chloride)) ? Number(targetProfile.chloride) : null;
  const targetSO4 = targetProfile && Number.isFinite(Number(targetProfile.sulfate)) ? Number(targetProfile.sulfate) : null;
  const srcCl = (sourceWater && Number(sourceWater.chloride)) || 0;
  const srcSO4 = (sourceWater && Number(sourceWater.sulfate)) || 0;

  let best = { caSource: null, mgSource: null, error: Infinity, tieBreak: Infinity };

  const caOpts = caCandidates.length ? caCandidates : [null];
  const mgOpts = mgCandidates.length ? mgCandidates : [null];

  for (const caSrc of caOpts) {
    for (const mgSrc of mgOpts) {
      const mineralGrams = {};
      if (caSrc && deltaCa > 0) {
        const caFrac = MINERAL_DB[caSrc] && MINERAL_DB[caSrc].ions ? MINERAL_DB[caSrc].ions.calcium : 0;
        if (caFrac > 0) mineralGrams[caSrc] = (deltaCa / 1000) / caFrac;
      }
      if (mgSrc && deltaMg > 0) {
        const mgFrac = MINERAL_DB[mgSrc] && MINERAL_DB[mgSrc].ions ? MINERAL_DB[mgSrc].ions.magnesium : 0;
        if (mgFrac > 0) mineralGrams[mgSrc] = (deltaMg / 1000) / mgFrac;
      }
      const added = calculateIonPPMs(mineralGrams);
      const result = {};
      ION_FIELDS.forEach((ion) => {
        result[ion] = (sourceWater && sourceWater[ion] ? Number(sourceWater[ion]) : 0) + (added[ion] || 0);
      });
      let error;
      if (targetCl != null && targetSO4 != null) {
        error = Math.pow((result.chloride || 0) - targetCl, 2) + Math.pow((result.sulfate || 0) - targetSO4, 2);
      } else {
        error = Math.pow((result.chloride || 0) - srcCl, 2) + Math.pow((result.sulfate || 0) - srcSO4, 2);
      }
      const tieBreak = (caSrc === "gypsum" ? 1 : 0) + (mgSrc === "magnesium-chloride" ? 2 : 0);
      if (error < best.error || (error === best.error && tieBreak < best.tieBreak)) {
        best = { caSource: caSrc, mgSource: mgSrc, error, tieBreak };
      }
    }
  }

  return {
    caSource: best.caSource,
    mgSource: best.mgSource
  };
}

// --- Water profile range evaluation ---
function evaluateWaterProfileRanges(ions, options = {}) {
  const normalized = {};
  ION_FIELDS.forEach((ion) => {
    normalized[ion] = Number.isFinite(Number(ions && ions[ion])) ? Number(ions[ion]) : 0;
  });
  const metrics = calculateMetrics(normalized);
  const ratio = calculateSo4ClRatio(normalized);
  const includeAdvanced = options.includeAdvanced !== false;
  const alkalinitySources = options.alkalinitySources !== undefined
    ? options.alkalinitySources
    : (() => { const s = getEffectiveAlkalinitySource(); return s ? [s] : []; })();
  const calciumSource = options.calciumSource !== undefined ? options.calciumSource : getEffectiveCalciumSource();
  const magnesiumSource = options.magnesiumSource !== undefined ? options.magnesiumSource : getEffectiveMagnesiumSource();
  const findings = [];

  function addFinding(severity, message) {
    findings.push({ severity, message });
  }

  function formatBand(min, max, unit) {
    if (min != null && max != null) return `${min}-${max}${unit ? " " + unit : ""}`;
    if (min != null) return `>=${min}${unit ? " " + unit : ""}`;
    if (max != null) return `<=${max}${unit ? " " + unit : ""}`;
    return "n/a";
  }

  function addBandFinding(label, value, unit, preferredMin, preferredMax, warnMin, warnMax, dangerMin, dangerMax) {
    if (!Number.isFinite(value)) return;
    const rounded = Math.round(value * 10) / 10;
    const valueText = `${rounded}${unit ? " " + unit : ""}`;
    const preferredBand = formatBand(preferredMin, preferredMax, unit);
    const direction = (
      (preferredMin != null && value < preferredMin) ||
      (warnMin != null && value < warnMin) ||
      (dangerMin != null && value < dangerMin)
    ) ? "low" : "high";
    if ((dangerMin != null && value < dangerMin) || (dangerMax != null && value > dangerMax)) {
      addFinding("danger", `${label} is too ${direction} at ${valueText} (recommended ${preferredBand}).`);
      return;
    }
    if ((warnMin != null && value < warnMin) || (warnMax != null && value > warnMax)) {
      addFinding("warn", `${label} is too ${direction} at ${valueText} (recommended ${preferredBand}).`);
      return;
    }
    if ((preferredMin != null && value < preferredMin) || (preferredMax != null && value > preferredMax)) {
      addFinding("info", `${label} is slightly ${direction} at ${valueText} (recommended ${preferredBand}).`);
    }
  }

  addBandFinding("TDS", metrics.tds, "mg/L", 75, 250, 50, 300, 25, 400);
  addBandFinding("KH", metrics.kh, "mg/L as CaCO3", 40, 70, 20, 120, 10, 180);
  addBandFinding("GH", metrics.gh, "mg/L as CaCO3", 50, 175, 25, 220, 10, 280);
  addBandFinding("Calcium", normalized.calcium, "mg/L", 17, 85, 10, 110, 5, 150);
  addBandFinding("Magnesium", normalized.magnesium, "mg/L", 5, 30, 2, 45, 1, 70);

  const useBakingSodaSodiumLimits = Array.isArray(alkalinitySources) && alkalinitySources.includes("baking-soda");
  const sodiumPreferredMax = useBakingSodaSodiumLimits ? 25 : 10;
  const sodiumWarnMax = useBakingSodaSodiumLimits ? 40 : 30;
  const sodiumDangerMax = useBakingSodaSodiumLimits ? 60 : 45;
  addBandFinding("Sodium", normalized.sodium, "mg/L", null, sodiumPreferredMax, null, sodiumWarnMax, null, sodiumDangerMax);

  if (includeAdvanced) {
    const chlorideHeavySource = calciumSource === "calcium-chloride" || magnesiumSource === "magnesium-chloride";
    const chloridePreferredMax = chlorideHeavySource ? 90 : 30;
    const chlorideWarnMax = chlorideHeavySource ? 130 : 50;
    const chlorideDangerMax = chlorideHeavySource ? 180 : 100;
    addBandFinding("Chloride", normalized.chloride, "mg/L", null, chloridePreferredMax, null, chlorideWarnMax, null, chlorideDangerMax);

    if (normalized.sulfate < 5 || normalized.sulfate > 75) {
      const sulfateDirection = normalized.sulfate < 5 ? "low" : "high";
      addFinding("info", `Sulfate is ${sulfateDirection} at ${Math.round(normalized.sulfate * 10) / 10} mg/L (heuristic 5-75 mg/L).`);
    }
    if (normalized.potassium > 20) {
      addFinding("info", `Potassium is high at ${Math.round(normalized.potassium * 10) / 10} mg/L (heuristic <=20 mg/L).`);
    }
    if (ratio == null) {
      addFinding("info", "SO4:Cl ratio unavailable (chloride is 0).");
    } else if (ratio < 0.5 || ratio > 2.0) {
      const ratioDirection = ratio < 0.5 ? "low" : "high";
      addFinding("info", `SO4:Cl ratio is ${ratioDirection} at ${ratio.toFixed(2)} (heuristic 0.50-2.00).`);
    }
  }

  findings.sort((a, b) => {
    const sa = RANGE_SEVERITY_ORDER[a.severity] ?? 99;
    const sb = RANGE_SEVERITY_ORDER[b.severity] ?? 99;
    return sa - sb;
  });

  return { findings, metrics, ratio };
}

// --- Split alkalinity delta between baking soda and potassium bicarbonate when both are enabled ---
function splitAlkalinityDelta(alkalinitySources, deltaAlkAsCaCO3, sourceWater, targetProfile) {
  var result = {};
  if (alkalinitySources.length === 0) return result;
  if (alkalinitySources.length === 1) {
    result[alkalinitySources[0]] = deltaAlkAsCaCO3;
    return result;
  }
  // Both baking-soda and potassium-bicarbonate enabled: split by target sodium vs potassium if present
  var targetNa = targetProfile && Number.isFinite(Number(targetProfile.sodium)) ? Number(targetProfile.sodium) : null;
  var targetK = targetProfile && Number.isFinite(Number(targetProfile.potassium)) ? Number(targetProfile.potassium) : null;
  var sourceNa = sourceWater && Number.isFinite(Number(sourceWater.sodium)) ? Number(sourceWater.sodium) : 0;
  var sourceK = sourceWater && Number.isFinite(Number(sourceWater.potassium)) ? Number(sourceWater.potassium) : 0;
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

// --- Compute full 7-ion profile from a Ca/Mg/Alk target ---
// Uses the same pickBestCaMgSources and splitAlkalinityDelta logic as the Calculator
// to ensure consistent ion math across all pages.
function computeFullProfile(target) {
  var hasExplicitIons = target && ION_FIELDS.every(function(ion) { return Number.isFinite(Number(target[ion])); });
  if (hasExplicitIons) {
    var explicit = {};
    ION_FIELDS.forEach(function(ion) {
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

  var caFraction = caSource ? (MINERAL_DB[caSource] && MINERAL_DB[caSource].ions ? MINERAL_DB[caSource].ions.calcium || 0 : 0) : 0;
  var mgFraction = mgSource ? (MINERAL_DB[mgSource] && MINERAL_DB[mgSource].ions ? MINERAL_DB[mgSource].ions.magnesium || 0 : 0) : 0;
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
    bicarbonate: sourceWater.bicarbonate || 0
  };

  if (caSource && mgL_caSalt > 0 && MINERAL_DB[caSource]) {
    for (var ionCa in MINERAL_DB[caSource].ions) {
      if (MINERAL_DB[caSource].ions.hasOwnProperty(ionCa)) {
        result[ionCa] += mgL_caSalt * MINERAL_DB[caSource].ions[ionCa];
      }
    }
  }

  if (mgSource && mgL_mgSalt > 0 && MINERAL_DB[mgSource]) {
    for (var ionMg in MINERAL_DB[mgSource].ions) {
      if (MINERAL_DB[mgSource].ions.hasOwnProperty(ionMg)) {
        result[ionMg] += mgL_mgSalt * MINERAL_DB[mgSource].ions[ionMg];
      }
    }
  }

  // Apply each alkalinity source from the split allocation
  var alkSources = ["baking-soda", "potassium-bicarbonate"];
  alkSources.forEach(function(alkId) {
    var alkDelta = alkAllocation[alkId];
    if (!alkDelta || alkDelta <= 0 || !MINERAL_DB[alkId]) return;
    var mgL_buffer;
    if (alkId === "potassium-bicarbonate") {
      mgL_buffer = alkDelta * ALK_TO_POTASSIUM_BICARB;
    } else {
      mgL_buffer = alkDelta * ALK_TO_BAKING_SODA;
    }
    for (var ionAlk in MINERAL_DB[alkId].ions) {
      if (MINERAL_DB[alkId].ions.hasOwnProperty(ionAlk)) {
        result[ionAlk] += mgL_buffer * MINERAL_DB[alkId].ions[ionAlk];
      }
    }
  });

  ION_FIELDS.forEach(function(ion) { result[ion] = Math.round(result[ion]); });
  return result;
}

// --- Build a stored target profile from ions (Inconsistency 1: shared across pages) ---
function buildStoredTargetProfile(label, ions, description, options) {
  options = options || {};
  const brewMethod = options.brewMethod === "espresso" ? "espresso" : (options.brewMethod === "filter" ? "filter" : loadBrewMethod());
  const normalized = {};
  ION_FIELDS.forEach(function(ion) {
    normalized[ion] = Math.round(parseFloat(ions[ion]) || 0);
  });
  const metrics = calculateMetrics(normalized);
  return {
    label: label,
    calcium: normalized.calcium,
    magnesium: normalized.magnesium,
    alkalinity: options.alkalinity != null ? Math.round(options.alkalinity) : Math.round(metrics.kh),
    potassium: normalized.potassium,
    sodium: normalized.sodium,
    sulfate: normalized.sulfate,
    chloride: normalized.chloride,
    bicarbonate: normalized.bicarbonate,
    description: description || "",
    brewMethod: brewMethod
  };
}
