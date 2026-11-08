# E2E — spec files + runbooks

Two formats live here:

- **`*.spec.ts`** — executable Playwright tests. Run locally with `npm run test:e2e`; gated in CI via the `e2e` job.
- **`*.md`** — markdown runbooks for Claude to execute via the Playwright MCP server. Used for flows that aren't yet automated (usually because they need a test Supabase account or manual setup).

Both formats describe the same flows; specs supersede runbooks where they exist, but the runbooks stay as living documentation and as fallback instructions for flows that can't be automated.

## Running locally

```bash
npm run test:e2e              # all specs, one-shot
npx playwright test --ui      # interactive UI mode for debugging
npx playwright test --debug   # step-through debugger
```

The `webServer` config in `playwright.config.ts` runs `npm run build && npx vite preview --port 8080 --strictPort` automatically — no need to start anything separately. The build step ensures the suite exercises the production bundle (the actual `dist/` artifact that ships to cafelytic.com), not the dev-server's on-the-fly transforms. Adds ~1.5s per cold run; preview itself boots instantly.

**Local iteration:** `reuseExistingServer: true` outside CI honors an already-running preview server on 8080 — so `npm run build && npx vite preview --port 8080 --strictPort` in another terminal once, then iterate with `npx playwright test --debug`. **The reused server serves whatever `dist/` was last built**, so rebuild between source edits or you'll see stale results. (Alternative: kill the long-running preview and let Playwright spawn a fresh one each invocation; you pay ~1.5s per run but never see stale state.)

**When the build fails:** Playwright waits for the webServer's URL to respond and times out after 60s with no Vite error in view. Run `npm run build` directly to see the actual failure (typecheck error, missing dep, etc.).

## When to reach for what

See the "Verifying changes" section of [../CLAUDE.md](../CLAUDE.md) for the full decision matrix. Short version:

- **Single-page, single-flow change during development** → the Claude desktop app's browser pane (`preview_start` with the `dev` config from `.claude/launch.json`, then `read_page` / `javascript_tool` / `read_console_messages`). Fast, sandboxed to the local server, zero setup cost per run.
- **Flow that has a `*.spec.ts` here** → `npm run test:e2e`. Deterministic, gated in CI.
- **Flow that only has a `.md` runbook here** (typically anything needing a logged-in Supabase session, multiple browser contexts, or production-origin checks) → Playwright MCP driving the `.md` runbook step-by-step.

## Index

| Flow | Spec | Runbook | Notes |
|---|---|---|---|
| index.html golden path + Sentry wiring + FOUC guard | [smoke-index.spec.ts](smoke-index.spec.ts) | [smoke-index.md](smoke-index.md) | Spec is the source of truth; runbook mirrors it as prose |
| Recipe Builder source-water persist + creator-gated share prompt (Calculator) | [smoke-recipe.spec.ts](smoke-recipe.spec.ts) | [smoke-recipe.md](smoke-recipe.md) | Anonymous tests run for everyone; signed-in `share-prompt` suite requires `.env.test` credentials (skipped without). Spec is the source of truth |
| Multi-device sync scenarios | [smoke-sync.spec.ts](smoke-sync.spec.ts) | [smoke-sync.md](smoke-sync.md) | Spec is the codified subset (Steps 1, 2, 4, 7, 9 — storage-layer driver); runbook is the full UI walk. Needs two contexts + a test account |
| Library browse/edit/import/owner flows | [smoke-library.spec.ts](smoke-library.spec.ts) | — | Library page and ownership workflows (spec-only today) |
| Settings page minerals/concentrates/stock editor flows | [smoke-minerals.spec.ts](smoke-minerals.spec.ts) | — | Settings behaviors and stock workflows (spec-only today) |
| Estimate-from-ZIP flow | [smoke-estimate-water.spec.ts](smoke-estimate-water.spec.ts) | — | Estimate Water UI and related guards (spec-only today) |
| Recipe-to-concentrate handoff | [smoke-stock-from-recipe.spec.ts](smoke-stock-from-recipe.spec.ts) | — | `+ Create Concentrate` import (hand-authored formula) and derive (ion-derived) paths; save persistence across reload; empty-label validation guard |
| Calculator dosing intelligence | [calculator-dosing.spec.ts](calculator-dosing.spec.ts) | — | Recipe Concentrate best-fit dose scaling (snaps to the prescribed dose on an exact match), residual mineral suggestions with one-click Enable, alkalinity buffer suggestion. Stubbed login (`stubLoggedIn`) |
| Recipe builder mixed mode | [recipe-mixed-mode.spec.ts](recipe-mixed-mode.spec.ts) | — | "Supplement minerals (optional)" panel under the active Recipe Concentrate: additive doses, combined solubility warning, open state persisting across reload. Stubbed login |
| Refresh after a cloud pull | [cloud-refresh.spec.ts](cloud-refresh.spec.ts) | — | A simulated pull (`cw:cloud-data-changed`) re-reads source water without reverting an edit still inside its save debounce; the Recipe Builder's reload for pulled drafts waits while a field has focus, Starting Water has unsaved preset edits, or a dialog is open. Stubbed login |
| Multiple Recipe Concentrates | [recipe-multi-concentrate.spec.ts](recipe-multi-concentrate.spec.ts) | — | One row per enabled concentrate in the recipe builder and calculator, summed contributions, disable/recompute, orphan-id filtering. Stubbed login |
| Custom dropper size | [concentrate-dropper.spec.ts](concentrate-dropper.spec.ts) | — | Optional mL-per-drop on Mineral and Recipe Concentrates: drops/mL toggle in the calculator and recipe builder (Recipe Concentrates dose in mL, not grams), dropper size saved and rounded to 3 decimals on the minerals page. Stubbed login |
| Web-side native redirect guard | [redirect-intercept.spec.ts](redirect-intercept.spec.ts) | — | `window.Capacitor` exists on the web build but `isNativePlatform()` is false, so OAuth and password-reset `redirectTo` stay on cafelytic.com URLs. Stubbed auth; no cloud state |
| Delete account | [smoke-delete-account.spec.ts](smoke-delete-account.spec.ts) | [smoke-delete-account.md](smoke-delete-account.md) | Settings "Delete account" reveal, exact-email confirm modal, `delete_account` RPC success (sign-out, local clear, redirect, flash) and failure paths. RPC is stubbed; the runbook covers the real deletion |
| Support contact form | [support-form.spec.ts](support-form.spec.ts) | — | Client-side validation (name, email, message), success and server-failure paths. `functions.invoke` is stubbed; never reaches the Edge Function or Resend |
