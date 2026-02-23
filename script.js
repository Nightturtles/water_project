// ============================================
// Coffee Water Chemistry Calculator
// ============================================

// --- State ---
let currentProfile = loadTargetPresetName();
let activeBrewMethod = loadBrewMethod();

// --- DOM elements ---
const volumeInput = document.getElementById("volume");
const volumeUnit = document.getElementById("volume-unit");
const sourcePresetsContainer = document.getElementById("source-presets");
const sourceEditModeBtn = document.getElementById("source-edit-mode-btn");
const sourceReadonlyTags = document.getElementById("source-readonly-tags");
const sourceInputGrid = document.getElementById("source-input-grid");
const sourceSaveBar = document.getElementById("source-save-bar");
const sourceEditBar = document.getElementById("source-edit-bar");
const sourceProfileNameInput = document.getElementById("source-profile-name");
const sourceSaveBtn = document.getElementById("source-save-btn");
const sourceSaveChangesBtn = document.getElementById("source-save-changes-btn");
const sourceSaveStatus = document.getElementById("source-save-status");
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
let activeSourcePreset = loadSourcePresetName();
let isSourceEditMode = false;

// --- Debounced calculate (Inefficiency 6) ---
var debouncedCalculate = debounce(calculate, 120);

const sourceAlkalinityInput = document.getElementById("src-alkalinity");
const sourceBicarbonateInput = document.getElementById("src-bicarbonate");

const savedVolume = loadVolumePreference("calculator", { value: volumeInput.value, unit: volumeUnit.value });
volumeInput.value = savedVolume.value;
volumeUnit.value = savedVolume.unit;

function getSourceWater() {
  const water = {};
  ION_FIELDS.forEach((ion) => {
    water[ion] = parseFloat(document.getElementById("src-" + ion).value) || 0;
  });
  return water;
}

function updateSourceHintLabel() {
  const resultsHint = document.getElementById("results-hint");
  if (resultsHint) {
    const preset = getAllPresets()[activeSourcePreset];
    const name = preset ? preset.label : "your water";
    resultsHint.textContent = `Using ${name} as your base, add these mineral salts:`;
  }
}

function updateSourceAlkalinityFromBicarbonate() {
  const bicarb = parseFloat(sourceBicarbonateInput.value) || 0;
  sourceAlkalinityInput.value = Math.round(bicarb * HCO3_TO_CACO3);
}

sourceAlkalinityInput.addEventListener("input", () => {
  const alkAsCaCO3 = parseFloat(sourceAlkalinityInput.value) || 0;
  sourceBicarbonateInput.value = toStableBicarbonateFromAlkalinity(alkAsCaCO3, sourceBicarbonateInput.value);
  sourceBicarbonateInput.dispatchEvent(new Event("input", { bubbles: true }));
});

function saveCurrentSourceWaterInputs() {
  saveSourceWater(getSourceWater());
}

function renderSourceReadonlyTags() {
  if (!sourceReadonlyTags) return;
  renderSourceWaterTags(sourceReadonlyTags, getSourceWater());
}

function updateSourceModeUI() {
  const customSelected = activeSourcePreset === "custom";
  const showInputs = isSourceEditMode || customSelected;
  if (sourceInputGrid) sourceInputGrid.style.display = showInputs ? "" : "none";
  if (sourceReadonlyTags) sourceReadonlyTags.style.display = showInputs ? "none" : "";
  if (sourceSaveBar) sourceSaveBar.style.display = customSelected ? "flex" : "none";
  if (!isSourceEditMode && sourceEditBar) sourceEditBar.style.display = "none";
  if (sourceEditModeBtn) {
    sourceEditModeBtn.textContent = isSourceEditMode ? "Done Editing" : "Edit Starting Water";
    sourceEditModeBtn.setAttribute("aria-pressed", isSourceEditMode ? "true" : "false");
  }
  renderSourceReadonlyTags();
}

