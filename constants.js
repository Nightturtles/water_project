// @ts-check
// ============================================
// Constants — pure data, no side effects
// ============================================
// Shared type definitions live in globals.d.ts (IonName, IonMap, MineralEntry).

// --- Mineral database ---
// Each mineral salt and the ions it contributes per gram dissolved in 1 liter
const MINERAL_DB = {
  "calcium-chloride": {
    name: "Calcium Chloride",
    formula: "CaCl\u2082\u00b72H\u2082O",
    mw: 147.01,
    description: "Adds calcium and chloride. Increases sweetness and body.",
    ions: {
      calcium: 40.078 / 147.01, // g Ca per g salt
      chloride: 70.906 / 147.01, // g Cl per g salt (2 * 35.453)
    },
  },
  "epsom-salt": {
    name: "Epsom Salt",
    formula: "MgSO\u2084\u00b77H\u2082O",
    mw: 246.47,
    description: "Adds magnesium and sulfate. Enhances fruity notes and clarity.",
    ions: {
      magnesium: 24.305 / 246.47,
      sulfate: 96.06 / 246.47,
    },
  },
  "baking-soda": {
    name: "Baking Soda",
    formula: "NaHCO\u2083",
    mw: 84.007,
    description: "Adds sodium and bicarbonate (alkalinity/KH). Buffers acidity.",
    ions: {
      sodium: 22.99 / 84.007,
      bicarbonate: 61.017 / 84.007,
    },
  },
  "potassium-bicarbonate": {
    name: "Potassium Bicarbonate",
    formula: "KHCO\u2083",
    mw: 100.115,
    description: "Sodium-free alkalinity source. Adds potassium and bicarbonate.",
    ions: {
      potassium: 39.098 / 100.115,
      bicarbonate: 61.017 / 100.115,
    },
  },
  "magnesium-chloride": {
    name: "Magnesium Chloride",
    formula: "MgCl\u2082\u00b76H\u2082O",
    mw: 203.3,
    description: "Adds magnesium and chloride. Fruity notes with added body.",
    ions: {
      magnesium: 24.305 / 203.3,
      chloride: 70.906 / 203.3,
    },
  },
  gypsum: {
    name: "Gypsum",
    formula: "CaSO\u2084\u00b72H\u2082O",
    mw: 172.17,
    description: "Adds calcium and sulfate. Sweetness with crisp clarity.",
    ions: {
      calcium: 40.078 / 172.17,
      sulfate: 96.06 / 172.17,
    },
  },
  "potassium-chloride": {
    name: "Potassium Chloride",
    formula: "KCl",
    mw: 74.551,
    description: "Adds potassium and chloride. Salt substitute, adds body.",
    ions: {
      potassium: 39.098 / 74.551,
      chloride: 35.453 / 74.551,
    },
  },
  "sodium-chloride": {
    name: "Sodium Chloride",
    formula: "NaCl",
    mw: 58.44,
    description: "Table salt. Adds sodium and chloride. Small amounts enhance sweetness.",
    ions: {
      sodium: 22.99 / 58.44,
      chloride: 35.453 / 58.44,
    },
  },
};

// --- Approximate solubility limits (g/L at ~25C) ---
// Used only to warn when DIY concentrate strengths are likely to precipitate.
const MINERAL_SOLUBILITY_G_PER_L_25C_APPROX = {
  "calcium-chloride": 700,
  "epsom-salt": 700,
  "baking-soda": 96,
  "potassium-bicarbonate": 330,
  "magnesium-chloride": 560,
  gypsum: 2,
  "potassium-chloride": 340,
  "sodium-chloride": 360,
};

// --- Shared ion field list and labels ---
const ION_FIELDS = [
  "calcium",
  "magnesium",
  "potassium",
  "sodium",
  "sulfate",
  "chloride",
  "bicarbonate",
];
const ION_LABELS = {
  calcium: "Ca",
  magnesium: "Mg",
  potassium: "K",
  sodium: "Na",
  sulfate: "SO\u2084",
  chloride: "Cl",
  bicarbonate: "HCO\u2083",
};

