// =============================================================================
// library-picker.js — Modal picker that adds a Recipe Library entry to the
// user's preset rail without leaving the current page.
//
// Used by index.html (Target Water Profile) and taste.html (Current Water
// Profile). Both sections are target-style profiles; library rows from
// fetchPublicRecipes() map 1:1 onto either rail via copyRecipeToMyProfiles().
// =============================================================================

(function () {
  "use strict";

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

  function renderEmpty(listEl, message) {
    listEl.innerHTML = "";
    var p = document.createElement("p");
    p.className = "library-picker-empty";
    p.textContent = message;
    listEl.appendChild(p);
  }

  // Build a single recipe card. Returns the root element so the caller can
  // append it. The Add button delegates to onAdd via the list-level click
  // handler (data-recipe-id), so each render is a single set of nodes — no
  // per-card listeners to clean up on close.
  function buildCard(recipe) {
    var card = document.createElement("div");
    card.className = "library-picker-card";
    card.dataset.recipeId = recipe.id;

    var info = document.createElement("div");
    info.className = "library-picker-card-info";

    var title = document.createElement("div");
    title.className = "library-picker-card-title";
    title.textContent = recipe.label;
    info.appendChild(title);

    var meta = document.createElement("div");
    meta.className = "library-picker-card-meta";
    meta.textContent = creatorLine(recipe) + " · " + brewMethodLabel(recipe.brewMethod);
    info.appendChild(meta);

    var ions = document.createElement("div");
    ions.className = "library-picker-card-ions";
    ions.textContent = ionsSummary(recipe);
    info.appendChild(ions);

    card.appendChild(info);

    var action = document.createElement("button");
    action.type = "button";
    action.className = "preset-btn library-picker-card-action";
    var alreadyAdded = typeof window.isRecipeInMyProfiles === "function"
      && window.isRecipeInMyProfiles(recipe);
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

  function renderList(listEl, recipes, brewMethod) {
    var filtered = recipes.filter(function (r) {
      return (r.brewMethod || "filter") === brewMethod;
    });
    if (filtered.length === 0) {
      renderEmpty(listEl, "No " + brewMethodLabel(brewMethod).toLowerCase() + " recipes in the library yet.");
      return;
    }
    listEl.innerHTML = "";
    filtered.forEach(function (r) {
      listEl.appendChild(buildCard(r));
    });
  }

  // Public entry: open the picker. options:
  //   brewMethod: "filter" | "espresso" — restricts the list to recipes for
  //               the section's currently-active brew method. Required.
  //   onAdd:     function(slug, recipe) — fires after copyRecipeToMyProfiles
  //              succeeds. The host page should re-render its preset rail
  //              and activate the slug. Required.
  //   title:     optional override for the dialog heading.
  function showLibraryPicker(options) {
    options = options || {};
    var brewMethod = options.brewMethod === "espresso" ? "espresso" : "filter";
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
    var previousFocus = document.activeElement;

    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "library-picker-title");
    titleEl.textContent = title;

    // Cached snapshot first for instant render; the live fetch below updates
    // the list once it resolves (no flicker if cache is already warm).
    var initial = typeof window.getPublicRecipesSync === "function"
      ? window.getPublicRecipesSync()
      : [];
    if (initial && initial.length) {
      renderList(listEl, initial, brewMethod);
    } else {
      renderEmpty(listEl, "Loading library…");
    }

    overlay.style.display = "flex";
    closeBtn.focus();

    if (typeof window.fetchPublicRecipes === "function") {
      window.fetchPublicRecipes(false).then(function (recipes) {
        if (overlay.style.display === "none") return;
        renderList(listEl, recipes || [], brewMethod);
      }).catch(function (e) {
        console.warn("[library-picker] fetch failed:", e);
      });
    }

    function close() {
      overlay.style.display = "none";
      overlay.removeEventListener("click", overlayClick);
      listEl.removeEventListener("click", listClick);
      closeBtn.removeEventListener("click", close);
      document.removeEventListener("keydown", keyHandler);
      pickerCleanup = null;
      if (previousFocus && previousFocus.focus) previousFocus.focus();
    }

    function listClick(e) {
      var actionBtn = e.target.closest("[data-add-recipe-id]");
      if (!actionBtn) return;
      var id = actionBtn.dataset.addRecipeId;
      var recipes = (typeof window.getPublicRecipesSync === "function"
        ? window.getPublicRecipesSync() : []) || [];
      var recipe = null;
      for (var i = 0; i < recipes.length; i++) {
        if (String(recipes[i].id) === String(id)) { recipe = recipes[i]; break; }
      }
      if (!recipe) return;
      if (typeof window.copyRecipeToMyProfiles !== "function") return;
      var slug = window.copyRecipeToMyProfiles(recipe);
      if (!slug) return;
      close();
      onAdd(slug, recipe);
    }

    function overlayClick(e) {
      if (e.target === overlay) close();
    }

    function keyHandler(e) {
      if (e.key === "Escape") { close(); return; }
      if (e.key !== "Tab") return;
      // Focus trap: cycle within the dialog. Build the list fresh so newly
      // rendered cards from the async fetch are included.
      var focusables = dialog.querySelectorAll(
        "button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
      );
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
    listEl.addEventListener("click", listClick);
    closeBtn.addEventListener("click", close);
    document.addEventListener("keydown", keyHandler);
  }

  window.showLibraryPicker = showLibraryPicker;
})();
