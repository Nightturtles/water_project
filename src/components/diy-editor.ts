// =============================================================================
// diy-editor.ts — Modal editor for single-mineral DIY concentrate specs.
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
//
// Phase A: converted from diy-editor.js. Loaded via legacy-globals.ts (the
// bridge module imports this file as a side-effect). The original IIFE wrapper
// is dropped — ES module scope already isolates internals. The public API is
// re-published on window so the not-yet-migrated classic caller
// (mineral-selector.js) reaches openDiyEditor unchanged.
// =============================================================================

import { escapeHtml } from "../lib/html";
import {
  loadDiyConcentrateSpecs,
  saveDiyConcentrateSpecs,
  loadSelectedConcentrates,
  saveSelectedConcentrates,
} from "../lib/storage";

// Local mirror of storage.ts's (non-exported) DiyConcentrateSpec, used for the
// spec objects this module reads from loadDiyConcentrateSpecs. Structurally
// identical, so records round-trip through storage's Record type without a cast.
interface DiySpec {
  bottleMl?: number;
  gramsPerBottle?: number;
}

export interface OpenDiyEditorOptions {
  /** The mineral whose DIY concentrate is being configured. */
  mineralId?: string;
  /** Fires with the saved mineralId after a successful save. */
  onSaved?: (mineralId: string) => void;
}

interface DiyEditorSession {
  mineralId: string;
  bottleMl: number;
  gramsPerBottle: number;
  onSaved: ((mineralId: string) => void) | null;
}

