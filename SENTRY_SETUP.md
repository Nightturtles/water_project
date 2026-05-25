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

```text
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

Defined on `window.sentryOnLoad = function () { Sentry.init({ ... }) }` — the
Sentry Loader invokes this hook before its default init, so custom options
take effect. **Define it before the `<script src="js.sentry-cdn.com/…">` tag**
so the hook is in place no matter how the loader is scheduled. Do not confuse
this with `Sentry.onLoad(callback)` (different API — that callback runs
*after* default init, too late to override options).

- `tracesSampleRate: 0.1` — 10% performance sampling (requires BrowserTracing integration enabled in the Sentry dashboard under Project Settings → Loader Script).
- `replaysSessionSampleRate: 0` — do not record sessions for everyone.
- `replaysOnErrorSampleRate: 1.0` — record a replay whenever an error fires (requires Session Replay enabled in the Loader Script settings).
- `beforeSend` — drops `event.request.cookies` before send to avoid leaking Supabase auth cookies.

If a feature looks like a no-op in production, verify it's enabled in the
Sentry dashboard at **Project Settings → Loader Script**. The loader bundles
only what's toggled there.

## Release tagging

Each deploy is tagged with the git SHA so stack traces resolve against the
TypeScript sources for that exact build.

### How it works

- `@sentry/vite-plugin` runs at build time (see `vite.config.mts`). When
  `SENTRY_AUTH_TOKEN` is set, it: (1) uploads `dist/assets/*.js.map` to
  Sentry tagged with the release name, (2) injects
  `window.SENTRY_RELEASE = { id: "<sha>" }` into the build, then (3) deletes
  the `*.map` files from `dist/` so they aren't served publicly on GitHub
  Pages.
- `sentry-init.js` reads `window.SENTRY_RELEASE.id` and passes it to
  `Sentry.init` as `release`, so every event from that deploy is tagged with
  the same identifier the artifacts were uploaded under.
- The deploy job in `.github/workflows/ci.yml` passes `GITHUB_SHA` to the
  build, so the release name matches the deployed commit. Locally it
  defaults to the current `HEAD` SHA from the plugin's git auto-detection.

### Auth token

The plugin authenticates to Sentry with a `SENTRY_AUTH_TOKEN` (secret,
unlike the public DSN). Scopes: `project:releases` + `org:read`. Generate at
**Sentry → User Settings → Auth Tokens** (or via
`https://<org>.sentry.io/settings/auth-tokens/`). Tokens are shown once;
copy immediately.

Stored as a GitHub Actions secret named `SENTRY_AUTH_TOKEN` on
`Nightturtles/water_project`. Only the `deploy` job reads it. The
`typecheck-and-test` job builds without the token so PR runs don't create a
Sentry release per commit.

### When the token is missing

Local builds and PR builds run without the token. The plugin's `disable`
guard fires and the whole plugin no-ops: no upload, no release injection,
no `*.map` deletion. `sentry-init.js`'s optional-chaining handles the
missing `window.SENTRY_RELEASE` and ships events with `release: undefined`,
same as pre-PR-f behavior. Build still succeeds and `npm run build:verify`
still passes.

### When the upload fails

If Sentry rejects the token (e.g. rotated, expired, network blip), the
plugin's `errorHandler` in `vite.config.mts` logs a warning and continues.
The build still produces a deployable `dist/`, but the sourcemaps for that
release won't resolve on Sentry's side. Investigate via the deploy job's
`npm run build` log.

### Verifying after a deploy

1. Open `https://cafelytic.com`, paste into the console:
   ```js
   throw new Error('sentry release test ' + Date.now());
   ```
2. Within ~30s the event appears in Sentry, tagged with the deploy's SHA.
3. The stack trace should resolve to a `.ts` source line (e.g.
   `src/lib/storage.ts:142`), not the minified `legacy-globals-HASH.js`.
4. `curl -I https://cafelytic.com/assets/*.js.map` should return 404 — the
   maps were uploaded to Sentry and deleted from the public bundle.

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
