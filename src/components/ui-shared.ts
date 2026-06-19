// ============================================
// UI Shared — DOM helpers and shared UI logic
// ============================================
//
// Phase A PR (e): converted from ui-shared.js. Loaded via legacy-globals.ts
// (the bridge module imports this file as a side-effect). Storage helpers
// come in by ES import; cross-script symbols hosted by classic scripts
// (constants.js's MINERAL_DB / ION_LABELS, metrics.js's calculateMetrics,
// supabase-client.js's isLoggedIn / signOut / supabaseClient / isLoggedInSync,
// sync.js's flushPendingSync / clearLocalUserContent / invalidatePublicRecipesCache,
// library-data.js's invalidatePublicRecipesCache, and login-modal.ts's
// openLoginModal) are still consumed via window/global lexical lookup.

import {
  loadCustomTargetProfiles,
  saveCustomTargetProfiles,
  loadSourcePresetName,
  saveSourcePresetName,
  getAllPresets,
  loadDeletedPresets,
  isAdvancedMineralDisplayMode,
  loadCreatorDisplayName,
  saveCreatorDisplayName,
  loadThemePreference,
} from "../lib/storage";

// --- Non-negative number input reader ---
export function readNonNegative(el: HTMLInputElement): number {
  return Math.max(0, parseFloat(el.value) || 0);
}

// --- Visible ion fields based on display mode ---
export function getVisibleIonFields(): IonName[] {
  if (isAdvancedMineralDisplayMode()) {
    return ["calcium", "magnesium", "potassium", "sodium", "sulfate", "chloride"];
  }
  return ["calcium", "magnesium"];
}

export function applyMineralDisplayMode(): void {
  const body = document.body;
  if (!body) return;
  const advanced = isAdvancedMineralDisplayMode();
  body.classList.toggle("advanced-minerals", advanced);
  body.classList.toggle("standard-minerals", !advanced);
}

// --- Status handler ---
export function createStatusHandler(
  statusEl: HTMLElement | null,
  options: { successMs?: number; errorMs?: number } = {},
): (message: string, isError?: boolean) => void {
  const successMs = options.successMs || 1500;
  const errorMs = options.errorMs || 3000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return function showStatus(message: string, isError?: boolean) {
    if (!statusEl) return;
    if (timer !== null) clearTimeout(timer);
    statusEl.textContent = message;
    statusEl.classList.toggle("error", !!isError);
    statusEl.classList.add("visible");
    timer = setTimeout(
      () => {
        statusEl.classList.remove("visible", "error");
      },
      isError ? errorMs : successMs,
    );
  };
}

// --- Enter key binding ---
export function bindEnterToClick(
  inputEl: HTMLInputElement | null,
  buttonEl: HTMLElement | null,
): void {
  if (!inputEl || !buttonEl) return;
  inputEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    buttonEl.click();
  });
}

// --- Source preset select initialization ---
export function initSourcePresetSelect(selectEl: HTMLSelectElement | null): string | null {
  if (!selectEl) return null;
  selectEl.innerHTML = "";
  const presetEntries = Object.entries(getAllPresets()).filter(([key]) => key !== "custom");
  for (const [key, preset] of presetEntries) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = preset.label || key;
    selectEl.appendChild(opt);
  }
  const savedPreset = loadSourcePresetName();
  const validKeys = presetEntries.map(([k]) => k);
  const fallback = validKeys[0] || null;
  const selectedPreset = validKeys.includes(savedPreset) ? savedPreset : fallback;
  if (selectedPreset) {
    selectEl.value = selectedPreset;
    if (selectedPreset !== savedPreset) {
      saveSourcePresetName(selectedPreset);
    }
  }
  return selectedPreset;
}

// --- Source water tags (Bug 5: XSS-safe, Inconsistency 4: always show alkalinity) ---
export function renderSourceWaterTags(tagsEl: HTMLElement | null, water: IonMap | null): void {
  if (!tagsEl) return;
  tagsEl.innerHTML = "";
  // Drive both the "All zeros" fallback and the per-ion tags from the same
  // visible-ion set so standard mode (Ca/Mg only) never says "All zeros"
  // for a profile that has hidden ions present (or vice versa).
  const safeWater: IonMap = water || {};
  const nonZero = getVisibleIonFields().filter(function (ion) {
    return (Number(safeWater[ion]) || 0) > 0;
  });
  const metrics = water ? calculateMetrics(water) : { kh: 0 };
  const alk = metrics.kh;
  const alkRounded = alk == null || alk !== alk ? 0 : Math.round(alk);

  if (nonZero.length === 0) {
    const tag = document.createElement("span");
    tag.className = "base-tag";
    tag.textContent = "All zeros";
    tagsEl.appendChild(tag);
    if (alkRounded !== 0) {
      const alkTag = document.createElement("span");
      alkTag.className = "base-tag";
      alkTag.textContent = "Alkalinity: " + alkRounded + " mg/L as CaCO₃";
      tagsEl.appendChild(alkTag);
    }
    return;
  }
  nonZero.forEach(function (ion) {
    const tag = document.createElement("span");
    tag.className = "base-tag";
    tag.textContent = ION_LABELS[ion] + ": " + Number(safeWater[ion]) + " mg/L";
    tagsEl.appendChild(tag);
  });
  const alkTag = document.createElement("span");
  alkTag.className = "base-tag";
  alkTag.textContent = "Alkalinity: " + alkRounded + " mg/L as CaCO₃";
  tagsEl.appendChild(alkTag);
}

// --- Confirmation modal (Bug 2: prevent stacking, Bug 3 fix: focus trap + ARIA) ---
//
// The static overlay markup (#confirm-overlay) lives in index.html, recipe.html,
// taste.html, and minerals.html only. Pages that don't ship it (library.html,
// start.html, login.html, reset-password.html, privacy/index.html) still need
// to be able to call showConfirm() for the nav-auth "Delete account" button,
// which appears on every page when the user is signed in. `ensureConfirmOverlay`
// inserts a matching DOM subtree on demand; the CSS in style.css then styles
// it identically to the static version.
let confirmCleanup: (() => void) | null = null;

export interface ShowConfirmOptions {
  // When set, an <input> appears between the message and the buttons. The
  // confirm (Yes) button is disabled until the trimmed input value exactly
  // matches `value`. Used by the Delete Account flow to force the user to
  // re-type their email — more memorable and less click-through-able than
  // a generic "type DELETE" pattern, and makes them look at which account
  // they're about to nuke.
  requireText?: { value: string; label: string; placeholder?: string };
  // Override button labels. Defaults: yesLabel="Yes", noLabel="No".
  yesLabel?: string;
  noLabel?: string;
}

function ensureConfirmOverlay(): HTMLElement {
  let overlay = document.getElementById("confirm-overlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "confirm-overlay";
  overlay.className = "confirm-overlay";
  overlay.style.display = "none";
  overlay.innerHTML =
    '<div class="confirm-dialog">' +
    '<p id="confirm-message"></p>' +
    '<div class="confirm-actions">' +
    '<button id="confirm-yes" class="preset-btn">Yes</button>' +
    '<button id="confirm-no" class="preset-btn">No</button>' +
    "</div>" +
    "</div>";
  document.body.appendChild(overlay);
  return overlay;
}

export function showConfirm(
  message: string,
  onYes: () => void,
  options?: ShowConfirmOptions,
): void {
  if (confirmCleanup) confirmCleanup();

  const overlay = ensureConfirmOverlay();
  const dialog = overlay.querySelector(".confirm-dialog") as HTMLElement;
  const msgEl = document.getElementById("confirm-message") as HTMLElement;
  const yesBtn = document.getElementById("confirm-yes") as HTMLButtonElement;
  const noBtn = document.getElementById("confirm-no") as HTMLButtonElement;
  const previousFocus = document.activeElement as HTMLElement | null;

  // ARIA attributes
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "confirm-message");

  msgEl.textContent = message;

  // Reset button labels each call so a previous invocation's custom copy
  // doesn't bleed into the next.
  yesBtn.textContent = options?.yesLabel || "Yes";
  noBtn.textContent = options?.noLabel || "No";
  yesBtn.disabled = false;

  // Optional type-to-confirm input. Inserted between the message and the
  // action buttons; removed in close() so it doesn't accumulate across calls.
  let inputWrap: HTMLElement | null = null;
  let input: HTMLInputElement | null = null;
  if (options?.requireText) {
    const required = options.requireText;
    inputWrap = document.createElement("div");
    inputWrap.className = "confirm-input-wrap";

    const label = document.createElement("label");
    label.className = "confirm-input-label";
    label.textContent = required.label;
    const inputId = "confirm-require-text-input";
    label.setAttribute("for", inputId);

    input = document.createElement("input");
    input.type = "text";
    input.id = inputId;
    input.className = "confirm-input";
    input.autocomplete = "off";
    input.spellcheck = false;
    if (required.placeholder) input.placeholder = required.placeholder;

    inputWrap.appendChild(label);
    inputWrap.appendChild(input);
    // Insert before the action buttons. msgEl is the dialog's first child;
    // .confirm-actions follows. Inserting before .confirm-actions keeps the
    // visual order message -> input -> buttons regardless of how the
    // dialog was constructed (static markup vs. ensureConfirmOverlay).
    const actions = dialog.querySelector(".confirm-actions") as HTMLElement;
    dialog.insertBefore(inputWrap, actions);

    yesBtn.disabled = true;
    input.addEventListener("input", () => {
      yesBtn.disabled = input!.value.trim() !== required.value.trim();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !yesBtn.disabled) {
        e.preventDefault();
        yesHandler();
      }
    });
  }

  overlay.style.display = "flex";
  lockBodyScroll("confirm");
  if (input) {
    input.focus();
  } else {
    yesBtn.focus();
  }

  function close() {
    overlay.style.display = "none";
    unlockBodyScroll("confirm");
    yesBtn.removeEventListener("click", yesHandler);
    noBtn.removeEventListener("click", noHandler);
    document.removeEventListener("keydown", keyHandler);
    overlay.removeEventListener("click", overlayClickHandler);
    if (inputWrap && inputWrap.parentNode) inputWrap.parentNode.removeChild(inputWrap);
    yesBtn.disabled = false;
    confirmCleanup = null;
    if (previousFocus && previousFocus.focus) {
      previousFocus.focus();
    }
  }
  function yesHandler() {
    if (yesBtn.disabled) return;
    close();
    onYes();
  }
  function noHandler() {
    close();
  }
  function keyHandler(e: KeyboardEvent) {
    if (e.key === "Escape") {
      noHandler();
      return;
    }
    if (e.key === "Tab") {
      const focusable: HTMLElement[] = input ? [input, yesBtn, noBtn] : [yesBtn, noBtn];
      const idx = focusable.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey) {
        e.preventDefault();
        focusable[(idx <= 0 ? focusable.length : idx) - 1]!.focus();
      } else {
        e.preventDefault();
        focusable[(idx + 1) % focusable.length]!.focus();
      }
    }
  }
  function overlayClickHandler(e: MouseEvent) {
    if (e.target === overlay) noHandler();
  }

  confirmCleanup = close;

  yesBtn.addEventListener("click", yesHandler);
  noBtn.addEventListener("click", noHandler);
  document.addEventListener("keydown", keyHandler);
  overlay.addEventListener("click", overlayClickHandler);
}

// --- Current user id cache ---
// Thin shim over the canonical cache in supabase-client.js
// (window._cachedAuthUserId).  Kept as named functions for back-compat with
// existing call sites and the window.* exports below.
export function primeCurrentUserId(): Promise<string | null | undefined> {
  if (window._authStateResolved) return Promise.resolve(window._cachedAuthUserId);
  return new Promise(function (resolve) {
    document.addEventListener("cw:auth-state-resolved", function onResolved() {
      document.removeEventListener("cw:auth-state-resolved", onResolved);
      resolve(window._cachedAuthUserId);
    });
  });
}

