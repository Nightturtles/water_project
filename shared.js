// ============================================
// Shared utilities across all pages
// ============================================

// --- Mineral database ---
// Each mineral salt and the ions it contributes per gram dissolved in 1 liter
const MINERAL_DB = {
  "calcium-chloride": {
    name: "Calcium Chloride",
    formula: "CaCl\u2082\u00b72H\u2082O",
    mw: 147.01,
    description: "Adds calcium and chloride. Increases sweetness and body.",
    ions: {
      calcium:  40.078  / 147.01,  // g Ca per g salt
      chloride: 70.906  / 147.01   // g Cl per g salt (2 * 35.453)
    }
  },
  "epsom-salt": {
    name: "Epsom Salt",
    formula: "MgSO\u2084\u00b77H\u2082O",
    mw: 246.47,
    description: "Adds magnesium and sulfate. Enhances fruity notes and clarity.",
    ions: {
      magnesium: 24.305  / 246.47,
      sulfate:   96.06   / 246.47
    }
  },
  "baking-soda": {
    name: "Baking Soda",
    formula: "NaHCO\u2083",
    mw: 84.007,
    description: "Adds sodium and bicarbonate (alkalinity/KH). Buffers acidity.",
    ions: {
      sodium:      22.99   / 84.007,
      bicarbonate: 61.017  / 84.007
    }
  },
  "potassium-bicarbonate": {
    name: "Potassium Bicarbonate",
    formula: "KHCO\u2083",
    mw: 100.115,
    description: "Sodium-free alkalinity source. Adds potassium and bicarbonate.",
    ions: {
      potassium:   39.098  / 100.115,
      bicarbonate: 61.017  / 100.115
    }
  },
  "magnesium-chloride": {
    name: "Magnesium Chloride",
    formula: "MgCl\u2082\u00b76H\u2082O",
    mw: 203.30,
    description: "Adds magnesium and chloride. Fruity notes with added body.",
    ions: {
      magnesium: 24.305  / 203.30,
      chloride:  70.906  / 203.30
    }
  },
  "gypsum": {
    name: "Gypsum",
    formula: "CaSO\u2084\u00b72H\u2082O",
    mw: 172.17,
    description: "Adds calcium and sulfate. Sweetness with crisp clarity.",
    ions: {
      calcium: 40.078  / 172.17,
      sulfate: 96.06   / 172.17
    }
  },
  "potassium-chloride": {
    name: "Potassium Chloride",
    formula: "KCl",
    mw: 74.551,
    description: "Adds potassium and chloride. Salt substitute, adds body.",
    ions: {
      potassium: 39.098  / 74.551,
      chloride:  35.453  / 74.551
    }
  },
  "sodium-chloride": {
    name: "Sodium Chloride",
    formula: "NaCl",
    mw: 58.44,
    description: "Table salt. Adds sodium and chloride. Small amounts enhance sweetness.",
    ions: {
      sodium:   22.99   / 58.44,
      chloride: 35.453  / 58.44
    }
  }
};

// --- Shared ion field list and labels ---
const ION_FIELDS = ["calcium", "magnesium", "potassium", "sodium", "sulfate", "chloride", "bicarbonate"];
const ION_LABELS = { calcium: "Ca", magnesium: "Mg", potassium: "K", sodium: "Na", sulfate: "SO\u2084", chloride: "Cl", bicarbonate: "HCO\u2083" };

// --- Source water presets ---
const SOURCE_PRESETS = {
  distilled: {
    label: "Distilled / RO",
    calcium: 0, magnesium: 0, potassium: 0, sodium: 0,
    sulfate: 0, chloride: 0, bicarbonate: 0
  },
  "soft-tap": {
    label: "Soft Tap Water",
    calcium: 15, magnesium: 3, potassium: 1, sodium: 10,
    sulfate: 5, chloride: 12, bicarbonate: 30
  },
  "hard-tap": {
    label: "Hard Tap Water",
    calcium: 60, magnesium: 15, potassium: 2, sodium: 20,
    sulfate: 25, chloride: 30, bicarbonate: 120
  },
  custom: {
    label: "Custom"
  }
};

