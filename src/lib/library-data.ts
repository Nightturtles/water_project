// =============================================================================
// library-data.ts — Data layer for the Recipe Library
// Fetches public recipes from Supabase and provides copy-to-my-profiles logic.
//
// Phase 3: converted from the classic library-data.js IIFE. Loaded via
// legacy-globals.ts (the bridge imports this file as a side-effect), which runs
// before the classic consumers and the component modules. The public functions
// are still reached through `window.*` by the already-migrated UI modules
// (script.ts, recipe-browser.ts, library-picker.ts, my-recipes-ui.ts) and by
// storage.ts's `typeof getPublicRecipesSync === "function"` global lookups, so
// each one is self-published on `window` at the bottom — the same pattern the
// other migrated modules use. Window types live in globals.d.ts.
// =============================================================================

import {
  addAddedTargetPreset,
  invalidateTargetPresetsCache,
  loadAddedTargetPresets,
  loadCustomTargetProfiles,
  loadDeletedTargetPresets,
  removeDeletedTargetPreset,
  saveCustomTargetProfiles,
  slugify,
} from "./storage";

// A raw recipe row, as it arrives either from Supabase (snake_case columns) or
// from a prior deploy's sessionStorage snapshot (already-normalized camelCase).
// Every field is optional and both casings are accepted; normalizePublicRecipeRow
// collapses them to the canonical camelCase shape. Internal callers pass values
// straight off JSON.parse / the Supabase response (effectively `any`), so this
// type is only a documentation aid at the call boundary.
interface RawPublicRecipeRow {
  id?: string | number;
  user_id?: string | null;
  userId?: string | null;
  slug?: string;
  label?: string;
  brew_method?: string;
  brewMethod?: string;
  calcium?: number;
  magnesium?: number;
  alkalinity?: number;
  potassium?: number;
  sodium?: number;
  sulfate?: number;
  chloride?: number;
  bicarbonate?: number;
  description?: string;
  creator_display_name?: string;
  creatorDisplayName?: string;
  tags?: unknown;
  tray?: string;
  category?: string;
  roast?: unknown;
  created_at?: string;
  createdAt?: string;
  is_starter?: boolean | null;
  isStarter?: boolean | null;
  stock_formula?: LibraryRecipeRow["stockFormula"];
  stockFormula?: LibraryRecipeRow["stockFormula"];
}

let publicRecipesCache: LibraryRecipeRow[] | null = null;
let publicRecipesLoadPromise: Promise<LibraryRecipeRow[]> | null = null;
// sessionStorage key for the cached catalog. Bump the suffix whenever a
// schema/migration change would make the prior cache misleading — users
// whose tab was open across the deploy rehydrate from sessionStorage
// BEFORE the live fetch, so a stale snapshot hides the new data forever
// (the fetch short-circuits on cache hit).
//   v2 — forced re-fetch after migration-010 tray/slug changes.
//   v3 — forced re-fetch after migration-011 added is_starter. Without
//        this bump, pre-011 _v2 snapshots normalize to isStarter:false
//        for every canonical row and break the starter rail silently.
//   v4 — forced re-fetch after migrations added stock_formula + 12 Coffee
//        ad Astra recipes. Pre-v4 snapshots have stockFormula:null on every
//        row and miss the new entries entirely.
//   v5 — forced re-fetch after migration 20260606060755 recategorized
//        eaf-rpavlis to espresso and renamed the "and" recipes to "&".
//        Pre-v5 snapshots carry the old brew_method/labels and would show
//        RPavlis under filter with stale names until the session ends.
const CACHE_KEY = "cw_library_public_recipes_v5";
// Set (not Array) so re-registering the same function reference doesn't
// duplicate firings — defends against bfcache restore and other scenarios
// where the same classic-script evaluates twice against the same module
// instance. Callers that want to unregister receive a token from
// onLibraryDataLoaded(cb) and call it to remove their registration.
const loadedCallbacks = new Set<(recipes: LibraryRecipeRow[]) => void>();

