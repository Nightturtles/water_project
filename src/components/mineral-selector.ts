// =============================================================================
// mineral-selector.ts — Inline mineral & concentrate selector for tool pages.
//
// Renders a chip strip of the user's currently selected minerals with an
// "Edit minerals" button that opens a tabbed modal:
//   - Direct Dose tab: checkbox grid for MINERAL_DB (same as minerals.html
//     Settings).
//   - Concentrates tab: toggle lists for DIY, Stock, and Brand (Lotus)
//     concentrates plus the Lotus dropper-style toggle. Spec editors and
//     stock creation remain in Settings (link at the bottom).
//
// Reuses load/save helpers from storage.ts and dispatches a
// `cw:minerals-changed` CustomEvent after any save so host pages can
// re-render their mineral- or concentrate-dependent UI.
//
// Phase A: converted from mineral-selector.js. Loaded via legacy-globals.ts
// (the bridge module imports this file as a side-effect). The IIFE wrapper is
// dropped — ES module scope already isolates internals. Storage helpers and
// showConfirm are imported from their migrated modules and called directly
// (they're guaranteed loaded before this module), so the original
// `typeof X === "function"` guards on those are removed; the cross-module
// window bridge (openDiyEditor / openStockEditor / applyAuthGate / body-scroll)
// is still reached via window.* with the same guards. The public API is
// re-published on window so the not-yet-migrated callers (script.js on
// index/recipe; the taste.html inline block) reach mountMineralSelector /
// openMineralSelectorModal unchanged.
// =============================================================================

import { MINERAL_DB, BRAND_CONCENTRATES, LOTUS_CONCENTRATE_IDS } from "../lib/constants";
import type { MineralEntry, BrandConcentrate } from "../lib/constants";
import { showConfirm } from "./ui-shared";
import {
  _getTransient,
  _setTransient,
  getActiveStockIds,
  loadDiyConcentrateSpecs,
  loadLotusDropperType,
  loadSelectedConcentrates,
  loadSelectedMinerals,
  loadStockConcentrateSpecs,
  saveLotusDropperType,
  saveSelectedConcentrates,
  saveSelectedMinerals,
  saveStockConcentrateSpecs,
  setStockEnabled,
} from "../lib/storage";

const ACTIVE_TAB_KEY = "cw_mineral_selector_tab";

// Local view of a stock concentrate spec as this module reads it. Mirrors the
// fields used from storage.ts's (non-exported) StockConcentrateSpec; `name` is
// not part of the canonical spec (rows carry `label`) but the original read it
// defensively as a label fallback, so it's kept here as optional.
interface StockSpec {
  label?: string;
  name?: string;
  minerals?: Array<{ mineralId?: string } | undefined>;
}

function readActiveTab(): "concentrates" | "direct" {
  // Category A: routes to sessionStorage when anonymous.
  const v = _getTransient(ACTIVE_TAB_KEY);
  if (v === "concentrates") return "concentrates";
  return "direct";
}

function writeActiveTab(tab: string): void {
  _setTransient(ACTIVE_TAB_KEY, tab);
}

function dispatchChanged(detail?: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent("cw:minerals-changed", { detail: detail || {} }));
}

// ---- Mineral checkbox row (shared with Direct Dose tab) ----

function buildMineralRow(id: string, mineral: MineralEntry, checked: boolean): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "mineral-item" + (checked ? " selected" : "");
  const label = document.createElement("label");
  label.className = "mineral-label";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.value = id;
  if (checked) input.checked = true;
  const info = document.createElement("div");
  info.className = "mineral-info";
  const nameSpan = document.createElement("span");
  nameSpan.className = "mineral-name";
  nameSpan.textContent = mineral.name;
  const formulaSpan = document.createElement("span");
  formulaSpan.className = "mineral-formula";
  formulaSpan.textContent = mineral.formula;
  const descSpan = document.createElement("span");
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

// "Selected Minerals" (what's on hand) up top; the rest under a collapsed
// "More minerals" group (mirrors the Settings page). Both stay inside listEl
// so the bindMineralListToggle change handler still sees every checkbox.
let directMoreExpanded = false;

