// =============================================================================
// recipe-browser.ts — Wave D recipe browser (mounted by library.html).
//
// D2 shipped the interactive filter bar + URL state + applyFilters predicate.
// D3 added the recipe card component, D4 added the featured hero and tray
// carousels. D5 wires filters into the rendered hero/carousels (so filter
// toggles actually narrow what's shown, not just the counter), adds the
// empty-state UI, and cuts over v2 → library.html.
//
// The filter predicate (`applyFilters`), section taxonomy (`LIBRARY_TRAYS`),
// and partition/featured helpers live in library-data.js so the Add From
// Library modal can share them. They're exposed on `window` (by
// library-data.js) so e2e tests reach them via page.evaluate unchanged.
//
// Phase A: converted from recipe-browser.js. Loaded via legacy-globals.ts (the
// bridge module imports this file as a side-effect). The IIFE wrapper is
// dropped — ES module scope already isolates internals. Storage helpers and
// formatStockSpec are imported from their migrated modules; the still-classic
// library-data globals (applyFilters / defaultFilters / partitionByCategory /
// pickFeaturedFromFiltered / LIBRARY_TRAYS / on-load+error subscriptions / the
// public-recipes accessors) are read via window.* AT CALL TIME rather than
// captured at module load — the original captured them into module vars, but
// since this module now loads (via legacy-globals) BEFORE the classic
// library-data.js script, a load-time capture would grab undefined. Reading
// window.* lazily is behavior-equivalent (library-data sets them once and never
// reassigns). deriveStockFormulaFromTarget (metrics.js) stays an ambient global;
// getUser is read from window (supabase-client publishes it via trySet). The
// public API is re-published on window so the not-yet-migrated caller (the
// library.html inline block, which calls window.mountRecipeBrowser) is unchanged.
// =============================================================================

import { formatStockSpec } from "../lib/stock-format";
import {
  addDeletedTargetPreset,
  deleteCustomTargetProfile,
  loadCustomTargetProfiles,
  loadStockConcentrateSpecs,
  removeAddedTargetPreset,
} from "../lib/storage";

const SEARCH_DEBOUNCE_MS = 150;

interface SegmentedOption {
  value: string;
  label: string;
}

const METHOD_OPTIONS: readonly SegmentedOption[] = [
  { value: "all", label: "All" },
  { value: "filter", label: "Filter" },
  { value: "espresso", label: "Espresso" },
];

const ROAST_OPTIONS: readonly SegmentedOption[] = [
  { value: "all", label: "All" },
  { value: "light", label: "Light" },
  { value: "medium", label: "Medium" },
  { value: "dark", label: "Dark" },
];

// Handlers passed down through cards / hero / carousels. The base contentHandlers
// (built in mountRecipeBrowser) provides every callback; per-render flags
// (saved / imported / derived / trayKey) are layered on via Object.assign. Every
// field is optional here because the call sites mirror the original's mix of
// guarded (`if (handlers.x)`) and direct calls — direct calls keep a `!`.
interface RecipeHandlers {
  saved?: boolean;
  imported?: boolean;
  derived?: boolean;
  trayKey?: string;
  isSaved?: (recipe: LibraryRecipeRow) => boolean;
  isStockImported?: (recipe: LibraryRecipeRow) => boolean;
  isStockDerived?: (recipe: LibraryRecipeRow) => boolean;
  isOwner?: (recipe: LibraryRecipeRow) => boolean;
  onToggleSave?: (recipe: LibraryRecipeRow) => void;
  onAddStock?: (recipe: LibraryRecipeRow) => void;
  onDeriveStock?: (recipe: LibraryRecipeRow) => void;
  onUseRecipe?: (recipe: LibraryRecipeRow) => void;
  onEditRecipe?: (recipe: LibraryRecipeRow) => void;
  onUnpublishRecipe?: (recipe: LibraryRecipeRow) => void;
  onClearFilters?: () => void;
  onRetry?: () => void;
}

// --- URL state ---------------------------------------------------------

function readFiltersFromUrl(): LibraryFilters {
  const f = window.defaultFilters!();
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch (e) {
    return f;
  }

  const method = params.get("method");
  if (method === "filter" || method === "espresso" || method === "all") f.method = method;

  const roast = params.get("roast");
  if (roast === "light" || roast === "medium" || roast === "dark" || roast === "all")
    f.roast = roast;

  const tags = params.get("tags");
  if (tags) {
    f.tags = tags
      .split(",")
      .map(function (t) {
        return t.trim();
      })
      .filter(Boolean);
  }

  f.mine = params.get("mine") === "1";

  const q = params.get("q");
  if (q) f.q = q;

  return f;
}

function writeFiltersToUrl(f: LibraryFilters): void {
  const params = new URLSearchParams();
  if (f.method !== "all") params.set("method", f.method);
  if (f.roast !== "all") params.set("roast", f.roast);
  if (f.tags.length) params.set("tags", f.tags.join(","));
  if (f.mine) params.set("mine", "1");
  if (f.q) params.set("q", f.q);

  const qs = params.toString();
  const next = window.location.pathname + (qs ? "?" + qs : "") + window.location.hash;
  try {
    window.history.replaceState(null, "", next);
  } catch (e) {
    // replaceState throws in some sandbox contexts (e.g. file://). Swallow
    // so the filter UX still works; URL just won't reflect state there.
  }
}

// --- Bookmark round-trip ----------------------------------------------

