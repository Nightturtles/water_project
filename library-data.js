// =============================================================================
// library-data.js — Data layer for the Recipe Library
// Fetches public recipes from Supabase and provides copy-to-my-profiles logic.
// =============================================================================

(function () {
  "use strict";

  var publicRecipesCache = null;
  // sessionStorage key for the cached catalog. Bump the suffix whenever a
  // schema/migration change would make the prior cache misleading — users
  // whose tab was open across the deploy rehydrate from sessionStorage
  // BEFORE the live fetch, so a stale snapshot hides the new data forever
  // (the fetch short-circuits on cache hit).
  //   v2 — forced re-fetch after migration-010 tray/slug changes.
  //   v3 — forced re-fetch after migration-011 added is_starter. Without
  //        this bump, pre-011 _v2 snapshots normalize to isStarter:false
  //        for every canonical row and break the starter rail silently.
  var CACHE_KEY = "cw_library_public_recipes_v3";
  // Set (not Array) so re-registering the same function reference doesn't
  // duplicate firings — defends against bfcache restore and other scenarios
  // where the same classic-script evaluates twice against the same module
  // instance. Callers that want to unregister receive a token from
  // onLibraryDataLoaded(cb) and call it to remove their registration.
  var loadedCallbacks = new Set();

  // Normalize a row into the canonical client shape. Accepts both DB shape
  // (snake_case columns from Supabase) and already-normalized client shape
  // (camelCase from a prior deploy's sessionStorage snapshot). This matters
  // across the tray → category rename: a tab open during the Wave B deploy
  // still has sessionStorage entries with the old `tray` field. Running
  // every cache-read through this normalizer ensures callers always see
  // `category` (and other canonical camelCase keys) regardless of when
  // the cache was written.
  function normalizePublicRecipeRow(row) {
    return {
      id: row.id,
      userId: row.user_id != null ? row.user_id : row.userId,
      slug: row.slug,
      label: row.label,
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
    };
  }

  // Synchronous accessor for use by sync callers that need library data
  // without awaiting a fetch (e.g. storage.getAllTargetPresets, which is
  // called from UI render paths that can't be made async without rippling
  // through every caller). Returns the in-memory cache if present, falls
  // back to the sessionStorage snapshot, and returns [] otherwise. The
  // first caller on a cold pageload will get [] and then the preset rail
  // re-renders via onLibraryDataLoaded once fetchPublicRecipes resolves.
  function getPublicRecipesSync() {
    if (publicRecipesCache) return publicRecipesCache;
    try {
      var cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        var parsed = JSON.parse(cached);
        publicRecipesCache = Array.isArray(parsed) ? parsed.map(normalizePublicRecipeRow) : [];
        return publicRecipesCache;
      }
    } catch (e) { /* ignore */ }
    return [];
  }

  // Register a callback that fires after fetchPublicRecipes completes
  // successfully (used by taste/index pages to re-render the preset rail
  // once library rows are available). Callbacks receive the recipes array.
  // Returns an unregister token — invoking it removes the callback. Callers
  // that don't need to unregister can ignore the return value.
  function onLibraryDataLoaded(cb) {
    if (typeof cb !== "function") return function () {};
    loadedCallbacks.add(cb);
    return function unregister() {
      loadedCallbacks.delete(cb);
    };
  }

  function fireLoadedCallbacks(recipes) {
    loadedCallbacks.forEach(function (cb) {
      try { cb(recipes); } catch (e) { console.warn("[library] onLibraryDataLoaded callback failed:", e); }
    });
  }

  // Fetch all public recipes from Supabase. Caches in sessionStorage.
  async function fetchPublicRecipes(forceRefresh) {
    if (!forceRefresh && publicRecipesCache) return publicRecipesCache;

    if (!forceRefresh) {
      try {
        var cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
          var parsedCached = JSON.parse(cached);
          publicRecipesCache = Array.isArray(parsedCached)
            ? parsedCached.map(normalizePublicRecipeRow)
            : [];
          return publicRecipesCache;
        }
      } catch (e) { /* ignore */ }
    }

    if (typeof window.supabaseClient === "undefined") return [];

    var result = await window.supabaseClient
      .from("target_profiles")
      .select(
        "id, user_id, slug, label, brew_method, calcium, magnesium, alkalinity, potassium, sodium, sulfate, chloride, bicarbonate, description, creator_display_name, tags, tray, roast, created_at, is_starter"
      )
      .eq("is_public", true)
      .order("created_at", { ascending: false });

    if (result.error) {
      console.warn("[library] failed to fetch public recipes:", result.error);
      return publicRecipesCache || [];
    }

    // Taxonomy v2 (migration 006): category (DB column: `tray`) + roast
    // power the recipe-browser carousels, filter chips, and the
    // re-add-from-library UI. The recipe-browser spec and mockups call
    // this field `category`; the DB keeps `tray` for parallelism with
    // `roast`, so the rename happens at the client boundary via
    // normalizePublicRecipeRow (which also accepts pre-Wave-B cached
    // rows with `tray` and rewrites them to `category`).
    var recipes = (result.data || []).map(normalizePublicRecipeRow);

    publicRecipesCache = recipes;
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(recipes));
    } catch (e) { /* sessionStorage full or unavailable */ }

    // Preset rail consumers (taste.html, index.html) cache the merged rail
    // in storage.targetPresetsCache. Invalidate so the next render picks up
    // the freshly-fetched library rows.
    if (typeof invalidateTargetPresetsCache === "function") {
      invalidateTargetPresetsCache();
    }
    fireLoadedCallbacks(recipes);

    return recipes;
  }

  function invalidatePublicRecipesCache() {
    publicRecipesCache = null;
    try { sessionStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ }
    if (typeof invalidateTargetPresetsCache === "function") {
      invalidateTargetPresetsCache();
    }
  }

  // Generate a unique slug that doesn't conflict with existing custom, built-in,
  // or Supabase-library profiles. Library slugs must be excluded here because
  // the library is now merged into the preset rail (Piece C, migration 007+),
  // so a user-chosen slug colliding with a library slug would shadow the
  // library row's data.
  function generateUniqueSlug(baseName) {
    var baseSlug = slugify(baseName);
    if (!baseSlug) baseSlug = "recipe";

    var existing = loadCustomTargetProfiles();
    var existingKeys = new Set(Object.keys(existing));

    // Also include built-in shim keys
    if (typeof RESERVED_TARGET_KEYS !== "undefined") {
      RESERVED_TARGET_KEYS.forEach(function (k) { existingKeys.add(k); });
    }

    // And Supabase library slugs currently loaded
    getPublicRecipesSync().forEach(function (r) {
      if (r && r.slug) existingKeys.add(r.slug);
    });

    if (!existingKeys.has(baseSlug)) return baseSlug;

    for (var i = 2; i < 100; i++) {
      var candidate = baseSlug + "-" + i;
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
  function copyRecipeToMyProfiles(recipe) {
    if (recipe && recipe.userId == null && recipe.slug) {
      if (typeof loadDeletedTargetPresets === "function" &&
          typeof removeDeletedTargetPreset === "function") {
        var tombstoned = loadDeletedTargetPresets();
        if (tombstoned.indexOf(recipe.slug) !== -1) {
          removeDeletedTargetPreset(recipe.slug);
        }
      }
      if (!recipe.isStarter && typeof addAddedTargetPreset === "function") {
        addAddedTargetPreset(recipe.slug);
      }
      return recipe.slug;
    }

    var slug = generateUniqueSlug(recipe.label);
    var profile = {
      label: recipe.label,
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
      roast: Array.isArray(recipe.roast) ? recipe.roast.slice() : ["all"]
    };

    var profiles = loadCustomTargetProfiles();
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
  // target_profiles INSERT policy in supabase/001_schema.sql enforces
  // `auth.uid() = user_id`, which rejects any client-originated row with
  // user_id NULL. Only migrations running as service role (002, 006, 007,
  // 010, 011) can create canonical rows, so a malicious user cannot forge a
  // row that makes this branch fire for their content.
  function isRecipeInMyProfiles(recipe) {
    if (recipe && recipe.userId == null && recipe.slug) {
      // Tombstones trump both starter and added: a tombstoned slug is hidden
      // from the rail regardless of is_starter or added-list state, so the
      // library star should reflect that. Matches the filter in
      // storage.getAllTargetPresets exactly so the UI and the rail agree.
      var tombstoned = typeof loadDeletedTargetPresets === "function"
        ? loadDeletedTargetPresets()
        : [];
      if (tombstoned.indexOf(recipe.slug) !== -1) return false;
      if (recipe.isStarter) return true;
      if (typeof loadAddedTargetPresets !== "function") return false;
      return loadAddedTargetPresets().indexOf(recipe.slug) !== -1;
    }

    var profiles = loadCustomTargetProfiles();
    var targetLabel = (recipe.label || "").toLowerCase();
    for (var key in profiles) {
      if (profiles.hasOwnProperty(key) && (profiles[key].label || "").toLowerCase() === targetLabel) {
        return true;
      }
    }
    return false;
  }

  // Expose on window
  window.fetchPublicRecipes = fetchPublicRecipes;
  window.invalidatePublicRecipesCache = invalidatePublicRecipesCache;
  window.copyRecipeToMyProfiles = copyRecipeToMyProfiles;
  window.isRecipeInMyProfiles = isRecipeInMyProfiles;
  window.getPublicRecipesSync = getPublicRecipesSync;
  window.onLibraryDataLoaded = onLibraryDataLoaded;

  // Node/Vitest UMD shim (harmless in browsers). Matches constants.js /
  // storage.js pattern so tests can `require("./library-data.js")` and
  // destructure the exports directly.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      fetchPublicRecipes: fetchPublicRecipes,
      invalidatePublicRecipesCache: invalidatePublicRecipesCache,
      copyRecipeToMyProfiles: copyRecipeToMyProfiles,
      isRecipeInMyProfiles: isRecipeInMyProfiles,
      getPublicRecipesSync: getPublicRecipesSync,
      onLibraryDataLoaded: onLibraryDataLoaded,
    };
  }

  // Auto-fetch on load so pages that merge library into their preset rail
  // (taste.html, index.html) don't need to each coordinate the fetch. Guarded
  // on supabaseClient because library.html loads this file before any user is
  // authenticated — the fetch will still work (is_public policy on RLS), but
  // the client must exist. Non-blocking; fireLoadedCallbacks handles the
  // re-render once rows arrive.
  if (typeof window.supabaseClient !== "undefined") {
    fetchPublicRecipes(false).catch(function (e) {
      console.warn("[library] auto-fetch failed:", e);
    });
  }
})();
