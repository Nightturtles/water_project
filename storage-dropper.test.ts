// Unit tests for the custom dropper-size helpers in src/lib/storage.ts:
// normalizeDropMl (user input -> 3-decimal mL per drop, or null = unset) and
// getConcentrateDropMl (which concentrates are shown in drops, and at what size).

import { describe, test, expect, beforeEach } from "vitest";
import * as storage from "./src/lib/storage";
import { LOTUS_DROPPER_ML } from "./src/lib/constants";

const { normalizeDropMl, getConcentrateDropMl, saveDiyConcentrateSpecs, invalidateAllCaches } =
  storage;

beforeEach(() => {
  global.localStorage.clear();
  global.sessionStorage.clear();
  invalidateAllCaches();
});

describe("normalizeDropMl", () => {
  test("keeps values to the 1,000th of a mL", () => {
    expect(normalizeDropMl(0.045)).toBe(0.045);
    expect(normalizeDropMl("0.05")).toBe(0.05);
    expect(normalizeDropMl("0.0456")).toBe(0.046);
    expect(normalizeDropMl(0.0444)).toBe(0.044);
  });

  test("blank, zero, negative, and garbage mean unset", () => {
    expect(normalizeDropMl("")).toBeNull();
    expect(normalizeDropMl(null)).toBeNull();
    expect(normalizeDropMl(undefined)).toBeNull();
    expect(normalizeDropMl(0)).toBeNull();
    expect(normalizeDropMl(-0.05)).toBeNull();
    expect(normalizeDropMl("abc")).toBeNull();
  });

  test("values that round to 0 at 3 decimals are unset", () => {
    expect(normalizeDropMl(0.0004)).toBeNull();
    expect(normalizeDropMl(0.0005)).toBe(0.001);
  });
});

describe("getConcentrateDropMl", () => {
  test("Lotus concentrates use the selected Lotus dropper", () => {
    expect(getConcentrateDropMl("brand:lotus:calcium")).toBe(LOTUS_DROPPER_ML.round);
    storage.saveLotusDropperType("straight");
    expect(getConcentrateDropMl("brand:lotus:calcium")).toBe(LOTUS_DROPPER_ML.straight);
  });

  test("a Mineral Concentrate uses its saved dropper size", () => {
    saveDiyConcentrateSpecs({
      "epsom-salt": { bottleMl: 100, gramsPerBottle: 10, dropMl: 0.045 },
    });
    expect(getConcentrateDropMl("diy:epsom-salt")).toBe(0.045);
  });

  test("a Mineral Concentrate without a dropper size stays mL-only (0)", () => {
    saveDiyConcentrateSpecs({ "epsom-salt": { bottleMl: 100, gramsPerBottle: 10 } });
    expect(getConcentrateDropMl("diy:epsom-salt")).toBe(0);
    expect(getConcentrateDropMl("diy:baking-soda")).toBe(0);
  });

  test("Recipe Concentrates and junk ids are not drops-capable", () => {
    expect(getConcentrateDropMl("stock:my-stock")).toBe(0);
    expect(getConcentrateDropMl(42)).toBe(0);
    expect(getConcentrateDropMl("diy:")).toBe(0);
  });
});
