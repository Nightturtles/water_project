// The merged push of user_settings and user_selections (src/lib/sync.ts
// pushSingleRows): a device sends only what it changed since it last synced,
// on top of whatever the row holds now, so it no longer undoes a write it has
// not pulled yet. The writer that makes this matter is a connected AI app
// (MCP.md): its database functions change these rows while the app is closed
// or in the background.
//
// In order:
//   - the pure diff and patch (changesSince, applyChanges);
//   - each of the four database functions against a stale device, on current
//     code and next to the frozen 1.2 sync (tests/fixtures/sync-v1.2.ts);
//   - what must NOT have changed: the delete lists, the first-login merge's
//     push, a device with no base, and the conditional write's retry;
//   - the three supports: one push at a time, a pull over an unpushed change,
//     and a push whose answer never arrived;
//   - the active recipe and brew method as one choice.
//
// Browser-global stubs come from tests/setup.js (logged in, localStorage).

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  changesSince,
  combineChanges,
  applyChanges,
  snapshotForCompare,
  type RowChanges,
  type PushFieldKind,
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

type Row = Record<string, unknown>;

// The row a push writes: what `local` changes relative to `base` (plus any
// changes still `pending` from an unconfirmed push), applied to the cloud's row.
const mergedRow =
  (kinds: Record<string, PushFieldKind>, groups: string[][]) =>
  (base: Row, local: Row, cloudRow: Row, pending?: RowChanges) =>
    applyChanges(
      kinds,
      groups,
      cloudRow,
      local,
      combineChanges([changesSince(kinds, base, local)].concat(pending ? [pending] : [])),
      snapshotForCompare(local) !== snapshotForCompare(base),
    );
const settings = mergedRow(SETTINGS_PUSH_KINDS, []);
const selections = mergedRow(SELECTIONS_PUSH_KINDS, SELECTIONS_PUSH_GROUPS);

