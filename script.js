// ============================================
// Coffee Water Chemistry Calculator
// ============================================

// --- Conversion factors (derived from MINERAL_DB) ---
const ALK_TO_BAKING_SODA = 2 * MINERAL_DB["baking-soda"].mw / MW_CACO3;
const ALK_TO_POTASSIUM_BICARB = 2 * MINERAL_DB["potassium-bicarbonate"].mw / MW_CACO3;

// --- State ---
let currentProfile = loadTargetPresetName();

// --- DOM elements ---
const volumeInput = document.getElementById("volume");
const volumeUnit = document.getElementById("volume-unit");
const sourcePresetSelect = document.getElementById("source-preset");
const sourceWaterTags = document.getElementById("source-water-tags");
const targetCa = document.getElementById("target-calcium");
const targetMg = document.getElementById("target-magnesium");
const targetAlk = document.getElementById("target-alkalinity");
const profileDesc = document.getElementById("profile-description");
const resultsContainer = document.getElementById("results-container");
const profileButtonsContainer = document.getElementById("profile-buttons");
const targetSaveBar = document.getElementById("target-save-bar");
const targetEditBar = document.getElementById("target-edit-bar");
const targetProfileNameInput = document.getElementById("target-profile-name");
const targetSaveBtn = document.getElementById("target-save-btn");
const targetSaveChangesBtn = document.getElementById("target-save-changes-btn");
const targetSaveStatus = document.getElementById("target-save-status");

let lastCalculatedIons = null;


// --- Populate source water dropdown ---
initSourcePresetSelect(sourcePresetSelect);
const savedVolume = loadVolumePreference("calculator", { value: volumeInput.value, unit: volumeUnit.value });
volumeInput.value = savedVolume.value;
volumeUnit.value = savedVolume.unit;

function getSourceWater() {
  return getSourceWaterByPreset(sourcePresetSelect.value);
}

function updateSourceWaterTags() {
  renderSourceWaterTags(sourceWaterTags, getSourceWater());
  const resultsHint = document.getElementById("results-hint");
  if (resultsHint) {
    const preset = getAllPresets()[sourcePresetSelect.value];
    const name = preset ? preset.label : "your water";
    resultsHint.textContent = `Using ${name} as your base, add these mineral salts:`;
  }
}

updateSourceWaterTags();

// --- Result items: show only minerals selected in Settings ---
// Calculator uses: epsom-salt (Mg), calcium-chloride (Ca), baking-soda or potassium-bicarbonate (alkalinity)

function renderResultItems() {
  const alkalinitySource = getEffectiveAlkalinitySource();
  if (alkalinitySource === null) {
    resultsContainer.innerHTML = '<p class="hint error">You need to select an alkalinity source in <a href="minerals.html">Settings</a></p>';
    lastCalculatedIons = null;
    updateSummaryMetrics({});
    return;
  }

  const selected = loadSelectedMinerals();
  const bufferMineralId = alkalinitySource;
  const mgSource = getEffectiveMagnesiumSource();
  const caSource = getEffectiveCalciumSource();

  const toShow = [
    { id: mgSource, order: 0 },
    { id: bufferMineralId, order: 1 },
    { id: caSource, order: 2 }
  ].filter(item => item.id && selected.includes(item.id))
   .sort((a, b) => a.order - b.order);

  resultsContainer.innerHTML = "";
  if (toShow.length === 0) {
    resultsContainer.innerHTML = '<p class="hint">Select minerals in <a href="minerals.html">Settings</a> to see what to add.</p>';
    lastCalculatedIons = null;
    updateSummaryMetrics({});
    return;
  }
  for (const { id } of toShow) {
    const mineral = MINERAL_DB[id];
    if (!mineral) continue;
    const div = document.createElement("div");
    div.className = "result-item";
    div.dataset.mineral = id;
    div.innerHTML = `
      <div class="result-info">
        <span class="result-name">${mineral.name}</span>
        <span class="result-detail">${mineral.formula}</span>
      </div>
      <span class="result-value">0.00 g</span>
    `;
    resultsContainer.appendChild(div);
  }
}

// --- Dynamic profile buttons ---
function renderProfileButtons() {
  profileButtonsContainer.innerHTML = "";
  const allProfiles = getAllTargetPresets();
  for (const [key, profile] of Object.entries(allProfiles)) {
    const btn = document.createElement("button");
    btn.className = "profile-btn";
    btn.dataset.profile = key;
    if (key === "custom") {
      btn.textContent = profile.label;
    } else {
      btn.textContent = profile.label;
      const del = document.createElement("span");
      del.className = "preset-delete";
      del.dataset.delete = key;
      del.innerHTML = "&times;";
      btn.appendChild(del);
    }
    profileButtonsContainer.appendChild(btn);
  }
  highlightProfile(currentProfile);
}

