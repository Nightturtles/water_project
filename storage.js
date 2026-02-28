// ============================================
// Storage — localStorage helpers and caches
// ============================================

// --- Safe localStorage wrappers (Bug 4) ---
function safeGetItem(key) {
  try { return localStorage.getItem(key); } catch(e) { return null; }
}
function safeSetItem(key, value) {
  try { localStorage.setItem(key, value); return true; } catch(e) { return false; }
}
function safeRemoveItem(key) {
  try { localStorage.removeItem(key); } catch(e) {}
}

// --- JSON parse helper ---
function safeParse(json, fallback) {
  if (!json) return fallback;
  try {
    const parsed = JSON.parse(json);
    return parsed ?? fallback;
  } catch (_) {
    return fallback;
  }
}

// --- Source water ---
function saveSourceWater(profile) {
  safeSetItem("cw_source_water", JSON.stringify(profile));
}

function loadSourceWater() {
  const fallback = { calcium: 0, magnesium: 0, potassium: 0, sodium: 0, sulfate: 0, chloride: 0, bicarbonate: 0 };
  const parsed = safeParse(safeGetItem("cw_source_water"), fallback);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
}

function saveSourcePresetName(name) {
  safeSetItem("cw_source_preset", name);
}

function loadSourcePresetName() {
  return safeGetItem("cw_source_preset") || "distilled";
}

// --- Mineral display mode ---
function saveMineralDisplayMode(mode) {
  safeSetItem("cw_mineral_display_mode", mode === "advanced" ? "advanced" : "standard");
}

function loadMineralDisplayMode() {
  return safeGetItem("cw_mineral_display_mode") === "advanced" ? "advanced" : "standard";
}

function isAdvancedMineralDisplayMode() {
  return loadMineralDisplayMode() === "advanced";
}

// --- Volume preference ---
function saveVolumePreference(pageKey, value, unit) {
  if (!pageKey) return;
  const key = "cw_volume_" + pageKey;
  const payload = {
    value: String(value ?? ""),
    unit: unit === "gallons" ? "gallons" : "liters"
  };
  safeSetItem(key, JSON.stringify(payload));
}

function loadVolumePreference(pageKey, defaults = {}) {
  const fallback = {
    value: String(defaults.value ?? "1"),
    unit: defaults.unit === "gallons" ? "gallons" : "liters"
  };
  if (!pageKey) return fallback;
  const key = "cw_volume_" + pageKey;
  const parsed = safeParse(safeGetItem(key), fallback);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
  const value = String(parsed.value ?? fallback.value);
  const unit = parsed.unit === "gallons" ? "gallons" : "liters";
  return { value, unit };
}

// --- Slugify ---
function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// --- Custom source profiles + cache ---
let customProfilesCache = null;

function loadCustomProfiles() {
  if (customProfilesCache) return Object.assign({}, customProfilesCache);
  const parsed = safeParse(safeGetItem("cw_custom_profiles"), {});
  customProfilesCache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  return Object.assign({}, customProfilesCache);
}

function saveCustomProfiles(profiles) {
  const ok = safeSetItem("cw_custom_profiles", JSON.stringify(profiles));
  customProfilesCache = null;
  invalidateSourcePresetsCache();
  return ok;
}

function deleteCustomProfile(key) {
  const profiles = loadCustomProfiles();
  delete profiles[key];
  saveCustomProfiles(profiles);
}

// --- Deleted source preset tracking ---
function loadDeletedPresets() {
  const parsed = safeParse(safeGetItem("cw_deleted_presets"), []);
  return Array.isArray(parsed) ? parsed : [];
}

function addDeletedPreset(key) {
  const deleted = loadDeletedPresets();
  if (!deleted.includes(key)) {
    deleted.push(key);
    safeSetItem("cw_deleted_presets", JSON.stringify(deleted));
    invalidateSourcePresetsCache();
  }
}

// --- Custom target profiles + cache ---
let customTargetProfilesCache = null;

function loadCustomTargetProfiles() {
  if (customTargetProfilesCache) return Object.assign({}, customTargetProfilesCache);
  const parsed = safeParse(safeGetItem("cw_custom_target_profiles"), {});
  customTargetProfilesCache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  return Object.assign({}, customTargetProfilesCache);
}

function saveCustomTargetProfiles(profiles) {
  const ok = safeSetItem("cw_custom_target_profiles", JSON.stringify(profiles));
  customTargetProfilesCache = null;
  invalidateTargetPresetsCache();
  return ok;
}

function deleteCustomTargetProfile(key) {
  const profiles = loadCustomTargetProfiles();
  delete profiles[key];
  saveCustomTargetProfiles(profiles);
}