function buildMineralListInto(listEl: HTMLElement, selectedIds: string[]): void {
  listEl.innerHTML = "";
  const selected: Record<string, boolean> = {};
  for (let i = 0; i < selectedIds.length; i++) selected[selectedIds[i]!] = true;

  const selectedLabel = document.createElement("div");
  selectedLabel.className = "mineral-group-label";
  selectedLabel.textContent = "Selected Minerals";
  listEl.appendChild(selectedLabel);

  let selectedCount = 0;
  let moreCount = 0;
  for (const id in MINERAL_DB) {
    if (!Object.prototype.hasOwnProperty.call(MINERAL_DB, id)) continue;
    if (selected[id]) {
      listEl.appendChild(buildMineralRow(id, MINERAL_DB[id]!, true));
      selectedCount++;
    } else {
      moreCount++;
    }
  }

  if (selectedCount === 0) {
    const empty = document.createElement("p");
    empty.className = "hint mineral-group-empty";
    empty.textContent = "No minerals selected. Pick some from More minerals below.";
    listEl.appendChild(empty);
    directMoreExpanded = true;
  }

  if (moreCount > 0) {
    const more = makeCollapsibleSubsection("More minerals", directMoreExpanded);
    more.section.classList.add("mineral-more-subsection");
    for (const id2 in MINERAL_DB) {
      if (!Object.prototype.hasOwnProperty.call(MINERAL_DB, id2)) continue;
      if (!selected[id2]) {
        more.content.appendChild(buildMineralRow(id2, MINERAL_DB[id2]!, false));
      }
    }
    // Track expanded state so it survives the re-render on each toggle.
    more.summary.addEventListener("click", function () {
      directMoreExpanded = more.summary.getAttribute("aria-expanded") === "true";
    });
    listEl.appendChild(more.section);
  }
}

function bindMineralListToggle(listEl: HTMLElement): void {
  listEl.addEventListener("change", function (e) {
    const target = e.target as HTMLInputElement | null;
    if (!target || target.type !== "checkbox") return;
    const checked = listEl.querySelectorAll<HTMLInputElement>("input[type='checkbox']:checked");
    const ids: string[] = [];
    for (let i = 0; i < checked.length; i++) ids.push(checked[i]!.value);
    saveSelectedMinerals(ids);
    dispatchChanged({ scope: "minerals", ids: ids });
    // Re-group so the toggled mineral moves between Selected and More.
    buildMineralListInto(listEl, ids);
  });
}

// ---- Concentrate save helpers (preserve other categories) ----

// Per-id enable/disable. Used by every concentrate toggle (Selected group
// + the three type groups) so enabling one item never rewrites the rest of
// its category. Stock routes through setStockEnabled (its own idempotent
// add/remove); diy/brand add or drop the single id.
function setConcentrateEnabled(concId: string, enabled: boolean): void {
  if (typeof concId !== "string") return;
  if (concId.indexOf("stock:") === 0) {
    setStockEnabled(concId, enabled);
    return;
  }
  const ids = loadSelectedConcentrates();
  const has = ids.indexOf(concId) !== -1;
  if (enabled && !has) saveSelectedConcentrates(ids.concat([concId]));
  else if (!enabled && has)
    saveSelectedConcentrates(
      ids.filter(function (id) {
        return id !== concId;
      }),
    );
}

// In the mixed "Selected Concentrates" group a type badge tells diy/stock
// rows apart (matches the chip-strip convention: "DIY" / "Recipe").
function appendConcentrateTypeBadge(row: HTMLElement, label: string): void {
  const nameSpan = row.querySelector(".mineral-name");
  if (!nameSpan) return;
  const badge = document.createElement("span");
  badge.className = "badge badge-concentrate";
  badge.textContent = label;
  nameSpan.appendChild(badge);
}

// ---- Row builders (shared by the type groups and the Selected group) ----

function buildDiyConcentrateRow(id: string, checked: boolean): HTMLDivElement {
  const concId = "diy:" + id;
  const row = buildMineralRow(id, MINERAL_DB[id]!, checked);
  row.classList.add("has-edit-actions");
  // The row's checkbox value defaults to the mineral id; rewrite to the
  // diy: prefixed concentrate id so the save handler reads it directly.
  const input = row.querySelector<HTMLInputElement>("input[type='checkbox']");
  if (input) input.value = concId;
  // Pencil button sits outside the <label> so its click doesn't toggle
  // the checkbox via implicit label association.
  const actions = document.createElement("div");
  actions.className = "mineral-selector-row-actions";
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "mineral-selector-edit-btn";
  editBtn.setAttribute("aria-label", "Edit mineral concentrate");
  editBtn.title = "Edit mineral concentrate";
  editBtn.dataset.mineralId = id;
  editBtn.innerHTML = "&#9998;";
  actions.appendChild(editBtn);
  row.appendChild(actions);
  return row;
}