// Normalize a row into the canonical client shape. Accepts both DB shape
// (snake_case columns from Supabase) and already-normalized client shape
// (camelCase from a prior deploy's sessionStorage snapshot). This matters
// across the tray → category rename: a tab open during the Wave B deploy
// still has sessionStorage entries with the old `tray` field. Running
// every cache-read through this normalizer ensures callers always see
// `category` (and other canonical camelCase keys) regardless of when
// the cache was written.
function normalizePublicRecipeRow(row: RawPublicRecipeRow): LibraryRecipeRow {
  return {
    id: row.id,
    userId: row.user_id != null ? row.user_id : row.userId,
    slug: row.slug || "",
    label: row.label || "",
    brewMethod: row.brew_method || row.brewMethod || "filter",
    calcium: row.calcium,
    magnesium: row.magnesium,
    alkalinity: row.alkalinity,
    potassium: row.potassium,
    sodium: row.sodium,
    sulfate: row.sulfate,
    chloride: row.chloride,
    bicarbonate: row.bicarbonate,
    description: row.description || "",
    creatorDisplayName: row.creator_display_name || row.creatorDisplayName || "",
    tags: Array.isArray(row.tags) ? row.tags : [],
    category: row.category || row.tray || "classic",
    roast: Array.isArray(row.roast) ? row.roast : ["all"],
    createdAt: row.created_at || row.createdAt,
    // Canonical library rows flagged is_starter=true (migration 011) are
    // the 8 recipes the preset rail shows by default. Non-starter canonical
    // rows are only in the rail if the user has explicitly added them from
    // library.html. The actual filter lives in storage.getAllTargetPresets.
    isStarter: row.isStarter != null ? !!row.isStarter : !!row.is_starter,
    // Multi-mineral concentrate formula (Coffee ad Astra recipes; later
    // user-defined stocks too). Shape: { bottleMl, doseGramsPerL, minerals:
    // [{mineralId, grams}], source, via }. NULL on most library rows; the
    // library card optionally renders it when present.
    stockFormula: row.stock_formula || row.stockFormula || null,
  };
}

// Synchronous accessor for use by sync callers that need library data
// without awaiting a fetch (e.g. storage.getAllTargetPresets, which is
// called from UI render paths that can't be made async without rippling
// through every caller). Returns the in-memory cache if present, falls
// back to the sessionStorage snapshot, and returns [] otherwise. The
// first caller on a cold pageload will get [] and then the preset rail
// re-renders via onLibraryDataLoaded once fetchPublicRecipes resolves.
function getPublicRecipesSync(): LibraryRecipeRow[] {
  if (publicRecipesCache) return publicRecipesCache;
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      publicRecipesCache = Array.isArray(parsed) ? parsed.map(normalizePublicRecipeRow) : [];
      return publicRecipesCache;
    }
  } catch (e) {
    /* ignore */
  }
  return [];
}

// Register a callback that fires after fetchPublicRecipes completes
// successfully (used by taste/index pages to re-render the preset rail
// once library rows are available). Callbacks receive the recipes array.
// Returns an unregister token — invoking it removes the callback. Callers
// that don't need to unregister can ignore the return value.
function onLibraryDataLoaded(cb: (recipes: LibraryRecipeRow[]) => void): () => void {
  if (typeof cb !== "function") return function () {};
  loadedCallbacks.add(cb);
  return function unregister() {
    loadedCallbacks.delete(cb);
  };
}

function fireLoadedCallbacks(recipes: LibraryRecipeRow[]): void {
  loadedCallbacks.forEach(function (cb) {
    try {
      cb(recipes);
    } catch (e) {
      console.warn("[library] onLibraryDataLoaded callback failed:", e);
    }
  });
}

