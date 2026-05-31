// ============================================
// Storage — localStorage helpers and caches
// ============================================
// Cross-file globals (scheduleSyncToCloud, supabaseClient, TARGET_PRESETS, etc.)
// are declared in globals.d.ts.

import { KEYS, VOLUME_PREFIX } from "./storage-keys";

interface SourceProfile {
  label?: string;
  // Picker grouping bucket (e.g. "pure", "generic", "bottled", "saved"). Set
  // on built-ins in constants.js; user-saved profiles omit it and fall under
  // "saved" in the picker.
  category?: string;
  calcium?: number;
  magnesium?: number;
  potassium?: number;
  sodium?: number;
  sulfate?: number;
  chloride?: number;
  bicarbonate?: number;
}

interface DiyConcentrateSpec {
  bottleMl?: number;
  gramsPerBottle?: number;
}

interface StockMineralEntry {
  mineralId: string;
  grams: number;
}

interface StockConcentrateSpec {
  label?: string;
  bottleMl?: number;
  doseGramsPerL?: number;
  minerals?: StockMineralEntry[];
  createdFrom?: string;
  source?: string;
}

interface ValidateNameOptions {
  allowEmpty?: boolean;
  emptyMessage?: string;
  invalidMessage?: string;
  reservedMessage?: string;
  duplicateMessage?: string;
  builtinKeys?: string[] | Set<string>;
  existingKeys?: string[] | Set<string>;
  existingLabels?: string[] | Set<string>;
}

type ValidateNameResult =
  | { ok: true; key: string; name: string; empty?: boolean }
  | {
      ok: false;
      code: "empty" | "invalid" | "reserved" | "duplicate";
      message: string;
    };

// --- Safe localStorage wrappers (Bug 4) ---
export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}
export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    return false;
  }
}
export function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (e) {}
}

