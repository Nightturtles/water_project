// Ambient declarations for cross-file globals that reach metrics.js / other
// @ts-checked files via classic-script scope. Mirrors the runtime: all these
// names are declared in sibling .js files loaded via <script> tags, and the
// browser makes them visible to later scripts by name.
//
// As more files get `// @ts-check`'d in Phase 3 PRs 3-4, some of the
// permissively-typed entries here will tighten to match real signatures.

export {}; // make this a module so `declare global` takes effect

declare global {
  // --- Shared ion/mineral types ---
  type IonName =
    | "calcium"
    | "magnesium"
    | "potassium"
    | "sodium"
    | "sulfate"
    | "chloride"
    | "bicarbonate";

  type IonMap = Partial<Record<IonName, number>>;

  interface MineralEntry {
    name: string;
    formula: string;
    mw: number;
    description: string;
    ions: IonMap;
  }

  interface DerivedMetrics {
    /** General hardness as CaCO3 (mg/L). */
    gh: number;
    /** Carbonate hardness / alkalinity as CaCO3 (mg/L). */
    kh: number;
    /** Total dissolved solids — sum of contributing ions (mg/L). */
    tds: number;
  }

  type MineralGrams = Record<string, number>;

  interface TargetProfile {
    label: string;
    calcium?: number;
    magnesium?: number;
    alkalinity?: number;
    potassium?: number;
    sodium?: number;
    sulfate?: number;
    chloride?: number;
    bicarbonate?: number;
    description?: string;
    brewMethod?: string;
    [key: string]: unknown;
  }

  // --- Constants from constants.js (classic-script globals) ---
  const MINERAL_DB: Record<string, MineralEntry>;
  const MINERAL_SOLUBILITY_G_PER_L_25C_APPROX: Record<string, number>;
  const ION_FIELDS: readonly IonName[];
  const ION_LABELS: Record<IonName, string>;
  const SOURCE_PRESETS: Record<string, { label: string; [key: string]: unknown }>;
  const TARGET_PRESETS: Record<string, TargetProfile>;
  const NON_EDITABLE_TARGET_KEYS: readonly string[];
  const LIBRARY_TAGS: readonly string[];
  const BUILTIN_TARGET_KEYS: readonly string[];
  const RESERVED_TARGET_KEYS: Set<string>;
  const BUILTIN_TARGET_LABELS: Record<string, string>;
  const GALLONS_TO_LITERS: number;
  const CA_TO_CACO3: number;
  const MG_TO_CACO3: number;
  const HCO3_TO_CACO3: number;
  const CACO3_TO_HCO3: number;
  const MW_CACO3: number;
  const ALK_TO_BAKING_SODA: number;
  const ALK_TO_POTASSIUM_BICARB: number;
  const LOTUS_DROPPER_ML: Record<string, number>;
  interface BrandConcentrate {
    name: string;
    mineralId: string;
    formula: string;
    gramsPerMl: number;
    description?: string;
  }
  const BRAND_CONCENTRATES: Record<string, BrandConcentrate>;
  const BRAND_CONCENTRATE_IDS: readonly string[];
  const LOTUS_CONCENTRATE_IDS: readonly string[];
  const RANGE_SEVERITY_ORDER: { danger: number; warn: number; info: number };
  const THEME_KEY: string;

  // --- Functions from other files (source-water-ui.js, storage.js, script.js) ---
  // Typed permissively for now; will tighten as those files get @ts-check in
  // later PRs.
  function getEffectiveCalciumSources(): string[];
  function getEffectiveMagnesiumSources(): string[];
  function getEffectiveAlkalinitySources(): string[];
  function getEffectiveCalciumSource(): string | null;
  function getEffectiveMagnesiumSource(): string | null;
  function getEffectiveAlkalinitySource(): string | null;
  function getSourceWaterByPreset(preset: string): IonMap;
  function loadSourcePresetName(): string;
  function loadBrewMethod(): string;
  function isReservedTargetKey(key: string): boolean;

  // From sync.js — feature-detected via `typeof scheduleSyncToCloud === 'function'`
  // in several storage.js paths, so guard against the function being absent in
  // contexts where sync.js hasn't loaded (tests, pages that skip sync).
  var scheduleSyncToCloud: (() => void) | undefined;

  // Supabase — loaded from CDN via <script src="https://cdn.jsdelivr.net/.../supabase.js">
  // then wrapped in supabase-client.js as window.supabaseClient.
  //
  // @supabase/supabase-js is installed as a DEV DEPENDENCY only — we use its
  // type definitions at `tsc --noEmit` time but the runtime client still
  // comes from the CDN. This gives @ts-checked files (sync.js) method-chain
  // and auth-response narrowing (e.g. auth.getUser()'s { data: { user: User |
  // null } } shape). It does NOT give row-level narrowing on
  // `.from('table').select('*')` results — those stay loose because we
  // haven't supplied a Database schema type to SupabaseClient<Database>.
  // A future PR can generate that via `supabase gen types typescript` to
  // catch column-name typos and wrong-shape upserts.
  interface Window {
    supabase: typeof import("@supabase/supabase-js");
    supabaseClient: import("@supabase/supabase-js").SupabaseClient;
    // Public API exposed from sync.js via `window.name = ...` at the bottom
    // of the IIFE.
    scheduleSyncToCloud?: () => void;
    syncNow?: () => Promise<void> | void;
    pushAllToCloud?: () => Promise<void>;
    pullFromCloud?: () => Promise<void>;
    handleFirstLoginMerge?: () => Promise<void>;
  }
}
