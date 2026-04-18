# Sentry Setup

Production error telemetry for cafelytic.com.

## Project

- Org/project dashboard: https://sentry.io/organizations/ (project name: `cafelytic`)
- Platform: Browser JavaScript (vanilla — no framework)
- Install method: **Loader Script** (no bundler yet; revisit in Phase 3 after Vite lands)

## DSN

The DSN is a public identifier — it's embedded in the HTML served to every
visitor and is safe to commit. The secret auth token (for source-map uploads
and CLI) is not stored here and is not needed until Phase 3.

```
https://c99c13e5b1291bc31a11c864a400daca@o4511243157700608.ingest.us.sentry.io/4511243165433856
```

The loader URL is derived from the public key:
`https://js.sentry-cdn.com/c99c13e5b1291bc31a11c864a400daca.min.js`

## Where it's wired

Every HTML entry point loads the Sentry loader in `<head>` right after
`theme-init.js`. If you add a new entry point, mirror the snippet from
`index.html`. CodeRabbit's path instructions flag drift between pages.

- `index.html`
- `recipe.html`
- `taste.html`
- `library.html`
- `login.html`
- `minerals.html`

## SDK init options

Set inside `Sentry.onLoad(() => Sentry.init({ ... }))`:

- `tracesSampleRate: 0.1` — 10% performance sampling (requires BrowserTracing integration enabled in the Sentry dashboard under Project Settings → Loader Script).
- `replaysSessionSampleRate: 0` — do not record sessions for everyone.
- `replaysOnErrorSampleRate: 1.0` — record a replay whenever an error fires (requires Session Replay enabled in the Loader Script settings).
- `beforeSend` — drops `event.request.cookies` before send to avoid leaking Supabase auth cookies.

If a feature looks like a no-op in production, verify it's enabled in the
Sentry dashboard at **Project Settings → Loader Script**. The loader bundles
only what's toggled there.

## Release tagging

Phase 1 ships without a release tag — Sentry will group errors under the
default "unreleased" bucket. Phase 3 will inject the deployed git SHA via a
Vite `define` so each deploy gets a distinct release.

## Runbook

**Verify an install change works locally**: open the dev server, paste into
the console:

```js
throw new Error('sentry wiring test ' + Date.now());
```

Within ~30s the event should appear in the Sentry Issues view. Resolve the
issue after testing so the release stays clean.

**Muting noisy errors**: in Sentry UI, open the issue, click "…" → "Ignore
until it happens X times / for Y time". Prefer time-bounded ignores to
permanent ones so we see regressions.

**Resolving**: when a fix ships, click "Resolve in the next release". Once
Phase 3 release tagging is live this will auto-reopen if the error recurs in
a later release.

## PII considerations

- Supabase auth cookies are scrubbed in `beforeSend`.
- `sendDefaultPii` is left at its default (false) — we do not send IP addresses
  or request headers beyond what Sentry's scrubbers allow.
- User emails: we never tag user context (`Sentry.setUser`) with the
  authenticated email. If we later want per-user filtering, tag with the
  Supabase user UUID, not the email.