function buildStockConcentrateRow(
  slug: string,
  specArg: StockSpec | undefined,
  checked: boolean,
): HTMLDivElement {
  const spec: StockSpec = specArg || {};
  const concId = "stock:" + slug;
  const label = spec.label || spec.name || slug;

  const item = document.createElement("div");
  item.className = "mineral-item has-edit-actions" + (checked ? " selected" : "");
  const lbl = document.createElement("label");
  lbl.className = "mineral-label";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.value = concId;
  input.checked = checked;
  const info = document.createElement("div");
  info.className = "mineral-info";
  const nameSpan = document.createElement("span");
  nameSpan.className = "mineral-name";
  nameSpan.textContent = label;
  info.appendChild(nameSpan);
  if (Array.isArray(spec.minerals) && spec.minerals.length > 0) {
    const sumSpan = document.createElement("span");
    sumSpan.className = "mineral-desc";
    const names: string[] = [];
    for (let j = 0; j < spec.minerals.length; j++) {
      const m = spec.minerals[j];
      const def = m && m.mineralId ? MINERAL_DB[m.mineralId] : null;
      if (def) names.push(def.name);
    }
    sumSpan.textContent = names.join(", ");
    info.appendChild(sumSpan);
  }
  lbl.appendChild(input);
  lbl.appendChild(info);
  item.appendChild(lbl);

  const actions = document.createElement("div");
  actions.className = "mineral-selector-row-actions";
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "mineral-selector-edit-btn";
  editBtn.setAttribute("aria-label", "Edit recipe concentrate");
  editBtn.title = "Edit recipe concentrate";
  editBtn.dataset.stockSlug = slug;
  editBtn.innerHTML = "&#9998;";
  actions.appendChild(editBtn);

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "mineral-selector-delete-btn";
  delBtn.setAttribute("aria-label", "Delete recipe concentrate");
  delBtn.title = "Delete recipe concentrate";
  delBtn.dataset.stockSlug = slug;
  delBtn.innerHTML = "&times;";
  actions.appendChild(delBtn);
  item.appendChild(actions);
  return item;
}

function buildBrandConcentrateRow(
  bid: string,
  brandArg: Partial<BrandConcentrate> | undefined,
  checked: boolean,
): HTMLDivElement {
  const brand: Partial<BrandConcentrate> = brandArg || {};
  const item = document.createElement("div");
  item.className = "mineral-item" + (checked ? " selected" : "");
  const lbl = document.createElement("label");
  lbl.className = "mineral-label";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.value = bid;
  if (checked) input.checked = true;
  const info = document.createElement("div");
  info.className = "mineral-info";
  const nameSpan = document.createElement("span");
  nameSpan.className = "mineral-name";
  nameSpan.textContent = brand.name || bid;
  const badge = brandBadgeFor(bid);
  if (badge) {
    const badgeSpan = document.createElement("span");
    badgeSpan.className = badge.className;
    badgeSpan.textContent = badge.label;
    nameSpan.appendChild(badgeSpan);
  }
  info.appendChild(nameSpan);
  if (brand.formula) {
    const formulaSpan = document.createElement("span");
    formulaSpan.className = "mineral-formula";
    formulaSpan.textContent = brand.formula;
    info.appendChild(formulaSpan);
  }
  lbl.appendChild(input);
  lbl.appendChild(info);
  item.appendChild(lbl);
  return item;
}

function confirmDeleteStock(slug: string | undefined): void {
  if (!slug) return;
  const allSpecs = loadStockConcentrateSpecs();
  const delLabel = (allSpecs[slug] && allSpecs[slug]!.label) || slug;
  const runDelete = function () {
    const cur = loadStockConcentrateSpecs();
    delete cur[slug];
    saveStockConcentrateSpecs(cur);
    const remaining = loadSelectedConcentrates().filter(function (id) {
      return id !== "stock:" + slug;
    });
    saveSelectedConcentrates(remaining);
    rebuildConcentratesTab();
    dispatchChanged({ scope: "concentrates", category: "stock", deletedSlug: slug });
  };
  showConfirm('Delete recipe concentrate "' + delLabel + '"?', runDelete);
}

// ---- Unified row handlers (attached to every concentrate list) ----