// --- Auth-aware storage helpers ---
// Category A (transient) keys route to sessionStorage when the user is
// anonymous so an unsigned-in visitor can navigate between pages within a
// tab without losing in-progress calculator state — but nothing is persisted
// across tabs or browser restarts.  When logged in, transient keys go to
// localStorage and are cloud-synced via sync.js.
//
// _isLoggedInSync reads the canonical cache set up by supabase-client.js
// (window._cachedAuthUserId / window.isLoggedInSync).  Until the initial
// getSession() resolves, this returns false — pages render as anonymous,
// then re-render when cw:auth-state-resolved fires.
function _isLoggedInSync(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.isLoggedInSync === "function" &&
    window.isLoggedInSync()
  );
}
// _getTransient / _setTransient / _getGated / _setGated are underscore-named
// to signal "internal-ish", but recipe.html, mineral-selector.js, and a few
// others reach them via classic-script global scope. They're exported here
// (and pushed onto window via the footer below) to preserve that surface.
export function _getTransient(key: string): string | null {
  try {
    return (_isLoggedInSync() ? localStorage : sessionStorage).getItem(key);
  } catch (e) {
    return null;
  }
}
export function _setTransient(key: string, value: string): boolean {
  try {
    (_isLoggedInSync() ? localStorage : sessionStorage).setItem(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

// Category B (named artifacts) and Category C (sync tracking).  These keys
// only mean something for an authenticated account; for anonymous visitors
// the read returns null and the write is a no-op.  This is the storage-layer
// backstop — UI gating (applyAuthGate in ui-shared.js) handles the visible
// "Sign in to save" affordance, but a callsite that slips past the UI gate
// still cannot leak account data into local persistence.
export function _getGated(key: string): string | null {
  if (!_isLoggedInSync()) return null;
  return safeGetItem(key);
}
export function _setGated(key: string, value: string): boolean {
  if (!_isLoggedInSync()) return false;
  return safeSetItem(key, value);
}

// --- JSON parse helper ---
export function safeParse<T>(json: string | null, fallback: T): any | T {
  if (!json) return fallback;
  try {
    const parsed = JSON.parse(json);
    return parsed ?? fallback;
  } catch (_) {
    return fallback;
  }
}

// --- Source water ---
export function saveSourceWater(profile: SourceProfile): boolean {
  const ok = _setTransient(KEYS.SOURCE_WATER, JSON.stringify(profile));
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
  return ok;
}

export function loadSourceWater() {
  const fallback = {
    calcium: 0,
    magnesium: 0,
    potassium: 0,
    sodium: 0,
    sulfate: 0,
    chloride: 0,
    bicarbonate: 0,
  };
  const parsed = safeParse(_getTransient(KEYS.SOURCE_WATER), fallback);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
}

export function saveSourcePresetName(name: string): void {
  _setTransient(KEYS.SOURCE_PRESET, name);
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

export function loadSourcePresetName(): string {
  return _getTransient(KEYS.SOURCE_PRESET) || "distilled";
}

// --- Mineral display mode ---
export function saveMineralDisplayMode(mode: string): void {
  _setTransient(KEYS.MINERAL_DISPLAY_MODE, mode === "advanced" ? "advanced" : "standard");
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

export function loadMineralDisplayMode(): "standard" | "advanced" {
  return _getTransient(KEYS.MINERAL_DISPLAY_MODE) === "advanced" ? "advanced" : "standard";
}

export function isAdvancedMineralDisplayMode(): boolean {
  return loadMineralDisplayMode() === "advanced";
}

// --- Volume preference ---
export function saveVolumePreference(
  pageKey: string,
  value: number | string | null | undefined,
  unit: string | null | undefined,
): void {
  if (!pageKey) return;
  const key = VOLUME_PREFIX + pageKey;
  const payload = {
    value: String(value ?? ""),
    unit: unit === "gallons" ? "gallons" : "liters",
  };
  _setTransient(key, JSON.stringify(payload));
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

export function loadVolumePreference(
  pageKey: string,
  defaults: { value?: number | string; unit?: string } = {},
): { value: string; unit: "gallons" | "liters" } {
  const fallback: { value: string; unit: "gallons" | "liters" } = {
    value: String(defaults.value ?? "1"),
    unit: defaults.unit === "gallons" ? "gallons" : "liters",
  };
  if (!pageKey) return fallback;
  const key = VOLUME_PREFIX + pageKey;
  const parsed = safeParse(_getTransient(key), fallback);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
  const value = String(parsed.value ?? fallback.value);
  const unit: "gallons" | "liters" = parsed.unit === "gallons" ? "gallons" : "liters";
  return { value, unit };
}

// --- Slugify ---
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// --- Custom source profiles + cache ---
let customProfilesCache: Record<string, SourceProfile> | null = null;

export function loadCustomProfiles(): Record<string, SourceProfile> {
  if (customProfilesCache) return Object.assign({}, customProfilesCache);
  const parsed = safeParse(_getGated(KEYS.CUSTOM_PROFILES), {});
  customProfilesCache =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  return Object.assign({}, customProfilesCache);
}

export function saveCustomProfiles(profiles: Record<string, SourceProfile>): boolean {
  // If a slug is being added that was previously tombstoned, lift the
  // tombstone — the user's explicit save is unambiguous intent. This must
  // happen at save time, not in sync, so we don't conflate "user re-saved"
  // with "stale local state from a missed pull" (the latter would otherwise
  // resurrect cross-device deletions).
  liftTombstonesForNewlyAddedSlugs(
    profiles,
    customProfilesCache,
    loadDeletedPresets,
    KEYS.DELETED_PRESETS,
    invalidateSourcePresetsCache,
  );
  const ok = _setGated(KEYS.CUSTOM_PROFILES, JSON.stringify(profiles));
  customProfilesCache = null;
  invalidateSourcePresetsCache();
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
  return ok;
}

// Shared helper: when the new dict has slugs not in the previous dict, lift
// any matching tombstones. Inlines the tombstone-array mutation rather than
// calling addDeletedTargetPreset/removeDeletedTargetPreset so source and
// target sides share one code path.
function liftTombstonesForNewlyAddedSlugs(
  newProfiles: Record<string, unknown>,
  oldCache: Record<string, unknown> | null,
  loadFn: () => string[],
  storageKey: string,
  invalidateFn: () => void,
): void {
  const tombstones = loadFn();
  if (tombstones.length === 0) return;
  const oldProfiles = oldCache || {};
  const newSlugs = Object.keys(newProfiles).filter(function (slug) {
    return !Object.prototype.hasOwnProperty.call(oldProfiles, slug);
  });
  if (newSlugs.length === 0) return;
  const filtered = tombstones.filter(function (slug: string) {
    return newSlugs.indexOf(slug) === -1;
  });
  if (filtered.length !== tombstones.length) {
    safeSetItem(storageKey, JSON.stringify(filtered));
    if (typeof invalidateFn === "function") invalidateFn();
  }
}

export function deleteCustomProfile(key: string): void {
  const profiles = loadCustomProfiles();
  delete profiles[key];
  saveCustomProfiles(profiles);
  addDeletedPreset(key);
}

// --- Deleted source preset tracking ---
export function loadDeletedPresets(): string[] {
  const parsed = safeParse(_getGated(KEYS.DELETED_PRESETS), []);
  return Array.isArray(parsed) ? parsed : [];
}

export function addDeletedPreset(key: string): void {
  const deleted = loadDeletedPresets();
  if (!deleted.includes(key)) {
    deleted.push(key);
    _setGated(KEYS.DELETED_PRESETS, JSON.stringify(deleted));
    invalidateSourcePresetsCache();
    if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
  }
}

// --- Custom target profiles + cache ---
let customTargetProfilesCache: Record<string, TargetProfile> | null = null;

export function loadCustomTargetProfiles(): Record<string, TargetProfile> {
  if (customTargetProfilesCache) return Object.assign({}, customTargetProfilesCache);
  const parsed = safeParse(_getGated(KEYS.CUSTOM_TARGET_PROFILES), {});
  customTargetProfilesCache =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  return Object.assign({}, customTargetProfilesCache);
}

export function saveCustomTargetProfiles(profiles: Record<string, TargetProfile>): boolean {
  liftTombstonesForNewlyAddedSlugs(
    profiles,
    customTargetProfilesCache,
    loadDeletedTargetPresets,
    KEYS.DELETED_TARGET_PRESETS,
    invalidateTargetPresetsCache,
  );
  const ok = _setGated(KEYS.CUSTOM_TARGET_PROFILES, JSON.stringify(profiles));
  customTargetProfilesCache = null;
  invalidateTargetPresetsCache();
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
  return ok;
}

export function deleteCustomTargetProfile(key: string): void {
  const profiles = loadCustomTargetProfiles();
  delete profiles[key];
  saveCustomTargetProfiles(profiles);
  addDeletedTargetPreset(key);
}

// One-shot localStorage rewrite for the 2026-05 Hendon Water consolidation.
// Migration 20260515232747 deleted the 'eaf-hendon-water' canonical row and
// kept 'bh-simplified-hendon' as the canonical Hendon entry. Without this
// rewrite, a user editing their rail offline could push a stale
// 'eaf-hendon-water' reference back to the server after the migration runs.
// Idempotent — safe to re-run. Can be dropped once nobody can plausibly have
// stale state (~3 months from the migration date).
export function migrateHendonSlug(): void {
  const FROM = "eaf-hendon-water";
  const TO = "bh-simplified-hendon";

  // This migration runs once per page load before auth resolves, so it must
  // touch the raw storage areas directly — the auth-routed helpers would
  // return null on a cold signed-in load and the stale slug would survive
  // long enough to get pushed back up on the next sync.
  if (safeGetItem(KEYS.TARGET_PRESET) === FROM) {
    safeSetItem(KEYS.TARGET_PRESET, TO);
  }
  try {
    if (sessionStorage.getItem(KEYS.TARGET_PRESET) === FROM) {
      sessionStorage.setItem(KEYS.TARGET_PRESET, TO);
    }
  } catch (e) {}

  const added = safeParse(safeGetItem(KEYS.ADDED_TARGET_PRESETS), []);
  if (Array.isArray(added) && added.includes(FROM)) {
    const next = Array.from(new Set(added.map((s) => (s === FROM ? TO : s))));
    safeSetItem(KEYS.ADDED_TARGET_PRESETS, JSON.stringify(next));
  }

  const deleted = safeParse(safeGetItem(KEYS.DELETED_TARGET_PRESETS), []);
  if (Array.isArray(deleted) && deleted.includes(FROM)) {
    safeSetItem(KEYS.DELETED_TARGET_PRESETS, JSON.stringify(deleted.filter((s) => s !== FROM)));
  }
}

// --- Deleted target preset tracking (tombstones so deletions survive pull) ---
export function loadDeletedTargetPresets(): string[] {
  const parsed = safeParse(_getGated(KEYS.DELETED_TARGET_PRESETS), []);
  return Array.isArray(parsed) ? parsed : [];
}

export function addDeletedTargetPreset(key: string): void {
  const deleted = loadDeletedTargetPresets();
  if (!deleted.includes(key)) {
    deleted.push(key);
    _setGated(KEYS.DELETED_TARGET_PRESETS, JSON.stringify(deleted));
    invalidateTargetPresetsCache();
    if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
  }
}

// Remove a tombstone so a previously-deleted library/built-in row reappears in
// the preset rail. Used by the "re-add from library" flow (Piece D): when a
// user clicks Add on a canonical library row whose slug is tombstoned, we
// lift the tombstone rather than creating a suffixed custom-profile copy, so
// the built-in returns at its canonical slug.
export function removeDeletedTargetPreset(key: string): void {
  const deleted = loadDeletedTargetPresets();
  const idx = deleted.indexOf(key);
  if (idx === -1) return;
  deleted.splice(idx, 1);
  _setGated(KEYS.DELETED_TARGET_PRESETS, JSON.stringify(deleted));
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

function loadAddedTargetPresetsRaw(): string[] {
  const parsed = safeParse(_getGated(KEYS.ADDED_TARGET_PRESETS), []);
  return Array.isArray(parsed) ? parsed : [];
}

export function loadAddedTargetPresets(): string[] {
  if (typeof ensureStarterBackfill === "function") ensureStarterBackfill();
  return loadAddedTargetPresetsRaw();
}

export function addAddedTargetPreset(key: string): void {
  const added = loadAddedTargetPresets();
  if (!added.includes(key)) {
    added.push(key);
    _setGated(KEYS.ADDED_TARGET_PRESETS, JSON.stringify(added));
    invalidateTargetPresetsCache();
    if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
  }
}

export function removeAddedTargetPreset(key: string): void {
  const added = loadAddedTargetPresets();
  const idx = added.indexOf(key);
  if (idx === -1) return;
  added.splice(idx, 1);
  _setGated(KEYS.ADDED_TARGET_PRESETS, JSON.stringify(added));
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
export function getExistingTargetProfileLabels(): Set<string> {
  const custom = loadCustomTargetProfiles();
  const labels = new Set<string>();
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

export function getExistingSourceProfileLabels(): Set<string> {
  const allPresets = getAllPresets();
  const labels = new Set<string>();
  for (const profile of Object.values(allPresets)) {
    if (profile && profile.label) {
      labels.add(profile.label.trim().toLowerCase());
    }
  }
  return labels;
}

// --- Target preset name ---
export function saveTargetPresetName(name: string): void {
  _setTransient(KEYS.TARGET_PRESET, name);
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

// --- Target draft ions (per-slug WIP edits) ---
// Before this key existed, editing a built-in target preset (sca, rao)
// silently flipped the active selection to "custom" and synced the switch
// to other devices. Now those edits go into a draft keyed by slug; the
// active preset stays put, and a draft survives a reload / second device
// so the user doesn't lose work.
//
// Shape: { "<slug>": { calcium, magnesium, alkalinity, potassium, sodium, sulfate, chloride, bicarbonate } }

export function loadTargetDraftIons(): Record<string, Record<string, number>> {
  const parsed = safeParse(_getTransient(KEYS.TARGET_DRAFT_IONS), {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

export function saveTargetDraftIons(slug: string, ions: Record<string, number>): void {
  if (!slug) return;
  const drafts = loadTargetDraftIons();
  drafts[slug] = ions;
  _setTransient(KEYS.TARGET_DRAFT_IONS, JSON.stringify(drafts));
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

export function clearTargetDraftIons(slug: string): void {
  if (!slug) return;
  const drafts = loadTargetDraftIons();
  if (!Object.prototype.hasOwnProperty.call(drafts, slug)) return;
  delete drafts[slug];
  _setTransient(KEYS.TARGET_DRAFT_IONS, JSON.stringify(drafts));
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

export function loadTargetDraftIonsFor(slug: string): Record<string, number> | null {
  if (!slug) return null;
  const drafts = loadTargetDraftIons();
  return drafts[slug] || null;
}

/**
 * @param brewMethod "filter" or "espresso" (defaults to filter)
 */
export function loadTargetPresetName(brewMethod?: string): string {
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
  const saved = _getTransient(KEYS.TARGET_PRESET);
  if (saved && saved !== "library") return saved;
  return brewMethod === "espresso" ? "cafelytic-espresso" : "cafelytic-filter";
}

// --- Brew method preference ---
export function normalizeBrewMethod(method: string | null | undefined): "espresso" | "filter" {
  return method === "espresso" ? "espresso" : "filter";
}

export function saveBrewMethod(method: string | null | undefined): void {
  _setTransient(KEYS.BREW_METHOD, normalizeBrewMethod(method));
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

export function loadBrewMethod(): "espresso" | "filter" {
  return normalizeBrewMethod(_getTransient(KEYS.BREW_METHOD));
}

// --- Lotus dropper preference ---
export function normalizeLotusDropperType(type: string | null | undefined): "straight" | "round" {
  return type === "straight" ? "straight" : "round";
}

export function saveLotusDropperType(type: string | null | undefined): void {
  _setTransient(KEYS.LOTUS_DROPPER_TYPE, normalizeLotusDropperType(type));
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

export function loadLotusDropperType(): "straight" | "round" {
  return normalizeLotusDropperType(_getTransient(KEYS.LOTUS_DROPPER_TYPE));
}

export function getLotusDropMl(): number {
  const selectedType = loadLotusDropperType();
  const selectedMl = LOTUS_DROPPER_ML && Number(LOTUS_DROPPER_ML[selectedType]);
  if (Number.isFinite(selectedMl) && selectedMl > 0) return selectedMl;
  const fallbackMl = LOTUS_DROPPER_ML && Number(LOTUS_DROPPER_ML.round);
  return Number.isFinite(fallbackMl) && fallbackMl > 0 ? fallbackMl : 0.0716;
}

export function normalizeLotusConcentrateUnit(unit: string | null | undefined): "ml" | "drops" {
  return unit === "ml" ? "ml" : "drops";
}

export function saveLotusConcentrateUnit(unit: string | null | undefined): void {
  _setTransient(KEYS.LOTUS_CONCENTRATE_UNIT, normalizeLotusConcentrateUnit(unit));
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

export function loadLotusConcentrateUnit(): "ml" | "drops" {
  return normalizeLotusConcentrateUnit(_getTransient(KEYS.LOTUS_CONCENTRATE_UNIT));
}

export function loadLotusConcentrateUnits(): Record<string, "ml" | "drops"> {
  const parsed = safeParse(_getTransient(KEYS.LOTUS_CONCENTRATE_UNITS), {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const normalized: Record<string, "ml" | "drops"> = {};
  Object.keys(parsed).forEach((key) => {
    normalized[key] = normalizeLotusConcentrateUnit(parsed[key]);
  });
  return normalized;
}

export function saveLotusConcentrateUnits(
  units: Record<string, string | null | undefined> | null | undefined,
): void {
  const safeUnits: Record<string, "ml" | "drops"> = {};
  if (units && typeof units === "object" && !Array.isArray(units)) {
    Object.keys(units).forEach((key) => {
      safeUnits[key] = normalizeLotusConcentrateUnit(units[key]);
    });
  }
  _setTransient(KEYS.LOTUS_CONCENTRATE_UNITS, JSON.stringify(safeUnits));
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

export function loadLotusConcentrateUnitFor(
  concentrateId: string | null | undefined,
): "ml" | "drops" {
  const units = loadLotusConcentrateUnits();
  if (concentrateId && units[concentrateId]) return units[concentrateId];
  return "drops";
}

export function saveLotusConcentrateUnitFor(
  concentrateId: string | null | undefined,
  unit: string | null | undefined,
): void {
  if (!concentrateId) return;
  const units = loadLotusConcentrateUnits();
  units[concentrateId] = normalizeLotusConcentrateUnit(unit);
  saveLotusConcentrateUnits(units);
}

// --- Invalidate all caches (called by sync.js after pulling cloud data) ---
export function invalidateAllCaches(): void {
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
let sourcePresetsCache: Record<string, SourceProfile> | null = null;
export function invalidateSourcePresetsCache(): void {
  sourcePresetsCache = null;
}

export function getAllPresets(): Record<string, SourceProfile> {
  if (sourcePresetsCache) return sourcePresetsCache;
  const custom = loadCustomProfiles();
  const deleted = loadDeletedPresets();
  const result: Record<string, SourceProfile> = {};
  for (const [key, value] of Object.entries(SOURCE_PRESETS)) {
    if (key === "custom") {
      for (const [ck, cv] of Object.entries(custom)) {
        if (!SOURCE_PRESETS[ck]) {
          result[ck] = cv;
        }
      }
      result[key] = value as SourceProfile;
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
        : Object.assign({}, override, { category: value && (value as SourceProfile).category });
    } else {
      result[key] = value as SourceProfile;
    }
  }
  sourcePresetsCache = result;
  return sourcePresetsCache;
}

export function getSourceWaterByPreset(presetName: string) {
  if (presetName === "custom") {
    return loadSourceWater();
  }
  const customProfiles = loadCustomProfiles();
  const preset = customProfiles[presetName] || SOURCE_PRESETS[presetName];
  if (!preset) return loadSourceWater();
  const { label: _label, ...ions } = preset;
  return ions;
}

// --- Selected minerals + cache ---
let selectedMineralsCache: string[] | null = null;

export function saveSelectedMinerals(mineralIds: string[]): void {
  _setTransient(KEYS.SELECTED_MINERALS, JSON.stringify(mineralIds));
  selectedMineralsCache = null;
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

export function loadSelectedMinerals(): string[] {
  if (selectedMineralsCache) return selectedMineralsCache;
  const parsed = safeParse(_getTransient(KEYS.SELECTED_MINERALS), null);
  selectedMineralsCache = Array.isArray(parsed)
    ? parsed
    : ["calcium-chloride", "epsom-salt", "baking-soda", "potassium-bicarbonate"];
  return selectedMineralsCache;
}

// --- Selected concentrates + DIY specs ---
let selectedConcentratesCache: string[] | null = null;
let diyConcentrateSpecsCache: Record<string, DiyConcentrateSpec> | null = null;
let stockConcentrateSpecsCache: Record<string, StockConcentrateSpec> | null = null;

export function saveSelectedConcentrates(concentrateIds: string[]): void {
  _setTransient(KEYS.SELECTED_CONCENTRATES, JSON.stringify(concentrateIds));
  selectedConcentratesCache = null;
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

export function loadSelectedConcentrates(): string[] {
  if (selectedConcentratesCache) return selectedConcentratesCache;
  const parsed = safeParse(_getTransient(KEYS.SELECTED_CONCENTRATES), null);
  selectedConcentratesCache = Array.isArray(parsed) ? parsed : [];
  return selectedConcentratesCache;
}

/** Returns only valid concentrate IDs (diy:, brand:, or stock: prefixed) from the selected concentrates list. */
export function loadValidSelectedConcentrates(): string[] {
  return loadSelectedConcentrates().filter(function (id) {
    return (
      typeof id === "string" &&
      (id.startsWith("diy:") || id.startsWith("brand:") || id.startsWith("stock:"))
    );
  });
}

export function saveDiyConcentrateSpecs(
  specs: Record<string, DiyConcentrateSpec> | null | undefined,
): void {
  _setGated(KEYS.DIY_CONCENTRATE_SPECS, JSON.stringify(specs || {}));
  diyConcentrateSpecsCache = null;
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

export function loadDiyConcentrateSpecs(): Record<string, DiyConcentrateSpec> {
  if (diyConcentrateSpecsCache) return Object.assign({}, diyConcentrateSpecsCache);
  const parsed = safeParse(_getGated(KEYS.DIY_CONCENTRATE_SPECS), {});
  diyConcentrateSpecsCache =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  return Object.assign({}, diyConcentrateSpecsCache);
}

export function parseDiyConcentrateId(concentrateId: unknown): string | null {
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

export function saveStockConcentrateSpecs(
  specs: Record<string, StockConcentrateSpec> | null | undefined,
): void {
  _setGated(KEYS.STOCK_CONCENTRATE_SPECS, JSON.stringify(specs || {}));
  stockConcentrateSpecsCache = null;
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

export function loadStockConcentrateSpecs(): Record<string, StockConcentrateSpec> {
  if (stockConcentrateSpecsCache) return Object.assign({}, stockConcentrateSpecsCache);
  const parsed = safeParse(_getGated(KEYS.STOCK_CONCENTRATE_SPECS), {});
  stockConcentrateSpecsCache =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  return Object.assign({}, stockConcentrateSpecsCache);
}

/** Extracts the slug from a "stock:<slug>" concentrate id. */
export function parseStockConcentrateId(concentrateId: unknown): string | null {
  if (typeof concentrateId !== "string") return null;
  if (!concentrateId.startsWith("stock:")) return null;
  const slug = concentrateId.slice(6);
  return slug || null;
}

/**
 * Returns the full StockConcentrateSpec for a "stock:<slug>" id, or null if
 * not found / not a stock id.
 */
export function getStockSpec(concentrateId: unknown): StockConcentrateSpec | null {
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
 */
export function getStockMineralIds(spec: StockConcentrateSpec | null | undefined): string[] {
  if (!spec || !Array.isArray(spec.minerals)) return [];
  const out = new Set<string>();
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
 */
export function getActiveStockId(concentrateIds: unknown): string | null {
  if (!Array.isArray(concentrateIds)) return null;
  for (const id of concentrateIds) {
    if (typeof id === "string" && id.startsWith("stock:")) return id;
  }
  return null;
}

/**
 * Enforces the single-stock-active rule when writing to cw_selected_concentrates:
 * strips any existing "stock:*" entries and (if stockId is non-null) appends
 * the given one. Pass null to clear the active stock. Mirrors the radio-like
 * checkbox behavior in minerals.html's Recipe Concentrates section so any code
 * path that activates a stock (selector toggle, new-stock save, auto-enable
 * after derive/import) ends in the same canonical state.
 */
export function writeActiveStockId(stockId: string | null | undefined): void {
  const others = loadSelectedConcentrates().filter(function (id) {
    return typeof id !== "string" || !id.startsWith("stock:");
  });
  if (stockId) others.push(stockId);
  saveSelectedConcentrates(others);
}

/**
 * Convenience wrapper around getActiveStockId + getStockSpec — returns the
 * resolved spec for the first enabled stock, or null if none enabled or the
 * spec was deleted (orphan id).
 */
export function getActiveStockSpec(concentrateIds: unknown): StockConcentrateSpec | null {
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
 */
export function computeStockMineralGramsPerL(
  spec: StockConcentrateSpec | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
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
 */
export function importLibraryStockToPantry(
  recipe: { slug?: unknown; label?: unknown; stockFormula?: any } | null | undefined,
): { status: "imported" | "already-present" | "invalid"; slug: string | null } {
  if (!recipe || typeof recipe !== "object") return { status: "invalid", slug: null };
  const slug = typeof recipe.slug === "string" ? recipe.slug : "";
  const formula = recipe.stockFormula;
  if (!slug || !formula || !Array.isArray(formula.minerals) || formula.minerals.length === 0) {
    return { status: "invalid", slug: null };
  }
  const specs = loadStockConcentrateSpecs();
  if (specs[slug]) return { status: "already-present", slug };

  const minerals: StockMineralEntry[] = [];
  for (const m of formula.minerals) {
    if (!m || typeof m !== "object" || typeof m.mineralId !== "string" || !m.mineralId) continue;
    minerals.push({ mineralId: m.mineralId, grams: Number(m.grams) || 0 });
  }
  // If every entry was malformed, the resulting spec would have an empty
  // minerals array — inert (computeStockMineralGramsPerL returns {} for it)
  // but still pollutes the user's pantry. Treat as invalid so we don't
  // persist a dead-on-arrival entry.
  if (minerals.length === 0) return { status: "invalid", slug: null };

  const spec: StockConcentrateSpec = {
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
 */
export function getConcentrateMineralId(concentrateId: unknown): string | null {
  if (typeof concentrateId !== "string") return null;
  if (concentrateId.startsWith("diy:")) return parseDiyConcentrateId(concentrateId);
  const brand = typeof BRAND_CONCENTRATES !== "undefined" && BRAND_CONCENTRATES[concentrateId];
  return brand ? brand.mineralId : null;
}

export function getDiyConcentrateGramsPerMl(mineralId: string | null | undefined): number {
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
 */
export function getConcentrateGramsPerMl(concentrateId: unknown): number {
  if (typeof concentrateId !== "string") return 0;
  if (concentrateId.startsWith("diy:")) {
    const mineralId = parseDiyConcentrateId(concentrateId);
    return mineralId ? getDiyConcentrateGramsPerMl(mineralId) : 0;
  }
  const brand = typeof BRAND_CONCENTRATES !== "undefined" && BRAND_CONCENTRATES[concentrateId];
  if (brand && Number.isFinite(brand.gramsPerMl)) return brand.gramsPerMl;
  return 0;
}

export function getAvailableMineralIds(): string[] {
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
export function getEffectiveAlkalinitySources(): string[] {
  const selected = getAvailableMineralIds();
  const hasBakingSoda = selected.includes("baking-soda");
  const hasPotBicarb = selected.includes("potassium-bicarbonate");
  if (!hasBakingSoda && !hasPotBicarb) return [];
  if (hasBakingSoda && hasPotBicarb) return ["baking-soda", "potassium-bicarbonate"];
  if (hasBakingSoda) return ["baking-soda"];
  return ["potassium-bicarbonate"];
}

/**
 * The two calcium-chloride forms (dihydrate `calcium-chloride` and anhydrous
 * `calcium-chloride-anhydrous`) are chemically interchangeable: same Ca:Cl
 * ratio, differing only in grams per dose. The derivation logic treats them as
 * a single calcium-source slot, so collapse them to one representative here.
 * Prefer the dihydrate when both are enabled to preserve prior behavior.
 */
function getEffectiveCalciumChlorideForm(selected: string[]): string | null {
  if (selected.includes("calcium-chloride")) return "calcium-chloride";
  if (selected.includes("calcium-chloride-anhydrous")) return "calcium-chloride-anhydrous";
  return null;
}

/** Returns an array of enabled calcium source mineral ids (a calcium-chloride form and/or gypsum). */
export function getEffectiveCalciumSources(): string[] {
  const selected = getAvailableMineralIds();
  const out: string[] = [];
  const cacl2 = getEffectiveCalciumChlorideForm(selected);
  if (cacl2) out.push(cacl2);
  if (selected.includes("gypsum")) out.push("gypsum");
  return out;
}

/** Returns an array of enabled magnesium source mineral ids (epsom-salt and/or magnesium-chloride). */
export function getEffectiveMagnesiumSources(): string[] {
  const selected = getAvailableMineralIds();
  const out: string[] = [];
  if (selected.includes("epsom-salt")) out.push("epsom-salt");
  if (selected.includes("magnesium-chloride")) out.push("magnesium-chloride");
  return out;
}

// --- Effective mineral sources ---
/** Returns a single alkalinity source when only one is enabled; when both are enabled returns "potassium-bicarbonate" as fallback; when none, null. Use getEffectiveAlkalinitySources() when both can contribute. */
export function getEffectiveAlkalinitySource(): string | null {
  const sources = getEffectiveAlkalinitySources();
  if (sources.length === 0) return null;
  if (sources.length === 1) return sources[0] ?? null;
  return "potassium-bicarbonate";
}

/** Returns a single calcium source when only one is enabled; when a calcium-chloride form and gypsum are both enabled returns the calcium-chloride form (tie-breaker); when none, null. */
export function getEffectiveCalciumSource(): string | null {
  const sources = getEffectiveCalciumSources();
  if (sources.length === 0) return null;
  if (sources.length === 1) return sources[0] ?? null;
  // Two sources means one calcium-chloride form + gypsum; prefer the CaCl2 form.
  return sources.find((s) => s !== "gypsum") ?? sources[0] ?? null;
}

/** Returns a single magnesium source when only one is enabled; when both enabled returns "epsom-salt" (tie-breaker); when none, null. */
export function getEffectiveMagnesiumSource(): string | null {
  const sources = getEffectiveMagnesiumSources();
  if (sources.length === 0) return null;
  if (sources.length === 1) return sources[0] ?? null;
  return "epsom-salt";
}

// --- Target presets aggregation + cache ---
let targetPresetsCache: Record<string, TargetProfile> | null = null;
export function invalidateTargetPresetsCache(): void {
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
const STARTER_MIGRATION_KEY = KEYS.STARTER_MIGRATION_APPLIED;
export function ensureStarterBackfill(): void {
  if (_getGated(STARTER_MIGRATION_KEY) === "1") return;
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
    _setGated(KEYS.ADDED_TARGET_PRESETS, JSON.stringify(seed));
    if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
  }
  _setGated(STARTER_MIGRATION_KEY, "1");
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
 */
export function getAllTargetPresets(): Record<string, TargetProfile> {
  if (targetPresetsCache) return targetPresetsCache;
  const custom = loadCustomTargetProfiles();
  const tombstoned = new Set(loadDeletedTargetPresets());
  const library = typeof getPublicRecipesSync === "function" ? getPublicRecipesSync() : [];

  ensureStarterBackfill();
  const added = new Set(loadAddedTargetPresetsRaw());

  const result: Record<string, TargetProfile> = {};

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

export function getTargetProfileByKey(key: string): TargetProfile | null {
  if (key === "custom") return null;
  // Route through the merged rail so library-only slugs (sey, aviary-*, rasami-*,
  // and all library-seeded built-ins) and library-overridden shim slugs resolve
  // to the same object the rail renders. Using loadCustomTargetProfiles + the
  // 5-entry shim directly would miss every library row and return null.
  const merged = getAllTargetPresets();
  return merged[key] || null;
}

export function inferTargetProfileBrewMethod(
  key: string,
  profile: TargetProfile | null | undefined,
): "espresso" | "filter" {
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

export function targetProfileSupportsBrewMethod(
  key: string,
  profile: TargetProfile | null | undefined,
  method: string | null | undefined,
): boolean {
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
      (profile.brewMethods as unknown[])
        .map((value) => normalizeBrewMethod(value as string | null | undefined))
        .filter((value, index, array) => array.indexOf(value) === index),
    );
    return allowed.has(brewMethod);
  }
  return inferTargetProfileBrewMethod(key, profile) === brewMethod;
}

export function getTargetPresetsForBrewMethod(
  method: string | null | undefined,
): Record<string, TargetProfile> {
  const brewMethod = normalizeBrewMethod(method);
  const allPresets = getAllTargetPresets();
  const filtered: Record<string, TargetProfile> = {};
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
export function validateProfileName(
  rawName: string | null | undefined,
  options: ValidateNameOptions = {},
): ValidateNameResult {
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

export function validateTargetProfileName(
  rawName: string | null | undefined,
  options: { allowEmpty?: boolean } = {},
): ValidateNameResult {
  return validateProfileName(rawName, {
    allowEmpty: options.allowEmpty,
    builtinKeys: RESERVED_TARGET_KEYS,
    existingKeys: new Set(Object.keys(loadCustomTargetProfiles())),
    existingLabels: getExistingTargetProfileLabels(),
  });
}

// --- Restore defaults ---
export function restoreSourcePresetDefaults(): void {
  // Clear tombstones for builtin presets only.  Tombstones for purely-custom
  // slugs must be preserved so deleted customs don't resurrect from the cloud.
  const preserved = loadDeletedPresets().filter(function (key) {
    return !SOURCE_PRESETS[key];
  });
  _setGated(KEYS.DELETED_PRESETS, JSON.stringify(preserved));
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
export function loadThemePreference(): "light" | "dark" | "system" {
  const saved = safeGetItem(THEME_KEY);
  if (saved === "light" || saved === "dark" || saved === "system") return saved;
  return "system";
}

export function saveThemePreference(mode: string): void {
  safeSetItem(THEME_KEY, mode);
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

// --- Creator display name (for recipe library publishing) ---
export function loadCreatorDisplayName(): string {
  return _getGated(KEYS.CREATOR_DISPLAY_NAME) || "";
}

export function saveCreatorDisplayName(name: string): void {
  _setGated(KEYS.CREATOR_DISPLAY_NAME, name);
  if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}

// --- Recipes-moved toaster (one-time) ---
const RECIPES_TOASTER_DISMISSED_KEY = "cw_recipes_toaster_dismissed";

export function loadRecipesToasterDismissed(): boolean {
  return safeGetItem(RECIPES_TOASTER_DISMISSED_KEY) === "true";
}

export function saveRecipesToasterDismissed(): void {
  safeSetItem(RECIPES_TOASTER_DISMISSED_KEY, "true");
}

// --- Calculator welcome modal (one-time) ---
const WELCOME_MODAL_DISMISSED_KEY = "cw_calculator_welcome_dismissed";

export function loadCalculatorWelcomeDismissed(): boolean {
  return safeGetItem(WELCOME_MODAL_DISMISSED_KEY) === "true";
}

export function saveCalculatorWelcomeDismissed(): void {
  safeSetItem(WELCOME_MODAL_DISMISSED_KEY, "true");
}

// --- Multi-tab cache invalidation (Inefficiency 4) ---
// Guarded for Node / Vitest contexts (unit tests may stub window as a bare
// object on globalThis, so check for the actual method before calling).
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  // Run one-shot localStorage migrations once per page load.
  migrateHendonSlug();

  window.addEventListener("storage", function (e) {
    if (!e.key) return;
    let recipeAffected = false;
    if (e.key === KEYS.CUSTOM_PROFILES) {
      customProfilesCache = null;
      invalidateSourcePresetsCache();
      recipeAffected = true;
    }
    if (e.key === KEYS.CUSTOM_TARGET_PROFILES) {
      customTargetProfilesCache = null;
      invalidateTargetPresetsCache();
      recipeAffected = true;
    }
    if (e.key === KEYS.SELECTED_MINERALS) {
      selectedMineralsCache = null;
    }
    if (e.key === KEYS.SELECTED_CONCENTRATES) {
      selectedConcentratesCache = null;
    }
    if (e.key === KEYS.DIY_CONCENTRATE_SPECS) {
      diyConcentrateSpecsCache = null;
    }
    if (e.key === KEYS.STOCK_CONCENTRATE_SPECS) {
      stockConcentrateSpecsCache = null;
    }
    if (e.key === KEYS.DELETED_PRESETS) {
      invalidateSourcePresetsCache();
      recipeAffected = true;
    }
    if (e.key === KEYS.DELETED_TARGET_PRESETS) {
      invalidateTargetPresetsCache();
      recipeAffected = true;
    }
    if (e.key === KEYS.ADDED_TARGET_PRESETS) {
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

  // Auth state flips and explicit cleanups invalidate every cached parse.
  // A logout swaps the underlying store for transient keys (localStorage ->
  // sessionStorage) and wipes user content; a login does the reverse and
  // pulls cloud data into localStorage.  Either way, cached values from the
  // pre-flip state are stale. cw:auth-state-resolved is included so a cache
  // populated during the pre-auth window (before the initial getSession()
  // settles) is dropped once auth settles, independent of whether
  // cw:auth-changed fires first.
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("cw:auth-changed", function () {
      if (typeof invalidateAllCaches === "function") invalidateAllCaches();
    });
    document.addEventListener("cw:auth-state-resolved", function () {
      if (typeof invalidateAllCaches === "function") invalidateAllCaches();
    });
    window.addEventListener("cw:storage-invalidated", function () {
      if (typeof invalidateAllCaches === "function") invalidateAllCaches();
    });
  }
}

// --- Window/global population (browser + tests) ---
// In the browser the legacy-globals.ts bridge module copies these onto window
// before any UI script runs. In Node/Vitest the test harness aliases
// `global.window = global`, so this Object.assign lands on global, where
// sync.ts's lexical references (safeGetItem, loadThemePreference, etc.)
// resolve via the global scope chain.  Keeping the assignment here means
// sync.test.js works without loading the bridge.
if (typeof window !== "undefined") {
  Object.assign(window, {
    safeGetItem,
    safeSetItem,
    safeRemoveItem,
    safeParse,
    _getTransient,
    _setTransient,
    _getGated,
    _setGated,
    saveSourceWater,
    loadSourceWater,
    saveSourcePresetName,
    loadSourcePresetName,
    saveMineralDisplayMode,
    loadMineralDisplayMode,
    isAdvancedMineralDisplayMode,
    saveVolumePreference,
    loadVolumePreference,
    slugify,
    loadCustomProfiles,
    saveCustomProfiles,
    deleteCustomProfile,
    loadDeletedPresets,
    addDeletedPreset,
    loadCustomTargetProfiles,
    saveCustomTargetProfiles,
    deleteCustomTargetProfile,
    migrateHendonSlug,
    loadDeletedTargetPresets,
    addDeletedTargetPreset,
    removeDeletedTargetPreset,
    loadAddedTargetPresets,
    addAddedTargetPreset,
    removeAddedTargetPreset,
    getExistingTargetProfileLabels,
    getExistingSourceProfileLabels,
    saveTargetPresetName,
    loadTargetDraftIons,
    saveTargetDraftIons,
    clearTargetDraftIons,
    loadTargetDraftIonsFor,
    loadTargetPresetName,
    normalizeBrewMethod,
    saveBrewMethod,
    loadBrewMethod,
    normalizeLotusDropperType,
    saveLotusDropperType,
    loadLotusDropperType,
    getLotusDropMl,
    normalizeLotusConcentrateUnit,
    saveLotusConcentrateUnit,
    loadLotusConcentrateUnit,
    loadLotusConcentrateUnits,
    saveLotusConcentrateUnits,
    loadLotusConcentrateUnitFor,
    saveLotusConcentrateUnitFor,
    invalidateAllCaches,
    invalidateSourcePresetsCache,
    invalidateTargetPresetsCache,
    getAllPresets,
    getSourceWaterByPreset,
    saveSelectedMinerals,
    loadSelectedMinerals,
    saveSelectedConcentrates,
    loadSelectedConcentrates,
    loadValidSelectedConcentrates,
    saveDiyConcentrateSpecs,
    loadDiyConcentrateSpecs,
    parseDiyConcentrateId,
    saveStockConcentrateSpecs,
    loadStockConcentrateSpecs,
    parseStockConcentrateId,
    getStockSpec,
    getStockMineralIds,
    getActiveStockId,
    writeActiveStockId,
    getActiveStockSpec,
    computeStockMineralGramsPerL,
    importLibraryStockToPantry,
    getConcentrateMineralId,
    getDiyConcentrateGramsPerMl,
    getConcentrateGramsPerMl,
    getAvailableMineralIds,
    getEffectiveAlkalinitySources,
    getEffectiveCalciumSources,
    getEffectiveMagnesiumSources,
    getEffectiveAlkalinitySource,
    getEffectiveCalciumSource,
    getEffectiveMagnesiumSource,
    getAllTargetPresets,
    getTargetProfileByKey,
    inferTargetProfileBrewMethod,
    targetProfileSupportsBrewMethod,
    getTargetPresetsForBrewMethod,
    validateProfileName,
    validateTargetProfileName,
    restoreSourcePresetDefaults,
    loadThemePreference,
    saveThemePreference,
    loadCreatorDisplayName,
    saveCreatorDisplayName,
    loadRecipesToasterDismissed,
    saveRecipesToasterDismissed,
    loadCalculatorWelcomeDismissed,
    saveCalculatorWelcomeDismissed,
    ensureStarterBackfill,
  });
}
