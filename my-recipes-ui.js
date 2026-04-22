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

  // Button-styled checkbox used by the multi-select rows (brew method,
  // roast level). The visual "checkbox" is a span inside the button so
  // the hit target is the full button. onToggle receives the new active
  // state after the click.
  function createCheckButton(label, value, initialActive, onToggle) {
    var btn = el("button", "rx-edit-check-btn");
    btn.type = "button";
    btn.dataset.value = value;
    btn.setAttribute("aria-pressed", initialActive ? "true" : "false");
    var box = el("span", "rx-edit-check-box");
    var text = el("span", "rx-edit-check-label", label);
    btn.appendChild(box);
    btn.appendChild(text);
    if (initialActive) btn.classList.add("is-active");
    btn.addEventListener("click", function () {
      var nowActive = !btn.classList.contains("is-active");
      btn.classList.toggle("is-active", nowActive);
      btn.setAttribute("aria-pressed", nowActive ? "true" : "false");
      onToggle(nowActive);
    });
    return btn;
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

  var ROAST_LEVELS = [
    { value: "light", label: "Light" },
    { value: "medium", label: "Medium" },
    { value: "dark", label: "Dark" },
  ];

  // Decode the stored brewMethod string into a pair of checkbox states.
  // 'all' means both methods; 'filter' / 'espresso' are single-select;
  // anything else (including undefined) defaults to filter-only so the
  // modal opens with at least one method selected.
  function decodeBrewMethods(brewMethod) {
    if (brewMethod === "all") return ["filter", "espresso"];
    if (brewMethod === "espresso") return ["espresso"];
    return ["filter"];
  }

  // Decode the stored roast array into checkbox states. The sentinel
  // ['all'] (seeded by migration 006 for legacy rows) expands to all
  // three levels so the user sees them pre-checked rather than none.
  // Canonical order + dedup so duplicate input (e.g. ['light','light'])
  // can't desync the UI toggle state from the saved payload.
  function decodeRoastLevels(roast) {
    if (!Array.isArray(roast) || roast.length === 0) return ["light", "medium", "dark"];
    if (roast.indexOf("all") !== -1) return ["light", "medium", "dark"];
    var seen = {};
    var out = [];
    ["light", "medium", "dark"].forEach(function (level) {
      if (roast.indexOf(level) !== -1 && !seen[level]) {
        seen[level] = true;
        out.push(level);
      }
    });
    return out;
  }

  // Encode the user's method selection back to the single-string form the
  // schema uses. Both checked → 'all'; one checked → that one. Zero
  // checked is blocked by the save-time validator.
  function encodeBrewMethod(selected) {
    if (selected.length >= 2) return "all";
    return selected[0] || "filter";
  }

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

    // --- Brew method (multi-select) ---
    // Both 'filter' and 'espresso' can be checked simultaneously; two
    // checked encodes to brew_method='all' on save. At least one must be
    // selected (validated at save time).
    var activeMethods = decodeBrewMethods(recipe.brewMethod).slice();
    var methodField = el("div", "rx-edit-field");
    methodField.appendChild(el("label", "rx-edit-label", "Brew method"));
    var methodGroup = el("div", "rx-edit-method");
    BREW_METHODS.forEach(function (opt) {
      methodGroup.appendChild(
        createCheckButton(
          opt.label,
          opt.value,
          activeMethods.indexOf(opt.value) !== -1,
          function (isActive) {
            var idx = activeMethods.indexOf(opt.value);
            if (isActive && idx === -1) activeMethods.push(opt.value);
            if (!isActive && idx !== -1) activeMethods.splice(idx, 1);
          },
        ),
      );
    });
    methodField.appendChild(methodGroup);
    dialog.appendChild(methodField);

    // --- Roast level (multi-select) ---
    // Same checkbox pattern. Saves as a plain array (['light'], ['light',
    // 'medium'], etc.) — the 'all' sentinel is preserved for canonical
    // library rows via migration 006 and intentionally isn't produced
    // from UI edits, so what-you-see-is-what-you-save.
    var activeRoasts = decodeRoastLevels(recipe.roast).slice();
    var roastField = el("div", "rx-edit-field");
    roastField.appendChild(el("label", "rx-edit-label", "Roast level"));
    var roastGroup = el("div", "rx-edit-roast");
    ROAST_LEVELS.forEach(function (opt) {
      roastGroup.appendChild(
        createCheckButton(
          opt.label,
          opt.value,
          activeRoasts.indexOf(opt.value) !== -1,
          function (isActive) {
            var idx = activeRoasts.indexOf(opt.value);
            if (isActive && idx === -1) activeRoasts.push(opt.value);
            if (!isActive && idx !== -1) activeRoasts.splice(idx, 1);
          },
        ),
      );
    });
    roastField.appendChild(roastGroup);
    dialog.appendChild(roastField);

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
        methods: activeMethods,
        roasts: activeRoasts,
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

    // Multi-select validation. Both fields must have at least one option
    // checked — otherwise the row's filtering behavior would be ambiguous
    // (empty method = matches nothing, empty roast = matches everything
    // in a confusing way).
    if (!Array.isArray(ctx.methods) || ctx.methods.length === 0) {
      ctx.errorEl.textContent = "Select at least one brew method.";
      return;
    }
    if (!Array.isArray(ctx.roasts) || ctx.roasts.length === 0) {
      ctx.errorEl.textContent = "Select at least one roast level.";
      return;
    }

    ctx.errorEl.textContent = "";
    ctx.saveBtn.disabled = true;
    ctx.saveBtn.textContent = "Saving…";

    // Ion inputs are type="number" min="0" but users can still paste a
    // negative value through the DOM. Clamp on the way out so a malformed
    // entry never reaches Supabase.
    function nonNeg(input) {
      var v = parseFloat(input.value);
      if (isNaN(v)) return 0;
      return Math.max(0, v);
    }

    var updated = {
      label: name,
      description: (ctx.description || "").trim(),
      brewMethod: encodeBrewMethod(ctx.methods),
      roast: ctx.roasts.slice(),
      calcium: nonNeg(ctx.ionInputs.calcium),
      magnesium: nonNeg(ctx.ionInputs.magnesium),
      alkalinity: nonNeg(ctx.ionInputs.alkalinity),
      potassium: nonNeg(ctx.ionInputs.potassium),
      sodium: nonNeg(ctx.ionInputs.sodium),
      sulfate: nonNeg(ctx.ionInputs.sulfate),
      chloride: nonNeg(ctx.ionInputs.chloride),
      bicarbonate: nonNeg(ctx.ionInputs.bicarbonate),
      tags: ctx.tags.slice(),
      isPublic: true,
    };

    // Mirror into the preset rail's local cache. Deliberately runs AFTER
    // the remote write lands (see applyLocalMirror below) so a Supabase
    // failure doesn't leave localStorage claiming a save that didn't
    // actually happen.
    function applyLocalMirror() {
      if (
        typeof loadCustomTargetProfiles !== "function" ||
        typeof saveCustomTargetProfiles !== "function"
      ) {
        return;
      }
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
      roast: updated.roast,
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
      // Offline / no client — localStorage is the only source of truth.
      // Apply the mirror and treat as success.
      applyLocalMirror();
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
        // Remote write landed — now sync the local mirror.
        applyLocalMirror();
        finish();
      })
      .catch(function (err) {
        console.warn("[my-recipes] edit update threw:", err);
        ctx.errorEl.textContent = "Failed to save changes. Please try again.";
        ctx.saveBtn.disabled = false;
        ctx.saveBtn.textContent = "Save";
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

    // Mirror into localStorage only after the remote update lands. Earlier
    // versions flipped local first, which desynced the preset rail from
    // Supabase whenever the write failed.
    function applyLocalMirror() {
      if (
        typeof loadCustomTargetProfiles !== "function" ||
        typeof saveCustomTargetProfiles !== "function" ||
        !recipe.slug
      ) {
        return;
      }
      var profiles = loadCustomTargetProfiles();
      if (profiles[recipe.slug]) {
        profiles[recipe.slug].isPublic = false;
        saveCustomTargetProfiles(profiles);
      }
    }

    if (typeof window.supabaseClient === "undefined") {
      applyLocalMirror();
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
        applyLocalMirror();
        finish();
      })
      .catch(function (err) {
        console.warn("[my-recipes] unpublish threw:", err);
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
