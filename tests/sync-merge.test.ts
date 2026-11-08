// End-to-end-ish tests for the sync merge semantics, run against an in-memory
// fake of the four Supabase tables.
//
// Every pull and push merges three versions of the data (what this device
// last synced, what it holds now, what the cloud holds now) instead of
// overwriting one side with the other. These tests pin the data-loss
// scenarios that motivated it:
//   * a pull must not erase a recipe / setting saved while a push was failing;
//   * a push must not erase what another device saved meanwhile;
//   * "Keep local data" must not wipe the cloud's tombstones, rail additions,
//     creator name or concentrates;
//   * a stale tombstone must not delete a recipe re-created on another device;
//   * an offline / failed user lookup must surface as an error, not a silent
//     "saved", and logout's flush must refuse to report success.
//
// Browser-global stubs come from tests/setup.js (logged in, localStorage).

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import * as storage from "../src/lib/storage";
import {
  pushAllToCloud,
  pullFromCloud,
  flushPendingSync,
  hasUnpushedChanges,
  handleFirstLoginMerge,
  mergeRowFields,
  mergeProfileRows,
  replaceLocalWithCloud,
  clearLocalUserContent,
  SETTINGS_FIELD_KINDS,
  SELECTIONS_FIELD_KINDS,
} from "../src/lib/sync";
import { KEYS } from "../src/lib/storage-keys";

const USER = "u1";
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

class FakeCloud {
  rows: Record<string, any> = { user_settings: null, user_selections: null };
  profiles: Record<string, any[]> = { source_profiles: [], target_profiles: [] };
  deletes: string[] = [];
  user: string | null = USER;
  offline = false;

  private netError() {
    return { message: "Failed to fetch" };
  }

  client() {
    return {
      auth: {
        getUser: async () =>
          this.offline
            ? {
                data: { user: null },
                error: { name: "AuthRetryableFetchError", message: "Failed to fetch" },
              }
            : { data: { user: this.user ? { id: this.user } : null }, error: null },
      },
      from: (table: string) => this.table(table),
    };
  }

  private table(t: string) {
    const single = t === "user_settings" || t === "user_selections";
    const read = () =>
      this.offline
        ? { data: null, error: this.netError() }
        : { data: clone(single ? this.rows[t] : this.profiles[t]), error: null };
    return {
      select: () => {
        const q: any = {
          eq: () => q,
          limit: () => q,
          maybeSingle: async () => read(),
          then: (resolve: any, reject: any) => Promise.resolve(read()).then(resolve, reject),
        };
        return q;
      },
      upsert: async (payload: any) => {
        if (this.offline) return { error: this.netError() };
        if (single) {
          this.rows[t] = Object.assign({}, this.rows[t] || {}, clone(payload));
        } else {
          for (const row of ([] as any[]).concat(payload)) {
            const i = this.profiles[t]!.findIndex((r) => r.slug === row.slug);
            if (i >= 0) this.profiles[t]![i] = { ...this.profiles[t]![i], ...clone(row) };
            else this.profiles[t]!.push(clone(row));
          }
        }
        return { error: null };
      },
      delete: () => {
        return {
          eq: () => ({
            in: async (_col: string, slugs: string[]) => {
              if (this.offline) return { error: this.netError() };
              this.deletes.push(t + ":" + slugs.join(","));
              this.profiles[t] = this.profiles[t]!.filter((r) => !slugs.includes(r.slug));
              return { error: null };
            },
          }),
        };
      },
    };
  }
}

const g: any = global;
let cloud: FakeCloud;
let savedClient: any;
let savedCachedUser: any;

function profile(label: string, calcium: number) {
  return {
    label,
    brewMethod: "filter",
    calcium,
    magnesium: 10,
    alkalinity: 30,
    potassium: 0,
    sodium: 0,
    sulfate: 0,
    chloride: 0,
    bicarbonate: 36.6,
  };
}

function cloudTarget(slug: string, label: string, calcium: number) {
  return {
    user_id: USER,
    slug,
    label,
    brew_method: "filter",
    calcium,
    magnesium: 10,
    alkalinity: 30,
    potassium: 0,
    sodium: 0,
    sulfate: 0,
    chloride: 0,
    bicarbonate: 36.6,
    description: "",
    is_public: false,
    creator_display_name: "",
    creator_user_id: USER,
    tags: [],
    roast: ["all"],
  };
}