// --- Deleted target preset tracking ---
function loadDeletedTargetPresets() {
  const parsed = safeParse(safeGetItem("cw_deleted_target_presets"), []);
  return Array.isArray(parsed) ? parsed : [];
}

function addDeletedTargetPreset(key) {
  const deleted = loadDeletedTargetPresets();
  if (!deleted.includes(key)) {
    deleted.push(key);
    safeSetItem("cw_deleted_target_presets", JSON.stringify(deleted));
    invalidateTargetPresetsCache();
  }
}

// --- Label helpers (for unique name enforcement) ---
function getExistingTargetProfileLabels() {
  const deleted = loadDeletedTargetPresets();
  const custom = loadCustomTargetProfiles();
  const labels = new Set();
  for (const key of BUILTIN_TARGET_KEYS) {
    if (!deleted.includes(key) && BUILTIN_TARGET_LABELS[key]) {
      labels.add(BUILTIN_TARGET_LABELS[key].trim().toLowerCase());
    }
  }
  for (const profile of Object.values(custom)) {
    if (profile && profile.label) {
      labels.add(profile.label.trim().toLowerCase());
    }
  }
  return labels;
}

function getExistingSourceProfileLabels() {
  const allPresets = getAllPresets();
  const labels = new Set();
  for (const profile of Object.values(allPresets)) {
    if (profile && profile.label) {
      labels.add(profile.label.trim().toLowerCase());
    }
  }
  return labels;
}

// --- Target preset name ---
function saveTargetPresetName(name) {
  safeSetItem("cw_target_preset", name);
}

function loadTargetPresetName() {
  return safeGetItem("cw_target_preset") || "sca";
}

// --- Brew method preference ---
function normalizeBrewMethod(method) {
  return method === "espresso" ? "espresso" : "filter";
}

function saveBrewMethod(method) {
  safeSetItem("cw_brew_method", normalizeBrewMethod(method));
}

function loadBrewMethod() {
  return normalizeBrewMethod(safeGetItem("cw_brew_method"));
}

// --- Source presets aggregation + cache ---
let sourcePresetsCache = null;
function invalidateSourcePresetsCache() {
  sourcePresetsCache = null;
}

function getAllPresets() {
  if (sourcePresetsCache) return sourcePresetsCache;
  const custom = loadCustomProfiles();
  const deleted = loadDeletedPresets();
  const result = {};
  for (const [key, value] of Object.entries(SOURCE_PRESETS)) {
    if (key === "custom") {
      for (const [ck, cv] of Object.entries(custom)) {
        if (!SOURCE_PRESETS[ck]) {
          result[ck] = cv;
        }
      }
      result[key] = value;
      continue;
    }
    if (deleted.includes(key)) continue;
    result[key] = custom[key] || value;
  }
  sourcePresetsCache = result;
  return sourcePresetsCache;
}

function getSourceWaterByPreset(presetName) {
  if (presetName === "custom") {
    return loadSourceWater();
  }
  const customProfiles = loadCustomProfiles();
  const preset = customProfiles[presetName] || SOURCE_PRESETS[presetName];
  if (!preset) return loadSourceWater();
  const { label, ...ions } = preset;
  return ions;
}

// --- Selected minerals + cache ---
let selectedMineralsCache = null;

function saveSelectedMinerals(mineralIds) {
  safeSetItem("cw_selected_minerals", JSON.stringify(mineralIds));
  selectedMineralsCache = null;
}

function loadSelectedMinerals() {
  if (selectedMineralsCache) return selectedMineralsCache;
  const parsed = safeParse(safeGetItem("cw_selected_minerals"), null);
  selectedMineralsCache = Array.isArray(parsed) ? parsed : ["calcium-chloride", "epsom-salt", "baking-soda", "potassium-bicarbonate"];
  return selectedMineralsCache;
}

// --- Mineral source preferences ---
// Legacy: no longer used by UI; kept for backward compatibility when loading old data.
function saveAlkalinitySource(mineralId) {
  safeSetItem("cw_alkalinity_source", mineralId);
}

function loadAlkalinitySource() {
  const saved = safeGetItem("cw_alkalinity_source");
  if (saved === "potassium-bicarbonate") return "potassium-bicarbonate";
  return "baking-soda";
}

/** Returns an array of enabled alkalinity source mineral ids (baking-soda and/or potassium-bicarbonate). */
function getEffectiveAlkalinitySources() {
  const selected = loadSelectedMinerals();
  const hasBakingSoda = selected.includes("baking-soda");
  const hasPotBicarb = selected.includes("potassium-bicarbonate");
  if (!hasBakingSoda && !hasPotBicarb) return [];
  if (hasBakingSoda && hasPotBicarb) return ["baking-soda", "potassium-bicarbonate"];
  if (hasBakingSoda) return ["baking-soda"];
  return ["potassium-bicarbonate"];
}

