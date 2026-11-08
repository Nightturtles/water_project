import { THEME_KEY } from "./constants";
import {
  safeGetItem,
  safeSetItem,
  safeRemoveItem,
  safeParse,
  loadSourceWater,
  loadSourcePresetName,
  loadThemePreference,
  loadMineralDisplayMode,
  loadBrewMethod,
  loadLotusDropperType,
  loadSelectedMinerals,
  DEFAULT_SELECTED_MINERALS,
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
import {
  KEYS,
  VOLUME_PREFIX,
  USER_CONTENT_KEYS_EXACT,
  USER_CONTENT_KEYS_PREFIX,
  TRANSIENT_KEYS,
  TRANSIENT_KEYS_PREFIX,
} from "./storage-keys";
import { reportError } from "./report";

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
// Monotonic counter bumped on every local save (scheduleSyncToCloud). The
// realtime pull snapshots it before its network read and bails out of applying
// cloud data if it changed — i.e. a local write landed mid-pull — so the
// full-row overwrites can't clobber an edit made while the pull was in flight.
let localWriteSeq = 0;
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

// Serialization gate for realtime-triggered pulls. Each enqueued task runs
// only after every previously-enqueued task has settled, so two
// pullFromCloud calls can never overlap (a burst of realtime events while a
// pull is in flight previously re-armed the debounce timer and could start
// a second, concurrent pull). The chain never rejects: each task's errors
// are the task's own responsibility (scheduleRealtimePull's catch), and the
// recovery arms below are belt-and-suspenders so one rejected task can't
// wedge every later pull. Exported for unit tests only — NOT published on
// window.
let realtimePullChain: Promise<unknown> = Promise.resolve();
export function enqueueSerialized(task: () => Promise<unknown>): Promise<unknown> {
  const next = realtimePullChain.then(task, task);
  realtimePullChain = next.then(
    function () {},
    function () {},
  );
  return next;
}

// Dirty-tracking storage keys. Each holds the last-successfully-pushed
// snapshot for one table. `pushAllToCloud` / `syncCustomProfiles` compare
// current localStorage state to these snapshots and skip upserts when
// nothing changed — avoids the postgres_changes broadcast storm that fires
// on every page-load initSync.push otherwise (each upserted row emits a
// broadcast, and every subscribed page receives them, including the
// pusher itself, which then runs a redundant pullFromCloud that can race
// an immediately-following local write).
const LAST_PUSHED_SETTINGS_KEY = KEYS.LAST_PUSHED_SETTINGS;
const LAST_PUSHED_SELECTIONS_KEY = KEYS.LAST_PUSHED_SELECTIONS;
const LAST_PUSHED_SOURCES_KEY = KEYS.LAST_PUSHED_SOURCE_PROFILES;
const LAST_PUSHED_TARGETS_KEY = KEYS.LAST_PUSHED_TARGET_PROFILES;

// USER_CONTENT_KEYS_EXACT / USER_CONTENT_KEYS_PREFIX (the logout wipe) and
// TRANSIENT_KEYS / TRANSIENT_KEYS_PREFIX (anonymous sessionStorage routing +
// sign-in migration) are imported from the categorized key registry in
// ./storage-keys, so they're derived from one source and can't drift apart.
// Category D keys (cw_theme, banner dismissals, cafelytic_no_analytics,
// cw_estimate_cache_v1:*, sb-*-auth-token) are intentionally absent there and
// are never cleared.

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
  localWriteSeq += 1;
  dispatchSaveStatus("saving");
  clearTimeout(syncTimer);
  syncTimer = setTimeout(function () {
    pushAllToCloud()
      .then(function () {
        // Refused by the first-login merge gate: still "saving" until the
        // merge completes and pushes (handleFirstLoginMerge), not "saved".
        if (!lastPushDeferredByMergeGate) dispatchSaveStatus("saved");
      })
      .catch(function (err) {
        reportError("sync.push", err);
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
      if (!lastPushDeferredByMergeGate) dispatchSaveStatus("saved");
    })
    .catch(function (err) {
      reportError("sync.push-immediate", err);
      dispatchSaveStatus("error", err);
    });
}

// --- Get currently logged-in user ID ---
// Resolves the user id, or null when genuinely signed out (no session). A
// lookup that FAILED (offline, a network blip, a server error) throws instead.
// It used to collapse into null, which made every push a silent no-op that
// still reported "saved", and let logout treat an unreachable account as
// "nothing to flush" and wipe unsynced edits.
async function getLoggedInUserId(): Promise<string | null> {
  const result = await window.supabaseClient.auth.getUser();
  const user = result && result.data && result.data.user;
  if (user) return user.id;
  const error = result && result.error;
  if (!error || (error as { name?: string }).name === "AuthSessionMissingError") return null;
  throw error;
}

// --- Collect all cw_volume_* entries from localStorage into one object ---
function collectVolumePreferences(): Record<string, unknown> {
  const volumes: Record<string, unknown> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(VOLUME_PREFIX)) {
        const pageKey = key.slice(VOLUME_PREFIX.length);
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
  const mineralInputs = safeParse(safeGetItem(KEYS.RECIPE_MINERAL_INPUTS), null);
  if (mineralInputs && typeof mineralInputs === "object")
    drafts.recipe_mineral_inputs = mineralInputs;
  const concentrateInputs = safeParse(safeGetItem(KEYS.RECIPE_CONCENTRATE_INPUTS), null);
  if (concentrateInputs && typeof concentrateInputs === "object")
    drafts.recipe_concentrate_inputs = concentrateInputs;
  const stockGrams = safeParse(safeGetItem(KEYS.RECIPE_STOCK_GRAMS), null);
  if (stockGrams && typeof stockGrams === "object") drafts.recipe_stock_grams = stockGrams;
  const dispenseMode = safeGetItem(KEYS.RECIPE_DISPENSE_MODE);
  if (dispenseMode === "manual" || dispenseMode === "stock")
    drafts.recipe_dispense_mode = dispenseMode;
  const targetDraftIons = safeParse(safeGetItem(KEYS.TARGET_DRAFT_IONS), null);
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

// --- Three-way merge of the single-row tables ---------------------------------
//
// user_settings / user_selections each hold one row per user that several
// devices edit. Every pull and push merges three versions of a field:
//   base  — what this device last synced (the LAST_PUSHED_* snapshot),
//   local — what this device holds now,
//   cloud — what the cloud row holds now.
// A field this device hasn't touched since it last synced (local == base)
// takes the cloud value; a field it has changed keeps the local value. Sets
// and keyed dicts merge element-by-element, so two devices adding different
// concentrates (or tombstones, or rail additions) both survive. Before this,
// pulls overwrote unpushed local edits and pushes overwrote other devices'
// changes wholesale.
export type FieldKind = "scalar" | "set" | "dict";

export const SETTINGS_FIELD_KINDS: Record<string, FieldKind> = {
  theme: "scalar",
  mineral_display_mode: "scalar",
  brew_method: "scalar",
  lotus_dropper_type: "scalar",
  selected_minerals: "set",
  selected_concentrates: "set",
  diy_concentrate_specs: "dict",
  stock_concentrate_specs: "dict",
  lotus_concentrate_units: "dict",
  volume_preferences: "dict",
  creator_display_name: "scalar",
  drafts: "dict",
};

export const SELECTIONS_FIELD_KINDS: Record<string, FieldKind> = {
  source_preset: "scalar",
  source_water: "scalar",
  target_preset: "scalar",
  deleted_source_presets: "set",
  deleted_target_presets: "set",
  added_target_presets: "set",
};

// "pull": a field with no base (first sync on this device) takes the cloud
// value, as the fresh-device pull always has. "push": a field with no base
// (the first-login merge's "keep local" / new-account push) keeps local data
// but unions collections with the cloud, so choosing "Keep local data" can't
// erase concentrates, tombstones or rail additions saved on other devices.
export type MergeMode = "pull" | "push";

function sameValue(a: unknown, b: unknown): boolean {
  return (
    stableStringify(a === undefined ? null : a) === stableStringify(b === undefined ? null : b)
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function mergeScalar(
  base: unknown,
  hasBase: boolean,
  local: unknown,
  cloud: unknown,
  mode: MergeMode,
): unknown {
  if (cloud === undefined || cloud === null) return local;
  if (!hasBase) {
    if (mode === "pull") return cloud;
    return local === undefined || local === null || local === "" ? cloud : local;
  }
  return sameValue(local, base) ? cloud : local;
}

function mergeSet(
  base: unknown,
  hasBase: boolean,
  local: unknown,
  cloud: unknown,
  mode: MergeMode,
): unknown[] {
  const L = Array.isArray(local) ? local : [];
  if (!Array.isArray(cloud)) return L.slice();
  const C = cloud;
  if (!hasBase && mode === "pull") return C.slice();
  const B = hasBase && Array.isArray(base) ? base : [];
  const out: unknown[] = [];
  const has = (list: unknown[], x: unknown) => list.some((y) => sameValue(x, y));
  // Kept if both sides have it, or one side added it since the last sync.
  // Something one side removed since the last sync stays removed.
  L.forEach(function (x) {
    if ((has(C, x) || !has(B, x)) && !has(out, x)) out.push(x);
  });
  C.forEach(function (x) {
    if (!has(L, x) && !has(B, x) && !has(out, x)) out.push(x);
  });
  return out;
}

function mergeDict(
  base: unknown,
  hasBase: boolean,
  local: unknown,
  cloud: unknown,
  mode: MergeMode,
): Record<string, unknown> {
  const L = isPlainObject(local) ? local : {};
  if (!isPlainObject(cloud)) return Object.assign({}, L);
  const C = cloud;
  if (!hasBase) {
    // Union either way; on a shared key the first-sync pull takes the cloud's
    // value and the keep-local push takes this device's.
    return mode === "pull" ? Object.assign({}, L, C) : Object.assign({}, C, L);
  }
  const B = isPlainObject(base) ? base : {};
  const out: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(L), ...Object.keys(C), ...Object.keys(B)]);
  keys.forEach(function (k) {
    const lk = Object.prototype.hasOwnProperty.call(L, k) ? L[k] : undefined;
    const bk = Object.prototype.hasOwnProperty.call(B, k) ? B[k] : undefined;
    const ck = Object.prototype.hasOwnProperty.call(C, k) ? C[k] : undefined;
    const v = sameValue(lk, bk) ? ck : lk;
    if (v !== undefined) out[k] = v;
  });
  return out;
}

// Merge every field listed in `kinds`. `base` is the parsed LAST_PUSHED_*
// snapshot (null when this device has never synced the row).
export function mergeRowFields(
  kinds: Record<string, FieldKind>,
  base: Record<string, unknown> | null,
  local: Record<string, unknown>,
  cloud: Record<string, unknown>,
  mode: MergeMode,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.keys(kinds).forEach(function (field) {
    const hasBase = !!base && Object.prototype.hasOwnProperty.call(base, field);
    const b = hasBase ? base![field] : undefined;
    const l = local[field];
    const c = cloud[field];
    const kind = kinds[field];
    const v =
      kind === "set"
        ? mergeSet(b, hasBase, l, c, mode)
        : kind === "dict"
          ? mergeDict(b, hasBase, l, c, mode)
          : mergeScalar(b, hasBase, l, c, mode);
    if (v !== undefined) out[field] = v;
  });
  return out;
}

function pickFields(
  kinds: Record<string, FieldKind>,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.keys(kinds).forEach(function (field) {
    if (row[field] !== undefined) out[field] = row[field];
  });
  return out;
}

function parseSnapshot(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

// Read-merge-write one single-row table. Returns the payload actually written
// (the new base) and whether it carries changes from other devices that this
// device doesn't have yet.
async function pushMergedRow(
  userId: string,
  table: "user_settings" | "user_selections",
  kinds: Record<string, FieldKind>,
  local: Record<string, unknown>,
  baseSnapshot: string | null,
  now: string,
): Promise<{ error?: unknown; pushed?: Record<string, unknown>; foldsRemoteChanges?: boolean }> {
  const read = await window.supabaseClient
    .from(table)
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (read && read.error) return { error: read.error };
  const cloud = read && isPlainObject(read.data) ? read.data : null;
  const localFields = pickFields(kinds, local);
  const merged = cloud
    ? mergeRowFields(kinds, parseSnapshot(baseSnapshot), localFields, cloud, "push")
    : localFields;
  const payload = Object.assign({ user_id: userId }, merged, { updated_at: now });
  const write = await window.supabaseClient.from(table).upsert(payload, { onConflict: "user_id" });
  if (write && write.error) return { error: write.error };
  return { pushed: payload, foldsRemoteChanges: !sameValue(localFields, merged) };
}

// The cloud row reduced to the payload shape buildSettingsPayload /
// buildSelectionsPayload produce, for the LAST_PUSHED_* base snapshot.
function cloudRowAsPayload(
  kinds: Record<string, FieldKind>,
  userId: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  return Object.assign({ user_id: userId }, pickFields(kinds, row));
}

// The recipe-builder / target drafts bundled in user_settings.drafts, and the
// storage key each one lives under.
const DRAFT_KEYS: Array<{ field: string; key: string; kind: "object" | "dispense" }> = [
  { field: "recipe_mineral_inputs", key: KEYS.RECIPE_MINERAL_INPUTS, kind: "object" },
  { field: "recipe_concentrate_inputs", key: KEYS.RECIPE_CONCENTRATE_INPUTS, kind: "object" },
  { field: "recipe_stock_grams", key: KEYS.RECIPE_STOCK_GRAMS, kind: "object" },
  { field: "recipe_dispense_mode", key: KEYS.RECIPE_DISPENSE_MODE, kind: "dispense" },
  { field: "target_draft_ions", key: KEYS.TARGET_DRAFT_IONS, kind: "object" },
];

// Write a (merged) user_settings row into localStorage.
function applySettingsRow(settings: Record<string, any>): void {
  if (settings.theme) safeSetItem(THEME_KEY, settings.theme);
  if (settings.mineral_display_mode)
    safeSetItem(KEYS.MINERAL_DISPLAY_MODE, settings.mineral_display_mode);
  if (settings.brew_method) safeSetItem(KEYS.BREW_METHOD, settings.brew_method);
  if (settings.lotus_dropper_type)
    safeSetItem(KEYS.LOTUS_DROPPER_TYPE, settings.lotus_dropper_type);
  if (settings.selected_minerals)
    safeSetItem(KEYS.SELECTED_MINERALS, JSON.stringify(settings.selected_minerals));
  if (settings.selected_concentrates)
    safeSetItem(KEYS.SELECTED_CONCENTRATES, JSON.stringify(settings.selected_concentrates));
  if (settings.diy_concentrate_specs)
    safeSetItem(KEYS.DIY_CONCENTRATE_SPECS, JSON.stringify(settings.diy_concentrate_specs));
  if (settings.stock_concentrate_specs)
    safeSetItem(KEYS.STOCK_CONCENTRATE_SPECS, JSON.stringify(settings.stock_concentrate_specs));
  if (settings.lotus_concentrate_units)
    safeSetItem(KEYS.LOTUS_CONCENTRATE_UNITS, JSON.stringify(settings.lotus_concentrate_units));
  if (settings.volume_preferences && typeof settings.volume_preferences === "object") {
    Object.entries(settings.volume_preferences).forEach(function (entry) {
      safeSetItem(VOLUME_PREFIX + entry[0], JSON.stringify(entry[1]));
    });
  }
  if (settings.creator_display_name)
    safeSetItem(KEYS.CREATOR_DISPLAY_NAME, settings.creator_display_name);
  // Drafts mirror the merged set exactly: a draft another device cleared (and
  // this device hadn't touched) is cleared here too. A missing drafts blob
  // leaves local drafts alone.
  if (isPlainObject(settings.drafts)) {
    const drafts = settings.drafts;
    DRAFT_KEYS.forEach(function (d) {
      const v = drafts[d.field];
      if (d.kind === "dispense") {
        if (v === "manual" || v === "stock") safeSetItem(d.key, v);
        else safeRemoveItem(d.key);
      } else if (v && typeof v === "object") {
        safeSetItem(d.key, JSON.stringify(v));
      } else {
        safeRemoveItem(d.key);
      }
    });
  }
}

// Write a (merged) user_selections row into localStorage.
function applySelectionsRow(selections: Record<string, any>): void {
  if (selections.source_preset) safeSetItem(KEYS.SOURCE_PRESET, selections.source_preset);
  if (selections.source_water)
    safeSetItem(KEYS.SOURCE_WATER, JSON.stringify(selections.source_water));
  if (selections.target_preset) safeSetItem(KEYS.TARGET_PRESET, selections.target_preset);
  if (selections.deleted_source_presets)
    safeSetItem(KEYS.DELETED_PRESETS, JSON.stringify(selections.deleted_source_presets));
  if (selections.deleted_target_presets)
    safeSetItem(KEYS.DELETED_TARGET_PRESETS, JSON.stringify(selections.deleted_target_presets));
  if (selections.added_target_presets)
    safeSetItem(KEYS.ADDED_TARGET_PRESETS, JSON.stringify(selections.added_target_presets));
}

// Merge the cloud's custom-profile rows with this device's profile dict.
// `base` holds the per-slug snapshot this device last synced. Returns the
// merged dict and the new per-slug base: the cloud's version of every cloud
// slug (so a profile kept locally stays dirty until pushed), and nothing for
// local-only profiles that never reached the cloud.
export function mergeProfileRows<P>(
  cloudRows: any[],
  local: Record<string, P>,
  tombstoned: string[],
  base: Record<string, string>,
  toProfile: (row: any) => P,
  toSnapshot: (slug: string, profile: P) => string,
): { profiles: Record<string, P>; snapshots: Record<string, string> } {
  const tomb = new Set(tombstoned);
  const profiles: Record<string, P> = {};
  const snapshots: Record<string, string> = {};
  const cloudSlugs = new Set<string>();
  cloudRows.forEach(function (row) {
    if (!row || typeof row.slug !== "string") return;
    const slug = row.slug;
    if (tomb.has(slug)) return;
    cloudSlugs.add(slug);
    const cloudProfile = toProfile(row);
    const cloudSnap = toSnapshot(slug, cloudProfile);
    snapshots[slug] = cloudSnap;
    const localProfile = Object.prototype.hasOwnProperty.call(local, slug)
      ? local[slug]
      : undefined;
    if (localProfile !== undefined) {
      const localSnap = toSnapshot(slug, localProfile);
      // Local changed since the last sync and differs from the cloud: keep
      // it (an unpushed edit; on a true conflict this device's newer edit
      // wins and is pushed next).
      if (localSnap !== base[slug] && localSnap !== cloudSnap) {
        profiles[slug] = localProfile;
        return;
      }
    }
    profiles[slug] = cloudProfile;
  });
  Object.keys(local).forEach(function (slug) {
    if (cloudSlugs.has(slug) || tomb.has(slug)) return;
    // Never synced: an unpushed creation, keep it. Synced before and now gone
    // from the cloud: deleted on another device, drop it.
    if (base[slug] === undefined) profiles[slug] = local[slug]!;
  });
  return { profiles, snapshots };
}

// Drop confirmed-delete entries for slugs that are no longer tombstoned.
function pruneConfirmedDeletes(key: string, tombstoned: string[]): void {
  const confirmed: unknown = safeParse(safeGetItem(key), null);
  if (!Array.isArray(confirmed)) return;
  const tomb = new Set(tombstoned);
  const kept = confirmed.filter(function (s) {
    return typeof s === "string" && tomb.has(s);
  });
  if (kept.length !== confirmed.length) safeSetItem(key, JSON.stringify(kept));
}

// True when this device holds changes the cloud doesn't have yet: a settings
// or selections field, a custom profile, or a tombstone whose DELETE hasn't
// been confirmed. Mirrors the dirty checks pushAllToCloud makes. False before
// the first-login merge (nothing can be pushed yet) and when signed out.
export function hasUnpushedChanges(): boolean {
  const userId = safeGetItem(KEYS.SYNCED_USER_ID);
  if (!userId) return false;
  if (
    snapshotForCompare(buildSettingsPayload(userId, "")) !== safeGetItem(LAST_PUSHED_SETTINGS_KEY)
  )
    return true;
  if (
    snapshotForCompare(buildSelectionsPayload(userId, "")) !==
    safeGetItem(LAST_PUSHED_SELECTIONS_KEY)
  )
    return true;
  const profileTables: Array<{
    profiles: Record<string, unknown>;
    tombstones: string[];
    snapshotsKey: string;
    confirmedKey: string;
    build: (slug: string, p: any) => unknown;
  }> = [
    {
      profiles: loadCustomProfiles(),
      tombstones: loadDeletedPresets(),
      snapshotsKey: LAST_PUSHED_SOURCES_KEY,
      confirmedKey: KEYS.CONFIRMED_DELETED_SOURCE_PROFILES,
      build: function (slug, p) {
        return buildSourceRow(userId, slug, p);
      },
    },
    {
      profiles: loadCustomTargetProfiles(),
      tombstones: loadDeletedTargetPresets(),
      snapshotsKey: LAST_PUSHED_TARGETS_KEY,
      confirmedKey: KEYS.CONFIRMED_DELETED_TARGET_PROFILES,
      build: function (slug, p) {
        return buildTargetRow(userId, slug, p);
      },
    },
  ];
  return profileTables.some(function (t) {
    const snaps: Record<string, string> = safeParse(safeGetItem(t.snapshotsKey), null) || {};
    const tomb = new Set(t.tombstones);
    const profileDirty = Object.keys(t.profiles).some(function (slug) {
      return !tomb.has(slug) && snaps[slug] !== stableStringify(t.build(slug, t.profiles[slug]));
    });
    if (profileDirty) return true;
    const confirmed = new Set<string>(safeParse(safeGetItem(t.confirmedKey), []));
    return t.tombstones.some(function (s) {
      return !confirmed.has(s);
    });
  });
}

// --- Push all localStorage data to Supabase ---
//
// Merge gate: refuses to push until this device has completed
// handleFirstLoginMerge for the signed-in user (SYNCED_USER_ID === userId).
// user_settings is one whole-row upsert, so a push from a device that has
// not yet reconciled with the cloud overwrites the cloud row with whatever
// this device happens to hold, which on a fresh sign-in is empty concentrate
// specs. That was the "my concentrates vanish when I sign in on the web"
// bug: login.html redirects to index.html the instant sign-in resolves,
// which kills the in-flight merge, and index.html's initSync (plus any
// debounced save) then pushed the empty local row before a merge ever
// pulled. Only handleFirstLoginMerge itself bypasses the gate, via
// allowBeforeMerge, for its "new user" and "keep local" branches.
//
// mergeUserId binds the merge's push to the user the merge started for: if
// the session switched accounts meanwhile, reject rather than push this
// device's (by then cleared) local state over another account's cloud row.
//
// Pushes are serialized (pushQueue): a second push starts only after the
// previous one settles, so logout's flush can await an in-flight push and two
// pushes can't interleave their read-merge-write of the same row.
let pushQueue: Promise<unknown> = Promise.resolve();
// Set when the most recent push was refused by the merge gate, so the save
// indicator doesn't claim "saved"; mergeGateRefusedPush stays set until the
// merge completes and pushes the held-back changes.
let lastPushDeferredByMergeGate = false;
let mergeGateRefusedPush = false;

// Clear this device's user content when it was last merged for a different
// account than `userId` (an account switch without a sign-out), so that
// account's data is never pushed into or mixed with the new one.
function clearLocalDataIfAccountChanged(userId: string): void {
  const syncedUserId = safeGetItem(KEYS.SYNCED_USER_ID);
  if (syncedUserId && syncedUserId !== userId) clearLocalUserContent();
}

export function pushAllToCloud(options?: {
  allowBeforeMerge?: boolean;
  mergeUserId?: string;
}): Promise<void> {
  const run = function () {
    return pushAllToCloudNow(options);
  };
  const next = pushQueue.then(run, run);
  pushQueue = next.then(
    function () {},
    function () {},
  );
  return next;
}

// Resolve the signed-in user for a push/pull, wrapping a failed lookup in an
// error callers can recognise (the underlying error is kept as `cause`, so
// reportError still classifies an offline blip as transient).
async function lookupUserIdForSync(): Promise<string | null> {
  try {
    return await getLoggedInUserId();
  } catch (err) {
    throw new Error("[sync] could not resolve the signed-in user", { cause: err });
  }
}

async function pushAllToCloudNow(options?: {
  allowBeforeMerge?: boolean;
  mergeUserId?: string;
}): Promise<void> {
  lastPushDeferredByMergeGate = false;
  const userId = await lookupUserIdForSync();
  if (!userId) {
    // The merge's own push (allowBeforeMerge) must not "succeed" without
    // pushing: handleFirstLoginMerge would then mark the device merged, and a
    // realtime pull could overwrite the local data the user chose to keep
    // before any push sent it up. Reject so the merge aborts and retries.
    // Ordinary pushes keep the logged-out no-op.
    if (options && options.allowBeforeMerge) {
      throw new Error("[sync] merge push aborted: could not resolve the signed-in user");
    }
    return;
  }
  if (options && options.mergeUserId && userId !== options.mergeUserId) {
    throw new Error("[sync] merge push aborted: the signed-in user changed");
  }
  if (!(options && options.allowBeforeMerge) && safeGetItem(KEYS.SYNCED_USER_ID) !== userId) {
    // Refused until the first-login merge completes; the merge pushes
    // afterwards (see handleFirstLoginMerge). Not a "saved".
    lastPushDeferredByMergeGate = true;
    mergeGateRefusedPush = true;
    return;
  }

  const now = new Date().toISOString();
  const seqAtStart = localWriteSeq;

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

  // Each row is pushed as read-merge-write: fetch the cloud row, three-way
  // merge it with this device's state (base = what this device last synced),
  // then upsert the merge. A blind whole-row upsert let a device with one
  // stale pending change overwrite fields other devices had since changed
  // (concentrate specs, the curated rail, tombstones, the creator name).
  const rows: Array<{
    table: "user_settings" | "user_selections";
    kinds: Record<string, FieldKind>;
    local: Record<string, unknown>;
    baseSnapshot: string | null;
    key: string;
  }> = [];
  if (settingsChanged) {
    rows.push({
      table: "user_settings",
      kinds: SETTINGS_FIELD_KINDS,
      local: settingsPayload,
      baseSnapshot: lastSettingsSnapshot,
      key: LAST_PUSHED_SETTINGS_KEY,
    });
  }
  if (selectionsChanged) {
    rows.push({
      table: "user_selections",
      kinds: SELECTIONS_FIELD_KINDS,
      local: selectionsPayload,
      baseSnapshot: lastSelectionsSnapshot,
      key: LAST_PUSHED_SELECTIONS_KEY,
    });
  }

  if (rows.length > 0) {
    const results = await Promise.all(
      rows.map(function (r) {
        return pushMergedRow(userId, r.table, r.kinds, r.local, r.baseSnapshot, now);
      }),
    );
    const pushErrors: unknown[] = [];
    let foldedRemoteChanges = false;
    results.forEach(function (res, idx) {
      const r = rows[idx];
      if (!r) return;
      if (res.error) {
        reportError("sync.upsert", res.error, { table: r.table });
        pushErrors.push(res.error);
        return;
      }
      safeSetItem(r.key, snapshotForCompare(res.pushed!));
      // Fold the other devices' changes the merge picked up into local
      // storage, unless the user edited something while we were away on the
      // network (then the push that edit scheduled will merge again).
      if (res.foldsRemoteChanges && localWriteSeq === seqAtStart) {
        if (r.table === "user_settings") applySettingsRow(res.pushed!);
        else applySelectionsRow(res.pushed!);
        foldedRemoteChanges = true;
      }
    });
    if (foldedRemoteChanges) {
      invalidateAllCaches();
      if (typeof window.dispatchEvent === "function") {
        window.dispatchEvent(new CustomEvent("cw:cloud-data-changed"));
      }
    }
    if (pushErrors.length > 0) {
      // Carry the underlying upsert errors so reportError can tell a transient
      // network blip (self-heals on the next push) apart from a real Postgrest
      // rejection. The throw stays load-bearing: logout's flushPendingSync
      // await relies on it to abort and preserve unsynced edits, so this
      // enriches the error without swallowing it.
      throw new Error("[sync] failed to upsert one or more cloud rows", {
        cause: pushErrors,
      });
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
  //
  // Each tombstone's DELETE is sent until it succeeds once, then recorded as
  // confirmed and never replayed. Replaying every tombstone on every push let
  // a device holding an old tombstone delete a recipe another device had
  // since re-created under the same slug (re-saving lifts the tombstone on
  // that device, but the stale device still had it and pushed before pulling).
  const confirmedSources = new Set<string>(
    safeParse(safeGetItem(KEYS.CONFIRMED_DELETED_SOURCE_PROFILES), []),
  );
  const confirmedTargets = new Set<string>(
    safeParse(safeGetItem(KEYS.CONFIRMED_DELETED_TARGET_PROFILES), []),
  );
  const sourceDeletes = deletedSources.filter(function (s) {
    return !confirmedSources.has(s);
  });
  const targetDeletes = deletedTargets.filter(function (s) {
    return !confirmedTargets.has(s);
  });
  const deleteCalls: any[] = [];
  const deletedSourcesPending = sourceDeletes.length > 0;
  const deletedTargetsPending = targetDeletes.length > 0;
  if (deletedSourcesPending) {
    deleteCalls.push(
      window.supabaseClient
        .from("source_profiles")
        .delete()
        .eq("user_id", userId)
        .in("slug", sourceDeletes),
    );
  }
  if (deletedTargetsPending) {
    deleteCalls.push(
      window.supabaseClient
        .from("target_profiles")
        .delete()
        .eq("user_id", userId)
        .in("slug", targetDeletes),
    );
  }
  if (deleteCalls.length > 0) {
    const delResults = await Promise.all(deleteCalls);
    let nextIdx = 0;
    const deleteErrors: unknown[] = [];
    if (deletedSourcesPending) {
      const srcDel = delResults[nextIdx++];
      if (srcDel && srcDel.error) {
        reportError("sync.tombstone-delete", srcDel.error);
        deleteErrors.push(srcDel.error);
      } else {
        sourceDeletes.forEach(function (s) {
          delete lastSourceSnapshots[s];
          confirmedSources.add(s);
        });
      }
    }
    if (deletedTargetsPending) {
      const tgtDel = delResults[nextIdx];
      if (tgtDel && tgtDel.error) {
        reportError("sync.tombstone-delete", tgtDel.error);
        deleteErrors.push(tgtDel.error);
      } else {
        targetDeletes.forEach(function (s) {
          delete lastTargetSnapshots[s];
          confirmedTargets.add(s);
        });
      }
    }
    // Keep only slugs that are still tombstoned, so a slug that is re-saved
    // and later deleted again has its DELETE sent again.
    safeSetItem(
      KEYS.CONFIRMED_DELETED_SOURCE_PROFILES,
      JSON.stringify(deletedSources.filter((s) => confirmedSources.has(s))),
    );
    safeSetItem(
      KEYS.CONFIRMED_DELETED_TARGET_PROFILES,
      JSON.stringify(deletedTargets.filter((s) => confirmedTargets.has(s))),
    );
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
      reportError("sync.profile-upsert", srcResult.error, { table: "source_profiles" });
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
      reportError("sync.profile-upsert", tgtResult.error, { table: "target_profiles" });
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
//
// Resolves true when applied (or signed out), false when skipped for a
// mid-pull local write (caller re-pulls), "discarded" when the rows belonged
// to a user who is no longer the one this pull was bound to.
//
// mergeUserId (the first-login merge): the pull must be for that user. An
// unresolved or different user, before or after the fetch, throws instead of
// a silent no-op, so the merge aborts and SYNCED_USER_ID stays unset.
// expectedUserId (realtime): the pull is bound to the user that passed the
// merge gate; if the signed-in user or the merge marker no longer matches by
// the time rows arrive, they are discarded rather than applied.
export async function pullFromCloud(options?: {
  skipIfLocalWriteDuringPull?: boolean;
  mergeUserId?: string;
  expectedUserId?: string;
  markMergedFor?: string;
}): Promise<boolean | "discarded"> {
  // Snapshot the local-write counter before any network round-trip. When the
  // realtime path sets skipIfLocalWriteDuringPull, a change here before we
  // apply means a local save landed mid-pull and the full-row overwrites below
  // would clobber it — so we skip applying and return false (the caller
  // re-pulls once that write has been pushed). Page-load / first-login pulls
  // leave the option unset and apply unconditionally, as before.
  const skipIfLocalWrite = !!(options && options.skipIfLocalWriteDuringPull);
  const seqAtStart = localWriteSeq;
  const expectedUserId = options && options.expectedUserId;
  const mergeUserId = options && options.mergeUserId;
  const userId = await lookupUserIdForSync();
  if (!userId) {
    if (mergeUserId) {
      throw new Error("[sync] merge pull aborted: could not resolve the signed-in user");
    }
    // Realtime: nothing was read, so nothing changed locally; don't let the
    // caller announce a change (sign-out or a failed lookup mid-pull).
    return expectedUserId ? "discarded" : true;
  }
  if (mergeUserId && userId !== mergeUserId) {
    throw new Error("[sync] merge pull aborted: the signed-in user changed");
  }
  if (expectedUserId && userId !== expectedUserId) return "discarded";

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
    reportError("sync.pull", errored.error);
    throw errored.error;
  }

  // The session may have switched accounts while we fetched; never apply a
  // merge user's rows to whatever the device holds for someone else.
  if (mergeUserId && (await lookupUserIdForSync()) !== mergeUserId) {
    throw new Error("[sync] merge pull aborted: the signed-in user changed mid-pull");
  }

  if (skipIfLocalWrite && localWriteSeq !== seqAtStart) {
    // A local save landed while we were fetching. The rows we just read are
    // already stale for whatever the user touched, and the full-row
    // safeSetItem calls below would overwrite that edit. Skip applying: the
    // local write stays in localStorage, its own debounced push sends it to
    // the cloud, and the realtime caller re-pulls to bring remote changes down.
    console.warn("[sync] pull skipped: local write landed mid-pull; will reconcile after push");
    return false;
  }

  if (
    expectedUserId &&
    (window._cachedAuthUserId !== expectedUserId ||
      safeGetItem(KEYS.SYNCED_USER_ID) !== expectedUserId)
  ) {
    // The account changed or the merge marker was cleared while we fetched.
    // These rows belong to the gated user, not to whatever is local now; drop
    // them and let the next merge's catch-up pull reconcile.
    console.warn("[sync] pull discarded: signed-in user or merge state changed mid-pull");
    realtimePullDeferred = true;
    return "discarded";
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

  // Every pull MERGES the cloud into local state rather than overwriting it
  // (see mergeRowFields / mergeProfileRows): anything this device changed
  // since it last synced and hasn't pushed yet is kept, and the next push
  // sends it. Local state is read here, after the network round trip, so it
  // includes edits made while the fetch was in flight. Overwriting used to
  // erase recipes and settings saved while offline or while a push failed,
  // whenever a realtime / reconnect / sign-in pull ran before a successful
  // push.
  if (settings) {
    const merged = mergeRowFields(
      SETTINGS_FIELD_KINDS,
      parseSnapshot(safeGetItem(LAST_PUSHED_SETTINGS_KEY)),
      pickFields(SETTINGS_FIELD_KINDS, buildSettingsPayload(sessionUserId, "")),
      settings,
      "pull",
    );
    applySettingsRow(merged);
  }
  if (selections) {
    const merged = mergeRowFields(
      SELECTIONS_FIELD_KINDS,
      parseSnapshot(safeGetItem(LAST_PUSHED_SELECTIONS_KEY)),
      pickFields(SELECTIONS_FIELD_KINDS, buildSelectionsPayload(sessionUserId, "")),
      selections,
      "pull",
    );
    applySelectionsRow(merged);
  }
  // The profile merges below read the merged tombstones and the profile
  // dicts through cached loaders.
  invalidateAllCaches();

  const tombstonedSources = loadDeletedPresets();
  const tombstonedTargets = loadDeletedTargetPresets();
  // A tombstone another device lifted (the recipe was re-saved there) drops
  // out of the confirmed-delete set, so deleting it again later re-sends.
  pruneConfirmedDeletes(KEYS.CONFIRMED_DELETED_SOURCE_PROFILES, tombstonedSources);
  pruneConfirmedDeletes(KEYS.CONFIRMED_DELETED_TARGET_PROFILES, tombstonedTargets);

  // Cloud rows win for profiles this device hasn't changed since it last
  // synced; tombstoned slugs are skipped (cloud deletion and the tombstone
  // push aren't atomic). A local profile missing from the cloud is dropped
  // when this device had synced it before (it was deleted elsewhere — the
  // empty-result-is-authoritative rule that stops deleted recipes resurrecting)
  // and kept when it never reached the cloud (a recipe created while offline,
  // during the sign-in merge, or while a push was failing).
  if (Array.isArray(sourceRows)) {
    const result = mergeProfileRows(
      sourceRows,
      loadCustomProfiles(),
      tombstonedSources,
      safeParse(safeGetItem(LAST_PUSHED_SOURCES_KEY), null) || {},
      function (row: any) {
        return {
          label: row.label,
          calcium: row.calcium,
          magnesium: row.magnesium,
          potassium: row.potassium,
          sodium: row.sodium,
          sulfate: row.sulfate,
          chloride: row.chloride,
          bicarbonate: row.bicarbonate,
        };
      },
      function (slug: string, profile: any) {
        return stableStringify(buildSourceRow(sessionUserId, slug, profile));
      },
    );
    safeSetItem(KEYS.CUSTOM_PROFILES, JSON.stringify(result.profiles));
    safeSetItem(LAST_PUSHED_SOURCES_KEY, JSON.stringify(result.snapshots));
  }

  if (Array.isArray(targetRows)) {
    const result = mergeProfileRows(
      targetRows,
      loadCustomTargetProfiles(),
      tombstonedTargets,
      safeParse(safeGetItem(LAST_PUSHED_TARGETS_KEY), null) || {},
      function (row: any): TargetProfile {
        return {
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
      },
      function (slug: string, profile: any) {
        return stableStringify(buildTargetRow(sessionUserId, slug, profile));
      },
    );
    safeSetItem(KEYS.CUSTOM_TARGET_PROFILES, JSON.stringify(result.profiles));
    safeSetItem(LAST_PUSHED_TARGETS_KEY, JSON.stringify(result.snapshots));
  }

  // Invalidate all storage caches so the next read picks up the new data.
  if (typeof invalidateAllCaches === "function") invalidateAllCaches();

  // The new single-row base is what the cloud holds now. Where the merge kept
  // a local change, local != base, so the next push sends it. Guard each on
  // the pull actually returning a row: if the cloud has no user_settings /
  // user_selections row yet, nothing has been pushed, and recording a base
  // would let the next push skip the seed upsert.
  if (settings) {
    safeSetItem(
      LAST_PUSHED_SETTINGS_KEY,
      snapshotForCompare(cloudRowAsPayload(SETTINGS_FIELD_KINDS, sessionUserId, settings)),
    );
  }
  if (selections) {
    safeSetItem(
      LAST_PUSHED_SELECTIONS_KEY,
      snapshotForCompare(cloudRowAsPayload(SELECTIONS_FIELD_KINDS, sessionUserId, selections)),
    );
  }

  // A first-login merge marks the device merged in the same synchronous step
  // that applies the account's data (the user was re-checked after the fetch,
  // above). Marking it one network round trip later left a window where a
  // navigation (e.g. tapping another page right after signing in) kept the
  // pulled data without the marker, and the next page then asked "keep local
  // or use cloud data?" about what was really the cloud's own data.
  if (options && options.markMergedFor && options.markMergedFor === sessionUserId) {
    safeSetItem(KEYS.SYNCED_USER_ID, sessionUserId);
  }

  return true;
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

  const defaultMinerals = DEFAULT_SELECTED_MINERALS;
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
 * catches it with `reportError("sync.first-login-merge", err)` —
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
    reportError("sync.has-cloud-data", errored.error);
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

// Union two concentrate-spec dicts: every cloud entry survives, and local
// wins where both define the same key (local is the side the user chose to
// keep). Exported for unit tests.
export function unionConcentrateSpecs<T>(
  local: Record<string, T> | null | undefined,
  cloud: Record<string, T> | null | undefined,
): Record<string, T> {
  const safeCloud = cloud && typeof cloud === "object" && !Array.isArray(cloud) ? cloud : {};
  const safeLocal = local && typeof local === "object" && !Array.isArray(local) ? local : {};
  return Object.assign({}, safeCloud, safeLocal);
}

// Union two selected-concentrate id lists, local order first, deduped.
// Exported for unit tests.
export function unionConcentrateIds(local: unknown, cloud: unknown): string[] {
  const out: string[] = [];
  [local, cloud].forEach(function (list) {
    if (!Array.isArray(list)) return;
    list.forEach(function (id) {
      if (typeof id === "string" && out.indexOf(id) === -1) out.push(id);
    });
  });
  return out;
}

// Before a "Keep local data" push, pull the cloud's concentrate specs and
// selected-concentrate list and union them into local storage. Throws on a
// fetch error so the merge aborts (and retries on the next load) instead of
// pushing a row that would drop the cloud's concentrates.
export async function foldCloudConcentratesIntoLocal(userId: string): Promise<void> {
  const res = await window.supabaseClient
    .from("user_settings")
    .select("diy_concentrate_specs, stock_concentrate_specs, selected_concentrates")
    .eq("user_id", userId)
    .maybeSingle();
  if (res && res.error) {
    reportError("sync.merge-fold-concentrates", res.error);
    throw res.error;
  }
  const cloud = res && res.data;
  if (!cloud) return;
  // The account may have switched while we fetched; never fold one account's
  // concentrates into whatever the device now holds for another.
  if ((await getLoggedInUserId()) !== userId) {
    throw new Error("[sync] merge aborted: the signed-in user changed while folding concentrates");
  }
  const writes: Array<[string, string]> = [
    [
      KEYS.DIY_CONCENTRATE_SPECS,
      JSON.stringify(unionConcentrateSpecs(loadDiyConcentrateSpecs(), cloud.diy_concentrate_specs)),
    ],
    [
      KEYS.STOCK_CONCENTRATE_SPECS,
      JSON.stringify(
        unionConcentrateSpecs(loadStockConcentrateSpecs(), cloud.stock_concentrate_specs),
      ),
    ],
    [
      KEYS.SELECTED_CONCENTRATES,
      JSON.stringify(unionConcentrateIds(loadSelectedConcentrates(), cloud.selected_concentrates)),
    ],
  ];
  // A failed write (e.g. storage quota) would leave local without the cloud's
  // concentrates, and the keep-local push that follows would then erase them
  // from the cloud. Abort the merge instead: SYNCED_USER_ID stays unset, so
  // the push gate holds and the merge retries on the next load.
  for (const [key, value] of writes) {
    if (!safeSetItem(key, value)) {
      invalidateAllCaches();
      throw new Error("[sync] failed to fold cloud concentrates into local storage: " + key);
    }
  }
  invalidateAllCaches();
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

    // This device holds another account's data (it was merged for someone
    // else and never signed out). Clear it before merging so none of it is
    // pushed into, or mixed with, the account now signed in.
    clearLocalDataIfAccountChanged(userId);

    // Already set up for this user on this device — just pull latest
    const syncedUserId = safeGetItem(KEYS.SYNCED_USER_ID);
    if (syncedUserId === userId) {
      await pullFromCloud({ mergeUserId: userId });
      return;
    }

    const cloudExists = await hasCloudData(userId);

    if (!cloudExists) {
      // Brand new user: push local data to initialize cloud
      await pushAllToCloud({ allowBeforeMerge: true, mergeUserId: userId });
    } else {
      if (isDefaultData()) {
        // Returning user on a fresh device: pull cloud data down
        await pullFromCloud({ mergeUserId: userId, markMergedFor: userId });
      } else {
        // Both local and cloud have non-default data: ask the user
        const choice = await showMergeDialog();
        if (choice === "local") {
          // "Keep local" overwrites the cloud user_settings row, but the
          // concentrate specs in it are named artifacts (Category B), not
          // preferences: fold the cloud's into local first so choosing
          // "local" can't erase concentrates saved on another device.
          await foldCloudConcentratesIntoLocal(userId);
          await pushAllToCloud({ allowBeforeMerge: true, mergeUserId: userId });
        } else {
          await pullFromCloud({ mergeUserId: userId, markMergedFor: userId });
        }
      }
    }

    // Only mark this device merged for the user it merged for. A sign-out or
    // account switch mid-merge (null included: sign-out clears local data, and
    // a stale marker would let the next sign-in push that empty state) leaves
    // the marker unset so the next load re-runs the merge.
    if ((await getLoggedInUserId()) !== userId) {
      throw new Error("[sync] merge aborted: the signed-in user changed during the merge");
    }
    safeSetItem(KEYS.SYNCED_USER_ID, userId);
    // Saves made while the merge was running were held back by the merge gate
    // (and the merge's pull kept them locally); push them now.
    if (mergeGateRefusedPush || hasUnpushedChanges()) {
      mergeGateRefusedPush = false;
      syncNow();
    }
    // Catch up on realtime changes that arrived while the merge was pending.
    if (realtimePullDeferred) {
      realtimePullDeferred = false;
      scheduleRealtimePull();
    }
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
        if (pendingSubscriptions > 0) {
          pendingSubscriptions -= 1;
          if (pendingSubscriptions === 0) {
            // Every channel is healthy now — only here is it safe to reset the
            // backoff. Resetting on the FIRST channel's SUBSCRIBED would let a
            // healthy channel keep zeroing attempts while the other keeps
            // failing, defeating the backoff and causing reconnect churn. This
            // runs on reconnects too (a fresh subscribeToCloudChanges resets
            // pendingSubscriptions), independent of realtimeSubscribedResolve
            // which is consumed once on the first subscribe.
            realtimeReconnectAttempts = 0;
            if (realtimeSubscribedResolve) {
              realtimeSubscribedResolve();
              realtimeSubscribedResolve = undefined;
            }
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
  // Reset backoff so stale attempt state from this session doesn't carry into a
  // later sign-in (which would start the first failure at a long delay).
  realtimeReconnectAttempts = 0;
  if (realtimeChannels.length === 0) return;
  realtimeChannels.forEach(function (channel) {
    try {
      if (window.supabaseClient && typeof window.supabaseClient.removeChannel === "function") {
        window.supabaseClient.removeChannel(channel);
      }
    } catch (err) {
      reportError("sync.remove-channel", err);
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
// as initSync's push-then-pull ordering). Pulls are serialized via
// enqueueSerialized so a second realtime event arriving while a pull is
// in flight can't start a concurrent pull.
//
// Until this device has completed the first-login merge for the subscribed
// user, a realtime pull is deferred instead: its push-first step is a no-op
// behind the merge gate, so the pull would overwrite unmerged local data
// with cloud state (initSync subscribes even when the merge failed). The
// merge re-arms one catch-up pull once it succeeds.
let realtimePullDeferred = false;

export function realtimePullBlockedByMerge(
  subscribedUserId: string | null,
  syncedUserId: string | null,
): boolean {
  return !subscribedUserId || syncedUserId !== subscribedUserId;
}

function scheduleRealtimePull(): void {
  clearTimeout(pullDebounceTimer);
  pullDebounceTimer = setTimeout(function () {
    pullDebounceTimer = undefined;
    enqueueSerialized(function () {
      const gatedUserId = realtimeUserId;
      if (
        !gatedUserId ||
        realtimePullBlockedByMerge(gatedUserId, safeGetItem(KEYS.SYNCED_USER_ID))
      ) {
        realtimePullDeferred = true;
        return Promise.resolve();
      }
      // Push anything this device hasn't synced yet: a pending debounced save,
      // or an earlier push that failed (offline, a blip). Gating this on the
      // debounce timer alone skipped the second case. The pull below merges,
      // so it keeps unpushed local edits even if this push fails too.
      const pendingPush = syncTimer || hasUnpushedChanges() ? syncNow() : Promise.resolve();
      return Promise.resolve(pendingPush)
        .then(function () {
          return pullFromCloud({ skipIfLocalWriteDuringPull: true, expectedUserId: gatedUserId });
        })
        .then(function (applied) {
          // Discarded rows were never written, so nothing changed locally;
          // the deferred flag set by pullFromCloud drives the catch-up.
          if (applied === "discarded") return;
          if (applied === false) {
            // pullFromCloud bailed because a local write landed mid-pull. Re-arm
            // so the remote change still lands once that write has been pushed
            // (the debounce throttles this, and the push-first step above sends
            // the local write up before the retry reads cloud again).
            scheduleRealtimePull();
            return;
          }
          if (typeof window.dispatchEvent === "function") {
            window.dispatchEvent(new CustomEvent("cw:cloud-data-changed"));
          }
        })
        .catch(function (err) {
          reportError("sync.realtime-pull", err);
        });
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
    if (safeGetItem(KEYS.SYNCED_USER_ID) !== userId) {
      // This device hasn't completed the first-login merge for this user:
      // a fresh device, or a sign-in on login.html whose merge was cut off by
      // the redirect to index.html. A blind push here would overwrite the
      // cloud user_settings row (concentrate specs included) with this
      // device's empty local state, so run the guarded merge instead. The
      // SIGNED_IN handler may start it too; mergeInFlight dedupes the two.
      await handleFirstLoginMerge();
    } else {
      await pushAllToCloud();
      await pullFromCloud();
    }
    if (typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent("cw:cloud-data-changed"));
    }
  } catch (err) {
    reportError("sync.init", err);
  } finally {
    // Bind Realtime even if the initial push/pull failed so a transient
    // network blip doesn't leave the tab without cloud updates for the
    // rest of the session.
    if (userId) subscribeToCloudChanges(userId);
  }
}

// --- Flush pending sync when navigating away ---
// Resolves once everything this device hasn't synced is in the cloud, and
// rejects if that can't be confirmed. Logout awaits this before signing out
// and clearing local data; if it rejects the caller MUST NOT wipe without the
// user's say-so. Background callers (visibilitychange, pagehide) ignore the
// rejection.
//
// It waits for a push that is already in flight (pushes are serialized), then
// pushes whenever anything is still unsynced — not only when a debounced save
// is pending. An earlier push that failed, or one that silently no-oped while
// offline, used to leave edits that a logout then wiped.
export async function flushPendingSync(): Promise<void> {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = undefined;
  }
  await pushQueue;
  if (!hasUnpushedChanges()) return;
  await pushAllToCloud();
  // A push that was refused or couldn't reach the account leaves the changes
  // unsynced; say so rather than letting the caller wipe them.
  if (hasUnpushedChanges()) {
    throw new Error("[sync] some changes could not be synced to the cloud");
  }
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
    reportError("sync.flush", err);
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
//
// auth-js emits SIGNED_IN not only on a real sign-in but on every page-load
// session recovery, tab refocus, and some token refreshes (GoTrueClient
// _recoverAndRefresh), so the handler must decide when handleFirstLoginMerge is
// actually needed vs. redundant. `wasLoggedInAtLoad` captures whether a session
// already existed when the page loaded — i.e. whether initSync is doing this
// load's push+pull. It's read synchronously from the auth cache supabase-client
// primes (legacy-globals.ts evaluates supabase-client before this module); a
// synchronous read is required because on a logged-in load auth-js emits
// SIGNED_IN BEFORE INITIAL_SESSION.
const wasLoggedInAtLoad = !!(typeof window !== "undefined" && window._cachedAuthUserId);
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
      // discarding it when the storage namespace flips to localStorage. This
      // and the (idempotent) subscribe run on every SIGNED_IN, including
      // recovery re-fires, so Realtime stays bound regardless.
      // A sign-in as a different account than this device last synced must
      // not carry that account's local data along (see
      // clearLocalDataIfAccountChanged); clear it before anything migrates.
      clearLocalDataIfAccountChanged(session.user.id);
      migrateAnonTransientToLocal();
      subscribeToCloudChanges(session.user.id);
      // Skip the first-login merge ONLY when it would be pure redundant work:
      // the user was already signed in at load (initSync owns this load's
      // push+pull) AND the merge has already completed for this user on this
      // device. SYNCED_USER_ID === uid is exactly that "completed" signal —
      // handleFirstLoginMerge sets it only after a successful merge, and its
      // repeat-login fast path is then just another pullFromCloud, which here
      // would race initSync's push-before-pull ordering (the stale-cloud-
      // clobbers-fresh-local shape behind 9f89a2e).
      //
      // Otherwise run it. A modal/login sign-in (logged out at load, so initSync
      // bailed) needs the merge to surface the user's cloud data. And a device
      // whose merge has NOT completed — a fresh device, or one whose first
      // attempt failed before setting SYNCED_USER_ID (e.g. a transient network
      // error) — must keep retrying the guarded merge. (initSync routes an
      // unmerged device into the same merge, and pushAllToCloud refuses to
      // push before it completes, so local defaults can't be pushed over the
      // user's cloud settings in the meantime.) Gating on "session exists"
      // instead would suppress that retry.
      const mergeAlreadyDone = safeGetItem(KEYS.SYNCED_USER_ID) === session.user.id;
      if (wasLoggedInAtLoad && mergeAlreadyDone) return;
      handleFirstLoginMerge()
        .then(function () {
          if (typeof window.dispatchEvent === "function") {
            window.dispatchEvent(new CustomEvent("cw:cloud-data-changed"));
          }
        })
        .catch(function (err) {
          reportError("sync.first-login-merge", err);
        });
    }
  });
}

// --- Window publishing (browser + tests) ---
// In the browser the legacy-globals.ts bridge module also copies these onto
// window via Object.assign, but the explicit assignments below mean tests
// (tests/sync.test.ts) — which `require()` this file without loading the bridge —
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