// Error counterpart to onLibraryDataLoaded. Fires when fetchPublicRecipes
// can't produce fresh rows AND there's no cached catalog to fall back on,
// so consumers (recipe-browser.ts) can swap an indefinite loading state for
// an explicit error + retry affordance instead of hanging blank. Same
// Set-based dedupe + unregister-token contract as onLibraryDataLoaded.
const errorCallbacks = new Set<(err: unknown) => void>();
function onLibraryDataError(cb: (err: unknown) => void): () => void {
  if (typeof cb !== "function") return function () {};
  errorCallbacks.add(cb);
  return function unregister() {
    errorCallbacks.delete(cb);
  };
}

function fireErrorCallbacks(err: unknown): void {
  errorCallbacks.forEach(function (cb) {
    try {
      cb(err);
    } catch (e) {
      console.warn("[library] onLibraryDataError callback failed:", e);
    }
  });
}

// True only when we hold a non-empty catalog to render. An empty array counts
// as "nothing cached": otherwise a fetch failure with publicRecipesCache===[]
// would skip the error callback and leave the page silently blank.
function hasCachedCatalog(): boolean {
  return Array.isArray(publicRecipesCache) && publicRecipesCache.length > 0;
}

// Fetch all public recipes from Supabase. Caches in sessionStorage.
async function fetchPublicRecipes(forceRefresh?: boolean): Promise<LibraryRecipeRow[]> {
  if (!forceRefresh && publicRecipesCache) return publicRecipesCache;

  if (!forceRefresh) {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsedCached = JSON.parse(cached);
        publicRecipesCache = Array.isArray(parsedCached)
          ? parsedCached.map(normalizePublicRecipeRow)
          : [];
        return publicRecipesCache;
      }
    } catch (e) {
      /* ignore */
    }
  }

  // No client to fetch with. By the time library.html calls this on
  // DOMContentLoaded the legacy-globals module has run, so this is an edge
  // case (misconfigured page); return [] without escalating to an error
  // state so a momentarily-late client doesn't flash a spurious retry card.
  if (typeof window.supabaseClient === "undefined") return [];

  try {
    const result = await window.supabaseClient
      .from("target_profiles")
      .select(
        "id, user_id, slug, label, brew_method, calcium, magnesium, alkalinity, potassium, sodium, sulfate, chloride, bicarbonate, description, creator_display_name, tags, tray, roast, created_at, is_starter, stock_formula",
      )
      .eq("is_public", true)
      .order("created_at", { ascending: false });

    if (result.error) {
      console.warn("[library] failed to fetch public recipes:", result.error);
      // Only escalate to a visible error state when there's nothing cached
      // to show — a non-empty stale cache beats a blank page.
      if (!hasCachedCatalog()) fireErrorCallbacks(result.error);
      return publicRecipesCache || [];
    }

    // Taxonomy v2 (migration 006): category (DB column: `tray`) + roast
    // power the recipe-browser carousels, filter chips, and the
    // re-add-from-library UI. The recipe-browser spec and mockups call
    // this field `category`; the DB keeps `tray` for parallelism with
    // `roast`, so the rename happens at the client boundary via
    // normalizePublicRecipeRow (which also accepts pre-Wave-B cached
    // rows with `tray` and rewrites them to `category`).
    const recipes = (result.data || []).map(normalizePublicRecipeRow);

    publicRecipesCache = recipes;
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(recipes));
    } catch (e) {
      /* sessionStorage full or unavailable */
    }

    // Preset rail consumers (taste.html, index.html) cache the merged rail
    // in storage.targetPresetsCache. Invalidate so the next render picks up
    // the freshly-fetched library rows.
    invalidateTargetPresetsCache();
    fireLoadedCallbacks(recipes);

    return recipes;
  } catch (err) {
    // Network/transport throw (vs. a structured result.error above). Same
    // rule: surface a retry only when we have no non-empty cache to fall back on.
    console.warn("[library] failed to fetch public recipes:", err);
    if (!hasCachedCatalog()) fireErrorCallbacks(err);
    return publicRecipesCache || [];
  }
}