// --- Source water presets ---
const SOURCE_PRESETS = {
  distilled: {
    label: "Distilled / RO",
    calcium: 0,
    magnesium: 0,
    potassium: 0,
    sodium: 0,
    sulfate: 0,
    chloride: 0,
    bicarbonate: 0,
  },
  "soft-tap": {
    label: "Soft Tap Water",
    calcium: 15,
    magnesium: 3,
    potassium: 1,
    sodium: 10,
    sulfate: 5,
    chloride: 12,
    bicarbonate: 30,
  },
  "hard-tap": {
    label: "Hard Tap Water",
    calcium: 60,
    magnesium: 15,
    potassium: 2,
    sodium: 20,
    sulfate: 25,
    chloride: 30,
    bicarbonate: 120,
  },
  custom: {
    label: "+ Add Custom",
  },
};

// --- Target water presets (Ca/Mg/Alk targets for coffee water) ---
//
// As of migration 007, the full library of target recipes lives in Supabase
// (target_profiles where user_id IS NULL). This object is now a *fallback shim*
// used only before Supabase data loads — it keeps the taste-page preset rail
// populated on a cold pageload and gives `getAllTargetPresets()` a baseline
// even when the user is offline.
//
// The eight entries below are the default starter set every user sees on a
// cold load:
//   * sca                             — canonical industry filter reference
//   * eaf-rpavlis                     — buffer-only no-scale water
//   * cafelytic-filter                — Cafelytic in-house filter (featured pick)
//   * cafelytic-espresso              — Cafelytic in-house espresso (espresso featured)
//   * lotus-light-bright              — clarity-forward filter
//   * lotus-simple-sweet              — rounded-sweetness filter
//   * lotus-light-bright-espresso     — clarity-forward espresso
//   * lotus-simple-sweet-espresso     — rounded-sweetness espresso
//
// Slugs and ion values here MUST stay byte-identical to the corresponding
// Supabase rows in migrations 002/006/007 so the shim and the loaded library
// don't disagree. If you change a value here, update the migration too.
const TARGET_PRESETS = {
  sca: {
    label: "SCA Standard",
    calcium: 51,
    magnesium: 17,
    alkalinity: 40,
    description: "SCA recommended range for brewing water. Balanced body and clarity.",
  },
  "eaf-rpavlis": {
    label: "RPavlis",
    brewMethod: "filter",
    calcium: 0,
    magnesium: 0,
    alkalinity: 50,
    potassium: 39,
    sodium: 0,
    sulfate: 0,
    chloride: 0,
    bicarbonate: 60.9,
    description: "Espresso Aficionados direct dosing: 1.000g KHCO3 per 10L.",
  },
  "cafelytic-filter": {
    label: "Cafelytic Filter",
    brewMethod: "filter",
    calcium: 2,
    magnesium: 11,
    alkalinity: 11,
    potassium: 9,
    sodium: 0,
    sulfate: 0,
    chloride: 36,
    bicarbonate: 13.41,
    description:
      "Cafelytic in-house light-roast filter recipe. Direct dosing per liter: " +
      "0.007g CaCl\u2082\u00b72H\u2082O + 0.092g MgCl\u2082\u00b76H\u2082O + 0.023g KHCO\u2083. " +
      "Mg-dominant, Cl-heavy, sodium-free, sulfate-free.",
  },
  "cafelytic-espresso": {
    label: "Cafelytic Espresso",
    brewMethod: "espresso",
    calcium: 4,
    magnesium: 16,
    alkalinity: 32,
    potassium: 25,
    sodium: 0,
    sulfate: 0,
    chloride: 54,
    bicarbonate: 39.02,
    description:
      "Cafelytic in-house espresso companion to Cafelytic Filter. Direct dosing per liter: " +
      "0.015g CaCl\u2082\u00b72H\u2082O + 0.134g MgCl\u2082\u00b76H\u2082O + 0.064g KHCO\u2083. " +
      "Preserves the Cafelytic house character (Cl-heavy, no SO\u2084, sodium-free, " +
      "K-buffered) at espresso concentrations.",
  },
  "lotus-light-bright": {
    label: "Light and Bright",
    brewMethod: "filter",
    calcium: 22.832,
    magnesium: 0,
    alkalinity: 24.245,
    potassium: 18.941,
    sodium: 0,
    sulfate: 0,
    chloride: 40.395,
    bicarbonate: 29.56,
    description: "Lotus recipe emphasizing high clarity and acidity for lighter coffees.",
  },
  "lotus-simple-sweet": {
    label: "Simple and Sweet",
    brewMethod: "filter",
    calcium: 22.832,
    magnesium: 7.882,
    alkalinity: 40.476,
    potassium: 12.628,
    sodium: 11.169,
    sulfate: 0,
    chloride: 63.389,
    bicarbonate: 49.35,
    description: "Lotus balanced profile with added sweetness and approachable acidity.",
  },
  "lotus-light-bright-espresso": {
    label: "Light and Bright (espresso)",
    brewMethod: "espresso",
    calcium: 0,
    magnesium: 3.941,
    alkalinity: 44.449,
    potassium: 34.726,
    sodium: 0,
    sulfate: 0,
    chloride: 11.497,
    bicarbonate: 54.194,
    description: "Lotus espresso profile for clarity-forward shots with restrained hardness.",
  },
  "lotus-simple-sweet-espresso": {
    label: "Simple and Sweet (espresso)",
    brewMethod: "espresso",
    calcium: 0,
    magnesium: 3.941,
    alkalinity: 56.73,
    potassium: 0,
    sodium: 26.061,
    sulfate: 0,
    chloride: 11.497,
    bicarbonate: 69.167,
    description: "Lotus espresso profile with higher buffer for sweeter, rounder shots.",
  },
};

