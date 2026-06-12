// Unit tests for src/lib/report.ts — the Sentry reporting helper used by the
// storage/sync pipeline. Browser globals are pre-stubbed by vitest.setup.js
// (window = global, localStorage = makeFakeStorage, etc.).
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { reportError, _resetReportCounts } from "./src/lib/report";
import { safeSetItem } from "./src/lib/storage";

describe("reportError", () => {
  beforeEach(() => {
    _resetReportCounts();
    // Remove Sentry stub so each test installs its own
    delete (window as any).Sentry;
  });

  afterEach(() => {
    delete (window as any).Sentry;
    _resetReportCounts();
  });

  test("1. does not throw when window.Sentry is undefined", () => {
    expect(() => reportError("x", new Error("boom"))).not.toThrow();
  });

  test("2. Error arg routes to captureException with correct tags", () => {
    const captureException = vi.fn();
    const captureMessage = vi.fn();
    (window as any).Sentry = { captureException, captureMessage };

    reportError("x", new Error("boom"));

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { area: "x" } }),
    );
    expect(captureMessage).not.toHaveBeenCalled();
  });

  test("3. non-Error (Supabase plain object) routes to captureMessage, not captureException", () => {
    const captureException = vi.fn();
    const captureMessage = vi.fn();
    (window as any).Sentry = { captureException, captureMessage };

    reportError("sync.pull", { message: "row level security" });

    expect(captureException).not.toHaveBeenCalled();
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("sync.pull"),
      expect.objectContaining({ tags: { area: "sync.pull" } }),
    );
  });

  test("4. per-area cap: only first 3 calls per area reach Sentry; a different area still reports", () => {
    const captureException = vi.fn();
    (window as any).Sentry = { captureException, captureMessage: vi.fn() };

    for (let i = 0; i < 5; i++) {
      reportError("storage.set", new Error("quota"));
    }
    expect(captureException).toHaveBeenCalledTimes(3);

    // A different area should still get through
    reportError("storage.get", new Error("other"));
    expect(captureException).toHaveBeenCalledTimes(4);
  });

  test("5. storage wiring: safeSetItem returns false AND captureException is called when setItem throws", () => {
    const captureException = vi.fn();
    (window as any).Sentry = { captureException, captureMessage: vi.fn() };

    const orig = global.localStorage;
    global.localStorage = {
      ...orig,
      setItem: () => { throw new Error("QuotaExceededError"); },
    } as any;

    try {
      const result = safeSetItem("test-key", "test-value");
      expect(result).toBe(false);
      expect(captureException).toHaveBeenCalledTimes(1);
      expect(captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ tags: { area: "storage.set" } }),
      );
    } finally {
      global.localStorage = orig;
    }
  });
});