export function getCurrentUserIdSync(): string | null {
  return window._cachedAuthUserId || null;
}

// --- Creator ownership check ---
// Returns true if the logged-in user is the original creator of this profile,
// i.e. they are allowed to push updates to a public/library version.
//
// Rules:
//  - If profile has no creatorUserId (not yet synced to cloud) → treat as
//    creator (newly-created local profile that will be attributed on push).
//  - If creatorUserId matches current user's id → creator.
//  - Otherwise (copy from library, or not logged in) → not creator.
export function isUserTheCreator(profile: any): boolean {
  if (!profile) return false;
  if (!("creatorUserId" in profile) || profile.creatorUserId === undefined) return true;
  const currentId = getCurrentUserIdSync();
  if (!currentId) return false;
  return profile.creatorUserId === currentId;
}

export function maybeOfferSharePrompt(profileKey: string, profile?: any): void {
  if (!profileKey) return;
  if (typeof showSharePrompt !== "function") return;
  let current = profile;
  if (!current && typeof loadCustomTargetProfiles === "function") {
    const all = loadCustomTargetProfiles();
    current = all && all[profileKey] ? all[profileKey] : null;
  }
  if (typeof isUserTheCreator === "function" && !isUserTheCreator(current)) return;
  showSharePrompt(profileKey);
}

// --- Auth gate for save affordances ---
// Visually locks an element when the user is anonymous and intercepts the
// click (capture phase) to open the login modal instead of running the
// existing save handler.  Aria-disabled is used rather than `disabled` so
// the click event reaches our handler; bubble-phase listeners are stopped
// via stopImmediatePropagation.  Listens to cw:auth-changed and
// cw:auth-state-resolved so a sign-in mid-page unlocks affordances without
// requiring a navigation.
// One shared pair of document listeners drives every gated element's updater.
// Previously each applyAuthGate(el) call added its OWN pair of document
// listeners, so the document-level listener count scaled with the number of
// gated controls on the page (dozens on library.html), and every one re-ran on
// each auth change. Elements now register an updater once; the two shared
// listeners iterate the registry.
const authGateUpdaters = new Set<() => void>();
let authGateListenersBound = false;

function runAuthGateUpdaters(): void {
  authGateUpdaters.forEach(function (fn) {
    try {
      fn();
    } catch (_) {}
  });
}

function ensureAuthGateListeners(): void {
  if (authGateListenersBound) return;
  authGateListenersBound = true;
  document.addEventListener("cw:auth-changed", runAuthGateUpdaters);
  document.addEventListener("cw:auth-state-resolved", runAuthGateUpdaters);
}

export function applyAuthGate(
  el: HTMLElement | null | undefined,
  opts?: { reason?: string },
): void {
  if (!el) return;
  opts = opts || {};
  const reason = opts.reason || "save";

  function gateClickHandler(ev: Event) {
    if (typeof window.isLoggedInSync === "function" && window.isLoggedInSync()) return;
    ev.preventDefault();
    if (typeof ev.stopImmediatePropagation === "function") ev.stopImmediatePropagation();
    else if (typeof ev.stopPropagation === "function") ev.stopPropagation();
    if (typeof window.openLoginModal === "function") {
      window.openLoginModal({ reason: reason });
    }
  }

  function update() {
    const loggedIn = typeof window.isLoggedInSync === "function" && window.isLoggedInSync();
    if (loggedIn) {
      el!.classList.remove("auth-locked");
      el!.removeAttribute("aria-disabled");
    } else {
      el!.classList.add("auth-locked");
      el!.setAttribute("aria-disabled", "true");
      if (!el!.dataset.authGateBound) {
        el!.addEventListener("click", gateClickHandler, true);
        el!.dataset.authGateBound = "1";
      }
    }
  }

  update();

  // Register this element's updater once (re-calling applyAuthGate on the same
  // element just refreshes its state above), and bind the shared document
  // listeners once per page.
  if (!el.dataset.authGateRegistered) {
    el.dataset.authGateRegistered = "1";
    authGateUpdaters.add(update);
    ensureAuthGateListeners();
  }
}

// --- Share to Recipe Library prompt (post-save dialog) ---
let sharePromptCleanup: (() => void) | null = null;

export async function showSharePrompt(profileKey: string): Promise<void> {
  // Only show if logged in
  if (typeof (window as any).isLoggedIn !== "function" || !(await (window as any).isLoggedIn()))
    return;

  const overlay = document.getElementById("share-prompt-overlay") as HTMLElement | null;
  if (!overlay) return;

  if (sharePromptCleanup) sharePromptCleanup();

  const titleEl = document.getElementById("share-prompt-title");
  const hintEl = document.getElementById("share-prompt-hint");
  const nameGroup = document.getElementById("share-prompt-name-group") as HTMLElement;
  const nameInput = document.getElementById("share-prompt-display-name") as HTMLInputElement;
  const yesBtn = document.getElementById("share-prompt-yes") as HTMLElement;
  const noBtn = document.getElementById("share-prompt-no") as HTMLElement;
  const previousFocus = document.activeElement as HTMLElement | null;

  // Tailor the wording: first-time share vs updating an already-public recipe.
  const profilesFirstRead = loadCustomTargetProfiles();
  const thisProfile = profilesFirstRead[profileKey] as any;
  const isUpdating = !!(thisProfile && thisProfile.isPublic);
  if (titleEl) {
    titleEl.textContent = isUpdating
      ? "Publish these updates to the Recipe Library?"
      : "Share this recipe to the Recipe Library?";
  }
  if (hintEl) {
    hintEl.textContent = isUpdating
      ? "Your existing library entry will be updated with these changes."
      : "Other users will be able to find and copy it.";
  }
  if (yesBtn) yesBtn.textContent = isUpdating ? "Publish updates" : "Share";

  // Show display name field only if not already set
  const existingName = loadCreatorDisplayName();
  if (existingName) {
    nameGroup.style.display = "none";
  } else {
    nameGroup.style.display = "";
    nameInput.value = "";
  }

  overlay.style.display = "flex";
  lockBodyScroll("share-prompt");
  if (!existingName) {
    nameInput.focus();
  } else {
    yesBtn.focus();
  }

  function close() {
    overlay!.style.display = "none";
    unlockBodyScroll("share-prompt");
    yesBtn.removeEventListener("click", yesHandler);
    noBtn.removeEventListener("click", noHandler);
    document.removeEventListener("keydown", keyHandler);
    overlay!.removeEventListener("click", overlayClickHandler);
    sharePromptCleanup = null;
    if (previousFocus && previousFocus.focus) previousFocus.focus();
  }

  function yesHandler() {
    const displayName = existingName || (nameInput.value || "").trim();
    if (!displayName) {
      nameInput.focus();
      return;
    }
    if (!existingName) saveCreatorDisplayName(displayName);

    // Flip the profile public locally. saveCustomTargetProfiles schedules a
    // sync-layer push of the full row (including is_public) — the SAME single
    // path every other field uses. Previously this also fired a separate
    // direct target_profiles.update(), a second writer of is_public that could
    // disagree with the sync push on a partial failure (and whose errors were
    // silently swallowed while the dialog still closed as "done"). One writer,
    // no disagreement.
    const profiles = loadCustomTargetProfiles() as Record<string, any>;
    if (profiles[profileKey]) {
      profiles[profileKey].isPublic = true;
      profiles[profileKey].creatorDisplayName = displayName;
      profiles[profileKey].tags = profiles[profileKey].tags || [];
      saveCustomTargetProfiles(profiles);
    }

    // Push now (syncNow) instead of waiting for the debounce, then invalidate
    // the public-recipes cache once the push lands so the recipe shows up in
    // library.html promptly. On a failed push the sync layer already broadcasts
    // cw:save-status "error" (the save indicator surfaces it) and the next
    // sync/pull reconciles is_public, so we simply skip the cache bust.
    //
    // No native OS share sheet fires here: "Publish to library" is a
    // discoverability action (flip is_public so other users find the recipe in
    // the app), not "share a link with a friend" — conflating them surprises
    // users. window.cwNativeShare stays defined for a future explicit Share
    // Link affordance.
    if (typeof (window as any).syncNow === "function") {
      Promise.resolve((window as any).syncNow())
        .then(function () {
          if (typeof (window as any).invalidatePublicRecipesCache === "function") {
            (window as any).invalidatePublicRecipesCache();
          }
        })
        .catch(function (err: any) {
          console.warn("[share] publish push failed:", err);
        });
    } else if (typeof (window as any).invalidatePublicRecipesCache === "function") {
      (window as any).invalidatePublicRecipesCache();
    }

    close();
  }

  function noHandler() {
    close();
  }

  function keyHandler(e: KeyboardEvent) {
    if (e.key === "Escape") {
      noHandler();
      return;
    }
    if (e.key === "Enter" && document.activeElement === nameInput) {
      yesHandler();
      return;
    }
    if (e.key === "Tab") {
      const focusable = [nameInput, yesBtn, noBtn].filter(function (el) {
        return (el as HTMLElement).offsetParent !== null;
      });
      const idx = focusable.indexOf(document.activeElement as any);
      if (e.shiftKey) {
        e.preventDefault();
        (focusable[(idx <= 0 ? focusable.length : idx) - 1] as HTMLElement).focus();
      } else {
        e.preventDefault();
        (focusable[(idx + 1) % focusable.length] as HTMLElement).focus();
      }
    }
  }

  function overlayClickHandler(e: MouseEvent) {
    if (e.target === overlay) noHandler();
  }

  sharePromptCleanup = close;
  yesBtn.addEventListener("click", yesHandler);
  noBtn.addEventListener("click", noHandler);
  document.addEventListener("keydown", keyHandler);
  overlay.addEventListener("click", overlayClickHandler);
}

export function inferEffectiveSourcesFromMineralGrams(
  mineralGramsPerL: Record<string, number> | null | undefined,
  fallback?: { calciumSource?: string | null; magnesiumSource?: string | null },
): { calciumSource: string | null; magnesiumSource: string | null } {
  fallback = fallback || {};
  const grams = mineralGramsPerL || {};
  let caSource: string | null = null;
  let mgSource: string | null = null;
  let bestCaAdded = 0;
  let bestMgAdded = 0;
  Object.keys(grams).forEach(function (mineralId) {
    const amount = Math.max(0, Number(grams[mineralId]) || 0);
    if (!amount) return;
    const mineral = typeof MINERAL_DB !== "undefined" ? MINERAL_DB[mineralId] : null;
    if (!mineral || !mineral.ions) return;
    const caAdded = amount * 1000 * (Number(mineral.ions.calcium) || 0);
    const mgAdded = amount * 1000 * (Number(mineral.ions.magnesium) || 0);
    if (caAdded > bestCaAdded) {
      bestCaAdded = caAdded;
      caSource = mineralId;
    }
    if (mgAdded > bestMgAdded) {
      bestMgAdded = mgAdded;
      mgSource = mineralId;
    }
  });
  return {
    calciumSource: caSource || fallback.calciumSource || null,
    magnesiumSource: mgSource || fallback.magnesiumSource || null,
  };
}

export function onStorageKeysChanged(
  keys: string[],
  handler: (e: StorageEvent) => void,
): () => void {
  if (!Array.isArray(keys) || typeof handler !== "function") return function () {};
  const keySet = new Set(keys.filter(Boolean));
  function onStorage(e: StorageEvent) {
    if (!e || !e.key) return;
    if (!keySet.has(e.key)) return;
    handler(e);
  }
  window.addEventListener("storage", onStorage);
  return function off() {
    window.removeEventListener("storage", onStorage);
  };
}

