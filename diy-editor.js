// =============================================================================
// diy-editor.js — Modal editor for single-mineral DIY concentrate specs.
//
// Exposes window.openDiyEditor({ mineralId, onSaved? }) for the edit-pencil
// affordance on each DIY row inside the mineral selector modal. Mirrors the
// inline editor at minerals.html:237-256 (bottle mL + grams per bottle inputs
// plus a solubility warning), and ends in saveDiyConcentrateSpecs() plus a
// cw:minerals-changed dispatch so the underlying selector rebuilds.
//
// Auto-selects the concentrate on save when it isn't already in
// cw_selected_concentrates, matching the user expectation that "I configured
// this DIY" implies "I want to use it." Stocks deliberately do NOT auto-enable
// from the selector's "+ New" path (single-active rule complicates that); DIYs
// have no such constraint.
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

  function getSolubilityLimitGPerL(mineralId) {
    var v =
      typeof MINERAL_SOLUBILITY_G_PER_L_25C_APPROX !== "undefined" &&
      MINERAL_SOLUBILITY_G_PER_L_25C_APPROX
        ? MINERAL_SOLUBILITY_G_PER_L_25C_APPROX[mineralId]
        : null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  var overlayEl = null;
  var dialogEl = null;
  var formEl = null;
  var titleEl = null;
  var warningEl = null;
  var errorEl = null;
  var closeBtn = null;
  var previousFocus = null;
  var keyHandler = null;
  var overlayClickHandler = null;
  var session = null;

  function ensureOverlay() {
    if (overlayEl) return;
    overlayEl = document.createElement("div");
    overlayEl.className = "library-picker-overlay diy-editor-overlay";
    overlayEl.style.display = "none";

    dialogEl = document.createElement("div");
    dialogEl.className = "library-picker-dialog diy-editor-dialog";
    dialogEl.setAttribute("role", "dialog");
    dialogEl.setAttribute("aria-modal", "true");
    dialogEl.setAttribute("aria-labelledby", "diy-editor-title");

    closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "library-picker-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "×";
    dialogEl.appendChild(closeBtn);

    titleEl = document.createElement("h2");
    titleEl.id = "diy-editor-title";
    titleEl.className = "library-picker-title";
    titleEl.textContent = "Mineral concentrate";
    dialogEl.appendChild(titleEl);

    formEl = document.createElement("div");
    formEl.className = "diy-editor-form";
    dialogEl.appendChild(formEl);

    overlayEl.appendChild(dialogEl);
    document.body.appendChild(overlayEl);
  }

  function readDraft() {
    var bottleEl = formEl.querySelector("#diy-editor-bottle-ml");
    var gramsEl = formEl.querySelector("#diy-editor-grams-per-bottle");
    return {
      bottleMl: bottleEl ? Math.max(0, parseFloat(bottleEl.value) || 0) : 0,
      gramsPerBottle: gramsEl ? Math.max(0, parseFloat(gramsEl.value) || 0) : 0,
    };
  }

  function updateWarning() {
    if (!warningEl) return;
    var d = readDraft();
    var limit = getSolubilityLimitGPerL(session.mineralId);
    if (!d.bottleMl || !d.gramsPerBottle || limit == null) {
      warningEl.hidden = true;
      return;
    }
    var gPerL = d.gramsPerBottle / (d.bottleMl / 1000);
    warningEl.hidden = gPerL < limit;
  }

  function showError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg || "";
    errorEl.hidden = !msg;
  }

  function renderForm() {
    var mineralName =
      typeof MINERAL_DB !== "undefined" && MINERAL_DB[session.mineralId]
        ? MINERAL_DB[session.mineralId].name
        : session.mineralId;
    var mineralFormula =
      typeof MINERAL_DB !== "undefined" && MINERAL_DB[session.mineralId]
        ? MINERAL_DB[session.mineralId].formula
        : "";

    var isNew = !(session.bottleMl > 0) && !(session.gramsPerBottle > 0);
    // First-time editors get an empty form with placeholders so "unset" is
    // visually distinct from a real 0. Existing specs keep their saved
    // values verbatim so a user editing won't accidentally see a phantom
    // placeholder over their real config.
    var bottleAttr =
      session.bottleMl > 0 ? 'value="' + session.bottleMl + '"' : 'placeholder="e.g. 1000"';
    var gramsAttr =
      session.gramsPerBottle > 0
        ? 'value="' + session.gramsPerBottle + '"'
        : 'placeholder="e.g. 50"';

    var hintHtml = isNew
      ? '<p class="hint diy-editor-hint">Tell the calculator how much ' +
        escapeHtml(mineralName) +
        " you dissolved. Enter your bottle's volume and how many grams of the salt you added; the calculator uses these to compute per-liter doses.</p>"
      : '<p class="hint diy-editor-hint">Bottle volume and grams of ' +
        escapeHtml(mineralName) +
        " dissolved.</p>";
    var nameLine = mineralFormula
      ? '<p class="diy-editor-mineral-line"><strong>' +
        escapeHtml(mineralName) +
        '</strong> <span class="mineral-formula">' +
        escapeHtml(mineralFormula) +
        "</span></p>"
      : '<p class="diy-editor-mineral-line"><strong>' + escapeHtml(mineralName) + "</strong></p>";

    formEl.innerHTML =
      nameLine +
      hintHtml +
      '<div class="concentrate-inputs">' +
      '<div class="input-group">' +
      '<label for="diy-editor-bottle-ml">Bottle mL</label>' +
      '<input type="number" id="diy-editor-bottle-ml" min="0" step="1" ' +
      bottleAttr +
      ">" +
      "</div>" +
      '<div class="input-group">' +
      '<label for="diy-editor-grams-per-bottle">Grams per bottle</label>' +
      '<input type="number" id="diy-editor-grams-per-bottle" min="0" step="0.01" ' +
      gramsAttr +
      ">" +
      "</div>" +
      "</div>" +
      '<div class="concentrate-warning diy-editor-warning" hidden>You’ve reached the solubility limit for this mineral, try a lower concentration.</div>' +
      '<div class="stock-editor-actions">' +
      '<button type="button" class="preset-btn primary" data-action="save">Save</button>' +
      '<button type="button" class="preset-btn" data-action="cancel">Cancel</button>' +
      "</div>" +
      '<div class="stock-new-error diy-editor-error" hidden></div>';

    warningEl = formEl.querySelector(".diy-editor-warning");
    errorEl = formEl.querySelector(".diy-editor-error");
    updateWarning();
  }

  function attachFormHandlers() {
    formEl.addEventListener("click", function (e) {
      var target = e.target instanceof HTMLElement ? e.target : null;
      if (!target) return;
      var action = target.dataset.action;
      if (action === "save") {
        handleSave();
      } else if (action === "cancel") {
        closeEditor();
      }
    });
    formEl.addEventListener("input", function (e) {
      if (!e.target || e.target.tagName !== "INPUT") return;
      updateWarning();
    });
  }

  function handleSave() {
    if (typeof window.isLoggedInSync === "function" && !window.isLoggedInSync()) {
      if (typeof window.openLoginModal === "function") {
        window.openLoginModal({ reason: "save-stock" });
      }
      return;
    }

    var d = readDraft();
    if (d.bottleMl <= 0) {
      showError("Bottle volume must be greater than 0.");
      return;
    }
    if (d.gramsPerBottle <= 0) {
      showError("Grams per bottle must be greater than 0.");
      return;
    }

    var specs = loadDiyConcentrateSpecs();
    specs[session.mineralId] = { bottleMl: d.bottleMl, gramsPerBottle: d.gramsPerBottle };
    saveDiyConcentrateSpecs(specs);

    // Auto-enable the concentrate id if it wasn't already enabled. Stocks
    // are single-active and treated as a deliberate user toggle; DIYs aren't,
    // so configuring grams implies "I want to use this."
    var concentrateId = "diy:" + session.mineralId;
    var selected = loadSelectedConcentrates();
    if (selected.indexOf(concentrateId) === -1) {
      saveSelectedConcentrates(selected.concat([concentrateId]));
    }

    var onSaved = session.onSaved;
    var mineralId = session.mineralId;
    closeEditor();
    window.dispatchEvent(
      new CustomEvent("cw:minerals-changed", {
        detail: { scope: "concentrates", category: "diy", mineralId: mineralId },
      }),
    );
    if (typeof onSaved === "function") {
      try {
        onSaved(mineralId);
      } catch (err) {
        console.error(err);
      }
    }
  }

  function openEditor(opts) {
    opts = opts || {};
    if (!opts.mineralId) {
      console.warn("[diy-editor] requires opts.mineralId");
      return;
    }
    ensureOverlay();

    var specs = loadDiyConcentrateSpecs();
    var existing = specs[opts.mineralId] || {};
    session = {
      mineralId: opts.mineralId,
      bottleMl: Number(existing.bottleMl) || 0,
      gramsPerBottle: Number(existing.gramsPerBottle) || 0,
      onSaved: typeof opts.onSaved === "function" ? opts.onSaved : null,
    };

    renderForm();
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

    var bottleInput = formEl.querySelector("#diy-editor-bottle-ml");
    if (bottleInput && bottleInput.focus) bottleInput.focus();
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

  window.openDiyEditor = openEditor;
})();
