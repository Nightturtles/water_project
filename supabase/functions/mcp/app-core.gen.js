// GENERATED FILE - do not edit. Source: src/lib/mcp-core.ts
// Regenerate with: npm run mcp:build
// source-hash: e27756742019f11a9b0d254c55fe4318f416a9c0472c2750489f33f269178135
// body-hash: 5c4a739234b504851c689fa3417146ad9f849c4782a81b28dc01c61bf39ccbd8
// deno-lint-ignore-file
// deno-fmt-ignore-file
// src/lib/constants.ts
const MINERAL_DB_LITERAL = {
	"calcium-chloride": {
		name: "Calcium Chloride (Dihydrate)",
		formula: "CaCl₂·2H₂O",
		mw: 147.01,
		description: "Adds calcium and chloride. Increases sweetness and body.",
		ions: {
			calcium: 40.078 / 147.01,
			chloride: 70.906 / 147.01
		}
	},
	"calcium-chloride-anhydrous": {
		name: "Calcium Chloride (Anhydrous)",
		formula: "CaCl₂",
		mw: 110.98,
		description: "Water-free calcium chloride. Adds the same calcium and chloride as the dihydrate, but more concentrated, so you weigh out less per dose.",
		ions: {
			calcium: 40.078 / 110.98,
			chloride: 70.906 / 110.98
		}
	},
	"epsom-salt": {
		name: "Epsom Salt",
		formula: "MgSO₄·7H₂O",
		mw: 246.47,
		description: "Adds magnesium and sulfate. Enhances fruity notes and clarity.",
		ions: {
			magnesium: 24.305 / 246.47,
			sulfate: 96.06 / 246.47
		}
	},
	"baking-soda": {
		name: "Baking Soda",
		formula: "NaHCO₃",
		mw: 84.007,
		description: "Adds sodium and bicarbonate (alkalinity/KH). Buffers acidity.",
		ions: {
			sodium: 22.99 / 84.007,
			bicarbonate: 61.017 / 84.007
		}
	},
	"potassium-bicarbonate": {
		name: "Potassium Bicarbonate",
		formula: "KHCO₃",
		mw: 100.115,
		description: "Sodium-free alkalinity source. Adds potassium and bicarbonate.",
		ions: {
			potassium: 39.098 / 100.115,
			bicarbonate: 61.017 / 100.115
		}
	},
	"magnesium-chloride": {
		name: "Magnesium Chloride",
		formula: "MgCl₂·6H₂O",
		mw: 203.3,
		description: "Adds magnesium and chloride. Fruity notes with added body.",
		ions: {
			magnesium: 24.305 / 203.3,
			chloride: 70.906 / 203.3
		}
	},
	gypsum: {
		name: "Gypsum",
		formula: "CaSO₄·2H₂O",
		mw: 172.17,
		description: "Adds calcium and sulfate. Sweetness with crisp clarity.",
		ions: {
			calcium: 40.078 / 172.17,
			sulfate: 96.06 / 172.17
		}
	},
	"potassium-chloride": {
		name: "Potassium Chloride",
		formula: "KCl",
		mw: 74.551,
		description: "Adds potassium and chloride. Salt substitute, adds body.",
		ions: {
			potassium: 39.098 / 74.551,
			chloride: 35.453 / 74.551
		}
	},
	"sodium-chloride": {
		name: "Sodium Chloride",
		formula: "NaCl",
		mw: 58.44,
		description: "Table salt. Adds sodium and chloride. Small amounts enhance sweetness.",
		ions: {
			sodium: 22.99 / 58.44,
			chloride: 35.453 / 58.44
		}
	}
};
const MINERAL_DB = MINERAL_DB_LITERAL;
const MINERAL_SOLUBILITY_G_PER_L_25C_APPROX = {
	"calcium-chloride": 700,
	"calcium-chloride-anhydrous": 745,
	"epsom-salt": 700,
	"baking-soda": 96,
	"potassium-bicarbonate": 330,
	"magnesium-chloride": 560,
	gypsum: 2,
	"potassium-chloride": 340,
	"sodium-chloride": 360
};
const RESERVED_LIBRARY_STOCK_SLUGS = [
	"rao-perger",
	"dan-eils",
	"matt-perger",
	"rao-2013",
	"melbourne-2013-wbc",
	"world-of-coffee-budapest",
	"bh-simplified-sca-optimal",
	"bh-default",
	"bh-simplified-rao-2008",
	"bh-simplified-hendon",
	"bh-hard",
	"bh-hard-af"
];
const ION_FIELDS = [
	"calcium",
	"magnesium",
	"potassium",
	"sodium",
	"sulfate",
	"chloride",
	"bicarbonate"
];
const SOURCE_PRESETS = {
	distilled: {
		label: "Distilled / RO",
		category: "pure",
		calcium: 0,
		magnesium: 0,
		potassium: 0,
		sodium: 0,
		sulfate: 0,
		chloride: 0,
		bicarbonate: 0
	},
	"soft-tap": {
		label: "Soft Tap Water",
		category: "generic",
		calcium: 15,
		magnesium: 3,
		potassium: 1,
		sodium: 10,
		sulfate: 5,
		chloride: 12,
		bicarbonate: 30
	},
	"hard-tap": {
		label: "Hard Tap Water",
		category: "generic",
		calcium: 60,
		magnesium: 15,
		potassium: 2,
		sodium: 20,
		sulfate: 25,
		chloride: 30,
		bicarbonate: 120
	},
	volvic: {
		label: "Volvic",
		category: "bottled",
		calcium: 12,
		magnesium: 8,
		potassium: 6.2,
		sodium: 12,
		sulfate: 8.1,
		chloride: 15,
		bicarbonate: 71
	},
	voss: {
		label: "Voss Still",
		category: "bottled",
		calcium: 5,
		magnesium: 1,
		potassium: .4,
		sodium: 6,
		sulfate: 4,
		chloride: 7,
		bicarbonate: 30
	},
	"crystal-geyser-olancha": {
		label: "Crystal Geyser (Olancha, CA)",
		category: "bottled",
		calcium: 20,
		magnesium: 2.1,
		potassium: 1.9,
		sodium: 17,
		sulfate: 24,
		chloride: 3.2,
		bicarbonate: 65
	},
	"crystal-geyser-shasta": {
		label: "Crystal Geyser (Mt Shasta, CA)",
		category: "bottled",
		calcium: 5.9,
		magnesium: 5.2,
		potassium: 1.2,
		sodium: 11,
		sulfate: 1.9,
		chloride: .82,
		bicarbonate: 56
	},
	custom: { label: "+ Add Custom" }
};
const TARGET_PRESETS = {
	"cafelytic-filter": {
		label: "Cafelytic Filter",
		brewMethod: "filter",
		calcium: 4,
		magnesium: 11,
		alkalinity: 11,
		potassium: 9,
		sodium: 0,
		sulfate: 16,
		chloride: 26,
		bicarbonate: 13,
		description: "Cafelytic in-house light-roast filter recipe. Mg-dominant with a chloride and sulfate blend, sodium-free, K-buffered."
	},
	sca: {
		label: "SCA Standard",
		calcium: 51,
		magnesium: 17,
		alkalinity: 40,
		description: "SCA recommended range for brewing water. Balanced body and clarity."
	},
	"lotus-light-bright": {
		label: "Light & Bright",
		brewMethod: "filter",
		calcium: 22.832,
		magnesium: 0,
		alkalinity: 24.245,
		potassium: 18.941,
		sodium: 0,
		sulfate: 0,
		chloride: 40.395,
		bicarbonate: 29.56,
		description: "Lotus recipe emphasizing high clarity and acidity for lighter coffees."
	},
	"lotus-simple-sweet": {
		label: "Simple & Sweet",
		brewMethod: "filter",
		calcium: 22.832,
		magnesium: 7.882,
		alkalinity: 40.476,
		potassium: 12.628,
		sodium: 11.169,
		sulfate: 0,
		chloride: 63.389,
		bicarbonate: 49.35,
		description: "Lotus balanced profile with added sweetness and approachable acidity."
	},
	"cafelytic-espresso": {
		label: "Cafelytic Espresso",
		brewMethod: "espresso",
		calcium: 2.16,
		magnesium: 8.65,
		alkalinity: 17.3,
		potassium: 13.51,
		sodium: 0,
		sulfate: 0,
		chloride: 29.19,
		bicarbonate: 21.09,
		description: "Cafelytic in-house espresso companion to Cafelytic Filter. Direct dosing per 1.85L: 0.015g CaCl₂·2H₂O + 0.134g MgCl₂·6H₂O + 0.064g KHCO₃. Preserves the Cafelytic house character (Cl-heavy, no SO₄, sodium-free, K-buffered) at espresso concentrations."
	},
	"eaf-rpavlis": {
		label: "RPavlis",
		brewMethod: "espresso",
		calcium: 0,
		magnesium: 0,
		alkalinity: 50,
		potassium: 39,
		sodium: 0,
		sulfate: 0,
		chloride: 0,
		bicarbonate: 60.9,
		description: "Espresso Aficionados direct dosing: 1.000g KHCO3 per 10L."
	},
	"lotus-light-bright-espresso": {
		label: "Light & Bright (espresso)",
		brewMethod: "espresso",
		calcium: 0,
		magnesium: 3.941,
		alkalinity: 44.449,
		potassium: 34.726,
		sodium: 0,
		sulfate: 0,
		chloride: 11.497,
		bicarbonate: 54.194,
		description: "Lotus espresso profile for clarity-forward shots with restrained hardness."
	},
	"lotus-simple-sweet-espresso": {
		label: "Simple & Sweet (espresso)",
		brewMethod: "espresso",
		calcium: 0,
		magnesium: 3.941,
		alkalinity: 56.73,
		potassium: 0,
		sodium: 26.061,
		sulfate: 0,
		chloride: 11.497,
		bicarbonate: 69.167,
		description: "Lotus espresso profile with higher buffer for sweeter, rounder shots."
	}
};
const LIBRARY_TAGS = [
	"Full Body",
	"Balanced",
	"Bright",
	"Sweet",
	"Juicy",
	"Clarity"
];
const LEGACY_RESERVED_TARGET_KEYS = ["rao", "cafelytic-filter-sulfate-free"];
const BUILTIN_TARGET_KEYS = Object.keys(TARGET_PRESETS);
const RESERVED_TARGET_KEYS = /* @__PURE__ */ new Set([
	...BUILTIN_TARGET_KEYS,
	...LEGACY_RESERVED_TARGET_KEYS,
	"custom",
	"library"
]);
const BUILTIN_TARGET_LABELS = {};
for (const [key, preset] of Object.entries(TARGET_PRESETS)) BUILTIN_TARGET_LABELS[key] = preset.label;
const CA_TO_CACO3 = 100.09 / 40.078;
const MG_TO_CACO3 = 100.09 / 24.305;
const HCO3_TO_CACO3 = 50.045 / 61.017;
const CACO3_TO_HCO3 = 61.017 / 50.045;
const MW_CACO3 = 100.09;
const ALK_TO_BAKING_SODA = 2 * MINERAL_DB_LITERAL["baking-soda"].mw / MW_CACO3;
const ALK_TO_POTASSIUM_BICARB = 2 * MINERAL_DB_LITERAL["potassium-bicarbonate"].mw / MW_CACO3;
const LOTUS_DROPPER_ML = {
	round: .0716,
	straight: .0386
};
const BRAND_CONCENTRATES = {
	"brand:lotus:calcium": {
		name: "Calcium",
		mineralId: "calcium-chloride",
		formula: "CaCl₂·2H₂O",
		gramsPerMl: .1671,
		description: "~113.7 mg/mL hardness as CaCO₃ (≈ 45.5 mg/mL Ca²⁺). Calibrated so 69 round drops in 15L yields ~15 mg/L Ca and ~26.5 mg/L Cl."
	},
	"brand:lotus:magnesium": {
		name: "Magnesium",
		mineralId: "magnesium-chloride",
		formula: "MgCl₂·6H₂O",
		gramsPerMl: .2302,
		description: "~113.4 mg/mL hardness as CaCO₃ (≈ 27.5 mg/mL Mg²⁺). Calibrated so 274 round drops in 15L yields ~36 mg/L Mg and ~105.0 mg/L Cl."
	},
	"brand:lotus:sodium-bicarbonate": {
		name: "Sodium Bicarbonate",
		mineralId: "baking-soda",
		formula: "NaHCO₃",
		gramsPerMl: .095,
		description: "~150.2 mg/mL alkalinity as CaCO₃ (≈ 26.0 mg/mL Na⁺; ≈ 69.0 mg/mL HCO₃⁻). Calibrated so 556 round drops in 15L yields ~69 mg/L Na and ~183.1 mg/L HCO₃."
	},
	"brand:lotus:potassium-bicarbonate": {
		name: "Potassium Bicarbonate",
		mineralId: "potassium-bicarbonate",
		formula: "KHCO₃",
		gramsPerMl: .1129,
		description: "~149.8 mg/mL alkalinity as CaCO₃ (≈ 44.1 mg/mL K⁺; ≈ 68.8 mg/mL HCO₃⁻). Calibrated so 556 round drops in 15L yields ~117 mg/L K and ~182.6 mg/L HCO₃."
	}
};
Object.keys(BRAND_CONCENTRATES).filter((id) => id.startsWith("brand:lotus:"));
const WATER_PROFILE_RANGE_BANDS = {
	filter: {
		tds: {
			preferredMin: 50,
			preferredMax: 300,
			warnMin: 30,
			warnMax: 400,
			dangerMin: 20,
			dangerMax: 500
		},
		kh: {
			preferredMin: 30,
			preferredMax: 90,
			warnMin: 10,
			warnMax: 130,
			dangerMin: 5,
			dangerMax: 200
		},
		gh: {
			preferredMin: 40,
			preferredMax: 200,
			warnMin: 20,
			warnMax: 250,
			dangerMin: null,
			dangerMax: 300
		},
		calcium: {
			preferredMin: 8,
			preferredMax: 90,
			warnMin: 4,
			warnMax: 120,
			dangerMin: null,
			dangerMax: 160
		},
		magnesium: {
			preferredMin: 2,
			preferredMax: 40,
			warnMin: 1,
			warnMax: 55,
			dangerMin: null,
			dangerMax: 75
		},
		sodium: {
			default: {
				preferredMax: 10,
				warnMax: 30,
				dangerMax: 45
			},
			bakingSoda: {
				preferredMax: 25,
				warnMax: 40,
				dangerMax: 60
			}
		},
		chloride: {
			default: {
				preferredMax: 30,
				warnMax: 50,
				dangerMax: 100
			},
			chlorideHeavy: {
				preferredMax: 90,
				warnMax: 130,
				dangerMax: 180
			}
		},
		sulfate: { warnMax: 150 },
		potassium: { dangerMax: 100 }
	},
	espresso: {
		tds: {
			preferredMin: 60,
			preferredMax: 260,
			warnMin: 35,
			warnMax: 350,
			dangerMin: 20,
			dangerMax: 450
		},
		kh: {
			preferredMin: 20,
			preferredMax: 70,
			warnMin: 10,
			warnMax: 100,
			dangerMin: 5,
			dangerMax: 150
		},
		gh: {
			preferredMin: 15,
			preferredMax: 180,
			warnMin: 8,
			warnMax: 240,
			dangerMin: null,
			dangerMax: 260
		},
		calcium: {
			preferredMin: 0,
			preferredMax: 70,
			warnMin: null,
			warnMax: 110,
			dangerMin: null,
			dangerMax: 150
		},
		magnesium: {
			preferredMin: 2,
			preferredMax: 45,
			warnMin: 1,
			warnMax: 60,
			dangerMin: null,
			dangerMax: 80
		},
		sodium: {
			default: {
				preferredMax: 20,
				warnMax: 35,
				dangerMax: 50
			},
			bakingSoda: {
				preferredMax: 30,
				warnMax: 45,
				dangerMax: 65
			}
		},
		chloride: {
			default: {
				preferredMax: 50,
				warnMax: 75,
				dangerMax: 130
			},
			chlorideHeavy: {
				preferredMax: 110,
				warnMax: 150,
				dangerMax: 210
			}
		},
		sulfate: { warnMax: 170 },
		potassium: { dangerMax: 120 }
	}
};
const RANGE_SEVERITY_ORDER = {
	danger: 0,
	warn: 1,
	info: 2
};
const THEME_KEY = "cw_theme";
// src/lib/storage-keys.ts
const KEYS = {
	SOURCE_WATER: "cw_source_water",
	SOURCE_PRESET: "cw_source_preset",
	TARGET_PRESET: "cw_target_preset",
	BREW_METHOD: "cw_brew_method",
	SELECTED_MINERALS: "cw_selected_minerals",
	SELECTED_CONCENTRATES: "cw_selected_concentrates",
	LOTUS_DROPPER_TYPE: "cw_lotus_dropper_type",
	LOTUS_CONCENTRATE_UNITS: "cw_lotus_concentrate_units",
	LOTUS_CONCENTRATE_UNIT: "cw_lotus_concentrate_unit",
	MINERAL_DISPLAY_MODE: "cw_mineral_display_mode",
	MINERAL_SELECTOR_TAB: "cw_mineral_selector_tab",
	RECIPE_MINERAL_INPUTS: "cw_recipe_mineral_inputs",
	RECIPE_CONCENTRATE_INPUTS: "cw_recipe_concentrate_inputs",
	RECIPE_STOCK_GRAMS: "cw_recipe_stock_grams",
	RECIPE_DISPENSE_MODE: "cw_recipe_dispense_mode",
	RECIPE_SUPPLEMENT_PANEL_OPEN: "cw_recipe_supplement_panel_open",
	TARGET_DRAFT_IONS: "cw_target_draft_ions",
	CUSTOM_PROFILES: "cw_custom_profiles",
	CUSTOM_TARGET_PROFILES: "cw_custom_target_profiles",
	STOCK_CONCENTRATE_SPECS: "cw_stock_concentrate_specs",
	DIY_CONCENTRATE_SPECS: "cw_diy_concentrate_specs",
	DELETED_PRESETS: "cw_deleted_presets",
	DELETED_TARGET_PRESETS: "cw_deleted_target_presets",
	ADDED_TARGET_PRESETS: "cw_added_target_presets",
	CREATOR_DISPLAY_NAME: "cw_creator_display_name",
	LAST_PUSHED_SETTINGS: "cw_last_pushed_settings",
	LAST_PUSHED_SELECTIONS: "cw_last_pushed_selections",
	LAST_PUSHED_SOURCE_PROFILES: "cw_last_pushed_source_profiles",
	LAST_PUSHED_TARGET_PROFILES: "cw_last_pushed_target_profiles",
	PENDING_PUSH_SETTINGS: "cw_pending_push_settings",
	PENDING_PUSH_SELECTIONS: "cw_pending_push_selections",
	SYNCED_USER_ID: "cw_synced_user_id",
	STARTER_MIGRATION_APPLIED: "cw_starter_migration_applied"
};
const VOLUME_PREFIX = "cw_volume_";
const CATEGORY_A = [
	KEYS.SOURCE_WATER,
	KEYS.SOURCE_PRESET,
	KEYS.TARGET_PRESET,
	KEYS.BREW_METHOD,
	KEYS.SELECTED_MINERALS,
	KEYS.SELECTED_CONCENTRATES,
	KEYS.LOTUS_DROPPER_TYPE,
	KEYS.LOTUS_CONCENTRATE_UNITS,
	KEYS.LOTUS_CONCENTRATE_UNIT,
	KEYS.MINERAL_DISPLAY_MODE,
	KEYS.MINERAL_SELECTOR_TAB,
	KEYS.RECIPE_MINERAL_INPUTS,
	KEYS.RECIPE_CONCENTRATE_INPUTS,
	KEYS.RECIPE_STOCK_GRAMS,
	KEYS.RECIPE_DISPENSE_MODE,
	KEYS.RECIPE_SUPPLEMENT_PANEL_OPEN,
	KEYS.TARGET_DRAFT_IONS
];
const CATEGORY_B = [
	KEYS.CUSTOM_PROFILES,
	KEYS.CUSTOM_TARGET_PROFILES,
	KEYS.STOCK_CONCENTRATE_SPECS,
	KEYS.DIY_CONCENTRATE_SPECS,
	KEYS.DELETED_PRESETS,
	KEYS.DELETED_TARGET_PRESETS,
	KEYS.ADDED_TARGET_PRESETS,
	KEYS.CREATOR_DISPLAY_NAME
];
const CATEGORY_C = [
	KEYS.LAST_PUSHED_SETTINGS,
	KEYS.LAST_PUSHED_SELECTIONS,
	KEYS.LAST_PUSHED_SOURCE_PROFILES,
	KEYS.LAST_PUSHED_TARGET_PROFILES,
	KEYS.PENDING_PUSH_SETTINGS,
	KEYS.PENDING_PUSH_SELECTIONS,
	KEYS.SYNCED_USER_ID,
	KEYS.STARTER_MIGRATION_APPLIED
];
[
	...CATEGORY_A,
	...CATEGORY_B,
	...CATEGORY_C
];
[...CATEGORY_A];
// src/lib/report.ts
const MAX_REPORTS_PER_AREA = 3;
const reportCounts = {};
const NETWORK_ERROR_RE = /failed to fetch|load failed|networkerror|network request failed|network connection was lost|internet connection appears to be offline/i;
function looksLikeNetworkError(err) {
	if (typeof err === "string") return NETWORK_ERROR_RE.test(err);
	if (!err || typeof err !== "object") return false;
	const e = err;
	if (e.code !== void 0 && e.code !== null && e.code !== "") return false;
	return NETWORK_ERROR_RE.test(String(e.message ?? ""));
}
function isTransientNetworkError(err) {
	if (looksLikeNetworkError(err)) return true;
	const cause = err?.cause;
	if (Array.isArray(cause)) return cause.length > 0 && cause.every(looksLikeNetworkError);
	if (cause != null) return looksLikeNetworkError(cause);
	return false;
}
function postgrestFields(err) {
	if (!err || typeof err !== "object") return void 0;
	const e = err;
	const fields = {};
	if (e.code) fields.code = e.code;
	if (e.details) fields.details = e.details;
	if (e.hint) fields.hint = e.hint;
	return Object.keys(fields).length > 0 ? fields : void 0;
}
function reportError(area, err, extra) {
	console.warn("[" + area + "]", err, extra || "");
	const sentry = typeof window !== "undefined" ? window.Sentry : void 0;
	if (isTransientNetworkError(err)) {
		if (sentry && typeof sentry.addBreadcrumb === "function") sentry.addBreadcrumb({
			category: area,
			level: "info",
			message: "transient network failure (not reported): " + String(err?.message ?? err)
		});
		return;
	}
	const count = reportCounts[area] ?? 0;
	if (count >= MAX_REPORTS_PER_AREA) return;
	reportCounts[area] = count + 1;
	if (!sentry) return;
	if (err instanceof Error && typeof sentry.captureException === "function") sentry.captureException(err, {
		tags: { area },
		extra
	});
	else if (typeof sentry.captureMessage === "function") {
		const pgFields = postgrestFields(err);
		sentry.captureMessage(area + ": " + String(err && err.message || err), {
			level: "warning",
			tags: { area },
			extra: pgFields ? {
				...extra,
				...pgFields
			} : extra
		});
	}
}
// src/lib/mineral-sources.ts
/** MINERAL_DB id a single-mineral concentrate supplies (diy: or brand:), else null. */
function concentrateMineralId(concentrateId) {
	if (typeof concentrateId !== "string") return null;
	if (concentrateId.startsWith("diy:")) return concentrateId.slice(4) || null;
	const brand = BRAND_CONCENTRATES[concentrateId];
	return brand ? brand.mineralId : null;
}
/** Grams of salt per mL of a Mineral Concentrate; 0 until bottle mL and grams are both set. */
function diyGramsPerMl(spec) {
	const bottleMl = spec ? Number(spec.bottleMl) : 0;
	const gramsPerBottle = spec ? Number(spec.gramsPerBottle) : 0;
	if (!Number.isFinite(bottleMl) || !Number.isFinite(gramsPerBottle)) return 0;
	if (bottleMl <= 0 || gramsPerBottle <= 0) return 0;
	return gramsPerBottle / bottleMl;
}
/** Grams of equivalent salt per mL for a diy: or brand: concentrate; 0 when unknown. */
function concentrateGramsPerMl(concentrateId, diySpecs) {
	if (typeof concentrateId !== "string") return 0;
	if (concentrateId.startsWith("diy:")) {
		const mineralId = concentrateId.slice(4);
		return mineralId ? diyGramsPerMl(diySpecs && diySpecs[mineralId]) : 0;
	}
	const brand = BRAND_CONCENTRATES[concentrateId];
	if (brand && Number.isFinite(brand.gramsPerMl)) return brand.gramsPerMl;
	return 0;
}
/**
* Normalize a user-entered mL-per-drop value: a positive finite number
* rounded to DROP_ML_DECIMALS, or null when blank / zero / invalid (null
* means "no dropper set", so the concentrate stays mL-only). Values that
* round to 0 are treated as unset.
*/
function normalizeDropMl(value) {
	if (value === null || value === void 0 || value === "") return null;
	const n = typeof value === "number" ? value : parseFloat(String(value));
	if (!Number.isFinite(n) || n <= 0) return null;
	const factor = Math.pow(10, 3);
	const rounded = Math.round(n * factor) / factor;
	return rounded > 0 ? rounded : null;
}
/** mL per drop of the selected Lotus dropper style (round when unknown). */
function lotusDropMl(dropperType) {
	const selectedMl = Number(LOTUS_DROPPER_ML[String(dropperType)]);
	if (Number.isFinite(selectedMl) && selectedMl > 0) return selectedMl;
	const fallbackMl = Number(LOTUS_DROPPER_ML.round);
	return Number.isFinite(fallbackMl) && fallbackMl > 0 ? fallbackMl : .0716;
}
/**
* mL per drop for a concentrate, or 0 when it isn't dosed in drops. Lotus
* brand concentrates use the selected Lotus dropper style; Mineral (diy:) and
* Recipe (stock:) Concentrates use the dropper size saved on their spec.
*/
function concentrateDropMl(concentrateId, saved) {
	if (typeof concentrateId !== "string") return 0;
	if (concentrateId.startsWith("brand:lotus:")) return lotusDropMl(saved.lotusDropperType);
	if (concentrateId.startsWith("diy:")) {
		const spec = saved.diySpecs && saved.diySpecs[concentrateId.slice(4)];
		return spec && normalizeDropMl(spec.dropMl) || 0;
	}
	if (concentrateId.startsWith("stock:")) {
		const spec = saved.stockSpecs && saved.stockSpecs[concentrateId.slice(6)];
		return spec && normalizeDropMl(spec.dropMl) || 0;
	}
	return 0;
}
/** Every salt the kit can supply: powders, concentrates, and Recipe Concentrate contents. */
function availableMineralIds(kit) {
	const out = new Set(kit.minerals);
	for (const c of kit.concentrates) if (c.mineralId) out.add(c.mineralId);
	for (const rc of kit.recipeConcentrates) for (const mid of rc.mineralIds) out.add(mid);
	return Array.from(out);
}
/**
* The salts of one slot (alkalinity, calcium or magnesium) the kit can dose
* from. A single-mineral concentrate whose bottle isn't configured can't dose
* anything, so it only counts when the slot has nothing else: counted
* alongside a working source it drew part (or all) of the slot's dose onto a
* salt nobody could add, and that mineral was left out of the water. Alone,
* it keeps the slot so its row shows with the "set bottle mL" prompt.
*/
function slotMineralIds(kit, slot) {
	const usable = new Set(kit.minerals);
	for (const c of kit.concentrates) if (c.mineralId && c.gramsPerMl > 0) usable.add(c.mineralId);
	for (const rc of kit.recipeConcentrates) for (const mid of rc.mineralIds) usable.add(mid);
	const fromUsable = slot.filter((id) => usable.has(id));
	if (fromUsable.length > 0) return fromUsable;
	const all = availableMineralIds(kit);
	return slot.filter((id) => all.includes(id));
}
const ALKALINITY_SLOT = ["baking-soda", "potassium-bicarbonate"];
const CALCIUM_SLOT = [
	"calcium-chloride",
	"calcium-chloride-anhydrous",
	"gypsum"
];
const MAGNESIUM_SLOT = ["epsom-salt", "magnesium-chloride"];
/** Enabled alkalinity sources (baking-soda and/or potassium-bicarbonate). */
function alkalinitySources(kit) {
	const selected = slotMineralIds(kit, ALKALINITY_SLOT);
	const hasBakingSoda = selected.includes("baking-soda");
	const hasPotBicarb = selected.includes("potassium-bicarbonate");
	if (!hasBakingSoda && !hasPotBicarb) return [];
	if (hasBakingSoda && hasPotBicarb) return ["baking-soda", "potassium-bicarbonate"];
	if (hasBakingSoda) return ["baking-soda"];
	return ["potassium-bicarbonate"];
}
/**
* The two calcium-chloride forms (dihydrate `calcium-chloride` and anhydrous
* `calcium-chloride-anhydrous`) are chemically interchangeable: same Ca:Cl
* ratio, differing only in grams per dose. The derivation logic treats them as
* a single calcium-source slot, so collapse them to one representative here.
* When both are enabled the dihydrate wins, unless the anhydrous form comes
* from a configured single-mineral concentrate and the dihydrate doesn't.
*/
function calciumChlorideForm(kit, selected) {
	if (selected.includes("calcium-chloride") && selected.includes("calcium-chloride-anhydrous")) {
		const concentrateForms = new Set(kit.concentrates.filter((c) => c.gramsPerMl > 0).map((c) => c.mineralId).filter((id) => !!id));
		if (concentrateForms.has("calcium-chloride-anhydrous") && !concentrateForms.has("calcium-chloride")) return "calcium-chloride-anhydrous";
		return "calcium-chloride";
	}
	if (selected.includes("calcium-chloride")) return "calcium-chloride";
	if (selected.includes("calcium-chloride-anhydrous")) return "calcium-chloride-anhydrous";
	return null;
}
/** Enabled calcium sources (a calcium-chloride form and/or gypsum). */
function calciumSources(kit) {
	const selected = slotMineralIds(kit, CALCIUM_SLOT);
	const out = [];
	const cacl2 = calciumChlorideForm(kit, selected);
	if (cacl2) out.push(cacl2);
	if (selected.includes("gypsum")) out.push("gypsum");
	return out;
}
/** Enabled magnesium sources (epsom-salt and/or magnesium-chloride). */
function magnesiumSources(kit) {
	const selected = slotMineralIds(kit, MAGNESIUM_SLOT);
	const out = [];
	if (selected.includes("epsom-salt")) out.push("epsom-salt");
	if (selected.includes("magnesium-chloride")) out.push("magnesium-chloride");
	return out;
}
/** One calcium source for range bands: the calcium-chloride form wins over gypsum. */
function singleCalciumSource(sources) {
	if (sources.length === 0) return null;
	if (sources.length === 1) return sources[0] ?? null;
	return sources.find((s) => s !== "gypsum") ?? sources[0] ?? null;
}
/** One magnesium source for range bands: epsom-salt wins when both are enabled. */
function singleMagnesiumSource(sources) {
	if (sources.length === 0) return null;
	if (sources.length === 1) return sources[0] ?? null;
	return "epsom-salt";
}
// src/lib/storage.ts
function safeGetItem(key) {
	try {
		return localStorage.getItem(key);
	} catch (e) {
		reportError("storage.get", e, { key });
		return null;
	}
}
function safeSetItem(key, value) {
	try {
		localStorage.setItem(key, value);
		return true;
	} catch (e) {
		reportError("storage.set", e, { key });
		return false;
	}
}
function safeRemoveItem(key) {
	try {
		localStorage.removeItem(key);
	} catch (e) {
		reportError("storage.remove", e, { key });
	}
}
function _isLoggedInSync() {
	return typeof window !== "undefined" && typeof window.isLoggedInSync === "function" && window.isLoggedInSync();
}
function _getTransient(key) {
	try {
		return (_isLoggedInSync() ? localStorage : sessionStorage).getItem(key);
	} catch (e) {
		return null;
	}
}
function _setTransient(key, value) {
	try {
		(_isLoggedInSync() ? localStorage : sessionStorage).setItem(key, value);
		return true;
	} catch (e) {
		return false;
	}
}
function _getGated(key) {
	if (!_isLoggedInSync()) return null;
	return safeGetItem(key);
}
function _setGated(key, value) {
	if (!_isLoggedInSync()) return false;
	return safeSetItem(key, value);
}
function safeParse(json, fallback) {
	if (!json) return fallback;
	try {
		return JSON.parse(json) ?? fallback;
	} catch (_) {
		return fallback;
	}
}
function saveSourceWater(profile) {
	const ok = _setTransient(KEYS.SOURCE_WATER, JSON.stringify(profile));
	if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
	return ok;
}
function loadSourceWater() {
	const fallback = {
		calcium: 0,
		magnesium: 0,
		potassium: 0,
		sodium: 0,
		sulfate: 0,
		chloride: 0,
		bicarbonate: 0
	};
	const parsed = safeParse(_getTransient(KEYS.SOURCE_WATER), fallback);
	return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
}
function saveSourcePresetName(name) {
	_setTransient(KEYS.SOURCE_PRESET, name);
	if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}
