// Slim recipe card — a trimmed version of the library page's createRecipeCard
// (recipe-browser.js), used by the calculator (index.html) and taste tuner
// (taste.html) profile rails. Renders title + Ca/Mg/Alk triplet + flavor chips
// + method·roast meta only; it omits the creator line, description, bookmark,
// stock/concentrate UI, and owner actions the full library card carries.
//
// The inner element classes (rx-card-title, rx-mineral-*, rx-card-tags,
// rx-card-tag) are shared with the library card via style.css — the single
// visual source of truth — so the two surfaces can't drift on chip / mineral
// styling. The card root gets its own .rx-slim-card class for the grid layout.
//
// The few pure helpers below mirror recipe-browser.js (el / visibleChipTags /
// formatMethod / formatRoast / createMineralTriplet). That file is the library
// page's UI and is NOT loaded on index.html or taste.html, so the helpers are
// re-implemented here rather than imported. They are trivial and stable; when
// recipe-browser.js is eventually converted to TS it can converge onto these.
//
// Exposed on window (mirroring creator-display.ts / ui-shared) so the classic
// scripts (script.js and the taste.html inline script) can call it without an
// import. Pulled in via the bare side-effect import in src/lib/legacy-globals.ts.

export interface SlimRecipe {
  label?: string;
  calcium?: number | null;
  magnesium?: number | null;
  alkalinity?: number | null;
  brewMethod?: string;
  roast?: string[] | null;
  tags?: string[] | null;
}

export interface SlimRecipeCardOptions {
  /** Stable key for the rail; written to data-profile (calculator) or data-preset (taste). */
  slug: string;
  /** Which data-* attribute the page's delegated click handler reads. Default "profile". */
  attrName?: "profile" | "preset";
  /** Active highlight — adds the existing .active class + aria-pressed="true". */
  selected?: boolean;
  /** Edit-mode delete affordance — renders the × badge with data-delete=slug. */
  deletable?: boolean;
  /** taste.html only: marks editable built-ins via data-target-key (used by updateCurrentEditBar). */
  targetKey?: string | null;
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Drop metadata tags (convention: /^via:/ identifies the catalogued source,
// e.g. "via:coffee-ad-astra"); render only the user-facing flavor tags as chips.
function visibleChipTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.filter((t): t is string => typeof t === "string" && !/^via:/.test(t));
}

function formatMethod(recipe: SlimRecipe): string {
  const method = recipe.brewMethod || "filter";
  return method === "all" ? "filter · espresso" : method;
}

function formatRoast(recipe: SlimRecipe): string {
  const roasts = Array.isArray(recipe.roast) ? recipe.roast : [];
  if (roasts.length === 0 || roasts.indexOf("all") !== -1) return "any roast";
  return roasts.join(", ");
}

function formatMethodRoast(recipe: SlimRecipe): string {
  return formatMethod(recipe) + " · " + formatRoast(recipe);
}

// GH / KH summary row (replaces the raw Ca/Mg/Alk triplet). Values come from
// metrics.js's recipeMetricsSummary, bridged on window: GH from Ca + Mg, KH
// from alkalinity, both as mg/L CaCO3. Reuses the .rx-mineral-* classes, so a
// pair renders with the same styling the triplet used.
function hardnessRow(recipe: SlimRecipe): HTMLElement {
  const wrap = el("div", "rx-mineral-triplet");
  const summary =
    typeof window.recipeMetricsSummary === "function" ? window.recipeMetricsSummary(recipe) : null;
  const pairs: Array<{ label: string; value: number | null }> = [
    { label: "GH", value: summary ? summary.gh : null },
    { label: "KH", value: summary ? summary.kh : null },
  ];
  pairs.forEach((pair) => {
    const item = el("span", "rx-mineral-item");
    item.appendChild(el("span", "rx-mineral-label", pair.label));
    item.appendChild(el("span", "rx-mineral-value", pair.value != null ? String(pair.value) : "-"));
    wrap.appendChild(item);
  });
  return wrap;
}

export function buildSlimRecipeCard(recipe: SlimRecipe, opts: SlimRecipeCardOptions): HTMLElement {
  const attr = opts.attrName === "preset" ? "preset" : "profile";
  const card = el("article", "rx-slim-card");
  card.dataset[attr] = opts.slug;
  if (opts.targetKey) card.dataset.targetKey = opts.targetKey;
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-pressed", opts.selected ? "true" : "false");
  card.setAttribute("aria-label", recipe.label || "recipe");
  if (opts.selected) card.classList.add("active");

  const header = el("div", "rx-slim-card-header");
  header.appendChild(el("h3", "rx-card-title", recipe.label || ""));
  card.appendChild(header);

  card.appendChild(hardnessRow(recipe));

  // Flavor chips get their own full-width row so they flow horizontally (not
  // squeezed into a vertical column by sharing a space-between footer with the
  // meta). Omitted entirely when the recipe has no user-facing tags.
  const tags = visibleChipTags(recipe.tags);
  if (tags.length) {
    const tagList = el("div", "rx-card-tags");
    tags.forEach((t) => tagList.appendChild(el("span", "rx-card-tag", t)));
    card.appendChild(tagList);
  }

  // Meta is always shown (product decision): "method · roast", falling back to
  // "filter · any roast" for recipes (shim presets, custom profiles) that carry
  // no brewMethod / roast metadata.
  card.appendChild(el("div", "rx-slim-meta", formatMethodRoast(recipe)));

  if (opts.deletable) {
    const del = el("span", "preset-delete", "×");
    del.dataset.delete = opts.slug;
    del.setAttribute("role", "button");
    del.setAttribute("tabindex", "0");
    del.setAttribute("aria-label", "Delete profile");
    // Keyboard parity: Enter/Space on the focused badge fires the same delegated
    // delete handler the click path uses (it reads data-delete). stopPropagation
    // keeps the key event from also reaching the card-level keydown (select).
    del.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      del.click();
    });
    card.appendChild(del);
  }

  // Keyboard parity with the <button> this replaces. The click itself is handled
  // by each page's existing delegated container listener (which reads
  // data-profile / data-preset), so here we only translate Enter/Space on the
  // focused card into a click. The delete badge owns its own activation via the
  // delegated [data-delete] branch, so we ignore key events that aren't on the card.
  card.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target !== card) return;
    e.preventDefault();
    card.click();
  });

  return card;
}

declare global {
  interface Window {
    buildSlimRecipeCard?: (recipe: SlimRecipe, opts: SlimRecipeCardOptions) => HTMLElement;
  }
}

if (typeof window !== "undefined") {
  window.buildSlimRecipeCard = buildSlimRecipeCard;
}
