// =============================================================================
// library-picker.js — Modal picker that adds a Recipe Library entry to the
// user's preset rail without leaving the current page.
//
// Used by index.html (Target Water Profile) and taste.html (Current Water
// Profile). Both sections are target-style profiles; library rows from
// fetchPublicRecipes() map 1:1 onto either rail via copyRecipeToMyProfiles().
//
// Mirrors the library page's discovery experience: search input, method /
// roast / tag filters (no "My Recipes" — would not make sense in an
// add-from-library flow), and collapsible sections drawn from the same
// LIBRARY_TRAYS source of truth as the carousels on library.html.
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

  var pickerCleanup = null;

  function getOverlay() {
    return document.getElementById("library-picker-overlay");
  }

  function brewMethodLabel(m) {
    return m === "espresso" ? "Espresso" : "Filter";
  }

  function creatorLine(recipe) {
    if (recipe.userId == null) return "Cafelytic";
    return recipe.creatorDisplayName || "Community";
  }

  function ionsSummary(recipe) {
    var ca = Math.round(Number(recipe.calcium) || 0);
    var mg = Math.round(Number(recipe.magnesium) || 0);
    var alk = Math.round(Number(recipe.alkalinity) || 0);
    return "Ca " + ca + " · Mg " + mg + " · Alk " + alk;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function buildCard(recipe, extraClass) {
    var card = el("div", "library-picker-card" + (extraClass ? " " + extraClass : ""));
    card.dataset.recipeId = recipe.id;

    var info = el("div", "library-picker-card-info");
    info.appendChild(el("div", "library-picker-card-title", recipe.label));
    info.appendChild(
      el("div", "library-picker-card-meta", creatorLine(recipe) + " · " + brewMethodLabel(recipe.brewMethod)),
    );
    info.appendChild(el("div", "library-picker-card-ions", ionsSummary(recipe)));
    card.appendChild(info);

    var action = el("button", "preset-btn library-picker-card-action");
    action.type = "button";
    var alreadyAdded =
      typeof window.isRecipeInMyProfiles === "function" && window.isRecipeInMyProfiles(recipe);
    if (alreadyAdded) {
      action.textContent = "Added";
      action.disabled = true;
      action.classList.add("library-picker-card-action--added");
    } else {
      action.textContent = "Add";
      action.dataset.addRecipeId = recipe.id;
    }
    card.appendChild(action);

    return card;
  }

  function buildSegmentedRow(labelText, options, currentValue, dataKey) {
    var row = el("div", "rx-filter-row library-picker-filter-row");
    row.appendChild(el("div", "rx-filter-row-label", labelText));
    var group = el("div", "rx-segmented");
    options.forEach(function (opt) {
      var btn = el("button", "rx-segmented-button", opt.label);
      btn.type = "button";
      btn.dataset[dataKey] = opt.value;
      if (opt.value === currentValue) btn.classList.add("is-active");
      group.appendChild(btn);
    });
    row.appendChild(group);
    return row;
  }

  function buildTagsRow(tagList, activeTags) {
    var row = el("div", "rx-filter-row library-picker-filter-row");
    row.appendChild(el("div", "rx-filter-row-label", "Flavor"));
    var group = el("div", "rx-chip-group");
    tagList.forEach(function (tag) {
      var chip = el("button", "rx-chip", tag);
      chip.type = "button";
      chip.dataset.tag = tag;
      if (activeTags.indexOf(tag) !== -1) chip.classList.add("is-active");
      group.appendChild(chip);
    });
    row.appendChild(group);
    return row;
  }

  // Public entry: open the picker. options:
  //   brewMethod: "filter" | "espresso" — initial method filter (the user can
  //               relax it to "all" or switch within the modal). Required.
  //   onAdd:     function(slug, recipe) — fires after copyRecipeToMyProfiles
  //              succeeds. The host page should re-render its preset rail
  //              and activate the slug. Required.
  //   title:     optional override for the dialog heading.
  function showLibraryPicker(options) {
    options = options || {};
    var initialMethod = options.brewMethod === "espresso" ? "espresso" : "filter";
    var onAdd = typeof options.onAdd === "function" ? options.onAdd : function () {};
    var title = options.title || "Add From Library";

    var overlay = getOverlay();
    if (!overlay) {
      console.warn("[library-picker] overlay element missing on this page");
      return;
    }

    if (pickerCleanup) pickerCleanup();

    var dialog = overlay.querySelector(".library-picker-dialog");
    var titleEl = overlay.querySelector(".library-picker-title");
    var listEl = overlay.querySelector(".library-picker-list");
    var closeBtn = overlay.querySelector(".library-picker-close");
    if (!dialog || !titleEl || !listEl || !closeBtn) {
      console.warn("[library-picker] dialog markup incomplete on this page");
      return;
    }
    var previousFocus = document.activeElement;

    titleEl.textContent = title;

    // Filter state — reset to open-time defaults each time the modal opens.
    // The modal does NOT participate in URL state (the library page owns ?q=
    // etc.); keeping state in this closure means the user sees a clean slate
    // every open and the URL never reflects modal-only filters.
    var state = {
      method: initialMethod,
      roast: "all",
      tags: [],
      q: "",
    };
    var collapsedSections = new Set();
    var searchDebounce = null;
    var searchInputEl = null;

    var tagList = (typeof LIBRARY_TAGS !== "undefined" && Array.isArray(LIBRARY_TAGS))
      ? LIBRARY_TAGS
      : [];

    // ---- Render scaffold (one-time per open) -------------------------------

    listEl.innerHTML = "";

    var searchSection = el("div", "library-picker-search");
    var searchInput = el("input", "rx-search-input library-picker-search-input");
    searchInput.type = "search";
    searchInput.placeholder = "Search recipes…";
    searchInput.autocomplete = "off";
    searchSection.appendChild(searchInput);
    searchInputEl = searchInput;
    listEl.appendChild(searchSection);

    var filtersWrap = el("div", "library-picker-filters");
    listEl.appendChild(filtersWrap);

    var resultsWrap = el("div", "library-picker-results");
    listEl.appendChild(resultsWrap);

    function renderFilters() {
      filtersWrap.innerHTML = "";
      filtersWrap.appendChild(buildSegmentedRow("Method", METHOD_OPTIONS, state.method, "method"));
      filtersWrap.appendChild(buildSegmentedRow("Roast", ROAST_OPTIONS, state.roast, "roast"));
      if (tagList.length) {
        filtersWrap.appendChild(buildTagsRow(tagList, state.tags));
      }
    }

    function resetState() {
      state.method = initialMethod;
      state.roast = "all";
      state.tags = [];
      state.q = "";
      if (searchInputEl) searchInputEl.value = "";
      collapsedSections.clear();
    }

    function renderResults() {
      resultsWrap.innerHTML = "";

      var allRecipes =
        typeof window.getPublicRecipesSync === "function" ? window.getPublicRecipesSync() : [];

      // The library catalog is empty until the async fetch resolves (or has
      // failed). Distinguish "fetching" from "fetched-but-empty" so the user
      // sees a loading message rather than a no-matches state on cold open.
      if ((!allRecipes || allRecipes.length === 0) && !catalogLoaded) {
        var loading = el("p", "library-picker-empty", "Loading library…");
        resultsWrap.appendChild(loading);
        return;
      }

      var filtered = typeof window.applyFilters === "function"
        ? window.applyFilters(state, allRecipes)
        : allRecipes;

      // Empty state — surface "Clear filters" only when something is filtered.
      if (!filtered || filtered.length === 0) {
        var emptyWrap = el("div", "library-picker-empty-wrap");
        emptyWrap.appendChild(el("p", "library-picker-empty", "No recipes match."));
        var anyActive = typeof window.hasAnyActiveFilter === "function"
          ? window.hasAnyActiveFilter(state)
          : false;
        if (anyActive) {
          var clearBtn = el("button", "library-picker-clear-filters", "Clear filters");
          clearBtn.type = "button";
          clearBtn.dataset.action = "clear-filters";
          emptyWrap.appendChild(clearBtn);
        }
        resultsWrap.appendChild(emptyWrap);
        return;
      }

      // Featured: pinned at top (non-collapsible). Use the doubly-filtered
      // set so the pinned card respects the active search/filter state.
      var featured = typeof window.pickFeaturedFromFiltered === "function"
        ? window.pickFeaturedFromFiltered(filtered, state.method)
        : null;
      if (featured) {
        resultsWrap.appendChild(buildCard(featured, "library-picker-card--featured"));
      }

      // Sections: iterate LIBRARY_TRAYS so order is canonical. Sections with
      // 0 recipes are skipped entirely (no empty headers).
      var trays = Array.isArray(window.LIBRARY_TRAYS) ? window.LIBRARY_TRAYS : [];
      var byCategory = typeof window.partitionByCategory === "function"
        ? window.partitionByCategory(filtered)
        : {};

      var searchActive = state.q !== "";

      trays.forEach(function (tray) {
        var bucket = byCategory[tray.key] || [];
        if (bucket.length === 0) return;

        var section = el("section", "library-picker-section");

        var contentId = "lp-section-" + tray.key;
        // While search is active, force-expand every section so users see why
        // their query matched. Otherwise respect user collapse state.
        var expanded = searchActive ? true : !collapsedSections.has(tray.key);

        var summary = el("button", "card-collapsible-summary library-picker-section-summary");
        summary.type = "button";
        summary.setAttribute("aria-expanded", expanded ? "true" : "false");
        summary.setAttribute("aria-controls", contentId);
        summary.dataset.sectionKey = tray.key;

        var titleSpan = el("span", "card-collapsible-title");
        titleSpan.appendChild(document.createTextNode(tray.title + " "));
        titleSpan.appendChild(el("span", "library-picker-section-count", "(" + bucket.length + ")"));
        summary.appendChild(titleSpan);

        var content = el("div", "card-collapsible-content library-picker-section-content");
        content.id = contentId;
        bucket.forEach(function (recipe) {
          content.appendChild(buildCard(recipe));
        });

        section.appendChild(summary);
        section.appendChild(content);
        resultsWrap.appendChild(section);
      });
    }

    function render() {
      renderFilters();
      renderResults();
    }

    // ---- Catalog: cached snapshot first, live fetch updates -----------------

    var catalogLoaded = false;
    var initial =
      typeof window.getPublicRecipesSync === "function" ? window.getPublicRecipesSync() : [];
    if (initial && initial.length) {
      catalogLoaded = true;
    }
    render();

    overlay.style.display = "flex";
    // Auto-focus the search input — better UX given the new affordance.
    searchInput.focus();

    if (typeof window.fetchPublicRecipes === "function") {
      window
        .fetchPublicRecipes(false)
        .then(function () {
          // Stale resolution: picker was closed (or reopened, which closes
          // the prior session first via pickerCleanup()) before the fetch
          // settled — don't overwrite the new session's render.
          if (pickerCleanup !== close) return;
          catalogLoaded = true;
          renderResults();
        })
        .catch(function (e) {
          if (pickerCleanup !== close) return;
          catalogLoaded = true; // surface "no recipes match" rather than an infinite loading state
          console.warn("[library-picker] fetch failed:", e);
          renderResults();
        });
    }

    // Note: this modal does NOT subscribe to cw:cloud-data-changed. If a
    // sync event lands while the modal is open, "Added" badges go stale
    // until close+reopen. recipe-browser.js does subscribe, but the modal
    // is short-lived enough that adding the subscription wasn't worth the
    // scope. Worth revisiting if users hit this in practice.

    // ---- Event handlers -----------------------------------------------------

    function onSearchInput() {
      if (searchDebounce) clearTimeout(searchDebounce);
      searchDebounce = setTimeout(function () {
        searchDebounce = null;
        if (state.q === searchInput.value) return;
        state.q = searchInput.value;
        renderResults();
      }, SEARCH_DEBOUNCE_MS);
    }

    function onFiltersClick(e) {
      var methodBtn = e.target.closest("[data-method]");
      if (methodBtn) {
        state.method = methodBtn.dataset.method;
        render();
        return;
      }
      var roastBtn = e.target.closest("[data-roast]");
      if (roastBtn) {
        state.roast = roastBtn.dataset.roast;
        render();
        return;
      }
      var tagBtn = e.target.closest("[data-tag]");
      if (tagBtn) {
        var tag = tagBtn.dataset.tag;
        var idx = state.tags.indexOf(tag);
        if (idx === -1) state.tags.push(tag);
        else state.tags.splice(idx, 1);
        render();
        return;
      }
    }

    function onResultsClick(e) {
      var clearBtn = e.target.closest('[data-action="clear-filters"]');
      if (clearBtn) {
        resetState();
        render();
        return;
      }

      var sectionSummary = e.target.closest(".library-picker-section-summary");
      if (sectionSummary) {
        // Suppress collapse toggle while search is active — sections are
        // force-expanded so the user can see all matches.
        if (state.q !== "") return;
        var key = sectionSummary.dataset.sectionKey;
        if (!key) return;
        if (collapsedSections.has(key)) {
          collapsedSections.delete(key);
          sectionSummary.setAttribute("aria-expanded", "true");
        } else {
          collapsedSections.add(key);
          sectionSummary.setAttribute("aria-expanded", "false");
        }
        return;
      }

      var actionBtn = e.target.closest("[data-add-recipe-id]");
      if (actionBtn) {
        var id = actionBtn.dataset.addRecipeId;
        var recipes =
          (typeof window.getPublicRecipesSync === "function" ? window.getPublicRecipesSync() : []) ||
          [];
        var recipe = null;
        for (var i = 0; i < recipes.length; i++) {
          if (String(recipes[i].id) === String(id)) {
            recipe = recipes[i];
            break;
          }
        }
        if (!recipe) return;
        if (typeof window.copyRecipeToMyProfiles !== "function") return;
        var slug = window.copyRecipeToMyProfiles(recipe);
        if (!slug) return;
        close();
        onAdd(slug, recipe);
      }
    }

    function close() {
      overlay.style.display = "none";
      overlay.removeEventListener("click", overlayClick);
      filtersWrap.removeEventListener("click", onFiltersClick);
      resultsWrap.removeEventListener("click", onResultsClick);
      searchInput.removeEventListener("input", onSearchInput);
      closeBtn.removeEventListener("click", close);
      document.removeEventListener("keydown", keyHandler);
      if (searchDebounce) {
        clearTimeout(searchDebounce);
        searchDebounce = null;
      }
      pickerCleanup = null;
      if (previousFocus && previousFocus.focus) previousFocus.focus();
    }

    function overlayClick(e) {
      if (e.target === overlay) close();
    }

    function keyHandler(e) {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab") return;
      // Focus trap: cycle within the dialog. Build the list fresh so newly
      // rendered cards from the async fetch are included. Filter by
      // visibility — buttons inside collapsed sections (display:none via the
      // card-collapsible sibling selector) shouldn't be in the Tab cycle.
      var raw = dialog.querySelectorAll(
        "button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      );
      var focusables = [];
      for (var i = 0; i < raw.length; i++) {
        if (raw[i].offsetParent !== null) focusables.push(raw[i]);
      }
      if (focusables.length === 0) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    pickerCleanup = close;
    overlay.addEventListener("click", overlayClick);
    filtersWrap.addEventListener("click", onFiltersClick);
    resultsWrap.addEventListener("click", onResultsClick);
    searchInput.addEventListener("input", onSearchInput);
    closeBtn.addEventListener("click", close);
    document.addEventListener("keydown", keyHandler);
  }

  window.showLibraryPicker = showLibraryPicker;
})();