// --- Delta formatting ---
export function roundDelta(delta: number | null | undefined, decimals = 0): number | null {
  if (!Number.isFinite(delta as number)) return null;
  if (decimals > 0) {
    const p = Math.pow(10, decimals);
    const rounded = Math.round((delta as number) * p) / p;
    return Object.is(rounded, -0) ? 0 : rounded;
  }
  const rounded = Math.round(delta as number);
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function formatDelta(delta: number | null | undefined, decimals = 0): string {
  const rounded = roundDelta(delta, decimals);
  if (rounded == null) return "-";
  const abs = decimals > 0 ? Math.abs(rounded).toFixed(decimals) : String(Math.abs(rounded));
  if (rounded > 0) return "+" + abs;
  if (rounded < 0) return "-" + abs;
  return decimals > 0 ? Number(0).toFixed(decimals) : "0";
}

export function setDeltaText(
  el: HTMLElement | null,
  delta: number | null | undefined,
  options: {
    decimals?: number;
    metricName?: string;
    baselineLabel?: string;
    visibleBaselineLabel?: string;
    unit?: string;
  } = {},
): void {
  if (!el) return;
  const decimals = options.decimals || 0;
  const metricName = options.metricName || "Value";
  const baselineLabel = options.baselineLabel || "baseline";
  const visibleBaselineLabel = options.visibleBaselineLabel || "";
  const unit = options.unit ? " " + options.unit : "";
  const rounded = roundDelta(delta, decimals);
  const deltaText = formatDelta(delta, decimals);
  el.textContent = visibleBaselineLabel ? `${deltaText} vs ${visibleBaselineLabel}` : deltaText;
  el.classList.remove("positive", "negative");
  if (rounded == null) {
    el.setAttribute("aria-label", `${metricName} delta unavailable compared to ${baselineLabel}`);
    return;
  }
  if (rounded > 0) {
    el.classList.add("positive");
    el.setAttribute(
      "aria-label",
      `${metricName} increased by ${Math.abs(rounded)}${unit} compared to ${baselineLabel}`,
    );
    return;
  }
  if (rounded < 0) {
    el.classList.add("negative");
    el.setAttribute(
      "aria-label",
      `${metricName} decreased by ${Math.abs(rounded)}${unit} compared to ${baselineLabel}`,
    );
    return;
  }
  el.setAttribute("aria-label", `${metricName} unchanged compared to ${baselineLabel}`);
}

// --- Range guidance rendering ---
export function renderRangeGuidance(
  el: HTMLElement | null,
  findings: Array<{ severity?: string; message?: string }> | null | undefined,
): void {
  if (!el) return;
  el.innerHTML = "";
  if (!Array.isArray(findings)) return;
  if (findings.length === 0) {
    const row = document.createElement("div");
    row.className = "range-guidance-line ok";
    row.textContent = "Profile sits within typical ranges.";
    el.appendChild(row);
    return;
  }
  const fragment = document.createDocumentFragment();
  findings.forEach((f) => {
    const row = document.createElement("div");
    const severity = f && f.severity ? f.severity : "info";
    row.className = "range-guidance-line " + severity;

    const prefix = document.createElement("span");
    prefix.className = "range-guidance-prefix";
    if (severity === "danger") {
      prefix.textContent = "High risk: ";
    } else if (severity === "warn") {
      prefix.textContent = "Recommended range: ";
    } else {
      prefix.textContent = "Note: ";
    }

    const message = document.createElement("span");
    message.textContent = f && f.message ? f.message : "";

    row.appendChild(prefix);
    row.appendChild(message);
    fragment.appendChild(row);
  });
  el.appendChild(fragment);
}

// --- Theme helpers ---
export function getResolvedTheme(): "light" | "dark" {
  const pref = loadThemePreference();
  if (pref === "light") return "light";
  if (pref === "dark") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(): void {
  document.documentElement.setAttribute("data-theme", getResolvedTheme());
  // Native iOS only: keep the shell's interface style in sync when the user
  // changes the theme without a reload (see theme-init.js for the load path and
  // CafelyticViewController for the native side). No-op off native.
  try {
    const w = window as unknown as {
      webkit?: { messageHandlers?: { cwTheme?: { postMessage: (m: string) => void } } };
    };
    w.webkit?.messageHandlers?.cwTheme?.postMessage(loadThemePreference());
  } catch {
    /* not on iOS native */
  }
}

export function initThemeListeners(): void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => {
    if (loadThemePreference() === "system") applyTheme();
  });
}

// --- Navigation ---
export function injectNav(): void {
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  const navItems: Array<
    | { type: "group"; label: string; children: Array<{ href: string; label: string }> }
    | { type: "link"; href: string; label: string; tool?: boolean }
  > = [
    // Top-level tabs. Labels mirror the native bottom bar (Calculator / Builder /
    // Tuner) so web and native read the same. On desktop they render as one flat
    // row; in the mobile hamburger menu the `tool` items are nested under a
    // "Tools" subheading (see .nav-tools-heading / .nav-tool-link in style.css).
    { type: "link", href: "index.html", label: "Calculator", tool: true },
    { type: "link", href: "recipe.html", label: "Builder", tool: true },
    { type: "link", href: "taste.html", label: "Tuner", tool: true },
    { type: "link", href: "library.html", label: "Library" },
    { type: "link", href: "start.html", label: "Beginners Guide" },
    { type: "link", href: "minerals.html", label: "Settings" },
    { type: "link", href: "support.html", label: "Support" },
  ];

  const nav = document.createElement("nav");
  nav.className = "site-nav";
  nav.setAttribute("aria-label", "Site navigation");

  // Brand logo + wordmark
  const brand = document.createElement("a");
  brand.href = "index.html";
  brand.className = "nav-brand";
  brand.setAttribute("aria-label", "Cafelytic home");
  brand.innerHTML =
    '<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<rect width="28" height="28" rx="3" fill="var(--brand-tile-fill)" stroke="var(--brand-tile-stroke)" stroke-width="1.5"/>' +
    '<text x="14" y="18" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif" font-size="13" font-weight="500" fill="var(--brand-tile-ca)">Ca</text>' +
    "</svg>" +
    '<span class="nav-brand-wordmark"><span class="brand-cafe">cafe</span><span class="brand-lytic">lytic</span></span>';
  nav.appendChild(brand);

  // Hamburger toggle (mobile only, hidden on desktop via CSS)
  const hamburger = document.createElement("button");
  hamburger.type = "button";
  hamburger.className = "nav-hamburger";
  hamburger.setAttribute("aria-label", "Toggle menu");
  hamburger.setAttribute("aria-expanded", "false");
  hamburger.innerHTML = "<span></span><span></span><span></span>";
  nav.appendChild(hamburger);

  // Nav links
  const linksWrap = document.createElement("div");
  linksWrap.className = "nav-links";
  let toolsHeadingInserted = false;
  navItems.forEach((item) => {
    if (item.type === "group") {
      const built = _buildNavGroup(item, currentPage);
      linksWrap.appendChild(built.wrap);
      _wireNavGroupBehavior(built.wrap, built.trigger, built.menu);
    } else {
      // Mobile only: drop a "Tools" subheading in front of the first tool tab.
      // It's display:none on desktop, so the desktop row stays flat and unchanged.
      if (item.tool && !toolsHeadingInserted) {
        const heading = document.createElement("div");
        heading.className = "nav-tools-heading";
        heading.setAttribute("aria-hidden", "true");
        heading.textContent = "Tools";
        linksWrap.appendChild(heading);
        toolsHeadingInserted = true;
      }
      const a = document.createElement("a");
      a.href = item.href;
      a.textContent = item.label;
      if (item.tool) a.classList.add("nav-tool-link");
      if (currentPage === item.href) a.classList.add("active");
      linksWrap.appendChild(a);
    }
  });
  nav.appendChild(linksWrap);

  // Auth element — inside the links dropdown on mobile, beside links on desktop
  const authWrap = document.createElement("div");
  authWrap.className = "nav-auth";
  linksWrap.appendChild(authWrap);

  document.body.insertBefore(nav, document.body.firstChild);

  // Hamburger toggle behavior
  hamburger.addEventListener("click", function () {
    const expanded = nav.classList.toggle("nav-open");
    hamburger.setAttribute("aria-expanded", String(expanded));
  });

  // Close menu when a link is clicked
  linksWrap.addEventListener("click", function (e) {
    if ((e.target as HTMLElement).tagName === "A") {
      nav.classList.remove("nav-open");
      hamburger.setAttribute("aria-expanded", "false");
    }
  });

  _updateNavAuth(authWrap, currentPage);
}

// Shared logout sequence. Order matters to avoid the data-loss class of bug:
//   1. flush any debounced edit to cloud while the session still exists
//   2. sign out (Supabase clears the session, fires SIGNED_OUT)
//   3. wipe local user content (Categories A/B/C; D preserved)
//   4. navigate to a clean page
// If the pending push fails, abort logout. Continuing would call signOut()
// and clearLocalUserContent() and silently drop the unsynced edit (e.g. a
// save made within SYNC_DEBOUNCE_MS of clicking Log out). Better to leave the
// user signed in so they can retry than to lose their data.
// Shared verbatim by the desktop top nav (_updateNavAuth) and the native
// bottom sheet (injectBottomNav) so this sequence lives in exactly one place.
async function performLogout(): Promise<void> {
  if (typeof window.flushPendingSync === "function") {
    try {
      await window.flushPendingSync();
    } catch (err) {
      console.warn("[auth] flushPendingSync failed; aborting logout:", err);
      return;
    }
  }
  // If signOut() throws (network blip, transient Supabase error), the auth
  // token survives — wiping local state and redirecting in that case would
  // leave the next page load authenticated, which defeats the purpose of
  // logout. Bail loudly instead.
  try {
    await (window as any).signOut();
  } catch (err) {
    console.warn("[auth] signOut failed:", err);
    return;
  }
  if (typeof window.clearLocalUserContent === "function") {
    window.clearLocalUserContent();
  }
  window.location.href = "index.html";
}

// Shared delete-account flow: typed-email confirm modal → delete_account RPC →
// signOut → wipe local content → flash flag → redirect. Invoked from the
// Settings page's "Delete account" section (mountDeleteAccountSetting) so the
// data-loss-sensitive sequence and its typed-email guard live in exactly one
// place.
function confirmAndDeleteAccount(userEmail: string): void {
  showConfirm(
    "This permanently deletes your account and all recipes saved to it. " +
      "Recipes you originally created and shared with others will stay " +
      'visible to them but show as "by Anonymous User". This cannot be undone.',
    async () => {
      // Unlike Log out, we deliberately skip flushPendingSync — there's no
      // point persisting the user's last edit to a row that's about to be
      // deleted, and racing the flush against the delete would only surface
      // confusing RLS errors.
      try {
        const { error } = await window.supabaseClient.rpc("delete_account");
        if (error) throw error;
      } catch (err) {
        console.warn("[auth] delete_account RPC failed:", err);
        alert(
          "Could not delete your account: " +
            ((err as { message?: string })?.message || "unknown error") +
            ". Please try again or contact info@cafelytic.com.",
        );
        return;
      }
      try {
        await (window as any).signOut();
      } catch (err) {
        console.warn("[auth] signOut after delete failed:", err);
        // Continue regardless — the auth row is already gone, so the local
        // session token is now invalid on the server side.
      }
      if (typeof window.clearLocalUserContent === "function") {
        window.clearLocalUserContent();
      }
      try {
        sessionStorage.setItem("cw_account_deleted_flash", "1");
      } catch (_) {
        // sessionStorage may be unavailable (private mode, embedded
        // contexts); the redirect still happens, just without the
        // confirmation toast.
      }
      window.location.href = "index.html";
    },
    {
      requireText: {
        value: userEmail,
        label: "Type your email to confirm:",
        placeholder: userEmail,
      },
      yesLabel: "Delete account",
      noLabel: "Cancel",
    },
  );
}

