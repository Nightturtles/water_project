// @ts-check
// ============================================
// Storage — localStorage helpers and caches
// ============================================
// Cross-file globals (scheduleSyncToCloud, supabaseClient, TARGET_PRESETS, etc.)
// are declared in globals.d.ts.

/**
 * @typedef {Object} SourceProfile
 * @property {string} [label]
 * @property {number} [calcium]
 * @property {number} [magnesium]
 * @property {number} [potassium]
 * @property {number} [sodium]
 * @property {number} [sulfate]
 * @property {number} [chloride]
 * @property {number} [bicarbonate]
 *
 * @typedef {Object} DiyConcentrateSpec
 * @property {number} [bottleMl]
 * @property {number} [gramsPerBottle]
 *
 * @typedef {Object} ValidateNameOptions
 * @property {boolean} [allowEmpty]
 * @property {string} [emptyMessage]
 * @property {string} [invalidMessage]
 * @property {string} [reservedMessage]
 * @property {string} [duplicateMessage]
 * @property {string[] | Set<string>} [builtinKeys]
 * @property {string[] | Set<string>} [existingKeys]
 * @property {string[] | Set<string>} [existingLabels]
 *
 * @typedef {| { ok: true, key: string, name: string, empty?: boolean }
 *           | { ok: false, code: "empty" | "invalid" | "reserved" | "duplicate", message: string }} ValidateNameResult
 */

// --- Safe localStorage wrappers (Bug 4) ---
/** @param {string} key @returns {string | null} */
function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}
/** @param {string} key @param {string} value @returns {boolean} */
function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    return false;
  }
}
/** @param {string} key */
function safeRemoveItem(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) {}
}

// --- JSON parse helper ---
/**
 * @template T
 * @param {string | null} json
 * @param {T} fallback
 * @returns {any | T}
 */
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
/** @param {SourceProfile} profile */
function saveSourceWater(profile) {
  const ok = safeSetItem("cw_source_water", JSON.stringify(profile));
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
  return ok;
}

function loadSourceWater() {
  const fallback = {
    calcium: 0,
    magnesium: 0,
    potassium: 0,
    sodium: 0,
    sulfate: 0,
    chloride: 0,
    bicarbonate: 0,
  };
  const parsed = safeParse(safeGetItem("cw_source_water"), fallback);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
}

