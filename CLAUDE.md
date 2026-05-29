# CLAUDE.md — Cafelytic

A pointer file for Claude Code sessions working in this repo. Not user-facing.

## What this is

[cafelytic.com](https://cafelytic.com) — a coffee water / brew recipe calculator. Vanilla JS, multi-page, mid-migration to a Vite-bundled build. Deployed to GitHub Pages via a GitHub Actions workflow on every push to `main`.

## Stack

- **Frontend**: vanilla JS, no framework, no bundler. Root-level `.js` files loaded via `<script>` tags in document order.
- **Backend**: Supabase (Postgres + Auth). Client created in `src/lib/supabase-client.ts` (bundled from the `@supabase/supabase-js` npm package; was a CDN `<script>` pre-migration); migrations in `supabase/migrations/`.
- **Deploy**: push to `main` → GitHub Actions runs the `deploy` job in [.github/workflows/ci.yml](.github/workflows/ci.yml), which builds `dist/` via Vite and publishes to Pages. Pages source must be set to "GitHub Actions" in repo settings (one-time setup, done in PR (c)).
- **Dev server**: the `dev` config in `.claude/launch.json` runs `vite` on port 8080 (the Vite dev server, which transpiles the TS modules on the fly). This is what Claude Preview's `preview_start dev` launches.

## File map

| Area | Files |
|---|---|
| Entry points | `index.html`, `recipe.html`, `taste.html`, `library.html`, `login.html`, `minerals.html`, `start.html`, `reset-password.html` |
| Data | `src/lib/storage.ts` (localStorage + sync hooks), `src/lib/sync.ts` (Supabase push/pull), `src/lib/supabase-client.ts` (client + auth helpers), `src/lib/legacy-globals.ts` (bridge module copying exports onto window for classic UI scripts; transitively pulls in `src/components/*`), `library-data.js` |
| Calc | `metrics.js`, `constants.js` |
| UI (TS modules) | `src/components/ui-shared.ts` (DOM helpers, nav, theme, share/confirm dialogs, applyAuthGate), `src/components/login-modal.ts` (anonymous sign-in modal opened from gated affordances) |
| UI (classic) | `script.js`, `source-water-ui.js`, `recipe-browser.js`, `my-recipes-ui.js`, `library-picker.js`, `stock-editor.js`, `diy-editor.js`, `estimate-water-ui.js`, `mineral-selector.js`, `theme-init.js` |
| Styles | `style.css` |
| Tooling | `.coderabbit.yaml`, `src/lib/sentry-init.ts`, `SENTRY_SETUP.md`, `e2e/` |

## Verification stack (in progress)

A multi-phase rollout is tracked at `~/.claude/plans/i-d-like-to-create-synthetic-boole.md` (local to the Claude Code harness, not committed).

- **Phase 1** ✅ — CodeRabbit (PR review) + Sentry (runtime errors).
- **Phase 2** (this PR) — Playwright MCP + `e2e/` runbooks.
- **Phase 3** — Vite + TypeScript strict bundling. **In progress**: Vitest + Playwright + incremental `@ts-check`/ESLint, the Vite scaffold (PR a), the dev-server + TS test migration (PR b), the Pages deploy cutover (PR c), the storage/sync move to `src/lib/*.ts` plus the `legacy-globals.ts` bridge (PR d), and the first UI slice (ui-shared.js + login-modal.js → `src/components/*.ts`, PR e) have all landed. Still pending: converting the remaining UI files (script.js, source-water-ui.js, recipe-browser.js, my-recipes-ui.js, library-picker.js, library-data.js, mineral-selector.js, stock-editor.js, diy-editor.js, estimate-water-ui.js, theme-init.js, analytics-init.js) one-by-one to `src/components/*.ts`, shrinking the bridge as each one converts. (`supabase-client.js` and `sentry-init.js` have since landed as `src/lib/*.ts`.)

## Verifying changes

When you (Claude) make a code change, verify it using this cheat sheet:

| Change | Tool | Notes |
|---|---|---|
| Pure-JS logic (calc, storage serialization) | `npm test` + targeted `node --check <file>` when useful | Vitest is available and should be the default first check. |
| Rendering a single page, single flow | **Claude Preview MCP** (`preview_start` → `dev`, then `preview_eval` / `preview_snapshot` / `preview_console_logs`) | Fast, sandboxed to localhost. First-line default. |
| Multi-page flows, multi-context sync, creator-gated branches | **Playwright MCP** (`mcp__playwright__*`) | Run a runbook from [e2e/](e2e/README.md). Slower, but supports multiple contexts (two-device sync scenarios). The `*.spec.ts` suite runs against `vite preview` (the built `dist/`), so it catches build-only regressions the dev server hides. |
| Production-only issue (e.g. Sentry wiring, CDN deploy) | `curl` the live URL, then check Sentry Feed | Claude Preview can't navigate off localhost. |

**Default**: reach for Claude Preview first. Escalate to Playwright only when the test requires what Claude Preview can't do (external origins, multiple contexts, richer assertion primitives).

### Analytics on localhost

[analytics-init.js](analytics-init.js) skips loading GA4 when the hostname is `localhost`/`127.0.0.1`, when `navigator.webdriver` is true, or when `localStorage.cafelytic_no_analytics === "1"`. So all dev, Playwright, and Claude Preview MCP traffic is excluded automatically. To exclude a personal browser on the live site, visit `https://cafelytic.com/?no-analytics=1` once (the script sets the flag and strips the param via `history.replaceState`; subsequent loads run without GA) — `?no-analytics=0` clears it. Devtools fallback: `localStorage.setItem("cafelytic_no_analytics","1")`.

## Supabase safety

Every change that touches `sync.js`, `storage.js`, or row-level-security migrations has user-data risk. The bugs fixed in commits `6d8cd63`, `6464fdb`, `9f89a2e` all slipped past review and cost users recipes. Before merging anything in those files:

1. Run `e2e/smoke-sync.md` (manual, full coverage) and/or `npm run test:e2e -- smoke-sync` (codified subset of Steps 1, 2, 4, 7, 9 covering the load-bearing sync round-trips).
2. Re-read the affected `supabase/migrations/` file end-to-end — do not trust diffs alone.
3. Prefer one extra PR round over a production rollback.

The test-account credentials for the spec live in `.env.test` at the project root (gitignored). `CAFELYTIC_TEST_EMAIL` and `CAFELYTIC_TEST_PASSWORD` are loaded by `e2e/smoke-sync.spec.ts` via a small parser at the top of the file (no `dotenv` dep). When credentials are missing, the describe block is `test.skip`-ed so contributors without them still get a green run.

### Migrations

Project is linked to Supabase ref `srlwgayrxzamxlodpsrq` via the CLI; config in `supabase/config.toml`, files in `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`. Migrations 001–013 were applied to prod manually before the CLI was adopted; they're marked applied in `supabase_migrations.schema_migrations` via `migration repair` and should never be re-run.

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