// Settings page (minerals.html) "Delete account" section. Apple Guideline
// 5.1.1(v) and Google Play's Data Deletion policy require an in-app deletion
// path; it lives here, as the last Settings card, on every platform — the web
// top nav and the native More sheet intentionally no longer carry it (too easy
// to tap by accident). The section ships hidden and is revealed only for
// signed-in users; there's no account to delete otherwise. The typed-email
// confirm modal is the real guard against an accidental tap.
async function mountDeleteAccountSetting(): Promise<void> {
  const section = document.getElementById("delete-account-section");
  const btn = document.getElementById("delete-account-btn");
  if (!section || !btn) return; // not the Settings page
  if (typeof window.supabaseClient === "undefined") return;
  try {
    // getSession() is the authoritative async auth source the nav uses too;
    // gating on it (rather than a sync snapshot) avoids the pre-auth-window
    // flash where a logged-in user briefly reads as logged out.
    const { data } = await window.supabaseClient.auth.getSession();
    const session = data && data.session;
    if (session && session.user) {
      const userEmail = session.user.email || "";
      btn.addEventListener("click", () => confirmAndDeleteAccount(userEmail));
      section.hidden = false;
    }
  } catch (_) {
    // Silently skip — mirrors _updateNavAuth's catch when Supabase is unavailable.
  }
}

async function _updateNavAuth(authWrap: HTMLElement, currentPage: string): Promise<void> {
  if (typeof window.supabaseClient === "undefined") return;
  try {
    const { data } = await window.supabaseClient.auth.getSession();
    const session = data && data.session;

    if (session && session.user) {
      const email = document.createElement("span");
      email.className = "nav-auth-email";
      email.textContent = session.user.email || "";

      const logoutBtn = document.createElement("button");
      logoutBtn.type = "button";
      logoutBtn.className = "nav-auth-btn";
      logoutBtn.textContent = "Log out";
      logoutBtn.addEventListener("click", performLogout);

      // "Delete account" intentionally lives in Settings (minerals.html), not
      // beside Log out here — it was too easy to fat-finger. See
      // mountDeleteAccountSetting().
      authWrap.appendChild(email);
      authWrap.appendChild(logoutBtn);
    } else {
      const loginLink = document.createElement("a");
      loginLink.href = "login.html";
      loginLink.className = "nav-auth-btn" + (currentPage === "login.html" ? " active" : "");
      loginLink.textContent = "Log in";
      authWrap.appendChild(loginLink);
    }
  } catch (_) {
    // Silently skip auth nav if Supabase is unavailable
  }
}

// Native check: Capacitor injects window.Capacitor into the WebView before any
// user script runs. Mirrors isNativePlatform() in supabase-client.ts; kept
// local so this UI module doesn't have to import that side-effectful client
// module (the file header notes supabase symbols are reached via window here).
function isNativeApp(): boolean {
  return (
    (
      window as { Capacitor?: { isNativePlatform?: () => boolean } }
    ).Capacitor?.isNativePlatform?.() === true
  );
}

// Inline SVG path data for the bottom nav + More sheet. viewBox 0 0 24 24,
// stroke="currentColor". Bar body paths tagged .cw-bn-fill get a tinted fill
// when their tab is active (see style.css). Source: the design handoff
// (prototype/cw-screen.jsx CwIcon); log-out/trash are standard 24px stroke
// icons in the same visual language for the sheet's account actions.
const BN_ICONS = {
  droplet:
    '<path class="cw-bn-fill" d="M12 2.6c0 0 6.6 6.9 6.6 11.4a6.6 6.6 0 0 1-13.2 0C5.4 9.5 12 2.6 12 2.6Z"/>',
  beaker:
    '<path class="cw-bn-fill" d="M10 3v5L5.4 18.2A1.4 1.4 0 0 0 6.7 20.3h10.6a1.4 1.4 0 0 0 1.3-2.1L14 8V3"/>' +
    '<path d="M8.5 3h7"/><path d="M7.2 14.5h9.6"/>',
  tuner:
    '<path d="M7 4v16"/><path d="M12 4v16"/><path d="M17 4v16"/>' +
    '<circle cx="7" cy="9" r="2.3" fill="var(--surface)"/>' +
    '<circle cx="12" cy="15" r="2.3" fill="var(--surface)"/>' +
    '<circle cx="17" cy="8" r="2.3" fill="var(--surface)"/>',
  book:
    '<path class="cw-bn-fill" d="M12 6.6C10.4 5.4 8.1 5.1 5.4 5.3a1 1 0 0 0-.9 1v11.2a1 1 0 0 0 1.1 1c2.4-.2 4.5.1 6.4 1.2 1.9-1.1 4-1.4 6.4-1.2a1 1 0 0 0 1.1-1V6.3a1 1 0 0 0-.9-1c-2.7-.2-5 .1-6.6 1.3Z"/>' +
    '<path d="M12 6.6V20"/>',
  more:
    '<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/>' +
    '<circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/>' +
    '<circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  sliders:
    '<path d="M3.5 7h17"/><path d="M3.5 12h17"/><path d="M3.5 17h17"/>' +
    '<circle cx="15.5" cy="7" r="2.4" fill="var(--surface)"/>' +
    '<circle cx="8.5" cy="12" r="2.4" fill="var(--surface)"/>' +
    '<circle cx="16" cy="17" r="2.4" fill="var(--surface)"/>',
  lightbulb:
    '<path d="M9.5 18h5"/><path d="M10 21h4"/>' +
    '<path d="M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.4 1.1 2.2h5.8c.1-.8.5-1.6 1.1-2.2A6 6 0 0 0 12 3Z"/>',
  person: '<circle cx="12" cy="8" r="3.6"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
  logout:
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  help:
    '<circle cx="12" cy="12" r="9.5"/>' +
    '<path d="M9.2 9.3a3 3 0 0 1 5.7 1c0 2-3 3-3 3"/>' +
    '<path d="M12 17h.01"/>',
};

function _bnSvg(inner: string): string {
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    inner +
    "</svg>"
  );
}

// Builds one More-sheet row. Navigation rows pass `href` (rendered as <a> with
// a trailing chevron); action rows pass `onClick` (rendered as <button>, no
// chevron); a display-only row passes neither (rendered as a static <div>).
// Text is set via textContent — only the SVG markup is trusted innerHTML.
function _buildSheetRow(opts: {
  href?: string;
  icon: string;
  label: string;
  sub?: string;
  accent?: boolean;
  danger?: boolean;
  onClick?: () => void;
}): HTMLElement {
  const row = document.createElement(opts.href ? "a" : opts.onClick ? "button" : "div");
  row.className =
    "more-sheet__row" +
    (opts.accent ? " more-sheet__row--accent" : "") +
    (opts.danger ? " more-sheet__row--danger" : "");
  if (opts.href) {
    (row as HTMLAnchorElement).href = opts.href;
  } else if (opts.onClick) {
    (row as HTMLButtonElement).type = "button";
  }

  const chip = document.createElement("span");
  chip.className = "more-sheet__chip";
  chip.innerHTML = _bnSvg(opts.icon);
  row.appendChild(chip);

  const text = document.createElement("span");
  text.className = "more-sheet__text";
  const label = document.createElement("span");
  label.className = "more-sheet__label";
  label.textContent = opts.label;
  text.appendChild(label);
  if (opts.sub) {
    const sub = document.createElement("span");
    sub.className = "more-sheet__sub";
    sub.textContent = opts.sub;
    text.appendChild(sub);
  }
  row.appendChild(text);

  if (opts.href) {
    const chev = document.createElement("span");
    chev.className = "more-sheet__chevron";
    chev.innerHTML = _bnSvg(BN_ICONS.chevron);
    row.appendChild(chev);
  }
  if (opts.onClick) row.addEventListener("click", opts.onClick);
  return row;
}

// Fills the More sheet's Account section from auth state. Mirrors
// _updateNavAuth's getSession branching but renders icon-chip rows, and calls
// the SAME shared logout handler (performLogout) so that data-loss-sensitive
// sequence is never forked. Account deletion lives in Settings now
// (mountDeleteAccountSetting), so this sheet no longer carries a delete row.
async function _buildSheetAccount(container: HTMLElement, currentPage: string): Promise<void> {
  if (typeof window.supabaseClient === "undefined") return;
  try {
    const { data } = await window.supabaseClient.auth.getSession();
    const session = data && data.session;
    if (session && session.user) {
      const userEmail = session.user.email || "";
      container.appendChild(
        _buildSheetRow({
          icon: BN_ICONS.person,
          label: userEmail || "Account",
          sub: "Signed in",
          accent: true,
        }),
      );
      container.appendChild(
        _buildSheetRow({ icon: BN_ICONS.logout, label: "Log out", onClick: performLogout }),
      );
      // "Delete account" lives in Settings (minerals.html) now, reached via the
      // Settings row in this sheet; it's intentionally not duplicated here.
    } else {
      container.appendChild(
        _buildSheetRow({
          href: "login.html",
          icon: BN_ICONS.person,
          label: "Log in",
          sub: "Sync recipes across devices",
          accent: true,
        }),
      );
    }
  } catch (_) {
    // Silently skip — mirrors _updateNavAuth's catch when Supabase is unavailable.
  }
}

// Native-only bottom tab bar + "More" bottom sheet. Mirrors injectNav()'s
// imperative createElement style. Injected only inside the Capacitor shell
// (gated by isNativeApp() in the DOMContentLoaded init); the web build keeps
// the existing top nav untouched.
function injectBottomNav(): void {
  const currentPage = window.location.pathname.split("/").pop() || "index.html";

  const tabs: Array<{ href: string | null; label: string; icon: string }> = [
    { href: "index.html", label: "Calculator", icon: BN_ICONS.droplet },
    { href: "recipe.html", label: "Builder", icon: BN_ICONS.beaker },
    { href: "taste.html", label: "Tuner", icon: BN_ICONS.tuner },
    { href: "library.html", label: "Library", icon: BN_ICONS.book },
    { href: null, label: "More", icon: BN_ICONS.more },
  ];

  // Pages that live behind the More sheet rather than a bar tab. On these the
  // More tab carries the active treatment.
  const SHEET_PAGES = ["minerals.html", "start.html", "login.html", "support.html"];
  const moreActive = SHEET_PAGES.indexOf(currentPage) !== -1;

  let sheetOpen = false;
  let moreBtn: HTMLButtonElement | null = null;

  // --- Bottom bar ---
  const bar = document.createElement("nav");
  bar.className = "bottom-nav";
  bar.setAttribute("aria-label", "Primary");

  tabs.forEach((tab) => {
    const isActive = tab.href ? currentPage === tab.href : moreActive;
    const el: HTMLElement = tab.href
      ? document.createElement("a")
      : document.createElement("button");
    el.className = "bottom-nav__tab" + (isActive ? " active" : "");
    el.innerHTML =
      '<span class="bottom-nav__pill">' +
      _bnSvg(tab.icon) +
      '</span><span class="bottom-nav__label">' +
      tab.label +
      "</span>";
    if (tab.href) {
      (el as HTMLAnchorElement).href = tab.href;
      if (isActive) el.setAttribute("aria-current", "page");
      el.addEventListener("click", (e) => {
        if (sheetOpen) closeSheet();
        // Same-page tap is a no-op (don't reload the page we're already on).
        if (tab.href === currentPage) e.preventDefault();
      });
    } else {
      const btn = el as HTMLButtonElement;
      btn.type = "button";
      btn.setAttribute("aria-haspopup", "dialog");
      btn.setAttribute("aria-expanded", "false");
      moreBtn = btn;
      btn.addEventListener("click", () => (sheetOpen ? closeSheet() : openSheet()));
    }
    bar.appendChild(el);
  });

  // --- More sheet: scrim + panel ---
  const scrim = document.createElement("div");
  scrim.className = "more-scrim";

  const sheet = document.createElement("div");
  sheet.className = "more-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "More");
  sheet.innerHTML =
    '<div class="more-sheet__grip" aria-hidden="true"></div>' +
    '<div class="more-sheet__heading">More</div>' +
    '<div class="more-sheet__list"></div>';
  const list = sheet.querySelector(".more-sheet__list") as HTMLElement;

  list.appendChild(
    _buildSheetRow({
      href: "minerals.html",
      icon: BN_ICONS.sliders,
      label: "Settings",
      sub: "Minerals, units & preferences",
    }),
  );
  list.appendChild(
    _buildSheetRow({
      href: "start.html",
      icon: BN_ICONS.lightbulb,
      label: "Beginners Guide",
      sub: "New to coffee water? Start here",
    }),
  );
  list.appendChild(
    _buildSheetRow({
      href: "support.html",
      icon: BN_ICONS.help,
      label: "Support",
      sub: "Get help or send us a message",
    }),
  );

  const divider = document.createElement("div");
  divider.className = "more-sheet__divider";
  list.appendChild(divider);

  const accountWrap = document.createElement("div");
  accountWrap.className = "more-sheet__account";
  list.appendChild(accountWrap);

  document.body.appendChild(bar);
  document.body.appendChild(scrim);
  document.body.appendChild(sheet);

  function openSheet(): void {
    sheetOpen = true;
    scrim.classList.add("is-open");
    sheet.classList.add("is-open");
    if (moreBtn) {
      moreBtn.classList.add("active");
      moreBtn.setAttribute("aria-expanded", "true");
    }
    const firstRow = list.querySelector<HTMLElement>(".more-sheet__row");
    if (firstRow) firstRow.focus();
  }
  function closeSheet(): void {
    sheetOpen = false;
    scrim.classList.remove("is-open");
    sheet.classList.remove("is-open");
    if (moreBtn) {
      // Restore the active treatment to whatever the current page dictates.
      if (!moreActive) moreBtn.classList.remove("active");
      moreBtn.setAttribute("aria-expanded", "false");
    }
  }

  scrim.addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sheetOpen) closeSheet();
  });
  // Tapping any sheet row dismisses the sheet (navigation rows then follow
  // their href; action rows have already run their handler).
  list.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".more-sheet__row")) closeSheet();
  });

  void _buildSheetAccount(accountWrap, currentPage);
}

