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
  SETTINGS_FIELD_KINDS,
  SELECTIONS_FIELD_KINDS,
} from "../src/lib/sync";

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