/** @param {string} name */
function saveSourcePresetName(name) {
  safeSetItem("cw_source_preset", name);
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

function loadSourcePresetName() {
  return safeGetItem("cw_source_preset") || "distilled";
}

// --- Mineral display mode ---
/** @param {string} mode */
function saveMineralDisplayMode(mode) {
  safeSetItem("cw_mineral_display_mode", mode === "advanced" ? "advanced" : "standard");
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

function loadMineralDisplayMode() {
  return safeGetItem("cw_mineral_display_mode") === "advanced" ? "advanced" : "standard";
}

function isAdvancedMineralDisplayMode() {
  return loadMineralDisplayMode() === "advanced";
}

// --- Volume preference ---
/**
 * @param {string} pageKey
 * @param {number | string | null | undefined} value
 * @param {string | null | undefined} unit
 */
function saveVolumePreference(pageKey, value, unit) {
  if (!pageKey) return;
  const key = "cw_volume_" + pageKey;
  const payload = {
    value: String(value ?? ""),
    unit: unit === "gallons" ? "gallons" : "liters",
  };
  safeSetItem(key, JSON.stringify(payload));
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

/**
 * @param {string} pageKey
 * @param {{ value?: number | string, unit?: string }} [defaults]
 * @returns {{ value: string, unit: "gallons" | "liters" }}
 */
function loadVolumePreference(pageKey, defaults = {}) {
  /** @type {{ value: string, unit: "gallons" | "liters" }} */
  const fallback = {
    value: String(defaults.value ?? "1"),
    unit: defaults.unit === "gallons" ? "gallons" : "liters",
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
/** @param {string} name */
function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// --- Custom source profiles + cache ---
/** @type {Record<string, SourceProfile> | null} */
let customProfilesCache = null;

/** @returns {Record<string, SourceProfile>} */
function loadCustomProfiles() {
  if (customProfilesCache) return Object.assign({}, customProfilesCache);
  const parsed = safeParse(safeGetItem("cw_custom_profiles"), {});
  customProfilesCache =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  return Object.assign({}, customProfilesCache);
}

/** @param {Record<string, SourceProfile>} profiles */
function saveCustomProfiles(profiles) {
  const ok = safeSetItem("cw_custom_profiles", JSON.stringify(profiles));
  customProfilesCache = null;
  invalidateSourcePresetsCache();
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
  return ok;
}

/** @param {string} key */
function deleteCustomProfile(key) {
  const profiles = loadCustomProfiles();
  delete profiles[key];
  saveCustomProfiles(profiles);
  addDeletedPreset(key);
}

// --- Deleted source preset tracking ---
/** @returns {string[]} */
function loadDeletedPresets() {
  const parsed = safeParse(safeGetItem("cw_deleted_presets"), []);
  return Array.isArray(parsed) ? parsed : [];
}

/** @param {string} key */
function addDeletedPreset(key) {
  const deleted = loadDeletedPresets();
  if (!deleted.includes(key)) {
    deleted.push(key);
    safeSetItem("cw_deleted_presets", JSON.stringify(deleted));
    invalidateSourcePresetsCache();
    if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
  }
}

// --- Custom target profiles + cache ---
/** @type {Record<string, TargetProfile> | null} */
let customTargetProfilesCache = null;

/** @returns {Record<string, TargetProfile>} */
function loadCustomTargetProfiles() {
  if (customTargetProfilesCache) return Object.assign({}, customTargetProfilesCache);
  const parsed = safeParse(safeGetItem("cw_custom_target_profiles"), {});
  customTargetProfilesCache =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  return Object.assign({}, customTargetProfilesCache);
}

/** @param {Record<string, TargetProfile>} profiles */
function saveCustomTargetProfiles(profiles) {
  const ok = safeSetItem("cw_custom_target_profiles", JSON.stringify(profiles));
  customTargetProfilesCache = null;
  invalidateTargetPresetsCache();
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
  return ok;
}

/** @param {string} key */
function deleteCustomTargetProfile(key) {
  const profiles = loadCustomTargetProfiles();
  delete profiles[key];
  saveCustomTargetProfiles(profiles);
  addDeletedTargetPreset(key);
}

// --- Deleted target preset tracking (tombstones so deletions survive pull) ---
/** @returns {string[]} */
function loadDeletedTargetPresets() {
  const parsed = safeParse(safeGetItem("cw_deleted_target_presets"), []);
  return Array.isArray(parsed) ? parsed : [];
}

/** @param {string} key */
function addDeletedTargetPreset(key) {
  const deleted = loadDeletedTargetPresets();
  if (!deleted.includes(key)) {
    deleted.push(key);
    safeSetItem("cw_deleted_target_presets", JSON.stringify(deleted));
    invalidateTargetPresetsCache();
    if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
  }
}

// Remove a tombstone so a previously-deleted library/built-in row reappears in
// the preset rail. Used by the "re-add from library" flow (Piece D): when a
// user clicks Add on a canonical library row whose slug is tombstoned, we
// lift the tombstone rather than creating a suffixed custom-profile copy, so
// the built-in returns at its canonical slug.
/** @param {string} key */
function removeDeletedTargetPreset(key) {
  const deleted = loadDeletedTargetPresets();
  const idx = deleted.indexOf(key);
  if (idx === -1) return;
  deleted.splice(idx, 1);
  safeSetItem("cw_deleted_target_presets", JSON.stringify(deleted));
  invalidateTargetPresetsCache();
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

// --- Label helpers (for unique name enforcement) ---
// After Piece B pruned TARGET_PRESETS from 7 to 5 entries, BUILTIN_TARGET_LABELS
// alone no longer covers every library-canonical label. The Supabase library
// is the source of truth for the full library-recipe label set, so merge it in
// here (via the sync cache from library-data.js) to keep the duplicate-name
// guard comprehensive — a user shouldn't be able to name a custom profile
// "Simple and Sweet" and shadow the Supabase row of the same label.
function getExistingTargetProfileLabels() {
  const custom = loadCustomTargetProfiles();
  const labels = new Set();
  for (const key of BUILTIN_TARGET_KEYS) {
    if (BUILTIN_TARGET_LABELS[key]) {
      labels.add(BUILTIN_TARGET_LABELS[key].trim().toLowerCase());
    }
  }
  if (typeof getPublicRecipesSync === "function") {
    for (const row of getPublicRecipesSync()) {
      if (row && row.label) {
        labels.add(row.label.trim().toLowerCase());
      }
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
/** @param {string} name */
function saveTargetPresetName(name) {
  safeSetItem("cw_target_preset", name);
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

function loadTargetPresetName() {
  // Default for new users is the featured Cafelytic Filter recipe (Piece C,
  // 2026-04) — launched as the editorial spotlight when the taxonomy v2 rolled
  // out. Returning users' saved preset takes precedence. On espresso brew mode,
  // activateProfile()'s findFallbackPreset handles the mode mismatch.
  return safeGetItem("cw_target_preset") || "cafelytic-filter";
}

// --- Brew method preference ---
/**
 * @param {string | null | undefined} method
 * @returns {"espresso" | "filter"}
 */
function normalizeBrewMethod(method) {
  return method === "espresso" ? "espresso" : "filter";
}

/** @param {string | null | undefined} method */
function saveBrewMethod(method) {
  safeSetItem("cw_brew_method", normalizeBrewMethod(method));
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

function loadBrewMethod() {
  return normalizeBrewMethod(safeGetItem("cw_brew_method"));
}

// --- Lotus dropper preference ---
/**
 * @param {string | null | undefined} type
 * @returns {"straight" | "round"}
 */
function normalizeLotusDropperType(type) {
  return type === "straight" ? "straight" : "round";
}

/** @param {string | null | undefined} type */
function saveLotusDropperType(type) {
  safeSetItem("cw_lotus_dropper_type", normalizeLotusDropperType(type));
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

function loadLotusDropperType() {
  return normalizeLotusDropperType(safeGetItem("cw_lotus_dropper_type"));
}

function getLotusDropMl() {
  const selectedType = loadLotusDropperType();
  const selectedMl = LOTUS_DROPPER_ML && Number(LOTUS_DROPPER_ML[selectedType]);
  if (Number.isFinite(selectedMl) && selectedMl > 0) return selectedMl;
  const fallbackMl = LOTUS_DROPPER_ML && Number(LOTUS_DROPPER_ML.round);
  return Number.isFinite(fallbackMl) && fallbackMl > 0 ? fallbackMl : 0.0716;
}

/**
 * @param {string | null | undefined} unit
 * @returns {"ml" | "drops"}
 */
function normalizeLotusConcentrateUnit(unit) {
  return unit === "ml" ? "ml" : "drops";
}

/** @param {string | null | undefined} unit */
function saveLotusConcentrateUnit(unit) {
  safeSetItem("cw_lotus_concentrate_unit", normalizeLotusConcentrateUnit(unit));
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

function loadLotusConcentrateUnit() {
  return normalizeLotusConcentrateUnit(safeGetItem("cw_lotus_concentrate_unit"));
}

/** @returns {Record<string, "ml" | "drops">} */
function loadLotusConcentrateUnits() {
  const parsed = safeParse(safeGetItem("cw_lotus_concentrate_units"), {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  /** @type {Record<string, "ml" | "drops">} */
  const normalized = {};
  Object.keys(parsed).forEach((key) => {
    normalized[key] = normalizeLotusConcentrateUnit(parsed[key]);
  });
  return normalized;
}

/** @param {Record<string, string | null | undefined> | null | undefined} units */
function saveLotusConcentrateUnits(units) {
  /** @type {Record<string, "ml" | "drops">} */
  const safeUnits = {};
  if (units && typeof units === "object" && !Array.isArray(units)) {
    Object.keys(units).forEach((key) => {
      safeUnits[key] = normalizeLotusConcentrateUnit(units[key]);
    });
  }
  safeSetItem("cw_lotus_concentrate_units", JSON.stringify(safeUnits));
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

/** @param {string | null | undefined} concentrateId */
function loadLotusConcentrateUnitFor(concentrateId) {
  const units = loadLotusConcentrateUnits();
  if (concentrateId && units[concentrateId]) return units[concentrateId];
  return "drops";
}

/**
 * @param {string | null | undefined} concentrateId
 * @param {string | null | undefined} unit
 */
function saveLotusConcentrateUnitFor(concentrateId, unit) {
  if (!concentrateId) return;
  const units = loadLotusConcentrateUnits();
  units[concentrateId] = normalizeLotusConcentrateUnit(unit);
  saveLotusConcentrateUnits(units);
}

// --- Invalidate all caches (called by sync.js after pulling cloud data) ---
function invalidateAllCaches() {
  customProfilesCache = null;
  customTargetProfilesCache = null;
  selectedMineralsCache = null;
  selectedConcentratesCache = null;
  diyConcentrateSpecsCache = null;
  invalidateSourcePresetsCache();
  invalidateTargetPresetsCache();
}

// --- Source presets aggregation + cache ---
/** @type {Record<string, SourceProfile> | null} */
let sourcePresetsCache = null;
function invalidateSourcePresetsCache() {
  sourcePresetsCache = null;
}

/** @returns {Record<string, SourceProfile>} */
function getAllPresets() {
  if (sourcePresetsCache) return sourcePresetsCache;
  const custom = loadCustomProfiles();
  const deleted = loadDeletedPresets();
  /** @type {Record<string, SourceProfile>} */
  const result = {};
  for (const [key, value] of Object.entries(SOURCE_PRESETS)) {
    if (key === "custom") {
      for (const [ck, cv] of Object.entries(custom)) {
        if (!SOURCE_PRESETS[ck]) {
          result[ck] = cv;
        }
      }
      result[key] = /** @type {SourceProfile} */ (value);
      continue;
    }
    if (deleted.includes(key)) continue;
    result[key] = custom[key] || /** @type {SourceProfile} */ (value);
  }
  sourcePresetsCache = result;
  return sourcePresetsCache;
}

/** @param {string} presetName */
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
/** @type {string[] | null} */
let selectedMineralsCache = null;

/** @param {string[]} mineralIds */
function saveSelectedMinerals(mineralIds) {
  safeSetItem("cw_selected_minerals", JSON.stringify(mineralIds));
  selectedMineralsCache = null;
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

/** @returns {string[]} */
function loadSelectedMinerals() {
  if (selectedMineralsCache) return selectedMineralsCache;
  const parsed = safeParse(safeGetItem("cw_selected_minerals"), null);
  selectedMineralsCache = Array.isArray(parsed)
    ? parsed
    : ["calcium-chloride", "epsom-salt", "baking-soda", "potassium-bicarbonate"];
  return selectedMineralsCache;
}

// --- Selected concentrates + DIY specs ---
/** @type {string[] | null} */
let selectedConcentratesCache = null;
/** @type {Record<string, DiyConcentrateSpec> | null} */
let diyConcentrateSpecsCache = null;

/** @param {string[]} concentrateIds */
function saveSelectedConcentrates(concentrateIds) {
  safeSetItem("cw_selected_concentrates", JSON.stringify(concentrateIds));
  selectedConcentratesCache = null;
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

/** @returns {string[]} */
function loadSelectedConcentrates() {
  if (selectedConcentratesCache) return selectedConcentratesCache;
  const parsed = safeParse(safeGetItem("cw_selected_concentrates"), null);
  selectedConcentratesCache = Array.isArray(parsed) ? parsed : [];
  return selectedConcentratesCache;
}

/** Returns only valid concentrate IDs (diy: or brand: prefixed) from the selected concentrates list. */
function loadValidSelectedConcentrates() {
  return loadSelectedConcentrates().filter(function (id) {
    return typeof id === "string" && (id.startsWith("diy:") || id.startsWith("brand:"));
  });
}

/** @param {Record<string, DiyConcentrateSpec> | null | undefined} specs */
function saveDiyConcentrateSpecs(specs) {
  safeSetItem("cw_diy_concentrate_specs", JSON.stringify(specs || {}));
  diyConcentrateSpecsCache = null;
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

/** @returns {Record<string, DiyConcentrateSpec>} */
function loadDiyConcentrateSpecs() {
  if (diyConcentrateSpecsCache) return Object.assign({}, diyConcentrateSpecsCache);
  const parsed = safeParse(safeGetItem("cw_diy_concentrate_specs"), {});
  diyConcentrateSpecsCache =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  return Object.assign({}, diyConcentrateSpecsCache);
}

/**
 * @param {unknown} concentrateId
 * @returns {string | null}
 */
function parseDiyConcentrateId(concentrateId) {
  if (typeof concentrateId !== "string") return null;
  if (!concentrateId.startsWith("diy:")) return null;
  const mineralId = concentrateId.slice(4);
  return mineralId || null;
}

/**
 * Returns the MINERAL_DB id that this concentrate contributes (for ion math).
 * DIY: mineral id; brand: mapped mineralId; else null.
 * @param {unknown} concentrateId
 * @returns {string | null}
 */
function getConcentrateMineralId(concentrateId) {
  if (typeof concentrateId !== "string") return null;
  if (concentrateId.startsWith("diy:")) return parseDiyConcentrateId(concentrateId);
  const brand = typeof BRAND_CONCENTRATES !== "undefined" && BRAND_CONCENTRATES[concentrateId];
  return brand ? brand.mineralId : null;
}

/** @param {string | null | undefined} mineralId */
function getDiyConcentrateGramsPerMl(mineralId) {
  if (!mineralId) return 0;
  const specs = loadDiyConcentrateSpecs();
  const spec = specs && specs[mineralId] ? specs[mineralId] : null;
  const bottleMl = spec ? Number(spec.bottleMl) : 0;
  const gramsPerBottle = spec ? Number(spec.gramsPerBottle) : 0;
  if (!Number.isFinite(bottleMl) || !Number.isFinite(gramsPerBottle)) return 0;
  if (bottleMl <= 0 || gramsPerBottle <= 0) return 0;
  return gramsPerBottle / bottleMl;
}

/**
 * Grams of equivalent mineral salt per mL of concentrate. Works for DIY (from
 * specs) and brand (from BRAND_CONCENTRATES).
 * @param {unknown} concentrateId
 * @returns {number}
 */
function getConcentrateGramsPerMl(concentrateId) {
  if (typeof concentrateId !== "string") return 0;
  if (concentrateId.startsWith("diy:")) {
    const mineralId = parseDiyConcentrateId(concentrateId);
    return mineralId ? getDiyConcentrateGramsPerMl(mineralId) : 0;
  }
  const brand = typeof BRAND_CONCENTRATES !== "undefined" && BRAND_CONCENTRATES[concentrateId];
  if (brand && Number.isFinite(brand.gramsPerMl)) return brand.gramsPerMl;
  return 0;
}

function getAvailableMineralIds() {
  const out = new Set(loadSelectedMinerals());
  const concentrates = loadSelectedConcentrates();
  for (const cid of concentrates) {
    const mineralId = getConcentrateMineralId(cid);
    if (mineralId) out.add(mineralId);
  }
  return Array.from(out);
}

// --- Mineral source preferences ---

/** Returns an array of enabled alkalinity source mineral ids (baking-soda and/or potassium-bicarbonate). */
function getEffectiveAlkalinitySources() {
  const selected = getAvailableMineralIds();
  const hasBakingSoda = selected.includes("baking-soda");
  const hasPotBicarb = selected.includes("potassium-bicarbonate");
  if (!hasBakingSoda && !hasPotBicarb) return [];
  if (hasBakingSoda && hasPotBicarb) return ["baking-soda", "potassium-bicarbonate"];
  if (hasBakingSoda) return ["baking-soda"];
  return ["potassium-bicarbonate"];
}

/** Returns an array of enabled calcium source mineral ids (calcium-chloride and/or gypsum). */
function getEffectiveCalciumSources() {
  const selected = getAvailableMineralIds();
  const out = [];
  if (selected.includes("calcium-chloride")) out.push("calcium-chloride");
  if (selected.includes("gypsum")) out.push("gypsum");
  return out;
}

/** Returns an array of enabled magnesium source mineral ids (epsom-salt and/or magnesium-chloride). */
function getEffectiveMagnesiumSources() {
  const selected = getAvailableMineralIds();
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
/** @type {Record<string, TargetProfile> | null} */
let targetPresetsCache = null;
function invalidateTargetPresetsCache() {
  targetPresetsCache = null;
}

/**
 * Build the taste-page preset rail by merging three sources in ascending
 * priority, with tombstoned slugs dropped uniformly:
 *
 *   1. TARGET_PRESETS shim  — the 5-entry fallback in constants.js, used
 *                              before Supabase library data arrives on a
 *                              cold pageload.
 *   2. Supabase library     — all is_public=true rows, fetched by
 *                              library-data.js (sync cache via
 *                              getPublicRecipesSync; [] before it resolves).
 *   3. User custom profiles — user_id=auth.uid() rows from Supabase,
 *                              mirrored in localStorage.
 *
 * Later sources override earlier ones at the same slug. Tombstones apply
 * uniformly (if a slug is in cw_deleted_target_presets it is hidden
 * regardless of source), so "remove from rail" works for library rows and
 * custom rows alike. The "+ Add Custom" pseudo-entry is always appended.
 *
 * @returns {Record<string, TargetProfile>}
 */
function getAllTargetPresets() {
  if (targetPresetsCache) return targetPresetsCache;
  const custom = loadCustomTargetProfiles();
  const tombstoned = new Set(loadDeletedTargetPresets());
  const library = typeof getPublicRecipesSync === "function" ? getPublicRecipesSync() : [];

  /** @type {Record<string, TargetProfile>} */
  const result = {};

  // 1. Shim — lowest priority. Kept so the rail has *something* on cold loads
  //    before Supabase responds.
  for (const [key, value] of Object.entries(TARGET_PRESETS)) {
    if (tombstoned.has(key)) continue;
    result[key] = value;
  }

  // 2. Supabase library — overrides shim at the same slug with canonical DB
  //    values. Library rows only carry a slug + ion data + label/description,
  //    so we normalize into the TargetProfile shape getTargetProfileByKey
  //    expects.
  for (const row of library) {
    if (!row || !row.slug) continue;
    if (tombstoned.has(row.slug)) continue;
    result[row.slug] = {
      label: row.label,
      brewMethod: row.brewMethod,
      calcium: row.calcium,
      magnesium: row.magnesium,
      alkalinity: row.alkalinity,
      potassium: row.potassium,
      sodium: row.sodium,
      sulfate: row.sulfate,
      chloride: row.chloride,
      bicarbonate: row.bicarbonate,
      description: row.description || "",
      creatorDisplayName: row.creatorDisplayName || "",
    };
  }

  // 3. User custom — highest priority. Wins over library and shim at any slug
  //    (so a user who copied a library recipe and edited it sees their edits,
  //    not the library row's values).
  for (const [ck, cv] of Object.entries(custom)) {
    if (tombstoned.has(ck)) continue;
    result[ck] = cv;
  }

  result["custom"] = { label: "+ Add Custom" };
  targetPresetsCache = result;
  return targetPresetsCache;
}

/**
 * @param {string} key
 * @returns {TargetProfile | null}
 */
function getTargetProfileByKey(key) {
  if (key === "custom") return null;
  const custom = loadCustomTargetProfiles();
  return custom[key] || TARGET_PRESETS[key] || null;
}

/**
 * @param {string} key
 * @param {TargetProfile | null | undefined} profile
 * @returns {"espresso" | "filter"}
 */
function inferTargetProfileBrewMethod(key, profile) {
  if (profile && (profile.brewMethod === "filter" || profile.brewMethod === "espresso")) {
    return profile.brewMethod;
  }
  if (typeof key === "string" && (key.startsWith("eaf-") || key.includes("espresso"))) {
    return "espresso";
  }
  const label = (profile && profile.label ? String(profile.label) : "").toLowerCase();
  const description = (
    profile && profile.description ? String(profile.description) : ""
  ).toLowerCase();
  if (label.includes("espresso") || description.includes("espresso")) {
    return "espresso";
  }
  return "filter";
}

/**
 * @param {string} key
 * @param {TargetProfile | null | undefined} profile
 * @param {string | null | undefined} method
 */
function targetProfileSupportsBrewMethod(key, profile, method) {
  const brewMethod = normalizeBrewMethod(method);
  if (profile && Array.isArray(profile.brewMethods)) {
    const allowed = new Set(
      /** @type {unknown[]} */ (profile.brewMethods)
        .map((value) => normalizeBrewMethod(/** @type {string | null | undefined} */ (value)))
        .filter((value, index, array) => array.indexOf(value) === index),
    );
    return allowed.has(brewMethod);
  }
  return inferTargetProfileBrewMethod(key, profile) === brewMethod;
}

/** @param {string | null | undefined} method */
function getTargetPresetsForBrewMethod(method) {
  const brewMethod = normalizeBrewMethod(method);
  const allPresets = getAllTargetPresets();
  /** @type {Record<string, TargetProfile>} */
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
    filtered.custom = { label: "+ Add Custom" };
  }
  return filtered;
}

// --- Profile name validation ---
/**
 * @param {string | null | undefined} rawName
 * @param {ValidateNameOptions} [options]
 * @returns {ValidateNameResult}
 */
function validateProfileName(rawName, options = {}) {
  const allowEmpty = !!options.allowEmpty;
  const emptyMessage = options.emptyMessage || "Enter a profile name.";
  const invalidMessage = options.invalidMessage || "Enter a valid name.";
  const reservedMessage =
    options.reservedMessage || "That name is reserved. Choose a different name.";
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

/**
 * @param {string | null | undefined} rawName
 * @param {{ allowEmpty?: boolean }} [options]
 * @returns {ValidateNameResult}
 */
function validateTargetProfileName(rawName, options = {}) {
  return validateProfileName(rawName, {
    allowEmpty: options.allowEmpty,
    builtinKeys: RESERVED_TARGET_KEYS,
    existingKeys: new Set(Object.keys(loadCustomTargetProfiles())),
    existingLabels: getExistingTargetProfileLabels(),
  });
}

// --- Restore defaults ---
function restoreSourcePresetDefaults() {
  // Clear tombstones for builtin presets only.  Tombstones for purely-custom
  // slugs must be preserved so deleted customs don't resurrect from the cloud.
  const preserved = loadDeletedPresets().filter(function (key) {
    return !SOURCE_PRESETS[key];
  });
  safeSetItem("cw_deleted_presets", JSON.stringify(preserved));
  invalidateSourcePresetsCache();
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
  const custom = loadCustomProfiles();
  for (const key of Object.keys(SOURCE_PRESETS)) {
    if (key === "custom") continue;
    delete custom[key];
  }
  saveCustomProfiles(custom);
}

// --- Theme ---
function loadThemePreference() {
  const saved = safeGetItem(THEME_KEY);
  if (saved === "light" || saved === "dark" || saved === "system") return saved;
  return "system";
}

/** @param {string} mode */
function saveThemePreference(mode) {
  safeSetItem(THEME_KEY, mode);
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

// --- Creator display name (for recipe library publishing) ---
function loadCreatorDisplayName() {
  return safeGetItem("cw_creator_display_name") || "";
}

/** @param {string} name */
function saveCreatorDisplayName(name) {
  safeSetItem("cw_creator_display_name", name);
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

// --- Recipes-moved toaster (one-time) ---
const RECIPES_TOASTER_DISMISSED_KEY = "cw_recipes_toaster_dismissed";

function loadRecipesToasterDismissed() {
  return safeGetItem(RECIPES_TOASTER_DISMISSED_KEY) === "true";
}

function saveRecipesToasterDismissed() {
  safeSetItem(RECIPES_TOASTER_DISMISSED_KEY, "true");
}

// --- Calculator welcome modal (one-time) ---
const WELCOME_MODAL_DISMISSED_KEY = "cw_calculator_welcome_dismissed";

function loadCalculatorWelcomeDismissed() {
  return safeGetItem(WELCOME_MODAL_DISMISSED_KEY) === "true";
}

function saveCalculatorWelcomeDismissed() {
  safeSetItem(WELCOME_MODAL_DISMISSED_KEY, "true");
}

// --- Multi-tab cache invalidation (Inefficiency 4) ---
window.addEventListener("storage", function (e) {
  if (!e.key) return;
  if (e.key === "cw_custom_profiles") {
    customProfilesCache = null;
    invalidateSourcePresetsCache();
  }
  if (e.key === "cw_custom_target_profiles") {
    customTargetProfilesCache = null;
    invalidateTargetPresetsCache();
  }
  if (e.key === "cw_selected_minerals") {
    selectedMineralsCache = null;
  }
  if (e.key === "cw_selected_concentrates") {
    selectedConcentratesCache = null;
  }
  if (e.key === "cw_diy_concentrate_specs") {
    diyConcentrateSpecsCache = null;
  }
  if (e.key === "cw_deleted_presets") {
    invalidateSourcePresetsCache();
  }
  if (e.key === "cw_deleted_target_presets") {
    invalidateTargetPresetsCache();
  }
});
