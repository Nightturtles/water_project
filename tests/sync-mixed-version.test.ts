// Mixed-version sync: the current src/lib/sync.ts on one device next to the
// sync code already shipped in the iOS apps (tests/fixtures/sync-v1.2.ts) on
// another, sharing one account.
//
// Installed apps keep running the old code until each user updates, so any
// change to sync.ts lives next to it for good. The bar these tests hold a
// change to: for the same sequence of user actions and sync events, a mix of
// current and v1.2 devices must never end up worse than v1.2 devices alone.
// "Worse" means: devices that no longer agree, a device left with unsynced
// changes, an account that never goes quiet, a recipe / setting lost or
// brought back that the all-v1.2 run kept or kept deleted, or a deleted
// recipe's row left in the cloud.
//
// The all-v1.2 run is a baseline, not a spec: it has known losses of its own
// (a stale device replays old deletes, whole rows overwrite each other). A
// change may fix those on current devices; it may not add new ones when an
// old app is in the mix.
//
// While src/lib/sync.ts still matches the fixture these pass trivially; they
// start to bite with the first change to it. See tests/helpers/sync-fleet.ts
// for what the simulation can and cannot model.

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
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
  recipe,
  cloudRecipes,
  cloudTombstones,
  localRecipes,
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
// Randomized runs
// ---------------------------------------------------------------------------

function seededRandom(seed: number) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Step = { device: number; op: string; key?: string; value?: number };

const RECIPES = ["r1", "r2", "r3"] as const;
const SETTING_OPS = ["mineral", "rail", "concentrate-spec", "concentrate"] as const;