// --- Restore defaults for target presets ---
function updateRestoreTargetBar() {
  const deleted = loadDeletedTargetPresets();
  document.getElementById("restore-target-bar").style.display = deleted.length > 0 ? "flex" : "none";
}

document.getElementById("restore-target-defaults").addEventListener("click", (e) => {
  e.preventDefault();
  restoreTargetPresetDefaults();
  renderProfileButtons();
  updateRestoreTargetBar();
});

function highlightProfile(profileName) {
  profileButtonsContainer.querySelectorAll(".profile-btn").forEach(b => b.classList.remove("active"));
  const btn = profileButtonsContainer.querySelector(`[data-profile="${profileName}"]`);
  if (btn) btn.classList.add("active");
  targetSaveBar.style.display = profileName === "custom" ? "flex" : "none";
  targetEditBar.style.display = "none";
}

function activateProfile(profileName) {
  currentProfile = profileName;
  highlightProfile(profileName);
  saveTargetPresetName(profileName);

  if (profileName === "custom") {
    profileDesc.textContent = "Enter your own target values above.";
    calculate();
    return;
  }

  const profile = getTargetProfileByKey(profileName);
  if (profile) {
    targetCa.value = profile.calcium;
    targetMg.value = profile.magnesium;
    targetAlk.value = profile.alkalinity;
    profileDesc.textContent = profile.description || "";
  }
  calculate();
}

function hasUnsavedTargetChanges() {
  if (currentProfile === "custom") return false;
  const profile = getTargetProfileByKey(currentProfile);
  if (!profile) return false;
  return (parseFloat(targetCa.value) || 0) !== (profile.calcium || 0) ||
         (parseFloat(targetMg.value) || 0) !== (profile.magnesium || 0) ||
         (parseFloat(targetAlk.value) || 0) !== (profile.alkalinity || 0);
}

// --- Event delegation for profile buttons ---
profileButtonsContainer.addEventListener("click", (e) => {
  const deleteKey = e.target.dataset.delete;
  if (deleteKey) {
    e.stopPropagation();
    showConfirm("Are you sure you want to delete this profile?", () => {
      if (TARGET_PRESETS[deleteKey]) {
        addDeletedTargetPreset(deleteKey);
      }
      deleteCustomTargetProfile(deleteKey);
      renderProfileButtons();
      updateRestoreTargetBar();
      if (currentProfile === deleteKey) {
        const remaining = Object.keys(getAllTargetPresets());
        const fallback = remaining.find(k => k !== "custom") || "custom";
        activateProfile(fallback);
      }
    });
    return;
  }

  const btn = e.target.closest(".profile-btn");
  if (!btn) return;
  activateProfile(btn.dataset.profile);
});

// --- Target input handling ---
[targetCa, targetMg, targetAlk].forEach(input => {
  input.addEventListener("input", () => {
    if (currentProfile !== "custom") {
      if (NON_EDITABLE_TARGET_KEYS.includes(currentProfile)) {
        currentProfile = "custom";
        highlightProfile("custom");
        saveTargetPresetName("custom");
        profileDesc.textContent = "Enter your own target values above.";
      } else {
        targetEditBar.style.display = hasUnsavedTargetChanges() ? "flex" : "none";
      }
    }
    calculate();
  });
});

// --- Save changes to existing target profile ---
targetSaveChangesBtn.addEventListener("click", () => {
  showConfirm("Are you sure you want to change this profile?", () => {
    const allProfiles = getAllTargetPresets();
    const existing = allProfiles[currentProfile];
    if (!existing) return;
    const ions = lastCalculatedIons || {};
    const metrics = calculateMetrics(ions);
    const profile = {
      label: existing.label,
      calcium: Math.round(ions.calcium || 0),
      magnesium: Math.round(ions.magnesium || 0),
      alkalinity: Math.round(metrics.kh || 0),
      potassium: Math.round(ions.potassium || 0),
      sodium: Math.round(ions.sodium || 0),
      sulfate: Math.round(ions.sulfate || 0),
      chloride: Math.round(ions.chloride || 0),
      bicarbonate: Math.round(ions.bicarbonate || 0),
      description: existing.description || ""
    };
    const profiles = loadCustomTargetProfiles();
    profiles[currentProfile] = profile;
    saveCustomTargetProfiles(profiles);
    targetEditBar.style.display = "none";
    renderProfileButtons();
  });
});

