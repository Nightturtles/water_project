// ============================================
// Coffee Water Chemistry Calculator
// ============================================

// --- State ---
// Load brew method first so loadTargetPresetName() can pick the
// mode-appropriate default (cafelytic-filter vs cafelytic-espresso) for new
// users. Returning users' saved preset still wins regardless of mode.
let activeBrewMethod = loadBrewMethod();
let currentProfile = loadTargetPresetName(activeBrewMethod);

// --- DOM elements ---
const volumeInput = document.getElementById("volume");
const volumeUnit = document.getElementById("volume-unit");
const targetCa = document.getElementById("target-calcium");
const targetMg = document.getElementById("target-magnesium");
const targetAlk = document.getElementById("target-alkalinity");
const targetK = document.getElementById("target-potassium");
const targetNa = document.getElementById("target-sodium");
const targetSO4 = document.getElementById("target-sulfate");
const targetCl = document.getElementById("target-chloride");
const targetHCO3 = document.getElementById("target-bicarbonate");
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
const targetMakeStockBtn = document.getElementById("target-make-stock-btn");

// Gate the named-target-profile save affordances when the user is anonymous.
// Capture-phase click handler intercepts before the bubble-phase save logic
// below ever fires, so no localStorage write happens off the locked button.
if (typeof window.applyAuthGate === "function") {
  if (targetSaveBtn) window.applyAuthGate(targetSaveBtn, { reason: "save-recipe" });
  if (targetSaveChangesBtn) window.applyAuthGate(targetSaveChangesBtn, { reason: "save-recipe" });
  if (targetMakeStockBtn) window.applyAuthGate(targetMakeStockBtn, { reason: "save-stock" });
}

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

