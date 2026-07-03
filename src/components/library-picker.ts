// =============================================================================
// library-picker.ts — Modal picker that adds a Recipe Library entry to the
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
//
// Phase A: converted from library-picker.js. Loaded via legacy-globals.ts
// (the bridge module imports this file as a side-effect). The original IIFE
// wrapper is dropped — ES module scope already isolates internals. The public
// API is re-published on window so the not-yet-migrated classic callers
// (script.js on index.html; the taste.html inline DOMContentLoaded block)
// reach window.showLibraryPicker unchanged. Library-data functions
// (getPublicRecipesSync, applyFilters, …) are still classic globals, so they
// are reached via window.* with the same typeof guards as the original.
// =============================================================================

import { LIBRARY_TAGS } from "../lib/constants";
import { recipeMetricsSummary } from "../lib/metrics";

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

let pickerCleanup: (() => void) | null = null;

// Public entry options. brewMethod / onAdd / title are all optional at the
// type level (the function coerces missing values), matching the original's
// `options = options || {}` + per-field defaulting.
export interface ShowLibraryPickerOptions {
  /** Initial method filter; "espresso" or "filter" (anything else → "filter"). */
  brewMethod?: string;
  /** Fires after copyRecipeToMyProfiles succeeds, with the new slug + recipe. */
  onAdd?: (slug: string, recipe: LibraryRecipeRow) => void;
  /** Optional override for the dialog heading. */
  title?: string;
}

function getOverlay(): HTMLElement | null {
  return document.getElementById("library-picker-overlay");
}

function brewMethodLabel(m: string | undefined): string {
  return m === "espresso" ? "Espresso" : "Filter";
}

function creatorLine(recipe: LibraryRecipeRow): string {
  // Delegate to the shared helper (src/lib/creator-display.ts) so the
  // "Anonymous User" fallback for deleted-creator recipes is consistent
  // with the recipe browser. Falls through to the legacy two-branch
  // logic if the bridge module hasn't initialized yet.
  if (typeof window.creatorDisplayLabel === "function") {
    return window.creatorDisplayLabel(recipe);
  }
  if (recipe.userId == null) return "Cafelytic";
  return recipe.creatorDisplayName || "Community";
}

function ionsSummary(recipe: LibraryRecipeRow): string {
  const s = recipeMetricsSummary(recipe);
  return "GH " + (s.gh != null ? s.gh : "-") + " · KH " + (s.kh != null ? s.kh : "-");
}

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

function buildCard(recipe: LibraryRecipeRow, extraClass?: string): HTMLDivElement {
  const card = el("div", "library-picker-card" + (extraClass ? " " + extraClass : ""));
  card.dataset.recipeId = String(recipe.id);

  const info = el("div", "library-picker-card-info");
  info.appendChild(el("div", "library-picker-card-title", recipe.label));
  info.appendChild(
    el(
      "div",
      "library-picker-card-meta",
      creatorLine(recipe) + " · " + brewMethodLabel(recipe.brewMethod),
    ),
  );
  info.appendChild(el("div", "library-picker-card-ions", ionsSummary(recipe)));
  card.appendChild(info);

  const action = el("button", "preset-btn library-picker-card-action");
  action.type = "button";
  const alreadyAdded =
    typeof window.isRecipeInMyProfiles === "function" && window.isRecipeInMyProfiles(recipe);
  if (alreadyAdded) {
    action.textContent = "Added";
    action.disabled = true;
    action.classList.add("library-picker-card-action--added");
  } else {
    action.textContent = "Add";
    action.dataset.addRecipeId = String(recipe.id);
  }
  card.appendChild(action);

  return card;
}

function buildSegmentedRow(
  labelText: string,
  options: readonly SegmentedOption[],
  currentValue: string,
  dataKey: string,
): HTMLDivElement {
  const row = el("div", "rx-filter-row library-picker-filter-row");
  row.appendChild(el("div", "rx-filter-row-label", labelText));
  const group = el("div", "rx-segmented");
  options.forEach(function (opt) {
    const btn = el("button", "rx-segmented-button", opt.label);
    btn.type = "button";
    btn.dataset[dataKey] = opt.value;
    if (opt.value === currentValue) btn.classList.add("is-active");
    group.appendChild(btn);
  });
  row.appendChild(group);
  return row;
}

function buildTagsRow(tagList: readonly string[], activeTags: readonly string[]): HTMLDivElement {
  const row = el("div", "rx-filter-row library-picker-filter-row");
  row.appendChild(el("div", "rx-filter-row-label", "Flavor"));
  const group = el("div", "rx-chip-group");
  tagList.forEach(function (tag) {
    const chip = el("button", "rx-chip", tag);
    chip.type = "button";
    chip.dataset.tag = tag;
    if (activeTags.indexOf(tag) !== -1) chip.classList.add("is-active");
    group.appendChild(chip);
  });
  row.appendChild(group);
  return row;
}

