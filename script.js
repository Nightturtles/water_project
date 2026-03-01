// ============================================
// Coffee Water Chemistry Calculator
// ============================================

// --- State ---
let currentProfile = loadTargetPresetName();
let activeBrewMethod = loadBrewMethod();

// --- DOM elements ---
const volumeInput = document.getElementById("volume");
const volumeUnit = document.getElementById("volume-unit");
const targetCa = document.getElementById("target-calcium");
const targetMg = document.getElementById("target-magnesium");
const targetAlk = document.getElementById("target-alkalinity");
const profileDesc = document.getElementById("profile-description");
const resultsContainer = document.getElementById("results-container");
const profileButtonsContainer = document.getElementById("profile-buttons");
const brewMethodToggle = document.getElementById("brew-method-toggle");
const targetSaveBar = document.getElementById("target-save-bar");
const targetEditBar = document.getElementById("target-edit-bar");
const targetEditModeBtn = document.getElementById("target-edit-mode-btn");
const targetReadonlyTags = document.getElementById("target-readonly-tags");
const targetProfileNameInput = document.getElementById("target-profile-name");
const targetSaveBtn = document.getElementById("target-save-btn");
const targetSaveChangesBtn = document.getElementById("target-save-changes-btn");
const targetSaveStatus = document.getElementById("target-save-status");

let lastCalculatedIons = null;
let isTargetEditMode = false;

// --- Debounced calculate (Inefficiency 6) ---
const debouncedCalculate = debounce(calculate, 120);

const savedVolume = loadVolumePreference("calculator", { value: volumeInput.value, unit: volumeUnit.value });
volumeInput.value = savedVolume.value;
volumeUnit.value = savedVolume.unit;

// --- Source water section (shared module) ---
function updateSourceHintLabel(presetName) {
  const resultsHint = document.getElementById("results-hint");
  if (resultsHint) {
    const preset = getAllPresets()[presetName];
    const name = preset ? preset.label : "your water";
    resultsHint.textContent = "Using " + name + " as your base, add these mineral salts:";
  }
}

const sourceSection = initSourceWaterSection({
  onChanged: calculate,
  onActivated: updateSourceHintLabel
});

// --- Result items: show only minerals selected in Settings ---

function renderResultItems() {
  const alkalinitySources = getEffectiveAlkalinitySources();
  if (alkalinitySources.length === 0) {
    resultsContainer.innerHTML = '<p class="hint error">You need to select an alkalinity source in <a href="minerals.html">Settings</a></p>';
    lastCalculatedIons = null;
    updateSummaryMetrics({});
    return;
  }

  const selectedMinerals = loadSelectedMinerals();
  const selectedConcentrates = loadSelectedConcentrates().filter((id) => typeof id === "string" && id.startsWith("diy:"));
  const mgSourceIds = getEffectiveMagnesiumSources();
  const caSourceIds = getEffectiveCalciumSources();

  const bufferIds = alkalinitySources;
  const candidates = [
    ...mgSourceIds.map((id, i) => ({ mineralId: id, order: 0 + i * 0.1 })),
    ...bufferIds.map((id, i) => ({ mineralId: id, order: 1 + i * 0.1 })),
    ...caSourceIds.map((id, i) => ({ mineralId: id, order: 2 + i * 0.1 }))
  ].filter((x) => x && x.mineralId);

  const toShow = [];
  for (const c of candidates) {
    const mineralId = c.mineralId;
    const diyId = "diy:" + mineralId;
    const showMineral = selectedMinerals.includes(mineralId);
    const showConcentrate = selectedConcentrates.includes(diyId);
    if (showMineral) toShow.push({ kind: "mineral", id: mineralId, order: c.order });
    if (showConcentrate) toShow.push({ kind: "concentrate", id: diyId, mineralId, order: c.order + 0.05 });
  }
  toShow.sort((a, b) => a.order - b.order);

  resultsContainer.innerHTML = "";
  if (toShow.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    if (selectedMinerals.length === 0 && selectedConcentrates.length === 0) {
      p.textContent = "No minerals or concentrates selected. Go to ";
      const a = document.createElement("a");
      a.href = "minerals.html";
      a.textContent = "Settings";
      p.appendChild(a);
      p.appendChild(document.createTextNode(" to pick some."));
    } else {
      p.textContent = "Select minerals or concentrates in ";
      const a = document.createElement("a");
      a.href = "minerals.html";
      a.textContent = "Settings";
      p.appendChild(a);
      p.appendChild(document.createTextNode(" to see what to add."));
    }
    resultsContainer.appendChild(p);
    lastCalculatedIons = null;
    updateSummaryMetrics({});
    return;
  }
  for (const item of toShow) {
    const mineralId = item.kind === "concentrate" ? item.mineralId : item.id;
    const mineral = MINERAL_DB[mineralId];
    if (!mineral) continue;
    const div = document.createElement("div");
    div.className = "result-item";
    if (item.kind === "concentrate") {
      div.dataset.concentrate = item.id;
    } else {
      div.dataset.mineral = item.id;
    }
    const resultInfo = document.createElement("div");
    resultInfo.className = "result-info";
    const nameSpan = document.createElement("span");
    nameSpan.className = "result-name";
    nameSpan.textContent = mineral.name;
    const detailSpan = document.createElement("span");
    detailSpan.className = "result-detail";
    if (item.kind === "concentrate") {
      detailSpan.textContent = mineral.formula + " ";
      const badge = document.createElement("span");
      badge.className = "badge badge-concentrate";
      badge.textContent = "CONCENTRATE";
      detailSpan.appendChild(badge);
    } else {
      detailSpan.textContent = mineral.formula;
    }
    resultInfo.appendChild(nameSpan);
    resultInfo.appendChild(detailSpan);
    const valueSpan = document.createElement("span");
    valueSpan.className = "result-value";
    valueSpan.textContent = item.kind === "concentrate" ? "0.000 mL" : "0.00 g";
    div.appendChild(resultInfo);
    div.appendChild(valueSpan);
    resultsContainer.appendChild(div);
  }
}