// Establish "this device is merged and in sync with the cloud".
async function syncedBaseline() {
  g.localStorage.setItem("cw_synced_user_id", USER);
  await pushAllToCloud();
  await pullFromCloud();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  g.localStorage.clear();
  g.sessionStorage.clear();
  storage.invalidateAllCaches();
  cloud = new FakeCloud();
  savedClient = g.window.supabaseClient;
  savedCachedUser = g.window._cachedAuthUserId;
  g.window.supabaseClient = cloud.client();
  g.window._cachedAuthUserId = USER;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  g.window.supabaseClient = savedClient;
  g.window._cachedAuthUserId = savedCachedUser;
});

describe("pulls never erase unpushed local changes", () => {
  test("a recipe saved while pushes were failing survives the next pull and is pushed after", async () => {
    await syncedBaseline();
    cloud.offline = true;
    storage.saveCustomTargetProfiles({ "offline-recipe": profile("Offline Recipe", 40) });
    await expect(pushAllToCloud()).rejects.toThrow(/could not resolve the signed-in user/);

    // Network back; another device's change triggers a pull before any push.
    cloud.offline = false;
    await pullFromCloud();
    expect(Object.keys(storage.loadCustomTargetProfiles())).toContain("offline-recipe");
    expect(hasUnpushedChanges()).toBe(true);

    await pushAllToCloud();
    expect(cloud.profiles.target_profiles!.map((r) => r.slug)).toContain("offline-recipe");
    expect(hasUnpushedChanges()).toBe(false);
  });

  test("an unpushed edit to a synced recipe is kept; untouched recipes take cloud edits", async () => {
    cloud.profiles.target_profiles = [cloudTarget("a", "A", 40), cloudTarget("b", "B", 50)];
    await syncedBaseline();

    const local = storage.loadCustomTargetProfiles();
    local["a"] = { ...local["a"]!, calcium: 99 };
    storage.saveCustomTargetProfiles(local);
    // Meanwhile another device edits "b".
    cloud.profiles.target_profiles[1] = cloudTarget("b", "B", 77);

    await pullFromCloud();
    const after = storage.loadCustomTargetProfiles();
    expect(after["a"]!.calcium).toBe(99);
    expect(after["b"]!.calcium).toBe(77);
  });

  test("a recipe deleted on another device is removed (synced before, gone from the cloud)", async () => {
    cloud.profiles.target_profiles = [cloudTarget("a", "A", 40)];
    await syncedBaseline();
    cloud.profiles.target_profiles = [];
    await pullFromCloud();
    expect(storage.loadCustomTargetProfiles()["a"]).toBeUndefined();
  });

  test("settings: a locally changed field is kept, fields changed elsewhere arrive", async () => {
    await syncedBaseline();
    // Local, unpushed: a new DIY concentrate.
    storage.saveDiyConcentrateSpecs({ "epsom-salt": { bottleMl: 100, gramsPerBottle: 10 } } as any);
    // Another device: switched brew method and added a stock concentrate.
    cloud.rows.user_settings = {
      ...cloud.rows.user_settings,
      brew_method: "espresso",
      stock_concentrate_specs: { x: { label: "X", bottleMl: 200, doseGramsPerL: 4, minerals: [] } },
    };
    await pullFromCloud();
    expect(Object.keys(storage.loadDiyConcentrateSpecs())).toEqual(["epsom-salt"]);
    expect(Object.keys(storage.loadStockConcentrateSpecs())).toEqual(["x"]);
    expect(storage.loadBrewMethod()).toBe("espresso");
  });
});

describe("pushes never erase other devices' changes", () => {
  test("a stale device's push keeps a concentrate another device created", async () => {
    await syncedBaseline();
    // Phone (this device), offline-ish: changes the dropper type only.
    storage.saveLotusDropperType("straight");
    // Laptop meanwhile creates Recipe Concentrate X.
    cloud.rows.user_settings = {
      ...cloud.rows.user_settings,
      stock_concentrate_specs: { x: { label: "X", bottleMl: 200, doseGramsPerL: 4, minerals: [] } },
    };
    await pushAllToCloud();
    expect(Object.keys(cloud.rows.user_settings.stock_concentrate_specs)).toEqual(["x"]);
    expect(cloud.rows.user_settings.lotus_dropper_type).toBe("straight");
    // And the push folded X into this device too.
    expect(Object.keys(storage.loadStockConcentrateSpecs())).toEqual(["x"]);
  });

  test("two devices adding different concentrates both survive", async () => {
    await syncedBaseline();
    storage.saveStockConcentrateSpecs({
      a: { label: "A", bottleMl: 100, doseGramsPerL: 4, minerals: [] },
    } as any);
    cloud.rows.user_settings = {
      ...cloud.rows.user_settings,
      stock_concentrate_specs: { b: { label: "B", bottleMl: 100, doseGramsPerL: 4, minerals: [] } },
    };
    await pushAllToCloud();
    expect(Object.keys(cloud.rows.user_settings.stock_concentrate_specs).sort()).toEqual([
      "a",
      "b",
    ]);
  });
});

