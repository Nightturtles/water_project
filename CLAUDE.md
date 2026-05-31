# CLAUDE.md — Cafelytic

A pointer file for Claude Code sessions working in this repo. Not user-facing.

## What this is

[cafelytic.com](https://cafelytic.com) — a coffee water / brew recipe calculator. Multi-page vanilla JS bundled by Vite, shipped two ways: as a web app deployed to GitHub Pages on every push to `main`, and as native iOS + Android apps (Capacitor) that wrap the same `dist/` build. The only migration still in flight is converting the classic root `.js` files to TypeScript modules under `src/` (see Verification stack below).

## Stack

- **Frontend**: vanilla JS, no framework, bundled by Vite (`vite.config.mts`). Classic root-level `.js` files are still loaded via `<script>` tags in document order; the TypeScript layer enters through a single module entry, `<script type="module" src="/src/lib/legacy-globals.ts">`, which copies its exports onto `window` for the classic scripts.
- **Backend**: Supabase (Postgres + Auth). Client created in `src/lib/supabase-client.ts` (bundled from the `@supabase/supabase-js` npm package; was a CDN `<script>` pre-migration); migrations in `supabase/migrations/`.
- **Deploy (web)**: push to `main` → GitHub Actions runs the `deploy` job in [.github/workflows/ci.yml](.github/workflows/ci.yml), which builds `dist/` via Vite and publishes to Pages. Pages source must be set to "GitHub Actions" in repo settings (one-time setup, done in PR (c)).
- **Native (iOS + Android)**: Capacitor wraps the same `dist/` build (`capacitor.config.ts`; appId `com.cafelytic.app`). There is intentionally no `server.url`, so the native app loads the bundled `dist/` over `file://` rather than proxying cafelytic.com. The iOS shell uses Swift Package Manager (no CocoaPods, no `.xcworkspace`). CI compile-checks both shells on every push via [.github/workflows/native.yml](.github/workflows/native.yml): `ios-build` runs an unsigned `xcodebuild` against the simulator SDK on a macOS runner, `android-build` runs `gradlew assembleDebug` — neither signs nor uploads. (ci.yml's `typecheck-and-test` job also runs `npx cap sync android --inline` as a fast scaffold-drift check.) Signed store builds are produced and uploaded locally via `scripts/upload-testflight.sh` (iOS/TestFlight) and `scripts/upload-play-internal.sh` (Android/Play).
- **Dev server**: the `dev` config in `.claude/launch.json` runs `vite` on port 8080 (the Vite dev server, which transpiles the TS modules on the fly). This is what Claude Preview's `preview_start dev` launches.

## File map

| Area | Files |
|---|---|
| Entry points | `index.html`, `recipe.html`, `taste.html`, `library.html`, `login.html`, `minerals.html`, `start.html`, `reset-password.html`, `privacy/index.html` (9 Vite inputs) |
| Data | `src/lib/storage.ts` (localStorage + sync hooks), `src/lib/storage-keys.ts` (canonical storage-key constants shared by storage/sync), `src/lib/sync.ts` (Supabase push/pull), `src/lib/supabase-client.ts` (client + auth helpers), `src/lib/legacy-globals.ts` (bridge module copying exports onto window for classic UI scripts; transitively pulls in `src/components/*`), `library-data.js` (still classic JS) |
| Calc | `metrics.js`, `constants.js` |
| UI (TS modules) | `src/components/ui-shared.ts` (DOM helpers, nav, theme, share/confirm dialogs, applyAuthGate), `src/components/login-modal.ts` (anonymous sign-in modal opened from gated affordances), `src/lib/html.ts` (shared HTML escaper), `src/lib/creator-display.ts` (recipe creator attribution) |
| UI (classic) | `script.js`, `source-water-ui.js`, `recipe-browser.js`, `my-recipes-ui.js`, `library-picker.js`, `stock-editor.js`, `diy-editor.js`, `estimate-water-ui.js`, `mineral-selector.js`, `theme-init.js` |
| Native (Capacitor) | `capacitor.config.ts` (appId, splash + status-bar plugin config), `src/lib/capacitor-bootstrap.ts` (native-only: splash dismiss, status bar, haptics via `window.cwHaptic`, share via `window.cwNativeShare`, deep-link OAuth), `ios/`, `android/`, `ios/debug.xcconfig` (`#include?`s the gitignored `team.xcconfig` for the Apple Team ID; template `team.xcconfig.example`) |
| Styles | `style.css` |
| Tooling | `vite.config.mts` (multi-page build, HTML partials, static copy, Sentry sourcemaps), `partials/` (shared `<head>` fragments injected at build time), `globals.d.ts` (ambient types for the `window` bridge), `tsconfig.json`, `eslint.config.js`, `vitest.config.js`, `playwright.config.ts`, `scripts/` (build verify, screenshot capture, asset PNGs, TestFlight/Play upload), `.coderabbit.yaml`, `src/lib/sentry-init.ts`, `SENTRY_SETUP.md`, `e2e/` |

## Verification stack (in progress)

A multi-phase rollout is tracked at `~/.claude/plans/i-d-like-to-create-synthetic-boole.md` (local to the Claude Code harness, not committed).

- **Phase 1** ✅ — CodeRabbit (PR review) + Sentry (runtime errors).
- **Phase 2** (this PR) — Playwright MCP + `e2e/` runbooks.
- **Phase 3** — Vite + TypeScript strict bundling. **Infrastructure landed**: Vitest + Playwright + ESLint/`tsc --noEmit`, the Vite scaffold (PR a), the dev-server + TS test migration (PR b), the Pages deploy cutover (PR c), the storage/sync move to `src/lib/*.ts` plus the `legacy-globals.ts` bridge (PR d), and the first UI slice (ui-shared.js + login-modal.js → `src/components/*.ts`, PR e). `supabase-client.js` and `sentry-init.js` have likewise landed as `src/lib/*.ts`. **Still in progress**: converting the remaining classic UI files (`script.js`, `source-water-ui.js`, `recipe-browser.js`, `my-recipes-ui.js`, `library-picker.js`, `library-data.js`, `mineral-selector.js`, `stock-editor.js`, `diy-editor.js`, `estimate-water-ui.js`, `theme-init.js`, `analytics-init.js`) one-by-one to `src/components/*.ts`, shrinking the bridge as each one converts.
- **Native rollout** ✅ (separate effort, after the verification stack above) — the app now also ships as native iOS + Android via Capacitor; see the **Native (Capacitor)** row in the file map and the **Native** bullet under Stack. `capacitor.config.ts` comments trace the relevant PRs (through "PR h").

## Verifying changes

When you (Claude) make a code change, verify it using this cheat sheet:

| Change | Tool | Notes |
|---|---|---|
| Pure-JS logic (calc, storage serialization) | `npm test` (Vitest), plus `npm run typecheck` / `npm run lint` | Default first check. `npm run typecheck` (`tsc --noEmit`) covers `src/**/*.ts`; `node --check <file>` is a quick syntax check for classic `.js`. |
| Rendering a single page, single flow | **Claude Preview MCP** (`preview_start` → `dev`, then `preview_eval` / `preview_snapshot` / `preview_console_logs`) | Fast, sandboxed to localhost. First-line default. |
| Multi-page flows, multi-context sync, creator-gated branches | **Playwright MCP** (`mcp__playwright__*`) | Run a runbook from [e2e/](e2e/README.md). Slower, but supports multiple contexts (two-device sync scenarios). The `*.spec.ts` suite runs against `vite preview` (the built `dist/`), so it catches build-only regressions the dev server hides. |
| Native (Capacitor) UI or behavior | **Claude Preview / Playwright** with the native platform forced on, or a real simulator/device build | On web, `@capacitor/core` overwrites a naive `window.Capacitor` stub, so force `isNativePlatform()` via a getter/setter shim injected before app scripts run (`addInitScript`). Full native verification needs `npx cap run ios` / `npx cap run android`. |
| Production-only issue (e.g. Sentry wiring, CDN deploy) | `curl` the live URL, then check Sentry Feed | Claude Preview can't navigate off localhost. |

**Default**: reach for Claude Preview first. Escalate to Playwright only when the test requires what Claude Preview can't do (external origins, multiple contexts, richer assertion primitives).

### Analytics on localhost

[analytics-init.js](analytics-init.js) skips loading GA4 when the hostname is `localhost`/`127.0.0.1` (and other loopback addresses: `0.0.0.0`, `::1`, `[::1]`, empty), when `navigator.webdriver` is true, or when `localStorage.cafelytic_no_analytics === "1"`. So all dev, Playwright, and Claude Preview MCP traffic is excluded automatically. To exclude a personal browser on the live site, visit `https://cafelytic.com/?no-analytics=1` once (the script sets the flag and strips the param via `history.replaceState`; subsequent loads run without GA) — `?no-analytics=0` clears it. Devtools fallback: `localStorage.setItem("cafelytic_no_analytics","1")`.

## Supabase safety

Every change that touches `src/lib/sync.ts`, `src/lib/storage.ts`, or row-level-security migrations has user-data risk. The bugs fixed in commits `6d8cd63`, `6464fdb`, `9f89a2e` all slipped past review and cost users recipes. Before merging anything in those files:

1. Run `e2e/smoke-sync.md` (manual, full coverage) and/or `npm run test:e2e -- smoke-sync` (codified subset of Steps 1, 2, 4, 7, 9 covering the load-bearing sync round-trips).
2. Re-read the affected `supabase/migrations/` file end-to-end — do not trust diffs alone.
3. Prefer one extra PR round over a production rollback.

The test-account credentials for the spec live in `.env.test` at the project root (gitignored). `CAFELYTIC_TEST_EMAIL` and `CAFELYTIC_TEST_PASSWORD` are loaded by `e2e/smoke-sync.spec.ts` via a small parser at the top of the file (no `dotenv` dep). When credentials are missing, the describe block is `test.skip`-ed so contributors without them still get a green run.

### Migrations

Project is linked to Supabase ref `srlwgayrxzamxlodpsrq` via the CLI; config in `supabase/config.toml`, files in `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`. The first 13 migrations (through `20260425213600_add_brand_tray_and_empirical_profiles.sql`) were applied to prod manually before the CLI was adopted; they're marked applied in `supabase_migrations.schema_migrations` via `migration repair` and should never be re-run.

When adding a migration:

1. **Claude:** `supabase migration new <name>`, then edit the generated SQL.
2. **Claude:** `supabase start` (if local stack isn't up), then `supabase db reset` — replays every migration against local Postgres from scratch. Catches name collisions, ordering bugs, broken SQL.
3. **User:** runs `supabase db push` against prod. **Claude does not push.** Production schema changes have cost users recipes before; the human gate is intentional.
4. **Claude:** `supabase migration list` to confirm the new version appears on both Local and Remote, then run `e2e/smoke-sync.md` against the live site (local DB doesn't catch prod-only issues like extension availability or RLS edge cases).

## Related docs

- [SENTRY_SETUP.md](SENTRY_SETUP.md) — error telemetry setup, DSN, runbook.
- [e2e/README.md](e2e/README.md) — smoke runbooks and when to use them.
- [SUPABASE_PLAN.md](SUPABASE_PLAN.md) — backend design notes.
- [SUPABASE_SMTP.md](SUPABASE_SMTP.md) — Resend custom SMTP setup so auth emails don't land in spam.