describe("the row a push writes (changesSince + applyChanges)", () => {
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

  test("with any change to the row, the delete lists go out as this device holds them", () => {
    const out = selections(
      { deleted_target_presets: ["old"], deleted_source_presets: [], added_target_presets: [] },
      {
        deleted_target_presets: ["old"],
        deleted_source_presets: [],
        added_target_presets: ["sey"],
      },
      {
        deleted_target_presets: ["old", "theirs"],
        deleted_source_presets: ["tap"],
        added_target_presets: [],
      },
    );
    expect(out.deleted_target_presets).toEqual(["old"]);
    expect(out.deleted_source_presets).toEqual([]);
  });

  test("with no change to the row, the delete lists stay as the cloud has them", () => {
    const row = { target_preset: "sca", deleted_target_presets: ["old"] };
    // Visited only for a change still pending from an earlier push.
    const out = selections(
      row,
      row,
      { target_preset: "rao", deleted_target_presets: ["old", "theirs"] },
      { fields: ["target_preset"], keys: {}, items: {} },
    );
    expect(out).toEqual({ target_preset: "sca", deleted_target_presets: ["old", "theirs"] });
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

  test("a payload field the kind tables do not list is still sent when the row changes", () => {
    expect(
      settings({ brand_new: 1, theme: "dark" }, { brand_new: 3, theme: "dark" }, { brand_new: 2 }),
    ).toEqual({ brand_new: 3, theme: "dark" });
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

describe("a second push while the first is still out waits its turn", () => {
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
// a decision on record and not a surprise (see applyKeys in sync.ts).
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
// What a device changed, by name: fields, and inside maps and lists the keys
// and items. This is what a push applies to the cloud's row, and what it
// saves until the write is confirmed.
// ---------------------------------------------------------------------------

describe("changesSince", () => {
  test("names changed fields, and inside maps and lists the keys and items", () => {
    expect(
      changesSince(
        SETTINGS_PUSH_KINDS,
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
      keys: { stock_concentrate_specs: ["a", "gone", "added"] },
      items: { selected_minerals: ["c", "b"] },
    });
  });

  test("a field the base has never held is named whole; the delete lists never are", () => {
    expect(
      changesSince(
        SELECTIONS_PUSH_KINDS,
        { target_preset: "sca", deleted_target_presets: [] },
        { target_preset: "sca", deleted_target_presets: ["x"], added_target_presets: ["rao"] },
      ),
    ).toEqual({ fields: ["added_target_presets"], keys: {}, items: {} });
  });

  test("a list in another order is named whole", () => {
    expect(
      changesSince(
        SETTINGS_PUSH_KINDS,
        { selected_minerals: ["a", "b"] },
        { selected_minerals: ["b", "a"] },
      ),
    ).toEqual({ fields: ["selected_minerals"], keys: {}, items: {} });
  });

  test("combineChanges unions them", () => {
    expect(
      combineChanges([
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

describe("a change still pending from an earlier push counts as this device's", () => {
  const pending = (p: Partial<RowChanges>): RowChanges => ({
    fields: p.fields || [],
    keys: p.keys || {},
    items: p.items || {},
  });

  test("a field put back to its base value still goes out as the device holds it", () => {
    expect(
      settings(
        { brew_method: "filter" },
        { brew_method: "filter" },
        { brew_method: "espresso" },
        pending({ fields: ["brew_method"] }),
      ),
    ).toEqual({ brew_method: "filter" });
  });

  test("a map key is the device's, present or deleted; other keys are the cloud's", () => {
    const out = settings(
      { stock_concentrate_specs: {} },
      // "mine" was added in a send that got no answer, then deleted again.
      { stock_concentrate_specs: {} },
      // The row: that send landed, and another writer saved "ai".
      { stock_concentrate_specs: { mine: { v: 9 }, ai: { v: 1 } } },
      pending({ keys: { stock_concentrate_specs: ["mine"] } }),
    );
    expect(out.stock_concentrate_specs).toEqual({ ai: { v: 1 } });
  });

  test("a list item is the device's, in or out; other items are the cloud's", () => {
    const out = settings(
      { selected_minerals: ["a"] },
      // "mine" was switched on in a send that got no answer, then off again.
      { selected_minerals: ["a"] },
      { selected_minerals: ["a", "mine", "theirs"] },
      pending({ items: { selected_minerals: ["mine"] } }),
    );
    expect(out.selected_minerals).toEqual(["a", "theirs"]);
  });
});

// ---------------------------------------------------------------------------
// A push whose answer never arrived. The write may have landed; the device
// was not told. Until a push of that row succeeds, the names of what the
// device changed stay saved and count as changed here whatever the base says.
// ---------------------------------------------------------------------------

async function oneSyncedDevice(): Promise<void> {
  newCloud();
  const [a] = await makeDevices(["current"]);
  use(a!);
  cloud.log.length = 0;
}

// The next conditional write of this row is sent, but the device is told the
// request failed, as when the connection drops after the request went out.
// `lands` says whether the server got it.
function loseNextAnswer(table: "user_settings" | "user_selections", lands: boolean): void {
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

describe("a push whose answer never arrived", () => {
  test("the value set back, plus another change: both reach the account", async () => {
    await oneSyncedDevice();
    loseNextAnswer("user_settings", true);
    storage.saveBrewMethod("espresso");
    await expect(pushAllToCloud()).rejects.toThrow(/failed to upsert/);
    expect(settingsRow().brew_method).toBe("espresso");
    expect(hasUnpushedChanges()).toBe(true);

    storage.saveBrewMethod("filter");
    edits.volume();
    await pushAllToCloud();
    expect(settingsRow().brew_method).toBe("filter");
    expect(volumeLanded()).toBe(true);
    expect(hasUnpushedChanges()).toBe(false);
  });

  test("the value set back and nothing else: the device is unsynced until that is sent", async () => {
    await oneSyncedDevice();
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

  test("the write never landed: the next push sends it", async () => {
    await oneSyncedDevice();
    loseNextAnswer("user_settings", false);
    storage.saveBrewMethod("espresso");
    await pushAllToCloud().catch(() => {});
    expect(settingsRow().brew_method).toBe("filter");
    expect(hasUnpushedChanges()).toBe(true);
    await pushAllToCloud();
    expect(settingsRow().brew_method).toBe("espresso");
    expect(hasUnpushedChanges()).toBe(false);
  });

  test("two in a row lost: the first is still allowed for", async () => {
    await oneSyncedDevice();
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

  test("a refused write is kept the same way until a push of that row succeeds", async () => {
    await oneSyncedDevice();
    cloud.onSingleRowWrite = () => ({ error: { message: "permission denied", code: "42501" } });
    storage.saveBrewMethod("espresso");
    await pushAllToCloud().catch(() => {});
    cloud.onSingleRowWrite = null;
    storage.saveBrewMethod("filter");
    // Back to the base value, but the device has not seen a push succeed.
    expect(hasUnpushedChanges()).toBe(true);
    await pushAllToCloud();
    expect(settingsRow().brew_method).toBe("filter");
    expect(g.localStorage.getItem("cw_pending_push_settings")).toBeNull();
    expect(hasUnpushedChanges()).toBe(false);
  });

  // What is saved is the names of what the device changed, not what the push
  // carried. (Saving the whole payload was tried: a concentrate carried over
  // from the cloud then looked like a local deletion on the retry.)
  test("what another writer saved, carried in the lost write, survives the retry", async () => {
    await oneSyncedDevice();
    ai.saveConcentrate();
    ai.setEnabled("selected_minerals", "gypsum", true);
    loseNextAnswer("user_settings", true);
    edits.volume();
    await pushAllToCloud().catch(() => {});
    expect(settingsRow().stock_concentrate_specs.ai, "carried through by the merge").toBeTruthy();
    // Still not pulled: this device does not hold the concentrate itself.
    expect(storage.loadStockConcentrateSpecs().ai).toBeUndefined();

    storage.saveVolumePreference("recipe", 250, "liters");
    await pushAllToCloud();
    expect(settingsRow().stock_concentrate_specs.ai).toBeTruthy();
    expect(settingsRow().selected_minerals).toContain("gypsum");
    expect(volumeLanded()).toBe(true);
    expect(JSON.stringify(settingsRow().volume_preferences)).toContain("250");
    expect(hasUnpushedChanges()).toBe(false);
  });

  test("signing out while the push is reading the row leaves nothing behind in local storage", async () => {
    await oneSyncedDevice();
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

  test("a push that succeeds leaves nothing saved", async () => {
    await oneSyncedDevice();
    edits.volume();
    edits.rail();
    await pushAllToCloud();
    expect(g.localStorage.getItem("cw_pending_push_settings")).toBeNull();
    expect(g.localStorage.getItem("cw_pending_push_selections")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The delete lists go out whole with any change to the selections row, as on
// every app version. A push that carries no change to that row (it is there
// for its half of the active choice) leaves them alone.
// ---------------------------------------------------------------------------

describe("the delete lists and a row with no change of its own", () => {
  test("changing only the brew method leaves another device's recipe removal alone", async () => {
    await oneSyncedDevice();
    storage.saveTargetPresetName("sca");
    await pushAllToCloud();
    // Another device removes a recipe; this one has not pulled.
    cloud.outsideWrite("user_selections", (row) => {
      row.deleted_target_presets = ["lotus-light-bright"];
      row.deleted_source_presets = ["tap"];
    });
    storage.saveBrewMethod("espresso");
    await pushAllToCloud();
    expect(settingsRow().brew_method).toBe("espresso");
    expect(selectionsRow().target_preset).toBe("sca");
    expect(selectionsRow().deleted_target_presets).toEqual(["lotus-light-bright"]);
    expect(selectionsRow().deleted_source_presets).toEqual(["tap"]);
    expect(hasUnpushedChanges()).toBe(false);
  });

  test("when the recipe half does need writing, nothing else in the row changes", async () => {
    await oneSyncedDevice();
    storage.saveTargetPresetName("sca");
    await pushAllToCloud();
    // Another writer chose a recipe, removed one, picked a source water and
    // added to the rail. This device then changes only its brew method.
    cloud.outsideWrite("user_selections", (row) => {
      row.target_preset = "rao";
      row.deleted_target_presets = ["lotus-light-bright"];
      row.source_preset = "volvic";
      row.source_water = VOLVIC;
      row.added_target_presets = [...(row.added_target_presets || []), "sey"];
    });
    storage.saveBrewMethod("espresso");
    await pushAllToCloud();
    // The device's recipe goes with its brew method...
    expect(settingsRow().brew_method).toBe("espresso");
    expect(selectionsRow().target_preset).toBe("sca");
    // ...and nothing else in the row is this device's to touch.
    expect(selectionsRow().deleted_target_presets).toEqual(["lotus-light-bright"]);
    expect(selectionsRow().source_preset).toBe("volvic");
    expect(selectionsRow().added_target_presets).toContain("sey");
    expect(hasUnpushedChanges()).toBe(false);
  });

  test("an ordinary push of the selections row still sends the delete lists whole", async () => {
    await oneSyncedDevice();
    cloud.outsideWrite("user_selections", (row) => {
      row.deleted_target_presets = ["lotus-light-bright"];
    });
    // A real change in this row: as on every app version, its lists go out.
    edits.rail();
    await pushAllToCloud();
    expect(selectionsRow().deleted_target_presets).toEqual([]);
    expect(railLanded()).toBe(true);
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