// --- localStorage helpers ---
function safeParse(json, fallback) {
  if (!json) return fallback;
  try {
    const parsed = JSON.parse(json);
    return parsed ?? fallback;
  } catch (_) {
    return fallback;
  }
}

function saveSourceWater(profile) {
  localStorage.setItem("cw_source_water", JSON.stringify(profile));
}

function loadSourceWater() {
  const fallback = { calcium: 0, magnesium: 0, potassium: 0, sodium: 0, sulfate: 0, chloride: 0, bicarbonate: 0 };
  const parsed = safeParse(localStorage.getItem("cw_source_water"), fallback);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
}

function saveSourcePresetName(name) {
  localStorage.setItem("cw_source_preset", name);
}

function loadSourcePresetName() {
  return localStorage.getItem("cw_source_preset") || "distilled";
}

function initSourcePresetSelect(selectEl) {
  if (!selectEl) return null;
  selectEl.innerHTML = "";
  const presetEntries = Object.entries(getAllPresets()).filter(([key]) => key !== "custom");
  for (const [key, preset] of presetEntries) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = preset.label;
    selectEl.appendChild(opt);
  }
  const savedPreset = loadSourcePresetName();
  const validKeys = presetEntries.map(([k]) => k);
  const fallback = validKeys[0] || null;
  const selectedPreset = validKeys.includes(savedPreset) ? savedPreset : fallback;
  if (selectedPreset) {
    selectEl.value = selectedPreset;
    if (selectedPreset !== savedPreset) {
      saveSourcePresetName(selectedPreset);
    }
  }
  return selectedPreset;
}

function renderSourceWaterTags(tagsEl, water) {
  if (!tagsEl) return;
  const nonZero = getVisibleIonFields().filter(ion => (water && water[ion]) > 0);
  const metrics = water ? calculateMetrics(water) : { kh: 0 };
  const alk = metrics.kh;
  const alkDisplay = (alk == null || alk !== alk) ? "\u2014" : Math.round(alk);
  const alkTag = `<span class="base-tag">Alkalinity: ${alkDisplay} mg/L as CaCO\u2083</span>`;
  if (nonZero.length === 0) {
    tagsEl.innerHTML = '<span class="base-tag">All zeros</span>' + alkTag;
    return;
  }
  tagsEl.innerHTML = nonZero
    .map(ion => `<span class="base-tag">${ION_LABELS[ion]}: ${water[ion]} mg/L</span>`)
    .join("") + alkTag;
}

function createStatusHandler(statusEl, options = {}) {
  const successMs = options.successMs || 1500;
  const errorMs = options.errorMs || 3000;
  let timer = null;
  return function showStatus(message, isError) {
    if (!statusEl) return;
    clearTimeout(timer);
    statusEl.textContent = message;
    statusEl.classList.toggle("error", isError);
    statusEl.classList.add("visible");
    timer = setTimeout(() => {
      statusEl.classList.remove("visible", "error");
    }, isError ? errorMs : successMs);
  };
}

function saveMineralDisplayMode(mode) {
  localStorage.setItem("cw_mineral_display_mode", mode === "advanced" ? "advanced" : "standard");
}

function loadMineralDisplayMode() {
  return localStorage.getItem("cw_mineral_display_mode") === "advanced" ? "advanced" : "standard";
}

function isAdvancedMineralDisplayMode() {
  return loadMineralDisplayMode() === "advanced";
}

function getVisibleIonFields() {
  if (isAdvancedMineralDisplayMode()) {
    return ["calcium", "magnesium", "potassium", "sodium", "sulfate", "chloride"];
  }
  return ["calcium", "magnesium"];
}

function applyMineralDisplayMode() {
  const body = document.body;
  if (!body) return;
  const advanced = isAdvancedMineralDisplayMode();
  body.classList.toggle("advanced-minerals", advanced);
  body.classList.toggle("standard-minerals", !advanced);
}