describe('"Keep local data" (first-sync push) unions instead of wiping', () => {
  test("cloud tombstones, rail additions, creator name and concentrates survive", async () => {
    cloud.rows.user_selections = {
      user_id: USER,
      deleted_target_presets: ["rao"],
      added_target_presets: ["sey"],
      source_preset: "distilled",
    };
    cloud.rows.user_settings = {
      user_id: USER,
      creator_display_name: "Kyle",
      stock_concentrate_specs: { x: { label: "X", bottleMl: 200, doseGramsPerL: 4, minerals: [] } },
    };
    // Local: anonymous-era tweaks only (no Category B data).
    storage.saveSourcePresetName("custom");
    await pushAllToCloud({ allowBeforeMerge: true, mergeUserId: USER });
    expect(cloud.rows.user_selections.deleted_target_presets).toEqual(["rao"]);
    expect(cloud.rows.user_selections.added_target_presets).toEqual(["sey"]);
    expect(cloud.rows.user_selections.source_preset).toBe("custom"); // local kept
    expect(cloud.rows.user_settings.creator_display_name).toBe("Kyle");
    expect(Object.keys(cloud.rows.user_settings.stock_concentrate_specs)).toEqual(["x"]);
  });
});

describe("tombstones", () => {
  test("a delete is sent once, not replayed on every push", async () => {
    cloud.profiles.target_profiles = [cloudTarget("a", "A", 40)];
    await syncedBaseline();
    storage.deleteCustomTargetProfile("a");
    await pushAllToCloud();
    await pushAllToCloud();
    expect(cloud.deletes).toEqual(["target_profiles:a"]);
  });

  test("a stale tombstone doesn't delete a recipe another device re-created", async () => {
    cloud.profiles.target_profiles = [cloudTarget("my-recipe", "My Recipe", 40)];
    await syncedBaseline();
    storage.deleteCustomTargetProfile("my-recipe");
    await pushAllToCloud(); // delete confirmed
    expect(cloud.profiles.target_profiles).toEqual([]);

    // Another device re-creates it (and lifts the tombstone in the cloud).
    cloud.profiles.target_profiles = [cloudTarget("my-recipe", "My Recipe", 55)];
    cloud.rows.user_selections = { ...cloud.rows.user_selections, deleted_target_presets: [] };

    // This (stale) device pushes before it pulls.
    await pushAllToCloud();
    expect(cloud.profiles.target_profiles.map((r) => r.slug)).toEqual(["my-recipe"]);
    await pullFromCloud();
    expect(storage.loadCustomTargetProfiles()["my-recipe"]!.calcium).toBe(55);
    expect(storage.loadDeletedTargetPresets()).toEqual([]);
  });
});

describe("failed lookups and logout flush", () => {
  test("a push that can't reach the account rejects instead of reporting success", async () => {
    await syncedBaseline();
    cloud.offline = true;
    storage.saveCreatorDisplayName("New Name");
    await expect(pushAllToCloud()).rejects.toThrow(/could not resolve the signed-in user/);
  });

  test("flushPendingSync rejects while unsynced changes can't be pushed", async () => {
    await syncedBaseline();
    cloud.offline = true;
    storage.saveCustomTargetProfiles({ x: profile("X", 40) });
    await expect(flushPendingSync()).rejects.toThrow();
  });

  test("flushPendingSync resolves without the network when nothing is unsynced", async () => {
    await syncedBaseline();
    cloud.offline = true;
    await expect(flushPendingSync()).resolves.toBeUndefined();
  });

  test("flushPendingSync pushes a change whose earlier push failed", async () => {
    await syncedBaseline();
    cloud.offline = true;
    storage.saveCustomTargetProfiles({ x: profile("X", 40) });
    await expect(pushAllToCloud()).rejects.toThrow();
    cloud.offline = false;
    await flushPendingSync();
    expect(cloud.profiles.target_profiles!.map((r) => r.slug)).toEqual(["x"]);
  });
});

describe("first-login merge marker", () => {
  test("the merge's pull marks the device merged in the same step that applies the data", async () => {
    cloud.profiles.target_profiles = [cloudTarget("a", "A", 40)];
    cloud.rows.user_settings = { user_id: USER, brew_method: "espresso" };
    await pullFromCloud({ mergeUserId: USER, markMergedFor: USER });
    // No extra round trip between applying and marking: both are already done.
    expect(g.localStorage.getItem("cw_synced_user_id")).toBe(USER);
    expect(storage.loadCustomTargetProfiles()["a"]).toBeDefined();
  });

  test("a returning user's merge on a fresh device completes and marks the device", async () => {
    cloud.profiles.target_profiles = [cloudTarget("a", "A", 40)];
    await handleFirstLoginMerge();
    expect(g.localStorage.getItem("cw_synced_user_id")).toBe(USER);
    expect(storage.loadCustomTargetProfiles()["a"]).toBeDefined();
  });
});

