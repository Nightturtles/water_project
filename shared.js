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
function saveSourceWater(profile) {
  localStorage.setItem("cw_source_water", JSON.stringify(profile));
}

function loadSourceWater() {
  const saved = localStorage.getItem("cw_source_water");
  if (saved) {
    return JSON.parse(saved);
  }
  return { calcium: 0, magnesium: 0, potassium: 0, sodium: 0, sulfate: 0, chloride: 0, bicarbonate: 0 };
}

function saveSourcePresetName(name) {
  localStorage.setItem("cw_source_preset", name);
}

function loadSourcePresetName() {
  return localStorage.getItem("cw_source_preset") || "distilled";
}

// --- Custom profile helpers ---
function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function loadCustomProfiles() {
  const saved = localStorage.getItem("cw_custom_profiles");
  return saved ? JSON.parse(saved) : {};
}

function saveCustomProfiles(profiles) {
  localStorage.setItem("cw_custom_profiles", JSON.stringify(profiles));
}

function deleteCustomProfile(key) {
  const profiles = loadCustomProfiles();
  delete profiles[key];
  saveCustomProfiles(profiles);
}

// --- Deleted preset tracking (for hiding built-in presets) ---
function loadDeletedPresets() {
  const saved = localStorage.getItem("cw_deleted_presets");
  return saved ? JSON.parse(saved) : [];
}

function addDeletedPreset(key) {
  const deleted = loadDeletedPresets();
  if (!deleted.includes(key)) {
    deleted.push(key);
    localStorage.setItem("cw_deleted_presets", JSON.stringify(deleted));
  }
}

// --- Custom target profile helpers ---
// Built-in target profile keys (from script.js PROFILES) — custom saves must not use these
const BUILTIN_TARGET_KEYS = ["sca", "rao", "hendon-light", "hendon-espresso"];

function loadCustomTargetProfiles() {
  const saved = localStorage.getItem("cw_custom_target_profiles");
  return saved ? JSON.parse(saved) : {};
}

function saveCustomTargetProfiles(profiles) {
  localStorage.setItem("cw_custom_target_profiles", JSON.stringify(profiles));
}

function deleteCustomTargetProfile(key) {
  const profiles = loadCustomTargetProfiles();
  delete profiles[key];
  saveCustomTargetProfiles(profiles);
}

function loadDeletedTargetPresets() {
  const saved = localStorage.getItem("cw_deleted_target_presets");
  return saved ? JSON.parse(saved) : [];
}

function addDeletedTargetPreset(key) {
  const deleted = loadDeletedTargetPresets();
  if (!deleted.includes(key)) {
    deleted.push(key);
    localStorage.setItem("cw_deleted_target_presets", JSON.stringify(deleted));
  }
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
function getAllPresets() {
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
  return result;
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

function loadSelectedMinerals() {
  const saved = localStorage.getItem("cw_selected_minerals");
  if (saved) {
    return JSON.parse(saved);
  }
  // Default selection
  return ["calcium-chloride", "epsom-salt", "baking-soda", "potassium-bicarbonate"];
}

// --- Navigation ---
function injectNav() {
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  const pages = [
    { href: "index.html",    label: "Calculator" },
    { href: "minerals.html", label: "Settings" },
    { href: "taste.html",    label: "Taste Tuner" },
    { href: "recipe.html",   label: "Recipe Builder" }
  ];

  const nav = document.createElement("nav");
  nav.className = "site-nav";
  nav.innerHTML = pages.map(p =>
    `<a href="${p.href}" class="${currentPage === p.href ? "active" : ""}">${p.label}</a>`
  ).join("");

  document.body.insertBefore(nav, document.body.firstChild);
}

// --- Conversion constants (single source of truth for GH/KH/TDS) ---
// CaCO3 MW = 100.09; equivalent weights for hardness/alkalinity
const CA_TO_CACO3 = 100.09 / 40.078;   // Ca ppm -> GH contribution (mg/L as CaCO3)
const MG_TO_CACO3 = 100.09 / 24.305;   // Mg ppm -> GH contribution (mg/L as CaCO3)
const HCO3_TO_CACO3 = 50.045 / 61.017; // HCO3 ppm -> KH (mg/L as CaCO3)
const CACO3_TO_HCO3 = 61.017 / 50.045; // KH (mg/L as CaCO3) -> bicarbonate ppm

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
  const gh = ions.calcium * CA_TO_CACO3 + ions.magnesium * MG_TO_CACO3;
  const kh = (ions.bicarbonate || 0) * HCO3_TO_CACO3;
  const tds = (ions.calcium || 0) + (ions.magnesium || 0) + (ions.potassium || 0) +
              (ions.sodium || 0) + (ions.sulfate || 0) + (ions.chloride || 0) + (ions.bicarbonate || 0);
  return { gh, kh, tds };
}

// --- Run nav injection on load ---
document.addEventListener("DOMContentLoaded", injectNav);
