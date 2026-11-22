// ============================================
// Coffee Water Chemistry Calculator
// ============================================
//
// Phase A: converted from script.js (the index.html calculator orchestrator).
// Unlike the other migrated UI files, this one is NOT imported by
// legacy-globals.ts — only index.html hosts the calculator, so it stays its
// own module entry (`<script type="module" src="/src/components/script.ts">`).
// Storage, constants, metrics, and ui-shared helpers are imported directly;
// the cross-module bridge (showLibraryPicker, recipeMatches, cwHaptic,
// formatStockSpec, init{Source,Estimate}…) is reached via window.* / the
// migrated modules with the same guards as the original.
// ============================================

import {
  MINERAL_DB,
  BRAND_CONCENTRATES,
  GALLONS_TO_LITERS,
  NON_EDITABLE_TARGET_KEYS,
  LIBRARY_TAGS,
  ION_FIELDS,
} from "../lib/constants";
import {
  calculateMetrics,
  displayedDrops,
  calculateSo4ClRatio,
  evaluateWaterProfileRanges,
  buildStoredTargetProfile,
} from "../lib/metrics";
import { computeDoses } from "../lib/dosing";
import type { DosingKit, DosingResult, DosingTarget } from "../lib/dosing";
import { buildSlimRecipeCard } from "./recipe-card";
import {
  bindEnterToClick,
  createStatusHandler,
  debounce,
  findFallbackPreset,
  maybeOfferSharePrompt,
  onStorageKeysChanged,
  renderRangeGuidance,
  setDeltaText,
  showConfirm,
} from "./ui-shared";
import {
  clearTargetDraftIons,
  deleteCustomTargetProfile,
  getActiveStockSpecs,
  getEffectiveAlkalinitySources,
  getEffectiveCalciumSources,
  getEffectiveMagnesiumSources,
  loadBrewMethod,
  getAllPresets,
  getConcentrateGramsPerMl,
  getConcentrateMineralId,
  getConcentrateDropMl,
  getTargetPresetsForBrewMethod,
  getTargetProfileByKey,
  isAdvancedMineralDisplayMode,
  loadCustomTargetProfiles,
  loadLotusConcentrateUnitFor,
  loadSelectedMinerals,
  loadTargetDraftIonsFor,
  loadTargetPresetName,
  loadValidSelectedConcentrates,
  loadVolumePreference,
  normalizeLotusConcentrateUnit,
  saveBrewMethod,
  saveCustomTargetProfiles,
  saveLotusConcentrateUnitFor,
  saveSelectedMinerals,
  saveTargetDraftIons,
  saveTargetPresetName,
  saveVolumePreference,
  validateTargetProfileName,
} from "../lib/storage";
import type { StockConcentrateSpec } from "../lib/storage";

// The Recipe Concentrate spec shape storage hands back from getActiveStockSpecs.
type StockSpec = StockConcentrateSpec;

