// flushPendingSync is what Log out awaits before it signs out and wipes this
// device (ui-shared performLogout). It must resolve only when nothing here is
// unsynced, and reject whenever that can't be confirmed, so logout can ask
// before discarding anything. These pin the cases that used to be wiped
// without a word: a save whose push had failed, a save made offline, a device
// that never finished its first-login merge, and a stalled connection.
//
// Browser-global stubs come from tests/setup.js (logged in, localStorage).

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  flushPendingSync,
  hasUnpushedChanges,
  pushAllToCloud,
  pullFromCloud,
} from "../src/lib/sync";
import { storage, cloud, newCloud, recipe, USER } from "./helpers/sync-fleet";

const g: any = global;
let savedClient: unknown;
let savedUser: unknown;

// A device that has finished its first-login merge and is in sync.
async function syncedDevice(): Promise<void> {
  newCloud();
  g.localStorage.setItem("cw_synced_user_id", USER);
  await pushAllToCloud();
  await pullFromCloud();
  vi.clearAllTimers();
}

function saveRecipe(slug: string, calcium: number): void {
  storage.saveCustomTargetProfiles({
    ...storage.loadCustomTargetProfiles(),
    [slug]: recipe(slug, calcium),
  });
}

const cloudRecipeSlugs = (): string[] => cloud.profiles.target_profiles!.map((r: any) => r.slug);

// Replace the account lookup every push starts with.
function stubGetUser(impl: () => Promise<unknown>) {
  const spy = vi.fn(impl);
  g.window.supabaseClient.auth.getUser = spy;
  return spy;
}

const offline = () =>
  Promise.resolve({
    data: { user: null },
    error: { name: "AuthRetryableFetchError", message: "Failed to fetch" },
  });

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

describe("nothing unsynced", () => {
  test("a device in sync reports nothing unsynced", async () => {
    await syncedDevice();
    expect(hasUnpushedChanges()).toBe(false);
  });

  test("the flush resolves without touching the network, so logging out offline works", async () => {
    await syncedDevice();
    const getUser = stubGetUser(offline);
    await expect(flushPendingSync()).resolves.toBeUndefined();
    expect(getUser).not.toHaveBeenCalled();
  });

  test("a save that already reached the cloud doesn't count, even though its timer once ran", async () => {
    await syncedDevice();
    storage.saveBrewMethod("espresso");
    await vi.advanceTimersByTimeAsync(1000); // the debounced push fires and succeeds
    expect(cloud.rows.user_settings.brew_method).toBe("espresso");
    expect(hasUnpushedChanges()).toBe(false);
    const getUser = stubGetUser(offline);
    await expect(flushPendingSync()).resolves.toBeUndefined();
    expect(getUser).not.toHaveBeenCalled();
  });

  test("signed out: nothing counts as unsynced", async () => {
    await syncedDevice();
    saveRecipe("mine", 40);
    g.window._cachedAuthUserId = null;
    g.localStorage.removeItem("cw_synced_user_id");
    expect(hasUnpushedChanges()).toBe(false);
  });
});

describe("unsynced changes are pushed before logout", () => {
  test("a save whose debounced push hasn't run yet", async () => {
    await syncedDevice();
    storage.saveBrewMethod("espresso");
    expect(hasUnpushedChanges()).toBe(true);
    await flushPendingSync();
    expect(cloud.rows.user_settings.brew_method).toBe("espresso");
    expect(hasUnpushedChanges()).toBe(false);
  });

  test("a recipe whose push failed earlier, with no save pending", async () => {
    await syncedDevice();
    const online = g.window.supabaseClient.auth.getUser;
    stubGetUser(offline);
    saveRecipe("mine", 40);
    await vi.advanceTimersByTimeAsync(1000); // the debounced push runs and can't reach the account
    expect(cloudRecipeSlugs()).toEqual([]);
    expect(hasUnpushedChanges()).toBe(true);

    g.window.supabaseClient.auth.getUser = online;
    await flushPendingSync();
    expect(cloudRecipeSlugs()).toEqual(["mine"]);
    expect(hasUnpushedChanges()).toBe(false);
  });
});

describe("the flush rejects when it can't confirm the changes are in the cloud", () => {
  test("offline with an unsynced recipe", async () => {
    await syncedDevice();
    saveRecipe("mine", 40);
    stubGetUser(offline);
    await expect(flushPendingSync()).rejects.toThrow(/could not reach the account/);
    expect(cloudRecipeSlugs()).toEqual([]);
    expect(storage.loadCustomTargetProfiles().mine).toBeTruthy();
  });

  test("the session is gone", async () => {
    await syncedDevice();
    saveRecipe("mine", 40);
    stubGetUser(() => Promise.resolve({ data: { user: null }, error: null }));
    await expect(flushPendingSync()).rejects.toThrow(/no signed-in user/);
  });

  test("the cloud refuses the write", async () => {
    await syncedDevice();
    storage.saveBrewMethod("espresso");
    const from = g.window.supabaseClient.from;
    g.window.supabaseClient.from = (table: string) => {
      const t = from(table);
      t.upsert = async () => ({ error: { message: "permission denied", code: "42501" } });
      return t;
    };
    await expect(flushPendingSync()).rejects.toThrow();
    expect(hasUnpushedChanges()).toBe(true);
  });

  test("a stalled connection: gives up after 12 s instead of hanging logout", async () => {
    await syncedDevice();
    saveRecipe("mine", 40);
    stubGetUser(() => new Promise(() => {})); // never answers
    const outcome = flushPendingSync().then(
      () => "resolved",
      (e: Error) => "rejected: " + e.message,
    );
    await vi.advanceTimersByTimeAsync(11_000);
    expect(await Promise.race([outcome, Promise.resolve("pending")])).toBe("pending");
    await vi.advanceTimersByTimeAsync(1_500);
    expect(await outcome).toMatch(/rejected: .*timed out/);
  });

  test("a device that never finished its first-login merge and holds local work", async () => {
    newCloud(); // signed in, but no cw_synced_user_id: every push is refused by the merge gate
    saveRecipe("mine", 40);
    expect(hasUnpushedChanges()).toBe(true);
    await expect(flushPendingSync()).rejects.toThrow(/hasn't finished merging/);
    expect(cloudRecipeSlugs()).toEqual([]);
  });

  test("an unmerged device with nothing but defaults has nothing to lose", async () => {
    newCloud();
    expect(hasUnpushedChanges()).toBe(false);
    await expect(flushPendingSync()).resolves.toBeUndefined();
  });
});

describe("ordinary pushes are unchanged", () => {
  test("a push that can't reach the account still resolves as a no-op", async () => {
    await syncedDevice();
    saveRecipe("mine", 40);
    stubGetUser(offline);
    await expect(pushAllToCloud()).resolves.toBeUndefined();
    expect(cloudRecipeSlugs()).toEqual([]);
  });

  test("a push before the first-login merge is still refused quietly", async () => {
    newCloud();
    saveRecipe("mine", 40);
    await expect(pushAllToCloud()).resolves.toBeUndefined();
    expect(cloudRecipeSlugs()).toEqual([]);
  });
});
