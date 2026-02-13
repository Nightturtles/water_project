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

  // Read source water from dropdown/preset
  const sourceWater = getSourceWater();
  // Convert source bicarbonate to alkalinity as CaCO3: alk = HCO3 * (50.045 / 61.017)
  const sourceAlkAsCaCO3 = (sourceWater.bicarbonate || 0) * (50.045 / 61.017);

  // Mineral deltas (target - source), floored at 0
  const deltaCa = Math.max(0, (parseFloat(targetCa.value) || 0) - (sourceWater.calcium || 0));
  const deltaMg = Math.max(0, (parseFloat(targetMg.value) || 0) - (sourceWater.magnesium || 0));
  const deltaAlk = Math.max(0, (parseFloat(targetAlk.value) || 0) - sourceAlkAsCaCO3);

  // Grams of each salt needed per liter, then scaled to volume
  const epsomPerL = (deltaMg * MG_TO_EPSOM) / 1000; // convert mg to g
  const cacl2PerL = (deltaCa * CA_TO_CACL2) / 1000;

  let bufferPerL;
  if (currentBuffer === "potassium-bicarb") {
    bufferPerL = (deltaAlk * ALK_TO_POTASSIUM_BICARB) / 1000;
  } else {
    bufferPerL = (deltaAlk * ALK_TO_BAKING_SODA) / 1000;
  }

  const epsomTotal = epsomPerL * volumeL;
  const bufferTotal = bufferPerL * volumeL;
  const cacl2Total = cacl2PerL * volumeL;

  // Display results
  resultEpsom.textContent = formatGrams(epsomTotal);
  resultBuffer.textContent = formatGrams(bufferTotal);
  resultCaCl2.textContent = formatGrams(cacl2Total);

  // Summary
  const totalTDS = (parseFloat(targetCa.value) || 0) +
                   (parseFloat(targetMg.value) || 0) +
                   (parseFloat(targetAlk.value) || 0);

  resultSummary.innerHTML =
    `<strong>Estimated TDS:</strong> ~${Math.round(totalTDS)} mg/L &nbsp;|&nbsp; ` +
    `<strong>Hardness:</strong> ~${Math.round(deltaCa * 2.5 + deltaMg * 4.1)} mg/L as CaCO\u2083 &nbsp;|&nbsp; ` +
    `<strong>Buffer:</strong> ~${Math.round(deltaAlk)} mg/L as CaCO\u2083`;
}

function formatGrams(g) {
  if (g < 0.01) return "0.00 g";
  if (g < 1) return g.toFixed(2) + " g";
  return g.toFixed(2) + " g";
}

// --- Initial calculation ---
calculate();
