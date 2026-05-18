// ============================================
// UI Shared — DOM helpers and shared UI logic
// ============================================

// --- Non-negative number input reader ---
function readNonNegative(el) {
  return Math.max(0, parseFloat(el.value) || 0);
}

// --- Visible ion fields based on display mode ---
function getVisibleIonFields() {
  if (isAdvancedMineralDisplayMode()) {
    return ["calcium", "magnesium", "potassium", "sodium", "sulfate", "chloride"];
  }
  return ["calcium", "magnesium"];
}

function applyMineralDisplayMode() {
  const body = document.body;
  if (!body) return;
  const advanced = isAdvancedMineralDisplayMode();
  body.classList.toggle("advanced-minerals", advanced);
  body.classList.toggle("standard-minerals", !advanced);
}

// --- Status handler ---
function createStatusHandler(statusEl, options = {}) {
  const successMs = options.successMs || 1500;
  const errorMs = options.errorMs || 3000;
  let timer = null;
  return function showStatus(message, isError) {
    if (!statusEl) return;
    clearTimeout(timer);
    statusEl.textContent = message;
    statusEl.classList.toggle("error", isError);
    statusEl.classList.add("visible");
    timer = setTimeout(() => {
      statusEl.classList.remove("visible", "error");
    }, isError ? errorMs : successMs);
  };
}

// --- Enter key binding ---
function bindEnterToClick(inputEl, buttonEl) {
  if (!inputEl || !buttonEl) return;
  inputEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    buttonEl.click();
  });
}

