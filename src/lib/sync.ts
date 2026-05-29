import {
  safeGetItem,
  safeSetItem,
  safeParse,
  loadSourceWater,
  loadSourcePresetName,
  loadThemePreference,
  loadMineralDisplayMode,
  loadBrewMethod,
  loadLotusDropperType,
  loadSelectedMinerals,
  loadSelectedConcentrates,
  loadDiyConcentrateSpecs,
  loadStockConcentrateSpecs,
  loadLotusConcentrateUnits,
  loadCreatorDisplayName,
  loadCustomProfiles,
  loadCustomTargetProfiles,
  loadDeletedPresets,
  loadDeletedTargetPresets,
  loadAddedTargetPresets,
  loadTargetPresetName,
  invalidateAllCaches,
} from "./storage";

// ============================================
// Sync — Cloud sync layer (localStorage-first)
// ============================================
// Strategy: localStorage is always the source of truth for reads.
// On write: localStorage is updated immediately, then a debounced push
// to Supabase fires shortly later if the user is logged in.
// On login: merge local and cloud data (see handleFirstLoginMerge).
// On page load: if logged in, pull latest cloud data in the background.
//
// Module top-level code runs once per page when the bridge imports this
// module; preserves the side-effects that the old IIFE wrapper used to host
// (visibilitychange / beforeunload / pagehide listeners, onAuthStateChange
// binding, initSync() kickoff, window.* publishing).

let syncTimer: ReturnType<typeof setTimeout> | undefined = undefined;
const SYNC_DEBOUNCE_MS = 500;
let mergeInFlight: Promise<void> | null = null;

// Realtime channel state. We split bindings across TWO channels per user:
// "user-data:<id>" for target_profiles + source_profiles + user_selections
// (the original three), and "user-settings:<id>" for user_settings alone.
// Empirical reason for the split: bundling all four bindings onto one
// channel made target_profiles deliveries flake under load — smoke-sync's
// Step 9 (create + delete + tombstone-guard) failed ~2/3 runs. The split
// restores reliable delivery. The pull debounce still coalesces bursts
// across both channels into one pullFromCloud call.
let realtimeChannels: any[] = [];
let realtimeUserId: string | null = null;
let pullDebounceTimer: ReturnType<typeof setTimeout> | undefined = undefined;
const PULL_DEBOUNCE_MS = 250;
// Realtime channel recovery. A CHANNEL_ERROR / TIMED_OUT used to be logged and
// left dead, so cross-device updates silently stopped arriving until a manual
// reload. We now resubscribe with capped exponential backoff; the counter
// resets on a clean SUBSCRIBED and any pending attempt is cancelled on
// teardown/sign-out.
let realtimeReconnectTimer: ReturnType<typeof setTimeout> | undefined = undefined;
let realtimeReconnectAttempts = 0;
const REALTIME_RECONNECT_BASE_MS = 1000;
const REALTIME_RECONNECT_MAX_MS = 30000;

// Test-observable readiness signals. `initSyncPromise` (created below at the
// bottom of the module) resolves when initSync's push+pull are done and
// subscribeToCloudChanges has been called. `realtimeSubscribedPromise`
// resolves on the first SUBSCRIBED status from the Realtime channel — the
// signal that postgres_changes subscriptions are wired and broadcasts will
// be delivered. `joined` (channel.state) is the WebSocket-level handshake
// and fires earlier; tests that polled it were racing the SUBSCRIBED handshake
// and missing broadcasts.
let realtimeSubscribedResolve: ((value?: void) => void) | undefined;
const realtimeSubscribedPromise: Promise<void> = new Promise(function (resolve) {
  realtimeSubscribedResolve = resolve;
});

// Dirty-tracking storage keys. Each holds the last-successfully-pushed
// snapshot for one table. `pushAllToCloud` / `syncCustomProfiles` compare
// current localStorage state to these snapshots and skip upserts when
// nothing changed — avoids the postgres_changes broadcast storm that fires
// on every page-load initSync.push otherwise (each upserted row emits a
// broadcast, and every subscribed page receives them, including the
// pusher itself, which then runs a redundant pullFromCloud that can race
// an immediately-following local write).
const LAST_PUSHED_SETTINGS_KEY = "cw_last_pushed_settings";
const LAST_PUSHED_SELECTIONS_KEY = "cw_last_pushed_selections";
const LAST_PUSHED_SOURCES_KEY = "cw_last_pushed_source_profiles";
const LAST_PUSHED_TARGETS_KEY = "cw_last_pushed_target_profiles";

// User-content keys gated by auth.  Wiped on logout by clearLocalUserContent.
// Category A: transient state (routed to sessionStorage when anonymous).
// Category B: named artifacts (refused when anonymous).
// Category C: sync tracking (only meaningful while logged in).
// Category D keys (cw_theme, banner dismissals, cafelytic_no_analytics,
// cw_estimate_cache_v1:*, sb-*-auth-token) are NOT in these lists and are
// never cleared.
const USER_CONTENT_KEYS_EXACT: string[] = [
  // Category A
  "cw_source_water",
  "cw_source_preset",
  "cw_target_preset",
  "cw_brew_method",
  "cw_selected_minerals",
  "cw_selected_concentrates",
  "cw_lotus_dropper_type",
  "cw_lotus_concentrate_units",
  "cw_lotus_concentrate_unit",
  "cw_mineral_display_mode",
  "cw_mineral_selector_tab",
  "cw_recipe_mineral_inputs",
  "cw_recipe_concentrate_inputs",
  "cw_recipe_stock_grams",
  "cw_recipe_dispense_mode",
  "cw_target_draft_ions",
  // Category B
  "cw_custom_profiles",
  "cw_custom_target_profiles",
  "cw_stock_concentrate_specs",
  "cw_diy_concentrate_specs",
  "cw_deleted_presets",
  "cw_deleted_target_presets",
  "cw_added_target_presets",
  "cw_creator_display_name",
  // Category C
  "cw_last_pushed_settings",
  "cw_last_pushed_selections",
  "cw_last_pushed_source_profiles",
  "cw_last_pushed_target_profiles",
  "cw_synced_user_id",
  "cw_starter_migration_applied",
];
const USER_CONTENT_KEYS_PREFIX: string[] = ["cw_volume_"];
// Category A keys, used for routing to sessionStorage when anonymous
// (commit 3), tracking which keys participate in transient state, and
// migrating anonymous in-tab work into localStorage on sign-in.
const TRANSIENT_KEYS: string[] = [
  "cw_source_water",
  "cw_source_preset",
  "cw_target_preset",
  "cw_brew_method",
  "cw_selected_minerals",
  "cw_selected_concentrates",
  "cw_lotus_dropper_type",
  "cw_lotus_concentrate_units",
  "cw_lotus_concentrate_unit",
  "cw_mineral_display_mode",
  "cw_mineral_selector_tab",
  "cw_recipe_mineral_inputs",
  "cw_recipe_concentrate_inputs",
  "cw_recipe_stock_grams",
  "cw_recipe_dispense_mode",
  "cw_target_draft_ions",
];
const TRANSIENT_KEYS_PREFIX: string[] = ["cw_volume_"];

