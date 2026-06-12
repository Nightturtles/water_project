// Error reporting helper for the storage/sync pipeline. Wraps window.Sentry
// (assigned by sentry-init.ts even when the user opted out — captureException
// on an un-init'd client is a safe no-op) with a per-area, per-page-load cap
// so a hot failure path (e.g. QuotaExceededError on every keystroke save)
// can't flood Sentry. console.warn always fires so local debugging keeps
// working; Sentry only gets the first MAX_REPORTS_PER_AREA per area.

const MAX_REPORTS_PER_AREA = 3;
const reportCounts: Record<string, number> = {};

export function reportError(area: string, err: unknown, extra?: Record<string, unknown>): void {
  console.warn("[" + area + "]", err, extra || "");
  const count = reportCounts[area] ?? 0;
  if (count >= MAX_REPORTS_PER_AREA) return;
  reportCounts[area] = count + 1;
  const sentry = typeof window !== "undefined" ? window.Sentry : undefined;
  if (!sentry) return;
  if (err instanceof Error && typeof sentry.captureException === "function") {
    sentry.captureException(err, { tags: { area }, extra });
  } else if (typeof sentry.captureMessage === "function") {
    sentry.captureMessage(area + ": " + String((err && (err as { message?: string }).message) || err), {
      level: "warning",
      tags: { area },
      extra,
    });
  }
}

// Test seam: reset the per-page-load cap between unit tests.
export function _resetReportCounts(): void {
  for (const k of Object.keys(reportCounts)) delete reportCounts[k];
}