// Type groups render only unselected rows, so a checkbox change there means
// "enable"; the Selected group renders only selected rows, so a change there
// means "disable". One handler covers both: enable/disable the single id,
// then rebuild so the row jumps to the right group.
function handleConcentrateRowChange(e: Event): void {
  const checkbox = e.target as HTMLInputElement | null;
  if (!checkbox || checkbox.type !== "checkbox") return;
  const concId = checkbox.value;

  // Enabling a DIY without a valid spec would silently dose 0 of that
  // mineral. Intercept: revert the checkbox and open the editor so the user
  // configures bottleMl + gramsPerBottle. The editor's save path persists
  // the spec AND adds the diy:* id, then onSaved rebuilds with it checked.
  if (checkbox.checked && concId.indexOf("diy:") === 0) {
    const mineralId = concId.slice(4);
    const specs = loadDiyConcentrateSpecs();
    const spec = specs[mineralId];
    const hasValidSpec = spec && Number(spec.bottleMl) > 0 && Number(spec.gramsPerBottle) > 0;
    if (!hasValidSpec) {
      checkbox.checked = false;
      const revertItem = checkbox.closest(".mineral-item");
      if (revertItem) revertItem.classList.remove("selected");
      if (typeof window.openDiyEditor === "function") {
        window.openDiyEditor({ mineralId: mineralId, onSaved: rebuildConcentratesTab });
      }
      return;
    }
  }

  setConcentrateEnabled(concId, checkbox.checked);
  dispatchChanged({ scope: "concentrates", toggledId: concId, enabled: checkbox.checked });
  rebuildConcentratesTab();
}

function handleConcentrateRowClick(e: Event): void {
  const el = e.target instanceof HTMLElement ? e.target : null;
  if (!el) return;
  const editBtn = el.closest<HTMLElement>(".mineral-selector-edit-btn");
  if (editBtn) {
    e.preventDefault();
    e.stopPropagation();
    if (editBtn.dataset.mineralId) {
      if (typeof window.openDiyEditor === "function")
        window.openDiyEditor({
          mineralId: editBtn.dataset.mineralId,
          onSaved: rebuildConcentratesTab,
        });
    } else if (editBtn.dataset.stockSlug) {
      if (typeof window.openStockEditor === "function")
        window.openStockEditor({
          mode: "edit",
          slug: editBtn.dataset.stockSlug,
          onSaved: rebuildConcentratesTab,
        });
    }
    return;
  }
  const delBtn = el.closest<HTMLElement>(".mineral-selector-delete-btn");
  if (delBtn) {
    e.preventDefault();
    e.stopPropagation();
    confirmDeleteStock(delBtn.dataset.stockSlug);
  }
}

// setStockEnabled lives in storage.js (top-level export) so the
// stock-editor modal's autoEnable path and the selector's change handler
// share one helper. Keeping a local shim would silently desync the two.

// ---- DIY subsection ----

function renderDiyContentInto(targetEl: HTMLElement): void {
  targetEl.innerHTML = "";
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent =
    "Single-mineral concentrates you've made at home. Tap the pencil to set bottle volume and grams per bottle.";
  targetEl.appendChild(hint);

  const list = document.createElement("div");
  list.className = "mineral-list mineral-selector-sublist";
  const selectedSet: Record<string, boolean> = {};
  const selected = loadSelectedConcentrates();
  for (let i = 0; i < selected.length; i++) selectedSet[selected[i]!] = true;
  for (const id in MINERAL_DB) {
    if (!Object.prototype.hasOwnProperty.call(MINERAL_DB, id)) continue;
    // Selected diy concentrates render in the "Selected Concentrates" group.
    if (selectedSet["diy:" + id]) continue;
    list.appendChild(buildDiyConcentrateRow(id, false));
  }
  targetEl.appendChild(list);

  list.addEventListener("change", handleConcentrateRowChange);
  list.addEventListener("click", handleConcentrateRowClick);
}

// ---- Stock subsection ----

function renderStockContentInto(targetEl: HTMLElement): void {
  targetEl.innerHTML = "";
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent =
    "Multi-mineral concentrates. Enable any number; the recipe builder and calculator sum each enabled concentrate's contribution.";
  targetEl.appendChild(hint);

  const newBtn = document.createElement("button");
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

  const specs = loadStockConcentrateSpecs();
  const stockIds = specs ? Object.keys(specs) : [];

  if (stockIds.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint mineral-selector-empty";
    empty.textContent = 'No recipe concentrates yet. Click "+ Create Concentrate" to add one.';
    targetEl.appendChild(empty);
    return;
  }

  const selected = loadSelectedConcentrates();
  const activeIds = getActiveStockIds(selected);
  const activeIdSet: Record<string, boolean> = {};
  for (let k = 0; k < activeIds.length; k++) activeIdSet[activeIds[k]!] = true;

  const list = document.createElement("div");
  list.className = "mineral-list mineral-selector-sublist";

  for (let i = 0; i < stockIds.length; i++) {
    const slug = stockIds[i]!;
    // Enabled recipe concentrates render in the "Selected Concentrates" group.
    if (activeIdSet["stock:" + slug]) continue;
    list.appendChild(buildStockConcentrateRow(slug, specs[slug], false));
  }
  targetEl.appendChild(list);

  list.addEventListener("change", handleConcentrateRowChange);
  list.addEventListener("click", handleConcentrateRowClick);
}

