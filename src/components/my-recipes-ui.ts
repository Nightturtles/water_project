// =============================================================================
// my-recipes-ui.ts — Owner affordances on library cards (edit + unpublish).
//
// Restores the edit-recipe modal and unpublish flow that were deleted in the
// Wave D5 cut-over (commit 028fc89). The UI surface is narrower than the
// old library-ui.js: no browsing logic, no add-to-my-profiles — just the two
// owner-only actions. Recipe-browser.js opens these when the user is the row
// creator (recipe.userId === currentUserId).
//
// DOM is built dynamically at open time so library.html stays lean.
//
// Phase A: converted from my-recipes-ui.js. Loaded via legacy-globals.ts (the
// bridge module imports this file as a side-effect). The original IIFE wrapper
// is dropped — ES module scope already isolates internals. Storage helpers are
// imported from src/lib/storage; the still-classic globals it touches
// (RESERVED_TARGET_KEYS, LIBRARY_TAGS, library-data's invalidatePublicRecipesCache)
// stay ambient / window.* with the same typeof guards as the original. The
// public API is re-published on window so the not-yet-migrated caller
// (recipe-browser.js) reaches openEditRecipeModal / confirmUnpublish unchanged.
// =============================================================================

import { loadCustomTargetProfiles, saveCustomTargetProfiles, slugify } from "../lib/storage";

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

// Button-styled checkbox used by the multi-select rows (brew method,
// roast level). The visual "checkbox" is a span inside the button so
// the hit target is the full button. onToggle receives the new active
// state after the click.
function createCheckButton(
  label: string,
  value: string,
  initialActive: boolean,
  onToggle: (active: boolean) => void,
): HTMLButtonElement {
  const btn = el("button", "rx-edit-check-btn");
  btn.type = "button";
  btn.dataset.value = value;
  btn.setAttribute("aria-pressed", initialActive ? "true" : "false");
  const box = el("span", "rx-edit-check-box");
  const text = el("span", "rx-edit-check-label", label);
  btn.appendChild(box);
  btn.appendChild(text);
  if (initialActive) btn.classList.add("is-active");
  btn.addEventListener("click", function () {
    const nowActive = !btn.classList.contains("is-active");
    btn.classList.toggle("is-active", nowActive);
    btn.setAttribute("aria-pressed", nowActive ? "true" : "false");
    onToggle(nowActive);
  });
  return btn;
}

// The eight editable ion fields. These are exactly the explicit numeric
// properties on TargetProfile, so indexing a recipe by one yields
// `number | undefined` (not the index signature's `unknown`).
type EditableIonField =
  | "calcium"
  | "magnesium"
  | "alkalinity"
  | "potassium"
  | "sodium"
  | "sulfate"
  | "chloride"
  | "bicarbonate";

const ION_FIELDS_LOCAL: ReadonlyArray<{ field: EditableIonField; label: string }> = [
  { field: "calcium", label: "Calcium" },
  { field: "magnesium", label: "Magnesium" },
  { field: "alkalinity", label: "Alkalinity (as CaCO₃)" },
  { field: "potassium", label: "Potassium" },
  { field: "sodium", label: "Sodium" },
  { field: "sulfate", label: "Sulfate" },
  { field: "chloride", label: "Chloride" },
  { field: "bicarbonate", label: "Bicarbonate" },
];

const BREW_METHODS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "filter", label: "Filter" },
  { value: "espresso", label: "Espresso" },
];

const ROAST_LEVELS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "light", label: "Light" },
  { value: "medium", label: "Medium" },
  { value: "dark", label: "Dark" },
];

// Decode the stored brewMethod string into a pair of checkbox states.
// 'all' means both methods; 'filter' / 'espresso' are single-select;
// anything else (including undefined) defaults to filter-only so the
// modal opens with at least one method selected.
function decodeBrewMethods(brewMethod: string | undefined): string[] {
  if (brewMethod === "all") return ["filter", "espresso"];
  if (brewMethod === "espresso") return ["espresso"];
  return ["filter"];
}

