// The merged push of user_settings and user_selections (src/lib/sync.ts
// pushSingleRow): a device sends only what it changed since it last synced,
// on top of whatever the row holds now, so it no longer undoes a write it has
// not pulled yet. The writer that makes this matter is a connected AI app
// (MCP.md): its database functions change these rows while the app is closed
// or in the background.
//
// Three groups:
//   - the pure merge (mergeRowForPush);
//   - each of the four database functions against a stale device, on current
//     code and next to the frozen 1.2 sync (tests/fixtures/sync-v1.2.ts);
//   - what must NOT have changed: the delete lists, the first-login merge's
//     push, a device with no base, and the conditional write's retry.
//
// Browser-global stubs come from tests/setup.js (logged in, localStorage).

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mergeRowForPush,
  baseAfterUnsyncedPull,
  ownChangesOf,
  combineOwnChanges,
  settleMergedSettings,
  settleMergedSelections,
  snapshotForCompare,
  SETTINGS_PUSH_KINDS,
  SELECTIONS_PUSH_KINDS,
  SELECTIONS_PUSH_GROUPS,
  buildSettingsPayload,
  buildSelectionsPayload,
  pushAllToCloud,
  pullFromCloud,
  hasUnpushedChanges,
} from "../src/lib/sync";
import {
  storage,
  cloud,
  newCloud,
  makeDevices,
  act,
  push,
  realtime,
  pageLoad,
  settle,
  dirty,
  use,
  USER,
  type Device,
  type Version,
} from "./helpers/sync-fleet";

const g: any = global;
let savedClient: unknown;
let savedUser: unknown;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  savedClient = g.window.supabaseClient;
  savedUser = g.window._cachedAuthUserId;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  g.localStorage.clear();
  g.sessionStorage.clear();
  storage.invalidateAllCaches();
  g.window.supabaseClient = savedClient;
  g.window._cachedAuthUserId = savedUser;
});

// ---------------------------------------------------------------------------
// The pure merge
// ---------------------------------------------------------------------------

describe("mergeRowForPush", () => {
  const settings = (
    base: Record<string, unknown>,
    local: Record<string, unknown>,
    cloudRow: Record<string, unknown>,
  ) => mergeRowForPush(SETTINGS_PUSH_KINDS, [], base, local, cloudRow);
  const selections = (
    base: Record<string, unknown>,
    local: Record<string, unknown>,
    cloudRow: Record<string, unknown>,
  ) => mergeRowForPush(SELECTIONS_PUSH_KINDS, SELECTIONS_PUSH_GROUPS, base, local, cloudRow);

  test("a field this device did not change keeps the cloud's value", () => {
    expect(
      settings(
        { theme: "dark", brew_method: "filter" },
        { theme: "light", brew_method: "filter" },
        { theme: "dark", brew_method: "espresso" },
      ),
    ).toEqual({ theme: "light", brew_method: "espresso" });
  });

  test("a field both changed takes this device's value", () => {
    expect(
      settings({ brew_method: "filter" }, { brew_method: "espresso" }, { brew_method: "filter" }),
    ).toEqual({ brew_method: "espresso" });
    expect(settings({ theme: "system" }, { theme: "light" }, { theme: "dark" })).toEqual({
      theme: "light",
    });
  });

  test("where nobody else wrote, the result is exactly the local payload", () => {
    const base = {
      selected_minerals: ["a", "b"],
      stock_concentrate_specs: { x: { bottleMl: 1 } },
      drafts: {},
    };
    const local = {
      selected_minerals: ["b", "a", "c"],
      stock_concentrate_specs: { y: { bottleMl: 2 } },
      drafts: { recipe_dispense_mode: "stock" },
    };
    expect(settings(base, local, JSON.parse(JSON.stringify(base)))).toEqual(local);
  });

  test("lists: both sides' additions and removals survive", () => {
    const out = settings(
      { selected_minerals: ["a", "b", "c"] },
      { selected_minerals: ["a", "c", "mine"] }, // removed b, added mine
      { selected_minerals: ["a", "b", "theirs"] }, // removed c, added theirs
    );
    expect(out.selected_minerals).toEqual(["a", "mine", "theirs"]);
  });

  test("a list this device did not touch is the cloud's, order included", () => {
    const out = settings(
      { selected_concentrates: ["stock:x", "stock:y"] },
      { selected_concentrates: ["stock:x", "stock:y"] },
      { selected_concentrates: ["stock:z", "stock:x"] },
    );
    expect(out.selected_concentrates).toEqual(["stock:z", "stock:x"]);
  });

  test("maps merge per key: added, edited and removed on either side", () => {
    const out = settings(
      { stock_concentrate_specs: { keep: { v: 1 }, mineGone: { v: 1 }, theirsGone: { v: 1 } } },
      {
        stock_concentrate_specs: { keep: { v: 2 }, theirsGone: { v: 1 }, mineNew: { v: 9 } },
      },
      {
        stock_concentrate_specs: { keep: { v: 1 }, mineGone: { v: 1 }, theirsNew: { v: 8 } },
      },
    );
    expect(out.stock_concentrate_specs).toEqual({
      keep: { v: 2 },
      mineNew: { v: 9 },
      theirsNew: { v: 8 },
    });
  });

  test("the same concentrate edited on both sides: this device's edit wins", () => {
    const out = settings(
      { diy_concentrate_specs: { "epsom-salt": { bottleMl: 100 } } },
      { diy_concentrate_specs: { "epsom-salt": { bottleMl: 250 } } },
      { diy_concentrate_specs: { "epsom-salt": { bottleMl: 500 } } },
    );
    expect(out.diy_concentrate_specs).toEqual({ "epsom-salt": { bottleMl: 250 } });
  });

  test("the delete lists are always this device's own, whatever the cloud holds", () => {
    const out = selections(
      { deleted_target_presets: ["old"], deleted_source_presets: [] },
      { deleted_target_presets: ["old"], deleted_source_presets: [] },
      { deleted_target_presets: ["old", "theirs"], deleted_source_presets: ["tap"] },
    );
    expect(out.deleted_target_presets).toEqual(["old"]);
    expect(out.deleted_source_presets).toEqual([]);
  });

  test("source water key and values travel together", () => {
    const tap = { calcium: 40 };
    const volvic = { calcium: 12 };
    // Untouched here: both from the cloud.
    expect(
      selections(
        { source_preset: "tap", source_water: tap },
        { source_preset: "tap", source_water: tap },
        { source_preset: "volvic", source_water: volvic },
      ),
    ).toEqual({ source_preset: "volvic", source_water: volvic });
    // Only the values were typed over here: the key stays this device's too.
    expect(
      selections(
        { source_preset: "tap", source_water: tap },
        { source_preset: "tap", source_water: { calcium: 41 } },
        { source_preset: "volvic", source_water: volvic },
      ),
    ).toEqual({ source_preset: "tap", source_water: { calcium: 41 } });
  });

  test("a field with no base, or with nothing in the cloud, is sent as this device holds it", () => {
    expect(settings({}, { theme: "light" }, { theme: "dark" })).toEqual({ theme: "light" });
    expect(
      settings(
        { selected_minerals: ["a"] },
        { selected_minerals: ["a"] },
        { selected_minerals: null },
      ),
    ).toEqual({ selected_minerals: ["a"] });
  });

  test("a payload field the kind tables do not list is still sent, as local", () => {
    expect(settings({ brand_new: 1 }, { brand_new: 1 }, { brand_new: 2 })).toEqual({
      brand_new: 1,
    });
  });

  test("user_id and updated_at are left to the caller", () => {
    expect(
      settings(
        { theme: "dark" },
        { user_id: "u", updated_at: "now", theme: "dark" },
        { theme: "x" },
      ),
    ).toEqual({ theme: "x" });
  });

  test("every payload field has a kind, so a new one is classified on purpose", () => {
    const skip = (k: string) => k !== "user_id" && k !== "updated_at";
    expect(Object.keys(buildSettingsPayload(USER, "")).filter(skip).sort()).toEqual(
      Object.keys(SETTINGS_PUSH_KINDS).sort(),
    );
    expect(Object.keys(buildSelectionsPayload(USER, "")).filter(skip).sort()).toEqual(
      Object.keys(SELECTIONS_PUSH_KINDS).sort(),
    );
  });
});