// Lazy warmup hook: page scripts call this once they actually need library
// data (picker open, rail visible, etc). Keeps non-library pages from paying
// an eager network cost during first paint.
function ensurePublicRecipesLoaded(): Promise<LibraryRecipeRow[]> {
  if (publicRecipesCache) return Promise.resolve(publicRecipesCache);
  if (typeof window.supabaseClient === "undefined") return Promise.resolve([]);
  // Dedupe concurrent callers (script.ts + taste.html + recipe.html on a
  // single page load) so they share one fetch instead of racing.
  if (publicRecipesLoadPromise) return publicRecipesLoadPromise;
  publicRecipesLoadPromise = fetchPublicRecipes(false)
    .catch(function (e) {
      console.warn("[library] lazy warmup failed:", e);
      return publicRecipesCache || [];
    })
    .finally(function () {
      publicRecipesLoadPromise = null;
    });
  return publicRecipesLoadPromise;
}

function invalidatePublicRecipesCache(): void {
  publicRecipesCache = null;
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch (e) {
    /* ignore */
  }
  invalidateTargetPresetsCache();
}

// Generate a unique slug that doesn't conflict with existing custom, built-in,
// or Supabase-library profiles. Library slugs must be excluded here because
// the library is now merged into the preset rail (Piece C, migration 007+),
// so a user-chosen slug colliding with a library slug would shadow the
// library row's data.
function generateUniqueSlug(baseName: string): string {
  let baseSlug = slugify(baseName);
  if (!baseSlug) baseSlug = "recipe";

  const existing = loadCustomTargetProfiles();
  const existingKeys = new Set(Object.keys(existing));

  // Also include built-in shim keys
  if (typeof RESERVED_TARGET_KEYS !== "undefined") {
    RESERVED_TARGET_KEYS.forEach(function (k) {
      existingKeys.add(k);
    });
  }

  // And Supabase library slugs currently loaded
  getPublicRecipesSync().forEach(function (r) {
    if (r && r.slug) existingKeys.add(r.slug);
  });

  if (!existingKeys.has(baseSlug)) return baseSlug;

  for (let i = 2; i < 100; i++) {
    const candidate = baseSlug + "-" + i;
    if (!existingKeys.has(candidate)) return candidate;
  }
  return baseSlug + "-" + Date.now();
}

