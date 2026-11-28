// Unit tests for the helpers the website's gtag.js gate and the native apps'
// Firebase reporting share (src/lib/usage-analytics.ts).

import { afterEach, describe, test, expect } from "vitest";
import {
  ANALYTICS_OPT_OUT_KEY,
  analyticsOptedOut,
  deviceStorage,
  setAnalyticsOptOut,
  screenNameFor,
} from "../src/lib/usage-analytics";
import { shouldLoadAnalytics } from "../src/lib/analytics-init";

function makeStorage(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("deviceStorage", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  test("returns the storage object when the browser allows it", () => {
    const storage = makeStorage();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    expect(deviceStorage()).toBe(storage);
  });

  // With site storage blocked, reading the global itself throws, before a
  // helper that takes the storage as an argument could catch anything.
  test("returns null when reading the global throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    expect(deviceStorage()).toBeNull();
  });
});

describe("analyticsOptedOut", () => {
  test("is false with no flag", () => {
    expect(analyticsOptedOut(makeStorage())).toBe(false);
  });

  test('is true only for the value "1"', () => {
    expect(analyticsOptedOut(makeStorage({ [ANALYTICS_OPT_OUT_KEY]: "1" }))).toBe(true);
    expect(analyticsOptedOut(makeStorage({ [ANALYTICS_OPT_OUT_KEY]: "0" }))).toBe(false);
    expect(analyticsOptedOut(makeStorage({ [ANALYTICS_OPT_OUT_KEY]: "true" }))).toBe(false);
  });

  test("reads blocked storage as not opted out", () => {
    expect(analyticsOptedOut(throwingStorage)).toBe(false);
  });
});

describe("setAnalyticsOptOut", () => {
  test("opting out sets the flag and opting in removes it", () => {
    const storage = makeStorage();
    expect(setAnalyticsOptOut(storage, true)).toBe(true);
    expect(storage.store[ANALYTICS_OPT_OUT_KEY]).toBe("1");
    expect(setAnalyticsOptOut(storage, false)).toBe(true);
    expect(ANALYTICS_OPT_OUT_KEY in storage.store).toBe(false);
  });

  test("reports a refused write", () => {
    expect(setAnalyticsOptOut(throwingStorage, true)).toBe(false);
    expect(setAnalyticsOptOut(throwingStorage, false)).toBe(false);
  });

  // The Settings switch and the website's gate must mean the same flag: a
  // device switched off in Settings loads no gtag.js on its next page.
  test("the flag it writes is the one the website gate reads", () => {
    const storage = makeStorage();
    const env = { urlOptOut: false, hostname: "cafelytic.com", webdriver: false, storage };
    expect(shouldLoadAnalytics(env)).toBe(true);
    setAnalyticsOptOut(storage, true);
    expect(shouldLoadAnalytics(env)).toBe(false);
    setAnalyticsOptOut(storage, false);
    expect(shouldLoadAnalytics(env)).toBe(true);
  });
});

describe("screenNameFor", () => {
  test("names a page after its file", () => {
    expect(screenNameFor("/recipe.html")).toBe("recipe");
    expect(screenNameFor("/minerals.html")).toBe("minerals");
    expect(screenNameFor("/oauth/consent.html")).toBe("consent");
  });

  test('the root page is "index" however it is addressed', () => {
    expect(screenNameFor("/")).toBe("index");
    expect(screenNameFor("")).toBe("index");
    expect(screenNameFor("/index.html")).toBe("index");
  });

  test("a directory page takes the directory's name", () => {
    expect(screenNameFor("/privacy/")).toBe("privacy");
    expect(screenNameFor("/privacy")).toBe("privacy");
    expect(screenNameFor("/privacy/index.html")).toBe("privacy");
  });
});
