// Sentry Browser JavaScript Loader — pre-init hook.
// Loaded BEFORE the js.sentry-cdn.com loader script in every HTML entry
// point so the loader picks up these options before its default init.
// See SENTRY_SETUP.md for DSN and option rationale.
window.sentryOnLoad = function () {
  Sentry.init({
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
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
};