// Legacy: no longer used by UI; kept for backward compatibility.
function saveCalciumSource(mineralId) {
  safeSetItem("cw_calcium_source", mineralId);
}

function loadCalciumSource() {
  const saved = safeGetItem("cw_calcium_source");
  if (saved === "gypsum") return "gypsum";
  return "calcium-chloride";
}

function saveMagnesiumSource(mineralId) {
  safeSetItem("cw_magnesium_source", mineralId);
}

function loadMagnesiumSource() {
  const saved = safeGetItem("cw_magnesium_source");
  if (saved === "magnesium-chloride") return "magnesium-chloride";
  return "epsom-salt";
}

/** Returns an array of enabled calcium source mineral ids (calcium-chloride and/or gypsum). */
function getEffectiveCalciumSources() {
  const selected = loadSelectedMinerals();
  const out = [];
  if (selected.includes("calcium-chloride")) out.push("calcium-chloride");
  if (selected.includes("gypsum")) out.push("gypsum");
  return out;
}

/** Returns an array of enabled magnesium source mineral ids (epsom-salt and/or magnesium-chloride). */
function getEffectiveMagnesiumSources() {
  const selected = loadSelectedMinerals();
  const out = [];
  if (selected.includes("epsom-salt")) out.push("epsom-salt");
  if (selected.includes("magnesium-chloride")) out.push("magnesium-chloride");
  return out;
}

// --- Effective mineral sources ---
/** Returns a single alkalinity source when only one is enabled; when both are enabled returns "potassium-bicarbonate" as fallback; when none, null. Use getEffectiveAlkalinitySources() when both can contribute. */
function getEffectiveAlkalinitySource() {
  const sources = getEffectiveAlkalinitySources();
  if (sources.length === 0) return null;
  if (sources.length === 1) return sources[0];
  return "potassium-bicarbonate";
}

/** Returns a single calcium source when only one is enabled; when both enabled returns "calcium-chloride" (tie-breaker); when none, null. */
function getEffectiveCalciumSource() {
  const sources = getEffectiveCalciumSources();
  if (sources.length === 0) return null;
  if (sources.length === 1) return sources[0];
  return "calcium-chloride";
}

/** Returns a single magnesium source when only one is enabled; when both enabled returns "epsom-salt" (tie-breaker); when none, null. */
function getEffectiveMagnesiumSource() {
  const sources = getEffectiveMagnesiumSources();
  if (sources.length === 0) return null;
  if (sources.length === 1) return sources[0];
  return "epsom-salt";
}

// --- Target presets aggregation + cache ---
let targetPresetsCache = null;
function invalidateTargetPresetsCache() {
  targetPresetsCache = null;
}

function getAllTargetPresets() {
  if (targetPresetsCache) return targetPresetsCache;
  const custom = loadCustomTargetProfiles();
  const deleted = loadDeletedTargetPresets();
  const result = {};
  for (const [key, value] of Object.entries(TARGET_PRESETS)) {
    if (deleted.includes(key)) continue;
    result[key] = custom[key] || value;
  }
  for (const [ck, cv] of Object.entries(custom)) {
    if (!TARGET_PRESETS[ck]) {
      result[ck] = cv;
    }
  }
  result["custom"] = { label: "Custom Recipe" };
  targetPresetsCache = result;
  return targetPresetsCache;
}

function getTargetProfileByKey(key) {
  if (key === "custom") return null;
  const custom = loadCustomTargetProfiles();
  return custom[key] || TARGET_PRESETS[key] || null;
}

function inferTargetProfileBrewMethod(key, profile) {
  if (profile && (profile.brewMethod === "filter" || profile.brewMethod === "espresso")) {
    return profile.brewMethod;
  }
  if (typeof key === "string" && (key.startsWith("eaf-") || key.includes("espresso"))) {
    return "espresso";
  }
  const label = (profile && profile.label ? String(profile.label) : "").toLowerCase();
  const description = (profile && profile.description ? String(profile.description) : "").toLowerCase();
  if (label.includes("espresso") || description.includes("espresso")) {
    return "espresso";
  }
  return "filter";
}

function targetProfileSupportsBrewMethod(key, profile, method) {
  const brewMethod = normalizeBrewMethod(method);
  if (profile && Array.isArray(profile.brewMethods)) {
    const allowed = new Set(
      profile.brewMethods
        .map((value) => normalizeBrewMethod(value))
        .filter((value, index, array) => array.indexOf(value) === index)
    );
    return allowed.has(brewMethod);
  }
  return inferTargetProfileBrewMethod(key, profile) === brewMethod;
}

