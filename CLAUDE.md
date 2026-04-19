# CLAUDE.md — Cafelytic

A pointer file for Claude Code sessions working in this repo. Not user-facing.

## What this is

[cafelytic.com](https://cafelytic.com) — a coffee water / brew recipe calculator. Vanilla JS, multi-page, no bundler. Deployed as a plain GitHub Pages static site from `main`.

## Stack

- **Frontend**: vanilla JS, no framework, no bundler. ~1,800 LOC spread across root-level `.js` files loaded via `<script>` tags in document order.
- **Backend**: Supabase (Postgres + Auth). Client loaded from CDN via `supabase-client.js`; migrations in `supabase/migrations/`.
- **Deploy**: push to `main` → GitHub Pages serves the raw files. No build step (yet — see Phase 3 below).
- **Dev server**: `npx http-server . -c-1`, wired as the `dev` config in `.claude/launch.json` (port 8080).

## File map

| Area | Files |
|---|---|
| Entry points | `index.html`, `recipe.html`, `taste.html`, `library.html`, `login.html`, `minerals.html` |
| Data | `storage.js` (localStorage + sync hooks), `sync.js` (Supabase push/pull), `supabase-client.js`, `library-data.js` |
| Calc | `metrics.js`, `constants.js` |
| UI | `script.js`, `ui-shared.js`, `source-water-ui.js`, `library-ui.js`, `theme-init.js` |
| Styles | `style.css` |
| Tooling | `.coderabbit.yaml`, `sentry-init.js`, `SENTRY_SETUP.md`, `e2e/` |

## Verification stack (in progress)

A multi-phase rollout is tracked at `/Users/kyleanderson/.claude/plans/i-d-like-to-create-synthetic-boole.md`.

- **Phase 1** ✅ — CodeRabbit (PR review) + Sentry (runtime errors).
- **Phase 2** (this PR) — Playwright MCP + `e2e/` runbooks.
- **Phase 3** — Vite + TypeScript strict + Vitest. Not started. Gate on a concrete motivating bug/refactor.

## Verifying changes

When you (Claude) make a code change, verify it using this cheat sheet:

| Change | Tool | Notes |
|---|---|---|
| Pure-JS logic (calc, storage serialization) | `node --check <file>` + read the diff carefully | No test runner yet (Phase 3). |
| Rendering a single page, single flow | **Claude Preview MCP** (`preview_start` → `dev`, then `preview_eval` / `preview_snapshot` / `preview_console_logs`) | Fast, sandboxed to localhost. First-line default. |
| Multi-page flows, multi-context sync, creator-gated branches | **Playwright MCP** (`mcp__playwright__*`) | Run a runbook from [e2e/](e2e/README.md). Slower, but supports multiple contexts (two-device sync scenarios). |
| Production-only issue (e.g. Sentry wiring, CDN deploy) | `curl` the live URL, then check Sentry Feed | Claude Preview can't navigate off localhost. |

**Default**: reach for Claude Preview first. Escalate to Playwright only when the test requires what Claude Preview can't do (external origins, multiple contexts, richer assertion primitives).

## Supabase safety

Every change that touches `sync.js`, `storage.js`, or row-level-security migrations has user-data risk. The bugs fixed in commits `6d8cd63`, `6464fdb`, `9f89a2e` all slipped past review and cost users recipes. Before merging anything in those files:

1. Run `e2e/smoke-sync.md` against the dev server with a test account.
2. Re-read the affected `supabase/migrations/` file end-to-end — do not trust diffs alone.
3. Prefer one extra PR round over a production rollback.

## Related docs

- [SENTRY_SETUP.md](SENTRY_SETUP.md) — error telemetry setup, DSN, runbook.
- [e2e/README.md](e2e/README.md) — smoke runbooks and when to use them.
- [SUPABASE_PLAN.md](SUPABASE_PLAN.md) — backend design notes.
