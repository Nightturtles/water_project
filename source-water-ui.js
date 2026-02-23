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
  var onChanged = options.onChanged || function() {};
  var onActivated = options.onActivated || function() {};

  // --- DOM elements ---
  var sourcePresetsContainer = document.getElementById("source-presets");
  var sourceEditModeBtn = document.getElementById("source-edit-mode-btn");
  var sourceReadonlyTags = document.getElementById("source-readonly-tags");
  var sourceInputGrid = document.getElementById("source-input-grid");
  var sourceSaveBar = document.getElementById("source-save-bar");
  var sourceEditBar = document.getElementById("source-edit-bar");
  var sourceProfileNameInput = document.getElementById("source-profile-name");
  var sourceSaveBtn = document.getElementById("source-save-btn");
  var sourceSaveChangesBtn = document.getElementById("source-save-changes-btn");
  var sourceSaveStatus = document.getElementById("source-save-status");
  var sourceAlkalinityInput = document.getElementById("src-alkalinity");
  var sourceBicarbonateInput = document.getElementById("src-bicarbonate");

  var activeSourcePreset = loadSourcePresetName();
  var isSourceEditMode = false;
  var showSourceSaveStatus = createStatusHandler(sourceSaveStatus);

  function getSourceWater() {
    var water = {};
    ION_FIELDS.forEach(function(ion) {
      water[ion] = parseFloat(document.getElementById("src-" + ion).value) || 0;
    });
    return water;
  }

  function saveCurrentSourceWaterInputs() {
    saveSourceWater(getSourceWater());
  }

  function updateSourceAlkalinityFromBicarbonate() {
    var bicarb = parseFloat(sourceBicarbonateInput.value) || 0;
    sourceAlkalinityInput.value = Math.round(bicarb * HCO3_TO_CACO3);
  }

  sourceAlkalinityInput.addEventListener("input", function() {
    var alkAsCaCO3 = parseFloat(sourceAlkalinityInput.value) || 0;
    sourceBicarbonateInput.value = toStableBicarbonateFromAlkalinity(alkAsCaCO3, sourceBicarbonateInput.value);
    sourceBicarbonateInput.dispatchEvent(new Event("input", { bubbles: true }));
  });

  function renderSourceReadonlyTags() {
    if (!sourceReadonlyTags) return;
    renderSourceWaterTags(sourceReadonlyTags, getSourceWater());
  }

  function updateSourceModeUI() {
    var customSelected = activeSourcePreset === "custom";
    var showInputs = isSourceEditMode || customSelected;
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
    var btn = sourcePresetsContainer.querySelector('[data-preset="' + presetName + '"]');
    if (btn) btn.classList.add("active");
    if (sourceSaveBar) sourceSaveBar.style.display = presetName === "custom" ? "flex" : "none";
    if (sourceEditBar) sourceEditBar.style.display = "none";
    updateSourceModeUI();
  }

  function activateSourcePreset(presetName) {
    var allPresets = getAllPresets();
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
    var values = getSourceWaterByPreset(presetName);
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
    var presetValues = getSourceWaterByPreset(activeSourcePreset);
    return ION_FIELDS.some(function(ion) {
      var current = parseFloat(document.getElementById("src-" + ion).value) || 0;
      return current !== (presetValues[ion] || 0);
    });
  }

  function renderSourcePresetButtons() {
    sourcePresetsContainer.innerHTML = "";
    var allPresets = getAllPresets();
    for (var _i = 0, _entries = Object.entries(allPresets); _i < _entries.length; _i++) {
      var key = _entries[_i][0];
      var preset = _entries[_i][1];
      var btn = document.createElement("button");
      btn.className = "preset-btn";
      btn.dataset.preset = key;
      btn.textContent = preset.label;
      if (isSourceEditMode && key !== "custom") {
        var del = document.createElement("span");
        del.className = "preset-delete";
        del.dataset.delete = key;
        del.innerHTML = "&times;";
        btn.appendChild(del);
      }
      sourcePresetsContainer.appendChild(btn);
    }
    highlightSourcePreset(activeSourcePreset);
  }

  function updateSourceProfileNameError() {
    var errEl = document.getElementById("source-profile-name-error");
    var validation = validateProfileName(sourceProfileNameInput.value, {
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
    var deleteKey = e.target.dataset.delete;
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
          var fallback = Object.keys(getAllPresets()).find(function(k) { return k !== "custom"; }) || "custom";
          activateSourcePreset(fallback);
        }
        showSourceSaveStatus("Profile deleted.", false);
        onChanged();
      });
      return;
    }
    var btn = e.target.closest(".preset-btn");
    if (!btn) return;
    activateSourcePreset(btn.dataset.preset);
    onChanged();
  });

  ION_FIELDS.forEach(function(ion) {
    var input = document.getElementById("src-" + ion);
    input.addEventListener("input", function() {
      if (activeSourcePreset !== "custom") {
        var showEdit = isSourceEditMode && hasUnsavedSourceChanges();
        sourceEditBar.style.display = showEdit ? "flex" : "none";
        if (showEdit) {
          var preset = getAllPresets()[activeSourcePreset];
          document.getElementById("source-edit-bar-label").textContent =
            "Editing: " + (preset && preset.label ? preset.label : activeSourcePreset);
        }
      }
      saveCurrentSourceWaterInputs();
      updateSourceAlkalinityFromBicarbonate();
      renderSourceReadonlyTags();
      onChanged();
    });
  });

  sourceProfileNameInput.addEventListener("input", updateSourceProfileNameError);
  bindEnterToClick(sourceProfileNameInput, sourceSaveBtn);

  sourceSaveBtn.addEventListener("click", function() {
    var validation = validateProfileName(sourceProfileNameInput.value, {
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
    var key = validation.key;
    var name = validation.name;
    if (!key || !name) {
      updateSourceProfileNameError();
      return;
    }
    document.getElementById("source-profile-name-error").textContent = "";
    var profiles = loadCustomProfiles();
    var profile = { label: name };
    ION_FIELDS.forEach(function(ion) {
      profile[ion] = parseFloat(document.getElementById("src-" + ion).value) || 0;
    });
    profiles[key] = profile;
    saveCustomProfiles(profiles);
    renderSourcePresetButtons();
    activateSourcePreset(key);
    sourceProfileNameInput.value = "";
    updateSourceProfileNameError();
    showSourceSaveStatus("Saved!", false);
    onChanged();
  });

  sourceSaveChangesBtn.addEventListener("click", function() {
    showConfirm("Are you sure you want to change this profile?", function() {
      var allPresets = getAllPresets();
      var existing = allPresets[activeSourcePreset];
      if (!existing) return;
      var profile = { label: existing.label };
      ION_FIELDS.forEach(function(ion) {
        profile[ion] = parseFloat(document.getElementById("src-" + ion).value) || 0;
      });
      var profiles = loadCustomProfiles();
      profiles[activeSourcePreset] = profile;
      saveCustomProfiles(profiles);
      sourceEditBar.style.display = "none";
      renderSourcePresetButtons();
      showSourceSaveStatus("Saved!", false);
      onChanged();
    });
  });

  // --- Initialize ---
  var sourceWater = loadSourceWater();
  ION_FIELDS.forEach(function(ion) {
    var input = document.getElementById("src-" + ion);
    if (input) input.value = sourceWater[ion] || 0;
  });
  updateSourceAlkalinityFromBicarbonate();
  renderSourcePresetButtons();
  updateSourceModeUI();
  updateRestoreSourceBar();
  updateSourceProfileNameError();
  var allSourcePresets = getAllPresets();
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
