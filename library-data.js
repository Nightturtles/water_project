// =============================================================================
// library-data.js — Data layer for the Recipe Library
// Fetches public recipes from Supabase and provides copy-to-my-profiles logic.
// =============================================================================

(function () {
  "use strict";

  var publicRecipesCache = null;

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
        createdAt: row.created_at
      };
    });

    publicRecipesCache = recipes;
    try {
      sessionStorage.setItem("cw_library_public_recipes", JSON.stringify(recipes));
    } catch (e) { /* sessionStorage full or unavailable */ }

    return recipes;
  }

  function invalidatePublicRecipesCache() {
    publicRecipesCache = null;
    try { sessionStorage.removeItem("cw_library_public_recipes"); } catch (e) { /* ignore */ }
  }

  // Generate a unique slug that doesn't conflict with existing custom or built-in profiles.
  function generateUniqueSlug(baseName) {
    var baseSlug = slugify(baseName);
    if (!baseSlug) baseSlug = "recipe";

    var existing = loadCustomTargetProfiles();
    var existingKeys = new Set(Object.keys(existing));

    // Also include built-in keys
    if (typeof RESERVED_TARGET_KEYS !== "undefined") {
      RESERVED_TARGET_KEYS.forEach(function (k) { existingKeys.add(k); });
    }

    if (!existingKeys.has(baseSlug)) return baseSlug;

    for (var i = 2; i < 100; i++) {
      var candidate = baseSlug + "-" + i;
      if (!existingKeys.has(candidate)) return candidate;
    }
    return baseSlug + "-" + Date.now();
  }

  // Copy a library recipe into the user's custom target profiles.
  // Returns the slug of the new profile, or null on failure.
  function copyRecipeToMyProfiles(recipe) {
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

  // Check if a library recipe is already in the user's custom profiles (by label match).
  function isRecipeInMyProfiles(recipe) {
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
})();