describe("baseAfterUnsyncedPull", () => {
  const next = (
    base: Record<string, unknown>,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    cloudRow: Record<string, unknown>,
  ) => baseAfterUnsyncedPull(SETTINGS_PUSH_KINDS, base, before, after, cloudRow);

  test("with nothing surviving, it is the payload after the pull", () => {
    const after = { user_id: "u", theme: "light", selected_minerals: ["a"], drafts: {} };
    expect(
      next(
        { theme: "dark", selected_minerals: ["a"], drafts: {} },
        { ...after, theme: "dark" },
        after,
        after,
      ),
    ).toEqual(after);
  });

  test("a value the pull applied advances; a local edit that survived keeps its old base", () => {
    expect(
      next(
        { theme: "dark", creator_display_name: "" },
        // Edited here: the name. Not edited: the theme.
        { theme: "dark", creator_display_name: "Kyle" },
        // The pull brought a new theme; the cloud's name was empty, so the edit stayed.
        { theme: "light", creator_display_name: "Kyle" },
        { theme: "light", creator_display_name: "" },
      ),
    ).toEqual({ theme: "light", creator_display_name: "" });
  });

  test("a local edit the pull overwrote advances with it", () => {
    expect(
      next(
        { brew_method: "filter" },
        { brew_method: "espresso" },
        { brew_method: "filter" },
        { brew_method: "filter" },
      ),
    ).toEqual({ brew_method: "filter" });
    expect(
      next(
        { theme: "system" },
        { theme: "light" },
        { theme: "dark", updated_at: "x" },
        { theme: "dark" },
      ),
    ).toEqual({ theme: "dark" });
  });

  test("an edit the account already held is the account's value, not an unsynced one", () => {
    // Saved here while the pull was fetching; the row it read held the same.
    expect(
      next(
        { mineral_display_mode: "standard" },
        { mineral_display_mode: "advanced" },
        { mineral_display_mode: "advanced" },
        { mineral_display_mode: "advanced" },
      ),
    ).toEqual({ mineral_display_mode: "advanced" });
    expect(
      next(
        { volume_preferences: {} },
        { volume_preferences: { recipe: { value: "750" } } },
        { volume_preferences: { recipe: { value: "750" } } },
        { volume_preferences: { recipe: { value: "750" } } },
      ),
    ).toEqual({ volume_preferences: { recipe: { value: "750" } } });
  });

  test("maps go key by key: a surviving new key stays unsynced, pulled keys advance", () => {
    expect(
      next(
        { volume_preferences: { calculator: { value: "1" } } },
        { volume_preferences: { calculator: { value: "1" }, recipe: { value: "750" } } },
        { volume_preferences: { calculator: { value: "2" }, recipe: { value: "750" } } },
        { volume_preferences: { calculator: { value: "2" } } },
      ),
    ).toEqual({ volume_preferences: { calculator: { value: "2" } } });
  });

  test("a key deleted here that the pull did not bring back stays 'deleted here'", () => {
    expect(
      next(
        { drafts: { a: { v: 1 }, b: { v: 1 } } },
        { drafts: { b: { v: 1 } } },
        { drafts: { b: { v: 2 } } },
        // The account still holds `a`.
        { drafts: { a: { v: 1 }, b: { v: 2 } } },
      ),
    ).toEqual({ drafts: { a: { v: 1 }, b: { v: 2 } } });
    // Deleted here and gone from the account too: nothing left to push.
    expect(
      next(
        { drafts: { a: { v: 1 }, b: { v: 1 } } },
        { drafts: { b: { v: 1 } } },
        { drafts: { b: { v: 2 } } },
        { drafts: { b: { v: 2 } } },
      ),
    ).toEqual({ drafts: { b: { v: 2 } } });
  });

  test("a field with no base that survived stays without one", () => {
    expect(next({}, { theme: "light" }, { theme: "light" }, {})).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// The four database functions a connected AI app writes through, applied to
// the fake cloud the way the SQL does it (supabase/migrations/
// 20261123013834_mcp_save_concentrate.sql, 20261123180000_mcp_set_selections.sql).
// ---------------------------------------------------------------------------

const AI_SPEC = {
  label: "AI concentrate",
  bottleMl: 100,
  doseGramsPerL: 4,
  minerals: [{ mineralId: "gypsum", grams: 1 }],
};
const VOLVIC = {
  calcium: 12,
  magnesium: 8,
  potassium: 6,
  sodium: 12,
  sulfate: 9,
  chloride: 15,
  bicarbonate: 74,
};

const ai = {
  // mcp_save_concentrate: sets ONE key in one of the two concentrate maps.
  saveConcentrate(key = "ai", spec: Record<string, unknown> = AI_SPEC): void {
    cloud.outsideWrite("user_settings", (row) => {
      row.stock_concentrate_specs = { ...(row.stock_concentrate_specs || {}), [key]: spec };
    });
  },
  // mcp_set_enabled: adds or removes ONE id in one of the two selected lists.
  setEnabled(field: "selected_minerals" | "selected_concentrates", id: string, on: boolean): void {
    cloud.outsideWrite("user_settings", (row) => {
      const list: string[] = (row[field] || []).filter((x: string) => x !== id);
      row[field] = on ? [...list, id] : list;
    });
  },
  // mcp_set_active_recipe: target_preset, maybe the rail, maybe brew_method.
  setActiveRecipe(slug: string, brewMethod?: string): void {
    cloud.outsideWrite("user_selections", (row) => {
      row.target_preset = slug;
      const added: string[] = row.added_target_presets || [];
      if (!added.includes(slug)) row.added_target_presets = [...added, slug];
    });
    if (brewMethod) {
      cloud.outsideWrite("user_settings", (row) => {
        row.brew_method = brewMethod;
      });
    }
  },
  // mcp_set_active_source_water: the key and its values, together.
  setActiveSourceWater(key: string, water: Record<string, number>): void {
    cloud.outsideWrite("user_selections", (row) => {
      row.source_preset = key;
      row.source_water = water;
    });
  },
};

// Changes a stale device might be holding, none touching what the AI app wrote.
const edits = {
  // user_settings
  volume: () => storage.saveVolumePreference("calculator", 500, "ml"),
  // user_selections
  rail: () => storage.addAddedTargetPreset("sey"),
};

const settingsRow = () => cloud.rows.user_settings;
const selectionsRow = () => cloud.rows.user_selections;

type Case = {
  name: string;
  write: () => void;
  // The stale device's own unrelated change, and proof that it landed.
  edit: () => void;
  editLanded: () => boolean;
  survived: () => boolean;
  // On the device, after it has caught up.
  localHasIt: () => boolean;
};

const volumeLanded = () => JSON.stringify(settingsRow().volume_preferences || {}).includes("500");
const railLanded = () => (selectionsRow().added_target_presets || []).includes("sey");

const CASES: Case[] = [
  {
    name: "mcp_save_concentrate: a new concentrate",
    write: () => ai.saveConcentrate(),
    edit: edits.volume,
    editLanded: volumeLanded,
    survived: () => !!(settingsRow().stock_concentrate_specs || {}).ai,
    localHasIt: () => !!storage.loadStockConcentrateSpecs().ai,
  },
  {
    name: "mcp_set_enabled: a mineral switched on",
    write: () => ai.setEnabled("selected_minerals", "gypsum", true),
    edit: edits.volume,
    editLanded: volumeLanded,
    survived: () => settingsRow().selected_minerals.includes("gypsum"),
    localHasIt: () => storage.loadSelectedMinerals().includes("gypsum"),
  },
  {
    name: "mcp_set_enabled: a mineral switched off",
    write: () => ai.setEnabled("selected_minerals", "epsom-salt", false),
    edit: edits.volume,
    editLanded: volumeLanded,
    survived: () => !settingsRow().selected_minerals.includes("epsom-salt"),
    localHasIt: () => !storage.loadSelectedMinerals().includes("epsom-salt"),
  },
  {
    name: "mcp_set_enabled: a concentrate switched on",
    write: () => {
      ai.saveConcentrate();
      ai.setEnabled("selected_concentrates", "stock:ai", true);
    },
    edit: edits.volume,
    editLanded: volumeLanded,
    survived: () => (settingsRow().selected_concentrates || []).includes("stock:ai"),
    localHasIt: () => storage.loadSelectedConcentrates().includes("stock:ai"),
  },
  {
    name: "mcp_set_active_recipe: the active recipe, added to the rail",
    write: () => ai.setActiveRecipe("rao"),
    edit: edits.rail,
    editLanded: railLanded,
    survived: () =>
      selectionsRow().target_preset === "rao" &&
      (selectionsRow().added_target_presets || []).includes("rao"),
    localHasIt: () =>
      storage.loadTargetPresetName("filter") === "rao" &&
      storage.loadAddedTargetPresets().includes("rao"),
  },
  {
    name: "mcp_set_active_recipe: the brew method it switched",
    write: () => ai.setActiveRecipe("rao", "espresso"),
    edit: edits.volume,
    editLanded: volumeLanded,
    survived: () => settingsRow().brew_method === "espresso",
    localHasIt: () => storage.loadBrewMethod() === "espresso",
  },
  {
    name: "mcp_set_active_source_water: the key and its values",
    write: () => ai.setActiveSourceWater("volvic", VOLVIC),
    edit: edits.rail,
    editLanded: railLanded,
    survived: () =>
      selectionsRow().source_preset === "volvic" && selectionsRow().source_water.calcium === 12,
    localHasIt: () =>
      storage.loadSourcePresetName() === "volvic" && storage.loadSourceWater().calcium === 12,
  },
];

// Two ways a device ends up pushing over a write it has not seen.
type Staleness = "pending" | "idle";
// pending: it held an unsynced change when the AI app wrote.
// idle:    it was in sync, missed the write (Realtime down, app in the
//          background), and the user then changed something.
async function staleDevicePushes(d: Device, c: Case, staleness: Staleness): Promise<void> {
  if (staleness === "pending") act(d, c.edit);
  c.write();
  if (staleness === "idle") act(d, c.edit);
  await push(d);
}

describe("a stale current device no longer undoes a connected AI app's write", () => {
  for (const c of CASES) {
    for (const staleness of ["pending", "idle"] as Staleness[]) {
      test(`${c.name} (${staleness === "pending" ? "device had an unsynced change" : "device was in sync, then edited"})`, async () => {
        newCloud();
        const [a] = await makeDevices(["current"]);
        await staleDevicePushes(a!, c, staleness);
        expect(c.survived(), "the AI app's write is still in the cloud").toBe(true);
        expect(c.editLanded(), "the device's own change landed").toBe(true);
        expect(cloud.log.some((l) => l.startsWith("update "))).toBe(true);

        // The push leaves nothing unsynced, and the next Realtime event (the
        // echo of its own write) brings the AI app's change onto the device.
        expect(dirty(a!)).toBe(false);
        await realtime(a!);
        use(a!);
        expect(c.localHasIt(), "the device shows the AI app's change").toBe(true);
        expect(dirty(a!)).toBe(false);
        expect(c.survived()).toBe(true);
        expect(c.editLanded()).toBe(true);
      });
    }
  }
});

describe("next to a 1.2 device", () => {
  for (const c of CASES) {
    test(`${c.name}: a stale current device keeps it, and the 1.2 device adopts it`, async () => {
      newCloud();
      const [a, old] = await makeDevices(["current", "v1.2"]);
      await staleDevicePushes(a!, c, "pending");
      await settle([a!, old!]);
      for (const d of [a!, old!]) await pageLoad(d);
      await settle([a!, old!]);
      expect(c.survived()).toBe(true);
      expect(c.editLanded()).toBe(true);
      for (const d of [a!, old!]) {
        use(d);
        expect(c.localHasIt(), d.name).toBe(true);
        expect(dirty(d), d.name).toBe(false);
      }
    });

    // The limit that remains, pinned so it is not mistaken for fixed: an
    // installed 1.2 app still pushes its whole row. A mix must end exactly as
    // two 1.2 devices do.
    test(`${c.name}: a stale 1.2 device still undoes it, no differently than before`, async () => {
      const sequence = async (versions: Version[]) => {
        newCloud();
        const [old, other] = await makeDevices(versions);
        await staleDevicePushes(old!, c, "pending");
        await settle([old!, other!]);
        for (const d of [old!, other!]) await pageLoad(d);
        await settle([old!, other!]);
        return {
          survived: c.survived(),
          editLanded: c.editLanded(),
          settings: { ...settingsRow(), updated_at: null },
          selections: { ...selectionsRow(), updated_at: null },
        };
      };
      const baseline = await sequence(["v1.2", "v1.2"]);
      expect(baseline.survived).toBe(false);
      expect(await sequence(["v1.2", "current"])).toEqual(baseline);
    });
  }
});

describe("when the device changed the same thing, its own change wins", () => {
  test("it switched the same concentrate's spec", async () => {
    newCloud();
    const [a] = await makeDevices(["current"]);
    act(a!, () => storage.saveStockConcentrateSpecs({ ai: { ...AI_SPEC, bottleMl: 250 } as any }));
    await push(a!);
    act(a!, () => storage.saveStockConcentrateSpecs({ ai: { ...AI_SPEC, bottleMl: 300 } as any }));
    ai.saveConcentrate("ai", { ...AI_SPEC, bottleMl: 999 });
    ai.saveConcentrate("other");
    await push(a!);
    expect(settingsRow().stock_concentrate_specs.ai.bottleMl).toBe(300);
    expect(settingsRow().stock_concentrate_specs.other).toBeTruthy();
  });

  test("it typed over the Starting Water: key and values both stay the device's", async () => {
    newCloud();
    const [a] = await makeDevices(["current"]);
    act(a!, () => storage.saveSourceWater({ ...storage.loadSourceWater(), calcium: 33 }));
    const key = storage.loadSourcePresetName();
    ai.setActiveSourceWater("volvic", VOLVIC);
    ai.setActiveRecipe("rao");
    await push(a!);
    expect(selectionsRow().source_preset).toBe(key);
    expect(selectionsRow().source_water.calcium).toBe(33);
    // The recipe the AI app chose is untouched by that.
    expect(selectionsRow().target_preset).toBe("rao");
  });

  test("it deleted a concentrate: the delete holds, the AI app's other concentrate stays", async () => {
    newCloud();
    const [a] = await makeDevices(["current"]);
    act(a!, () => storage.saveStockConcentrateSpecs({ mine: AI_SPEC as any }));
    await push(a!);
    act(a!, () => storage.saveStockConcentrateSpecs({}));
    ai.saveConcentrate("ai");
    await push(a!);
    expect(Object.keys(settingsRow().stock_concentrate_specs)).toEqual(["ai"]);
  });
});

// ---------------------------------------------------------------------------
// What must not have changed
// ---------------------------------------------------------------------------

describe("deletes are pushed exactly as before", () => {
  test("a stale device's selections push still replaces the cloud's delete lists with its own", async () => {
    const sequence = async (version: Version) => {
      newCloud();
      const [a] = await makeDevices([version]);
      // Another writer recorded deletes this device has not seen.
      cloud.outsideWrite("user_selections", (row) => {
        row.deleted_target_presets = ["gone"];
        row.deleted_source_presets = ["tap"];
      });
      act(a!, edits.rail);
      await push(a!);
      return {
        targets: selectionsRow().deleted_target_presets,
        sources: selectionsRow().deleted_source_presets,
      };
    };
    const old = await sequence("v1.2");
    expect(old).toEqual({ targets: [], sources: [] });
    expect(await sequence("current")).toEqual(old);
  });
});

describe("pushes that still send the whole row", () => {
  const writes = () => cloud.log.filter((l) => /^(upsert|update) user_/.test(l));

  test("a device with no base (nothing synced yet for that row)", async () => {
    newCloud();
    g.localStorage.setItem("cw_synced_user_id", USER);
    await pushAllToCloud();
    expect(writes()).toEqual(["upsert user_settings", "upsert user_selections"]);
  });

  test("the first-login merge's own push, even with a base and a cloud row", async () => {
    newCloud();
    const [a] = await makeDevices(["current"]);
    ai.saveConcentrate();
    act(a!, edits.volume);
    cloud.log.length = 0;
    await pushAllToCloud({ allowBeforeMerge: true });
    expect(writes()).toEqual(["upsert user_settings"]);
    // Whole row: this is the "Keep both" push, which folds the cloud's
    // concentrates in beforehand (foldCloudConcentratesIntoLocal).
    expect((settingsRow().stock_concentrate_specs || {}).ai).toBeUndefined();
  });

  test("a row that has vanished from the cloud is seeded again", async () => {
    newCloud();
    const [a] = await makeDevices(["current"]);
    cloud.rows.user_settings = null;
    act(a!, edits.volume);
    cloud.log.length = 0;
    await push(a!);
    expect(writes()).toEqual(["upsert user_settings"]);
    expect(volumeLanded()).toBe(true);
  });

  test("a base that cannot be read", async () => {
    newCloud();
    const [a] = await makeDevices(["current"]);
    act(a!, edits.volume);
    use(a!);
    g.localStorage.setItem("cw_last_pushed_settings", "{not json");
    cloud.log.length = 0;
    await pushAllToCloud();
    expect(writes()).toEqual(["upsert user_settings"]);
  });
});

describe("a device in sync has a base the merge can read", () => {
  test("both snapshots parse, so an ordinary push takes the merged path", async () => {
    newCloud();
    const [a] = await makeDevices(["current", "v1.2"]);
    use(a!);
    for (const key of ["cw_last_pushed_settings", "cw_last_pushed_selections"]) {
      expect(() => JSON.parse(g.localStorage.getItem(key))).not.toThrow();
    }
    act(a!, edits.volume);
    act(a!, edits.rail);
    cloud.log.length = 0;
    await push(a!);
    expect(cloud.log).toEqual(["update user_settings", "update user_selections"]);
  });

  test("a device upgraded from 1.2 starts with a usable base", async () => {
    newCloud();
    // Set up and synced by the 1.2 code, then running current code.
    const [a] = await makeDevices(["v1.2"]);
    a!.version = "current";
    ai.saveConcentrate();
    act(a!, edits.volume);
    await push(a!);
    expect((settingsRow().stock_concentrate_specs || {}).ai).toBeTruthy();
    expect(volumeLanded()).toBe(true);
  });
});

describe("the write is conditional on the row still being the one that was read", () => {
  test("a write landing between the read and the write is kept: the push reads again", async () => {
    newCloud();
    const [a] = await makeDevices(["current"]);
    act(a!, edits.volume);
    // The AI app saves a concentrate after this push has read the row.
    cloud.beforeConditionalWrite.push(() => ai.saveConcentrate());
    await push(a!);
    expect(cloud.log.filter((l) => l.startsWith("update user_settings"))).toEqual([
      "update user_settings (refused: row changed)",
      "update user_settings",
    ]);
    expect((settingsRow().stock_concentrate_specs || {}).ai).toBeTruthy();
    expect(volumeLanded()).toBe(true);
    expect(dirty(a!)).toBe(false);
  });

  test("a row that keeps changing fails the push and leaves the change unsynced", async () => {
    newCloud();
    const [a] = await makeDevices(["current"]);
    act(a!, edits.volume);
    let n = 0;
    cloud.onSingleRowWrite = () => {
      // Someone else writes every time, just before this device's write.
      n += 1;
      cloud.beforeConditionalWrite.push(() => ai.saveConcentrate("k" + n));
    };
    use(a!);
    await expect(pushAllToCloud()).rejects.toThrow(/failed to upsert/);
    expect(n).toBe(3);
    expect(volumeLanded()).toBe(false);
    expect(hasUnpushedChanges()).toBe(true);
    // Nothing of the other writer's was lost, and the next push gets through.
    cloud.onSingleRowWrite = null;
    await push(a!);
    expect(Object.keys(settingsRow().stock_concentrate_specs).sort()).toEqual(["k1", "k2", "k3"]);
    expect(volumeLanded()).toBe(true);
  });

  test("a failed read fails the push without writing", async () => {
    newCloud();
    const [a] = await makeDevices(["current"]);
    act(a!, edits.volume);
    use(a!);
    const from = g.window.supabaseClient.from;
    g.window.supabaseClient.from = (table: string) => {
      const t = from(table);
      if (table !== "user_settings") return t;
      t.select = () => {
        const q: any = {
          eq: () => q,
          maybeSingle: async () => ({ data: null, error: { message: "Failed to fetch" } }),
        };
        return q;
      };
      return t;
    };
    cloud.log.length = 0;
    await expect(pushAllToCloud()).rejects.toThrow(/failed to upsert/);
    expect(cloud.log).toEqual([]);
    expect(hasUnpushedChanges()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Interleavings on one device. Found by review of the merged push: each was
// harmless while a push sent the whole row and is not once it sends a diff
// against a base.
// ---------------------------------------------------------------------------

// Everything the fake cloud does resolves on microtasks.
const flush = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};

describe("a second push of a row while the first is still out waits its turn", () => {
  // The first write to `table` lands in the cloud, but its response is held
  // back until `release` is called, so the push that sent it is still out.
  function holdFirstWriteResponse(table: string): () => void {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const from = g.window.supabaseClient.from;
    let held = false;
    g.window.supabaseClient.from = (name: string) => {
      const t = from(name);
      if (name !== table) return t;
      const update = t.update;
      t.update = (payload: unknown) => {
        const q = update(payload);
        if (held) return q;
        held = true;
        const then = q.then;
        q.then = (resolve: any, reject: any) =>
          then((v: unknown) => gate.then(() => resolve(v)), reject);
        return q;
      };
      return t;
    };
    return release;
  }

  const settingsWrites = () => cloud.log.filter((l) => l === "update user_settings").length;
  const baseMatchesLocal = () =>
    g.localStorage.getItem("cw_last_pushed_settings") ===
    snapshotForCompare(buildSettingsPayload(USER, ""));

  async function syncedDevice(): Promise<void> {
    newCloud();
    const [a] = await makeDevices(["current"]);
    use(a!);
    cloud.log.length = 0;
  }

  test("a setting changed and changed back between them ends as the user left it", async () => {
    await syncedDevice();
    const release = holdFirstWriteResponse("user_settings");

    storage.saveBrewMethod("espresso");
    const first = pushAllToCloud();
    await flush();
    expect(settingsRow().brew_method).toBe("espresso");

    // Back to filter, plus another setting. Against the base the first push
    // started from, brew_method looks untouched; the second push must not
    // build its payload until the first has recorded what it sent.
    storage.saveBrewMethod("filter");
    storage.saveMineralDisplayMode("advanced");
    const second = pushAllToCloud();
    await flush();
    expect(settingsWrites(), "the second push has not written yet").toBe(1);

    release();
    await Promise.all([first, second]);
    expect(settingsWrites()).toBe(2);
    expect(settingsRow().brew_method).toBe("filter");
    expect(settingsRow().mineral_display_mode).toBe("advanced");
    // The base is the later push's, not the earlier one's arriving late.
    expect(baseMatchesLocal()).toBe(true);
    expect(hasUnpushedChanges()).toBe(false);
  });

  test("another writer's concentrate survives both, also when the second changes the same map", async () => {
    await syncedDevice();
    ai.saveConcentrate();
    const release = holdFirstWriteResponse("user_settings");

    edits.volume();
    const first = pushAllToCloud();
    await flush();
    storage.saveStockConcentrateSpecs({ mine: AI_SPEC as any });
    const second = pushAllToCloud();
    await flush();
    release();
    await Promise.all([first, second]);
    expect(Object.keys(settingsRow().stock_concentrate_specs).sort()).toEqual(["ai", "mine"]);
    expect(volumeLanded()).toBe(true);
    expect(hasUnpushedChanges()).toBe(false);
  });

  test("a row's snapshot is recorded when its own write succeeds, not when the other row's does", async () => {
    await syncedDevice();
    // The first push changes both rows; its selections write stays out.
    const release = holdFirstWriteResponse("user_selections");
    storage.saveBrewMethod("espresso");
    edits.rail();
    const first = pushAllToCloud();
    await flush();
    expect(settingsRow().brew_method).toBe("espresso");
    expect(baseMatchesLocal(), "settings base recorded while selections is still out").toBe(true);

    // The settings queue is free: a change back goes out now and is not
    // mistaken for "untouched".
    storage.saveBrewMethod("filter");
    storage.saveMineralDisplayMode("advanced");
    const second = pushAllToCloud();
    await flush();
    expect(settingsRow().brew_method).toBe("filter");
    expect(settingsRow().mineral_display_mode).toBe("advanced");

    release();
    await Promise.all([first, second]);
    expect(railLanded()).toBe(true);
    expect(hasUnpushedChanges()).toBe(false);
  });

  test("a pull that runs while a push is out keeps the base it recorded", async () => {
    await syncedDevice();
    // Another device chose a light theme; this one, not having pulled, holds
    // dark and an unpushed volume.
    cloud.outsideWrite("user_settings", (row) => {
      row.theme = "light";
    });
    edits.volume();
    const release = holdFirstWriteResponse("user_settings");
    const first = pushAllToCloud();
    await flush();
    expect(settingsRow().theme, "the merged write kept the other device's theme").toBe("light");

    // A page-load pull is not in the push queue. It reads the row the push
    // just wrote, applies it, and records the base from that.
    await pullFromCloud();
    expect(storage.loadThemePreference()).toBe("light");
    const baseFromPull = g.localStorage.getItem("cw_last_pushed_settings");

    // The push's answer arrives. Its snapshot was built before the pull and
    // still says dark: it must not replace the pull's base.
    release();
    await first;
    expect(g.localStorage.getItem("cw_last_pushed_settings")).toBe(baseFromPull);
    expect(hasUnpushedChanges()).toBe(false);

    // So a later save does not send "light" over another device's newer choice.
    cloud.outsideWrite("user_settings", (row) => {
      row.theme = "system";
    });
    storage.saveVolumePreference("recipe", 250, "liters");
    await pushAllToCloud();
    expect(settingsRow().theme).toBe("system");
    expect(JSON.stringify(settingsRow().volume_preferences)).toContain("250");
  });

  test("a push that waited does not go out if the device signed out meanwhile", async () => {
    await syncedDevice();
    const release = holdFirstWriteResponse("user_settings");
    storage.saveBrewMethod("espresso");
    const first = pushAllToCloud();
    await flush();
    storage.saveMineralDisplayMode("advanced");
    const second = pushAllToCloud();
    await flush();
    // Sign-out wipes this marker along with the rest of local storage.
    g.localStorage.removeItem("cw_synced_user_id");
    release();
    await first;
    await expect(second).rejects.toThrow(/failed to upsert/);
    expect(settingsWrites()).toBe(1);
    expect(settingsRow().mineral_display_mode).not.toBe("advanced");
  });

  test("a slow request is waited for, not given up on: the next push goes out after it", async () => {
    await syncedDevice();
    // The first settings read answers only when released.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const from = g.window.supabaseClient.from;
    let slowed = false;
    g.window.supabaseClient.from = (name: string) => {
      const t = from(name);
      if (name !== "user_settings") return t;
      const select = t.select;
      t.select = (...args: unknown[]) => {
        const q = select(...args);
        if (slowed) return q;
        slowed = true;
        const maybeSingle = q.maybeSingle;
        q.maybeSingle = async () => {
          await gate;
          return maybeSingle();
        };
        return q;
      };
      return t;
    };
    storage.saveBrewMethod("espresso");
    const first = pushAllToCloud();
    await flush();
    storage.saveBrewMethod("filter");
    storage.saveMineralDisplayMode("advanced");
    const second = pushAllToCloud();
    await flush();
    // However long it takes: no time limit moves the queue on with a request
    // still out, because a request that was given up on can still land.
    vi.advanceTimersByTime(10 * 60 * 1000);
    await flush();
    expect(settingsWrites(), "nothing is written while the first is still out").toBe(0);

    release();
    await Promise.all([first, second]);
    expect(settingsRow().brew_method).toBe("filter");
    expect(settingsRow().mineral_display_mode).toBe("advanced");
    expect(hasUnpushedChanges()).toBe(false);
  });
});

describe("a pull that applies over changes this device has not pushed", () => {
  // Run `during` while the pull is reading user_settings, the way a save in
  // the first moments of a page load lands during initSync's pull.
  function duringNextSettingsRead(during: () => void): void {
    const from = g.window.supabaseClient.from;
    let done = false;
    g.window.supabaseClient.from = (table: string) => {
      const t = from(table);
      if (table !== "user_settings") return t;
      const select = t.select;
      t.select = (...args: unknown[]) => {
        if (!done) {
          done = true;
          during();
        }
        return select(...args);
      };
      return t;
    };
  }

  test("what survives the pull is still uploaded by the next push", async () => {
    newCloud();
    const [a] = await makeDevices(["current"]);
    use(a!);
    // The cloud has no volume for this page, so the pull does not overwrite it.
    duringNextSettingsRead(() => storage.saveVolumePreference("recipe", 750, "liters"));
    await pullFromCloud();
    expect(storage.loadVolumePreference("recipe").value).toBe("750");
    expect(hasUnpushedChanges()).toBe(true);

    await pushAllToCloud();
    expect(JSON.stringify(settingsRow().volume_preferences)).toContain("750");
    expect(hasUnpushedChanges()).toBe(false);
  });

  test("a value the pull brought in is not pushed back over another writer's later change", async () => {
    newCloud();
    const [a] = await makeDevices(["current"]);
    use(a!);
    // Another device changed the theme; this one saves a volume mid-pull.
    cloud.outsideWrite("user_settings", (row) => {
      row.theme = "light";
    });
    duringNextSettingsRead(() => storage.saveVolumePreference("recipe", 750, "liters"));
    await pullFromCloud();
    expect(storage.loadThemePreference()).toBe("light");
    expect(hasUnpushedChanges(), "the surviving volume is still unsynced").toBe(true);

    // The theme changes again elsewhere before this device pushes.
    cloud.outsideWrite("user_settings", (row) => {
      row.theme = "dark";
    });
    await pushAllToCloud();
    expect(settingsRow().theme).toBe("dark");
    expect(JSON.stringify(settingsRow().volume_preferences)).toContain("750");
  });

  const settingsWritesLogged = () => cloud.log.filter((l) => / user_settings/.test(l));

  test("a local edit the pull overwrote is not sent again by the next push", async () => {
    newCloud();
    const [a] = await makeDevices(["current"]);
    use(a!);
    expect(settingsRow().mineral_display_mode).toBe("standard");
    // Saved mid-pull, then overwritten: the pull applies the account's "standard".
    duringNextSettingsRead(() => storage.saveMineralDisplayMode("advanced"));
    await pullFromCloud();
    expect(storage.loadMineralDisplayMode()).toBe("standard");
    expect(hasUnpushedChanges()).toBe(false);

    // Another device now chooses "advanced". This device has nothing to push
    // and must not send its "standard" back.
    cloud.outsideWrite("user_settings", (row) => {
      row.mineral_display_mode = "advanced";
    });
    cloud.log.length = 0;
    await pushAllToCloud();
    expect(settingsWritesLogged()).toEqual([]);
    expect(settingsRow().mineral_display_mode).toBe("advanced");
  });

  test("an edit the pull's row already held is not left marked unsynced", async () => {
    newCloud();
    const [a] = await makeDevices(["current"]);
    use(a!);
    cloud.outsideWrite("user_settings", (row) => {
      row.mineral_display_mode = "advanced";
    });
    // Saved here mid-pull; the row the pull read holds the same value.
    duringNextSettingsRead(() => storage.saveMineralDisplayMode("advanced"));
    await pullFromCloud();
    expect(storage.loadMineralDisplayMode()).toBe("advanced");
    expect(hasUnpushedChanges()).toBe(false);

    // Another device goes back to "standard": this device must not undo that.
    cloud.outsideWrite("user_settings", (row) => {
      row.mineral_display_mode = "standard";
    });
    cloud.log.length = 0;
    await pushAllToCloud();
    expect(settingsWritesLogged()).toEqual([]);
    expect(settingsRow().mineral_display_mode).toBe("standard");
  });

  test("a device with no base still adopts the account's rows and has nothing to push", async () => {
    newCloud();
    const [a] = await makeDevices(["current"]);
    use(a!);
    g.localStorage.removeItem("cw_last_pushed_settings");
    g.localStorage.removeItem("cw_last_pushed_selections");
    storage.saveBrewMethod("espresso");
    vi.clearAllTimers();
    await pullFromCloud();
    expect(storage.loadBrewMethod()).toBe("filter");
    expect(hasUnpushedChanges()).toBe(false);
  });

  test("a pull with nothing unpushed refreshes the base as it always did", async () => {
    newCloud();
    const [a] = await makeDevices(["current"]);
    ai.saveConcentrate();
    use(a!);
    await pullFromCloud();
    expect(storage.loadStockConcentrateSpecs().ai).toBeTruthy();
    expect(hasUnpushedChanges()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A trade-off the merged push makes next to an old app, pinned so that it is
// a decision on record and not a surprise (see mergeDictForPush in sync.ts).
// ---------------------------------------------------------------------------

describe("known trade-off next to a stale 1.2 device", () => {
  test("a concentrate wiped by the 1.2 device's whole-row push is not put back by a current device that pushes before it pulls", async () => {
    const sequence = async (versions: Version[]) => {
      newCloud();
      const [n, old] = await makeDevices(versions);
      act(n!, () => storage.saveStockConcentrateSpecs({ mine: AI_SPEC as any }));
      await push(n!);
      // The 1.2 device never pulled the concentrate. It switches a mineral on
      // and pushes its whole row, concentrate map included.
      act(old!, () => storage.saveSelectedMinerals([...storage.loadSelectedMinerals(), "gypsum"]));
      await push(old!);
      // The first device changes something else and pushes before pulling.
      act(n!, edits.volume);
      await push(n!);
      await settle([n!, old!]);
      for (const d of [n!, old!]) await pageLoad(d);
      await settle([n!, old!]);
      return {
        concentrate: !!(settingsRow().stock_concentrate_specs || {}).mine,
        mineralSwitch: settingsRow().selected_minerals.includes("gypsum"),
      };
    };
    // Two 1.2 devices: the first device's whole row puts the concentrate back
    // and undoes the other's switch.
    expect(await sequence(["v1.2", "v1.2"])).toEqual({ concentrate: true, mineralSwitch: false });
    // A current first device keeps the switch and does not put the
    // concentrate back: one loss either way, a different one. (Had the first
    // device pulled before pushing, the concentrate was gone on both.)
    expect(await sequence(["current", "v1.2"])).toEqual({
      concentrate: false,
      mineralSwitch: true,
    });
  });
});

// ---------------------------------------------------------------------------
// A change the server never confirmed. The write may have landed; the device
// was not told. Until a push of that row succeeds, what the device changed
// (which fields, map keys and list items, not their values) stays on record
// and counts as changed here whatever the base says.
// ---------------------------------------------------------------------------

describe("ownChangesOf", () => {
  const changes = (base: Record<string, unknown>, local: Record<string, unknown>) =>
    ownChangesOf(SETTINGS_PUSH_KINDS, base, local);

  test("names changed fields, and inside maps and lists the keys and items", () => {
    expect(
      changes(
        {
          brew_method: "filter",
          theme: "dark",
          stock_concentrate_specs: { a: { v: 1 }, gone: { v: 1 }, same: { v: 1 } },
          selected_minerals: ["a", "b"],
        },
        {
          brew_method: "espresso",
          theme: "dark",
          stock_concentrate_specs: { a: { v: 2 }, same: { v: 1 }, added: { v: 9 } },
          selected_minerals: ["a", "c"],
        },
      ),
    ).toEqual({
      fields: ["brew_method"],
      keys: { stock_concentrate_specs: ["a", "added", "gone"] },
      items: { selected_minerals: ["c", "b"] },
    });
  });

  test("names nothing it is only carrying, has no base for, or always sends whole", () => {
    expect(
      ownChangesOf(
        SELECTIONS_PUSH_KINDS,
        { target_preset: "sca", deleted_target_presets: [] },
        // No base for added_target_presets; the delete lists are sent whole.
        { target_preset: "sca", deleted_target_presets: ["x"], added_target_presets: ["rao"] },
      ),
    ).toEqual({ fields: [], keys: {}, items: {} });
  });

  test("a list in another order is named whole", () => {
    expect(changes({ selected_minerals: ["a", "b"] }, { selected_minerals: ["b", "a"] })).toEqual({
      fields: ["selected_minerals"],
      keys: {},
      items: {},
    });
  });

  test("extra fields can be named regardless", () => {
    expect(
      ownChangesOf(SETTINGS_PUSH_KINDS, { brew_method: "filter" }, { brew_method: "filter" }, [
        "brew_method",
      ]),
    ).toEqual({ fields: ["brew_method"], keys: {}, items: {} });
  });

  test("combineOwnChanges unions entries", () => {
    expect(
      combineOwnChanges([
        { fields: ["a"], keys: { m: ["k1"] }, items: { l: ["x"] } },
        { fields: ["a", "b"], keys: { m: ["k2"], n: ["k"] }, items: { l: ["x", "y"] } },
      ]),
    ).toEqual({
      fields: ["a", "b"],
      keys: { m: ["k1", "k2"], n: ["k"] },
      items: { l: ["x", "y"] },
    });
  });
});

describe("mergeRowForPush with changes on record", () => {
  const settings = (
    base: Record<string, unknown>,
    local: Record<string, unknown>,
    cloudRow: Record<string, unknown>,
    own: { fields?: string[]; keys?: Record<string, string[]>; items?: Record<string, unknown[]> },
  ) =>
    mergeRowForPush(SETTINGS_PUSH_KINDS, [], base, local, cloudRow, {
      fields: own.fields || [],
      keys: own.keys || {},
      items: own.items || {},
    });

  test("a field put back to its base value still goes out as the device holds it", () => {
    expect(
      settings(
        { brew_method: "filter" },
        { brew_method: "filter" },
        { brew_method: "espresso" },
        { fields: ["brew_method"] },
      ),
    ).toEqual({ brew_method: "filter" });
  });

  test("a map key on record is the device's, present or deleted; other keys merge as usual", () => {
    const out = settings(
      { stock_concentrate_specs: {} },
      // "mine" was added in a send that got no answer, then deleted again.
      { stock_concentrate_specs: {} },
      // The row: that send landed, and another writer saved "ai".
      { stock_concentrate_specs: { mine: { v: 9 }, ai: { v: 1 } } },
      { keys: { stock_concentrate_specs: ["mine"] } },
    );
    expect(out.stock_concentrate_specs).toEqual({ ai: { v: 1 } });
  });

  test("a list item on record is the device's, in or out; other items merge as usual", () => {
    const out = settings(
      { selected_minerals: ["a"] },
      // "mine" was switched on in a send that got no answer, then off again.
      { selected_minerals: ["a"] },
      { selected_minerals: ["a", "mine", "theirs"] },
      { items: { selected_minerals: ["mine"] } },
    );
    expect(out.selected_minerals).toEqual(["a", "theirs"]);
  });

  test("with nothing on record it is the plain merge", () => {
    expect(
      settings(
        { brew_method: "filter" },
        { brew_method: "filter" },
        { brew_method: "espresso" },
        {},
      ),
    ).toEqual({ brew_method: "espresso" });
  });
});

describe("a write the server committed without the device hearing back", () => {
  // The next write to `table` is sent, but the device is told the request
  // failed, as when the connection drops after the request went out. `lands`
  // says whether the server got it.
  function loseNextAnswer(table: string, lands: boolean): void {
    const from = g.window.supabaseClient.from;
    let done = false;
    g.window.supabaseClient.from = (name: string) => {
      const t = from(name);
      if (name !== table) return t;
      const update = t.update;
      t.update = (payload: unknown) => {
        if (done) return update(payload);
        done = true;
        const lost = { data: null, error: { message: "TypeError: Failed to fetch" } };
        if (!lands) {
          const q: any = { eq: () => q, is: () => q, select: () => q };
          q.then = (resolve: any) => Promise.resolve(lost).then(resolve);
          return q;
        }
        const q = update(payload);
        const then = q.then;
        q.then = (resolve: any, reject: any) => then(() => resolve(lost), reject);
        return q;
      };
      return t;
    };
  }

  const settingsWrites = () => cloud.log.filter((l) => l === "update user_settings").length;

  async function syncedDevice(): Promise<void> {
    newCloud();
    const [a] = await makeDevices(["current"]);
    use(a!);
    cloud.log.length = 0;
  }

  test("the value set back, plus another change: both reach the account before the device reports synced", async () => {
    await syncedDevice();
    loseNextAnswer("user_settings", true);
    storage.saveBrewMethod("espresso");
    await expect(pushAllToCloud()).rejects.toThrow(/failed to upsert/);
    expect(settingsRow().brew_method).toBe("espresso");
    expect(hasUnpushedChanges()).toBe(true);

    storage.saveBrewMethod("filter");
    edits.volume();
    expect(hasUnpushedChanges()).toBe(true);
    await pushAllToCloud();
    expect(settingsRow().brew_method).toBe("filter");
    expect(volumeLanded()).toBe(true);
    expect(hasUnpushedChanges()).toBe(false);
  });

  test("the value set back and nothing else: the device still does not report synced until it is undone", async () => {
    await syncedDevice();
    loseNextAnswer("user_settings", true);
    storage.saveBrewMethod("espresso");
    await pushAllToCloud().catch(() => {});
    storage.saveBrewMethod("filter");
    // Local storage equals the base again, but the account holds espresso.
    expect(hasUnpushedChanges()).toBe(true);
    await pushAllToCloud();
    expect(settingsRow().brew_method).toBe("filter");
    expect(hasUnpushedChanges()).toBe(false);
  });

  test("the write did land and the value was kept: the next push finds it there and writes nothing", async () => {
    await syncedDevice();
    loseNextAnswer("user_settings", true);
    storage.saveBrewMethod("espresso");
    await pushAllToCloud().catch(() => {});
    const before = settingsWrites();
    await pushAllToCloud();
    expect(settingsWrites()).toBe(before);
    expect(settingsRow().brew_method).toBe("espresso");
    expect(hasUnpushedChanges()).toBe(false);
  });

  test("the write never landed: the next push sends it", async () => {
    await syncedDevice();
    loseNextAnswer("user_settings", false);
    storage.saveBrewMethod("espresso");
    await pushAllToCloud().catch(() => {});
    expect(settingsRow().brew_method).toBe("filter");
    expect(hasUnpushedChanges()).toBe(true);
    await pushAllToCloud();
    expect(settingsRow().brew_method).toBe("espresso");
    expect(hasUnpushedChanges()).toBe(false);
  });

  test("another writer's later change is not mistaken for the lost write", async () => {
    await syncedDevice();
    loseNextAnswer("user_settings", true);
    storage.saveBrewMethod("espresso");
    await pushAllToCloud().catch(() => {});
    // Someone else then sets the display mode and saves a concentrate.
    cloud.outsideWrite("user_settings", (row) => {
      row.mineral_display_mode = "advanced";
    });
    ai.saveConcentrate();
    storage.saveBrewMethod("filter");
    await pushAllToCloud();
    expect(settingsRow().brew_method).toBe("filter");
    expect(settingsRow().mineral_display_mode).toBe("advanced");
    expect(settingsRow().stock_concentrate_specs.ai).toBeTruthy();
  });

  test("two writes in a row lost: the first is still allowed for", async () => {
    await syncedDevice();
    loseNextAnswer("user_settings", true);
    storage.saveBrewMethod("espresso");
    await pushAllToCloud().catch(() => {});
    // Set back; this write does not reach the server at all.
    loseNextAnswer("user_settings", false);
    storage.saveBrewMethod("filter");
    await pushAllToCloud().catch(() => {});
    expect(settingsRow().brew_method).toBe("espresso");
    await pushAllToCloud();
    expect(settingsRow().brew_method).toBe("filter");
    expect(hasUnpushedChanges()).toBe(false);
  });

  test("a refusal keeps the change on record until a push of that row succeeds", async () => {
    await syncedDevice();
    cloud.onSingleRowWrite = () => ({ error: { message: "permission denied", code: "42501" } });
    storage.saveBrewMethod("espresso");
    await pushAllToCloud().catch(() => {});
    cloud.onSingleRowWrite = null;
    storage.saveBrewMethod("filter");
    // Back to the base value, but the device has not seen a push succeed.
    expect(hasUnpushedChanges()).toBe(true);
    const before = settingsWrites();
    await pushAllToCloud();
    // The row holds filter already: nothing to write, and nothing left over.
    expect(settingsWrites()).toBe(before);
    expect(g.localStorage.getItem("cw_pending_push_settings")).toBeNull();
    expect(hasUnpushedChanges()).toBe(false);
  });

  // The record names what the device changed, not what the push carried.
  // (Recording the whole payload once turned a carried-over concentrate into
  // a local deletion on the retry.)
  test("a concentrate another writer saved, carried in the lost write, survives the retry", async () => {
    await syncedDevice();
    ai.saveConcentrate();
    loseNextAnswer("user_settings", true);
    edits.volume();
    await pushAllToCloud().catch(() => {});
    expect(settingsRow().stock_concentrate_specs.ai, "carried through by the merge").toBeTruthy();
    // Still not pulled: this device does not hold the concentrate itself.
    expect(storage.loadStockConcentrateSpecs().ai).toBeUndefined();

    storage.saveVolumePreference("recipe", 250, "liters");
    await pushAllToCloud();
    expect(settingsRow().stock_concentrate_specs.ai).toBeTruthy();
    expect(volumeLanded()).toBe(true);
    expect(JSON.stringify(settingsRow().volume_preferences)).toContain("250");
    expect(hasUnpushedChanges()).toBe(false);
  });

  test("a switch another writer made, carried in the lost write, survives the retry too", async () => {
    await syncedDevice();
    ai.setEnabled("selected_minerals", "gypsum", true);
    ai.setActiveSourceWater("volvic", VOLVIC);
    loseNextAnswer("user_settings", true);
    edits.volume();
    edits.rail();
    await pushAllToCloud().catch(() => {});
    storage.saveVolumePreference("recipe", 250, "liters");
    await pushAllToCloud();
    expect(settingsRow().selected_minerals).toContain("gypsum");
    expect(selectionsRow().source_preset).toBe("volvic");
    expect(railLanded()).toBe(true);
  });

  test("signing out while the push is reading the row leaves nothing behind in local storage", async () => {
    await syncedDevice();
    edits.volume();
    // Sign-out wipes local storage while the row read is on the network.
    const from = g.window.supabaseClient.from;
    let wiped = false;
    g.window.supabaseClient.from = (name: string) => {
      const t = from(name);
      if (name !== "user_settings" || wiped) return t;
      const select = t.select;
      t.select = (...args: unknown[]) => {
        const q = select(...args);
        if (wiped) return q;
        wiped = true;
        const maybeSingle = q.maybeSingle;
        q.maybeSingle = async () => {
          g.localStorage.clear();
          return maybeSingle();
        };
        return q;
      };
      return t;
    };
    await pushAllToCloud().catch(() => {});
    expect(g.localStorage.getItem("cw_pending_push_settings")).toBeNull();
    expect(g.localStorage.getItem("cw_last_pushed_settings")).toBeNull();
  });

  test("an ordinary push leaves no record behind", async () => {
    await syncedDevice();
    edits.volume();
    edits.rail();
    await pushAllToCloud();
    expect(g.localStorage.getItem("cw_pending_push_settings")).toBeNull();
    expect(g.localStorage.getItem("cw_pending_push_selections")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Two tabs of one browser share local storage, and with it the base, but not
// a page's queue.
// ---------------------------------------------------------------------------

describe("two tabs", () => {
  // The Web Locks API as the browser gives it to every tab of one origin.
  function fakeLocks() {
    const tails: Record<string, Promise<unknown>> = {};
    return {
      request: (name: string, callback: () => Promise<unknown>) => {
        const run = (tails[name] || Promise.resolve()).then(callback, callback);
        tails[name] = run.then(
          () => {},
          () => {},
        );
        return run;
      },
    };
  }

  // A second copy of the sync and storage modules: another tab. It shares the
  // global localStorage and the account with the first.
  async function openSecondTab() {
    const account = g.window.supabaseClient;
    g.window.supabaseClient = savedClient;
    vi.resetModules();
    const sync = await import("../src/lib/sync");
    const tabStorage = await import("../src/lib/storage");
    g.window.supabaseClient = account;
    return { sync, storage: tabStorage };
  }

  function holdFirstSettingsAnswer(): () => void {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const from = g.window.supabaseClient.from;
    let held = false;
    g.window.supabaseClient.from = (name: string) => {
      const t = from(name);
      if (name !== "user_settings") return t;
      const update = t.update;
      t.update = (payload: unknown) => {
        const q = update(payload);
        if (held) return q;
        held = true;
        const then = q.then;
        q.then = (resolve: any, reject: any) =>
          then((v: unknown) => gate.then(() => resolve(v)), reject);
        return q;
      };
      return t;
    };
    return release;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function scenario(withLocks: boolean) {
    if (withLocks) vi.stubGlobal("navigator", { locks: fakeLocks() });
    newCloud();
    const [a] = await makeDevices(["current"]);
    use(a!);
    cloud.log.length = 0;
    const tabB = await openSecondTab();
    const release = holdFirstSettingsAnswer();

    // Tab A saves espresso; the write lands, the answer is still out.
    storage.saveBrewMethod("espresso");
    const first = pushAllToCloud();
    await flush();
    expect(settingsRow().brew_method).toBe("espresso");

    // Tab B: back to filter, and a new theme.
    tabB.storage.saveBrewMethod("filter");
    tabB.storage.saveThemePreference("dark");
    const second = tabB.sync.pushAllToCloud();
    await flush();
    const wroteBeforeRelease = cloud.log.filter((l) => l === "update user_settings").length;

    release();
    await Promise.all([first, second]);
    return { tabB, wroteBeforeRelease };
  }

  test("with the browser's lock, the second tab waits and the account ends as the user left it", async () => {
    const { tabB, wroteBeforeRelease } = await scenario(true);
    expect(wroteBeforeRelease, "tab B waited for tab A").toBe(1);
    expect(settingsRow().brew_method).toBe("filter");
    expect(settingsRow().theme).toBe("dark");
    expect(tabB.sync.hasUnpushedChanges()).toBe(false);
    expect(g.localStorage.getItem("cw_last_pushed_settings")).toBe(
      tabB.sync.snapshotForCompare(tabB.sync.buildSettingsPayload(USER, "")),
    );
  });

  test("without it, the record of tab A's send still gets tab B's push right", async () => {
    const { tabB, wroteBeforeRelease } = await scenario(false);
    expect(wroteBeforeRelease, "tab B did not wait").toBe(2);
    expect(settingsRow().brew_method).toBe("filter");
    expect(settingsRow().theme).toBe("dark");
    // Tab A answered last. Tab B had recorded the base meanwhile, so tab A's
    // older snapshot does not replace it and nothing is left to push.
    expect(g.localStorage.getItem("cw_last_pushed_settings")).toBe(
      tabB.sync.snapshotForCompare(tabB.sync.buildSettingsPayload(USER, "")),
    );
    expect(tabB.sync.hasUnpushedChanges()).toBe(false);
  });

  test("a browser that has the lock API but refuses it does not stop the push", async () => {
    vi.stubGlobal("navigator", {
      locks: { request: () => Promise.reject(new Error("SecurityError")) },
    });
    newCloud();
    const [a] = await makeDevices(["current"]);
    use(a!);
    edits.volume();
    await pushAllToCloud();
    expect(volumeLanded()).toBe(true);
    expect(hasUnpushedChanges()).toBe(false);
  });

  test("a pull in another tab while this tab's push is out is seen by the push", async () => {
    newCloud();
    const [a] = await makeDevices(["current"]);
    use(a!);
    const tabB = await openSecondTab();
    expect(settingsRow().theme).toBe("system");
    // Hold tab A's read of the row.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const from = g.window.supabaseClient.from;
    let held = false;
    g.window.supabaseClient.from = (name: string) => {
      const t = from(name);
      if (name !== "user_settings") return t;
      const select = t.select;
      t.select = (...args: unknown[]) => {
        const q = select(...args);
        if (held) return q;
        held = true;
        const maybeSingle = q.maybeSingle;
        q.maybeSingle = async () => {
          await gate;
          return maybeSingle();
        };
        return q;
      };
      return t;
    };

    storage.saveThemePreference("light");
    const first = pushAllToCloud();
    await flush();

    // Tab B pulls: it reads "system", applies it over the edit in the local
    // storage both tabs share, and records a base with the same text as
    // before. Nothing in tab A's own memory changes.
    await tabB.sync.pullFromCloud();
    expect(g.localStorage.getItem("cw_theme")).toBe("system");
    const baseFromPull = g.localStorage.getItem("cw_last_pushed_settings");

    release();
    await first;
    expect(settingsRow().theme).toBe("light");
    expect(g.localStorage.getItem("cw_last_pushed_settings")).toBe(baseFromPull);

    // Another device then chooses dark; a later save here must not send the
    // pulled "system" over it.
    cloud.outsideWrite("user_settings", (row) => {
      row.theme = "dark";
    });
    tabB.storage.saveVolumePreference("recipe", 250, "liters");
    await tabB.sync.pushAllToCloud();
    expect(settingsRow().theme).toBe("dark");
    expect(JSON.stringify(settingsRow().volume_preferences)).toContain("250");
  });

  test("without the lock, a tab that finishes does not clear another tab's unconfirmed change", async () => {
    newCloud();
    const [a] = await makeDevices(["current"]);
    use(a!);
    const tabB = await openSecondTab();
    // Tab A's write lands with its answer held; tab B's lands and its answer
    // is lost for good.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const from = g.window.supabaseClient.from;
    let writes = 0;
    g.window.supabaseClient.from = (name: string) => {
      const t = from(name);
      if (name !== "user_settings") return t;
      const update = t.update;
      t.update = (payload: unknown) => {
        const q = update(payload);
        writes += 1;
        const then = q.then;
        if (writes === 1) {
          q.then = (resolve: any, reject: any) =>
            then((v: unknown) => gate.then(() => resolve(v)), reject);
        } else if (writes === 2) {
          q.then = (resolve: any, reject: any) =>
            then(() => resolve({ data: null, error: { message: "Failed to fetch" } }), reject);
        }
        return q;
      };
      return t;
    };

    storage.saveThemePreference("dark");
    const first = pushAllToCloud();
    await flush();
    expect(settingsRow().theme).toBe("dark");

    tabB.storage.saveThemePreference("light");
    await tabB.sync.pushAllToCloud().catch(() => {});
    expect(settingsRow().theme).toBe("light");

    // The user goes back to dark before tab A hears back.
    tabB.storage.saveThemePreference("dark");
    release();
    await first;
    // Local storage equals what tab A recorded, but the account holds light:
    // tab B's change is still on record, so the device is not clean.
    expect(tabB.sync.hasUnpushedChanges()).toBe(true);
    await tabB.sync.pushAllToCloud();
    expect(settingsRow().theme).toBe("dark");
    expect(tabB.sync.hasUnpushedChanges()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The two rows of one choice, when only one of them saved.
// ---------------------------------------------------------------------------

describe("the active choice when only one of its two rows saved", () => {
  test("the unsaved half stays on record and goes out with the next push, once", async () => {
    newCloud();
    const [a] = await makeDevices(["current"]);
    use(a!);
    // Another writer activated an espresso recipe; this device, not having
    // pulled, chooses another filter recipe. Its brew method has not changed,
    // yet must be sent along.
    ai.setActiveRecipe("cafelytic-espresso", "espresso");
    storage.saveTargetPresetName("rao");
    // The settings write is refused outright; the selections write saves.
    cloud.onSingleRowWrite = (table) =>
      table === "user_settings"
        ? { error: { message: "canceling statement due to statement timeout", code: "57014" } }
        : undefined;
    await pushAllToCloud().catch(() => {});
    cloud.onSingleRowWrite = null;
    expect(selectionsRow().target_preset).toBe("rao");
    expect(settingsRow().brew_method).toBe("espresso");
    expect(hasUnpushedChanges(), "the brew method half is still owed").toBe(true);

    await pushAllToCloud();
    expect(settingsRow().brew_method).toBe("filter");
    expect(selectionsRow().target_preset).toBe("rao");
    expect(hasUnpushedChanges()).toBe(false);

    // Both halves are in: nothing is sent again.
    cloud.log.length = 0;
    await pushAllToCloud();
    expect(cloud.log).toEqual([]);
  });

  test("the same when the row that failed is the recipe's", async () => {
    newCloud();
    const [a] = await makeDevices(["current"]);
    use(a!);
    ai.setActiveRecipe("rao");
    // The device switches to espresso; its recipe row is refused.
    storage.saveBrewMethod("espresso");
    storage.saveTargetPresetName("cafelytic-espresso");
    cloud.onSingleRowWrite = (table) =>
      table === "user_selections" ? { error: { message: "refused", code: "57014" } } : undefined;
    await pushAllToCloud().catch(() => {});
    cloud.onSingleRowWrite = null;
    expect(settingsRow().brew_method).toBe("espresso");
    expect(selectionsRow().target_preset).toBe("rao");
    expect(hasUnpushedChanges()).toBe(true);
    await pushAllToCloud();
    expect(selectionsRow().target_preset).toBe("cafelytic-espresso");
    expect(hasUnpushedChanges()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A pull that completes before the push it overlaps has written. The pull
// records a base whose text is the same as before, so only the count of
// refreshes tells the push that its own snapshot is the older view.
// ---------------------------------------------------------------------------

describe("a pull that completes before an overlapping push writes", () => {
  test("the push does not put its snapshot over the pull's base", async () => {
    newCloud();
    const [a] = await makeDevices(["current"]);
    use(a!);
    expect(settingsRow().theme).toBe("system");
    // Hold the push's read of the row.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const from = g.window.supabaseClient.from;
    let held = false;
    g.window.supabaseClient.from = (name: string) => {
      const t = from(name);
      if (name !== "user_settings") return t;
      const select = t.select;
      t.select = (...args: unknown[]) => {
        const q = select(...args);
        if (held) return q;
        held = true;
        const maybeSingle = q.maybeSingle;
        q.maybeSingle = async () => {
          await gate;
          return maybeSingle();
        };
        return q;
      };
      return t;
    };

    storage.saveThemePreference("light");
    const first = pushAllToCloud();
    await flush();

    // A page-load pull reads the row (still "system"), applies it over the
    // local edit and records the base, all before the push has written.
    await pullFromCloud();
    expect(storage.loadThemePreference()).toBe("system");
    const baseFromPull = g.localStorage.getItem("cw_last_pushed_settings");

    release();
    await first;
    // The push sent what the user chose.
    expect(settingsRow().theme).toBe("light");
    expect(g.localStorage.getItem("cw_last_pushed_settings")).toBe(baseFromPull);

    // Another device then chooses dark. This device holds "system" from the
    // pull; a later save must not send that over it.
    cloud.outsideWrite("user_settings", (row) => {
      row.theme = "dark";
    });
    edits.volume();
    await pushAllToCloud();
    expect(settingsRow().theme).toBe("dark");
    expect(volumeLanded()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fields that only make sense together. A whole-row push kept them consistent
// for free; the merge has to put each pair back together.
// ---------------------------------------------------------------------------

describe("the active recipe and the brew method are one choice", () => {
  async function staleDevice(): Promise<void> {
    newCloud();
    const [a] = await makeDevices(["current"]);
    use(a!);
  }
  // mcp_set_active_recipe for an espresso recipe on a filter account.
  const aiActivatesEspressoRecipe = () => ai.setActiveRecipe("cafelytic-espresso", "espresso");

  test("the device chose a recipe too: its recipe and its brew method both stand, and its other change lands", async () => {
    await staleDevice();
    storage.saveTargetPresetName("rao");
    edits.volume();
    aiActivatesEspressoRecipe();
    await pushAllToCloud();
    expect(selectionsRow().target_preset).toBe("rao");
    expect(settingsRow().brew_method).toBe("filter");
    expect(volumeLanded()).toBe(true);
  });

  test("the device changed neither: the other writer's recipe and brew method both stand", async () => {
    await staleDevice();
    edits.volume();
    edits.rail();
    aiActivatesEspressoRecipe();
    await pushAllToCloud();
    expect(selectionsRow().target_preset).toBe("cafelytic-espresso");
    expect(settingsRow().brew_method).toBe("espresso");
    expect(volumeLanded()).toBe(true);
    expect(railLanded()).toBe(true);
  });

  test("the device switched brew method only: its recipe stands with it", async () => {
    await staleDevice();
    const recipe = storage.loadTargetPresetName("filter");
    ai.setActiveRecipe("rao");
    storage.saveBrewMethod("espresso");
    await pushAllToCloud();
    expect(settingsRow().brew_method).toBe("espresso");
    expect(selectionsRow().target_preset).toBe(storage.loadTargetPresetName("espresso"));
    expect(selectionsRow().target_preset).not.toBe("rao");
    expect(recipe).not.toBe("rao");
  });
});

describe("a concentrate and its switch", () => {
  test("settleMergedSettings: an id another writer switched on for a concentrate deleted here is dropped", () => {
    const merged: Record<string, unknown> = {
      stock_concentrate_specs: { other: { v: 1 } },
      diy_concentrate_specs: {},
      selected_concentrates: [
        "stock:house",
        "stock:other",
        "diy:gypsum",
        "brand:lotus:calcium",
        "stock:kept",
      ],
    };
    settleMergedSettings(
      merged,
      {
        stock_concentrate_specs: { house: { v: 1 }, other: { v: 1 }, kept: { v: 1 } },
        diy_concentrate_specs: { gypsum: { v: 1 } },
        selected_concentrates: [],
      },
      {
        // Deleted here: house, kept, and the gypsum Mineral Concentrate.
        stock_concentrate_specs: { other: { v: 1 } },
        diy_concentrate_specs: {},
        // An id this device itself still holds is sent as it is, as a
        // whole-row push did (the app never leaves one behind on delete).
        selected_concentrates: ["stock:kept"],
      },
    );
    expect(merged.selected_concentrates).toEqual([
      "stock:other",
      "brand:lotus:calcium",
      "stock:kept",
    ]);
    expect(merged.stock_concentrate_specs).toEqual({ other: { v: 1 } });
  });

  test("deleted here while another writer switches it on: both are gone, and one made later under the same key starts off", async () => {
    newCloud();
    const [a] = await makeDevices(["current"]);
    use(a!);
    storage.saveStockConcentrateSpecs({ house: AI_SPEC as any });
    await pushAllToCloud();

    storage.saveStockConcentrateSpecs({});
    ai.setEnabled("selected_concentrates", "stock:house", true);
    ai.setEnabled("selected_concentrates", "brand:lotus:calcium", true);
    await pushAllToCloud();
    expect(settingsRow().stock_concentrate_specs.house).toBeUndefined();
    expect(settingsRow().selected_concentrates).toEqual(["brand:lotus:calcium"]);

    await pullFromCloud();
    storage.saveStockConcentrateSpecs({ house: AI_SPEC as any });
    await pushAllToCloud();
    expect(settingsRow().stock_concentrate_specs.house).toBeTruthy();
    expect(settingsRow().selected_concentrates).toEqual(["brand:lotus:calcium"]);
  });

  // Left as it was, on purpose: the delete stands, as for any key this device
  // did not change, and the id stays behind with nothing to switch on.
  test("switched on here while another writer deleted it: the delete stands", async () => {
    newCloud();
    const [a] = await makeDevices(["current"]);
    use(a!);
    storage.saveStockConcentrateSpecs({ house: AI_SPEC as any });
    await pushAllToCloud();

    cloud.outsideWrite("user_settings", (row) => {
      row.stock_concentrate_specs = {};
    });
    storage.saveSelectedConcentrates(["stock:house"]);
    await pushAllToCloud();
    expect(settingsRow().stock_concentrate_specs.house).toBeUndefined();
    expect(settingsRow().selected_concentrates).toEqual(["stock:house"]);
  });
});

describe("an active source water this device has deleted", () => {
  const pick = (
    base: Record<string, unknown>,
    local: Record<string, unknown>,
    cloudRow: Record<string, unknown>,
  ) => {
    const merged = mergeRowForPush(
      SELECTIONS_PUSH_KINDS,
      SELECTIONS_PUSH_GROUPS,
      base,
      local,
      cloudRow,
    );
    settleMergedSelections(merged, base, local);
    return merged;
  };
  const row = (over: Record<string, unknown>) => ({
    source_preset: "distilled",
    source_water: { calcium: 0 },
    target_preset: "sca",
    deleted_source_presets: [],
    deleted_target_presets: [],
    added_target_presets: ["rao"],
    ...over,
  });

  // Left to the app on purpose: taking the device's recipe here would leave
  // it under the other writer's brew method, which lives in the other row.
  // The other writer's pair stays whole; the app, not finding that recipe,
  // picks another and saves the choice, which goes out as the device's pair.
  test("a recipe removed here that another writer made active keeps the other writer's choice", () => {
    expect(
      pick(row({}), row({ deleted_target_presets: ["mine"] }), row({ target_preset: "mine" }))
        .target_preset,
    ).toBe("mine");
    const offRail = pick(row({}), row({ added_target_presets: [] }), row({ target_preset: "rao" }));
    expect(offRail.target_preset).toBe("rao");
    expect(offRail.added_target_presets).toEqual([]);
  });

  test("a source water deleted here that another writer made active: the device's water stands, key and values", () => {
    const out = pick(
      row({}),
      row({ deleted_source_presets: ["tap"] }),
      row({ source_preset: "tap", source_water: { calcium: 40 } }),
    );
    expect(out.source_preset).toBe("distilled");
    expect(out.source_water).toEqual({ calcium: 0 });
  });

  test("anything else another writer made active is kept", () => {
    const out = pick(
      row({}),
      row({ deleted_target_presets: ["other"] }),
      row({ target_preset: "rao", source_preset: "volvic", source_water: { calcium: 12 } }),
    );
    expect(out.target_preset).toBe("rao");
    expect(out.source_preset).toBe("volvic");
  });
});