// --- Duplicate name error below name input (target profile) ---
function updateTargetProfileNameError() {
  const errEl = document.getElementById("target-profile-name-error");
  const validation = validateTargetProfileName(targetProfileNameInput.value, { allowEmpty: true });
  if (validation.empty) {
    errEl.textContent = "";
    targetSaveBtn.disabled = false;
    return;
  }
  if (!validation.ok) {
    errEl.textContent = validation.message;
    targetSaveBtn.disabled = true;
    return;
  }
  errEl.textContent = "";
  targetSaveBtn.disabled = false;
}

targetProfileNameInput.addEventListener("input", updateTargetProfileNameError);
bindEnterToClick(targetProfileNameInput, targetSaveBtn);

// --- Save new custom target profile ---
targetSaveBtn.addEventListener("click", () => {
  const validation = validateTargetProfileName(targetProfileNameInput.value);
  if (!validation.ok) {
    if (validation.code === "reserved" || validation.code === "duplicate") {
      updateTargetProfileNameError();
      return;
    }
    document.getElementById("target-profile-name-error").textContent = "";
    showTargetSaveStatus(validation.message, true);
    return;
  }
  const { key, name } = validation;
  if (!key || !name) {
    updateTargetProfileNameError();
    return;
  }

  document.getElementById("target-profile-name-error").textContent = "";

  const profiles = loadCustomTargetProfiles();
  const ions = lastCalculatedIons || {};
  const metrics = calculateMetrics(ions);
  profiles[key] = {
    label: name,
    calcium: Math.round(ions.calcium || 0),
    magnesium: Math.round(ions.magnesium || 0),
    alkalinity: Math.round(metrics.kh || 0),
    potassium: Math.round(ions.potassium || 0),
    sodium: Math.round(ions.sodium || 0),
    sulfate: Math.round(ions.sulfate || 0),
    chloride: Math.round(ions.chloride || 0),
    bicarbonate: Math.round(ions.bicarbonate || 0),
    description: ""
  };
  saveCustomTargetProfiles(profiles);

  renderProfileButtons();
  activateProfile(key);
  targetProfileNameInput.value = "";
  updateTargetProfileNameError();
  showTargetSaveStatus("Saved!", false);
});

const showTargetSaveStatus = createStatusHandler(targetSaveStatus);

// --- Source water dropdown change ---
sourcePresetSelect.addEventListener("change", () => {
  saveSourcePresetName(sourcePresetSelect.value);
  updateSourceWaterTags();
  calculate();
});

// --- Recalculate on any input change ---
function onVolumeChanged() {
  saveVolumePreference("calculator", volumeInput.value, volumeUnit.value);
  calculate();
}
volumeInput.addEventListener("input", onVolumeChanged);
volumeUnit.addEventListener("change", onVolumeChanged);