// Toggle the "in my profiles" state for a recipe. Works for both canonical
// library rows (recipe.userId == null, toggled via tombstone) and user-
// published rows (toggled via custom-profile add/delete by label match).
// Returns the new saved state.
function toggleBookmark(recipe: LibraryRecipeRow | null | undefined): boolean {
  if (!recipe) return false;
  const wasSaved =
    typeof window.isRecipeInMyProfiles === "function" && window.isRecipeInMyProfiles(recipe);

  if (!wasSaved) {
    if (typeof window.copyRecipeToMyProfiles === "function") window.copyRecipeToMyProfiles(recipe);
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
      addDeletedTargetPreset(recipe.slug);
    } else {
      removeAddedTargetPreset(recipe.slug);
    }
  } else {
    // User-published row — remove the custom profile that matches by label.
    // Same identity heuristic used by isRecipeInMyProfiles.
    const profiles = loadCustomTargetProfiles();
    const target = String(recipe.label || "").toLowerCase();
    for (const key in profiles) {
      if (
        Object.prototype.hasOwnProperty.call(profiles, key) &&
        String(profiles[key]!.label || "").toLowerCase() === target
      ) {
        deleteCustomTargetProfile(key);
        break;
      }
    }
  }
  return false;
}

// --- DOM helpers -------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string | null,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatMethod(recipe: LibraryRecipeRow): string {
  const method = recipe.brewMethod || "filter";
  return method === "all" ? "filter · espresso" : method;
}

function formatRoast(recipe: LibraryRecipeRow): string {
  const roasts = Array.isArray(recipe.roast) ? recipe.roast : [];
  if (roasts.length === 0 || roasts.indexOf("all") !== -1) return "any roast";
  return roasts.join(", ");
}

function formatMethodRoast(recipe: LibraryRecipeRow): string {
  return formatMethod(recipe) + " · " + formatRoast(recipe);
}

// Tags that are metadata, not user-facing display. Convention: any value
// matching /^via:/ identifies the catalogued source the recipe came from
// (e.g. 'via:coffee-ad-astra'). We render only the user-facing flavor tags
// ("Bright", "Sweet", etc.) as chips; via:* stays on the recipe row for
// analytics + admin reporting.
function visibleChipTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.filter(function (t) {
    return typeof t === "string" && !/^via:/.test(t);
  });
}

