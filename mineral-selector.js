// =============================================================================
// mineral-selector.js — Inline mineral & concentrate selector for tool pages.
//
// Renders a chip strip of the user's currently selected minerals with an
// "Edit minerals" button that opens a tabbed modal:
//   - Direct Dose tab: checkbox grid for MINERAL_DB (same as minerals.html
//     Settings).
//   - Concentrates tab: toggle lists for DIY, Stock, and Brand (Lotus)
//     concentrates plus the Lotus dropper-style toggle. Spec editors and
//     stock creation remain in Settings (link at the bottom).
//
// Reuses load/save helpers from storage.js and dispatches a
// `cw:minerals-changed` CustomEvent after any save so host pages can
// re-render their mineral- or concentrate-dependent UI.
// =============================================================================

(function () {
  "use strict";

  var ACTIVE_TAB_KEY = "cw_mineral_selector_tab";

  function readActiveTab() {
    // Category A: routes to sessionStorage when anonymous.
    var v = typeof _getTransient === "function" ? _getTransient(ACTIVE_TAB_KEY) : null;
    if (v === "concentrates") return "concentrates";
    return "direct";
  }

  function writeActiveTab(tab) {
    if (typeof _setTransient === "function") _setTransient(ACTIVE_TAB_KEY, tab);
  }

  function dispatchChanged(detail) {
    window.dispatchEvent(new CustomEvent("cw:minerals-changed", { detail: detail || {} }));
  }

  // ---- Mineral checkbox row (shared with Direct Dose tab) ----

  function buildMineralRow(id, mineral, checked) {
    var div = document.createElement("div");
    div.className = "mineral-item" + (checked ? " selected" : "");
    var label = document.createElement("label");
    label.className = "mineral-label";
    var input = document.createElement("input");
    input.type = "checkbox";
    input.value = id;
    if (checked) input.checked = true;
    var info = document.createElement("div");
    info.className = "mineral-info";
    var nameSpan = document.createElement("span");
    nameSpan.className = "mineral-name";
    nameSpan.textContent = mineral.name;
    var formulaSpan = document.createElement("span");
    formulaSpan.className = "mineral-formula";
    formulaSpan.textContent = mineral.formula;
    var descSpan = document.createElement("span");
    descSpan.className = "mineral-desc";
    descSpan.textContent = mineral.description;
    info.appendChild(nameSpan);
    info.appendChild(formulaSpan);
    info.appendChild(descSpan);
    label.appendChild(input);
    label.appendChild(info);
    div.appendChild(label);
    return div;
  }

  function buildMineralListInto(listEl, selectedIds) {
    listEl.innerHTML = "";
    var selected = {};
    for (var i = 0; i < selectedIds.length; i++) selected[selectedIds[i]] = true;
    for (var id in MINERAL_DB) {
      if (!Object.prototype.hasOwnProperty.call(MINERAL_DB, id)) continue;
      listEl.appendChild(buildMineralRow(id, MINERAL_DB[id], !!selected[id]));
    }
  }

  function bindMineralListToggle(listEl) {
    listEl.addEventListener("change", function (e) {
      if (!e.target || e.target.type !== "checkbox") return;
      var item = e.target.closest(".mineral-item");
      if (item) item.classList.toggle("selected", e.target.checked);
      var checked = listEl.querySelectorAll("input[type='checkbox']:checked");
      var ids = [];
      for (var i = 0; i < checked.length; i++) ids.push(checked[i].value);
      saveSelectedMinerals(ids);
      dispatchChanged({ scope: "minerals", ids: ids });
    });
  }

  // ---- Concentrate save helpers (preserve other categories) ----

  function writeDiyIds(diyIds) {
    var others = loadSelectedConcentrates().filter(function (id) {
      return typeof id === "string" && !id.startsWith("diy:");
    });
    saveSelectedConcentrates(others.concat(diyIds));
  }

  function writeBrandIds(brandIds) {
    var others = loadSelectedConcentrates().filter(function (id) {
      return typeof id === "string" && !id.startsWith("brand:");
    });
    saveSelectedConcentrates(others.concat(brandIds));
  }

  // setStockEnabled lives in storage.js (top-level export) so the
  // stock-editor modal's autoEnable path and the selector's change handler
  // share one helper. Keeping a local shim would silently desync the two.

  // ---- DIY subsection ----

  function renderDiyContentInto(targetEl) {
    targetEl.innerHTML = "";
    var hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent =
      "Single-mineral concentrates you've made at home. Tap the pencil to set bottle volume and grams per bottle.";
    targetEl.appendChild(hint);

    var list = document.createElement("div");
    list.className = "mineral-list mineral-selector-sublist";
    var selectedSet = {};
    var selected = loadSelectedConcentrates();
    for (var i = 0; i < selected.length; i++) selectedSet[selected[i]] = true;
    for (var id in MINERAL_DB) {
      if (!Object.prototype.hasOwnProperty.call(MINERAL_DB, id)) continue;
      var concId = "diy:" + id;
      var row = buildMineralRow(id, MINERAL_DB[id], !!selectedSet[concId]);
      row.classList.add("has-edit-actions");
      // The row's checkbox value defaults to the mineral id; rewrite to the
      // diy: prefixed concentrate id so the save handler reads it directly.
      var input = row.querySelector("input[type='checkbox']");
      if (input) input.value = concId;
      // Pencil button sits outside the <label> so its click doesn't toggle
      // the checkbox via implicit label association.
      var actions = document.createElement("div");
      actions.className = "mineral-selector-row-actions";
      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "mineral-selector-edit-btn";
      editBtn.setAttribute("aria-label", "Edit mineral concentrate");
      editBtn.title = "Edit mineral concentrate";
      editBtn.dataset.mineralId = id;
      editBtn.innerHTML = "&#9998;";
      actions.appendChild(editBtn);
      row.appendChild(actions);
      list.appendChild(row);
    }
    targetEl.appendChild(list);

    list.addEventListener("change", function (e) {
      if (!e.target || e.target.type !== "checkbox") return;
      var checkbox = e.target;

      // Enabling a DIY without a valid spec would silently dose 0 of that
      // mineral. Intercept: revert the checkbox and open the editor so the
      // user configures bottleMl + gramsPerBottle. The editor's save path
      // both persists the spec AND adds the diy:* id to selected
      // concentrates, then onSaved rebuilds the list with the row checked.
      if (checkbox.checked) {
        var concId = checkbox.value;
        var mineralId = concId.indexOf("diy:") === 0 ? concId.slice(4) : "";
        if (mineralId) {
          var specs =
            typeof loadDiyConcentrateSpecs === "function" ? loadDiyConcentrateSpecs() : {};
          var spec = specs[mineralId];
          var hasValidSpec = spec && Number(spec.bottleMl) > 0 && Number(spec.gramsPerBottle) > 0;
          if (!hasValidSpec) {
            checkbox.checked = false;
            var revertItem = checkbox.closest(".mineral-item");
            if (revertItem) revertItem.classList.remove("selected");
            if (typeof window.openDiyEditor === "function") {
              window.openDiyEditor({
                mineralId: mineralId,
                onSaved: function () {
                  rebuildConcentratesTab();
                },
              });
            }
            return;
          }
        }
      }

      var item = checkbox.closest(".mineral-item");
      if (item) item.classList.toggle("selected", checkbox.checked);
      var checked = list.querySelectorAll("input[type='checkbox']:checked");
      var ids = [];
      for (var i = 0; i < checked.length; i++) ids.push(checked[i].value);
      writeDiyIds(ids);
      dispatchChanged({ scope: "concentrates", category: "diy", ids: ids });
    });

    list.addEventListener("click", function (e) {
      var btn =
        e.target instanceof HTMLElement ? e.target.closest(".mineral-selector-edit-btn") : null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof window.openDiyEditor !== "function") return;
      window.openDiyEditor({
        mineralId: btn.dataset.mineralId,
        onSaved: function () {
          rebuildConcentratesTab();
        },
      });
    });
  }

  // ---- Stock subsection ----

  function renderStockContentInto(targetEl) {
    targetEl.innerHTML = "";
    var hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent =
      "Multi-mineral concentrates. Enable any number; the recipe builder and calculator sum each enabled concentrate's contribution.";
    targetEl.appendChild(hint);

    var newBtn = document.createElement("button");
    newBtn.type = "button";
    newBtn.className = "preset-btn mineral-selector-add-new-btn";
    newBtn.textContent = "+ Create Concentrate";
    newBtn.addEventListener("click", function () {
      if (typeof window.openStockEditor !== "function") return;
      window.openStockEditor({
        mode: "new",
        onSaved: function () {
          rebuildConcentratesTab();
        },
      });
    });
    if (typeof window.applyAuthGate === "function") {
      window.applyAuthGate(newBtn, { reason: "save-stock" });
    }
    targetEl.appendChild(newBtn);

    var specs = typeof loadStockConcentrateSpecs === "function" ? loadStockConcentrateSpecs() : {};
    var stockIds = specs ? Object.keys(specs) : [];

    if (stockIds.length === 0) {
      var empty = document.createElement("p");
      empty.className = "hint mineral-selector-empty";
      empty.textContent = 'No recipe concentrates yet. Click "+ Create Concentrate" to add one.';
      targetEl.appendChild(empty);
      return;
    }

    var selected = loadSelectedConcentrates();
    var activeIds = typeof getActiveStockIds === "function" ? getActiveStockIds(selected) : [];
    var activeIdSet = {};
    for (var k = 0; k < activeIds.length; k++) activeIdSet[activeIds[k]] = true;

    var list = document.createElement("div");
    list.className = "mineral-list mineral-selector-sublist";

    for (var i = 0; i < stockIds.length; i++) {
      var slug = stockIds[i];
      var concId = "stock:" + slug;
      var spec = specs[slug] || {};
      var label = (spec && (spec.label || spec.name)) || slug;
      var isActive = !!activeIdSet[concId];

      var item = document.createElement("div");
      item.className = "mineral-item has-edit-actions" + (isActive ? " selected" : "");
      var lbl = document.createElement("label");
      lbl.className = "mineral-label";
      var input = document.createElement("input");
      input.type = "checkbox";
      input.value = concId;
      input.checked = isActive;
      var info = document.createElement("div");
      info.className = "mineral-info";
      var nameSpan = document.createElement("span");
      nameSpan.className = "mineral-name";
      nameSpan.textContent = label;
      info.appendChild(nameSpan);
      if (Array.isArray(spec.minerals) && spec.minerals.length > 0) {
        var sumSpan = document.createElement("span");
        sumSpan.className = "mineral-desc";
        var names = [];
        for (var j = 0; j < spec.minerals.length; j++) {
          var m = spec.minerals[j];
          var def = m && m.mineralId ? MINERAL_DB[m.mineralId] : null;
          if (def) names.push(def.name);
        }
        sumSpan.textContent = names.join(", ");
        info.appendChild(sumSpan);
      }
      lbl.appendChild(input);
      lbl.appendChild(info);
      item.appendChild(lbl);

      var actions = document.createElement("div");
      actions.className = "mineral-selector-row-actions";
      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "mineral-selector-edit-btn";
      editBtn.setAttribute("aria-label", "Edit recipe concentrate");
      editBtn.title = "Edit recipe concentrate";
      editBtn.dataset.stockSlug = slug;
      editBtn.innerHTML = "&#9998;";
      actions.appendChild(editBtn);

      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "mineral-selector-delete-btn";
      delBtn.setAttribute("aria-label", "Delete recipe concentrate");
      delBtn.title = "Delete recipe concentrate";
      delBtn.dataset.stockSlug = slug;
      delBtn.innerHTML = "&times;";
      actions.appendChild(delBtn);
      item.appendChild(actions);

      list.appendChild(item);
    }
    targetEl.appendChild(list);

    list.addEventListener("change", function (e) {
      if (!e.target || e.target.type !== "checkbox") return;
      var clicked = e.target;
      // Multi-Recipe-Concentrate: each checkbox toggles its own stock
      // independently. Update only this row's selected class; other rows
      // keep their state.
      var rowItem = clicked.closest(".mineral-item");
      if (rowItem) rowItem.classList.toggle("selected", clicked.checked);
      setStockEnabled(clicked.value, clicked.checked);
      dispatchChanged({
        scope: "concentrates",
        category: "stock",
        toggledId: clicked.value,
        enabled: clicked.checked,
      });
    });

    list.addEventListener("click", function (e) {
      var editBtn =
        e.target instanceof HTMLElement ? e.target.closest(".mineral-selector-edit-btn") : null;
      if (editBtn) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.openStockEditor !== "function") return;
        window.openStockEditor({
          mode: "edit",
          slug: editBtn.dataset.stockSlug,
          onSaved: function () {
            rebuildConcentratesTab();
          },
        });
        return;
      }
      var delBtn =
        e.target instanceof HTMLElement ? e.target.closest(".mineral-selector-delete-btn") : null;
      if (!delBtn) return;
      e.preventDefault();
      e.stopPropagation();
      var delSlug = delBtn.dataset.stockSlug;
      var allSpecs = loadStockConcentrateSpecs();
      var delLabel = (allSpecs[delSlug] && allSpecs[delSlug].label) || delSlug;
      var runDelete = function () {
        var cur = loadStockConcentrateSpecs();
        delete cur[delSlug];
        saveStockConcentrateSpecs(cur);
        var remaining = loadSelectedConcentrates().filter(function (id) {
          return id !== "stock:" + delSlug;
        });
        saveSelectedConcentrates(remaining);
        rebuildConcentratesTab();
        dispatchChanged({ scope: "concentrates", category: "stock", deletedSlug: delSlug });
      };
      if (typeof showConfirm === "function") {
        showConfirm('Delete recipe concentrate "' + delLabel + '"?', runDelete);
      } else if (
        typeof window.confirm === "function" &&
        window.confirm('Delete recipe concentrate "' + delLabel + '"?')
      ) {
        runDelete();
      }
    });
  }

  // ---- Brand subsection ----

  // Parse a brand:<brand>:<rest> concentrate id into a display label and
  // CSS modifier class so future brands can opt into their own pill color
  // via .badge-<brand> CSS rules. Lotus is the only brand today; the same
  // logic will pick up future brands automatically when their IDs land.
  function brandBadgeFor(concentrateId) {
    if (typeof concentrateId !== "string") return null;
    var parts = concentrateId.split(":");
    if (parts.length < 3 || parts[0] !== "brand") return null;
    var brand = parts[1] || "";
    if (!brand) return null;
    return {
      label: brand.charAt(0).toUpperCase() + brand.slice(1),
      className: "badge badge-" + brand,
    };
  }

  function renderBrandContentInto(targetEl) {
    targetEl.innerHTML = "";
    var hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent =
      "Pre-made concentrates with fixed concentration. Pick your dropper style; checked items appear on tool pages.";
    targetEl.appendChild(hint);

    // Dropper-style toggle.
    var dropperWrap = document.createElement("div");
    dropperWrap.className = "mineral-selector-dropper-toggle";
    var dropperType = typeof loadLotusDropperType === "function" ? loadLotusDropperType() : "round";
    [
      { value: "round", label: "Round Dropper" },
      { value: "straight", label: "Straight Dropper" },
    ].forEach(function (opt) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "preset-btn mineral-selector-dropper-btn" + (dropperType === opt.value ? " active" : "");
      btn.dataset.dropper = opt.value;
      btn.textContent = opt.label;
      btn.addEventListener("click", function () {
        if (typeof saveLotusDropperType === "function") saveLotusDropperType(opt.value);
        dropperWrap.querySelectorAll(".mineral-selector-dropper-btn").forEach(function (b) {
          b.classList.toggle("active", b.dataset.dropper === opt.value);
        });
        dispatchChanged({ scope: "concentrates", category: "brand", dropper: opt.value });
      });
      dropperWrap.appendChild(btn);
    });
    targetEl.appendChild(dropperWrap);

    var brandIds =
      typeof LOTUS_CONCENTRATE_IDS !== "undefined" && LOTUS_CONCENTRATE_IDS
        ? LOTUS_CONCENTRATE_IDS
        : typeof BRAND_CONCENTRATES !== "undefined"
          ? Object.keys(BRAND_CONCENTRATES)
          : [];

    var selected = loadSelectedConcentrates();
    var selectedSet = {};
    for (var i = 0; i < selected.length; i++) selectedSet[selected[i]] = true;

    var list = document.createElement("div");
    list.className = "mineral-list mineral-selector-sublist";

    var brandDb = typeof BRAND_CONCENTRATES !== "undefined" ? BRAND_CONCENTRATES : {};
    for (var k = 0; k < brandIds.length; k++) {
      var bid = brandIds[k];
      var brand = brandDb[bid] || {};
      var checked = !!selectedSet[bid];
      var item = document.createElement("div");
      item.className = "mineral-item" + (checked ? " selected" : "");
      var lbl = document.createElement("label");
      lbl.className = "mineral-label";
      var input = document.createElement("input");
      input.type = "checkbox";
      input.value = bid;
      if (checked) input.checked = true;
      var info = document.createElement("div");
      info.className = "mineral-info";
      var nameSpan = document.createElement("span");
      nameSpan.className = "mineral-name";
      nameSpan.textContent = brand.name || bid;
      var badge = brandBadgeFor(bid);
      if (badge) {
        var badgeSpan = document.createElement("span");
        badgeSpan.className = badge.className;
        badgeSpan.textContent = badge.label;
        nameSpan.appendChild(badgeSpan);
      }
      info.appendChild(nameSpan);
      if (brand.formula) {
        var formulaSpan = document.createElement("span");
        formulaSpan.className = "mineral-formula";
        formulaSpan.textContent = brand.formula;
        info.appendChild(formulaSpan);
      }
      lbl.appendChild(input);
      lbl.appendChild(info);
      item.appendChild(lbl);
      list.appendChild(item);
    }
    targetEl.appendChild(list);

    list.addEventListener("change", function (e) {
      if (!e.target || e.target.type !== "checkbox") return;
      var item = e.target.closest(".mineral-item");
      if (item) item.classList.toggle("selected", e.target.checked);
      var checkedNodes = list.querySelectorAll("input[type='checkbox']:checked");
      var ids = [];
      for (var i = 0; i < checkedNodes.length; i++) ids.push(checkedNodes[i].value);
      writeBrandIds(ids);
      dispatchChanged({ scope: "concentrates", category: "brand", ids: ids });
    });
  }

  // ---- Tabbed modal (shared across all chip mounts) ----

  var modalEl = null;
  var directListEl = null;
  var concDiyContentEl = null;
  var concStockContentEl = null;
  var concBrandContentEl = null;
  var directPanelEl = null;
  var concPanelEl = null;
  var directTabBtn = null;
  var concTabBtn = null;
  var modalCloseBtn = null;
  var modalKeyHandler = null;
  var modalOverlayClickHandler = null;
  var modalPreviousFocus = null;

  // Build a collapsible subsection wrapper: each <section> contains a
  // summary button and a content div as direct siblings, so the existing
  // .card-collapsible-summary[aria-expanded="false"] ~ .card-collapsible-content
  // CSS rule scopes naturally to that section without per-id rules.
  function makeCollapsibleSubsection(title) {
    var section = document.createElement("section");
    section.className = "mineral-selector-subsection card-collapsible";

    var summary = document.createElement("button");
    summary.type = "button";
    summary.className = "card-collapsible-summary";
    summary.setAttribute("aria-expanded", "true");
    var titleSpan = document.createElement("span");
    titleSpan.className = "card-collapsible-title";
    titleSpan.textContent = title;
    summary.appendChild(titleSpan);
    section.appendChild(summary);

    var content = document.createElement("div");
    content.className = "card-collapsible-content";
    section.appendChild(content);

    summary.addEventListener("click", function () {
      var open = summary.getAttribute("aria-expanded") === "true";
      summary.setAttribute("aria-expanded", open ? "false" : "true");
    });

    return { section: section, content: content };
  }

  function setActiveTab(tab) {
    var isConcs = tab === "concentrates";
    directPanelEl.hidden = isConcs;
    concPanelEl.hidden = !isConcs;
    directTabBtn.classList.toggle("mineral-selector-tab--active", !isConcs);
    concTabBtn.classList.toggle("mineral-selector-tab--active", isConcs);
    directTabBtn.setAttribute("aria-selected", !isConcs ? "true" : "false");
    concTabBtn.setAttribute("aria-selected", isConcs ? "true" : "false");
    writeActiveTab(isConcs ? "concentrates" : "direct");
  }

  function rebuildConcentratesTab() {
    // Only the content divs rebuild — the collapsible summary wrappers
    // stay put so the user's open/closed state survives each rebuild.
    if (concDiyContentEl) renderDiyContentInto(concDiyContentEl);
    if (concStockContentEl) renderStockContentInto(concStockContentEl);
    if (concBrandContentEl) renderBrandContentInto(concBrandContentEl);
  }

  function ensureModal() {
    if (modalEl) return;
    modalEl = document.createElement("div");
    modalEl.className = "library-picker-overlay mineral-selector-modal-overlay";
    modalEl.id = "mineral-selector-modal-overlay";
    modalEl.style.display = "none";

    var dialog = document.createElement("div");
    dialog.className = "library-picker-dialog mineral-selector-modal-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "mineral-selector-modal-title");

    modalCloseBtn = document.createElement("button");
    modalCloseBtn.type = "button";
    modalCloseBtn.className = "library-picker-close";
    modalCloseBtn.setAttribute("aria-label", "Close");
    modalCloseBtn.textContent = "×";
    dialog.appendChild(modalCloseBtn);

    var title = document.createElement("h2");
    title.id = "mineral-selector-modal-title";
    title.className = "library-picker-title";
    title.textContent = "Available Minerals & Concentrates";
    dialog.appendChild(title);

    var tabs = document.createElement("div");
    tabs.className = "mineral-selector-tabs";
    tabs.setAttribute("role", "tablist");

    directTabBtn = document.createElement("button");
    directTabBtn.type = "button";
    directTabBtn.className = "preset-btn mineral-selector-tab";
    directTabBtn.setAttribute("role", "tab");
    directTabBtn.id = "mineral-selector-tab-direct";
    directTabBtn.setAttribute("aria-controls", "mineral-selector-panel-direct");
    directTabBtn.textContent = "Direct Dose";
    directTabBtn.addEventListener("click", function () {
      setActiveTab("direct");
    });

    concTabBtn = document.createElement("button");
    concTabBtn.type = "button";
    concTabBtn.className = "preset-btn mineral-selector-tab";
    concTabBtn.setAttribute("role", "tab");
    concTabBtn.id = "mineral-selector-tab-concentrates";
    concTabBtn.setAttribute("aria-controls", "mineral-selector-panel-concentrates");
    concTabBtn.textContent = "Concentrates";
    concTabBtn.addEventListener("click", function () {
      setActiveTab("concentrates");
    });

    tabs.appendChild(directTabBtn);
    tabs.appendChild(concTabBtn);
    dialog.appendChild(tabs);

    var panels = document.createElement("div");
    panels.className = "mineral-selector-tab-panels";

    // Direct Dose panel.
    directPanelEl = document.createElement("div");
    directPanelEl.className = "mineral-selector-tab-panel";
    directPanelEl.id = "mineral-selector-panel-direct";
    directPanelEl.setAttribute("role", "tabpanel");
    directPanelEl.setAttribute("aria-labelledby", "mineral-selector-tab-direct");

    var directHint = document.createElement("p");
    directHint.className = "hint";
    directHint.textContent = "Pick the mineral salts you have on hand for direct dosing.";
    directPanelEl.appendChild(directHint);

    directListEl = document.createElement("div");
    directListEl.className = "mineral-list mineral-selector-modal-list";
    directPanelEl.appendChild(directListEl);
    bindMineralListToggle(directListEl);
    panels.appendChild(directPanelEl);

    // Concentrates panel.
    concPanelEl = document.createElement("div");
    concPanelEl.className = "mineral-selector-tab-panel";
    concPanelEl.id = "mineral-selector-panel-concentrates";
    concPanelEl.setAttribute("role", "tabpanel");
    concPanelEl.setAttribute("aria-labelledby", "mineral-selector-tab-concentrates");

    var diyWrap = makeCollapsibleSubsection("Mineral Concentrates");
    concDiyContentEl = diyWrap.content;
    concPanelEl.appendChild(diyWrap.section);

    var stockWrap = makeCollapsibleSubsection("Recipe Concentrates");
    concStockContentEl = stockWrap.content;
    concPanelEl.appendChild(stockWrap.section);

    var brandWrap = makeCollapsibleSubsection("Brand Name Concentrates");
    concBrandContentEl = brandWrap.content;
    concPanelEl.appendChild(brandWrap.section);

    var manageLink = document.createElement("a");
    manageLink.className = "mineral-selector-manage-link";
    manageLink.href = "minerals.html";
    manageLink.textContent = "Open full Settings page →";
    concPanelEl.appendChild(manageLink);

    panels.appendChild(concPanelEl);
    dialog.appendChild(panels);

    modalEl.appendChild(dialog);
    document.body.appendChild(modalEl);
  }

  function openModal() {
    ensureModal();
    modalPreviousFocus = document.activeElement;
    buildMineralListInto(directListEl, loadSelectedMinerals());
    rebuildConcentratesTab();
    setActiveTab(readActiveTab());
    modalEl.style.display = "";

    modalOverlayClickHandler = function (e) {
      if (e.target === modalEl) closeModal();
    };
    modalEl.addEventListener("click", modalOverlayClickHandler);
    modalCloseBtn.addEventListener("click", closeModal);

    modalKeyHandler = function (e) {
      if (e.key === "Escape") {
        closeModal();
        return;
      }
      if (e.key !== "Tab") return;
      var raw = modalEl.querySelectorAll(
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
    document.addEventListener("keydown", modalKeyHandler);

    // Focus the active tab so keyboard users land somewhere predictable.
    var activeTab = readActiveTab() === "concentrates" ? concTabBtn : directTabBtn;
    if (activeTab && activeTab.focus) activeTab.focus();
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.style.display = "none";
    if (modalOverlayClickHandler) {
      modalEl.removeEventListener("click", modalOverlayClickHandler);
      modalOverlayClickHandler = null;
    }
    if (modalCloseBtn) modalCloseBtn.removeEventListener("click", closeModal);
    if (modalKeyHandler) {
      document.removeEventListener("keydown", modalKeyHandler);
      modalKeyHandler = null;
    }
    if (modalPreviousFocus && modalPreviousFocus.focus) modalPreviousFocus.focus();
    modalPreviousFocus = null;
    // Lets host pages that defer their re-render (e.g. recipe.html, which
    // location.reload()s on mineral changes) act when the user is done
    // editing rather than mid-toggle.
    window.dispatchEvent(new CustomEvent("cw:mineral-selector-closed"));
  }

  // Note: deliberately NO `cw:minerals-changed` listener that rebuilds the
  // modal's subsections on self-fired events. The change handlers update
  // their own DOM in place (.selected class + checkbox state), and
  // openModal() rebuilds everything from scratch on each open so cross-tab
  // edits land on the next open. Listening here would wipe focus mid-click
  // on the just-toggled checkbox.

  function chipLabelFor(mineral) {
    return mineral.formula || mineral.name;
  }

  // ---- Public mount: chip strip + "Edit minerals" button ----

  function mountMineralSelector(targetEl) {
    if (!targetEl) return;
    // If this element was already mounted, detach the previous chip-rerender
    // listener so re-mount doesn't leak duplicates (the old closure's chips
    // element is also out of the DOM, so its renderChips would no-op anyway,
    // but stale window listeners accumulate).
    if (typeof targetEl._cwMineralSelectorCleanup === "function") {
      targetEl._cwMineralSelectorCleanup();
      targetEl._cwMineralSelectorCleanup = null;
    }
    targetEl.innerHTML = "";

    var wrap = document.createElement("div");
    wrap.className = "mineral-selector-chips-wrap";

    var chips = document.createElement("div");
    chips.className = "mineral-chips";

    var editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "mineral-edit-link";
    editBtn.textContent = "Edit minerals";

    function appendBadge(chip, label, className) {
      var badge = document.createElement("span");
      badge.className = className;
      badge.textContent = label;
      chip.appendChild(badge);
    }

    function renderChips() {
      chips.innerHTML = "";
      var mineralIds = loadSelectedMinerals();
      var concentrateIds = loadSelectedConcentrates();

      if (mineralIds.length === 0 && concentrateIds.length === 0) {
        var empty = document.createElement("span");
        empty.className = "mineral-chip mineral-chip--empty";
        empty.textContent = "No minerals selected";
        chips.appendChild(empty);
        return;
      }

      for (var i = 0; i < mineralIds.length; i++) {
        var mineral = MINERAL_DB[mineralIds[i]];
        if (!mineral) continue;
        var chip = document.createElement("span");
        chip.className = "mineral-chip";
        chip.textContent = chipLabelFor(mineral);
        chip.title = mineral.name;
        chips.appendChild(chip);
      }

      var stockSpecs =
        typeof loadStockConcentrateSpecs === "function" ? loadStockConcentrateSpecs() : {};
      var brandDb = typeof BRAND_CONCENTRATES !== "undefined" ? BRAND_CONCENTRATES : {};

      for (var j = 0; j < concentrateIds.length; j++) {
        var concId = concentrateIds[j];
        if (typeof concId !== "string") continue;

        if (concId.indexOf("diy:") === 0) {
          var diyMineralId = concId.slice(4);
          var diyMineral = MINERAL_DB[diyMineralId];
          if (!diyMineral) continue;
          var diyChip = document.createElement("span");
          diyChip.className = "mineral-chip";
          diyChip.textContent = chipLabelFor(diyMineral);
          diyChip.title = "DIY: " + diyMineral.name;
          appendBadge(diyChip, "DIY", "badge badge-concentrate");
          chips.appendChild(diyChip);
        } else if (concId.indexOf("stock:") === 0) {
          var slug = concId.slice(6);
          var spec = stockSpecs[slug];
          if (!spec) continue;
          var stockLabel = (spec && (spec.label || spec.name)) || slug;
          var stockChip = document.createElement("span");
          stockChip.className = "mineral-chip";
          stockChip.textContent = stockLabel;
          stockChip.title = "Recipe Concentrate: " + stockLabel;
          appendBadge(stockChip, "Recipe", "badge badge-concentrate");
          chips.appendChild(stockChip);
        } else if (concId.indexOf("brand:") === 0) {
          var brand = brandDb[concId];
          if (!brand) continue;
          var brandChip = document.createElement("span");
          brandChip.className = "mineral-chip";
          brandChip.textContent = brand.name || concId;
          var brandBadge = brandBadgeFor(concId);
          brandChip.title = (brandBadge ? brandBadge.label + ": " : "") + (brand.name || concId);
          if (brandBadge) appendBadge(brandChip, brandBadge.label, brandBadge.className);
          chips.appendChild(brandChip);
        }
      }
    }

    editBtn.addEventListener("click", openModal);
    window.addEventListener("cw:minerals-changed", renderChips);
    targetEl._cwMineralSelectorCleanup = function () {
      window.removeEventListener("cw:minerals-changed", renderChips);
    };
    renderChips();

    wrap.appendChild(chips);
    wrap.appendChild(editBtn);
    targetEl.appendChild(wrap);
  }

  window.mountMineralSelector = mountMineralSelector;
  window.openMineralSelectorModal = openModal;
})();
