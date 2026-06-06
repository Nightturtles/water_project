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

// Gate the named-target-profile save affordances when the user is anonymous.
// Capture-phase click handler intercepts before the bubble-phase save logic
// below ever fires, so no localStorage write happens off the locked button.
if (typeof window.applyAuthGate === "function") {
  // Edit mode exposes delete affordances and the "Done Editing" path that
  // auto-saves dirty changes through persistTargetProfileEdits(); gate the
  // toggle so anonymous users see the modal instead of an opaque
  // "Storage full" error from the silent _setGated no-op.
  if (targetEditModeBtn) window.applyAuthGate(targetEditModeBtn, { reason: "save-recipe" });
  if (targetSaveBtn) window.applyAuthGate(targetSaveBtn, { reason: "save-recipe" });
  if (targetSaveChangesBtn) window.applyAuthGate(targetSaveChangesBtn, { reason: "save-recipe" });
}

let lastCalculatedIons = null;
let isTargetEditMode = false;

// --- Debounced calculate (Inefficiency 6) ---
const debouncedCalculate = debounce(calculate, 120);

const savedVolume = loadVolumePreference("calculator", {
  value: volumeInput.value,
  unit: volumeUnit.value,
});
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
  onActivated: updateSourceHintLabel,
});

if (typeof initEstimateWaterUI === "function") {
  initEstimateWaterUI();
}

// --- Result items: show only minerals selected in Settings ---

function renderResultItems() {
  const alkalinitySources = getEffectiveAlkalinitySources();
  if (alkalinitySources.length === 0) {
    resultsContainer.innerHTML =
      '<p class="hint error">You need to select an alkalinity source in <a href="minerals.html">Settings</a></p>';
    lastCalculatedIons = null;
    updateSummaryMetrics({});
    return;
  }

  const selectedMinerals = loadSelectedMinerals();
  const selectedConcentrates = loadValidSelectedConcentrates();

  // Active Recipe Concentrates: each dispenses a fixed-ratio multi-mineral mix
  // at its prescribed dose. When any are enabled, the calculator suppresses
  // per-mineral / single-mineral concentrate rows and shows one row per
  // enabled concentrate; their ion contributions are summed. Mixed
  // concentrate + supplemental dosing is deferred to PR 3; revisit if users
  // ask for gap-fill suggestions.
  const activeStockEntries = getActiveStockSpecs(selectedConcentrates);

  const toShow = [];
  if (activeStockEntries.length > 0) {
    activeStockEntries.forEach((entry, idx) => {
      toShow.push({
        kind: "stock",
        id: entry.id,
        label: entry.spec.label || entry.id,
        spec: entry.spec,
        order: -1 + idx * 0.001,
      });
    });
  } else {
    const mgSourceIds = getEffectiveMagnesiumSources();
    const caSourceIds = getEffectiveCalciumSources();

    const bufferIds = alkalinitySources;
    const candidates = [
      ...mgSourceIds.map((id, i) => ({ mineralId: id, order: 0 + i * 0.1 })),
      ...bufferIds.map((id, i) => ({ mineralId: id, order: 1 + i * 0.1 })),
      ...caSourceIds.map((id, i) => ({ mineralId: id, order: 2 + i * 0.1 })),
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
      stockBadge.textContent = "CONCENTRATE";
      nameSpan.appendChild(stockBadge);
      const detailSpan = document.createElement("span");
      detailSpan.className = "result-detail";
      detailSpan.textContent = formatStockResultDetail(item.spec);
      resultInfo.appendChild(nameSpan);
      resultInfo.appendChild(detailSpan);
      // The calculator scales each concentrate's dose to best-fit the target,
      // so the shown amount may differ from the bottle's prescribed dose.
      // Surface the prescribed dose as a volume-independent reference.
      const dosePerL = Number(item.spec && item.spec.doseGramsPerL) || 0;
      if (dosePerL > 0) {
        const prescribedSpan = document.createElement("span");
        prescribedSpan.className = "result-prescribed";
        prescribedSpan.textContent = "prescribed: " + Math.round(dosePerL * 100) / 100 + " g/L";
        resultInfo.appendChild(prescribedSpan);
      }
      div.appendChild(resultInfo);
      const valueSpan = document.createElement("span");
      valueSpan.className = "result-value";
      valueSpan.textContent = "0.00 g";
      div.appendChild(valueSpan);
      resultsContainer.appendChild(div);
      continue;
    }

    const mineralId = item.kind === "concentrate" ? item.mineralId : item.id;
    const mineral =
      item.kind === "concentrate" &&
      typeof BRAND_CONCENTRATES !== "undefined" &&
      BRAND_CONCENTRATES[item.id]
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
  // When Recipe Concentrates are active, calculate() fills this container with
  // the gap-fill section (Supplements heading, supplement rows, and one-click
  // "Enable {mineral}" rows). Built empty here; the contents are target-
  // dependent and rebuilt on every calculate(), which runs on target changes
  // (renderResultItems does not).
  if (activeStockEntries.length > 0) {
    const supplementsContainer = document.createElement("div");
    supplementsContainer.id = "stock-supplements";
    resultsContainer.appendChild(supplementsContainer);
  }
}

// --- Dynamic profile buttons (Inefficiency 1: cleaned up redundant if/else) ---
// --- Target Profile rail filters (Roast + Flavor; Method = the brew toggle) ---
// Reuses the Library's filter vocabulary + the shared window.recipeMatches
// predicate so the calculator narrows profiles exactly like library.html does.
const TARGET_ROAST_OPTIONS = [
  { value: "all", label: "All" },
  { value: "light", label: "Light" },
  { value: "medium", label: "Medium" },
  { value: "dark", label: "Dark" },
];
let targetFilterRoast = "all";
const targetFilterTags = [];

function buildTargetFilters() {
  const container = document.getElementById("target-filters");
  if (!container) return;
  // Capture the brew-method toggle (it lives in the markup before this box, or
  // already inside it on a re-run) BEFORE wiping, so its once-bound click
  // wiring survives the relocation into the Method row below.
  const brewToggle = document.getElementById("brew-method-toggle");
  container.innerHTML = "";

  // Method row — the existing Filter/Espresso toggle, relocated into the box.
  if (brewToggle) {
    const methodRow = document.createElement("div");
    methodRow.className = "rx-filter-row";
    const methodLabel = document.createElement("div");
    methodLabel.className = "rx-filter-row-label";
    methodLabel.textContent = "Method";
    methodRow.appendChild(methodLabel);
    methodRow.appendChild(brewToggle);
    container.appendChild(methodRow);
  }

  // Roast (segmented, single-select). Divided from the Method row above.
  const roastRow = document.createElement("div");
  roastRow.className = "rx-filter-row rx-filter-row-divided";
  const roastLabel = document.createElement("div");
  roastLabel.className = "rx-filter-row-label";
  roastLabel.textContent = "Roast";
  roastRow.appendChild(roastLabel);
  const roastSeg = document.createElement("div");
  roastSeg.className = "rx-segmented";
  const roastBtns = [];
  TARGET_ROAST_OPTIONS.forEach((opt) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rx-segmented-button";
    b.dataset.value = opt.value;
    b.textContent = opt.label;
    b.addEventListener("click", () => {
      targetFilterRoast = opt.value;
      roastBtns.forEach((x) =>
        x.classList.toggle("is-active", x.dataset.value === targetFilterRoast),
      );
      renderProfileButtons();
    });
    roastSeg.appendChild(b);
    roastBtns.push(b);
  });
  roastBtns.forEach((x) => x.classList.toggle("is-active", x.dataset.value === targetFilterRoast));
  roastRow.appendChild(roastSeg);
  container.appendChild(roastRow);

  // Flavor (chips, multi-select / AND).
  const tagList =
    typeof LIBRARY_TAGS !== "undefined" && Array.isArray(LIBRARY_TAGS) ? LIBRARY_TAGS : [];
  if (tagList.length) {
    const flavorRow = document.createElement("div");
    flavorRow.className = "rx-filter-row rx-filter-row-divided";
    const flavorLabel = document.createElement("div");
    flavorLabel.className = "rx-filter-row-label";
    flavorLabel.textContent = "Flavor";
    flavorRow.appendChild(flavorLabel);
    const chipGroup = document.createElement("div");
    chipGroup.className = "rx-chip-group";
    tagList.forEach((tag) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "rx-chip";
      chip.dataset.tag = tag;
      chip.textContent = tag;
      chip.addEventListener("click", () => {
        const idx = targetFilterTags.indexOf(tag);
        if (idx === -1) targetFilterTags.push(tag);
        else targetFilterTags.splice(idx, 1);
        chip.classList.toggle("is-active", targetFilterTags.indexOf(tag) !== -1);
        renderProfileButtons();
      });
      chipGroup.appendChild(chip);
    });
    flavorRow.appendChild(chipGroup);
    container.appendChild(flavorRow);
  }
}