function loadSourcePresetName() {
	return _getTransient(KEYS.SOURCE_PRESET) || "distilled";
}
function saveMineralDisplayMode(mode) {
	_setTransient(KEYS.MINERAL_DISPLAY_MODE, mode === "advanced" ? "advanced" : "standard");
	if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}
function loadMineralDisplayMode() {
	return _getTransient(KEYS.MINERAL_DISPLAY_MODE) === "advanced" ? "advanced" : "standard";
}
function isAdvancedMineralDisplayMode() {
	return loadMineralDisplayMode() === "advanced";
}
function saveVolumePreference(pageKey, value, unit) {
	if (!pageKey) return;
	_setTransient(VOLUME_PREFIX + pageKey, JSON.stringify({
		value: String(value ?? ""),
		unit: unit === "gallons" ? "gallons" : "liters"
	}));
	if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}
function loadVolumePreference(pageKey, defaults = {}) {
	const fallback = {
		value: String(defaults.value ?? "1"),
		unit: defaults.unit === "gallons" ? "gallons" : "liters"
	};
	if (!pageKey) return fallback;
	const parsed = safeParse(_getTransient(VOLUME_PREFIX + pageKey), fallback);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
	return {
		value: String(parsed.value ?? fallback.value),
		unit: parsed.unit === "gallons" ? "gallons" : "liters"
	};
}
function slugify(name) {
	return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
let customProfilesCache = null;
function loadCustomProfiles() {
	if (customProfilesCache) return Object.assign({}, customProfilesCache);
	const parsed = safeParse(_getGated(KEYS.CUSTOM_PROFILES), {});
	customProfilesCache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	return Object.assign({}, customProfilesCache);
}
function saveCustomProfiles(profiles) {
	liftTombstonesForNewlyAddedSlugs(profiles, customProfilesCache, loadDeletedPresets, KEYS.DELETED_PRESETS, invalidateSourcePresetsCache);
	const ok = _setGated(KEYS.CUSTOM_PROFILES, JSON.stringify(profiles));
	customProfilesCache = null;
	invalidateSourcePresetsCache();
	if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
	return ok;
}
function liftTombstonesForNewlyAddedSlugs(newProfiles, oldCache, loadFn, storageKey, invalidateFn) {
	const tombstones = loadFn();
	if (tombstones.length === 0) return;
	const oldProfiles = oldCache || {};
	const newSlugs = Object.keys(newProfiles).filter(function(slug) {
		return !Object.prototype.hasOwnProperty.call(oldProfiles, slug);
	});
	if (newSlugs.length === 0) return;
	const filtered = tombstones.filter(function(slug) {
		return newSlugs.indexOf(slug) === -1;
	});
	if (filtered.length !== tombstones.length) {
		safeSetItem(storageKey, JSON.stringify(filtered));
		if (typeof invalidateFn === "function") invalidateFn();
	}
}
function deleteCustomProfile(key) {
	const profiles = loadCustomProfiles();
	delete profiles[key];
	saveCustomProfiles(profiles);
	addDeletedPreset(key);
}
function loadDeletedPresets() {
	const parsed = safeParse(_getGated(KEYS.DELETED_PRESETS), []);
	return Array.isArray(parsed) ? parsed : [];
}
function addDeletedPreset(key) {
	const deleted = loadDeletedPresets();
	if (!deleted.includes(key)) {
		deleted.push(key);
		_setGated(KEYS.DELETED_PRESETS, JSON.stringify(deleted));
		invalidateSourcePresetsCache();
		if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
	}
}
let customTargetProfilesCache = null;
function loadCustomTargetProfiles() {
	if (customTargetProfilesCache) return Object.assign({}, customTargetProfilesCache);
	const parsed = safeParse(_getGated(KEYS.CUSTOM_TARGET_PROFILES), {});
	customTargetProfilesCache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	return Object.assign({}, customTargetProfilesCache);
}
function saveCustomTargetProfiles(profiles) {
	liftTombstonesForNewlyAddedSlugs(profiles, customTargetProfilesCache, loadDeletedTargetPresets, KEYS.DELETED_TARGET_PRESETS, invalidateTargetPresetsCache);
	const ok = _setGated(KEYS.CUSTOM_TARGET_PROFILES, JSON.stringify(profiles));
	customTargetProfilesCache = null;
	invalidateTargetPresetsCache();
	if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
	return ok;
}
function deleteCustomTargetProfile(key) {
	const profiles = loadCustomTargetProfiles();
	delete profiles[key];
	saveCustomTargetProfiles(profiles);
	addDeletedTargetPreset(key);
}
function migrateHendonSlug() {
	const FROM = "eaf-hendon-water";
	const TO = "bh-simplified-hendon";
	if (safeGetItem(KEYS.TARGET_PRESET) === FROM) safeSetItem(KEYS.TARGET_PRESET, TO);
	try {
		if (sessionStorage.getItem(KEYS.TARGET_PRESET) === FROM) sessionStorage.setItem(KEYS.TARGET_PRESET, TO);
	} catch (e) {}
	const added = safeParse(safeGetItem(KEYS.ADDED_TARGET_PRESETS), []);
	if (Array.isArray(added) && added.includes(FROM)) {
		const next = Array.from(new Set(added.map((s) => s === FROM ? TO : s)));
		safeSetItem(KEYS.ADDED_TARGET_PRESETS, JSON.stringify(next));
	}
	const deleted = safeParse(safeGetItem(KEYS.DELETED_TARGET_PRESETS), []);
	if (Array.isArray(deleted) && deleted.includes(FROM)) safeSetItem(KEYS.DELETED_TARGET_PRESETS, JSON.stringify(deleted.filter((s) => s !== FROM)));
}
function loadDeletedTargetPresets() {
	const parsed = safeParse(_getGated(KEYS.DELETED_TARGET_PRESETS), []);
	return Array.isArray(parsed) ? parsed : [];
}
function addDeletedTargetPreset(key) {
	const deleted = loadDeletedTargetPresets();
	if (!deleted.includes(key)) {
		deleted.push(key);
		_setGated(KEYS.DELETED_TARGET_PRESETS, JSON.stringify(deleted));
		invalidateTargetPresetsCache();
		if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
	}
}
function removeDeletedTargetPreset(key) {
	const deleted = loadDeletedTargetPresets();
	const idx = deleted.indexOf(key);
	if (idx === -1) return;
	deleted.splice(idx, 1);
	_setGated(KEYS.DELETED_TARGET_PRESETS, JSON.stringify(deleted));
	invalidateTargetPresetsCache();
	if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}
function loadAddedTargetPresetsRaw() {
	const parsed = safeParse(_getGated(KEYS.ADDED_TARGET_PRESETS), []);
	return Array.isArray(parsed) ? parsed : [];
}
function loadAddedTargetPresets() {
	if (typeof ensureStarterBackfill === "function") ensureStarterBackfill();
	return loadAddedTargetPresetsRaw();
}
function addAddedTargetPreset(key) {
	const added = loadAddedTargetPresets();
	if (!added.includes(key)) {
		added.push(key);
		_setGated(KEYS.ADDED_TARGET_PRESETS, JSON.stringify(added));
		invalidateTargetPresetsCache();
		if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
	}
}
function removeAddedTargetPreset(key) {
	const added = loadAddedTargetPresets();
	const idx = added.indexOf(key);
	if (idx === -1) return;
	added.splice(idx, 1);
	_setGated(KEYS.ADDED_TARGET_PRESETS, JSON.stringify(added));
	invalidateTargetPresetsCache();
	if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}
function getExistingTargetProfileLabels() {
	const custom = loadCustomTargetProfiles();
	const labels = /* @__PURE__ */ new Set();
	for (const key of BUILTIN_TARGET_KEYS) if (BUILTIN_TARGET_LABELS[key]) labels.add(BUILTIN_TARGET_LABELS[key].trim().toLowerCase());
	if (typeof getPublicRecipesSync === "function") {
		for (const row of getPublicRecipesSync()) if (row && row.label) labels.add(row.label.trim().toLowerCase());
	}
	for (const profile of Object.values(custom)) if (profile && profile.label) labels.add(profile.label.trim().toLowerCase());
	return labels;
}
function getExistingSourceProfileLabels() {
	const allPresets = getAllPresets();
	const labels = /* @__PURE__ */ new Set();
	for (const profile of Object.values(allPresets)) if (profile && profile.label) labels.add(profile.label.trim().toLowerCase());
	return labels;
}
function saveTargetPresetName(name) {
	_setTransient(KEYS.TARGET_PRESET, name);
	if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}
function loadTargetDraftIons() {
	const parsed = safeParse(_getTransient(KEYS.TARGET_DRAFT_IONS), {});
	return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}
function saveTargetDraftIons(slug, ions) {
	if (!slug) return;
	const drafts = loadTargetDraftIons();
	drafts[slug] = ions;
	_setTransient(KEYS.TARGET_DRAFT_IONS, JSON.stringify(drafts));
	if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}
function clearTargetDraftIons(slug) {
	if (!slug) return;
	const drafts = loadTargetDraftIons();
	if (!Object.prototype.hasOwnProperty.call(drafts, slug)) return;
	delete drafts[slug];
	_setTransient(KEYS.TARGET_DRAFT_IONS, JSON.stringify(drafts));
	if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}
function loadTargetDraftIonsFor(slug) {
	if (!slug) return null;
	return loadTargetDraftIons()[slug] || null;
}
/**
* @param brewMethod "filter" or "espresso" (defaults to filter)
*/
function loadTargetPresetName(brewMethod) {
	const saved = _getTransient(KEYS.TARGET_PRESET);
	if (saved && saved !== "library") return saved;
	return brewMethod === "espresso" ? "cafelytic-espresso" : "cafelytic-filter";
}
function normalizeBrewMethod(method) {
	return method === "espresso" ? "espresso" : "filter";
}
function saveBrewMethod(method) {
	_setTransient(KEYS.BREW_METHOD, normalizeBrewMethod(method));
	if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}
function loadBrewMethod() {
	return normalizeBrewMethod(_getTransient(KEYS.BREW_METHOD));
}
function normalizeLotusDropperType(type) {
	return type === "straight" ? "straight" : "round";
}
function saveLotusDropperType(type) {
	_setTransient(KEYS.LOTUS_DROPPER_TYPE, normalizeLotusDropperType(type));
	if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}
function loadLotusDropperType() {
	return normalizeLotusDropperType(_getTransient(KEYS.LOTUS_DROPPER_TYPE));
}
function getLotusDropMl() {
	return lotusDropMl(loadLotusDropperType());
}
function normalizeLotusConcentrateUnit(unit) {
	return unit === "ml" ? "ml" : "drops";
}
function saveLotusConcentrateUnit(unit) {
	_setTransient(KEYS.LOTUS_CONCENTRATE_UNIT, normalizeLotusConcentrateUnit(unit));
	if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}
function loadLotusConcentrateUnit() {
	return normalizeLotusConcentrateUnit(_getTransient(KEYS.LOTUS_CONCENTRATE_UNIT));
}
function loadLotusConcentrateUnits() {
	const parsed = safeParse(_getTransient(KEYS.LOTUS_CONCENTRATE_UNITS), {});
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
	const normalized = {};
	Object.keys(parsed).forEach((key) => {
		normalized[key] = normalizeLotusConcentrateUnit(parsed[key]);
	});
	return normalized;
}
function saveLotusConcentrateUnits(units) {
	const safeUnits = {};
	if (units && typeof units === "object" && !Array.isArray(units)) Object.keys(units).forEach((key) => {
		safeUnits[key] = normalizeLotusConcentrateUnit(units[key]);
	});
	_setTransient(KEYS.LOTUS_CONCENTRATE_UNITS, JSON.stringify(safeUnits));
	if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}
function loadLotusConcentrateUnitFor(concentrateId) {
	const units = loadLotusConcentrateUnits();
	if (concentrateId && units[concentrateId]) return units[concentrateId];
	return "drops";
}
function saveLotusConcentrateUnitFor(concentrateId, unit) {
	if (!concentrateId) return;
	const units = loadLotusConcentrateUnits();
	units[concentrateId] = normalizeLotusConcentrateUnit(unit);
	saveLotusConcentrateUnits(units);
}
function invalidateAllCaches() {
	customProfilesCache = null;
	customTargetProfilesCache = null;
	selectedMineralsCache = null;
	selectedConcentratesCache = null;
	diyConcentrateSpecsCache = null;
	stockConcentrateSpecsCache = null;
	invalidateSourcePresetsCache();
	invalidateTargetPresetsCache();
}
let sourcePresetsCache = null;
function invalidateSourcePresetsCache() {
	sourcePresetsCache = null;
}
function getAllPresets() {
	if (sourcePresetsCache) return sourcePresetsCache;
	const custom = loadCustomProfiles();
	const deleted = loadDeletedPresets();
	const result = {};
	for (const [key, value] of Object.entries(SOURCE_PRESETS)) {
		if (key === "custom") {
			for (const [ck, cv] of Object.entries(custom)) if (!SOURCE_PRESETS[ck]) result[ck] = cv;
			result[key] = value;
			continue;
		}
		if (deleted.includes(key)) continue;
		const override = custom[key];
		if (override) result[key] = override.category ? override : Object.assign({}, override, { category: value && value.category });
		else result[key] = value;
	}
	sourcePresetsCache = result;
	return sourcePresetsCache;
}
function getSourceWaterByPreset(presetName) {
	if (presetName === "custom") return loadSourceWater();
	const preset = loadCustomProfiles()[presetName] || SOURCE_PRESETS[presetName];
	if (!preset) return loadSourceWater();
	const { label: _label, ...ions } = preset;
	return ions;
}
const DEFAULT_SELECTED_MINERALS = [
	"calcium-chloride",
	"epsom-salt",
	"baking-soda"
];
let selectedMineralsCache = null;
function saveSelectedMinerals(mineralIds) {
	_setTransient(KEYS.SELECTED_MINERALS, JSON.stringify(mineralIds));
	selectedMineralsCache = null;
	if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}
function loadSelectedMinerals() {
	if (selectedMineralsCache) return selectedMineralsCache;
	const parsed = safeParse(_getTransient(KEYS.SELECTED_MINERALS), null);
	selectedMineralsCache = Array.isArray(parsed) ? parsed : DEFAULT_SELECTED_MINERALS.slice();
	return selectedMineralsCache;
}
let selectedConcentratesCache = null;
let diyConcentrateSpecsCache = null;
let stockConcentrateSpecsCache = null;
function saveSelectedConcentrates(concentrateIds) {
	_setTransient(KEYS.SELECTED_CONCENTRATES, JSON.stringify(concentrateIds));
	selectedConcentratesCache = null;
	if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}
function loadSelectedConcentrates() {
	if (selectedConcentratesCache) return selectedConcentratesCache;
	const parsed = safeParse(_getTransient(KEYS.SELECTED_CONCENTRATES), null);
	selectedConcentratesCache = Array.isArray(parsed) ? parsed : [];
	return selectedConcentratesCache;
}
/** Returns only valid concentrate IDs (diy:, brand:, or stock: prefixed) from the selected concentrates list. */
function loadValidSelectedConcentrates() {
	return loadSelectedConcentrates().filter(function(id) {
		return typeof id === "string" && (id.startsWith("diy:") || id.startsWith("brand:") || id.startsWith("stock:"));
	});
}
function saveDiyConcentrateSpecs(specs) {
	_setGated(KEYS.DIY_CONCENTRATE_SPECS, JSON.stringify(specs || {}));
	diyConcentrateSpecsCache = null;
	if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}
function loadDiyConcentrateSpecs() {
	if (diyConcentrateSpecsCache) return Object.assign({}, diyConcentrateSpecsCache);
	const parsed = safeParse(_getGated(KEYS.DIY_CONCENTRATE_SPECS), {});
	diyConcentrateSpecsCache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	return Object.assign({}, diyConcentrateSpecsCache);
}
function parseDiyConcentrateId(concentrateId) {
	if (typeof concentrateId !== "string") return null;
	if (!concentrateId.startsWith("diy:")) return null;
	return concentrateId.slice(4) || null;
}
function saveStockConcentrateSpecs(specs) {
	_setGated(KEYS.STOCK_CONCENTRATE_SPECS, JSON.stringify(specs || {}));
	stockConcentrateSpecsCache = null;
	if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}
function loadStockConcentrateSpecs() {
	if (stockConcentrateSpecsCache) return Object.assign({}, stockConcentrateSpecsCache);
	const parsed = safeParse(_getGated(KEYS.STOCK_CONCENTRATE_SPECS), {});
	stockConcentrateSpecsCache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	return Object.assign({}, stockConcentrateSpecsCache);
}
/** Extracts the slug from a "stock:<slug>" concentrate id. */
function parseStockConcentrateId(concentrateId) {
	if (typeof concentrateId !== "string") return null;
	if (!concentrateId.startsWith("stock:")) return null;
	return concentrateId.slice(6) || null;
}
/**
* Returns the full StockConcentrateSpec for a "stock:<slug>" id, or null if
* not found / not a stock id.
*/
function getStockSpec(concentrateId) {
	const slug = parseStockConcentrateId(concentrateId);
	if (!slug) return null;
	const specs = loadStockConcentrateSpecs();
	return specs && specs[slug] ? specs[slug] : null;
}
/**
* Returns all unique mineral ids contained in a stock spec. Each entry's
* mineralId is normalized; duplicates collapse. Used by getAvailableMineralIds
* so the calculator's mineral-source pickers see every mineral the user can
* dose via an enabled stock.
*/
function getStockMineralIds(spec) {
	if (!spec || !Array.isArray(spec.minerals)) return [];
	const out = /* @__PURE__ */ new Set();
	for (const entry of spec.minerals) if (entry && typeof entry === "object" && typeof entry.mineralId === "string" && entry.mineralId) out.add(entry.mineralId);
	return Array.from(out);
}
/**
* Returns every "stock:<slug>" id in `concentrateIds`, preserving order.
* Multi-Recipe-Concentrate: a recipe can have any number of Recipe
* Concentrates active simultaneously; the calculator and recipe builder both
* sum their contributions. Filters non-strings and non-"stock:" prefixes
* defensively.
*/
function getActiveStockIds(concentrateIds) {
	if (!Array.isArray(concentrateIds)) return [];
	const out = [];
	for (const id of concentrateIds) if (typeof id === "string" && id.startsWith("stock:")) out.push(id);
	return out;
}
/**
* Singular shim — returns the id of the first active stock whose spec resolves
* (skipping orphaned ids whose spec was deleted), or null. Aligned with
* getActiveStockSpec so the singular id and singular spec never refer to
* different concentrates. New code should use getActiveStockSpecs and iterate.
*/
function getActiveStockId(concentrateIds) {
	const first = getActiveStockSpecs(concentrateIds)[0];
	return first ? first.id : null;
}
/**
* Toggle a single "stock:<slug>" id in cw_selected_concentrates without
* disturbing other active stocks. The canonical write helper now that
* multiple Recipe Concentrates can be active at once. Pass enabled=false to
* remove. Idempotent: enabling an already-enabled stock or disabling a
* not-enabled stock is a no-op (no localStorage write, no sync trigger).
*/
function setStockEnabled(stockId, enabled) {
	if (typeof stockId !== "string" || !stockId.startsWith("stock:")) return;
	const ids = loadSelectedConcentrates();
	const already = ids.indexOf(stockId) !== -1;
	if (enabled && already) return;
	if (!enabled && !already) return;
	if (enabled) saveSelectedConcentrates(ids.concat([stockId]));
	else saveSelectedConcentrates(ids.filter((id) => id !== stockId));
}
/**
* Deprecated v1 single-active write helper. Strips every other "stock:*" id
* before adding `stockId`. Kept as a compatibility shim for any external
* caller that hasn't migrated; new code should use setStockEnabled. Pass null
* to clear all active stocks.
* @deprecated use setStockEnabled instead
*/
function writeActiveStockId(stockId) {
	const others = loadSelectedConcentrates().filter(function(id) {
		return typeof id !== "string" || !id.startsWith("stock:");
	});
	if (stockId) others.push(stockId);
	saveSelectedConcentrates(others);
}
/**
* Resolves every active "stock:<slug>" id to its spec via getStockSpec.
* Filters out orphan ids (where the spec was deleted but the selection still
* references it) so callers get a clean list of usable specs each paired with
* its id. Preserves the order of getActiveStockIds.
*/
function getActiveStockSpecs(concentrateIds) {
	const out = [];
	for (const id of getActiveStockIds(concentrateIds)) {
		const spec = getStockSpec(id);
		if (spec) out.push({
			id,
			spec
		});
	}
	return out;
}
/**
* Singular shim — returns the first resolved active stock spec, or null. New
* code should use getActiveStockSpecs and iterate.
*/
function getActiveStockSpec(concentrateIds) {
	const first = getActiveStockSpecs(concentrateIds)[0];
	return first ? first.spec : null;
}
/**
* Per-liter grams of each mineral when dispensing the stock at its prescribed
* dose (one liter of brew water gets `doseGramsPerL` grams of stock; that
* amount carries `mineral.grams / bottleMl` grams of each mineral per gram of
* stock — same convention the Coffee ad Astra seed rows use).
* Returns {} for malformed specs (zero/missing bottleMl or doseGramsPerL,
* non-array minerals, etc.).
*/
function computeStockMineralGramsPerL(spec) {
	const out = {};
	if (!spec || !Array.isArray(spec.minerals)) return out;
	const bottleMl = Number(spec.bottleMl);
	const doseGramsPerL = Number(spec.doseGramsPerL);
	if (!Number.isFinite(bottleMl) || bottleMl <= 0) return out;
	if (!Number.isFinite(doseGramsPerL) || doseGramsPerL <= 0) return out;
	for (const m of spec.minerals) {
		if (!m || typeof m !== "object" || !m.mineralId) continue;
		const grams = Number(m.grams);
		if (!Number.isFinite(grams) || grams <= 0) continue;
		out[m.mineralId] = (out[m.mineralId] || 0) + grams / bottleMl * doseGramsPerL;
	}
	return out;
}
/**
* Imports a library recipe's stockFormula into the user's stock pantry, keyed
* on the library row's slug, with createdFrom set to "library:<slug>" so the
* "Reset to library values" link in Settings can find the source row later.
*
* Idempotent: if a spec with that slug is already present, returns
* {status:"already-present"} without writing. The user's path to refresh from
* library values is the reset link in Settings — re-importing here would
* silently clobber any edits the user made (e.g. matching the bottle volume
* they actually have on hand).
*
* Does NOT auto-enable the stock in cw_selected_concentrates; user explicitly
* enables it from Settings. saveStockConcentrateSpecs already triggers cloud
* sync via scheduleSyncToCloud.
*
* NOTE: No production caller as of #stock-import editor flow — recipe-browser.js
* onAddStock now navigates to "minerals.html#stock-import=<slug>" so the user
* can review/tweak before saving. Retained as the canonical "recreate library
* spec from a recipe" helper for tests/storage-stock.test.ts coverage and a planned
* "Reset to library values" affordance.
*/
function importLibraryStockToPantry(recipe) {
	if (!recipe || typeof recipe !== "object") return {
		status: "invalid",
		slug: null
	};
	const slug = typeof recipe.slug === "string" ? recipe.slug : "";
	const formula = recipe.stockFormula;
	if (!slug || !formula || !Array.isArray(formula.minerals) || formula.minerals.length === 0) return {
		status: "invalid",
		slug: null
	};
	const specs = loadStockConcentrateSpecs();
	if (specs[slug]) return {
		status: "already-present",
		slug
	};
	const minerals = [];
	for (const m of formula.minerals) {
		if (!m || typeof m !== "object" || typeof m.mineralId !== "string" || !m.mineralId) continue;
		minerals.push({
			mineralId: m.mineralId,
			grams: Number(m.grams) || 0
		});
	}
	if (minerals.length === 0) return {
		status: "invalid",
		slug: null
	};
	const spec = {
		label: typeof recipe.label === "string" && recipe.label ? recipe.label : slug,
		bottleMl: Number(formula.bottleMl) || 0,
		doseGramsPerL: Number(formula.doseGramsPerL) || 0,
		minerals,
		createdFrom: "library:" + slug
	};
	if (typeof formula.source === "string" && formula.source) spec.source = formula.source;
	specs[slug] = spec;
	saveStockConcentrateSpecs(specs);
	return {
		status: "imported",
		slug
	};
}
/**
* Returns the MINERAL_DB id that this concentrate contributes (for ion math).
* DIY: mineral id; brand: mapped mineralId; else null.
*/
function getConcentrateMineralId(concentrateId) {
	return concentrateMineralId(concentrateId);
}
function getDiyConcentrateGramsPerMl(mineralId) {
	if (!mineralId) return 0;
	return diyGramsPerMl(loadDiyConcentrateSpecs()[mineralId]);
}
/**
* mL per drop for a concentrate, or 0 when it isn't dosed in drops.
* Lotus brand concentrates use the selected Lotus dropper style; Mineral
* (diy:) and Recipe (stock:) Concentrates use the dropper size saved on their
* spec, if any.
*/
function getConcentrateDropMl(concentrateId) {
	return concentrateDropMl(concentrateId, {
		lotusDropperType: loadLotusDropperType(),
		diySpecs: loadDiyConcentrateSpecs(),
		stockSpecs: loadStockConcentrateSpecs()
	});
}
/**
* Grams of equivalent mineral salt per mL of concentrate. Works for DIY (from
* specs) and brand (from BRAND_CONCENTRATES).
*/
function getConcentrateGramsPerMl(concentrateId) {
	return concentrateGramsPerMl(concentrateId, loadDiyConcentrateSpecs());
}
/**
* The user's dosing kit as saved in this browser: selected powders, selected
* single-mineral concentrates, and selected Recipe Concentrates whose spec
* still exists. The rules for what a kit can dose from live in
* mineral-sources.ts (shared with the MCP server); the getters below apply
* them to this kit.
*/
function loadMineralKit() {
	const concentrates = [];
	const recipeConcentrates = [];
	for (const cid of loadSelectedConcentrates()) {
		if (typeof cid !== "string") continue;
		const mineralId = getConcentrateMineralId(cid);
		if (mineralId) {
			concentrates.push({
				id: cid,
				mineralId,
				gramsPerMl: getConcentrateGramsPerMl(cid)
			});
			continue;
		}
		if (cid.startsWith("stock:")) {
			const spec = getStockSpec(cid);
			if (spec) recipeConcentrates.push({
				id: cid,
				mineralIds: getStockMineralIds(spec)
			});
		}
	}
	return {
		minerals: loadSelectedMinerals(),
		concentrates,
		recipeConcentrates
	};
}
function getAvailableMineralIds() {
	return availableMineralIds(loadMineralKit());
}
/** Returns an array of enabled alkalinity source mineral ids (baking-soda and/or potassium-bicarbonate). */
function getEffectiveAlkalinitySources() {
	return alkalinitySources(loadMineralKit());
}
/** Returns an array of enabled calcium source mineral ids (a calcium-chloride form and/or gypsum). */
function getEffectiveCalciumSources() {
	return calciumSources(loadMineralKit());
}
/** Returns an array of enabled magnesium source mineral ids (epsom-salt and/or magnesium-chloride). */
function getEffectiveMagnesiumSources() {
	return magnesiumSources(loadMineralKit());
}
/** Returns a single alkalinity source when only one is enabled; when both are enabled returns "potassium-bicarbonate" as fallback; when none, null. Use getEffectiveAlkalinitySources() when both can contribute. */
function getEffectiveAlkalinitySource() {
	const sources = getEffectiveAlkalinitySources();
	if (sources.length === 0) return null;
	if (sources.length === 1) return sources[0] ?? null;
	return "potassium-bicarbonate";
}
/** Returns a single calcium source when only one is enabled; when a calcium-chloride form and gypsum are both enabled returns the calcium-chloride form (tie-breaker); when none, null. */
function getEffectiveCalciumSource() {
	return singleCalciumSource(getEffectiveCalciumSources());
}
/** Returns a single magnesium source when only one is enabled; when both enabled returns "epsom-salt" (tie-breaker); when none, null. */
function getEffectiveMagnesiumSource() {
	return singleMagnesiumSource(getEffectiveMagnesiumSources());
}
let targetPresetsCache = null;
let firstSeenTargetPresetName = null;
function invalidateTargetPresetsCache() {
	targetPresetsCache = null;
}
const STARTER_MIGRATION_KEY = KEYS.STARTER_MIGRATION_APPLIED;
function ensureStarterBackfill() {
	if (_getGated(STARTER_MIGRATION_KEY) === "1") return;
	const library = typeof getPublicRecipesSync === "function" ? getPublicRecipesSync() : [];
	if (!Array.isArray(library) || library.length === 0) return;
	const hasPriorTombstones = loadDeletedTargetPresets().length > 0;
	const hasPriorCustom = Object.keys(loadCustomTargetProfiles()).length > 0;
	if (hasPriorTombstones || hasPriorCustom) {
		const seed = loadAddedTargetPresetsRaw();
		const seedSet = new Set(seed);
		for (const row of library) {
			if (!row || !row.slug) continue;
			if (row.userId != null) continue;
			if (row.isStarter) continue;
			if (seedSet.has(row.slug)) continue;
			seed.push(row.slug);
			seedSet.add(row.slug);
		}
		_setGated(KEYS.ADDED_TARGET_PRESETS, JSON.stringify(seed));
		if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
	}
	_setGated(STARTER_MIGRATION_KEY, "1");
}
/**
* Build the taste-page preset rail by merging three sources in ascending
* priority, with tombstoned slugs dropped and non-starter canonical rows
* filtered to the user's explicit added list:
*
*   1. TARGET_PRESETS shim  — the 8-entry fallback in src/lib/constants.ts, used
*                              before Supabase library data arrives on a
*                              cold pageload.
*   2. Supabase library     — all is_public=true rows, fetched by
*                              library-data.js. Canonical rows
*                              (userId == null) are gated on is_starter +
*                              added_target_presets; user-published rows
*                              (userId != null) do not pass through the rail
*                              merge (they arrive via copy-to-custom).
*   3. User custom profiles — user_id=auth.uid() rows from Supabase,
*                              mirrored in localStorage.
*
* Later sources override earlier ones at the same slug. Tombstones apply
* uniformly. The "+ Add Custom" pseudo-entry is always appended.
*/
function getAllTargetPresets() {
	if (targetPresetsCache) return targetPresetsCache;
	const custom = loadCustomTargetProfiles();
	const tombstoned = new Set(loadDeletedTargetPresets());
	const library = typeof getPublicRecipesSync === "function" ? getPublicRecipesSync() : [];
	ensureStarterBackfill();
	const added = new Set(loadAddedTargetPresetsRaw());
	const result = {};
	for (const [key, value] of Object.entries(TARGET_PRESETS)) {
		if (tombstoned.has(key)) continue;
		result[key] = value;
	}
	const libraryRowToPreset = (row) => ({
		label: row.label,
		brewMethod: row.brewMethod,
		calcium: row.calcium,
		magnesium: row.magnesium,
		alkalinity: row.alkalinity,
		potassium: row.potassium,
		sodium: row.sodium,
		sulfate: row.sulfate,
		chloride: row.chloride,
		bicarbonate: row.bicarbonate,
		description: row.description || "",
		creatorDisplayName: row.creatorDisplayName || "",
		roast: Array.isArray(row.roast) ? row.roast : ["all"],
		tags: Array.isArray(row.tags) ? row.tags : []
	});
	for (const row of library) {
		if (!row || !row.slug) continue;
		if (row.userId != null) continue;
		if (tombstoned.has(row.slug)) continue;
		if (!row.isStarter && !added.has(row.slug)) continue;
		result[row.slug] = libraryRowToPreset(row);
	}
	if (firstSeenTargetPresetName === null) firstSeenTargetPresetName = _getTransient(KEYS.TARGET_PRESET) || "";
	const selectedSlugs = /* @__PURE__ */ new Set([firstSeenTargetPresetName, _getTransient(KEYS.TARGET_PRESET) || ""]);
	const providedSlugs = new Set(Object.keys(result));
	for (const row of library) {
		if (!row || !row.slug || row.userId == null) continue;
		if (!selectedSlugs.has(row.slug) || providedSlugs.has(row.slug)) continue;
		if (tombstoned.has(row.slug)) continue;
		result[row.slug] = libraryRowToPreset(row);
	}
	for (const [ck, cv] of Object.entries(custom)) {
		if (tombstoned.has(ck)) continue;
		result[ck] = cv;
	}
	result["custom"] = { label: "+ Custom" };
	result["library"] = { label: "+ From Library" };
	targetPresetsCache = result;
	return targetPresetsCache;
}
function getTargetProfileByKey(key) {
	if (key === "custom") return null;
	return getAllTargetPresets()[key] || null;
}
function inferTargetProfileBrewMethod(key, profile) {
	if (profile && (profile.brewMethod === "filter" || profile.brewMethod === "espresso")) return profile.brewMethod;
	if (typeof key === "string" && (key.startsWith("eaf-") || key.includes("espresso"))) return "espresso";
	const label = (profile && profile.label ? String(profile.label) : "").toLowerCase();
	const description = (profile && profile.description ? String(profile.description) : "").toLowerCase();
	if (label.includes("espresso") || description.includes("espresso")) return "espresso";
	return "filter";
}
function targetProfileSupportsBrewMethod(key, profile, method) {
	const brewMethod = normalizeBrewMethod(method);
	if (profile && profile.brewMethod === "all") return true;
	if (profile && Array.isArray(profile.brewMethods)) return new Set(profile.brewMethods.map((value) => normalizeBrewMethod(value)).filter((value, index, array) => array.indexOf(value) === index)).has(brewMethod);
	return inferTargetProfileBrewMethod(key, profile) === brewMethod;
}
const TARGET_PRESET_PRIORITY = {
	"cafelytic-filter": 0,
	"cafelytic-espresso": 1
};
/**
* Comparator for target-preset slugs that floats the in-house Cafelytic recipes
* to the front (Filter before Espresso) and leaves all other slugs equal-ranked
* so a stable sort preserves their incoming order. Exported for reuse + unit
* testing.
*/
function compareTargetPresetKeys(a, b) {
	return (TARGET_PRESET_PRIORITY[a] ?? Number.MAX_SAFE_INTEGER) - (TARGET_PRESET_PRIORITY[b] ?? Number.MAX_SAFE_INTEGER);
}
function getTargetPresetsForBrewMethod(method) {
	const brewMethod = normalizeBrewMethod(method);
	const allPresets = getAllTargetPresets();
	const matching = [];
	for (const [key, profile] of Object.entries(allPresets)) {
		if (key === "custom" || key === "library") continue;
		if (targetProfileSupportsBrewMethod(key, profile, brewMethod)) matching.push([key, profile]);
	}
	matching.sort((a, b) => compareTargetPresetKeys(a[0], b[0]));
	const filtered = {};
	for (const [key, profile] of matching) filtered[key] = profile;
	filtered.custom = allPresets.custom || { label: "+ Custom" };
	filtered.library = allPresets.library || { label: "+ From Library" };
	return filtered;
}
function unusedProfileKey(key, isTaken) {
	if (!isTaken(key)) return key;
	for (let i = 2; i < 1e3; i++) {
		const candidate = key + "-" + i;
		if (!isTaken(candidate)) return candidate;
	}
	return key + "-" + Date.now();
}
function validateProfileName(rawName, options = {}) {
	const allowEmpty = !!options.allowEmpty;
	const emptyMessage = options.emptyMessage || "Enter a profile name.";
	const invalidMessage = options.invalidMessage || "Enter a valid name.";
	const reservedMessage = options.reservedMessage || "That name is reserved. Choose a different name.";
	const duplicateMessage = options.duplicateMessage || "A profile with this name already exists.";
	const name = (rawName || "").trim();
	if (!name) return allowEmpty ? {
		ok: true,
		key: "",
		name: "",
		empty: true
	} : {
		ok: false,
		code: "empty",
		message: emptyMessage
	};
	const key = slugify(name);
	if (!key) return {
		ok: false,
		code: "invalid",
		message: invalidMessage
	};
	const builtinKeys = options.builtinKeys || [];
	const builtinKeySet = builtinKeys instanceof Set ? builtinKeys : new Set(builtinKeys);
	if (builtinKeySet.has(key)) return {
		ok: false,
		code: "reserved",
		message: reservedMessage
	};
	const existingKeys = options.existingKeys || [];
	const existingKeySet = existingKeys instanceof Set ? existingKeys : new Set(existingKeys);
	if (existingKeySet.has(key)) return {
		ok: false,
		code: "duplicate",
		message: duplicateMessage
	};
	const existingLabels = options.existingLabels || [];
	if ((existingLabels instanceof Set ? existingLabels : new Set(existingLabels)).has(name.toLowerCase())) return {
		ok: false,
		code: "duplicate",
		message: duplicateMessage
	};
	const retiredKeys = options.retiredKeys || [];
	const retiredKeySet = retiredKeys instanceof Set ? retiredKeys : new Set(retiredKeys);
	return {
		ok: true,
		key: unusedProfileKey(key, function(candidate) {
			return retiredKeySet.has(candidate) || existingKeySet.has(candidate) || builtinKeySet.has(candidate);
		}),
		name
	};
}
function validateTargetProfileName(rawName, options = {}) {
	return validateProfileName(rawName, {
		allowEmpty: options.allowEmpty,
		builtinKeys: RESERVED_TARGET_KEYS,
		existingKeys: new Set(Object.keys(loadCustomTargetProfiles())),
		existingLabels: getExistingTargetProfileLabels(),
		retiredKeys: loadDeletedTargetPresets()
	});
}
function restoreSourcePresetDefaults() {
	const preserved = loadDeletedPresets().filter(function(key) {
		return !SOURCE_PRESETS[key];
	});
	_setGated(KEYS.DELETED_PRESETS, JSON.stringify(preserved));
	invalidateSourcePresetsCache();
	if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
	const custom = loadCustomProfiles();
	for (const key of Object.keys(SOURCE_PRESETS)) {
		if (key === "custom") continue;
		delete custom[key];
	}
	saveCustomProfiles(custom);
}
function loadThemePreference() {
	const saved = safeGetItem(THEME_KEY);
	if (saved === "light" || saved === "dark" || saved === "system") return saved;
	return "system";
}
function saveThemePreference(mode) {
	safeSetItem(THEME_KEY, mode);
	if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}
function loadCreatorDisplayName() {
	return _getGated(KEYS.CREATOR_DISPLAY_NAME) || "";
}
function saveCreatorDisplayName(name) {
	_setGated(KEYS.CREATOR_DISPLAY_NAME, name);
	if (typeof scheduleSyncToCloud === "function") scheduleSyncToCloud();
}
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
	migrateHendonSlug();
	window.addEventListener("storage", function(e) {
		if (!e.key) return;
		let recipeAffected = false;
		if (e.key === KEYS.CUSTOM_PROFILES) {
			customProfilesCache = null;
			invalidateSourcePresetsCache();
			recipeAffected = true;
		}
		if (e.key === KEYS.CUSTOM_TARGET_PROFILES) {
			customTargetProfilesCache = null;
			invalidateTargetPresetsCache();
			recipeAffected = true;
		}
		if (e.key === KEYS.SELECTED_MINERALS) selectedMineralsCache = null;
		if (e.key === KEYS.SELECTED_CONCENTRATES) selectedConcentratesCache = null;
		if (e.key === KEYS.DIY_CONCENTRATE_SPECS) diyConcentrateSpecsCache = null;
		if (e.key === KEYS.STOCK_CONCENTRATE_SPECS) stockConcentrateSpecsCache = null;
		if (e.key === KEYS.DELETED_PRESETS) {
			invalidateSourcePresetsCache();
			recipeAffected = true;
		}
		if (e.key === KEYS.DELETED_TARGET_PRESETS) {
			invalidateTargetPresetsCache();
			recipeAffected = true;
		}
		if (e.key === KEYS.ADDED_TARGET_PRESETS) {
			invalidateTargetPresetsCache();
			recipeAffected = true;
		}
		if (recipeAffected && typeof window.dispatchEvent === "function") window.dispatchEvent(new CustomEvent("cw:cloud-data-changed"));
	});
	if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
		document.addEventListener("cw:auth-changed", function() {
			if (typeof invalidateAllCaches === "function") invalidateAllCaches();
		});
		document.addEventListener("cw:auth-state-resolved", function() {
			if (typeof invalidateAllCaches === "function") invalidateAllCaches();
		});
		window.addEventListener("cw:storage-invalidated", function() {
			if (typeof invalidateAllCaches === "function") invalidateAllCaches();
		});
	}
}
if (typeof window !== "undefined") Object.assign(window, {
	safeGetItem,
	safeSetItem,
	safeRemoveItem,
	safeParse,
	_getTransient,
	_setTransient,
	_getGated,
	_setGated,
	saveSourceWater,
	loadSourceWater,
	saveSourcePresetName,
	loadSourcePresetName,
	saveMineralDisplayMode,
	loadMineralDisplayMode,
	isAdvancedMineralDisplayMode,
	saveVolumePreference,
	loadVolumePreference,
	slugify,
	loadCustomProfiles,
	saveCustomProfiles,
	deleteCustomProfile,
	loadDeletedPresets,
	addDeletedPreset,
	loadCustomTargetProfiles,
	saveCustomTargetProfiles,
	deleteCustomTargetProfile,
	migrateHendonSlug,
	loadDeletedTargetPresets,
	addDeletedTargetPreset,
	removeDeletedTargetPreset,
	loadAddedTargetPresets,
	addAddedTargetPreset,
	removeAddedTargetPreset,
	getExistingTargetProfileLabels,
	getExistingSourceProfileLabels,
	saveTargetPresetName,
	loadTargetDraftIons,
	saveTargetDraftIons,
	clearTargetDraftIons,
	loadTargetDraftIonsFor,
	loadTargetPresetName,
	normalizeBrewMethod,
	saveBrewMethod,
	loadBrewMethod,
	normalizeLotusDropperType,
	saveLotusDropperType,
	loadLotusDropperType,
	getLotusDropMl,
	normalizeLotusConcentrateUnit,
	saveLotusConcentrateUnit,
	loadLotusConcentrateUnit,
	loadLotusConcentrateUnits,
	saveLotusConcentrateUnits,
	loadLotusConcentrateUnitFor,
	saveLotusConcentrateUnitFor,
	invalidateAllCaches,
	invalidateSourcePresetsCache,
	invalidateTargetPresetsCache,
	getAllPresets,
	getSourceWaterByPreset,
	saveSelectedMinerals,
	loadSelectedMinerals,
	saveSelectedConcentrates,
	loadSelectedConcentrates,
	loadValidSelectedConcentrates,
	saveDiyConcentrateSpecs,
	loadDiyConcentrateSpecs,
	parseDiyConcentrateId,
	saveStockConcentrateSpecs,
	loadStockConcentrateSpecs,
	parseStockConcentrateId,
	getStockSpec,
	getStockMineralIds,
	getActiveStockId,
	getActiveStockIds,
	writeActiveStockId,
	setStockEnabled,
	getActiveStockSpec,
	getActiveStockSpecs,
	computeStockMineralGramsPerL,
	importLibraryStockToPantry,
	getConcentrateMineralId,
	getDiyConcentrateGramsPerMl,
	getConcentrateGramsPerMl,
	normalizeDropMl,
	getConcentrateDropMl,
	getAvailableMineralIds,
	getEffectiveAlkalinitySources,
	getEffectiveCalciumSources,
	getEffectiveMagnesiumSources,
	getEffectiveAlkalinitySource,
	getEffectiveCalciumSource,
	getEffectiveMagnesiumSource,
	getAllTargetPresets,
	getTargetProfileByKey,
	inferTargetProfileBrewMethod,
	targetProfileSupportsBrewMethod,
	getTargetPresetsForBrewMethod,
	validateProfileName,
	validateTargetProfileName,
	restoreSourcePresetDefaults,
	loadThemePreference,
	saveThemePreference,
	loadCreatorDisplayName,
	saveCreatorDisplayName,
	ensureStarterBackfill
});
// src/lib/metrics.ts
const NA_ATOMIC_MASS = 22.99;
const K_ATOMIC_MASS = 39.098;
/**
* Convert grams-per-liter of mineral salts into ion concentrations (mg/L).
*/
function calculateIonPPMs(mineralGrams) {
	const ions = {
		calcium: 0,
		magnesium: 0,
		potassium: 0,
		sodium: 0,
		sulfate: 0,
		chloride: 0,
		bicarbonate: 0
	};
	for (const [mineralId, grams] of Object.entries(mineralGrams)) {
		const mineral = MINERAL_DB[mineralId];
		if (!mineral) continue;
		for (const [ion, fraction] of Object.entries(mineral.ions)) {
			const key = ion;
			ions[key] += grams * (fraction ?? 0) * 1e3;
		}
	}
	return ions;
}
/**
* The dose a Calculator row actually tells the user to add, as opposed to the
* exact solved dose. Rows round for display (whole drops, 0.001 mL, 0.01 g),
* and at small volumes that rounding moves the water noticeably: 2.4 drops
* shown as "2" is a 17% smaller dose. The summary readout is computed from
* these values so it describes the water the displayed doses make.
*
* Grams below 0.01 print as "<0.01 g", which gives no figure to follow, so
* they pass through unrounded.
*/
function displayedGrams(grams) {
	if (!Number.isFinite(grams) || grams <= 0) return 0;
	if (grams < .01) return grams;
	return Number(grams.toFixed(2));
}
/** Whole drops shown for a concentrate dose of `ml` with a `dropMl` dropper. */
function displayedDrops(ml, dropMl) {
	if (!Number.isFinite(ml) || ml <= 0) return 0;
	return Number.isFinite(dropMl) && dropMl > 0 ? Math.round(ml / dropMl) : 0;
}
/**
* mL of concentrate a row shows: whole drops times the dropper size when the
* row is in drops, otherwise the mL figure at its 3 printed decimals.
*/
function displayedConcentrateMl(ml, unit, dropMl) {
	if (!Number.isFinite(ml) || ml <= 0) return 0;
	if (unit === "drops") return displayedDrops(ml, dropMl) * dropMl || 0;
	return Number(ml.toFixed(3));
}
/**
* Compute GH / KH / TDS from an ion map (CaCO3-equivalent for GH and KH).
*/
function calculateMetrics(ions) {
	return {
		gh: (ions.calcium || 0) * CA_TO_CACO3 + (ions.magnesium || 0) * MG_TO_CACO3,
		kh: (ions.bicarbonate || 0) * HCO3_TO_CACO3,
		tds: (ions.calcium || 0) + (ions.magnesium || 0) + (ions.potassium || 0) + (ions.sodium || 0) + (ions.sulfate || 0) + (ions.chloride || 0) + (ions.bicarbonate || 0)
	};
}
/**
* Headline water metrics for a recipe's display surfaces, rounded to integers:
* GH and KH as mg/L CaCO3, TDS as mg/L (ppm). GH is the Ca + Mg hardness; KH
* comes from the recipe's alkalinity (already CaCO3, so it equals carbonate
* hardness), falling back to bicarbonate x HCO3_TO_CACO3 when alkalinity is
* absent so both alkalinity-only rows (e.g. the SCA preset shim) and
* bicarbonate-only rows report a correct KH. TDS is the sum of all
* ion concentrations, matching calculateMetrics. Used by the slim cards (GH/KH)
* and the library detail modal (GH/KH/TDS).
*/
function recipeMetricsSummary(recipe) {
	recipe = recipe || {};
	const gh = (Number(recipe.calcium) || 0) * CA_TO_CACO3 + (Number(recipe.magnesium) || 0) * MG_TO_CACO3;
	const alk = Number(recipe.alkalinity);
	const kh = recipe.alkalinity != null && Number.isFinite(alk) ? alk : (Number(recipe.bicarbonate) || 0) * HCO3_TO_CACO3;
	const tds = (Number(recipe.calcium) || 0) + (Number(recipe.magnesium) || 0) + (Number(recipe.potassium) || 0) + (Number(recipe.sodium) || 0) + (Number(recipe.sulfate) || 0) + (Number(recipe.chloride) || 0) + (Number(recipe.bicarbonate) || 0);
	return {
		gh: Math.round(gh),
		kh: Math.round(kh),
		tds: Math.round(tds)
	};
}
/**
* SO4:Cl ratio, or null when chloride is absent/zero.
* Defensive; accepts partial/malformed inputs from storage.
*/
function calculateSo4ClRatio(ions) {
	if (!ions || typeof ions !== "object") return null;
	const ionRecord = ions;
	const sulfate = Number(ionRecord.sulfate);
	const chloride = Number(ionRecord.chloride);
	if (!Number.isFinite(sulfate) || !Number.isFinite(chloride) || chloride <= 0) return null;
	return sulfate / chloride;
}
function toStableBicarbonateFromAlkalinity(alkAsCaCO3, existingBicarbonate) {
	const alkRounded = Math.round(parseFloat(String(alkAsCaCO3 ?? "")) || 0);
	const candidate = Math.round(alkRounded * CACO3_TO_HCO3 * 10) / 10;
	const existing = Math.round((parseFloat(String(existingBicarbonate ?? "")) || 0) * 10) / 10;
	const candidateAlk = Math.round(candidate * HCO3_TO_CACO3);
	if (Math.round(existing * .8201812609600603) === alkRounded) return existing;
	if (candidateAlk === alkRounded) return candidate;
	return candidate;
}
/**
* Dose the Ca/Mg deltas across the enabled salts so the added sulfate and
* chloride land as close as possible (least squares) to the target profile's
* SO4/Cl, while still delivering the Ca and Mg deltas exactly.
*
* Unlike pickBestCaMgSources (kept for its existing callers), a slot with
* both of its salts enabled may SPLIT its delta — e.g. Mg 10 as epsom 2 +
* MgCl2 8 — which is the only way to reach SO4:Cl ratios between the
* all-sulfate and all-chloride corners. The solve reduces to one scalar:
* every divalent cation pairs with one SO4²⁻ or two Cl⁻, so added sulfate
* trades against added chloride at the fixed mass ratio κ = 96.06/70.906
* regardless of which salt carries it. Least-squares over (SO4, Cl) is then
* a 1-D quadratic in "total sulfate carried by the blendable slots", solved
* in closed form and clamped to capacity.
*
* Tie-breaks (any split with the same sulfate total yields identical water):
* sulfate rides Mg (epsom) before Ca (gypsum is solubility-limited and
* disfavored, matching pickBestCaMgSources). A slot within 2% of a pure
* corner snaps to it, so profiles without a meaningful SO4/Cl target keep
* producing the classic single-salt dose. When the profile omits BOTH ions
* (non-finite, e.g. a Ca/Mg/Alk-only partial profile) blending is skipped
* entirely and the legacy least-added-anion corner is chosen.
*/
function allocateCaMgDoses(sourceWater, targetProfile, deltaCa, deltaMg, sources) {
	const caSources = sources ? sources.calcium : getEffectiveCalciumSources();
	const mgSources = sources ? sources.magnesium : getEffectiveMagnesiumSources();
	const caCl2Form = caSources.find((s) => s !== "gypsum") ?? null;
	const hasGypsum = caSources.includes("gypsum");
	const hasEpsom = mgSources.includes("epsom-salt");
	const hasMgCl2 = mgSources.includes("magnesium-chloride");
	const yieldOf = (mineralId, anion, cation) => {
		const ions = MINERAL_DB[mineralId] ? MINERAL_DB[mineralId].ions : null;
		const anionFrac = ions && ions[anion] || 0;
		const cationFrac = ions && ions[cation] || 0;
		return cationFrac > 0 ? anionFrac / cationFrac : 0;
	};
	const so4PerMg = yieldOf("epsom-salt", "sulfate", "magnesium");
	const clPerMg = yieldOf("magnesium-chloride", "chloride", "magnesium");
	const so4PerCa = yieldOf("gypsum", "sulfate", "calcium");
	const clPerCa = yieldOf(caCl2Form ?? "calcium-chloride", "chloride", "calcium");
	const dCa = Math.max(0, Number(deltaCa) || 0);
	const dMg = Math.max(0, Number(deltaMg) || 0);
	const srcSO4 = sourceWater && Number(sourceWater.sulfate) || 0;
	const srcCl = sourceWater && Number(sourceWater.chloride) || 0;
	const tSO4 = targetProfile ? Number(targetProfile.sulfate) : NaN;
	const tCl = targetProfile ? Number(targetProfile.chloride) : NaN;
	const hasAnionTarget = Number.isFinite(tSO4) || Number.isFinite(tCl);
	const wantS = Number.isFinite(tSO4) ? Math.max(0, tSO4 - srcSO4) : 0;
	const wantC = Number.isFinite(tCl) ? Math.max(0, tCl - srcCl) : 0;
	const mgFree = dMg > 0 && hasEpsom && hasMgCl2;
	const caFree = dCa > 0 && caCl2Form != null && hasGypsum;
	let fixedS = 0;
	let fixedC = 0;
	if (dMg > 0 && !mgFree) {
		if (hasEpsom) fixedS += dMg * so4PerMg;
		else if (hasMgCl2) fixedC += dMg * clPerMg;
	}
	if (dCa > 0 && !caFree) {
		if (caCl2Form) fixedC += dCa * clPerCa;
		else if (hasGypsum) fixedS += dCa * so4PerCa;
	}
	const capSMg = mgFree ? dMg * so4PerMg : 0;
	const capSCa = caFree ? dCa * so4PerCa : 0;
	const sMax = capSMg + capSCa;
	const uFree = (mgFree ? dMg * clPerMg : 0) + (caFree ? dCa * clPerCa : 0);
	const kappa = uFree > 0 ? sMax / uFree : 0;
	let sOnMg = 0;
	let sOnCa = 0;
	if (sMax > 0 && kappa > 0) {
		if (!hasAnionTarget) {
			let best = null;
			for (const smg of mgFree ? [capSMg, 0] : [0]) for (const sca of caFree ? [0, capSCa] : [0]) {
				const so4 = fixedS + smg + sca;
				const cl = fixedC + uFree - (smg + sca) / kappa;
				const err = so4 * so4 + cl * cl;
				const tie = (sca > 0 ? 1 : 0) + (mgFree && smg === 0 ? 2 : 0);
				if (!best || err < best.err || err === best.err && tie < best.tie) best = {
					sMg: smg,
					sCa: sca,
					err,
					tie
				};
			}
			sOnMg = best ? best.sMg : 0;
			sOnCa = best ? best.sCa : 0;
		} else {
			const a = wantS - fixedS;
			const b = fixedC + uFree - wantC;
			let s = kappa * (kappa * a + b) / (kappa * kappa + 1);
			s = Math.min(sMax, Math.max(0, s));
			sOnMg = Math.min(s, capSMg);
			sOnCa = Math.min(s - sOnMg, capSCa);
		}
	}
	const SNAP_SHARE = .02;
	const snapShare = (cationOnSulfate, delta) => {
		if (delta <= 0) return 0;
		if (cationOnSulfate < SNAP_SHARE * delta) return 0;
		if (cationOnSulfate > .98 * delta) return delta;
		return cationOnSulfate;
	};
	let mgOnEpsom = 0;
	if (mgFree) mgOnEpsom = snapShare(so4PerMg > 0 ? sOnMg / so4PerMg : 0, dMg);
	else if (dMg > 0 && hasEpsom) mgOnEpsom = dMg;
	const mgOnMgCl2 = hasMgCl2 ? Math.max(0, dMg - mgOnEpsom) : 0;
	let caOnGypsum = 0;
	if (caFree) caOnGypsum = snapShare(so4PerCa > 0 ? sOnCa / so4PerCa : 0, dCa);
	else if (dCa > 0 && hasGypsum && !caCl2Form) caOnGypsum = dCa;
	const caOnCaCl2 = caCl2Form ? Math.max(0, dCa - caOnGypsum) : 0;
	const gramsPerL = {};
	const addSalt = (mineralId, cationMgL, cation) => {
		if (!mineralId || cationMgL <= 0) return;
		const frac = MINERAL_DB[mineralId] && MINERAL_DB[mineralId].ions[cation] || 0;
		if (frac > 0) gramsPerL[mineralId] = (gramsPerL[mineralId] || 0) + cationMgL / frac / 1e3;
	};
	addSalt("epsom-salt", mgOnEpsom, "magnesium");
	addSalt("magnesium-chloride", mgOnMgCl2, "magnesium");
	addSalt("gypsum", caOnGypsum, "calcium");
	addSalt(caCl2Form, caOnCaCl2, "calcium");
	let mgSource = null;
	if (mgOnEpsom > 0 || mgOnMgCl2 > 0) mgSource = mgOnEpsom >= mgOnMgCl2 ? "epsom-salt" : "magnesium-chloride";
	else if (mgSources.length > 0) mgSource = mgSources.length === 1 ? mgSources[0] ?? null : "epsom-salt";
	let caSource = null;
	if (caOnGypsum > 0 || caOnCaCl2 > 0) caSource = caOnCaCl2 >= caOnGypsum ? caCl2Form ?? "gypsum" : "gypsum";
	else if (caSources.length > 0) caSource = caCl2Form ?? caSources[0] ?? null;
	return {
		gramsPerL,
		caSource,
		mgSource,
		blended: mgOnEpsom > 0 && mgOnMgCl2 > 0 || caOnGypsum > 0 && caOnCaCl2 > 0
	};
}
function evaluateWaterProfileRanges(ions, options = {}) {
	const normalized = {
		calcium: 0,
		magnesium: 0,
		potassium: 0,
		sodium: 0,
		sulfate: 0,
		chloride: 0,
		bicarbonate: 0
	};
	ION_FIELDS.forEach((ion) => {
		const raw = ions ? ions[ion] : void 0;
		normalized[ion] = Number.isFinite(Number(raw)) ? Number(raw) : 0;
	});
	const metrics = calculateMetrics(normalized);
	const ratio = calculateSo4ClRatio(normalized);
	const includeAdvanced = options.includeAdvanced !== false;
	const alkalinitySources = options.alkalinitySources !== void 0 ? options.alkalinitySources : (() => {
		const s = getEffectiveAlkalinitySource();
		return s ? [s] : [];
	})();
	const calciumSource = options.calciumSource !== void 0 ? options.calciumSource : getEffectiveCalciumSource();
	const magnesiumSource = options.magnesiumSource !== void 0 ? options.magnesiumSource : getEffectiveMagnesiumSource();
	const brewMethod = options.brewMethod === "espresso" ? "espresso" : "filter";
	const methodBands = WATER_PROFILE_RANGE_BANDS[brewMethod] || WATER_PROFILE_RANGE_BANDS.filter;
	const findings = [];
	function addFinding(severity, message) {
		findings.push({
			severity,
			message
		});
	}
	function formatBand(min, max, unit) {
		if (min != null && max != null) return `${min}-${max}${unit ? " " + unit : ""}`;
		if (min != null) return `>=${min}${unit ? " " + unit : ""}`;
		if (max != null) return `<=${max}${unit ? " " + unit : ""}`;
		return "n/a";
	}
	function addBandFinding(label, value, unit, preferredMin, preferredMax, warnMin, warnMax, dangerMin, dangerMax) {
		if (!Number.isFinite(value)) return;
		const valueText = `${Math.round(value * 10) / 10}${unit ? " " + unit : ""}`;
		const preferredBand = formatBand(preferredMin, preferredMax, unit);
		const direction = preferredMin != null && value < preferredMin || warnMin != null && value < warnMin || dangerMin != null && value < dangerMin ? "low" : "high";
		if (dangerMin != null && value < dangerMin || dangerMax != null && value > dangerMax) {
			addFinding("danger", `${label} is too ${direction} at ${valueText} (recommended ${preferredBand}).`);
			return;
		}
		if (warnMin != null && value < warnMin || warnMax != null && value > warnMax) addFinding("warn", `${label} is too ${direction} at ${valueText} (recommended ${preferredBand}).`);
	}
	function addBandFindingFromConfig(label, value, unit, band) {
		if (!band) return;
		addBandFinding(label, value, unit, band.preferredMin ?? null, band.preferredMax ?? null, band.warnMin ?? null, band.warnMax ?? null, band.dangerMin ?? null, band.dangerMax ?? null);
	}
	addBandFindingFromConfig("TDS", metrics.tds, "mg/L", methodBands.tds);
	addBandFindingFromConfig("KH", metrics.kh, "mg/L as CaCO3", methodBands.kh);
	addBandFindingFromConfig("GH", metrics.gh, "mg/L as CaCO3", methodBands.gh);
	addBandFindingFromConfig("Calcium", normalized.calcium, "mg/L", methodBands.calcium);
	addBandFindingFromConfig("Magnesium", normalized.magnesium, "mg/L", methodBands.magnesium);
	const sodiumBands = Array.isArray(alkalinitySources) && alkalinitySources.includes("baking-soda") ? methodBands.sodium.bakingSoda : methodBands.sodium.default;
	addBandFinding("Sodium", normalized.sodium, "mg/L", null, sodiumBands.preferredMax ?? null, null, sodiumBands.warnMax ?? null, null, sodiumBands.dangerMax ?? null);
	if (includeAdvanced) {
		const chlorideBands = calciumSource === "calcium-chloride" || calciumSource === "calcium-chloride-anhydrous" || magnesiumSource === "magnesium-chloride" ? methodBands.chloride.chlorideHeavy : methodBands.chloride.default;
		addBandFinding("Chloride", normalized.chloride, "mg/L", null, chlorideBands.preferredMax ?? null, null, chlorideBands.warnMax ?? null, null, chlorideBands.dangerMax ?? null);
		const sulfateWarnMax = methodBands.sulfate && Number.isFinite(methodBands.sulfate.warnMax) ? methodBands.sulfate.warnMax : 150;
		if (normalized.sulfate > sulfateWarnMax) addFinding("warn", `Sulfate is too high at ${Math.round(normalized.sulfate * 10) / 10} mg/L (recommended <=${sulfateWarnMax} mg/L).`);
		const potassiumDangerMax = methodBands.potassium && Number.isFinite(methodBands.potassium.dangerMax) ? methodBands.potassium.dangerMax : 100;
		if (normalized.potassium > potassiumDangerMax) addFinding("danger", `Potassium is too high at ${Math.round(normalized.potassium * 10) / 10} mg/L (recommended <=${potassiumDangerMax} mg/L).`);
	}
	findings.sort((a, b) => {
		return (RANGE_SEVERITY_ORDER[a.severity] ?? 99) - (RANGE_SEVERITY_ORDER[b.severity] ?? 99);
	});
	return {
		findings,
		metrics,
		ratio
	};
}
function splitAlkalinityDelta(alkalinitySources, deltaAlkAsCaCO3, sourceWater, targetProfile) {
	const result = {};
	if (alkalinitySources.length === 0) return result;
	if (alkalinitySources.length === 1) {
		const firstSource = alkalinitySources[0];
		if (firstSource) result[firstSource] = deltaAlkAsCaCO3;
		return result;
	}
	const targetNa = targetProfile && Number.isFinite(Number(targetProfile.sodium)) ? Number(targetProfile.sodium) : null;
	const targetK = targetProfile && Number.isFinite(Number(targetProfile.potassium)) ? Number(targetProfile.potassium) : null;
	const sourceNa = sourceWater && Number.isFinite(Number(sourceWater.sodium)) ? Number(sourceWater.sodium) : 0;
	const sourceK = sourceWater && Number.isFinite(Number(sourceWater.potassium)) ? Number(sourceWater.potassium) : 0;
	const deltaNa = targetNa != null ? Math.max(0, targetNa - sourceNa) : 0;
	const deltaK = targetK != null ? Math.max(0, targetK - sourceK) : 0;
	if (deltaNa > 0 && deltaK > 0) {
		const naEq = deltaNa / NA_ATOMIC_MASS;
		const kEq = deltaK / K_ATOMIC_MASS;
		const totalEq = naEq + kEq;
		result["baking-soda"] = deltaAlkAsCaCO3 * naEq / totalEq;
		result["potassium-bicarbonate"] = deltaAlkAsCaCO3 * kEq / totalEq;
	} else if (deltaNa > 0) result["baking-soda"] = deltaAlkAsCaCO3;
	else result["potassium-bicarbonate"] = deltaAlkAsCaCO3;
	return result;
}
/**
* Derive a multi-mineral stock concentrate formula from a recipe's per-ion
* target profile. Returns "a" valid solution, not "the" canonical one — the
* inverse problem is underdetermined (Mg can come from epsom or MgCl2, HCO3
* from baking-soda or KHCO3, etc.), so the user reviews and tweaks the
* derived list before saving.
*
* Greedy heuristic order:
*   1. HCO3 split between baking-soda (Na carrier) and KHCO3 (K carrier)
*      proportional to target Na and K (mirrors splitAlkalinityDelta).
*   2. Mg → epsom-salt when the recipe names no chloride, magnesium-chloride
*      when it names no sulfate, and a blend of the two when it names both,
*      sized so the concentrate's sulfate and chloride land as close as
*      possible to the recipe's (least squares, as allocateCaMgDoses does for
*      the Calculator's powders).
*   3. Ca → the selected calcium-chloride form (dihydrate by default; anhydrous
*      when that is the form the user has). Gypsum would match SO4-heavy targets
*      but its ~2 g/L solubility cap (MINERAL_SOLUBILITY_G_PER_L_25C_APPROX,
*      src/lib/constants.ts) is exceeded by even modest Ca
*      targets at concentrate strengths.
*   4. Residual K → potassium-chloride; residual Na → sodium-chloride.
*/
function deriveStockFormulaFromTarget(target, options) {
	options = options || {};
	let bottleMl = Number(options.bottleMl);
	let doseGramsPerL = Number(options.doseGramsPerL);
	if (!Number.isFinite(bottleMl) || bottleMl <= 0) bottleMl = 200;
	if (!Number.isFinite(doseGramsPerL) || doseGramsPerL <= 0) doseGramsPerL = 4;
	const notes = [];
	let minerals = [];
	function num(field) {
		if (!target) return 0;
		const v = Number(target[field]);
		return Number.isFinite(v) && v > 0 ? v : 0;
	}
	const tCa = num("calcium");
	const tMg = num("magnesium");
	const tK = num("potassium");
	const tNa = num("sodium");
	const tSO4 = num("sulfate");
	const tCl = num("chloride");
	const tBicarb = num("bicarbonate");
	const tAlk = num("alkalinity");
	const tHCO3 = tAlk > 0 && Math.abs(Math.round(tBicarb * .8201812609600603) - Math.round(tAlk)) > 1 ? tAlk * CACO3_TO_HCO3 : tBicarb;
	if (tCa + tMg + tK + tNa + tSO4 + tCl + tHCO3 === 0) {
		notes.push("Distilled / RO target: no minerals to derive.");
		return {
			bottleMl,
			doseGramsPerL,
			minerals,
			notes
		};
	}
	function gramsForIon(mineralId, ionName, mgPerL) {
		const entry = MINERAL_DB[mineralId];
		if (!entry || !entry.ions) return 0;
		const frac = entry.ions[ionName] || 0;
		if (frac <= 0 || mgPerL <= 0) return 0;
		return mgPerL * bottleMl / (1e3 * frac * doseGramsPerL);
	}
	/**
	* mg/L of side-ion produced when the mineral is sized to deliver primaryMgPerL
	* of the primary ion. = primaryMgPerL × (sideFrac / primaryFrac).
	*/
	function sideIonProduced(mineralId, primaryIon, primaryMgPerL, sideIon) {
		const entry = MINERAL_DB[mineralId];
		if (!entry || !entry.ions) return 0;
		const ionsRec = entry.ions;
		const primaryFrac = ionsRec[primaryIon] || 0;
		const sideFrac = ionsRec[sideIon] || 0;
		if (primaryFrac <= 0 || sideFrac <= 0 || primaryMgPerL <= 0) return 0;
		return primaryMgPerL * (sideFrac / primaryFrac);
	}
	let producedNa = 0;
	let producedK = 0;
	let producedSO4 = 0;
	if (tHCO3 > 0) {
		let hcoNa = 0;
		let hcoK = 0;
		if (tNa > 0 && tK > 0) {
			const bakingDb = MINERAL_DB["baking-soda"];
			const khcoDb = MINERAL_DB["potassium-bicarbonate"];
			const bakingNaFrac = bakingDb && bakingDb.ions && bakingDb.ions.sodium || 0;
			const bakingHCO3Frac = bakingDb && bakingDb.ions && bakingDb.ions.bicarbonate || 0;
			const khcoKFrac = khcoDb && khcoDb.ions && khcoDb.ions.potassium || 0;
			const khcoHCO3Frac = khcoDb && khcoDb.ions && khcoDb.ions.bicarbonate || 0;
			const directNaHCO3 = bakingNaFrac > 0 ? tNa * (bakingHCO3Frac / bakingNaFrac) : 0;
			const directKHCO3 = khcoKFrac > 0 ? tK * (khcoHCO3Frac / khcoKFrac) : 0;
			const directTotalHCO3 = directNaHCO3 + directKHCO3;
			const tolerance = Math.max(1, tHCO3 * .1);
			if (Math.abs(directTotalHCO3 - tHCO3) <= tolerance) {
				hcoNa = directNaHCO3;
				hcoK = directKHCO3;
			} else {
				const naEq = tNa / NA_ATOMIC_MASS;
				const kEq = tK / K_ATOMIC_MASS;
				hcoNa = tHCO3 * naEq / (naEq + kEq);
				hcoK = tHCO3 * kEq / (naEq + kEq);
			}
		} else if (tNa > 0) hcoNa = tHCO3;
		else hcoK = tHCO3;
		if (hcoNa > 0) {
			const gBaking = gramsForIon("baking-soda", "bicarbonate", hcoNa);
			if (gBaking > 0) {
				minerals.push({
					mineralId: "baking-soda",
					grams: gBaking
				});
				producedNa += sideIonProduced("baking-soda", "bicarbonate", hcoNa, "sodium");
			}
		}
		if (hcoK > 0) {
			const gKHCO3 = gramsForIon("potassium-bicarbonate", "bicarbonate", hcoK);
			if (gKHCO3 > 0) {
				minerals.push({
					mineralId: "potassium-bicarbonate",
					grams: gKHCO3
				});
				producedK += sideIonProduced("potassium-bicarbonate", "bicarbonate", hcoK, "potassium");
			}
		}
	}
	if (tMg > 0) {
		let mgOnEpsom;
		if (tCl === 0) mgOnEpsom = tMg;
		else if (tSO4 === 0) mgOnEpsom = 0;
		else {
			const so4PerMg = sideIonProduced("epsom-salt", "magnesium", 1, "sulfate");
			const clPerMg = sideIonProduced("magnesium-chloride", "magnesium", 1, "chloride");
			const fixedCl = sideIonProduced("calcium-chloride", "calcium", tCa, "chloride") + sideIonProduced("potassium-chloride", "potassium", Math.max(0, tK - producedK), "chloride") + sideIonProduced("sodium-chloride", "sodium", Math.max(0, tNa - producedNa), "chloride");
			const denom = so4PerMg * so4PerMg + clPerMg * clPerMg;
			let x = denom > 0 ? (so4PerMg * tSO4 + clPerMg * (fixedCl + clPerMg * tMg - tCl)) / denom : tSO4 / Math.max(tCl, 1) > 1 ? tMg : 0;
			x = Math.min(tMg, Math.max(0, x));
			if (x < .02 * tMg) x = 0;
			else if (x > .98 * tMg) x = tMg;
			mgOnEpsom = x;
		}
		const mgOnMgCl2 = tMg - mgOnEpsom;
		const gEpsom = gramsForIon("epsom-salt", "magnesium", mgOnEpsom);
		if (gEpsom > 0) {
			minerals.push({
				mineralId: "epsom-salt",
				grams: gEpsom
			});
			producedSO4 += sideIonProduced("epsom-salt", "magnesium", mgOnEpsom, "sulfate");
		}
		const gMgCl2 = gramsForIon("magnesium-chloride", "magnesium", mgOnMgCl2);
		if (gMgCl2 > 0) minerals.push({
			mineralId: "magnesium-chloride",
			grams: gMgCl2
		});
	}
	if (tCa > 0) {
		const requestedCaId = options.calciumChlorideId;
		let caId;
		if (requestedCaId === "calcium-chloride" || requestedCaId === "calcium-chloride-anhydrous") caId = requestedCaId;
		else {
			const powders = loadSelectedMinerals();
			caId = (powders.includes("calcium-chloride") ? "calcium-chloride" : powders.includes("calcium-chloride-anhydrous") ? "calcium-chloride-anhydrous" : getEffectiveCalciumSource()) === "calcium-chloride-anhydrous" ? "calcium-chloride-anhydrous" : "calcium-chloride";
		}
		if (tSO4 > 0 && tSO4 / Math.max(tCl, 1) > 1 && tSO4 - producedSO4 > 1) notes.push("Used calcium-chloride for Ca even though target favors sulfate; gypsum's ~2 g/L solubility limit makes it impractical at concentrate strengths.");
		const gCa = gramsForIon(caId, "calcium", tCa);
		if (gCa > 0) minerals.push({
			mineralId: caId,
			grams: gCa
		});
	}
	const residK = Math.max(0, tK - producedK);
	const residNa = Math.max(0, tNa - producedNa);
	if (residK > 0) {
		const gKCl = gramsForIon("potassium-chloride", "potassium", residK);
		if (gKCl > 0) minerals.push({
			mineralId: "potassium-chloride",
			grams: gKCl
		});
	}
	if (residNa > 0) {
		const gNaCl = gramsForIon("sodium-chloride", "sodium", residNa);
		if (gNaCl > 0) minerals.push({
			mineralId: "sodium-chloride",
			grams: gNaCl
		});
	}
	if (tSO4 - producedSO4 > 1) notes.push("Target sulfate of " + Math.round(tSO4) + " mg/L exceeds what the chosen Mg source supplies (~" + Math.round(producedSO4) + " mg/L). Gypsum could close the gap but isn't soluble at concentrate strengths.");
	minerals = minerals.map(function(m) {
		return {
			mineralId: m.mineralId,
			grams: Math.round(m.grams * 10) / 10
		};
	}).filter(function(m) {
		return m.grams > 0;
	});
	minerals.forEach(function(m) {
		const cap = MINERAL_SOLUBILITY_G_PER_L_25C_APPROX[m.mineralId];
		if (!cap) return;
		const concentrationGperL = m.grams / (bottleMl / 1e3);
		if (concentrationGperL > cap) {
			const entry = MINERAL_DB[m.mineralId];
			const name = entry && entry.name || m.mineralId;
			notes.push(name + " in bottle (" + concentrationGperL.toFixed(1) + " g/L) exceeds approximate solubility (" + cap + " g/L); use a higher dose per liter, which makes the bottle weaker.");
		}
	});
	return {
		bottleMl,
		doseGramsPerL,
		minerals,
		notes
	};
}
/**
* Transpose an m×n matrix to n×m.
*/
function _matTranspose(A) {
	if (!A || A.length === 0) return [];
	const m = A.length;
	const firstRow = A[0];
	const n = firstRow ? firstRow.length : 0;
	const out = [];
	for (let j = 0; j < n; j++) {
		const row = [];
		for (let i = 0; i < m; i++) {
			const ai = A[i];
			row.push(ai && ai[j] || 0);
		}
		out.push(row);
	}
	return out;
}
/**
* Multiply matrix A (m×n) by matrix B (n×p), returning an m×p matrix.
*/
function _matMul(A, B) {
	const m = A.length;
	const n = A[0]?.length || 0;
	const p = B[0]?.length || 0;
	const out = [];
	for (let i = 0; i < m; i++) {
		const rowA = A[i];
		const row = new Array(p).fill(0);
		if (!rowA) {
			out.push(row);
			continue;
		}
		for (let k = 0; k < n; k++) {
			const aik = rowA[k] || 0;
			if (aik === 0) continue;
			const rowB = B[k];
			if (!rowB) continue;
			for (let j = 0; j < p; j++) row[j] = (row[j] || 0) + aik * (rowB[j] || 0);
		}
		out.push(row);
	}
	return out;
}
/**
* Multiply matrix A (m×n) by vector x (n), returning a vector of length m.
*/
function _matVec(A, x) {
	const m = A.length;
	const n = A[0]?.length || 0;
	const out = new Array(m).fill(0);
	for (let i = 0; i < m; i++) {
		const row = A[i];
		if (!row) continue;
		let s = 0;
		for (let j = 0; j < n; j++) s += (row[j] || 0) * (x[j] || 0);
		out[i] = s;
	}
	return out;
}
/**
* Solve an n×n linear system Mx = c via Gaussian elimination with partial
* pivoting. Returns null if the system is singular (no unique solution).
* Mutates copies of M and c; the inputs are not modified.
*/
function _solveLinear(M, c) {
	const n = M.length;
	if (n === 0) return [];
	const aug = M.map((row, i) => (row || []).concat([c[i] || 0]));
	for (let col = 0; col < n; col++) {
		let pivot = col;
		for (let row = col + 1; row < n; row++) {
			const augRow = aug[row];
			const augPivot = aug[pivot];
			const a = augRow && augRow[col] || 0;
			const p = augPivot && augPivot[col] || 0;
			if (Math.abs(a) > Math.abs(p)) pivot = row;
		}
		const augPivotRow = aug[pivot];
		const pivotVal = augPivotRow && augPivotRow[col] || 0;
		if (Math.abs(pivotVal) < 1e-12) return null;
		if (pivot !== col) {
			const tmp = aug[col] || [];
			const pRow = aug[pivot] || [];
			aug[col] = pRow;
			aug[pivot] = tmp;
		}
		const colRow = aug[col];
		if (!colRow) continue;
		const colDiag = colRow[col] || 0;
		if (colDiag === 0) continue;
		for (let row = col + 1; row < n; row++) {
			const rowVec = aug[row];
			if (!rowVec) continue;
			const factor = (rowVec[col] || 0) / colDiag;
			if (factor === 0) continue;
			for (let k = col; k <= n; k++) rowVec[k] = (rowVec[k] || 0) - factor * (colRow[k] || 0);
		}
	}
	const x = new Array(n).fill(0);
	for (let row = n - 1; row >= 0; row--) {
		const augRow = aug[row];
		if (!augRow) continue;
		let s = augRow[n] || 0;
		for (let col = row + 1; col < n; col++) s -= (augRow[col] || 0) * (x[col] || 0);
		const diag = augRow[row] || 0;
		x[row] = diag === 0 ? 0 : s / diag;
	}
	return x;
}
/**
* Non-negative least squares. Find x ≥ 0 minimizing ||A·x - b||².
*
* Lawson–Hanson active-set algorithm. Start with every variable held at 0,
* repeatedly free the variable whose gradient most reduces the error, solve
* the unconstrained problem over the free ("passive") set, and when that
* solution goes negative step back to the feasible boundary and re-bind the
* variables that hit 0. Unlike dropping every negative variable at once (the
* previous approach), this converges to the true constrained optimum: a
* variable bound at 0 can be freed again later if the gradient says it helps.
*
* @param A — m×n matrix
* @param b — m-vector
* @returns x — n-vector, all entries ≥ 0
*/
function solveNNLS(A, b) {
	if (!A || A.length === 0) return [];
	const n = A[0]?.length || 0;
	if (n === 0) return [];
	const m = A.length;
	const col = (j) => A.map((row) => row && row[j] || 0);
	const residual = (x) => A.map((row, i) => {
		let s = b[i] || 0;
		for (let j = 0; j < n; j++) s -= (row && row[j] || 0) * (x[j] || 0);
		return s;
	});
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < m; i++) {
		normB += (b[i] || 0) * (b[i] || 0);
		for (let j = 0; j < n; j++) {
			const v = A[i] && A[i][j] || 0;
			normA += v * v;
		}
	}
	const tol = 1e-10 * Math.max(1, Math.sqrt(normA) * Math.sqrt(normB));
	function solvePassive(passive) {
		const Ap = A.map((row) => passive.map((j) => row && row[j] || 0));
		const At = _matTranspose(Ap);
		return _solveLinear(_matMul(At, Ap), _matVec(At, b));
	}
	const x = new Array(n).fill(0);
	const passive = /* @__PURE__ */ new Set();
	const blocked = /* @__PURE__ */ new Set();
	for (let outer = 0; outer < 3 * n + 30; outer++) {
		const r = residual(x);
		let bestJ = -1;
		let bestW = tol;
		for (let j = 0; j < n; j++) {
			if (passive.has(j) || blocked.has(j)) continue;
			const cj = col(j);
			let w = 0;
			for (let i = 0; i < m; i++) w += (cj[i] || 0) * (r[i] || 0);
			if (w > bestW) {
				bestW = w;
				bestJ = j;
			}
		}
		if (bestJ < 0) break;
		passive.add(bestJ);
		for (let inner = 0; inner < 3 * n + 30; inner++) {
			const idx = [...passive].sort((a, c) => a - c);
			const z = solvePassive(idx);
			if (z === null) {
				passive.delete(bestJ);
				blocked.add(bestJ);
				x[bestJ] = 0;
				break;
			}
			if (z.every((v) => v > 0)) {
				idx.forEach((j, k) => {
					x[j] = z[k] || 0;
				});
				break;
			}
			let alpha = 1;
			idx.forEach((j, k) => {
				const zj = z[k] || 0;
				if (zj <= 0) {
					const xj = x[j] || 0;
					const denom = xj - zj;
					if (denom > 0) alpha = Math.min(alpha, xj / denom);
				}
			});
			idx.forEach((j, k) => {
				const xj = x[j] || 0;
				x[j] = xj + alpha * ((z[k] || 0) - xj);
			});
			idx.forEach((j) => {
				if ((x[j] || 0) <= tol) {
					x[j] = 0;
					passive.delete(j);
				}
			});
			if (passive.size === 0) break;
		}
	}
	return x.map((v) => Math.max(0, v || 0));
}
/**
* Inverse-solve dosing for the calculator's stock-active branch: given the
* source water, target ion profile, list of enabled Recipe Concentrate
* specs, and list of enabled mineral salt ids, find the per-source dose that
* minimizes squared error against the target.
*
* For each Recipe Concentrate, the column of A is its per-gram ion
* contribution at unit dose (i.e. 1 g/L of the concentrate). For each
* mineral salt, the column is its per-gram ion contribution. b is
* target − sourceWater per ion. Solver units are grams per liter of brew
* water; multiply by volumeL outside to get displayed amounts.
*/
function isConcentrateMadeFor(entry, slug) {
	const from = entry.spec && typeof entry.spec.createdFrom === "string" ? entry.spec.createdFrom : "";
	if (from === "library:" + slug || from === "derived:" + slug) return true;
	return entry.id === "stock:" + slug;
}
function concentrateAddsMinerals(entry) {
	const spec = entry.spec;
	if (!spec || !(Number(spec.doseGramsPerL) > 0) || !Array.isArray(spec.minerals)) return false;
	return spec.minerals.some((mm) => !!mm && Number(mm.grams) > 0);
}
function solveCalculatorDosing(sourceWater, target, concentrateEntries, mineralIds, options) {
	const entries = Array.isArray(concentrateEntries) ? concentrateEntries : [];
	const mins = Array.isArray(mineralIds) ? mineralIds : [];
	const b = [];
	ION_FIELDS.forEach((ion) => {
		const tgt = target && target[ion] != null ? Number(target[ion]) : 0;
		const src = sourceWater && sourceWater[ion] != null ? Number(sourceWater[ion]) : 0;
		b.push(Number.isFinite(tgt) && Number.isFinite(src) ? tgt - src : 0);
	});
	const A = ION_FIELDS.map(() => []);
	const concentrateOrder = [];
	for (const entry of entries) {
		if (!entry || !entry.spec) continue;
		const dosePerL = Number(entry.spec.doseGramsPerL) || 0;
		if (dosePerL <= 0) continue;
		const perLAtPrescribed = computeStockMineralGramsPerL(entry.spec);
		const perGramOfConcentrate = {};
		for (const [mid, g] of Object.entries(perLAtPrescribed)) perGramOfConcentrate[mid] = g / dosePerL;
		const ions = calculateIonPPMs(perGramOfConcentrate);
		ION_FIELDS.forEach((ion, i) => {
			const col = A[i];
			if (col) col.push(ions[ion] || 0);
		});
		concentrateOrder.push(entry.id);
	}
	const mineralOrder = [];
	for (const mid of mins) {
		if (!MINERAL_DB[mid]) continue;
		const ions = calculateIonPPMs({ [mid]: 1 });
		ION_FIELDS.forEach((ion, i) => {
			const col = A[i];
			if (col) col.push(ions[ion] || 0);
		});
		mineralOrder.push(mid);
	}
	const UNSPECIFIED_ION_WEIGHT = .01;
	const recipeSlug = options && options.recipeSlug ? String(options.recipeSlug) : "";
	const madeForRecipe = entries.length === 0 || recipeSlug !== "" && entries.some((e) => !!e && isConcentrateMadeFor(e, recipeSlug) && concentrateAddsMinerals(e));
	const targetOf = (ion) => {
		const v = target && target[ion] != null ? Number(target[ion]) : 0;
		return Number.isFinite(v) ? v : 0;
	};
	const anionsBlank = (targetOf("calcium") > 0 || targetOf("magnesium") > 0) && targetOf("sulfate") <= 0 && targetOf("chloride") <= 0;
	const cationsBlank = targetOf("bicarbonate") > 0 && targetOf("sodium") <= 0 && targetOf("potassium") <= 0;
	const rowScale = ION_FIELDS.map((ion) => {
		if (!madeForRecipe || targetOf(ion) > 0) return 1;
		if ((ion === "sulfate" || ion === "chloride") && anionsBlank) return UNSPECIFIED_ION_WEIGHT;
		if ((ion === "sodium" || ion === "potassium") && cationsBlank) return UNSPECIFIED_ION_WEIGHT;
		return 1;
	});
	const weightedA = A.map((row, i) => row.map((v) => v * (rowScale[i] ?? 1)));
	const weightedB = b.map((v, i) => v * (rowScale[i] ?? 1));
	let x = [];
	if (concentrateOrder.length + mineralOrder.length > 0) x = solveNNLS(weightedA, weightedB);
	const SNAP_PRESCRIBED_REL = .1;
	const SNAP_ZERO_REL = .1;
	if (concentrateOrder.some((id, k) => {
		const entry = entries.find((e) => e && e.id === id);
		if (!entry || !entry.spec) return false;
		const prescribed = Number(entry.spec.doseGramsPerL) || 0;
		if (prescribed <= 0) return false;
		const solved = x[k] || 0;
		return solved > 0 && Math.abs(solved - prescribed) / prescribed <= SNAP_PRESCRIBED_REL;
	})) concentrateOrder.forEach((id, k) => {
		const entry = entries.find((e) => e && e.id === id);
		if (!entry || !entry.spec) return;
		const prescribed = Number(entry.spec.doseGramsPerL) || 0;
		if (prescribed <= 0) return;
		const solved = x[k] || 0;
		if (solved > 0 && solved / prescribed < SNAP_ZERO_REL) x[k] = 0;
	});
	concentrateOrder.forEach((id, k) => {
		const entry = entries.find((e) => e && e.id === id);
		if (!entry || !entry.spec) return;
		const prescribed = Number(entry.spec.doseGramsPerL) || 0;
		if (prescribed <= 0) return;
		const solved = x[k] || 0;
		if (solved <= 0) return;
		if (Math.abs(solved - prescribed) / prescribed <= SNAP_PRESCRIBED_REL) x[k] = prescribed;
	});
	const concentrateGramsPerL = {};
	const mineralGramsPerL = {};
	concentrateOrder.forEach((id, k) => {
		concentrateGramsPerL[id] = Math.max(0, x[k] || 0);
	});
	mineralOrder.forEach((id, k) => {
		mineralGramsPerL[id] = Math.max(0, x[concentrateOrder.length + k] || 0);
	});
	const Ax = _matVec(A, x);
	const residualIons = {
		calcium: 0,
		magnesium: 0,
		potassium: 0,
		sodium: 0,
		sulfate: 0,
		chloride: 0,
		bicarbonate: 0
	};
	let maxResidualIon = null;
	ION_FIELDS.forEach((ion, i) => {
		const resid = (b[i] || 0) - (Ax[i] || 0);
		residualIons[ion] = resid;
		if (maxResidualIon === null || Math.abs(resid) > Math.abs(maxResidualIon.residual)) maxResidualIon = {
			ion,
			residual: resid
		};
	});
	return {
		concentrateGramsPerL,
		mineralGramsPerL,
		residualIons,
		maxResidualIon
	};
}
// src/lib/dosing.ts
function nonNegative(value) {
	return Math.max(0, parseFloat(String(value ?? "")) || 0);
}
/** mL a concentrate row displays: whole drops when it has a dropper and is set to drops, else mL. */
function shownConcentrateMl(ml, row) {
	if (row.dropMl > 0) return displayedConcentrateMl(ml, row.unit, row.dropMl);
	return displayedConcentrateMl(ml, "ml", 0);
}
function toMineralKit(kit) {
	return {
		minerals: kit.minerals,
		concentrates: kit.concentrates.filter((c) => !!c.mineralId).map((c) => ({
			id: c.id,
			mineralId: c.mineralId,
			gramsPerMl: c.gramsPerMl
		})),
		recipeConcentrates: kit.recipeConcentrates.map((rc) => ({
			id: rc.id,
			mineralIds: getStockMineralIds(rc.spec)
		}))
	};
}
/** The single calcium source the kit doses from (storage's getEffectiveCalciumSource, for a kit). */
function effectiveCalciumSource(kit) {
	return singleCalciumSource(calciumSources(toMineralKit(kit)));
}
function finalIonsFrom(sourceWater, mineralGramsPerL) {
	const added = calculateIonPPMs(mineralGramsPerL);
	const out = {};
	ION_FIELDS.forEach((ion) => {
		out[ion] = (sourceWater[ion] || 0) + (added[ion] || 0);
	});
	return out;
}
function computeDoses(input) {
	const { sourceWater, target, kit } = input;
	const volumeL = Number(input.volumeL) || 0;
	const mineralKit = toMineralKit(kit);
	const alkalinitySources$1 = alkalinitySources(mineralKit);
	const caSourceIds = calciumSources(mineralKit);
	const mgSourceIds = magnesiumSources(mineralKit);
	const stockEntries = kit.recipeConcentrates;
	const result = {
		status: "ok",
		mode: stockEntries.length > 0 ? "recipe-concentrates" : "minerals",
		sources: {
			alkalinity: alkalinitySources$1,
			calcium: caSourceIds,
			magnesium: mgSourceIds
		},
		mineralGrams: {},
		concentrateMl: {},
		recipeConcentrateMl: {},
		supplementGramsPerL: {},
		enableSuggestions: [],
		shown: {
			mineralGrams: {},
			concentrateMl: {},
			recipeConcentrateMl: {},
			supplementGrams: {}
		},
		warnings: [],
		finalIons: null,
		rangeSources: {
			alkalinitySources: alkalinitySources$1,
			calciumSource: singleCalciumSource(caSourceIds),
			magnesiumSource: singleMagnesiumSource(mgSourceIds)
		}
	};
	if (!volumeL || volumeL <= 0) {
		result.status = "no-volume";
		alkalinitySources$1.forEach((id) => result.mineralGrams[id] = 0);
		mgSourceIds.forEach((id) => result.mineralGrams[id] = 0);
		caSourceIds.forEach((id) => result.mineralGrams[id] = 0);
		for (const { id } of stockEntries) result.recipeConcentrateMl[id] = 0;
		return result;
	}
	if (alkalinitySources$1.length === 0) {
		result.status = "no-alkalinity-source";
		return result;
	}
	const sourceAlkAsCaCO3 = (sourceWater.bicarbonate || 0) * HCO3_TO_CACO3;
	const targetCaMgL = nonNegative(target.calcium);
	const targetMgMgL = nonNegative(target.magnesium);
	const targetAlkAsCaCO3 = nonNegative(target.alkalinity);
	const rawDeltaCa = targetCaMgL - (sourceWater.calcium || 0);
	const rawDeltaMg = targetMgMgL - (sourceWater.magnesium || 0);
	const rawDeltaAlk = targetAlkAsCaCO3 - sourceAlkAsCaCO3;
	if (stockEntries.length > 0) {
		const solverTarget = Object.assign({}, target, { bicarbonate: toStableBicarbonateFromAlkalinity(targetAlkAsCaCO3, target.bicarbonate) });
		const solve = solveCalculatorDosing(sourceWater, solverTarget, stockEntries, [], { recipeSlug: input.recipeSlug ?? null });
		const residualIons = solve.residualIons;
		const SUPP_THRESHOLD = 1;
		const residualCa = Math.max(0, residualIons.calcium || 0);
		const residualMg = Math.max(0, residualIons.magnesium || 0);
		const residualAlkAsCaCO3 = Math.max(0, (residualIons.bicarbonate || 0) * HCO3_TO_CACO3);
		const selectedMinerals = kit.minerals;
		const supplementGramsPerL = result.supplementGramsPerL;
		const enableSuggestions = result.enableSuggestions;
		if (residualCa > SUPP_THRESHOLD) {
			const caId = [
				"calcium-chloride",
				"calcium-chloride-anhydrous",
				"gypsum"
			].find((id) => selectedMinerals.includes(id));
			if (caId) {
				const frac = MINERAL_DB[caId]?.ions?.calcium || 0;
				if (frac > 0) supplementGramsPerL[caId] = residualCa / frac / 1e3;
			} else enableSuggestions.push({
				ion: "calcium",
				mineralId: "calcium-chloride"
			});
		}
		if (residualMg > SUPP_THRESHOLD) {
			const mgId = ["epsom-salt", "magnesium-chloride"].find((id) => selectedMinerals.includes(id));
			if (mgId) {
				const frac = MINERAL_DB[mgId]?.ions?.magnesium || 0;
				if (frac > 0) supplementGramsPerL[mgId] = residualMg / frac / 1e3;
			} else enableSuggestions.push({
				ion: "magnesium",
				mineralId: "epsom-salt"
			});
		}
		if (residualAlkAsCaCO3 > SUPP_THRESHOLD) {
			const enabledAlk = ["baking-soda", "potassium-bicarbonate"].filter((id) => selectedMinerals.includes(id));
			if (enabledAlk.length > 0) {
				const alloc = splitAlkalinityDelta(enabledAlk, residualAlkAsCaCO3, sourceWater, solverTarget);
				if ((alloc["baking-soda"] || 0) > 0) supplementGramsPerL["baking-soda"] = alloc["baking-soda"] * ALK_TO_BAKING_SODA / 1e3;
				if ((alloc["potassium-bicarbonate"] || 0) > 0) supplementGramsPerL["potassium-bicarbonate"] = alloc["potassium-bicarbonate"] * ALK_TO_POTASSIUM_BICARB / 1e3;
			} else enableSuggestions.push({
				ion: "bicarbonate",
				mineralId: "baking-soda"
			});
		}
		const combinedStockMineralGramsPerL = {};
		for (const entry of stockEntries) {
			const ml = (solve.concentrateGramsPerL[entry.id] || 0) * volumeL;
			result.recipeConcentrateMl[entry.id] = ml;
			const shownMl = shownConcentrateMl(ml, entry);
			result.shown.recipeConcentrateMl[entry.id] = shownMl;
			const gPerL = shownMl / volumeL;
			const dosePerL = Number(entry.spec.doseGramsPerL) || 0;
			if (dosePerL > 0 && gPerL > 0) {
				const perLAtPrescribed = computeStockMineralGramsPerL(entry.spec);
				const scale = gPerL / dosePerL;
				for (const mid of Object.keys(perLAtPrescribed)) combinedStockMineralGramsPerL[mid] = (combinedStockMineralGramsPerL[mid] || 0) + perLAtPrescribed[mid] * scale;
			}
		}
		for (const [mid, gPerL] of Object.entries(supplementGramsPerL)) if (gPerL > 0) {
			const shownGrams = displayedGrams(gPerL * volumeL);
			result.shown.supplementGrams[mid] = shownGrams;
			combinedStockMineralGramsPerL[mid] = (combinedStockMineralGramsPerL[mid] || 0) + shownGrams / volumeL;
		}
		if ((residualIons.calcium || 0) < -1) {
			const achieved = Math.round(targetCaMgL - (residualIons.calcium || 0));
			result.warnings.push(`Source water + Recipe Concentrate already exceed the target for Calcium (${achieved} vs ${targetCaMgL} mg/L).`);
		}
		if ((residualIons.magnesium || 0) < -1) {
			const achieved = Math.round(targetMgMgL - (residualIons.magnesium || 0));
			result.warnings.push(`Source water + Recipe Concentrate already exceed the target for Magnesium (${achieved} vs ${targetMgMgL} mg/L).`);
		}
		const alkResidAsCaCO3 = (residualIons.bicarbonate || 0) * HCO3_TO_CACO3;
		if (alkResidAsCaCO3 < -1) {
			const achieved = Math.round(targetAlkAsCaCO3 - alkResidAsCaCO3);
			result.warnings.push(`Source water + Recipe Concentrate already exceed the target for Alkalinity (${achieved} vs ${targetAlkAsCaCO3} mg/L as CaCO₃).`);
		}
		result.finalIons = finalIonsFrom(sourceWater, combinedStockMineralGramsPerL);
		return result;
	}
	const deltaCa = Math.max(0, rawDeltaCa);
	const deltaMg = Math.max(0, rawDeltaMg);
	const deltaAlkAsCaCO3 = Math.max(0, rawDeltaAlk);
	const allocation = allocateCaMgDoses(sourceWater, target, deltaCa, deltaMg, {
		calcium: caSourceIds,
		magnesium: mgSourceIds
	});
	result.rangeSources = {
		alkalinitySources: alkalinitySources$1,
		calciumSource: allocation.caSource,
		magnesiumSource: allocation.mgSource
	};
	const warnings = result.warnings;
	const selectedMinerals = kit.minerals;
	const conflictMineralIds = /* @__PURE__ */ new Set();
	const CACL2_FORMS = ["calcium-chloride", "calcium-chloride-anhydrous"];
	kit.concentrates.forEach((c) => {
		const mineralId = c.mineralId;
		if (!mineralId) return;
		if (!(c.gramsPerMl > 0)) return;
		if (CACL2_FORMS.includes(mineralId) ? CACL2_FORMS.some((form) => selectedMinerals.includes(form)) : selectedMinerals.includes(mineralId)) conflictMineralIds.add(mineralId);
	});
	if (conflictMineralIds.size > 0) warnings.push("You’ve selected both the normal and concentrate version of a mineral. We will default to using the concentrate.");
	if (rawDeltaCa < 0) warnings.push(`Your source water already exceeds the target for Calcium (${sourceWater.calcium || 0} vs ${targetCaMgL} mg/L).`);
	if (rawDeltaMg < 0) warnings.push(`Your source water already exceeds the target for Magnesium (${sourceWater.magnesium || 0} vs ${targetMgMgL} mg/L).`);
	if (rawDeltaAlk < 0) warnings.push(`Your source water already exceeds the target for Alkalinity (${Math.round(sourceAlkAsCaCO3)} vs ${targetAlkAsCaCO3} mg/L as CaCO₃).`);
	if (mgSourceIds.length === 0 && deltaMg > 0) warnings.push("You need an enabled magnesium source (Epsom Salt or Magnesium Chloride).");
	if (caSourceIds.length === 0 && deltaCa > 0) warnings.push("You need an enabled calcium source (Calcium Chloride or Gypsum).");
	const caMgGramsPerL = allocation.gramsPerL;
	const alkAllocation = splitAlkalinityDelta(alkalinitySources$1, deltaAlkAsCaCO3, sourceWater, target);
	const bufferGramsPerL = {};
	if (alkAllocation["baking-soda"] != null && alkAllocation["baking-soda"] > 0) bufferGramsPerL["baking-soda"] = alkAllocation["baking-soda"] * ALK_TO_BAKING_SODA / 1e3;
	if (alkAllocation["potassium-bicarbonate"] != null && alkAllocation["potassium-bicarbonate"] > 0) bufferGramsPerL["potassium-bicarbonate"] = alkAllocation["potassium-bicarbonate"] * ALK_TO_POTASSIUM_BICARB / 1e3;
	if (alkalinitySources$1.length === 2 && deltaAlkAsCaCO3 > 0) {
		const usedSources = Object.keys(alkAllocation).filter((k) => alkAllocation[k] > 0);
		if (usedSources.length === 1) {
			const usedName = usedSources[0] === "baking-soda" ? "Baking Soda" : "Potassium Bicarbonate";
			const targetNa = Number(target && target.sodium) || 0;
			const targetK = Number(target && target.potassium) || 0;
			const usedSodium = usedSources[0] === "baking-soda";
			const reason = (usedSodium ? targetK : targetNa) > 0 ? "your source water already meets the " + (usedSodium ? "potassium" : "sodium") + " target" : (usedSodium ? targetNa : targetK) > 0 ? "the target profile only calls for " + (usedSodium ? "sodium" : "potassium") : "the target profile has no Na/K targets to guide the split";
			warnings.push("Both alkalinity sources are enabled, but " + reason + ": using only " + usedName + ".");
		}
	}
	const resultValues = {};
	for (const [id, gPerL] of Object.entries(bufferGramsPerL)) resultValues[id] = gPerL * volumeL;
	for (const [id, gPerL] of Object.entries(caMgGramsPerL)) resultValues[id] = gPerL * volumeL;
	mgSourceIds.forEach((id) => {
		if (resultValues[id] == null) resultValues[id] = 0;
	});
	caSourceIds.forEach((id) => {
		if (resultValues[id] == null) resultValues[id] = 0;
	});
	const mineralGrams = { ...resultValues };
	conflictMineralIds.forEach((mineralId) => {
		mineralGrams[mineralId] = 0;
	});
	result.mineralGrams = mineralGrams;
	const rowSources = /* @__PURE__ */ new Set([
		...mgSourceIds,
		...alkalinitySources$1,
		...caSourceIds
	]);
	for (const [mineralId, grams] of Object.entries(mineralGrams)) if (selectedMinerals.includes(mineralId) && MINERAL_DB[mineralId]) result.shown.mineralGrams[mineralId] = displayedGrams(grams);
	const dosedByConcentrate = {};
	const sharedSaltNames = /* @__PURE__ */ new Set();
	kit.concentrates.forEach((c) => {
		const mineralId = c.mineralId;
		if (!mineralId) return;
		const grams = resultValues[mineralId] != null ? Number(resultValues[mineralId]) : 0;
		const gramsPerMl = c.gramsPerMl;
		if (!Number.isFinite(gramsPerMl) || gramsPerMl <= 0) {
			result.concentrateMl[c.id] = 0;
			const slot = [
				ALKALINITY_SLOT,
				CALCIUM_SLOT,
				MAGNESIUM_SLOT
			].find((s) => s.includes(mineralId));
			if ((slot ? Math.max(...slot.map((id) => Number(resultValues[id]) || 0)) : grams) > 0 && !dosedByConcentrate[mineralId]) warnings.push("Set bottle mL and grams per bottle in Settings to use this concentrate.");
			return;
		}
		if (dosedByConcentrate[mineralId]) {
			result.concentrateMl[c.id] = 0;
			if (grams > 0) sharedSaltNames.add(MINERAL_DB[mineralId]?.name || mineralId);
			return;
		}
		dosedByConcentrate[mineralId] = c.id;
		result.concentrateMl[c.id] = Math.max(0, grams / gramsPerMl);
	});
	sharedSaltNames.forEach((name) => {
		warnings.push("More than one enabled concentrate supplies " + name + ". Only the first one is dosed; use just that one.");
	});
	for (const c of kit.concentrates) {
		if (!c.mineralId || !rowSources.has(c.mineralId)) continue;
		if (!BRAND_CONCENTRATES[c.id] && !MINERAL_DB[c.mineralId]) continue;
		result.shown.concentrateMl[c.id] = shownConcentrateMl(result.concentrateMl[c.id] || 0, c);
	}
	const mineralGramsPerL = {};
	for (const [id, grams] of Object.entries(result.shown.mineralGrams)) if (grams > 0) mineralGramsPerL[id] = grams / volumeL;
	for (const c of kit.concentrates) {
		const ml = result.shown.concentrateMl[c.id];
		if (!c.mineralId || ml == null || !(ml > 0) || !(c.gramsPerMl > 0)) continue;
		mineralGramsPerL[c.mineralId] = (mineralGramsPerL[c.mineralId] || 0) + ml * c.gramsPerMl / volumeL;
	}
	result.finalIons = finalIonsFrom(sourceWater, mineralGramsPerL);
	return result;
}
/** The powders a new user starts with (storage.ts's DEFAULT_SELECTED_MINERALS). */
const STARTER_MINERALS = [
	"calcium-chloride",
	"epsom-salt",
	"baking-soda"
];
/**
* The dosing kit for a set of saved settings: what the Calculator page would
* dose with, and how it would display each concentrate, for a user whose
* settings are these.
*/
function buildDosingKit(settings) {
	const minerals = Array.isArray(settings.selectedMinerals) ? settings.selectedMinerals.filter((id) => typeof id === "string") : STARTER_MINERALS.slice();
	const selected = Array.isArray(settings.selectedConcentrates) ? settings.selectedConcentrates.filter((id) => typeof id === "string" && (id.startsWith("diy:") || id.startsWith("brand:") || id.startsWith("stock:"))) : [];
	const diySpecs = settings.diySpecs || {};
	const stockSpecs = settings.stockSpecs || {};
	const units = settings.concentrateUnits || {};
	const displayOf = (id) => {
		const dropMl = concentrateDropMl(id, {
			lotusDropperType: settings.lotusDropperType,
			diySpecs,
			stockSpecs
		});
		if (!(dropMl > 0)) return {
			dropMl: 0,
			unit: "ml"
		};
		return {
			dropMl,
			unit: units[id] === "ml" ? "ml" : "drops"
		};
	};
	const kit = {
		minerals,
		concentrates: [],
		recipeConcentrates: []
	};
	for (const id of selected) {
		if (id.startsWith("stock:")) {
			const spec = stockSpecs[id.slice(6)];
			if (spec) kit.recipeConcentrates.push({
				id,
				spec,
				...displayOf(id)
			});
			continue;
		}
		kit.concentrates.push({
			id,
			mineralId: concentrateMineralId(id),
			gramsPerMl: concentrateGramsPerMl(id, diySpecs),
			...displayOf(id)
		});
	}
	return kit;
}
export { BRAND_CONCENTRATES, CACO3_TO_HCO3, HCO3_TO_CACO3, ION_FIELDS, LIBRARY_TAGS, MINERAL_DB, MINERAL_SOLUBILITY_G_PER_L_25C_APPROX, RESERVED_LIBRARY_STOCK_SLUGS, RESERVED_TARGET_KEYS, SOURCE_PRESETS, TARGET_PRESETS, buildDosingKit, calculateIonPPMs, calculateMetrics, calculateSo4ClRatio, computeDoses, computeStockMineralGramsPerL, deriveStockFormulaFromTarget, effectiveCalciumSource, evaluateWaterProfileRanges, recipeMetricsSummary, slugify, validateProfileName };