// Save a library recipe to the user's preset rail. Returns the slug under
// which the recipe is now visible, or null on failure.
//
// Canonical library rows (userId == null, the 002/006/007-seeded built-ins
// like sca, cafelytic-filter, rasami-*) stay at their canonical slug — we
// never fork them to custom profiles — so "remove, then re-add from library"
// is a true round-trip rather than leaving a "sca-2" dangling in custom.
// Both paths for canonical rows after migration 011 lift any existing
// tombstone first because the rail filter is `(is_starter OR added) AND
// NOT tombstoned`. A pre-011 user could have a tombstone on a now-non-
// starter slug (e.g. tombstoned "rao" before migration) — without the
// lift, saving "rao" would add to the added list but the rail would still
// hide it, and the user would see ★ on the card but no change in the rail.
//   * is_starter=true  — lift tombstone (starters are visible by default).
//   * is_starter=false — lift tombstone AND add slug to the added list.
//
// User-published rows (userId != null) always fork to a new custom profile
// with a unique slug — we don't mutate someone else's publish.
function copyRecipeToMyProfiles(recipe: LibraryRecipeRow): string | null {
  // Refuse early when anonymous.  Callers (recipe-browser.ts bookmark,
  // library-picker Add) check for a falsy return; treating null as "open
  // the login modal" is wired in commit 5.
  if (typeof window.isLoggedInSync === "function" && !window.isLoggedInSync()) {
    if (typeof window.openLoginModal === "function") {
      window.openLoginModal({ reason: "save-recipe" });
    }
    return null;
  }
  if (recipe && recipe.userId == null && recipe.slug) {
    const tombstoned = loadDeletedTargetPresets();
    if (tombstoned.indexOf(recipe.slug) !== -1) {
      removeDeletedTargetPreset(recipe.slug);
    }
    if (!recipe.isStarter) {
      addAddedTargetPreset(recipe.slug);
    }
    return recipe.slug;
  }

  const slug = generateUniqueSlug(recipe.label || "");
  const profile = {
    label: recipe.label || "",
    calcium: Number(recipe.calcium) || 0,
    magnesium: Number(recipe.magnesium) || 0,
    alkalinity: Number(recipe.alkalinity) || 0,
    potassium: Number(recipe.potassium) || 0,
    sodium: Number(recipe.sodium) || 0,
    sulfate: Number(recipe.sulfate) || 0,
    chloride: Number(recipe.chloride) || 0,
    bicarbonate: Number(recipe.bicarbonate) || 0,
    description: recipe.description || "",
    brewMethod: recipe.brewMethod || "filter",
    // Preserve attribution so the copy is recognisably "not my recipe"
    // on every device.  creatorUserId is the authoritative creator check;
    // creatorDisplayName is kept for display.
    creatorUserId: recipe.userId || null,
    creatorDisplayName: recipe.creatorDisplayName || "",
    roast: Array.isArray(recipe.roast) ? recipe.roast.slice() : ["all"],
  };

  const profiles = loadCustomTargetProfiles();
  profiles[slug] = profile;
  saveCustomTargetProfiles(profiles);
  return slug;
}