// ---- Brand subsection ----

// Parse a brand:<brand>:<rest> concentrate id into a display label and
// CSS modifier class so future brands can opt into their own pill color
// via .badge-<brand> CSS rules. Lotus is the only brand today; the same
// logic will pick up future brands automatically when their IDs land.
function brandBadgeFor(concentrateId: string): { label: string; className: string } | null {
  if (typeof concentrateId !== "string") return null;
  const parts = concentrateId.split(":");
  if (parts.length < 3 || parts[0] !== "brand") return null;
  const brand = parts[1] || "";
  if (!brand) return null;
  return {
    label: brand.charAt(0).toUpperCase() + brand.slice(1),
    className: "badge badge-" + brand,
  };
}

function renderBrandContentInto(targetEl: HTMLElement): void {
  targetEl.innerHTML = "";
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent =
    "Pre-made concentrates with fixed concentration. Pick your dropper style; checked items appear on tool pages.";
  targetEl.appendChild(hint);

  // Dropper-style toggle.
  const dropperWrap = document.createElement("div");
  dropperWrap.className = "mineral-selector-dropper-toggle";
  const dropperType = loadLotusDropperType();
  [
    { value: "round", label: "Round Dropper" },
    { value: "straight", label: "Straight Dropper" },
  ].forEach(function (opt) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "preset-btn mineral-selector-dropper-btn" + (dropperType === opt.value ? " active" : "");
    btn.dataset.dropper = opt.value;
    btn.textContent = opt.label;
    btn.addEventListener("click", function () {
      saveLotusDropperType(opt.value);
      dropperWrap
        .querySelectorAll<HTMLElement>(".mineral-selector-dropper-btn")
        .forEach(function (b) {
          b.classList.toggle("active", b.dataset.dropper === opt.value);
        });
      dispatchChanged({ scope: "concentrates", category: "brand", dropper: opt.value });
    });
    dropperWrap.appendChild(btn);
  });
  targetEl.appendChild(dropperWrap);

  const brandIds: readonly string[] =
    typeof LOTUS_CONCENTRATE_IDS !== "undefined" && LOTUS_CONCENTRATE_IDS
      ? LOTUS_CONCENTRATE_IDS
      : typeof BRAND_CONCENTRATES !== "undefined"
        ? Object.keys(BRAND_CONCENTRATES)
        : [];

  const selected = loadSelectedConcentrates();
  const selectedSet: Record<string, boolean> = {};
  for (let i = 0; i < selected.length; i++) selectedSet[selected[i]!] = true;

  const list = document.createElement("div");
  list.className = "mineral-list mineral-selector-sublist";

  const brandDb: Record<string, BrandConcentrate> =
    typeof BRAND_CONCENTRATES !== "undefined" ? BRAND_CONCENTRATES : {};
  for (let k = 0; k < brandIds.length; k++) {
    const bid = brandIds[k]!;
    // Selected brand concentrates render in the "Selected Concentrates" group.
    if (selectedSet[bid]) continue;
    list.appendChild(buildBrandConcentrateRow(bid, brandDb[bid], false));
  }
  targetEl.appendChild(list);

  list.addEventListener("change", handleConcentrateRowChange);
  list.addEventListener("click", handleConcentrateRowClick);
}

// ---- Selected Concentrates group (mirrors "Selected Minerals") ----

// The user's enabled concentrates across all three types, shown first and
// expanded. The type groups below hold only the unselected ones. Rebuilt on
// every toggle (via rebuildConcentratesTab) so rows move groups live.
function renderSelectedConcentratesInto(targetEl: HTMLElement): void {
  targetEl.innerHTML = "";

  const selected = loadSelectedConcentrates();
  const stockSpecs = loadStockConcentrateSpecs();
  const brandDb: Record<string, BrandConcentrate> =
    typeof BRAND_CONCENTRATES !== "undefined" ? BRAND_CONCENTRATES : {};

  const list = document.createElement("div");
  list.className = "mineral-list mineral-selector-sublist";
  let count = 0;

  for (let i = 0; i < selected.length; i++) {
    const concId = selected[i];
    if (typeof concId !== "string") continue;
    let row: HTMLDivElement | null = null;
    if (concId.indexOf("diy:") === 0) {
      const mineralId = concId.slice(4);
      if (!MINERAL_DB[mineralId]) continue;
      row = buildDiyConcentrateRow(mineralId, true);
      appendConcentrateTypeBadge(row, "DIY");
    } else if (concId.indexOf("stock:") === 0) {
      const slug = concId.slice(6);
      if (!stockSpecs[slug]) continue; // orphaned id (spec deleted) — skip
      row = buildStockConcentrateRow(slug, stockSpecs[slug], true);
      appendConcentrateTypeBadge(row, "Recipe");
    } else if (concId.indexOf("brand:") === 0) {
      if (!brandDb[concId]) continue;
      row = buildBrandConcentrateRow(concId, brandDb[concId], true);
    }
    if (row) {
      list.appendChild(row);
      count++;
    }
  }

  if (count === 0) {
    const empty = document.createElement("p");
    empty.className = "hint mineral-group-empty";
    empty.textContent = "No concentrates selected. Add some from the groups below.";
    targetEl.appendChild(empty);
    return;
  }

  targetEl.appendChild(list);
  list.addEventListener("change", handleConcentrateRowChange);
  list.addEventListener("click", handleConcentrateRowClick);
}

