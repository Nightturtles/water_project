// ============================================
// Coffee Water Chemistry Calculator
// ============================================

// --- Water profiles (target mineral concentrations in mg/L) ---
const PROFILES = {
  sca: {
    label: "SCA Standard",
    calcium: 51,
    magnesium: 17,
    alkalinity: 40,
    description: "SCA recommended range for brewing water. Balanced body and clarity."
  },
  rao: {
    label: "Rao Water",
    calcium: 39,
    magnesium: 16,
    alkalinity: 40,
    description: "Scott Rao's recipe. Clean, sweet, and well-balanced for most coffees."
  },
  "hendon-light": {
    label: "Light Roast",
    calcium: 25,
    magnesium: 35,
    alkalinity: 25,
    description: "Higher magnesium for light roasts. Enhances fruity and floral notes."
  },
  "hendon-espresso": {
    label: "Espresso",
    calcium: 70,
    magnesium: 20,
    alkalinity: 50,
    description: "Higher hardness for espresso. More body and texture in the cup."
  }
};

// SCA Standard and Rao Water can be deleted but not edited
const NON_EDITABLE_PROFILES = ["sca", "rao"];

// --- Buffer descriptions ---
const BUFFER_INFO = {
  "baking-soda": {
    name: "Baking Soda",
    detail: "Sodium bicarbonate (NaHCO3)"
  },
  "potassium-bicarbonate": {
    name: "Potassium Bicarbonate",
    detail: "Potassium bicarbonate (KHCO3)"
  }
};

// --- Molecular weights and conversion factors ---
// Epsom salt: MgSO4 * 7H2O, MW = 246.47, provides Mg (MW = 24.305)
// To get X mg/L of Mg, need X * (246.47 / 24.305) mg/L of Epsom salt
const MG_TO_EPSOM = 246.47 / 24.305; // ~10.14

// Baking soda: NaHCO3, MW = 84.007
// Alkalinity is measured as mg/L CaCO3 (MW = 100.09)
// 1 mole CaCO3 = 2 moles NaHCO3 (because CaCO3 has 2 equivalents)
// mg/L NaHCO3 = alkalinity_as_CaCO3 * (2 * 84.007 / 100.09)
const ALK_TO_BAKING_SODA = (2 * 84.007) / 100.09; // ~1.679

// Potassium bicarbonate: KHCO3, MW = 100.115
// mg/L KHCO3 = alkalinity_as_CaCO3 * (2 * 100.115 / 100.09)
const ALK_TO_POTASSIUM_BICARB = (2 * 100.115) / 100.09; // ~2.001

// Calcium chloride dihydrate: CaCl2 * 2H2O, MW = 147.01, provides Ca (MW = 40.078)
// To get X mg/L of Ca, need X * (147.01 / 40.078) mg/L of CaCl2·2H2O
const CA_TO_CACL2 = 147.01 / 40.078; // ~3.667

// --- Mass fraction constants for ion calculations ---
const FRAC_CA_IN_CACL2_2H2O = 40.078 / 147.01;
const FRAC_CL_IN_CACL2_2H2O = 70.906 / 147.01;
const FRAC_MG_IN_MGSO4_7H2O = 24.305 / 246.47;
const FRAC_SO4_IN_MGSO4_7H2O = 96.06 / 246.47;
const FRAC_K_IN_KHCO3 = 39.098 / 100.115;
const FRAC_HCO3_IN_KHCO3 = 61.017 / 100.115;
const FRAC_NA_IN_NAHCO3 = 22.99 / 84.007;
const FRAC_HCO3_IN_NAHCO3 = 61.017 / 84.007;

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
const resultSummary = document.getElementById("result-summary");
const resultsContainer = document.getElementById("results-container");
const profileButtonsContainer = document.getElementById("profile-buttons");
const targetSaveBar = document.getElementById("target-save-bar");
const targetEditBar = document.getElementById("target-edit-bar");
const targetProfileNameInput = document.getElementById("target-profile-name");
const targetSaveBtn = document.getElementById("target-save-btn");
const targetSaveChangesBtn = document.getElementById("target-save-changes-btn");
const targetSaveStatus = document.getElementById("target-save-status");


// --- Populate source water dropdown ---
const presetEntries = Object.entries(getAllPresets());
presetEntries.forEach(([key, preset]) => {
  const opt = document.createElement("option");
  opt.value = key;
  opt.textContent = preset.label;
  sourcePresetSelect.appendChild(opt);
});
const savedPreset = loadSourcePresetName();
const validKeys = presetEntries.map(([k]) => k);
if (!validKeys.includes(savedPreset)) {
  const fallback = validKeys.find(k => k !== "custom") || validKeys[0];
  sourcePresetSelect.value = fallback;
  saveSourcePresetName(fallback);
} else {
  sourcePresetSelect.value = savedPreset;
}