interface PickerState {
  method: string;
  roast: string;
  tags: string[];
  q: string;
}

// Public entry: open the picker. options:
//   brewMethod: "filter" | "espresso" — initial method filter (the user can
//               relax it to "all" or switch within the modal). Required.
//   onAdd:     function(slug, recipe) — fires after copyRecipeToMyProfiles
//              succeeds. The host page should re-render its preset rail
//              and activate the slug. Required.
//   title:     optional override for the dialog heading.
function showLibraryPicker(options?: ShowLibraryPickerOptions): void {
  options = options || {};
  const initialMethod = options.brewMethod === "espresso" ? "espresso" : "filter";
  const onAdd: (slug: string, recipe: LibraryRecipeRow) => void =
    typeof options.onAdd === "function" ? options.onAdd : function () {};
  const title = options.title || "Add From Library";

  const overlay = getOverlay();
  if (!overlay) {
    console.warn("[library-picker] overlay element missing on this page");
    return;
  }

  if (pickerCleanup) pickerCleanup();

  const dialog = overlay.querySelector(".library-picker-dialog");
  const titleEl = overlay.querySelector(".library-picker-title");
  const listEl = overlay.querySelector(".library-picker-list");
  const closeBtn = overlay.querySelector(".library-picker-close");
  if (!dialog || !titleEl || !listEl || !closeBtn) {
    console.warn("[library-picker] dialog markup incomplete on this page");
    return;
  }
  const previousFocus = document.activeElement as HTMLElement | null;

  titleEl.textContent = title;

  // Filter state — reset to open-time defaults each time the modal opens.
  // The modal does NOT participate in URL state (the library page owns ?q=
  // etc.); keeping state in this closure means the user sees a clean slate
  // every open and the URL never reflects modal-only filters.
  const state: PickerState = {
    method: initialMethod,
    roast: "all",
    tags: [],
    q: "",
  };
  const collapsedSections = new Set<string>();
  let searchDebounce: ReturnType<typeof setTimeout> | null = null;
  let searchInputEl: HTMLInputElement | null = null;

  const tagList: readonly string[] =
    typeof LIBRARY_TAGS !== "undefined" && Array.isArray(LIBRARY_TAGS) ? LIBRARY_TAGS : [];

  // ---- Render scaffold (one-time per open) -------------------------------

  listEl.innerHTML = "";

  const searchSection = el("div", "library-picker-search");
  const searchInput = el("input", "rx-search-input library-picker-search-input");
  searchInput.type = "search";
  searchInput.placeholder = "Search recipes…";
  searchInput.autocomplete = "off";
  searchInput.setAttribute("aria-label", "Search recipes");
  searchSection.appendChild(searchInput);
  searchInputEl = searchInput;
  listEl.appendChild(searchSection);

  const filtersWrap = el("div", "library-picker-filters");
  listEl.appendChild(filtersWrap);

  const resultsWrap = el("div", "library-picker-results");
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

    const allRecipes =
      typeof window.getPublicRecipesSync === "function" ? window.getPublicRecipesSync() : [];

    // The library catalog is empty until the async fetch resolves (or has
    // failed). Distinguish "fetching" from "fetched-but-empty" so the user
    // sees a loading message rather than a no-matches state on cold open.
    if ((!allRecipes || allRecipes.length === 0) && !catalogLoaded) {
      const loading = el("p", "library-picker-empty", "Loading library…");
      resultsWrap.appendChild(loading);
      return;
    }

    const filtered =
      typeof window.applyFilters === "function"
        ? window.applyFilters(state, allRecipes)
        : allRecipes;

    // Empty state — surface "Clear filters" only when something is filtered.
    if (!filtered || filtered.length === 0) {
      const emptyWrap = el("div", "library-picker-empty-wrap");
      emptyWrap.appendChild(el("p", "library-picker-empty", "No recipes match."));
      const anyActive =
        typeof window.hasAnyActiveFilter === "function" ? window.hasAnyActiveFilter(state) : false;
      if (anyActive) {
        const clearBtn = el("button", "library-picker-clear-filters", "Clear filters");
        clearBtn.type = "button";
        clearBtn.dataset.action = "clear-filters";
        emptyWrap.appendChild(clearBtn);
      }
      resultsWrap.appendChild(emptyWrap);
      return;
    }

    // Featured: pinned at top (non-collapsible). Use the doubly-filtered
    // set so the pinned card respects the active search/filter state.
    const featured =
      typeof window.pickFeaturedFromFiltered === "function"
        ? window.pickFeaturedFromFiltered(filtered, state.method)
        : null;
    if (featured) {
      resultsWrap.appendChild(buildCard(featured, "library-picker-card--featured"));
    }

    // Sections: iterate LIBRARY_TRAYS so order is canonical. Sections with
    // 0 recipes are skipped entirely (no empty headers).
    const trays = Array.isArray(window.LIBRARY_TRAYS) ? window.LIBRARY_TRAYS : [];
    const byCategory =
      typeof window.partitionByCategory === "function" ? window.partitionByCategory(filtered) : {};

    const searchActive = state.q !== "";

    trays.forEach(function (tray) {
      const bucket = byCategory[tray.key] || [];
      if (bucket.length === 0) return;

      const section = el("section", "library-picker-section");

      const contentId = "lp-section-" + tray.key;
      // While search is active, force-expand every section so users see why
      // their query matched. Otherwise respect user collapse state.
      const expanded = searchActive ? true : !collapsedSections.has(tray.key);

      const summary = el("button", "card-collapsible-summary library-picker-section-summary");
      summary.type = "button";
      summary.setAttribute("aria-expanded", expanded ? "true" : "false");
      summary.setAttribute("aria-controls", contentId);
      summary.dataset.sectionKey = tray.key;

      const titleSpan = el("span", "card-collapsible-title");
      titleSpan.appendChild(document.createTextNode(tray.title + " "));
      titleSpan.appendChild(el("span", "library-picker-section-count", "(" + bucket.length + ")"));
      summary.appendChild(titleSpan);

      const content = el("div", "card-collapsible-content library-picker-section-content");
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

  let catalogLoaded = false;
  const initial =
    typeof window.getPublicRecipesSync === "function" ? window.getPublicRecipesSync() : [];
  if (initial && initial.length) {
    catalogLoaded = true;
  }
  render();

  overlay.style.display = "flex";
  if (window.lockBodyScroll) window.lockBodyScroll("library-picker");
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
      .catch(function (e: unknown) {
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

  function onFiltersClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const methodBtn = target.closest<HTMLElement>("[data-method]");
    if (methodBtn) {
      state.method = methodBtn.dataset.method!;
      render();
      return;
    }
    const roastBtn = target.closest<HTMLElement>("[data-roast]");
    if (roastBtn) {
      state.roast = roastBtn.dataset.roast!;
      render();
      return;
    }
    const tagBtn = target.closest<HTMLElement>("[data-tag]");
    if (tagBtn) {
      const tag = tagBtn.dataset.tag!;
      const idx = state.tags.indexOf(tag);
      if (idx === -1) state.tags.push(tag);
      else state.tags.splice(idx, 1);
      render();
      return;
    }
  }

  function onResultsClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const clearBtn = target.closest<HTMLElement>('[data-action="clear-filters"]');
    if (clearBtn) {
      resetState();
      render();
      return;
    }

    const sectionSummary = target.closest<HTMLElement>(".library-picker-section-summary");
    if (sectionSummary) {
      // Suppress collapse toggle while search is active — sections are
      // force-expanded so the user can see all matches.
      if (state.q !== "") return;
      const key = sectionSummary.dataset.sectionKey;
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

    const actionBtn = target.closest<HTMLElement>("[data-add-recipe-id]");
    if (actionBtn) {
      const id = actionBtn.dataset.addRecipeId;
      const recipes =
        (typeof window.getPublicRecipesSync === "function" ? window.getPublicRecipesSync() : []) ||
        [];
      let recipe: LibraryRecipeRow | null = null;
      for (let i = 0; i < recipes.length; i++) {
        if (String(recipes[i]!.id) === String(id)) {
          recipe = recipes[i]!;
          break;
        }
      }
      if (!recipe) return;
      if (typeof window.copyRecipeToMyProfiles !== "function") return;
      const slug = window.copyRecipeToMyProfiles(recipe);
      if (!slug) return;
      close();
      onAdd(slug, recipe);
    }
  }

  function close() {
    overlay!.style.display = "none";
    if (window.unlockBodyScroll) window.unlockBodyScroll("library-picker");
    overlay!.removeEventListener("click", overlayClick);
    filtersWrap.removeEventListener("click", onFiltersClick);
    resultsWrap.removeEventListener("click", onResultsClick);
    searchInput.removeEventListener("input", onSearchInput);
    closeBtn!.removeEventListener("click", close);
    document.removeEventListener("keydown", keyHandler);
    if (searchDebounce) {
      clearTimeout(searchDebounce);
      searchDebounce = null;
    }
    pickerCleanup = null;
    if (previousFocus && previousFocus.focus) previousFocus.focus();
  }

  function overlayClick(e: MouseEvent) {
    if (e.target === overlay) close();
  }

  function keyHandler(e: KeyboardEvent) {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (e.key !== "Tab") return;
    // Focus trap: cycle within the dialog. Build the list fresh so newly
    // rendered cards from the async fetch are included. Filter by
    // visibility — buttons inside collapsed sections (display:none via the
    // card-collapsible sibling selector) shouldn't be in the Tab cycle.
    const raw = dialog!.querySelectorAll<HTMLElement>(
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