// ---- Tabbed modal (shared across all chip mounts) ----

let modalEl: HTMLDivElement | null = null;
let directListEl: HTMLDivElement | null = null;
let concSelectedContentEl: HTMLDivElement | null = null;
let concSelectedSummaryEl: HTMLButtonElement | null = null;
let concDiyContentEl: HTMLDivElement | null = null;
let concStockContentEl: HTMLDivElement | null = null;
let concBrandContentEl: HTMLDivElement | null = null;
let concDiySummaryEl: HTMLButtonElement | null = null;
let concStockSummaryEl: HTMLButtonElement | null = null;
let concBrandSummaryEl: HTMLButtonElement | null = null;
let directPanelEl: HTMLDivElement | null = null;
let concPanelEl: HTMLDivElement | null = null;
let directTabBtn: HTMLButtonElement | null = null;
let concTabBtn: HTMLButtonElement | null = null;
let modalCloseBtn: HTMLButtonElement | null = null;
let modalKeyHandler: ((e: KeyboardEvent) => void) | null = null;
let modalOverlayClickHandler: ((e: MouseEvent) => void) | null = null;
let modalPreviousFocus: HTMLElement | null = null;

// Build a collapsible subsection wrapper: each <section> contains a
// summary button and a content div as direct siblings, so the existing
// .card-collapsible-summary[aria-expanded="false"] ~ .card-collapsible-content
// CSS rule scopes naturally to that section without per-id rules.
function makeCollapsibleSubsection(
  title: string,
  expanded: boolean,
): { section: HTMLElement; content: HTMLDivElement; summary: HTMLButtonElement } {
  const section = document.createElement("section");
  section.className = "mineral-selector-subsection card-collapsible";

  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "card-collapsible-summary";
  summary.setAttribute("aria-expanded", expanded ? "true" : "false");
  const titleSpan = document.createElement("span");
  titleSpan.className = "card-collapsible-title";
  titleSpan.textContent = title;
  summary.appendChild(titleSpan);
  section.appendChild(summary);

  const content = document.createElement("div");
  content.className = "card-collapsible-content";
  section.appendChild(content);

  summary.addEventListener("click", function () {
    const open = summary.getAttribute("aria-expanded") === "true";
    summary.setAttribute("aria-expanded", open ? "false" : "true");
  });

  return { section: section, content: content, summary: summary };
}

function setActiveTab(tab: string): void {
  const isConcs = tab === "concentrates";
  directPanelEl!.hidden = isConcs;
  concPanelEl!.hidden = !isConcs;
  directTabBtn!.classList.toggle("mineral-selector-tab--active", !isConcs);
  concTabBtn!.classList.toggle("mineral-selector-tab--active", isConcs);
  directTabBtn!.setAttribute("aria-selected", !isConcs ? "true" : "false");
  concTabBtn!.setAttribute("aria-selected", isConcs ? "true" : "false");
  writeActiveTab(isConcs ? "concentrates" : "direct");
}

function rebuildConcentratesTab(): void {
  // Only the content divs rebuild — the collapsible summary wrappers
  // stay put so the user's open/closed state survives each rebuild.
  if (concSelectedContentEl) renderSelectedConcentratesInto(concSelectedContentEl);
  if (concDiyContentEl) renderDiyContentInto(concDiyContentEl);
  if (concStockContentEl) renderStockContentInto(concStockContentEl);
  if (concBrandContentEl) renderBrandContentInto(concBrandContentEl);
}

