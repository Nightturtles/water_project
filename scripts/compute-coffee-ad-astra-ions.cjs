#!/usr/bin/env node
// One-shot script: compute resulting brew-water ion targets for the 12
// stock-solution recipes catalogued in the Coffee ad Astra "Water for Coffee
// Extraction" blog post (Jonathan Gagné, Dec 2018).
//
// Each recipe specifies grams of each mineral salt dissolved in a 200-mL
// distilled-water stock, with 16 g of stock dosed into 4 L of brew water
// (4 g/L). The math: per L brew water, mineral_g = recipe_g / 50.
//
// Usage:  node scripts/compute-coffee-ad-astra-ions.cjs
// Emits:  one INSERT VALUES tuple per recipe, ready to paste into the migration.
//
// Mineral ID convention follows MINERAL_DB in constants.js:
//   - "calcium-chloride"     = CaCl₂·2H₂O  (dihydrate, MW 147.01)
//   - "magnesium-chloride"   = MgCl₂·6H₂O  (hexahydrate, MW 203.3)
//   - "epsom-salt"           = MgSO₄·7H₂O  (heptahydrate, MW 246.47)
//   - "baking-soda"          = NaHCO₃      (MW 84.007)
//   - "potassium-bicarbonate"= KHCO₃       (MW 100.115)
// The article gives both anhydrous and hydrate weights for CaCl₂ and MgCl₂;
// we use the hydrate values to match MINERAL_DB directly.

require("../constants.js");
const metrics = require("../metrics.js");

// CaCO3 unit conversion factor, lifted from constants.js.
const HCO3_TO_CACO3 = globalThis.HCO3_TO_CACO3;

/**
 * Each recipe lists grams of mineral per 200-mL stock (matching the article
 * verbatim, hydrate forms). doseGramsPerL = 4 (16 g stock per 4 L brew water).
 */
const RECIPES = [
  {
    slug: "rao-perger",
    label: "Rao/Perger",
    description:
      "Author's #1 by Scott Rao and Matt Perger. Bright, well-balanced multi-mineral profile with both sulfate and chloride contributions.",
    creator: "Scott Rao",
    roast: ["all"],
    tags: ["Balanced", "Bright"],
    minerals: {
      "epsom-salt": 5,
      "magnesium-chloride": 2,
      "calcium-chloride": 2, // 1.5 g anhydrous ≡ 2 g dihydrate
      "baking-soda": 1.7,
      "potassium-bicarbonate": 2,
    },
  },
  {
    slug: "dan-eils",
    label: "Dan Eils",
    description:
      "Sulfate-free recipe by Dan Eils. Magnesium chloride + calcium chloride extraction with potassium-buffered alkalinity.",
    creator: "Dan Eils",
    roast: ["all"],
    tags: ["Sweet", "Balanced"],
    minerals: {
      "magnesium-chloride": 5,
      "calcium-chloride": 5, // 3.8 g anhydrous ≡ 5 g dihydrate
      "potassium-bicarbonate": 5,
    },
  },
  {
    slug: "matt-perger",
    label: "Matt Perger",
    description:
      "Two-mineral epsom + baking soda stock. Magnesium-only extraction, sodium-buffered.",
    creator: "Matt Perger",
    roast: ["all"],
    tags: ["Bright"],
    minerals: { "epsom-salt": 10, "baking-soda": 3.4 },
  },
  {
    slug: "rao-2013",
    label: "Rao 2013",
    description:
      "Earlier Rao recipe with magnesium and calcium chloride extraction, sodium-buffered alkalinity. No sulfate.",
    creator: "Scott Rao",
    roast: ["all"],
    tags: ["Sweet"],
    minerals: {
      "magnesium-chloride": 4,
      "calcium-chloride": 4, // 3 g anhydrous ≡ 4 g dihydrate
      "baking-soda": 3.4,
    },
  },
  {
    slug: "melbourne-2013-wbc",
    label: "Melbourne 2013 WBC",
    description:
      "Ultra-soft profile from the 2013 Melbourne World Barista Championship. Low TDS for sensitive lighter roasts.",
    creator: "World Barista Championship 2013",
    roast: ["light"],
    tags: ["Bright", "Clarity"],
    minerals: { "epsom-salt": 2.9, "baking-soda": 1.0 },
  },
  {
    slug: "world-of-coffee-budapest",
    label: "World of Coffee Budapest",
    description:
      "Two-mineral epsom + baking soda recipe used at the World of Coffee Budapest competition.",
    creator: "World of Coffee Budapest",
    roast: ["all"],
    tags: ["Balanced"],
    minerals: { "epsom-salt": 6.2, "baking-soda": 3.4 },
  },
  {
    slug: "bh-simplified-sca-optimal",
    label: "BH Simplified SCA Optimal",
    description:
      "Barista Hustle's two-mineral approximation of the SCA optimal target. Epsom + baking soda only.",
    creator: "Barista Hustle",
    roast: ["all"],
    tags: ["Balanced"],
    minerals: { "epsom-salt": 8.4, "baking-soda": 3.4 },
  },
  {
    slug: "bh-default",
    label: "Barista Hustle (default)",
    description: "Barista Hustle's default two-mineral filter recipe.",
    creator: "Barista Hustle",
    roast: ["all"],
    tags: ["Balanced"],
    minerals: { "epsom-salt": 9.8, "baking-soda": 3.4 },
  },
  {
    slug: "bh-simplified-rao-2008",
    label: "BH Simplified Rao 2008",
    description: "Barista Hustle's two-mineral simplification of Scott Rao's 2008 recipe.",
    creator: "Barista Hustle",
    roast: ["all"],
    tags: ["Sweet"],
    minerals: { "epsom-salt": 9.2, "baking-soda": 4.2 },
  },
  {
    slug: "bh-simplified-hendon",
    label: "BH Simplified Hendon",
    description:
      "Barista Hustle's two-mineral take on Christopher Hendon's Water for Coffee profile. Higher hardness, lower buffer.",
    creator: "Barista Hustle",
    roast: ["all"],
    tags: ["Bright"],
    minerals: { "epsom-salt": 12.2, "baking-soda": 2.6 },
  },
  {
    slug: "bh-hard",
    label: "BH Hard",
    description:
      "Barista Hustle's hard-water recipe — high magnesium, low buffer, for vivid acidity.",
    creator: "Barista Hustle",
    roast: ["light"],
    tags: ["Bright"],
    minerals: { "epsom-salt": 15.4, "baking-soda": 2.9 },
  },
  {
    slug: "bh-hard-af",
    label: "BH Hard AF",
    description:
      'Barista Hustle\'s most extreme hard-water profile ("Hard as Falcon"). Use for very low-yield extractions.',
    creator: "Barista Hustle",
    roast: ["light"],
    tags: ["Bright"],
    minerals: { "epsom-salt": 21.5, "baking-soda": 3.8 },
  },
];

