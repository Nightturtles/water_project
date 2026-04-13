// =============================================================================
// library-ui.js — UI logic for the Recipe Library page
// =============================================================================

(function () {
  "use strict";

  var MY_RECIPES_TAG = "My Recipes";

  var allRecipes = [];
  var currentUserId = null;
  var activeBrewFilter = "all";
  var activeTags = new Set();
  var searchTerm = "";

  // --- Init ---
  document.addEventListener("DOMContentLoaded", async function () {
    var loggedIn = typeof isLoggedIn === "function" && await isLoggedIn();
    var authGate = document.getElementById("library-auth-gate");
    var content = document.getElementById("library-content");

    if (!loggedIn) {
      authGate.style.display = "";
      content.style.display = "none";
      return;
    }

    authGate.style.display = "none";
    content.style.display = "";

    // Get current user for "my published" detection
    if (typeof getUser === "function") {
      var userResult = await getUser();
      var user = userResult && userResult.data && userResult.data.user;
      if (user) currentUserId = user.id;
    }

    // Fetch recipes
    allRecipes = await fetchPublicRecipes(true);

    // Build tag filter chips
    buildTagFilters();

    // Bind search
    var searchInput = document.getElementById("library-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        searchTerm = searchInput.value.trim().toLowerCase();
        renderFilteredRecipes();
      });
    }

    // Bind brew method filter
    var brewFilter = document.getElementById("library-brew-filter");
    if (brewFilter) {
      brewFilter.addEventListener("click", function (e) {
        var btn = e.target.closest(".brew-method-btn");
        if (!btn) return;
        var filter = btn.dataset.filter;
        if (filter === activeBrewFilter) return;
        activeBrewFilter = filter;
        brewFilter.querySelectorAll(".brew-method-btn").forEach(function (b) {
          b.classList.toggle("active", b.dataset.filter === activeBrewFilter);
        });
        renderFilteredRecipes();
      });
    }

    renderFilteredRecipes();
  });

  // --- Tag filters ---
  function buildTagFilters() {
    // Count which predefined tags are actually used
    var tagCounts = {};
    allRecipes.forEach(function (r) {
      (r.tags || []).forEach(function (t) {
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      });
    });

    var container = document.getElementById("library-tag-filters");
    if (!container) return;
    container.innerHTML = "";

    // "My Recipes" pinned first
    var myCount = currentUserId ? allRecipes.filter(function (r) { return r.userId === currentUserId; }).length : 0;
    if (myCount > 0) {
      container.appendChild(createFilterChip(MY_RECIPES_TAG));
    }

    // Predefined tags — only show those with at least 1 recipe
    LIBRARY_TAGS.forEach(function (tag) {
      if (tagCounts[tag] && tagCounts[tag] > 0) {
        container.appendChild(createFilterChip(tag));
      }
    });
  }

  function createFilterChip(tag) {
    var chip = document.createElement("button");
    chip.type = "button";
    chip.className = "library-tag-chip" + (activeTags.has(tag) ? " active" : "");
    chip.textContent = tag;
    chip.addEventListener("click", function () {
      if (activeTags.has(tag)) {
        activeTags.delete(tag);
        chip.classList.remove("active");
      } else {
        activeTags.add(tag);
        chip.classList.add("active");
      }
      renderFilteredRecipes();
    });
    return chip;
  }

  // --- Filtering ---
  function getFilteredRecipes() {
    var filterMyRecipes = activeTags.has(MY_RECIPES_TAG);
    // Regular tags (excluding the virtual "My Recipes" tag)
    var regularTags = new Set();
    activeTags.forEach(function (t) {
      if (t !== MY_RECIPES_TAG) regularTags.add(t);
    });

    return allRecipes.filter(function (r) {
      // "My Recipes" filter — must be owned by current user
      if (filterMyRecipes && r.userId !== currentUserId) return false;

      // Brew method
      if (activeBrewFilter !== "all") {
        var brewMethod = (r.brewMethod || "filter").toLowerCase();
        if (brewMethod !== activeBrewFilter) return false;
      }

      // Regular tags
      if (regularTags.size > 0) {
        var recipeTags = new Set((r.tags || []).map(function (t) { return t.toLowerCase(); }));
        var match = false;
        regularTags.forEach(function (t) {
          if (recipeTags.has(t.toLowerCase())) match = true;
        });
        if (!match) return false;
      }

      // Search
      if (searchTerm) {
        var haystack = [
          r.label,
          r.description,
          r.creatorDisplayName,
          (r.tags || []).join(" ")
        ].join(" ").toLowerCase();
        if (haystack.indexOf(searchTerm) === -1) return false;
      }

      return true;
    });
  }

  // --- Rendering ---
  function renderFilteredRecipes() {
    var grid = document.getElementById("library-grid");
    var emptyEl = document.getElementById("library-empty");
    var countEl = document.getElementById("library-count");
    if (!grid) return;

    var filtered = getFilteredRecipes();

    grid.innerHTML = "";

    if (filtered.length === 0) {
      if (emptyEl) emptyEl.style.display = "";
      if (countEl) countEl.textContent = "";
    } else {
      if (emptyEl) emptyEl.style.display = "none";
      if (countEl) countEl.textContent = filtered.length + " recipe" + (filtered.length !== 1 ? "s" : "");
    }

    filtered.forEach(function (recipe) {
      var isOwner = currentUserId && recipe.userId === currentUserId;
      grid.appendChild(createRecipeCard(recipe, isOwner));
    });
  }

  function createRecipeCard(recipe, isOwner) {
    var card = document.createElement("div");
    card.className = "library-card";

    // Header
    var header = document.createElement("div");
    header.className = "library-card-header";

    var title = document.createElement("h3");
    title.className = "library-card-title";
    title.textContent = recipe.label;
    header.appendChild(title);

    var brewBadge = document.createElement("span");
    brewBadge.className = "library-brew-badge";
    brewBadge.textContent = (recipe.brewMethod || "filter").charAt(0).toUpperCase() + (recipe.brewMethod || "filter").slice(1);
    header.appendChild(brewBadge);

    card.appendChild(header);

    // Creator
    if (recipe.creatorDisplayName) {
      var creator = document.createElement("div");
      creator.className = "library-card-creator";
      creator.textContent = "by " + recipe.creatorDisplayName;
      card.appendChild(creator);
    }

    // Ion summary
    var ions = document.createElement("div");
    ions.className = "library-card-ions";
    var ionPairs = [
      { label: "Ca", value: recipe.calcium },
      { label: "Mg", value: recipe.magnesium },
      { label: "Alk", value: recipe.alkalinity }
    ];
    ionPairs.forEach(function (pair) {
      var tag = document.createElement("span");
      tag.className = "library-ion-tag";
      tag.textContent = pair.label + " " + Math.round(pair.value || 0);
      ions.appendChild(tag);
    });
    card.appendChild(ions);

    // Description
    if (recipe.description) {
      var desc = document.createElement("p");
      desc.className = "library-card-desc";
      var text = recipe.description;
      if (text.length > 120) text = text.substring(0, 117) + "...";
      desc.textContent = text;
      card.appendChild(desc);
    }

    // Tags
    if (recipe.tags && recipe.tags.length > 0) {
      var tagsWrap = document.createElement("div");
      tagsWrap.className = "library-card-tags";
      recipe.tags.forEach(function (tag) {
        var chip = document.createElement("span");
        chip.className = "library-tag-chip small";
        chip.textContent = tag;
        tagsWrap.appendChild(chip);
      });
      card.appendChild(tagsWrap);
    }

    // Actions
    var actions = document.createElement("div");
    actions.className = "library-card-actions";

    if (isOwner) {
      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "preset-btn";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", function () {
        openEditModal(recipe);
      });
      actions.appendChild(editBtn);

      var unpublishBtn = document.createElement("button");
      unpublishBtn.type = "button";
      unpublishBtn.className = "preset-btn library-unpublish-btn";
      unpublishBtn.textContent = "Unpublish";
      unpublishBtn.addEventListener("click", function () {
        handleUnpublish(recipe, card);
      });
      actions.appendChild(unpublishBtn);
    } else {
      var added = isRecipeInMyProfiles(recipe);
      var addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "preset-btn library-add-btn" + (added ? " added" : "");
      addBtn.textContent = added ? "Added" : "Add to My Recipes";
      addBtn.disabled = added;
      addBtn.addEventListener("click", function () {
        copyRecipeToMyProfiles(recipe);
        addBtn.textContent = "Added";
        addBtn.classList.add("added");
        addBtn.disabled = true;
      });
      actions.appendChild(addBtn);
    }

    card.appendChild(actions);
    return card;
  }

  // --- Unpublish ---
  async function handleUnpublish(recipe, cardEl) {
    if (!confirm('Unpublish "' + recipe.label + '" from the Recipe Library?')) return;

    // Update the profile in localStorage to set isPublic = false
    var profiles = loadCustomTargetProfiles();
    var slug = recipe.slug;
    if (profiles[slug]) {
      profiles[slug].isPublic = false;
      saveCustomTargetProfiles(profiles);
    }

    // Also update directly in Supabase
    if (typeof window.supabaseClient !== "undefined") {
      await window.supabaseClient
        .from("target_profiles")
        .update({ is_public: false })
        .eq("id", recipe.id);
    }

    // Remove from local cache and re-render
    allRecipes = allRecipes.filter(function (r) { return r.id !== recipe.id; });
    invalidatePublicRecipesCache();
    buildTagFilters();
    renderFilteredRecipes();
  }

  // --- Edit modal ---
  var editingRecipe = null;
  var editTags = [];

  function openEditModal(recipe) {
    editingRecipe = recipe;
    editTags = (recipe.tags || []).slice();

    var overlay = document.getElementById("edit-recipe-overlay");
    if (!overlay) return;

    // Populate fields
    document.getElementById("edit-recipe-name").value = recipe.label || "";
    document.getElementById("edit-recipe-desc").value = recipe.description || "";
    document.getElementById("edit-calcium").value = Math.round(recipe.calcium || 0);
    document.getElementById("edit-magnesium").value = Math.round(recipe.magnesium || 0);
    document.getElementById("edit-alkalinity").value = Math.round(recipe.alkalinity || 0);
    document.getElementById("edit-potassium").value = Math.round(recipe.potassium || 0);
    document.getElementById("edit-sodium").value = Math.round(recipe.sodium || 0);
    document.getElementById("edit-sulfate").value = Math.round(recipe.sulfate || 0);
    document.getElementById("edit-chloride").value = Math.round(recipe.chloride || 0);
    document.getElementById("edit-bicarbonate").value = Math.round(recipe.bicarbonate || 0);

    // Brew method toggle
    var brewMethod = recipe.brewMethod || "filter";
    var toggle = document.getElementById("edit-brew-method-toggle");
    if (toggle) {
      toggle.querySelectorAll(".brew-method-btn").forEach(function (btn) {
        btn.classList.toggle("active", btn.dataset.brewMethod === brewMethod);
      });
    }

    // Tags
    renderEditTags();

    // Clear error
    document.getElementById("edit-recipe-error").textContent = "";

    overlay.style.display = "flex";
    document.getElementById("edit-recipe-name").focus();

    // Bind events (use named functions so we can remove them)
    var saveBtn = document.getElementById("edit-recipe-save");
    var cancelBtn = document.getElementById("edit-recipe-cancel");

    function onSave() { handleEditSave(); }
    function onCancel() { closeEditModal(); }
    function onOverlayClick(e) { if (e.target === overlay) closeEditModal(); }
    function onKeydown(e) { if (e.key === "Escape") closeEditModal(); }

    // Brew method toggle clicks
    if (toggle) {
      toggle.addEventListener("click", handleEditBrewToggle);
    }

    saveBtn.addEventListener("click", onSave);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onKeydown);

    // Store cleanup references
    overlay._editCleanup = function () {
      saveBtn.removeEventListener("click", onSave);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onOverlayClick);
      document.removeEventListener("keydown", onKeydown);
      if (toggle) toggle.removeEventListener("click", handleEditBrewToggle);
    };
  }

  function closeEditModal() {
    var overlay = document.getElementById("edit-recipe-overlay");
    if (!overlay) return;
    overlay.style.display = "none";
    if (overlay._editCleanup) {
      overlay._editCleanup();
      overlay._editCleanup = null;
    }
    editingRecipe = null;
  }

  function handleEditBrewToggle(e) {
    var btn = e.target.closest(".brew-method-btn");
    if (!btn) return;
    var toggle = document.getElementById("edit-brew-method-toggle");
    if (!toggle) return;
    toggle.querySelectorAll(".brew-method-btn").forEach(function (b) {
      b.classList.toggle("active", b === btn);
    });
  }

  function renderEditTags() {
    var container = document.getElementById("edit-tag-chips");
    if (!container) return;
    container.innerHTML = "";
    LIBRARY_TAGS.forEach(function (tag) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "library-tag-chip library-edit-tag-toggle" + (editTags.indexOf(tag) !== -1 ? " active" : "");
      chip.textContent = tag;
      chip.addEventListener("click", function () {
        var idx = editTags.indexOf(tag);
        if (idx !== -1) {
          editTags.splice(idx, 1);
          chip.classList.remove("active");
        } else {
          editTags.push(tag);
          chip.classList.add("active");
        }
      });
      container.appendChild(chip);
    });
  }

  async function handleEditSave() {
    if (!editingRecipe) return;

    var errorEl = document.getElementById("edit-recipe-error");
    var name = (document.getElementById("edit-recipe-name").value || "").trim();
    if (!name) {
      errorEl.textContent = "Recipe name is required.";
      return;
    }

    var newSlug = slugify(name);
    if (!newSlug) {
      errorEl.textContent = "Enter a valid name.";
      return;
    }

    // Check for slug conflicts (allow keeping the same name)
    if (newSlug !== editingRecipe.slug) {
      var profiles = loadCustomTargetProfiles();
      if (profiles[newSlug] || (typeof RESERVED_TARGET_KEYS !== "undefined" && RESERVED_TARGET_KEYS.has(newSlug))) {
        errorEl.textContent = "A recipe with this name already exists.";
        return;
      }
    }

    errorEl.textContent = "";

    // Read brew method from toggle
    var activeBrewBtn = document.querySelector("#edit-brew-method-toggle .brew-method-btn.active");
    var brewMethod = activeBrewBtn ? activeBrewBtn.dataset.brewMethod : "filter";

    // Build updated profile
    var updated = {
      label: name,
      calcium: parseFloat(document.getElementById("edit-calcium").value) || 0,
      magnesium: parseFloat(document.getElementById("edit-magnesium").value) || 0,
      alkalinity: parseFloat(document.getElementById("edit-alkalinity").value) || 0,
      potassium: parseFloat(document.getElementById("edit-potassium").value) || 0,
      sodium: parseFloat(document.getElementById("edit-sodium").value) || 0,
      sulfate: parseFloat(document.getElementById("edit-sulfate").value) || 0,
      chloride: parseFloat(document.getElementById("edit-chloride").value) || 0,
      bicarbonate: parseFloat(document.getElementById("edit-bicarbonate").value) || 0,
      description: (document.getElementById("edit-recipe-desc").value || "").trim(),
      brewMethod: brewMethod,
      isPublic: true,
      creatorDisplayName: editingRecipe.creatorDisplayName || "",
      tags: editTags.slice()
    };

    // Update localStorage
    var profiles = loadCustomTargetProfiles();
    if (newSlug !== editingRecipe.slug) {
      delete profiles[editingRecipe.slug];
    }
    profiles[newSlug] = updated;
    saveCustomTargetProfiles(profiles);

    // Update directly in Supabase
    if (typeof window.supabaseClient !== "undefined") {
      var supabasePayload = {
        slug: newSlug,
        label: updated.label,
        brew_method: updated.brewMethod,
        calcium: updated.calcium,
        magnesium: updated.magnesium,
        alkalinity: updated.alkalinity,
        potassium: updated.potassium,
        sodium: updated.sodium,
        sulfate: updated.sulfate,
        chloride: updated.chloride,
        bicarbonate: updated.bicarbonate,
        description: updated.description,
        tags: updated.tags,
        is_public: true,
        updated_at: new Date().toISOString()
      };

      var result = await window.supabaseClient
        .from("target_profiles")
        .update(supabasePayload)
        .eq("id", editingRecipe.id);

      if (result.error) {
        console.warn("[library] edit update failed:", result.error);
        errorEl.textContent = "Failed to save changes. Please try again.";
        return;
      }
    }

    // Update the recipe in the local allRecipes cache
    for (var i = 0; i < allRecipes.length; i++) {
      if (allRecipes[i].id === editingRecipe.id) {
        allRecipes[i].slug = newSlug;
        allRecipes[i].label = updated.label;
        allRecipes[i].brewMethod = updated.brewMethod;
        allRecipes[i].calcium = updated.calcium;
        allRecipes[i].magnesium = updated.magnesium;
        allRecipes[i].alkalinity = updated.alkalinity;
        allRecipes[i].potassium = updated.potassium;
        allRecipes[i].sodium = updated.sodium;
        allRecipes[i].sulfate = updated.sulfate;
        allRecipes[i].chloride = updated.chloride;
        allRecipes[i].bicarbonate = updated.bicarbonate;
        allRecipes[i].description = updated.description;
        allRecipes[i].tags = updated.tags;
        break;
      }
    }

    invalidatePublicRecipesCache();
    closeEditModal();
    buildTagFilters();
    renderFilteredRecipes();
  }
})();