// Decode the stored roast array into checkbox states. The sentinel
// ['all'] (seeded by migration 006 for legacy rows) expands to all
// three levels so the user sees them pre-checked rather than none.
// Canonical order + dedup so duplicate input (e.g. ['light','light'])
// can't desync the UI toggle state from the saved payload.
function decodeRoastLevels(roast: string[] | undefined): string[] {
  if (!Array.isArray(roast) || roast.length === 0) return ["light", "medium", "dark"];
  if (roast.indexOf("all") !== -1) return ["light", "medium", "dark"];
  const seen: Record<string, boolean> = {};
  const out: string[] = [];
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
function encodeBrewMethod(selected: string[]): string {
  if (selected.length >= 2) return "all";
  return selected[0] || "filter";
}

interface EditRecipeOptions {
  onSaved?: () => void;
}

interface SaveContext {
  name: string;
  description: string;
  methods: string[];
  roasts: string[];
  ionInputs: Record<EditableIonField, HTMLInputElement>;
  tags: string[];
  errorEl: HTMLElement;
  saveBtn: HTMLButtonElement;
  close: () => void;
  onSaved: (() => void) | null;
}

// --- Edit modal -------------------------------------------------------

// openEditRecipeModal(recipe, { onSaved })
// Opens a centered modal pre-populated with the recipe's current fields.
// Saving updates Supabase + localStorage; onSaved is called after a
// successful save (before the modal closes). Returns a close() handle.
function openEditRecipeModal(recipe: LibraryRecipeRow, options?: EditRecipeOptions): () => void {
  options = options || {};
  const onSaved = typeof options.onSaved === "function" ? options.onSaved : null;

  // Cleanup any prior modal (defensive — shouldn't happen in practice).
  const existing = document.querySelector(".rx-edit-overlay");
  if (existing) existing.remove();

  const overlay = el("div", "rx-edit-overlay");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Edit recipe");

  const dialog = el("div", "rx-edit-dialog");
  overlay.appendChild(dialog);

  dialog.appendChild(el("h3", "rx-edit-title", "Edit recipe"));

  // --- Name ---
  const nameField = el("div", "rx-edit-field");
  nameField.appendChild(el("label", "rx-edit-label", "Name"));
  const nameInput = el("input", "rx-edit-input");
  nameInput.type = "text";
  nameInput.maxLength = 40;
  nameInput.value = recipe.label || "";
  nameField.appendChild(nameInput);
  dialog.appendChild(nameField);

  // --- Description ---
  const descField = el("div", "rx-edit-field");
  descField.appendChild(el("label", "rx-edit-label", "Description"));
  const descInput = el("textarea", "rx-edit-input rx-edit-textarea");
  descInput.rows = 2;
  descInput.maxLength = 200;
  descInput.value = recipe.description || "";
  descField.appendChild(descInput);
  dialog.appendChild(descField);

  // --- Brew method (multi-select) ---
  // Both 'filter' and 'espresso' can be checked simultaneously; two
  // checked encodes to brew_method='all' on save. At least one must be
  // selected (validated at save time).
  const activeMethods = decodeBrewMethods(recipe.brewMethod).slice();
  const methodField = el("div", "rx-edit-field");
  methodField.appendChild(el("label", "rx-edit-label", "Brew method"));
  const methodGroup = el("div", "rx-edit-method");
  BREW_METHODS.forEach(function (opt) {
    methodGroup.appendChild(
      createCheckButton(
        opt.label,
        opt.value,
        activeMethods.indexOf(opt.value) !== -1,
        function (isActive) {
          const idx = activeMethods.indexOf(opt.value);
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
  const activeRoasts = decodeRoastLevels(recipe.roast).slice();
  const roastField = el("div", "rx-edit-field");
  roastField.appendChild(el("label", "rx-edit-label", "Roast level"));
  const roastGroup = el("div", "rx-edit-roast");
  ROAST_LEVELS.forEach(function (opt) {
    roastGroup.appendChild(
      createCheckButton(
        opt.label,
        opt.value,
        activeRoasts.indexOf(opt.value) !== -1,
        function (isActive) {
          const idx = activeRoasts.indexOf(opt.value);
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
  const ionsGrid = el("div", "rx-edit-ions");
  const ionInputs = {} as Record<EditableIonField, HTMLInputElement>;
  ION_FIELDS_LOCAL.forEach(function (ion) {
    const wrap = el("div", "rx-edit-ion");
    wrap.appendChild(el("label", "rx-edit-ion-label", ion.label));
    const input = el("input", "rx-edit-input");
    input.type = "number";
    input.min = "0";
    input.step = "1";
    input.value = String(Math.round(recipe[ion.field] || 0));
    wrap.appendChild(input);
    ionsGrid.appendChild(wrap);
    ionInputs[ion.field] = input;
  });
  dialog.appendChild(ionsGrid);

  // --- Tags ---
  dialog.appendChild(el("label", "rx-edit-label", "Flavor tags"));
  const tagGroup = el("div", "rx-edit-tags");
  const activeTags = (Array.isArray(recipe.tags) ? recipe.tags : []).slice();
  const canonicalTags: readonly string[] =
    typeof LIBRARY_TAGS !== "undefined" && Array.isArray(LIBRARY_TAGS) ? LIBRARY_TAGS : [];
  canonicalTags.forEach(function (tag) {
    const chip = el("button", "rx-edit-tag-chip", tag);
    chip.type = "button";
    if (activeTags.indexOf(tag) !== -1) chip.classList.add("is-active");
    chip.addEventListener("click", function () {
      const idx = activeTags.indexOf(tag);
      if (idx === -1) activeTags.push(tag);
      else activeTags.splice(idx, 1);
      chip.classList.toggle("is-active");
    });
    tagGroup.appendChild(chip);
  });
  dialog.appendChild(tagGroup);

  // --- Error + actions ---
  const errorEl = el("div", "rx-edit-error");
  errorEl.setAttribute("role", "alert");
  dialog.appendChild(errorEl);

  const actions = el("div", "rx-edit-actions");
  const saveBtn = el("button", "rx-edit-save", "Save");
  saveBtn.type = "button";
  const cancelBtn = el("button", "rx-edit-cancel", "Cancel");
  cancelBtn.type = "button";
  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  dialog.appendChild(actions);

  // Tracked so cross-device Realtime listeners can skip re-rendering
  // the underlying rail/library while the user is mid-edit on this slug.
  // The modal itself is in its own DOM subtree and would survive a
  // re-render anyway; this just keeps the experience from feeling like
  // things are shifting beneath the user. Cleared on close().
  window._cwEditModalOpenSlug = recipe && recipe.slug ? recipe.slug : null;

  function close() {
    window._cwEditModalOpenSlug = null;
    if (window.unlockBodyScroll) window.unlockBodyScroll("edit-recipe");
    document.removeEventListener("keydown", keyHandler);
    overlay.removeEventListener("click", overlayClickHandler);
    overlay.remove();
    // Replay the deferred re-render hook. While the modal was open,
    // recipe-browser's cw:cloud-data-changed listener was gated by
    // _cwEditModalOpenSlug and skipped any refetchAndRender calls for
    // Realtime updates that arrived in that window. Dispatching a
    // synthetic event here gives those listeners exactly one chance
    // to catch up — refetchAndRender is a single Supabase query so the
    // cost in the no-changes case is small.
    if (typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent("cw:cloud-data-changed"));
    }
  }

  function keyHandler(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }

  function overlayClickHandler(e: MouseEvent) {
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
  if (window.lockBodyScroll) window.lockBodyScroll("edit-recipe");
  nameInput.focus();
  nameInput.select();

  return close;
}

function save(recipe: LibraryRecipeRow, ctx: SaveContext) {
  const name = (ctx.name || "").trim();
  if (!name) {
    ctx.errorEl.textContent = "Recipe name is required.";
    return;
  }

  const newSlug =
    typeof slugify === "function" ? slugify(name) : name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (!newSlug) {
    ctx.errorEl.textContent = "Enter a valid name.";
    return;
  }

  // Slug conflict check if the user renamed the recipe.
  if (newSlug !== recipe.slug && typeof loadCustomTargetProfiles === "function") {
    const profiles = loadCustomTargetProfiles();
    const reserved = typeof RESERVED_TARGET_KEYS !== "undefined" ? RESERVED_TARGET_KEYS : null;
    const reservedHit = reserved && typeof reserved.has === "function" && reserved.has(newSlug);
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
  function nonNeg(input: HTMLInputElement): number {
    const v = parseFloat(input.value);
    if (isNaN(v)) return 0;
    return Math.max(0, v);
  }

  const updated = {
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
    const localProfiles = loadCustomTargetProfiles();
    const existing: Partial<TargetProfile> = localProfiles[recipe.slug] || {};
    if (newSlug !== recipe.slug) delete localProfiles[recipe.slug];
    localProfiles[newSlug] = Object.assign({}, existing, updated, {
      creatorDisplayName: existing.creatorDisplayName || recipe.creatorDisplayName || "",
    });
    saveCustomTargetProfiles(localProfiles);
  }

  const supabasePayload = {
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

  // Promise.resolve adopts the Postgrest builder (a PromiseLike, not a full
  // Promise) into a real Promise so the original .then(...).catch(...) chain —
  // and its semantics, where the catch also catches a throw from the success
  // handler — is preserved verbatim.
  //
  // .select("id").maybeSingle() makes the affected-row count observable: a v2
  // UPDATE resolves with error:null even when zero rows matched (an RLS denial
  // or a stale/nonexistent id), so without the select we'd mirror a change
  // Supabase never accepted. The owner can still SELECT their own row after
  // this write (the "select own rows" RLS policy is independent of is_public),
  // so a genuine save returns the row and a no-op returns data:null.
  Promise.resolve(
    window.supabaseClient
      .from("target_profiles")
      .update(supabasePayload)
      .eq("id", recipe.id)
      .select("id")
      .maybeSingle(),
  )
    .then(function (result) {
      if (result.error || !result.data) {
        console.warn(
          "[my-recipes] edit update failed:",
          result.error || "no matching row (RLS or stale id)",
        );
        ctx.errorEl.textContent = "Failed to save changes. Please try again.";
        ctx.saveBtn.disabled = false;
        ctx.saveBtn.textContent = "Save";
        return;
      }
      // Remote write landed — now sync the local mirror.
      applyLocalMirror();
      finish();
    })
    .catch(function (err: unknown) {
      console.warn("[my-recipes] edit update threw:", err);
      ctx.errorEl.textContent = "Failed to save changes. Please try again.";
      ctx.saveBtn.disabled = false;
      ctx.saveBtn.textContent = "Save";
    });

  function finish() {
    if (typeof window.invalidatePublicRecipesCache === "function") {
      window.invalidatePublicRecipesCache();
    }
    if (typeof window.cwHaptic === "function") window.cwHaptic("medium");
    if (ctx.onSaved) ctx.onSaved();
    ctx.close();
  }
}

// --- Unpublish -------------------------------------------------------

interface ConfirmUnpublishOptions {
  onUnpublished?: () => void;
  confirm?: (message: string) => boolean;
}

// confirmUnpublish(recipe, { onUnpublished })
// Asks the user to confirm, then flips is_public=false in Supabase and
// mirrors the change into localStorage. onUnpublished fires on success.
function confirmUnpublish(recipe: LibraryRecipeRow, options?: ConfirmUnpublishOptions): void {
  options = options || {};
  const onUnpublished = typeof options.onUnpublished === "function" ? options.onUnpublished : null;

  const confirmFn =
    typeof options.confirm === "function" ? options.confirm : window.confirm.bind(window);
  const ok = confirmFn('Unpublish "' + (recipe.label || "") + '" from the Recipe Library?');
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
    const profiles = loadCustomTargetProfiles();
    if (profiles[recipe.slug]) {
      profiles[recipe.slug]!.isPublic = false;
      saveCustomTargetProfiles(profiles);
    }
  }

  if (typeof window.supabaseClient === "undefined") {
    applyLocalMirror();
    finish();
    return;
  }

  // Promise.resolve adopts the Postgrest builder (a PromiseLike) into a real
  // Promise so the original .then(...).catch(...) chain is preserved verbatim.
  //
  // .select("id").maybeSingle() is required for the same reason as the edit
  // path: a v2 UPDATE resolves error:null even when zero rows matched (RLS
  // denial or stale id), so a bare error check would mirror is_public=false
  // locally while the row stays public in Supabase. The owner's "select own
  // rows" RLS policy still returns the row after it flips to is_public=false,
  // so a real unpublish returns data and a no-op returns data:null.
  Promise.resolve(
    window.supabaseClient
      .from("target_profiles")
      .update({ is_public: false })
      .eq("id", recipe.id)
      .select("id")
      .maybeSingle(),
  )
    .then(function (result) {
      if (result.error || !result.data) {
        console.warn(
          "[my-recipes] unpublish failed:",
          result.error || "no matching row (RLS or stale id)",
        );
        return;
      }
      applyLocalMirror();
      finish();
    })
    .catch(function (err: unknown) {
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

export type { EditRecipeOptions, ConfirmUnpublishOptions };
