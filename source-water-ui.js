// ============================================
// Source Water UI — shared source water profile management
// Used by Calculator (index.html) and Recipe Builder (recipe.html)
// ============================================

/**
 * Initialize the source water section.
 * @param {Object} options
 * @param {Function} options.onChanged  - called when source water changes (preset click, ion edit, save, delete)
 * @param {Function} options.onActivated - called when a preset is activated; receives (presetName)
 * @returns {{ getSourceWater: Function, getActivePreset: Function }}
 */
function initSourceWaterSection(options) {
  options = options || {};
  const onChanged = options.onChanged || function() {};
  const onActivated = options.onActivated || function() {};

  // --- DOM elements ---
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
  const sourceAlkalinityInput = document.getElementById("src-alkalinity");
  const sourceBicarbonateInput = document.getElementById("src-bicarbonate");

  let activeSourcePreset = loadSourcePresetName();
  let isSourceEditMode = false;
  const showSourceSaveStatus = createStatusHandler(sourceSaveStatus);

  function getSourceWater() {
    const water = {};
    ION_FIELDS.forEach(function(ion) {
      water[ion] = readNonNegative(document.getElementById("src-" + ion));
    });
    return water;
  }

  function saveCurrentSourceWaterInputs() {
    saveSourceWater(getSourceWater());
  }
  const debouncedSave = typeof debounce === "function" ? debounce(saveCurrentSourceWaterInputs, 300) : saveCurrentSourceWaterInputs;

  function updateSourceAlkalinityFromBicarbonate() {
    const bicarb = parseFloat(sourceBicarbonateInput.value) || 0;
    sourceAlkalinityInput.value = Math.round(bicarb * HCO3_TO_CACO3);
  }

  sourceAlkalinityInput.addEventListener("input", function() {
    const alkAsCaCO3 = parseFloat(sourceAlkalinityInput.value) || 0;
    sourceBicarbonateInput.value = toStableBicarbonateFromAlkalinity(alkAsCaCO3, sourceBicarbonateInput.value);
    sourceBicarbonateInput.dispatchEvent(new Event("input", { bubbles: true }));
  });

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
    sourcePresetsContainer.querySelectorAll(".preset-btn").forEach(function(b) { b.classList.remove("active"); });
    const btn = sourcePresetsContainer.querySelector('[data-preset="' + CSS.escape(presetName) + '"]');
    if (btn) btn.classList.add("active");
    if (sourceSaveBar) sourceSaveBar.style.display = presetName === "custom" ? "flex" : "none";
    if (sourceEditBar) sourceEditBar.style.display = "none";
    updateSourceModeUI();
  }

  function activateSourcePreset(presetName) {
    const allPresets = getAllPresets();
    if (!allPresets[presetName]) {
      presetName = Object.keys(allPresets).find(function(k) { return k !== "custom"; }) || "custom";
    }
    activeSourcePreset = presetName;
    highlightSourcePreset(presetName);
    saveSourcePresetName(presetName);
    if (presetName === "custom") {
      onActivated(presetName);
      return;
    }
    const values = getSourceWaterByPreset(presetName);
    ION_FIELDS.forEach(function(ion) {
      document.getElementById("src-" + ion).value = values[ion] || 0;
    });
    saveCurrentSourceWaterInputs();
    updateSourceAlkalinityFromBicarbonate();
    renderSourceReadonlyTags();
    onActivated(presetName);
  }

  function hasUnsavedSourceChanges() {
    if (activeSourcePreset === "custom") return false;
    const presetValues = getSourceWaterByPreset(activeSourcePreset);
    return ION_FIELDS.some(function(ion) {
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
        del.textContent = "\u00d7";
        btn.appendChild(del);
      }
      sourcePresetsContainer.appendChild(btn);
    }
    highlightSourcePreset(activeSourcePreset);
  }

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

  // --- Event handlers ---

  if (sourceEditModeBtn) {
    sourceEditModeBtn.addEventListener("click", function() {
      isSourceEditMode = !isSourceEditMode;
      renderSourcePresetButtons();
      updateSourceModeUI();
    });
  }

  document.getElementById("restore-source-defaults").addEventListener("click", function(e) {
    e.preventDefault();
    restoreSourcePresetDefaults();
    renderSourcePresetButtons();
    updateRestoreSourceBar();
  });

  sourcePresetsContainer.addEventListener("click", function(e) {
    const deleteKey = e.target.dataset.delete;
    if (deleteKey) {
      if (!isSourceEditMode) return;
      e.stopPropagation();
      showConfirm("Are you sure you want to delete this profile?", function() {
        if (SOURCE_PRESETS[deleteKey]) {
          addDeletedPreset(deleteKey);
        }
        deleteCustomProfile(deleteKey);
        renderSourcePresetButtons();
        updateRestoreSourceBar();
        if (activeSourcePreset === deleteKey) {
          const fallback = Object.keys(getAllPresets()).find(function(k) { return k !== "custom"; }) || "custom";
          activateSourcePreset(fallback);
        }
        showSourceSaveStatus("Profile deleted.", false);
        onChanged();
      });
      return;
    }
    const btn = e.target.closest(".preset-btn");
    if (!btn) return;
    activateSourcePreset(btn.dataset.preset);
    onChanged();
  });

  ION_FIELDS.forEach(function(ion) {
    const input = document.getElementById("src-" + ion);
    input.addEventListener("input", function() {
      if (activeSourcePreset !== "custom") {
        const showEdit = isSourceEditMode && hasUnsavedSourceChanges();
        sourceEditBar.style.display = showEdit ? "flex" : "none";
        if (showEdit) {
          const preset = getAllPresets()[activeSourcePreset];
          document.getElementById("source-edit-bar-label").textContent =
            "Editing: " + (preset && preset.label ? preset.label : activeSourcePreset);
        }
      }
      debouncedSave();
      updateSourceAlkalinityFromBicarbonate();
      renderSourceReadonlyTags();
      onChanged();
    });
  });

  sourceProfileNameInput.addEventListener("input", updateSourceProfileNameError);
  bindEnterToClick(sourceProfileNameInput, sourceSaveBtn);

  sourceSaveBtn.addEventListener("click", function() {
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
    const key = validation.key;
    const name = validation.name;
    if (!key || !name) {
      updateSourceProfileNameError();
      return;
    }
    document.getElementById("source-profile-name-error").textContent = "";
    const profiles = loadCustomProfiles();
    const profile = { label: name };
    ION_FIELDS.forEach(function(ion) {
      profile[ion] = readNonNegative(document.getElementById("src-" + ion));
    });
    profiles[key] = profile;
    if (!saveCustomProfiles(profiles)) {
      showSourceSaveStatus("Storage full — could not save.", true);
      return;
    }
    renderSourcePresetButtons();
    activateSourcePreset(key);
    sourceProfileNameInput.value = "";
    updateSourceProfileNameError();
    showSourceSaveStatus("Saved!", false);
    onChanged();
  });

  sourceSaveChangesBtn.addEventListener("click", function() {
    showConfirm("Are you sure you want to change this profile?", function() {
      const allPresets = getAllPresets();
      const existing = allPresets[activeSourcePreset];
      if (!existing) return;
      const profile = { label: existing.label };
      ION_FIELDS.forEach(function(ion) {
        profile[ion] = readNonNegative(document.getElementById("src-" + ion));
      });
      const profiles = loadCustomProfiles();
      profiles[activeSourcePreset] = profile;
      if (!saveCustomProfiles(profiles)) {
        showSourceSaveStatus("Storage full — could not save.", true);
        return;
      }
      sourceEditBar.style.display = "none";
      renderSourcePresetButtons();
      showSourceSaveStatus("Saved!", false);
      onChanged();
    });
  });

  // --- Initialize ---
  const sourceWater = loadSourceWater();
  ION_FIELDS.forEach(function(ion) {
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
    activeSourcePreset = Object.keys(allSourcePresets).find(function(k) { return k !== "custom"; }) || "custom";
  }
  activateSourcePreset(activeSourcePreset);

  // --- Public API ---
  return {
    getSourceWater: getSourceWater,
    getActivePreset: function() { return activeSourcePreset; }
  };
}