function _buildNavGroup(
  group: { label: string; children: Array<{ href: string; label: string }> },
  currentPage: string,
): { wrap: HTMLElement; trigger: HTMLElement; menu: HTMLElement } {
  const isCurrentInGroup = group.children.some((c) => c.href === currentPage);

  const wrap = document.createElement("div");
  wrap.className = "nav-group";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "nav-group-trigger" + (isCurrentInGroup ? " active" : "");
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = group.label + ' <span class="chevron" aria-hidden="true">▾</span>';

  const menu = document.createElement("div");
  menu.className = "nav-group-menu";
  menu.hidden = true;

  group.children.forEach((c) => {
    const a = document.createElement("a");
    a.href = c.href;
    a.textContent = c.label;
    if (currentPage === c.href) a.className = "active";
    menu.appendChild(a);
  });

  wrap.appendChild(trigger);
  wrap.appendChild(menu);

  return { wrap, trigger, menu };
}

function _wireNavGroupBehavior(wrap: HTMLElement, trigger: HTMLElement, menu: HTMLElement): void {
  function close() {
    wrap.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    menu.hidden = true;
  }
  function open() {
    wrap.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    menu.hidden = false;
  }

  trigger.addEventListener("click", function (e) {
    e.stopPropagation();
    if (wrap.classList.contains("is-open")) close();
    else open();
  });

  document.addEventListener("click", function (e) {
    if (!wrap.contains(e.target as Node)) close();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && wrap.classList.contains("is-open")) {
      close();
      trigger.focus();
    }
  });
}

// --- Shared restore bar helpers ---
export function updateRestoreSourceBar(): void {
  const el = document.getElementById("restore-source-bar");
  if (!el) return;
  el.style.display = loadDeletedPresets().length > 0 ? "flex" : "none";
}

export function findFallbackPreset(allPresets: Record<string, unknown>): string {
  const keys = Object.keys(allPresets);
  return (
    keys.find(function (k) {
      return k !== "custom" && k !== "library";
    }) || "custom"
  );
}

// --- Safe radio selection (Bug 6) ---
export function selectRadioByValue(name: string, value: string): void {
  const radios = document.querySelectorAll(
    'input[name="' + CSS.escape(name) + '"]',
  ) as NodeListOf<HTMLInputElement>;
  radios.forEach(function (el) {
    if (el.value === value) el.checked = true;
  });
}

// --- Debounce helper (Inefficiency 6) ---
export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  ms: number,
): (...args: TArgs) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return function (this: unknown, ...args: TArgs) {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
    }, ms);
  };
}

// --- Save-status indicator (closes the "did my edit save?" loop) ---
// Listens for cw:save-status events dispatched by sync.js. Three transitions:
// "saving" (visible while a debounced push is queued or in-flight), "saved"
// (briefly visible after success, then fades), "error" (sticky until the
// next attempt succeeds). One element per page, optional — pages without the
// element opt out.
export function initSaveStatusIndicator(): void {
  const el = document.getElementById("save-status-indicator");
  if (!el) return;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  function setState(text: string, stateClass?: string) {
    if (hideTimer !== null) clearTimeout(hideTimer);
    el!.textContent = text;
    el!.classList.remove("status-saving", "status-saved", "status-error");
    if (stateClass) el!.classList.add(stateClass);
    el!.classList.add("visible");
  }

  // Page-init code paths (e.g. recipe.html writing back normalized concentrate
  // inputs) call scheduleSyncToCloud before the user has done anything, which
  // flashes "Saving…/Saved" on load. Gate the visible toast on first real
  // interaction so the indicator only surfaces for user-driven saves. Errors
  // are not gated — a genuine init-time push failure should still be visible.
  let userHasInteracted = false;
  const interactionEvents = ["pointerdown", "keydown", "touchstart", "input", "change"];
  function markInteracted() {
    userHasInteracted = true;
    interactionEvents.forEach(function (ev) {
      document.removeEventListener(ev, markInteracted, true);
    });
  }
  interactionEvents.forEach(function (ev) {
    document.addEventListener(ev, markInteracted, true);
  });

  window.addEventListener("cw:save-status", (e: Event) => {
    const detail = (e as CustomEvent).detail;
    const status = detail && detail.status;
    if (!userHasInteracted && (status === "saving" || status === "saved")) return;
    if (status === "saving") {
      setState("Saving…", "status-saving");
    } else if (status === "saved") {
      setState("Saved", "status-saved");
      hideTimer = setTimeout(() => {
        el!.classList.remove("visible", "status-saved");
      }, 2000);
    } else if (status === "error") {
      setState("Couldn't save - retrying", "status-error");
    }
  });
}

// --- Body scroll lock for modals (native scroll-chaining fix) ---
// On iOS the Capacitor shell keeps the WebView's scrollView bouncing
// (CafelyticViewController.swift re-enables `scrollView.bounces = true`), so
// the document behind an overlay stays a live scroller. A drag that starts in
// a modal's inner overflow:auto container then scroll-chains to that document
// once it reaches a boundary (or immediately, when the inner container has
// little to scroll) and the page behind the modal moves instead of the modal.
// Locking `overflow: hidden` on <body> collapses the document scroller while a
// modal is up; `overscroll-behavior: contain` on the inner containers stops
// the chain on newer WebKit (see style.css). We track open modals by token in
// a Set rather than a bare counter so the lock is idempotent per modal (a
// double open() or double close() can't unbalance it) and survives stacking —
// the login modal can open over the recipe detail modal, and the
// recipe-concentrate / DIY editors open over the mineral selector; the body
// stays locked until the last overlay closes.
const openModalTokens = new Set<string>();
export function lockBodyScroll(token?: string): void {
  openModalTokens.add(token || "modal");
  document.body.classList.add("modal-scroll-lock");
}
export function unlockBodyScroll(token?: string): void {
  openModalTokens.delete(token || "modal");
  if (openModalTokens.size === 0) {
    document.body.classList.remove("modal-scroll-lock");
  }
}

// --- Window/global population ---
// Classic-script consumers (script.js, recipe-browser.js, source-water-ui.js,
// mineral-selector.js, stock-editor.js, estimate-water-ui.js, plus several
// inline HTML blocks) reach these names via lexical lookup, which resolves to
// the global scope. Publishing them on window keeps the existing call sites
// working unchanged. Mirrors storage.ts:1486's pattern. Will shrink as
// consumers also become TS modules and import directly.
if (typeof window !== "undefined") {
  Object.assign(window, {
    readNonNegative,
    getVisibleIonFields,
    applyMineralDisplayMode,
    createStatusHandler,
    bindEnterToClick,
    initSourcePresetSelect,
    renderSourceWaterTags,
    showConfirm,
    primeCurrentUserId,
    getCurrentUserIdSync,
    isUserTheCreator,
    maybeOfferSharePrompt,
    applyAuthGate,
    showSharePrompt,
    inferEffectiveSourcesFromMineralGrams,
    onStorageKeysChanged,
    roundDelta,
    formatDelta,
    setDeltaText,
    renderRangeGuidance,
    getResolvedTheme,
    applyTheme,
    initThemeListeners,
    injectNav,
    updateRestoreSourceBar,
    findFallbackPreset,
    selectRadioByValue,
    debounce,
    initSaveStatusIndicator,
    lockBodyScroll,
    unlockBodyScroll,
  });
}

// --- One-shot flash banner after account deletion ---
// confirmAndDeleteAccount (triggered from the Settings "Delete account"
// section) sets this flag in sessionStorage immediately before navigating to
// index.html. We read + clear it here so the user lands on the home page with
// a brief confirmation that the deletion went through, rather than a silent
// unauthed redirect that looks like they got logged out by mistake.
function showAccountDeletedFlashIfPending(): void {
  let pending = false;
  try {
    pending = sessionStorage.getItem("cw_account_deleted_flash") === "1";
    if (pending) sessionStorage.removeItem("cw_account_deleted_flash");
  } catch (_) {
    return;
  }
  if (!pending) return;
  const banner = document.createElement("div");
  banner.className = "account-deleted-flash";
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");
  banner.textContent = "Your account has been deleted.";
  document.body.appendChild(banner);
  setTimeout(() => {
    banner.classList.add("account-deleted-flash--leaving");
    setTimeout(() => {
      if (banner.parentNode) banner.parentNode.removeChild(banner);
    }, 400);
  }, 4000);
}

// --- App Store / Google Play footer callout (web + mobile web only) ---
// Cafelytic also ships as native iOS/Android apps (Capacitor). On the web we
// surface the matching store badge in the footer — the least obtrusive region
// of the page — so visitors know a native app exists. Hidden inside the native
// app itself (isNativeApp() short-circuits): someone already in the app has
// nothing to download. Permanent, not dismissible — the footer is already
// low-emphasis, so there is nothing in the way to dismiss.
const APP_STORE_URL = "https://apps.apple.com/app/id6777549437";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.cafelytic.app";
// Google Play listing is not live yet. Flip to true (and paste the official
// badge into GOOGLE_BADGE_SVG below) when it is — that turns on the Play badge
// and the per-platform targeting in injectAppStoreCallout().
const PLAY_STORE_LIVE: boolean = false;

