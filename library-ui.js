// =============================================================================
// library-ui.js — UI logic for the Recipe Library page
// =============================================================================

(function () {
  "use strict";

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
      var user = await getUser();
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
    renderMyPublished();
  });

  // --- Tag filters ---
  function buildTagFilters() {
    var tagCounts = {};
    allRecipes.forEach(function (r) {
      (r.tags || []).forEach(function (t) {
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      });
    });

    var container = document.getElementById("library-tag-filters");
    if (!container) return;
    container.innerHTML = "";

    // Sort tags by count descending
    var sortedTags = Object.keys(tagCounts).sort(function (a, b) {
      return tagCounts[b] - tagCounts[a];
    });

    sortedTags.forEach(function (tag) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "library-tag-chip";
      chip.textContent = tag;
      chip.dataset.tag = tag;
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
      container.appendChild(chip);
    });
  }

  // --- Filtering ---
  function getFilteredRecipes() {
    return allRecipes.filter(function (r) {
      // Brew method
      if (activeBrewFilter !== "all") {
        var brewMethod = (r.brewMethod || "filter").toLowerCase();
        if (brewMethod !== activeBrewFilter) return false;
      }

      // Tags
      if (activeTags.size > 0) {
        var recipeTags = new Set((r.tags || []).map(function (t) { return t.toLowerCase(); }));
        var match = false;
        activeTags.forEach(function (t) {
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

    // Exclude user's own public recipes from main grid (shown in "My Published" section)
    var displayRecipes = filtered.filter(function (r) {
      return r.userId !== currentUserId;
    });

    grid.innerHTML = "";

    if (displayRecipes.length === 0) {
      if (emptyEl) emptyEl.style.display = "";
      if (countEl) countEl.textContent = "";
    } else {
      if (emptyEl) emptyEl.style.display = "none";
      if (countEl) countEl.textContent = displayRecipes.length + " recipe" + (displayRecipes.length !== 1 ? "s" : "");
    }

    displayRecipes.forEach(function (recipe) {
      grid.appendChild(createRecipeCard(recipe, false));
    });
  }

  function renderMyPublished() {
    var section = document.getElementById("my-published-section");
    var grid = document.getElementById("my-published-grid");
    if (!section || !grid || !currentUserId) return;

    var myRecipes = allRecipes.filter(function (r) {
      return r.userId === currentUserId;
    });

    if (myRecipes.length === 0) {
      section.style.display = "none";
      return;
    }

    section.style.display = "";
    grid.innerHTML = "";
    myRecipes.forEach(function (recipe) {
      grid.appendChild(createRecipeCard(recipe, true));
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
    renderMyPublished();
    renderFilteredRecipes();
  }
})();