describe("account switch without sign-out", () => {
  test("the previous account's local data is cleared, never pushed into the new account", async () => {
    g.localStorage.setItem("cw_synced_user_id", "old-user");
    storage.saveCustomTargetProfiles({ secret: profile("Old account recipe", 40) });
    cloud.user = "new-user";
    await handleFirstLoginMerge();
    expect(cloud.profiles.target_profiles!.map((r) => r.slug)).not.toContain("secret");
    expect(storage.loadCustomTargetProfiles()["secret"]).toBeUndefined();
  });
});

describe("mergeRowFields", () => {
  test("set: additions on both sides kept, removals on either side honored", () => {
    const merged = mergeRowFields(
      SELECTIONS_FIELD_KINDS,
      { deleted_target_presets: ["a", "b"] },
      { deleted_target_presets: ["a", "c"] }, // local removed b, added c
      { deleted_target_presets: ["b", "d"] }, // cloud removed a, added d
      "pull",
    );
    expect(merged.deleted_target_presets).toEqual(["c", "d"]);
  });

  test("dict: per-key three-way", () => {
    const merged = mergeRowFields(
      SETTINGS_FIELD_KINDS,
      { stock_concentrate_specs: { a: 1, b: 1 } },
      { stock_concentrate_specs: { a: 2, b: 1 } }, // local edited a
      { stock_concentrate_specs: { a: 1, c: 1 } }, // cloud deleted b, added c
      "pull",
    );
    expect(merged.stock_concentrate_specs).toEqual({ a: 2, c: 1 });
  });

  test("scalar: untouched locally takes the cloud; changed locally keeps local", () => {
    const base = { brew_method: "filter", theme: "light" };
    const merged = mergeRowFields(
      SETTINGS_FIELD_KINDS,
      base,
      { brew_method: "filter", theme: "dark" },
      { brew_method: "espresso", theme: "light" },
      "pull",
    );
    expect(merged.brew_method).toBe("espresso");
    expect(merged.theme).toBe("dark");
  });

  test("first-sync pull (no base) takes the cloud for scalars and sets", () => {
    const merged = mergeRowFields(
      SETTINGS_FIELD_KINDS,
      null,
      { selected_minerals: ["baking-soda"], brew_method: "filter" },
      { selected_minerals: ["epsom-salt"], brew_method: "espresso" },
      "pull",
    );
    expect(merged.selected_minerals).toEqual(["epsom-salt"]);
    expect(merged.brew_method).toBe("espresso");
  });
});

