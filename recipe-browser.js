// =============================================================================
// recipe-browser.js — Wave D recipe browser (mounted by library-v2.html).
//
// D2 shipped the interactive filter bar + URL state + applyFilters predicate.
// D3 adds the recipe card component, D4 adds the featured hero and tray
// carousels. Filters still drive only a counter in D3/D4 — wiring filters
// into the rendered hero/carousels is D5's work. Cut-over to library.html
// is also D5.
//
// `applyFilters` is the load-bearing predicate and is exposed on `window` so
// e2e can exercise it directly via page.evaluate without rebuilding the DOM.
// =============================================================================

(function () {
  "use strict";

  var SEARCH_DEBOUNCE_MS = 150;

  var METHOD_OPTIONS = [
    { value: "all", label: "All" },
    { value: "filter", label: "Filter" },
    { value: "espresso", label: "Espresso" },
  ];

  var ROAST_OPTIONS = [
    { value: "all", label: "All" },
    { value: "light", label: "Light" },
    { value: "medium", label: "Medium" },
    { value: "dark", label: "Dark" },
  ];

  // Trays rendered as carousels under the hero (in this order). 'featured'
  // drives the hero, not a carousel. Unknown categories fall through to
  // 'classic' per partitionByCategory.
  var CAROUSEL_TRAYS = [
    {
      key: "original",
      title: "Cafelytic Originals",
      subtitle: "House recipes from the Cafelytic team",
    },
    {
      key: "roaster",
      title: "Roaster Recipes",
      subtitle: "Published water from specialty roasters",
    },
    {
      key: "classic",
      title: "Classic Formulas",
      subtitle: "Canonical references every coffee nerd knows",
    },
  ];

  function defaultFilters() {
    return { method: "all", roast: "all", tags: [], mine: false, q: "" };
  }

  function hasAnyActiveFilter(f) {
    return f.method !== "all" || f.roast !== "all" || f.tags.length > 0 || f.mine || f.q !== "";
  }

  // --- URL state ---------------------------------------------------------

  function readFiltersFromUrl() {
    var f = defaultFilters();
    var params;
    try {
      params = new URLSearchParams(window.location.search);
    } catch (e) {
      return f;
    }

    var method = params.get("method");
    if (method === "filter" || method === "espresso" || method === "all") f.method = method;

    var roast = params.get("roast");
    if (roast === "light" || roast === "medium" || roast === "dark" || roast === "all")
      f.roast = roast;

    var tags = params.get("tags");
    if (tags) {
      f.tags = tags
        .split(",")
        .map(function (t) {
          return t.trim();
        })
        .filter(Boolean);
    }

    f.mine = params.get("mine") === "1";

    var q = params.get("q");
    if (q) f.q = q;

    return f;
  }

  function writeFiltersToUrl(f) {
    var params = new URLSearchParams();
    if (f.method !== "all") params.set("method", f.method);
    if (f.roast !== "all") params.set("roast", f.roast);
    if (f.tags.length) params.set("tags", f.tags.join(","));
    if (f.mine) params.set("mine", "1");
    if (f.q) params.set("q", f.q);

    var qs = params.toString();
    var next = window.location.pathname + (qs ? "?" + qs : "") + window.location.hash;
    try {
      window.history.replaceState(null, "", next);
    } catch (e) {
      // replaceState throws in some sandbox contexts (e.g. file://). Swallow
      // so the filter UX still works; URL just won't reflect state there.
    }
  }

  // --- Pure predicate ----------------------------------------------------

  // Determine whether `recipe` passes the current `filters`. Kept pure so the
  // same function powers the D2 counter and the D5 render filter. `options.isSaved`
  // is a predicate invoked for the `mine` filter so callers can inject their
  // own saved-set (tests, future "saved view" features) without depending on
  // storage.js being loaded.
  function recipeMatches(recipe, filters, options) {
    if (!recipe) return false;

    // Method (hard filter). Recipe with brewMethod 'all' is accepted for any
    // non-default method filter — matches targetProfileSupportsBrewMethod
    // semantics shipped in Wave C.
    if (filters.method !== "all") {
      var rm = recipe.brewMethod || "filter";
      if (rm !== filters.method && rm !== "all") return false;
    }

    // Roast (hard filter). recipe.roast is an array (per library-data
    // normalizePublicRecipeRow). Recipe matches if the filter value is in
    // its array OR the array contains 'all'.
    if (filters.roast !== "all") {
      var roasts = Array.isArray(recipe.roast) ? recipe.roast : [];
      if (roasts.indexOf(filters.roast) === -1 && roasts.indexOf("all") === -1) return false;
    }

    // Flavor tags (soft filter, AND combination).
    if (filters.tags && filters.tags.length) {
      var recipeTags = Array.isArray(recipe.tags) ? recipe.tags : [];
      for (var i = 0; i < filters.tags.length; i++) {
        if (recipeTags.indexOf(filters.tags[i]) === -1) return false;
      }
    }

    // My Recipes.
    if (filters.mine) {
      var isSaved = options && typeof options.isSaved === "function" ? options.isSaved : null;
      if (!isSaved || !isSaved(recipe)) return false;
    }

    // Search (label / description / creatorDisplayName, case-insensitive
    // substring).
    if (filters.q) {
      var needle = String(filters.q).toLowerCase();
      var haystack = [recipe.label || "", recipe.description || "", recipe.creatorDisplayName || ""]
        .join(" ")
        .toLowerCase();
      if (haystack.indexOf(needle) === -1) return false;
    }

    return true;
  }

  function applyFilters(filters, recipes, options) {
    if (!Array.isArray(recipes)) return [];
    var merged = Object.assign({}, defaultFilters(), filters || {});
    return recipes.filter(function (r) {
      return recipeMatches(r, merged, options);
    });
  }

  // --- Bookmark round-trip ----------------------------------------------

  // Toggle the "in my profiles" state for a recipe. Works for both canonical
  // library rows (recipe.userId == null, toggled via tombstone) and user-
  // published rows (toggled via custom-profile add/delete by label match).
  // No-ops when storage.js helpers are unavailable. Returns the new saved
  // state.
  function toggleBookmark(recipe) {
    if (!recipe) return false;
    var wasSaved = typeof isRecipeInMyProfiles === "function" && isRecipeInMyProfiles(recipe);

    if (!wasSaved) {
      if (typeof copyRecipeToMyProfiles === "function") copyRecipeToMyProfiles(recipe);
      return true;
    }

    // Unsave path.
    if (recipe.userId == null && recipe.slug) {
      // Canonical library row (userId null per the 002/006/007 migrations).
      // Re-tombstone at the canonical slug so the re-add flow can later lift
      // it — matches the round-trip semantics in copyRecipeToMyProfiles.
      if (typeof addDeletedTargetPreset === "function") addDeletedTargetPreset(recipe.slug);
    } else if (
      typeof loadCustomTargetProfiles === "function" &&
      typeof deleteCustomTargetProfile === "function"
    ) {
      // User-published row — remove the custom profile that matches by label.
      // Same identity heuristic used by isRecipeInMyProfiles.
      var profiles = loadCustomTargetProfiles();
      var target = String(recipe.label || "").toLowerCase();
      for (var key in profiles) {
        if (
          Object.prototype.hasOwnProperty.call(profiles, key) &&
          String(profiles[key].label || "").toLowerCase() === target
        ) {
          deleteCustomTargetProfile(key);
          break;
        }
      }
    }
    return false;
  }

  // --- DOM helpers -------------------------------------------------------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function formatMethodRoast(recipe) {
    var method = recipe.brewMethod || "filter";
    var methodLabel = method === "all" ? "filter · espresso" : method;

    var roasts = Array.isArray(recipe.roast) ? recipe.roast : [];
    var roastLabel;
    if (roasts.length === 0 || roasts.indexOf("all") !== -1) {
      roastLabel = "any roast";
    } else {
      roastLabel = roasts.join(", ");
    }
    return methodLabel + " · " + roastLabel;
  }

  function createMineralTriplet(recipe, extraClass) {
    var wrap = el("div", "rx-mineral-triplet" + (extraClass ? " " + extraClass : ""));
    [
      { field: "calcium", label: "Ca" },
      { field: "magnesium", label: "Mg" },
      { field: "alkalinity", label: "Alk" },
    ].forEach(function (pair) {
      var item = el("span", "rx-mineral-item");
      item.appendChild(el("span", "rx-mineral-label", pair.label));
      item.appendChild(
        el(
          "span",
          "rx-mineral-value",
          recipe[pair.field] != null ? String(recipe[pair.field]) : "—",
        ),
      );
      wrap.appendChild(item);
    });
    return wrap;
  }

  function createSegmentedRow(labelText, options, getValue, onChange) {
    var row = el("div", "rx-filter-row");
    row.appendChild(el("div", "rx-filter-row-label", labelText));
    var group = el("div", "rx-segmented");
    var buttons = [];
    options.forEach(function (opt) {
      var btn = el("button", "rx-segmented-button", opt.label);
      btn.type = "button";
      btn.dataset.value = opt.value;
      btn.addEventListener("click", function () {
        onChange(opt.value);
      });
      group.appendChild(btn);
      buttons.push(btn);
    });
    row.appendChild(group);

    function sync() {
      var current = getValue();
      buttons.forEach(function (b) {
        b.classList.toggle("is-active", b.dataset.value === current);
      });
    }

    return { row: row, sync: sync };
  }

  function createFlavorRow(getTags, getMine, onToggleTag, onToggleMine) {
    var row = el("div", "rx-filter-row rx-filter-row-divided");
    row.appendChild(el("div", "rx-filter-row-label", "Flavor"));
    var group = el("div", "rx-chip-group");

    var myChip = el("button", "rx-chip rx-chip-my-recipes", "My Recipes");
    myChip.type = "button";
    myChip.addEventListener("click", onToggleMine);
    group.appendChild(myChip);

    var tagList =
      typeof LIBRARY_TAGS !== "undefined" && Array.isArray(LIBRARY_TAGS) ? LIBRARY_TAGS : [];
    var tagChips = [];
    tagList.forEach(function (tag) {
      var chip = el("button", "rx-chip", tag);
      chip.type = "button";
      chip.dataset.tag = tag;
      chip.addEventListener("click", function () {
        onToggleTag(tag);
      });
      group.appendChild(chip);
      tagChips.push(chip);
    });

    row.appendChild(group);

    function sync() {
      var active = getTags();
      tagChips.forEach(function (chip) {
        chip.classList.toggle("is-active", active.indexOf(chip.dataset.tag) !== -1);
      });
      myChip.classList.toggle("is-active", getMine());
    }

    return { row: row, sync: sync };
  }

  function createSearchSection(getQ, onInput) {
    var section = el("div", "rx-search");
    var input = el("input", "rx-search-input");
    input.type = "search";
    input.placeholder = "Search recipes…";
    input.autocomplete = "off";
    input.value = getQ();
    input.addEventListener("input", function () {
      onInput(input.value);
    });
    section.appendChild(input);

    function sync() {
      if (input.value !== getQ()) input.value = getQ();
    }

    return { section: section, sync: sync, input: input };
  }

  function createFilterSummary(onClear) {
    var summary = el("div", "rx-filter-summary");
    var count = el("span", "rx-result-count", "");
    var clear = el("button", "rx-clear-filters", "Clear filters");
    clear.type = "button";
    clear.addEventListener("click", onClear);
    summary.appendChild(count);
    summary.appendChild(clear);

    function sync(matched, total, anyActive) {
      count.textContent = matched + " of " + total + " recipes";
      clear.hidden = !anyActive;
    }

    return { summary: summary, sync: sync };
  }

  // --- Recipe card / hero / carousel (D3 + D4) --------------------------

  function createRecipeCard(recipe, handlers) {
    var card = el("article", "rx-recipe-card");
    card.dataset.slug = recipe.slug || "";

    // Header: title + source + bookmark
    var header = el("div", "rx-card-header");
    var titleCol = el("div", "rx-card-title-col");
    titleCol.appendChild(el("h3", "rx-card-title", recipe.label || ""));
    if (recipe.creatorDisplayName) {
      titleCol.appendChild(el("p", "rx-card-source", "by " + recipe.creatorDisplayName));
    }
    header.appendChild(titleCol);

    var bookmark = el("button", "rx-card-bookmark");
    bookmark.type = "button";
    bookmark.setAttribute("aria-label", handlers.saved ? "Unsave recipe" : "Save recipe");
    bookmark.setAttribute("aria-pressed", handlers.saved ? "true" : "false");
    bookmark.textContent = handlers.saved ? "★" : "☆";
    if (handlers.saved) bookmark.classList.add("is-active");
    bookmark.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      handlers.onToggleSave(recipe);
    });
    header.appendChild(bookmark);
    card.appendChild(header);

    // Mineral triplet
    card.appendChild(createMineralTriplet(recipe));

    // Description (2-line clamp via CSS -webkit-line-clamp)
    if (recipe.description) {
      card.appendChild(el("p", "rx-card-desc", recipe.description));
    }

    // Footer: tag chips (left) + method/roast meta (right)
    var footer = el("div", "rx-card-footer");
    var tagList = el("div", "rx-card-tags");
    (Array.isArray(recipe.tags) ? recipe.tags : []).forEach(function (tag) {
      tagList.appendChild(el("span", "rx-card-tag", tag));
    });
    footer.appendChild(tagList);
    footer.appendChild(el("span", "rx-card-meta", formatMethodRoast(recipe)));
    card.appendChild(footer);

    return card;
  }

  function createFeaturedHero(recipe, handlers) {
    var section = el("section", "rx-featured-hero");
    section.dataset.slug = recipe.slug || "";

    section.appendChild(el("div", "rx-hero-eyebrow", "Featured · Editor's pick"));

    var row = el("div", "rx-hero-row");

    var content = el("div", "rx-hero-content");
    content.appendChild(el("h2", "rx-hero-title", recipe.label || ""));
    if (recipe.creatorDisplayName) {
      content.appendChild(el("p", "rx-hero-source", "by " + recipe.creatorDisplayName));
    }
    content.appendChild(createMineralTriplet(recipe, "rx-mineral-triplet-hero"));
    if (recipe.description) {
      content.appendChild(el("p", "rx-hero-desc", recipe.description));
    }

    var tagList = el("div", "rx-hero-tags");
    (Array.isArray(recipe.tags) ? recipe.tags : []).forEach(function (tag) {
      tagList.appendChild(el("span", "rx-card-tag rx-card-tag-accent", tag));
    });
    if (tagList.firstChild) content.appendChild(tagList);

    row.appendChild(content);

    var ctas = el("div", "rx-hero-ctas");

    var useBtn = el("button", "rx-hero-use", "Use this recipe");
    useBtn.type = "button";
    useBtn.addEventListener("click", function () {
      handlers.onUseRecipe(recipe);
    });
    ctas.appendChild(useBtn);

    var saveBtn = el("button", "rx-hero-save", handlers.saved ? "Saved" : "Save");
    saveBtn.type = "button";
    saveBtn.setAttribute("aria-pressed", handlers.saved ? "true" : "false");
    if (handlers.saved) saveBtn.classList.add("is-active");
    saveBtn.addEventListener("click", function () {
      handlers.onToggleSave(recipe);
    });
    ctas.appendChild(saveBtn);

    row.appendChild(ctas);
    section.appendChild(row);

    return section;
  }

  function createTrayCarousel(title, subtitle, recipes, handlers) {
    if (!recipes || recipes.length === 0) return null;

    var section = el("section", "rx-carousel-section");
    section.dataset.tray = handlers.trayKey || "";

    var heading = el("div", "rx-carousel-heading");
    var titleCol = el("div", "rx-carousel-heading-text");
    titleCol.appendChild(el("h2", "rx-carousel-title", title));
    if (subtitle) titleCol.appendChild(el("p", "rx-carousel-subtitle", subtitle));
    heading.appendChild(titleCol);

    // Chevrons — visible only on desktop via CSS. Scroll the carousel
    // container by one card-width on click.
    var chevrons = el("div", "rx-carousel-chevrons");
    var scrollEl = el("div", "rx-carousel");

    function makeChevron(direction, label, symbol) {
      var btn = el("button", "rx-chevron rx-chevron-" + direction, symbol);
      btn.type = "button";
      btn.setAttribute("aria-label", label);
      btn.addEventListener("click", function () {
        scrollEl.scrollBy({ left: direction === "prev" ? -320 : 320, behavior: "smooth" });
      });
      return btn;
    }
    chevrons.appendChild(makeChevron("prev", "Scroll " + title + " left", "‹"));
    chevrons.appendChild(makeChevron("next", "Scroll " + title + " right", "›"));
    heading.appendChild(chevrons);

    section.appendChild(heading);

    recipes.forEach(function (recipe) {
      scrollEl.appendChild(
        createRecipeCard(recipe, {
          saved: handlers.isSaved(recipe),
          onToggleSave: handlers.onToggleSave,
        }),
      );
    });
    section.appendChild(scrollEl);

    return section;
  }

  // --- Content layout ----------------------------------------------------

  function partitionByCategory(recipes) {
    var out = { featured: [], original: [], roaster: [], classic: [] };
    if (!Array.isArray(recipes)) return out;
    recipes.forEach(function (r) {
      var cat = r && r.category ? r.category : "classic";
      if (!Object.prototype.hasOwnProperty.call(out, cat)) cat = "classic";
      out[cat].push(r);
    });
    return out;
  }

  function renderContent(root, recipes, handlers) {
    while (root.firstChild) root.removeChild(root.firstChild);

    if (!Array.isArray(recipes) || recipes.length === 0) {
      // Cold load before library fetch resolves. onLibraryDataLoaded will
      // re-render once rows arrive.
      return;
    }

    var byCategory = partitionByCategory(recipes);

    if (byCategory.featured.length > 0) {
      // Spec: "zero or one recipe at a time" in the featured tray. If data
      // ever drifts and includes multiple, we render the first and ignore
      // the rest rather than failing.
      root.appendChild(createFeaturedHero(byCategory.featured[0], handlers));
    }

    CAROUSEL_TRAYS.forEach(function (tray) {
      var carouselHandlers = Object.assign({}, handlers, { trayKey: tray.key });
      var carousel = createTrayCarousel(
        tray.title,
        tray.subtitle,
        byCategory[tray.key],
        carouselHandlers,
      );
      if (carousel) root.appendChild(carousel);
    });
  }

  // --- Mount -------------------------------------------------------------

  function mountRecipeBrowser(root) {
    if (!root) return;

    while (root.firstChild) root.removeChild(root.firstChild);

    var state = readFiltersFromUrl();
    var allRecipes =
      typeof window.getPublicRecipesSync === "function" ? window.getPublicRecipesSync() : [];

    var page = el("div", "rx-page");

    var searchSection = createSearchSection(function () {
      return state.q;
    }, handleSearchInput);
    page.appendChild(searchSection.section);

    var filterBar = el("section", "rx-filter-bar");
    var methodRow = createSegmentedRow(
      "Method",
      METHOD_OPTIONS,
      function () {
        return state.method;
      },
      function (v) {
        state.method = v;
        commit();
      },
    );
    filterBar.appendChild(methodRow.row);

    var roastRow = createSegmentedRow(
      "Roast",
      ROAST_OPTIONS,
      function () {
        return state.roast;
      },
      function (v) {
        state.roast = v;
        commit();
      },
    );
    filterBar.appendChild(roastRow.row);

    var flavorRow = createFlavorRow(
      function () {
        return state.tags;
      },
      function () {
        return state.mine;
      },
      function (tag) {
        var idx = state.tags.indexOf(tag);
        if (idx === -1) state.tags = state.tags.concat([tag]);
        else state.tags = state.tags.slice(0, idx).concat(state.tags.slice(idx + 1));
        commit();
      },
      function () {
        state.mine = !state.mine;
        commit();
      },
    );
    filterBar.appendChild(flavorRow.row);

    page.appendChild(filterBar);

    var summary = createFilterSummary(function () {
      state = defaultFilters();
      searchSection.input.value = "";
      commit();
    });
    page.appendChild(summary.summary);

    var contentRoot = el("div", "rx-content");
    page.appendChild(contentRoot);

    root.appendChild(page);

    // --- Content handlers ---------------------------------------------

    var contentHandlers = {
      isSaved: function (recipe) {
        return typeof isRecipeInMyProfiles === "function" && isRecipeInMyProfiles(recipe);
      },
      onToggleSave: function (recipe) {
        toggleBookmark(recipe);
        // Full re-render of the content region so every surface (hero + any
        // carousel card) reflects the new saved state. Cheap at 30 cards;
        // revisit if the catalog grows past ~200.
        renderContent(contentRoot, allRecipes, contentHandlers);
      },
      onUseRecipe: function (recipe) {
        var params = new URLSearchParams();
        if (recipe.slug) params.set("preset", recipe.slug);
        if (recipe.brewMethod === "filter" || recipe.brewMethod === "espresso") {
          params.set("method", recipe.brewMethod);
        }
        var qs = params.toString();
        window.location.href = "taste.html" + (qs ? "?" + qs : "");
      },
    };

    // --- State wiring --------------------------------------------------

    var searchTimer = null;

    function handleSearchInput(value) {
      state.q = value;
      if (searchTimer) window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(function () {
        searchTimer = null;
        commit();
      }, SEARCH_DEBOUNCE_MS);
    }

    function commit() {
      writeFiltersToUrl(state);
      render();
    }

    function render() {
      methodRow.sync();
      roastRow.sync();
      flavorRow.sync();
      searchSection.sync();

      var isSaved =
        typeof window.isRecipeInMyProfiles === "function" ? window.isRecipeInMyProfiles : null;
      var matched = applyFilters(state, allRecipes, { isSaved: isSaved }).length;
      summary.sync(matched, allRecipes.length, hasAnyActiveFilter(state));
    }

    // Re-render when async library fetch completes. library-data.js auto-
    // fetches on load for pages with supabaseClient; we just subscribe.
    if (typeof window.onLibraryDataLoaded === "function") {
      window.onLibraryDataLoaded(function (recipes) {
        allRecipes = Array.isArray(recipes) ? recipes : [];
        render();
        renderContent(contentRoot, allRecipes, contentHandlers);
      });
    }

    // Handle browser back/forward restoring previous query strings.
    window.addEventListener("popstate", function () {
      state = readFiltersFromUrl();
      searchSection.input.value = state.q;
      render();
    });

    render();
    renderContent(contentRoot, allRecipes, contentHandlers);
  }

  // --- Exports -----------------------------------------------------------

  window.mountRecipeBrowser = mountRecipeBrowser;
  // Exposed for e2e coverage — see smoke-library-v2.spec.ts applyFilters cases.
  window.applyFilters = applyFilters;
  window.readFiltersFromUrl = readFiltersFromUrl;
  window.writeFiltersToUrl = writeFiltersToUrl;
})();
