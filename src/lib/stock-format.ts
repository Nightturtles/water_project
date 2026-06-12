// Shared stock-formula formatter. Replaces two drifted implementations:
//   - recipe-browser.js formatStockFormula  (labelMode: "short", includeBottleDose: true)
//   - script.js formatStockResultDetail     (labelMode: "formula", includeBottleDose: false)
//
// Published onto window via legacy-globals.ts so all classic UI scripts can
// call window.formatStockSpec / window.STOCK_MINERAL_SHORT without per-file
// changes. Window type augmentation is in globals.d.ts.
//
// MINERAL_DB is a constants.js global (ambient-declared in globals.d.ts). It
// is safe to reference inside function bodies — classic-script load order
// guarantees constants.js executes before any call site runs — but it must
// NOT be read at module-evaluation time.

// Compact label for a MINERAL_DB id used in stock-formula chips. Falls back
// to the formula notation when shorter than the full name (KHCO3 vs.
// "Potassium Bicarbonate"); falls back to the raw id for unknown salts so
// future additions still render.
//
// Moved verbatim from recipe-browser.js (line 184) so there is exactly one
// source of truth for these labels.
export const STOCK_MINERAL_SHORT: Record<string, string> = {
  "epsom-salt": "epsom",
  "magnesium-chloride": "MgCl₂·6H₂O",
  "calcium-chloride": "CaCl₂·2H₂O",
  "calcium-chloride-anhydrous": "CaCl₂",
  "baking-soda": "NaHCO₃",
  "potassium-bicarbonate": "KHCO₃",
  gypsum: "gypsum",
  "potassium-chloride": "KCl",
  "sodium-chloride": "NaCl",
};

type MineralEntry =
  | {
      minerals?: Array<{ mineralId?: string; grams?: number }>;
      bottleMl?: number;
      doseGramsPerL?: number;
    }
  | null
  | undefined;

/**
 * Unified stock-formula formatter that reproduces both classic implementations.
 *
 * labelMode "short"   — uses STOCK_MINERAL_SHORT labels; keeps zero-gram entries
 *                       (only skips non-finite); optionally appends bottle / dose.
 * labelMode "formula" — uses MINERAL_DB[id].formula labels; drops zero-or-negative
 *                       entries; never appends bottle / dose regardless of
 *                       includeBottleDose.
 */
export function formatStockSpec(
  spec: MineralEntry,
  opts: { labelMode: "short" | "formula"; includeBottleDose: boolean },
): string {
  if (!spec || !Array.isArray(spec.minerals) || spec.minerals.length === 0) {
    return "";
  }

  const parts: string[] = [];

  for (const m of spec.minerals) {
    if (!m || typeof m !== "object") continue;

    const grams = Number(m.grams);

    if (opts.labelMode === "short") {
      // Keep zero-gram entries; only skip non-finite.
      if (!Number.isFinite(grams)) continue;
      const label = STOCK_MINERAL_SHORT[m.mineralId ?? ""] || m.mineralId || "?";
      parts.push(grams + " g " + label);
    } else {
      // formula mode: drop entries with no mineralId, or grams <= 0 / non-finite.
      if (!m.mineralId) continue;
      if (!Number.isFinite(grams) || grams <= 0) continue;
      // MINERAL_DB is a constants.js global — guard against the module being
      // loaded in a test environment before constants.js has run.
      const mineralDb: Record<string, { formula?: string }> =
        typeof MINERAL_DB !== "undefined" ? MINERAL_DB : {};
      const label = mineralDb[m.mineralId]?.formula || m.mineralId;
      parts.push(grams + "g " + label);
    }
  }

  if (parts.length === 0) return "";

  let result = parts.join(" · ");

  if (opts.labelMode === "short" && opts.includeBottleDose) {
    const bottle = Number(spec.bottleMl);
    const dose = Number(spec.doseGramsPerL);
    if (Number.isFinite(bottle) && bottle > 0) result += " in " + bottle + " mL";
    if (Number.isFinite(dose) && dose > 0) result += " - " + dose + " g/L";
  }

  return result;
}
