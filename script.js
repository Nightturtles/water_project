// ============================================
// Coffee Water Chemistry Calculator
// ============================================

// --- Water profiles (target mineral concentrations in mg/L) ---
const PROFILES = {
  sca: {
    calcium: 51,
    magnesium: 17,
    alkalinity: 40,
    description: "SCA recommended range for brewing water. Balanced body and clarity."
  },
  rao: {
    calcium: 39,
    magnesium: 16,
    alkalinity: 40,
    description: "Scott Rao's recipe. Clean, sweet, and well-balanced for most coffees."
  },
  "hendon-light": {
    calcium: 25,
    magnesium: 35,
    alkalinity: 25,
    description: "Higher magnesium for light roasts. Enhances fruity and floral notes."
  },
  "hendon-espresso": {
    calcium: 70,
    magnesium: 20,
    alkalinity: 50,
    description: "Higher hardness for espresso. More body and texture in the cup."
  }
};

// --- Buffer descriptions ---
const BUFFER_INFO = {
  "baking-soda": {
    name: "Baking Soda",
    detail: "Sodium bicarbonate (NaHCO3)",
    description: "Sodium bicarbonate (NaHCO3) \u2014 cheap and easy to find at any grocery store."
  },
  "potassium-bicarb": {
    name: "Potassium Bicarbonate",
    detail: "Potassium bicarbonate (KHCO3)",
    description: "Potassium bicarbonate (KHCO3) \u2014 sodium-free alternative, preferred by many coffee pros."
  }
};

// --- Molecular weights and conversion factors ---
// Epsom salt: MgSO4 * 7H2O, MW = 246.47, provides Mg (MW = 24.305)
// To get X mg/L of Mg, need X * (246.47 / 24.305) mg/L of Epsom salt
const MG_TO_EPSOM = 246.47 / 24.305; // ~10.14

// Baking soda: NaHCO3, MW = 84.007
// Alkalinity is measured as mg/L CaCO3 (MW = 100.09)
// 1 mole CaCO3 = 2 moles NaHCO3 (because CaCO3 has 2 equivalents)
// mg/L NaHCO3 = alkalinity_as_CaCO3 * (2 * 84.007 / 100.09)
const ALK_TO_BAKING_SODA = (2 * 84.007) / 100.09; // ~1.679

// Potassium bicarbonate: KHCO3, MW = 100.115
// mg/L KHCO3 = alkalinity_as_CaCO3 * (2 * 100.115 / 100.09)
const ALK_TO_POTASSIUM_BICARB = (2 * 100.115) / 100.09; // ~2.001

// Calcium chloride dihydrate: CaCl2 * 2H2O, MW = 147.01, provides Ca (MW = 40.078)
// To get X mg/L of Ca, need X * (147.01 / 40.078) mg/L of CaCl2·2H2O
const CA_TO_CACL2 = 147.01 / 40.078; // ~3.667

const GALLONS_TO_LITERS = 3.78541;

// --- State ---
let currentProfile = "sca";
let currentBuffer = "baking-soda";

// --- DOM elements ---
const volumeInput = document.getElementById("volume");
const volumeUnit = document.getElementById("volume-unit");
const sourcePresetSelect = document.getElementById("source-preset");
const sourceWaterTags = document.getElementById("source-water-tags");
const targetCa = document.getElementById("target-calcium");
const targetMg = document.getElementById("target-magnesium");
const targetAlk = document.getElementById("target-alkalinity");
const profileDesc = document.getElementById("profile-description");
const bufferDesc = document.getElementById("buffer-description");
const bufferResultName = document.getElementById("buffer-result-name");
const bufferResultDetail = document.getElementById("buffer-result-detail");
const resultEpsom = document.getElementById("result-epsom");
const resultBuffer = document.getElementById("result-buffer");
const resultCaCl2 = document.getElementById("result-calcium-chloride");
const resultSummary = document.getElementById("result-summary");