// Check whether a library recipe is currently visible in the user's preset
// rail (i.e., the Add button should show "Added" rather than offering the
// action again).
//
// Canonical library rows (userId == null — the 002/006/007-seeded built-ins)
// split on is_starter after migration 011:
//   * is_starter=true  — visible by default; "in rail" = NOT tombstoned.
//   * is_starter=false — invisible by default; "in rail" = slug is in the
//                         user's added_target_presets list.
// User-published rows (userId != null) are added via copy-to-custom (which
// creates a new custom profile with a suffixed slug) and detected here by
// label match against the user's custom profiles.
//
// Trust boundary note: `recipe.userId == null` distinguishes canonical rows
// from user-published rows by RLS guarantee, not by convention. The
// target_profiles INSERT policy enforces `auth.uid() = user_id`, which
// rejects any client-originated row with user_id NULL. Only service-role
// migrations can create canonical rows, so a malicious user cannot forge a
// row that makes this branch fire for their content.
function isRecipeInMyProfiles(recipe: LibraryRecipeRow): boolean {
  if (recipe && recipe.userId == null && recipe.slug) {
    // Tombstones trump both starter and added: a tombstoned slug is hidden
    // from the rail regardless of is_starter or added-list state, so the
    // library star should reflect that. Matches the filter in
    // storage.getAllTargetPresets exactly so the UI and the rail agree.
    const tombstoned = loadDeletedTargetPresets();
    if (tombstoned.indexOf(recipe.slug) !== -1) return false;
    if (recipe.isStarter) return true;
    return loadAddedTargetPresets().indexOf(recipe.slug) !== -1;
  }

  const profiles = loadCustomTargetProfiles();
  const targetLabel = (recipe.label || "").toLowerCase();
  for (const key in profiles) {
    if (!Object.prototype.hasOwnProperty.call(profiles, key)) continue;
    const profile = profiles[key];
    if (profile && (profile.label || "").toLowerCase() === targetLabel) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Section taxonomy + filter predicates — shared across the library page
// (recipe-browser.ts carousels) and the Add From Library modal
// (library-picker.ts). Kept in library-data.ts because it's the only file
// loaded on every page that displays library rows; moving these here means
// adding a section to LIBRARY_TRAYS automatically picks up in both surfaces.
// ---------------------------------------------------------------------------

// Method-conditional hero. The library carousels and the modal both pull
// a single "featured" card to the top via pickFeaturedFromFiltered.
const FEATURED_PICKS: Record<string, string> = {
  espresso: "cafelytic-espresso",
  filter: "cafelytic-filter",
  all: "cafelytic-filter",
};

// Trays rendered in this order. Featured isn't a tray — it's pulled from
// FEATURED_PICKS and rendered above the trays. Unknown category values fall
// through to 'classic' per partitionByCategory.
const LIBRARY_TRAYS = [
  {
    key: "original",
    title: "Cafelytic Originals",
    subtitle: "House recipes from the Cafelytic team",
  },
  {
    key: "intro-water",
    title: "Intro to Water",
    subtitle:
      "RAsami's Week 1 recipes. Make one recipe each day to learn how different mineral balances affect the taste of your coffee.",
  },
  {
    key: "roaster",
    title: "Roaster Recipes",
    subtitle: "Published water from specialty roasters",
  },
  {
    key: "brand",
    title: "Coffee Water Brands",
    subtitle: "Mineral kits and concentrates from coffee water companies",
  },
  {
    key: "classic",
    title: "Classic Formulas",
    subtitle: "Canonical references every coffee nerd knows",
  },
];

function defaultFilters(): LibraryFilters {
  return { method: "all", roast: "all", tags: [], mine: false, q: "" };
}

function hasAnyActiveFilter(f: LibraryFilterState): boolean {
  return (
    f.method !== "all" || f.roast !== "all" || (f.tags || []).length > 0 || !!f.mine || f.q !== ""
  );
}

// Pure predicate — kept here so the same function powers the library page
// filter bar and the modal picker. options.isSaved is a predicate the caller
// supplies for the `mine` filter (the modal doesn't use it).
function recipeMatches(
  recipe: TargetProfile | LibraryRecipeRow,
  filters: LibraryFilterState,
  options?: { isSaved?: (recipe: LibraryRecipeRow) => boolean },
): boolean {
  if (!recipe) return false;

  // Method (hard filter). Recipe with brewMethod 'all' is accepted for any
  // non-default method filter.
  if (filters.method !== "all") {
    const rm = recipe.brewMethod || "filter";
    if (rm !== filters.method && rm !== "all") return false;
  }

  // Roast (hard filter). Recipe matches if the filter value is in its array
  // OR the array contains 'all'.
  if (filters.roast !== "all") {
    const roasts = Array.isArray(recipe.roast) ? recipe.roast : [];
    if (roasts.indexOf(filters.roast) === -1 && roasts.indexOf("all") === -1) return false;
  }

  // Flavor tags (soft filter, AND combination).
  if (filters.tags && filters.tags.length) {
    const recipeTags = Array.isArray(recipe.tags) ? recipe.tags : [];
    for (let i = 0; i < filters.tags.length; i++) {
      if (recipeTags.indexOf(filters.tags[i]) === -1) return false;
    }
  }

  // My Recipes.
  if (filters.mine) {
    const isSaved = options && typeof options.isSaved === "function" ? options.isSaved : null;
    if (!isSaved || !isSaved(recipe as LibraryRecipeRow)) return false;
  }

  // Search (label / description / creatorDisplayName, case-insensitive
  // substring).
  if (filters.q) {
    const needle = String(filters.q).toLowerCase();
    const haystack = [recipe.label || "", recipe.description || "", recipe.creatorDisplayName || ""]
      .join(" ")
      .toLowerCase();
    if (haystack.indexOf(needle) === -1) return false;
  }

  return true;
}

function applyFilters(
  filters: LibraryFilterState,
  recipes: LibraryRecipeRow[],
  options?: { isSaved?: (recipe: LibraryRecipeRow) => boolean },
): LibraryRecipeRow[] {
  if (!Array.isArray(recipes)) return [];
  const merged = Object.assign({}, defaultFilters(), filters || {});
  return recipes.filter(function (r) {
    return recipeMatches(r, merged, options);
  });
}

// Group filtered recipes by their category key, in the order LIBRARY_TRAYS
// declares them. Unknown categories fall through to "classic".
function partitionByCategory(recipes: LibraryRecipeRow[]): Record<string, LibraryRecipeRow[]> {
  const out: Record<string, LibraryRecipeRow[]> = {
    original: [],
    "intro-water": [],
    roaster: [],
    brand: [],
    classic: [],
  };
  if (!Array.isArray(recipes)) return out;
  recipes.forEach(function (r) {
    let cat = r && r.category ? r.category : "classic";
    if (!Object.prototype.hasOwnProperty.call(out, cat)) cat = "classic";
    out[cat]!.push(r);
  });
  // Intro to Water is a learn-by-doing series — order by slug so
  // rasami-w1d1 → rasami-w1d7 render in day order. Other trays keep
  // whatever order the caller passed in (created_at DESC).
  out["intro-water"]!.sort(function (a, b) {
    const sa = a && a.slug ? a.slug : "";
    const sb = b && b.slug ? b.slug : "";
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
  return out;
}

// Pick the featured recipe for the current method filter from an already-
// filtered set. Important: pass the doubly-filtered set (method + search +
// tags + roast) so the featured card respects the active search query —
// otherwise the pinned card may not contain the user's search needle.
function pickFeaturedFromFiltered(
  filtered: LibraryRecipeRow[],
  method: string,
): LibraryRecipeRow | null {
  if (!Array.isArray(filtered) || filtered.length === 0) return null;
  const slug = FEATURED_PICKS[method] || FEATURED_PICKS.all;
  if (!slug) return null;
  for (let i = 0; i < filtered.length; i++) {
    const item = filtered[i];
    if (item && item.slug === slug) return item;
  }
  return null;
}

// Expose on window for the classic consumers + storage.ts's global lookups.
window.fetchPublicRecipes = fetchPublicRecipes;
window.ensurePublicRecipesLoaded = ensurePublicRecipesLoaded;
window.invalidatePublicRecipesCache = invalidatePublicRecipesCache;
window.copyRecipeToMyProfiles = copyRecipeToMyProfiles;
window.isRecipeInMyProfiles = isRecipeInMyProfiles;
window.getPublicRecipesSync = getPublicRecipesSync;
window.onLibraryDataLoaded = onLibraryDataLoaded;
window.onLibraryDataError = onLibraryDataError;
window.LIBRARY_TRAYS = LIBRARY_TRAYS;
window.FEATURED_PICKS = FEATURED_PICKS;
window.defaultFilters = defaultFilters;
window.hasAnyActiveFilter = hasAnyActiveFilter;
window.recipeMatches = recipeMatches;
window.applyFilters = applyFilters;
window.partitionByCategory = partitionByCategory;
window.pickFeaturedFromFiltered = pickFeaturedFromFiltered;

// Named exports for the Vitest unit suites (library-data.test.js,
// library-merge.test.js), which import this module directly instead of going
// through the window bridge. normalizePublicRecipeRow + generateUniqueSlug are
// internal helpers exposed only for those tests.
export {
  normalizePublicRecipeRow,
  getPublicRecipesSync,
  onLibraryDataLoaded,
  onLibraryDataError,
  fetchPublicRecipes,
  ensurePublicRecipesLoaded,
  invalidatePublicRecipesCache,
  generateUniqueSlug,
  copyRecipeToMyProfiles,
  isRecipeInMyProfiles,
  FEATURED_PICKS,
  LIBRARY_TRAYS,
  defaultFilters,
  hasAnyActiveFilter,
  recipeMatches,
  applyFilters,
  partitionByCategory,
  pickFeaturedFromFiltered,
};

// No eager auto-fetch here; callers warm this explicitly via
// ensurePublicRecipesLoaded() on pages where library data is actually needed.
