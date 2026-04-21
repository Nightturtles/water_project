// =============================================================================
// library-data.js — Data layer for the Recipe Library
// Fetches public recipes from Supabase and provides copy-to-my-profiles logic.
// =============================================================================

(function () {
  "use strict";

  var publicRecipesCache = null;
  var loadedCallbacks = [];

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
      var cached = sessionStorage.getItem("cw_library_public_recipes");
      if (cached) {
        publicRecipesCache = JSON.parse(cached);
        return publicRecipesCache;
      }
    } catch (e) { /* ignore */ }
    return [];
  }

  // Register a callback that fires after fetchPublicRecipes completes
  // successfully (used by taste/index pages to re-render the preset rail
  // once library rows are available). Callbacks receive the recipes array.
  function onLibraryDataLoaded(cb) {
    if (typeof cb === "function") loadedCallbacks.push(cb);
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
        var cached = sessionStorage.getItem("cw_library_public_recipes");
        if (cached) {
          publicRecipesCache = JSON.parse(cached);
          return publicRecipesCache;
        }
      } catch (e) { /* ignore */ }
    }

    if (typeof window.supabaseClient === "undefined") return [];

    // NOTE: tray/roast are introduced by migration 006 but intentionally NOT
    // in this select list yet — migrations 006/007 are deferred to post-merge,
    // so fetching columns that don't yet exist would 400 on every pageload in
    // production during the window between code deploy and migration apply.
    // Row-level normalization below defaults them (tray → "classic",
    // roast → ["all"]); follow-up PR re-adds them here once migrations land.
    var result = await window.supabaseClient
      .from("target_profiles")
      .select("id, user_id, slug, label, brew_method, calcium, magnesium, alkalinity, potassium, sodium, sulfate, chloride, bicarbonate, description, creator_display_name, tags, created_at")
      .eq("is_public", true)
      .order("created_at", { ascending: false });

    if (result.error) {
      console.warn("[library] failed to fetch public recipes:", result.error);
      return publicRecipesCache || [];
    }

    var recipes = (result.data || []).map(function (row) {
      return {
        id: row.id,
        userId: row.user_id,
        slug: row.slug,
        label: row.label,
        brewMethod: row.brew_method || "filter",
        calcium: row.calcium,
        magnesium: row.magnesium,
        alkalinity: row.alkalinity,
        potassium: row.potassium,
        sodium: row.sodium,
        sulfate: row.sulfate,
        chloride: row.chloride,
        bicarbonate: row.bicarbonate,
        description: row.description || "",
        creatorDisplayName: row.creator_display_name || "",
        tags: Array.isArray(row.tags) ? row.tags : [],
        // Taxonomy v2 (migration 006): tray + roast power the landing-page
        // filter chips and the re-add-from-library UI.
        tray: row.tray || "classic",
        roast: Array.isArray(row.roast) ? row.roast : ["all"],
        createdAt: row.created_at
      };
    });

    publicRecipesCache = recipes;
    try {
      sessionStorage.setItem("cw_library_public_recipes", JSON.stringify(recipes));
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
    try { sessionStorage.removeItem("cw_library_public_recipes"); } catch (e) { /* ignore */ }
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

  // Copy a library recipe into the user's custom target profiles.
  // Returns the slug under which the recipe is now available, or null on failure.
  //
  // Special case (Piece D, re-add flow): if the library row's slug is currently
  // tombstoned — meaning the user previously clicked × on this slug in the
  // preset rail — lift the tombstone instead of creating a suffixed custom
  // copy. The merge in storage.getAllTargetPresets will then surface the
  // library row at its canonical slug on the next render. This preserves
  // identity for canonical built-ins (sca, rao, lotus-*, cafelytic-*) so that
  // "remove, then re-add from library" is a true round-trip rather than
  // leaving a "sca-2" dangling in custom profiles.
  function copyRecipeToMyProfiles(recipe) {
    if (recipe && recipe.slug && typeof loadDeletedTargetPresets === "function") {
      var tombstoned = loadDeletedTargetPresets();
      if (tombstoned.indexOf(recipe.slug) !== -1) {
        if (typeof removeDeletedTargetPreset === "function") {
          removeDeletedTargetPreset(recipe.slug);
        }
        return recipe.slug;
      }
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
      creatorDisplayName: recipe.creatorDisplayName || ""
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
  // Two regimes:
  //   1. Canonical library rows (userId == null — the 007-seeded built-ins like
  //      SCA, Rao, Lotus, Cafelytic) live in the rail at their canonical slug
  //      via storage.getAllTargetPresets's merge, unless tombstoned. So for
  //      these, "in my profiles" = "not tombstoned". Fixes the Piece D subtle
  //      bug where a tombstoned built-in showed "Added" (via label match
  //      through residual state) even though the user couldn't see it.
  //   2. User-published rows (userId != null) are added via copy-to-custom,
  //      which creates a new custom profile with a suffixed slug. These are
  //      detected by label match against the user's custom profiles.
  //
  // Trust boundary note: `recipe.userId == null` distinguishes canonical rows
  // from user-published rows by RLS guarantee, not by convention. The
  // target_profiles INSERT policy in supabase/001_schema.sql enforces
  // `auth.uid() = user_id`, which rejects any client-originated row with
  // user_id NULL. Only migrations running as service role (002, 006, 007)
  // can create canonical rows, so a malicious user cannot forge a row that
  // makes this branch fire for their content.
  function isRecipeInMyProfiles(recipe) {
    if (recipe && recipe.userId == null && recipe.slug && typeof loadDeletedTargetPresets === "function") {
      var tombstoned = loadDeletedTargetPresets();
      return tombstoned.indexOf(recipe.slug) === -1;
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