function highlightSourcePreset(presetName) {
  sourcePresetsContainer.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
  const btn = sourcePresetsContainer.querySelector(`[data-preset="${presetName}"]`);
  if (btn) btn.classList.add("active");
  if (sourceSaveBar) sourceSaveBar.style.display = presetName === "custom" ? "flex" : "none";
  if (sourceEditBar) sourceEditBar.style.display = "none";
  updateSourceModeUI();
}

function activateSourcePreset(presetName) {
  const allPresets = getAllPresets();
  if (!allPresets[presetName]) {
    presetName = Object.keys(allPresets).find((k) => k !== "custom") || "custom";
  }
  activeSourcePreset = presetName;
  highlightSourcePreset(presetName);
  saveSourcePresetName(presetName);
  if (presetName === "custom") {
    updateSourceHintLabel();
    return;
  }
  const values = getSourceWaterByPreset(presetName);
  ION_FIELDS.forEach((ion) => {
    document.getElementById("src-" + ion).value = values[ion] || 0;
  });
  saveCurrentSourceWaterInputs();
  updateSourceAlkalinityFromBicarbonate();
  renderSourceReadonlyTags();
  updateSourceHintLabel();
}

function hasUnsavedSourceChanges() {
  if (activeSourcePreset === "custom") return false;
  const presetValues = getSourceWaterByPreset(activeSourcePreset);
  return ION_FIELDS.some((ion) => {
    const current = parseFloat(document.getElementById("src-" + ion).value) || 0;
    return current !== (presetValues[ion] || 0);
  });
}

function renderSourcePresetButtons() {
  sourcePresetsContainer.innerHTML = "";
  const allPresets = getAllPresets();
  for (const [key, preset] of Object.entries(allPresets)) {
    const btn = document.createElement("button");
    btn.className = "preset-btn";
    btn.dataset.preset = key;
    btn.textContent = preset.label;
    if (isSourceEditMode && key !== "custom") {
      const del = document.createElement("span");
      del.className = "preset-delete";
      del.dataset.delete = key;
      del.innerHTML = "&times;";
      btn.appendChild(del);
    }
    sourcePresetsContainer.appendChild(btn);
  }
  highlightSourcePreset(activeSourcePreset);
}

const showSourceSaveStatus = createStatusHandler(sourceSaveStatus);

if (sourceEditModeBtn) {
  sourceEditModeBtn.addEventListener("click", () => {
    isSourceEditMode = !isSourceEditMode;
    renderSourcePresetButtons();
    updateSourceModeUI();
  });
}

document.getElementById("restore-source-defaults").addEventListener("click", (e) => {
  e.preventDefault();
  restoreSourcePresetDefaults();
  renderSourcePresetButtons();
  updateRestoreSourceBar();
});

sourcePresetsContainer.addEventListener("click", (e) => {
  const deleteKey = e.target.dataset.delete;
  if (deleteKey) {
    if (!isSourceEditMode) return;
    e.stopPropagation();
    showConfirm("Are you sure you want to delete this profile?", () => {
      if (SOURCE_PRESETS[deleteKey]) {
        addDeletedPreset(deleteKey);
      }
      deleteCustomProfile(deleteKey);
      renderSourcePresetButtons();
      updateRestoreSourceBar();
      if (activeSourcePreset === deleteKey) {
        const fallback = Object.keys(getAllPresets()).find((k) => k !== "custom") || "custom";
        activateSourcePreset(fallback);
      }
      showSourceSaveStatus("Profile deleted.", false);
    });
    return;
  }
  const btn = e.target.closest(".preset-btn");
  if (!btn) return;
  activateSourcePreset(btn.dataset.preset);
  calculate();
});