function getSourceWater() {
  return getSourceWaterByPreset(sourcePresetSelect.value);
}

function updateSourceWaterTags() {
  const water = getSourceWater();
  const nonZero = ION_FIELDS.filter(ion => water[ion] > 0);
  if (nonZero.length === 0) {
    sourceWaterTags.innerHTML = '<span class="base-tag">All zeros</span>';
  } else {
    sourceWaterTags.innerHTML = nonZero
      .map(ion => `<span class="base-tag">${ION_LABELS[ion]}: ${water[ion]} mg/L</span>`)
      .join("");
  }
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

// Returns "baking-soda" | "potassium-bicarbonate" | null. null means no alkalinity source selected in Settings.
function getAlkalinitySource() {
  const selected = loadSelectedMinerals();
  const hasBakingSoda = selected.includes("baking-soda");
  const hasPotBicarb = selected.includes("potassium-bicarbonate");
  if (!hasBakingSoda && !hasPotBicarb) return null;
  if (hasBakingSoda && !hasPotBicarb) return "baking-soda";
  if (!hasBakingSoda && hasPotBicarb) return "potassium-bicarbonate";
  // Both selected: use Settings preference
  return loadAlkalinitySource();
}

function renderResultItems() {
  const alkalinitySource = getAlkalinitySource();
  if (alkalinitySource === null) {
    resultsContainer.innerHTML = '<p class="hint error">You need to select an alkalinity source in <a href="minerals.html">Settings</a></p>';
    resultSummary.innerHTML = "";
    return;
  }

  const selected = loadSelectedMinerals();
  const bufferMineralId = alkalinitySource;

  const toShow = [
    { id: "epsom-salt", order: 0 },
    { id: bufferMineralId, order: 1 },
    { id: "calcium-chloride", order: 2 }
  ].filter(item => selected.includes(item.id))
   .sort((a, b) => a.order - b.order);

  resultsContainer.innerHTML = "";
  if (toShow.length === 0) {
    resultsContainer.innerHTML = '<p class="hint">Select minerals in <a href="minerals.html">Settings</a> to see what to add.</p>';
    return;
  }
  for (const { id } of toShow) {
    const mineral = MINERAL_DB[id];
    if (!mineral) continue;
    const isBuffer = id === "baking-soda" || id === "potassium-bicarbonate";
    const info = isBuffer ? BUFFER_INFO[id] : null;
    const name = info ? info.name : mineral.name;
    const detail = info ? info.detail : mineral.formula;
    const div = document.createElement("div");
    div.className = "result-item";
    div.dataset.mineral = id;
    div.innerHTML = `
      <div class="result-info">
        <span class="result-name">${name}</span>
        <span class="result-detail">${detail}</span>
      </div>
      <span class="result-value">0.00 g</span>
    `;
    resultsContainer.appendChild(div);
  }
}

// --- Target profile helpers ---
function getAllTargetPresets() {
  const custom = loadCustomTargetProfiles();
  const deleted = loadDeletedTargetPresets();
  const result = {};
  for (const [key, value] of Object.entries(PROFILES)) {
    if (deleted.includes(key)) continue;
    result[key] = custom[key] || value;
  }
  for (const [ck, cv] of Object.entries(custom)) {
    if (!PROFILES[ck]) {
      result[ck] = cv;
    }
  }
  result["custom"] = { label: "Custom" };
  return result;
}

function getTargetProfileByKey(key) {
  if (key === "custom") return null;
  const custom = loadCustomTargetProfiles();
  return custom[key] || PROFILES[key] || null;
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
  localStorage.removeItem("cw_deleted_target_presets");
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
      if (PROFILES[deleteKey]) {
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
      if (NON_EDITABLE_PROFILES.includes(currentProfile)) {
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
    const profile = {
      label: existing.label,
      calcium: parseFloat(targetCa.value) || 0,
      magnesium: parseFloat(targetMg.value) || 0,
      alkalinity: parseFloat(targetAlk.value) || 0,
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
  const name = targetProfileNameInput.value.trim();
  if (!name) {
    errEl.textContent = "";
    targetSaveBtn.disabled = false;
    return;
  }
  const key = slugify(name);
  if (BUILTIN_TARGET_KEYS.includes(key)) {
    errEl.textContent = "That name is reserved. Choose a different name.";
    targetSaveBtn.disabled = true;
    return;
  }
  const existingLabels = getExistingTargetProfileLabels();
  if (existingLabels.has(name.toLowerCase())) {
    errEl.textContent = "A profile with this name already exists.";
    targetSaveBtn.disabled = true;
    return;
  }
  errEl.textContent = "";
  targetSaveBtn.disabled = false;
}

targetProfileNameInput.addEventListener("input", updateTargetProfileNameError);

// --- Save new custom target profile ---
targetSaveBtn.addEventListener("click", () => {
  const name = targetProfileNameInput.value.trim();
  if (!name) {
    document.getElementById("target-profile-name-error").textContent = "";
    showTargetSaveStatus("Enter a profile name.", true);
    return;
  }

  const key = slugify(name);
  if (!key) {
    document.getElementById("target-profile-name-error").textContent = "";
    showTargetSaveStatus("Enter a valid name.", true);
    return;
  }
  if (BUILTIN_TARGET_KEYS.includes(key)) {
    updateTargetProfileNameError();
    return;
  }
  const profiles = loadCustomTargetProfiles();
  if (profiles[key]) {
    updateTargetProfileNameError();
    return;
  }
  const existingLabels = getExistingTargetProfileLabels();
  if (existingLabels.has(name.trim().toLowerCase())) {
    updateTargetProfileNameError();
    return;
  }

  document.getElementById("target-profile-name-error").textContent = "";

  profiles[key] = {
    label: name,
    calcium: parseFloat(targetCa.value) || 0,
    magnesium: parseFloat(targetMg.value) || 0,
    alkalinity: parseFloat(targetAlk.value) || 0,
    description: ""
  };
  saveCustomTargetProfiles(profiles);

  renderProfileButtons();
  activateProfile(key);
  targetProfileNameInput.value = "";
  updateTargetProfileNameError();
  showTargetSaveStatus("Saved!", false);
});


let targetSaveTimer = null;
function showTargetSaveStatus(message, isError) {
  clearTimeout(targetSaveTimer);
  targetSaveStatus.textContent = message;
  targetSaveStatus.classList.toggle("error", isError);
  targetSaveStatus.classList.add("visible");
  targetSaveTimer = setTimeout(() => {
    targetSaveStatus.classList.remove("visible", "error");
  }, isError ? 3000 : 1500);
}

// --- Source water dropdown change ---
sourcePresetSelect.addEventListener("change", () => {
  saveSourcePresetName(sourcePresetSelect.value);
  updateSourceWaterTags();
  calculate();
});

// --- Recalculate on any input change ---
[volumeInput, volumeUnit].forEach(el => {
  el.addEventListener("input", calculate);
  el.addEventListener("change", calculate);
});

// --- Core calculation ---
function calculate() {
  // Get volume in liters
  let volumeL = parseFloat(volumeInput.value) || 0;
  if (volumeUnit.value === "gallons") {
    volumeL *= GALLONS_TO_LITERS;
  }

  // Guard against divide-by-zero / nonsense volume
  if (!volumeL || volumeL <= 0) {
    const alk = getAlkalinitySource();
    updateResultValues({ "epsom-salt": 0, "calcium-chloride": 0, ...(alk ? { [alk]: 0 } : {}) });
    resultSummary.innerHTML = `<strong>Enter a water volume</strong> to see results.`;
    return;
  }

  const currentBuffer = getAlkalinitySource();
  if (currentBuffer === null) {
    resultSummary.innerHTML = "";
    return;
  }

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
  // Check which minerals the user actually has
  const selected = loadSelectedMinerals();
  const hasEpsom = selected.includes("epsom-salt");
  const hasCaCl2 = selected.includes("calcium-chloride");
  if (!hasEpsom && deltaMg > 0) warnings.push("You need Epsom Salt to add magnesium. Enable it in Settings.");
  if (!hasCaCl2 && deltaCa > 0) warnings.push("You need Calcium Chloride to add calcium. Enable it in Settings.");

  const warningsEl = document.getElementById("result-warnings");
  if (warningsEl) warningsEl.textContent = warnings.join("\n");

  // ---------------------------
  // Compute salt dosing (per L)
  // ---------------------------
  let epsomPerL = hasEpsom ? (deltaMg * MG_TO_EPSOM) / 1000 : 0;
  let cacl2PerL = hasCaCl2 ? (deltaCa * CA_TO_CACL2) / 1000 : 0;

  // Buffer dosing:
  // target alkalinity is in mg/L as CaCO3. Convert to grams of bicarbonate salt using the tool's constants.
  let bufferPerL;
  if (currentBuffer === "potassium-bicarbonate") {
    bufferPerL = (deltaAlkAsCaCO3 * ALK_TO_POTASSIUM_BICARB) / 1000; // grams per liter
  } else {
    bufferPerL = (deltaAlkAsCaCO3 * ALK_TO_BAKING_SODA) / 1000; // grams per liter
  }

  // Total grams for the full volume
  const epsomTotal = epsomPerL * volumeL;
  const bufferTotal = bufferPerL * volumeL;
  const cacl2Total = cacl2PerL * volumeL;

  // Zero out sub-threshold amounts so ion summary matches displayed grams
  if (epsomTotal < 0.01) epsomPerL = 0;
  if (cacl2Total < 0.01) cacl2PerL = 0;
  if (bufferTotal < 0.01) bufferPerL = 0;

  // Display grams (only update elements that exist for selected minerals)
  updateResultValues({
    "epsom-salt": epsomTotal,
    "calcium-chloride": cacl2Total,
    [currentBuffer]: bufferTotal
  });

  // ---------------------------
  // Compute resulting ions (mg/L)
  // ---------------------------
  // Final Ca and Mg: only add delta if the mineral is available and above display threshold
  const finalCa = (sourceWater.calcium || 0) + (cacl2PerL > 0 ? deltaCa : 0);
  const finalMg = (sourceWater.magnesium || 0) + (epsomPerL > 0 ? deltaMg : 0);

  // Convert salt grams/L to mg/L of salt
  const mgL_epsom = epsomPerL * 1000;
  const mgL_cacl2 = cacl2PerL * 1000;
  const mgL_buffer = bufferPerL * 1000;

  // Ions contributed by added salts (source presets do not track these, assume 0 in source)
  const addedCl = mgL_cacl2 * FRAC_CL_IN_CACL2_2H2O;
  const addedSO4 = mgL_epsom * FRAC_SO4_IN_MGSO4_7H2O;

  // Buffer ions (either K + HCO3 or Na + HCO3)
  const addedHCO3 =
    currentBuffer === "potassium-bicarbonate"
      ? mgL_buffer * FRAC_HCO3_IN_KHCO3
      : mgL_buffer * FRAC_HCO3_IN_NAHCO3;

  const addedK = currentBuffer === "potassium-bicarbonate" ? mgL_buffer * FRAC_K_IN_KHCO3 : 0;
  const addedNa = currentBuffer === "baking-soda" ? mgL_buffer * FRAC_NA_IN_NAHCO3 : 0;

  // Final bicarbonate (mg/L) is source bicarbonate + added bicarbonate
  const finalHCO3 = (sourceWater.bicarbonate || 0) + addedHCO3;

  // Final other ions (mg/L) — include source water contributions
  const finalCl = (sourceWater.chloride || 0) + addedCl;
  const finalSO4 = (sourceWater.sulfate || 0) + addedSO4;
  const finalK = (sourceWater.potassium || 0) + addedK;
  const finalNa = (sourceWater.sodium || 0) + addedNa;

  // ---------------------------
  // GH / KH / TDS — use shared calculateMetrics for consistency
  // ---------------------------
  const finalIons = {
    calcium: finalCa, magnesium: finalMg, potassium: finalK, sodium: finalNa,
    sulfate: finalSO4, chloride: finalCl, bicarbonate: finalHCO3
  };
  const metrics = calculateMetrics(finalIons);
  const GH_asCaCO3 = metrics.gh;
  const KH_asCaCO3 = metrics.kh;
  const TDS_ion_sum = metrics.tds;

  // Sulfate:Chloride ratio
  const so4ToCl = finalCl > 0 ? finalSO4 / finalCl : null;

  // Summary HTML
  resultSummary.innerHTML =
    `<div style="line-height:1.5">` +
      `<div><strong>TDS (ion-sum approx):</strong> ~${Math.round(TDS_ion_sum)} mg/L</div>` +
      `<div><strong>GH:</strong> ~${Math.round(GH_asCaCO3)} mg/L as CaCO\u2083</div>` +
      `<div><strong>KH:</strong> ~${Math.round(KH_asCaCO3)} mg/L as CaCO\u2083</div>` +
      `<div><strong>SO\u2084:Cl ratio:</strong> ${so4ToCl === null ? "\u2014" : so4ToCl.toFixed(2)}</div>` +
      `<hr style="border:none;border-top:1px solid var(--gray-300);margin:8px 0" />` +
      `<div><strong>Final ions (mg/L):</strong> ` +
        `Ca ${finalCa.toFixed(2)} | ` +
        `Mg ${finalMg.toFixed(2)} | ` +
        `K ${finalK.toFixed(2)} | ` +
        `Na ${finalNa.toFixed(2)} | ` +
        `HCO\u2083 ${finalHCO3.toFixed(2)} | ` +
        `SO\u2084 ${finalSO4.toFixed(2)} | ` +
        `Cl ${finalCl.toFixed(2)}` +
      `</div>` +
    `</div>`;
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
