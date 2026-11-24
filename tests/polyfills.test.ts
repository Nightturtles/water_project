// Array.prototype.at stand-in for WebViews older than Chrome 92 (see
// src/lib/polyfills.ts). Installed onto a bare object here so the test does
// not have to remove the real method from Array.prototype.

import { describe, test, expect } from "vitest";
import { installArrayAt } from "../src/lib/polyfills";

function arrayLike(items: unknown[]): { at: (i: number) => unknown } {
  const proto: { at?: unknown } = {};
  installArrayAt(proto);
  return Object.assign(Object.create(proto), items, { length: items.length });
}

describe("installArrayAt", () => {
  test("matches the native method for positive, negative and out-of-range indexes", () => {
    const items = ["a", "b", "c"];
    const a = arrayLike(items);
    for (const i of [0, 1, 2, 3, -1, -3, -4, 1.9, -1.9, NaN]) {
      expect(a.at(i)).toBe(items.at(i));
    }
    expect(arrayLike([]).at(-1)).toBeUndefined();
  });

  test("leaves an existing method alone", () => {
    const native = function () {
      return "native";
    };
    const proto = { at: native };
    installArrayAt(proto);
    expect(proto.at).toBe(native);
  });
});
