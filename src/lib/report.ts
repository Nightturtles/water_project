// Error reporting helper for the storage/sync pipeline. Wraps window.Sentry
// (assigned by sentry-init.ts even when the user opted out — captureException
// on an un-init'd client is a safe no-op) with a per-area, per-page-load cap
// so a hot failure path (e.g. QuotaExceededError on every keystroke save)
// can't flood Sentry. console.warn always fires so local debugging keeps
// working; Sentry only gets the first MAX_REPORTS_PER_AREA per area.

const MAX_REPORTS_PER_AREA = 3;
const reportCounts: Record<string, number> = {};

// Fetch-layer failure strings browsers throw when a request never reaches the
// server: Chrome ("Failed to fetch"), WebKit/Safari ("Load failed", "The
// network connection was lost", "The Internet connection appears to be
// offline"), Firefox ("NetworkError when attempting to fetch…"), and the
// React-Native-style "Network request failed". These are transient and
// self-heal on the next sync trigger.
const NETWORK_ERROR_RE =
  /failed to fetch|load failed|networkerror|network request failed|network connection was lost|internet connection appears to be offline/i;

// Distinguish a transient network blip from a real Postgrest/DB rejection.
// Supabase returns DB errors as plain objects carrying a non-empty SQLSTATE /
// PGRST `code`; a dropped fetch has an empty `code` and one of the messages
// above. Anything with a real `code` is a genuine error, never a network blip —
// so an RLS denial ("42501") or constraint violation is always reported.
function looksLikeNetworkError(err: unknown): boolean {
  if (typeof err === "string") return NETWORK_ERROR_RE.test(err);
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code !== undefined && e.code !== null && e.code !== "") return false;
  return NETWORK_ERROR_RE.test(String(e.message ?? ""));
}

// True when `err` is, or only wraps, transient network failures. pushAllToCloud
// re-throws a generic Error whose `cause` is the array of underlying upsert
// errors (the throw itself stays load-bearing — logout's flushPendingSync await
// relies on it to abort and preserve unsynced edits; see sync.ts), so unwrap
// `cause` to classify the real reason. A mixed cause (one network failure + one
// real DB error) is NOT transient: we still want the alert for the real one.
function isTransientNetworkError(err: unknown): boolean {
  if (looksLikeNetworkError(err)) return true;
  const cause = (err as { cause?: unknown } | null | undefined)?.cause;
  if (Array.isArray(cause)) return cause.length > 0 && cause.every(looksLikeNetworkError);
  if (cause != null) return looksLikeNetworkError(cause);
  return false;
}

// Lift the diagnostic fields off a Supabase/Postgrest error (a plain object, so
// the captureException Error-only path would otherwise drop them) into Sentry's
// `extra`. Without this, the "[sync] failed to upsert" incident reached Sentry
// as a bare message with no code/details/hint to act on.
function postgrestFields(err: unknown): Record<string, unknown> | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { code?: unknown; details?: unknown; hint?: unknown };
  const fields: Record<string, unknown> = {};
  if (e.code) fields.code = e.code;
  if (e.details) fields.details = e.details;
  if (e.hint) fields.hint = e.hint;
  return Object.keys(fields).length > 0 ? fields : undefined;
}

export function reportError(area: string, err: unknown, extra?: Record<string, unknown>): void {
  console.warn("[" + area + "]", err, extra || "");

  const sentry = typeof window !== "undefined" ? window.Sentry : undefined;

  // Transient fetch/network failures (connection dropped mid-request) are
  // expected on mobile and self-heal on the next sync trigger. Leave a
  // breadcrumb so they still surface in the trail of any real error that
  // follows, but don't raise an alert-worthy event (and don't spend the
  // per-area cap). A real DB error reaches Sentry below with full context.
  if (isTransientNetworkError(err)) {
    if (sentry && typeof sentry.addBreadcrumb === "function") {
      sentry.addBreadcrumb({
        category: area,
        level: "info",
        message:
          "transient network failure (not reported): " +
          String((err as { message?: unknown })?.message ?? err),
      });
    }
    return;
  }

  const count = reportCounts[area] ?? 0;
  if (count >= MAX_REPORTS_PER_AREA) return;
  reportCounts[area] = count + 1;
  if (!sentry) return;
  if (err instanceof Error && typeof sentry.captureException === "function") {
    sentry.captureException(err, { tags: { area }, extra });
  } else if (typeof sentry.captureMessage === "function") {
    const pgFields = postgrestFields(err);
    sentry.captureMessage(
      area + ": " + String((err && (err as { message?: string }).message) || err),
      {
        level: "warning",
        tags: { area },
        extra: pgFields ? { ...extra, ...pgFields } : extra,
      },
    );
  }
}

// Test seam: reset the per-page-load cap between unit tests.
export function _resetReportCounts(): void {
  for (const k of Object.keys(reportCounts)) delete reportCounts[k];
}