// Stable JSON.stringify: sorts object keys so two objects with the same
// content but different insertion order serialize identically. Used for
// content-equality comparisons against last-pushed snapshots — without
// sorted keys, a reload that rebuilds the same object in a different key
// order would falsely look "changed" and trigger a redundant push.
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) {
    return "[" + v.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(v as object).sort();
  return (
    "{" +
    keys
      .map(function (k) {
        return JSON.stringify(k) + ":" + stableStringify((v as any)[k]);
      })
      .join(",") +
    "}"
  );
}

// --- Save-status broadcast (consumed by ui-shared.js's indicator) ---
// Fires three event kinds: "saving" the moment a write is queued (the local
// write has already happened by then), "saved" when the debounced push
// resolves (or immediately for logged-out users — pushAllToCloud early-
// returns and the .then still fires), and "error" if the push throws.
function dispatchSaveStatus(status: string, err?: unknown): void {
  try {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
    window.dispatchEvent(
      new CustomEvent("cw:save-status", { detail: { status: status, error: err } }),
    );
  } catch (_) {}
}

async function waitForAuthStateResolved(): Promise<void> {
  if (window._authStateResolved) return;
  await new Promise<void>(function (resolve) {
    function onResolved() {
      document.removeEventListener("cw:auth-state-resolved", onResolved);
      resolve();
    }
    document.addEventListener("cw:auth-state-resolved", onResolved);
  });
}

// --- Debounced sync trigger (called from storage.js save functions) ---
export function scheduleSyncToCloud(): void {
  dispatchSaveStatus("saving");
  clearTimeout(syncTimer);
  syncTimer = setTimeout(function () {
    pushAllToCloud()
      .then(function () {
        dispatchSaveStatus("saved");
      })
      .catch(function (err) {
        console.warn("[sync] push failed:", err);
        dispatchSaveStatus("error", err);
      });
  }, SYNC_DEBOUNCE_MS);
}

// --- Immediate sync (no debounce) ---
export function syncNow(): Promise<void> {
  clearTimeout(syncTimer);
  syncTimer = undefined;
  dispatchSaveStatus("saving");
  return pushAllToCloud()
    .then(function () {
      dispatchSaveStatus("saved");
    })
    .catch(function (err) {
      console.warn("[sync] immediate push failed:", err);
      dispatchSaveStatus("error", err);
    });
}

// --- Get currently logged-in user ID, or null ---
async function getLoggedInUserId(): Promise<string | null> {
  try {
    const result = await window.supabaseClient.auth.getUser();
    return result.data && result.data.user ? result.data.user.id : null;
  } catch (_) {
    return null;
  }
}

// --- Collect all cw_volume_* entries from localStorage into one object ---
function collectVolumePreferences(): Record<string, unknown> {
  const volumes: Record<string, unknown> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("cw_volume_")) {
        const pageKey = key.slice("cw_volume_".length);
        const val = safeParse(safeGetItem(key), null);
        if (val !== null) volumes[pageKey] = val;
      }
    }
  } catch (_) {}
  return volumes;
}

// --- Drafts payload (recipe builder WIP + target ion edits) ---
// Bundled into one jsonb column on user_settings (see the 20260520120000
// migration). These keys persist as a side-effect of typing into a form
// and used to be localStorage-only; bundling them here lets a user move
// between phone and laptop mid-edit without losing work.
function collectDrafts(): Record<string, unknown> {
  const drafts: Record<string, unknown> = {};
  const mineralInputs = safeParse(safeGetItem("cw_recipe_mineral_inputs"), null);
  if (mineralInputs && typeof mineralInputs === "object")
    drafts.recipe_mineral_inputs = mineralInputs;
  const concentrateInputs = safeParse(safeGetItem("cw_recipe_concentrate_inputs"), null);
  if (concentrateInputs && typeof concentrateInputs === "object")
    drafts.recipe_concentrate_inputs = concentrateInputs;
  const stockGrams = safeParse(safeGetItem("cw_recipe_stock_grams"), null);
  if (stockGrams && typeof stockGrams === "object") drafts.recipe_stock_grams = stockGrams;
  const dispenseMode = safeGetItem("cw_recipe_dispense_mode");
  if (dispenseMode === "manual" || dispenseMode === "stock")
    drafts.recipe_dispense_mode = dispenseMode;
  const targetDraftIons = safeParse(safeGetItem("cw_target_draft_ions"), null);
  if (targetDraftIons && typeof targetDraftIons === "object")
    drafts.target_draft_ions = targetDraftIons;
  return drafts;
}

// Build the user_settings push payload from localStorage. Returns a fresh
// object each call so callers can serialize/mutate freely.
export function buildSettingsPayload(userId: string, now: string) {
  return {
    user_id: userId,
    theme: loadThemePreference(),
    mineral_display_mode: loadMineralDisplayMode(),
    brew_method: loadBrewMethod(),
    lotus_dropper_type: loadLotusDropperType(),
    selected_minerals: loadSelectedMinerals(),
    selected_concentrates: loadSelectedConcentrates(),
    diy_concentrate_specs: loadDiyConcentrateSpecs(),
    stock_concentrate_specs: loadStockConcentrateSpecs(),
    lotus_concentrate_units: loadLotusConcentrateUnits(),
    volume_preferences: collectVolumePreferences(),
    creator_display_name: loadCreatorDisplayName(),
    drafts: collectDrafts(),
    updated_at: now,
  };
}

// Build the user_selections push payload from localStorage.
// loadTargetPresetName needs the current brewMethod so that on a brand-new
// account (cw_target_preset unset) we push the correct default for whichever
// mode the user is actually in — without it, an espresso-first user's first
// push would seed cloud with "cafelytic-filter" and the next pull would
// snap the active preset to filter across every device.
export function buildSelectionsPayload(userId: string, now: string) {
  return {
    user_id: userId,
    source_preset: loadSourcePresetName(),
    source_water: loadSourceWater(),
    target_preset: loadTargetPresetName(loadBrewMethod()),
    deleted_source_presets: loadDeletedPresets(),
    deleted_target_presets: loadDeletedTargetPresets(),
    added_target_presets: loadAddedTargetPresets(),
    updated_at: now,
  };
}

// Snapshot used for dirty-tracking comparisons. Strips fields that change
// on every push (updated_at) so a no-op push doesn't look like a real change.
// user_id is kept since it identifies the row and stays stable per user.
export function snapshotForCompare(payload: Record<string, unknown>): string {
  const copy: Record<string, unknown> = {};
  Object.keys(payload).forEach(function (k) {
    if (k !== "updated_at") copy[k] = payload[k];
  });
  return stableStringify(copy);
}

