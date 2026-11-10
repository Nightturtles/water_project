// Sentry error telemetry — bundled via Vite (was the CDN Loader Script in
// every HTML <head> before Phase A PR h). Imported FIRST by
// src/lib/legacy-globals.ts so Sentry is live before any other module's
// top-level code can throw. window.SENTRY_RELEASE is injected at build time
// by @sentry/vite-plugin (see vite.config.mts); when the auth token is
// missing the plugin no-ops and release falls back to undefined.
// See SENTRY_SETUP.md for DSN ownership and option rationale.

import * as Sentry from "@sentry/browser";

// Re-expose on window so the not-yet-converted classic-script files
// (estimate-water-ui.js calls window.Sentry.captureException) keep working.
// The CDN loader script used to publish this global; we replicate it here.
// This stays assigned even when the user has opted out below — calling
// captureException on an un-init'd client is a safe no-op, so classic-script
// callers don't need their own guard.
window.Sentry = Sentry;

// Honor the documented opt-out. privacy/index.html tells users they can
// disable error reporting by running
// `localStorage.setItem("cafelytic_no_sentry", "1")` and reloading; without
// this guard that promise was never kept. Mirrors the localStorage opt-out
// switch in analytics-init.js (cafelytic_no_analytics). Wrapped in try/catch
// because localStorage access throws in some privacy modes / sandboxed frames.
function sentryDisabled(): boolean {
  try {
    return (
      typeof localStorage !== "undefined" && localStorage.getItem("cafelytic_no_sentry") === "1"
    );
  } catch (_) {
    return false;
  }
}

if (!sentryDisabled()) {
  Sentry.init({
    dsn: "https://c99c13e5b1291bc31a11c864a400daca@o4511243157700608.ingest.us.sentry.io/4511243165433856",
    release: window.SENTRY_RELEASE?.id,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
    // SDK v11 replaced `sendDefaultPii` with `dataCollection`, and leaving it
    // unset now collects cookies, user info (IP address) and HTTP request and
    // response bodies. Our Supabase requests carry sign-in credentials and
    // recipe contents, and privacy/index.html promises Sentry gets neither,
    // so pin the restrictive baseline (the v10 default, per the v11 migration
    // guide) explicitly. Do not remove this block without updating the
    // privacy page and the store privacy labels.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
        response: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
      },
      httpBodies: [],
      urlQueryParams: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      graphQL: { document: false, variables: false },
    },
    // v11 flipped this default to true, which attaches a synthetic stack trace
    // to captureMessage events. reportError (src/lib/report.ts) funnels every
    // non-Error failure through one captureMessage call, so those traces would
    // all point at the same line and regroup existing issues by call site
    // instead of by message. Keep the pre-v11 behavior.
    attachStacktrace: false,
    ignoreErrors: [
      // Telegram / in-app WebView bridge noise — not our code.
      /Error invoking postEvent: Method not found/,
      // Cross-origin "Script error." — browser strips details; not actionable.
      /Script error\.?/,
    ],
    beforeSend: function (event) {
      if (event.request && event.request.cookies) delete event.request.cookies;
      return event;
    },
  });
}