// --- Core calculation ---
function calculate() {
  const warningsEl = document.getElementById("result-warnings");

  // Get volume in liters
  let volumeL = parseFloat(volumeInput.value) || 0;
  if (volumeUnit.value === "gallons") {
    volumeL *= GALLONS_TO_LITERS;
  }

  // Guard against divide-by-zero / nonsense volume
  if (!volumeL || volumeL <= 0) {
    const alk = getEffectiveAlkalinitySource();
    const mgSource = getEffectiveMagnesiumSource();
    const caSource = getEffectiveCalciumSource();
    if (warningsEl) warningsEl.textContent = "";
    lastCalculatedIons = null;
    updateResultValues({
      ...(mgSource ? { [mgSource]: 0 } : {}),
      ...(caSource ? { [caSource]: 0 } : {}),
      ...(alk ? { [alk]: 0 } : {})
    });
    updateSummaryMetrics({});
    return;
  }

  const currentBuffer = getEffectiveAlkalinitySource();
  if (currentBuffer === null) {
    if (warningsEl) warningsEl.textContent = "";
    lastCalculatedIons = null;
    updateSummaryMetrics({});
    return;
  }
  const mgSource = getEffectiveMagnesiumSource();
  const caSource = getEffectiveCalciumSource();

  // Read source water from dropdown/preset
  const sourceWater = getSourceWater();

  // Convert source bicarbonate to alkalinity as CaCO3 (uses shared HCO3_TO_CACO3)
  const sourceAlkAsCaCO3 = (sourceWater.bicarbonate || 0) * HCO3_TO_CACO3;

  // ---------------------------
  // Targets (UI)
  // ---------------------------
  // NOTE: In the existing UI, targetAlk is "alkalinity as CaCO3" (mg/L as CaCO3)
  const targetCaMgL = parseFloat(targetCa.value) || 0; // mg/L Ca
  const targetMgMgL = parseFloat(targetMg.value) || 0; // mg/L Mg
  const targetAlkAsCaCO3 = parseFloat(targetAlk.value) || 0; // mg/L as CaCO3

  // Mineral deltas (target - source), floored at 0
  const rawDeltaCa = targetCaMgL - (sourceWater.calcium || 0);
  const rawDeltaMg = targetMgMgL - (sourceWater.magnesium || 0);
  const rawDeltaAlk = targetAlkAsCaCO3 - sourceAlkAsCaCO3;
  const deltaCa = Math.max(0, rawDeltaCa);
  const deltaMg = Math.max(0, rawDeltaMg);
  const deltaAlkAsCaCO3 = Math.max(0, rawDeltaAlk);

  // Warn when source exceeds target
  const warnings = [];
  if (rawDeltaCa < 0) warnings.push(`Your source water already exceeds the target for Calcium (${(sourceWater.calcium || 0)} vs ${targetCaMgL} mg/L).`);
  if (rawDeltaMg < 0) warnings.push(`Your source water already exceeds the target for Magnesium (${(sourceWater.magnesium || 0)} vs ${targetMgMgL} mg/L).`);
  if (rawDeltaAlk < 0) warnings.push(`Your source water already exceeds the target for Alkalinity (${Math.round(sourceAlkAsCaCO3)} vs ${targetAlkAsCaCO3} mg/L as CaCO\u2083).`);
  if (!mgSource && deltaMg > 0) warnings.push("You need an enabled magnesium source (Epsom Salt or Magnesium Chloride).");
  if (!caSource && deltaCa > 0) warnings.push("You need an enabled calcium source (Calcium Chloride or Gypsum).");

  if (warningsEl) warningsEl.textContent = warnings.join("\n");

  // ---------------------------
  // Compute salt dosing (per L)
  // ---------------------------
  const mgFraction = mgSource ? (MINERAL_DB[mgSource]?.ions?.magnesium || 0) : 0;
  const caFraction = caSource ? (MINERAL_DB[caSource]?.ions?.calcium || 0) : 0;
  let mgSaltPerL = mgFraction > 0 ? (deltaMg / mgFraction) / 1000 : 0;
  let caSaltPerL = caFraction > 0 ? (deltaCa / caFraction) / 1000 : 0;

  // Buffer dosing:
  // target alkalinity is in mg/L as CaCO3. Convert to grams of bicarbonate salt using the tool's constants.
  let bufferPerL;
  if (currentBuffer === "potassium-bicarbonate") {
    bufferPerL = (deltaAlkAsCaCO3 * ALK_TO_POTASSIUM_BICARB) / 1000; // grams per liter
  } else {
    bufferPerL = (deltaAlkAsCaCO3 * ALK_TO_BAKING_SODA) / 1000; // grams per liter
  }

  // Total grams for the full volume
  const mgSaltTotal = mgSaltPerL * volumeL;
  const bufferTotal = bufferPerL * volumeL;
  const caSaltTotal = caSaltPerL * volumeL;

  // Zero out sub-threshold amounts so ion summary matches displayed grams
  if (mgSaltTotal < 0.01) mgSaltPerL = 0;
  if (caSaltTotal < 0.01) caSaltPerL = 0;
  if (bufferTotal < 0.01) bufferPerL = 0;

  // Display grams (only update elements that exist for selected minerals)
  updateResultValues({
    ...(mgSource ? { [mgSource]: mgSaltTotal } : {}),
    ...(caSource ? { [caSource]: caSaltTotal } : {}),
    [currentBuffer]: bufferTotal
  });

  // ---------------------------
  // Compute resulting ions (mg/L)
  // ---------------------------
  const mineralGramsPerL = {};
  if (mgSource && mgSaltPerL > 0) mineralGramsPerL[mgSource] = mgSaltPerL;
  if (caSource && caSaltPerL > 0) mineralGramsPerL[caSource] = caSaltPerL;
  if (currentBuffer && bufferPerL > 0) mineralGramsPerL[currentBuffer] = bufferPerL;
  const addedIons = calculateIonPPMs(mineralGramsPerL);
  const finalIons = {};
  ION_FIELDS.forEach((ion) => {
    finalIons[ion] = (sourceWater[ion] || 0) + (addedIons[ion] || 0);
  });
  lastCalculatedIons = finalIons;
  const finalSO4 = finalIons.sulfate || 0;
  const finalCl = finalIons.chloride || 0;

  // ---------------------------
  // GH / KH / TDS — use shared calculateMetrics for consistency
  // ---------------------------
  const metrics = calculateMetrics(finalIons);
  const GH_asCaCO3 = metrics.gh;
  const KH_asCaCO3 = metrics.kh;
  const TDS_ion_sum = metrics.tds;
  const advancedMode = isAdvancedMineralDisplayMode();
  const baselineMetrics = calculateMetrics(sourceWater || {});

  // Sulfate:Chloride ratio
  const so4ToCl = finalCl > 0 ? finalSO4 / finalCl : null;
  const baselineRatio = calculateSo4ClRatio(sourceWater || {});

  updateSummaryMetrics({
    gh: GH_asCaCO3,
    kh: KH_asCaCO3,
    tds: TDS_ion_sum,
    ions: finalIons,
    baselineIons: sourceWater || {},
    baselineMetrics,
    so4ToCl,
    baselineRatio,
    advancedMode
  });
}

