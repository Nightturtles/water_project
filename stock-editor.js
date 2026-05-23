// =============================================================================
// stock-editor.js — Modal editor for stock concentrate solutions.
//
// Exposes window.openStockEditor({ mode, slug?, prefill?, autoEnable?, onSaved? })
// for four entry points:
//   - "+ Create Concentrate" inside the mineral selector modal
//   - Edit pencil on each recipe-concentrate row inside the mineral selector
//   - "+ Create Concentrate" on library recipe cards (both states:
//     adopting an authored stock formula and deriving one from recipe targets)
//
// Renders an overlay above any open dialog (z-index 210) and reuses the
// library-picker-dialog CSS chrome. All save logic mirrors the inline editor
// in minerals.html (renderStockNewForm, save handler at minerals.html ~1225):
// same validation gates, same RESERVED_LIBRARY_STOCK_SLUGS rule, same
// createdFrom round-trip, same call to saveStockConcentrateSpecs. The inline
// editor in minerals.html is left untouched for this PR; consolidating is a
// follow-up.
// =============================================================================

(function () {
  "use strict";

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function uniqueStockSlug(baseSlug, existingSlugs) {
    var base = baseSlug || "stock";
    var taken = new Set(existingSlugs);
    RESERVED_LIBRARY_STOCK_SLUGS.forEach(function (s) {
      taken.add(s);
    });
    if (!taken.has(base)) return base;
    var i = 2;
    while (taken.has(base + "-" + i)) i++;
    return base + "-" + i;
  }

  function getSolubilityLimitGPerL(mineralId) {
    var v =
      typeof MINERAL_SOLUBILITY_G_PER_L_25C_APPROX !== "undefined" &&
      MINERAL_SOLUBILITY_G_PER_L_25C_APPROX
        ? MINERAL_SOLUBILITY_G_PER_L_25C_APPROX[mineralId]
        : null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function getOverLimitMineralIds(spec) {
    if (!spec || !Array.isArray(spec.minerals)) return [];
    var bottleMl = Math.max(0, Number(spec.bottleMl) || 0);
    if (bottleMl <= 0) return [];
    var liters = bottleMl / 1000;
    var out = [];
    for (var i = 0; i < spec.minerals.length; i++) {
      var entry = spec.minerals[i];
      if (!entry || typeof entry !== "object") continue;
      var limit = getSolubilityLimitGPerL(entry.mineralId);
      if (limit == null) continue;
      var grams = Math.max(0, Number(entry.grams) || 0);
      if (grams <= 0) continue;
      if (grams / liters >= limit) out.push(entry.mineralId);
    }
    return out;
  }

  function buildMineralOptionsHtml(selectedMineralId) {
    var html = '<option value="">- Pick a mineral -</option>';
    if (typeof MINERAL_DB === "undefined" || !MINERAL_DB) return html;
    for (var mid in MINERAL_DB) {
      if (!Object.prototype.hasOwnProperty.call(MINERAL_DB, mid)) continue;
      var sel = mid === selectedMineralId ? " selected" : "";
      html +=
        '<option value="' + mid + '"' + sel + ">" + escapeHtml(MINERAL_DB[mid].name) + "</option>";
    }
    return html;
  }

  // ---- Modal state (one editor open at a time) ----

  var overlayEl = null;
  var dialogEl = null;
  var formEl = null;
  var errorEl = null;
  var warningEl = null;
  var titleEl = null;
  var deleteBtn = null;
  var closeBtn = null;
  var previousFocus = null;
  var keyHandler = null;
  var overlayClickHandler = null;
  var session = null;

  function ensureOverlay() {
    if (overlayEl) return;
    overlayEl = document.createElement("div");
    overlayEl.className = "library-picker-overlay stock-editor-overlay";
    overlayEl.style.display = "none";

    dialogEl = document.createElement("div");
    dialogEl.className = "library-picker-dialog stock-editor-dialog";
    dialogEl.setAttribute("role", "dialog");
    dialogEl.setAttribute("aria-modal", "true");
    dialogEl.setAttribute("aria-labelledby", "stock-editor-title");

    closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "library-picker-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "×";
    dialogEl.appendChild(closeBtn);

    titleEl = document.createElement("h2");
    titleEl.id = "stock-editor-title";
    titleEl.className = "library-picker-title";
    titleEl.textContent = "Recipe concentrate";
    dialogEl.appendChild(titleEl);

    formEl = document.createElement("div");
    formEl.className = "stock-editor-form";
    dialogEl.appendChild(formEl);

    overlayEl.appendChild(dialogEl);
    document.body.appendChild(overlayEl);
  }

  function buildMineralListHtml(minerals) {
    if (!minerals || minerals.length === 0) {
      return '<p class="hint stock-pane-empty">No minerals yet. Click "+ Add mineral" below.</p>';
    }
    var html = "";
    for (var idx = 0; idx < minerals.length; idx++) {
      var entry = minerals[idx];
      var grams = Number.isFinite(Number(entry.grams)) ? Number(entry.grams) : 0;
      html +=
        '<div class="stock-mineral-row" data-mineral-idx="' +
        idx +
        '">' +
        '<select data-field="mineral-id">' +
        buildMineralOptionsHtml(entry.mineralId) +
        "</select>" +
        '<div class="input-with-suffix">' +
        '<input type="number" min="0" step="0.01" value="' +
        grams +
        '" data-field="mineral-grams" placeholder="grams">' +
        '<span class="input-suffix" aria-hidden="true">g</span>' +
        "</div>" +
        '<button type="button" class="stock-mineral-remove" data-action="remove-mineral" aria-label="Remove mineral">×</button>' +
        "</div>";
    }
    return html;
  }

  function refreshMineralList() {
    var listEl = formEl.querySelector(".stock-editor-mineral-list");
    if (!listEl) return;
    listEl.innerHTML = buildMineralListHtml(session.minerals);
  }

  function renderForm() {
    var label = session.label != null ? String(session.label) : "";
    var bottleMl =
      Number.isFinite(Number(session.bottleMl)) && Number(session.bottleMl) > 0
        ? Number(session.bottleMl)
        : 200;
    var doseGramsPerL =
      Number.isFinite(Number(session.doseGramsPerL)) && Number(session.doseGramsPerL) > 0
        ? Number(session.doseGramsPerL)
        : 4;
    var hintHtml = session.hint
      ? '<p class="hint stock-derive-hint">' + escapeHtml(session.hint) + "</p>"
      : "";
    var notesHtml =
      Array.isArray(session.notes) && session.notes.length
        ? session.notes
            .map(function (n) {
              return '<p class="hint stock-derive-note">' + escapeHtml(String(n)) + "</p>";
            })
            .join("")
        : "";

    formEl.innerHTML =
      hintHtml +
      notesHtml +
      '<div class="input-group">' +
      '<label for="stock-editor-label">Name</label>' +
      '<input type="text" id="stock-editor-label" placeholder="My Concentrate" value="' +
      escapeHtml(label) +
      '">' +
      "</div>" +
      '<div class="concentrate-inputs">' +
      '<div class="input-group">' +
      '<label for="stock-editor-bottle-ml">Bottle mL</label>' +
      '<input type="number" id="stock-editor-bottle-ml" min="0" step="1" value="' +
      bottleMl +
      '">' +
      "</div>" +
      '<div class="input-group">' +
      '<label for="stock-editor-dose">Dose g/L</label>' +
      '<input type="number" id="stock-editor-dose" min="0" step="0.01" value="' +
      doseGramsPerL +
      '">' +
      "</div>" +
      "</div>" +
      '<div class="stock-mineral-list stock-editor-mineral-list">' +
      buildMineralListHtml(session.minerals) +
      "</div>" +
      '<button type="button" class="preset-btn stock-add-mineral-btn" data-action="add-mineral">+ Add mineral</button>' +
      '<div class="concentrate-warning stock-editor-warning" hidden></div>' +
      '<div class="stock-editor-actions">' +
      '<button type="button" class="preset-btn primary" data-action="save">Save</button>' +
      '<button type="button" class="preset-btn" data-action="cancel">Cancel</button>' +
      (session.mode === "edit"
        ? '<button type="button" class="preset-btn stock-editor-delete" data-action="delete">Delete</button>'
        : "") +
      "</div>" +
      '<div class="stock-new-error stock-editor-error" hidden></div>';

    errorEl = formEl.querySelector(".stock-editor-error");
    warningEl = formEl.querySelector(".stock-editor-warning");
    updateWarning();
  }

  function showError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg || "";
    errorEl.hidden = !msg;
  }

  function updateWarning() {
    if (!warningEl) return;
    var draft = readDraftFromForm();
    var overLimitIds = getOverLimitMineralIds(draft);
    if (overLimitIds.length === 0) {
      warningEl.hidden = true;
      warningEl.textContent = "";
      return;
    }
    var names = overLimitIds.map(function (mid) {
      return (typeof MINERAL_DB !== "undefined" && MINERAL_DB[mid] && MINERAL_DB[mid].name) || mid;
    });
    warningEl.hidden = false;
    warningEl.textContent =
      "Above solubility limit for " +
      names.join(", ") +
      ". Try a larger bottle volume or fewer grams.";
  }

  function readDraftFromForm() {
    var labelInput = formEl.querySelector("#stock-editor-label");
    var bottleInput = formEl.querySelector("#stock-editor-bottle-ml");
    var doseInput = formEl.querySelector("#stock-editor-dose");
    return {
      label: labelInput ? labelInput.value.trim() : "",
      bottleMl: bottleInput ? Math.max(0, parseFloat(bottleInput.value) || 0) : 0,
      doseGramsPerL: doseInput ? Math.max(0, parseFloat(doseInput.value) || 0) : 0,
      minerals: session.minerals.slice(),
    };
  }

  function attachFormHandlers() {
    formEl.addEventListener("click", function (e) {
      var target = e.target instanceof HTMLElement ? e.target : null;
      if (!target) return;
      var action = target.dataset.action;
      if (!action) return;

      if (action === "add-mineral") {
        session.minerals.push({ mineralId: "", grams: 0 });
        refreshMineralList();
        var lastSel = formEl.querySelector(
          '.stock-mineral-row[data-mineral-idx="' + (session.minerals.length - 1) + '"] select',
        );
        if (lastSel) lastSel.focus();
        updateWarning();
        return;
      }

      if (action === "remove-mineral") {
        var row = target.closest(".stock-mineral-row");
        if (!row) return;
        var idx = parseInt(row.dataset.mineralIdx, 10);
        if (Number.isNaN(idx)) return;
        session.minerals.splice(idx, 1);
        refreshMineralList();
        updateWarning();
        return;
      }

      if (action === "save") {
        handleSave();
        return;
      }

      if (action === "cancel") {
        closeEditor();
        return;
      }

      if (action === "delete") {
        handleDelete();
        return;
      }
    });

    formEl.addEventListener("change", function (e) {
      var target = e.target;
      if (target.tagName === "SELECT" && target.dataset.field === "mineral-id") {
        var row = target.closest(".stock-mineral-row");
        if (!row) return;
        var idx = parseInt(row.dataset.mineralIdx, 10);
        if (Number.isNaN(idx) || !session.minerals[idx]) return;
        session.minerals[idx].mineralId = target.value;
        updateWarning();
      }
    });

    formEl.addEventListener("input", function (e) {
      var target = e.target;
      if (!target || target.tagName !== "INPUT") return;
      if (target.dataset.field === "mineral-grams") {
        var row = target.closest(".stock-mineral-row");
        if (!row) return;
        var idx = parseInt(row.dataset.mineralIdx, 10);
        if (Number.isNaN(idx) || !session.minerals[idx]) return;
        session.minerals[idx].grams = Math.max(0, parseFloat(target.value) || 0);
        updateWarning();
      } else if (target.id === "stock-editor-bottle-ml" || target.id === "stock-editor-dose") {
        updateWarning();
      }
    });
  }

  function handleSave() {
    // Mirror the gate from minerals.html:1229: applyAuthGate locks the
    // OPENER button, but library-card import buttons can open this editor
    // from a path that bypasses the gate (the gate is on the import button
    // itself, but a logout after open would leave the save unlocked).
    if (typeof window.isLoggedInSync === "function" && !window.isLoggedInSync()) {
      if (typeof window.openLoginModal === "function") {
        window.openLoginModal({ reason: "save-stock" });
      }
      return;
    }

    var draft = readDraftFromForm();
    if (!draft.label) {
      showError("Please enter a name.");
      return;
    }
    if (draft.bottleMl <= 0) {
      showError("Bottle volume must be greater than 0.");
      return;
    }
    if (draft.doseGramsPerL <= 0) {
      showError("Dose must be greater than 0.");
      return;
    }
    if (!draft.minerals || draft.minerals.length === 0) {
      showError("Add at least one mineral.");
      return;
    }
    var cleaned = [];
    for (var i = 0; i < draft.minerals.length; i++) {
      var m = draft.minerals[i];
      if (!m || !m.mineralId) {
        showError("All mineral rows need a mineral selected.");
        return;
      }
      if (!(Number(m.grams) > 0)) {
        showError("All mineral rows need a positive grams value.");
        return;
      }
      cleaned.push({ mineralId: m.mineralId, grams: Number(m.grams) });
    }

    var specs = loadStockConcentrateSpecs();
    var finalSlug;
    if (session.mode === "edit") {
      finalSlug = session.editSlug;
    } else if (session.importSlug) {
      // Library-import path keys under the library slug verbatim so the
      // recipe card's hasOwn(specs, recipe.slug) check flips to "In your
      // pantry" on the next render. Block re-importing the same slug to
      // match minerals.html:1261.
      if (Object.prototype.hasOwnProperty.call(specs, session.importSlug)) {
        showError("This library stock is already in your pantry.");
        return;
      }
      finalSlug = String(session.importSlug);
    } else {
      var baseSlug = (typeof slugify === "function" ? slugify(draft.label) : "") || "stock";
      finalSlug = uniqueStockSlug(baseSlug, Object.keys(specs));
    }

    var spec = {
      label: draft.label,
      bottleMl: draft.bottleMl,
      doseGramsPerL: draft.doseGramsPerL,
      minerals: cleaned,
    };
    if (session.mode === "edit") {
      // Preserve the round-tripped origin and source so minerals.html's
      // "Reset to library values" / "Re-derive from recipe" affordances keep
      // working on stocks edited via this modal.
      var existing = specs[finalSlug] || {};
      if (existing.createdFrom) spec.createdFrom = existing.createdFrom;
      if (existing.source) spec.source = existing.source;
    } else if (session.deriveSlug) {
      spec.createdFrom = "derived:" + session.deriveSlug;
    } else if (session.importSlug) {
      spec.createdFrom = "library:" + session.importSlug;
      if (session.importSource) spec.source = session.importSource;
    }
    specs[finalSlug] = spec;
    saveStockConcentrateSpecs(specs);

    if (session.autoEnable) {
      // Multi-Recipe-Concentrate: enabling a newly-created stock is additive;
      // any other stocks the user had enabled stay enabled.
      setStockEnabled("stock:" + finalSlug, true);
    }

    var savedSlug = finalSlug;
    var onSaved = session.onSaved;
    closeEditor();
    window.dispatchEvent(
      new CustomEvent("cw:minerals-changed", {
        detail: { scope: "concentrates", category: "stock", savedSlug: savedSlug },
      }),
    );
    if (typeof onSaved === "function") {
      try {
        onSaved(savedSlug);
      } catch (err) {
        console.error(err);
      }
    }
  }

  function handleDelete() {
    if (session.mode !== "edit" || !session.editSlug) return;
    var specs = loadStockConcentrateSpecs();
    var label = (specs[session.editSlug] && specs[session.editSlug].label) || session.editSlug;
    var slug = session.editSlug;
    var onSaved = session.onSaved;
    if (typeof showConfirm !== "function") {
      // showConfirm is defined in ui-shared.js; if missing, fall back to a
      // browser-native prompt rather than silently destroying user data.
      // Mirror the showConfirm branch's post-delete steps so the underlying
      // selector still rebuilds via cw:minerals-changed and a throwing
      // onSaved callback can't break the modal close.
      if (!confirm('Delete recipe concentrate "' + label + '"?')) return;
      deleteStock(slug);
      closeEditor();
      window.dispatchEvent(
        new CustomEvent("cw:minerals-changed", {
          detail: { scope: "concentrates", category: "stock", deletedSlug: slug },
        }),
      );
      if (typeof onSaved === "function") {
        try {
          onSaved(null);
        } catch (err) {
          console.error(err);
        }
      }
      return;
    }
    showConfirm('Delete recipe concentrate "' + label + '"?', function () {
      deleteStock(slug);
      closeEditor();
      window.dispatchEvent(
        new CustomEvent("cw:minerals-changed", {
          detail: { scope: "concentrates", category: "stock", deletedSlug: slug },
        }),
      );
      if (typeof onSaved === "function") {
        try {
          onSaved(null);
        } catch (err) {
          console.error(err);
        }
      }
    });
  }

  function deleteStock(slug) {
    var cur = loadStockConcentrateSpecs();
    delete cur[slug];
    saveStockConcentrateSpecs(cur);
    var remaining = loadSelectedConcentrates().filter(function (id) {
      return id !== "stock:" + slug;
    });
    saveSelectedConcentrates(remaining);
  }

  function openEditor(opts) {
    opts = opts || {};
    ensureOverlay();

    var mode = opts.mode || "new";
    var prefill = opts.prefill || {};
    var resolvedSession = {
      mode: mode,
      editSlug: null,
      label: "",
      bottleMl: 0,
      doseGramsPerL: 0,
      minerals: [],
      hint: "",
      notes: [],
      deriveSlug: "",
      importSlug: "",
      importSource: "",
      autoEnable: !!opts.autoEnable,
      onSaved: typeof opts.onSaved === "function" ? opts.onSaved : null,
    };

    if (mode === "edit") {
      if (!opts.slug) {
        console.warn("[stock-editor] edit mode requires opts.slug");
        return;
      }
      var specs = loadStockConcentrateSpecs();
      var spec = specs[opts.slug];
      if (!spec) {
        console.warn("[stock-editor] no stock spec for slug:", opts.slug);
        return;
      }
      resolvedSession.editSlug = opts.slug;
      resolvedSession.label = spec.label || opts.slug;
      resolvedSession.bottleMl = Number(spec.bottleMl) || 0;
      resolvedSession.doseGramsPerL = Number(spec.doseGramsPerL) || 0;
      resolvedSession.minerals = Array.isArray(spec.minerals)
        ? spec.minerals.map(function (m) {
            return {
              mineralId: m && typeof m.mineralId === "string" ? m.mineralId : "",
              grams: Number(m && m.grams) || 0,
            };
          })
        : [];
    } else {
      resolvedSession.label = prefill.label || "";
      resolvedSession.bottleMl = Number(prefill.bottleMl) || 0;
      resolvedSession.doseGramsPerL = Number(prefill.doseGramsPerL) || 0;
      resolvedSession.minerals = Array.isArray(prefill.minerals)
        ? prefill.minerals.map(function (m) {
            return {
              mineralId: m && typeof m.mineralId === "string" ? m.mineralId : "",
              grams: Number(m && m.grams) || 0,
            };
          })
        : [];
      resolvedSession.hint = prefill.hint || "";
      resolvedSession.notes = Array.isArray(prefill.notes) ? prefill.notes : [];
      resolvedSession.deriveSlug = prefill.deriveSlug || "";
      resolvedSession.importSlug = prefill.importSlug || "";
      resolvedSession.importSource = prefill.source || "";
    }

    session = resolvedSession;
    titleEl.textContent = mode === "edit" ? "Edit recipe concentrate" : "New recipe concentrate";

    renderForm();
    // Attach handlers exactly once per overlay; renderForm() replaces the
    // form contents so the listener on the parent .stock-editor-form is
    // still wired through event delegation.
    if (!formEl._cwEditorHandlersAttached) {
      attachFormHandlers();
      formEl._cwEditorHandlersAttached = true;
    }

    previousFocus = document.activeElement;
    overlayEl.style.display = "";

    overlayClickHandler = function (e) {
      if (e.target === overlayEl) closeEditor();
    };
    overlayEl.addEventListener("click", overlayClickHandler);
    closeBtn.addEventListener("click", closeEditor);

    keyHandler = function (e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeEditor();
        return;
      }
      if (e.key !== "Tab") return;
      var raw = overlayEl.querySelectorAll(
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
    document.addEventListener("keydown", keyHandler, true);

    var labelInput = formEl.querySelector("#stock-editor-label");
    if (labelInput && labelInput.focus) labelInput.focus();
  }

  function closeEditor() {
    if (!overlayEl) return;
    overlayEl.style.display = "none";
    if (overlayClickHandler) {
      overlayEl.removeEventListener("click", overlayClickHandler);
      overlayClickHandler = null;
    }
    if (closeBtn) closeBtn.removeEventListener("click", closeEditor);
    if (keyHandler) {
      document.removeEventListener("keydown", keyHandler, true);
      keyHandler = null;
    }
    if (previousFocus && previousFocus.focus) previousFocus.focus();
    previousFocus = null;
    session = null;
  }

  window.openStockEditor = openEditor;
})();
