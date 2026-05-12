// @ts-check
// ============================================
// Storage — localStorage helpers and caches
// ============================================
// Cross-file globals (scheduleSyncToCloud, supabaseClient, TARGET_PRESETS, etc.)
// are declared in globals.d.ts.

/**
 * @typedef {Object} SourceProfile
 * @property {string} [label]
 * @property {string} [category] - Picker grouping bucket (e.g. "pure", "generic", "bottled", "saved"). Set on built-ins in constants.js; user-saved profiles omit it and fall under "saved" in the picker.
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
 * @typedef {Object} StockMineralEntry
 * @property {string} mineralId   - Key in MINERAL_DB (e.g. "epsom-salt").
 * @property {number} grams       - Grams of this salt dissolved in the stock bottle.
 *
 * @typedef {Object} StockConcentrateSpec
 * @property {string} [label]              - User-facing name (e.g. "Rao/Perger").
 * @property {number} [bottleMl]           - Bottle volume the minerals are dissolved in.
 * @property {number} [doseGramsPerL]      - Grams of stock per liter of brew water.
 * @property {StockMineralEntry[]} [minerals]
 * @property {string} [createdFrom]        - Optional back-reference (e.g. "library:rao-perger").
 * @property {string} [source]             - Optional attribution carried from the library row (e.g. "Rao & Perger").
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
  // If a slug is being added that was previously tombstoned, lift the
  // tombstone — the user's explicit save is unambiguous intent. This must
  // happen at save time, not in sync, so we don't conflate "user re-saved"
  // with "stale local state from a missed pull" (the latter would otherwise
  // resurrect cross-device deletions).
  liftTombstonesForNewlyAddedSlugs(
    profiles,
    customProfilesCache,
    loadDeletedPresets,
    "cw_deleted_presets",
    invalidateSourcePresetsCache,
  );
  const ok = safeSetItem("cw_custom_profiles", JSON.stringify(profiles));
  customProfilesCache = null;
  invalidateSourcePresetsCache();
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
  return ok;
}

// Shared helper: when the new dict has slugs not in the previous dict, lift
// any matching tombstones. Inlines the tombstone-array mutation rather than
// calling addDeletedTargetPreset/removeDeletedTargetPreset so source and
// target sides share one code path.
/**
 * @param {Record<string, unknown>} newProfiles
 * @param {Record<string, unknown> | null} oldCache
 * @param {() => string[]} loadFn
 * @param {string} storageKey
 * @param {() => void} invalidateFn
 */
