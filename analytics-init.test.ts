// Unit tests for the analytics-init GA-gating logic.
//
// src/lib/analytics-init.ts exports two pure helpers and ALSO runs a browser
// bootstrap at module-eval time. In Node (vitest's "node" environment),
// location/history/navigator are undefined, so the bootstrap is skipped and
// importing the module just binds the two helpers: no GA, no globals touched.

function makeFakeStorage() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
    get _store() {
      return store;
    },
  };
}

import { describe, test, expect } from "vitest";
import { shouldLoadAnalytics, handleOptOutURLParam, createGtag } from "./src/lib/analytics-init";

// ---------------------------------------------------------------------------
// shouldLoadAnalytics — pure decision tree
// ---------------------------------------------------------------------------

describe("shouldLoadAnalytics", () => {
  type Env = Parameters<typeof shouldLoadAnalytics>[0];
  function env(overrides: Partial<Env> = {}): Env {
    return Object.assign(
      {
        urlOptOut: false,
        hostname: "cafelytic.com",
        webdriver: false,
        storage: makeFakeStorage(),
      },
      overrides,
    );
  }

  test("urlOptOut=true short-circuits to false", () => {
    expect(shouldLoadAnalytics(env({ urlOptOut: true }))).toBe(false);
  });

  test("localhost hostname → false", () => {
    expect(shouldLoadAnalytics(env({ hostname: "localhost" }))).toBe(false);
  });

  test("127.0.0.1 → false", () => {
    expect(shouldLoadAnalytics(env({ hostname: "127.0.0.1" }))).toBe(false);
  });

  test("0.0.0.0 → false", () => {
    expect(shouldLoadAnalytics(env({ hostname: "0.0.0.0" }))).toBe(false);
  });

  test("::1 → false", () => {
    expect(shouldLoadAnalytics(env({ hostname: "::1" }))).toBe(false);
  });

  test("[::1] → false", () => {
    expect(shouldLoadAnalytics(env({ hostname: "[::1]" }))).toBe(false);
  });

  test("empty hostname → false", () => {
    expect(shouldLoadAnalytics(env({ hostname: "" }))).toBe(false);
  });

  test("production hostname + no opt-outs → true", () => {
    expect(shouldLoadAnalytics(env())).toBe(true);
  });

  test("webdriver=true → false (Playwright/automation gate)", () => {
    expect(shouldLoadAnalytics(env({ webdriver: true }))).toBe(false);
  });

  test("storage flag === '1' → false", () => {
    const storage = makeFakeStorage();
    storage.setItem("cafelytic_no_analytics", "1");
    expect(shouldLoadAnalytics(env({ storage: storage }))).toBe(false);
  });

  test("storage flag === '0' → true (only '1' is opt-out)", () => {
    const storage = makeFakeStorage();
    storage.setItem("cafelytic_no_analytics", "0");
    expect(shouldLoadAnalytics(env({ storage: storage }))).toBe(true);
  });

  test("storage.getItem throws (strict privacy mode) → falls through to true", () => {
    const blockingStorage = {
      getItem: () => {
        throw new Error("SecurityError: localStorage blocked");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(shouldLoadAnalytics(env({ storage: blockingStorage }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createGtag — the command-queue shim
// ---------------------------------------------------------------------------

describe("createGtag", () => {
  test("pushes an Arguments object, NOT a plain array (gtag.js ignores arrays)", () => {
    // Regression guard for #207: gtag.js only recognizes dataLayer entries
    // that are `arguments` objects. A rest-params rewrite pushed plain arrays,
    // which the tag silently dropped — zero GA hits while gtag/js still loaded
    // fine. If this assertion fires, GA is dark in production again.
    const dl: unknown[] = [];
    const gtag = createGtag(dl);
    gtag("config", "G-TEST123");
    expect(dl).toHaveLength(1);
    expect(Object.prototype.toString.call(dl[0])).toBe("[object Arguments]");
  });

  test("queued entry exposes the command tuple by index and length", () => {
    const dl: unknown[] = [];
    const gtag = createGtag(dl);
    const when = new Date(0);
    gtag("js", when);
    gtag("config", "G-TEST123");
    const first = dl[0] as { [i: number]: unknown; length: number };
    const second = dl[1] as { [i: number]: unknown; length: number };
    expect(first.length).toBe(2);
    expect(first[0]).toBe("js");
    expect(first[1]).toBe(when);
    expect(second.length).toBe(2);
    expect(second[0]).toBe("config");
    expect(second[1]).toBe("G-TEST123");
  });
});

// ---------------------------------------------------------------------------
// handleOptOutURLParam — side effects (storage write, history.replaceState)
// ---------------------------------------------------------------------------

describe("handleOptOutURLParam", () => {
  function makeFakeHistory() {
    const calls: { state: unknown; title: string; url: string | null | undefined }[] = [];
    return {
      calls,
      replaceState: function (state: unknown, title: string, url?: string | null) {
        calls.push({ state: state, title: title, url: url });
      },
    };
  }

  function makeFakeLocation(overrides: Partial<{ pathname: string; hash: string }> = {}) {
    return Object.assign({ pathname: "/", hash: "", search: "" }, overrides);
  }

  test("empty search → returns false, no writes, no replaceState", () => {
    const storage = makeFakeStorage();
    const hist = makeFakeHistory();
    const loc = makeFakeLocation();
    const result = handleOptOutURLParam("", loc, hist, storage);
    expect(result).toBe(false);
    expect(storage._store).toEqual({});
    expect(hist.calls).toEqual([]);
  });

  test("?no-analytics=1 → returns true, sets flag, strips param via replaceState", () => {
    const storage = makeFakeStorage();
    const hist = makeFakeHistory();
    const loc = makeFakeLocation();
    const result = handleOptOutURLParam("?no-analytics=1", loc, hist, storage);
    expect(result).toBe(true);
    expect(storage.getItem("cafelytic_no_analytics")).toBe("1");
    expect(hist.calls).toHaveLength(1);
    expect(hist.calls[0]!.url).toBe("/");
  });

  test("?no-analytics=0 → returns false, clears existing flag", () => {
    const storage = makeFakeStorage();
    storage.setItem("cafelytic_no_analytics", "1");
    const hist = makeFakeHistory();
    const loc = makeFakeLocation();
    const result = handleOptOutURLParam("?no-analytics=0", loc, hist, storage);
    expect(result).toBe(false);
    expect(storage.getItem("cafelytic_no_analytics")).toBeNull();
  });

  test("?no-analytics=1&foo=bar → replaceState preserves other params", () => {
    const storage = makeFakeStorage();
    const hist = makeFakeHistory();
    const loc = makeFakeLocation();
    handleOptOutURLParam("?no-analytics=1&foo=bar", loc, hist, storage);
    expect(hist.calls).toHaveLength(1);
    expect(hist.calls[0]!.url).toBe("/?foo=bar");
  });

  test("?no-analytics=1 with hash → replaceState preserves hash", () => {
    const storage = makeFakeStorage();
    const hist = makeFakeHistory();
    const loc = makeFakeLocation({ hash: "#section", pathname: "/recipe.html" });
    handleOptOutURLParam("?no-analytics=1", loc, hist, storage);
    expect(hist.calls).toHaveLength(1);
    expect(hist.calls[0]!.url).toBe("/recipe.html#section");
  });

  test("?other=1 (no no-analytics param) → returns false, no replaceState", () => {
    const storage = makeFakeStorage();
    const hist = makeFakeHistory();
    const loc = makeFakeLocation();
    const result = handleOptOutURLParam("?other=1", loc, hist, storage);
    expect(result).toBe(false);
    expect(hist.calls).toEqual([]);
    expect(storage._store).toEqual({});
  });

  test("storage that throws on setItem → still returns true (doesn't crash)", () => {
    const blockingStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {},
    };
    const hist = makeFakeHistory();
    const loc = makeFakeLocation();
    const result = handleOptOutURLParam("?no-analytics=1", loc, hist, blockingStorage);
    expect(result).toBe(true);
    expect(hist.calls).toHaveLength(1);
  });

  test("history.replaceState throws after v==='1' → still returns true (intent preserved)", () => {
    // Matches the original IIFE: urlOptOut was assigned true BEFORE the
    // replaceState call, so an exception in replaceState doesn't undo the
    // opt-out for this load. Storage flag is set; URL strip didn't happen.
    const storage = makeFakeStorage();
    const hist = {
      replaceState: () => {
        throw new Error("history broken");
      },
    };
    const loc = makeFakeLocation();
    const result = handleOptOutURLParam("?no-analytics=1", loc, hist, storage);
    expect(result).toBe(true);
    expect(storage.getItem("cafelytic_no_analytics")).toBe("1");
  });

  test("history.replaceState throws after v==='0' → returns false (no opt-out intent)", () => {
    const storage = makeFakeStorage();
    storage.setItem("cafelytic_no_analytics", "1");
    const hist = {
      replaceState: () => {
        throw new Error("history broken");
      },
    };
    const loc = makeFakeLocation();
    const result = handleOptOutURLParam("?no-analytics=0", loc, hist, storage);
    expect(result).toBe(false);
    // The clear-flag call happened before replaceState, so the flag is gone.
    expect(storage.getItem("cafelytic_no_analytics")).toBeNull();
  });
});
