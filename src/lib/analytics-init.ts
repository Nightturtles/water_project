// =============================================================================
// analytics-init.ts — Google Analytics 4 load gating
// Decides whether GA4 should load on a given pageview and, when it should,
// bootstraps gtag.js. The gate keeps dev, automated-test, and opted-out traffic
// out of Cafelytic's GA active-user count.
//
// Phase 3: converted from the classic analytics-init.js IIFE. Loaded via
// legacy-globals.ts (imported as a side-effect, right after sentry-init) rather
// than the render-blocking <head> <script> it used to be. GA's own gtag/js tag
// is async regardless, so the deferred load is immaterial; the ?no-analytics
// opt-out just applies a tick later. The two pure helpers are exported for the
// Vitest suite (analytics-init.test.js); nothing reaches them at runtime, so
// there is no window self-publish. Window types (dataLayer, gtag) live in
// globals.d.ts.
// =============================================================================

const MEASUREMENT_ID = "G-BGJWVRGJJC";

// Minimal structural shapes, typed to exactly what each helper touches, so both
// the real DOM objects (Location / History / Storage) and the test's fakes
// satisfy them without implementing the full lib.dom interfaces.
interface OptOutLocation {
  pathname: string;
  hash: string;
}
interface OptOutHistory {
  replaceState(data: unknown, unused: string, url?: string | null): void;
}
interface OptOutStorage {
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
interface AnalyticsEnv {
  urlOptOut: boolean;
  hostname: string;
  webdriver: boolean;
  storage: { getItem(key: string): string | null };
}

// Apply the ?no-analytics=<v> URL param to localStorage and strip it from the
// URL via history.replaceState. Returns true iff the request was an explicit
// opt-OUT (value "1") and analytics should be skipped for THIS load. Extracted
// from the IIFE so the side-effect path is unit-testable.
export function handleOptOutURLParam(
  search: string,
  loc: OptOutLocation,
  hist: OptOutHistory,
  storage: OptOutStorage,
): boolean {
  // optedOutNow lives outside the try so that if hist.replaceState throws
  // *after* we've recorded the opt-out, the return value still reflects the
  // user's intent for this load (matches the original IIFE, where urlOptOut
  // was a captured var rather than a try-block return).
  let optedOutNow = false;
  try {
    const params = new URLSearchParams(search);
    if (!params.has("no-analytics")) return false;
    const v = params.get("no-analytics");
    if (v === "1") {
      optedOutNow = true;
      try {
        storage.setItem("cafelytic_no_analytics", "1");
      } catch (e) {}
    } else if (v === "0") {
      try {
        storage.removeItem("cafelytic_no_analytics");
      } catch (e) {}
    }
    params.delete("no-analytics");
    const q = params.toString();
    hist.replaceState(null, "", loc.pathname + (q ? "?" + q : "") + loc.hash);
  } catch (e) {}
  return optedOutNow;
}

// Pure decision: should GA load on this pageview, given the inputs? No side
// effects; tests drive every branch by varying the env argument.
export function shouldLoadAnalytics(env: AnalyticsEnv): boolean {
  if (env.urlOptOut) return false;
  const h = env.hostname;
  if (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h === "[::1]" ||
    h === ""
  ) {
    return false;
  }
  if (env.webdriver === true) return false;
  try {
    if (env.storage.getItem("cafelytic_no_analytics") === "1") return false;
  } catch (e) {}
  return true;
}

// Browser bootstrap. Skipped under Node / Vitest (no location/history/
// navigator), which lets the test file import the two helpers without firing GA.
if (
  typeof location !== "undefined" &&
  typeof history !== "undefined" &&
  typeof navigator !== "undefined"
) {
  const urlOptOut = handleOptOutURLParam(location.search, location, history, localStorage);
  if (
    shouldLoadAnalytics({
      urlOptOut,
      hostname: location.hostname,
      webdriver: navigator.webdriver,
      storage: localStorage,
    })
  ) {
    const dataLayer: unknown[] = window.dataLayer || [];
    window.dataLayer = dataLayer;
    // GA's command queue: each gtag(...) call is pushed as its argument tuple,
    // which GA later reads by index. Rest params (rather than the canonical
    // `arguments` push) to satisfy prefer-rest-params; GA processes the queued
    // array identically.
    const gtag = function (...args: unknown[]): void {
      dataLayer.push(args);
    };
    window.gtag = gtag;
    gtag("js", new Date());
    gtag("config", MEASUREMENT_ID);
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + MEASUREMENT_ID;
    document.head.appendChild(s);
  }
}
