// =============================================================================
// my-recipes-ui.js — Owner affordances on library cards (edit + unpublish).
//
// Restores the edit-recipe modal and unpublish flow that were deleted in the
// Wave D5 cut-over (commit 028fc89). The UI surface is narrower than the
// old library-ui.js: no browsing logic, no add-to-my-profiles — just the two
// owner-only actions. Recipe-browser.js opens these when the user is the row
// creator (recipe.userId === currentUserId).
//
// DOM is built dynamically at open time so library.html stays lean.
// =============================================================================

(function () {
  "use strict";

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  var ION_FIELDS_LOCAL = [
    { field: "calcium", label: "Calcium" },
    { field: "magnesium", label: "Magnesium" },
    { field: "alkalinity", label: "Alkalinity (as CaCO₃)" },
    { field: "potassium", label: "Potassium" },
    { field: "sodium", label: "Sodium" },
    { field: "sulfate", label: "Sulfate" },
    { field: "chloride", label: "Chloride" },
    { field: "bicarbonate", label: "Bicarbonate" },
  ];

  var BREW_METHODS = [
    { value: "filter", label: "Filter" },
    { value: "espresso", label: "Espresso" },
  ];

  // --- Edit modal -------------------------------------------------------

  // openEditRecipeModal(recipe, { onSaved })
  // Opens a centered modal pre-populated with the recipe's current fields.
  // Saving updates Supabase + localStorage; onSaved is called after a
  // successful save (before the modal closes). Returns a close() handle.
  function openEditRecipeModal(recipe, options) {
    options = options || {};
    var onSaved = typeof options.onSaved === "function" ? options.onSaved : null;

    // Cleanup any prior modal (defensive — shouldn't happen in practice).
    var existing = document.querySelector(".rx-edit-overlay");
    if (existing) existing.remove();

    var overlay = el("div", "rx-edit-overlay");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Edit recipe");

    var dialog = el("div", "rx-edit-dialog");
    overlay.appendChild(dialog);

    dialog.appendChild(el("h3", "rx-edit-title", "Edit recipe"));

    // --- Name ---
    var nameField = el("div", "rx-edit-field");
    nameField.appendChild(el("label", "rx-edit-label", "Name"));
    var nameInput = el("input", "rx-edit-input");
    nameInput.type = "text";
    nameInput.maxLength = 40;
    nameInput.value = recipe.label || "";
    nameField.appendChild(nameInput);
    dialog.appendChild(nameField);

    // --- Description ---
    var descField = el("div", "rx-edit-field");
    descField.appendChild(el("label", "rx-edit-label", "Description"));
    var descInput = el("textarea", "rx-edit-input rx-edit-textarea");
    descInput.rows = 2;
    descInput.maxLength = 200;
    descInput.value = recipe.description || "";
    descField.appendChild(descInput);
    dialog.appendChild(descField);

    // --- Brew method ---
    var methodField = el("div", "rx-edit-field");
    methodField.appendChild(el("label", "rx-edit-label", "Brew method"));
    var methodGroup = el("div", "rx-edit-method");
    var currentMethod = recipe.brewMethod === "espresso" ? "espresso" : "filter";
    var methodButtons = [];
    BREW_METHODS.forEach(function (opt) {
      var btn = el("button", "rx-edit-method-btn", opt.label);
      btn.type = "button";
      btn.dataset.value = opt.value;
      if (opt.value === currentMethod) btn.classList.add("is-active");
      btn.addEventListener("click", function () {
        currentMethod = opt.value;
        methodButtons.forEach(function (b) {
          b.classList.toggle("is-active", b.dataset.value === currentMethod);
        });
      });
      methodGroup.appendChild(btn);
      methodButtons.push(btn);
    });
    methodField.appendChild(methodGroup);
    dialog.appendChild(methodField);

    // --- Minerals grid ---
    dialog.appendChild(el("label", "rx-edit-label", "Minerals (mg/L)"));
    var ionsGrid = el("div", "rx-edit-ions");
    var ionInputs = {};
    ION_FIELDS_LOCAL.forEach(function (ion) {
      var wrap = el("div", "rx-edit-ion");
      wrap.appendChild(el("label", "rx-edit-ion-label", ion.label));
      var input = el("input", "rx-edit-input");
      input.type = "number";
      input.min = "0";
      input.step = "1";
      input.value = Math.round(recipe[ion.field] || 0);
      wrap.appendChild(input);
      ionsGrid.appendChild(wrap);
      ionInputs[ion.field] = input;
    });
    dialog.appendChild(ionsGrid);

    // --- Tags ---
    dialog.appendChild(el("label", "rx-edit-label", "Flavor tags"));
    var tagGroup = el("div", "rx-edit-tags");
    var activeTags = (Array.isArray(recipe.tags) ? recipe.tags : []).slice();
    var canonicalTags =
      typeof LIBRARY_TAGS !== "undefined" && Array.isArray(LIBRARY_TAGS) ? LIBRARY_TAGS : [];
    canonicalTags.forEach(function (tag) {
      var chip = el("button", "rx-edit-tag-chip", tag);
      chip.type = "button";
      if (activeTags.indexOf(tag) !== -1) chip.classList.add("is-active");
      chip.addEventListener("click", function () {
        var idx = activeTags.indexOf(tag);
        if (idx === -1) activeTags.push(tag);
        else activeTags.splice(idx, 1);
        chip.classList.toggle("is-active");
      });
      tagGroup.appendChild(chip);
    });
    dialog.appendChild(tagGroup);

    // --- Error + actions ---
    var errorEl = el("div", "rx-edit-error");
    errorEl.setAttribute("role", "alert");
    dialog.appendChild(errorEl);

    var actions = el("div", "rx-edit-actions");
    var saveBtn = el("button", "rx-edit-save", "Save");
    saveBtn.type = "button";
    var cancelBtn = el("button", "rx-edit-cancel", "Cancel");
    cancelBtn.type = "button";
    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    dialog.appendChild(actions);

    function close() {
      document.removeEventListener("keydown", keyHandler);
      overlay.removeEventListener("click", overlayClickHandler);
      overlay.remove();
    }

    function keyHandler(e) {
      if (e.key === "Escape") close();
    }

    function overlayClickHandler(e) {
      if (e.target === overlay) close();
    }

    cancelBtn.addEventListener("click", close);
    saveBtn.addEventListener("click", function () {
      save(recipe, {
        name: nameInput.value,
        description: descInput.value,
        brewMethod: currentMethod,
        ionInputs: ionInputs,
        tags: activeTags,
        errorEl: errorEl,
        saveBtn: saveBtn,
        close: close,
        onSaved: onSaved,
      });
    });

    document.addEventListener("keydown", keyHandler);
    overlay.addEventListener("click", overlayClickHandler);

    document.body.appendChild(overlay);
    nameInput.focus();
    nameInput.select();

    return close;
  }

  function save(recipe, ctx) {
    var name = (ctx.name || "").trim();
    if (!name) {
      ctx.errorEl.textContent = "Recipe name is required.";
      return;
    }

    var newSlug =
      typeof slugify === "function"
        ? slugify(name)
        : name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (!newSlug) {
      ctx.errorEl.textContent = "Enter a valid name.";
      return;
    }

    // Slug conflict check if the user renamed the recipe.
    if (newSlug !== recipe.slug && typeof loadCustomTargetProfiles === "function") {
      var profiles = loadCustomTargetProfiles();
      var reserved = typeof RESERVED_TARGET_KEYS !== "undefined" ? RESERVED_TARGET_KEYS : null;
      var reservedHit = reserved && typeof reserved.has === "function" && reserved.has(newSlug);
      if (profiles[newSlug] || reservedHit) {
        ctx.errorEl.textContent = "A recipe with this name already exists.";
        return;
      }
    }

    ctx.errorEl.textContent = "";
    ctx.saveBtn.disabled = true;
    ctx.saveBtn.textContent = "Saving…";

    var updated = {
      label: name,
      description: (ctx.description || "").trim(),
      brewMethod: ctx.brewMethod,
      calcium: parseFloat(ctx.ionInputs.calcium.value) || 0,
      magnesium: parseFloat(ctx.ionInputs.magnesium.value) || 0,
      alkalinity: parseFloat(ctx.ionInputs.alkalinity.value) || 0,
      potassium: parseFloat(ctx.ionInputs.potassium.value) || 0,
      sodium: parseFloat(ctx.ionInputs.sodium.value) || 0,
      sulfate: parseFloat(ctx.ionInputs.sulfate.value) || 0,
      chloride: parseFloat(ctx.ionInputs.chloride.value) || 0,
      bicarbonate: parseFloat(ctx.ionInputs.bicarbonate.value) || 0,
      tags: ctx.tags.slice(),
      isPublic: true,
    };

    // Local-storage mirror so the preset rail stays in sync without a round
    // trip. Matches the old library-ui.js semantics.
    if (
      typeof loadCustomTargetProfiles === "function" &&
      typeof saveCustomTargetProfiles === "function"
    ) {
      var localProfiles = loadCustomTargetProfiles();
      var existing = localProfiles[recipe.slug] || {};
      if (newSlug !== recipe.slug) delete localProfiles[recipe.slug];
      localProfiles[newSlug] = Object.assign({}, existing, updated, {
        creatorDisplayName: existing.creatorDisplayName || recipe.creatorDisplayName || "",
      });
      saveCustomTargetProfiles(localProfiles);
    }

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
      updated_at: new Date().toISOString(),
    };

    if (typeof window.supabaseClient === "undefined") {
      // Offline / no client — local save already happened; treat as success.
      finish();
      return;
    }

    window.supabaseClient
      .from("target_profiles")
      .update(supabasePayload)
      .eq("id", recipe.id)
      .then(function (result) {
        if (result.error) {
          console.warn("[my-recipes] edit update failed:", result.error);
          ctx.errorEl.textContent = "Failed to save changes. Please try again.";
          ctx.saveBtn.disabled = false;
          ctx.saveBtn.textContent = "Save";
          return;
        }
        finish();
      });

    function finish() {
      if (typeof window.invalidatePublicRecipesCache === "function") {
        window.invalidatePublicRecipesCache();
      }
      if (ctx.onSaved) ctx.onSaved();
      ctx.close();
    }
  }

  // --- Unpublish -------------------------------------------------------

  // confirmUnpublish(recipe, { onUnpublished })
  // Asks the user to confirm, then flips is_public=false in Supabase and
  // mirrors the change into localStorage. onUnpublished fires on success.
  function confirmUnpublish(recipe, options) {
    options = options || {};
    var onUnpublished = typeof options.onUnpublished === "function" ? options.onUnpublished : null;

    var confirmFn =
      typeof options.confirm === "function" ? options.confirm : window.confirm.bind(window);
    var ok = confirmFn('Unpublish "' + (recipe.label || "") + '" from the Recipe Library?');
    if (!ok) return;

    // localStorage mirror — keep the preset rail in sync.
    if (
      typeof loadCustomTargetProfiles === "function" &&
      typeof saveCustomTargetProfiles === "function" &&
      recipe.slug
    ) {
      var profiles = loadCustomTargetProfiles();
      if (profiles[recipe.slug]) {
        profiles[recipe.slug].isPublic = false;
        saveCustomTargetProfiles(profiles);
      }
    }

    if (typeof window.supabaseClient === "undefined") {
      finish();
      return;
    }

    window.supabaseClient
      .from("target_profiles")
      .update({ is_public: false })
      .eq("id", recipe.id)
      .then(function (result) {
        if (result.error) {
          console.warn("[my-recipes] unpublish failed:", result.error);
          return;
        }
        finish();
      });

    function finish() {
      if (typeof window.invalidatePublicRecipesCache === "function") {
        window.invalidatePublicRecipesCache();
      }
      if (onUnpublished) onUnpublished();
    }
  }

  // --- Exports ---------------------------------------------------------

  window.openEditRecipeModal = openEditRecipeModal;
  window.confirmUnpublish = confirmUnpublish;
})();