// A random sequence of user actions (recipe create / edit / delete / re-create
// under the same name, source water, mineral selection, rail, Recipe
// Concentrates) interleaved with sync events (a debounced push, a Realtime
// event, a page load), each on a random device. Devices act on stale state
// whenever their own sync events haven't come up yet.
function makeScript(seed: number, deviceCount: number, steps: number, recipesOnly: boolean) {
  const rand = seededRandom(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const script: Step[] = [];
  for (let i = 0; i < steps; i++) {
    const device = Math.floor(rand() * deviceCount);
    const roll = rand();
    if (roll < 0.45) {
      const ops = recipesOnly
        ? (["save", "save", "delete", "source-water"] as const)
        : (["save", "save", "delete", "source-water", ...SETTING_OPS] as const);
      const op = pick(ops);
      const key =
        op === "save" || op === "delete"
          ? pick(RECIPES)
          : op === "mineral"
            ? pick(["gypsum", "magnesium-chloride", "epsom-salt"])
            : op === "rail"
              ? pick(["rao", "sey"])
              : pick(["x", "y"]);
      script.push({ device, op, key, value: 1 + Math.floor(rand() * 90) });
    } else if (roll < 0.62) script.push({ device, op: "push" });
    else if (roll < 0.85) script.push({ device, op: "realtime" });
    else script.push({ device, op: "page-load" });
  }
  return script;
}

// Apply one user action on the live device. Says what it did to the thing it
// touched, so the run can tell later whether that thing should exist.
function applyAction(step: Step): "add" | "remove" | "none" {
  const key = step.key!;
  if (step.op === "save") {
    storage.saveCustomTargetProfiles({
      ...storage.loadCustomTargetProfiles(),
      [key]: recipe(key, step.value!),
    });
    return "add";
  }
  if (step.op === "delete") {
    if (!storage.loadCustomTargetProfiles()[key]) return "none";
    storage.deleteCustomTargetProfile(key);
    return "remove";
  }
  if (step.op === "source-water") {
    storage.saveSourceWater({ ...storage.loadSourceWater(), calcium: step.value! });
    return "none";
  }
  if (step.op === "mineral") {
    const selected = storage.loadSelectedMinerals();
    const has = selected.includes(key);
    storage.saveSelectedMinerals(has ? selected.filter((x) => x !== key) : [...selected, key]);
    return has ? "remove" : "add";
  }
  if (step.op === "rail") {
    const has = storage.loadAddedTargetPresets().includes(key);
    if (has) storage.removeAddedTargetPreset(key);
    else storage.addAddedTargetPreset(key);
    return has ? "remove" : "add";
  }
  if (step.op === "concentrate-spec") {
    const specs: Record<string, any> = storage.loadStockConcentrateSpecs();
    const has = !!specs[key];
    if (has) delete specs[key];
    else specs[key] = { label: key, bottleMl: step.value, doseGramsPerL: 4, minerals: [] };
    storage.saveStockConcentrateSpecs(specs);
    return has ? "remove" : "add";
  }
  if (step.op === "concentrate") {
    const id = "stock:" + key;
    const selected = storage.loadSelectedConcentrates();
    const has = selected.includes(id);
    storage.saveSelectedConcentrates(has ? selected.filter((x) => x !== id) : [...selected, id]);
    return has ? "remove" : "add";
  }
  return "none";
}

type Outcome = {
  converged: boolean;
  dirty: boolean;
  neverQuiet: boolean;
  // The last action on it anywhere was a save / add, yet it is gone.
  lost: string[];
  // The last action on it anywhere was a delete / remove, yet it is there.
  broughtBack: string[];
  // Added and never removed by any device, yet gone.
  missing: string[];
  // Rows still in the cloud for recipes the cloud lists as deleted.
  deletedRowsLeft: string[];
  trace: string[];
};

const MAX_ROUNDS = 10;

async function run(versions: Version[], script: Step[]): Promise<Outcome> {
  newCloud();
  const devices: Device[] = await makeDevices(versions);
  const lastAction: Record<string, "add" | "remove"> = {};
  const added = new Set<string>();
  const removed = new Set<string>();
  const trace: string[] = [];
  for (const step of script) {
    const d = devices[step.device]!;
    if (step.op === "push") await push(d).catch(() => {});
    else if (step.op === "realtime") await realtime(d);
    else if (step.op === "page-load") await pageLoad(d);
    else {
      let effect: "add" | "remove" | "none" = "none";
      act(d, () => {
        effect = applyAction(step);
      });
      if (effect !== "none") {
        const thing =
          (step.op === "save" || step.op === "delete" ? "recipe" : step.op) + ":" + step.key;
        lastAction[thing] = effect;
        (effect === "add" ? added : removed).add(thing);
      }
      trace.push(`${d.name} ${step.op} ${step.key ?? ""} ${step.value ?? ""} -> ${effect}`);
      continue;
    }
    trace.push(
      `${d.name} ${step.op} | cloud ${cloudRecipes().join(",")} deleted ${cloudTombstones().join(",")}`,
    );
  }

  // Everyone comes back online: Realtime rounds, a page load each, Realtime
  // again.
  let noisy = await settle(devices, MAX_ROUNDS);
  for (const d of devices) await pageLoad(d);
  noisy = Math.max(noisy, await settle(devices, MAX_ROUNDS));

  const views = devices.map((d) => {
    use(d);
    return JSON.stringify({
      recipes: localRecipes(d),
      water: storage.loadSourceWater().calcium,
      minerals: storage.loadSelectedMinerals().slice().sort(),
      rail: storage.loadAddedTargetPresets().slice().sort(),
      specs: Object.keys(storage.loadStockConcentrateSpecs()).sort(),
      concentrates: storage.loadSelectedConcentrates().slice().sort(),
    });
  });

  use(devices[0]!);
  const exists = (thing: string): boolean => {
    const i = thing.indexOf(":");
    const kind = thing.slice(0, i);
    const key = thing.slice(i + 1);
    if (kind === "recipe") return key in storage.loadCustomTargetProfiles();
    if (kind === "mineral") return storage.loadSelectedMinerals().includes(key);
    if (kind === "rail") return storage.loadAddedTargetPresets().includes(key);
    if (kind === "concentrate-spec") return key in storage.loadStockConcentrateSpecs();
    return storage.loadSelectedConcentrates().includes("stock:" + key);
  };
  const things = Object.keys(lastAction).sort();
  const deleted = new Set(cloudTombstones());
  return {
    converged: views.every((v) => v === views[0]),
    dirty: devices.some((d) => dirty(d)),
    neverQuiet: noisy >= MAX_ROUNDS,
    lost: things.filter((t) => lastAction[t] === "add" && !exists(t)),
    broughtBack: things.filter((t) => lastAction[t] === "remove" && exists(t)),
    missing: [...added].filter((t) => !removed.has(t) && !exists(t)).sort(),
    deletedRowsLeft: cloud.profiles
      .target_profiles!.filter((r: any) => deleted.has(r.slug))
      .map((r: any) => r.slug)
      .sort(),
    trace,
  };
}

// Totals over a set of runs. Which of two conflicting changes survives a
// whole-row overwrite is down to ordering, so single runs differ between
// fleets without either being wrong; the totals are what must not get worse.
type Totals = {
  lost: number;
  broughtBack: number;
  missing: number;
  deletedRowsLeft: number;
  runsThatDisagree: number;
  runsLeftUnsynced: number;
  runsNeverQuiet: number;
};

function addTo(totals: Totals, o: Outcome): void {
  totals.lost += o.lost.length;
  totals.broughtBack += o.broughtBack.length;
  totals.missing += o.missing.length;
  totals.deletedRowsLeft += o.deletedRowsLeft.length;
  if (!o.converged) totals.runsThatDisagree++;
  if (o.dirty) totals.runsLeftUnsynced++;
  if (o.neverQuiet) totals.runsNeverQuiet++;
}

const zero = (): Totals => ({
  lost: 0,
  broughtBack: 0,
  missing: 0,
  deletedRowsLeft: 0,
  runsThatDisagree: 0,
  runsLeftUnsynced: 0,
  runsNeverQuiet: 0,
});

const FLEETS: Array<{ baseline: Version[]; mixes: Version[][] }> = [
  {
    baseline: ["v1.2", "v1.2"],
    mixes: [
      ["v1.2", "current"],
      ["current", "v1.2"],
    ],
  },
  {
    baseline: ["v1.2", "v1.2", "v1.2"],
    mixes: [
      ["v1.2", "current", "current"],
      ["current", "v1.2", "v1.2"],
    ],
  },
];

const SEEDS = 60;

describe("a current device next to v1.2 devices is no worse than v1.2 devices alone", () => {
  for (const recipesOnly of [true, false]) {
    for (const fleet of FLEETS) {
      const n = fleet.baseline.length;
      test(`${n} devices, ${recipesOnly ? "recipes" : "recipes and settings"}`, async () => {
        const baseline = zero();
        const mixed = fleet.mixes.map(zero);
        for (let seed = 1; seed <= SEEDS; seed++) {
          const script = makeScript(seed * 31 + n, n, 24, recipesOnly);
          addTo(baseline, await run(fleet.baseline, script));
          for (let m = 0; m < fleet.mixes.length; m++) {
            addTo(mixed[m]!, await run(fleet.mixes[m]!, script));
          }
        }
        for (let m = 0; m < fleet.mixes.length; m++) {
          const worse = (Object.keys(baseline) as Array<keyof Totals>)
            .filter((k) => mixed[m]![k] > baseline[k])
            .map((k) => `${k}: ${mixed[m]![k]} (v1.2 alone: ${baseline[k]})`);
          expect(worse, fleet.mixes[m]!.join(" + ")).toEqual([]);
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Pinned sequences. Each one made merge-based sync (#238) worse than v1.2
// alone when an old device was in the mix, and in each the all-v1.2 result is
// the right one, so a mix has to end exactly the same way.
// ---------------------------------------------------------------------------

async function seedRecipe(devices: Device[], slug: string, extra: Record<string, unknown> = {}) {
  act(devices[0]!, () =>
    storage.saveCustomTargetProfiles({
      ...storage.loadCustomTargetProfiles(),
      [slug]: recipe(slug, 40, extra),
    }),
  );
  await push(devices[0]!);
  for (const d of devices) await pageLoad(d);
}

const editRecipe =
  (slug: string, calcium: number, extra: Record<string, unknown> = {}) =>
  () =>
    storage.saveCustomTargetProfiles({
      ...storage.loadCustomTargetProfiles(),
      [slug]: recipe(slug, calcium, extra),
    });

const MIXES: Version[][] = [
  ["current", "v1.2"],
  ["v1.2", "current"],
];

type Sequence = (versions: Version[]) => Promise<unknown>;

async function expectNoWorseThanV1_2(sequence: Sequence) {
  const baseline = await sequence(["v1.2", "v1.2"]);
  for (const mix of MIXES) {
    expect(await sequence(mix), mix.join(" + ")).toEqual(baseline);
  }
}

describe("pinned mixed-version sequences end the same as with two v1.2 devices", () => {
  test("a deleted public recipe re-uploaded by a stale device is removed again", async () => {
    await expectNoWorseThanV1_2(async (versions) => {
      newCloud();
      const [a, b] = await makeDevices(versions);
      await seedRecipe([a!, b!], "pub", { isPublic: true });
      // B has an unpushed edit; A deletes the recipe.
      act(b!, editRecipe("pub", 44, { isPublic: true }));
      act(a!, () => storage.deleteCustomTargetProfile("pub"));
      await push(a!);
      await realtime(b!);
      await settle([a!, b!]);
      // The deleting device's next page load.
      await pageLoad(a!);
      return { cloud: cloudRecipes() };
    });
  });

  test("a delete whose row DELETE failed survives another device's whole-row upsert", async () => {
    await expectNoWorseThanV1_2(async (versions) => {
      newCloud();
      const [a, b] = await makeDevices(versions);
      await seedRecipe([a!, b!], "r");
      // B has a pending selections change and hasn't seen the delete.
      act(b!, () => storage.saveSourceWater({ ...storage.loadSourceWater(), calcium: 5 }));
      act(a!, () => storage.deleteCustomTargetProfile("r"));
      cloud.failNextProfileDelete = true;
      await push(a!).catch(() => {});
      await push(b!);
      await pageLoad(a!);
      await pageLoad(b!);
      await settle([a!, b!]);
      return { cloud: cloudRecipes(), a: localRecipes(a!), b: localRecipes(b!) };
    });
  });

  test("an edit saved after another device's delete was pushed past is kept or dropped as before", async () => {
    await expectNoWorseThanV1_2(async (versions) => {
      newCloud();
      const [a, b] = await makeDevices(versions);
      await seedRecipe([a!, b!], "r");
      act(b!, () => storage.deleteCustomTargetProfile("r"));
      await push(b!);
      // A hasn't pulled: it pushes a selections change, then saves an edit.
      act(a!, () => storage.saveSourceWater({ ...storage.loadSourceWater(), calcium: 7 }));
      await push(a!);
      act(a!, editRecipe("r", 77));
      await push(a!);
      await settle([a!, b!]);
      for (const d of [a!, b!]) await pageLoad(d);
      await settle([a!, b!]);
      return { cloud: cloudRecipes(), a: localRecipes(a!), b: localRecipes(b!) };
    });
  });
});

// ---------------------------------------------------------------------------
// Reusing a deleted recipe's name. This one is v1.2's own bug, so it is pinned
// to the right outcome instead of to the all-v1.2 result: a device that still
// holds the old delete replays it on its next push, and that must not erase a
// recipe saved under the same name since. The protection is in how the saving
// device picks the key (storage.ts unusedProfileKey), so it holds whichever
// sync version the stale device runs.
// ---------------------------------------------------------------------------

// Save a recipe the way the app's save buttons do: validate the name, then
// store it under the key the validation returns.
function saveByName(name: string, calcium: number): void {
  const v = storage.validateTargetProfileName(name);
  if (!v.ok) throw new Error("name rejected: " + v.code);
  storage.saveCustomTargetProfiles({
    ...storage.loadCustomTargetProfiles(),
    [v.key]: recipe(v.name, calcium),
  });
}

describe("a recipe saved under a deleted name survives a device that still holds the delete", () => {
  for (const versions of [
    ["current", "v1.2"],
    ["v1.2", "current"],
    ["current", "current"],
  ] as Version[][]) {
    test(versions.join(" + "), async () => {
      newCloud();
      const [a, b] = await makeDevices(versions);
      act(a!, () => saveByName("Morning", 40));
      await push(a!);
      for (const d of [a!, b!]) await pageLoad(d);

      // A deletes it. Both devices learn of the delete; B then goes idle,
      // still holding the tombstone.
      act(a!, () => storage.deleteCustomTargetProfile("morning"));
      await push(a!);
      await settle([a!, b!]);

      // A saves a new recipe under the same name.
      act(a!, () => saveByName("Morning", 77));
      await push(a!);

      // B opens a page: push first (replaying its deletes), then pull.
      await pageLoad(b!);
      await settle([a!, b!]);

      expect(cloudRecipes()).toEqual(["morning-2=77"]);
      expect(localRecipes(a!)).toEqual(["morning-2=77"]);
      expect(localRecipes(b!)).toEqual(["morning-2=77"]);
    });
  }
});
