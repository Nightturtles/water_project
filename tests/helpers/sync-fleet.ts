// A small fleet of simulated devices that share one account, for testing how
// different versions of the sync code behave next to each other.
//
// Each device is a localStorage image plus the sync module it runs:
//   "current" - src/lib/sync.ts as it is in this checkout;
//   "v1.2"    - tests/fixtures/sync-v1.2.ts, the sync code frozen as shipped in
//               the iOS apps 1.2 and 1.2.1.
// All devices talk to one in-memory fake of the four Supabase tables. Only one
// device is "live" at a time: use() swaps its image into the global
// localStorage stub from tests/setup.js, so every operation here is fully
// awaited before another device acts. That makes runs deterministic; it also
// means this harness cannot produce two requests in flight at once.
//
// Browser-global stubs come from tests/setup.js (logged in, localStorage).

import { vi } from "vitest";
import * as storage from "../../src/lib/storage";
import * as CURRENT from "../../src/lib/sync";
import * as V1_2 from "../fixtures/sync-v1.2";

export { storage };
export const USER = "u1";
const g: any = global;
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export class FakeCloud {
  rows: Record<string, any> = { user_settings: null, user_selections: null };
  profiles: Record<string, any[]> = { source_profiles: [], target_profiles: [] };
  // Every request that changed something, in order. Used for traces and to
  // tell when the account has gone quiet.
  log: string[] = [];
  writes = 0;
  failNextProfileDelete = false;

  client() {
    return {
      auth: {
        getUser: async () => ({ data: { user: { id: USER } }, error: null }),
      },
      from: (table: string) => this.table(table),
    };
  }

  private table(t: string) {
    const single = t === "user_settings" || t === "user_selections";
    const read = () => ({
      data: clone(single ? this.rows[t] : this.profiles[t]),
      error: null,
    });
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
        this.writes++;
        if (single) {
          this.rows[t] = Object.assign({}, this.rows[t] || {}, clone(payload));
          this.log.push("upsert " + t);
        } else {
          for (const row of ([] as any[]).concat(payload)) {
            const rows = this.profiles[t]!;
            const i = rows.findIndex((r) => r.slug === row.slug);
            if (i >= 0) rows[i] = { ...rows[i], ...clone(row) };
            else rows.push(clone(row));
            this.log.push("upsert " + t + ":" + row.slug);
          }
        }
        return { error: null };
      },
      delete: () => ({
        eq: () => ({
          in: async (_col: string, slugs: string[]) => {
            if (this.failNextProfileDelete) {
              this.failNextProfileDelete = false;
              return { error: { message: "Failed to fetch" } };
            }
            const before = this.profiles[t]!.length;
            this.profiles[t] = this.profiles[t]!.filter((r) => !slugs.includes(r.slug));
            const removed = before - this.profiles[t]!.length;
            this.log.push("delete " + t + ":" + slugs.join(",") + " (removed " + removed + ")");
            if (removed > 0) this.writes++;
            return { error: null };
          },
        }),
      }),
    };
  }
}

export let cloud: FakeCloud;

// Start a fresh account. Call before makeDevices in every run.
export function newCloud(): FakeCloud {
  cloud = new FakeCloud();
  live = null;
  g.localStorage.clear();
  g.sessionStorage.clear();
  storage.invalidateAllCaches();
  g.window.supabaseClient = cloud.client();
  g.window._cachedAuthUserId = USER;
  return cloud;
}

export type Version = "current" | "v1.2";
export type Device = {
  name: string;
  version: Version;
  image: Record<string, string>;
  // A save whose debounced push hasn't run yet (the device's sync timer).
  pending: boolean;
};

const syncModule = (d: Device): any => (d.version === "v1.2" ? V1_2 : CURRENT);

function readImage(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < g.localStorage.length; i++) {
    const k = g.localStorage.key(i)!;
    out[k] = g.localStorage.getItem(k)!;
  }
  return out;
}

let live: Device | null = null;