// Official, unmodified store badge artwork. Each constant carries BOTH the
// light-surface and dark-surface variant; the CSS in style.css shows the right
// one per resolved theme via [data-theme="dark"] (.badge-art--light /
// .badge-art--dark). Apple + Google brand guidelines require the official art
// used as-is: do not recolor, distort, rotate, or redraw it.
// APPLE_BADGE_SVG holds Apple's official "Download on the App Store" lockup
// (black + white), fetched from Apple's badge toolkit and inlined verbatim (only
// ids and <title> stripped; artwork untouched). GOOGLE_BADGE_SVG is still a
// placeholder — replace it with the official Google Play badge when
// PLAY_STORE_LIVE is turned on.
const APPLE_BADGE_SVG =
  '<svg class="badge-art badge-art--light" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="119.66407" height="40" viewBox="0 0 119.66407 40"><g><g><g><path d="M110.13477,0H9.53468c-.3667,0-.729,0-1.09473.002-.30615.002-.60986.00781-.91895.0127A13.21476,13.21476,0,0,0,5.5171.19141a6.66509,6.66509,0,0,0-1.90088.627A6.43779,6.43779,0,0,0,1.99757,1.99707,6.25844,6.25844,0,0,0,.81935,3.61816a6.60119,6.60119,0,0,0-.625,1.90332,12.993,12.993,0,0,0-.1792,2.002C.00587,7.83008.00489,8.1377,0,8.44434V31.5586c.00489.3105.00587.6113.01515.9219a12.99232,12.99232,0,0,0,.1792,2.0019,6.58756,6.58756,0,0,0,.625,1.9043A6.20778,6.20778,0,0,0,1.99757,38.001a6.27445,6.27445,0,0,0,1.61865,1.1787,6.70082,6.70082,0,0,0,1.90088.6308,13.45514,13.45514,0,0,0,2.0039.1768c.30909.0068.6128.0107.91895.0107C8.80567,40,9.168,40,9.53468,40H110.13477c.3594,0,.7246,0,1.084-.002.3047,0,.6172-.0039.9219-.0107a13.279,13.279,0,0,0,2-.1768,6.80432,6.80432,0,0,0,1.9082-.6308,6.27742,6.27742,0,0,0,1.6172-1.1787,6.39482,6.39482,0,0,0,1.1816-1.6143,6.60413,6.60413,0,0,0,.6191-1.9043,13.50643,13.50643,0,0,0,.1856-2.0019c.0039-.3106.0039-.6114.0039-.9219.0078-.3633.0078-.7246.0078-1.0938V9.53613c0-.36621,0-.72949-.0078-1.09179,0-.30664,0-.61426-.0039-.9209a13.5071,13.5071,0,0,0-.1856-2.002,6.6177,6.6177,0,0,0-.6191-1.90332,6.46619,6.46619,0,0,0-2.7988-2.7998,6.76754,6.76754,0,0,0-1.9082-.627,13.04394,13.04394,0,0,0-2-.17676c-.3047-.00488-.6172-.01074-.9219-.01269-.3594-.002-.7246-.002-1.084-.002Z" style="fill: #a6a6a6"/><path d="M8.44483,39.125c-.30468,0-.602-.0039-.90429-.0107a12.68714,12.68714,0,0,1-1.86914-.1631,5.88381,5.88381,0,0,1-1.65674-.5479,5.40573,5.40573,0,0,1-1.397-1.0166,5.32082,5.32082,0,0,1-1.02051-1.3965,5.72186,5.72186,0,0,1-.543-1.6572,12.41351,12.41351,0,0,1-.1665-1.875c-.00634-.2109-.01464-.9131-.01464-.9131V8.44434S.88185,7.75293.8877,7.5498a12.37039,12.37039,0,0,1,.16553-1.87207,5.7555,5.7555,0,0,1,.54346-1.6621A5.37349,5.37349,0,0,1,2.61183,2.61768,5.56543,5.56543,0,0,1,4.01417,1.59521a5.82309,5.82309,0,0,1,1.65332-.54394A12.58589,12.58589,0,0,1,7.543.88721L8.44532.875H111.21387l.9131.0127a12.38493,12.38493,0,0,1,1.8584.16259,5.93833,5.93833,0,0,1,1.6709.54785,5.59374,5.59374,0,0,1,2.415,2.41993,5.76267,5.76267,0,0,1,.5352,1.64892,12.995,12.995,0,0,1,.1738,1.88721c.0029.2832.0029.5874.0029.89014.0079.375.0079.73193.0079,1.09179V30.4648c0,.3633,0,.7178-.0079,1.0752,0,.3252,0,.6231-.0039.9297a12.73126,12.73126,0,0,1-.1709,1.8535,5.739,5.739,0,0,1-.54,1.67,5.48029,5.48029,0,0,1-1.0156,1.3857,5.4129,5.4129,0,0,1-1.3994,1.0225,5.86168,5.86168,0,0,1-1.668.5498,12.54218,12.54218,0,0,1-1.8692.1631c-.2929.0068-.5996.0107-.8974.0107l-1.084.002Z"/></g><g><g><g><path d="M24.76888,20.30068a4.94881,4.94881,0,0,1,2.35656-4.15206,5.06566,5.06566,0,0,0-3.99116-2.15768c-1.67924-.17626-3.30719,1.00483-4.1629,1.00483-.87227,0-2.18977-.98733-3.6085-.95814a5.31529,5.31529,0,0,0-4.47292,2.72787c-1.934,3.34842-.49141,8.26947,1.3612,10.97608.9269,1.32535,2.01018,2.8058,3.42763,2.7533,1.38706-.05753,1.9051-.88448,3.5794-.88448,1.65876,0,2.14479.88448,3.591.8511,1.48838-.02416,2.42613-1.33124,3.32051-2.66914a10.962,10.962,0,0,0,1.51842-3.09251A4.78205,4.78205,0,0,1,24.76888,20.30068Z" style="fill: #fff"/><path d="M22.03725,12.21089a4.87248,4.87248,0,0,0,1.11452-3.49062,4.95746,4.95746,0,0,0-3.20758,1.65961,4.63634,4.63634,0,0,0-1.14371,3.36139A4.09905,4.09905,0,0,0,22.03725,12.21089Z" style="fill: #fff"/></g></g><g><path d="M42.30227,27.13965h-4.7334l-1.13672,3.35645H34.42727l4.4834-12.418h2.083l4.4834,12.418H43.438ZM38.0591,25.59082h3.752l-1.84961-5.44727h-.05176Z" style="fill: #fff"/><path d="M55.15969,25.96973c0,2.81348-1.50586,4.62109-3.77832,4.62109a3.0693,3.0693,0,0,1-2.84863-1.584h-.043v4.48438h-1.8584V21.44238H48.4302v1.50586h.03418a3.21162,3.21162,0,0,1,2.88281-1.60059C53.645,21.34766,55.15969,23.16406,55.15969,25.96973Zm-1.91016,0c0-1.833-.94727-3.03809-2.39258-3.03809-1.41992,0-2.375,1.23047-2.375,3.03809,0,1.82422.95508,3.0459,2.375,3.0459C52.30227,29.01563,53.24953,27.81934,53.24953,25.96973Z" style="fill: #fff"/><path d="M65.12453,25.96973c0,2.81348-1.50586,4.62109-3.77832,4.62109a3.0693,3.0693,0,0,1-2.84863-1.584h-.043v4.48438h-1.8584V21.44238H58.395v1.50586h.03418A3.21162,3.21162,0,0,1,61.312,21.34766C63.60988,21.34766,65.12453,23.16406,65.12453,25.96973Zm-1.91016,0c0-1.833-.94727-3.03809-2.39258-3.03809-1.41992,0-2.375,1.23047-2.375,3.03809,0,1.82422.95508,3.0459,2.375,3.0459C62.26711,29.01563,63.21438,27.81934,63.21438,25.96973Z" style="fill: #fff"/><path d="M71.71047,27.03613c.1377,1.23145,1.334,2.04,2.96875,2.04,1.56641,0,2.69336-.80859,2.69336-1.91895,0-.96387-.67969-1.541-2.28906-1.93652l-1.60937-.3877c-2.28027-.55078-3.33887-1.61719-3.33887-3.34766,0-2.14258,1.86719-3.61426,4.51855-3.61426,2.624,0,4.42285,1.47168,4.4834,3.61426h-1.876c-.1123-1.23926-1.13672-1.9873-2.63379-1.9873s-2.52148.75684-2.52148,1.8584c0,.87793.6543,1.39453,2.25488,1.79l1.36816.33594c2.54785.60254,3.60645,1.626,3.60645,3.44238,0,2.32324-1.85059,3.77832-4.79395,3.77832-2.75391,0-4.61328-1.4209-4.7334-3.667Z" style="fill: #fff"/><path d="M83.34621,19.2998v2.14258h1.72168v1.47168H83.34621v4.99121c0,.77539.34473,1.13672,1.10156,1.13672a5.80752,5.80752,0,0,0,.61133-.043v1.46289a5.10351,5.10351,0,0,1-1.03223.08594c-1.833,0-2.54785-.68848-2.54785-2.44434V22.91406H80.16262V21.44238H81.479V19.2998Z" style="fill: #fff"/><path d="M86.065,25.96973c0-2.84863,1.67773-4.63867,4.29395-4.63867,2.625,0,4.29492,1.79,4.29492,4.63867,0,2.85645-1.66113,4.63867-4.29492,4.63867C87.72609,30.6084,86.065,28.82617,86.065,25.96973Zm6.69531,0c0-1.9541-.89551-3.10742-2.40137-3.10742s-2.40039,1.16211-2.40039,3.10742c0,1.96191.89453,3.10645,2.40039,3.10645S92.76027,27.93164,92.76027,25.96973Z" style="fill: #fff"/><path d="M96.18606,21.44238h1.77246v1.541h.043a2.1594,2.1594,0,0,1,2.17773-1.63574,2.86616,2.86616,0,0,1,.63672.06934v1.73828a2.59794,2.59794,0,0,0-.835-.1123,1.87264,1.87264,0,0,0-1.93652,2.083v5.37012h-1.8584Z" style="fill: #fff"/><path d="M109.3843,27.83691c-.25,1.64355-1.85059,2.77148-3.89844,2.77148-2.63379,0-4.26855-1.76465-4.26855-4.5957,0-2.83984,1.64355-4.68164,4.19043-4.68164,2.50488,0,4.08008,1.7207,4.08008,4.46582v.63672h-6.39453v.1123a2.358,2.358,0,0,0,2.43555,2.56445,2.04834,2.04834,0,0,0,2.09082-1.27344Zm-6.28223-2.70215h4.52637a2.1773,2.1773,0,0,0-2.2207-2.29785A2.292,2.292,0,0,0,103.10207,25.13477Z" style="fill: #fff"/></g></g></g><g><g><path d="M37.82619,8.731a2.63964,2.63964,0,0,1,2.80762,2.96484c0,1.90625-1.03027,3.002-2.80762,3.002H35.67092V8.731Zm-1.22852,5.123h1.125a1.87588,1.87588,0,0,0,1.96777-2.146,1.881,1.881,0,0,0-1.96777-2.13379h-1.125Z" style="fill: #fff"/><path d="M41.68068,12.44434a2.13323,2.13323,0,1,1,4.24707,0,2.13358,2.13358,0,1,1-4.24707,0Zm3.333,0c0-.97607-.43848-1.54687-1.208-1.54687-.77246,0-1.207.5708-1.207,1.54688,0,.98389.43457,1.55029,1.207,1.55029C44.57522,13.99463,45.01369,13.42432,45.01369,12.44434Z" style="fill: #fff"/><path d="M51.57326,14.69775h-.92187l-.93066-3.31641h-.07031l-.92676,3.31641h-.91309l-1.24121-4.50293h.90137l.80664,3.436h.06641l.92578-3.436h.85254l.92578,3.436h.07031l.80273-3.436h.88867Z" style="fill: #fff"/><path d="M53.85354,10.19482H54.709v.71533h.06641a1.348,1.348,0,0,1,1.34375-.80225,1.46456,1.46456,0,0,1,1.55859,1.6748v2.915h-.88867V12.00586c0-.72363-.31445-1.0835-.97168-1.0835a1.03294,1.03294,0,0,0-1.0752,1.14111v2.63428h-.88867Z" style="fill: #fff"/><path d="M59.09377,8.437h.88867v6.26074h-.88867Z" style="fill: #fff"/><path d="M61.21779,12.44434a2.13346,2.13346,0,1,1,4.24756,0,2.1338,2.1338,0,1,1-4.24756,0Zm3.333,0c0-.97607-.43848-1.54687-1.208-1.54687-.77246,0-1.207.5708-1.207,1.54688,0,.98389.43457,1.55029,1.207,1.55029C64.11232,13.99463,64.5508,13.42432,64.5508,12.44434Z" style="fill: #fff"/><path d="M66.4009,13.42432c0-.81055.60352-1.27783,1.6748-1.34424l1.21973-.07031v-.38867c0-.47559-.31445-.74414-.92187-.74414-.49609,0-.83984.18213-.93848.50049h-.86035c.09082-.77344.81836-1.26953,1.83984-1.26953,1.12891,0,1.76563.562,1.76563,1.51318v3.07666h-.85547v-.63281h-.07031a1.515,1.515,0,0,1-1.35254.707A1.36026,1.36026,0,0,1,66.4009,13.42432Zm2.89453-.38477v-.37646l-1.09961.07031c-.62012.0415-.90137.25244-.90137.64941,0,.40527.35156.64111.835.64111A1.0615,1.0615,0,0,0,69.29543,13.03955Z" style="fill: #fff"/><path d="M71.34816,12.44434c0-1.42285.73145-2.32422,1.86914-2.32422a1.484,1.484,0,0,1,1.38086.79h.06641V8.437h.88867v6.26074h-.85156v-.71143h-.07031a1.56284,1.56284,0,0,1-1.41406.78564C72.0718,14.772,71.34816,13.87061,71.34816,12.44434Zm.918,0c0,.95508.4502,1.52979,1.20313,1.52979.749,0,1.21191-.583,1.21191-1.52588,0-.93848-.46777-1.52979-1.21191-1.52979C72.72121,10.91846,72.26613,11.49707,72.26613,12.44434Z" style="fill: #fff"/><path d="M79.23,12.44434a2.13323,2.13323,0,1,1,4.24707,0,2.13358,2.13358,0,1,1-4.24707,0Zm3.333,0c0-.97607-.43848-1.54687-1.208-1.54687-.77246,0-1.207.5708-1.207,1.54688,0,.98389.43457,1.55029,1.207,1.55029C82.12453,13.99463,82.563,13.42432,82.563,12.44434Z" style="fill: #fff"/><path d="M84.66945,10.19482h.85547v.71533h.06641a1.348,1.348,0,0,1,1.34375-.80225,1.46456,1.46456,0,0,1,1.55859,1.6748v2.915H87.605V12.00586c0-.72363-.31445-1.0835-.97168-1.0835a1.03294,1.03294,0,0,0-1.0752,1.14111v2.63428h-.88867Z" style="fill: #fff"/><path d="M93.51516,9.07373v1.1416h.97559v.74854h-.97559V13.2793c0,.47168.19434.67822.63672.67822a2.96657,2.96657,0,0,0,.33887-.02051v.74023a2.9155,2.9155,0,0,1-.4834.04541c-.98828,0-1.38184-.34766-1.38184-1.21582v-2.543h-.71484v-.74854h.71484V9.07373Z" style="fill: #fff"/><path d="M95.70461,8.437h.88086v2.48145h.07031a1.3856,1.3856,0,0,1,1.373-.80664,1.48339,1.48339,0,0,1,1.55078,1.67871v2.90723H98.69v-2.688c0-.71924-.335-1.0835-.96289-1.0835a1.05194,1.05194,0,0,0-1.13379,1.1416v2.62988h-.88867Z" style="fill: #fff"/><path d="M104.76125,13.48193a1.828,1.828,0,0,1-1.95117,1.30273A2.04531,2.04531,0,0,1,100.73,12.46045a2.07685,2.07685,0,0,1,2.07617-2.35254c1.25293,0,2.00879.856,2.00879,2.27V12.688h-3.17969v.0498a1.1902,1.1902,0,0,0,1.19922,1.29,1.07934,1.07934,0,0,0,1.07129-.5459Zm-3.126-1.45117h2.27441a1.08647,1.08647,0,0,0-1.1084-1.1665A1.15162,1.15162,0,0,0,101.63527,12.03076Z" style="fill: #fff"/></g></g></g></svg>' +
  '<svg class="badge-art badge-art--dark" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="119.66407" height="40" viewBox="0 0 119.66407 40"><g><g><g><path d="M110.13477,0H9.53468c-.3667,0-.729,0-1.09473.002-.30615.002-.60986.00781-.91895.0127A13.21476,13.21476,0,0,0,5.5171.19141a6.66509,6.66509,0,0,0-1.90088.627A6.43779,6.43779,0,0,0,1.99757,1.99707,6.25844,6.25844,0,0,0,.81935,3.61816a6.60119,6.60119,0,0,0-.625,1.90332,12.993,12.993,0,0,0-.1792,2.002C.00587,7.83008.00489,8.1377,0,8.44434V31.5586c.00489.3105.00587.6113.01515.9219a12.99232,12.99232,0,0,0,.1792,2.0019,6.58756,6.58756,0,0,0,.625,1.9043A6.20778,6.20778,0,0,0,1.99757,38.001a6.27445,6.27445,0,0,0,1.61865,1.1787,6.70082,6.70082,0,0,0,1.90088.6308,13.45514,13.45514,0,0,0,2.0039.1768c.30909.0068.6128.0107.91895.0107C8.80567,40,9.168,40,9.53468,40H110.13477c.3594,0,.7246,0,1.084-.002.3047,0,.6172-.0039.9219-.0107a13.279,13.279,0,0,0,2-.1768,6.80432,6.80432,0,0,0,1.9082-.6308,6.27742,6.27742,0,0,0,1.6172-1.1787,6.39482,6.39482,0,0,0,1.1816-1.6143,6.60413,6.60413,0,0,0,.6191-1.9043,13.50643,13.50643,0,0,0,.1856-2.0019c.0039-.3106.0039-.6114.0039-.9219.0078-.3633.0078-.7246.0078-1.0938V9.53613c0-.36621,0-.72949-.0078-1.09179,0-.30664,0-.61426-.0039-.9209a13.5071,13.5071,0,0,0-.1856-2.002,6.6177,6.6177,0,0,0-.6191-1.90332,6.46619,6.46619,0,0,0-2.7988-2.7998,6.76754,6.76754,0,0,0-1.9082-.627,13.04394,13.04394,0,0,0-2-.17676c-.3047-.00488-.6172-.01074-.9219-.01269-.3594-.002-.7246-.002-1.084-.002Z"/><path d="M8.44483,39.125c-.30468,0-.602-.0039-.90429-.0107a12.68714,12.68714,0,0,1-1.86914-.1631,5.88381,5.88381,0,0,1-1.65674-.5479,5.40573,5.40573,0,0,1-1.397-1.0166,5.32082,5.32082,0,0,1-1.02051-1.3965,5.72186,5.72186,0,0,1-.543-1.6572,12.41351,12.41351,0,0,1-.1665-1.875c-.00634-.2109-.01464-.9131-.01464-.9131V8.44434S.88185,7.75293.8877,7.5498a12.37039,12.37039,0,0,1,.16553-1.87207,5.7555,5.7555,0,0,1,.54346-1.6621A5.37349,5.37349,0,0,1,2.61183,2.61768,5.56543,5.56543,0,0,1,4.01417,1.59521a5.82309,5.82309,0,0,1,1.65332-.54394A12.58589,12.58589,0,0,1,7.543.88721L8.44532.875H111.21387l.9131.0127a12.38493,12.38493,0,0,1,1.8584.16259,5.93833,5.93833,0,0,1,1.6709.54785,5.59374,5.59374,0,0,1,2.415,2.41993,5.76267,5.76267,0,0,1,.5352,1.64892,12.995,12.995,0,0,1,.1738,1.88721c.0029.2832.0029.5874.0029.89014.0079.375.0079.73193.0079,1.09179V30.4648c0,.3633,0,.7178-.0079,1.0752,0,.3252,0,.6231-.0039.9297a12.73126,12.73126,0,0,1-.1709,1.8535,5.739,5.739,0,0,1-.54,1.67,5.48029,5.48029,0,0,1-1.0156,1.3857,5.4129,5.4129,0,0,1-1.3994,1.0225,5.86168,5.86168,0,0,1-1.668.5498,12.54218,12.54218,0,0,1-1.8692.1631c-.2929.0068-.5996.0107-.8974.0107l-1.084.002Z" style="fill: #fff"/></g><g><g><g><path d="M24.99671,19.88935a5.14625,5.14625,0,0,1,2.45058-4.31771,5.26776,5.26776,0,0,0-4.15039-2.24376c-1.74624-.1833-3.43913,1.04492-4.329,1.04492-.90707,0-2.27713-1.02672-3.75247-.99637a5.52735,5.52735,0,0,0-4.65137,2.8367c-2.01111,3.482-.511,8.59939,1.41551,11.414.96388,1.37823,2.09037,2.91774,3.56438,2.86315,1.4424-.05983,1.98111-.91977,3.7222-.91977,1.72494,0,2.23035.91977,3.73427.88506,1.54777-.02512,2.52292-1.38435,3.453-2.77563a11.39931,11.39931,0,0,0,1.579-3.21589A4.97284,4.97284,0,0,1,24.99671,19.88935Z"/><path d="M22.15611,11.47681a5.06687,5.06687,0,0,0,1.159-3.62989,5.15524,5.15524,0,0,0-3.33555,1.72582,4.82131,4.82131,0,0,0-1.18934,3.4955A4.26259,4.26259,0,0,0,22.15611,11.47681Z"/></g></g><g><path d="M42.30178,27.13965h-4.7334l-1.13672,3.35645H34.42678l4.4834-12.418h2.083l4.4834,12.418H43.43752Zm-4.24316-1.54883h3.752L39.961,20.14355H39.9092Z"/><path d="M55.1592,25.96973c0,2.81348-1.50586,4.62109-3.77832,4.62109a3.0693,3.0693,0,0,1-2.84863-1.584h-.043v4.48438h-1.8584V21.44238h1.79883v1.50586h.03418a3.21162,3.21162,0,0,1,2.88281-1.60059C53.64455,21.34766,55.1592,23.16406,55.1592,25.96973Zm-1.91016,0c0-1.833-.94727-3.03809-2.39258-3.03809-1.41992,0-2.375,1.23047-2.375,3.03809,0,1.82422.95508,3.0459,2.375,3.0459C52.30178,29.01563,53.249,27.81934,53.249,25.96973Z"/><path d="M65.12453,25.96973c0,2.81348-1.50635,4.62109-3.77881,4.62109a3.0693,3.0693,0,0,1-2.84863-1.584h-.043v4.48438h-1.8584V21.44238h1.79883v1.50586h.03418a3.21162,3.21162,0,0,1,2.88281-1.60059C63.6094,21.34766,65.12453,23.16406,65.12453,25.96973Zm-1.91064,0c0-1.833-.94727-3.03809-2.39258-3.03809-1.41992,0-2.375,1.23047-2.375,3.03809,0,1.82422.95508,3.0459,2.375,3.0459C62.26662,29.01563,63.21389,27.81934,63.21389,25.96973Z"/><path d="M71.70949,27.03613c.1377,1.23145,1.334,2.04,2.96875,2.04,1.56641,0,2.69336-.80859,2.69336-1.91895,0-.96387-.67969-1.541-2.28906-1.93652l-1.60937-.3877c-2.28027-.55078-3.33887-1.61719-3.33887-3.34766,0-2.14258,1.86719-3.61426,4.51758-3.61426,2.625,0,4.42383,1.47168,4.48438,3.61426h-1.876c-.1123-1.23926-1.13672-1.9873-2.63379-1.9873s-2.52148.75684-2.52148,1.8584c0,.87793.6543,1.39453,2.25488,1.79l1.36816.33594c2.54785.60254,3.60547,1.626,3.60547,3.44238,0,2.32324-1.84961,3.77832-4.793,3.77832-2.75391,0-4.61328-1.4209-4.7334-3.667Z"/><path d="M83.34621,19.2998v2.14258h1.72168v1.47168H83.34621v4.99121c0,.77539.34473,1.13672,1.10156,1.13672a5.80752,5.80752,0,0,0,.61133-.043v1.46289a5.10351,5.10351,0,0,1-1.03223.08594c-1.833,0-2.54785-.68848-2.54785-2.44434V22.91406H80.16262V21.44238H81.479V19.2998Z"/><path d="M86.064,25.96973c0-2.84863,1.67773-4.63867,4.29395-4.63867,2.625,0,4.29492,1.79,4.29492,4.63867,0,2.85645-1.66113,4.63867-4.29492,4.63867C87.72512,30.6084,86.064,28.82617,86.064,25.96973Zm6.69531,0c0-1.9541-.89551-3.10742-2.40137-3.10742s-2.40137,1.16211-2.40137,3.10742c0,1.96191.89551,3.10645,2.40137,3.10645S92.7593,27.93164,92.7593,25.96973Z"/><path d="M96.18508,21.44238h1.77246v1.541h.043a2.1594,2.1594,0,0,1,2.17773-1.63574,2.86616,2.86616,0,0,1,.63672.06934v1.73828a2.59794,2.59794,0,0,0-.835-.1123,1.87264,1.87264,0,0,0-1.93652,2.083v5.37012h-1.8584Z"/><path d="M109.38332,27.83691c-.25,1.64355-1.85059,2.77148-3.89844,2.77148-2.63379,0-4.26855-1.76465-4.26855-4.5957,0-2.83984,1.64355-4.68164,4.19043-4.68164,2.50488,0,4.08008,1.7207,4.08008,4.46582v.63672h-6.39453v.1123a2.358,2.358,0,0,0,2.43555,2.56445,2.04834,2.04834,0,0,0,2.09082-1.27344Zm-6.28223-2.70215h4.52637a2.1773,2.1773,0,0,0-2.2207-2.29785A2.292,2.292,0,0,0,103.10109,25.13477Z"/></g></g></g><g><g><path d="M37.82619,8.731a2.63964,2.63964,0,0,1,2.80762,2.96484c0,1.90625-1.03027,3.002-2.80762,3.002H35.67092V8.731Zm-1.22852,5.123h1.125a1.87588,1.87588,0,0,0,1.96777-2.146,1.881,1.881,0,0,0-1.96777-2.13379h-1.125Z"/><path d="M41.68068,12.44434a2.13323,2.13323,0,1,1,4.24707,0,2.13358,2.13358,0,1,1-4.24707,0Zm3.333,0c0-.97607-.43848-1.54687-1.208-1.54687-.77246,0-1.207.5708-1.207,1.54688,0,.98389.43457,1.55029,1.207,1.55029C44.57522,13.99463,45.01369,13.42432,45.01369,12.44434Z"/><path d="M51.57326,14.69775h-.92187l-.93066-3.31641h-.07031l-.92676,3.31641h-.91309l-1.24121-4.50293h.90137l.80664,3.436h.06641l.92578-3.436h.85254l.92578,3.436h.07031l.80273-3.436h.88867Z"/><path d="M53.85354,10.19482H54.709v.71533h.06641a1.348,1.348,0,0,1,1.34375-.80225,1.46456,1.46456,0,0,1,1.55859,1.6748v2.915h-.88867V12.00586c0-.72363-.31445-1.0835-.97168-1.0835a1.03294,1.03294,0,0,0-1.0752,1.14111v2.63428h-.88867Z"/><path d="M59.09377,8.437h.88867v6.26074h-.88867Z"/><path d="M61.21779,12.44434a2.13346,2.13346,0,1,1,4.24756,0,2.1338,2.1338,0,1,1-4.24756,0Zm3.333,0c0-.97607-.43848-1.54687-1.208-1.54687-.77246,0-1.207.5708-1.207,1.54688,0,.98389.43457,1.55029,1.207,1.55029C64.11232,13.99463,64.5508,13.42432,64.5508,12.44434Z"/><path d="M66.4009,13.42432c0-.81055.60352-1.27783,1.6748-1.34424l1.21973-.07031v-.38867c0-.47559-.31445-.74414-.92187-.74414-.49609,0-.83984.18213-.93848.50049h-.86035c.09082-.77344.81836-1.26953,1.83984-1.26953,1.12891,0,1.76563.562,1.76563,1.51318v3.07666h-.85547v-.63281h-.07031a1.515,1.515,0,0,1-1.35254.707A1.36026,1.36026,0,0,1,66.4009,13.42432Zm2.89453-.38477v-.37646l-1.09961.07031c-.62012.0415-.90137.25244-.90137.64941,0,.40527.35156.64111.835.64111A1.0615,1.0615,0,0,0,69.29543,13.03955Z"/><path d="M71.34816,12.44434c0-1.42285.73145-2.32422,1.86914-2.32422a1.484,1.484,0,0,1,1.38086.79h.06641V8.437h.88867v6.26074h-.85156v-.71143h-.07031a1.56284,1.56284,0,0,1-1.41406.78564C72.0718,14.772,71.34816,13.87061,71.34816,12.44434Zm.918,0c0,.95508.4502,1.52979,1.20313,1.52979.749,0,1.21191-.583,1.21191-1.52588,0-.93848-.46777-1.52979-1.21191-1.52979C72.72121,10.91846,72.26613,11.49707,72.26613,12.44434Z"/><path d="M79.23,12.44434a2.13323,2.13323,0,1,1,4.24707,0,2.13358,2.13358,0,1,1-4.24707,0Zm3.333,0c0-.97607-.43848-1.54687-1.208-1.54687-.77246,0-1.207.5708-1.207,1.54688,0,.98389.43457,1.55029,1.207,1.55029C82.12453,13.99463,82.563,13.42432,82.563,12.44434Z"/><path d="M84.66945,10.19482h.85547v.71533h.06641a1.348,1.348,0,0,1,1.34375-.80225,1.46456,1.46456,0,0,1,1.55859,1.6748v2.915H87.605V12.00586c0-.72363-.31445-1.0835-.97168-1.0835a1.03294,1.03294,0,0,0-1.0752,1.14111v2.63428h-.88867Z"/><path d="M93.51516,9.07373v1.1416h.97559v.74854h-.97559V13.2793c0,.47168.19434.67822.63672.67822a2.96657,2.96657,0,0,0,.33887-.02051v.74023a2.9155,2.9155,0,0,1-.4834.04541c-.98828,0-1.38184-.34766-1.38184-1.21582v-2.543h-.71484v-.74854h.71484V9.07373Z"/><path d="M95.70461,8.437h.88086v2.48145h.07031a1.3856,1.3856,0,0,1,1.373-.80664,1.48339,1.48339,0,0,1,1.55078,1.67871v2.90723H98.69v-2.688c0-.71924-.335-1.0835-.96289-1.0835a1.05194,1.05194,0,0,0-1.13379,1.1416v2.62988h-.88867Z"/><path d="M104.76125,13.48193a1.828,1.828,0,0,1-1.95117,1.30273A2.04531,2.04531,0,0,1,100.73,12.46045a2.07685,2.07685,0,0,1,2.07617-2.35254c1.25293,0,2.00879.856,2.00879,2.27V12.688h-3.17969v.0498a1.1902,1.1902,0,0,0,1.19922,1.29,1.07934,1.07934,0,0,0,1.07129-.5459Zm-3.126-1.45117h2.27441a1.08647,1.08647,0,0,0-1.1084-1.1665A1.15162,1.15162,0,0,0,101.63527,12.03076Z"/></g></g></g></svg>';
