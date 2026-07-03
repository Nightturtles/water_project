// ============================================
// Constants — pure data, no side effects
// ============================================
// The shared ion/mineral types (IonName, IonMap, MineralEntry, TargetProfile,
// …) are defined and exported here.

// --- Shared ion/mineral types ---
export type IonName =
  | "calcium"
  | "magnesium"
  | "potassium"
  | "sodium"
  | "sulfate"
  | "chloride"
  | "bicarbonate";

export type IonMap = Partial<Record<IonName, number>>;

export interface MineralEntry {
  name: string;
  formula: string;
  mw: number;
  description: string;
  ions: IonMap;
}

export interface TargetProfile {
  label: string;
  calcium?: number;
  magnesium?: number;
  alkalinity?: number;
  potassium?: number;
  sodium?: number;
  sulfate?: number;
  chloride?: number;
  bicarbonate?: number;
  description?: string;
  brewMethod?: string;
  [key: string]: unknown;
}

export interface BrandConcentrate {
  name: string;
  mineralId: string;
  formula: string;
  gramsPerMl: number;
  description?: string;
}

export interface MethodRangeBand {
  preferredMin?: number | null;
  preferredMax?: number | null;
  warnMin?: number | null;
  warnMax?: number | null;
  dangerMin?: number | null;
  dangerMax?: number | null;
}

export interface BrewMethodRangeBands {
  tds: MethodRangeBand;
  kh: MethodRangeBand;
  gh: MethodRangeBand;
  calcium: MethodRangeBand;
  magnesium: MethodRangeBand;
  sodium: {
    default: { preferredMax: number; warnMax: number; dangerMax: number };
    bakingSoda: { preferredMax: number; warnMax: number; dangerMax: number };
  };
  chloride: {
    default: { preferredMax: number; warnMax: number; dangerMax: number };
    chlorideHeavy: { preferredMax: number; warnMax: number; dangerMax: number };
  };
  sulfate: { warnMax: number };
  potassium: { dangerMax: number };
}