// Shared DIY-stock UI block — used by both createRecipeCard (regular card)
// and createFeaturedHero (featured hero). Renders the formula text plus an
// import sub-action that flips between "+ Create Concentrate" and "✓ In your
// pantry" + a Settings link. Single source of truth so the two surfaces can't
// drift.
function appendStockUi(container: HTMLElement, recipe: LibraryRecipeRow, handlers: RecipeHandlers) {
  const stockText = formatStockFormula(recipe.stockFormula);

  if (stockText) {
    // Hand-authored formula (Coffee ad Astra rows): existing
    // "+ Create Concentrate" adoption path is canonical and preserved verbatim.
    const stockRow = el("div", "rx-card-stock");
    stockRow.appendChild(el("span", "rx-card-stock-label", "Recipe concentrate"));
    stockRow.appendChild(el("span", "rx-card-stock-formula", stockText));
    container.appendChild(stockRow);

    const stockActions = el("div", "rx-card-stock-actions");
    if (handlers.imported) {
      const importedLabel = el("span", "rx-card-stock-imported", "✓ In your pantry");
      const settingsLink = el("a", "rx-card-stock-settings", "Settings");
      settingsLink.href = "minerals.html#stock-concentrates-summary";
      stockActions.appendChild(importedLabel);
      stockActions.appendChild(settingsLink);
    } else {
      const addBtn = el("button", "rx-card-stock-add", "+ Create Concentrate");
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

  const deriveActions = el("div", "rx-card-stock-actions");
  if (handlers.derived) {
    const derivedLabel = el("span", "rx-card-stock-imported", "✓ In your pantry");
    const derivedSettings = el("a", "rx-card-stock-settings", "Settings");
    derivedSettings.href = "minerals.html#stock-concentrates-summary";
    deriveActions.appendChild(derivedLabel);
    deriveActions.appendChild(derivedSettings);
  } else {
    const deriveBtn = el("button", "rx-card-stock-add", "+ Create Concentrate");
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
// no minerals to derive — skip rendering the action at all.
function hasDerivableIonProfile(recipe: LibraryRecipeRow | null | undefined): boolean {
  if (!recipe) return false;
  const fields = ["calcium", "magnesium", "potassium", "sodium", "bicarbonate"] as const;
  for (let i = 0; i < fields.length; i++) {
    if (Number(recipe[fields[i]!]) > 0) return true;
  }
  return false;
}

function formatStockFormula(formula: LibraryRecipeRow["stockFormula"]): string {
  return formatStockSpec(formula, { labelMode: "short", includeBottleDose: true });
}

// GH / KH summary row. Values from metrics.js's recipeMetricsSummary (on
// window): GH from Ca + Mg, KH from alkalinity, mg/L as CaCO3.
function createMineralTriplet(recipe: LibraryRecipeRow, extraClass?: string): HTMLDivElement {
  const wrap = el("div", "rx-mineral-triplet" + (extraClass ? " " + extraClass : ""));
  const summary =
    typeof window.recipeMetricsSummary === "function"
      ? window.recipeMetricsSummary(recipe)
      : { gh: null, kh: null };
  (
    [
      { label: "GH", value: summary.gh },
      { label: "KH", value: summary.kh },
    ] as Array<{ label: string; value: number | null }>
  ).forEach(function (pair) {
    const item = el("span", "rx-mineral-item");
    item.appendChild(el("span", "rx-mineral-label", pair.label));
    item.appendChild(el("span", "rx-mineral-value", pair.value != null ? String(pair.value) : "-"));
    wrap.appendChild(item);
  });
  return wrap;
}

interface SyncRow {
  row: HTMLDivElement;
  sync: () => void;
}

function createSegmentedRow(
  labelText: string,
  options: readonly SegmentedOption[],
  getValue: () => string,
  onChange: (value: string) => void,
): SyncRow {
  const row = el("div", "rx-filter-row");
  row.appendChild(el("div", "rx-filter-row-label", labelText));
  const group = el("div", "rx-segmented");
  const buttons: HTMLButtonElement[] = [];
  options.forEach(function (opt) {
    const btn = el("button", "rx-segmented-button", opt.label);
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
    const current = getValue();
    buttons.forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.value === current);
    });
  }

  return { row: row, sync: sync };
}

function createFlavorRow(
  getTags: () => string[],
  getMine: () => boolean,
  onToggleTag: (tag: string) => void,
  onToggleMine: () => void,
): SyncRow {
  const row = el("div", "rx-filter-row rx-filter-row-divided");
  row.appendChild(el("div", "rx-filter-row-label", "Flavor"));
  const group = el("div", "rx-chip-group");

  const myChip = el("button", "rx-chip rx-chip-my-recipes", "My Recipes");
  myChip.type = "button";
  myChip.addEventListener("click", onToggleMine);
  group.appendChild(myChip);

  const tagList: readonly string[] =
    typeof LIBRARY_TAGS !== "undefined" && Array.isArray(LIBRARY_TAGS) ? LIBRARY_TAGS : [];
  const tagChips: HTMLButtonElement[] = [];
  tagList.forEach(function (tag) {
    const chip = el("button", "rx-chip", tag);
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
    const active = getTags();
    tagChips.forEach(function (chip) {
      chip.classList.toggle("is-active", active.indexOf(chip.dataset.tag!) !== -1);
    });
    myChip.classList.toggle("is-active", getMine());
  }

  return { row: row, sync: sync };
}

interface SearchSection {
  section: HTMLDivElement;
  sync: () => void;
  input: HTMLInputElement;
}

function createSearchSection(getQ: () => string, onInput: (value: string) => void): SearchSection {
  const section = el("div", "rx-search");
  const input = el("input", "rx-search-input");
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

interface FilterSummary {
  summary: HTMLDivElement;
  sync: (matched: number, total: number, anyActive: boolean) => void;
}

function createFilterSummary(onClear: () => void): FilterSummary {
  const summary = el("div", "rx-filter-summary");
  const count = el("span", "rx-result-count", "");
  const clear = el("button", "rx-clear-filters", "Clear filters");
  clear.type = "button";
  clear.addEventListener("click", onClear);
  summary.appendChild(count);
  summary.appendChild(clear);

  function sync(matched: number, total: number, anyActive: boolean) {
    count.textContent = matched + " of " + total + " recipes";
    clear.hidden = !anyActive;
  }

  return { summary: summary, sync: sync };
}

// --- Recipe card / hero / carousel (D3 + D4) --------------------------

function createRecipeCard(recipe: LibraryRecipeRow, handlers: RecipeHandlers): HTMLElement {
  const card = el("article", "rx-recipe-card");
  card.dataset.slug = recipe.slug || "";
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-label", "View " + (recipe.label || "recipe") + " details");
  card.addEventListener("click", function (e) {
    // Skip clicks that originated on any interactive descendant — buttons
    // stopPropagation, but anchors (rx-card-stock-settings) don't, and
    // closest() is the defensive choice for any future inner controls too.
    // Note: the card itself has role="button" so we exclude it from the hit.
    const tgt = e.target as HTMLElement | null;
    const hit = tgt && tgt.closest ? tgt.closest('button, a, [role="button"]') : null;
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
  const header = el("div", "rx-card-header");
  const titleCol = el("div", "rx-card-title-col");
  titleCol.appendChild(el("h3", "rx-card-title", recipe.label || ""));
  // creatorDisplayLabel (src/lib/creator-display.ts) collapses the three
  // attribution states (system / deleted creator / known) into one string.
  if (typeof window.creatorDisplayLabel === "function") {
    titleCol.appendChild(el("p", "rx-card-source", "by " + window.creatorDisplayLabel(recipe)));
  } else if (recipe.creatorDisplayName) {
    titleCol.appendChild(el("p", "rx-card-source", "by " + recipe.creatorDisplayName));
  }
  header.appendChild(titleCol);

  const bookmark = el("button", "rx-card-bookmark");
  bookmark.type = "button";
  bookmark.setAttribute("aria-label", handlers.saved ? "Unsave recipe" : "Save recipe");
  bookmark.setAttribute("aria-pressed", handlers.saved ? "true" : "false");
  bookmark.textContent = handlers.saved ? "★" : "☆";
  if (handlers.saved) bookmark.classList.add("is-active");
  bookmark.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    handlers.onToggleSave!(recipe);
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
  const footer = el("div", "rx-card-footer");
  const tagList = el("div", "rx-card-tags");
  visibleChipTags(recipe.tags).forEach(function (tag) {
    tagList.appendChild(el("span", "rx-card-tag", tag));
  });
  footer.appendChild(tagList);
  footer.appendChild(el("span", "rx-card-meta", formatMethodRoast(recipe)));
  card.appendChild(footer);

  // Owner-only action row: edit + unpublish. Handlers.isOwner is false
  // until currentUserId resolves; cards re-render once it does.
  if (handlers.isOwner && handlers.isOwner(recipe)) {
    const ownerActions = el("div", "rx-card-owner-actions");
    const editBtn = el("button", "rx-card-owner-btn", "Edit");
    editBtn.type = "button";
    editBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      handlers.onEditRecipe!(recipe);
    });
    const unpublishBtn = el("button", "rx-card-owner-btn rx-card-owner-btn-danger", "Unpublish");
    unpublishBtn.type = "button";
    unpublishBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      handlers.onUnpublishRecipe!(recipe);
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
let detailOverlay: HTMLDivElement | null = null;
let detailDialog: HTMLDivElement | null = null;
let detailCloseBtn: HTMLButtonElement | null = null;
let detailScroll: HTMLDivElement | null = null;
let detailPreviousFocus: HTMLElement | null = null;
let detailKeyHandler: ((e: KeyboardEvent) => void) | null = null;
let detailOverlayClickHandler: ((e: MouseEvent) => void) | null = null;

function ensureDetailOverlay(): void {
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
type DetailIonField =
  | "calcium"
  | "magnesium"
  | "alkalinity"
  | "sodium"
  | "potassium"
  | "sulfate"
  | "chloride"
  | "bicarbonate";

const DETAIL_MINERAL_FIELDS: ReadonlyArray<{ field: DetailIonField; label: string }> = [
  { field: "calcium", label: "Ca" },
  { field: "magnesium", label: "Mg" },
  { field: "alkalinity", label: "Alk" },
  { field: "sodium", label: "Na" },
  { field: "potassium", label: "K" },
  { field: "sulfate", label: "SO₄" },
  { field: "chloride", label: "Cl" },
  { field: "bicarbonate", label: "HCO₃" },
];

function titleCaseCategory(cat: string | undefined): string {
  if (!cat) return "";
  return String(cat)
    .split("-")
    .map(function (s) {
      return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    })
    .join(" ");
}

function buildDetailBody(recipe: LibraryRecipeRow, handlers: RecipeHandlers): void {
  const scroll = detailScroll!;
  scroll.innerHTML = "";

  // Header: eyebrow + (title + Save) + byline
  const header = el("div", "rx-detail-header");

  const eyebrowText = titleCaseCategory(recipe.category);
  if (eyebrowText) header.appendChild(el("p", "rx-detail-eyebrow", eyebrowText));

  const titleRow = el("div", "rx-detail-title-row");
  const title = el("h2", "rx-detail-title", recipe.label || "");
  title.id = "rx-detail-title";
  titleRow.appendChild(title);

  const saved = handlers.isSaved && handlers.isSaved(recipe);
  const saveBtn = el("button", "rx-detail-save");
  saveBtn.type = "button";
  saveBtn.setAttribute("aria-label", saved ? "Unsave recipe" : "Save recipe");
  saveBtn.setAttribute("aria-pressed", saved ? "true" : "false");
  if (saved) saveBtn.classList.add("is-active");
  const saveIcon = el("span", "rx-detail-save-icon", saved ? "★" : "☆");
  const saveLabel = el("span", "rx-detail-save-label", saved ? "Saved" : "Save");
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

  scroll.appendChild(header);

  // Headline metrics (GH / KH / TDS) - derived summary numbers shown above the
  // raw per-ion breakdown. recipeMetricsSummary is bridged on window by
  // metrics.js. Rendered as a 3-up grid (.rx-detail-metrics).
  const summary =
    typeof window.recipeMetricsSummary === "function" ? window.recipeMetricsSummary(recipe) : null;
  if (summary) {
    const metricsSection = el("div", "rx-detail-section");
    const metricsGrid = el("div", "rx-detail-metrics");
    (
      [
        { label: "GH", value: summary.gh },
        { label: "KH", value: summary.kh },
        { label: "TDS", value: summary.tds },
      ] as Array<{ label: string; value: number | null }>
    ).forEach(function (m) {
      const cell = el("div", "rx-detail-metric");
      cell.appendChild(el("span", "rx-detail-metric-label", m.label));
      cell.appendChild(
        el("span", "rx-detail-metric-value", m.value != null ? String(m.value) : "-"),
      );
      metricsGrid.appendChild(cell);
    });
    metricsSection.appendChild(metricsGrid);
    scroll.appendChild(metricsSection);
  }

  // Description
  if (recipe.description) {
    const descSection = el("div", "rx-detail-section");
    descSection.appendChild(el("div", "rx-detail-section-label", "Description"));
    descSection.appendChild(el("p", "rx-detail-desc", recipe.description));
    scroll.appendChild(descSection);
  }

  // Mineral profile (all 8 ions)
  const mineralSection = el("div", "rx-detail-section");
  mineralSection.appendChild(el("div", "rx-detail-section-label", "Mineral profile (ppm)"));
  const mineralGrid = el("div", "rx-detail-minerals");
  DETAIL_MINERAL_FIELDS.forEach(function (pair) {
    const item = el("div", "rx-detail-mineral");
    item.appendChild(el("span", "rx-detail-mineral-label", pair.label));
    const val = recipe[pair.field];
    item.appendChild(el("span", "rx-detail-mineral-value", val != null ? String(val) : "-"));
    mineralGrid.appendChild(item);
  });
  mineralSection.appendChild(mineralGrid);
  scroll.appendChild(mineralSection);

  // Recipe concentrate (only when present)
  const stockText = formatStockFormula(recipe.stockFormula);
  if (stockText) {
    const stockSection = el("div", "rx-detail-section");
    stockSection.appendChild(el("div", "rx-detail-section-label", "Recipe concentrate"));
    const stockBox = el("div", "rx-detail-stock");
    stockBox.appendChild(document.createTextNode(stockText));
    const srcParts: string[] = [];
    const formula = recipe.stockFormula;
    if (formula && formula.source) srcParts.push("Source: " + formula.source);
    if (formula && formula.via) srcParts.push("via " + formula.via);
    if (srcParts.length) {
      stockBox.appendChild(el("span", "rx-detail-stock-source", srcParts.join(" · ")));
    }
    stockSection.appendChild(stockBox);
    scroll.appendChild(stockSection);
  }

  // Footer: flavor tags (left) + stacked method/roast (right)
  const footer = el("div", "rx-detail-footer");
  const tagList = el("div", "rx-detail-tags");
  visibleChipTags(recipe.tags).forEach(function (tag) {
    tagList.appendChild(el("span", "rx-card-tag", tag));
  });
  footer.appendChild(tagList);

  const meta = el("div", "rx-detail-meta");
  meta.appendChild(el("span", "rx-detail-meta-line", formatMethod(recipe)));
  meta.appendChild(el("span", "rx-detail-meta-line", formatRoast(recipe)));
  footer.appendChild(meta);
  scroll.appendChild(footer);

  // Bottom actions: stock action (left) + owner actions (right)
  const actions = el("div", "rx-detail-actions");
  let hasAnyAction = false;

  const detailFormula = recipe.stockFormula;
  if (detailFormula && Array.isArray(detailFormula.minerals) && detailFormula.minerals.length) {
    if (handlers.imported) {
      const importedWrap = el("div", "rx-detail-stock-status");
      importedWrap.appendChild(el("span", "rx-card-stock-imported", "✓ In your pantry"));
      const settingsLink = el("a", "rx-card-stock-settings", "Settings");
      settingsLink.href = "minerals.html#stock-concentrates-summary";
      importedWrap.appendChild(settingsLink);
      actions.appendChild(importedWrap);
    } else {
      const addBtn = el("button", "preset-btn", "+ Create Concentrate");
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
      const derivedWrap = el("div", "rx-detail-stock-status");
      derivedWrap.appendChild(el("span", "rx-card-stock-imported", "✓ In your pantry"));
      const derivedSettings = el("a", "rx-card-stock-settings", "Settings");
      derivedSettings.href = "minerals.html#stock-concentrates-summary";
      derivedWrap.appendChild(derivedSettings);
      actions.appendChild(derivedWrap);
    } else {
      const deriveBtn = el("button", "preset-btn", "+ Create Concentrate");
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
    const ownerGroup = el("div", "rx-detail-owner-actions");
    const editBtn = el("button", "rx-card-owner-btn", "Edit");
    editBtn.type = "button";
    editBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      // Close detail modal before opening the edit modal — see Add-to-stocks
      // handler above for the focus-trap / Escape rationale.
      closeRecipeDetailModal();
      if (handlers.onEditRecipe) handlers.onEditRecipe(recipe);
    });
    const unpublishBtn = el("button", "rx-card-owner-btn rx-card-owner-btn-danger", "Unpublish");
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

  if (hasAnyAction) scroll.appendChild(actions);
}

function openRecipeDetailModal(
  recipe: LibraryRecipeRow | null | undefined,
  handlers?: RecipeHandlers,
): void {
  if (!recipe) return;
  ensureDetailOverlay();
  buildDetailBody(recipe, handlers || {});

  const overlay = detailOverlay!;
  const closeBtn = detailCloseBtn!;
  detailPreviousFocus = document.activeElement as HTMLElement | null;
  overlay.style.display = "";
  // Lock the page behind the modal so a drag inside .rx-detail-scroll can't
  // scroll-chain to the document on native iOS (see lockBodyScroll).
  if (window.lockBodyScroll) window.lockBodyScroll("recipe-detail");

  detailOverlayClickHandler = function (e) {
    if (e.target === overlay) closeRecipeDetailModal();
  };
  overlay.addEventListener("click", detailOverlayClickHandler);
  closeBtn.addEventListener("click", closeRecipeDetailModal);

  detailKeyHandler = function (e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeRecipeDetailModal();
      return;
    }
    if (e.key !== "Tab") return;
    const raw = overlay.querySelectorAll<HTMLElement>(
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
  document.addEventListener("keydown", detailKeyHandler, true);

  if (closeBtn && closeBtn.focus) closeBtn.focus();
}

function closeRecipeDetailModal(): void {
  if (!detailOverlay) return;
  const overlay = detailOverlay;
  overlay.style.display = "none";
  if (window.unlockBodyScroll) window.unlockBodyScroll("recipe-detail");
  if (detailOverlayClickHandler) {
    overlay.removeEventListener("click", detailOverlayClickHandler);
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

function createTrayCarousel(
  title: string,
  subtitle: string | undefined,
  recipes: LibraryRecipeRow[] | undefined,
  handlers: RecipeHandlers,
): HTMLElement | null {
  if (!recipes || recipes.length === 0) return null;

  const section = el("section", "rx-carousel-section");
  section.dataset.tray = handlers.trayKey || "";

  const heading = el("div", "rx-carousel-heading");
  const titleCol = el("div", "rx-carousel-heading-text");
  titleCol.appendChild(el("h2", "rx-carousel-title", title));
  if (subtitle) titleCol.appendChild(el("p", "rx-carousel-subtitle", subtitle));
  heading.appendChild(titleCol);

  // Chevrons — visible only on desktop via CSS. Scroll the carousel
  // container by one card-width on click.
  const chevrons = el("div", "rx-carousel-chevrons");
  const scrollWrap = el("div", "rx-carousel-wrap");
  const scrollEl = el("div", "rx-carousel");

  function makeChevron(direction: string, label: string, symbol: string): HTMLButtonElement {
    const btn = el("button", "rx-chevron rx-chevron-" + direction, symbol);
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
    // onEditRecipe + onUnpublishRecipe to render owner affordances.
    scrollEl.appendChild(
      createRecipeCard(
        recipe,
        Object.assign({}, handlers, {
          saved: handlers.isSaved!(recipe),
          imported: handlers.isStockImported && handlers.isStockImported(recipe),
          derived: handlers.isStockDerived && handlers.isStockDerived(recipe),
        }),
      ),
    );
  });
  // Edge-fade affordance: toggle fade overlays from scroll position so the
  // overflow is visible on every viewport. ResizeObserver gives a correct
  // first read once the carousel is laid out (scrollWidth is 0 at build time).
  function updateCarouselScrollState() {
    const max = scrollEl.scrollWidth - scrollEl.clientWidth;
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

// Wide, full-width hero card for the Featured slot. Reuses createMineralTriplet
// and the existing handlers contract — bookmark star is still the only
// selection affordance, matching the regular library cards. data-tray="featured"
// is preserved so existing scroll-restoration / e2e selectors keep working.
function createFeaturedHero(
  recipe: LibraryRecipeRow,
  handlers: RecipeHandlers,
): HTMLElement | null {
  if (!recipe) return null;

  const section = el("section", "rx-featured-hero");
  section.dataset.tray = "featured";
  if (recipe.slug) section.dataset.slug = recipe.slug;
  section.setAttribute("role", "button");
  section.setAttribute("tabindex", "0");
  section.setAttribute("aria-label", "View " + (recipe.label || "recipe") + " details");
  section.addEventListener("click", function (e) {
    // Skip clicks that originated on any interactive descendant — same
    // reasoning as the card click handler in createRecipeCard.
    const tgt = e.target as HTMLElement | null;
    const hit = tgt && tgt.closest ? tgt.closest('button, a, [role="button"]') : null;
    if (hit && hit !== section) return;
    openRecipeDetailModal(recipe, handlers);
  });
  section.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target !== section) return;
    e.preventDefault();
    openRecipeDetailModal(recipe, handlers);
  });

  const eyebrow = el("p", "rx-featured-eyebrow");
  eyebrow.appendChild(el("span", "rx-featured-star", "★"));
  eyebrow.appendChild(document.createTextNode(" Featured · Editor's pick"));
  section.appendChild(eyebrow);

  const header = el("header", "rx-featured-header");
  const titleCol = el("div", "rx-featured-title-col");
  titleCol.appendChild(el("h2", "rx-featured-title", recipe.label || ""));
  if (typeof window.creatorDisplayLabel === "function") {
    titleCol.appendChild(el("p", "rx-featured-source", "by " + window.creatorDisplayLabel(recipe)));
  } else if (recipe.creatorDisplayName) {
    titleCol.appendChild(el("p", "rx-featured-source", "by " + recipe.creatorDisplayName));
  }
  header.appendChild(titleCol);

  // Bookmark sits as the title's flex sibling so the title-col absorbs
  // wrapping and the bookmark stays anchored at the header's top-right.
  const saved = handlers.isSaved && handlers.isSaved(recipe);
  const bookmark = el("button", "rx-featured-bookmark");
  bookmark.type = "button";
  bookmark.setAttribute("aria-label", saved ? "Unsave recipe" : "Save recipe");
  bookmark.setAttribute("aria-pressed", saved ? "true" : "false");
  bookmark.textContent = saved ? "★" : "☆";
  if (saved) bookmark.classList.add("is-active");
  bookmark.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    handlers.onToggleSave!(recipe);
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
  // via appendStockUi. Hero-scoped CSS overrides scale typography.
  appendStockUi(section, recipe, handlers);

  const footer = el("div", "rx-featured-footer");
  const tagList = el("div", "rx-featured-tags");
  visibleChipTags(recipe.tags).forEach(function (tag) {
    tagList.appendChild(el("span", "rx-card-tag", tag));
  });
  footer.appendChild(tagList);
  footer.appendChild(el("span", "rx-featured-meta", formatMethodRoast(recipe)));
  section.appendChild(footer);

  if (handlers.isOwner && handlers.isOwner(recipe)) {
    const ownerActions = el("div", "rx-featured-owner-actions");
    const editBtn = el("button", "rx-card-owner-btn", "Edit");
    editBtn.type = "button";
    editBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      handlers.onEditRecipe!(recipe);
    });
    const unpublishBtn = el("button", "rx-card-owner-btn rx-card-owner-btn-danger", "Unpublish");
    unpublishBtn.type = "button";
    unpublishBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      handlers.onUnpublishRecipe!(recipe);
    });
    ownerActions.appendChild(editBtn);
    ownerActions.appendChild(unpublishBtn);
    section.appendChild(ownerActions);
  }

  return section;
}

// --- Content layout ----------------------------------------------------

function createEmptyState(onClear: () => void): HTMLElement {
  const wrap = el("section", "rx-empty-state");
  wrap.appendChild(el("p", "rx-empty-title", "No recipes match these filters."));
  wrap.appendChild(el("p", "rx-empty-subtitle", "Try relaxing one of your constraints."));
  const cta = el("button", "rx-empty-clear", "Clear all filters");
  cta.type = "button";
  cta.addEventListener("click", onClear);
  wrap.appendChild(cta);
  return wrap;
}

// Shown when the catalog fetch failed and there's nothing cached to display,
// so the content region offers a recovery path instead of hanging blank
// (library-data.js fires onLibraryDataError on failure).
function createErrorState(onRetry: () => void): HTMLElement {
  const wrap = el("section", "rx-empty-state");
  wrap.appendChild(el("p", "rx-empty-title", "Couldn't load the recipe library."));
  wrap.appendChild(el("p", "rx-empty-subtitle", "Check your connection and try again."));
  const cta = el("button", "rx-empty-clear", "Retry");
  cta.type = "button";
  cta.addEventListener("click", onRetry);
  wrap.appendChild(cta);
  return wrap;
}

function renderContent(
  root: HTMLElement,
  filtered: LibraryRecipeRow[] | undefined,
  catalogLoaded: boolean,
  handlers: RecipeHandlers,
  method: string,
  loadFailed: boolean,
): void {
  // Capture horizontal scroll position of each existing carousel so a
  // re-render (triggered e.g. by star-toggle) doesn't reset users back to
  // the leftmost card of every tray. Keyed by tray slug in data-tray.
  const scrollByTray: Record<string, number> = {};
  const existingSections = root.querySelectorAll<HTMLElement>(".rx-carousel-section[data-tray]");
  for (let i = 0; i < existingSections.length; i++) {
    const key = existingSections[i]!.dataset.tray;
    const scrollEl = existingSections[i]!.querySelector(".rx-carousel");
    if (key && scrollEl) scrollByTray[key] = scrollEl.scrollLeft;
  }

  while (root.firstChild) root.removeChild(root.firstChild);

  // Library fetch hasn't resolved yet — stay silent until data lands. Using an
  // explicit "loaded" boolean (not a zero count) so a successful fetch that
  // returns zero rows correctly falls through to the empty state. If the fetch
  // FAILED and left us with no catalog, surface an error + retry instead.
  if (!catalogLoaded) {
    if (loadFailed) root.appendChild(createErrorState(handlers.onRetry!));
    return;
  }

  // Catalog loaded, but either filters excluded everything or the catalog
  // itself is empty. Either way, surface the clear-filters CTA — it's an
  // idempotent no-op when no filters are active.
  if (!Array.isArray(filtered) || filtered.length === 0) {
    root.appendChild(createEmptyState(handlers.onClearFilters!));
    return;
  }

  const byCategory = window.partitionByCategory!(filtered);

  // Featured slot: one card picked by brew-method filter. Rendered as a wide
  // hero (createFeaturedHero) instead of a single-card carousel.
  const featured = window.pickFeaturedFromFiltered!(filtered, method);
  if (featured) {
    // Mirror the carousel-iteration pattern (resolve saved + imported per
    // recipe before passing handlers into createCard). Letting
    // createFeaturedHero see `imported:` here closes the gap when a
    // stock-bearing recipe is promoted to Featured (B3a-hero).
    const heroHandlers: RecipeHandlers = Object.assign({}, handlers, {
      imported: handlers.isStockImported && handlers.isStockImported(featured),
      derived: handlers.isStockDerived && handlers.isStockDerived(featured),
    });
    const hero = createFeaturedHero(featured, heroHandlers);
    if (hero) root.appendChild(hero);
  }

  (window.LIBRARY_TRAYS || []).forEach(function (tray) {
    const carouselHandlers: RecipeHandlers = Object.assign({}, handlers, { trayKey: tray.key });
    const carousel = createTrayCarousel(
      tray.title,
      tray.subtitle,
      byCategory[tray.key],
      carouselHandlers,
    );
    if (carousel) root.appendChild(carousel);
  });

  // Restore captured scroll positions on the fresh DOM. Layout has resolved by
  // now because the sections are already appended. Missing keys (tray just
  // appeared) stay at scrollLeft=0 naturally.
  const newSections = root.querySelectorAll<HTMLElement>(".rx-carousel-section[data-tray]");
  for (let j = 0; j < newSections.length; j++) {
    const k = newSections[j]!.dataset.tray;
    const s = newSections[j]!.querySelector(".rx-carousel");
    if (k && s && scrollByTray[k] != null) s.scrollLeft = scrollByTray[k]!;
  }
}

// --- Mount -------------------------------------------------------------

function mountRecipeBrowser(root: HTMLElement | null): void {
  if (!root) return;

  while (root.firstChild) root.removeChild(root.firstChild);

  let state = readFiltersFromUrl();
  let allRecipes =
    typeof window.getPublicRecipesSync === "function" ? window.getPublicRecipesSync() : [];
  // A non-empty sync cache means library-data.js has already fetched or
  // rehydrated from sessionStorage — safe to render. Otherwise we wait for
  // onLibraryDataLoaded to flip this true before unblocking the content region.
  let catalogLoaded = allRecipes.length > 0;
  // Set when a catalog fetch fails with no cache to fall back on; flips
  // renderContent from a silent loading state to an error + retry card.
  let loadFailed = false;

  // currentUserId drives owner-only affordances (Edit / Unpublish). null until
  // getUser() resolves; re-rendered when it does. Stays null for anonymous
  // visitors so they see no owner buttons.
  let currentUserId: string | null = null;

  const page = el("div", "rx-page");

  const searchSection = createSearchSection(function () {
    return state.q;
  }, handleSearchInput);
  page.appendChild(searchSection.section);

  const filterBar = el("section", "rx-filter-bar");
  const methodRow = createSegmentedRow(
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

  const roastRow = createSegmentedRow(
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

  const flavorRow = createFlavorRow(
    function () {
      return state.tags;
    },
    function () {
      return state.mine;
    },
    function (tag) {
      const idx = state.tags.indexOf(tag);
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

  const summary = createFilterSummary(onClearFilters);
  page.appendChild(summary.summary);

  const contentRoot = el("div", "rx-content");
  page.appendChild(contentRoot);

  root.appendChild(page);

  // --- Content handlers ---------------------------------------------

  const contentHandlers: RecipeHandlers = {
    isSaved: function (recipe) {
      return (
        typeof window.isRecipeInMyProfiles === "function" && window.isRecipeInMyProfiles(recipe)
      );
    },
    // Stock pantry membership — true if the user has already imported this
    // library row's stockFormula into cw_stock_concentrate_specs. Read fresh
    // each call so a click-to-import on one card flips other cards on the
    // next render.
    isStockImported: function (recipe) {
      if (!recipe || !recipe.slug || !recipe.stockFormula) return false;
      const specs = loadStockConcentrateSpecs();
      return !!(specs && Object.prototype.hasOwnProperty.call(specs, recipe.slug));
    },
    // Derived-stock pantry membership — true if a previously-saved spec carries
    // createdFrom: "derived:<slug>" matching this recipe.
    isStockDerived: function (recipe) {
      if (!recipe || !recipe.slug) return false;
      const specs = loadStockConcentrateSpecs();
      if (!specs) return false;
      const marker = "derived:" + recipe.slug;
      const keys = Object.keys(specs);
      for (let i = 0; i < keys.length; i++) {
        const spec = specs[keys[i]!];
        if (spec && spec.createdFrom === marker) return true;
      }
      return false;
    },
    // Owner check — card passes recipe, we match against the fetched user.
    // userId === null on canonical library rows (SCA, Cafelytic, etc.) so
    // they're never rendered as owned.
    isOwner: function (recipe) {
      return !!(currentUserId && recipe && recipe.userId === currentUserId);
    },
    onToggleSave: function (recipe) {
      toggleBookmark(recipe);
      // Full re-render so every surface (hero + any carousel card) reflects
      // the new saved state. Cheap at 30 cards; revisit past ~200.
      render();
    },
    // Opens the stock-editor modal pre-filled with the recipe's hand-authored
    // stockFormula. On Save, the spec is keyed under recipe.slug so this card
    // flips to "✓ In your pantry" on the next render.
    onAddStock: function (recipe) {
      if (!recipe || !recipe.slug) return;
      if (typeof window.openStockEditor !== "function") {
        window.location.href = "minerals.html#stock-import=" + encodeURIComponent(recipe.slug);
        return;
      }
      const f = recipe.stockFormula || {};
      const minerals = Array.isArray(f.minerals)
        ? f.minerals
            .filter(function (m) {
              return m && typeof m === "object" && typeof m.mineralId === "string" && m.mineralId;
            })
            .map(function (m) {
              return { mineralId: m!.mineralId!, grams: Number(m!.grams) || 0 };
            })
        : [];
      const recipeName = recipe.label || recipe.slug;
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
    // Same shape as onAddStock but the formula is derived from the recipe's ion
    // targets via deriveStockFormulaFromTarget rather than copied from a
    // hand-authored stockFormula. Derivation runs here at click time.
    onDeriveStock: function (recipe) {
      if (!recipe || !recipe.slug) return;
      if (
        typeof window.openStockEditor !== "function" ||
        typeof deriveStockFormulaFromTarget !== "function"
      ) {
        window.location.href = "minerals.html#stock-derive=" + encodeURIComponent(recipe.slug);
        return;
      }
      const derived = deriveStockFormulaFromTarget(recipe);
      const recipeName = recipe.label || recipe.slug;
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
      const params = new URLSearchParams();
      if (recipe.slug) params.set("preset", recipe.slug);
      if (recipe.brewMethod === "filter" || recipe.brewMethod === "espresso") {
        params.set("method", recipe.brewMethod);
      }
      const qs = params.toString();
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
          // Optimistic removal: the Supabase update already landed, so drop the
          // row from local state before refetching. If the refetch fails, the
          // user still sees the expected result rather than the row reappearing
          // or the carousel going blank.
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

  // Shared helper: re-fetch library rows after an owner-initiated mutation so
  // edits/unpublishes surface without a full page reload. Falls back to the
  // existing sync cache if the network fetch fails.
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
      .catch(function (err: unknown) {
        console.warn("[recipe-browser] refetch failed; falling back to cache:", err);
        if (typeof window.getPublicRecipesSync === "function") {
          const fallback = window.getPublicRecipesSync();
          // Only adopt the cache when it actually has data. The unpublish and
          // edit flows invalidate the public-recipes cache before refetching,
          // so a network failure here would otherwise replace allRecipes with
          // [] and blank the carousel. Preserving the current state (which
          // includes optimistic mutations) keeps the UI consistent.
          if (Array.isArray(fallback) && fallback.length > 0) allRecipes = fallback;
        }
        // Optimistic: mutation already landed in Supabase; the cache may be
        // stale for a moment but the next library.html load will see the write.
        catalogLoaded = true;
        render();
      });
  }

  // --- State wiring --------------------------------------------------

  // window.setTimeout returns a DOM timer handle (number); annotate concretely
  // since @types/node's overload would otherwise widen ReturnType to Timeout.
  let searchTimer: number | null = null;

  function handleSearchInput(value: string) {
    state.q = value;
    if (searchTimer) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(function () {
      searchTimer = null;
      commit();
    }, SEARCH_DEBOUNCE_MS);
  }

  function onClearFilters() {
    state = window.defaultFilters!();
    searchSection.input.value = "";
    commit();
  }

  // Retry after a failed catalog load. Clear the error flag, re-render into the
  // silent loading state, then force a fresh fetch — the onLibraryData*
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

    const isSaved =
      typeof window.isRecipeInMyProfiles === "function" ? window.isRecipeInMyProfiles : undefined;
    const filtered = window.applyFilters!(state, allRecipes, { isSaved: isSaved });
    summary.sync(filtered.length, allRecipes.length, window.hasAnyActiveFilter!(state));
    renderContent(contentRoot, filtered, catalogLoaded, contentHandlers, state.method, loadFailed);
  }

  // Re-render when the async library fetch completes. library.html warms the
  // fetch via ensurePublicRecipesLoaded() on DOMContentLoaded; we subscribe to
  // both outcomes so a failure surfaces a retry instead of hanging blank.
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

  // Cross-device sync: when sync.js receives a Realtime change for this user,
  // re-fetch the library. If the user is mid-edit, defer — refetch will fire
  // again on modal close, since any save also dispatches cw:cloud-data-changed.
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

  // Resolve current user so owner-only card affordances can appear. Async —
  // cards re-render once the user id is known. Anonymous visitors never get
  // owner buttons (currentUserId stays null).
  if (typeof window.getUser === "function") {
    window
      .getUser()
      .then(function (res) {
        const user = res && res.data && res.data.user;
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
