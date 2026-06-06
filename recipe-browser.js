// =============================================================================
// recipe-browser.js — Wave D recipe browser (mounted by library.html).
//
// D2 shipped the interactive filter bar + URL state + applyFilters predicate.
// D3 added the recipe card component, D4 added the featured hero and tray
// carousels. D5 wires filters into the rendered hero/carousels (so filter
// toggles actually narrow what's shown, not just the counter), adds the
// empty-state UI, and cuts over v2 → library.html.
//
// The filter predicate (`applyFilters`), section taxonomy (`LIBRARY_TRAYS`),
// and partition/featured helpers were moved to library-data.js so the Add
// From Library modal can share them. They're still exposed on `window` (by
// library-data.js) so e2e tests reach them via page.evaluate unchanged.
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

  // Featured recipe is picked client-side by brew-method filter. When the
  // method filter excludes the primary pick, the espresso branch keeps the
  // Featured slot populated instead of letting it disappear. Slugs must
  // match canonical library rows (user_id IS NULL); if the slug isn't in
  // the filtered set (e.g. roast filter also excludes it), the Featured
  // hero is omitted rather than rendering an empty section.
  // Section taxonomy + filter predicates moved to library-data.js so the
  // Add From Library modal (library-picker.js) can share the same source of
  // truth — adding a tray to LIBRARY_TRAYS over there flows through to both
  // the carousels here and the modal automatically.
  var FEATURED_PICKS = window.FEATURED_PICKS;
  var CAROUSEL_TRAYS = window.LIBRARY_TRAYS;
  var defaultFilters = window.defaultFilters;
  var hasAnyActiveFilter = window.hasAnyActiveFilter;

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

  // recipeMatches + applyFilters live in library-data.js (shared with the
  // Add From Library modal). Use the window.applyFilters reference below.
  var applyFilters = window.applyFilters;

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
      // Canonical library row. Migration 011 splits the round-trip on
      // is_starter: starters go visible-by-default, so we tombstone them to
      // remove; non-starters go hidden-by-default, so unsave means removing
      // from the explicit added list (leaving no tombstone — they'd be
      // filtered out by the default rail merge anyway).
      if (recipe.isStarter) {
        if (typeof addDeletedTargetPreset === "function") addDeletedTargetPreset(recipe.slug);
      } else {
        if (typeof removeAddedTargetPreset === "function") removeAddedTargetPreset(recipe.slug);
      }
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

  function formatMethod(recipe) {
    var method = recipe.brewMethod || "filter";
    return method === "all" ? "filter · espresso" : method;
  }

  function formatRoast(recipe) {
    var roasts = Array.isArray(recipe.roast) ? recipe.roast : [];
    if (roasts.length === 0 || roasts.indexOf("all") !== -1) return "any roast";
    return roasts.join(", ");
  }

  function formatMethodRoast(recipe) {
    return formatMethod(recipe) + " · " + formatRoast(recipe);
  }

  // Compact label for a MINERAL_DB id used in stock-formula chips. Falls back
  // to the formula notation when shorter than the full name (KHCO₃ vs.
  // "Potassium Bicarbonate"); falls back to the raw id for unknown salts so
  // future additions still render.
  var STOCK_MINERAL_SHORT = {
    "epsom-salt": "epsom",
    "magnesium-chloride": "MgCl₂·6H₂O",
    "calcium-chloride": "CaCl₂·2H₂O",
    "calcium-chloride-anhydrous": "CaCl₂",
    "baking-soda": "NaHCO₃",
    "potassium-bicarbonate": "KHCO₃",
    gypsum: "gypsum",
    "potassium-chloride": "KCl",
    "sodium-chloride": "NaCl",
  };

  // Tags that are metadata, not user-facing display. Convention: any value
  // matching /^via:/ identifies the catalogued source the recipe came from
  // (e.g. 'via:coffee-ad-astra'). We render only the user-facing flavor tags
  // ("Bright", "Sweet", etc.) as chips; via:* stays on the recipe row for
  // analytics + admin reporting. Filtering here (not in library-data.js's
  // normalize step) keeps recipe.tags as the raw column value.
  function visibleChipTags(tags) {
    if (!Array.isArray(tags)) return [];
    return tags.filter(function (t) {
      return typeof t === "string" && !/^via:/.test(t);
    });
  }

  // Shared DIY-stock UI block — used by both createRecipeCard (regular card)
  // and createFeaturedHero (featured hero). Renders the formula text plus an
  // import sub-action that flips between "+ Create Concentrate" (when the
  // library slug isn't yet in cw_stock_concentrate_specs) and "✓ In your
  // pantry" + a Settings link (when it is). Single source of truth so the
  // two surfaces can't drift — CodeRabbit flagged the prior duplication on
  // PR #64. Hero typography differences live in CSS via .rx-featured-hero
  // .rx-card-stock-* overrides.
  function appendStockUi(container, recipe, handlers) {
    var stockText = formatStockFormula(recipe.stockFormula);

    if (stockText) {
      // Hand-authored formula (Coffee ad Astra rows): existing
      // "+ Create Concentrate" adoption path is canonical and preserved verbatim.
      var stockRow = el("div", "rx-card-stock");
      stockRow.appendChild(el("span", "rx-card-stock-label", "Recipe concentrate"));
      stockRow.appendChild(el("span", "rx-card-stock-formula", stockText));
      container.appendChild(stockRow);

      var stockActions = el("div", "rx-card-stock-actions");
      if (handlers.imported) {
        var importedLabel = el("span", "rx-card-stock-imported", "✓ In your pantry");
        var settingsLink = el("a", "rx-card-stock-settings", "Settings");
        settingsLink.href = "minerals.html#stock-concentrates-summary";
        stockActions.appendChild(importedLabel);
        stockActions.appendChild(settingsLink);
      } else {
        var addBtn = el("button", "rx-card-stock-add", "+ Create Concentrate");
        addBtn.type = "button";
        addBtn.setAttribute("aria-label", "Add this recipe's concentrate to your pantry");
        addBtn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (handlers.onAddStock) handlers.onAddStock(recipe);
        });
        if (typeof window.applyAuthGate === "function") {
          window.applyAuthGate(addBtn, { reason: "save-stock" });
        }
        stockActions.appendChild(addBtn);
      }
      container.appendChild(stockActions);
      return;
    }

    // No hand-authored formula. If the recipe has a non-trivial ion profile,
    // offer to derive one — opens minerals.html with the stock-new editor
    // pre-filled from the recipe's targets so the user can review and tweak
    // before saving.
    if (!hasDerivableIonProfile(recipe)) return;

    var deriveActions = el("div", "rx-card-stock-actions");
    if (handlers.derived) {
      var derivedLabel = el("span", "rx-card-stock-imported", "✓ In your pantry");
      var derivedSettings = el("a", "rx-card-stock-settings", "Settings");
      derivedSettings.href = "minerals.html#stock-concentrates-summary";
      deriveActions.appendChild(derivedLabel);
      deriveActions.appendChild(derivedSettings);
    } else {
      var deriveBtn = el("button", "rx-card-stock-add", "+ Create Concentrate");
      deriveBtn.type = "button";
      deriveBtn.setAttribute("aria-label", "Create a concentrate from this recipe's targets");
      if (typeof window.applyAuthGate === "function") {
        window.applyAuthGate(deriveBtn, { reason: "save-stock" });
      }
      deriveBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (handlers.onDeriveStock) handlers.onDeriveStock(recipe);
      });
      deriveActions.appendChild(deriveBtn);
    }
    container.appendChild(deriveActions);
  }

  // Cards offer "+ Create Concentrate" only when at least one of the load-bearing
  // ions (Ca/Mg/K/Na/HCO3) is non-zero. Distilled / RO / all-zero rows have
  // no minerals to derive — skip rendering the action at all rather than
  // showing a button that produces an empty editor.
  function hasDerivableIonProfile(recipe) {
    if (!recipe) return false;
    var fields = ["calcium", "magnesium", "potassium", "sodium", "bicarbonate"];
    for (var i = 0; i < fields.length; i++) {
      if (Number(recipe[fields[i]]) > 0) return true;
    }
    return false;
  }

  function formatStockFormula(formula) {
    if (!formula || !Array.isArray(formula.minerals) || formula.minerals.length === 0) {
      return "";
    }
    var parts = formula.minerals
      .map(function (m) {
        if (!m || typeof m !== "object") return "";
        var label = STOCK_MINERAL_SHORT[m.mineralId] || m.mineralId || "?";
        var grams = Number(m.grams);
        if (!Number.isFinite(grams)) return "";
        // Trim a trailing .0 so "5.0 g epsom" reads as "5 g epsom".
        var gramsStr = grams === Math.round(grams) ? String(grams) : String(grams);
        return gramsStr + " g " + label;
      })
      .filter(Boolean)
      .join(" · ");
    var bottle = Number(formula.bottleMl);
    var dose = Number(formula.doseGramsPerL);
    var bottleLabel = Number.isFinite(bottle) && bottle > 0 ? " in " + bottle + " mL" : "";
    var doseLabel = Number.isFinite(dose) && dose > 0 ? " - " + dose + " g/L" : "";
    return parts + bottleLabel + doseLabel;
  }

  // GH / KH summary row (replaces the raw Ca/Mg/Alk triplet). Values from
  // metrics.js's recipeMetricsSummary (on window): GH from Ca + Mg, KH from
  // alkalinity, mg/L as CaCO3. extraClass is preserved for the featured-hero
  // variant (.rx-featured-mineral-triplet).
  function createMineralTriplet(recipe, extraClass) {
    var wrap = el("div", "rx-mineral-triplet" + (extraClass ? " " + extraClass : ""));
    var summary =
      typeof window.recipeMetricsSummary === "function"
        ? window.recipeMetricsSummary(recipe)
        : { gh: null, kh: null };
    [
      { label: "GH", value: summary.gh },
      { label: "KH", value: summary.kh },
    ].forEach(function (pair) {
      var item = el("span", "rx-mineral-item");
      item.appendChild(el("span", "rx-mineral-label", pair.label));
      item.appendChild(
        el("span", "rx-mineral-value", pair.value != null ? String(pair.value) : "-"),
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
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", "View " + (recipe.label || "recipe") + " details");
    card.addEventListener("click", function (e) {
      // Skip clicks that originated on any interactive descendant — buttons
      // stopPropagation, but anchors (rx-card-stock-settings) don't, and
      // closest() is the defensive choice for any future inner controls too.
      // Note: the card itself has role="button" so we exclude it from the hit.
      var hit = e.target.closest && e.target.closest('button, a, [role="button"]');
      if (hit && hit !== card) return;
      openRecipeDetailModal(recipe, handlers);
    });
    card.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      // Don't hijack Space/Enter when the focus is on an inner control.
      if (e.target !== card) return;
      e.preventDefault();
      openRecipeDetailModal(recipe, handlers);
    });

    // Header: title + source + bookmark
    var header = el("div", "rx-card-header");
    var titleCol = el("div", "rx-card-title-col");
    titleCol.appendChild(el("h3", "rx-card-title", recipe.label || ""));
    // creatorDisplayLabel (src/lib/creator-display.ts) collapses the three
    // attribution states (system / deleted creator / known) into one string.
    if (typeof window.creatorDisplayLabel === "function") {
      titleCol.appendChild(el("p", "rx-card-source", "by " + window.creatorDisplayLabel(recipe)));
    } else if (recipe.creatorDisplayName) {
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
    if (typeof window.applyAuthGate === "function") {
      window.applyAuthGate(bookmark, { reason: "bookmark" });
    }
    header.appendChild(bookmark);
    card.appendChild(header);

    // Mineral triplet
    card.appendChild(createMineralTriplet(recipe));

    // Description (2-line clamp via CSS -webkit-line-clamp)
    if (recipe.description) {
      card.appendChild(el("p", "rx-card-desc", recipe.description));
    }

    // Recipe-concentrate formula + import sub-action. Single source of truth in
    // appendStockUi so the regular card and the featured hero can't drift.
    appendStockUi(card, recipe, handlers);

    // Footer: tag chips (left) + method/roast meta (right). via:* tags are
    // metadata — see visibleChipTags above.
    var footer = el("div", "rx-card-footer");
    var tagList = el("div", "rx-card-tags");
    visibleChipTags(recipe.tags).forEach(function (tag) {
      tagList.appendChild(el("span", "rx-card-tag", tag));
    });
    footer.appendChild(tagList);
    footer.appendChild(el("span", "rx-card-meta", formatMethodRoast(recipe)));
    card.appendChild(footer);

    // Owner-only action row: edit + unpublish. Handlers.isOwner is false
    // until currentUserId resolves; cards re-render once it does.
    if (handlers.isOwner && handlers.isOwner(recipe)) {
      var ownerActions = el("div", "rx-card-owner-actions");
      var editBtn = el("button", "rx-card-owner-btn", "Edit");
      editBtn.type = "button";
      editBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        handlers.onEditRecipe(recipe);
      });
      var unpublishBtn = el("button", "rx-card-owner-btn rx-card-owner-btn-danger", "Unpublish");
      unpublishBtn.type = "button";
      unpublishBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        handlers.onUnpublishRecipe(recipe);
      });
      ownerActions.appendChild(editBtn);
      ownerActions.appendChild(unpublishBtn);
      card.appendChild(ownerActions);
    }

    return card;
  }

  // --- Recipe detail modal -----------------------------------------------

  // Singleton overlay state. Open/close are reentrant — clicking a second
  // card while the modal is up just re-renders the body for the new recipe.
  var detailOverlay = null;
  var detailDialog = null;
  var detailCloseBtn = null;
  var detailScroll = null;
  var detailPreviousFocus = null;
  var detailKeyHandler = null;
  var detailOverlayClickHandler = null;

  function ensureDetailOverlay() {
    if (detailOverlay) return;
    detailOverlay = document.createElement("div");
    detailOverlay.className = "library-picker-overlay rx-detail-overlay";
    detailOverlay.style.display = "none";

    detailDialog = document.createElement("div");
    detailDialog.className = "library-picker-dialog rx-detail-dialog";
    detailDialog.setAttribute("role", "dialog");
    detailDialog.setAttribute("aria-modal", "true");
    detailDialog.setAttribute("aria-labelledby", "rx-detail-title");

    detailCloseBtn = document.createElement("button");
    detailCloseBtn.type = "button";
    detailCloseBtn.className = "library-picker-close";
    detailCloseBtn.setAttribute("aria-label", "Close");
    detailCloseBtn.textContent = "×";
    detailDialog.appendChild(detailCloseBtn);

    detailScroll = document.createElement("div");
    detailScroll.className = "rx-detail-scroll";
    detailDialog.appendChild(detailScroll);

    detailOverlay.appendChild(detailDialog);
    document.body.appendChild(detailOverlay);
  }

  // Mineral grid order. Includes all 8 ions, vs. the card's compact Ca/Mg/Alk
  // triplet. ALK is the calculated/derived value users tune to; the explicit
  // HCO3 is shown alongside for completeness.
  var DETAIL_MINERAL_FIELDS = [
    { field: "calcium", label: "Ca" },
    { field: "magnesium", label: "Mg" },
    { field: "alkalinity", label: "Alk" },
    { field: "sodium", label: "Na" },
    { field: "potassium", label: "K" },
    { field: "sulfate", label: "SO₄" },
    { field: "chloride", label: "Cl" },
    { field: "bicarbonate", label: "HCO₃" },
  ];

  function titleCaseCategory(cat) {
    if (!cat) return "";
    return String(cat)
      .split("-")
      .map(function (s) {
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
      })
      .join(" ");
  }

  function buildDetailBody(recipe, handlers) {
    detailScroll.innerHTML = "";

    // Header: eyebrow + (title + Save) + byline
    var header = el("div", "rx-detail-header");

    var eyebrowText = titleCaseCategory(recipe.category);
    if (eyebrowText) header.appendChild(el("p", "rx-detail-eyebrow", eyebrowText));

    var titleRow = el("div", "rx-detail-title-row");
    var title = el("h2", "rx-detail-title", recipe.label || "");
    title.id = "rx-detail-title";
    titleRow.appendChild(title);

    var saved = handlers.isSaved && handlers.isSaved(recipe);
    var saveBtn = el("button", "rx-detail-save");
    saveBtn.type = "button";
    saveBtn.setAttribute("aria-label", saved ? "Unsave recipe" : "Save recipe");
    saveBtn.setAttribute("aria-pressed", saved ? "true" : "false");
    if (saved) saveBtn.classList.add("is-active");
    var saveIcon = el("span", "rx-detail-save-icon", saved ? "★" : "☆");
    var saveLabel = el("span", "rx-detail-save-label", saved ? "Saved" : "Save");
    saveBtn.appendChild(saveIcon);
    saveBtn.appendChild(saveLabel);
    saveBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (handlers.onToggleSave) handlers.onToggleSave(recipe);
      // Re-render the modal body so the Save button icon / label / aria-pressed
      // reflect the new saved state. Without this, the snapshot taken at
      // open-time goes stale until the user closes and reopens the modal.
      buildDetailBody(recipe, handlers);
    });
    if (typeof window.applyAuthGate === "function") {
      window.applyAuthGate(saveBtn, { reason: "bookmark" });
    }
    titleRow.appendChild(saveBtn);

    header.appendChild(titleRow);

    if (typeof window.creatorDisplayLabel === "function") {
      header.appendChild(el("p", "rx-detail-byline", "by " + window.creatorDisplayLabel(recipe)));
    } else if (recipe.creatorDisplayName) {
      header.appendChild(el("p", "rx-detail-byline", "by " + recipe.creatorDisplayName));
    }

    detailScroll.appendChild(header);

    // Headline metrics (GH / KH / TDS) - derived summary numbers shown above the
    // raw per-ion breakdown. recipeMetricsSummary is bridged on window by
    // metrics.js. Rendered as a 3-up grid (.rx-detail-metrics) in the user's
    // stated order so it stays readable on small screens.
    var summary =
      typeof window.recipeMetricsSummary === "function"
        ? window.recipeMetricsSummary(recipe)
        : null;
    if (summary) {
      var metricsSection = el("div", "rx-detail-section");
      var metricsGrid = el("div", "rx-detail-metrics");
      [
        { label: "GH", value: summary.gh },
        { label: "KH", value: summary.kh },
        { label: "TDS", value: summary.tds },
      ].forEach(function (m) {
        var cell = el("div", "rx-detail-metric");
        cell.appendChild(el("span", "rx-detail-metric-label", m.label));
        cell.appendChild(el("span", "rx-detail-metric-value", String(m.value)));
        metricsGrid.appendChild(cell);
      });
      metricsSection.appendChild(metricsGrid);
      detailScroll.appendChild(metricsSection);
    }

    // Description
    if (recipe.description) {
      var descSection = el("div", "rx-detail-section");
      descSection.appendChild(el("div", "rx-detail-section-label", "Description"));
      descSection.appendChild(el("p", "rx-detail-desc", recipe.description));
      detailScroll.appendChild(descSection);
    }

    // Mineral profile (all 8 ions)
    var mineralSection = el("div", "rx-detail-section");
    mineralSection.appendChild(el("div", "rx-detail-section-label", "Mineral profile (ppm)"));
    var mineralGrid = el("div", "rx-detail-minerals");
    DETAIL_MINERAL_FIELDS.forEach(function (pair) {
      var item = el("div", "rx-detail-mineral");
      item.appendChild(el("span", "rx-detail-mineral-label", pair.label));
      var val = recipe[pair.field];
      item.appendChild(el("span", "rx-detail-mineral-value", val != null ? String(val) : "-"));
      mineralGrid.appendChild(item);
    });
    mineralSection.appendChild(mineralGrid);
    detailScroll.appendChild(mineralSection);

    // Recipe concentrate (only when present)
    var stockText = formatStockFormula(recipe.stockFormula);
    if (stockText) {
      var stockSection = el("div", "rx-detail-section");
      stockSection.appendChild(el("div", "rx-detail-section-label", "Recipe concentrate"));
      var stockBox = el("div", "rx-detail-stock");
      stockBox.appendChild(document.createTextNode(stockText));
      var srcParts = [];
      if (recipe.stockFormula.source) srcParts.push("Source: " + recipe.stockFormula.source);
      if (recipe.stockFormula.via) srcParts.push("via " + recipe.stockFormula.via);
      if (srcParts.length) {
        stockBox.appendChild(el("span", "rx-detail-stock-source", srcParts.join(" · ")));
      }
      stockSection.appendChild(stockBox);
      detailScroll.appendChild(stockSection);
    }

    // Footer: flavor tags (left) + stacked method/roast (right)
    var footer = el("div", "rx-detail-footer");
    var tagList = el("div", "rx-detail-tags");
    visibleChipTags(recipe.tags).forEach(function (tag) {
      tagList.appendChild(el("span", "rx-card-tag", tag));
    });
    footer.appendChild(tagList);

    var meta = el("div", "rx-detail-meta");
    meta.appendChild(el("span", "rx-detail-meta-line", formatMethod(recipe)));
    meta.appendChild(el("span", "rx-detail-meta-line", formatRoast(recipe)));
    footer.appendChild(meta);
    detailScroll.appendChild(footer);

    // Bottom actions: stock action (left) + owner actions (right)
    var actions = el("div", "rx-detail-actions");
    var hasAnyAction = false;

    if (
      recipe.stockFormula &&
      Array.isArray(recipe.stockFormula.minerals) &&
      recipe.stockFormula.minerals.length
    ) {
      if (handlers.imported) {
        var importedWrap = el("div", "rx-detail-stock-status");
        importedWrap.appendChild(el("span", "rx-card-stock-imported", "✓ In your pantry"));
        var settingsLink = el("a", "rx-card-stock-settings", "Settings");
        settingsLink.href = "minerals.html#stock-concentrates-summary";
        importedWrap.appendChild(settingsLink);
        actions.appendChild(importedWrap);
      } else {
        var addBtn = el("button", "preset-btn", "+ Create Concentrate");
        addBtn.type = "button";
        addBtn.setAttribute("aria-label", "Add this recipe's concentrate to your pantry");
        addBtn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          // Close the detail modal before launching the stock editor so two
          // overlays don't stack — the detail modal's document-level Escape /
          // focus-trap would otherwise steal events from the child dialog.
          closeRecipeDetailModal();
          if (handlers.onAddStock) handlers.onAddStock(recipe);
        });
        if (typeof window.applyAuthGate === "function") {
          window.applyAuthGate(addBtn, { reason: "save-stock" });
        }
        actions.appendChild(addBtn);
      }
      hasAnyAction = true;
    } else if (hasDerivableIonProfile(recipe)) {
      if (handlers.derived) {
        var derivedWrap = el("div", "rx-detail-stock-status");
        derivedWrap.appendChild(el("span", "rx-card-stock-imported", "✓ In your pantry"));
        var derivedSettings = el("a", "rx-card-stock-settings", "Settings");
        derivedSettings.href = "minerals.html#stock-concentrates-summary";
        derivedWrap.appendChild(derivedSettings);
        actions.appendChild(derivedWrap);
      } else {
        var deriveBtn = el("button", "preset-btn", "+ Create Concentrate");
        deriveBtn.type = "button";
        deriveBtn.setAttribute("aria-label", "Create a concentrate from this recipe's targets");
        deriveBtn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          // Same reasoning as the Add-to-stocks handler above: close first so
          // the detail modal's focus-trap doesn't sit behind the stock editor.
          closeRecipeDetailModal();
          if (handlers.onDeriveStock) handlers.onDeriveStock(recipe);
        });
        if (typeof window.applyAuthGate === "function") {
          window.applyAuthGate(deriveBtn, { reason: "save-stock" });
        }
        actions.appendChild(deriveBtn);
      }
      hasAnyAction = true;
    }

    if (handlers.isOwner && handlers.isOwner(recipe)) {
      var ownerGroup = el("div", "rx-detail-owner-actions");
      var editBtn = el("button", "rx-card-owner-btn", "Edit");
      editBtn.type = "button";
      editBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        // Close detail modal before opening the edit modal — see Add-to-stocks
        // handler above for the focus-trap / Escape rationale.
        closeRecipeDetailModal();
        if (handlers.onEditRecipe) handlers.onEditRecipe(recipe);
      });
      var unpublishBtn = el("button", "rx-card-owner-btn rx-card-owner-btn-danger", "Unpublish");
      unpublishBtn.type = "button";
      unpublishBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        // Same as Edit: close before launching the unpublish confirm dialog.
        closeRecipeDetailModal();
        if (handlers.onUnpublishRecipe) handlers.onUnpublishRecipe(recipe);
      });
      ownerGroup.appendChild(editBtn);
      ownerGroup.appendChild(unpublishBtn);
      actions.appendChild(ownerGroup);
      hasAnyAction = true;
    }

    if (hasAnyAction) detailScroll.appendChild(actions);
  }

  function openRecipeDetailModal(recipe, handlers) {
    if (!recipe) return;
    ensureDetailOverlay();
    buildDetailBody(recipe, handlers || {});

    detailPreviousFocus = document.activeElement;
    detailOverlay.style.display = "";

    detailOverlayClickHandler = function (e) {
      if (e.target === detailOverlay) closeRecipeDetailModal();
    };
    detailOverlay.addEventListener("click", detailOverlayClickHandler);
    detailCloseBtn.addEventListener("click", closeRecipeDetailModal);

    detailKeyHandler = function (e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRecipeDetailModal();
        return;
      }
      if (e.key !== "Tab") return;
      var raw = detailOverlay.querySelectorAll(
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
    };
    document.addEventListener("keydown", detailKeyHandler, true);

    if (detailCloseBtn && detailCloseBtn.focus) detailCloseBtn.focus();
  }

  function closeRecipeDetailModal() {
    if (!detailOverlay) return;
    detailOverlay.style.display = "none";
    if (detailOverlayClickHandler) {
      detailOverlay.removeEventListener("click", detailOverlayClickHandler);
      detailOverlayClickHandler = null;
    }
    if (detailCloseBtn) detailCloseBtn.removeEventListener("click", closeRecipeDetailModal);
    if (detailKeyHandler) {
      document.removeEventListener("keydown", detailKeyHandler, true);
      detailKeyHandler = null;
    }
    if (detailPreviousFocus && detailPreviousFocus.focus) detailPreviousFocus.focus();
    detailPreviousFocus = null;
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
    var scrollWrap = el("div", "rx-carousel-wrap");
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
      // Forward the full handlers set — createRecipeCard needs isOwner +
      // onEditRecipe + onUnpublishRecipe to render owner affordances. Earlier
      // versions of this site lose-lose'd owner buttons by passing a narrow
      // {saved, onToggleSave} here.
      scrollEl.appendChild(
        createRecipeCard(
          recipe,
          Object.assign({}, handlers, {
            saved: handlers.isSaved(recipe),
            imported: handlers.isStockImported && handlers.isStockImported(recipe),
            derived: handlers.isStockDerived && handlers.isStockDerived(recipe),
          }),
        ),
      );
    });
    // Edge-fade affordance: the chevrons (desktop-only) were the sole cue that
    // a row scrolls. Toggle fade overlays from scroll position so the overflow
    // is visible on every viewport. ResizeObserver gives a correct first read
    // once the carousel is laid out (scrollWidth is 0 at build time, before the
    // section is inserted into the DOM).
    function updateCarouselScrollState() {
      var max = scrollEl.scrollWidth - scrollEl.clientWidth;
      scrollWrap.classList.toggle("can-scroll-left", scrollEl.scrollLeft > 4);
      scrollWrap.classList.toggle("can-scroll-right", scrollEl.scrollLeft < max - 4);
    }
    scrollEl.addEventListener("scroll", updateCarouselScrollState, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(updateCarouselScrollState).observe(scrollEl);
    }
    // Initial read: this section isn't in the DOM yet (the caller appends it
    // after we return), so scrollWidth/clientWidth are 0 here. A 0ms timeout
    // fires after the caller's synchronous insertion; reading scrollWidth then
    // forces layout, so the fade is correct on first paint without waiting for
    // a scroll — and it fires even when the tab is backgrounded (unlike rAF).
    setTimeout(updateCarouselScrollState, 0);

    scrollWrap.appendChild(scrollEl);
    section.appendChild(scrollWrap);

    return section;
  }

  // --- Featured hero -----------------------------------------------------

  // Wide, full-width hero card for the Featured slot. Replaces the earlier
  // single-card carousel (which shared styling with every other tray and
  // therefore didn't read as featured). Reuses createMineralTriplet and the
  // existing handlers contract — bookmark star is still the only selection
  // affordance, matching the regular library cards. data-tray="featured" is
  // preserved so existing scroll-restoration / e2e selectors keep working.
  //
  // The DOM mirrors createRecipeCard's order (header → minerals → desc →
  // footer{tags + meta} → owner actions) so the hero reads as a souped-up
  // version of a regular card rather than a bespoke layout. The visual
  // emphasis (gradient, accent border, larger title, eyebrow, top-right
  // pinned bookmark) lives in CSS.
  function createFeaturedHero(recipe, handlers) {
    if (!recipe) return null;

    var section = el("section", "rx-featured-hero");
    section.dataset.tray = "featured";
    if (recipe.slug) section.dataset.slug = recipe.slug;
    section.setAttribute("role", "button");
    section.setAttribute("tabindex", "0");
    section.setAttribute("aria-label", "View " + (recipe.label || "recipe") + " details");
    section.addEventListener("click", function (e) {
      // Skip clicks that originated on any interactive descendant — same
      // reasoning as the card click handler in createRecipeCard. The hero
      // itself has role="button" so we exclude it from the hit.
      var hit = e.target.closest && e.target.closest('button, a, [role="button"]');
      if (hit && hit !== section) return;
      openRecipeDetailModal(recipe, handlers);
    });
    section.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target !== section) return;
      e.preventDefault();
      openRecipeDetailModal(recipe, handlers);
    });

    var eyebrow = el("p", "rx-featured-eyebrow");
    eyebrow.appendChild(el("span", "rx-featured-star", "\u2605"));
    eyebrow.appendChild(document.createTextNode(" Featured \u00b7 Editor's pick"));
    section.appendChild(eyebrow);

    var header = el("header", "rx-featured-header");
    var titleCol = el("div", "rx-featured-title-col");
    titleCol.appendChild(el("h2", "rx-featured-title", recipe.label || ""));
    if (typeof window.creatorDisplayLabel === "function") {
      titleCol.appendChild(
        el("p", "rx-featured-source", "by " + window.creatorDisplayLabel(recipe)),
      );
    } else if (recipe.creatorDisplayName) {
      titleCol.appendChild(el("p", "rx-featured-source", "by " + recipe.creatorDisplayName));
    }
    header.appendChild(titleCol);

    // Bookmark sits as the title's flex sibling so the title-col absorbs
    // wrapping and the bookmark stays anchored at the header's top-right.
    // (Earlier this was position:absolute on the hero, but .auth-locked
    // sets position:relative at equal specificity later in the cascade,
    // which collapsed the bookmark back into flow when logged out.)
    var saved = handlers.isSaved && handlers.isSaved(recipe);
    var bookmark = el("button", "rx-featured-bookmark");
    bookmark.type = "button";
    bookmark.setAttribute("aria-label", saved ? "Unsave recipe" : "Save recipe");
    bookmark.setAttribute("aria-pressed", saved ? "true" : "false");
    bookmark.textContent = saved ? "\u2605" : "\u2606";
    if (saved) bookmark.classList.add("is-active");
    bookmark.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      handlers.onToggleSave(recipe);
    });
    if (typeof window.applyAuthGate === "function") {
      window.applyAuthGate(bookmark, { reason: "bookmark" });
    }
    header.appendChild(bookmark);
    section.appendChild(header);

    section.appendChild(createMineralTriplet(recipe, "rx-featured-mineral-triplet"));

    if (recipe.description) {
      section.appendChild(el("p", "rx-featured-desc", recipe.description));
    }

    // Recipe-concentrate formula + import sub-action — shared with createRecipeCard
    // via appendStockUi. Hero-scoped CSS overrides scale typography for the
    // larger hero context (see .rx-featured-hero .rx-card-stock-*).
    appendStockUi(section, recipe, handlers);

    var footer = el("div", "rx-featured-footer");
    var tagList = el("div", "rx-featured-tags");
    visibleChipTags(recipe.tags).forEach(function (tag) {
      tagList.appendChild(el("span", "rx-card-tag", tag));
    });
    footer.appendChild(tagList);
    footer.appendChild(el("span", "rx-featured-meta", formatMethodRoast(recipe)));
    section.appendChild(footer);

    if (handlers.isOwner && handlers.isOwner(recipe)) {
      var ownerActions = el("div", "rx-featured-owner-actions");
      var editBtn = el("button", "rx-card-owner-btn", "Edit");
      editBtn.type = "button";
      editBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        handlers.onEditRecipe(recipe);
      });
      var unpublishBtn = el("button", "rx-card-owner-btn rx-card-owner-btn-danger", "Unpublish");
      unpublishBtn.type = "button";
      unpublishBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        handlers.onUnpublishRecipe(recipe);
      });
      ownerActions.appendChild(editBtn);
      ownerActions.appendChild(unpublishBtn);
      section.appendChild(ownerActions);
    }

    return section;
  }

  // --- Content layout ----------------------------------------------------

  // partitionByCategory + pickFeaturedFromFiltered live in library-data.js.
  var partitionByCategory = window.partitionByCategory;
  var pickFeaturedFromFiltered = window.pickFeaturedFromFiltered;

  function createEmptyState(onClear) {
    var wrap = el("section", "rx-empty-state");
    wrap.appendChild(el("p", "rx-empty-title", "No recipes match these filters."));
    wrap.appendChild(el("p", "rx-empty-subtitle", "Try relaxing one of your constraints."));
    var cta = el("button", "rx-empty-clear", "Clear all filters");
    cta.type = "button";
    cta.addEventListener("click", onClear);
    wrap.appendChild(cta);
    return wrap;
  }

  // Shown when the catalog fetch failed and there's nothing cached to display,
  // so the content region offers a recovery path instead of hanging blank
  // (library-data.js fires onLibraryDataError on failure).
  function createErrorState(onRetry) {
    var wrap = el("section", "rx-empty-state");
    wrap.appendChild(el("p", "rx-empty-title", "Couldn't load the recipe library."));
    wrap.appendChild(el("p", "rx-empty-subtitle", "Check your connection and try again."));
    var cta = el("button", "rx-empty-clear", "Retry");
    cta.type = "button";
    cta.addEventListener("click", onRetry);
    wrap.appendChild(cta);
    return wrap;
  }

  function renderContent(root, filtered, catalogLoaded, handlers, method, loadFailed) {
    // Capture horizontal scroll position of each existing carousel so a
    // re-render (triggered e.g. by star-toggle) doesn't reset users back to
    // the leftmost card of every tray. Keyed by tray slug in data-tray.
    var scrollByTray = {};
    var existingSections = root.querySelectorAll(".rx-carousel-section[data-tray]");
    for (var i = 0; i < existingSections.length; i++) {
      var key = existingSections[i].dataset.tray;
      var scrollEl = existingSections[i].querySelector(".rx-carousel");
      if (key && scrollEl) scrollByTray[key] = scrollEl.scrollLeft;
    }

    while (root.firstChild) root.removeChild(root.firstChild);

    // Library fetch hasn't resolved yet — stay silent until data lands.
    // Using an explicit "loaded" boolean (not a zero count) so a successful
    // fetch that returns zero rows correctly falls through to the empty
    // state rather than masquerading as still-loading. If the fetch FAILED
    // and left us with no catalog, surface an error + retry instead of an
    // indefinite blank.
    if (!catalogLoaded) {
      if (loadFailed) root.appendChild(createErrorState(handlers.onRetry));
      return;
    }

    // Catalog loaded, but either filters excluded everything or the catalog
    // itself is empty. Either way, surface the clear-filters CTA — it's an
    // idempotent no-op when no filters are active.
    if (!Array.isArray(filtered) || filtered.length === 0) {
      root.appendChild(createEmptyState(handlers.onClearFilters));
      return;
    }

    var byCategory = partitionByCategory(filtered);

    // Featured slot: one card picked by brew-method filter (espresso falls
    // back to cafelytic-espresso so the slot stays populated). Rendered as
    // a wide hero (createFeaturedHero) instead of a single-card carousel so
    // it reads as featured rather than another tray. Bookmark star is still
    // the only selection affordance, matching the regular library cards.
    var featured = pickFeaturedFromFiltered(filtered, method);
    if (featured) {
      // Mirror the carousel-iteration pattern (createTrayCarousel resolves
      // saved + imported per recipe before passing handlers into createCard).
      // Letting createFeaturedHero see `imported:` here closes the gap when a
      // stock-bearing recipe is promoted to Featured (B3a-hero).
      var heroHandlers = Object.assign({}, handlers, {
        imported: handlers.isStockImported && handlers.isStockImported(featured),
        derived: handlers.isStockDerived && handlers.isStockDerived(featured),
      });
      var hero = createFeaturedHero(featured, heroHandlers);
      if (hero) root.appendChild(hero);
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

    // Restore captured scroll positions on the fresh DOM. Layout has
    // resolved by now because the sections are already appended. Missing
    // keys (tray just appeared) stay at scrollLeft=0 naturally.
    var newSections = root.querySelectorAll(".rx-carousel-section[data-tray]");
    for (var j = 0; j < newSections.length; j++) {
      var k = newSections[j].dataset.tray;
      var s = newSections[j].querySelector(".rx-carousel");
      if (k && s && scrollByTray[k] != null) s.scrollLeft = scrollByTray[k];
    }
  }

  // --- Mount -------------------------------------------------------------

  function mountRecipeBrowser(root) {
    if (!root) return;

    while (root.firstChild) root.removeChild(root.firstChild);

    var state = readFiltersFromUrl();
    var allRecipes =
      typeof window.getPublicRecipesSync === "function" ? window.getPublicRecipesSync() : [];
    // A non-empty sync cache means library-data.js has already fetched or
    // rehydrated from sessionStorage — safe to render. Otherwise we wait
    // for onLibraryDataLoaded to flip this true before unblocking the
    // content region.
    var catalogLoaded = allRecipes.length > 0;
    // Set when a catalog fetch fails with no cache to fall back on; flips
    // renderContent from a silent loading state to an error + retry card.
    var loadFailed = false;

    // currentUserId drives owner-only affordances (Edit / Unpublish).
    // null until getUser() resolves; re-rendered when it does. Stays null
    // for anonymous visitors so they see no owner buttons.
    var currentUserId = null;

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

    var summary = createFilterSummary(onClearFilters);
    page.appendChild(summary.summary);

    var contentRoot = el("div", "rx-content");
    page.appendChild(contentRoot);

    root.appendChild(page);

    // --- Content handlers ---------------------------------------------

    var contentHandlers = {
      isSaved: function (recipe) {
        return typeof isRecipeInMyProfiles === "function" && isRecipeInMyProfiles(recipe);
      },
      // Stock pantry membership — true if the user has already imported this
      // library row's stockFormula into cw_stock_concentrate_specs. Read fresh
      // each call so a click-to-import on one card flips other cards on the
      // next render (cards keyed off the same library slug, e.g. if the same
      // recipe appears in Featured + a tray, both reflect the new state).
      isStockImported: function (recipe) {
        if (!recipe || !recipe.slug || !recipe.stockFormula) return false;
        if (typeof loadStockConcentrateSpecs !== "function") return false;
        var specs = loadStockConcentrateSpecs();
        return !!(specs && Object.prototype.hasOwnProperty.call(specs, recipe.slug));
      },
      // Derived-stock pantry membership — true if a previously-saved spec
      // carries createdFrom: "derived:<slug>" matching this recipe. Lets the
      // "+ Create Concentrate" CTA flip to "✓ In your pantry" on re-renders, the
      // same way isStockImported does for the hand-authored Ad Astra path.
      isStockDerived: function (recipe) {
        if (!recipe || !recipe.slug) return false;
        if (typeof loadStockConcentrateSpecs !== "function") return false;
        var specs = loadStockConcentrateSpecs();
        if (!specs) return false;
        var marker = "derived:" + recipe.slug;
        var keys = Object.keys(specs);
        for (var i = 0; i < keys.length; i++) {
          var spec = specs[keys[i]];
          if (spec && spec.createdFrom === marker) return true;
        }
        return false;
      },
      // Owner check — card passes recipe, we match against the fetched
      // user. userId === null on canonical library rows (SCA, Cafelytic,
      // etc.) so they're never rendered as owned.
      isOwner: function (recipe) {
        return !!(currentUserId && recipe && recipe.userId === currentUserId);
      },
      onToggleSave: function (recipe) {
        toggleBookmark(recipe);
        // Full re-render so every surface (hero + any carousel card) reflects
        // the new saved state. Cheap at 30 cards; revisit if catalog grows
        // past ~200.
        render();
      },
      // Opens the stock-editor modal pre-filled with the recipe's
      // hand-authored stockFormula. The user reviews/tweaks before saving —
      // same UX shape as onDeriveStock below. On Save, the spec is keyed
      // under recipe.slug so this card flips to "✓ In your pantry" on the
      // next render (refetchAndRender wired through onSaved).
      onAddStock: function (recipe) {
        if (!recipe || !recipe.slug) return;
        if (typeof window.openStockEditor !== "function") {
          window.location.href = "minerals.html#stock-import=" + encodeURIComponent(recipe.slug);
          return;
        }
        var f = recipe.stockFormula || {};
        var minerals = Array.isArray(f.minerals)
          ? f.minerals
              .filter(function (m) {
                return m && typeof m === "object" && typeof m.mineralId === "string" && m.mineralId;
              })
              .map(function (m) {
                return { mineralId: m.mineralId, grams: Number(m.grams) || 0 };
              })
          : [];
        var recipeName = recipe.label || recipe.slug;
        window.openStockEditor({
          mode: "new-import",
          prefill: {
            label: recipeName,
            bottleMl: Number(f.bottleMl) || 0,
            doseGramsPerL: Number(f.doseGramsPerL) || 0,
            minerals: minerals,
            hint: "Imported from " + recipeName + ": review and tweak before saving.",
            importSlug: recipe.slug,
            source: typeof f.source === "string" ? f.source : "",
          },
          autoEnable: true,
          onSaved: function () {
            refetchAndRender();
          },
        });
      },
      // Same shape as onAddStock but the formula is derived from the
      // recipe's ion targets via deriveStockFormulaFromTarget rather than
      // copied from a hand-authored stockFormula. Derivation runs here at
      // click time so the editor opens with the current algorithm's output.
      onDeriveStock: function (recipe) {
        if (!recipe || !recipe.slug) return;
        if (
          typeof window.openStockEditor !== "function" ||
          typeof deriveStockFormulaFromTarget !== "function"
        ) {
          window.location.href = "minerals.html#stock-derive=" + encodeURIComponent(recipe.slug);
          return;
        }
        var derived = deriveStockFormulaFromTarget(recipe);
        var recipeName = recipe.label || recipe.slug;
        window.openStockEditor({
          mode: "new-derive",
          prefill: {
            label: recipeName,
            bottleMl: derived.bottleMl,
            doseGramsPerL: derived.doseGramsPerL,
            minerals: derived.minerals,
            hint:
              "Auto-derived from " + recipeName + "'s ion targets: review and tweak before saving.",
            notes: derived.notes || [],
            deriveSlug: recipe.slug,
          },
          autoEnable: true,
          onSaved: function () {
            refetchAndRender();
          },
        });
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
      onEditRecipe: function (recipe) {
        if (typeof window.openEditRecipeModal !== "function") return;
        window.openEditRecipeModal(recipe, {
          onSaved: function () {
            refetchAndRender();
          },
        });
      },
      onUnpublishRecipe: function (recipe) {
        if (typeof window.confirmUnpublish !== "function") return;
        window.confirmUnpublish(recipe, {
          onUnpublished: function () {
            // Optimistic removal: the Supabase update already landed, so
            // drop the row from local state before refetching. If the
            // refetch fails, the user still sees the expected result
            // rather than the row reappearing or the carousel going blank.
            allRecipes = allRecipes.filter(function (r) {
              return r.id !== recipe.id;
            });
            refetchAndRender();
          },
        });
      },
      onClearFilters: onClearFilters,
      onRetry: onRetry,
    };

    // Shared helper: re-fetch library rows after an owner-initiated mutation
    // so edits/unpublishes surface without a full page reload. Falls back
    // to the existing sync cache if the network fetch fails — never leaves
    // the content region stuck without a re-render.
    function refetchAndRender() {
      if (typeof window.fetchPublicRecipes !== "function") {
        render();
        return;
      }
      window
        .fetchPublicRecipes(true)
        .then(function (recipes) {
          allRecipes = Array.isArray(recipes) ? recipes : [];
          catalogLoaded = true;
          render();
        })
        .catch(function (err) {
          console.warn("[recipe-browser] refetch failed; falling back to cache:", err);
          if (typeof window.getPublicRecipesSync === "function") {
            var fallback = window.getPublicRecipesSync();
            // Only adopt the cache when it actually has data. The unpublish
            // and edit flows invalidate the public-recipes cache before
            // refetching, so a network failure here would otherwise replace
            // allRecipes with [] and blank the carousel. Preserving the
            // current state (which includes optimistic mutations) keeps
            // the UI consistent with what the user just did.
            if (Array.isArray(fallback) && fallback.length > 0) allRecipes = fallback;
          }
          // Optimistic: mutation already landed in Supabase; the cache may
          // be stale for a moment but the next library.html load will see
          // the write.
          catalogLoaded = true;
          render();
        });
    }

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

    function onClearFilters() {
      state = defaultFilters();
      searchSection.input.value = "";
      commit();
    }

    // Retry after a failed catalog load. Clear the error flag, re-render into
    // the silent loading state, then force a fresh fetch — the onLibraryData*
    // subscriptions below re-drive render() with the result (data or error).
    function onRetry() {
      loadFailed = false;
      render();
      if (typeof window.fetchPublicRecipes === "function") {
        window.fetchPublicRecipes(true);
      }
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
      var filtered = applyFilters(state, allRecipes, { isSaved: isSaved });
      summary.sync(filtered.length, allRecipes.length, hasAnyActiveFilter(state));
      renderContent(
        contentRoot,
        filtered,
        catalogLoaded,
        contentHandlers,
        state.method,
        loadFailed,
      );
    }

    // Re-render when the async library fetch completes. library.html warms the
    // fetch via ensurePublicRecipesLoaded() on DOMContentLoaded; we subscribe
    // to both outcomes so a failure surfaces a retry instead of hanging blank.
    if (typeof window.onLibraryDataLoaded === "function") {
      window.onLibraryDataLoaded(function (recipes) {
        allRecipes = Array.isArray(recipes) ? recipes : [];
        catalogLoaded = true;
        loadFailed = false;
        render();
      });
    }
    if (typeof window.onLibraryDataError === "function") {
      window.onLibraryDataError(function () {
        // Only show the error card if we have nothing to display; a populated
        // catalog (e.g. from a prior load) should stay visible.
        if (!catalogLoaded) {
          loadFailed = true;
          render();
        }
      });
    }

    // Cross-device sync: when sync.js receives a Realtime change for this
    // user, re-fetch the library. refetchAndRender invalidates the public-
    // recipes cache and rerenders, so a recipe edited / unpublished /
    // published on another device surfaces here within ~1 s. If the user
    // is mid-edit, defer — refetch will fire again on modal close, since
    // any save also dispatches cw:cloud-data-changed via storage writes.
    window.addEventListener("cw:cloud-data-changed", function () {
      if (window._cwEditModalOpenSlug) return;
      refetchAndRender();
    });

    // Handle browser back/forward restoring previous query strings.
    window.addEventListener("popstate", function () {
      state = readFiltersFromUrl();
      searchSection.input.value = state.q;
      render();
    });

    // Resolve current user so owner-only card affordances can appear. Async
    // — cards re-render once the user id is known. Anonymous visitors
    // never get owner buttons (currentUserId stays null).
    if (typeof getUser === "function") {
      getUser()
        .then(function (res) {
          var user = res && res.data && res.data.user;
          if (!user) return;
          currentUserId = user.id;
          render();
        })
        .catch(function () {
          // Silent failure — owner affordances simply don't appear.
        });
    }

    render();
  }

  // --- Exports -----------------------------------------------------------

  window.mountRecipeBrowser = mountRecipeBrowser;
  // window.applyFilters is exposed by library-data.js (shared with the modal).
  // E2E coverage: e2e/smoke-library.spec.ts applyFilters cases.
  window.readFiltersFromUrl = readFiltersFromUrl;
  window.writeFiltersToUrl = writeFiltersToUrl;
  // Internal export for e2e — lets the smoke spec assert the via:* metadata
  // filter without needing prod data to contain such a tag yet.
  window.__visibleChipTags = visibleChipTags;
})();
