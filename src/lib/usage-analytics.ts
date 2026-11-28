// =============================================================================
// usage-analytics.ts — the pieces the two analytics paths share
//
// The website counts visits with Google Analytics' gtag.js
// (src/lib/analytics-init.ts). The native apps cannot: gtag.js drops every
// event unless the page protocol is http(s), and the iOS app loads from
// capacitor://localhost. They use the Firebase Analytics SDK instead
// (src/lib/capacitor-bootstrap.ts), which reports to the same Analytics
// property through its own iOS and Android streams.
//
// Both paths honor one per-device opt-out flag, and the Settings page has a
// switch for it (mountAnalyticsSetting in src/components/ui-shared.ts). The
// flag is deliberately not part of the synced settings: it is a choice about
// this device's data, and it predates accounts as the `?no-analytics=1` URL
// switch.
//
// Everything here is pure so the Vitest suite can drive it.
// =============================================================================

export const ANALYTICS_OPT_OUT_KEY = "cafelytic_no_analytics";

// The website's Google Analytics web stream. The native apps' streams are
// named by their Firebase config files instead (GoogleService-Info.plist,
// google-services.json).
export const MEASUREMENT_ID = "G-BGJWVRGJJC";

interface FlagStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// True when this device has opted out. Storage that throws (privacy modes,
// sandboxed frames) reads as "not opted out", matching analytics-init.ts.
export function analyticsOptedOut(storage: Pick<FlagStorage, "getItem">): boolean {
  try {
    return storage.getItem(ANALYTICS_OPT_OUT_KEY) === "1";
  } catch (_) {
    return false;
  }
}

// Record the choice. Returns false when storage refused the write, so the
// caller can put the switch back instead of showing a choice that did not
// stick.
export function setAnalyticsOptOut(storage: FlagStorage, optedOut: boolean): boolean {
  try {
    if (optedOut) storage.setItem(ANALYTICS_OPT_OUT_KEY, "1");
    else storage.removeItem(ANALYTICS_OPT_OUT_KEY);
    return true;
  } catch (_) {
    return false;
  }
}

// The screen name the native apps report for a page: the page's file name
// without ".html", so it lines up with the page paths the website reports and
// cannot drift from a hand-kept list. Directory pages take the directory's
// name ("/privacy/" and "/privacy/index.html" are both "privacy"), and the
// root page is "index".
export function screenNameFor(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  const last = (parts[parts.length - 1] ?? "index").replace(/\.html$/, "");
  if (last !== "index") return last;
  return parts[parts.length - 2] ?? "index";
}
