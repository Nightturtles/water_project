// Canonical seed data for store screenshots.
//
// The capture script (scripts/capture-screenshots.mjs) signs every scene in
// as DEMO_USER (stubbed, no real account) and writes DEMO_ACCOUNT_STORAGE into
// localStorage before the page scripts run, so the screenshots show one
// believable account instead of an empty app. Edit the values here to change
// what reviewers see on the store listings.
//
// Three rules keep this honest:
//   - Every key is one the app reads. The names live in
//     src/lib/storage-keys.ts and the shapes in the loaders in
//     src/lib/storage.ts. A key the app does not read is silently ignored,
//     which is how the first version of this file captured five default
//     pages; each scene's `ready` check in the capture script now fails the
//     run when its seeded data is not on screen.
//   - Everything goes to localStorage. Signed out, the app reads its
//     transient keys from sessionStorage and refuses the named-artifact keys
//     (the saved recipe below) altogether; signed in, it reads both kinds
//     from localStorage (_getTransient / _getGated in storage.ts).
//   - Mineral ids come from MINERAL_DB in src/lib/constants.ts. The four
//     doses below make the saved recipe exactly, so the Recipe Builder scene
//     (grams typed in) and the Calculator scene (grams worked out from the
//     saved recipe) agree.

// Not an account: the capture script answers the app's session check with
// this object and blocks every sign-in and sync request.
const DEMO_USER = {
  id: "00000000-0000-4000-8000-00000000c0fe",
  email: "demo@cafelytic.com",
};

// The batch both tool pages are set to.
const BATCH_VOLUME = { value: "1", unit: "gallons" };

// What the demo account has on the shelf: the starter kit plus magnesium
// chloride, so the selection differs visibly from a new user's default.
const SELECTED_MINERALS = ["calcium-chloride", "epsom-salt", "magnesium-chloride", "baking-soda"];

// Grams per gallon typed into the Recipe Builder.
const BUILDER_GRAMS = {
  "calcium-chloride": "0.25",
  "epsom-salt": "0.3",
  "magnesium-chloride": "0.1",
  "baking-soda": "0.16",
};

// A recipe the demo user saved: the water BUILDER_GRAMS makes in one gallon
// of distilled water (mg/L; alkalinity as CaCO3), in the shape the
// Calculator stores a saved target profile.
const USER_RECIPE_SLUG = "sunday-brew";
const USER_RECIPE = {
  label: "Sunday Brew",
  brewMethod: "filter",
  calcium: 18,
  magnesium: 11,
  alkalinity: 25,
  potassium: 0,
  sodium: 11.5,
  sulfate: 31,
  chloride: 41,
  bicarbonate: 30.5,
  description: "Sweet and bright. My go-to for washed light roasts.",
};

const DEMO_ACCOUNT_STORAGE = {
  // Marks the account as already on the eight-recipe starter rail. Without
  // it, the saved recipe below reads as "an account from before the starter
  // rail" and every library recipe is added to the rail
  // (ensureStarterBackfill in storage.ts).
  cw_starter_migration_applied: "1",
  // Calculator: the saved recipe, selected.
  cw_custom_target_profiles: JSON.stringify({ [USER_RECIPE_SLUG]: USER_RECIPE }),
  cw_target_preset: USER_RECIPE_SLUG,
  cw_brew_method: "filter",
  cw_volume_calculator: JSON.stringify(BATCH_VOLUME),
  // Settings (and every page that doses from the shelf).
  cw_selected_minerals: JSON.stringify(SELECTED_MINERALS),
  // Recipe Builder: a recipe in progress.
  cw_volume_recipe: JSON.stringify(BATCH_VOLUME),
  cw_recipe_mineral_inputs: JSON.stringify(BUILDER_GRAMS),
};

module.exports = {
  DEMO_USER,
  SELECTED_MINERALS,
  BUILDER_GRAMS,
  USER_RECIPE_SLUG,
  USER_RECIPE,
  DEMO_ACCOUNT_STORAGE,
};