// --- Dynamic profile buttons (Inefficiency 1: cleaned up redundant if/else) ---
function renderProfileButtons() {
  profileButtonsContainer.innerHTML = "";
  const allProfiles = getTargetPresetsForBrewMethod(activeBrewMethod);
  for (const [key, profile] of Object.entries(allProfiles)) {
    const btn = document.createElement("button");
    btn.className = "profile-btn";
    btn.dataset.profile = key;
    btn.textContent = profile.label;
    if (isTargetEditMode && key !== "custom") {
      const del = document.createElement("span");
      del.className = "preset-delete";
      del.dataset.delete = key;
      del.textContent = "\u00d7";
      btn.appendChild(del);
    }
    profileButtonsContainer.appendChild(btn);
  }
  highlightProfile(currentProfile);
}

function renderTargetReadonlyTags() {
  if (!targetReadonlyTags) return;
  targetReadonlyTags.innerHTML = "";
  const ca = parseFloat(targetCa.value) || 0;
  const mg = parseFloat(targetMg.value) || 0;
  const alk = parseFloat(targetAlk.value) || 0;
  const tags = [
    ["Ca", Math.round(ca), "mg/L"],
    ["Mg", Math.round(mg), "mg/L"],
    ["Alkalinity", Math.round(alk), "mg/L as CaCO3"]
  ];
  tags.forEach(function(t) {
    const span = document.createElement("span");
    span.className = "base-tag";
    span.textContent = t[0] + ": " + t[1] + " " + t[2];
    targetReadonlyTags.appendChild(span);
  });
}

function updateTargetModeUI() {
  const targetInputs = document.querySelector(".target-inputs");
  const customSelected = currentProfile === "custom";
  const showInputs = isTargetEditMode || customSelected;
  if (targetInputs) targetInputs.style.display = showInputs ? "" : "none";
  if (targetReadonlyTags) {
    targetReadonlyTags.style.display = showInputs ? "none" : "";
  }
  if (!showInputs) {
    targetEditBar.style.display = "none";
  }
  if (targetEditModeBtn) {
    targetEditModeBtn.textContent = isTargetEditMode ? "Done Editing" : "Edit Profiles";
    targetEditModeBtn.setAttribute("aria-pressed", isTargetEditMode ? "true" : "false");
  }
  renderTargetReadonlyTags();
}

// --- Restore defaults for target presets (uses shared updateRestoreTargetBar) ---
document.getElementById("restore-target-defaults").addEventListener("click", (e) => {
  e.preventDefault();
  restoreTargetPresetDefaults();
  renderProfileButtons();
  updateRestoreTargetBar();
});