function renderProfileButtons() {
  profileButtonsContainer.innerHTML = "";
  const allProfiles = getTargetPresetsForBrewMethod(activeBrewMethod);
  const filterActive = targetFilterRoast !== "all" || targetFilterTags.length > 0;
  const filters = {
    method: "all",
    roast: targetFilterRoast,
    tags: targetFilterTags,
    mine: false,
    q: "",
  };
  const matchesFilter = (profile) =>
    typeof window.recipeMatches !== "function" || window.recipeMatches(profile, filters);

  let shownReal = 0;
  for (const [key, profile] of Object.entries(allProfiles)) {
    // "+ Custom"/"+ From Library" actions and the active selection always show;
    // everything else is subject to the Roast/Flavor filter. Presets without
    // roast/tags metadata (shim/custom) fall out only when a filter is active.
    const isSentinel = key === "custom" || key === "library";
    if (filterActive && !isSentinel && key !== currentProfile && !matchesFilter(profile)) {
      continue;
    }
    if (!isSentinel) shownReal++;
    if (isSentinel) {
      // "+ Custom" / "+ From Library" stay as compact dashed action tiles, not
      // recipe cards (they have no minerals/tags). data-profile keeps the
      // existing delegated click handler dispatching them (custom flow / picker).
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "rx-slim-action-tile";
      tile.dataset.profile = key;
      tile.textContent = profile.label;
      profileButtonsContainer.appendChild(tile);
    } else {
      // buildSlimRecipeCard is bridged via legacy-globals.ts (same as
      // getTargetPresetsForBrewMethod above), so it's safe to call directly.
      const card = window.buildSlimRecipeCard(profile, {
        slug: key,
        attrName: "profile",
        selected: key === currentProfile,
        deletable: isTargetEditMode,
      });
      profileButtonsContainer.appendChild(card);
    }
  }

  if (filterActive && shownReal === 0) {
    const empty = document.createElement("p");
    empty.className = "hint target-filter-empty";
    empty.textContent = "No profiles match these filters.";
    profileButtonsContainer.insertBefore(empty, profileButtonsContainer.firstChild);
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
    ["Alkalinity", Math.round(alk), "mg/L as CaCO3"],
  ];
  if (isAdvancedMineralDisplayMode()) {
    tags.push(
      ["K", Math.round(parseFloat(targetK.value) || 0), "mg/L"],
      ["Na", Math.round(parseFloat(targetNa.value) || 0), "mg/L"],
      ["SO\u2084", Math.round(parseFloat(targetSO4.value) || 0), "mg/L"],
      ["Cl", Math.round(parseFloat(targetCl.value) || 0), "mg/L"],
    );
  }
  tags.forEach(function (t) {
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
  profileButtonsContainer.querySelectorAll(".active").forEach((b) => {
    b.classList.remove("active");
    b.setAttribute("aria-pressed", "false");
  });
  const btn = profileButtonsContainer.querySelector(`[data-profile="${CSS.escape(profileName)}"]`);
  if (btn) {
    btn.classList.add("active");
    btn.setAttribute("aria-pressed", "true");
  }
  targetSaveBar.style.display = profileName === "custom" ? "flex" : "none";
  targetEditBar.style.display = "none";
  updateTargetModeUI();
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
  // Overlay any persisted draft for this slug. Drafts are written by the
  // target-input listener (see above) and survive reload + cross-device sync,
  // so a user who tuned ions on their phone and reopened on their laptop sees
  // the in-progress values, not the saved profile's clean values.
  const draftIons =
    typeof loadTargetDraftIonsFor === "function" ? loadTargetDraftIonsFor(profileName) : null;
  if (draftIons && typeof draftIons === "object") {
    if (Number.isFinite(Number(draftIons.calcium))) targetCa.value = draftIons.calcium;
    if (Number.isFinite(Number(draftIons.magnesium))) targetMg.value = draftIons.magnesium;
    if (Number.isFinite(Number(draftIons.alkalinity))) targetAlk.value = draftIons.alkalinity;
    if (Number.isFinite(Number(draftIons.potassium))) targetK.value = draftIons.potassium;
    if (Number.isFinite(Number(draftIons.sodium))) targetNa.value = draftIons.sodium;
    if (Number.isFinite(Number(draftIons.sulfate))) targetSO4.value = draftIons.sulfate;
    if (Number.isFinite(Number(draftIons.chloride))) targetCl.value = draftIons.chloride;
    if (Number.isFinite(Number(draftIons.bicarbonate))) targetHCO3.value = draftIons.bicarbonate;
    if (NON_EDITABLE_TARGET_KEYS.includes(profileName)) {
      // Mirror the non-editable branch of the input handler so the UI reflects
      // the restored draft state on first paint.
      const label = profile && profile.label ? profile.label : profileName;
      profileDesc.textContent = "Modified " + label + " - name and save to keep these values.";
    }
  }
  // Render profile state after input values are assigned so readonly tags are in sync.
  highlightProfile(profileName);
  // After highlight, surface the right bar for any restored draft. highlightProfile
  // hides both bars; if a draft is live, re-show the appropriate one.
  if (draftIons && hasUnsavedTargetChanges()) {
    if (NON_EDITABLE_TARGET_KEYS.includes(profileName)) {
      targetSaveBar.style.display = "flex";
    } else {
      targetEditBar.style.display = "flex";
      const label = profile && profile.label ? profile.label : profileName;
      document.getElementById("target-edit-bar-label").textContent = "Editing: " + label;
    }
  }
  calculate();
}

function hasUnsavedTargetChanges() {
  if (currentProfile === "custom") return false;
  const profile = getTargetProfileByKey(currentProfile);
  if (!profile) return false;
  const changed =
    (parseFloat(targetCa.value) || 0) !== (profile.calcium || 0) ||
    (parseFloat(targetMg.value) || 0) !== (profile.magnesium || 0) ||
    (parseFloat(targetAlk.value) || 0) !== (profile.alkalinity || 0);
  if (changed) return true;
  if (isAdvancedMineralDisplayMode()) {
    return (
      (parseFloat(targetK.value) || 0) !== (profile.potassium || 0) ||
      (parseFloat(targetNa.value) || 0) !== (profile.sodium || 0) ||
      (parseFloat(targetSO4.value) || 0) !== (profile.sulfate || 0) ||
      (parseFloat(targetCl.value) || 0) !== (profile.chloride || 0)
    );
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

  const btn = e.target.closest("[data-profile]");
  if (!btn) return;
  const nextProfile = btn.dataset.profile;
  // Warn before discarding in-progress edits. confirm() is the simplest
  // first cut; a nicer dialog can replace this later. "library" is the
  // picker pseudo-tile and shouldn't trigger the prompt — picking from the
  // library doesn't switch the active preset.
  if (
    nextProfile !== currentProfile &&
    nextProfile !== "library" &&
    typeof hasUnsavedTargetChanges === "function" &&
    hasUnsavedTargetChanges()
  ) {
    if (!window.confirm("Discard unsaved changes?")) return;
    if (typeof clearTargetDraftIons === "function") clearTargetDraftIons(currentProfile);
  }
  activateProfile(nextProfile);
  // Light haptic on the deliberate "switch profile" tap (native only — web
  // call sites see window.cwHaptic as undefined and the optional chain
  // no-ops). activateProfile also runs on page init and Realtime refresh
  // paths; gating the haptic at the click handler keeps it tied to user
  // intent rather than every internal call.
  if (typeof window.cwHaptic === "function") window.cwHaptic("light");
});

// Snapshot the current target inputs as an ion object. Used by the draft-
// persistence path below so an in-progress edit survives reload and a second
// device. Mirrors the field set the calculator reads from elsewhere.
function readCurrentTargetIons() {
  return {
    calcium: parseFloat(targetCa.value) || 0,
    magnesium: parseFloat(targetMg.value) || 0,
    alkalinity: parseFloat(targetAlk.value) || 0,
    potassium: parseFloat(targetK.value) || 0,
    sodium: parseFloat(targetNa.value) || 0,
    sulfate: parseFloat(targetSO4.value) || 0,
    chloride: parseFloat(targetCl.value) || 0,
    bicarbonate: parseFloat(targetHCO3.value) || 0,
  };
}

function getCurrentTargetProfileForCalculations() {
  const ions = readCurrentTargetIons();
  return {
    calcium: ions.calcium,
    magnesium: ions.magnesium,
    alkalinity: ions.alkalinity,
    potassium: ions.potassium,
    sodium: ions.sodium,
    sulfate: ions.sulfate,
    chloride: ions.chloride,
    bicarbonate: ions.bicarbonate,
  };
}

// --- Target input handling (Inefficiency 6: debounced) ---
[targetCa, targetMg, targetAlk, targetK, targetNa, targetSO4, targetCl].forEach((input) => {
  input.addEventListener("input", () => {
    renderTargetReadonlyTags();
    if (currentProfile !== "custom") {
      const hasChanges = hasUnsavedTargetChanges();
      const isNonEditable = NON_EDITABLE_TARGET_KEYS.includes(currentProfile);
      // Persist edits as a per-slug draft so a reload / second-device session
      // doesn't lose them. Previously NON_EDITABLE_TARGET_KEYS edits silently
      // flipped currentProfile to "custom" and synced that switch — a
      // cross-device surprise.
      if (hasChanges) {
        saveTargetDraftIons(currentProfile, readCurrentTargetIons());
      } else {
        clearTargetDraftIons(currentProfile);
      }
      if (isNonEditable) {
        // Built-in canonical recipes (SCA, Rao) can't be overwritten in place.
        // Surface the "Save Profile" bar with a name input instead of the
        // "Save Changes" edit bar, and tell the user via the description.
        targetEditBar.style.display = "none";
        targetSaveBar.style.display = hasChanges ? "flex" : "none";
        const profile = getTargetProfileByKey(currentProfile);
        const label = profile && profile.label ? profile.label : currentProfile;
        profileDesc.textContent = hasChanges
          ? "Modified " + label + " - name and save to keep these values."
          : (profile && profile.description) || "";
      } else {
        targetEditBar.style.display = hasChanges ? "flex" : "none";
        if (hasChanges) {
          const profile = getTargetProfileByKey(currentProfile);
          document.getElementById("target-edit-bar-label").textContent =
            "Editing: " + (profile && profile.label ? profile.label : currentProfile);
        }
      }
    }
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
  const hasExplicitIons = orig && ION_FIELDS.every((ion) => Number.isFinite(Number(orig[ion])));
  let profile;
  if (hasExplicitIons) {
    const editIons = {
      calcium: parseFloat(targetCa.value) || 0,
      magnesium: parseFloat(targetMg.value) || 0,
      potassium: parseFloat(targetK.value) || 0,
      sodium: parseFloat(targetNa.value) || 0,
      sulfate: parseFloat(targetSO4.value) || 0,
      chloride: parseFloat(targetCl.value) || 0,
      bicarbonate: parseFloat(targetHCO3.value) || 0,
    };
    profile = buildStoredTargetProfile(existing.label, editIons, existing.description || "", {
      alkalinity: parseFloat(targetAlk.value) || 0,
      brewMethod: activeBrewMethod,
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
      brewMethod: activeBrewMethod,
    };
  }
  // Preserve library sharing / attribution fields from the original profile.
  if (orig) {
    if (orig.isPublic) profile.isPublic = true;
    if (orig.creatorDisplayName) profile.creatorDisplayName = orig.creatorDisplayName;
    if (orig.tags) profile.tags = orig.tags;
    if ("creatorUserId" in orig) profile.creatorUserId = orig.creatorUserId;
  }
  const profiles = loadCustomTargetProfiles();
  profiles[currentProfile] = profile;
  if (!saveCustomTargetProfiles(profiles)) {
    showTargetSaveStatus("Storage full; could not save.", true);
    return { saved: false };
  }
  // Save Changes committed the draft into the profile — drop the draft so a
  // reload doesn't re-show stale "modified" UI.
  if (typeof clearTargetDraftIons === "function") clearTargetDraftIons(currentProfile);
  targetEditBar.style.display = "none";
  if (typeof syncNow === "function") syncNow();
  return { saved: true, profile: profile };
}

// Offer the share prompt after an edit-save, but only to the recipe's creator.
function offerShareAfterEdit(profileKey, profile) {
  if (typeof maybeOfferSharePrompt === "function") maybeOfferSharePrompt(profileKey, profile);
}

if (targetEditModeBtn) {
  targetEditModeBtn.addEventListener("click", () => {
    // Leaving edit mode with unsaved ion changes: persist them.
    // "Done Editing" is a natural commit point — no extra confirmation.
    if (isTargetEditMode && hasUnsavedTargetChanges()) {
      const key = currentProfile;
      const result = persistTargetProfileEdits();
      if (!result.saved) return; // storage error — stay in edit mode
      offerShareAfterEdit(key, result.profile);
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
    offerShareAfterEdit(key, result.profile);
    if (typeof window.cwHaptic === "function") window.cwHaptic("medium");
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
    bicarbonate: parseFloat(targetHCO3.value) || 0,
  };
  var profile = buildStoredTargetProfile(name, targetIons, "", {
    alkalinity: parseFloat(targetAlk.value) || 0,
    brewMethod: activeBrewMethod,
  });

  profiles[key] = profile;
  if (!saveCustomTargetProfiles(profiles)) {
    showTargetSaveStatus("Storage full; could not save.", true);
    return;
  }

  // The user named + saved a new profile from in-progress edits on the active
  // preset (currentProfile). Clear that draft so revisiting the source preset
  // shows its clean values rather than the now-committed edits.
  if (typeof clearTargetDraftIons === "function") clearTargetDraftIons(currentProfile);

  renderProfileButtons();
  activateProfile(key);
  targetProfileNameInput.value = "";
  updateTargetProfileNameError();
  showTargetSaveStatus("Saved!", false);

  // Sync immediately so the save persists even if the user navigates away
  if (typeof syncNow === "function") syncNow();

  // Offer to share to Recipe Library (only if logged in)
  if (typeof maybeOfferSharePrompt === "function") maybeOfferSharePrompt(key, profile);
  if (typeof window.cwHaptic === "function") window.cwHaptic("medium");
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

// Calculator dosing plan for the active Recipe Concentrates. Stage 1 solves
// each concentrate's best-fit dose against the target (snapped to prescribed
// when it matches); Stage 2 sizes individual-mineral supplements for the
// leftover residual and flags ions that need a mineral the user hasn't enabled
// individually. Pure given selections + source + target inputs. Returns null
// when no concentrate is active. Called from calculate() (which owns volume).
function computeStockDosingPlan(sourceWater) {
  const selectedConcentrates = loadValidSelectedConcentrates();
  const entries = getActiveStockSpecs(selectedConcentrates);
  if (entries.length === 0) return null;

  const targetProfile = getCurrentTargetProfileForCalculations();
  const targetAlkAsCaCO3 = readNonNegative(targetAlk);
  // The solver matches on bicarbonate (ION_FIELDS), but the user edits the
  // Alkalinity input and the hidden bicarbonate field isn't synced from it.
  // Derive a consistent bicarbonate so a hand-typed custom Alkalinity isn't
  // read as zero. toStableBicarbonateFromAlkalinity keeps a preset's stored
  // bicarbonate when it round-trips to the same alkalinity.
  const solverTarget = Object.assign({}, targetProfile, {
    bicarbonate: toStableBicarbonateFromAlkalinity(targetAlkAsCaCO3, targetProfile.bicarbonate),
  });

  // Stage 1: best-fit concentrate doses (snapped). No mineral variables — the
  // concentrate is the primary, minerals only top up the residual in Stage 2.
  const solve = solveCalculatorDosing(sourceWater, solverTarget, entries, []);

  // Stage 2: residual after the concentrate contribution, gap-filled with
  // individually-enabled minerals. residualIons is target − source − concentrate
  // (post-snap), in mg/L per ion; bicarbonate converts to alkalinity-as-CaCO3.
  const SUPP_THRESHOLD = 1; // mg/L; ignore sub-1 residual noise
  const residualCa = Math.max(0, solve.residualIons.calcium || 0);
  const residualMg = Math.max(0, solve.residualIons.magnesium || 0);
  const residualAlkAsCaCO3 = Math.max(0, (solve.residualIons.bicarbonate || 0) * HCO3_TO_CACO3);

  // "Enabled" must mean individually selected — getEffective*Sources() also
  // reports minerals that live INSIDE an active concentrate, which would make
  // the gap-fill think a salt is dose-able when there's no row for it.
  const selectedMinerals = loadSelectedMinerals();
  /** @type {Record<string, number>} g/L per supplement mineral */
  const supplementGramsPerL = {};
  /** @type {Array<{ ion: string, mineralId: string }>} */
  const enableSuggestions = [];

  if (residualCa > SUPP_THRESHOLD) {
    const caId = ["calcium-chloride", "calcium-chloride-anhydrous", "gypsum"].find((id) =>
      selectedMinerals.includes(id),
    );
    if (caId) {
      const frac =
        (MINERAL_DB[caId] && MINERAL_DB[caId].ions && MINERAL_DB[caId].ions.calcium) || 0;
      if (frac > 0) supplementGramsPerL[caId] = residualCa / frac / 1000;
    } else {
      enableSuggestions.push({ ion: "calcium", mineralId: "calcium-chloride" });
    }
  }

  if (residualMg > SUPP_THRESHOLD) {
    const mgId = ["epsom-salt", "magnesium-chloride"].find((id) => selectedMinerals.includes(id));
    if (mgId) {
      const frac =
        (MINERAL_DB[mgId] && MINERAL_DB[mgId].ions && MINERAL_DB[mgId].ions.magnesium) || 0;
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
      const alloc = splitAlkalinityDelta(enabledAlk, residualAlkAsCaCO3, sourceWater, solverTarget);
      if ((alloc["baking-soda"] || 0) > 0) {
        supplementGramsPerL["baking-soda"] = (alloc["baking-soda"] * ALK_TO_BAKING_SODA) / 1000;
      }
      if ((alloc["potassium-bicarbonate"] || 0) > 0) {
        supplementGramsPerL["potassium-bicarbonate"] =
          (alloc["potassium-bicarbonate"] * ALK_TO_POTASSIUM_BICARB) / 1000;
      }
    } else {
      enableSuggestions.push({ ion: "bicarbonate", mineralId: "baking-soda" });
    }
  }

  return { entries, solve, supplementGramsPerL, enableSuggestions };
}

// Populate the #stock-supplements container with the gap-fill section: a
// "Supplements" heading, one row per individual-mineral supplement (with its
// computed amount for the volume), and a one-click "Enable {mineral}" row for
// each ion that needs a mineral the user hasn't enabled. Rebuilt on every
// calculate() so it tracks the current target. No-op when nothing to suggest.
function renderStockSupplements(plan, volumeL) {
  const container = document.getElementById("stock-supplements");
  if (!container) return;
  container.innerHTML = "";
  if (!plan) return;
  const suppIds = Object.keys(plan.supplementGramsPerL).filter(
    (id) => plan.supplementGramsPerL[id] > 0,
  );
  if (suppIds.length === 0 && plan.enableSuggestions.length === 0) return;

  const heading = document.createElement("div");
  heading.className = "result-section-heading";
  heading.textContent = "Supplements";
  container.appendChild(heading);

  for (const mineralId of suppIds) {
    const mineral = MINERAL_DB[mineralId];
    if (!mineral) continue;
    const grams = plan.supplementGramsPerL[mineralId] * volumeL;
    const div = document.createElement("div");
    div.className = "result-item";
    div.dataset.mineral = mineralId;
    const info = document.createElement("div");
    info.className = "result-info";
    const nameSpan = document.createElement("span");
    nameSpan.className = "result-name";
    nameSpan.textContent = mineral.name;
    const detailSpan = document.createElement("span");
    detailSpan.className = "result-detail";
    detailSpan.textContent = mineral.formula;
    info.appendChild(nameSpan);
    info.appendChild(detailSpan);
    div.appendChild(info);
    const valueSpan = document.createElement("span");
    valueSpan.className = "result-value";
    valueSpan.textContent = formatGrams(grams);
    div.appendChild(valueSpan);
    container.appendChild(div);
  }

  const GAP_ION_LABEL = { calcium: "Calcium", magnesium: "Magnesium", bicarbonate: "Alkalinity" };
  for (const sugg of plan.enableSuggestions) {
    const mineral = MINERAL_DB[sugg.mineralId];
    if (!mineral) continue;
    const ionLabel = GAP_ION_LABEL[sugg.ion] || sugg.ion;
    const div = document.createElement("div");
    div.className = "result-item result-enable-suggestion";
    div.dataset.enableMineral = sugg.mineralId;
    const info = document.createElement("div");
    info.className = "result-info";
    const nameSpan = document.createElement("span");
    nameSpan.className = "result-name";
    nameSpan.textContent = "Add " + mineral.name;
    const detailSpan = document.createElement("span");
    detailSpan.className = "result-detail";
    detailSpan.textContent = "Enable it to close the gap on " + ionLabel;
    info.appendChild(nameSpan);
    info.appendChild(detailSpan);
    div.appendChild(info);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "enable-mineral-btn";
    btn.textContent = "Enable";
    btn.addEventListener("click", function () {
      const current = loadSelectedMinerals();
      if (!current.includes(sugg.mineralId)) {
        saveSelectedMinerals(current.concat([sugg.mineralId]));
      }
      // index.html listens for cw:minerals-changed and re-runs
      // renderResultItems + calculate, so the newly-enabled mineral resolves
      // into a real supplement row with its amount on the next pass.
      window.dispatchEvent(
        new CustomEvent("cw:minerals-changed", { detail: { source: "calculator-gap-fill" } }),
      );
    });
    div.appendChild(btn);
    container.appendChild(div);
  }
}

// --- Core calculation ---
function calculate() {
  const warningsEl = document.getElementById("result-warnings");

  // Get volume in liters
  let volumeL = parseFloat(volumeInput.value) || 0;
  if (volumeUnit.value === "gallons") {
    volumeL *= GALLONS_TO_LITERS;
  }

  const selectedConcentratesEarly = loadValidSelectedConcentrates();
  const activeStockEntriesEarly = getActiveStockSpecs(selectedConcentratesEarly);

  // Guard against divide-by-zero / nonsense volume
  if (!volumeL || volumeL <= 0) {
    const alkSources = getEffectiveAlkalinitySources();
    const mgSourceIds = getEffectiveMagnesiumSources();
    const caSourceIds = getEffectiveCalciumSources();
    if (warningsEl) warningsEl.textContent = "";
    lastCalculatedIons = null;
    const zeroValues = {};
    alkSources.forEach((id) => {
      zeroValues[id] = 0;
    });
    mgSourceIds.forEach((id) => {
      zeroValues[id] = 0;
    });
    caSourceIds.forEach((id) => {
      zeroValues[id] = 0;
    });
    updateResultValues(zeroValues);
    if (activeStockEntriesEarly.length > 0) {
      const zeroStockValues = {};
      for (const { id } of activeStockEntriesEarly) zeroStockValues[id] = 0;
      updateStockValues(zeroStockValues);
      renderStockSupplements(null, 0);
    }
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

  // Active Recipe Concentrates: bypass the per-mineral picker entirely. Each
  // concentrate dispenses a fixed-ratio mix at its prescribed dose; we
  // forward-compute the summed ion contribution and let the user compare to
  // target visually. Source-exceeds-target warnings still apply because the
  // user can't reduce ion concentrations by dosing more concentrate.
  if (activeStockEntriesEarly.length > 0) {
    // Stage 1 + 2: solve each concentrate's best-fit dose against the target
    // (snapped to prescribed when it matches), then size individual-mineral
    // supplements for the residual and flag ions needing an unenabled mineral.
    const plan = computeStockDosingPlan(sourceWater);
    const concentrateGramsPerL = plan ? plan.solve.concentrateGramsPerL : {};
    const residualIons = plan ? plan.solve.residualIons : {};

    // Stock row values: each concentrate's solved/snapped dose × volume. Also
    // accumulate the per-mineral g/L the concentrates deliver AT THAT dose
    // (scale the prescribed-dose contribution by solved/prescribed).
    /** @type {Record<string, number>} */
    const stockTotalsByStockId = {};
    /** @type {Record<string, number>} */
    const combinedStockMineralGramsPerL = {};
    for (const { id, spec } of activeStockEntriesEarly) {
      const gPerL = concentrateGramsPerL[id] || 0;
      stockTotalsByStockId[id] = gPerL * volumeL;
      const dosePerL = Number(spec.doseGramsPerL) || 0;
      if (dosePerL > 0 && gPerL > 0) {
        const perLAtPrescribed = computeStockMineralGramsPerL(spec);
        const scale = gPerL / dosePerL;
        for (const mid of Object.keys(perLAtPrescribed)) {
          combinedStockMineralGramsPerL[mid] =
            (combinedStockMineralGramsPerL[mid] || 0) + perLAtPrescribed[mid] * scale;
        }
      }
    }
    updateStockValues(stockTotalsByStockId);

    // Gap-fill section (Supplements heading + supplement rows + one-click
    // Enable rows). Fold supplement minerals into the final ion profile too.
    renderStockSupplements(plan, volumeL);
    if (plan) {
      for (const [mid, gPerL] of Object.entries(plan.supplementGramsPerL)) {
        if (gPerL > 0)
          combinedStockMineralGramsPerL[mid] = (combinedStockMineralGramsPerL[mid] || 0) + gPerL;
      }
    }

    // Overshoot warnings: a negative residual means source + concentrate
    // already exceed the target for that ion (the concentrate's fixed ratio
    // forces excess the user can't dial back). Supplements only add, so no
    // supplement is suggested for an overshot ion.
    const OVERSHOOT_TOL = 1; // mg/L
    const stockWarnings = [];
    if ((residualIons.calcium || 0) < -OVERSHOOT_TOL) {
      const achieved = Math.round(targetCaMgL - (residualIons.calcium || 0));
      stockWarnings.push(
        `Source water + Recipe Concentrate already exceed the target for Calcium (${achieved} vs ${targetCaMgL} mg/L).`,
      );
    }
    if ((residualIons.magnesium || 0) < -OVERSHOOT_TOL) {
      const achieved = Math.round(targetMgMgL - (residualIons.magnesium || 0));
      stockWarnings.push(
        `Source water + Recipe Concentrate already exceed the target for Magnesium (${achieved} vs ${targetMgMgL} mg/L).`,
      );
    }
    const alkResidAsCaCO3 = (residualIons.bicarbonate || 0) * HCO3_TO_CACO3;
    if (alkResidAsCaCO3 < -OVERSHOOT_TOL) {
      const achieved = Math.round(targetAlkAsCaCO3 - alkResidAsCaCO3);
      stockWarnings.push(
        `Source water + Recipe Concentrate already exceed the target for Alkalinity (${achieved} vs ${targetAlkAsCaCO3} mg/L as CaCO₃).`,
      );
    }
    if (warningsEl) warningsEl.textContent = stockWarnings.join("\n");

    const stockAddedIons = calculateIonPPMs(combinedStockMineralGramsPerL);
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

  const targetProfile = getCurrentTargetProfileForCalculations();
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
      `Your source water already exceeds the target for Alkalinity (${Math.round(sourceAlkAsCaCO3)} vs ${targetAlkAsCaCO3} mg/L as CaCO\u2083).`,
    );
  if (!hasMgSource && deltaMg > 0)
    warnings.push("You need an enabled magnesium source (Epsom Salt or Magnesium Chloride).");
  if (!hasCaSource && deltaCa > 0)
    warnings.push("You need an enabled calcium source (Calcium Chloride or Gypsum).");

  // Compute salt dosing (per L) using auto-selected sources
  const mgFraction = mgSource ? MINERAL_DB[mgSource]?.ions?.magnesium || 0 : 0;
  const caFraction = caSource ? MINERAL_DB[caSource]?.ions?.calcium || 0 : 0;
  const mgSaltPerL = mgFraction > 0 ? deltaMg / mgFraction / 1000 : 0;
  const caSaltPerL = caFraction > 0 ? deltaCa / caFraction / 1000 : 0;

  // Alkalinity: one source or split between baking soda and potassium bicarbonate
  const alkAllocation = splitAlkalinityDelta(
    alkalinitySources,
    deltaAlkAsCaCO3,
    sourceWater,
    targetProfile,
  );
  const bufferGramsPerL = {};
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
    const usedSources = Object.keys(alkAllocation).filter(function (k) {
      return alkAllocation[k] > 0;
    });
    if (usedSources.length === 1) {
      const usedName = usedSources[0] === "baking-soda" ? "Baking Soda" : "Potassium Bicarbonate";
      warnings.push(
        "Both alkalinity sources are enabled, but the target profile has no Na/K targets to guide the split: using only " +
          usedName +
          ".",
      );
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
  mgSourceIds.forEach((id) => {
    if (resultValues[id] == null) resultValues[id] = 0;
  });
  caSourceIds.forEach((id) => {
    if (resultValues[id] == null) resultValues[id] = 0;
  });

  const displayMineralGrams = { ...resultValues };
  conflictMineralIds.forEach((mineralId) => {
    displayMineralGrams[mineralId] = 0;
  });
  updateResultValues(displayMineralGrams);

  const concentrateValues = {};
  selectedConcentrates.forEach((cid) => {
    const mineralId = getConcentrateMineralId(cid);
    if (!mineralId) return;
    const grams = resultValues[mineralId] != null ? Number(resultValues[mineralId]) : 0;
    const gramsPerMl = getConcentrateGramsPerMl(cid);
    if (!Number.isFinite(gramsPerMl) || gramsPerMl <= 0) {
      concentrateValues[cid] = 0;
      if (grams > 0)
        warnings.push("Set bottle mL and grams per bottle in Settings to use this concentrate.");
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
    brewMethod: activeBrewMethod,
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
  setDeltaText(
    document.getElementById("calc-delta-gh"),
    baselineMetrics ? gh - baselineMetrics.gh : null,
    {
      metricName: "GH",
      unit: "mg/L as CaCO3",
      baselineLabel: "source water",
    },
  );
  setDeltaText(
    document.getElementById("calc-delta-kh"),
    baselineMetrics ? kh - baselineMetrics.kh : null,
    {
      metricName: "KH",
      unit: "mg/L as CaCO3",
      baselineLabel: "source water",
    },
  );
  setDeltaText(
    document.getElementById("calc-delta-tds"),
    baselineMetrics ? tds - baselineMetrics.tds : null,
    {
      metricName: "TDS",
      unit: "mg/L",
      baselineLabel: "source water",
    },
  );
  ION_FIELDS.forEach((ion) => {
    const el = document.getElementById("calc-" + ion);
    if (!el) return;
    const v = ions[ion];
    el.textContent = Number.isFinite(v) ? Math.round(v) : 0;
    setDeltaText(
      document.getElementById("calc-delta-" + ion),
      baselineIons ? v - (baselineIons[ion] || 0) : null,
      {
        metricName: ion.charAt(0).toUpperCase() + ion.slice(1),
        unit: "mg/L",
        baselineLabel: "source water",
      },
    );
  });
  document.getElementById("calc-so4cl").textContent = advancedMode
    ? so4ToCl == null
      ? "-"
      : so4ToCl.toFixed(2)
    : "-";
  setDeltaText(
    document.getElementById("calc-delta-so4cl"),
    !advancedMode || so4ToCl == null || baselineRatio == null ? null : so4ToCl - baselineRatio,
    {
      decimals: 2,
      metricName: "SO4:Cl ratio",
      baselineLabel: "source water",
    },
  );

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
        brewMethod,
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
  const drops = Number.isFinite(dropMl) && dropMl > 0 ? Math.round(ml / dropMl) : 0;
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
        item.setAttribute(
          "aria-label",
          name + ", " + formatGrams(grams) + ", auto-selected for this recipe",
        );
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
    const item = resultsContainer.querySelector(
      `[data-concentrate="${CSS.escape(concentrateId)}"]`,
    );
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
      const ariaValue = isLotus ? displayValue + " " + unit : displayValue;
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
buildTargetFilters();
renderProfileButtons();
updateTargetModeUI();
const allTargetPresets = getTargetPresetsForBrewMethod(activeBrewMethod);
// Saved slug may be a library row whose data hasn't lazy-loaded yet.
// Falling back and persisting now would permanently overwrite the user's
// last-selected library profile.  Defer the fallback's persistence until
// refreshPresetRail() confirms the slug is truly missing after the
// library load resolves.
const initialSavedSlug = currentProfile;
let initialFallbackSlug = null;
if (!allTargetPresets[currentProfile]) {
  initialFallbackSlug = findFallbackPreset(allTargetPresets);
  currentProfile = initialFallbackSlug;
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
  // If we fell back at init because the saved slug looked unknown but
  // it's actually a library row we hadn't loaded yet, and the user
  // hasn't picked something else in the meantime, restore the saved slug.
  if (
    initialFallbackSlug &&
    initialSavedSlug !== initialFallbackSlug &&
    currentProfile === initialFallbackSlug &&
    merged[initialSavedSlug]
  ) {
    currentProfile = initialSavedSlug;
    initialFallbackSlug = null;
    activateProfile(currentProfile);
    return;
  }
  if (!merged[currentProfile]) {
    currentProfile = findFallbackPreset(merged);
    saveTargetPresetName(currentProfile);
    activateProfile(currentProfile);
  }
}
if (typeof window.onLibraryDataLoaded === "function") {
  window.onLibraryDataLoaded(refreshPresetRail);
}
if (typeof window.ensurePublicRecipesLoaded === "function") {
  window.ensurePublicRecipesLoaded();
}
// Cross-device sync: re-render when sync.js Realtime pull writes new data.
window.addEventListener("cw:cloud-data-changed", refreshPresetRail);

// --- Multi-tab sync: refresh results when mineral/concentrate selection changes in another tab ---
if (typeof onStorageKeysChanged === "function") {
  // Include cw_stock_concentrate_specs: the calculator reads concentrate specs
  // for labels, formulas, orphan filtering, and dose totals, so editing a
  // Recipe Concentrate in Settings (another tab) must refresh the rows + doses
  // here, not just selection changes.
  onStorageKeysChanged(
    ["cw_selected_minerals", "cw_selected_concentrates", "cw_stock_concentrate_specs"],
    function () {
      renderResultItems();
      calculate();
    },
  );
}

// --- Refresh on bfcache restore ---
window.addEventListener("pageshow", (e) => {
  if (e.persisted) location.reload();
});