// --- Source preset select initialization ---
function initSourcePresetSelect(selectEl) {
  if (!selectEl) return null;
  selectEl.innerHTML = "";
  const presetEntries = Object.entries(getAllPresets()).filter(([key]) => key !== "custom");
  for (const [key, preset] of presetEntries) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = preset.label;
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
function renderSourceWaterTags(tagsEl, water) {
  if (!tagsEl) return;
  tagsEl.innerHTML = "";
  const allZeros = ION_FIELDS.every(function(ion) {
    const value = Number(water && water[ion]);
    return !Number.isFinite(value) || value === 0;
  });
  if (allZeros) {
    const zeroTag = document.createElement("span");
    zeroTag.className = "base-tag";
    zeroTag.textContent = "All zeros";
    tagsEl.appendChild(zeroTag);
    return;
  }
  const nonZero = getVisibleIonFields().filter(function(ion) { return (water && water[ion]) > 0; });
  const metrics = water ? calculateMetrics(water) : { kh: 0 };
  const alk = metrics.kh;
  const alkRounded = (alk == null || alk !== alk) ? 0 : Math.round(alk);

  if (nonZero.length === 0) {
    const tag = document.createElement("span");
    tag.className = "base-tag";
    tag.textContent = "All zeros";
    tagsEl.appendChild(tag);
    if (alkRounded !== 0) {
      const alkTag = document.createElement("span");
      alkTag.className = "base-tag";
      alkTag.textContent = "Alkalinity: " + alkRounded + " mg/L as CaCO\u2083";
      tagsEl.appendChild(alkTag);
    }
    return;
  }
  nonZero.forEach(function(ion) {
    const tag = document.createElement("span");
    tag.className = "base-tag";
    tag.textContent = ION_LABELS[ion] + ": " + Number(water[ion]) + " mg/L";
    tagsEl.appendChild(tag);
  });
  const alkTag = document.createElement("span");
  alkTag.className = "base-tag";
  alkTag.textContent = "Alkalinity: " + alkRounded + " mg/L as CaCO\u2083";
  tagsEl.appendChild(alkTag);
}

// --- Confirmation modal (Bug 2: prevent stacking, Bug 3 fix: focus trap + ARIA) ---
let confirmCleanup = null;
function showConfirm(message, onYes) {
  if (confirmCleanup) confirmCleanup();

  const overlay = document.getElementById("confirm-overlay");
  const dialog = overlay.querySelector(".confirm-dialog");
  const msgEl = document.getElementById("confirm-message");
  const yesBtn = document.getElementById("confirm-yes");
  const noBtn = document.getElementById("confirm-no");
  const previousFocus = document.activeElement;

  // ARIA attributes
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "confirm-message");

  msgEl.textContent = message;
  overlay.style.display = "flex";
  yesBtn.focus();

  function close() {
    overlay.style.display = "none";
    yesBtn.removeEventListener("click", yesHandler);
    noBtn.removeEventListener("click", noHandler);
    document.removeEventListener("keydown", keyHandler);
    overlay.removeEventListener("click", overlayClickHandler);
    confirmCleanup = null;
    if (previousFocus && previousFocus.focus) {
      previousFocus.focus();
    }
  }
  function yesHandler() { close(); onYes(); }
  function noHandler() { close(); }
  function keyHandler(e) {
    if (e.key === "Escape") { noHandler(); return; }
    if (e.key === "Tab") {
      const focusable = [yesBtn, noBtn];
      const idx = focusable.indexOf(document.activeElement);
      if (e.shiftKey) {
        e.preventDefault();
        focusable[(idx <= 0 ? focusable.length : idx) - 1].focus();
      } else {
        e.preventDefault();
        focusable[(idx + 1) % focusable.length].focus();
      }
    }
  }
  function overlayClickHandler(e) { if (e.target === overlay) noHandler(); }

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
function primeCurrentUserId() {
  if (window._authStateResolved) return Promise.resolve(window._cachedAuthUserId);
  return new Promise(function (resolve) {
    document.addEventListener("cw:auth-state-resolved", function onResolved() {
      document.removeEventListener("cw:auth-state-resolved", onResolved);
      resolve(window._cachedAuthUserId);
    });
  });
}

function getCurrentUserIdSync() {
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
function isUserTheCreator(profile) {
  if (!profile) return false;
  if (!("creatorUserId" in profile) || profile.creatorUserId === undefined) return true;
  var currentId = getCurrentUserIdSync();
  if (!currentId) return false;
  return profile.creatorUserId === currentId;
}

window.primeCurrentUserId = primeCurrentUserId;
window.getCurrentUserIdSync = getCurrentUserIdSync;
window.isUserTheCreator = isUserTheCreator;

// --- Auth gate for save affordances ---
// Visually locks an element when the user is anonymous and intercepts the
// click (capture phase) to open the login modal instead of running the
// existing save handler.  Aria-disabled is used rather than `disabled` so
// the click event reaches our handler; bubble-phase listeners are stopped
// via stopImmediatePropagation.  Listens to cw:auth-changed and
// cw:auth-state-resolved so a sign-in mid-page unlocks affordances without
// requiring a navigation.
function applyAuthGate(el, opts) {
  if (!el) return;
  opts = opts || {};
  var reason = opts.reason || "save";

  function gateClickHandler(ev) {
    if (typeof window.isLoggedInSync === "function" && window.isLoggedInSync()) return;
    ev.preventDefault();
    if (typeof ev.stopImmediatePropagation === "function") ev.stopImmediatePropagation();
    else if (typeof ev.stopPropagation === "function") ev.stopPropagation();
    if (typeof window.openLoginModal === "function") {
      window.openLoginModal({ reason: reason });
    }
  }

  function update() {
    var loggedIn = typeof window.isLoggedInSync === "function" && window.isLoggedInSync();
    if (loggedIn) {
      el.classList.remove("auth-locked");
      el.removeAttribute("aria-disabled");
    } else {
      el.classList.add("auth-locked");
      el.setAttribute("aria-disabled", "true");
      if (!el.dataset.authGateBound) {
        el.addEventListener("click", gateClickHandler, true);
        el.dataset.authGateBound = "1";
      }
    }
  }

  update();
  document.addEventListener("cw:auth-changed", update);
  document.addEventListener("cw:auth-state-resolved", update);
}
window.applyAuthGate = applyAuthGate;

// --- Share to Recipe Library prompt (post-save dialog) ---
var sharePromptCleanup = null;

async function showSharePrompt(profileKey) {
  // Only show if logged in
  if (typeof isLoggedIn !== "function" || !(await isLoggedIn())) return;

  var overlay = document.getElementById("share-prompt-overlay");
  if (!overlay) return;

  if (sharePromptCleanup) sharePromptCleanup();

  var titleEl = document.getElementById("share-prompt-title");
  var hintEl = document.getElementById("share-prompt-hint");
  var nameGroup = document.getElementById("share-prompt-name-group");
  var nameInput = document.getElementById("share-prompt-display-name");
  var yesBtn = document.getElementById("share-prompt-yes");
  var noBtn = document.getElementById("share-prompt-no");
  var previousFocus = document.activeElement;

  // Tailor the wording: first-time share vs updating an already-public recipe.
  var profiles = loadCustomTargetProfiles();
  var thisProfile = profiles[profileKey];
  var isUpdating = !!(thisProfile && thisProfile.isPublic);
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
  var existingName = loadCreatorDisplayName();
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
    overlay.style.display = "none";
    yesBtn.removeEventListener("click", yesHandler);
    noBtn.removeEventListener("click", noHandler);
    document.removeEventListener("keydown", keyHandler);
    overlay.removeEventListener("click", overlayClickHandler);
    sharePromptCleanup = null;
    if (previousFocus && previousFocus.focus) previousFocus.focus();
  }

  function yesHandler() {
    var displayName = existingName || (nameInput.value || "").trim();
    if (!displayName) {
      nameInput.focus();
      return;
    }
    if (!existingName) saveCreatorDisplayName(displayName);

    // Update the saved profile with public fields
    var profiles = loadCustomTargetProfiles();
    if (profiles[profileKey]) {
      profiles[profileKey].isPublic = true;
      profiles[profileKey].creatorDisplayName = displayName;
      profiles[profileKey].tags = profiles[profileKey].tags || [];
      saveCustomTargetProfiles(profiles);
    }

    // Also update directly in Supabase so it takes effect immediately
    if (typeof window.supabaseClient !== "undefined") {
      window.supabaseClient.auth.getUser().then(function (res) {
        var user = res && res.data && res.data.user;
        if (!user) return;
        window.supabaseClient
          .from("target_profiles")
          .update({
            is_public: true,
            creator_display_name: displayName,
            tags: profiles[profileKey] ? profiles[profileKey].tags : []
          })
          .eq("user_id", user.id)
          .eq("slug", profileKey)
          .then(function (result) {
            if (result.error) {
              console.warn("[share] direct update failed:", result.error);
              return;
            }
            // Invalidate the library cache so the freshly-published recipe
            // shows up in library.html without a full reload. Fallthrough
            // from the Wave D cut-over — before this, library.html only
            // saw new publishes after an invalidate-via-pageload.
            if (typeof window.invalidatePublicRecipesCache === "function") {
              window.invalidatePublicRecipesCache();
            }
          });
      });
    }

    close();
  }

  function noHandler() { close(); }

  function keyHandler(e) {
    if (e.key === "Escape") { noHandler(); return; }
    if (e.key === "Enter" && document.activeElement === nameInput) { yesHandler(); return; }
    if (e.key === "Tab") {
      var focusable = [nameInput, yesBtn, noBtn].filter(function(el) {
        return el.offsetParent !== null;
      });
      var idx = focusable.indexOf(document.activeElement);
      if (e.shiftKey) {
        e.preventDefault();
        focusable[(idx <= 0 ? focusable.length : idx) - 1].focus();
      } else {
        e.preventDefault();
        focusable[(idx + 1) % focusable.length].focus();
      }
    }
  }

  function overlayClickHandler(e) { if (e.target === overlay) noHandler(); }

  sharePromptCleanup = close;
  yesBtn.addEventListener("click", yesHandler);
  noBtn.addEventListener("click", noHandler);
  document.addEventListener("keydown", keyHandler);
  overlay.addEventListener("click", overlayClickHandler);
}

// --- Delta formatting ---
function roundDelta(delta, decimals = 0) {
  if (!Number.isFinite(delta)) return null;
  if (decimals > 0) {
    const p = Math.pow(10, decimals);
    const rounded = Math.round(delta * p) / p;
    return Object.is(rounded, -0) ? 0 : rounded;
  }
  const rounded = Math.round(delta);
  return Object.is(rounded, -0) ? 0 : rounded;
}

function formatDelta(delta, decimals = 0) {
  const rounded = roundDelta(delta, decimals);
  if (rounded == null) return "-";
  const abs = decimals > 0 ? Math.abs(rounded).toFixed(decimals) : String(Math.abs(rounded));
  if (rounded > 0) return "+" + abs;
  if (rounded < 0) return "-" + abs;
  return decimals > 0 ? Number(0).toFixed(decimals) : "0";
}

function setDeltaText(el, delta, options = {}) {
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
    el.setAttribute("aria-label", `${metricName} increased by ${Math.abs(rounded)}${unit} compared to ${baselineLabel}`);
    return;
  }
  if (rounded < 0) {
    el.classList.add("negative");
    el.setAttribute("aria-label", `${metricName} decreased by ${Math.abs(rounded)}${unit} compared to ${baselineLabel}`);
    return;
  }
  el.setAttribute("aria-label", `${metricName} unchanged compared to ${baselineLabel}`);
}