// --- Push all localStorage data to Supabase ---
export async function pushAllToCloud(): Promise<void> {
  const userId = await getLoggedInUserId();
  if (!userId) return;

  const now = new Date().toISOString();

  const settingsPayload = buildSettingsPayload(userId, now);
  const selectionsPayload = buildSelectionsPayload(userId, now);

  // Skip upserts when the payload hasn't changed since our last successful
  // push to that table. This is the storm-prevention path: every page-load
  // initSync.push would otherwise re-upsert the full row, fire a
  // postgres_changes broadcast that arrives back at our own channel, and
  // trigger a redundant pullFromCloud — which can race a local write that
  // happened in the same tick (replication-lag may return the stale value).
  const settingsSnapshot = snapshotForCompare(settingsPayload);
  const selectionsSnapshot = snapshotForCompare(selectionsPayload);
  const lastSettingsSnapshot = safeGetItem(LAST_PUSHED_SETTINGS_KEY);
  const lastSelectionsSnapshot = safeGetItem(LAST_PUSHED_SELECTIONS_KEY);
  const settingsChanged = settingsSnapshot !== lastSettingsSnapshot;
  const selectionsChanged = selectionsSnapshot !== lastSelectionsSnapshot;

  const upserts: Array<{ table: string; promise: any; snapshot: string; key: string }> = [];
  if (settingsChanged) {
    upserts.push({
      table: "user_settings",
      promise: window.supabaseClient
        .from("user_settings")
        .upsert(settingsPayload, { onConflict: "user_id" }),
      snapshot: settingsSnapshot,
      key: LAST_PUSHED_SETTINGS_KEY,
    });
  }
  if (selectionsChanged) {
    upserts.push({
      table: "user_selections",
      promise: window.supabaseClient
        .from("user_selections")
        .upsert(selectionsPayload, { onConflict: "user_id" }),
      snapshot: selectionsSnapshot,
      key: LAST_PUSHED_SELECTIONS_KEY,
    });
  }

  if (upserts.length > 0) {
    const results = await Promise.all(
      upserts.map(function (u) {
        return u.promise;
      }),
    );
    const pushErrors: unknown[] = [];
    results.forEach(function (r, idx) {
      const u = upserts[idx];
      if (!u) return;
      if (r.error) {
        console.warn("[sync] " + u.table + " upsert failed:", r.error);
        pushErrors.push(r.error);
      } else {
        safeSetItem(u.key, u.snapshot);
      }
    });
    if (pushErrors.length > 0) {
      throw new Error("[sync] failed to upsert one or more cloud rows");
    }
  }

  await syncCustomProfiles(userId, now);
}

// Build the source_profiles row from a local profile entry (sans updated_at).
export function buildSourceRow(userId: string, slug: string, p: any) {
  return {
    user_id: userId,
    slug: slug,
    label: p.label || slug,
    calcium: Number(p.calcium) || 0,
    magnesium: Number(p.magnesium) || 0,
    potassium: Number(p.potassium) || 0,
    sodium: Number(p.sodium) || 0,
    sulfate: Number(p.sulfate) || 0,
    chloride: Number(p.chloride) || 0,
    bicarbonate: Number(p.bicarbonate) || 0,
  };
}

// Build the target_profiles row from a local profile entry (sans updated_at).
export function buildTargetRow(userId: string, slug: string, p: any) {
  return {
    user_id: userId,
    slug: slug,
    label: p.label || slug,
    brew_method: p.brewMethod || "filter",
    calcium: Number(p.calcium) || 0,
    magnesium: Number(p.magnesium) || 0,
    alkalinity: Number(p.alkalinity) || 0,
    potassium: Number(p.potassium) || 0,
    sodium: Number(p.sodium) || 0,
    sulfate: Number(p.sulfate) || 0,
    chloride: Number(p.chloride) || 0,
    bicarbonate: Number(p.bicarbonate) || 0,
    description: p.description || "",
    is_public: !!p.isPublic,
    creator_display_name: p.creatorDisplayName || "",
    // Default creator_user_id to the current user for locally-created
    // profiles that haven't yet been attributed.  Library copies explicitly
    // set creatorUserId to the original author.
    creator_user_id: p.creatorUserId !== undefined ? p.creatorUserId : userId,
    tags: Array.isArray(p.tags) ? p.tags : [],
    roast: Array.isArray(p.roast) && p.roast.length > 0 ? p.roast : ["all"],
  };
}

/**
 * Sync custom source and target profiles (upsert new/changed, delete removed).
 */