function ensureModal(): void {
  if (modalEl) return;
  modalEl = document.createElement("div");
  modalEl.className = "library-picker-overlay mineral-selector-modal-overlay";
  modalEl.id = "mineral-selector-modal-overlay";
  modalEl.style.display = "none";

  const dialog = document.createElement("div");
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

  const title = document.createElement("h2");
  title.id = "mineral-selector-modal-title";
  title.className = "library-picker-title";
  title.textContent = "Available Minerals & Concentrates";
  dialog.appendChild(title);

  const tabs = document.createElement("div");
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

  const panels = document.createElement("div");
  panels.className = "mineral-selector-tab-panels";

  // Direct Dose panel.
  directPanelEl = document.createElement("div");
  directPanelEl.className = "mineral-selector-tab-panel";
  directPanelEl.id = "mineral-selector-panel-direct";
  directPanelEl.setAttribute("role", "tabpanel");
  directPanelEl.setAttribute("aria-labelledby", "mineral-selector-tab-direct");

  const directHint = document.createElement("p");
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

  // "Selected Concentrates" first and expanded; the type groups below hold
  // only the unselected items and start collapsed (openModal sets state).
  const selectedWrap = makeCollapsibleSubsection("Selected Concentrates", true);
  concSelectedContentEl = selectedWrap.content;
  concSelectedSummaryEl = selectedWrap.summary;
  concPanelEl.appendChild(selectedWrap.section);

  const diyWrap = makeCollapsibleSubsection("Mineral Concentrates", false);
  concDiyContentEl = diyWrap.content;
  concDiySummaryEl = diyWrap.summary;
  concPanelEl.appendChild(diyWrap.section);

  const stockWrap = makeCollapsibleSubsection("Recipe Concentrates", false);
  concStockContentEl = stockWrap.content;
  concStockSummaryEl = stockWrap.summary;
  concPanelEl.appendChild(stockWrap.section);

  const brandWrap = makeCollapsibleSubsection("Brand Name Concentrates", false);
  concBrandContentEl = brandWrap.content;
  concBrandSummaryEl = brandWrap.summary;
  concPanelEl.appendChild(brandWrap.section);

  const manageLink = document.createElement("a");
  manageLink.className = "mineral-selector-manage-link";
  manageLink.href = "minerals.html";
  manageLink.textContent = "Open full Settings page →";
  concPanelEl.appendChild(manageLink);

  panels.appendChild(concPanelEl);
  dialog.appendChild(panels);

  modalEl.appendChild(dialog);
  document.body.appendChild(modalEl);
}

function openModal(): void {
  ensureModal();
  modalPreviousFocus = document.activeElement as HTMLElement | null;
  buildMineralListInto(directListEl!, loadSelectedMinerals());
  rebuildConcentratesTab();
  // "Selected Concentrates" is the calm default: expanded up top, with the
  // three type groups collapsed below (the user expands one to add more).
  if (concSelectedSummaryEl) concSelectedSummaryEl.setAttribute("aria-expanded", "true");
  if (concDiySummaryEl) concDiySummaryEl.setAttribute("aria-expanded", "false");
  if (concStockSummaryEl) concStockSummaryEl.setAttribute("aria-expanded", "false");
  if (concBrandSummaryEl) concBrandSummaryEl.setAttribute("aria-expanded", "false");
  setActiveTab(readActiveTab());
  modalEl!.style.display = "";
  if (window.lockBodyScroll) window.lockBodyScroll("mineral-selector");

  modalOverlayClickHandler = function (e) {
    if (e.target === modalEl) closeModal();
  };
  modalEl!.addEventListener("click", modalOverlayClickHandler);
  modalCloseBtn!.addEventListener("click", closeModal);

  modalKeyHandler = function (e) {
    if (e.key === "Escape") {
      closeModal();
      return;
    }
    if (e.key !== "Tab") return;
    const raw = modalEl!.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    const focusables: HTMLElement[] = [];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i]!.offsetParent !== null) focusables.push(raw[i]!);
    }
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
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
  const activeTab = readActiveTab() === "concentrates" ? concTabBtn : directTabBtn;
  if (activeTab && activeTab.focus) activeTab.focus();
}