function getTargetPresetsForBrewMethod(method) {
  const brewMethod = normalizeBrewMethod(method);
  const allPresets = getAllTargetPresets();
  const filtered = {};
  for (const [key, profile] of Object.entries(allPresets)) {
    if (key === "custom") {
      filtered[key] = profile;
      continue;
    }
    if (targetProfileSupportsBrewMethod(key, profile, brewMethod)) {
      filtered[key] = profile;
    }
  }
  if (!filtered.custom) {
    filtered.custom = { label: "Custom Recipe" };
  }
  return filtered;
}

// --- Profile name validation ---
function validateProfileName(rawName, options = {}) {
  const allowEmpty = !!options.allowEmpty;
  const emptyMessage = options.emptyMessage || "Enter a profile name.";
  const invalidMessage = options.invalidMessage || "Enter a valid name.";
  const reservedMessage = options.reservedMessage || "That name is reserved. Choose a different name.";
  const duplicateMessage = options.duplicateMessage || "A profile with this name already exists.";
  const name = (rawName || "").trim();

  if (!name) {
    return allowEmpty
      ? { ok: true, key: "", name: "", empty: true }
      : { ok: false, code: "empty", message: emptyMessage };
  }

  const key = slugify(name);
  if (!key) {
    return { ok: false, code: "invalid", message: invalidMessage };
  }

  const builtinKeys = options.builtinKeys || [];
  const builtinKeySet = builtinKeys instanceof Set ? builtinKeys : new Set(builtinKeys);
  if (builtinKeySet.has(key)) {
    return { ok: false, code: "reserved", message: reservedMessage };
  }

  const existingKeys = options.existingKeys || [];
  const existingKeySet = existingKeys instanceof Set ? existingKeys : new Set(existingKeys);
  if (existingKeySet.has(key)) {
    return { ok: false, code: "duplicate", message: duplicateMessage };
  }

  const existingLabels = options.existingLabels || [];
  const existingLabelSet = existingLabels instanceof Set ? existingLabels : new Set(existingLabels);
  if (existingLabelSet.has(name.toLowerCase())) {
    return { ok: false, code: "duplicate", message: duplicateMessage };
  }

  return { ok: true, key, name };
}

function validateTargetProfileName(rawName, options = {}) {
  return validateProfileName(rawName, {
    allowEmpty: options.allowEmpty,
    builtinKeys: RESERVED_TARGET_KEYS,
    existingKeys: new Set(Object.keys(loadCustomTargetProfiles())),
    existingLabels: getExistingTargetProfileLabels()
  });
}

// --- Restore defaults ---
function restoreSourcePresetDefaults() {
  safeRemoveItem("cw_deleted_presets");
  const custom = loadCustomProfiles();
  for (const key of Object.keys(SOURCE_PRESETS)) {
    if (key === "custom") continue;
    delete custom[key];
  }
  saveCustomProfiles(custom);
}

function restoreTargetPresetDefaults() {
  safeRemoveItem("cw_deleted_target_presets");
  const custom = loadCustomTargetProfiles();
  for (const key of BUILTIN_TARGET_KEYS) {
    delete custom[key];
  }
  saveCustomTargetProfiles(custom);
}

// --- Theme ---
function loadThemePreference() {
  const saved = safeGetItem(THEME_KEY);
  if (saved === "light" || saved === "dark" || saved === "system") return saved;
  return "system";
}

function saveThemePreference(mode) {
  safeSetItem(THEME_KEY, mode);
}

// --- Calculator welcome modal (one-time) ---
const WELCOME_MODAL_DISMISSED_KEY = "cw_calculator_welcome_dismissed";

function loadCalculatorWelcomeDismissed() {
  return safeGetItem(WELCOME_MODAL_DISMISSED_KEY) === "true";
}

function saveCalculatorWelcomeDismissed() {
  safeSetItem(WELCOME_MODAL_DISMISSED_KEY, "true");
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

// --- Multi-tab cache invalidation (Inefficiency 4) ---
window.addEventListener("storage", function(e) {
  if (!e.key) return;
  if (e.key === "cw_custom_profiles") { customProfilesCache = null; invalidateSourcePresetsCache(); }
  if (e.key === "cw_custom_target_profiles") { customTargetProfilesCache = null; invalidateTargetPresetsCache(); }
  if (e.key === "cw_selected_minerals") { selectedMineralsCache = null; }
  if (e.key === "cw_deleted_presets") { invalidateSourcePresetsCache(); }
  if (e.key === "cw_deleted_target_presets") { invalidateTargetPresetsCache(); }
});
