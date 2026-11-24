import { THEME_KEY, MINERAL_DB } from "./constants";
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
import { showMergeDialog, summarizeMerge } from "./merge-dialog";
import type { MergeItem, MergeSummary } from "./merge-dialog";

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
        dispatchSaveStatus("saved");
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
      dispatchSaveStatus("saved");
    })
    .catch(function (err) {
      reportError("sync.push-immediate", err);
      dispatchSaveStatus("error", err);
    });
}

// --- Get currently logged-in user ID ---
// lookupUserId tells "signed out" (resolves null) apart from "couldn't find
// out" (throws: offline, a network blip, a server error). Only logout's flush
// needs the difference; everything else goes through getLoggedInUserId, which
// treats both as null, as it always has.
async function lookupUserId(): Promise<string | null> {
  const result = await window.supabaseClient.auth.getUser();
  const user = result && result.data && result.data.user;
  if (user) return user.id;
  const error = result && result.error;
  if (!error || (error as { name?: string }).name === "AuthSessionMissingError") return null;
  throw error;
}

async function getLoggedInUserId(): Promise<string | null> {
  try {
    return await lookupUserId();
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

// --- Merged push of user_settings and user_selections ---
//
// Each of these is one row per user, written by every device and by the
// database functions a connected AI app calls (MCP.md). A push used to upsert
// the whole row from localStorage, so a device that had not pulled since
// someone else's write put its old copy of every field back: a concentrate
// saved by an AI app vanished, or a switch it made flipped back, the next
// time that device changed a brew volume.
//
// A push now sends only what this device changed:
//
//   1. changesSince(base, local) names what differs from the base, the
//      snapshot of the row this device last synced (LAST_PUSHED_*): whole
//      fields, and inside maps and lists the keys and items. One map goes a
//      level further (NESTED_MAPS): the unsaved target edits inside drafts
//      are named per recipe.
//   2. The row is read, and applyChanges puts those changes onto it. Whatever
//      this device did not change keeps the cloud's value.
//   3. The result is written on condition that the row's updated_at is still
//      the one that was read. If someone wrote in between, it reads again.
//
// The names from step 1 are saved (PENDING_PUSH_*) before anything is sent
// and removed when the write succeeds (or when a pull refreshes the row's
// base: the device then holds what the account holds). If the answer never
// arrives (the connection drops, the page is left, the app is suspended)
// they stay, and the next push counts them as changed whatever the base
// says. Without that, a setting sent, never confirmed and then put back would
// look untouched, and the value that was sent would stay in the account.
//
// Pushes run one at a time (inPushQueue): step 1 is only right if the base is
// the last thing this device got into the row.
//
// What is deliberately the same as before:
//   - The base is what this device held when it last pushed or pulled, never
//     the merged row. A base holding values local storage doesn't would make
//     the next push read them as local changes and revert them.
//   - The delete lists (deleted_source_presets, deleted_target_presets) go
//     out whole, as this device holds them, with any change to the row.
//     Installed apps rely on that overwrite; merging the lists is what made
//     the closed three-way-merge change (#238) worse than old apps alone
//     (tests/sync-mixed-version.test.ts pins the sequences).
//   - Three pushes still upsert the whole row: the first-login merge's own, a
//     device with no readable base, and a row that does not exist yet.
//   - Pulls still replace local values with the row's.
//
// Limits this accepts. Each is what a whole-row push did too, or rarer:
//   - Installed apps at 1.2.x keep overwriting whole rows.
//   - A write that is still on its way when a later push succeeds can land
//     after it.
//   - Two tabs each have their own queue, and share the base and the saved
//     names. Overlapping pushes from two tabs can leave the device marked
//     unsynced when it is not, or lose the protection of the saved names.
//   - A request the browser never settles holds up later pushes on that page.
export type PushFieldKind = "scalar" | "set" | "dict" | "whole";

// "scalar": one value. "set": a list where each item is there or not. "dict":
// a map merged key by key. "whole": sent as this device holds it whenever the
// row has any change (the delete lists). A payload field not listed here is
// treated as "whole", so a field added to a payload later is never dropped.
export const SETTINGS_PUSH_KINDS: Record<string, PushFieldKind> = {
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

// Maps that sit inside a "dict" field and are merged key by key themselves,
// listed as field -> the keys that hold such a map. There is one:
// drafts.target_draft_ions holds the unsaved target edits, one entry per
// recipe, so two devices editing different recipes each send only their own
// recipe's edit instead of the whole map. The recipes a device changed are
// named in RowChanges.keys under "<field>.<key>" ("drafts.target_draft_ions").
const NESTED_MAPS: Record<string, string[]> = { drafts: ["target_draft_ions"] };

function nestedMaps(field: string): string[] {
  return (ownValue(NESTED_MAPS, field) as string[] | undefined) || [];
}

export const SELECTIONS_PUSH_KINDS: Record<string, PushFieldKind> = {
  source_preset: "scalar",
  source_water: "scalar",
  target_preset: "scalar",
  deleted_source_presets: "whole",
  deleted_target_presets: "whole",
  added_target_presets: "set",
};

// Fields that only make sense together: the active source water's key and the
// Starting Water values it stands for. If this device changed either, both are
// its own; otherwise both come from the cloud.
export const SELECTIONS_PUSH_GROUPS: string[][] = [["source_preset", "source_water"]];

const PUSH_ROW_SKIP_FIELDS = ["user_id", "updated_at"];
const PUSH_MAX_ATTEMPTS = 3;

// What a device changed in a row: fields changed as a whole, and inside maps
// and lists the keys and items added, edited or removed. `keys` is by field
// name, or by "<field>.<key>" for a map inside a map (NESTED_MAPS).
export type RowChanges = {
  fields: string[];
  keys: Record<string, string[]>;
  items: Record<string, unknown[]>;
};

function sameValue(a: unknown, b: unknown): boolean {
  return (
    stableStringify(a === undefined ? null : a) === stableStringify(b === undefined ? null : b)
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function ownValue(obj: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

function listHas(list: unknown[], x: unknown): boolean {
  return list.some(function (y) {
    return sameValue(x, y);
  });
}

// The keys whose values differ between two maps, a key in only one included.
function changedKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  return Object.keys(Object.assign({}, a, b)).filter(function (k) {
    return !sameValue(ownValue(a, k), ownValue(b, k));
  });
}

// What `local` changes relative to `base`. Pure; exported for unit tests.
export function changesSince(
  kinds: Record<string, PushFieldKind>,
  base: Record<string, unknown>,
  local: Record<string, unknown>,
): RowChanges {
  const out: RowChanges = { fields: [], keys: {}, items: {} };
  Object.keys(local).forEach(function (field) {
    const kind = ownValue(kinds, field);
    if (!kind || kind === "whole" || PUSH_ROW_SKIP_FIELDS.indexOf(field) !== -1) return;
    const l = local[field];
    const b = ownValue(base, field);
    // A field the base has never held is this device's as a whole.
    if (b === undefined) {
      out.fields.push(field);
    } else if (sameValue(l, b)) {
      return;
    } else if (kind === "dict" && isPlainObject(l) && isPlainObject(b)) {
      const own: string[] = [];
      changedKeys(b, l).forEach(function (k) {
        const lk = ownValue(l, k);
        const bk = ownValue(b, k);
        // A map inside this one: name what changed inside it. A base that
        // has never held it counts as empty, so a first edit names its
        // recipe rather than the whole map.
        if (
          nestedMaps(field).indexOf(k) !== -1 &&
          isPlainObject(lk) &&
          (bk === undefined || isPlainObject(bk))
        ) {
          const inner = changedKeys(bk || {}, lk);
          if (inner.length > 0) out.keys[field + "." + k] = inner;
        } else {
          own.push(k);
        }
      });
      if (own.length > 0) out.keys[field] = own;
    } else if (kind === "set" && Array.isArray(l) && Array.isArray(b)) {
      const moved = l
        .filter(function (x) {
          return !listHas(b, x);
        })
        .concat(
          b.filter(function (x) {
            return !listHas(l, x);
          }),
        );
      // Same members in another order: the whole list is the change. This
      // happens when an item is switched off and on again between pushes (it
      // moves to the end), and the list then goes out as this device holds
      // it, as a whole-row push sent it. Treating it as no change was tried:
      // it keeps what another device added meanwhile, but loses this device's
      // switch-on to another device's removal, and lost more in the
      // mixed-version runs than it saved.
      if (moved.length > 0) out.items[field] = moved;
      else out.fields.push(field);
    } else {
      out.fields.push(field);
    }
  });
  return out;
}

// Everything any of them names. Pure; exported for unit tests.
export function combineChanges(list: RowChanges[]): RowChanges {
  const out: RowChanges = { fields: [], keys: {}, items: {} };
  list.forEach(function (changes) {
    changes.fields.forEach(function (f) {
      if (out.fields.indexOf(f) === -1) out.fields.push(f);
    });
    Object.keys(changes.keys).forEach(function (f) {
      const into = out.keys[f] || (out.keys[f] = []);
      (changes.keys[f] || []).forEach(function (k) {
        if (into.indexOf(k) === -1) into.push(k);
      });
    });
    Object.keys(changes.items).forEach(function (f) {
      const into = out.items[f] || (out.items[f] = []);
      (changes.items[f] || []).forEach(function (x) {
        if (!listHas(into, x)) into.push(x);
      });
    });
  });
  return out;
}

function hasChanges(changes: RowChanges): boolean {
  return (
    changes.fields.length > 0 ||
    Object.keys(changes.keys).length > 0 ||
    Object.keys(changes.items).length > 0
  );
}

// The cloud's list with this device's additions and removals applied. This
// device's order first, then what the cloud added.
function applyItems(local: unknown, cloud: unknown, items: unknown[]): unknown[] {
  const L = Array.isArray(local) ? local : [];
  if (!Array.isArray(cloud)) return L.slice();
  return L.filter(function (x) {
    return listHas(items, x) || listHas(cloud, x);
  }).concat(
    cloud.filter(function (x) {
      return !listHas(L, x) && !listHas(items, x);
    }),
  );
}

// The cloud's map with the keys this device added, edited or removed applied.
//
// Known trade-off, pinned in tests/sync-push-merge.test.ts: a key this device
// holds unchanged but the cloud no longer has is NOT sent back. Usually that
// is right (it was deleted on another device, and a whole-row push used to
// bring it back). But the same absence is what an installed 1.2.x app leaves
// when it overwrites the row with a copy that never held the key, and a
// whole-row push from this device would have restored it. Sending such keys
// back was tried and rejected: it brings back more deleted items than 1.2
// devices alone do (tests/sync-mixed-version.test.ts, 10 against 9), which is
// the bar that test holds every change to.
function applyKeys(local: unknown, cloud: unknown, keys: string[]): Record<string, unknown> {
  const L = isPlainObject(local) ? local : {};
  if (!isPlainObject(cloud)) return Object.assign({}, L);
  const out: Record<string, unknown> = Object.assign({}, cloud);
  keys.forEach(function (k) {
    const v = ownValue(L, k);
    if (v === undefined) delete out[k];
    else out[k] = v;
  });
  return out;
}

// The row to write: `cloud` with this device's `changes` applied, taking the
// changed values from `local` (a buildSettingsPayload / buildSelectionsPayload
// result). `rowChanged` says whether `local` differs from the base at all; if
// it does, the "whole" fields go out as this device holds them. user_id and
// updated_at are left to the caller. Pure; exported for unit tests.
export function applyChanges(
  kinds: Record<string, PushFieldKind>,
  groups: string[][],
  cloud: Record<string, unknown>,
  local: Record<string, unknown>,
  changes: RowChanges,
  rowChanged: boolean,
): Record<string, unknown> {
  const whole = function (field: string): boolean {
    return changes.fields.indexOf(field) !== -1;
  };
  const keys = function (field: string): string[] {
    return (ownValue(changes.keys, field) as string[] | undefined) || [];
  };
  const items = function (field: string): unknown[] {
    return (ownValue(changes.items, field) as unknown[] | undefined) || [];
  };
  const touched = function (field: string): boolean {
    return (
      whole(field) ||
      keys(field).length > 0 ||
      items(field).length > 0 ||
      nestedMaps(field).some(function (k) {
        return keys(field + "." + k).length > 0;
      })
    );
  };
  const out: Record<string, unknown> = {};
  Object.keys(local).forEach(function (field) {
    if (PUSH_ROW_SKIP_FIELDS.indexOf(field) !== -1) return;
    const l = local[field];
    const c = ownValue(cloud, field);
    const kind = (ownValue(kinds, field) as PushFieldKind | undefined) || "whole";
    const group = groups.filter(function (g) {
      return g.indexOf(field) !== -1;
    })[0];
    if (c === undefined || c === null) {
      // Nothing in the cloud to keep.
      out[field] = l;
    } else if (kind === "whole") {
      out[field] = rowChanged ? l : c;
    } else if (group) {
      out[field] = group.some(touched) ? l : c;
    } else if (!touched(field)) {
      out[field] = c;
    } else if (whole(field)) {
      out[field] = l;
    } else if (kind === "set") {
      out[field] = applyItems(l, c, items(field));
    } else {
      const merged = applyKeys(l, c, keys(field));
      // A map inside this one: the same again, one level down. Not if the
      // device changed it as a whole: it is then named in keys(field), and
      // applyKeys has already taken this device's copy.
      const mine = isPlainObject(l) ? l : {};
      nestedMaps(field).forEach(function (k) {
        const inner = keys(field + "." + k);
        if (inner.length === 0 || keys(field).indexOf(k) !== -1) return;
        merged[k] = applyKeys(ownValue(mine, k), ownValue(merged, k), inner);
      });
      out[field] = merged;
    }
  });
  return out;
}

// One push at a time, per page. changesSince is only right if the base is the
// last thing this device got into the row, and two pushes overlapping break
// that: the later one's base is a push behind, so a setting changed and
// changed back looks untouched and the earlier value wins.
//
// A push waits for the one before it until its requests have settled, however
// long that takes. Giving up on a slow request and letting the queue move on
// was tried and removed: giving up cannot cancel the request.
let pushQueue: Promise<unknown> = Promise.resolve();

function inPushQueue<T>(task: () => Promise<T>): Promise<T> {
  const next = pushQueue.then(task, task);
  pushQueue = next.then(
    function () {},
    function () {},
  );
  return next;
}

function parsePushBase(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

// The changes a push sent and has not seen confirmed, or null.
function readPendingChanges(key: string): RowChanges | null {
  const parsed = safeParse(safeGetItem(key), null);
  if (!isPlainObject(parsed)) return null;
  const lists = function (v: unknown): Record<string, unknown[]> {
    const out: Record<string, unknown[]> = {};
    if (isPlainObject(v)) {
      Object.keys(v).forEach(function (k) {
        if (Array.isArray(v[k])) out[k] = v[k] as unknown[];
      });
    }
    return out;
  };
  const changes: RowChanges = {
    fields: Array.isArray(parsed.fields) ? (parsed.fields as string[]) : [],
    keys: lists(parsed.keys) as Record<string, string[]>,
    items: lists(parsed.items),
  };
  return hasChanges(changes) ? changes : null;
}

type SingleRow = {
  table: "user_settings" | "user_selections";
  baseKey: string;
  pendingKey: string;
  kinds: Record<string, PushFieldKind>;
  groups: string[][];
  // This row's part of the active choice (see pushSingleRows).
  activeChoice: (local: Record<string, unknown>) => RowChanges;
  build: (userId: string, now: string) => Record<string, unknown>;
};

const SINGLE_ROWS: SingleRow[] = [
  {
    table: "user_settings",
    baseKey: LAST_PUSHED_SETTINGS_KEY,
    pendingKey: KEYS.PENDING_PUSH_SETTINGS,
    kinds: SETTINGS_PUSH_KINDS,
    groups: [],
    activeChoice: function () {
      return { fields: ["brew_method"], keys: {}, items: {} };
    },
    build: buildSettingsPayload,
  },
  {
    table: "user_selections",
    baseKey: LAST_PUSHED_SELECTIONS_KEY,
    pendingKey: KEYS.PENDING_PUSH_SELECTIONS,
    kinds: SELECTIONS_PUSH_KINDS,
    groups: SELECTIONS_PUSH_GROUPS,
    // The recipe, and its place on the rail if it has one: a library recipe
    // is only shown while it is on the rail, so the device that chose it
    // keeps it there even if another device has taken it off meanwhile.
    activeChoice: function (local) {
      const recipe = local.target_preset;
      const rail = local.added_target_presets;
      const items: Record<string, unknown[]> = {};
      if (Array.isArray(rail) && rail.indexOf(recipe) !== -1) items.added_target_presets = [recipe];
      return { fields: ["target_preset"], keys: {}, items: items };
    },
    build: buildSelectionsPayload,
  },
];

// Read the row, apply this device's changes to it, and write on condition
// that the row is still the one that was read (its updated_at is unchanged;
// every writer, the database functions included, sets updated_at). If the row
// changed in between, nothing is written and it reads again.
async function writeMerged(
  row: SingleRow,
  userId: string,
  local: Record<string, unknown>,
  changes: RowChanges,
  rowChanged: boolean,
): Promise<{ error: unknown }> {
  const client = window.supabaseClient;
  for (let attempt = 0; attempt < PUSH_MAX_ATTEMPTS; attempt++) {
    const read = await client.from(row.table).select("*").eq("user_id", userId).maybeSingle();
    if (read && read.error) return { error: read.error };
    const cloud: Record<string, unknown> | null =
      read && isPlainObject(read.data) ? read.data : null;
    // No row yet: nothing to merge with.
    if (!cloud) return client.from(row.table).upsert(local, { onConflict: "user_id" });

    const payload = applyChanges(row.kinds, row.groups, cloud, local, changes, rowChanged);
    // A row with no change of its own (it is here for a pending change, or
    // for its half of the active choice) is written only if that changes
    // something. A row that did change is always written, as before.
    if (
      !rowChanged &&
      Object.keys(payload).every(function (field) {
        return sameValue(payload[field], ownValue(cloud, field));
      })
    ) {
      return { error: null };
    }
    payload.updated_at = local.updated_at;
    let write = client.from(row.table).update(payload).eq("user_id", userId);
    write =
      cloud.updated_at === null || cloud.updated_at === undefined
        ? write.is("updated_at", null)
        : write.eq("updated_at", cloud.updated_at);
    const written = await write.select("user_id");
    if (written && written.error) return { error: written.error };
    if (written && Array.isArray(written.data) && written.data.length > 0) return { error: null };
  }
  return {
    error: new Error("[sync] " + row.table + " kept changing while it was being saved"),
  };
}

// Push both rows, in the queue. Each row's payload is built from local
// storage when this push's turn comes, and each row records its own snapshot
// when its own write succeeds, whatever happens to the other.
//
// `merge` false is the first-login merge's own push, which sends the rows
// whole (its "new account" / "Keep both" branches).
function pushSingleRows(
  userId: string,
  merge: boolean,
): Promise<Array<{ table: string; error: unknown }>> {
  return inPushQueue(async function () {
    // This push may have waited behind another. If the device signed out or
    // changed account meanwhile, local storage is no longer this user's.
    if (merge && safeGetItem(KEYS.SYNCED_USER_ID) !== userId) {
      const error = new Error("[sync] the signed-in account changed before the save went out");
      return SINGLE_ROWS.map(function (row) {
        return { table: row.table, error: error };
      });
    }
    const now = new Date().toISOString();
    const built = SINGLE_ROWS.map(function (row) {
      const local = row.build(userId, now);
      const baseText = safeGetItem(row.baseKey);
      return {
        row: row,
        local: local,
        snapshot: snapshotForCompare(local),
        baseText: baseText,
        base: merge ? parsePushBase(baseText) : null,
      };
    });
    // The active recipe (user_selections.target_preset) and the brew method
    // (user_settings.brew_method) live in different rows but are one choice:
    // the app shows a recipe only under its own brew method, and falls back
    // to another recipe when the two disagree. So if this device changed
    // either, both go out as it holds them; otherwise both stay the cloud's.
    // They are still two requests, so another writer can land between them.
    //
    // A row with no base is no evidence of a change here: it goes out whole
    // for its own reasons and does not pull the other row along.
    const activeChoiceChanged =
      merge &&
      built.some(function (b) {
        const base = b.base;
        return (
          !!base &&
          b.row.activeChoice(b.local).fields.some(function (field) {
            return !sameValue(b.local[field], ownValue(base, field));
          })
        );
      });

    return Promise.all(
      built.map(async function (b) {
        const row = b.row;
        const pending = readPendingChanges(row.pendingKey);
        const rowChanged = b.snapshot !== b.baseText;
        // Skip the write when the payload hasn't changed since our last
        // successful push to that table. This is the storm-prevention path:
        // every page-load initSync.push would otherwise rewrite the row, fire
        // a postgres_changes broadcast that arrives back at our own channel,
        // and trigger a redundant pullFromCloud, which can race a local write
        // that happened in the same tick (replication lag may return the
        // stale value). Not skipped while an earlier send is unconfirmed, or
        // when this row's half of the active choice has to go with the
        // other's.
        if (!rowChanged && !pending && !activeChoiceChanged) {
          return { table: row.table, error: null };
        }

        let result: { error: unknown };
        if (!b.base) {
          result = await window.supabaseClient
            .from(row.table)
            .upsert(b.local, { onConflict: "user_id" });
        } else {
          const changes = combineChanges(
            [
              pending || { fields: [], keys: {}, items: {} },
              changesSince(row.kinds, b.base, b.local),
            ].concat(activeChoiceChanged ? [row.activeChoice(b.local)] : []),
          );
          // Saved before anything is sent, removed only on success. That is
          // before this row's read too, not just before its write: both rows
          // start here in one step, and when the two halves of the active
          // choice go out, each must be saved before either request, so that
          // one row saving and the other failing leaves the other half owed.
          if (hasChanges(changes)) safeSetItem(row.pendingKey, JSON.stringify(changes));
          result = await writeMerged(row, userId, b.local, changes, rowChanged);
        }
        if (result && result.error) return { table: row.table, error: result.error };
        // The requests took time. If the device signed out or changed account
        // meanwhile, local storage was wiped and is not this push's to write.
        // (The first-login merge's push runs before the device is marked as
        // merged, so it goes by the signed-in user instead.)
        const stillThisUser = merge
          ? safeGetItem(KEYS.SYNCED_USER_ID) === userId
          : window._cachedAuthUserId === userId;
        if (stillThisUser) {
          safeSetItem(row.baseKey, b.snapshot);
          safeRemoveItem(row.pendingKey);
        }
        return { table: row.table, error: null };
      }),
    );
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
// mustSync (logout's flush): the caller is about to wipe this device, so a
// push that didn't happen must not look like one that did. Every early return
// below (no user, a failed lookup, the merge gate) throws instead.
export async function pushAllToCloud(options?: {
  allowBeforeMerge?: boolean;
  mergeUserId?: string;
  mustSync?: boolean;
}): Promise<void> {
  const mustSync = !!(options && options.mustSync);
  let userId: string | null;
  if (mustSync) {
    try {
      userId = await lookupUserId();
    } catch (err) {
      throw new Error("[sync] not synced: could not reach the account", { cause: err });
    }
    if (!userId) throw new Error("[sync] not synced: no signed-in user");
  } else {
    userId = await getLoggedInUserId();
  }
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
    if (mustSync) {
      throw new Error("[sync] not synced: this device hasn't finished merging with the account");
    }
    return;
  }

  const now = new Date().toISOString();

  // The first-login merge's own push sends this device's rows whole: it is the
  // "new account" / "Keep both" choice, with its own fold of the cloud's
  // concentrates. Every other push merges (see pushSingleRows).
  const results = await pushSingleRows(userId, !(options && options.allowBeforeMerge));
  const pushErrors: unknown[] = [];
  results.forEach(function (r) {
    if (!r.error) return;
    reportError("sync.upsert", r.error, { table: r.table });
    pushErrors.push(r.error);
  });
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
        reportError("sync.tombstone-delete", srcDel.error);
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
        reportError("sync.tombstone-delete", tgtDel.error);
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

// A cloud source_profiles row as the local profile entry pullFromCloud stores.
function sourceRowToProfile(row: any) {
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
}

// A cloud target_profiles row as the local profile entry pullFromCloud stores.
function targetRowToProfile(row: any): TargetProfile {
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
  const userId = await getLoggedInUserId();
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
  if (mergeUserId && (await getLoggedInUserId()) !== mergeUserId) {
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

  // Does this device hold changes to a single row that it has not pushed?
  // Only an unguarded pull can get here in that state (realtime pulls push
  // first, and bail out above if a save lands mid-pull): a save that landed
  // while a page-load pull was fetching, or one whose push is still out. The
  // apply below overwrites most of such a change, but not all of it: a volume
  // or draft key the cloud lacks, or a field the cloud holds empty, survives.
  // Refreshing the base from local afterwards would record the survivor as
  // synced, and since a push sends only what differs from the base, it would
  // never be uploaded. So such a row keeps the base it had (see the refresh
  // at the end). A device with no readable base is not in that state: its
  // pull adopts the account's rows and must not leave anything to push.
  const holdsUnpushed = function (baseKey: string, local: Record<string, unknown>): boolean {
    const raw = safeGetItem(baseKey);
    return parsePushBase(raw) !== null && snapshotForCompare(local) !== raw;
  };
  const settingsHeldUnpushed = holdsUnpushed(
    LAST_PUSHED_SETTINGS_KEY,
    buildSettingsPayload(sessionUserId, ""),
  );
  const selectionsHeldUnpushed = holdsUnpushed(
    LAST_PUSHED_SELECTIONS_KEY,
    buildSelectionsPayload(sessionUserId, ""),
  );

  // Apply user_settings
  if (settings) {
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
    // Drafts: restore each known key only if present. An empty/missing
    // drafts blob shouldn't blow away the user's local in-progress edits —
    // their local draft is the more recent write in that case.
    if (settings.drafts && typeof settings.drafts === "object") {
      const drafts = settings.drafts;
      if (drafts.recipe_mineral_inputs && typeof drafts.recipe_mineral_inputs === "object")
        safeSetItem(KEYS.RECIPE_MINERAL_INPUTS, JSON.stringify(drafts.recipe_mineral_inputs));
      if (drafts.recipe_concentrate_inputs && typeof drafts.recipe_concentrate_inputs === "object")
        safeSetItem(
          KEYS.RECIPE_CONCENTRATE_INPUTS,
          JSON.stringify(drafts.recipe_concentrate_inputs),
        );
      if (drafts.recipe_stock_grams && typeof drafts.recipe_stock_grams === "object")
        safeSetItem(KEYS.RECIPE_STOCK_GRAMS, JSON.stringify(drafts.recipe_stock_grams));
      if (drafts.recipe_dispense_mode === "manual" || drafts.recipe_dispense_mode === "stock")
        safeSetItem(KEYS.RECIPE_DISPENSE_MODE, drafts.recipe_dispense_mode);
      if (drafts.target_draft_ions && typeof drafts.target_draft_ions === "object")
        safeSetItem(KEYS.TARGET_DRAFT_IONS, JSON.stringify(drafts.target_draft_ions));
    }
  }

  // Apply user_selections
  if (selections) {
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
      const profile = sourceRowToProfile(row);
      srcProfiles[row.slug] = profile;
      // Refresh lastPushed snapshot for dirty-tracking — we just learned
      // what cloud has, so a follow-up push of the same data is a no-op
      // and should be skipped.
      newSourceSnapshots[row.slug] = stableStringify(
        buildSourceRow(sessionUserId, row.slug, profile),
      );
    });
    safeSetItem(KEYS.CUSTOM_PROFILES, JSON.stringify(srcProfiles));
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
      const profile = targetRowToProfile(row);
      tgtProfiles[row.slug] = profile;
      newTargetSnapshots[row.slug] = stableStringify(
        buildTargetRow(sessionUserId, row.slug, profile),
      );
    });
    safeSetItem(KEYS.CUSTOM_TARGET_PROFILES, JSON.stringify(tgtProfiles));
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
  //
  // A row this device held unpushed changes to when the pull applied
  // (settingsHeldUnpushed / selectionsHeldUnpushed above) keeps the base it
  // had. The next push then sends everything that differs from that base:
  // whatever of the device's own change survived the apply, and also what
  // the pull just brought in, as a whole-row push would have.
  //
  // A row whose base is refreshed has nothing pending either: the device now
  // holds what the account holds. Names left over from a push that was never
  // confirmed would otherwise send those pulled values again, over whatever
  // another device sets next.
  if (settings && !settingsHeldUnpushed) {
    safeSetItem(
      LAST_PUSHED_SETTINGS_KEY,
      snapshotForCompare(buildSettingsPayload(sessionUserId, "")),
    );
    safeRemoveItem(KEYS.PENDING_PUSH_SETTINGS);
  }
  if (selections && !selectionsHeldUnpushed) {
    safeSetItem(
      LAST_PUSHED_SELECTIONS_KEY,
      snapshotForCompare(buildSelectionsPayload(sessionUserId, "")),
    );
    safeRemoveItem(KEYS.PENDING_PUSH_SELECTIONS);
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

// --- What the merge dialog shows: how this device and the account differ ---
function profileItems(
  profiles: Record<string, any>,
  build: (slug: string, p: any) => unknown,
): MergeItem[] {
  return Object.keys(profiles).map(function (slug) {
    const p = profiles[slug] || {};
    return { key: slug, name: p.label || slug, fingerprint: stableStringify(build(slug, p)) };
  });
}

function concentrateItems(diy: unknown, stock: unknown): MergeItem[] {
  const items: MergeItem[] = [];
  const asDict = function (v: unknown): Record<string, any> {
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};
  };
  const diySpecs = asDict(diy);
  Object.keys(diySpecs).forEach(function (id) {
    const mineral = MINERAL_DB[id.replace(/^diy:/, "")];
    items.push({
      key: "diy:" + id,
      name: mineral ? mineral.name : id,
      fingerprint: stableStringify(diySpecs[id]),
    });
  });
  const stockSpecs = asDict(stock);
  Object.keys(stockSpecs).forEach(function (slug) {
    const spec = stockSpecs[slug] || {};
    items.push({
      key: "stock:" + slug,
      name: spec.label || slug,
      fingerprint: stableStringify(spec),
    });
  });
  return items;
}

// Read the account's recipes, starting waters and concentrates and diff them
// against this device, so the merge dialog can name what each choice adds,
// replaces or removes. Read-only. Resolves null when the account can't be
// read: the dialog then explains the choices in general terms rather than
// blocking the merge on a nicety.
async function buildMergeSummary(userId: string): Promise<MergeSummary | null> {
  try {
    const results = await Promise.all([
      window.supabaseClient
        .from("user_settings")
        .select("diy_concentrate_specs, stock_concentrate_specs")
        .eq("user_id", userId)
        .maybeSingle(),
      window.supabaseClient.from("source_profiles").select("*").eq("user_id", userId),
      window.supabaseClient.from("target_profiles").select("*").eq("user_id", userId),
    ]);
    const errored = results.find(function (r) {
      return !!(r && r.error);
    });
    if (errored && errored.error) throw errored.error;

    const settings = results[0].data;
    const cloudSources: Record<string, any> = {};
    (results[1].data || []).forEach(function (row: any) {
      cloudSources[row.slug] = sourceRowToProfile(row);
    });
    const cloudTargets: Record<string, any> = {};
    (results[2].data || []).forEach(function (row: any) {
      cloudTargets[row.slug] = targetRowToProfile(row);
    });
    const buildSource = function (slug: string, p: any) {
      return buildSourceRow(userId, slug, p);
    };
    const buildTarget = function (slug: string, p: any) {
      return buildTargetRow(userId, slug, p);
    };
    const localDiy = loadDiyConcentrateSpecs();
    const localStock = loadStockConcentrateSpecs();
    const cloudDiy = settings && settings.diy_concentrate_specs;
    const cloudStock = settings && settings.stock_concentrate_specs;
    return summarizeMerge(
      {
        recipes: profileItems(loadCustomTargetProfiles(), buildTarget),
        waters: profileItems(loadCustomProfiles(), buildSource),
        concentrates: concentrateItems(localDiy, localStock),
        deletedRecipeKeys: loadDeletedTargetPresets(),
        deletedWaterKeys: loadDeletedPresets(),
      },
      {
        recipes: profileItems(cloudTargets, buildTarget),
        waters: profileItems(cloudSources, buildSource),
        concentrates: concentrateItems(cloudDiy, cloudStock),
        // pullFromCloud leaves a local spec dict alone when the account has no
        // value for it, so Use account only keeps those concentrates here
        // (and a later push adds them to the account).
        keptLocalConcentrateKeys: concentrateItems(
          cloudDiy ? {} : localDiy,
          cloudStock ? {} : localStock,
        ).map(function (c) {
          return c.key;
        }),
      },
    );
  } catch (err) {
    reportError("sync.merge-summary", err);
    return null;
  }
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

// Before a "Keep both" merge push (the dialog's "local" choice), pull the cloud's concentrate specs and
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
        await pullFromCloud({ mergeUserId: userId });
      } else {
        // Both local and cloud have non-default data: ask the user
        const choice = await showMergeDialog(await buildMergeSummary(userId));
        if (choice === "local") {
          // "Keep both" overwrites the cloud user_settings row, but the
          // concentrate specs in it are named artifacts (Category B), not
          // preferences: fold the cloud's into local first so choosing
          // "local" can't erase concentrates saved on another device.
          // Baseline for the pull below, taken before the push reads its
          // payload: any save from here on isn't in that push.
          const seqBeforePush = localWriteSeq;
          await foldCloudConcentratesIntoLocal(userId);
          await pushAllToCloud({ allowBeforeMerge: true, mergeUserId: userId });
          // The push leaves the account's own recipes and starting waters in
          // place; pull so they show up here now, as the dialog said they
          // would, instead of on the next page load. Best-effort: the local
          // data is already safe in the account, and every later load pushes
          // then pulls anyway.
          //
          // The page stays editable during the merge, and a save made now
          // can't push itself (the merge gate is still closed). Pulling over
          // it would replace the edit with the account's rows and mark them
          // as pushed, losing it on both sides. So if anything was saved
          // since the baseline, before or during the fetch, leave local alone
          // and let the catch-up below push that save and then pull.
          try {
            const applied =
              localWriteSeq === seqBeforePush &&
              (await pullFromCloud({ mergeUserId: userId, skipIfLocalWriteDuringPull: true }));
            if (applied === false) realtimePullDeferred = true;
          } catch (err) {
            reportError("sync.merge-keep-both-pull", err);
          }
        } else {
          await pullFromCloud({ mergeUserId: userId });
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
      const pendingPush = syncTimer || hasUnpushedChanges() ? syncNow() : Promise.resolve();
      return Promise.resolve(pendingPush)
        .then(function () {
          // syncNow resolves even when its upload failed (it reports the
          // error itself). Pulling then would replace the unpushed recipes
          // and starting waters with the account's rows and mark those as
          // pushed, losing the edit for good. Keep it in local data instead:
          // the next save, realtime event or page load retries the push, and
          // the pull follows once it gets through. (initSync does the same:
          // a failed push there skips its pull.)
          if (hasUnpushedChanges()) {
            console.warn("[sync] pull skipped: local changes have not reached the account yet");
            return "discarded" as const;
          }
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

// --- Does this device hold changes the cloud doesn't have? ---
// A local check, no network: a settings or selections row or a custom profile
// that differs from what this device last pushed or pulled (a save whose
// debounced push hasn't run yet, or one whose push failed), or, before the
// first-login merge has completed, any real local data at all (nothing can be
// pushed until it does). False when signed out.
//
// It deliberately doesn't look at syncTimer: that still holds the id of a
// timer that already fired (scheduleRealtimePull leans on that to retry a
// failed push), so it would report "unsynced" for the rest of the page after
// any save, and logging out offline would then ask about changes that had
// long since synced.
//
// Tombstones aren't counted: a delete uploads its tombstone with the
// selections row first, and every push by any device holding it re-sends the
// row DELETE, so one that hasn't gone through yet is not lost by logging out.
export function hasUnpushedChanges(): boolean {
  const userId = window._cachedAuthUserId || safeGetItem(KEYS.SYNCED_USER_ID);
  if (!userId) return false;
  if (safeGetItem(KEYS.SYNCED_USER_ID) !== userId) return !isDefaultData();
  // A send the server never confirmed: whether the account holds what this
  // device holds is not known until a push of that row has succeeded.
  if (
    readPendingChanges(KEYS.PENDING_PUSH_SETTINGS) ||
    readPendingChanges(KEYS.PENDING_PUSH_SELECTIONS)
  )
    return true;
  if (
    snapshotForCompare(buildSettingsPayload(userId, "")) !== safeGetItem(LAST_PUSHED_SETTINGS_KEY)
  )
    return true;
  if (
    snapshotForCompare(buildSelectionsPayload(userId, "")) !==
    safeGetItem(LAST_PUSHED_SELECTIONS_KEY)
  )
    return true;
  const profileDirty = function (
    profiles: Record<string, unknown>,
    tombstones: string[],
    snapshotsKey: string,
    build: (slug: string, p: any) => unknown,
  ): boolean {
    const snapshots: Record<string, string> = safeParse(safeGetItem(snapshotsKey), null) || {};
    return Object.keys(profiles).some(function (slug) {
      if (tombstones.indexOf(slug) !== -1) return false;
      return snapshots[slug] !== stableStringify(build(slug, profiles[slug]));
    });
  };
  return (
    profileDirty(loadCustomProfiles(), loadDeletedPresets(), LAST_PUSHED_SOURCES_KEY, (slug, p) =>
      buildSourceRow(userId, slug, p),
    ) ||
    profileDirty(
      loadCustomTargetProfiles(),
      loadDeletedTargetPresets(),
      LAST_PUSHED_TARGETS_KEY,
      (slug, p) => buildTargetRow(userId, slug, p),
    )
  );
}

// --- Flush before logout ---
// Resolves once everything this device hasn't synced is in the cloud, and
// rejects when that can't be confirmed: the push failed, the account couldn't
// be reached, the device never finished its first-login merge, or it took
// longer than FLUSH_TIMEOUT_MS. Logout (ui-shared performLogout) awaits this
// before signing out and clearing local data, and asks the user before
// discarding anything when it rejects.
//
// With nothing unsynced it resolves without touching the network, so logging
// out offline still works. It used to push only when a debounced save was
// pending: a save whose earlier push had failed, or one made while offline
// (that push "succeeded" as a no-op), was wiped by logout without a word, and
// a push stuck on a stalled connection held logout forever.
const FLUSH_TIMEOUT_MS = 12000;
const FLUSH_MAX_PUSHES = 3;

export async function flushPendingSync(): Promise<void> {
  if (!hasUnpushedChanges()) return;
  // The push below sends whatever a pending debounced save would have. The
  // timer id is kept: scheduleRealtimePull reads a set syncTimer as "push
  // before pulling", which is what retries this push if it fails and the user
  // stays signed in.
  clearTimeout(syncTimer);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>(function (_, reject) {
    timer = setTimeout(function () {
      reject(new Error("[sync] not synced: timed out syncing pending changes"));
    }, FLUSH_TIMEOUT_MS);
  });
  // The page stays editable while the push is on the network, and a save
  // that lands after the push read its payload isn't in it. So check again
  // afterwards and go round until nothing is left; if saves keep arriving,
  // reject, and logout asks instead of wiping the latest one.
  const pushUntilClean = async function (): Promise<void> {
    for (let attempt = 0; attempt < FLUSH_MAX_PUSHES && hasUnpushedChanges(); attempt++) {
      await pushAllToCloud({ mustSync: true });
    }
    if (hasUnpushedChanges()) {
      throw new Error("[sync] not synced: changes were still being saved");
    }
  };
  try {
    await Promise.race([pushUntilClean(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// The debounced save, sent now instead of when its timer fires. For the
// page-leave handlers below, which can't wait or ask: they send what was about
// to be sent anyway and nothing more.
function flushDebouncedPush(): Promise<void> {
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
// ui-shared.ts, through flushPendingSync) acts on a rejection.
function flushPendingSyncQuiet(): void {
  flushDebouncedPush().catch(function (err) {
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
