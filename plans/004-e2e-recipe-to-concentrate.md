# Plan 004: Add e2e coverage for the Recipe → Concentrate handoff

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 150b9ff..HEAD -- recipe-browser.js stock-editor.js e2e/`
> If recipe-browser.js or stock-editor.js changed since this plan was written,
> compare the "Current state" excerpts against the live code before
> proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (test-only; no source changes)
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `150b9ff`, 2026-06-11

## Why this matters

The project's own e2e index ([e2e/README.md](../e2e/README.md), the "Recipe-to-concentrate handoff" row) says: *"`+ Create Concentrate` flow from recipe/calculator into the concentrate editor. No automated coverage yet; verify manually until a spec lands."* This flow mutates persisted state (`cw_stock_concentrate_specs`, which cloud-syncs for signed-in users) through `stock-editor.js` — 630 lines of classic JS with zero tests, recently churned by the multi-concentrate feature work (PRs #156–#158). A regression here ships silently today. After this plan, both handoff paths (import a hand-authored formula; derive a formula from ion targets) are covered by a spec that runs in CI like the other smoke specs.

## Current state

### The flow under test

Recipe cards (rendered by `recipe-browser.js` on library.html, index.html, taste.html) offer a "+ Create Concentrate" button in two variants, both calling `window.openStockEditor` (defined in `stock-editor.js`):

- **Import path** — for recipes with a hand-authored `stockFormula` (the Coffee Ad Astra recipes, added in migration `20260506231724`, have one). [recipe-browser.js:1336-1369](../recipe-browser.js) (`onAddStock`): opens the editor with `mode: "new-import"`, prefilled `label`, `bottleMl`, `doseGramsPerL`, `minerals`, and `importSlug: recipe.slug`. On save, the spec is keyed under `recipe.slug` and the card's CTA flips to "✓ In your pantry" (membership check: `isStockImported`, recipe-browser.js:1294-1300, reads `loadStockConcentrateSpecs()` and checks `hasOwnProperty(recipe.slug)`).
- **Derive path** — for recipes without a stockFormula. [recipe-browser.js:1371-1400+](../recipe-browser.js) (`onDeriveStock`): computes a formula via `deriveStockFormulaFromTarget(recipe)` (metrics.js) at click time, opens the editor with `mode: "new-derive"` and `deriveSlug: recipe.slug`. The saved spec carries `createdFrom: "derived:<slug>"` (membership check: `isStockDerived`, recipe-browser.js:1305-1317).
- Both paths fall back to a `minerals.html#stock-import=...` redirect when `window.openStockEditor` is missing — not the path under test.
- Button DOM: created via `el("button", "rx-card-stock-add", "+ Create Concentrate")` (recipe-browser.js:236, 267) and `el("button", "preset-btn", "+ Create Concentrate")` (recipe-browser.js:755, 782). Prefer locating by role/name (`getByRole("button", { name: "+ Create Concentrate" })`) over class.

### The editor modal (stock-editor.js)

`window.openStockEditor({ mode, slug?, prefill?, autoEnable?, onSaved? })` (stock-editor.js:4). Key DOM, from stock-editor.js:95-218:
- overlay `.stock-editor-overlay`, dialog `.stock-editor-dialog`
- inputs `#stock-editor-label` (Name), `#stock-editor-bottle-ml`, `#stock-editor-dose`
- mineral rows inside `.stock-editor-mineral-list`
- error/warning regions `.stock-editor-error`, `.stock-editor-warning`
- **The save control's exact selector is not pinned in this plan** — read stock-editor.js around lines 208-330 (the `.stock-editor-actions` block and its click handler) to identify it before writing the spec. The handler ultimately calls `saveStockConcentrateSpecs` (src/lib/storage.ts:800) which writes the `cw_stock_concentrate_specs` localStorage key (canonical name: `STOCK_CONCENTRATE_SPECS` in src/lib/storage-keys.ts:48).

### Auth gating and the test harness

- Concentrate specs are Category B (gated) data: anonymous users get the login modal instead of a save. Use the existing stub: `stubLoggedIn(page)` from [e2e/_auth-stub.ts](../e2e/_auth-stub.ts) — it pins `window._cachedAuthUserId` / `window.isLoggedInSync` before app scripts run. With a stubbed (not real) session, cloud pushes fail silently and everything persists to localStorage only — no Supabase cleanup needed, and nothing public is ever created.
- Structural pattern to model after: [e2e/calculator-dosing.spec.ts](../e2e/calculator-dosing.spec.ts) — same stub, seeds localStorage after first load, reloads, asserts. Note its header comment explains the stub rationale; write a similar header.
- Playwright config: baseURL `http://localhost:8080`, webServer `npm run build && npx vite preview --port 8080 --strictPort` (playwright.config.ts) — specs run against the **built** dist, started automatically by `npx playwright test`.
- Library data comes from prod Supabase (public recipes, `is_public=true`). The Ad Astra recipes are seeded by migrations and stable. Known environmental flake: "Failed to fetch" against prod Supabase — re-run once before calling it a regression.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Run just this spec | `npx playwright test smoke-stock-from-recipe` | all pass |
| Full e2e | `npm run test:e2e` | pass / creds-gated skips |
| Typecheck (spec is TS) | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope** (the only files you should create/modify):
- `e2e/smoke-stock-from-recipe.spec.ts` (create)
- `e2e/README.md` (update the "Recipe-to-concentrate handoff" row to point at the new spec)

**Out of scope** (do NOT touch):
- `stock-editor.js`, `recipe-browser.js`, or any source file — if the flow appears broken, that's a STOP-and-report, not a fix-it.
- `.env.test` / real-credential flows — this spec must run green with no credentials (stubbed auth only).
- The `minerals.html#stock-import=...` fallback path.

