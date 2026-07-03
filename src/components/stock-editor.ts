// =============================================================================
// stock-editor.ts — Modal editor for stock concentrate solutions.
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
//
// Phase A: converted from stock-editor.js. Loaded via legacy-globals.ts (the
// bridge module imports this file as a side-effect). The original IIFE wrapper
// is dropped — ES module scope already isolates internals. The public API is
// re-published on window so the not-yet-migrated classic callers
// (mineral-selector.js, recipe-browser.js) reach openStockEditor unchanged.
// =============================================================================

import {
  MINERAL_DB,
  RESERVED_LIBRARY_STOCK_SLUGS,
  MINERAL_SOLUBILITY_G_PER_L_25C_APPROX,
} from "../lib/constants";
import { showConfirm } from "./ui-shared";
import { escapeHtml } from "../lib/html";
import {
  slugify,
  loadStockConcentrateSpecs,
  saveStockConcentrateSpecs,
  setStockEnabled,
  loadSelectedConcentrates,
  saveSelectedConcentrates,
} from "../lib/storage";

interface StockEditorMineral {
  mineralId: string;
  grams: number;
}

// Local mirror of storage.ts's (non-exported) StockConcentrateSpec, used for
// the spec objects this module reads from / writes to loadStockConcentrateSpecs.
// Structurally identical, so the records round-trip through storage's Record
// type without a cast.
interface StockSpec {
  label?: string;
  bottleMl?: number;
  doseGramsPerL?: number;
  minerals?: StockEditorMineral[];
  createdFrom?: string;
  source?: string;
}

export interface StockEditorPrefill {
  label?: string;
  bottleMl?: number;
  doseGramsPerL?: number;
  minerals?: Array<{ mineralId?: string; grams?: number }>;
  hint?: string;
  notes?: string[];
  deriveSlug?: string;
  importSlug?: string;
  source?: string;
}

export interface OpenStockEditorOptions {
  /** "edit" loads an existing spec by slug; any other value seeds a new form from prefill. */
  mode?: string;
  /** Required in edit mode — the slug of the stock spec to load. */
  slug?: string;
  prefill?: StockEditorPrefill;
  /** New stocks only: additively enable the saved stock after creation. */
  autoEnable?: boolean;
  /** Fires with the saved slug after a save, or null after a delete. */
  onSaved?: (slug: string | null) => void;
}

interface StockEditorSession {
  mode: string;
  editSlug: string | null;
  label: string;
  bottleMl: number;
  doseGramsPerL: number;
  minerals: StockEditorMineral[];
  hint: string;
  notes: string[];
  deriveSlug: string;
  importSlug: string;
  importSource: string;
  autoEnable: boolean;
  onSaved: ((slug: string | null) => void) | null;
}

interface StockDraft {
  label: string;
  bottleMl: number;
  doseGramsPerL: number;
  minerals: StockEditorMineral[];
}

function uniqueStockSlug(baseSlug: string, existingSlugs: string[]): string {
  const base = baseSlug || "stock";
  const taken = new Set(existingSlugs);
  RESERVED_LIBRARY_STOCK_SLUGS.forEach(function (s) {
    taken.add(s);
  });
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(base + "-" + i)) i++;
  return base + "-" + i;
}