if (typeof initEstimateWaterUI === "function") {
  initEstimateWaterUI();
}

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
  const selectedConcentrates = loadValidSelectedConcentrates();

  // Active stock: dispenses a fixed-ratio multi-mineral mix at a prescribed
  // dose. v1 rule is single-stock-per-recipe and stock-only output — when an
  // enabled stock is found, suppress every per-mineral / single-mineral
  // concentrate row so the user sees just the stock dispensing line. Mixed
  // stock + supplemental dosing is deferred to a follow-up; revisit if users
  // ask for it.
  const activeStockId = getActiveStockId(selectedConcentrates);
  const activeStockSpec = getActiveStockSpec(selectedConcentrates);

  const toShow = [];
  if (activeStockSpec) {
    toShow.push({
      kind: "stock",
      id: activeStockId,
      label: activeStockSpec.label || activeStockId,
      spec: activeStockSpec,
      order: -1,
    });
  } else {
    const mgSourceIds = getEffectiveMagnesiumSources();
    const caSourceIds = getEffectiveCalciumSources();

    const bufferIds = alkalinitySources;
    const candidates = [
      ...mgSourceIds.map((id, i) => ({ mineralId: id, order: 0 + i * 0.1 })),
      ...bufferIds.map((id, i) => ({ mineralId: id, order: 1 + i * 0.1 })),
      ...caSourceIds.map((id, i) => ({ mineralId: id, order: 2 + i * 0.1 }))
    ].filter((x) => x && x.mineralId);

    for (const c of candidates) {
      const mineralId = c.mineralId;
      const showMineral = selectedMinerals.includes(mineralId);
      if (showMineral) toShow.push({ kind: "mineral", id: mineralId, order: c.order });
      selectedConcentrates.forEach((cid) => {
        if (getConcentrateMineralId(cid) === mineralId) {
          toShow.push({ kind: "concentrate", id: cid, mineralId, order: c.order + 0.05 });
        }
      });
    }
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
    if (item.kind === "stock") {
      const div = document.createElement("div");
      div.className = "result-item";
      div.dataset.stock = item.id;
      const resultInfo = document.createElement("div");
      resultInfo.className = "result-info";
      const nameSpan = document.createElement("span");
      nameSpan.className = "result-name";
      nameSpan.textContent = item.label;
      const stockBadge = document.createElement("span");
      stockBadge.className = "badge badge-concentrate";
      stockBadge.textContent = "STOCK";
      nameSpan.appendChild(stockBadge);
      const detailSpan = document.createElement("span");
      detailSpan.className = "result-detail";
      detailSpan.textContent = formatStockResultDetail(item.spec);
      resultInfo.appendChild(nameSpan);
      resultInfo.appendChild(detailSpan);
      div.appendChild(resultInfo);
      const valueSpan = document.createElement("span");
      valueSpan.className = "result-value";
      valueSpan.textContent = "0.00 g";
      div.appendChild(valueSpan);
      resultsContainer.appendChild(div);
      continue;
    }

    const mineralId = item.kind === "concentrate" ? item.mineralId : item.id;
    const mineral = item.kind === "concentrate" && typeof BRAND_CONCENTRATES !== "undefined" && BRAND_CONCENTRATES[item.id]
      ? { name: BRAND_CONCENTRATES[item.id].name, formula: BRAND_CONCENTRATES[item.id].formula }
      : MINERAL_DB[mineralId];
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
    if (item.kind === "concentrate" && item.id.startsWith("brand:lotus:")) {
      const lotusBadge = document.createElement("span");
      lotusBadge.className = "badge badge-lotus";
      lotusBadge.textContent = "Lotus";
      nameSpan.appendChild(lotusBadge);
    }
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
    div.appendChild(resultInfo);
    if (item.kind === "concentrate" && item.id.startsWith("brand:lotus:")) {
      const valueWrap = document.createElement("div");
      valueWrap.className = "lotus-value-field";
      const valueSpan = document.createElement("span");
      valueSpan.className = "result-value";
      const defaultUnit = loadLotusConcentrateUnitFor(item.id);
      valueSpan.textContent = formatLotusConcentrateValue(0, defaultUnit);
      const unitSelect = document.createElement("select");
      unitSelect.className = "lotus-unit-select";
      unitSelect.dataset.lotusUnitFor = item.id;
      const dropsOption = document.createElement("option");
      dropsOption.value = "drops";
      dropsOption.textContent = "drops";
      const mlOption = document.createElement("option");
      mlOption.value = "ml";
      mlOption.textContent = "mL";
      unitSelect.appendChild(dropsOption);
      unitSelect.appendChild(mlOption);
      unitSelect.value = defaultUnit;
      valueWrap.appendChild(valueSpan);
      valueWrap.appendChild(unitSelect);
      div.appendChild(valueWrap);
    } else {
      const valueSpan = document.createElement("span");
      valueSpan.className = "result-value";
      valueSpan.textContent = item.kind === "concentrate" ? "0.000 mL" : "0.00 g";
      div.appendChild(valueSpan);
    }
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
    if (isTargetEditMode && key !== "custom" && key !== "library") {
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
  if (isAdvancedMineralDisplayMode()) {
    tags.push(
      ["K", Math.round(parseFloat(targetK.value) || 0), "mg/L"],
      ["Na", Math.round(parseFloat(targetNa.value) || 0), "mg/L"],
      ["SO\u2084", Math.round(parseFloat(targetSO4.value) || 0), "mg/L"],
      ["Cl", Math.round(parseFloat(targetCl.value) || 0), "mg/L"]
    );
  }
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

function highlightProfile(profileName) {
  profileButtonsContainer.querySelectorAll(".profile-btn").forEach(b => b.classList.remove("active"));
  const btn = profileButtonsContainer.querySelector(`[data-profile="${CSS.escape(profileName)}"]`);
  if (btn) btn.classList.add("active");
  targetSaveBar.style.display = profileName === "custom" ? "flex" : "none";
  targetEditBar.style.display = "none";
  updateTargetModeUI();
  updateMakeStockBtnVisibility();
}

// "+ Make a stock" surfaces the recipe-browser entry point on the Calculator
// page so users can derive a stock from any saved target profile — including
// private customs (cw_custom_target_profiles) that never appear on library.html.
// Hides when:
//   - the active profile is the unnamed "custom" scratchpad (no slug to hand
//     off to minerals.html)
//   - every primary ion is zero (distilled / RO target — nothing to derive)
//   - the user has unsaved edits on a saved profile (handoff carries only the
//     slug, so minerals.html would re-derive from stale persisted data —
//     surfacing the action while it would silently produce the wrong stock
//     is worse than hiding it until the user saves)
// Match recipe-browser.js's hasDerivableIonProfile, but read from the live
// target inputs so visibility tracks edits, and use target-alkalinity (the
// input the user actually sees and edits) rather than target-bicarbonate
// (hidden, not updated by the live flow).
function updateMakeStockBtnVisibility() {
  if (!targetMakeStockBtn) return;
  const hasSlug = currentProfile && currentProfile !== "custom";
  const ions = [targetCa, targetMg, targetK, targetNa, targetAlk];
  const hasIons = ions.some((el) => (parseFloat(el && el.value) || 0) > 0);
  const isSaved = !hasUnsavedTargetChanges();
  targetMakeStockBtn.style.display = hasSlug && hasIons && isSaved ? "" : "none";
}

function activateProfile(profileName) {
  const visibleProfiles = getTargetPresetsForBrewMethod(activeBrewMethod);
  if (!visibleProfiles[profileName]) {
    profileName = findFallbackPreset(visibleProfiles);
  }
  // "library" is an action pseudo-tile, not a real profile: opening the picker
  // must not mutate currentProfile or persist a saved-preset name (would
  // auto-open the picker on next load).
  if (profileName === "library") {
    if (typeof window.showLibraryPicker === "function") {
      window.showLibraryPicker({
        brewMethod: activeBrewMethod,
        onAdd: (slug) => {
          renderProfileButtons();
          activateProfile(slug);
        },
      });
    }
    return;
  }
  currentProfile = profileName;
  saveTargetPresetName(profileName);

  if (profileName === "custom") {
    highlightProfile(profileName);
    profileDesc.textContent = "Enter your own target values above.";
    calculate();
    return;
  }

  const profile = getTargetProfileByKey(profileName);
  if (profile) {
    targetCa.value = profile.calcium;
    targetMg.value = profile.magnesium;
    targetAlk.value = profile.alkalinity;
    targetK.value = profile.potassium || 0;
    targetNa.value = profile.sodium || 0;
    targetSO4.value = profile.sulfate || 0;
    targetCl.value = profile.chloride || 0;
    targetHCO3.value = profile.bicarbonate || 0;
    profileDesc.textContent = profile.description || "";
  }
  // Render profile state after input values are assigned so readonly tags are in sync.
  highlightProfile(profileName);
  calculate();
}

function hasUnsavedTargetChanges() {
  if (currentProfile === "custom") return false;
  const profile = getTargetProfileByKey(currentProfile);
  if (!profile) return false;
  const changed = (parseFloat(targetCa.value) || 0) !== (profile.calcium || 0) ||
         (parseFloat(targetMg.value) || 0) !== (profile.magnesium || 0) ||
         (parseFloat(targetAlk.value) || 0) !== (profile.alkalinity || 0);
  if (changed) return true;
  if (isAdvancedMineralDisplayMode()) {
    return (parseFloat(targetK.value) || 0) !== (profile.potassium || 0) ||
           (parseFloat(targetNa.value) || 0) !== (profile.sodium || 0) ||
           (parseFloat(targetSO4.value) || 0) !== (profile.sulfate || 0) ||
           (parseFloat(targetCl.value) || 0) !== (profile.chloride || 0);
  }
  return false;
}

// --- Event delegation for profile buttons ---
profileButtonsContainer.addEventListener("click", (e) => {
  const deleteKey = e.target.dataset.delete;
  if (deleteKey) {
    if (!isTargetEditMode) return;
    e.stopPropagation();
    showConfirm("Are you sure you want to delete this profile?", () => {
      deleteCustomTargetProfile(deleteKey);
      renderProfileButtons();
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

// "+ Make a stock" — hand off to minerals.html, which re-derives from the
// saved target via deriveStockFormulaFromTarget and opens the stock editor
// pre-filled. The slug round-trips through the hash; minerals.html falls
// back to getTargetProfileByKey so private customs (cw_custom_target_profiles)
// resolve too.
//
// updateMakeStockBtnVisibility already hides the button on unsaved edits, but
// keep a defensive guard here in case a click race lands first (e.g. user
// types, immediately clicks before the input listener fires).
if (targetMakeStockBtn) {
  targetMakeStockBtn.addEventListener("click", () => {
    if (!currentProfile || currentProfile === "custom") return;
    if (hasUnsavedTargetChanges()) return;
    window.location.href = "minerals.html#stock-derive=" + encodeURIComponent(currentProfile);
  });
}

// --- Target input handling (Inefficiency 6: debounced) ---
[targetCa, targetMg, targetAlk, targetK, targetNa, targetSO4, targetCl].forEach(input => {
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
    updateMakeStockBtnVisibility();
    debouncedCalculate();
  });
});

// --- Persist edits to the currently-loaded target profile.
// Returns { saved, profile, wasCreator } so callers can trigger follow-up
// actions (render refresh, share prompt) consistently. ---
function persistTargetProfileEdits() {
  calculate();
  const allProfiles = getTargetPresetsForBrewMethod(activeBrewMethod);
  const existing = allProfiles[currentProfile];
  if (!existing) return { saved: false };
  const orig = getTargetProfileByKey(currentProfile);
  const hasExplicitIons = orig && ION_FIELDS.every(ion => Number.isFinite(Number(orig[ion])));
  let profile;
  if (hasExplicitIons) {
    const editIons = {
      calcium: parseFloat(targetCa.value) || 0,
      magnesium: parseFloat(targetMg.value) || 0,
      potassium: parseFloat(targetK.value) || 0,
      sodium: parseFloat(targetNa.value) || 0,
      sulfate: parseFloat(targetSO4.value) || 0,
      chloride: parseFloat(targetCl.value) || 0,
      bicarbonate: parseFloat(targetHCO3.value) || 0
    };
    profile = buildStoredTargetProfile(existing.label, editIons, existing.description || "", {
      alkalinity: parseFloat(targetAlk.value) || 0,
      brewMethod: activeBrewMethod
    });
  } else {
    profile = {
      label: existing.label,
      calcium: parseFloat(targetCa.value) || 0,
      magnesium: parseFloat(targetMg.value) || 0,
      alkalinity: parseFloat(targetAlk.value) || 0,
      potassium: parseFloat(targetK.value) || 0,
      sodium: parseFloat(targetNa.value) || 0,
      sulfate: parseFloat(targetSO4.value) || 0,
      chloride: parseFloat(targetCl.value) || 0,
      bicarbonate: parseFloat(targetHCO3.value) || 0,
      description: existing.description || "",
      brewMethod: activeBrewMethod
    };
  }
  // Preserve library sharing / attribution fields from the original profile.
  if (orig) {
    if (orig.isPublic) profile.isPublic = true;
    if (orig.creatorDisplayName) profile.creatorDisplayName = orig.creatorDisplayName;
    if (orig.tags) profile.tags = orig.tags;
    if ("creatorUserId" in orig) profile.creatorUserId = orig.creatorUserId;
  }
  const wasCreator = typeof isUserTheCreator === "function" ? isUserTheCreator(orig || profile) : false;
  const profiles = loadCustomTargetProfiles();
  profiles[currentProfile] = profile;
  if (!saveCustomTargetProfiles(profiles)) {
    showTargetSaveStatus("Storage full; could not save.", true);
    return { saved: false };
  }
  targetEditBar.style.display = "none";
  if (typeof syncNow === "function") syncNow();
  return { saved: true, profile: profile, wasCreator: wasCreator };
}

// Offer the share prompt after an edit-save, but only to the recipe's creator.
function offerShareAfterEdit(profileKey, wasCreator) {
  if (!wasCreator) return;
  if (typeof showSharePrompt === "function") showSharePrompt(profileKey);
}

if (targetEditModeBtn) {
  targetEditModeBtn.addEventListener("click", () => {
    // Leaving edit mode with unsaved ion changes: persist them.
    // "Done Editing" is a natural commit point — no extra confirmation.
    if (isTargetEditMode && hasUnsavedTargetChanges()) {
      const key = currentProfile;
      const result = persistTargetProfileEdits();
      if (!result.saved) return;  // storage error — stay in edit mode
      offerShareAfterEdit(key, result.wasCreator);
    }
    isTargetEditMode = !isTargetEditMode;
    renderProfileButtons();
    updateTargetModeUI();
  });
}

// --- Save changes to existing target profile (Bug 1: alkalinity drift fix) ---
targetSaveChangesBtn.addEventListener("click", () => {
  showConfirm("Are you sure you want to change this profile?", () => {
    const key = currentProfile;
    const result = persistTargetProfileEdits();
    if (!result.saved) return;
    renderProfileButtons();
    offerShareAfterEdit(key, result.wasCreator);
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
  const targetIons = {
    calcium: parseFloat(targetCa.value) || 0,
    magnesium: parseFloat(targetMg.value) || 0,
    potassium: parseFloat(targetK.value) || 0,
    sodium: parseFloat(targetNa.value) || 0,
    sulfate: parseFloat(targetSO4.value) || 0,
    chloride: parseFloat(targetCl.value) || 0,
    bicarbonate: parseFloat(targetHCO3.value) || 0
  };
  var profile = buildStoredTargetProfile(name, targetIons, "", {
    alkalinity: parseFloat(targetAlk.value) || 0,
    brewMethod: activeBrewMethod
  });

  profiles[key] = profile;
  if (!saveCustomTargetProfiles(profiles)) {
    showTargetSaveStatus("Storage full; could not save.", true);
    return;
  }

  renderProfileButtons();
  activateProfile(key);
  targetProfileNameInput.value = "";
  updateTargetProfileNameError();
  showTargetSaveStatus("Saved!", false);

  // Sync immediately so the save persists even if the user navigates away
  if (typeof syncNow === "function") syncNow();

  // Offer to share to Recipe Library (only if logged in)
  if (typeof showSharePrompt === "function") {
    showSharePrompt(key);
  }
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

  const selectedConcentratesEarly = loadValidSelectedConcentrates();
  const activeStockIdEarly = getActiveStockId(selectedConcentratesEarly);
  const activeStockSpecEarly = getActiveStockSpec(selectedConcentratesEarly);

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
    if (activeStockIdEarly) updateStockValues({ [activeStockIdEarly]: 0 });
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

  // Active stock: bypass the per-mineral picker entirely. The stock dispenses
  // a fixed-ratio mix at a prescribed dose; we forward-compute resulting ions
  // and let the user compare to target visually. Source-exceeds-target
  // warnings still apply because the user can't reduce ion concentrations by
  // dosing more stock.
  if (activeStockSpecEarly) {
    const stockMineralGramsPerL = computeStockMineralGramsPerL(activeStockSpecEarly);
    const dosePerL = Number(activeStockSpecEarly.doseGramsPerL) || 0;
    const totalStockGrams = dosePerL * volumeL;
    updateStockValues({ [activeStockIdEarly]: totalStockGrams });

    const stockWarnings = [];
    if (rawDeltaCa < 0) stockWarnings.push(`Your source water already exceeds the target for Calcium (${(sourceWater.calcium || 0)} vs ${targetCaMgL} mg/L).`);
    if (rawDeltaMg < 0) stockWarnings.push(`Your source water already exceeds the target for Magnesium (${(sourceWater.magnesium || 0)} vs ${targetMgMgL} mg/L).`);
    if (rawDeltaAlk < 0) stockWarnings.push(`Your source water already exceeds the target for Alkalinity (${Math.round(sourceAlkAsCaCO3)} vs ${targetAlkAsCaCO3} mg/L as CaCO₃).`);
    if (warningsEl) warningsEl.textContent = stockWarnings.join("\n");

    const stockAddedIons = calculateIonPPMs(stockMineralGramsPerL);
    const stockFinalIons = {};
    ION_FIELDS.forEach((ion) => {
      stockFinalIons[ion] = (sourceWater[ion] || 0) + (stockAddedIons[ion] || 0);
    });
    lastCalculatedIons = stockFinalIons;

    const stockMetrics = calculateMetrics(stockFinalIons);
    const stockBaselineMetrics = calculateMetrics(sourceWater || {});
    const stockFinalSO4 = stockFinalIons.sulfate || 0;
    const stockFinalCl = stockFinalIons.chloride || 0;
    const stockSo4ToCl = stockFinalCl > 0 ? stockFinalSO4 / stockFinalCl : null;
    const stockBaselineRatio = calculateSo4ClRatio(sourceWater || {});
    updateSummaryMetrics({
      gh: stockMetrics.gh,
      kh: stockMetrics.kh,
      tds: stockMetrics.tds,
      ions: stockFinalIons,
      baselineIons: sourceWater || {},
      baselineMetrics: stockBaselineMetrics,
      so4ToCl: stockSo4ToCl,
      baselineRatio: stockBaselineRatio,
      advancedMode: isAdvancedMineralDisplayMode(),
      alkalinitySources: getEffectiveAlkalinitySources(),
      calciumSource: getEffectiveCalciumSource(),
      magnesiumSource: getEffectiveMagnesiumSource(),
      brewMethod: activeBrewMethod,
    });
    return;
  }

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
  const selectedConcentrates = selectedConcentratesEarly;
  const conflictMineralIds = new Set();
  selectedConcentrates.forEach((cid) => {
    const mineralId = getConcentrateMineralId(cid);
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

  // Warn when both alkalinity sources are enabled but the split is entirely one-sided
  if (alkalinitySources.length === 2 && deltaAlkAsCaCO3 > 0) {
    const usedSources = Object.keys(alkAllocation).filter(function(k) { return alkAllocation[k] > 0; });
    if (usedSources.length === 1) {
      const usedName = usedSources[0] === "baking-soda" ? "Baking Soda" : "Potassium Bicarbonate";
      warnings.push("Both alkalinity sources are enabled, but the target profile has no Na/K targets to guide the split: using only " + usedName + ".");
    }
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
    const mineralId = getConcentrateMineralId(cid);
    if (!mineralId) return;
    const grams = resultValues[mineralId] != null ? Number(resultValues[mineralId]) : 0;
    const gramsPerMl = getConcentrateGramsPerMl(cid);
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
    magnesiumSource: mgSource,
    brewMethod: activeBrewMethod
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
  const brewMethod = payload.brewMethod === "espresso" ? "espresso" : "filter";

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
    advancedMode ? (so4ToCl == null ? "-" : so4ToCl.toFixed(2)) : "-";
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
        magnesiumSource,
        brewMethod
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
  if (!Number.isFinite(g) || g <= 0) return "0.00 g";
  if (g < 0.01) return "<0.01 g";
  return g.toFixed(2) + " g";
}

function formatMl(ml) {
  if (!Number.isFinite(ml) || ml <= 0) return "0.000 mL";
  return ml.toFixed(3) + " mL";
}

function formatLotusConcentrateValue(ml, unit) {
  if (unit === "ml") {
    if (!Number.isFinite(ml) || ml <= 0) return "0.000";
    return ml.toFixed(3);
  }
  const dropMl = getLotusDropMl();
  const drops = (Number.isFinite(dropMl) && dropMl > 0) ? Math.round(ml / dropMl) : 0;
  return String(drops);
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

// Stock dispense uses grams (not mL like single-mineral concentrates), so it
// gets its own updater rather than reusing updateConcentrateValues.
function updateStockValues(valuesByStock) {
  for (const [stockId, grams] of Object.entries(valuesByStock)) {
    const item = resultsContainer.querySelector(`[data-stock="${CSS.escape(stockId)}"]`);
    if (!item) continue;
    const valEl = item.querySelector(".result-value");
    if (valEl) valEl.textContent = formatGrams(grams);
    if (grams > 0) {
      const nameEl = item.querySelector(".result-name");
      const name = nameEl ? nameEl.textContent : stockId;
      item.setAttribute("aria-label", name + ", " + formatGrams(grams));
    } else {
      item.removeAttribute("aria-label");
    }
  }
}

// Compact "5g MgSO4·7H2O · 2g MgCl2·6H2O · ..." string for the calculator's
// stock result row. Uses MINERAL_DB.formula as the salt label (already a
// short notation like "CaCl2·2H2O") so the row stays scannable.
function formatStockResultDetail(spec) {
  if (!spec || !Array.isArray(spec.minerals)) return "";
  const parts = spec.minerals
    .map((m) => {
      if (!m || typeof m !== "object" || !m.mineralId) return "";
      const grams = Number(m.grams);
      if (!Number.isFinite(grams) || grams <= 0) return "";
      const mineral = MINERAL_DB[m.mineralId];
      const label = mineral && mineral.formula ? mineral.formula : m.mineralId;
      return grams + "g " + label;
    })
    .filter(Boolean);
  if (parts.length === 0) return "";
  return parts.join(" · ");
}

// `computeStockMineralGramsPerL` lives in storage.js next to other stock-spec
// helpers; classic-script load order makes it a global by the time this file
// runs. Keeping the implementation in storage.js means it's reachable from
// unit tests without requiring script.js to set up a DOM.

function updateConcentrateValues(valuesByConcentrate) {
  for (const [concentrateId, ml] of Object.entries(valuesByConcentrate)) {
    const item = resultsContainer.querySelector(`[data-concentrate="${CSS.escape(concentrateId)}"]`);
    if (!item) continue;
    const valEl = item.querySelector(".result-value");
    const isLotus = concentrateId.startsWith("brand:lotus:");
    const unitSelect = isLotus ? item.querySelector("[data-lotus-unit-for]") : null;
    const unit = unitSelect ? normalizeLotusConcentrateUnit(unitSelect.value) : "drops";
    const displayValue = isLotus ? formatLotusConcentrateValue(ml, unit) : formatMl(ml);
    if (valEl) valEl.textContent = displayValue;
    if (ml > 0) {
      const nameEl = item.querySelector(".result-name");
      const name = nameEl ? nameEl.textContent : concentrateId;
      const ariaValue = isLotus ? (displayValue + " " + unit) : displayValue;
      item.setAttribute("aria-label", name + ", " + ariaValue);
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
resultsContainer.addEventListener("change", (e) => {
  const select = e.target.closest("[data-lotus-unit-for]");
  if (!select) return;
  const concentrateId = select.dataset.lotusUnitFor;
  saveLotusConcentrateUnitFor(concentrateId, select.value);
  calculate();
});
renderResultItems();
renderProfileButtons();
updateTargetModeUI();
const allTargetPresets = getTargetPresetsForBrewMethod(activeBrewMethod);
if (!allTargetPresets[currentProfile]) {
  currentProfile = findFallbackPreset(allTargetPresets);
  saveTargetPresetName(currentProfile);
}
activateProfile(currentProfile);

// When the public-recipes fetch resolves, the preset-rail cache is invalidated
// by library-data.js. Re-render so the Supabase library rows appear without
// requiring a page navigation. Also re-check currentProfile — a tombstoned
// library slug that was previously absent from the shim could leave
// currentProfile pointing at a preset that has disappeared.
function refreshPresetRail() {
  renderProfileButtons();
  const merged = getTargetPresetsForBrewMethod(activeBrewMethod);
  if (!merged[currentProfile]) {
    currentProfile = findFallbackPreset(merged);
    saveTargetPresetName(currentProfile);
    activateProfile(currentProfile);
  }
}
if (typeof window.onLibraryDataLoaded === "function") {
  window.onLibraryDataLoaded(refreshPresetRail);
}
// Cross-device sync: re-render when sync.js Realtime pull writes new data.
window.addEventListener("cw:cloud-data-changed", refreshPresetRail);

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

// --- Multi-tab sync: refresh results when mineral/concentrate selection changes in another tab ---
window.addEventListener("storage", function(e) {
  if (e.key === "cw_selected_minerals" || e.key === "cw_selected_concentrates") {
    renderResultItems();
    calculate();
  }
});

// --- Refresh on bfcache restore ---
window.addEventListener("pageshow", (e) => {
  if (e.persisted) location.reload();
});