// --- Mineral database ---
// Each mineral salt and the ions it contributes per gram dissolved in 1 liter.
// The literal lives in an internal const so same-file derivations below
// (ALK_TO_*) can index known keys without noUncheckedIndexedAccess guards;
// the export is typed to the public Record shape consumers already use.
const MINERAL_DB_LITERAL = {
  "calcium-chloride": {
    name: "Calcium Chloride (Dihydrate)",
    formula: "CaCl₂·2H₂O",
    mw: 147.01,
    description: "Adds calcium and chloride. Increases sweetness and body.",
    ions: {
      calcium: 40.078 / 147.01, // g Ca per g salt
      chloride: 70.906 / 147.01, // g Cl per g salt (2 * 35.453)
    },
  },
  "calcium-chloride-anhydrous": {
    name: "Calcium Chloride (Anhydrous)",
    formula: "CaCl₂",
    mw: 110.98,
    description:
      "Water-free calcium chloride. Adds the same calcium and chloride as the dihydrate, but more concentrated, so you weigh out less per dose.",
    ions: {
      calcium: 40.078 / 110.98, // g Ca per g salt
      chloride: 70.906 / 110.98, // g Cl per g salt (2 * 35.453)
    },
  },
  "epsom-salt": {
    name: "Epsom Salt",
    formula: "MgSO₄·7H₂O",
    mw: 246.47,
    description: "Adds magnesium and sulfate. Enhances fruity notes and clarity.",
    ions: {
      magnesium: 24.305 / 246.47,
      sulfate: 96.06 / 246.47,
    },
  },
  "baking-soda": {
    name: "Baking Soda",
    formula: "NaHCO₃",
    mw: 84.007,
    description: "Adds sodium and bicarbonate (alkalinity/KH). Buffers acidity.",
    ions: {
      sodium: 22.99 / 84.007,
      bicarbonate: 61.017 / 84.007,
    },
  },
  "potassium-bicarbonate": {
    name: "Potassium Bicarbonate",
    formula: "KHCO₃",
    mw: 100.115,
    description: "Sodium-free alkalinity source. Adds potassium and bicarbonate.",
    ions: {
      potassium: 39.098 / 100.115,
      bicarbonate: 61.017 / 100.115,
    },
  },
  "magnesium-chloride": {
    name: "Magnesium Chloride",
    formula: "MgCl₂·6H₂O",
    mw: 203.3,
    description: "Adds magnesium and chloride. Fruity notes with added body.",
    ions: {
      magnesium: 24.305 / 203.3,
      chloride: 70.906 / 203.3,
    },
  },
  gypsum: {
    name: "Gypsum",
    formula: "CaSO₄·2H₂O",
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
} satisfies Record<string, MineralEntry>;

export const MINERAL_DB: Record<string, MineralEntry> = MINERAL_DB_LITERAL;

// --- Approximate solubility limits (g/L at ~25C) ---
// Used only to warn when DIY concentrate strengths are likely to precipitate.
export const MINERAL_SOLUBILITY_G_PER_L_25C_APPROX: Record<string, number> = {
  "calcium-chloride": 700,
  "calcium-chloride-anhydrous": 745,
  "epsom-salt": 700,
  "baking-soda": 96,
  "potassium-bicarbonate": 330,
  "magnesium-chloride": 560,
  gypsum: 2,
  "potassium-chloride": 340,
  "sodium-chloride": 360,
};

// Library-recipe slugs reserved so user-defined stocks can't shadow them.
export const RESERVED_LIBRARY_STOCK_SLUGS: readonly string[] = [
  "rao-perger",
  "dan-eils",
  "matt-perger",
  "rao-2013",
  "melbourne-2013-wbc",
  "world-of-coffee-budapest",
  "bh-simplified-sca-optimal",
  "bh-default",
  "bh-simplified-rao-2008",
  "bh-simplified-hendon",
  "bh-hard",
  "bh-hard-af",
];

// --- Shared ion field list and labels ---
export const ION_FIELDS: readonly IonName[] = [
  "calcium",
  "magnesium",
  "potassium",
  "sodium",
  "sulfate",
  "chloride",
  "bicarbonate",
];
export const ION_LABELS: Record<IonName, string> = {
  calcium: "Ca",
  magnesium: "Mg",
  potassium: "K",
  sodium: "Na",
  sulfate: "SO₄",
  chloride: "Cl",
  bicarbonate: "HCO₃",
};

// --- Source water presets ---
// --- Source water preset categories ---
// Drives the grouping in source-water-ui.ts renderSourcePresetButtons. The
// "saved" bucket is for user-created custom profiles that don't carry a
// category field. The literal "+ Add Custom" entry is always last and has no
// category so it's not grouped under any heading.
export const SOURCE_CATEGORY_ORDER: readonly string[] = ["pure", "generic", "bottled", "saved"];
export const SOURCE_CATEGORY_LABELS: Record<string, string> = {
  pure: "Distilled / RO",
  generic: "Tap Water",
  bottled: "Bottled Water",
  saved: "Saved Profiles",
};

// Bottled water values are taken from each brand's published label / technical
// data sheet. These are international brands with stable, widely cited
// mineralogies; values are mg/L. If a user's local bottling differs (some
// brands source from multiple springs by region) they can override via
// "Edit Starting Water" → Save Changes.
export const SOURCE_PRESETS: Record<string, { label: string; [key: string]: unknown }> = {
  distilled: {
    label: "Distilled / RO",
    category: "pure",
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
    category: "generic",
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
    category: "generic",
    calcium: 60,
    magnesium: 15,
    potassium: 2,
    sodium: 20,
    sulfate: 25,
    chloride: 30,
    bicarbonate: 120,
  },
  // --- Bottled water profiles (mg/L from official label values) ---
  volvic: {
    label: "Volvic",
    category: "bottled",
    calcium: 12,
    magnesium: 8,
    potassium: 6.2,
    sodium: 12,
    sulfate: 8.1,
    chloride: 15,
    bicarbonate: 71,
  },
  voss: {
    label: "Voss Still",
    category: "bottled",
    calcium: 5,
    magnesium: 1,
    potassium: 0.4,
    sodium: 6,
    sulfate: 4,
    chloride: 7,
    bicarbonate: 30,
  },
  "crystal-geyser-olancha": {
    label: "Crystal Geyser (Olancha, CA)",
    category: "bottled",
    calcium: 20,
    magnesium: 2.1,
    potassium: 1.9,
    sodium: 17,
    sulfate: 24,
    chloride: 3.2,
    bicarbonate: 65,
  },
  "crystal-geyser-shasta": {
    label: "Crystal Geyser (Mt Shasta, CA)",
    category: "bottled",
    calcium: 5.9,
    magnesium: 5.2,
    potassium: 1.2,
    sodium: 11,
    sulfate: 1.9,
    chloride: 0.82,
    bicarbonate: 56,
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
// cold load. Their KEY ORDER also sets the taste-page rail order, which
// renderTastePresets iterates in insertion order (no sort), filtered by brew
// method — so the filter rail reads top-to-bottom 1-4 and the espresso rail 5-8:
//   1. cafelytic-filter             — Cafelytic in-house filter (featured pick)
//   2. sca                          — canonical industry reference (no brewMethod; defaults to filter)
//   3. lotus-light-bright           — clarity-forward filter
//   4. lotus-simple-sweet           — rounded-sweetness filter
//   5. cafelytic-espresso           — Cafelytic in-house espresso (espresso featured)
//   6. eaf-rpavlis                  — buffer-only no-scale water (espresso)
//   7. lotus-light-bright-espresso  — clarity-forward espresso
//   8. lotus-simple-sweet-espresso  — rounded-sweetness espresso
//
// Slugs, ion values, labels, AND brew methods here MUST stay byte-identical to
// the corresponding Supabase rows (migrations 002/006/007/010 seed/refresh them;
// 20260606060755 recategorizes eaf-rpavlis to espresso and renames the "and"
// recipes to "&") so the shim and the loaded library don't disagree. If you
// change a value or the key order here, update the migration too.
export const TARGET_PRESETS: Record<string, TargetProfile> = {
  "cafelytic-filter": {
    label: "Cafelytic Filter",
    brewMethod: "filter",
    calcium: 4,
    magnesium: 10,
    alkalinity: 11,
    potassium: 8.65,
    sodium: 0,
    sulfate: 0,
    chloride: 34.05,
    bicarbonate: 13.18,
    description:
      "Cafelytic in-house light-roast filter recipe. Direct dosing per 1.85L: " +
      "0.024g CaCl₂·2H₂O + 0.148g MgCl₂·6H₂O + 0.040g KHCO₃. " +
      "Mg-dominant, Cl-heavy, sodium-free, sulfate-free.",
  },
  sca: {
    label: "SCA Standard",
    calcium: 51,
    magnesium: 17,
    alkalinity: 40,
    description: "SCA recommended range for brewing water. Balanced body and clarity.",
  },
  "lotus-light-bright": {
    label: "Light & Bright",
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
    label: "Simple & Sweet",
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
  "cafelytic-espresso": {
    label: "Cafelytic Espresso",
    brewMethod: "espresso",
    calcium: 2.16,
    magnesium: 8.65,
    alkalinity: 17.3,
    potassium: 13.51,
    sodium: 0,
    sulfate: 0,
    chloride: 29.19,
    bicarbonate: 21.09,
    description:
      "Cafelytic in-house espresso companion to Cafelytic Filter. Direct dosing per 1.85L: " +
      "0.015g CaCl₂·2H₂O + 0.134g MgCl₂·6H₂O + 0.064g KHCO₃. " +
      "Preserves the Cafelytic house character (Cl-heavy, no SO₄, sodium-free, " +
      "K-buffered) at espresso concentrations.",
  },
  "eaf-rpavlis": {
    label: "RPavlis",
    brewMethod: "espresso",
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
  "lotus-light-bright-espresso": {
    label: "Light & Bright (espresso)",
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
    label: "Simple & Sweet (espresso)",
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
export const NON_EDITABLE_TARGET_KEYS: readonly string[] = ["sca", "rao"];

// --- Predefined library tags ---
// Canonical flavor-tag vocabulary for the recipe library (v2 taxonomy, 2026-04).
// Migration 006 re-tightened every library row to this 6-tag set and added a
// CHECK constraint on target_profiles.tags enforcing the same. Removed in the
// 2026-04 taxonomy overhaul: "Delicate" (→ Clarity), "Round" (→ Full Body),
// "Low TDS" / "High TDS" (not flavor descriptors).
export const LIBRARY_TAGS: readonly string[] = [
  "Full Body",
  "Balanced",
  "Bright",
  "Sweet",
  "Juicy",
  "Clarity",
];

// --- Custom target profile helpers ---

// Library slugs that exist in Supabase (user_id IS NULL) but are NOT in the
// TARGET_PRESETS fallback shim. They still need to be reserved so a user
// can't create a custom profile that collides with the canonical library
// row. `rao` lives here because the shim was trimmed to the 8-entry starter
// set but Rao's recipe remains in the library.
const LEGACY_RESERVED_TARGET_KEYS = ["rao"];

export const BUILTIN_TARGET_KEYS: readonly string[] = Object.keys(TARGET_PRESETS);
export const RESERVED_TARGET_KEYS: Set<string> = new Set([
  ...BUILTIN_TARGET_KEYS,
  ...LEGACY_RESERVED_TARGET_KEYS,
  "custom",
  "library",
]);
export const BUILTIN_TARGET_LABELS: Record<string, string> = {};
for (const [key, preset] of Object.entries(TARGET_PRESETS)) {
  BUILTIN_TARGET_LABELS[key] = preset.label;
}

export function isReservedTargetKey(key: string): boolean {
  return RESERVED_TARGET_KEYS.has(key);
}

// --- Unit conversion ---
export const GALLONS_TO_LITERS = 3.78541;

// --- Conversion constants (single source of truth for GH/KH/TDS) ---
export const CA_TO_CACO3 = 100.09 / 40.078; // Ca ppm -> GH contribution (mg/L as CaCO3)
export const MG_TO_CACO3 = 100.09 / 24.305; // Mg ppm -> GH contribution (mg/L as CaCO3)
export const HCO3_TO_CACO3 = 50.045 / 61.017; // HCO3 ppm -> KH (mg/L as CaCO3)
export const CACO3_TO_HCO3 = 61.017 / 50.045; // KH (mg/L as CaCO3) -> bicarbonate ppm
export const MW_CACO3 = 100.09; // Molecular weight of CaCO3
export const ALK_TO_BAKING_SODA = (2 * MINERAL_DB_LITERAL["baking-soda"].mw) / MW_CACO3;
export const ALK_TO_POTASSIUM_BICARB =
  (2 * MINERAL_DB_LITERAL["potassium-bicarbonate"].mw) / MW_CACO3;

// --- Brand name concentrates (fixed strength, equivalent grams of mineral per mL) ---
// Lotus Coffee Water Drops: concentrations derived from official round-tip dropper recipes
// (round drop ≈ 0.0716 mL, straight drop ≈ 0.0386 mL). gramsPerMl = equivalent grams of
// the mapped MINERAL_DB salt per mL of concentrate (for dosing math).
export const LOTUS_DROPPER_ML: Record<string, number> = {
  round: 0.0716,
  straight: 0.0386,
};
export const BRAND_CONCENTRATES: Record<string, BrandConcentrate> = {
  "brand:lotus:calcium": {
    name: "Calcium",
    mineralId: "calcium-chloride",
    formula: "CaCl₂·2H₂O",
    gramsPerMl: 0.1671,
    description:
      "~113.7 mg/mL hardness as CaCO₃ (≈ 45.5 mg/mL Ca²⁺). Calibrated so 69 round drops in 15L yields ~15 mg/L Ca and ~26.5 mg/L Cl.",
  },
  "brand:lotus:magnesium": {
    name: "Magnesium",
    mineralId: "magnesium-chloride",
    formula: "MgCl₂·6H₂O",
    gramsPerMl: 0.2302,
    description:
      "~113.4 mg/mL hardness as CaCO₃ (≈ 27.5 mg/mL Mg²⁺). Calibrated so 274 round drops in 15L yields ~36 mg/L Mg and ~105.0 mg/L Cl.",
  },
  "brand:lotus:sodium-bicarbonate": {
    name: "Sodium Bicarbonate",
    mineralId: "baking-soda",
    formula: "NaHCO₃",
    gramsPerMl: 0.095,
    description:
      "~150.2 mg/mL alkalinity as CaCO₃ (≈ 26.0 mg/mL Na⁺; ≈ 69.0 mg/mL HCO₃⁻). Calibrated so 556 round drops in 15L yields ~69 mg/L Na and ~183.1 mg/L HCO₃.",
  },
  "brand:lotus:potassium-bicarbonate": {
    name: "Potassium Bicarbonate",
    mineralId: "potassium-bicarbonate",
    formula: "KHCO₃",
    gramsPerMl: 0.1129,
    description:
      "~149.8 mg/mL alkalinity as CaCO₃ (≈ 44.1 mg/mL K⁺; ≈ 68.8 mg/mL HCO₃⁻). Calibrated so 556 round drops in 15L yields ~117 mg/L K and ~182.6 mg/L HCO₃.",
  },
};

/** All brand concentrate IDs (for iteration). */
export const BRAND_CONCENTRATE_IDS: readonly string[] = Object.keys(BRAND_CONCENTRATES);

/** Lotus Coffee Water Drops subset (for settings subsection). */
export const LOTUS_CONCENTRATE_IDS: readonly string[] = BRAND_CONCENTRATE_IDS.filter((id) =>
  id.startsWith("brand:lotus:"),
);

// --- Water-profile range bands by brew method ---
// These bands drive evaluateWaterProfileRanges() in src/lib/metrics.ts.
// Espresso bands diverge from filter in two directions:
//  - Lower bounds are more permissive (zero-Ca/low-GH espresso recipes).
//  - Upper KH and GH bounds are tighter than filter to flag the
//    scale risk that espresso boilers face above ~70-100 ppm CaCO3
//    alkalinity (Barista Hustle / ThirdWaveWater / EspressoAF guidance).
export const WATER_PROFILE_RANGE_BANDS: Record<"filter" | "espresso", BrewMethodRangeBands> = {
  filter: {
    tds: {
      preferredMin: 50,
      preferredMax: 300,
      warnMin: 30,
      warnMax: 400,
      dangerMin: 20,
      dangerMax: 500,
    },
    kh: {
      preferredMin: 30,
      preferredMax: 90,
      warnMin: 10,
      warnMax: 130,
      dangerMin: 5,
      dangerMax: 200,
    },
    gh: {
      preferredMin: 40,
      preferredMax: 200,
      warnMin: 20,
      warnMax: 250,
      dangerMin: null,
      dangerMax: 300,
    },
    calcium: {
      preferredMin: 8,
      preferredMax: 90,
      warnMin: 4,
      warnMax: 120,
      dangerMin: null,
      dangerMax: 160,
    },
    magnesium: {
      preferredMin: 2,
      preferredMax: 40,
      warnMin: 1,
      warnMax: 55,
      dangerMin: null,
      dangerMax: 75,
    },
    sodium: {
      default: { preferredMax: 10, warnMax: 30, dangerMax: 45 },
      bakingSoda: { preferredMax: 25, warnMax: 40, dangerMax: 60 },
    },
    chloride: {
      default: { preferredMax: 30, warnMax: 50, dangerMax: 100 },
      chlorideHeavy: { preferredMax: 90, warnMax: 130, dangerMax: 180 },
    },
    sulfate: { warnMax: 150 },
    potassium: { dangerMax: 100 },
  },
  espresso: {
    tds: {
      preferredMin: 60,
      preferredMax: 260,
      warnMin: 35,
      warnMax: 350,
      dangerMin: 20,
      dangerMax: 450,
    },
    kh: {
      preferredMin: 20,
      preferredMax: 70,
      warnMin: 10,
      warnMax: 100,
      dangerMin: 5,
      dangerMax: 150,
    },
    gh: {
      preferredMin: 15,
      preferredMax: 180,
      warnMin: 8,
      warnMax: 240,
      dangerMin: null,
      dangerMax: 260,
    },
    calcium: {
      preferredMin: 0,
      preferredMax: 70,
      warnMin: null,
      warnMax: 110,
      dangerMin: null,
      dangerMax: 150,
    },
    magnesium: {
      preferredMin: 2,
      preferredMax: 45,
      warnMin: 1,
      warnMax: 60,
      dangerMin: null,
      dangerMax: 80,
    },
    sodium: {
      default: { preferredMax: 20, warnMax: 35, dangerMax: 50 },
      bakingSoda: { preferredMax: 30, warnMax: 45, dangerMax: 65 },
    },
    chloride: {
      default: { preferredMax: 50, warnMax: 75, dangerMax: 130 },
      chlorideHeavy: { preferredMax: 110, warnMax: 150, dangerMax: 210 },
    },
    sulfate: { warnMax: 170 },
    potassium: { dangerMax: 120 },
  },
};

// --- Range severity ordering ---
export const RANGE_SEVERITY_ORDER: { danger: number; warn: number; info: number } = {
  danger: 0,
  warn: 1,
  info: 2,
};

// --- Theme key ---
export const THEME_KEY = "cw_theme";