// Placeholder too — only rendered once PLAY_STORE_LIVE is true.
const GOOGLE_BADGE_SVG =
  '<svg class="badge-art badge-art--light" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 135 40" role="img" aria-hidden="true"><rect width="135" height="40" rx="8" fill="#000"/><text x="67" y="16" fill="#fff" font-size="7" text-anchor="middle" font-family="Roboto,Arial,sans-serif">GET IT ON</text><text x="67" y="30" fill="#fff" font-size="13" font-weight="600" text-anchor="middle" font-family="Roboto,Arial,sans-serif">Google Play</text></svg>' +
  '<svg class="badge-art badge-art--dark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 135 40" role="img" aria-hidden="true"><rect width="135" height="40" rx="8" fill="#fff" stroke="#a3a3a3" stroke-width="1"/><text x="67" y="16" fill="#000" font-size="7" text-anchor="middle" font-family="Roboto,Arial,sans-serif">GET IT ON</text><text x="67" y="30" fill="#000" font-size="13" font-weight="600" text-anchor="middle" font-family="Roboto,Arial,sans-serif">Google Play</text></svg>';

type StoreTarget = "ios" | "android" | "both";

// Web-only platform sniff. Capacitor.getPlatform() is undefined off-native, so
// on the web we read the userAgent. Only consulted once both stores are live;
// while Google Play is dark we show the Apple badge everywhere instead.
function detectWebStore(): StoreTarget {
  const ua = navigator.userAgent || "";
  const iPadOSDesktop = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/iPad|iPhone|iPod/.test(ua) || iPadOSDesktop) return "ios";
  if (/Android/.test(ua)) return "android";
  return "both";
}