// --- Populate source water dropdown ---
Object.entries(getAllPresets()).forEach(([key, preset]) => {
  const opt = document.createElement("option");
  opt.value = key;
  opt.textContent = preset.label;
  sourcePresetSelect.appendChild(opt);
});
sourcePresetSelect.value = loadSourcePresetName();

function getSourceWater() {
  return getSourceWaterByPreset(sourcePresetSelect.value);
}

function updateSourceWaterTags() {
  const water = getSourceWater();
  const ions = ["calcium", "magnesium", "bicarbonate"];
  const labels = { calcium: "Ca", magnesium: "Mg", bicarbonate: "HCO\u2083" };
  sourceWaterTags.innerHTML = ions
    .map(ion => `<span class="base-tag">${labels[ion]}: ${water[ion] || 0} mg/L</span>`)
    .join("");
}

updateSourceWaterTags();

// --- Profile button handling ---
document.querySelectorAll(".profile-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".profile-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const profile = btn.dataset.profile;
    currentProfile = profile;

    if (profile === "custom") {
      profileDesc.textContent = "Enter your own target values above.";
    } else {
      const p = PROFILES[profile];
      targetCa.value = p.calcium;
      targetMg.value = p.magnesium;
      targetAlk.value = p.alkalinity;
      profileDesc.textContent = p.description;
    }

    calculate();
  });
});

// --- Buffer button handling ---
document.querySelectorAll(".buffer-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".buffer-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    currentBuffer = btn.dataset.buffer;
    const info = BUFFER_INFO[currentBuffer];
    bufferDesc.textContent = info.description;
    bufferResultName.textContent = info.name;
    bufferResultDetail.textContent = info.detail;

    calculate();
  });
});

// --- When user manually edits target values, switch to "Custom" ---
[targetCa, targetMg, targetAlk].forEach(input => {
  input.addEventListener("input", () => {
    document.querySelectorAll(".profile-btn").forEach(b => b.classList.remove("active"));
    document.querySelector('[data-profile="custom"]').classList.add("active");
    currentProfile = "custom";
    profileDesc.textContent = "Enter your own target values above.";
    calculate();
  });
});

// --- Source water dropdown change ---
sourcePresetSelect.addEventListener("change", () => {
  saveSourcePresetName(sourcePresetSelect.value);
  updateSourceWaterTags();
  calculate();
});

// --- Recalculate on any input change ---
[volumeInput, volumeUnit].forEach(el => {
  el.addEventListener("input", calculate);
  el.addEventListener("change", calculate);
});