describe("mergeProfileRows", () => {
  const toP = (r: any) => ({ v: r.v });
  const snap = (slug: string, p: any) => slug + ":" + p.v;

  test("keeps never-synced local profiles, drops synced ones missing from the cloud", () => {
    const { profiles } = mergeProfileRows(
      [],
      { fresh: { v: 1 }, gone: { v: 1 } },
      [],
      { gone: "gone:1" },
      toP,
      snap,
    );
    expect(Object.keys(profiles)).toEqual(["fresh"]);
  });

  test("tombstoned cloud rows are skipped", () => {
    const { profiles, snapshots } = mergeProfileRows(
      [{ slug: "t", v: 1 }],
      {},
      ["t"],
      {},
      toP,
      snap,
    );
    expect(profiles).toEqual({});
    expect(snapshots).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Regressions found reviewing the merge-based sync. Several devices share the
// fake cloud; each keeps its own localStorage image, swapped in around fully
// awaited operations (one module instance, so no device runs in the
// background while another is loaded).
// ---------------------------------------------------------------------------

function deviceImage(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < g.localStorage.length; i++) {
    const k = g.localStorage.key(i)!;
    out[k] = g.localStorage.getItem(k)!;
  }
  return out;
}

function useDevice(image: Record<string, string>) {
  vi.clearAllTimers(); // no debounced push from the previous device
  g.localStorage.clear();
  for (const k of Object.keys(image)) g.localStorage.setItem(k, image[k]!);
  storage.invalidateAllCaches();
}

// What a realtime event does on a device: push first if it holds unsynced
// changes, then pull.
async function realtimeEvent() {
  if (hasUnpushedChanges()) await pushAllToCloud();
  await pullFromCloud();
}

// Run `during` once, inside the first upsert to `table` (i.e. while a push is
// out on the network).
function duringUpsert(table: string, during: () => void) {
  const original = g.window.supabaseClient.from;
  let done = false;
  g.window.supabaseClient.from = (t: string) => {
    const tbl = original(t);
    if (t !== table) return tbl;
    const upsert = tbl.upsert;
    tbl.upsert = async (payload: any) => {
      if (!done) {
        done = true;
        during();
      }
      return upsert(payload);
    };
    return tbl;
  };
  return () => {
    g.window.supabaseClient.from = original;
  };
}

const cloudSlugs = () => cloud.profiles.target_profiles!.map((r: any) => r.slug);

describe("review regressions: tombstones", () => {
  test("an idle device's pulled tombstone doesn't delete a recipe re-created on another device", async () => {
    cloud.profiles.target_profiles = [cloudTarget("morning-filter", "Morning Filter", 40)];
    await syncedBaseline();
    let phone = deviceImage();
    let laptop = deviceImage();

    useDevice(phone);
    storage.deleteCustomTargetProfile("morning-filter");
    await pushAllToCloud();
    phone = deviceImage();

    useDevice(laptop);
    await realtimeEvent();
    // Learning about another device's delete isn't an unsynced change.
    expect(hasUnpushedChanges()).toBe(false);
    laptop = deviceImage();

    useDevice(phone);
    storage.saveCustomTargetProfiles({
      ...storage.loadCustomTargetProfiles(),
      "morning-filter": profile("Morning Filter", 55),
    });
    await pushAllToCloud();
    phone = deviceImage();

    useDevice(laptop);
    await realtimeEvent();
    expect(cloudSlugs()).toContain("morning-filter");
    expect(storage.loadCustomTargetProfiles()["morning-filter"]!.calcium).toBe(55);
  });

  test("a recipe deleted, re-created and deleted again with no pull between is deleted from the cloud", async () => {
    cloud.profiles.target_profiles = [cloudTarget("r", "R", 40)];
    await syncedBaseline();
    storage.deleteCustomTargetProfile("r");
    await pushAllToCloud();
    storage.saveCustomTargetProfiles({
      ...storage.loadCustomTargetProfiles(),
      r: profile("R", 41),
    });
    await pushAllToCloud();
    expect(cloudSlugs()).toContain("r");
    storage.deleteCustomTargetProfile("r");
    await pushAllToCloud();
    expect(cloudSlugs()).not.toContain("r");
  });

  test('"Keep local data" keeps local recipes the cloud had tombstoned, and the local mineral selection', async () => {
    cloud.rows.user_settings = {
      user_id: USER,
      selected_minerals: ["gypsum", "magnesium-chloride", "potassium-bicarbonate"],
    };
    cloud.rows.user_selections = { user_id: USER, deleted_target_presets: ["my-recipe", "gone"] };
    storage.saveSelectedMinerals(["calcium-chloride", "epsom-salt", "baking-soda"]);
    storage.saveCustomTargetProfiles({ "my-recipe": profile("My Recipe", 40) });

    await pushAllToCloud({ allowBeforeMerge: true, mergeUserId: USER });
    g.localStorage.setItem("cw_synced_user_id", USER);
    await pullFromCloud();

    expect(storage.loadSelectedMinerals().slice().sort()).toEqual([
      "baking-soda",
      "calcium-chloride",
      "epsom-salt",
    ]);
    expect(storage.loadCustomTargetProfiles()["my-recipe"]).toBeDefined();
    expect(cloudSlugs()).toContain("my-recipe");
    // The cloud's other tombstones still stand.
    expect(cloud.rows.user_selections.deleted_target_presets).toEqual(["gone"]);
  });

  test("a recipe edited here and deleted on another device before this device pushed is kept and pushed", async () => {
    cloud.profiles.target_profiles = [cloudTarget("r", "R", 40)];
    await syncedBaseline();
    let other = deviceImage();
    // This device edits r but doesn't push yet.
    storage.saveCustomTargetProfiles({
      ...storage.loadCustomTargetProfiles(),
      r: profile("R", 47),
    });
    const here = deviceImage();
    // Another device deletes r.
    useDevice(other);
    storage.deleteCustomTargetProfile("r");
    await pushAllToCloud();
    other = deviceImage();
    // This device pulls, then pushes.
    useDevice(here);
    await pullFromCloud();
    expect(storage.loadCustomTargetProfiles()["r"]!.calcium).toBe(47);
    await pushAllToCloud();
    expect(cloudSlugs()).toContain("r");
    expect(cloud.rows.user_selections.deleted_target_presets).not.toContain("r");
  });
});

describe("review regressions: folding a push", () => {
  test("a save made while a push is on the network doesn't lose another device's change", async () => {
    await syncedBaseline();
    cloud.rows.user_settings = {
      ...cloud.rows.user_settings,
      stock_concentrate_specs: { x: { label: "X", bottleMl: 200, doseGramsPerL: 4, minerals: [] } },
    };
    storage.saveLotusDropperType("straight");
    const restore = duringUpsert("user_settings", () => storage.saveBrewMethod("espresso"));
    await pushAllToCloud();
    restore();
    await pullFromCloud();
    await pushAllToCloud();
    expect(Object.keys(cloud.rows.user_settings.stock_concentrate_specs || {})).toContain("x");
    expect(cloud.rows.user_settings.brew_method).toBe("espresso");
  });

  test("a save from another tab while a push is on the network isn't overwritten by the push", async () => {
    await syncedBaseline();
    cloud.rows.user_settings = {
      ...cloud.rows.user_settings,
      stock_concentrate_specs: { x: { label: "X", bottleMl: 200, doseGramsPerL: 4, minerals: [] } },
    };
    storage.saveLotusDropperType("straight");
    // Another tab's save: written straight to localStorage, with its write
    // marker, not through this tab's storage module.
    const restore = duringUpsert("user_settings", () => {
      g.localStorage.setItem(KEYS.BREW_METHOD, "espresso");
      g.localStorage.setItem(KEYS.LOCAL_WRITE_MARKER, "another-tab");
    });
    await pushAllToCloud();
    restore();
    expect(g.localStorage.getItem(KEYS.BREW_METHOD)).toBe("espresso");
    storage.invalidateAllCaches();
    await pushAllToCloud(); // the other tab's push
    expect(cloud.rows.user_settings.brew_method).toBe("espresso");
    expect(Object.keys(cloud.rows.user_settings.stock_concentrate_specs || {})).toContain("x");
  });

  test("a push whose account signs out mid-flight writes nothing back to the device", async () => {
    await syncedBaseline();
    cloud.rows.user_settings = {
      ...cloud.rows.user_settings,
      stock_concentrate_specs: { x: { label: "X", bottleMl: 200, doseGramsPerL: 4, minerals: [] } },
    };
    storage.saveLotusDropperType("straight");
    const restore = duringUpsert("user_settings", () => {
      g.window._cachedAuthUserId = null;
      clearLocalUserContent();
    });
    await pushAllToCloud();
    restore();
    expect(g.localStorage.getItem(KEYS.STOCK_CONCENTRATE_SPECS)).toBeNull();
    expect(g.localStorage.getItem(KEYS.LAST_PUSHED_SETTINGS)).toBeNull();
    expect(g.localStorage.getItem(KEYS.LAST_PUSHED_TARGET_PROFILES)).toBeNull();
  });
});

describe("review regressions: merge choices, order, drafts, stalls", () => {
  test('"Use cloud data" neither keeps nor uploads local-only recipes', async () => {
    cloud.profiles.target_profiles = [cloudTarget("cloud-recipe", "Cloud Recipe", 30)];
    cloud.rows.user_settings = { user_id: USER, selected_minerals: ["gypsum"] };
    storage.saveCustomTargetProfiles({ "local-only": profile("Local Only", 40) });
    await replaceLocalWithCloud(USER);
    expect(Object.keys(storage.loadCustomTargetProfiles())).toEqual(["cloud-recipe"]);
    expect(storage.loadSelectedMinerals()).toEqual(["gypsum"]);
    await pushAllToCloud();
    expect(cloudSlugs()).toEqual(["cloud-recipe"]);
  });

  test("two devices holding the same tombstones in different orders stop pushing at each other", async () => {
    await syncedBaseline();
    let a = deviceImage();
    let b = deviceImage();
    useDevice(a);
    storage.addDeletedTargetPreset("rao");
    await pushAllToCloud();
    a = deviceImage();
    useDevice(b);
    storage.addDeletedTargetPreset("sca");
    await pushAllToCloud();
    b = deviceImage();
    const dirty: boolean[] = [];
    for (let round = 0; round < 3; round++) {
      for (const which of ["a", "b"] as const) {
        useDevice(which === "a" ? a : b);
        await pullFromCloud();
        dirty.push(hasUnpushedChanges());
        if (hasUnpushedChanges()) await pushAllToCloud();
        if (which === "a") a = deviceImage();
        else b = deviceImage();
      }
    }
    // Settled after the first round: nobody is dirty in the later rounds.
    expect(dirty.slice(2)).toEqual([false, false, false, false]);
    expect(cloud.rows.user_selections.deleted_target_presets.slice().sort()).toEqual([
      "rao",
      "sca",
    ]);
  });

  test("a 1.2 client's empty drafts blob doesn't delete this device's draft", async () => {
    g.localStorage.setItem(KEYS.RECIPE_MINERAL_INPUTS, JSON.stringify({ "epsom-salt": "1.2" }));
    await syncedBaseline();
    cloud.rows.user_settings = { ...cloud.rows.user_settings, drafts: {}, theme: "dark" };
    await pullFromCloud();
    expect(g.localStorage.getItem(KEYS.RECIPE_MINERAL_INPUTS)).not.toBeNull();
  });

  test("logout's flush gives up on a push stuck on the network instead of hanging", async () => {
    await syncedBaseline();
    storage.saveLotusDropperType("straight");
    const original = g.window.supabaseClient.from;
    let release: (value: unknown) => void = () => {};
    g.window.supabaseClient.from = (t: string) => {
      const tbl = original(t);
      tbl.select = () => ({
        eq: () => ({
          maybeSingle: () =>
            new Promise((resolve) => {
              release = resolve;
            }),
        }),
      });
      return tbl;
    };
    const outcome = flushPendingSync().then(
      () => "resolved",
      (e: Error) => "rejected: " + e.message,
    );
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await outcome).toMatch(/rejected: .*timed out/);
    // The stalled request finally fails (as the client's request timeout makes
    // it do), so the push queue drains for whatever runs next.
    g.window.supabaseClient.from = original;
    release({ data: null, error: { message: "Failed to fetch" } });
    await vi.advanceTimersByTimeAsync(0);
  });
});

// ---------------------------------------------------------------------------
// Randomized multi-device simulation. Three devices edit minerals, the rail,
// source water and recipes (create, edit, delete, re-create) in random order.
//
// Sequential: each change is pushed and every other device then gets the
// realtime event before anyone acts again, so every device must end up exactly
// matching a model that applies the changes in order (no lost edits, no
// resurrected or wrongly deleted recipes).
//
// Concurrent: devices act on stale state, push and pull in random order, and
// some saves land while a push is on the network. After everyone syncs, all
// devices must agree, none may hold unsynced changes, and anything added and
// never removed by any device (a mineral, a rail entry, a recipe) must exist.
// ---------------------------------------------------------------------------

function seededRandom(seed: number) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Observed = {
  minerals: string[];
  rail: string[];
  calcium: number;
  recipes: Record<string, number>;
};

function observe(): Observed {
  const recipes: Record<string, number> = {};
  const profiles = storage.loadCustomTargetProfiles();
  Object.keys(profiles)
    .sort()
    .forEach((slug) => {
      recipes[slug] = Number(profiles[slug]!.calcium);
    });
  return {
    minerals: storage.loadSelectedMinerals().slice().sort(),
    rail: storage.loadAddedTargetPresets().slice().sort(),
    calcium: Number(storage.loadSourceWater().calcium) || 0,
    recipes,
  };
}

type Mutation = {
  kind: "mineral" | "rail" | "calcium" | "upsert" | "delete";
  key: string;
  value: number;
};
const POOL = {
  mineral: ["gypsum", "magnesium-chloride", "potassium-bicarbonate", "epsom-salt"],
  rail: ["rao", "sey", "aviary-filter"],
  recipe: ["r1", "r2", "r3"],
};

function randomMutation(rand: () => number): Mutation {
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const kind = pick(["mineral", "rail", "calcium", "upsert", "upsert", "delete"] as const);
  const key =
    kind === "mineral" ? pick(POOL.mineral) : kind === "rail" ? pick(POOL.rail) : pick(POOL.recipe);
  return { kind, key, value: 1 + Math.floor(rand() * 90) };
}

// Apply on the device currently loaded; returns what it did for the model and
// the invariants ("add" / "remove" of key in its collection, or "set").
function applyMutation(m: Mutation): "add" | "remove" | "set" | "noop" {
  if (m.kind === "mineral") {
    const cur = storage.loadSelectedMinerals();
    const has = cur.includes(m.key);
    storage.saveSelectedMinerals(has ? cur.filter((x) => x !== m.key) : [...cur, m.key]);
    return has ? "remove" : "add";
  }
  if (m.kind === "rail") {
    const has = storage.loadAddedTargetPresets().includes(m.key);
    if (has) storage.removeAddedTargetPreset(m.key);
    else storage.addAddedTargetPreset(m.key);
    return has ? "remove" : "add";
  }
  if (m.kind === "calcium") {
    storage.saveSourceWater({ ...storage.loadSourceWater(), calcium: m.value });
    return "set";
  }
  if (m.kind === "upsert") {
    storage.saveCustomTargetProfiles({
      ...storage.loadCustomTargetProfiles(),
      [m.key]: profile(m.key, m.value),
    });
    return "add";
  }
  if (!storage.loadCustomTargetProfiles()[m.key]) return "noop";
  storage.deleteCustomTargetProfile(m.key);
  return "remove";
}

function applyToModel(model: Observed, m: Mutation, effect: string) {
  if (effect === "noop") return;
  if (m.kind === "mineral" || m.kind === "rail") {
    const list = m.kind === "mineral" ? model.minerals : model.rail;
    const next = effect === "add" ? [...list, m.key] : list.filter((x) => x !== m.key);
    if (m.kind === "mineral") model.minerals = next.sort();
    else model.rail = next.sort();
  } else if (m.kind === "calcium") {
    model.calcium = m.value;
  } else if (m.kind === "upsert") {
    model.recipes = { ...model.recipes, [m.key]: m.value };
  } else {
    const next = { ...model.recipes };
    delete next[m.key];
    model.recipes = next;
  }
  model.recipes = Object.fromEntries(Object.entries(model.recipes).sort());
}

async function freshAccount() {
  vi.clearAllTimers();
  g.localStorage.clear();
  g.sessionStorage.clear();
  storage.invalidateAllCaches();
  cloud = new FakeCloud();
  g.window.supabaseClient = cloud.client();
  await syncedBaseline();
}

describe("randomized multi-device simulation", () => {
  test("sequential changes leave every device matching the changes applied in order", async () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rand = seededRandom(seed);
      await freshAccount();
      const devices = [deviceImage(), deviceImage(), deviceImage()];
      useDevice(devices[0]!);
      const model = observe();
      for (let step = 0; step < 25; step++) {
        const d = Math.floor(rand() * 3);
        useDevice(devices[d]!);
        const m = randomMutation(rand);
        applyToModel(model, m, applyMutation(m));
        await pushAllToCloud();
        devices[d] = deviceImage();
        for (let e = 0; e < 3; e++) {
          if (e === d) continue;
          useDevice(devices[e]!);
          await realtimeEvent();
          devices[e] = deviceImage();
        }
        for (let e = 0; e < 3; e++) {
          useDevice(devices[e]!);
          const where = `seed ${seed} step ${step} (${m.kind} ${m.key}) device ${e}`;
          expect(observe(), where).toEqual(model);
          expect(hasUnpushedChanges(), where).toBe(false);
        }
      }
    }
  }, 60_000);

  test("concurrent changes converge without losing anything never removed", async () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rand = seededRandom(1000 + seed);
      await freshAccount();
      const devices = [deviceImage(), deviceImage(), deviceImage()];
      const added = new Set<string>();
      const removed = new Set<string>();
      const track = (m: Mutation, effect: string) => {
        if (m.kind === "calcium" || effect === "noop") return;
        const collection = m.kind === "upsert" || m.kind === "delete" ? "recipe" : m.kind;
        (effect === "add" ? added : removed).add(collection + ":" + m.key);
      };
      for (let step = 0; step < 30; step++) {
        const d = Math.floor(rand() * 3);
        useDevice(devices[d]!);
        const action = rand();
        if (action < 0.5) {
          const m = randomMutation(rand);
          track(m, applyMutation(m));
        } else if (action < 0.65) {
          await pushAllToCloud();
        } else if (action < 0.75) {
          await pullFromCloud();
        } else if (action < 0.9) {
          await realtimeEvent();
        } else {
          // A save lands while this device's push is on the network.
          const m = randomMutation(rand);
          const restore = duringUpsert("user_settings", () => track(m, applyMutation(m)));
          storage.saveLotusDropperType(rand() < 0.5 ? "straight" : "dropper");
          await pushAllToCloud();
          restore();
        }
        devices[d] = deviceImage();
      }
      for (let round = 0; round < 4; round++) {
        for (let e = 0; e < 3; e++) {
          useDevice(devices[e]!);
          await realtimeEvent();
          if (hasUnpushedChanges()) await pushAllToCloud();
          devices[e] = deviceImage();
        }
      }
      const states = devices.map((img) => {
        useDevice(img);
        return { obs: observe(), dirty: hasUnpushedChanges() };
      });
      const where = `seed ${1000 + seed}`;
      expect(
        states.map((s) => s.dirty),
        where,
      ).toEqual([false, false, false]);
      expect(states[1]!.obs, where).toEqual(states[0]!.obs);
      expect(states[2]!.obs, where).toEqual(states[0]!.obs);
      const final = states[0]!.obs;
      for (const k of added) {
        if (removed.has(k)) continue;
        const [kind, key] = k.split(":") as [string, string];
        const present =
          kind === "mineral"
            ? final.minerals.includes(key)
            : kind === "rail"
              ? final.rail.includes(key)
              : key in final.recipes;
        expect(present, `${where}: ${k} was added and never removed`).toBe(true);
      }
    }
  }, 60_000);
});