function saveVolumePreference(pageKey, value, unit) {
  if (!pageKey) return;
  const key = "cw_volume_" + pageKey;
  const payload = {
    value: String(value ?? ""),
    unit: unit === "gallons" ? "gallons" : "liters"
  };
  localStorage.setItem(key, JSON.stringify(payload));
}

function loadVolumePreference(pageKey, defaults = {}) {
  const fallback = {
    value: String(defaults.value ?? "1"),
    unit: defaults.unit === "gallons" ? "gallons" : "liters"
  };
  if (!pageKey) return fallback;
  const key = "cw_volume_" + pageKey;
  const parsed = safeParse(localStorage.getItem(key), fallback);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
  const value = String(parsed.value ?? fallback.value);
  const unit = parsed.unit === "gallons" ? "gallons" : "liters";
  return { value, unit };
}

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

function bindEnterToClick(inputEl, buttonEl) {
  if (!inputEl || !buttonEl) return;
  inputEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    buttonEl.click();
  });
}

// --- Custom profile helpers ---
function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

let customProfilesCache = null;

function loadCustomProfiles() {
  if (customProfilesCache) return customProfilesCache;
  const parsed = safeParse(localStorage.getItem("cw_custom_profiles"), {});
  customProfilesCache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  return customProfilesCache;
}

function saveCustomProfiles(profiles) {
  localStorage.setItem("cw_custom_profiles", JSON.stringify(profiles));
  customProfilesCache = null;
  invalidateSourcePresetsCache();
}

function deleteCustomProfile(key) {
  const profiles = loadCustomProfiles();
  delete profiles[key];
  saveCustomProfiles(profiles);
}

// --- Deleted preset tracking (for hiding built-in presets) ---
function loadDeletedPresets() {
  const parsed = safeParse(localStorage.getItem("cw_deleted_presets"), []);
  return Array.isArray(parsed) ? parsed : [];
}

function addDeletedPreset(key) {
  const deleted = loadDeletedPresets();
  if (!deleted.includes(key)) {
    deleted.push(key);
    localStorage.setItem("cw_deleted_presets", JSON.stringify(deleted));
    invalidateSourcePresetsCache();
  }
}

