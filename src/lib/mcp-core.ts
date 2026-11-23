// ============================================
// MCP core: the app logic the MCP server shares
// ============================================
// The MCP server (supabase/functions/mcp) runs on Deno, outside the Vite
// bundle. It must report the same GH / KH / TDS, raise the same range
// warnings, and hand out the same profile keys as the app, so it takes those
// from here instead of re-implementing them. `npm run mcp:build` bundles this
// entry into supabase/functions/mcp/app-core.gen.js; tests/mcp-core.test.ts
// fails when that file is stale.
//
// Only re-export functions that take everything they need as arguments. A
// function that falls back to reading the browser's storage would silently
// use defaults on the server, where there is no signed-in browser state.

export {
  MINERAL_DB,
  SOURCE_PRESETS,
  TARGET_PRESETS,
  RESERVED_TARGET_KEYS,
  ION_FIELDS,
  BRAND_CONCENTRATES,
  LIBRARY_TAGS,
  MINERAL_SOLUBILITY_G_PER_L_25C_APPROX,
  RESERVED_LIBRARY_STOCK_SLUGS,
  HCO3_TO_CACO3,
  CACO3_TO_HCO3,
} from "./constants";
export {
  calculateMetrics,
  recipeMetricsSummary,
  calculateSo4ClRatio,
  evaluateWaterProfileRanges,
  calculateIonPPMs,
  // Reads the browser's mineral selection only when options.calciumChlorideId
  // is left out; the server always passes it.
  deriveStockFormulaFromTarget,
} from "./metrics";
export { slugify, validateProfileName, computeStockMineralGramsPerL } from "./storage";
// The Calculator page's dose math and kit rules. Both take the user's settings
// as arguments (the page passes this browser's, the server the synced row).
export { computeDoses, buildDosingKit } from "./dosing";
