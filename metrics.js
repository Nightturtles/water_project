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

// --- Water profile range evaluation ---
function evaluateWaterProfileRanges(ions, options = {}) {
  const normalized = {};
  ION_FIELDS.forEach((ion) => {
    normalized[ion] = Number.isFinite(Number(ions && ions[ion])) ? Number(ions[ion]) : 0;
  });
  const metrics = calculateMetrics(normalized);
  const ratio = calculateSo4ClRatio(normalized);
  const includeAdvanced = options.includeAdvanced !== false;
  const alkalinitySource = getEffectiveAlkalinitySource();
  const calciumSource = getEffectiveCalciumSource();
  const magnesiumSource = getEffectiveMagnesiumSource();
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

  const sodiumPreferredMax = alkalinitySource === "baking-soda" ? 25 : 10;
  const sodiumWarnMax = alkalinitySource === "baking-soda" ? 40 : 30;
  const sodiumDangerMax = alkalinitySource === "baking-soda" ? 60 : 45;
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

// --- Compute full 7-ion profile from a Ca/Mg/Alk target ---
function computeFullProfile(target) {
  const hasExplicitIons = target && ION_FIELDS.every((ion) => Number.isFinite(Number(target[ion])));
  if (hasExplicitIons) {
    const explicit = {};
    ION_FIELDS.forEach((ion) => {
      explicit[ion] = Math.round(Number(target[ion]) || 0);
    });
    return explicit;
  }

  const sourceWater = getSourceWaterByPreset(loadSourcePresetName());
  const alkSource = getEffectiveAlkalinitySource();
  const caSource = getEffectiveCalciumSource();
  const mgSource = getEffectiveMagnesiumSource();

  const sourceAlk = (sourceWater.bicarbonate || 0) * HCO3_TO_CACO3;
  const deltaCa = Math.max(0, (target.calcium || 0) - (sourceWater.calcium || 0));
  const deltaMg = Math.max(0, (target.magnesium || 0) - (sourceWater.magnesium || 0));
  const deltaAlk = Math.max(0, (target.alkalinity || 0) - sourceAlk);

  const caFraction = caSource ? (MINERAL_DB[caSource]?.ions?.calcium || 0) : 0;
  const mgFraction = mgSource ? (MINERAL_DB[mgSource]?.ions?.magnesium || 0) : 0;
  const mgL_caSalt = caFraction > 0 ? deltaCa / caFraction : 0;
  const mgL_mgSalt = mgFraction > 0 ? deltaMg / mgFraction : 0;
  let mgL_buffer = 0;
  if (alkSource === "potassium-bicarbonate") {
    mgL_buffer = deltaAlk * ALK_TO_POTASSIUM_BICARB;
  } else if (alkSource === "baking-soda") {
    mgL_buffer = deltaAlk * ALK_TO_BAKING_SODA;
  }

  const result = {
    calcium: sourceWater.calcium || 0,
    magnesium: sourceWater.magnesium || 0,
    potassium: sourceWater.potassium || 0,
    sodium: sourceWater.sodium || 0,
    sulfate: sourceWater.sulfate || 0,
    chloride: sourceWater.chloride || 0,
    bicarbonate: sourceWater.bicarbonate || 0
  };

  if (caSource && mgL_caSalt > 0) {
    for (const [ion, fraction] of Object.entries(MINERAL_DB[caSource].ions)) {
      result[ion] += mgL_caSalt * fraction;
    }
  }

  if (mgSource && mgL_mgSalt > 0) {
    for (const [ion, fraction] of Object.entries(MINERAL_DB[mgSource].ions)) {
      result[ion] += mgL_mgSalt * fraction;
    }
  }

  if (alkSource && mgL_buffer > 0) {
    for (const [ion, fraction] of Object.entries(MINERAL_DB[alkSource].ions)) {
      result[ion] += mgL_buffer * fraction;
    }
  }

  ION_FIELDS.forEach(ion => { result[ion] = Math.round(result[ion]); });
  return result;
}

// --- Build a stored target profile from ions (Inconsistency 1: shared across pages) ---
function buildStoredTargetProfile(label, ions, description, options) {
  options = options || {};
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
    description: description || ""
  };
}