interface DiyDraft {
  bottleMl: number;
  gramsPerBottle: number;
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

let overlayEl: HTMLDivElement | null = null;
let dialogEl: HTMLDivElement | null = null;
// formEl / titleEl / closeBtn are created once in ensureOverlay and never
// nulled, so they carry definite-assignment types rather than `| null`.
let formEl!: HTMLDivElement;
let titleEl!: HTMLHeadingElement;
let warningEl: HTMLElement | null = null;
let errorEl: HTMLElement | null = null;
let closeBtn!: HTMLButtonElement;
let previousFocus: HTMLElement | null = null;
let keyHandler: ((e: KeyboardEvent) => void) | null = null;
let overlayClickHandler: ((e: MouseEvent) => void) | null = null;
let session: DiyEditorSession | null = null;

function ensureOverlay(): void {
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

function readDraft(): DiyDraft {
  const bottleEl = formEl.querySelector<HTMLInputElement>("#diy-editor-bottle-ml");
  const gramsEl = formEl.querySelector<HTMLInputElement>("#diy-editor-grams-per-bottle");
  return {
    bottleMl: bottleEl ? Math.max(0, parseFloat(bottleEl.value) || 0) : 0,
    gramsPerBottle: gramsEl ? Math.max(0, parseFloat(gramsEl.value) || 0) : 0,
  };
}

function updateWarning(): void {
  const w = warningEl;
  if (!w) return;
  const d = readDraft();
  const limit = getSolubilityLimitGPerL(session!.mineralId);
  if (!d.bottleMl || !d.gramsPerBottle || limit == null) {
    w.hidden = true;
    return;
  }
  const gPerL = d.gramsPerBottle / (d.bottleMl / 1000);
  w.hidden = gPerL < limit;
}

function showError(msg?: string): void {
  if (!errorEl) return;
  errorEl.textContent = msg || "";
  errorEl.hidden = !msg;
}

function renderForm(): void {
  const s = session!;
  const mineralName =
    typeof MINERAL_DB !== "undefined" && MINERAL_DB[s.mineralId]
      ? MINERAL_DB[s.mineralId]!.name
      : s.mineralId;
  const mineralFormula =
    typeof MINERAL_DB !== "undefined" && MINERAL_DB[s.mineralId]
      ? MINERAL_DB[s.mineralId]!.formula
      : "";

  const isNew = !(s.bottleMl > 0) && !(s.gramsPerBottle > 0);
  // First-time editors get an empty form with placeholders so "unset" is
  // visually distinct from a real 0. Existing specs keep their saved
  // values verbatim so a user editing won't accidentally see a phantom
  // placeholder over their real config.
  const bottleAttr = s.bottleMl > 0 ? 'value="' + s.bottleMl + '"' : 'placeholder="e.g. 1000"';
  const gramsAttr =
    s.gramsPerBottle > 0 ? 'value="' + s.gramsPerBottle + '"' : 'placeholder="e.g. 50"';

  const hintHtml = isNew
    ? '<p class="hint diy-editor-hint">Tell the calculator how much ' +
      escapeHtml(mineralName) +
      " you dissolved. Enter your bottle's volume and how many grams of the salt you added; the calculator uses these to compute per-liter doses.</p>"
    : '<p class="hint diy-editor-hint">Bottle volume and grams of ' +
      escapeHtml(mineralName) +
      " dissolved.</p>";
  const nameLine = mineralFormula
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

  warningEl = formEl.querySelector<HTMLElement>(".diy-editor-warning");
  errorEl = formEl.querySelector<HTMLElement>(".diy-editor-error");
  updateWarning();
}

function attachFormHandlers(): void {
  formEl.addEventListener("click", function (e) {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (!target) return;
    const action = target.dataset.action;
    if (action === "save") {
      handleSave();
    } else if (action === "cancel") {
      closeEditor();
    }
  });
  formEl.addEventListener("input", function (e) {
    const target = e.target as HTMLElement | null;
    if (!target || target.tagName !== "INPUT") return;
    updateWarning();
  });
}

function handleSave(): void {
  if (typeof window.isLoggedInSync === "function" && !window.isLoggedInSync()) {
    if (typeof window.openLoginModal === "function") {
      window.openLoginModal({ reason: "save-stock" });
    }
    return;
  }

  const s = session!;
  const d = readDraft();
  if (d.bottleMl <= 0) {
    showError("Bottle volume must be greater than 0.");
    return;
  }
  if (d.gramsPerBottle <= 0) {
    showError("Grams per bottle must be greater than 0.");
    return;
  }

  const specs = loadDiyConcentrateSpecs();
  specs[s.mineralId] = { bottleMl: d.bottleMl, gramsPerBottle: d.gramsPerBottle };
  saveDiyConcentrateSpecs(specs);

  // Auto-enable the concentrate id if it wasn't already enabled. Stocks
  // are single-active and treated as a deliberate user toggle; DIYs aren't,
  // so configuring grams implies "I want to use this."
  const concentrateId = "diy:" + s.mineralId;
  const selected = loadSelectedConcentrates();
  if (selected.indexOf(concentrateId) === -1) {
    saveSelectedConcentrates(selected.concat([concentrateId]));
  }

  const onSaved = s.onSaved;
  const mineralId = s.mineralId;
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

function openEditor(opts?: OpenDiyEditorOptions): void {
  opts = opts || {};
  const mineralId = opts.mineralId;
  if (!mineralId) {
    console.warn("[diy-editor] requires opts.mineralId");
    return;
  }
  ensureOverlay();

  const specs = loadDiyConcentrateSpecs();
  const existing: DiySpec = specs[mineralId] || {};
  session = {
    mineralId: mineralId,
    bottleMl: Number(existing.bottleMl) || 0,
    gramsPerBottle: Number(existing.gramsPerBottle) || 0,
    onSaved: typeof opts.onSaved === "function" ? opts.onSaved : null,
  };

  renderForm();
  const fe = formEl as HTMLDivElement & { _cwEditorHandlersAttached?: boolean };
  if (!fe._cwEditorHandlersAttached) {
    attachFormHandlers();
    fe._cwEditorHandlersAttached = true;
  }

  previousFocus = document.activeElement as HTMLElement | null;
  overlayEl!.style.display = "";
  if (window.lockBodyScroll) window.lockBodyScroll("diy-editor");

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

  const bottleInput = formEl.querySelector<HTMLInputElement>("#diy-editor-bottle-ml");
  if (bottleInput && bottleInput.focus) bottleInput.focus();
}

function closeEditor(): void {
  const ov = overlayEl;
  if (!ov) return;
  ov.style.display = "none";
  if (window.unlockBodyScroll) window.unlockBodyScroll("diy-editor");
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

window.openDiyEditor = openEditor;