function liftTombstonesForNewlyAddedSlugs(newProfiles, oldCache, loadFn, storageKey, invalidateFn) {
  const tombstones = loadFn();
  if (tombstones.length === 0) return;
  const oldProfiles = oldCache || {};
  const newSlugs = Object.keys(newProfiles).filter(function (slug) {
    return !Object.prototype.hasOwnProperty.call(oldProfiles, slug);
  });
  if (newSlugs.length === 0) return;
  const filtered = tombstones.filter(function (/** @type {string} */ slug) {
    return newSlugs.indexOf(slug) === -1;
  });
  if (filtered.length !== tombstones.length) {
    safeSetItem(storageKey, JSON.stringify(filtered));
    if (typeof invalidateFn === "function") invalidateFn();
  }
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
  liftTombstonesForNewlyAddedSlugs(
    profiles,
    customTargetProfilesCache,
    loadDeletedTargetPresets,
    "cw_deleted_target_presets",
    invalidateTargetPresetsCache,
  );
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

// --- Added target preset tracking (mirror of tombstones for non-starter slugs) ---
// Migration 011 split canonical library rows into starter (8 rows, visible by
// default) and non-starter (the rest, hidden by default). The added list
// records which non-starter canonical slugs the user has explicitly brought
// into their rail via library.html. Symmetric with the tombstone list —
// tombstones subtract from the default rail, added adds to it — and synced
// to Supabase via the same user_selections round-trip (sync.js).
//
// Every read here triggers ensureStarterBackfill() first (defined below near
// getAllTargetPresets, since it depends on getPublicRecipesSync). That way a
// user landing on library.html before the rail ever renders still gets their
// pre-011 catalog preserved — library-data.js reads this list directly for
// save-state and copy logic.

/** @returns {string[]} */
function loadAddedTargetPresetsRaw() {
  const parsed = safeParse(safeGetItem("cw_added_target_presets"), []);
  return Array.isArray(parsed) ? parsed : [];
}

/** @returns {string[]} */
function loadAddedTargetPresets() {
  if (typeof ensureStarterBackfill === "function") ensureStarterBackfill();
  return loadAddedTargetPresetsRaw();
}

/** @param {string} key */
function addAddedTargetPreset(key) {
  const added = loadAddedTargetPresets();
  if (!added.includes(key)) {
    added.push(key);
    safeSetItem("cw_added_target_presets", JSON.stringify(added));
    invalidateTargetPresetsCache();
    if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
  }
}

/** @param {string} key */
function removeAddedTargetPreset(key) {
  const added = loadAddedTargetPresets();
  const idx = added.indexOf(key);
  if (idx === -1) return;
  added.splice(idx, 1);
  safeSetItem("cw_added_target_presets", JSON.stringify(added));
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

/**
 * @param {string} [brewMethod] "filter" or "espresso" (defaults to filter)
 */
function loadTargetPresetName(brewMethod) {
  // Saved preset (any brew mode) wins. For new users with no saved preset,
  // pick the canonical Cafelytic default matching the caller's active brew
  // mode: cafelytic-filter (filter) or cafelytic-espresso (espresso). This
  // replaces the prior "always return cafelytic-filter then let
  // findFallbackPreset correct it" pattern — the default is now explicit
  // per mode instead of relying on a silent downstream correction.
  //
  // "library" is an action pseudo-tile, not a real profile. The click
  // handlers never persist it, but devtools tampering or a future
  // regression could leave it stuck in storage; treat it as missing so a
  // bad value can't auto-open the picker on every page load.
  const saved = safeGetItem("cw_target_preset");
  if (saved && saved !== "library") return saved;
  return brewMethod === "espresso" ? "cafelytic-espresso" : "cafelytic-filter";
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
  stockConcentrateSpecsCache = null;
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
    const override = custom[key];
    if (override) {
      // Save Changes (source-water-ui.js) writes the edited profile into
      // customProfiles[<builtin-key>] without copying the built-in's category.
      // Inherit it here so the picker still groups the override under its
      // original heading (e.g. an edited "evian" still renders as Bottled).
      result[key] = override.category
        ? override
        : Object.assign({}, override, { category: value && value.category });
    } else {
      result[key] = /** @type {SourceProfile} */ (value);
    }
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
/** @type {Record<string, StockConcentrateSpec> | null} */
let stockConcentrateSpecsCache = null;

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

/** Returns only valid concentrate IDs (diy:, brand:, or stock: prefixed) from the selected concentrates list. */
function loadValidSelectedConcentrates() {
  return loadSelectedConcentrates().filter(function (id) {
    return (
      typeof id === "string" &&
      (id.startsWith("diy:") || id.startsWith("brand:") || id.startsWith("stock:"))
    );
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

// --- Stock (multi-mineral DIY) concentrate specs ---
// A stock spec describes ONE bottle that holds several minerals dissolved
// together — e.g. 5 g epsom + 2 g MgCl2 + 1.5 g CaCl2 + 1.7 g NaHCO3 +
// 2 g KHCO3 in 200 mL distilled water — and a per-liter dose rate. Coexists
// with single-mineral diy:* and fixed brand:* concentrates. UI for defining
// these arrives in B2; calculator dispensing in B3. Adding the storage
// primitives now keeps each phase shippable independently.

/** @param {Record<string, StockConcentrateSpec> | null | undefined} specs */
function saveStockConcentrateSpecs(specs) {
  safeSetItem("cw_stock_concentrate_specs", JSON.stringify(specs || {}));
  stockConcentrateSpecsCache = null;
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

/** @returns {Record<string, StockConcentrateSpec>} */
function loadStockConcentrateSpecs() {
  if (stockConcentrateSpecsCache) return Object.assign({}, stockConcentrateSpecsCache);
  const parsed = safeParse(safeGetItem("cw_stock_concentrate_specs"), {});
  stockConcentrateSpecsCache =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  return Object.assign({}, stockConcentrateSpecsCache);
}

/**
 * Extracts the slug from a "stock:<slug>" concentrate id.
 * @param {unknown} concentrateId
 * @returns {string | null}
 */
function parseStockConcentrateId(concentrateId) {
  if (typeof concentrateId !== "string") return null;
  if (!concentrateId.startsWith("stock:")) return null;
  const slug = concentrateId.slice(6);
  return slug || null;
}

/**
 * Returns the full StockConcentrateSpec for a "stock:<slug>" id, or null if
 * not found / not a stock id.
 * @param {unknown} concentrateId
 * @returns {StockConcentrateSpec | null}
 */
function getStockSpec(concentrateId) {
  const slug = parseStockConcentrateId(concentrateId);
  if (!slug) return null;
  const specs = loadStockConcentrateSpecs();
  return specs && specs[slug] ? specs[slug] : null;
}

/**
 * Returns all unique mineral ids contained in a stock spec. Each entry's
 * mineralId is normalized; duplicates collapse. Used by getAvailableMineralIds
 * so the calculator's mineral-source pickers see every mineral the user can
 * dose via an enabled stock.
 * @param {StockConcentrateSpec | null | undefined} spec
 * @returns {string[]}
 */
function getStockMineralIds(spec) {
  if (!spec || !Array.isArray(spec.minerals)) return [];
  const out = new Set();
  for (const entry of spec.minerals) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof entry.mineralId === "string" &&
      entry.mineralId
    ) {
      out.add(entry.mineralId);
    }
  }
  return Array.from(out);
}

/**
 * Returns the first "stock:<slug>" id in `concentrateIds`, or null if none
 * is enabled. v1 single-stock-active rule: the calculator and recipe builder
 * both dispense from this one stock and ignore any others. Centralized here
 * so future multi-stock work touches one helper instead of three call sites.
 * @param {unknown} concentrateIds
 * @returns {string | null}
 */
function getActiveStockId(concentrateIds) {
  if (!Array.isArray(concentrateIds)) return null;
  for (const id of concentrateIds) {
    if (typeof id === "string" && id.startsWith("stock:")) return id;
  }
  return null;
}

/**
 * Convenience wrapper around getActiveStockId + getStockSpec — returns the
 * resolved spec for the first enabled stock, or null if none enabled or the
 * spec was deleted (orphan id).
 * @param {unknown} concentrateIds
 * @returns {StockConcentrateSpec | null}
 */
function getActiveStockSpec(concentrateIds) {
  const id = getActiveStockId(concentrateIds);
  return id ? getStockSpec(id) : null;
}

/**
 * Per-liter grams of each mineral when dispensing the stock at its prescribed
 * dose (one liter of brew water gets `doseGramsPerL` grams of stock; that
 * amount carries `mineral.grams / bottleMl` grams of each mineral per gram of
 * stock — same convention as scripts/compute-coffee-ad-astra-ions.cjs).
 * Returns {} for malformed specs (zero/missing bottleMl or doseGramsPerL,
 * non-array minerals, etc.).
 * @param {StockConcentrateSpec | null | undefined} spec
 * @returns {Record<string, number>}
 */
function computeStockMineralGramsPerL(spec) {
  /** @type {Record<string, number>} */
  const out = {};
  if (!spec || !Array.isArray(spec.minerals)) return out;
  const bottleMl = Number(spec.bottleMl);
  const doseGramsPerL = Number(spec.doseGramsPerL);
  if (!Number.isFinite(bottleMl) || bottleMl <= 0) return out;
  if (!Number.isFinite(doseGramsPerL) || doseGramsPerL <= 0) return out;
  for (const m of spec.minerals) {
    if (!m || typeof m !== "object" || !m.mineralId) continue;
    const grams = Number(m.grams);
    if (!Number.isFinite(grams) || grams <= 0) continue;
    out[m.mineralId] = (out[m.mineralId] || 0) + (grams / bottleMl) * doseGramsPerL;
  }
  return out;
}

/**
 * Imports a library recipe's stockFormula into the user's stock pantry, keyed
 * on the library row's slug, with createdFrom set to "library:<slug>" so the
 * "Reset to library values" link in Settings can find the source row later.
 *
 * Idempotent: if a spec with that slug is already present, returns
 * {status:"already-present"} without writing. The user's path to refresh from
 * library values is the reset link in Settings — re-importing here would
 * silently clobber any edits the user made (e.g. matching the bottle volume
 * they actually have on hand).
 *
 * Does NOT auto-enable the stock in cw_selected_concentrates; user explicitly
 * enables it from Settings. saveStockConcentrateSpecs already triggers cloud
 * sync via scheduleSyncToCloud.
 *
 * NOTE: No production caller as of #stock-import editor flow — recipe-browser.js
 * onAddStock now navigates to "minerals.html#stock-import=<slug>" so the user
 * can review/tweak before saving. Retained as the canonical "recreate library
 * spec from a recipe" helper for storage-stock.test.js coverage and a planned
 * "Reset to library values" affordance.
 *
 * @param {{ slug?: unknown, label?: unknown, stockFormula?: any } | null | undefined} recipe
 * @returns {{ status: "imported" | "already-present" | "invalid", slug: string | null }}
 */
function importLibraryStockToPantry(recipe) {
  if (!recipe || typeof recipe !== "object") return { status: "invalid", slug: null };
  const slug = typeof recipe.slug === "string" ? recipe.slug : "";
  const formula = recipe.stockFormula;
  if (!slug || !formula || !Array.isArray(formula.minerals) || formula.minerals.length === 0) {
    return { status: "invalid", slug: null };
  }
  const specs = loadStockConcentrateSpecs();
  if (specs[slug]) return { status: "already-present", slug };

  /** @type {StockMineralEntry[]} */
  const minerals = [];
  for (const m of formula.minerals) {
    if (!m || typeof m !== "object" || typeof m.mineralId !== "string" || !m.mineralId) continue;
    minerals.push({ mineralId: m.mineralId, grams: Number(m.grams) || 0 });
  }
  // If every entry was malformed, the resulting spec would have an empty
  // minerals array — inert (computeStockMineralGramsPerL returns {} for it)
  // but still pollutes the user's pantry. Treat as invalid so we don't
  // persist a dead-on-arrival entry.
  if (minerals.length === 0) return { status: "invalid", slug: null };

  /** @type {StockConcentrateSpec} */
  const spec = {
    label: typeof recipe.label === "string" && recipe.label ? recipe.label : slug,
    bottleMl: Number(formula.bottleMl) || 0,
    doseGramsPerL: Number(formula.doseGramsPerL) || 0,
    minerals,
    createdFrom: "library:" + slug,
  };
  if (typeof formula.source === "string" && formula.source) spec.source = formula.source;

  specs[slug] = spec;
  saveStockConcentrateSpecs(specs);
  return { status: "imported", slug };
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
    if (mineralId) {
      out.add(mineralId);
      continue;
    }
    // Stock concentrates are multi-mineral, so getConcentrateMineralId returns
    // null. Enumerate every mineral inside the stock so downstream pickers
    // (calcium-source, alkalinity-source) see them all.
    if (typeof cid === "string" && cid.startsWith("stock:")) {
      const spec = getStockSpec(cid);
      for (const mid of getStockMineralIds(spec)) out.add(mid);
    }
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

// Starter-migration backfill flag. Migration 011 narrowed the default rail
// from every canonical row (~28) to is_starter=true rows (8). Users who
// explicitly curated their rail pre-011 (tombstoning some recipes or
// creating custom profiles) should keep their current rail shape post-011;
// auto-populate the added list with every non-starter canonical slug to
// preserve it. Users who never customized get the new 8-recipe starter
// rail — they had no investment in the extras, and re-adding is one click
// in library.html.
//
// Only tombstones + custom profiles count as "curated" signals. cw_target_preset
// doesn't — script.js writes a default on every page mount before the rail
// renders, so checking it would trigger backfill for every fresh user too.
//
// ensureStarterBackfill is idempotent (early-returns once the flag is set)
// and called from every entry point that reads the added list — both
// getAllTargetPresets and loadAddedTargetPresets — so library-first flows
// (user lands on library.html before taste.html renders the rail) don't
// skip the migration.
const STARTER_MIGRATION_KEY = "cw_starter_migration_applied";
function ensureStarterBackfill() {
  if (safeGetItem(STARTER_MIGRATION_KEY) === "1") return;
  const library = typeof getPublicRecipesSync === "function" ? getPublicRecipesSync() : [];
  if (!Array.isArray(library) || library.length === 0) return; // rerun when library arrives
  const hasPriorTombstones = loadDeletedTargetPresets().length > 0;
  const hasPriorCustom = Object.keys(loadCustomTargetProfiles()).length > 0;
  const existingUser = hasPriorTombstones || hasPriorCustom;
  if (existingUser) {
    // Use the raw read so a future refactor that re-enters loadAddedTargetPresets
    // from inside the backfill doesn't recurse.
    const seed = loadAddedTargetPresetsRaw();
    const seedSet = new Set(seed);
    for (const row of library) {
      if (!row || !row.slug) continue;
      if (row.userId != null) continue;
      if (row.isStarter) continue;
      if (seedSet.has(row.slug)) continue;
      seed.push(row.slug);
      seedSet.add(row.slug);
    }
    safeSetItem("cw_added_target_presets", JSON.stringify(seed));
    if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
  }
  safeSetItem(STARTER_MIGRATION_KEY, "1");
}

/**
 * Build the taste-page preset rail by merging three sources in ascending
 * priority, with tombstoned slugs dropped and non-starter canonical rows
 * filtered to the user's explicit added list:
 *
 *   1. TARGET_PRESETS shim  — the 8-entry fallback in constants.js, used
 *                              before Supabase library data arrives on a
 *                              cold pageload.
 *   2. Supabase library     — all is_public=true rows, fetched by
 *                              library-data.js. Canonical rows
 *                              (userId == null) are gated on is_starter +
 *                              added_target_presets; user-published rows
 *                              (userId != null) do not pass through the rail
 *                              merge (they arrive via copy-to-custom).
 *   3. User custom profiles — user_id=auth.uid() rows from Supabase,
 *                              mirrored in localStorage.
 *
 * Later sources override earlier ones at the same slug. Tombstones apply
 * uniformly. The "+ Add Custom" pseudo-entry is always appended.
 *
 * @returns {Record<string, TargetProfile>}
 */
function getAllTargetPresets() {
  if (targetPresetsCache) return targetPresetsCache;
  const custom = loadCustomTargetProfiles();
  const tombstoned = new Set(loadDeletedTargetPresets());
  const library = typeof getPublicRecipesSync === "function" ? getPublicRecipesSync() : [];

  ensureStarterBackfill();
  const added = new Set(loadAddedTargetPresetsRaw());

  /** @type {Record<string, TargetProfile>} */
  const result = {};

  // 1. Shim — lowest priority. Kept so the rail has *something* on cold loads
  //    before Supabase responds. The shim is the 8 starter slugs exactly, so
  //    no per-entry starter filter is needed here.
  for (const [key, value] of Object.entries(TARGET_PRESETS)) {
    if (tombstoned.has(key)) continue;
    result[key] = value;
  }

  // 2. Supabase library — overrides shim at the same slug with canonical DB
  //    values. Canonical rows (userId == null) pass only if is_starter OR the
  //    user explicitly added the slug via library.html. User-published rows
  //    (userId != null) bypass the starter filter and flow through as before
  //    — the starter/added gating is canonical-row-only.
  for (const row of library) {
    if (!row || !row.slug) continue;
    if (tombstoned.has(row.slug)) continue;
    if (row.userId == null && !row.isStarter && !added.has(row.slug)) continue;
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

  result["custom"] = { label: "+ Custom" };
  result["library"] = { label: "+ From Library" };
  targetPresetsCache = result;
  return targetPresetsCache;
}

/**
 * @param {string} key
 * @returns {TargetProfile | null}
 */
function getTargetProfileByKey(key) {
  if (key === "custom") return null;
  // Route through the merged rail so library-only slugs (sey, aviary-*, rasami-*,
  // and all library-seeded built-ins) and library-overridden shim slugs resolve
  // to the same object the rail renders. Using loadCustomTargetProfiles + the
  // 5-entry shim directly would miss every library row and return null.
  const merged = getAllTargetPresets();
  return merged[key] || null;
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
  // Recipe-browser taxonomy v2 (migration 008): brew_method='all' means the
  // recipe works across both modes (e.g. SCA target, some roaster waters),
  // so it shows up in whichever mode the user is in. Normalization in
  // library-data.js passes the value through verbatim, so checking the
  // string is sufficient.
  if (profile && profile.brewMethod === "all") {
    return true;
  }
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
    if (key === "custom" || key === "library") {
      filtered[key] = profile;
      continue;
    }
    if (targetProfileSupportsBrewMethod(key, profile, brewMethod)) {
      filtered[key] = profile;
    }
  }
  if (!filtered.custom) {
    filtered.custom = { label: "+ Custom" };
  }
  if (!filtered.library) {
    filtered.library = { label: "+ From Library" };
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
// Guarded for Node / Vitest contexts (unit tests may stub window as a bare
// object on globalThis, so check for the actual method before calling).
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("storage", function (e) {
    if (!e.key) return;
    var recipeAffected = false;
    if (e.key === "cw_custom_profiles") {
      customProfilesCache = null;
      invalidateSourcePresetsCache();
      recipeAffected = true;
    }
    if (e.key === "cw_custom_target_profiles") {
      customTargetProfilesCache = null;
      invalidateTargetPresetsCache();
      recipeAffected = true;
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
    if (e.key === "cw_stock_concentrate_specs") {
      stockConcentrateSpecsCache = null;
    }
    if (e.key === "cw_deleted_presets") {
      invalidateSourcePresetsCache();
      recipeAffected = true;
    }
    if (e.key === "cw_deleted_target_presets") {
      invalidateTargetPresetsCache();
      recipeAffected = true;
    }
    if (e.key === "cw_added_target_presets") {
      invalidateTargetPresetsCache();
      recipeAffected = true;
    }
    // When another tab on this device receives a Realtime update and
    // writes the merged state to localStorage, fan the event out so this
    // tab's UI listeners also re-render. (CustomEvent doesn't cross tabs;
    // the storage event does.)
    if (recipeAffected && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent("cw:cloud-data-changed"));
    }
  });
}

// --- Node/Vitest UMD shim (harmless in browsers) ---
// Tests require this file as a CJS module and need to call its functions; in
// the browser we rely on classic-script globals across files. The shim uses
// Object.assign(module.exports, …) rather than `module.exports = …` so tsc
// doesn't classify this file as a CommonJS module — which would hide its
// top-level function declarations from sibling @ts-checked files like sync.js
// that reach them as script-scope globals.
if (typeof module !== "undefined" && module.exports) {
  const _umdExports = {
    getAllTargetPresets,
    getTargetProfileByKey,
    getTargetPresetsForBrewMethod,
    targetProfileSupportsBrewMethod,
    invalidateTargetPresetsCache,
    loadDeletedTargetPresets,
    addDeletedTargetPreset,
    removeDeletedTargetPreset,
    loadAddedTargetPresets,
    addAddedTargetPreset,
    removeAddedTargetPreset,
    loadCustomTargetProfiles,
    saveCustomTargetProfiles,
    getExistingTargetProfileLabels,
    loadTargetPresetName,
    slugify,
    // Stock concentrate helpers (B1) — exposed for unit tests; production
    // callers already see them as classic-script globals.
    loadStockConcentrateSpecs,
    saveStockConcentrateSpecs,
    parseStockConcentrateId,
    getStockSpec,
    getStockMineralIds,
    getActiveStockId,
    getActiveStockSpec,
    computeStockMineralGramsPerL,
    importLibraryStockToPantry,
    loadSelectedConcentrates,
    saveSelectedConcentrates,
    loadValidSelectedConcentrates,
    getAvailableMineralIds,
    invalidateAllCaches,
  };
  Object.assign(module.exports, _umdExports);
  Object.assign(globalThis, _umdExports);
}