function highlightProfile(profileName) {
  profileButtonsContainer.querySelectorAll(".profile-btn").forEach(b => b.classList.remove("active"));
  const btn = profileButtonsContainer.querySelector(`[data-profile="${CSS.escape(profileName)}"]`);
  if (btn) btn.classList.add("active");
  targetSaveBar.style.display = profileName === "custom" ? "flex" : "none";
  targetEditBar.style.display = "none";
  updateTargetModeUI();
}

function activateProfile(profileName) {
  const visibleProfiles = getTargetPresetsForBrewMethod(activeBrewMethod);
  if (!visibleProfiles[profileName]) {
    profileName = findFallbackPreset(visibleProfiles);
  }
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
    if (!isTargetEditMode) return;
    e.stopPropagation();
    showConfirm("Are you sure you want to delete this profile?", () => {
      if (TARGET_PRESETS[deleteKey]) {
        addDeletedTargetPreset(deleteKey);
      }
      deleteCustomTargetProfile(deleteKey);
      renderProfileButtons();
      updateRestoreTargetBar();
      if (currentProfile === deleteKey) {
        const fallback = findFallbackPreset(getTargetPresetsForBrewMethod(activeBrewMethod));
        activateProfile(fallback);
      }
    });
    return;
  }

  const btn = e.target.closest(".profile-btn");
  if (!btn) return;
  activateProfile(btn.dataset.profile);
});

// --- Target input handling (Inefficiency 6: debounced) ---
[targetCa, targetMg, targetAlk].forEach(input => {
  input.addEventListener("input", () => {
    renderTargetReadonlyTags();
    if (currentProfile !== "custom") {
      if (NON_EDITABLE_TARGET_KEYS.includes(currentProfile)) {
        currentProfile = "custom";
        highlightProfile("custom");
        saveTargetPresetName("custom");
        profileDesc.textContent = "Enter your own target values above.";
      } else {
        const showEdit = hasUnsavedTargetChanges();
        targetEditBar.style.display = showEdit ? "flex" : "none";
        if (showEdit) {
          const profile = getTargetProfileByKey(currentProfile);
          document.getElementById("target-edit-bar-label").textContent =
            "Editing: " + (profile && profile.label ? profile.label : currentProfile);
        }
      }
    }
    debouncedCalculate();
  });
});

if (targetEditModeBtn) {
  targetEditModeBtn.addEventListener("click", () => {
    isTargetEditMode = !isTargetEditMode;
    renderProfileButtons();
    updateTargetModeUI();
  });
}

