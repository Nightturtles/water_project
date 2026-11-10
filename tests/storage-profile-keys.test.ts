// A profile's key comes from its name, and deletes are replayed by every
// device that still holds the tombstone. So a new profile must never be given
// a key that was deleted before: a device that hadn't synced since the name
// was reused would erase the new profile on its next push. These pin the rule
// at the two places a name becomes a key for a brand-new profile:
// unusedProfileKey and the name validation every save button goes through.
// (Library copies are covered in library-data.test.ts, and the cross-device
// outcome in sync-mixed-version.test.ts.)
//
// Browser-global stubs come from tests/setup.js (logged in, localStorage).

import { describe, test, expect, beforeEach } from "vitest";
import {
  unusedProfileKey,
  validateProfileName,
  validateTargetProfileName,
  saveCustomTargetProfiles,
  loadCustomTargetProfiles,
  deleteCustomTargetProfile,
  loadDeletedTargetPresets,
  invalidateAllCaches,
} from "../src/lib/storage";

const recipe = (label: string): any => ({
  label,
  brewMethod: "filter",
  calcium: 40,
  magnesium: 10,
  alkalinity: 30,
  potassium: 0,
  sodium: 0,
  sulfate: 0,
  chloride: 0,
  bicarbonate: 36.6,
});

// Save a recipe the way the app's save buttons do: validate the name, then
// store it under the key the validation returns.
function saveByName(name: string): string {
  const v = validateTargetProfileName(name);
  if (!v.ok) throw new Error("name rejected: " + v.code);
  saveCustomTargetProfiles({ ...loadCustomTargetProfiles(), [v.key]: recipe(v.name) });
  return v.key;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  invalidateAllCaches();
});

describe("unusedProfileKey", () => {
  test("a key nothing has taken is returned as is", () => {
    expect(unusedProfileKey("morning", () => false)).toBe("morning");
  });

  test("a taken key gets the first free numbered suffix", () => {
    const taken = new Set(["morning", "morning-2", "morning-3"]);
    expect(unusedProfileKey("morning", (k) => taken.has(k))).toBe("morning-4");
  });
});

describe("validateProfileName with retired keys", () => {
  test("a name whose key was deleted before gets a fresh key and keeps its label", () => {
    expect(validateProfileName("Morning", { retiredKeys: ["morning"] })).toEqual({
      ok: true,
      key: "morning-2",
      name: "Morning",
    });
  });

  test("the fresh key skips retired, existing and built-in keys alike", () => {
    expect(
      validateProfileName("Morning", {
        retiredKeys: new Set(["morning", "morning-3"]),
        existingKeys: ["morning-2"],
        builtinKeys: ["morning-4"],
      }),
    ).toMatchObject({ ok: true, key: "morning-5" });
  });

  test("a name that was never deleted keeps its plain key", () => {
    expect(validateProfileName("Evening", { retiredKeys: ["morning"] })).toMatchObject({
      ok: true,
      key: "evening",
    });
  });

  test("with no retired keys given, nothing changes", () => {
    expect(validateProfileName("Morning")).toEqual({ ok: true, key: "morning", name: "Morning" });
  });

  test("a name still in use is rejected as before, not given a new key", () => {
    expect(
      validateProfileName("Morning", { existingKeys: ["morning"], retiredKeys: ["morning"] }),
    ).toMatchObject({ ok: false, code: "duplicate" });
    expect(
      validateProfileName("Morning", { existingLabels: ["morning"], retiredKeys: ["morning"] }),
    ).toMatchObject({ ok: false, code: "duplicate" });
  });

  test("a reserved name is still rejected", () => {
    expect(
      validateProfileName("Custom", { builtinKeys: ["custom"], retiredKeys: ["custom"] }),
    ).toMatchObject({ ok: false, code: "reserved" });
  });
});

describe("saving a recipe under a name that was deleted before", () => {
  test("the new recipe gets a new key; the old tombstone is left alone", () => {
    expect(saveByName("Morning")).toBe("morning");
    deleteCustomTargetProfile("morning");
    expect(loadDeletedTargetPresets()).toEqual(["morning"]);

    expect(saveByName("Morning")).toBe("morning-2");
    expect(Object.keys(loadCustomTargetProfiles())).toEqual(["morning-2"]);
    expect(loadCustomTargetProfiles()["morning-2"]!.label).toBe("Morning");
    // Still tombstoned: a replayed delete of "morning" can't touch "morning-2".
    expect(loadDeletedTargetPresets()).toEqual(["morning"]);
  });

  test("delete and re-create again: each time a key that was never used", () => {
    saveByName("Morning");
    deleteCustomTargetProfile("morning");
    saveByName("Morning");
    deleteCustomTargetProfile("morning-2");
    expect(saveByName("Morning")).toBe("morning-3");
    expect(loadDeletedTargetPresets().slice().sort()).toEqual(["morning", "morning-2"]);
  });

  test("the same name can't be saved twice while the first copy exists", () => {
    saveByName("Morning");
    deleteCustomTargetProfile("morning");
    saveByName("Morning"); // now "morning-2", labelled "Morning"
    expect(validateTargetProfileName("Morning")).toMatchObject({ ok: false, code: "duplicate" });
  });
});