// --- Target water presets (Ca/Mg/Alk targets for coffee water) ---
const TARGET_PRESETS = {
  sca: {
    label: "SCA Standard",
    calcium: 51,
    magnesium: 17,
    alkalinity: 40,
    description: "SCA recommended range for brewing water. Balanced body and clarity."
  },
  "lotus-light-bright": {
    label: "Light and Bright",
    calcium: 24,
    magnesium: 0,
    alkalinity: 30,
    description: "Lotus recipe emphasizing high clarity and acidity for lighter coffees."
  },
  "lotus-simple-sweet": {
    label: "Simple and Sweet",
    calcium: 21.6,
    magnesium: 8.7,
    alkalinity: 40,
    description: "Lotus balanced profile with added sweetness and approachable acidity."
  },
  "lotus-light-bright-espresso": {
    label: "Light and Bright (espresso)",
    calcium: 0,
    magnesium: 4.9,
    alkalinity: 50,
    description: "Lotus espresso profile for clarity-forward shots with restrained hardness."
  },
  "lotus-simple-sweet-espresso": {
    label: "Simple and Sweet (espresso)",
    calcium: 0,
    magnesium: 4.9,
    alkalinity: 55,
    description: "Lotus espresso profile with higher buffer for sweeter, rounder shots."
  },
  "lotus-bright-juicy": {
    label: "Bright and Juicy",
    calcium: 14.4,
    magnesium: 8.7,
    alkalinity: 18,
    description: "Lotus profile tuned for vivid acidity, fruit-forward cups, and high clarity."
  },
  rao: {
    label: "Rao's Recipe",
    calcium: 20.9,
    magnesium: 8.5,
    alkalinity: 40,
    description: "Lotus-style Rao recipe target with balanced sweetness and structure."
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

const NON_EDITABLE_TARGET_KEYS = ["sca", "rao"];

// --- Custom target profile helpers ---
const BUILTIN_TARGET_KEYS = Object.keys(TARGET_PRESETS);
const RESERVED_TARGET_KEYS = new Set([...BUILTIN_TARGET_KEYS, "custom"]);
const BUILTIN_TARGET_LABELS = {};
for (const [key, preset] of Object.entries(TARGET_PRESETS)) {
  BUILTIN_TARGET_LABELS[key] = preset.label;
}

function isReservedTargetKey(key) {
  return RESERVED_TARGET_KEYS.has(key);
}

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

let customTargetProfilesCache = null;

function loadCustomTargetProfiles() {
  if (customTargetProfilesCache) return customTargetProfilesCache;
  const parsed = safeParse(localStorage.getItem("cw_custom_target_profiles"), {});
  customTargetProfilesCache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  return customTargetProfilesCache;
}

function saveCustomTargetProfiles(profiles) {
  localStorage.setItem("cw_custom_target_profiles", JSON.stringify(profiles));
  customTargetProfilesCache = null;
  invalidateTargetPresetsCache();
}

function deleteCustomTargetProfile(key) {
  const profiles = loadCustomTargetProfiles();
  delete profiles[key];
  saveCustomTargetProfiles(profiles);
}

function loadDeletedTargetPresets() {
  const parsed = safeParse(localStorage.getItem("cw_deleted_target_presets"), []);
  return Array.isArray(parsed) ? parsed : [];
}

function addDeletedTargetPreset(key) {
  const deleted = loadDeletedTargetPresets();
  if (!deleted.includes(key)) {
    deleted.push(key);
    localStorage.setItem("cw_deleted_target_presets", JSON.stringify(deleted));
    invalidateTargetPresetsCache();
  }
}

// Returns a Set of lowercased display names for existing target profiles (built-in non-deleted + custom). Used to enforce unique names.
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

// Returns a Set of lowercased display names for existing source/starting water profiles. Used to enforce unique names.
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

function saveTargetPresetName(name) {
  localStorage.setItem("cw_target_preset", name);
}

function loadTargetPresetName() {
  return localStorage.getItem("cw_target_preset") || "sca";
}

// Returns built-in presets merged with saved custom profiles.
// Built-in presets can be overridden by custom profiles with the same key.
// Deleted built-in presets are filtered out.
// Custom-only profiles are inserted before the "custom" entry.
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
      // Insert custom-only profiles before the "Custom" entry
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

// Returns the ion values for a given preset name (or custom from localStorage)
function getSourceWaterByPreset(presetName) {
  if (presetName === "custom") {
    return loadSourceWater();
  }
  // Check custom profiles first (overrides), then built-in presets
  const customProfiles = loadCustomProfiles();
  const preset = customProfiles[presetName] || SOURCE_PRESETS[presetName];
  if (!preset) return loadSourceWater();
  const { label, ...ions } = preset;
  return ions;
}

function saveSelectedMinerals(mineralIds) {
  localStorage.setItem("cw_selected_minerals", JSON.stringify(mineralIds));
}

function saveAlkalinitySource(mineralId) {
  localStorage.setItem("cw_alkalinity_source", mineralId);
}

function loadAlkalinitySource() {
  const saved = localStorage.getItem("cw_alkalinity_source");
  if (saved === "potassium-bicarbonate") return "potassium-bicarbonate";
  return "baking-soda"; // default
}

function saveCalciumSource(mineralId) {
  localStorage.setItem("cw_calcium_source", mineralId);
}

function loadCalciumSource() {
  const saved = localStorage.getItem("cw_calcium_source");
  if (saved === "gypsum") return "gypsum";
  return "calcium-chloride"; // default
}

function saveMagnesiumSource(mineralId) {
  localStorage.setItem("cw_magnesium_source", mineralId);
}

function loadMagnesiumSource() {
  const saved = localStorage.getItem("cw_magnesium_source");
  if (saved === "magnesium-chloride") return "magnesium-chloride";
  return "epsom-salt"; // default
}

function loadSelectedMinerals() {
  const parsed = safeParse(localStorage.getItem("cw_selected_minerals"), null);
  if (Array.isArray(parsed)) return parsed;
  // Default selection
  return ["calcium-chloride", "epsom-salt", "baking-soda", "potassium-bicarbonate"];
}

function restoreSourcePresetDefaults() {
  localStorage.removeItem("cw_deleted_presets");
  const custom = loadCustomProfiles();
  for (const key of Object.keys(SOURCE_PRESETS)) {
    if (key === "custom") continue;
    delete custom[key];
  }
  saveCustomProfiles(custom);
}

function restoreTargetPresetDefaults() {
  localStorage.removeItem("cw_deleted_target_presets");
  const custom = loadCustomTargetProfiles();
  for (const key of BUILTIN_TARGET_KEYS) {
    delete custom[key];
  }
  saveCustomTargetProfiles(custom);
}

// --- Navigation ---
function injectNav() {
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  const pages = [
    { href: "index.html",    label: "Calculator" },
    { href: "recipe.html",   label: "Recipe Builder" },
    { href: "taste.html",    label: "Taste Tuner" },
    { href: "minerals.html", label: "Settings" }
  ];

  const nav = document.createElement("nav");
  nav.className = "site-nav";
  nav.innerHTML = pages.map(p =>
    `<a href="${p.href}" class="${currentPage === p.href ? "active" : ""}">${p.label}</a>`
  ).join("");

  document.body.insertBefore(nav, document.body.firstChild);
}

// --- Unit conversion ---
const GALLONS_TO_LITERS = 3.78541;

// --- Conversion constants (single source of truth for GH/KH/TDS) ---
// CaCO3 MW = 100.09; equivalent weights for hardness/alkalinity
const CA_TO_CACO3 = 100.09 / 40.078;   // Ca ppm -> GH contribution (mg/L as CaCO3)
const MG_TO_CACO3 = 100.09 / 24.305;   // Mg ppm -> GH contribution (mg/L as CaCO3)
const HCO3_TO_CACO3 = 50.045 / 61.017; // HCO3 ppm -> KH (mg/L as CaCO3)
const CACO3_TO_HCO3 = 61.017 / 50.045; // KH (mg/L as CaCO3) -> bicarbonate ppm
const MW_CACO3 = 100.09;               // Molecular weight of CaCO3
const ALK_TO_BAKING_SODA = 2 * MINERAL_DB["baking-soda"].mw / MW_CACO3;
const ALK_TO_POTASSIUM_BICARB = 2 * MINERAL_DB["potassium-bicarbonate"].mw / MW_CACO3;

// --- Ion calculation from grams of minerals ---
// Given an object { mineralId: gramsPerLiter, ... }, returns ion PPMs
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

function roundDelta(delta, decimals = 0) {
  if (!Number.isFinite(delta)) return null;
  if (decimals > 0) {
    const p = Math.pow(10, decimals);
    const rounded = Math.round(delta * p) / p;
    return Object.is(rounded, -0) ? 0 : rounded;
  }
  const rounded = Math.round(delta);
  return Object.is(rounded, -0) ? 0 : rounded;
}

function formatDelta(delta, decimals = 0) {
  const rounded = roundDelta(delta, decimals);
  if (rounded == null) return "—";
  const abs = decimals > 0 ? Math.abs(rounded).toFixed(decimals) : String(Math.abs(rounded));
  if (rounded > 0) return "+" + abs;
  if (rounded < 0) return "-" + abs;
  return decimals > 0 ? Number(0).toFixed(decimals) : "0";
}

function setDeltaText(el, delta, options = {}) {
  if (!el) return;
  const decimals = options.decimals || 0;
  const metricName = options.metricName || "Value";
  const baselineLabel = options.baselineLabel || "baseline";
  const visibleBaselineLabel = options.visibleBaselineLabel || "";
  const unit = options.unit ? " " + options.unit : "";
  const rounded = roundDelta(delta, decimals);
  const deltaText = formatDelta(delta, decimals);
  el.textContent = visibleBaselineLabel ? `${deltaText} vs ${visibleBaselineLabel}` : deltaText;
  el.classList.remove("positive", "negative");
  if (rounded == null) {
    el.setAttribute("aria-label", `${metricName} delta unavailable compared to ${baselineLabel}`);
    return;
  }
  if (rounded > 0) {
    el.classList.add("positive");
    el.setAttribute("aria-label", `${metricName} increased by ${Math.abs(rounded)}${unit} compared to ${baselineLabel}`);
    return;
  }
  if (rounded < 0) {
    el.classList.add("negative");
    el.setAttribute("aria-label", `${metricName} decreased by ${Math.abs(rounded)}${unit} compared to ${baselineLabel}`);
    return;
  }
  el.setAttribute("aria-label", `${metricName} unchanged compared to ${baselineLabel}`);
}

// --- Determine effective alkalinity source based on mineral selections ---
function getEffectiveAlkalinitySource() {
  const selected = loadSelectedMinerals();
  const hasBakingSoda = selected.includes("baking-soda");
  const hasPotBicarb = selected.includes("potassium-bicarbonate");
  if (!hasBakingSoda && !hasPotBicarb) return null;
  if (hasBakingSoda && !hasPotBicarb) return "baking-soda";
  if (!hasBakingSoda && hasPotBicarb) return "potassium-bicarbonate";
  return loadAlkalinitySource();
}

function getEffectiveCalciumSource() {
  const selected = loadSelectedMinerals();
  const hasCaCl2 = selected.includes("calcium-chloride");
  const hasGypsum = selected.includes("gypsum");
  if (!hasCaCl2 && !hasGypsum) return null;
  if (hasCaCl2 && !hasGypsum) return "calcium-chloride";
  if (!hasCaCl2 && hasGypsum) return "gypsum";
  return loadCalciumSource();
}

function getEffectiveMagnesiumSource() {
  const selected = loadSelectedMinerals();
  const hasEpsom = selected.includes("epsom-salt");
  const hasMgCl2 = selected.includes("magnesium-chloride");
  if (!hasEpsom && !hasMgCl2) return null;
  if (hasEpsom && !hasMgCl2) return "epsom-salt";
  if (!hasEpsom && hasMgCl2) return "magnesium-chloride";
  return loadMagnesiumSource();
}

// --- Get all target presets (built-in + custom, respecting deletions) ---
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

// --- Confirmation modal (shared across pages) ---
function showConfirm(message, onYes) {
  const overlay = document.getElementById("confirm-overlay");
  const msgEl = document.getElementById("confirm-message");
  const yesBtn = document.getElementById("confirm-yes");
  const noBtn = document.getElementById("confirm-no");

  msgEl.textContent = message;
  overlay.style.display = "flex";

  function close() {
    overlay.style.display = "none";
    yesBtn.removeEventListener("click", yesHandler);
    noBtn.removeEventListener("click", noHandler);
    document.removeEventListener("keydown", keyHandler);
    overlay.removeEventListener("click", overlayClickHandler);
  }
  function yesHandler() { close(); onYes(); }
  function noHandler() { close(); }
  function keyHandler(e) { if (e.key === "Escape") noHandler(); }
  function overlayClickHandler(e) { if (e.target === overlay) noHandler(); }

  yesBtn.addEventListener("click", yesHandler);
  noBtn.addEventListener("click", noHandler);
  document.addEventListener("keydown", keyHandler);
  overlay.addEventListener("click", overlayClickHandler);
}

// --- Theme (Light/Dark/System) ---
const THEME_KEY = "cw_theme";

function loadThemePreference() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark" || saved === "system") return saved;
  return "system";
}

function saveThemePreference(mode) {
  localStorage.setItem(THEME_KEY, mode);
}

function getResolvedTheme() {
  const pref = loadThemePreference();
  if (pref === "light") return "light";
  if (pref === "dark") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", getResolvedTheme());
}

function initThemeListeners() {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => {
    if (loadThemePreference() === "system") applyTheme();
  });
}

// --- Run shared UI setup on load ---
document.addEventListener("DOMContentLoaded", () => {
  injectNav();
  applyMineralDisplayMode();
  initThemeListeners();
});