const BOTTLE_ML = 200;
const DOSE_G_PER_L = 4; // 16 g stock per 4 L brew water
const DILUTION_DIVISOR = BOTTLE_ML / DOSE_G_PER_L; // 50

/**
 * Round to 1 decimal. The seed migration uses up to 3 decimals in places, but
 * 1-decimal precision is plenty for water-chemistry targets and matches the
 * granularity of the source recipes.
 */
function r1(n) {
  return Math.round(n * 10) / 10;
}

function escapeSqlText(s) {
  return s.replace(/'/g, "''");
}

function jsonbLiteral(obj) {
  return "'" + JSON.stringify(obj).replace(/'/g, "''") + "'::jsonb";
}

function rowFor(recipe) {
  // Per L brew water grams = recipe stock grams / 50.
  /** @type {Record<string, number>} */
  const perLiter = {};
  for (const [mineralId, grams] of Object.entries(recipe.minerals)) {
    perLiter[mineralId] = grams / DILUTION_DIVISOR;
  }
  const ions = metrics.calculateIonPPMs(perLiter);
  const alkalinity = ions.bicarbonate * HCO3_TO_CACO3;

  // stock_formula JSON keeps the original grams (per 200 mL bottle), preserves
  // the recipe's source attribution, and lists minerals in author-given order.
  const stockFormula = {
    bottleMl: BOTTLE_ML,
    doseGramsPerL: DOSE_G_PER_L,
    minerals: Object.entries(recipe.minerals).map(([id, grams]) => ({
      mineralId: id,
      grams,
    })),
    source: recipe.creator,
    via: "Coffee ad Astra (Jonathan Gagné, Dec 2018)",
  };

  return {
    slug: recipe.slug,
    label: recipe.label,
    description: recipe.description,
    creator: recipe.creator,
    roast: recipe.roast,
    tags: recipe.tags,
    calcium: r1(ions.calcium),
    magnesium: r1(ions.magnesium),
    alkalinity: r1(alkalinity),
    potassium: r1(ions.potassium),
    sodium: r1(ions.sodium),
    sulfate: r1(ions.sulfate),
    chloride: r1(ions.chloride),
    bicarbonate: r1(ions.bicarbonate),
    stockFormula,
  };
}

const rows = RECIPES.map(rowFor);

console.log("-- Computed ion targets for Coffee ad Astra recipes");
console.log("-- " + "slug".padEnd(28) + "  Ca   Mg   Alk    K    Na   SO4   Cl   HCO3 ");
for (const r of rows) {
  console.log(
    "-- " +
      r.slug.padEnd(28) +
      "  " +
      String(r.calcium).padStart(4) +
      " " +
      String(r.magnesium).padStart(4) +
      " " +
      String(r.alkalinity).padStart(4) +
      "  " +
      String(r.potassium).padStart(4) +
      " " +
      String(r.sodium).padStart(4) +
      " " +
      String(r.sulfate).padStart(4) +
      " " +
      String(r.chloride).padStart(4) +
      " " +
      String(r.bicarbonate).padStart(5),
  );
}

console.log("\n\n-- Migration body:\n");

console.log(
  "INSERT INTO target_profiles\n" +
    "  (user_id, slug, label, brew_method,\n" +
    "   calcium, magnesium, alkalinity, potassium, sodium, sulfate, chloride, bicarbonate,\n" +
    "   description, is_public, creator_display_name, tags, tray, roast,\n" +
    "   stock_formula)\n" +
    "VALUES",
);

const tuples = rows.map((r, i) => {
  const isLast = i === rows.length - 1;
  return (
    "  (NULL, '" +
    r.slug +
    "', '" +
    escapeSqlText(r.label) +
    "', 'all',\n" +
    "   " +
    [
      r.calcium,
      r.magnesium,
      r.alkalinity,
      r.potassium,
      r.sodium,
      r.sulfate,
      r.chloride,
      r.bicarbonate,
    ].join(", ") +
    ",\n" +
    "   '" +
    escapeSqlText(r.description) +
    "',\n" +
    "   true, '" +
    escapeSqlText(r.creator) +
    "',\n" +
    "   '" +
    JSON.stringify(r.tags).replace(/'/g, "''") +
    "',\n" +
    "   'classic',\n" +
    "   '" +
    JSON.stringify(r.roast).replace(/'/g, "''") +
    "',\n" +
    "   " +
    jsonbLiteral(r.stockFormula) +
    ")" +
    (isLast ? ";" : ",")
  );
});

console.log(tuples.join("\n\n"));
