// GENERATED FILE - do not edit. Source: src/lib/mcp-core.ts
// Regenerate with: npm run mcp:build
// source-hash: e45d46899d54bee8f00ea4f241389d793b6e1a409ee02c671a6292cf4b93ae47
// body-hash: ebe1b367739bb4396243a0fdb91a00c2ff411b5dcf24cda10824fbd61048539a
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
2 * MINERAL_DB_LITERAL["baking-soda"].mw / MW_CACO3;
2 * MINERAL_DB_LITERAL["potassium-bicarbonate"].mw / MW_CACO3;
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
	const selectedType = loadLotusDropperType();
	const selectedMl = LOTUS_DROPPER_ML && Number(LOTUS_DROPPER_ML[selectedType]);
	if (Number.isFinite(selectedMl) && selectedMl > 0) return selectedMl;
	const fallbackMl = LOTUS_DROPPER_ML && Number(LOTUS_DROPPER_ML.round);
	return Number.isFinite(fallbackMl) && fallbackMl > 0 ? fallbackMl : .0716;
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
	if (typeof concentrateId !== "string") return null;
	if (concentrateId.startsWith("diy:")) return parseDiyConcentrateId(concentrateId);
	const brand = typeof BRAND_CONCENTRATES !== "undefined" && BRAND_CONCENTRATES[concentrateId];
	return brand ? brand.mineralId : null;
}
function getDiyConcentrateGramsPerMl(mineralId) {
	if (!mineralId) return 0;
	const specs = loadDiyConcentrateSpecs();
	const spec = specs && specs[mineralId] ? specs[mineralId] : null;
	const bottleMl = spec ? Number(spec.bottleMl) : 0;
	const gramsPerBottle = spec ? Number(spec.gramsPerBottle) : 0;
	if (!Number.isFinite(bottleMl) || !Number.isFinite(gramsPerBottle)) return 0;
	if (bottleMl <= 0 || gramsPerBottle <= 0) return 0;
	return gramsPerBottle / bottleMl;
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
/**
* mL per drop for a concentrate, or 0 when it isn't dosed in drops.
* Lotus brand concentrates use the selected Lotus dropper style; Mineral
* (diy:) and Recipe (stock:) Concentrates use the dropper size saved on their
* spec, if any.
*/
function getConcentrateDropMl(concentrateId) {
	if (typeof concentrateId !== "string") return 0;
	if (concentrateId.startsWith("brand:lotus:")) return getLotusDropMl();
	if (concentrateId.startsWith("diy:")) {
		const mineralId = parseDiyConcentrateId(concentrateId);
		if (!mineralId) return 0;
		const spec = loadDiyConcentrateSpecs()[mineralId];
		return spec && normalizeDropMl(spec.dropMl) || 0;
	}
	if (concentrateId.startsWith("stock:")) {
		const spec = getStockSpec(concentrateId);
		return spec && normalizeDropMl(spec.dropMl) || 0;
	}
	return 0;
}
/**
* Grams of equivalent mineral salt per mL of concentrate. Works for DIY (from
* specs) and brand (from BRAND_CONCENTRATES).
*/
function getConcentrateGramsPerMl(concentrateId) {
	if (typeof concentrateId !== "string") return 0;
	if (concentrateId.startsWith("diy:")) {
		const mineralId = parseDiyConcentrateId(concentrateId);
		return mineralId ? getDiyConcentrateGramsPerMl(mineralId) : 0;
	}
	const brand = typeof BRAND_CONCENTRATES !== "undefined" && BRAND_CONCENTRATES[concentrateId];
	if (brand && Number.isFinite(brand.gramsPerMl)) return brand.gramsPerMl;
	return 0;
}
function getAvailableMineralIds() {
	const out = new Set(loadSelectedMinerals());
	const concentrates = loadSelectedConcentrates();
	for (const cid of concentrates) {
		const mineralId = getConcentrateMineralId(cid);
		if (mineralId) {
			out.add(mineralId);
			continue;
		}
		if (typeof cid === "string" && cid.startsWith("stock:")) {
			const spec = getStockSpec(cid);
			for (const mid of getStockMineralIds(spec)) out.add(mid);
		}
	}
	return Array.from(out);
}
/** Returns an array of enabled alkalinity source mineral ids (baking-soda and/or potassium-bicarbonate). */
function getEffectiveAlkalinitySources() {
	const selected = getAvailableMineralIds();
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
function getEffectiveCalciumChlorideForm(selected) {
	if (selected.includes("calcium-chloride") && selected.includes("calcium-chloride-anhydrous")) {
		const concentrateForms = new Set(loadSelectedConcentrates().filter((cid) => getConcentrateGramsPerMl(cid) > 0).map(getConcentrateMineralId).filter((id) => !!id));
		if (concentrateForms.has("calcium-chloride-anhydrous") && !concentrateForms.has("calcium-chloride")) return "calcium-chloride-anhydrous";
		return "calcium-chloride";
	}
	if (selected.includes("calcium-chloride")) return "calcium-chloride";
	if (selected.includes("calcium-chloride-anhydrous")) return "calcium-chloride-anhydrous";
	return null;
}
/** Returns an array of enabled calcium source mineral ids (a calcium-chloride form and/or gypsum). */
function getEffectiveCalciumSources() {
	const selected = getAvailableMineralIds();
	const out = [];
	const cacl2 = getEffectiveCalciumChlorideForm(selected);
	if (cacl2) out.push(cacl2);
	if (selected.includes("gypsum")) out.push("gypsum");
	return out;
}
/** Returns an array of enabled magnesium source mineral ids (epsom-salt and/or magnesium-chloride). */
function getEffectiveMagnesiumSources() {
	const selected = getAvailableMineralIds();
	const out = [];
	if (selected.includes("epsom-salt")) out.push("epsom-salt");
	if (selected.includes("magnesium-chloride")) out.push("magnesium-chloride");
	return out;
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
	const sources = getEffectiveCalciumSources();
	if (sources.length === 0) return null;
	if (sources.length === 1) return sources[0] ?? null;
	return sources.find((s) => s !== "gypsum") ?? sources[0] ?? null;
}
/** Returns a single magnesium source when only one is enabled; when both enabled returns "epsom-salt" (tie-breaker); when none, null. */
function getEffectiveMagnesiumSource() {
	const sources = getEffectiveMagnesiumSources();
	if (sources.length === 0) return null;
	if (sources.length === 1) return sources[0] ?? null;
	return "epsom-salt";
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
export { BRAND_CONCENTRATES, CACO3_TO_HCO3, HCO3_TO_CACO3, ION_FIELDS, LIBRARY_TAGS, MINERAL_DB, RESERVED_TARGET_KEYS, SOURCE_PRESETS, TARGET_PRESETS, calculateMetrics, calculateSo4ClRatio, evaluateWaterProfileRanges, recipeMetricsSummary, slugify, validateProfileName };