// --- Range guidance rendering ---
function renderRangeGuidance(el, findings) {
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
function getResolvedTheme() {
  const pref = loadThemePreference();
  if (pref === "light") return "light";
  if (pref === "dark") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", getResolvedTheme());
}

function initThemeListeners() {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => {
    if (loadThemePreference() === "system") applyTheme();
  });
}

// --- Navigation ---
function injectNav() {
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  const navItems = [
    { type: "group", label: "Tools", children: [
      { href: "index.html",  label: "Calculator" },
      { href: "recipe.html", label: "Recipe Builder" },
      { href: "taste.html",  label: "Taste Tuner" }
    ]},
    { type: "link", href: "library.html",  label: "Library" },
    { type: "link", href: "start.html",    label: "Beginners Guide" },
    { type: "link", href: "minerals.html", label: "Settings" }
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
    '</svg>' +
    '<span class="nav-brand-wordmark"><span class="brand-cafe">cafe</span><span class="brand-lytic">lytic</span></span>';
  nav.appendChild(brand);

  // Hamburger toggle (mobile only, hidden on desktop via CSS)
  const hamburger = document.createElement("button");
  hamburger.type = "button";
  hamburger.className = "nav-hamburger";
  hamburger.setAttribute("aria-label", "Toggle menu");
  hamburger.setAttribute("aria-expanded", "false");
  hamburger.innerHTML = '<span></span><span></span><span></span>';
  nav.appendChild(hamburger);

  // Nav links
  const linksWrap = document.createElement("div");
  linksWrap.className = "nav-links";
  navItems.forEach(item => {
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
    var expanded = nav.classList.toggle("nav-open");
    hamburger.setAttribute("aria-expanded", String(expanded));
  });

  // Close menu when a link is clicked
  linksWrap.addEventListener("click", function (e) {
    if (e.target.tagName === "A") {
      nav.classList.remove("nav-open");
      hamburger.setAttribute("aria-expanded", "false");
    }
  });

  _updateNavAuth(authWrap, currentPage);
}

async function _updateNavAuth(authWrap, currentPage) {
  if (typeof window.supabaseClient === "undefined") return;
  try {
    const { data } = await window.supabaseClient.auth.getSession();
    const session = data && data.session;

    if (session && session.user) {
      const email = document.createElement("span");
      email.className = "nav-auth-email";
      email.textContent = session.user.email;

      const logoutBtn = document.createElement("button");
      logoutBtn.type = "button";
      logoutBtn.className = "nav-auth-btn";
      logoutBtn.textContent = "Log out";
      logoutBtn.addEventListener("click", async () => {
        // Order matters to avoid the data-loss class of bug:
        //   1. flush any debounced edit to cloud while the session still exists
        //   2. sign out (Supabase clears the session, fires SIGNED_OUT)
        //   3. wipe local user content (Categories A/B/C; D preserved)
        //   4. navigate to a clean page
        if (typeof window.flushPendingSync === "function") {
          try { await window.flushPendingSync(); } catch (_) {}
        }
        // If signOut() throws (network blip, transient Supabase error), the
        // auth token survives — wiping local state and redirecting in that
        // case would leave the next page load authenticated, which defeats
        // the purpose of logout. Bail loudly instead.
        try {
          await signOut();
        } catch (err) {
          console.warn("[auth] signOut failed:", err);
          return;
        }
        if (typeof window.clearLocalUserContent === "function") {
          window.clearLocalUserContent();
        }
        window.location.href = "index.html";
      });

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

function _buildNavGroup(group, currentPage) {
  const isCurrentInGroup = group.children.some(c => c.href === currentPage);

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

  group.children.forEach(c => {
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

function _wireNavGroupBehavior(wrap, trigger, menu) {
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
    if (!wrap.contains(e.target)) close();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && wrap.classList.contains("is-open")) {
      close();
      trigger.focus();
    }
  });
}

// --- Shared restore bar helpers ---
function updateRestoreSourceBar() {
  const el = document.getElementById("restore-source-bar");
  if (!el) return;
  el.style.display = loadDeletedPresets().length > 0 ? "flex" : "none";
}

function findFallbackPreset(allPresets) {
  const keys = Object.keys(allPresets);
  return keys.find(function(k) { return k !== "custom" && k !== "library"; }) || "custom";
}

// --- Safe radio selection (Bug 6) ---
function selectRadioByValue(name, value) {
  const radios = document.querySelectorAll('input[name="' + CSS.escape(name) + '"]');
  radios.forEach(function(el) { if (el.value === value) el.checked = true; });
}

// --- Debounce helper (Inefficiency 6) ---
function debounce(fn, ms) {
  let timer;
  return function() {
    const context = this, args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function() { fn.apply(context, args); }, ms);
  };
}

// --- Recipes-moved toaster (one-time, all pages) ---
function showRecipesToaster() {
  if (loadRecipesToasterDismissed()) return;

  var toaster = document.createElement("div");
  toaster.className = "recipes-toaster";
  toaster.setAttribute("role", "status");

  var link = document.createElement("a");
  link.href = "library.html";
  link.className = "recipes-toaster-link";
  link.textContent = "Recipes have moved to the new library section. Check it out!";
  toaster.appendChild(link);

  var closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "recipes-toaster-close";
  closeBtn.setAttribute("aria-label", "Dismiss notification");
  closeBtn.textContent = "\u00d7";
  toaster.appendChild(closeBtn);

  function dismiss(e) {
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

// --- Run shared UI setup on load ---
document.addEventListener("DOMContentLoaded", () => {
  injectNav();
  applyMineralDisplayMode();
  initThemeListeners();
  showRecipesToaster();
});