// Slugs whose Ca/Mg/Alk/etc. values are not editable in-place from the taste
// page: typing into a target input while one of these is active forks to a
// new "custom" profile instead of overwriting the library row.
//
// Currently scoped to sca/rao — broadening this to every library (user_id=NULL)
// slug is a pending UX call tracked against Piece D.
const NON_EDITABLE_TARGET_KEYS = ["sca", "rao"];

// --- Predefined library tags ---
// Canonical flavor-tag vocabulary for the recipe library (v2 taxonomy, 2026-04).
// Migration 006 re-tightened every library row to this 6-tag set and added a
// CHECK constraint on target_profiles.tags enforcing the same. Removed in the
// 2026-04 taxonomy overhaul: "Delicate" (→ Clarity), "Round" (→ Full Body),
// "Low TDS" / "High TDS" (not flavor descriptors).
const LIBRARY_TAGS = ["Full Body", "Balanced", "Bright", "Sweet", "Juicy", "Clarity"];

// --- Custom target profile helpers ---
const BUILTIN_TARGET_KEYS = Object.keys(TARGET_PRESETS);
const RESERVED_TARGET_KEYS = new Set([...BUILTIN_TARGET_KEYS, "custom"]);
/** @type {Record<string, string>} */
const BUILTIN_TARGET_LABELS = {};
for (const [key, preset] of Object.entries(TARGET_PRESETS)) {
  BUILTIN_TARGET_LABELS[key] = preset.label;
}

/** @param {string} key */
function isReservedTargetKey(key) {
  return RESERVED_TARGET_KEYS.has(key);
}

// --- Unit conversion ---
const GALLONS_TO_LITERS = 3.78541;

// --- Conversion constants (single source of truth for GH/KH/TDS) ---
const CA_TO_CACO3 = 100.09 / 40.078; // Ca ppm -> GH contribution (mg/L as CaCO3)
const MG_TO_CACO3 = 100.09 / 24.305; // Mg ppm -> GH contribution (mg/L as CaCO3)
const HCO3_TO_CACO3 = 50.045 / 61.017; // HCO3 ppm -> KH (mg/L as CaCO3)
const CACO3_TO_HCO3 = 61.017 / 50.045; // KH (mg/L as CaCO3) -> bicarbonate ppm
const MW_CACO3 = 100.09; // Molecular weight of CaCO3
const ALK_TO_BAKING_SODA = (2 * MINERAL_DB["baking-soda"].mw) / MW_CACO3;
const ALK_TO_POTASSIUM_BICARB = (2 * MINERAL_DB["potassium-bicarbonate"].mw) / MW_CACO3;