// Make `d` the live device: its localStorage image, and its version's
// scheduleSyncToCloud for storage.ts's save hooks. Debounced pushes never fire
// on their own (timers are cleared); the tests drive pushes explicitly.
export function use(d: Device): void {
  if (live && live !== d) live.image = readImage();
  vi.clearAllTimers();
  g.localStorage.clear();
  for (const k of Object.keys(d.image)) g.localStorage.setItem(k, d.image[k]!);
  storage.invalidateAllCaches();
  g.window.scheduleSyncToCloud = syncModule(d).scheduleSyncToCloud;
  g.scheduleSyncToCloud = g.window.scheduleSyncToCloud;
  live = d;
}

function keep(d: Device): void {
  if (live === d) d.image = readImage();
}

// Devices that have each completed the first-login merge and a page load, so
// they start in sync with the cloud and with each other.
export async function makeDevices(versions: Version[]): Promise<Device[]> {
  const devs: Device[] = versions.map((version, i) => ({
    name: version + "#" + i,
    version,
    image: {},
    pending: false,
  }));
  for (const d of devs) {
    use(d);
    g.localStorage.setItem("cw_synced_user_id", USER);
    await syncModule(d).pushAllToCloud();
    await syncModule(d).pullFromCloud();
    keep(d);
  }
  for (const d of devs) await pageLoad(d);
  return devs;
}

// A local change on `d` (anything that calls storage.ts save functions).
export function act(d: Device, fn: () => void): void {
  use(d);
  fn();
  d.pending = true;
  keep(d);
}

// The device's debounced push firing.
export async function push(d: Device): Promise<void> {
  use(d);
  try {
    await syncModule(d).pushAllToCloud();
    d.pending = false;
  } finally {
    keep(d);
  }
}

// initSync on a page load: push, then pull.
export async function pageLoad(d: Device): Promise<void> {
  use(d);
  await syncModule(d).pushAllToCloud();
  d.pending = false;
  await syncModule(d).pullFromCloud();
  keep(d);
}

// A Realtime event reaching the device: push first if it has something
// pending, then pull. v1.2 pushes only when its debounce timer is pending. A
// current module that exports hasUnpushedChanges also pushes when that is true
// (the push-first rule that comes with merge-based sync).
export async function realtime(d: Device): Promise<void> {
  use(d);
  const mod = syncModule(d);
  const hasUnpushed =
    d.version === "current" && typeof mod.hasUnpushedChanges === "function"
      ? !!mod.hasUnpushedChanges()
      : false;
  if (d.pending || hasUnpushed) {
    await mod.pushAllToCloud().catch(() => {});
    d.pending = false;
  }
  await mod.pullFromCloud({ skipIfLocalWriteDuringPull: true });
  keep(d);
}

// Deliver Realtime events to every device until nobody writes any more.
// Returns the number of rounds in which some device wrote; maxRounds means the
// account never went quiet.
export async function settle(devs: Device[], maxRounds = 10): Promise<number> {
  let noisy = 0;
  for (let round = 0; round < maxRounds; round++) {
    const before = cloud.writes;
    for (const d of devs) await realtime(d);
    if (cloud.writes === before) return noisy;
    noisy++;
  }
  return noisy;
}

// True when the device still holds single-row changes it would push. Uses the
// module's own check when it has one, else the last-pushed snapshot compare
// both versions push by.
export function dirty(d: Device): boolean {
  use(d);
  const mod = syncModule(d);
  if (d.version === "current" && typeof mod.hasUnpushedChanges === "function") {
    return !!mod.hasUnpushedChanges();
  }
  return (
    mod.snapshotForCompare(mod.buildSettingsPayload(USER, "")) !==
      g.localStorage.getItem("cw_last_pushed_settings") ||
    mod.snapshotForCompare(mod.buildSelectionsPayload(USER, "")) !==
      g.localStorage.getItem("cw_last_pushed_selections")
  );
}

export function recipe(label: string, calcium: number, extra: Record<string, unknown> = {}): any {
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
    ...extra,
  };
}

export const cloudRecipes = (): string[] =>
  cloud.profiles.target_profiles!.map((r: any) => r.slug + "=" + r.calcium).sort();

export const cloudTombstones = (): string[] =>
  ((cloud.rows.user_selections && cloud.rows.user_selections.deleted_target_presets) || [])
    .slice()
    .sort();

export function localRecipes(d: Device): string[] {
  use(d);
  const profiles: Record<string, any> = storage.loadCustomTargetProfiles();
  return Object.keys(profiles)
    .map((slug) => slug + "=" + profiles[slug].calcium)
    .sort();
}
