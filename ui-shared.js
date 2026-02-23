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
  if (rounded == null) return "\u2014";
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
  if (!Array.isArray(findings) || findings.length === 0) return;
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
  const pages = [
    { href: "index.html",    label: "Calculator" },
    { href: "recipe.html",   label: "Recipe Builder" },
    { href: "taste.html",    label: "Taste Tuner" },
    { href: "minerals.html", label: "Settings" }
  ];

  const nav = document.createElement("nav");
  nav.className = "site-nav";
  pages.forEach(p => {
    const a = document.createElement("a");
    a.href = p.href;
    a.textContent = p.label;
    if (currentPage === p.href) a.className = "active";
    nav.appendChild(a);
  });

  document.body.insertBefore(nav, document.body.firstChild);
}

// --- Shared restore bar helpers (Inconsistency 7) ---
function updateRestoreTargetBar() {
  const el = document.getElementById("restore-target-bar");
  if (!el) return;
  el.style.display = loadDeletedTargetPresets().length > 0 ? "flex" : "none";
}

function updateRestoreSourceBar() {
  const el = document.getElementById("restore-source-bar");
  if (!el) return;
  el.style.display = loadDeletedPresets().length > 0 ? "flex" : "none";
}

function findFallbackPreset(allPresets) {
  const keys = Object.keys(allPresets);
  return keys.find(function(k) { return k !== "custom"; }) || "custom";
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

// --- Run shared UI setup on load ---
document.addEventListener("DOMContentLoaded", () => {
  injectNav();
  applyMineralDisplayMode();
  initThemeListeners();
});