function updateSummaryMetrics(payload) {
  const gh = payload.gh;
  const kh = payload.kh;
  const tds = payload.tds;
  const ions = payload.ions || {};
  const baselineIons = payload.baselineIons || null;
  const baselineMetrics = payload.baselineMetrics || null;
  const so4ToCl = payload.so4ToCl;
  const baselineRatio = payload.baselineRatio;
  const advancedMode = !!payload.advancedMode;

  document.getElementById("calc-gh").textContent = Number.isFinite(gh) ? Math.round(gh) : 0;
  document.getElementById("calc-kh").textContent = Number.isFinite(kh) ? Math.round(kh) : 0;
  document.getElementById("calc-tds").textContent = Number.isFinite(tds) ? Math.round(tds) : 0;
  setDeltaText(document.getElementById("calc-delta-gh"), baselineMetrics ? gh - baselineMetrics.gh : null, {
    metricName: "GH",
    unit: "mg/L as CaCO3",
    baselineLabel: "source water"
  });
  setDeltaText(document.getElementById("calc-delta-kh"), baselineMetrics ? kh - baselineMetrics.kh : null, {
    metricName: "KH",
    unit: "mg/L as CaCO3",
    baselineLabel: "source water"
  });
  setDeltaText(document.getElementById("calc-delta-tds"), baselineMetrics ? tds - baselineMetrics.tds : null, {
    metricName: "TDS",
    unit: "mg/L",
    baselineLabel: "source water"
  });
  ION_FIELDS.forEach((ion) => {
    const el = document.getElementById("calc-" + ion);
    if (!el) return;
    const v = ions[ion];
    el.textContent = Number.isFinite(v) ? Math.round(v) : 0;
    setDeltaText(document.getElementById("calc-delta-" + ion), baselineIons ? v - (baselineIons[ion] || 0) : null, {
      metricName: ion.charAt(0).toUpperCase() + ion.slice(1),
      unit: "mg/L",
      baselineLabel: "source water"
    });
  });
  document.getElementById("calc-so4cl").textContent =
    advancedMode ? (so4ToCl == null ? "—" : so4ToCl.toFixed(2)) : "—";
  setDeltaText(document.getElementById("calc-delta-so4cl"), (so4ToCl == null || baselineRatio == null) ? null : (so4ToCl - baselineRatio), {
    decimals: 2,
    metricName: "SO4:Cl ratio",
    baselineLabel: "source water"
  });
}

function formatGrams(g) {
  if (!isFinite(g) || g < 0.01) return "0.00 g";
  return g.toFixed(2) + " g";
}

function updateResultValues(valuesByMineral) {
  for (const [mineralId, grams] of Object.entries(valuesByMineral)) {
    const item = resultsContainer.querySelector(`[data-mineral="${mineralId}"]`);
    if (item) {
      const valEl = item.querySelector(".result-value");
      if (valEl) valEl.textContent = formatGrams(grams);
    }
  }
}

// --- Initialize ---
renderResultItems();
renderProfileButtons();
updateRestoreTargetBar();
const allTargetPresets = getAllTargetPresets();
if (!allTargetPresets[currentProfile]) {
  currentProfile = Object.keys(allTargetPresets).find(k => k !== "custom") || "custom";
  saveTargetPresetName(currentProfile);
}
activateProfile(currentProfile);

// --- Refresh on bfcache restore ---
window.addEventListener("pageshow", (e) => {
  if (e.persisted) location.reload();
});
