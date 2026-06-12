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

  // A Recipe Concentrate spec (internal name: "stock"): a multi-mineral bottle
  // dosed by g/L. Defined in src/lib/storage.ts; mirrored here as a global for
  // the classic JS files (metrics.js inverse solver) that reference it.
  interface StockConcentrateSpec {
    label?: string;
    bottleMl?: number;
    doseGramsPerL?: number;
    minerals?: Array<{ mineralId: string; grams: number }>;
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
  interface MethodRangeBand {
    preferredMin?: number | null;
    preferredMax?: number | null;
    warnMin?: number | null;
    warnMax?: number | null;
    dangerMin?: number | null;
    dangerMax?: number | null;
  }
  interface BrewMethodRangeBands {
    tds: MethodRangeBand;
    kh: MethodRangeBand;
    gh: MethodRangeBand;
    calcium: MethodRangeBand;
    magnesium: MethodRangeBand;
    sodium: {
      default: { preferredMax: number; warnMax: number; dangerMax: number };
      bakingSoda: { preferredMax: number; warnMax: number; dangerMax: number };
    };
    chloride: {
      default: { preferredMax: number; warnMax: number; dangerMax: number };
      chlorideHeavy: { preferredMax: number; warnMax: number; dangerMax: number };
    };
    sulfate: { warnMax: number };
    potassium: { dangerMax: number };
  }
  const WATER_PROFILE_RANGE_BANDS: Record<"filter" | "espresso", BrewMethodRangeBands>;
  const RANGE_SEVERITY_ORDER: { danger: number; warn: number; info: number };
  const THEME_KEY: string;

  // --- Functions from other files (source-water-ui.js, storage.js, script.js) ---
  // Typed permissively for now; will tighten as those files get @ts-check in
  // later PRs.
  function calculateMetrics(ions: IonMap): DerivedMetrics;
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
  // From src/lib/storage.ts (bridged onto window) — distributes a Recipe
  // Concentrate's prescribed dose across its mineral formula (g/L of each
  // mineral). Called by metrics.js's solveCalculatorDosing.
  function computeStockMineralGramsPerL(
    spec: StockConcentrateSpec | null | undefined,
  ): Record<string, number>;

  // From src/lib/html.ts — shared HTML-escaper, bridged onto window so the
  // classic UI scripts (diy-editor.js, stock-editor.js, minerals.html inline)
  // share one implementation instead of each defining their own.
  var escapeHtml: ((s: unknown) => string) | undefined;

  // From sync.js — feature-detected via `typeof scheduleSyncToCloud === 'function'`
  // in several storage.js paths, so guard against the function being absent in
  // contexts where sync.js hasn't loaded (tests, pages that skip sync).
  var scheduleSyncToCloud: (() => void) | undefined;

  // From library-data.js — feature-detected via `typeof getPublicRecipesSync === 'function'`
  // in storage.js (getAllTargetPresets, getExistingTargetProfileLabels). Returns
  // the cached public-recipes list, or [] before the Supabase fetch resolves.
  // Loose row typing since library-data.js isn't @ts-checked yet; the fields
  // storage.js reads (slug, label, ions, brewMethod, description,
  // creatorDisplayName) are covered by TargetProfile & { slug: string }.
  interface LibraryRecipeRow extends TargetProfile {
    slug: string;
    userId?: string | null;
    tags?: string[];
    // `category` is the client-side name for the DB column `tray`. The
    // recipe-browser spec uses `category`; the DB keeps `tray` for
    // parallelism with `roast`. library-data.js renames at the boundary.
    category?: string;
    roast?: string[];
    creatorDisplayName?: string;
    // Migration 011: `is_starter` canonical-row flag, normalized to
    // `isStarter` in library-data.js. Only set on canonical rows
    // (userId == null); undefined on user-published rows.
    isStarter?: boolean;
  }
  var getPublicRecipesSync: (() => LibraryRecipeRow[]) | undefined;

  // Supabase — bundled via Vite from @supabase/supabase-js (a runtime
  // dependency since Phase A PR h). src/lib/supabase-client.ts creates the
  // client and publishes it as window.supabaseClient for classic UI scripts
  // (recipe-browser.js, my-recipes-ui.js, etc.) plus inline HTML scripts on
  // login.html. The Window-typed entry below gives @ts-checked files
  // (storage.ts, sync.ts) method-chain and auth-response narrowing. Row-level
  // narrowing on `.from('table').select('*')` stays loose because we haven't
  // supplied a Database schema type to SupabaseClient<Database> — a future
  // PR can generate that via `supabase gen types typescript` to catch
  // column-name typos and wrong-shape upserts.
  //
  // SENTRY_RELEASE is injected at build time by @sentry/vite-plugin (see
  // vite.config.mts) and read by src/lib/sentry-init.ts. Undefined on local
  // dev / PR builds where SENTRY_AUTH_TOKEN is unset.
  // From src/lib/stock-format.ts — unified formatter bridged onto window.
  // Two classic files (recipe-browser.js, script.js) delegate to this.
  const STOCK_MINERAL_SHORT: Record<string, string>;
  function formatStockSpec(
    spec:
      | {
          minerals?: Array<{ mineralId?: string; grams?: number }>;
          bottleMl?: number;
          doseGramsPerL?: number;
        }
      | null
      | undefined,
    opts: { labelMode: "short" | "formula"; includeBottleDose: boolean },
  ): string;

  interface Window {
    supabaseClient: import("@supabase/supabase-js").SupabaseClient;
    Sentry?: typeof import("@sentry/browser");
    SENTRY_RELEASE?: { id?: string };
    // From src/lib/stock-format.ts — unified stock-formula formatter and label map.
    STOCK_MINERAL_SHORT?: Record<string, string>;
    formatStockSpec?: (
      spec:
        | {
            minerals?: Array<{ mineralId?: string; grams?: number }>;
            bottleMl?: number;
            doseGramsPerL?: number;
          }
        | null
        | undefined,
      opts: { labelMode: "short" | "formula"; includeBottleDose: boolean },
    ) => string;
    // From src/lib/html.ts — shared HTML-escaper (see the global above).
    escapeHtml?: (s: unknown) => string;
    // From metrics.js - headline water metrics (rounded) for recipe surfaces:
    // GH/KH as mg/L CaCO3 (GH from Ca+Mg, KH from alkalinity), TDS as mg/L.
    // Consumed by the slim cards (recipe-card.ts, GH/KH), library cards/hero
    // (recipe-browser.js, GH/KH), the Add-From-Library picker
    // (library-picker.js, GH/KH), and the library detail modal (GH/KH/TDS).
    recipeMetricsSummary?: (recipe: {
      calcium?: number | null;
      magnesium?: number | null;
      alkalinity?: number | null;
      potassium?: number | null;
      sodium?: number | null;
      sulfate?: number | null;
      chloride?: number | null;
      bicarbonate?: number | null;
    }) => { gh: number; kh: number; tds: number };
    // Public API exposed from sync.js via `window.name = ...` at the bottom
    // of the IIFE.
    scheduleSyncToCloud?: () => void;
    syncNow?: () => Promise<void> | void;
    pushAllToCloud?: () => Promise<void>;
    pullFromCloud?: (options?: { skipIfLocalWriteDuringPull?: boolean }) => Promise<boolean>;
    handleFirstLoginMerge?: () => Promise<void>;
    // Exposed from sync.js so the logout button (in ui-shared.js) can flush
    // any debounced edit to cloud BEFORE signOut() clears the session, and
    // wipe Categories A/B/C from both storage areas AFTER signOut() resolves.
    flushPendingSync?: () => Promise<void>;
    clearLocalUserContent?: () => void;
    // Resolves when initSync's push-then-pull completes and the Realtime
    // channel has been subscribed. Lets test code (e2e/smoke-sync.spec.ts)
    // await readiness without polling internal state.
    initSyncPromise?: Promise<void>;
    // Resolves on the first SUBSCRIBED status from channel.subscribe —
    // the signal that postgres_changes events will be delivered.
    realtimeSubscribedPromise?: Promise<void>;
    // Synchronous auth cache populated by supabase-client.js. Storage helpers
    // (_getTransient / _getGated in storage.js) read these to route between
    // localStorage and sessionStorage without awaiting getSession() on every
    // call. _authStateResolved flips true once the initial getSession()
    // settles (cw:auth-state-resolved fires at the same moment).
    _cachedAuthUserId?: string | null;
    _authStateResolved?: boolean;
    isLoggedInSync?: () => boolean;
    // Login modal API exposed from login-modal.js. openLoginModal mounts the
    // dialog on first call; the reason string drives the heading ("save",
    // "save-recipe", "save-profile", "save-stock", "publish", "bookmark").
    openLoginModal?: (opts?: { reason?: string }) => void;
    closeLoginModal?: () => void;
    // Auth-gate helper exposed from ui-shared.js. Locks save affordances
    // when the user is anonymous, intercepts clicks in capture phase, and
    // opens the login modal instead of running the underlying save.
    applyAuthGate?: (el: HTMLElement | null | undefined, opts?: { reason?: string }) => void;
    // Native capability shims published by src/lib/capacitor-bootstrap.ts on
    // iOS / Android only. Undefined on web, so call sites use optional
    // chaining (`window.cwHaptic?.("light")`). Classic JS files (script.js,
    // my-recipes-ui.js) fire-and-forget these — no awaiting and no error
    // surface, since "haptic didn't fire" is invisible to the user.
    cwHaptic?: (style?: "light" | "medium" | "heavy") => void;
    cwNativeShare?: (opts: { title?: string; text?: string; url?: string }) => void;
    // Capacitor runtime object, present on iOS / Android once
    // src/lib/capacitor-bootstrap.ts imports @capacitor/core. On web the
    // import still runs (window.Capacitor IS defined), but
    // isNativePlatform() returns false. Several call sites (supabase-client
    // AUTH_CALLBACK selection, ui-shared share-prompt accept) read this to
    // branch web vs native behavior.
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
  }
}