async function syncCustomProfiles(userId: string, now?: string): Promise<void> {
  now = now || new Date().toISOString();
  const localSource = loadCustomProfiles();
  const localTarget = loadCustomTargetProfiles();
  const deletedSources = loadDeletedPresets();
  const deletedTargets = loadDeletedTargetPresets();

  // Tombstone sets used to filter upserts below: a slug present in BOTH
  // the local custom-profile dict and the tombstone list must NOT be
  // upserted — that's the resurrection bug. The save path
  // (saveCustomProfiles / saveCustomTargetProfiles) is responsible for
  // lifting tombstones when the user explicitly re-saves; if the slug
  // is still tombstoned here, the local dict entry is stale (e.g. from
  // a missed pullFromCloud after a cross-device delete) and the
  // tombstone is the authoritative record of intent.
  const tombstonedSourceSet = new Set(deletedSources);
  const tombstonedTargetSet = new Set(deletedTargets);

  // Dirty-tracking snapshots: { slug: stableStringify(row-without-updated_at) }.
  // Compared per-slug in the upsert path below; updated on successful upsert
  // and on tombstone delete. pullFromCloud also refreshes these so we don't
  // re-push cloud state right back.
  const lastSourceSnapshots: Record<string, string> =
    safeParse(safeGetItem(LAST_PUSHED_SOURCES_KEY), null) || {};
  const lastTargetSnapshots: Record<string, string> =
    safeParse(safeGetItem(LAST_PUSHED_TARGETS_KEY), null) || {};

  // Delete cloud rows for tombstoned slugs.  This replaces the previous
  // SELECT+diff pattern, which could delete rows created on other devices
  // whenever local state was stale (e.g. a debounced push that ran without
  // a fresh pull).  Tombstones are the authoritative record of deletion.
  const deleteCalls: any[] = [];
  const deletedSourcesPending = deletedSources.length > 0;
  const deletedTargetsPending = deletedTargets.length > 0;
  if (deletedSourcesPending) {
    deleteCalls.push(
      window.supabaseClient
        .from("source_profiles")
        .delete()
        .eq("user_id", userId)
        .in("slug", deletedSources),
    );
  }
  if (deletedTargetsPending) {
    deleteCalls.push(
      window.supabaseClient
        .from("target_profiles")
        .delete()
        .eq("user_id", userId)
        .in("slug", deletedTargets),
    );
  }
  if (deleteCalls.length > 0) {
    const delResults = await Promise.all(deleteCalls);
    let nextIdx = 0;
    const deleteErrors: unknown[] = [];
    if (deletedSourcesPending) {
      const srcDel = delResults[nextIdx++];
      if (srcDel && srcDel.error) {
        console.warn("[sync] tombstone delete failed:", srcDel.error);
        deleteErrors.push(srcDel.error);
      } else {
        deletedSources.forEach(function (s) {
          delete lastSourceSnapshots[s];
        });
      }
    }
    if (deletedTargetsPending) {
      const tgtDel = delResults[nextIdx];
      if (tgtDel && tgtDel.error) {
        console.warn("[sync] tombstone delete failed:", tgtDel.error);
        deleteErrors.push(tgtDel.error);
      } else {
        deletedTargets.forEach(function (s) {
          delete lastTargetSnapshots[s];
        });
      }
    }
    if (deleteErrors.length > 0) {
      throw new Error("[sync] failed to delete one or more tombstoned rows");
    }
  }

  // Upsert local source profiles, skipping (a) any tombstoned slugs so a
  // local dict that still holds a deleted entry can't resurrect it, and
  // (b) any rows whose content matches our last-pushed snapshot (storm-
  // prevention — see snapshotForCompare's rationale).
  const sourceChanged: Array<{ slug: string; row: any; snapshot: string }> = [];
  Object.entries(localSource).forEach(function (entry) {
    const slug = entry[0];
    if (tombstonedSourceSet.has(slug)) return;
    const row = buildSourceRow(userId, slug, entry[1]);
    const snapshot = stableStringify(row);
    if (lastSourceSnapshots[slug] === snapshot) return;
    sourceChanged.push({ slug: slug, row: row, snapshot: snapshot });
  });
  if (sourceChanged.length > 0) {
    const sourceRows = sourceChanged.map(function (e) {
      return Object.assign({}, e.row, { updated_at: now });
    });
    const srcResult = await window.supabaseClient
      .from("source_profiles")
      .upsert(sourceRows, { onConflict: "user_id,slug" });
    if (srcResult.error) {
      console.warn("[sync] source_profiles upsert failed:", srcResult.error);
      throw srcResult.error;
    } else {
      sourceChanged.forEach(function (e) {
        lastSourceSnapshots[e.slug] = e.snapshot;
      });
    }
  }

  // Upsert local target profiles, same filtering as sources.
  const targetChanged: Array<{ slug: string; row: any; snapshot: string }> = [];
  Object.entries(localTarget).forEach(function (entry) {
    const slug = entry[0];
    if (tombstonedTargetSet.has(slug)) return;
    const row = buildTargetRow(userId, slug, entry[1]);
    const snapshot = stableStringify(row);
    if (lastTargetSnapshots[slug] === snapshot) return;
    targetChanged.push({ slug: slug, row: row, snapshot: snapshot });
  });
  if (targetChanged.length > 0) {
    const targetRows = targetChanged.map(function (e) {
      return Object.assign({}, e.row, { updated_at: now });
    });
    const tgtResult = await window.supabaseClient
      .from("target_profiles")
      .upsert(targetRows, { onConflict: "user_id,slug" });
    if (tgtResult.error) {
      console.warn("[sync] target_profiles upsert failed:", tgtResult.error);
      throw tgtResult.error;
    } else {
      targetChanged.forEach(function (e) {
        lastTargetSnapshots[e.slug] = e.snapshot;
      });
    }
  }

  // Persist updated snapshots back to localStorage (covers both
  // tombstone-delete cleanup and successful upserts above).
  safeSetItem(LAST_PUSHED_SOURCES_KEY, JSON.stringify(lastSourceSnapshots));
  safeSetItem(LAST_PUSHED_TARGETS_KEY, JSON.stringify(lastTargetSnapshots));
}