// --- Core calculation ---
function calculate() {
  // Get volume in liters
  let volumeL = parseFloat(volumeInput.value) || 0;
  if (volumeUnit.value === "gallons") {
    volumeL *= GALLONS_TO_LITERS;
  }

  // Guard against divide-by-zero / nonsense volume
  if (!volumeL || volumeL <= 0) {
    resultEpsom.textContent = "0.00 g";
    resultBuffer.textContent = "0.00 g";
    resultCaCl2.textContent = "0.00 g";
    resultSummary.innerHTML = `<strong>Enter a water volume</strong> to see results.`;
    return;
  }

  // Read source water from dropdown/preset
  const sourceWater = getSourceWater();

  // ---------------------------
  // Conversions & constants
  // ---------------------------
  // Fractions by mass for each salt form
  // CaCl2·2H2O (MW 147.01): Ca 40.078, Cl2 70.906
  const FRAC_CA_IN_CACL2_2H2O = 40.078 / 147.01; // ~0.2725
  const FRAC_CL_IN_CACL2_2H2O = 70.906 / 147.01; // ~0.4820

  // MgSO4·7H2O (MW 246.47): Mg 24.305, SO4 96.06
  const FRAC_MG_IN_MGSO4_7H2O = 24.305 / 246.47; // ~0.0986
  const FRAC_SO4_IN_MGSO4_7H2O = 96.06 / 246.47; // ~0.3896

  // KHCO3 (MW 100.115): K 39.0983, HCO3 61.017
  const FRAC_K_IN_KHCO3 = 39.0983 / 100.115; // ~0.3909
  const FRAC_HCO3_IN_KHCO3 = 61.017 / 100.115; // ~0.6091

  // NaHCO3 (MW 84.007): Na 22.989, HCO3 61.017
  const FRAC_NA_IN_NAHCO3 = 22.989 / 84.007; // ~0.2737
  const FRAC_HCO3_IN_NAHCO3 = 61.017 / 84.007; // ~0.7263

  // Hardness/alkalinity conversions (ppm as CaCO3)
  const CA_TO_CACO3 = 2.497; // Ca ppm -> GH contribution (as CaCO3)
  const MG_TO_CACO3 = 4.118; // Mg ppm -> GH contribution (as CaCO3)
  const HCO3_TO_CACO3 = 50.045 / 61.017; // ~0.8197 (HCO3 ppm -> alkalinity as CaCO3)

  // Convert source bicarbonate to alkalinity as CaCO3: alk_as_CaCO3 = HCO3 * (50.045 / 61.017)
  const sourceAlkAsCaCO3 = (sourceWater.bicarbonate || 0) * HCO3_TO_CACO3;

  // ---------------------------
  // Targets (UI)
  // ---------------------------
  // NOTE: In the existing UI, targetAlk is "alkalinity as CaCO3" (mg/L as CaCO3)
  const targetCaMgL = parseFloat(targetCa.value) || 0; // mg/L Ca
  const targetMgMgL = parseFloat(targetMg.value) || 0; // mg/L Mg
  const targetAlkAsCaCO3 = parseFloat(targetAlk.value) || 0; // mg/L as CaCO3

  // Mineral deltas (target - source), floored at 0
  const deltaCa = Math.max(0, targetCaMgL - (sourceWater.calcium || 0));
  const deltaMg = Math.max(0, targetMgMgL - (sourceWater.magnesium || 0));
  const deltaAlkAsCaCO3 = Math.max(0, targetAlkAsCaCO3 - sourceAlkAsCaCO3);

  // ---------------------------
  // Compute salt dosing (per L)
  // ---------------------------
  // To get X mg/L of Mg, need X * (MW_salt / MW_element) mg/L of salt
  // MG_TO_EPSOM and CA_TO_CACL2 are defined earlier in the file
  const epsomPerL = (deltaMg * MG_TO_EPSOM) / 1000; // grams per liter
  const cacl2PerL = (deltaCa * CA_TO_CACL2) / 1000; // grams per liter

  // Buffer dosing:
  // target alkalinity is in mg/L as CaCO3. Convert to grams of bicarbonate salt using the tool's constants.
  let bufferPerL;
  if (currentBuffer === "potassium-bicarb") {
    bufferPerL = (deltaAlkAsCaCO3 * ALK_TO_POTASSIUM_BICARB) / 1000; // grams per liter
  } else {
    bufferPerL = (deltaAlkAsCaCO3 * ALK_TO_BAKING_SODA) / 1000; // grams per liter
  }

  // Total grams for the full volume
  const epsomTotal = epsomPerL * volumeL;
  const bufferTotal = bufferPerL * volumeL;
  const cacl2Total = cacl2PerL * volumeL;

  // Display grams
  resultEpsom.textContent = formatGrams(epsomTotal);
  resultBuffer.textContent = formatGrams(bufferTotal);
  resultCaCl2.textContent = formatGrams(cacl2Total);

  // ---------------------------
  // Compute resulting ions (mg/L)
  // ---------------------------
  // Final Ca and Mg are simply source + delta (since we only add minerals)
  const finalCa = (sourceWater.calcium || 0) + deltaCa; // mg/L
  const finalMg = (sourceWater.magnesium || 0) + deltaMg; // mg/L

  // Convert salt grams/L to mg/L of salt
  const mgL_epsom = epsomPerL * 1000;
  const mgL_cacl2 = cacl2PerL * 1000;
  const mgL_buffer = bufferPerL * 1000;

  // Ions contributed by added salts (source presets do not track these, assume 0 in source)
  const addedCl = mgL_cacl2 * FRAC_CL_IN_CACL2_2H2O;
  const addedSO4 = mgL_epsom * FRAC_SO4_IN_MGSO4_7H2O;

  // Buffer ions (either K + HCO3 or Na + HCO3)
  const addedHCO3 =
    currentBuffer === "potassium-bicarb"
      ? mgL_buffer * FRAC_HCO3_IN_KHCO3
      : mgL_buffer * FRAC_HCO3_IN_NAHCO3;

  const addedK = currentBuffer === "potassium-bicarb" ? mgL_buffer * FRAC_K_IN_KHCO3 : 0;
  const addedNa = currentBuffer === "baking-soda" ? mgL_buffer * FRAC_NA_IN_NAHCO3 : 0;

  // Final bicarbonate (mg/L) is source bicarbonate + added bicarbonate
  const finalHCO3 = (sourceWater.bicarbonate || 0) + addedHCO3;

  // Final other ions (mg/L)
  const finalCl = addedCl;
  const finalSO4 = addedSO4;
  const finalK = addedK;
  const finalNa = addedNa;

  // ---------------------------
  // GH / KH
  // ---------------------------
  const GH_asCaCO3 = finalCa * CA_TO_CACO3 + finalMg * MG_TO_CACO3;
  const KH_asCaCO3 = finalHCO3 * HCO3_TO_CACO3;

  // ---------------------------
  // TDS reporting
  // ---------------------------
  // 1) Added-salts, mass-based "TDS" (mg/L of salts added)
  const TDS_added_salts = mgL_epsom + mgL_cacl2 + mgL_buffer;

  // 2) Ion-sum approximation (sum of major ions we track), mg/L
  // This is NOT the same as conductivity-based TDS meters, but it is intuitive.
  const TDS_ion_sum =
    finalCa + finalMg + finalHCO3 + finalCl + finalSO4 + finalK + finalNa;

  // Sulfate:Chloride ratio
  const so4ToCl = finalCl > 0 ? finalSO4 / finalCl : null;

  const bufferLabel = currentBuffer === "potassium-bicarb" ? "K" : "Na";
  const bufferIonPpm = currentBuffer === "potassium-bicarb" ? finalK : finalNa;

  // Summary HTML
  resultSummary.innerHTML =
    `<div style="line-height:1.5">` +
      `<div><strong>TDS (added salts, mass-based):</strong> ~${Math.round(TDS_added_salts)} mg/L</div>` +
      `<div><strong>TDS (ion-sum approx):</strong> ~${Math.round(TDS_ion_sum)} mg/L</div>` +
      `<div><strong>GH:</strong> ~${Math.round(GH_asCaCO3)} mg/L as CaCO\u2083</div>` +
      `<div><strong>KH:</strong> ~${Math.round(KH_asCaCO3)} mg/L as CaCO\u2083</div>` +
      `<div><strong>SO\u2084:Cl ratio:</strong> ${so4ToCl === null ? "—" : so4ToCl.toFixed(2)}</div>` +
      `<hr style="border:none;border-top:1px solid var(--gray-300);margin:8px 0" />` +
      `<div><strong>Final ions (mg/L):</strong> ` +
        `Ca ${finalCa.toFixed(2)} | ` +
        `Mg ${finalMg.toFixed(2)} | ` +
        `HCO\u2083 ${finalHCO3.toFixed(2)} | ` +
        `SO\u2084 ${finalSO4.toFixed(2)} | ` +
        `Cl ${finalCl.toFixed(2)} | ` +
        `${bufferLabel} ${bufferIonPpm.toFixed(2)}` +
      `</div>` +
    `</div>`;
}

function formatGrams(g) {
  if (!isFinite(g) || g <= 0) return "0.00 g";
  if (g < 0.01) return "0.00 g";
  if (g < 1) return g.toFixed(2) + " g";
  return g.toFixed(2) + " g";
}

// --- Initial calculation ---
calculate();
