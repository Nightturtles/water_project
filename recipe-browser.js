// =============================================================================
// recipe-browser.js — Wave D recipe browser (mounted by library-v2.html).
//
// D2 scope: interactive filter bar. Method / Roast segmented controls, Flavor
// chip toggles, My Recipes toggle, debounced search. Filter state mirrors to
// the URL (replaceState) and drives a match counter over the cached library.
//
// No recipe rendering yet — the counter is the only output surface. Recipe
// card + carousel + hero land in D3/D4; filter wiring into the rendered view
// lands in D5.
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
    if (roast === "light" || roast === "medium" || roast === "dark" || roast === "all") f.roast = roast;

    var tags = params.get("tags");
    if (tags) {
      f.tags = tags.split(",").map(function (t) { return t.trim(); }).filter(Boolean);
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
      var haystack = [
        recipe.label || "",
        recipe.description || "",
        recipe.creatorDisplayName || "",
      ].join(" ").toLowerCase();
      if (haystack.indexOf(needle) === -1) return false;
    }

    return true;
  }

  function applyFilters(filters, recipes, options) {
    if (!Array.isArray(recipes)) return [];
    var merged = Object.assign({}, defaultFilters(), filters || {});
    return recipes.filter(function (r) { return recipeMatches(r, merged, options); });
  }

  // --- DOM helpers -------------------------------------------------------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
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
      btn.addEventListener("click", function () { onChange(opt.value); });
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

    var tagList = (typeof LIBRARY_TAGS !== "undefined" && Array.isArray(LIBRARY_TAGS))
      ? LIBRARY_TAGS
      : [];
    var tagChips = [];
    tagList.forEach(function (tag) {
      var chip = el("button", "rx-chip", tag);
      chip.type = "button";
      chip.dataset.tag = tag;
      chip.addEventListener("click", function () { onToggleTag(tag); });
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
    input.addEventListener("input", function () { onInput(input.value); });
    section.appendChild(input);

    function sync() {
      // Only rewrite input value if it drifted from state (e.g. programmatic
      // clear). Avoids bouncing focus/caret during live typing.
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

  // --- Mount -------------------------------------------------------------

  function mountRecipeBrowser(root) {
    if (!root) return;

    while (root.firstChild) root.removeChild(root.firstChild);

    var state = readFiltersFromUrl();
    var allRecipes = (typeof window.getPublicRecipesSync === "function")
      ? window.getPublicRecipesSync()
      : [];

    var page = el("div", "rx-page");

    var searchSection = createSearchSection(
      function () { return state.q; },
      handleSearchInput
    );
    page.appendChild(searchSection.section);

    var filterBar = el("section", "rx-filter-bar");
    var methodRow = createSegmentedRow(
      "Method",
      METHOD_OPTIONS,
      function () { return state.method; },
      function (v) { state.method = v; commit(); }
    );
    filterBar.appendChild(methodRow.row);

    var roastRow = createSegmentedRow(
      "Roast",
      ROAST_OPTIONS,
      function () { return state.roast; },
      function (v) { state.roast = v; commit(); }
    );
    filterBar.appendChild(roastRow.row);

    var flavorRow = createFlavorRow(
      function () { return state.tags; },
      function () { return state.mine; },
      function (tag) {
        var idx = state.tags.indexOf(tag);
        if (idx === -1) state.tags = state.tags.concat([tag]);
        else state.tags = state.tags.slice(0, idx).concat(state.tags.slice(idx + 1));
        commit();
      },
      function () { state.mine = !state.mine; commit(); }
    );
    filterBar.appendChild(flavorRow.row);

    page.appendChild(filterBar);

    var summary = createFilterSummary(function () {
      state = defaultFilters();
      searchSection.input.value = "";
      commit();
    });
    page.appendChild(summary.summary);

    page.appendChild(el("div", "rx-content"));

    root.appendChild(page);

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

      var isSaved = typeof window.isRecipeInMyProfiles === "function"
        ? window.isRecipeInMyProfiles
        : null;
      var matched = applyFilters(state, allRecipes, { isSaved: isSaved }).length;
      summary.sync(matched, allRecipes.length, hasAnyActiveFilter(state));
    }

    // Re-render when async library fetch completes. library-data.js auto-
    // fetches on load for pages with supabaseClient; we just subscribe.
    if (typeof window.onLibraryDataLoaded === "function") {
      window.onLibraryDataLoaded(function (recipes) {
        allRecipes = Array.isArray(recipes) ? recipes : [];
        render();
      });
    }

    // Handle browser back/forward restoring previous query strings.
    window.addEventListener("popstate", function () {
      state = readFiltersFromUrl();
      searchSection.input.value = state.q;
      render();
    });

    render();
  }

  // --- Exports -----------------------------------------------------------

  window.mountRecipeBrowser = mountRecipeBrowser;
  // Exposed for e2e coverage — see smoke-library-v2.spec.ts applyFilters cases.
  window.applyFilters = applyFilters;
  window.readFiltersFromUrl = readFiltersFromUrl;
  window.writeFiltersToUrl = writeFiltersToUrl;
})();