// --- Pull all cloud data into localStorage and invalidate caches ---
export async function pullFromCloud(): Promise<void> {
  const userId = await getLoggedInUserId();
  if (!userId) return;

  const results = await Promise.all([
    window.supabaseClient.from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
    window.supabaseClient.from("user_selections").select("*").eq("user_id", userId).maybeSingle(),
    window.supabaseClient.from("source_profiles").select("*").eq("user_id", userId),
    window.supabaseClient.from("target_profiles").select("*").eq("user_id", userId),
  ]);
  const errored = results.find(function (r) {
    return !!(r && r.error);
  });
  if (errored && errored.error) {
    console.warn("[sync] pull failed:", errored.error);
    throw errored.error;
  }

  // Re-bind userId as `string` (not `string | null`) so the forEach
  // closures below can hand it to buildSourceRow/buildTargetRow without
  // a runtime null check — TS doesn't carry the `if (!userId) return`
  // narrowing across the closure boundary.
  const sessionUserId: string = userId;
  const settings = results[0] && results[0].data;
  const selections = results[1] && results[1].data;
  const sourceRows = results[2] && results[2].data;
  const targetRows = results[3] && results[3].data;

  // Apply user_settings
  if (settings) {
    if (settings.theme) safeSetItem(THEME_KEY, settings.theme);
    if (settings.mineral_display_mode)
      safeSetItem("cw_mineral_display_mode", settings.mineral_display_mode);
    if (settings.brew_method) safeSetItem("cw_brew_method", settings.brew_method);
    if (settings.lotus_dropper_type)
      safeSetItem("cw_lotus_dropper_type", settings.lotus_dropper_type);
    if (settings.selected_minerals)
      safeSetItem("cw_selected_minerals", JSON.stringify(settings.selected_minerals));
    if (settings.selected_concentrates)
      safeSetItem("cw_selected_concentrates", JSON.stringify(settings.selected_concentrates));
    if (settings.diy_concentrate_specs)
      safeSetItem("cw_diy_concentrate_specs", JSON.stringify(settings.diy_concentrate_specs));
    if (settings.stock_concentrate_specs)
      safeSetItem("cw_stock_concentrate_specs", JSON.stringify(settings.stock_concentrate_specs));
    if (settings.lotus_concentrate_units)
      safeSetItem("cw_lotus_concentrate_units", JSON.stringify(settings.lotus_concentrate_units));
    if (settings.volume_preferences && typeof settings.volume_preferences === "object") {
      Object.entries(settings.volume_preferences).forEach(function (entry) {
        safeSetItem("cw_volume_" + entry[0], JSON.stringify(entry[1]));
      });
    }
    if (settings.creator_display_name)
      safeSetItem("cw_creator_display_name", settings.creator_display_name);
    // Drafts: restore each known key only if present. An empty/missing
    // drafts blob shouldn't blow away the user's local in-progress edits —
    // their local draft is the more recent write in that case.
    if (settings.drafts && typeof settings.drafts === "object") {
      const drafts = settings.drafts;
      if (drafts.recipe_mineral_inputs && typeof drafts.recipe_mineral_inputs === "object")
        safeSetItem("cw_recipe_mineral_inputs", JSON.stringify(drafts.recipe_mineral_inputs));
      if (drafts.recipe_concentrate_inputs && typeof drafts.recipe_concentrate_inputs === "object")
        safeSetItem(
          "cw_recipe_concentrate_inputs",
          JSON.stringify(drafts.recipe_concentrate_inputs),
        );
      if (drafts.recipe_stock_grams && typeof drafts.recipe_stock_grams === "object")
        safeSetItem("cw_recipe_stock_grams", JSON.stringify(drafts.recipe_stock_grams));
      if (drafts.recipe_dispense_mode === "manual" || drafts.recipe_dispense_mode === "stock")
        safeSetItem("cw_recipe_dispense_mode", drafts.recipe_dispense_mode);
      if (drafts.target_draft_ions && typeof drafts.target_draft_ions === "object")
        safeSetItem("cw_target_draft_ions", JSON.stringify(drafts.target_draft_ions));
    }
  }

  // Apply user_selections
  if (selections) {
    if (selections.source_preset) safeSetItem("cw_source_preset", selections.source_preset);
    if (selections.source_water)
      safeSetItem("cw_source_water", JSON.stringify(selections.source_water));
    if (selections.target_preset) safeSetItem("cw_target_preset", selections.target_preset);
    if (selections.deleted_source_presets)
      safeSetItem("cw_deleted_presets", JSON.stringify(selections.deleted_source_presets));
    if (selections.deleted_target_presets)
      safeSetItem("cw_deleted_target_presets", JSON.stringify(selections.deleted_target_presets));
    if (selections.added_target_presets)
      safeSetItem("cw_added_target_presets", JSON.stringify(selections.added_target_presets));
  }

  // Apply source profiles, skipping any that are tombstoned locally.
  // (Cloud deletion and tombstone push aren't atomic, so a slug can still
  // be present in source_profiles briefly after deletion.)
  //
  // An empty array is authoritative: if the cloud query succeeded with
  // no rows, the user has no source profiles, and any stale local entries
  // must be cleared. Otherwise a recipe deleted on another device stays
  // in our localStorage forever, and the next push resurrects it on the
  // cloud (the cleanup in syncCustomProfiles incorrectly classifies the
  // local-and-tombstone overlap as "user re-saved").
  if (Array.isArray(sourceRows)) {
    const tombstonedSources = loadDeletedPresets();
    const srcProfiles: Record<string, any> = {};
    const newSourceSnapshots: Record<string, string> = {};
    sourceRows.forEach(function (row: any) {
      if (tombstonedSources.indexOf(row.slug) !== -1) return;
      const profile = {
        label: row.label,
        calcium: row.calcium,
        magnesium: row.magnesium,
        potassium: row.potassium,
        sodium: row.sodium,
        sulfate: row.sulfate,
        chloride: row.chloride,
        bicarbonate: row.bicarbonate,
      };
      srcProfiles[row.slug] = profile;
      // Refresh lastPushed snapshot for dirty-tracking — we just learned
      // what cloud has, so a follow-up push of the same data is a no-op
      // and should be skipped.
      newSourceSnapshots[row.slug] = stableStringify(
        buildSourceRow(sessionUserId, row.slug, profile),
      );
    });
    safeSetItem("cw_custom_profiles", JSON.stringify(srcProfiles));
    safeSetItem(LAST_PUSHED_SOURCES_KEY, JSON.stringify(newSourceSnapshots));
  }

  // Apply target profiles, skipping any that are tombstoned locally
  // (cloud deletion and tombstone push aren't atomic, so a slug may still
  // be in cloud target_profiles briefly after deletion). Same empty-array-
  // is-authoritative reasoning as the source-profiles branch above.
  if (Array.isArray(targetRows)) {
    const tombstonedTargets = loadDeletedTargetPresets();
    const tgtProfiles: Record<string, TargetProfile> = {};
    const newTargetSnapshots: Record<string, string> = {};
    targetRows.forEach(function (row: any) {
      if (tombstonedTargets.indexOf(row.slug) !== -1) return;
      const profile: TargetProfile = {
        label: row.label,
        brewMethod: row.brew_method,
        calcium: row.calcium,
        magnesium: row.magnesium,
        alkalinity: row.alkalinity,
        potassium: row.potassium,
        sodium: row.sodium,
        sulfate: row.sulfate,
        chloride: row.chloride,
        bicarbonate: row.bicarbonate,
        description: row.description,
        isPublic: !!row.is_public,
        creatorDisplayName: row.creator_display_name || "",
        creatorUserId: row.creator_user_id || null,
        tags: Array.isArray(row.tags) ? row.tags : [],
        roast: Array.isArray(row.roast) && row.roast.length > 0 ? row.roast : ["all"],
      };
      tgtProfiles[row.slug] = profile;
      newTargetSnapshots[row.slug] = stableStringify(
        buildTargetRow(sessionUserId, row.slug, profile),
      );
    });
    safeSetItem("cw_custom_target_profiles", JSON.stringify(tgtProfiles));
    safeSetItem(LAST_PUSHED_TARGETS_KEY, JSON.stringify(newTargetSnapshots));
  }

  // Invalidate all storage caches so next read picks up the new data.
  // Done BEFORE building the lastPushed snapshots below, so the load*()
  // helpers inside buildSettingsPayload/buildSelectionsPayload read the
  // just-pulled values (some load helpers use module-level caches that
  // would otherwise return pre-pull state).
  if (typeof invalidateAllCaches === "function") invalidateAllCaches();

  // Refresh single-row lastPushed snapshots so the next pushAllToCloud
  // doesn't re-upload data that already matches cloud. Guard each on the
  // corresponding pull actually returning a row — if cloud has no
  // user_settings/user_selections row yet, we have NOT pushed it, and
  // claiming we did would let the next push skip the seed-upsert and
  // leave the row missing forever. Snapshots are built via the same
  // buildXxxPayload + snapshotForCompare path push uses, so a no-op push
  // immediately after pull is correctly detected as no-op.
  if (settings) {
    safeSetItem(
      LAST_PUSHED_SETTINGS_KEY,
      snapshotForCompare(buildSettingsPayload(sessionUserId, "")),
    );
  }
  if (selections) {
    safeSetItem(
      LAST_PUSHED_SELECTIONS_KEY,
      snapshotForCompare(buildSelectionsPayload(sessionUserId, "")),
    );
  }
}