// --- Save changes to existing target profile (Bug 1: alkalinity drift fix) ---
targetSaveChangesBtn.addEventListener("click", () => {
  showConfirm("Are you sure you want to change this profile?", () => {
    calculate();
    const allProfiles = getTargetPresetsForBrewMethod(activeBrewMethod);
    const existing = allProfiles[currentProfile];
    if (!existing) return;
    const orig = getTargetProfileByKey(currentProfile);
    const hasExplicitIons = orig && ION_FIELDS.every(ion => Number.isFinite(Number(orig[ion])));
    let profile;
    if (hasExplicitIons) {
      const ions = lastCalculatedIons || {};
      profile = buildStoredTargetProfile(existing.label, ions, existing.description || "", {
        alkalinity: parseFloat(targetAlk.value) || 0,
        brewMethod: activeBrewMethod
      });
    } else {
      profile = {
        label: existing.label,
        calcium: parseFloat(targetCa.value) || 0,
        magnesium: parseFloat(targetMg.value) || 0,
        alkalinity: parseFloat(targetAlk.value) || 0,
        description: existing.description || "",
        brewMethod: activeBrewMethod
      };
    }
    const profiles = loadCustomTargetProfiles();
    profiles[currentProfile] = profile;
    if (!saveCustomTargetProfiles(profiles)) {
      showTargetSaveStatus("Storage full — could not save.", true);
      return;
    }
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

// --- Save new custom target profile (Bug 1: alkalinity drift fix) ---
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
  calculate();

  const profiles = loadCustomTargetProfiles();
  const ions = lastCalculatedIons || {};
  profiles[key] = buildStoredTargetProfile(name, ions, "", {
    alkalinity: parseFloat(targetAlk.value) || 0,
    brewMethod: activeBrewMethod
  });
  if (!saveCustomTargetProfiles(profiles)) {
    showTargetSaveStatus("Storage full — could not save.", true);
    return;
  }

  renderProfileButtons();
  activateProfile(key);
  targetProfileNameInput.value = "";
  updateTargetProfileNameError();
  showTargetSaveStatus("Saved!", false);
});

const showTargetSaveStatus = createStatusHandler(targetSaveStatus);

// --- Recalculate on any input change (Inefficiency 6: debounced volume input) ---
function onVolumeChanged() {
  saveVolumePreference("calculator", volumeInput.value, volumeUnit.value);
  debouncedCalculate();
}
volumeInput.addEventListener("input", onVolumeChanged);
volumeUnit.addEventListener("change", () => {
  saveVolumePreference("calculator", volumeInput.value, volumeUnit.value);
  calculate();
});

// --- Split alkalinity delta between baking soda and potassium bicarbonate when both are enabled ---
function splitAlkalinityDelta(alkalinitySources, deltaAlkAsCaCO3, sourceWater, targetProfile) {
  const result = {};
  if (alkalinitySources.length === 0) return result;
  if (alkalinitySources.length === 1) {
    result[alkalinitySources[0]] = deltaAlkAsCaCO3;
    return result;
  }
  // Both baking-soda and potassium-bicarbonate enabled: split by target sodium vs potassium if present
  const targetNa = targetProfile && Number.isFinite(Number(targetProfile.sodium)) ? Number(targetProfile.sodium) : null;
  const targetK = targetProfile && Number.isFinite(Number(targetProfile.potassium)) ? Number(targetProfile.potassium) : null;
  const sourceNa = sourceWater && Number.isFinite(Number(sourceWater.sodium)) ? Number(sourceWater.sodium) : 0;
  const sourceK = sourceWater && Number.isFinite(Number(sourceWater.potassium)) ? Number(sourceWater.potassium) : 0;
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
    const alkSources = getEffectiveAlkalinitySources();
    const mgSourceIds = getEffectiveMagnesiumSources();
    const caSourceIds = getEffectiveCalciumSources();
    if (warningsEl) warningsEl.textContent = "";
    lastCalculatedIons = null;
    const zeroValues = {};
    alkSources.forEach(id => { zeroValues[id] = 0; });
    mgSourceIds.forEach(id => { zeroValues[id] = 0; });
    caSourceIds.forEach(id => { zeroValues[id] = 0; });
    updateResultValues(zeroValues);
    updateSummaryMetrics({});
    return;
  }

  const alkalinitySources = getEffectiveAlkalinitySources();
  if (alkalinitySources.length === 0) {
    if (warningsEl) warningsEl.textContent = "";
    lastCalculatedIons = null;
    updateSummaryMetrics({});
    return;
  }

  // Read source water from shared module
  const sourceWater = sourceSection.getSourceWater();

  // Convert source bicarbonate to alkalinity as CaCO3
  const sourceAlkAsCaCO3 = (sourceWater.bicarbonate || 0) * HCO3_TO_CACO3;

  // Targets (UI)
  const targetCaMgL = readNonNegative(targetCa);
  const targetMgMgL = readNonNegative(targetMg);
  const targetAlkAsCaCO3 = readNonNegative(targetAlk);

  // Mineral deltas (target - source), floored at 0
  const rawDeltaCa = targetCaMgL - (sourceWater.calcium || 0);
  const rawDeltaMg = targetMgMgL - (sourceWater.magnesium || 0);
  const rawDeltaAlk = targetAlkAsCaCO3 - sourceAlkAsCaCO3;
  const deltaCa = Math.max(0, rawDeltaCa);
  const deltaMg = Math.max(0, rawDeltaMg);
  const deltaAlkAsCaCO3 = Math.max(0, rawDeltaAlk);

  const targetProfile = getTargetProfileByKey(currentProfile);
  const { caSource, mgSource } = pickBestCaMgSources(sourceWater, targetProfile, deltaCa, deltaMg);

  // Warn when source exceeds target or when we need a source but none is enabled
  const hasMgSource = getEffectiveMagnesiumSources().length > 0;
  const hasCaSource = getEffectiveCalciumSources().length > 0;
  const warnings = [];
  const selectedMinerals = loadSelectedMinerals();
  const selectedConcentrates = loadSelectedConcentrates().filter((id) => typeof id === "string" && id.startsWith("diy:"));
  const conflictMineralIds = new Set();
  selectedConcentrates.forEach((cid) => {
    const mineralId = parseDiyConcentrateId(cid);
    if (!mineralId) return;
    if (selectedMinerals.includes(mineralId)) conflictMineralIds.add(mineralId);
  });
  if (conflictMineralIds.size > 0) {
    warnings.push("You’ve selected both the normal and concentrate version of a mineral. We will default to using the concentrate.");
  }
  if (rawDeltaCa < 0) warnings.push(`Your source water already exceeds the target for Calcium (${(sourceWater.calcium || 0)} vs ${targetCaMgL} mg/L).`);
  if (rawDeltaMg < 0) warnings.push(`Your source water already exceeds the target for Magnesium (${(sourceWater.magnesium || 0)} vs ${targetMgMgL} mg/L).`);
  if (rawDeltaAlk < 0) warnings.push(`Your source water already exceeds the target for Alkalinity (${Math.round(sourceAlkAsCaCO3)} vs ${targetAlkAsCaCO3} mg/L as CaCO\u2083).`);
  if (!hasMgSource && deltaMg > 0) warnings.push("You need an enabled magnesium source (Epsom Salt or Magnesium Chloride).");
  if (!hasCaSource && deltaCa > 0) warnings.push("You need an enabled calcium source (Calcium Chloride or Gypsum).");

  // Compute salt dosing (per L) using auto-selected sources
  const mgFraction = mgSource ? (MINERAL_DB[mgSource]?.ions?.magnesium || 0) : 0;
  const caFraction = caSource ? (MINERAL_DB[caSource]?.ions?.calcium || 0) : 0;
  const mgSaltPerL = mgFraction > 0 ? (deltaMg / mgFraction) / 1000 : 0;
  const caSaltPerL = caFraction > 0 ? (deltaCa / caFraction) / 1000 : 0;

  // Alkalinity: one source or split between baking soda and potassium bicarbonate
  const alkAllocation = splitAlkalinityDelta(alkalinitySources, deltaAlkAsCaCO3, sourceWater, targetProfile);
  const bufferGramsPerL = {};
  if (alkAllocation["baking-soda"] != null && alkAllocation["baking-soda"] > 0) {
    bufferGramsPerL["baking-soda"] = (alkAllocation["baking-soda"] * ALK_TO_BAKING_SODA) / 1000;
  }
  if (alkAllocation["potassium-bicarbonate"] != null && alkAllocation["potassium-bicarbonate"] > 0) {
    bufferGramsPerL["potassium-bicarbonate"] = (alkAllocation["potassium-bicarbonate"] * ALK_TO_POTASSIUM_BICARB) / 1000;
  }

  // Total grams for the full volume; show 0 for unchosen Ca/Mg sources so UI indicates which were chosen
  const mgSaltTotal = mgSaltPerL * volumeL;
  const caSaltTotal = caSaltPerL * volumeL;
  const bufferTotals = {};
  for (const [id, gPerL] of Object.entries(bufferGramsPerL)) {
    bufferTotals[id] = gPerL * volumeL;
  }
  const resultValues = { ...bufferTotals };
  if (mgSource) resultValues[mgSource] = mgSaltTotal;
  if (caSource) resultValues[caSource] = caSaltTotal;
  const mgSourceIds = getEffectiveMagnesiumSources();
  const caSourceIds = getEffectiveCalciumSources();
  mgSourceIds.forEach((id) => { if (resultValues[id] == null) resultValues[id] = 0; });
  caSourceIds.forEach((id) => { if (resultValues[id] == null) resultValues[id] = 0; });

  const displayMineralGrams = { ...resultValues };
  conflictMineralIds.forEach((mineralId) => { displayMineralGrams[mineralId] = 0; });
  updateResultValues(displayMineralGrams);

  const concentrateValues = {};
  selectedConcentrates.forEach((cid) => {
    const mineralId = parseDiyConcentrateId(cid);
    if (!mineralId) return;
    const grams = resultValues[mineralId] != null ? Number(resultValues[mineralId]) : 0;
    const gramsPerMl = getDiyConcentrateGramsPerMl(mineralId);
    if (!Number.isFinite(gramsPerMl) || gramsPerMl <= 0) {
      concentrateValues[cid] = 0;
      if (grams > 0) warnings.push("Set bottle mL and grams per bottle in Settings to use this concentrate.");
      return;
    }
    concentrateValues[cid] = Math.max(0, grams / gramsPerMl);
  });
  updateConcentrateValues(concentrateValues);
  if (warningsEl) warningsEl.textContent = warnings.join("\n");

  // Compute resulting ions (mg/L)
  const mineralGramsPerL = {};
  if (mgSource && mgSaltPerL > 0) mineralGramsPerL[mgSource] = mgSaltPerL;
  if (caSource && caSaltPerL > 0) mineralGramsPerL[caSource] = caSaltPerL;
  for (const [id, gPerL] of Object.entries(bufferGramsPerL)) {
    if (gPerL > 0) mineralGramsPerL[id] = gPerL;
  }
  const addedIons = calculateIonPPMs(mineralGramsPerL);
  const finalIons = {};
  ION_FIELDS.forEach((ion) => {
    finalIons[ion] = (sourceWater[ion] || 0) + (addedIons[ion] || 0);
  });
  lastCalculatedIons = finalIons;
  const finalSO4 = finalIons.sulfate || 0;
  const finalCl = finalIons.chloride || 0;

  // GH / KH / TDS
  const metrics = calculateMetrics(finalIons);
  const GH_asCaCO3 = metrics.gh;
  const KH_asCaCO3 = metrics.kh;
  const TDS_ion_sum = metrics.tds;
  const advancedMode = isAdvancedMineralDisplayMode();
  const baselineMetrics = calculateMetrics(sourceWater || {});

  // Sulfate:Chloride ratio
  const so4ToCl = finalCl > 0 ? finalSO4 / finalCl : null;
  const baselineRatio = calculateSo4ClRatio(sourceWater || {});

  const alkalinitySourcesForRange = getEffectiveAlkalinitySources();
  updateSummaryMetrics({
    gh: GH_asCaCO3,
    kh: KH_asCaCO3,
    tds: TDS_ion_sum,
    ions: finalIons,
    baselineIons: sourceWater || {},
    baselineMetrics,
    so4ToCl,
    baselineRatio,
    advancedMode,
    alkalinitySources: alkalinitySourcesForRange,
    calciumSource: caSource,
    magnesiumSource: mgSource
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
    advancedMode ? (so4ToCl == null ? "\u2014" : so4ToCl.toFixed(2)) : "\u2014";
  setDeltaText(document.getElementById("calc-delta-so4cl"), (so4ToCl == null || baselineRatio == null) ? null : (so4ToCl - baselineRatio), {
    decimals: 2,
    metricName: "SO4:Cl ratio",
    baselineLabel: "source water"
  });

  const rangeWarningsEl = document.getElementById("calc-range-warnings");
  if (rangeWarningsEl) {
    const alkalinitySources = payload.alkalinitySources;
    const calciumSource = payload.calciumSource;
    const magnesiumSource = payload.magnesiumSource;
    const hasAlkalinitySource = alkalinitySources && alkalinitySources.length > 0;
    if (!Number.isFinite(gh) || !Number.isFinite(kh) || !Number.isFinite(tds)) {
      renderRangeGuidance(rangeWarningsEl, []);
    } else if (hasAlkalinitySource && calciumSource != null && magnesiumSource != null) {
      const evaluation = evaluateWaterProfileRanges(ions, {
        includeAdvanced: advancedMode,
        alkalinitySources,
        calciumSource,
        magnesiumSource
      });
      renderRangeGuidance(rangeWarningsEl, evaluation.findings);
    } else {
      renderRangeGuidance(rangeWarningsEl, []);
    }
  }
}

function setActiveBrewMethod(method) {
  activeBrewMethod = method === "espresso" ? "espresso" : "filter";
  saveBrewMethod(activeBrewMethod);
  if (brewMethodToggle) {
    brewMethodToggle.querySelectorAll(".brew-method-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.brewMethod === activeBrewMethod);
    });
  }
  renderProfileButtons();
  const visible = getTargetPresetsForBrewMethod(activeBrewMethod);
  if (!visible[currentProfile]) {
    currentProfile = findFallbackPreset(visible);
    saveTargetPresetName(currentProfile);
  }
  activateProfile(currentProfile);
}

// --- Bug 3: Fixed formatGrams to handle sub-threshold display ---
function formatGrams(g) {
  if (!isFinite(g) || g <= 0) return "0.00 g";
  if (g < 0.01) return "<0.01 g";
  return g.toFixed(2) + " g";
}

function formatMl(ml) {
  if (!isFinite(ml) || ml <= 0) return "0.000 mL";
  return ml.toFixed(3) + " mL";
}

function updateResultValues(valuesByMineral) {
  for (const [mineralId, grams] of Object.entries(valuesByMineral)) {
    const item = resultsContainer.querySelector(`[data-mineral="${CSS.escape(mineralId)}"]`);
    if (item) {
      const valEl = item.querySelector(".result-value");
      if (valEl) valEl.textContent = formatGrams(grams);
      const nameEl = item.querySelector(".result-name");
      const name = nameEl ? nameEl.textContent : MINERAL_DB[mineralId]?.name || mineralId;
      if (grams > 0) {
        item.setAttribute("aria-label", name + ", " + formatGrams(grams) + ", auto-selected for this recipe");
      } else {
        item.removeAttribute("aria-label");
      }
    }
  }
}

function updateConcentrateValues(valuesByConcentrate) {
  for (const [concentrateId, ml] of Object.entries(valuesByConcentrate)) {
    const item = resultsContainer.querySelector(`[data-concentrate="${CSS.escape(concentrateId)}"]`);
    if (!item) continue;
    const valEl = item.querySelector(".result-value");
    if (valEl) valEl.textContent = formatMl(ml);
    if (ml > 0) {
      const nameEl = item.querySelector(".result-name");
      const name = nameEl ? nameEl.textContent : concentrateId;
      item.setAttribute("aria-label", name + ", " + formatMl(ml));
    } else {
      item.removeAttribute("aria-label");
    }
  }
}

// --- Initialize ---
if (brewMethodToggle) {
  brewMethodToggle.addEventListener("click", (e) => {
    const btn = e.target.closest(".brew-method-btn");
    if (!btn) return;
    if (btn.dataset.brewMethod === activeBrewMethod) return;
    setActiveBrewMethod(btn.dataset.brewMethod);
  });
  brewMethodToggle.querySelectorAll(".brew-method-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.brewMethod === activeBrewMethod);
  });
}
renderResultItems();
renderProfileButtons();
updateTargetModeUI();
updateRestoreTargetBar();
const allTargetPresets = getTargetPresetsForBrewMethod(activeBrewMethod);
if (!allTargetPresets[currentProfile]) {
  currentProfile = findFallbackPreset(allTargetPresets);
  saveTargetPresetName(currentProfile);
}
activateProfile(currentProfile);

// --- Welcome modal (one-time, Calculator page only) ---
(function initWelcomeModal() {
  const overlay = document.getElementById("welcome-modal-overlay");
  const closeBtn = document.getElementById("welcome-modal-close");
  const okBtn = document.getElementById("welcome-modal-ok");
  if (!overlay || !closeBtn || !okBtn) return;

  let keyHandler = null;

  function getFocusReturnTarget() {
    const main = document.querySelector("main");
    if (!main) return null;
    const focusable = main.querySelector("button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])");
    return focusable || null;
  }

  function closeWelcomeModal() {
    overlay.style.display = "none";
    document.body.classList.remove("welcome-modal-open");
    saveCalculatorWelcomeDismissed();
    if (keyHandler) {
      document.removeEventListener("keydown", keyHandler);
      keyHandler = null;
    }
    closeBtn.removeEventListener("click", closeWelcomeModal);
    okBtn.removeEventListener("click", closeWelcomeModal);
    const returnTarget = getFocusReturnTarget();
    if (returnTarget && returnTarget.focus) {
      returnTarget.focus();
    }
  }

  function showWelcomeModal() {
    if (loadCalculatorWelcomeDismissed()) return;
    overlay.style.display = "flex";
    document.body.classList.add("welcome-modal-open");
    closeBtn.focus();

    keyHandler = function(e) {
      if (e.key === "Escape") {
        closeWelcomeModal();
        return;
      }
      if (e.key === "Tab") {
        const focusable = [closeBtn, okBtn];
        const idx = focusable.indexOf(document.activeElement);
        if (idx === -1) return;
        e.preventDefault();
        if (e.shiftKey) {
          focusable[(idx <= 0 ? focusable.length : idx) - 1].focus();
        } else {
          focusable[(idx + 1) % focusable.length].focus();
        }
      }
    };

    document.addEventListener("keydown", keyHandler);
    closeBtn.addEventListener("click", closeWelcomeModal);
    okBtn.addEventListener("click", closeWelcomeModal);
  }

  showWelcomeModal();
})();

// --- Refresh on bfcache restore ---
window.addEventListener("pageshow", (e) => {
  if (e.persisted) location.reload();
});