// All DOM access + orchestration runs inside main(), invoked on DOMContentLoaded
// (see the bottom of the file). DOMContentLoaded also guarantees the DOM ids
// this file queries exist. (The classic script.js was a body `defer` script;
// recipe.html / taste.html wrap their inline orchestration the same way.)
function main(): void {
  // --- State ---
  // Load brew method first so loadTargetPresetName() can pick the
  // mode-appropriate default (cafelytic-filter vs cafelytic-espresso) for new
  // users. Returning users' saved preset still wins regardless of mode.
  let activeBrewMethod = loadBrewMethod();
  let currentProfile = loadTargetPresetName(activeBrewMethod);

  // --- DOM elements ---
  const volumeInput = document.getElementById("volume") as HTMLInputElement;
  const volumeUnit = document.getElementById("volume-unit") as HTMLSelectElement;
  const targetCa = document.getElementById("target-calcium") as HTMLInputElement;
  const targetMg = document.getElementById("target-magnesium") as HTMLInputElement;
  const targetAlk = document.getElementById("target-alkalinity") as HTMLInputElement;
  const targetK = document.getElementById("target-potassium") as HTMLInputElement;
  const targetNa = document.getElementById("target-sodium") as HTMLInputElement;
  const targetSO4 = document.getElementById("target-sulfate") as HTMLInputElement;
  const targetCl = document.getElementById("target-chloride") as HTMLInputElement;
  const targetHCO3 = document.getElementById("target-bicarbonate") as HTMLInputElement;
  const profileDesc = document.getElementById("profile-description") as HTMLElement;
  const resultsContainer = document.getElementById("results-container") as HTMLElement;
  const profileButtonsContainer = document.getElementById("profile-buttons") as HTMLElement;
  const brewMethodToggle = document.getElementById("brew-method-toggle");
  const targetSaveBar = document.getElementById("target-save-bar") as HTMLElement;
  const targetEditBar = document.getElementById("target-edit-bar") as HTMLElement;
  const targetEditModeBtn = document.getElementById("target-edit-mode-btn");
  const targetReadonlyTags = document.getElementById("target-readonly-tags");
  const targetProfileNameInput = document.getElementById("target-profile-name") as HTMLInputElement;
  const targetSaveBtn = document.getElementById("target-save-btn") as HTMLButtonElement;
  const targetSaveChangesBtn = document.getElementById(
    "target-save-changes-btn",
  ) as HTMLButtonElement;
  const targetSaveStatus = document.getElementById("target-save-status");

  // Gate the named-target-profile save affordances when the user is anonymous.
  // Capture-phase click handler intercepts before the bubble-phase save logic
  // below ever fires, so no localStorage write happens off the locked button.
  if (typeof window.applyAuthGate === "function") {
    // Edit mode exposes delete affordances and the "Done Editing" path that
    // auto-saves dirty changes through persistTargetProfileEdits(); gate the
    // toggle so anonymous users see the modal instead of an opaque
    // "Storage full" error from the silent _setGated no-op.
    if (targetEditModeBtn) window.applyAuthGate(targetEditModeBtn, { reason: "save-recipe" });
    if (targetSaveBtn) window.applyAuthGate(targetSaveBtn, { reason: "save-recipe" });
    if (targetSaveChangesBtn) window.applyAuthGate(targetSaveChangesBtn, { reason: "save-recipe" });
  }

  // Retained verbatim from script.js: assigned on every calculate() pass but
  // never read (write-only in the original too). Kept as-is for this mechanical
  // port rather than dropped; eslint would otherwise flag the unused binding.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let lastCalculatedIons: Record<string, number> | null = null;
  let isTargetEditMode = false;

  // --- Debounced calculate (Inefficiency 6) ---
  const debouncedCalculate = debounce(calculate, 120);

  const savedVolume = loadVolumePreference("calculator", {
    value: volumeInput.value,
    unit: volumeUnit.value,
  });
  volumeInput.value = savedVolume.value;
  volumeUnit.value = savedVolume.unit;

  // --- Source water section (shared module) ---
  function updateSourceHintLabel(presetName: string): void {
    const resultsHint = document.getElementById("results-hint");
    if (resultsHint) {
      const preset = getAllPresets()[presetName];
      const name = preset ? preset.label : "your water";
      resultsHint.textContent = "Using " + name + " as your base, add these mineral salts:";
    }
  }

  const sourceSection = window.initSourceWaterSection!({
    onChanged: calculate,
    onActivated: updateSourceHintLabel,
  });

  if (typeof window.initEstimateWaterUI === "function") {
    window.initEstimateWaterUI();
  }

  // --- Result items: show only minerals selected in Settings ---

  interface ShowItem {
    kind: "stock" | "mineral" | "concentrate";
    id: string;
    label?: string;
    spec?: StockSpec;
    mineralId?: string;
    order: number;
  }

  function renderResultItems(): void {
    const alkalinitySources = getEffectiveAlkalinitySources();
    if (alkalinitySources.length === 0) {
      resultsContainer.innerHTML =
        '<p class="hint error">You need to select an alkalinity source in <a href="minerals.html">Settings</a></p>';
      lastCalculatedIons = null;
      updateSummaryMetrics({});
      return;
    }

    const selectedMinerals = loadSelectedMinerals();
    const selectedConcentrates = loadValidSelectedConcentrates();

    // Active Recipe Concentrates: each dispenses a fixed-ratio multi-mineral mix
    // at its prescribed dose. When any are enabled, the calculator suppresses
    // per-mineral / single-mineral concentrate rows and shows one row per
    // enabled concentrate; their ion contributions are summed.
    const activeStockEntries = getActiveStockSpecs(selectedConcentrates);

    const toShow: ShowItem[] = [];
    if (activeStockEntries.length > 0) {
      activeStockEntries.forEach((entry, idx) => {
        toShow.push({
          kind: "stock",
          id: entry.id,
          label: entry.spec.label || entry.id,
          spec: entry.spec,
          order: -1 + idx * 0.001,
        });
      });
    } else {
      const mgSourceIds = getEffectiveMagnesiumSources();
      const caSourceIds = getEffectiveCalciumSources();

      const bufferIds = alkalinitySources;
      const candidates = [
        ...mgSourceIds.map((id, i) => ({ mineralId: id, order: 0 + i * 0.1 })),
        ...bufferIds.map((id, i) => ({ mineralId: id, order: 1 + i * 0.1 })),
        ...caSourceIds.map((id, i) => ({ mineralId: id, order: 2 + i * 0.1 })),
      ].filter((x) => x && x.mineralId);

      for (const c of candidates) {
        const mineralId = c.mineralId;
        const showMineral = selectedMinerals.includes(mineralId);
        if (showMineral) toShow.push({ kind: "mineral", id: mineralId, order: c.order });
        selectedConcentrates.forEach((cid) => {
          if (getConcentrateMineralId(cid) === mineralId) {
            toShow.push({ kind: "concentrate", id: cid, mineralId, order: c.order + 0.05 });
          }
        });
      }
    }
    toShow.sort((a, b) => a.order - b.order);

    resultsContainer.innerHTML = "";
    if (toShow.length === 0) {
      const p = document.createElement("p");
      p.className = "hint";
      if (selectedMinerals.length === 0 && selectedConcentrates.length === 0) {
        p.textContent = "No minerals or concentrates selected. Go to ";
        const a = document.createElement("a");
        a.href = "minerals.html";
        a.textContent = "Settings";
        p.appendChild(a);
        p.appendChild(document.createTextNode(" to pick some."));
      } else {
        p.textContent = "Select minerals or concentrates in ";
        const a = document.createElement("a");
        a.href = "minerals.html";
        a.textContent = "Settings";
        p.appendChild(a);
        p.appendChild(document.createTextNode(" to see what to add."));
      }
      resultsContainer.appendChild(p);
      lastCalculatedIons = null;
      updateSummaryMetrics({});
      return;
    }
    for (const item of toShow) {
      if (item.kind === "stock") {
        const div = document.createElement("div");
        div.className = "result-item";
        div.dataset.stock = item.id;
        const resultInfo = document.createElement("div");
        resultInfo.className = "result-info";
        const nameSpan = document.createElement("span");
        nameSpan.className = "result-name";
        nameSpan.textContent = item.label ?? "";
        const stockBadge = document.createElement("span");
        stockBadge.className = "badge badge-concentrate";
        stockBadge.textContent = "CONCENTRATE";
        nameSpan.appendChild(stockBadge);
        const detailSpan = document.createElement("span");
        detailSpan.className = "result-detail";
        detailSpan.textContent = formatStockResultDetail(item.spec);
        resultInfo.appendChild(nameSpan);
        resultInfo.appendChild(detailSpan);
        // The calculator scales each concentrate's dose to best-fit the target,
        // so the shown amount may differ from the bottle's prescribed dose.
        // Surface the prescribed dose as a volume-independent reference.
        const dosePerL = Number(item.spec && item.spec.doseGramsPerL) || 0;
        if (dosePerL > 0) {
          const prescribedSpan = document.createElement("span");
          prescribedSpan.className = "result-prescribed";
          prescribedSpan.textContent = "prescribed: " + Math.round(dosePerL * 100) / 100 + " mL/L";
          resultInfo.appendChild(prescribedSpan);
        }
        div.appendChild(resultInfo);
        div.appendChild(buildConcentrateValueEl(item.id));
        resultsContainer.appendChild(div);
        continue;
      }

      const mineralId = item.kind === "concentrate" ? item.mineralId! : item.id;
      const brandEntry =
        typeof BRAND_CONCENTRATES !== "undefined" ? BRAND_CONCENTRATES[item.id] : undefined;
      const mineral =
        item.kind === "concentrate" && brandEntry
          ? { name: brandEntry.name, formula: brandEntry.formula }
          : MINERAL_DB[mineralId];
      if (!mineral) continue;
      const div = document.createElement("div");
      div.className = "result-item";
      if (item.kind === "concentrate") {
        div.dataset.concentrate = item.id;
      } else {
        div.dataset.mineral = item.id;
      }
      const resultInfo = document.createElement("div");
      resultInfo.className = "result-info";
      const nameSpan = document.createElement("span");
      nameSpan.className = "result-name";
      nameSpan.textContent = mineral.name;
      if (item.kind === "concentrate" && item.id.startsWith("brand:lotus:")) {
        const lotusBadge = document.createElement("span");
        lotusBadge.className = "badge badge-lotus";
        lotusBadge.textContent = "Lotus";
        nameSpan.appendChild(lotusBadge);
      }
      const detailSpan = document.createElement("span");
      detailSpan.className = "result-detail";
      if (item.kind === "concentrate") {
        detailSpan.textContent = mineral.formula + " ";
        const badge = document.createElement("span");
        badge.className = "badge badge-concentrate";
        badge.textContent = "CONCENTRATE";
        detailSpan.appendChild(badge);
      } else {
        detailSpan.textContent = mineral.formula;
      }
      resultInfo.appendChild(nameSpan);
      resultInfo.appendChild(detailSpan);
      div.appendChild(resultInfo);
      if (item.kind === "concentrate") {
        div.appendChild(buildConcentrateValueEl(item.id));
      } else {
        const valueSpan = document.createElement("span");
        valueSpan.className = "result-value";
        valueSpan.textContent = "0.00 g";
        div.appendChild(valueSpan);
      }
      resultsContainer.appendChild(div);
    }
    // When Recipe Concentrates are active, calculate() fills this container with
    // the gap-fill section. Built empty here; the contents are target-dependent
    // and rebuilt on every calculate(), which runs on target changes.
    if (activeStockEntries.length > 0) {
      const supplementsContainer = document.createElement("div");
      supplementsContainer.id = "stock-supplements";
      resultsContainer.appendChild(supplementsContainer);
    }
  }

  // --- Dynamic profile buttons ---
  // --- Target Profile rail filters (Roast + Flavor; Method = the brew toggle) ---
  // Reuses the Library's filter vocabulary + the shared window.recipeMatches
  // predicate so the calculator narrows profiles exactly like library.html does.
  const TARGET_ROAST_OPTIONS = [
    { value: "all", label: "All" },
    { value: "light", label: "Light" },
    { value: "medium", label: "Medium" },
    { value: "dark", label: "Dark" },
  ];
  let targetFilterRoast = "all";
  const targetFilterTags: string[] = [];

  function buildTargetFilters(): void {
    const container = document.getElementById("target-filters");
    if (!container) return;
    // Capture the brew-method toggle (it lives in the markup before this box, or
    // already inside it on a re-run) BEFORE wiping, so its once-bound click
    // wiring survives the relocation into the Method row below.
    const brewToggle = document.getElementById("brew-method-toggle");
    container.innerHTML = "";

    // Method row — the existing Filter/Espresso toggle, relocated into the box.
    if (brewToggle) {
      const methodRow = document.createElement("div");
      methodRow.className = "rx-filter-row";
      const methodLabel = document.createElement("div");
      methodLabel.className = "rx-filter-row-label";
      methodLabel.textContent = "Method";
      methodRow.appendChild(methodLabel);
      methodRow.appendChild(brewToggle);
      container.appendChild(methodRow);
    }

    // Roast (segmented, single-select). Divided from the Method row above.
    const roastRow = document.createElement("div");
    roastRow.className = "rx-filter-row rx-filter-row-divided";
    const roastLabel = document.createElement("div");
    roastLabel.className = "rx-filter-row-label";
    roastLabel.textContent = "Roast";
    roastRow.appendChild(roastLabel);
    const roastSeg = document.createElement("div");
    roastSeg.className = "rx-segmented";
    const roastBtns: HTMLButtonElement[] = [];
    TARGET_ROAST_OPTIONS.forEach((opt) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rx-segmented-button";
      b.dataset.value = opt.value;
      b.textContent = opt.label;
      b.addEventListener("click", () => {
        targetFilterRoast = opt.value;
        roastBtns.forEach((x) =>
          x.classList.toggle("is-active", x.dataset.value === targetFilterRoast),
        );
        renderProfileButtons();
      });
      roastSeg.appendChild(b);
      roastBtns.push(b);
    });
    roastBtns.forEach((x) =>
      x.classList.toggle("is-active", x.dataset.value === targetFilterRoast),
    );
    roastRow.appendChild(roastSeg);
    container.appendChild(roastRow);

    // Flavor (chips, multi-select / AND).
    const tagList =
      typeof LIBRARY_TAGS !== "undefined" && Array.isArray(LIBRARY_TAGS) ? LIBRARY_TAGS : [];
    if (tagList.length) {
      const flavorRow = document.createElement("div");
      flavorRow.className = "rx-filter-row rx-filter-row-divided";
      const flavorLabel = document.createElement("div");
      flavorLabel.className = "rx-filter-row-label";
      flavorLabel.textContent = "Flavor";
      flavorRow.appendChild(flavorLabel);
      const chipGroup = document.createElement("div");
      chipGroup.className = "rx-chip-group";
      tagList.forEach((tag) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "rx-chip";
        chip.dataset.tag = tag;
        chip.textContent = tag;
        chip.addEventListener("click", () => {
          const idx = targetFilterTags.indexOf(tag);
          if (idx === -1) targetFilterTags.push(tag);
          else targetFilterTags.splice(idx, 1);
          chip.classList.toggle("is-active", targetFilterTags.indexOf(tag) !== -1);
          renderProfileButtons();
        });
        chipGroup.appendChild(chip);
      });
      flavorRow.appendChild(chipGroup);
      container.appendChild(flavorRow);
    }
  }

  function renderProfileButtons(): void {
    profileButtonsContainer.innerHTML = "";
    const allProfiles = getTargetPresetsForBrewMethod(activeBrewMethod);
    const filterActive = targetFilterRoast !== "all" || targetFilterTags.length > 0;
    const filters = {
      method: "all",
      roast: targetFilterRoast,
      tags: targetFilterTags,
      mine: false,
      q: "",
    };
    const matchesFilter = (profile: TargetProfile) =>
      typeof window.recipeMatches !== "function" || window.recipeMatches(profile, filters);

    let shownReal = 0;
    for (const [key, profile] of Object.entries(allProfiles)) {
      // "+ Custom"/"+ From Library" actions and the active selection always show;
      // everything else is subject to the Roast/Flavor filter.
      const isSentinel = key === "custom" || key === "library";
      if (filterActive && !isSentinel && key !== currentProfile && !matchesFilter(profile)) {
        continue;
      }
      if (!isSentinel) shownReal++;
      if (isSentinel) {
        // "+ Custom" / "+ From Library" stay as compact dashed action tiles, not
        // recipe cards. data-profile keeps the delegated click handler dispatching
        // them (custom flow / picker).
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = "rx-slim-action-tile";
        tile.dataset.profile = key;
        tile.textContent = profile.label;
        profileButtonsContainer.appendChild(tile);
      } else {
        // buildSlimRecipeCard is imported from recipe-card.ts.
        const card = buildSlimRecipeCard(profile, {
          slug: key,
          attrName: "profile",
          selected: key === currentProfile,
          deletable: isTargetEditMode,
        });
        profileButtonsContainer.appendChild(card);
      }
    }

    if (filterActive && shownReal === 0) {
      const empty = document.createElement("p");
      empty.className = "hint target-filter-empty";
      empty.textContent = "No profiles match these filters.";
      profileButtonsContainer.insertBefore(empty, profileButtonsContainer.firstChild);
    }
    highlightProfile(currentProfile);
  }

  function renderTargetReadonlyTags(): void {
    if (!targetReadonlyTags) return;
    targetReadonlyTags.innerHTML = "";
    const ca = parseFloat(targetCa.value) || 0;
    const mg = parseFloat(targetMg.value) || 0;
    const alk = parseFloat(targetAlk.value) || 0;
    const tags: Array<[string, number, string]> = [
      ["Ca", Math.round(ca), "mg/L"],
      ["Mg", Math.round(mg), "mg/L"],
      ["Alkalinity", Math.round(alk), "mg/L as CaCO3"],
    ];
    if (isAdvancedMineralDisplayMode()) {
      tags.push(
        ["K", Math.round(parseFloat(targetK.value) || 0), "mg/L"],
        ["Na", Math.round(parseFloat(targetNa.value) || 0), "mg/L"],
        ["SO₄", Math.round(parseFloat(targetSO4.value) || 0), "mg/L"],
        ["Cl", Math.round(parseFloat(targetCl.value) || 0), "mg/L"],
      );
    }
    tags.forEach(function (t) {
      const span = document.createElement("span");
      span.className = "base-tag";
      span.textContent = t[0] + ": " + t[1] + " " + t[2];
      targetReadonlyTags.appendChild(span);
    });
  }

  function updateTargetModeUI(): void {
    const targetInputs = document.querySelector<HTMLElement>(".target-inputs");
    const customSelected = currentProfile === "custom";
    const showInputs = isTargetEditMode || customSelected;
    if (targetInputs) targetInputs.style.display = showInputs ? "" : "none";
    if (targetReadonlyTags) {
      targetReadonlyTags.style.display = showInputs ? "none" : "";
    }
    if (!showInputs) {
      targetEditBar.style.display = "none";
    }
    if (targetEditModeBtn) {
      targetEditModeBtn.textContent = isTargetEditMode ? "Done Editing" : "Edit Profiles";
      targetEditModeBtn.setAttribute("aria-pressed", isTargetEditMode ? "true" : "false");
    }
    renderTargetReadonlyTags();
  }

  function highlightProfile(profileName: string): void {
    profileButtonsContainer.querySelectorAll(".active").forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-pressed", "false");
    });
    const btn = profileButtonsContainer.querySelector(
      `[data-profile="${CSS.escape(profileName)}"]`,
    );
    if (btn) {
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
    }
    targetSaveBar.style.display = profileName === "custom" ? "flex" : "none";
    targetEditBar.style.display = "none";
    updateTargetModeUI();
  }

  function activateProfile(profileName: string): void {
    const visibleProfiles = getTargetPresetsForBrewMethod(activeBrewMethod);
    if (!visibleProfiles[profileName]) {
      profileName = findFallbackPreset(visibleProfiles);
    }
    // "library" is an action pseudo-tile, not a real profile: opening the picker
    // must not mutate currentProfile or persist a saved-preset name (would
    // auto-open the picker on next load).
    if (profileName === "library") {
      if (typeof window.showLibraryPicker === "function") {
        window.showLibraryPicker({
          brewMethod: activeBrewMethod,
          onAdd: (slug) => {
            renderProfileButtons();
            activateProfile(slug);
          },
        });
      }
      return;
    }
    currentProfile = profileName;
    saveTargetPresetName(profileName);

    if (profileName === "custom") {
      highlightProfile(profileName);
      profileDesc.textContent = "Enter your own target values above.";
      calculate();
      return;
    }

    const profile = getTargetProfileByKey(profileName);
    if (profile) {
      targetCa.value = String(profile.calcium);
      targetMg.value = String(profile.magnesium);
      targetAlk.value = String(profile.alkalinity);
      targetK.value = String(profile.potassium || 0);
      targetNa.value = String(profile.sodium || 0);
      targetSO4.value = String(profile.sulfate || 0);
      targetCl.value = String(profile.chloride || 0);
      targetHCO3.value = String(profile.bicarbonate || 0);
      profileDesc.textContent = profile.description || "";
    }
    // Overlay any persisted draft for this slug. Drafts are written by the
    // target-input listener and survive reload + cross-device sync.
    const draftIons = loadTargetDraftIonsFor(profileName);
    if (draftIons && typeof draftIons === "object") {
      if (Number.isFinite(Number(draftIons.calcium))) targetCa.value = String(draftIons.calcium);
      if (Number.isFinite(Number(draftIons.magnesium)))
        targetMg.value = String(draftIons.magnesium);
      if (Number.isFinite(Number(draftIons.alkalinity)))
        targetAlk.value = String(draftIons.alkalinity);
      if (Number.isFinite(Number(draftIons.potassium))) targetK.value = String(draftIons.potassium);
      if (Number.isFinite(Number(draftIons.sodium))) targetNa.value = String(draftIons.sodium);
      if (Number.isFinite(Number(draftIons.sulfate))) targetSO4.value = String(draftIons.sulfate);
      if (Number.isFinite(Number(draftIons.chloride))) targetCl.value = String(draftIons.chloride);
      if (Number.isFinite(Number(draftIons.bicarbonate)))
        targetHCO3.value = String(draftIons.bicarbonate);
      if (NON_EDITABLE_TARGET_KEYS.includes(profileName)) {
        // Mirror the non-editable branch of the input handler so the UI reflects
        // the restored draft state on first paint.
        const label = profile && profile.label ? profile.label : profileName;
        profileDesc.textContent = "Modified " + label + " - name and save to keep these values.";
      }
    }
    // Render profile state after input values are assigned so readonly tags are in sync.
    highlightProfile(profileName);
    // After highlight, surface the right bar for any restored draft. highlightProfile
    // hides both bars; if a draft is live, re-show the appropriate one.
    if (draftIons && hasUnsavedTargetChanges()) {
      if (NON_EDITABLE_TARGET_KEYS.includes(profileName)) {
        targetSaveBar.style.display = "flex";
      } else {
        targetEditBar.style.display = "flex";
        const label = profile && profile.label ? profile.label : profileName;
        (document.getElementById("target-edit-bar-label") as HTMLElement).textContent =
          "Editing: " + label;
      }
    }
    calculate();
  }

  function hasUnsavedTargetChanges(): boolean {
    if (currentProfile === "custom") return false;
    const profile = getTargetProfileByKey(currentProfile);
    if (!profile) return false;
    const changed =
      (parseFloat(targetCa.value) || 0) !== (profile.calcium || 0) ||
      (parseFloat(targetMg.value) || 0) !== (profile.magnesium || 0) ||
      (parseFloat(targetAlk.value) || 0) !== (profile.alkalinity || 0);
    if (changed) return true;
    if (isAdvancedMineralDisplayMode()) {
      return (
        (parseFloat(targetK.value) || 0) !== (profile.potassium || 0) ||
        (parseFloat(targetNa.value) || 0) !== (profile.sodium || 0) ||
        (parseFloat(targetSO4.value) || 0) !== (profile.sulfate || 0) ||
        (parseFloat(targetCl.value) || 0) !== (profile.chloride || 0)
      );
    }
    return false;
  }

  // --- Event delegation for profile buttons ---
  profileButtonsContainer.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const deleteKey = target.dataset.delete;
    if (deleteKey) {
      if (!isTargetEditMode) return;
      e.stopPropagation();
      showConfirm("Are you sure you want to delete this profile?", () => {
        deleteCustomTargetProfile(deleteKey);
        renderProfileButtons();
        if (currentProfile === deleteKey) {
          const fallback = findFallbackPreset(getTargetPresetsForBrewMethod(activeBrewMethod));
          activateProfile(fallback);
        }
      });
      return;
    }

    const btn = target.closest<HTMLElement>("[data-profile]");
    if (!btn) return;
    const nextProfile = btn.dataset.profile!;
    // Warn before discarding in-progress edits. "library" is the picker
    // pseudo-tile and shouldn't trigger the prompt.
    if (
      nextProfile !== currentProfile &&
      nextProfile !== "library" &&
      typeof hasUnsavedTargetChanges === "function" &&
      hasUnsavedTargetChanges()
    ) {
      if (!window.confirm("Discard unsaved changes?")) return;
      clearTargetDraftIons(currentProfile);
    }
    activateProfile(nextProfile);
    // Light haptic on the deliberate "switch profile" tap (native only — web
    // call sites see window.cwHaptic as undefined and the optional chain
    // no-ops).
    if (typeof window.cwHaptic === "function") window.cwHaptic("light");
  });

  // Snapshot the current target inputs as an ion object. Used by the draft-
  // persistence path so an in-progress edit survives reload and a second device.
  function readCurrentTargetIons(): Record<string, number> {
    return {
      calcium: parseFloat(targetCa.value) || 0,
      magnesium: parseFloat(targetMg.value) || 0,
      alkalinity: parseFloat(targetAlk.value) || 0,
      potassium: parseFloat(targetK.value) || 0,
      sodium: parseFloat(targetNa.value) || 0,
      sulfate: parseFloat(targetSO4.value) || 0,
      chloride: parseFloat(targetCl.value) || 0,
      bicarbonate: parseFloat(targetHCO3.value) || 0,
    };
  }

  function getCurrentTargetProfileForCalculations(): DosingTarget {
    const ions = readCurrentTargetIons();
    return {
      calcium: ions.calcium!,
      magnesium: ions.magnesium!,
      alkalinity: ions.alkalinity!,
      potassium: ions.potassium!,
      sodium: ions.sodium!,
      sulfate: ions.sulfate!,
      chloride: ions.chloride!,
      bicarbonate: ions.bicarbonate!,
    };
  }

  // --- Target input handling (debounced) ---
  [targetCa, targetMg, targetAlk, targetK, targetNa, targetSO4, targetCl].forEach((input) => {
    input.addEventListener("input", () => {
      renderTargetReadonlyTags();
      if (currentProfile !== "custom") {
        const hasChanges = hasUnsavedTargetChanges();
        const isNonEditable = NON_EDITABLE_TARGET_KEYS.includes(currentProfile);
        // Persist edits as a per-slug draft so a reload / second-device session
        // doesn't lose them.
        if (hasChanges) {
          saveTargetDraftIons(currentProfile, readCurrentTargetIons());
        } else {
          clearTargetDraftIons(currentProfile);
        }
        if (isNonEditable) {
          // Built-in canonical recipes (SCA, Rao) can't be overwritten in place.
          // Surface the "Save Profile" bar with a name input instead of the
          // "Save Changes" edit bar, and tell the user via the description.
          targetEditBar.style.display = "none";
          targetSaveBar.style.display = hasChanges ? "flex" : "none";
          const profile = getTargetProfileByKey(currentProfile);
          const label = profile && profile.label ? profile.label : currentProfile;
          profileDesc.textContent = hasChanges
            ? "Modified " + label + " - name and save to keep these values."
            : (profile && profile.description) || "";
        } else {
          targetEditBar.style.display = hasChanges ? "flex" : "none";
          if (hasChanges) {
            const profile = getTargetProfileByKey(currentProfile);
            (document.getElementById("target-edit-bar-label") as HTMLElement).textContent =
              "Editing: " + (profile && profile.label ? profile.label : currentProfile);
          }
        }
      }
      debouncedCalculate();
    });
  });

  // --- Persist edits to the currently-loaded target profile.
  // Returns { saved, profile, wasCreator } so callers can trigger follow-up
  // actions (render refresh, share prompt) consistently. ---
  interface PersistResult {
    saved: boolean;
    profile?: TargetProfile;
  }

  function persistTargetProfileEdits(): PersistResult {
    calculate();
    const allProfiles = getTargetPresetsForBrewMethod(activeBrewMethod);
    const existing = allProfiles[currentProfile];
    if (!existing) return { saved: false };
    const orig = getTargetProfileByKey(currentProfile);
    const hasExplicitIons = orig && ION_FIELDS.every((ion) => Number.isFinite(Number(orig[ion])));
    let profile: TargetProfile;
    if (hasExplicitIons) {
      const editIons = {
        calcium: parseFloat(targetCa.value) || 0,
        magnesium: parseFloat(targetMg.value) || 0,
        potassium: parseFloat(targetK.value) || 0,
        sodium: parseFloat(targetNa.value) || 0,
        sulfate: parseFloat(targetSO4.value) || 0,
        chloride: parseFloat(targetCl.value) || 0,
        bicarbonate: parseFloat(targetHCO3.value) || 0,
      };
      profile = buildStoredTargetProfile(existing.label, editIons, existing.description || "", {
        alkalinity: parseFloat(targetAlk.value) || 0,
        brewMethod: activeBrewMethod,
      });
    } else {
      profile = {
        label: existing.label,
        calcium: parseFloat(targetCa.value) || 0,
        magnesium: parseFloat(targetMg.value) || 0,
        alkalinity: parseFloat(targetAlk.value) || 0,
        potassium: parseFloat(targetK.value) || 0,
        sodium: parseFloat(targetNa.value) || 0,
        sulfate: parseFloat(targetSO4.value) || 0,
        chloride: parseFloat(targetCl.value) || 0,
        bicarbonate: parseFloat(targetHCO3.value) || 0,
        description: existing.description || "",
        brewMethod: activeBrewMethod,
      };
    }
    // Preserve library sharing / attribution fields from the original profile.
    if (orig) {
      if (orig.isPublic) profile.isPublic = true;
      if (orig.creatorDisplayName) profile.creatorDisplayName = orig.creatorDisplayName;
      if (orig.tags) profile.tags = orig.tags;
      if ("creatorUserId" in orig) profile.creatorUserId = orig.creatorUserId;
    }
    const profiles = loadCustomTargetProfiles();
    profiles[currentProfile] = profile;
    if (!saveCustomTargetProfiles(profiles)) {
      showTargetSaveStatus("Storage full; could not save.", true);
      return { saved: false };
    }
    // Save Changes committed the draft into the profile — drop the draft so a
    // reload doesn't re-show stale "modified" UI.
    clearTargetDraftIons(currentProfile);
    targetEditBar.style.display = "none";
    if (typeof window.syncNow === "function") window.syncNow();
    return { saved: true, profile: profile };
  }

  // Offer the share prompt after an edit-save, but only to the recipe's creator.
  function offerShareAfterEdit(profileKey: string, profile: TargetProfile | undefined): void {
    maybeOfferSharePrompt(profileKey, profile);
  }

  if (targetEditModeBtn) {
    targetEditModeBtn.addEventListener("click", () => {
      // Leaving edit mode with unsaved ion changes: persist them.
      // "Done Editing" is a natural commit point — no extra confirmation.
      if (isTargetEditMode && hasUnsavedTargetChanges()) {
        const key = currentProfile;
        const result = persistTargetProfileEdits();
        if (!result.saved) return; // storage error — stay in edit mode
        offerShareAfterEdit(key, result.profile);
      }
      isTargetEditMode = !isTargetEditMode;
      renderProfileButtons();
      updateTargetModeUI();
    });
  }

  // --- Save changes to existing target profile ---
  targetSaveChangesBtn.addEventListener("click", () => {
    showConfirm("Are you sure you want to change this profile?", () => {
      const key = currentProfile;
      const result = persistTargetProfileEdits();
      if (!result.saved) return;
      renderProfileButtons();
      offerShareAfterEdit(key, result.profile);
      if (typeof window.cwHaptic === "function") window.cwHaptic("medium");
    });
  });

  // --- Duplicate name error below name input (target profile) ---
  function updateTargetProfileNameError(): void {
    const errEl = document.getElementById("target-profile-name-error") as HTMLElement;
    const validation = validateTargetProfileName(targetProfileNameInput.value, {
      allowEmpty: true,
    });
    if (validation.ok && validation.empty) {
      errEl.textContent = "";
      targetSaveBtn.disabled = false;
      return;
    }
    if (!validation.ok) {
      errEl.textContent = validation.message ?? "";
      targetSaveBtn.disabled = true;
      return;
    }
    errEl.textContent = "";
    targetSaveBtn.disabled = false;
  }

  targetProfileNameInput.addEventListener("input", updateTargetProfileNameError);
  bindEnterToClick(targetProfileNameInput, targetSaveBtn);

  // --- Save new custom target profile ---
  targetSaveBtn.addEventListener("click", () => {
    const validation = validateTargetProfileName(targetProfileNameInput.value);
    if (!validation.ok) {
      if (validation.code === "reserved" || validation.code === "duplicate") {
        updateTargetProfileNameError();
        return;
      }
      (document.getElementById("target-profile-name-error") as HTMLElement).textContent = "";
      showTargetSaveStatus(validation.message ?? "", true);
      return;
    }
    const { key, name } = validation;
    if (!key || !name) {
      updateTargetProfileNameError();
      return;
    }

    (document.getElementById("target-profile-name-error") as HTMLElement).textContent = "";
    calculate();

    const profiles = loadCustomTargetProfiles();
    const targetIons = {
      calcium: parseFloat(targetCa.value) || 0,
      magnesium: parseFloat(targetMg.value) || 0,
      potassium: parseFloat(targetK.value) || 0,
      sodium: parseFloat(targetNa.value) || 0,
      sulfate: parseFloat(targetSO4.value) || 0,
      chloride: parseFloat(targetCl.value) || 0,
      bicarbonate: parseFloat(targetHCO3.value) || 0,
    };
    const profile = buildStoredTargetProfile(name, targetIons, "", {
      alkalinity: parseFloat(targetAlk.value) || 0,
      brewMethod: activeBrewMethod,
    });

    profiles[key] = profile;
    if (!saveCustomTargetProfiles(profiles)) {
      showTargetSaveStatus("Storage full; could not save.", true);
      return;
    }

    // The user named + saved a new profile from in-progress edits on the active
    // preset (currentProfile). Clear that draft so revisiting the source preset
    // shows its clean values rather than the now-committed edits.
    clearTargetDraftIons(currentProfile);

    renderProfileButtons();
    activateProfile(key);
    targetProfileNameInput.value = "";
    updateTargetProfileNameError();
    showTargetSaveStatus("Saved!", false);

    // Sync immediately so the save persists even if the user navigates away
    if (typeof window.syncNow === "function") window.syncNow();

    // Offer to share to Recipe Library (only if logged in)
    maybeOfferSharePrompt(key, profile);
    if (typeof window.cwHaptic === "function") window.cwHaptic("medium");
  });

  const showTargetSaveStatus = createStatusHandler(targetSaveStatus);

  // --- Recalculate on any input change (debounced volume input) ---
  function onVolumeChanged(): void {
    saveVolumePreference("calculator", volumeInput.value, volumeUnit.value);
    debouncedCalculate();
  }
  volumeInput.addEventListener("input", onVolumeChanged);
  volumeUnit.addEventListener("change", () => {
    saveVolumePreference("calculator", volumeInput.value, volumeUnit.value);
    calculate();
  });

  type StockSupplements = Pick<DosingResult, "supplementGramsPerL" | "enableSuggestions">;

  // The user's dosing kit, as the result rows currently present it. A
  // concentrate is shown in drops only when its row has the drops/mL select
  // (built when the concentrate has a dropper size); otherwise it is in mL.
  function gatherDosingKit(): DosingKit {
    const displayOf = (concentrateId: string): { dropMl: number; unit: "ml" | "drops" } => {
      const dropMl = getConcentrateDropMl(concentrateId);
      const unitSelect = resultsContainer.querySelector<HTMLSelectElement>(
        `[data-lotus-unit-for="${CSS.escape(concentrateId)}"]`,
      );
      if (unitSelect && dropMl > 0) {
        return { dropMl, unit: normalizeLotusConcentrateUnit(unitSelect.value) };
      }
      return { dropMl: 0, unit: "ml" };
    };
    const selectedConcentrates = loadValidSelectedConcentrates();
    return {
      minerals: loadSelectedMinerals(),
      concentrates: selectedConcentrates
        .filter((cid) => !cid.startsWith("stock:"))
        .map((cid) => ({
          id: cid,
          mineralId: getConcentrateMineralId(cid),
          gramsPerMl: getConcentrateGramsPerMl(cid),
          ...displayOf(cid),
        })),
      recipeConcentrates: getActiveStockSpecs(selectedConcentrates).map((entry) => ({
        id: entry.id,
        spec: entry.spec,
        ...displayOf(entry.id),
      })),
    };
  }

  // Populate the #stock-supplements container with the gap-fill section.
  function renderStockSupplements(plan: StockSupplements | null, volumeL: number): void {
    const container = document.getElementById("stock-supplements");
    if (!container) return;
    container.innerHTML = "";
    if (!plan) return;
    const suppIds = Object.keys(plan.supplementGramsPerL).filter(
      (id) => plan.supplementGramsPerL[id]! > 0,
    );
    if (suppIds.length === 0 && plan.enableSuggestions.length === 0) return;

    const heading = document.createElement("div");
    heading.className = "result-section-heading";
    heading.textContent = "Supplements";
    container.appendChild(heading);

    for (const mineralId of suppIds) {
      const mineral = MINERAL_DB[mineralId];
      if (!mineral) continue;
      const grams = plan.supplementGramsPerL[mineralId]! * volumeL;
      const div = document.createElement("div");
      div.className = "result-item";
      div.dataset.mineral = mineralId;
      const info = document.createElement("div");
      info.className = "result-info";
      const nameSpan = document.createElement("span");
      nameSpan.className = "result-name";
      nameSpan.textContent = mineral.name;
      const detailSpan = document.createElement("span");
      detailSpan.className = "result-detail";
      detailSpan.textContent = mineral.formula;
      info.appendChild(nameSpan);
      info.appendChild(detailSpan);
      div.appendChild(info);
      const valueSpan = document.createElement("span");
      valueSpan.className = "result-value";
      valueSpan.textContent = formatGrams(grams);
      div.appendChild(valueSpan);
      container.appendChild(div);
    }

    const GAP_ION_LABEL: Record<string, string> = {
      calcium: "Calcium",
      magnesium: "Magnesium",
      bicarbonate: "Alkalinity",
    };
    for (const sugg of plan.enableSuggestions) {
      const mineral = MINERAL_DB[sugg.mineralId];
      if (!mineral) continue;
      const ionLabel = GAP_ION_LABEL[sugg.ion] || sugg.ion;
      const div = document.createElement("div");
      div.className = "result-item result-enable-suggestion";
      div.dataset.enableMineral = sugg.mineralId;
      const info = document.createElement("div");
      info.className = "result-info";
      const nameSpan = document.createElement("span");
      nameSpan.className = "result-name";
      nameSpan.textContent = "Add " + mineral.name;
      const detailSpan = document.createElement("span");
      detailSpan.className = "result-detail";
      detailSpan.textContent = "Enable it to close the gap on " + ionLabel;
      info.appendChild(nameSpan);
      info.appendChild(detailSpan);
      div.appendChild(info);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "enable-mineral-btn";
      btn.textContent = "Enable";
      btn.addEventListener("click", function () {
        const current = loadSelectedMinerals();
        if (!current.includes(sugg.mineralId)) {
          saveSelectedMinerals(current.concat([sugg.mineralId]));
        }
        // index.html listens for cw:minerals-changed and re-runs
        // renderResultItems + calculate, so the newly-enabled mineral resolves
        // into a real supplement row with its amount on the next pass.
        window.dispatchEvent(
          new CustomEvent("cw:minerals-changed", { detail: { source: "calculator-gap-fill" } }),
        );
      });
      div.appendChild(btn);
      container.appendChild(div);
    }
  }

  // --- Core calculation ---
  // The dose math lives in src/lib/dosing.ts (computeDoses), shared with the
  // MCP server. This function gathers the page's inputs, calls it, and renders.
  function calculate(): void {
    const warningsEl = document.getElementById("result-warnings");

    // Get volume in liters
    let volumeL = parseFloat(volumeInput.value) || 0;
    if (volumeUnit.value === "gallons") {
      volumeL *= GALLONS_TO_LITERS;
    }

    // Read source water from shared module
    const sourceWater = sourceSection.getSourceWater();
    const doses = computeDoses({
      sourceWater,
      target: getCurrentTargetProfileForCalculations(),
      volumeL,
      kit: gatherDosingKit(),
      recipeSlug: currentProfile,
    });

    if (doses.status === "no-volume") {
      if (warningsEl) warningsEl.textContent = "";
      lastCalculatedIons = null;
      updateResultValues(doses.mineralGrams);
      if (doses.mode === "recipe-concentrates") {
        updateStockValues(doses.recipeConcentrateMl);
        renderStockSupplements(null, 0);
      }
      updateSummaryMetrics({});
      return;
    }

    if (doses.status === "no-alkalinity-source") {
      if (warningsEl) warningsEl.textContent = "";
      lastCalculatedIons = null;
      updateSummaryMetrics({});
      return;
    }

    if (doses.mode === "recipe-concentrates") {
      updateStockValues(doses.recipeConcentrateMl);
      renderStockSupplements(doses, volumeL);
    } else {
      updateResultValues(doses.mineralGrams);
      updateConcentrateValues(doses.concentrateMl);
    }
    if (warningsEl) warningsEl.textContent = doses.warnings.join("\n");

    // The readout describes the water the DISPLAYED doses make (whole drops,
    // rounded mL / grams), not the exact solve; range bands follow it too.
    const finalIons: Record<string, number> = doses.finalIons || {};
    lastCalculatedIons = finalIons;
    const metrics = calculateMetrics(finalIons);
    const finalSO4 = finalIons.sulfate || 0;
    const finalCl = finalIons.chloride || 0;
    updateSummaryMetrics({
      gh: metrics.gh,
      kh: metrics.kh,
      tds: metrics.tds,
      ions: finalIons,
      baselineIons: sourceWater || {},
      baselineMetrics: calculateMetrics(sourceWater || {}),
      so4ToCl: finalCl > 0 ? finalSO4 / finalCl : null,
      baselineRatio: calculateSo4ClRatio(sourceWater || {}),
      advancedMode: isAdvancedMineralDisplayMode(),
      alkalinitySources: doses.rangeSources.alkalinitySources,
      calciumSource: doses.rangeSources.calciumSource,
      magnesiumSource: doses.rangeSources.magnesiumSource,
      brewMethod: activeBrewMethod,
    });
  }

  interface SummaryPayload {
    gh?: number;
    kh?: number;
    tds?: number;
    ions?: Record<string, number>;
    baselineIons?: Record<string, number> | null;
    baselineMetrics?: { gh: number; kh: number; tds: number } | null;
    so4ToCl?: number | null;
    baselineRatio?: number | null;
    advancedMode?: boolean;
    alkalinitySources?: string[];
    calciumSource?: string | null;
    magnesiumSource?: string | null;
    brewMethod?: string;
  }

  function updateSummaryMetrics(payload: SummaryPayload): void {
    const gh = payload.gh;
    const kh = payload.kh;
    const tds = payload.tds;
    const ions = payload.ions || {};
    const baselineIons = payload.baselineIons || null;
    const baselineMetrics = payload.baselineMetrics || null;
    const so4ToCl = payload.so4ToCl;
    const baselineRatio = payload.baselineRatio;
    const advancedMode = !!payload.advancedMode;
    const brewMethod = payload.brewMethod === "espresso" ? "espresso" : "filter";

    (document.getElementById("calc-gh") as HTMLElement).textContent = String(
      Number.isFinite(gh) ? Math.round(gh!) : 0,
    );
    (document.getElementById("calc-kh") as HTMLElement).textContent = String(
      Number.isFinite(kh) ? Math.round(kh!) : 0,
    );
    (document.getElementById("calc-tds") as HTMLElement).textContent = String(
      Number.isFinite(tds) ? Math.round(tds!) : 0,
    );
    setDeltaText(
      document.getElementById("calc-delta-gh"),
      baselineMetrics && gh != null ? gh - baselineMetrics.gh : null,
      {
        metricName: "GH",
        unit: "mg/L as CaCO3",
        baselineLabel: "source water",
      },
    );
    setDeltaText(
      document.getElementById("calc-delta-kh"),
      baselineMetrics && kh != null ? kh - baselineMetrics.kh : null,
      {
        metricName: "KH",
        unit: "mg/L as CaCO3",
        baselineLabel: "source water",
      },
    );
    setDeltaText(
      document.getElementById("calc-delta-tds"),
      baselineMetrics && tds != null ? tds - baselineMetrics.tds : null,
      {
        metricName: "TDS",
        unit: "mg/L",
        baselineLabel: "source water",
      },
    );
    ION_FIELDS.forEach((ion) => {
      const el = document.getElementById("calc-" + ion);
      if (!el) return;
      const v = ions[ion];
      el.textContent = String(Number.isFinite(v) ? Math.round(v!) : 0);
      setDeltaText(
        document.getElementById("calc-delta-" + ion),
        baselineIons && v != null ? v - (baselineIons[ion] || 0) : null,
        {
          metricName: ion.charAt(0).toUpperCase() + ion.slice(1),
          unit: "mg/L",
          baselineLabel: "source water",
        },
      );
    });
    (document.getElementById("calc-so4cl") as HTMLElement).textContent = advancedMode
      ? so4ToCl == null
        ? "-"
        : so4ToCl.toFixed(2)
      : "-";
    setDeltaText(
      document.getElementById("calc-delta-so4cl"),
      !advancedMode || so4ToCl == null || baselineRatio == null ? null : so4ToCl - baselineRatio,
      {
        decimals: 2,
        metricName: "SO4:Cl ratio",
        baselineLabel: "source water",
      },
    );

    const rangeWarningsEl = document.getElementById("calc-range-warnings");
    if (rangeWarningsEl) {
      const alkalinitySources = payload.alkalinitySources;
      const calciumSource = payload.calciumSource;
      const magnesiumSource = payload.magnesiumSource;
      const hasAlkalinitySource = alkalinitySources && alkalinitySources.length > 0;
      if (!Number.isFinite(gh) || !Number.isFinite(kh) || !Number.isFinite(tds)) {
        renderRangeGuidance(rangeWarningsEl, []);
      } else if (hasAlkalinitySource && calciumSource != null && magnesiumSource != null) {
        const evaluation = evaluateWaterProfileRanges(ions, {
          includeAdvanced: advancedMode,
          alkalinitySources,
          calciumSource,
          magnesiumSource,
          brewMethod,
        });
        renderRangeGuidance(rangeWarningsEl, evaluation.findings);
      } else {
        renderRangeGuidance(rangeWarningsEl, []);
      }
    }
  }

  function setActiveBrewMethod(method: string): void {
    activeBrewMethod = method === "espresso" ? "espresso" : "filter";
    saveBrewMethod(activeBrewMethod);
    if (brewMethodToggle) {
      brewMethodToggle.querySelectorAll<HTMLElement>(".brew-method-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.brewMethod === activeBrewMethod);
      });
    }
    renderProfileButtons();
    const visible = getTargetPresetsForBrewMethod(activeBrewMethod);
    if (!visible[currentProfile]) {
      currentProfile = findFallbackPreset(visible);
      saveTargetPresetName(currentProfile);
    }
    activateProfile(currentProfile);
  }

  // --- Bug 3: Fixed formatGrams to handle sub-threshold display ---
  function formatGrams(g: number): string {
    if (!Number.isFinite(g) || g <= 0) return "0.00 g";
    if (g < 0.01) return "<0.01 g";
    return g.toFixed(2) + " g";
  }

  function formatMl(ml: number): string {
    if (!Number.isFinite(ml) || ml <= 0) return "0.000 mL";
    return ml.toFixed(3) + " mL";
  }

  // Value cell for a concentrate result row (Lotus, Mineral, or Recipe
  // Concentrate). Drops-capable concentrates (Lotus, or any concentrate with a
  // dropper size set) get a drops/mL toggle; the rest show mL only.
  function buildConcentrateValueEl(concentrateId: string): HTMLElement {
    const dropMl = getConcentrateDropMl(concentrateId);
    const valueSpan = document.createElement("span");
    valueSpan.className = "result-value";
    if (!(dropMl > 0)) {
      valueSpan.textContent = formatMl(0);
      return valueSpan;
    }
    const valueWrap = document.createElement("div");
    valueWrap.className = "lotus-value-field";
    const defaultUnit = loadLotusConcentrateUnitFor(concentrateId);
    valueSpan.textContent = formatDropsOrMl(0, defaultUnit, dropMl);
    const unitSelect = document.createElement("select");
    unitSelect.className = "lotus-unit-select";
    unitSelect.dataset.lotusUnitFor = concentrateId;
    const dropsOption = document.createElement("option");
    dropsOption.value = "drops";
    dropsOption.textContent = "drops";
    const mlOption = document.createElement("option");
    mlOption.value = "ml";
    mlOption.textContent = "mL";
    unitSelect.appendChild(dropsOption);
    unitSelect.appendChild(mlOption);
    unitSelect.value = defaultUnit;
    valueWrap.appendChild(valueSpan);
    valueWrap.appendChild(unitSelect);
    return valueWrap;
  }

  // Drops/mL text for one concentrate result row (shared by Mineral and
  // Recipe Concentrate rows). The unit select exists only on drops-capable rows.
  function concentrateDisplayValue(
    item: Element,
    concentrateId: string,
    ml: number,
  ): { text: string; unit: string | null } {
    const unitSelect = item.querySelector<HTMLSelectElement>("[data-lotus-unit-for]");
    const dropMl = getConcentrateDropMl(concentrateId);
    if (unitSelect && dropMl > 0) {
      const unit = normalizeLotusConcentrateUnit(unitSelect.value);
      return { text: formatDropsOrMl(ml, unit, dropMl), unit };
    }
    return { text: formatMl(ml), unit: null };
  }

  function formatDropsOrMl(ml: number, unit: string, dropMl: number): string {
    if (unit === "ml") {
      if (!Number.isFinite(ml) || ml <= 0) return "0.000";
      return ml.toFixed(3);
    }
    return String(displayedDrops(ml, dropMl));
  }

  // Row updaters only write text. What each row displays (and so the readout)
  // is worked out by computeDoses, with the same rounding helpers.
  function updateResultValues(valuesByMineral: Record<string, number>): void {
    for (const [mineralId, grams] of Object.entries(valuesByMineral)) {
      const item = resultsContainer.querySelector(`[data-mineral="${CSS.escape(mineralId)}"]`);
      if (item) {
        const valEl = item.querySelector(".result-value");
        if (valEl) valEl.textContent = formatGrams(grams);
        const nameEl = item.querySelector(".result-name");
        const name = nameEl ? nameEl.textContent : MINERAL_DB[mineralId]?.name || mineralId;
        if (grams > 0) {
          item.setAttribute(
            "aria-label",
            name + ", " + formatGrams(grams) + ", auto-selected for this recipe",
          );
        } else {
          item.removeAttribute("aria-label");
        }
      }
    }
  }

  // Recipe Concentrate rows are keyed by data-stock (not data-concentrate), so
  // they get their own updater. Amounts are mL of concentrate (the dose math
  // treats 1 g of this dilute concentrate as 1 mL), shown in drops when the
  // concentrate has a dropper size.
  function updateStockValues(valuesByStock: Record<string, number>): void {
    for (const [stockId, ml] of Object.entries(valuesByStock)) {
      const item = resultsContainer.querySelector(`[data-stock="${CSS.escape(stockId)}"]`);
      if (!item) continue;
      const valEl = item.querySelector(".result-value");
      const display = concentrateDisplayValue(item, stockId, ml);
      if (valEl) valEl.textContent = display.text;
      if (ml > 0) {
        const nameEl = item.querySelector(".result-name");
        const name = nameEl ? nameEl.textContent : stockId;
        item.setAttribute(
          "aria-label",
          name + ", " + display.text + (display.unit ? " " + display.unit : ""),
        );
      } else {
        item.removeAttribute("aria-label");
      }
    }
  }

  // Compact "5g MgSO4·7H2O · 2g MgCl2·6H2O · ..." string for the calculator's
  // stock result row. Delegates to src/lib/stock-format.ts (formatStockSpec)
  // via the window bridge. Uses MINERAL_DB.formula as the salt label.
  function formatStockResultDetail(spec: StockSpec | undefined): string {
    return window.formatStockSpec!(spec, { labelMode: "formula", includeBottleDose: false });
  }

  // `computeStockMineralGramsPerL` lives in storage.js next to other stock-spec
  // helpers; classic-script load order makes it a global by the time this file
  // runs.

  function updateConcentrateValues(valuesByConcentrate: Record<string, number>): void {
    for (const [concentrateId, ml] of Object.entries(valuesByConcentrate)) {
      const item = resultsContainer.querySelector(
        `[data-concentrate="${CSS.escape(concentrateId)}"]`,
      );
      if (!item) continue;
      const valEl = item.querySelector(".result-value");
      const display = concentrateDisplayValue(item, concentrateId, ml);
      const displayValue = display.text;
      if (valEl) valEl.textContent = displayValue;
      if (ml > 0) {
        const nameEl = item.querySelector(".result-name");
        const name = nameEl ? nameEl.textContent : concentrateId;
        const ariaValue = display.unit ? displayValue + " " + display.unit : displayValue;
        item.setAttribute("aria-label", name + ", " + ariaValue);
      } else {
        item.removeAttribute("aria-label");
      }
    }
  }

  // --- Initialize ---
  if (brewMethodToggle) {
    brewMethodToggle.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>(".brew-method-btn");
      if (!btn) return;
      if (btn.dataset.brewMethod === activeBrewMethod) return;
      setActiveBrewMethod(btn.dataset.brewMethod!);
    });
    brewMethodToggle.querySelectorAll<HTMLElement>(".brew-method-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.brewMethod === activeBrewMethod);
    });
  }
  resultsContainer.addEventListener("change", (e) => {
    const select = (e.target as HTMLElement).closest<HTMLSelectElement>("[data-lotus-unit-for]");
    if (!select) return;
    const concentrateId = select.dataset.lotusUnitFor!;
    saveLotusConcentrateUnitFor(concentrateId, select.value);
    calculate();
  });
  renderResultItems();
  buildTargetFilters();
  renderProfileButtons();
  updateTargetModeUI();
  const allTargetPresets = getTargetPresetsForBrewMethod(activeBrewMethod);
  // Saved slug may be a library row whose data hasn't lazy-loaded yet. Falling
  // back and persisting now would permanently overwrite the user's last-selected
  // library profile. Defer the fallback's persistence until refreshPresetRail()
  // confirms the slug is truly missing after the library load resolves.
  const initialSavedSlug = currentProfile;
  let initialFallbackSlug: string | null = null;
  if (!allTargetPresets[currentProfile]) {
    initialFallbackSlug = findFallbackPreset(allTargetPresets);
    currentProfile = initialFallbackSlug;
  }
  activateProfile(currentProfile);

  // When the public-recipes fetch resolves, the preset-rail cache is invalidated
  // by library-data.js. Re-render so the Supabase library rows appear without
  // requiring a page navigation.
  function refreshPresetRail(): void {
    renderProfileButtons();
    const merged = getTargetPresetsForBrewMethod(activeBrewMethod);
    // If we fell back at init because the saved slug looked unknown but it's
    // actually a library row we hadn't loaded yet, and the user hasn't picked
    // something else in the meantime, restore the saved slug.
    if (
      initialFallbackSlug &&
      initialSavedSlug !== initialFallbackSlug &&
      currentProfile === initialFallbackSlug &&
      merged[initialSavedSlug]
    ) {
      currentProfile = initialSavedSlug;
      initialFallbackSlug = null;
      activateProfile(currentProfile);
      return;
    }
    if (!merged[currentProfile]) {
      currentProfile = findFallbackPreset(merged);
      saveTargetPresetName(currentProfile);
      activateProfile(currentProfile);
    }
  }
  if (typeof window.onLibraryDataLoaded === "function") {
    window.onLibraryDataLoaded(refreshPresetRail);
  }
  if (typeof window.ensurePublicRecipesLoaded === "function") {
    window.ensurePublicRecipesLoaded();
  }
  // Cross-device sync: re-render when sync.js Realtime pull writes new data.
  window.addEventListener("cw:cloud-data-changed", refreshPresetRail);
  // A pull can also change the source water, volume, and enabled minerals /
  // concentrates this page rendered from. Re-read them (nothing is saved) so
  // the results reflect the account and the next edit doesn't write stale
  // values back over another device's change. Fields the user is typing in
  // are left alone.
  window.addEventListener("cw:cloud-data-changed", function () {
    sourceSection.refreshFromStorage();
    const active = document.activeElement;
    if (active !== volumeInput && active !== volumeUnit) {
      const stored = loadVolumePreference("calculator", {
        value: volumeInput.value,
        unit: volumeUnit.value,
      });
      volumeInput.value = stored.value;
      volumeUnit.value = stored.unit;
    }
    renderResultItems();
    calculate();
  });

  // --- Multi-tab sync: refresh results when mineral/concentrate selection changes in another tab ---
  // Include cw_stock_concentrate_specs: the calculator reads concentrate specs
  // for labels, formulas, orphan filtering, and dose totals, so editing a Recipe
  // Concentrate in Settings (another tab) must refresh the rows + doses here.
  onStorageKeysChanged(
    ["cw_selected_minerals", "cw_selected_concentrates", "cw_stock_concentrate_specs"],
    function () {
      renderResultItems();
      calculate();
    },
  );

  // Publish the two functions the index.html inline `cw:minerals-changed`
  // listener calls. As a classic script these were top-level globals; as an ES
  // module they're scoped, so expose them on window for that inline block.
  window.renderResultItems = renderResultItems;
  window.calculate = calculate;

  // --- Refresh on bfcache restore ---
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) location.reload();
  });
} // end main()

// As a deferred module, this always evaluates before DOMContentLoaded fires, so
// registering the listener (rather than calling main() directly) reliably defers
// the orchestration until the classic constants/metrics/library-data scripts
// have run.
document.addEventListener("DOMContentLoaded", main);
