// Canonical seed data for store screenshots.
//
// The capture script (scripts/capture-screenshots.mjs) loads this module
// and injects the relevant slice into localStorage before each scene
// renders, so screenshots show realistic content instead of an empty app.
// Edit the recipes here to change what reviewers see on the store listings.
//
// Two compatibility notes:
//   - Storage keys mirror those used by src/lib/storage.ts. Internal
//     identifiers stay as "stock" (per the user-facing-vs-internal rule);
//     visible labels use "Recipe Concentrate."
//   - Slugs are namespaced with "screenshot-" so they can be cleared in
//     bulk without touching real recipe data.

const SCENE_CALCULATOR_RECIPE = {
  slug: "screenshot-calculator-everyday-pour-over",
  label: "Everyday pour over",
  notes: "Bright and balanced. Cleaner mineral profile for lighter roasts.",
  // Brewing target — typical pour-over starting point.
  totalWaterGrams: 350,
  coffeeGrams: 21,
  ratio: 16.7,
  // Mineral target (mg/L) chosen to land near the SCA Brew Water Chart center.
  targets: {
    calcium: 17,
    magnesium: 8,
    sodium: 5,
    bicarbonate: 40,
    chloride: 5,
    sulfate: 30,
  },
};

const SCENE_LIBRARY_RECIPES = [
  {
    slug: "screenshot-library-balanced",
    label: "Balanced (everyday)",
    creator: "Cafelytic",
    isPublic: true,
  },
  {
    slug: "screenshot-library-bright",
    label: "Bright (light roasts)",
    creator: "Cafelytic",
    isPublic: true,
  },
  {
    slug: "screenshot-library-heavy",
    label: "Heavy (espresso, dark roasts)",
    creator: "Cafelytic",
    isPublic: true,
  },
  {
    slug: "screenshot-library-sca",
    label: "SCA target water",
    creator: "Cafelytic",
    isPublic: true,
  },
];

const SCENE_MINERAL_SELECTION = {
  enabled: ["calcium-chloride", "magnesium-sulfate", "sodium-bicarbonate", "magnesium-chloride"],
};

const SCENE_BUILDER_DRAFT = {
  slug: "screenshot-builder-draft-saturday-morning",
  label: "Saturday morning pour over",
  // Mid-edit state — the description input is partly filled to imply
  // active editing without looking like a glitch.
  notes: "Brighter than the everyday recipe. Pulling more acidity from a",
  totalWaterGrams: 500,
  coffeeGrams: 30,
};

const SCENE_SIGNED_IN_USER = {
  // The capture script substitutes the live test session in if creds are
  // available; otherwise it injects this placeholder so the nav renders.
  email: "demo@cafelytic.com",
};

module.exports = {
  SCENE_CALCULATOR_RECIPE,
  SCENE_LIBRARY_RECIPES,
  SCENE_MINERAL_SELECTION,
  SCENE_BUILDER_DRAFT,
  SCENE_SIGNED_IN_USER,
};