ION_FIELDS.forEach((ion) => {
  const input = document.getElementById("src-" + ion);
  input.addEventListener("input", () => {
    if (activeSourcePreset !== "custom") {
      const showEdit = isSourceEditMode && hasUnsavedSourceChanges();
      sourceEditBar.style.display = showEdit ? "flex" : "none";
      if (showEdit) {
        const preset = getAllPresets()[activeSourcePreset];
        document.getElementById("source-edit-bar-label").textContent =
          "Editing: " + (preset && preset.label ? preset.label : activeSourcePreset);
      }
    }
    saveCurrentSourceWaterInputs();
    updateSourceAlkalinityFromBicarbonate();
    renderSourceReadonlyTags();
    calculate();
  });
});

function updateSourceProfileNameError() {
  const errEl = document.getElementById("source-profile-name-error");
  const validation = validateProfileName(sourceProfileNameInput.value, {
    allowEmpty: true,
    builtinKeys: new Set(Object.keys(SOURCE_PRESETS)),
    existingKeys: new Set(Object.keys(loadCustomProfiles())),
    existingLabels: getExistingSourceProfileLabels()
  });
  if (validation.empty) {
    errEl.textContent = "";
    sourceSaveBtn.disabled = false;
    return;
  }
  if (!validation.ok) {
    errEl.textContent = validation.message;
    sourceSaveBtn.disabled = true;
    return;
  }
  errEl.textContent = "";
  sourceSaveBtn.disabled = false;
}

sourceProfileNameInput.addEventListener("input", updateSourceProfileNameError);
bindEnterToClick(sourceProfileNameInput, sourceSaveBtn);

sourceSaveBtn.addEventListener("click", () => {
  const validation = validateProfileName(sourceProfileNameInput.value, {
    builtinKeys: new Set(Object.keys(SOURCE_PRESETS)),
    existingKeys: new Set(Object.keys(loadCustomProfiles())),
    existingLabels: getExistingSourceProfileLabels()
  });
  if (!validation.ok) {
    if (validation.code === "reserved" || validation.code === "duplicate") {
      updateSourceProfileNameError();
      return;
    }
    document.getElementById("source-profile-name-error").textContent = "";
    showSourceSaveStatus(validation.message, true);
    return;
  }
  const { key, name } = validation;
  if (!key || !name) {
    updateSourceProfileNameError();
    return;
  }
  document.getElementById("source-profile-name-error").textContent = "";
  const profiles = loadCustomProfiles();
  const profile = { label: name };
  ION_FIELDS.forEach((ion) => {
    profile[ion] = parseFloat(document.getElementById("src-" + ion).value) || 0;
  });
  profiles[key] = profile;
  saveCustomProfiles(profiles);
  renderSourcePresetButtons();
  activateSourcePreset(key);
  sourceProfileNameInput.value = "";
  updateSourceProfileNameError();
  showSourceSaveStatus("Saved!", false);
});

sourceSaveChangesBtn.addEventListener("click", () => {
  showConfirm("Are you sure you want to change this profile?", () => {
    const allPresets = getAllPresets();
    const existing = allPresets[activeSourcePreset];
    if (!existing) return;
    const profile = { label: existing.label };
    ION_FIELDS.forEach((ion) => {
      profile[ion] = parseFloat(document.getElementById("src-" + ion).value) || 0;
    });
    const profiles = loadCustomProfiles();
    profiles[activeSourcePreset] = profile;
    saveCustomProfiles(profiles);
    sourceEditBar.style.display = "none";
    renderSourcePresetButtons();
    showSourceSaveStatus("Saved!", false);
  });
});

// --- Result items: show only minerals selected in Settings ---

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
      del.innerHTML = "&times;";
      btn.appendChild(del);
    }
    profileButtonsContainer.appendChild(btn);
  }
  highlightProfile(currentProfile);
}

