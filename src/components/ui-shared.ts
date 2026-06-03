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
  loadRecipesToasterDismissed,
  saveRecipesToasterDismissed,
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
  if (input) {
    input.focus();
  } else {
    yesBtn.focus();
  }

  function close() {
    overlay.style.display = "none";
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
  if (!existingName) {
    nameInput.focus();
  } else {
    yesBtn.focus();
  }

  function close() {
    overlay!.style.display = "none";
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
    | { type: "link"; href: string; label: string }
  > = [
    {
      type: "group",
      label: "Tools",
      children: [
        { href: "index.html", label: "Calculator" },
        { href: "recipe.html", label: "Recipe Builder" },
        { href: "taste.html", label: "Taste Tuner" },
      ],
    },
    { type: "link", href: "library.html", label: "Library" },
    { type: "link", href: "start.html", label: "Beginners Guide" },
    { type: "link", href: "minerals.html", label: "Settings" },
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
  navItems.forEach((item) => {
    if (item.type === "group") {
      const built = _buildNavGroup(item, currentPage);
      linksWrap.appendChild(built.wrap);
      _wireNavGroupBehavior(built.wrap, built.trigger, built.menu);
    } else {
      const a = document.createElement("a");
      a.href = item.href;
      a.textContent = item.label;
      if (currentPage === item.href) a.className = "active";
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
  const SHEET_PAGES = ["minerals.html", "start.html", "login.html"];
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

// --- Recipes-moved toaster (one-time, all pages) ---
export function showRecipesToaster(): void {
  if (loadRecipesToasterDismissed()) return;

  const toaster = document.createElement("div");
  toaster.className = "recipes-toaster";
  toaster.setAttribute("role", "status");

  const link = document.createElement("a");
  link.href = "library.html";
  link.className = "recipes-toaster-link";
  link.textContent = "Recipes have moved to the new library section. Check it out!";
  toaster.appendChild(link);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "recipes-toaster-close";
  closeBtn.setAttribute("aria-label", "Dismiss notification");
  closeBtn.textContent = "×";
  toaster.appendChild(closeBtn);

  function dismiss(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    saveRecipesToasterDismissed();
    toaster.classList.add("recipes-toaster--hiding");
    toaster.addEventListener("animationend", function () {
      toaster.remove();
    });
  }

  closeBtn.addEventListener("click", dismiss);

  document.body.appendChild(toaster);
  // Trigger entrance animation on next frame
  requestAnimationFrame(function () {
    toaster.classList.add("recipes-toaster--visible");
  });
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
    showRecipesToaster,
    initSaveStatusIndicator,
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
  showRecipesToaster();
  initSaveStatusIndicator();
  // Settings page only: reveal + wire the "Delete account" section for
  // signed-in users (no-ops on every other page).
  mountDeleteAccountSetting();
  showAccountDeletedFlashIfPending();
});