function buildStoreBadge(store: "ios" | "android"): HTMLAnchorElement {
  const a = document.createElement("a");
  a.className = `app-store-badge app-store-badge--${store}`;
  a.href = store === "ios" ? APP_STORE_URL : PLAY_STORE_URL;
  a.target = "_blank";
  a.rel = "noopener";
  a.setAttribute(
    "aria-label",
    store === "ios" ? "Download Cafelytic on the App Store" : "Get Cafelytic on Google Play",
  );
  // Trusted, hardcoded official badge markup (no dynamic/user text enters the
  // string), so this innerHTML carries no injection risk and needs no escaping.
  a.innerHTML = store === "ios" ? APPLE_BADGE_SVG : GOOGLE_BADGE_SVG;
  return a;
}

function injectAppStoreCallout(): void {
  if (isNativeApp()) return; // already have the app in-app
  const footer = document.querySelector("footer");
  if (!footer) return; // every page ships one; defensive
  if (footer.querySelector(".app-store-callout")) return; // idempotent

  // Only the App Store is live today, so show the Apple badge to all web
  // visitors. Once PLAY_STORE_LIVE flips true, target per platform instead.
  let showApple = true;
  let showPlay = false;
  if (PLAY_STORE_LIVE) {
    const target = detectWebStore();
    showApple = target === "ios" || target === "both";
    showPlay = target === "android" || target === "both";
  }
  if (!showApple && !showPlay) return;

  const wrap = document.createElement("div");
  wrap.className = "app-store-callout";

  const label = document.createElement("p");
  label.className = "app-store-callout__label";
  label.textContent = "Get the Cafelytic app";
  wrap.appendChild(label);

  const badges = document.createElement("div");
  badges.className = "app-store-callout__badges";
  if (showApple) badges.appendChild(buildStoreBadge("ios"));
  if (showPlay) badges.appendChild(buildStoreBadge("android"));
  wrap.appendChild(badges);

  footer.appendChild(wrap);
}

// --- Run shared UI setup on load ---
document.addEventListener("DOMContentLoaded", () => {
  injectNav();
  // Native (Capacitor) only: add the bottom tab bar + More sheet, and flag the
  // body so CSS slims the top nav to a brand-only strip. Web is unchanged.
  if (isNativeApp()) {
    document.body.classList.add("is-capacitor");
    const platform = (
      window as { Capacitor?: { getPlatform?: () => string } }
    ).Capacitor?.getPlatform?.();
    if (platform === "ios") document.body.classList.add("platform-ios");
    injectBottomNav();
  }
  applyMineralDisplayMode();
  initThemeListeners();
  initSaveStatusIndicator();
  // Settings page only: reveal + wire the "Delete account" section for
  // signed-in users (no-ops on every other page).
  mountDeleteAccountSetting();
  showAccountDeletedFlashIfPending();
  injectAppStoreCallout();
});