function renderTargetReadonlyTags() {
  if (!targetReadonlyTags) return;
  const ca = parseFloat(targetCa.value) || 0;
  const mg = parseFloat(targetMg.value) || 0;
  const alk = parseFloat(targetAlk.value) || 0;
  targetReadonlyTags.innerHTML = [
    `<span class="base-tag">Ca: ${Math.round(ca)} mg/L</span>`,
    `<span class="base-tag">Mg: ${Math.round(mg)} mg/L</span>`,
    `<span class="base-tag">Alkalinity: ${Math.round(alk)} mg/L as CaCO3</span>`
  ].join("");
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
  const btn = profileButtonsContainer.querySelector(`[data-profile="${profileName}"]`);
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
  saveCustomTargetProfiles(profiles);

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

  // Convert source bicarbonate to alkalinity as CaCO3
  const sourceAlkAsCaCO3 = (sourceWater.bicarbonate || 0) * HCO3_TO_CACO3;

  // Targets (UI)
  const targetCaMgL = parseFloat(targetCa.value) || 0;
  const targetMgMgL = parseFloat(targetMg.value) || 0;
  const targetAlkAsCaCO3 = parseFloat(targetAlk.value) || 0;

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

  // Compute salt dosing (per L)
  const mgFraction = mgSource ? (MINERAL_DB[mgSource]?.ions?.magnesium || 0) : 0;
  const caFraction = caSource ? (MINERAL_DB[caSource]?.ions?.calcium || 0) : 0;
  const mgSaltPerL = mgFraction > 0 ? (deltaMg / mgFraction) / 1000 : 0;
  const caSaltPerL = caFraction > 0 ? (deltaCa / caFraction) / 1000 : 0;

  let bufferPerL;
  if (currentBuffer === "potassium-bicarbonate") {
    bufferPerL = (deltaAlkAsCaCO3 * ALK_TO_POTASSIUM_BICARB) / 1000;
  } else {
    bufferPerL = (deltaAlkAsCaCO3 * ALK_TO_BAKING_SODA) / 1000;
  }

  // Total grams for the full volume
  const mgSaltTotal = mgSaltPerL * volumeL;
  const bufferTotal = bufferPerL * volumeL;
  const caSaltTotal = caSaltPerL * volumeL;

  // Display grams (only update elements that exist for selected minerals)
  updateResultValues({
    ...(mgSource ? { [mgSource]: mgSaltTotal } : {}),
    ...(caSource ? { [caSource]: caSaltTotal } : {}),
    [currentBuffer]: bufferTotal
  });

  // Compute resulting ions (mg/L)
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
    advancedMode ? (so4ToCl == null ? "\u2014" : so4ToCl.toFixed(2)) : "\u2014";
  setDeltaText(document.getElementById("calc-delta-so4cl"), (so4ToCl == null || baselineRatio == null) ? null : (so4ToCl - baselineRatio), {
    decimals: 2,
    metricName: "SO4:Cl ratio",
    baselineLabel: "source water"
  });

  const rangeWarningsEl = document.getElementById("calc-range-warnings");
  if (rangeWarningsEl) {
    if (!Number.isFinite(gh) || !Number.isFinite(kh) || !Number.isFinite(tds)) {
      renderRangeGuidance(rangeWarningsEl, []);
    } else {
      const evaluation = evaluateWaterProfileRanges(ions, { includeAdvanced: advancedMode });
      renderRangeGuidance(rangeWarningsEl, evaluation.findings);
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
const sourceWater = loadSourceWater();
ION_FIELDS.forEach((ion) => {
  const input = document.getElementById("src-" + ion);
  if (input) input.value = sourceWater[ion] || 0;
});
updateSourceAlkalinityFromBicarbonate();
renderSourcePresetButtons();
updateSourceModeUI();
updateRestoreSourceBar();
updateSourceProfileNameError();
const allSourcePresets = getAllPresets();
if (!allSourcePresets[activeSourcePreset]) {
  activeSourcePreset = Object.keys(allSourcePresets).find((k) => k !== "custom") || "custom";
}
activateSourcePreset(activeSourcePreset);
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

// --- Refresh on bfcache restore ---
window.addEventListener("pageshow", (e) => {
  if (e.persisted) location.reload();
});