// --- Returns true if local data is entirely default (no user customization) ---
export function isDefaultData(): boolean {
  const sourceWater = loadSourceWater();
  const allZeroSource = Object.values(sourceWater).every(function (v) {
    return Number(v) === 0;
  });
  const noCustomSource = Object.keys(loadCustomProfiles()).length === 0;
  const noCustomTarget = Object.keys(loadCustomTargetProfiles()).length === 0;
  const noDeletedSource = loadDeletedPresets().length === 0;
  const noDeletedTarget = loadDeletedTargetPresets().length === 0;

  const defaultMinerals = [
    "calcium-chloride",
    "epsom-salt",
    "baking-soda",
    "potassium-bicarbonate",
  ];
  const minerals = loadSelectedMinerals();
  const mineralsAreDefault =
    minerals.length === defaultMinerals.length &&
    defaultMinerals.every(function (m) {
      return minerals.includes(m);
    });

  // Created artifacts beyond the original six checks. The prior version missed
  // these, so a user who had built concentrate specs / recipe drafts / a
  // curated rail (but happened to leave source water zeroed and the default
  // minerals selected) was judged "default" and silently overwritten by
  // pullFromCloud on a fresh device — the data-loss shape behind commits
  // 6d8cd63 / 9f89a2e.
  //
  // Deliberately NOT counted here: display/format preferences (brew_method,
  // mineral_display_mode, lotus dropper type, volume units, source/target
  // preset *selection*). This function gates a binary merge dialog whose "keep
  // local" branch runs pushAllToCloud and overwrites the cloud row; prompting
  // over a trivial toggle would push users toward clobbering their own cloud
  // recipes. Losing a stray preference to a cloud pull is recoverable —
  // clobbering cloud content is not — so only real artifacts flip this false.
  const noConcentrates = loadSelectedConcentrates().length === 0;
  const noDiySpecs = Object.keys(loadDiyConcentrateSpecs()).length === 0;
  const noStockSpecs = Object.keys(loadStockConcentrateSpecs()).length === 0;
  const noAddedPresets = loadAddedTargetPresets().length === 0;
  const noCreatorName = !loadCreatorDisplayName();
  const noDrafts = Object.keys(collectDrafts()).length === 0;

  return (
    allZeroSource &&
    noCustomSource &&
    noCustomTarget &&
    noDeletedSource &&
    noDeletedTarget &&
    mineralsAreDefault &&
    noConcentrates &&
    noDiySpecs &&
    noStockSpecs &&
    noAddedPresets &&
    noCreatorName &&
    noDrafts
  );
}

/**
 * Returns true if Supabase has any stored data for this user.
 *
 * Probe failures THROW rather than being collapsed into "no data" — without
 * this, a transient network blip during handleFirstLoginMerge would route to
 * the "brand new user" branch and overwrite the cloud row with local
 * defaults (the same data-loss shape as commits 6d8cd63 / 9f89a2e). Callers
 * already handle the rejection: handleFirstLoginMerge wraps in mergeInFlight
 * which propagates the error up, and the onAuthStateChange SIGNED_IN handler
 * catches it with `console.warn("[sync] post-signin merge failed:", err)` —
 * the merge is skipped on this attempt and retried on the next sign-in or
 * page reload.
 */
async function hasCloudData(userId: string): Promise<boolean> {
  const results = await Promise.all([
    window.supabaseClient
      .from("user_settings")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle(),
    window.supabaseClient
      .from("user_selections")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle(),
    window.supabaseClient.from("source_profiles").select("slug").eq("user_id", userId).limit(1),
    window.supabaseClient.from("target_profiles").select("slug").eq("user_id", userId).limit(1),
  ]);
  const errored = results.find(function (r) {
    return !!(r && r.error);
  });
  if (errored && errored.error) {
    console.warn("[sync] hasCloudData probe failed:", errored.error);
    throw errored.error;
  }
  return !!(
    results[0].data ||
    results[1].data ||
    (results[2].data && results[2].data.length > 0) ||
    (results[3].data && results[3].data.length > 0)
  );
}

// --- Show merge conflict dialog, returns promise resolving to 'local' or 'cloud' ---
function showMergeDialog(): Promise<"local" | "cloud"> {
  return new Promise(function (resolve) {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.style.display = "flex";

    const dialog = document.createElement("div");
    dialog.className = "confirm-dialog";

    const msg = document.createElement("p");
    msg.id = "confirm-message";
    msg.textContent =
      "You have local data on this device and saved data in the cloud. Which would you like to keep?";

    const actions = document.createElement("div");
    actions.className = "confirm-actions";

    const localBtn = document.createElement("button");
    localBtn.className = "preset-btn";
    localBtn.textContent = "Keep local data";

    const cloudBtn = document.createElement("button");
    cloudBtn.className = "preset-btn";
    cloudBtn.textContent = "Use cloud data";

    actions.appendChild(localBtn);
    actions.appendChild(cloudBtn);
    dialog.appendChild(msg);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    localBtn.addEventListener("click", function () {
      overlay.remove();
      resolve("local");
    });
    cloudBtn.addEventListener("click", function () {
      overlay.remove();
      resolve("cloud");
    });
  });
}

// --- First-login merge: call this right after a successful sign-in ---
// Determines what to do based on whether cloud data exists and whether
// local data has been customized. Skips the prompt on repeat logins
// from the same device (tracked via cw_synced_user_id).
export async function handleFirstLoginMerge(): Promise<void> {
  if (mergeInFlight) return mergeInFlight;
  mergeInFlight = (async function () {
    const userId = await getLoggedInUserId();
    if (!userId) return;

    // Already set up for this user on this device — just pull latest
    const syncedUserId = safeGetItem("cw_synced_user_id");
    if (syncedUserId === userId) {
      await pullFromCloud();
      return;
    }

    const cloudExists = await hasCloudData(userId);

    if (!cloudExists) {
      // Brand new user: push local data to initialize cloud
      await pushAllToCloud();
    } else {
      if (isDefaultData()) {
        // Returning user on a fresh device: pull cloud data down
        await pullFromCloud();
      } else {
        // Both local and cloud have non-default data: ask the user
        const choice = await showMergeDialog();
        if (choice === "local") {
          await pushAllToCloud();
        } else {
          await pullFromCloud();
        }
      }
    }

    safeSetItem("cw_synced_user_id", userId);
  })();
  return mergeInFlight.finally(function () {
    mergeInFlight = null;
  });
}

