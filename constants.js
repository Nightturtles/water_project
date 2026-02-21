// ============================================
// Constants — pure data, no side effects
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
  "eaf-holy-water": {
    label: "Holy Water",
    calcium: 0,
    magnesium: 15,
    alkalinity: 23,
    potassium: 18,
    sodium: 0,
    sulfate: 59,
    chloride: 0,
    bicarbonate: 28,
    description: "Espresso Aficionados direct dosing: 1.520g Epsom + 0.460g KHCO3 per 10L."
  },
  "eaf-melbourne-water": {
    label: "Melbourne Water",
    calcium: 0,
    magnesium: 12,
    alkalinity: 20.2,
    potassium: 0,
    sodium: 9,
    sulfate: 48,
    chloride: 0,
    bicarbonate: 24.7,
    description: "Espresso Aficionados direct dosing: 1.220g Epsom + 0.340g Baking Soda per 10L."
  },
  "eaf-hendon-water": {
    label: "Hendon Water (Direct Dosing)",
    calcium: 0,
    magnesium: 24,
    alkalinity: 31,
    potassium: 0,
    sodium: 14,
    sulfate: 95,
    chloride: 0,
    bicarbonate: 37.8,
    description: "Espresso Aficionados direct dosing: 2.430g Epsom + 0.520g Baking Soda per 10L."
  },
  "eaf-bh-water-4": {
    label: "Barista Hustle Water #4",
    calcium: 0,
    magnesium: 19.4,
    alkalinity: 40,
    potassium: 0,
    sodium: 18,
    sulfate: 77,
    chloride: 0,
    bicarbonate: 48.7,
    description: "Espresso Aficionados direct dosing: 1.970g Epsom + 0.671g Baking Soda per 10L."
  },
  "eaf-tww-espresso-inspired": {
    label: "TWW Espresso Inspired",
    calcium: 0,
    magnesium: 38.9,
    alkalinity: 67.5,
    potassium: 53,
    sodium: 0,
    sulfate: 154,
    chloride: 0,
    bicarbonate: 82.3,
    description: "Espresso Aficionados direct dosing: 3.940g Epsom + 1.350g KHCO3 per 10L."
  },
  "eaf-rpavlis": {
    label: "RPavlis",
    calcium: 0,
    magnesium: 0,
    alkalinity: 50,
    potassium: 39,
    sodium: 0,
    sulfate: 0,
    chloride: 0,
    bicarbonate: 60.9,
    description: "Espresso Aficionados direct dosing: 1.000g KHCO3 per 10L."
  },
  "eaf-fam-29th-wave": {
    label: "Fam's 29th Wave",
    calcium: 0,
    magnesium: 4.9,
    alkalinity: 90,
    potassium: 0,
    sodium: 41,
    sulfate: 19,
    chloride: 0,
    bicarbonate: 109.7,
    description: "Espresso Aficionados direct dosing: 0.493g Epsom + 1.511g Baking Soda per 10L."
  },
  "eaf-fam-69th-wave": {
    label: "Fam's 69th Wave",
    calcium: 0,
    magnesium: 14.6,
    alkalinity: 90,
    potassium: 0,
    sodium: 41,
    sulfate: 58,
    chloride: 0,
    bicarbonate: 109.7,
    description: "Espresso Aficionados direct dosing: 1.478g Epsom + 1.511g Baking Soda per 10L."
  },
  rao: {
    label: "Rao's Recipe",
    calcium: 20.9,
    magnesium: 8.5,
    alkalinity: 40,
    description: "Lotus-style Rao recipe target with balanced sweetness and structure."
  },
  "hendon-light": {
    label: "Hendon Light Roast",
    calcium: 25,
    magnesium: 35,
    alkalinity: 25,
    description: "Higher magnesium for light roasts. Enhances fruity and floral notes."
  },
  "hendon-espresso": {
    label: "Hendon Espresso",
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

// --- Unit conversion ---
const GALLONS_TO_LITERS = 3.78541;

// --- Conversion constants (single source of truth for GH/KH/TDS) ---
const CA_TO_CACO3 = 100.09 / 40.078;   // Ca ppm -> GH contribution (mg/L as CaCO3)
const MG_TO_CACO3 = 100.09 / 24.305;   // Mg ppm -> GH contribution (mg/L as CaCO3)
const HCO3_TO_CACO3 = 50.045 / 61.017; // HCO3 ppm -> KH (mg/L as CaCO3)
const CACO3_TO_HCO3 = 61.017 / 50.045; // KH (mg/L as CaCO3) -> bicarbonate ppm
const MW_CACO3 = 100.09;               // Molecular weight of CaCO3
const ALK_TO_BAKING_SODA = 2 * MINERAL_DB["baking-soda"].mw / MW_CACO3;
const ALK_TO_POTASSIUM_BICARB = 2 * MINERAL_DB["potassium-bicarbonate"].mw / MW_CACO3;

// --- Range severity ordering ---
const RANGE_SEVERITY_ORDER = { danger: 0, warn: 1, info: 2 };

// --- Theme key ---
const THEME_KEY = "cw_theme";