## Git workflow

- Branch: `advisor/004-e2e-stock-from-recipe`
- Commit message suggestion: `Add e2e spec for the recipe-to-concentrate handoff (import + derive paths)`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Reconnoiter the live selectors

Before writing assertions, run the app (`npm run build && npx vite preview --port 8080`) or use a temporary Playwright trace to confirm on library.html:
- which cards show "+ Create Concentrate" (expect Coffee Ad Astra recipes on the import path),
- the save button selector inside the stock editor (from stock-editor.js:208-330),
- the exact "in your pantry" CTA text after save (recipe-browser.js:1303 comment says "✓ In your pantry").

Record these in the spec file header comment.

**Verify**: you can manually drive the flow once in a headed/traced browser session.

### Step 2: Write the spec — import path

`e2e/smoke-stock-from-recipe.spec.ts`, modeled on calculator-dosing.spec.ts:

1. `stubLoggedIn(page)`; `page.goto("/library.html")`; wait for cards to render (the library list is async — wait for a card containing "+ Create Concentrate" to be visible rather than a fixed timeout).
2. Open a recipe that has the import-path button (scope the locator to one card; pick the first match and read its recipe name from the card for later assertions).
3. Click "+ Create Concentrate" → assert `.stock-editor-overlay` visible and `#stock-editor-label` prefilled (non-empty value).
4. Fill `#stock-editor-label` with `E2E Import Concentrate`; click the save control.
5. Assert persistence: `page.evaluate(() => JSON.parse(localStorage.getItem("cw_stock_concentrate_specs") || "{}"))` → has a key whose spec `label === "E2E Import Concentrate"` with a non-empty `minerals` array.
6. Assert the card's CTA flipped to the pantry state ("✓ In your pantry").
7. `page.reload()` → CTA still shows pantry state (membership survives reload).

**Verify**: `npx playwright test smoke-stock-from-recipe` → this test passes.

### Step 3: Extend the spec — derive path

Same skeleton, second test:

1. Find a card offering the derive variant (a recipe with ion targets but no hand-authored formula — if the same card exposes both, prefer a card found NOT to be an Ad Astra import). If discovery is ambiguous in the DOM, drive it from data instead: pick the recipe in `page.evaluate` via `window` state or simply use a different card than Step 2's and accept whichever variant it offers, asserting accordingly.
2. Click "+ Create Concentrate" → editor opens; assert `.stock-editor-mineral-list` contains at least one mineral row and `#stock-editor-bottle-ml` has a value > 0 (derivation produced something).
3. Save with label `E2E Derived Concentrate`; assert the stored spec exists and — if this was the derive variant — carries `createdFrom: "derived:<slug>"`.

If both paths genuinely cannot be distinguished from the page, keep the second test as "derive-or-import on a second recipe" and note it in the spec header — partial coverage beats a brittle selector.

**Verify**: `npx playwright test smoke-stock-from-recipe` → both tests pass.

### Step 4: Negative-ish guard (cheap, high value)

Add a third test: with the editor open, clear `#stock-editor-label` and attempt save → assert `.stock-editor-error` (or the actual validation surface found in Step 1) becomes visible and `cw_stock_concentrate_specs` does NOT gain an entry. (The save handler's validation gates are mirrored in minerals.html:577's comment — "Mirrors the gates enforced in the '+ Create Concentrate' save handler".) If stock-editor.js turns out not to validate an empty label, delete this test and note it in your report — do not add validation yourself.

**Verify**: `npx playwright test smoke-stock-from-recipe` → all tests pass.

### Step 5: Update the e2e index and run the full gate

Edit the `Recipe-to-concentrate handoff` row in `e2e/README.md`: replace "_not yet written_" with a link to `smoke-stock-from-recipe.spec.ts`, matching the table's existing format.

**Verify**: `npm run test:e2e` → full suite passes (creds-gated specs skip without `.env.test`); `npm run typecheck` and `npm run lint` → exit 0.

## Test plan

This plan IS a test plan. Coverage delivered: import handoff happy path, derive handoff happy path, persistence across reload, pantry-state CTA flip, and (if the app validates) the empty-label rejection. Explicitly NOT covered (fine for now): editing an existing concentrate, deletion, cloud round-trip of specs (that's smoke-sync's domain).

## Done criteria

- [ ] `e2e/smoke-stock-from-recipe.spec.ts` exists with ≥2 passing tests, no real credentials required
- [ ] `npx playwright test smoke-stock-from-recipe` exits 0
- [ ] `npm run test:e2e` exits 0 (skips allowed for creds-gated specs)
- [ ] `e2e/README.md` row updated; "not yet written" no longer appears for this flow
- [ ] `npm run typecheck` and `npm run lint` exit 0
- [ ] No source files modified (`git status` shows only the two in-scope files)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- No library card shows a "+ Create Concentrate" button when logged-in-stubbed (the library fetch may have failed, or the affordance moved — check the browser console for fetch errors first and re-run once for the known prod-Supabase flake).
- The save control or pantry CTA can't be located from the structures described in stock-editor.js:95-218 / recipe-browser.js:1294-1317 (drift).
- The flow itself is broken (save doesn't persist, CTA doesn't flip) — that's a product bug to report, not to patch.
- You need to modify any source file to make the spec pass.

## Maintenance notes

- This spec hits prod Supabase for the public library fetch (read-only). If the Ad Astra recipes are ever unpublished, the import-path test loses its subject — prefer asserting on "a card with the button" over a hard-coded recipe name where possible.
- When `stock-editor.js` migrates to `src/components/*.ts` (in-flight migration), this spec is the characterization safety net — run it against the migration PR.
- Reviewer: check the spec uses web-first assertions (`await expect(locator)...`) rather than waits, and that no test depends on another test's state.