function getSolubilityLimitGPerL(mineralId: string): number | null {
  if (
    typeof MINERAL_SOLUBILITY_G_PER_L_25C_APPROX === "undefined" ||
    !MINERAL_SOLUBILITY_G_PER_L_25C_APPROX
  ) {
    return null;
  }
  const v = MINERAL_SOLUBILITY_G_PER_L_25C_APPROX[mineralId];
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getOverLimitMineralIds(spec: StockDraft | null): string[] {
  if (!spec || !Array.isArray(spec.minerals)) return [];
  const bottleMl = Math.max(0, Number(spec.bottleMl) || 0);
  if (bottleMl <= 0) return [];
  const liters = bottleMl / 1000;
  const out: string[] = [];
  for (let i = 0; i < spec.minerals.length; i++) {
    const entry = spec.minerals[i];
    if (!entry || typeof entry !== "object") continue;
    const limit = getSolubilityLimitGPerL(entry.mineralId);
    if (limit == null) continue;
    const grams = Math.max(0, Number(entry.grams) || 0);
    if (grams <= 0) continue;
    if (grams / liters >= limit) out.push(entry.mineralId);
  }
  return out;
}

function buildMineralOptionsHtml(selectedMineralId: string): string {
  let html = '<option value="">- Pick a mineral -</option>';
  if (typeof MINERAL_DB === "undefined" || !MINERAL_DB) return html;
  for (const mid in MINERAL_DB) {
    if (!Object.prototype.hasOwnProperty.call(MINERAL_DB, mid)) continue;
    const sel = mid === selectedMineralId ? " selected" : "";
    html +=
      '<option value="' + mid + '"' + sel + ">" + escapeHtml(MINERAL_DB[mid]!.name) + "</option>";
  }
  return html;
}

// ---- Modal state (one editor open at a time) ----

let overlayEl: HTMLDivElement | null = null;
let dialogEl: HTMLDivElement | null = null;
// formEl / titleEl / closeBtn are created once in ensureOverlay and never
// nulled, so they carry definite-assignment types rather than `| null`.
let formEl!: HTMLDivElement;
let errorEl: HTMLElement | null = null;
let warningEl: HTMLElement | null = null;
let titleEl!: HTMLHeadingElement;
let closeBtn!: HTMLButtonElement;
let previousFocus: HTMLElement | null = null;
let keyHandler: ((e: KeyboardEvent) => void) | null = null;
let overlayClickHandler: ((e: MouseEvent) => void) | null = null;
let session: StockEditorSession | null = null;

function ensureOverlay(): void {
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

function buildMineralListHtml(minerals: StockEditorMineral[]): string {
  if (!minerals || minerals.length === 0) {
    return '<p class="hint stock-pane-empty">No minerals yet. Click "+ Add mineral" below.</p>';
  }
  let html = "";
  for (let idx = 0; idx < minerals.length; idx++) {
    const entry = minerals[idx]!;
    const grams = Number.isFinite(Number(entry.grams)) ? Number(entry.grams) : 0;
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

function refreshMineralList(): void {
  const s = session!;
  const listEl = formEl.querySelector(".stock-editor-mineral-list");
  if (!listEl) return;
  listEl.innerHTML = buildMineralListHtml(s.minerals);
}

function renderForm(): void {
  const s = session!;
  const label = s.label != null ? String(s.label) : "";
  const bottleMl =
    Number.isFinite(Number(s.bottleMl)) && Number(s.bottleMl) > 0 ? Number(s.bottleMl) : 200;
  const doseGramsPerL =
    Number.isFinite(Number(s.doseGramsPerL)) && Number(s.doseGramsPerL) > 0
      ? Number(s.doseGramsPerL)
      : 4;
  const hintHtml = s.hint ? '<p class="hint stock-derive-hint">' + escapeHtml(s.hint) + "</p>" : "";
  const notesHtml =
    Array.isArray(s.notes) && s.notes.length
      ? s.notes
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
    buildMineralListHtml(s.minerals) +
    "</div>" +
    '<button type="button" class="preset-btn stock-add-mineral-btn" data-action="add-mineral">+ Add mineral</button>' +
    '<div class="concentrate-warning stock-editor-warning" hidden></div>' +
    '<div class="stock-editor-actions">' +
    '<button type="button" class="preset-btn primary" data-action="save">Save</button>' +
    '<button type="button" class="preset-btn" data-action="cancel">Cancel</button>' +
    (s.mode === "edit"
      ? '<button type="button" class="preset-btn stock-editor-delete" data-action="delete">Delete</button>'
      : "") +
    "</div>" +
    '<div class="stock-new-error stock-editor-error" hidden></div>';

  errorEl = formEl.querySelector<HTMLElement>(".stock-editor-error");
  warningEl = formEl.querySelector<HTMLElement>(".stock-editor-warning");
  updateWarning();
}

function showError(msg?: string): void {
  if (!errorEl) return;
  errorEl.textContent = msg || "";
  errorEl.hidden = !msg;
}

function updateWarning(): void {
  const w = warningEl;
  if (!w) return;
  const draft = readDraftFromForm();
  const overLimitIds = getOverLimitMineralIds(draft);
  if (overLimitIds.length === 0) {
    w.hidden = true;
    w.textContent = "";
    return;
  }
  const names = overLimitIds.map(function (mid) {
    return (typeof MINERAL_DB !== "undefined" && MINERAL_DB[mid]?.name) || mid;
  });
  w.hidden = false;
  w.textContent =
    "Above solubility limit for " +
    names.join(", ") +
    ". Try a larger bottle volume or fewer grams.";
}

function readDraftFromForm(): StockDraft {
  const labelInput = formEl.querySelector<HTMLInputElement>("#stock-editor-label");
  const bottleInput = formEl.querySelector<HTMLInputElement>("#stock-editor-bottle-ml");
  const doseInput = formEl.querySelector<HTMLInputElement>("#stock-editor-dose");
  return {
    label: labelInput ? labelInput.value.trim() : "",
    bottleMl: bottleInput ? Math.max(0, parseFloat(bottleInput.value) || 0) : 0,
    doseGramsPerL: doseInput ? Math.max(0, parseFloat(doseInput.value) || 0) : 0,
    minerals: session!.minerals.slice(),
  };
}

function attachFormHandlers(): void {
  formEl.addEventListener("click", function (e) {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (!target) return;
    const action = target.dataset.action;
    if (!action) return;

    if (action === "add-mineral") {
      session!.minerals.push({ mineralId: "", grams: 0 });
      refreshMineralList();
      const lastSel = formEl.querySelector<HTMLElement>(
        '.stock-mineral-row[data-mineral-idx="' + (session!.minerals.length - 1) + '"] select',
      );
      if (lastSel) lastSel.focus();
      updateWarning();
      return;
    }

    if (action === "remove-mineral") {
      const row = target.closest<HTMLElement>(".stock-mineral-row");
      if (!row) return;
      const idx = parseInt(row.dataset.mineralIdx ?? "", 10);
      if (Number.isNaN(idx)) return;
      session!.minerals.splice(idx, 1);
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
    const target = e.target as HTMLSelectElement;
    if (target.tagName === "SELECT" && target.dataset.field === "mineral-id") {
      const row = target.closest<HTMLElement>(".stock-mineral-row");
      if (!row) return;
      const idx = parseInt(row.dataset.mineralIdx ?? "", 10);
      const entry = session!.minerals[idx];
      if (Number.isNaN(idx) || !entry) return;
      entry.mineralId = target.value;
      updateWarning();
    }
  });

  formEl.addEventListener("input", function (e) {
    const target = e.target as HTMLInputElement | null;
    if (!target || target.tagName !== "INPUT") return;
    if (target.dataset.field === "mineral-grams") {
      const row = target.closest<HTMLElement>(".stock-mineral-row");
      if (!row) return;
      const idx = parseInt(row.dataset.mineralIdx ?? "", 10);
      const entry = session!.minerals[idx];
      if (Number.isNaN(idx) || !entry) return;
      entry.grams = Math.max(0, parseFloat(target.value) || 0);
      updateWarning();
    } else if (target.id === "stock-editor-bottle-ml" || target.id === "stock-editor-dose") {
      updateWarning();
    }
  });
}

function handleSave(): void {
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

  const s = session!;
  const draft = readDraftFromForm();
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
  const cleaned: StockEditorMineral[] = [];
  for (let i = 0; i < draft.minerals.length; i++) {
    const m = draft.minerals[i];
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

  const specs = loadStockConcentrateSpecs();
  let finalSlug: string;
  if (s.mode === "edit") {
    finalSlug = s.editSlug!;
  } else if (s.importSlug) {
    // Library-import path keys under the library slug verbatim so the
    // recipe card's hasOwn(specs, recipe.slug) check flips to "In your
    // pantry" on the next render. Block re-importing the same slug to
    // match minerals.html:1261.
    if (Object.prototype.hasOwnProperty.call(specs, s.importSlug)) {
      showError("This library stock is already in your pantry.");
      return;
    }
    finalSlug = String(s.importSlug);
  } else {
    const baseSlug = (typeof slugify === "function" ? slugify(draft.label) : "") || "stock";
    finalSlug = uniqueStockSlug(baseSlug, Object.keys(specs));
  }

  const spec: StockSpec = {
    label: draft.label,
    bottleMl: draft.bottleMl,
    doseGramsPerL: draft.doseGramsPerL,
    minerals: cleaned,
  };
  if (s.mode === "edit") {
    // Preserve the round-tripped origin and source so minerals.html's
    // "Reset to library values" / "Re-derive from recipe" affordances keep
    // working on stocks edited via this modal.
    const existing: StockSpec = specs[finalSlug] || {};
    if (existing.createdFrom) spec.createdFrom = existing.createdFrom;
    if (existing.source) spec.source = existing.source;
  } else if (s.deriveSlug) {
    spec.createdFrom = "derived:" + s.deriveSlug;
  } else if (s.importSlug) {
    spec.createdFrom = "library:" + s.importSlug;
    if (s.importSource) spec.source = s.importSource;
  }
  specs[finalSlug] = spec;
  saveStockConcentrateSpecs(specs);

  if (s.autoEnable) {
    // Multi-Recipe-Concentrate: enabling a newly-created stock is additive;
    // any other stocks the user had enabled stay enabled.
    setStockEnabled("stock:" + finalSlug, true);
  }

  const savedSlug = finalSlug;
  const onSaved = s.onSaved;
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

function handleDelete(): void {
  const s = session!;
  if (s.mode !== "edit" || !s.editSlug) return;
  const specs = loadStockConcentrateSpecs();
  const label = specs[s.editSlug]?.label || s.editSlug;
  const slug = s.editSlug;
  const onSaved = s.onSaved;
  if (typeof showConfirm !== "function") {
    // showConfirm is defined in ui-shared.ts; if missing, fall back to a
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

function deleteStock(slug: string): void {
  const cur = loadStockConcentrateSpecs();
  delete cur[slug];
  saveStockConcentrateSpecs(cur);
  const remaining = loadSelectedConcentrates().filter(function (id) {
    return id !== "stock:" + slug;
  });
  saveSelectedConcentrates(remaining);
}

function openEditor(opts?: OpenStockEditorOptions): void {
  opts = opts || {};
  ensureOverlay();

  const mode = opts.mode || "new";
  const prefill = opts.prefill || {};
  const resolvedSession: StockEditorSession = {
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
    const specs = loadStockConcentrateSpecs();
    const spec = specs[opts.slug];
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
  const fe = formEl as HTMLDivElement & { _cwEditorHandlersAttached?: boolean };
  if (!fe._cwEditorHandlersAttached) {
    attachFormHandlers();
    fe._cwEditorHandlersAttached = true;
  }

  previousFocus = document.activeElement as HTMLElement | null;
  overlayEl!.style.display = "";
  if (window.lockBodyScroll) window.lockBodyScroll("stock-editor");

  overlayClickHandler = function (e) {
    if (e.target === overlayEl) closeEditor();
  };
  overlayEl!.addEventListener("click", overlayClickHandler);
  closeBtn.addEventListener("click", closeEditor);

  keyHandler = function (e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeEditor();
      return;
    }
    if (e.key !== "Tab") return;
    const raw = overlayEl!.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    const focusables: HTMLElement[] = [];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i]!.offsetParent !== null) focusables.push(raw[i]!);
    }
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last!.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first!.focus();
    }
  };
  document.addEventListener("keydown", keyHandler, true);

  const labelInput = formEl.querySelector<HTMLInputElement>("#stock-editor-label");
  if (labelInput && labelInput.focus) labelInput.focus();
}

function closeEditor(): void {
  const ov = overlayEl;
  if (!ov) return;
  ov.style.display = "none";
  if (window.unlockBodyScroll) window.unlockBodyScroll("stock-editor");
  if (overlayClickHandler) {
    ov.removeEventListener("click", overlayClickHandler);
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