// --- Realtime: subscribe to per-user table changes ---
// Subscribes to postgres_changes on target_profiles, source_profiles, and
// user_selections, filtered to the current user's rows. Any event triggers
// a debounced pullFromCloud + a CustomEvent so UI listeners re-render.
//
// We always pull rather than apply the payload directly because the pull
// path already handles tombstone filtering (see pullFromCloud above) and
// cache invalidation. Bursts of events (e.g. a recipe edit that touches
// both target_profiles and user_selections) coalesce into one pull.
//
// RLS on these tables restricts SELECT to user_id = auth.uid(), and
// Realtime applies the same policies to postgres_changes, so subscriptions
// remain per-user safe.
function subscribeToCloudChanges(userId: string): void {
  if (!window.supabaseClient || typeof window.supabaseClient.channel !== "function") return;
  if (realtimeChannels.length > 0 && realtimeUserId === userId) return;
  if (realtimeChannels.length > 0) unsubscribeFromCloudChanges();

  const filter = "user_id=eq." + userId;

  // The two channels we'll create. Both must be SUBSCRIBED before we resolve
  // realtimeSubscribedPromise — callers (smoke-sync, settings writes between
  // sign-in and rail-render) rely on the promise meaning "every binding is
  // delivering events", not just "the first one is". Track pending count
  // here; subscribeChannel decrements as each SUBSCRIBED arrives.
  const channelSpecs: { name: string; tables: string[] }[] = [
    {
      name: "user-data:" + userId,
      tables: ["target_profiles", "source_profiles", "user_selections"],
    },
    { name: "user-settings:" + userId, tables: ["user_settings"] },
  ];
  let pendingSubscriptions = channelSpecs.length;

  function subscribeChannel(name: string, tables: string[]): any {
    let channel = window.supabaseClient.channel(name);
    tables.forEach(function (table) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: table, filter: filter },
        scheduleRealtimePull,
      );
    });
    channel.subscribe(function (status: string) {
      if (status === "SUBSCRIBED") {
        // Clean (re)subscribe: reset the backoff so a later failure starts
        // from the base delay again.
        realtimeReconnectAttempts = 0;
        if (pendingSubscriptions > 0) {
          pendingSubscriptions -= 1;
          if (pendingSubscriptions === 0 && realtimeSubscribedResolve) {
            realtimeSubscribedResolve();
            realtimeSubscribedResolve = undefined;
          }
        }
      }
      // CLOSED is excluded on purpose: it also fires during our own
      // removeChannel() teardown, so reconnecting on it would fight a
      // deliberate unsubscribe. Only genuine failures resubscribe.
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn("[sync] realtime channel status (" + name + "):", status);
        scheduleRealtimeReconnect();
      }
    });
    return channel;
  }

  realtimeChannels = channelSpecs.map(function (spec) {
    return subscribeChannel(spec.name, spec.tables);
  });
  realtimeUserId = userId;
}

function unsubscribeFromCloudChanges(): void {
  // Cancel any pending reconnect first, so a sign-out / page-leave that lands
  // here while a backoff timer is armed doesn't fire a stray resubscribe later
  // (this runs even when no channels are currently live).
  if (realtimeReconnectTimer) {
    clearTimeout(realtimeReconnectTimer);
    realtimeReconnectTimer = undefined;
  }
  if (realtimeChannels.length === 0) return;
  realtimeChannels.forEach(function (channel) {
    try {
      if (window.supabaseClient && typeof window.supabaseClient.removeChannel === "function") {
        window.supabaseClient.removeChannel(channel);
      }
    } catch (err) {
      console.warn("[sync] removeChannel threw:", err);
    }
  });
  realtimeChannels = [];
  realtimeUserId = null;
}

// Resubscribe after a realtime CHANNEL_ERROR / TIMED_OUT, with capped
// exponential backoff. No-op if a reconnect is already pending or we're signed
// out. Tears the dead channels down first because subscribeToCloudChanges
// short-circuits when channels already exist for the same user.
function scheduleRealtimeReconnect(): void {
  if (realtimeReconnectTimer) return;
  const userId = realtimeUserId;
  if (!userId) return;
  const delay = Math.min(
    REALTIME_RECONNECT_MAX_MS,
    REALTIME_RECONNECT_BASE_MS * Math.pow(2, realtimeReconnectAttempts),
  );
  realtimeReconnectAttempts += 1;
  realtimeReconnectTimer = setTimeout(function () {
    realtimeReconnectTimer = undefined;
    // Bail if we signed out or switched users while waiting.
    if (!realtimeUserId || realtimeUserId !== userId) return;
    unsubscribeFromCloudChanges();
    subscribeToCloudChanges(userId);
    // Catch-up pull: Realtime only delivers events that fire while subscribed,
    // so anything another device wrote during the dead/reconnecting window
    // would otherwise be missed until the next event. The write is already in
    // the cloud by now, so pull reconciles it. Debounced + push-first via the
    // same bridge the live events use.
    scheduleRealtimePull();
  }, delay);
}

// Realtime → pull bridge. Debounce so a burst of events (one per affected
// table) folds into a single pull. Push any pending local write first so
// the pull reads cloud state that already includes our own write —
// otherwise we'd briefly overwrite local with stale cloud (same rationale
// as initSync's push-then-pull ordering).
function scheduleRealtimePull(): void {
  clearTimeout(pullDebounceTimer);
  pullDebounceTimer = setTimeout(function () {
    pullDebounceTimer = undefined;
    const pendingPush = syncTimer ? syncNow() : Promise.resolve();
    Promise.resolve(pendingPush)
      .then(function () {
        return pullFromCloud();
      })
      .then(function () {
        if (typeof window.dispatchEvent === "function") {
          window.dispatchEvent(new CustomEvent("cw:cloud-data-changed"));
        }
      })
      .catch(function (err) {
        console.warn("[sync] realtime pull failed:", err);
      });
  }, PULL_DEBOUNCE_MS);
}

// --- Background sync on page load (if already logged in) ---
// Push first so any unsynced local writes (e.g. a save made immediately
// before navigating to this page) are propagated to the cloud before
// pull reads it back.  Otherwise pull can race an in-flight keepalive
// push and overwrite fresh local data with stale cloud state.
//
// Safe because syncCustomProfiles now deletes via the local tombstone
// list rather than diffing slugs, so push can't wipe rows created on
// another device.  (Before that fix, 9f89a2e had to reverse the order
// to pull-first to avoid cross-device data loss.)
async function initSync(): Promise<void> {
  let userId: string | null = null;
  try {
    await waitForAuthStateResolved();
    const result = await window.supabaseClient.auth.getSession();
    if (!result.data || !result.data.session) return;
    userId = result.data.session.user.id;
    await pushAllToCloud();
    await pullFromCloud();
    if (typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent("cw:cloud-data-changed"));
    }
  } catch (err) {
    console.warn("[sync] initSync failed:", err);
  } finally {
    // Bind Realtime even if the initial push/pull failed so a transient
    // network blip doesn't leave the tab without cloud updates for the
    // rest of the session.
    if (userId) subscribeToCloudChanges(userId);
  }
}

// --- Flush pending sync when navigating away ---
// Returns a promise that resolves when the inflight push settles, and
// rejects if the push fails.  Logout awaits this before calling signOut()
// so a debounced edit (made within SYNC_DEBOUNCE_MS of clicking Log out)
// reaches the cloud before the session is cleared; if the push fails the
// caller MUST abort logout to avoid wiping unsynced edits.  Background
// callers (visibilitychange, pagehide) can ignore the rejection.
export function flushPendingSync(): Promise<void> {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = undefined;
    return pushAllToCloud();
  }
  return Promise.resolve();
}