function closeModal(): void {
  if (!modalEl) return;
  modalEl.style.display = "none";
  if (window.unlockBodyScroll) window.unlockBodyScroll("mineral-selector");
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

function chipLabelFor(mineral: MineralEntry): string {
  // Human-readable name (e.g. "Epsom Salt"), not the scientific formula.
  return mineral.name || mineral.formula;
}

// ---- Public mount: chip strip + "Edit minerals" button ----

// The mount element carries a cleanup hook so re-mount can detach the prior
// chip-rerender listener instead of leaking duplicate window listeners.
interface MineralSelectorMount extends HTMLElement {
  _cwMineralSelectorCleanup?: (() => void) | null;
}

function mountMineralSelector(targetEl: HTMLElement | null): void {
  if (!targetEl) return;
  const mount = targetEl as MineralSelectorMount;
  // If this element was already mounted, detach the previous chip-rerender
  // listener so re-mount doesn't leak duplicates (the old closure's chips
  // element is also out of the DOM, so its renderChips would no-op anyway,
  // but stale window listeners accumulate).
  if (typeof mount._cwMineralSelectorCleanup === "function") {
    mount._cwMineralSelectorCleanup();
    mount._cwMineralSelectorCleanup = null;
  }
  mount.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "mineral-selector-chips-wrap";

  const chips = document.createElement("div");
  chips.className = "mineral-chips";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  // Same design + copy as the "Edit Minerals" button on the Calculator and
  // Builder (a standard preset button), not a bespoke link style.
  editBtn.className = "preset-btn mineral-selector-chips-edit";
  editBtn.textContent = "Edit Minerals";
  editBtn.setAttribute("aria-label", "Edit the minerals and concentrates you have available");

  function appendBadge(chip: HTMLElement, label: string, className: string): void {
    const badge = document.createElement("span");
    badge.className = className;
    badge.textContent = label;
    chip.appendChild(badge);
  }

  function renderChips(): void {
    chips.innerHTML = "";
    const mineralIds = loadSelectedMinerals();
    const concentrateIds = loadSelectedConcentrates();

    if (mineralIds.length === 0 && concentrateIds.length === 0) {
      const empty = document.createElement("span");
      empty.className = "mineral-chip mineral-chip--empty";
      empty.textContent = "No minerals selected";
      chips.appendChild(empty);
      return;
    }

    for (let i = 0; i < mineralIds.length; i++) {
      const mineral = MINERAL_DB[mineralIds[i]!];
      if (!mineral) continue;
      const chip = document.createElement("span");
      chip.className = "mineral-chip";
      chip.textContent = chipLabelFor(mineral);
      chip.title = mineral.name;
      chips.appendChild(chip);
    }

    const stockSpecs = loadStockConcentrateSpecs();
    const brandDb: Record<string, BrandConcentrate> =
      typeof BRAND_CONCENTRATES !== "undefined" ? BRAND_CONCENTRATES : {};

    for (let j = 0; j < concentrateIds.length; j++) {
      const concId = concentrateIds[j];
      if (typeof concId !== "string") continue;

      if (concId.indexOf("diy:") === 0) {
        const diyMineralId = concId.slice(4);
        const diyMineral = MINERAL_DB[diyMineralId];
        if (!diyMineral) continue;
        const diyChip = document.createElement("span");
        diyChip.className = "mineral-chip";
        diyChip.textContent = chipLabelFor(diyMineral);
        diyChip.title = "DIY: " + diyMineral.name;
        appendBadge(diyChip, "DIY", "badge badge-concentrate");
        chips.appendChild(diyChip);
      } else if (concId.indexOf("stock:") === 0) {
        const slug = concId.slice(6);
        const spec = stockSpecs[slug];
        if (!spec) continue;
        const stockLabel = (spec && (spec.label || (spec as StockSpec).name)) || slug;
        const stockChip = document.createElement("span");
        stockChip.className = "mineral-chip";
        stockChip.textContent = stockLabel;
        stockChip.title = "Recipe Concentrate: " + stockLabel;
        appendBadge(stockChip, "Recipe", "badge badge-concentrate");
        chips.appendChild(stockChip);
      } else if (concId.indexOf("brand:") === 0) {
        const brand = brandDb[concId];
        if (!brand) continue;
        const brandChip = document.createElement("span");
        brandChip.className = "mineral-chip";
        brandChip.textContent = brand.name || concId;
        const brandBadge = brandBadgeFor(concId);
        brandChip.title = (brandBadge ? brandBadge.label + ": " : "") + (brand.name || concId);
        if (brandBadge) appendBadge(brandChip, brandBadge.label, brandBadge.className);
        chips.appendChild(brandChip);
      }
    }
  }

  editBtn.addEventListener("click", openModal);
  window.addEventListener("cw:minerals-changed", renderChips);
  mount._cwMineralSelectorCleanup = function () {
    window.removeEventListener("cw:minerals-changed", renderChips);
  };
  renderChips();

  wrap.appendChild(chips);
  wrap.appendChild(editBtn);
  mount.appendChild(wrap);
}

window.mountMineralSelector = mountMineralSelector;
window.openMineralSelectorModal = openModal;