// --- Brand name concentrates (fixed strength, equivalent grams of mineral per mL) ---
// Lotus Coffee Water Drops: concentrations derived from official round-tip dropper recipes
// (round drop ≈ 0.0716 mL, straight drop ≈ 0.0386 mL). gramsPerMl = equivalent grams of
// the mapped MINERAL_DB salt per mL of concentrate (for dosing math).
const LOTUS_DROPPER_ML = {
  round: 0.0716,
  straight: 0.0386,
};
const BRAND_CONCENTRATES = {
  "brand:lotus:calcium": {
    name: "Calcium",
    mineralId: "calcium-chloride",
    formula: "CaCl\u2082\u00b72H\u2082O",
    gramsPerMl: 0.1671,
    description:
      "~113.7 mg/mL hardness as CaCO\u2083 (\u2248 45.5 mg/mL Ca\u00B2\u207A). Calibrated so 69 round drops in 15L yields ~15 mg/L Ca and ~26.5 mg/L Cl.",
  },
  "brand:lotus:magnesium": {
    name: "Magnesium",
    mineralId: "magnesium-chloride",
    formula: "MgCl\u2082\u00b76H\u2082O",
    gramsPerMl: 0.2302,
    description:
      "~113.4 mg/mL hardness as CaCO\u2083 (\u2248 27.5 mg/mL Mg\u00B2\u207A). Calibrated so 274 round drops in 15L yields ~36 mg/L Mg and ~105.0 mg/L Cl.",
  },
  "brand:lotus:sodium-bicarbonate": {
    name: "Sodium Bicarbonate",
    mineralId: "baking-soda",
    formula: "NaHCO\u2083",
    gramsPerMl: 0.095,
    description:
      "~150.2 mg/mL alkalinity as CaCO\u2083 (\u2248 26.0 mg/mL Na\u207A; \u2248 69.0 mg/mL HCO\u2083\u207B). Calibrated so 556 round drops in 15L yields ~69 mg/L Na and ~183.1 mg/L HCO\u2083.",
  },
  "brand:lotus:potassium-bicarbonate": {
    name: "Potassium Bicarbonate",
    mineralId: "potassium-bicarbonate",
    formula: "KHCO\u2083",
    gramsPerMl: 0.1129,
    description:
      "~149.8 mg/mL alkalinity as CaCO\u2083 (\u2248 44.1 mg/mL K\u207A; \u2248 68.8 mg/mL HCO\u2083\u207B). Calibrated so 556 round drops in 15L yields ~117 mg/L K and ~182.6 mg/L HCO\u2083.",
  },
};

/** All brand concentrate IDs (for iteration). */
const BRAND_CONCENTRATE_IDS = Object.keys(BRAND_CONCENTRATES);

/** Lotus Coffee Water Drops subset (for settings subsection). */
const LOTUS_CONCENTRATE_IDS = BRAND_CONCENTRATE_IDS.filter((id) => id.startsWith("brand:lotus:"));

// --- Range severity ordering ---
const RANGE_SEVERITY_ORDER = { danger: 0, warn: 1, info: 2 };

// --- Theme key ---
const THEME_KEY = "cw_theme";

// --- Node/Vitest UMD shim (harmless in browsers) ---
// Browsers: `module` is undefined, the if-branch is skipped entirely.
// Node/Vitest: exports all top-level names AND mirrors them to globalThis so
// sibling files that reference these names via browser script-scope (e.g.
// metrics.js's `MINERAL_DB`) can resolve them through the global scope chain.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MINERAL_DB,
    MINERAL_SOLUBILITY_G_PER_L_25C_APPROX,
    ION_FIELDS,
    ION_LABELS,
    SOURCE_PRESETS,
    TARGET_PRESETS,
    NON_EDITABLE_TARGET_KEYS,
    LIBRARY_TAGS,
    BUILTIN_TARGET_KEYS,
    RESERVED_TARGET_KEYS,
    BUILTIN_TARGET_LABELS,
    GALLONS_TO_LITERS,
    CA_TO_CACO3,
    MG_TO_CACO3,
    HCO3_TO_CACO3,
    CACO3_TO_HCO3,
    MW_CACO3,
    ALK_TO_BAKING_SODA,
    ALK_TO_POTASSIUM_BICARB,
    LOTUS_DROPPER_ML,
    BRAND_CONCENTRATES,
    BRAND_CONCENTRATE_IDS,
    LOTUS_CONCENTRATE_IDS,
    RANGE_SEVERITY_ORDER,
    THEME_KEY,
  };
  Object.assign(globalThis, module.exports);
}