// Wipe all Category A/B/C keys from both localStorage and sessionStorage.
// Category D (theme, banner dismissals, cafelytic_no_analytics,
// cw_estimate_cache_v1:*, sb-*-auth-token) is preserved.  Called by the
// logout button (in ui-shared.js) AFTER signOut() resolves, and also from
// the SIGNED_OUT auth handler below as defense-in-depth.
export function clearLocalUserContent(): void {
  USER_CONTENT_KEYS_EXACT.forEach(function (k) {
    try {
      localStorage.removeItem(k);
    } catch (_) {}
    try {
      sessionStorage.removeItem(k);
    } catch (_) {}
  });
  function sweepPrefix(store: Storage): void {
    const toRemove: string[] = [];
    for (let j = 0; j < store.length; j++) {
      const key = store.key(j);
      if (!key) continue;
      for (let p = 0; p < USER_CONTENT_KEYS_PREFIX.length; p++) {
        const prefix = USER_CONTENT_KEYS_PREFIX[p];
        if (prefix && key.indexOf(prefix) === 0) {
          toRemove.push(key);
          break;
        }
      }
    }
    toRemove.forEach(function (key) {
      try {
        store.removeItem(key);
      } catch (_) {}
    });
  }
  try {
    sweepPrefix(localStorage);
  } catch (_) {}
  try {
    sweepPrefix(sessionStorage);
  } catch (_) {}
  try {
    // Dispatch on window to match the cw:cloud-data-changed convention
    // used elsewhere in this file.
    window.dispatchEvent(new Event("cw:storage-invalidated"));
  } catch (_) {}
}

// Background callers swallow flush failures; only the logout path (in
// ui-shared.js) treats a rejection as a signal to abort sign-out.
function flushPendingSyncQuiet(): void {
  flushPendingSync().catch(function (err) {
    console.warn("[sync] background flush failed:", err);
  });
}

document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "hidden") flushPendingSyncQuiet();
});

function teardownOnLeave(): void {
  unsubscribeFromCloudChanges();
  flushPendingSyncQuiet();
}

window.addEventListener("beforeunload", teardownOnLeave);
// pagehide fires reliably on mobile (iOS) and on bfcache evictions, where
// beforeunload is often skipped.
window.addEventListener("pagehide", teardownOnLeave);

// Promote anonymous in-tab work into logged-in storage on sign-in. Transient
// keys route to sessionStorage while logged out (storage.ts _getTransient/
// _setTransient), but nothing copied them across when auth flipped to true, so
// the moment _isLoggedInSync() returned true every transient read switched to
// (empty) localStorage and the sessionStorage copy was stranded until the tab
// closed — silently losing whatever the visitor had entered before signing in.
//
// Uses explicit sessionStorage -> localStorage access (NOT _getTransient/
// _setTransient, which branch on login state and are ambiguous mid-transition).
// Runs before handleFirstLoginMerge so the migrated work counts as local data.
// Idempotent: each genuine SIGNED_IN clears the sessionStorage copy it moves,
// so a later sign-in with no fresh anonymous work migrates nothing.
export function migrateAnonTransientToLocal(): void {
  if (typeof sessionStorage === "undefined" || typeof localStorage === "undefined") return;
  try {
    const keys: string[] = TRANSIENT_KEYS.slice();
    // Plus any dynamic cw_volume_* entries written while anonymous.
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (
        k &&
        keys.indexOf(k) === -1 &&
        TRANSIENT_KEYS_PREFIX.some(function (prefix) {
          return k.startsWith(prefix);
        })
      ) {
        keys.push(k);
      }
    }
    keys.forEach(function (key) {
      let val: string | null;
      try {
        val = sessionStorage.getItem(key);
      } catch (_) {
        return;
      }
      if (val === null) return;
      try {
        // The anonymous in-tab edit is the most recent intent, so it wins over
        // any stale localStorage value; the cloud merge still gets a say after.
        localStorage.setItem(key, val);
        sessionStorage.removeItem(key);
      } catch (_) {}
    });
  } catch (_) {}
}

// Re-bind Realtime when the auth session changes within a single page
// (sign-in from a logged-out tab, or sign-out without a reload).
// SIGNED_OUT tears the channel down; SIGNED_IN subscribes for the new
// user. TOKEN_REFRESHED is a no-op — supabase-js v2 keeps the existing
// channel alive across token refreshes.
if (window.supabaseClient && window.supabaseClient.auth) {
  window.supabaseClient.auth.onAuthStateChange(function (event: string, session: any) {
    if (event === "SIGNED_OUT") {
      unsubscribeFromCloudChanges();
      // Defense-in-depth: covers session expiry, OAuth edge cases, or any
      // SIGNED_OUT path that doesn't route through the logout button.
      // Idempotent with the button's explicit clearLocalUserContent call.
      clearLocalUserContent();
    } else if (event === "SIGNED_IN" && session && session.user) {
      // Promote any work the user did while logged out (transient keys live in
      // sessionStorage when anonymous) into localStorage BEFORE the merge runs,
      // so handleFirstLoginMerge sees it as local data instead of silently
      // discarding it when the storage namespace flips to localStorage.
      migrateAnonTransientToLocal();
      subscribeToCloudChanges(session.user.id);
      // Without this call, modal-based sign-ins succeed but the user's
      // saved recipes/profiles don't appear until the next page navigation
      // (which is when the existing login.html call site would have fired).
      // TOKEN_REFRESHED reuses the same session and does NOT enter this
      // branch — Supabase emits it as a distinct event — so we don't risk
      // re-pulling on token rotation.
      handleFirstLoginMerge()
        .then(function () {
          if (typeof window.dispatchEvent === "function") {
            window.dispatchEvent(new CustomEvent("cw:cloud-data-changed"));
          }
        })
        .catch(function (err) {
          console.warn("[sync] post-signin merge failed:", err);
        });
    }
  });
}

// --- Window publishing (browser + tests) ---
// In the browser the legacy-globals.ts bridge module also copies these onto
// window via Object.assign, but the explicit assignments below mean tests
// (sync.test.js) — which `require()` this file without loading the bridge —
// still see the public API on `global` after `global.window = global`.
window.scheduleSyncToCloud = scheduleSyncToCloud;
window.syncNow = syncNow;
window.pushAllToCloud = pushAllToCloud;
window.pullFromCloud = pullFromCloud;
window.handleFirstLoginMerge = handleFirstLoginMerge;
window.flushPendingSync = flushPendingSync;
window.clearLocalUserContent = clearLocalUserContent;
window.realtimeSubscribedPromise = realtimeSubscribedPromise;

// Kick off background sync. Expose the promise so tests (and any other
// out-of-tree caller) can await push+pull settling before issuing writes —
// page.goto resolves on `load`, but initSync's async work keeps running
// afterward, and a test write between those points races initSync's pull.
const initSyncPromise = initSync();
window.initSyncPromise = initSyncPromise;
export { initSyncPromise, realtimeSubscribedPromise };
