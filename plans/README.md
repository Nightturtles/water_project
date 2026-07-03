# Implementation Plans

Living index, maintained by the improve skill across audit runs. Execute in the
order below unless dependencies say otherwise. Each executor: read the plan fully
before starting, honor its STOP conditions, and update your row when done.

- **Run 1** — 2026-06-11, commit `150b9ff` (standard depth, all nine categories; baseline 299 unit tests green). Produced plans 001-005, all merged.
- **Run 2** — 2026-06-17, commit `59bd719` (standard depth; reconcile run scoped to the 5 commits since `150b9ff` — the new `submit-support` public endpoint, the account-deletion migration, the sync/auth changes, and the mobile-nav restructuring). Produced plans 006-009.

Repo-wide gate reminders (from CLAUDE.md):
- Any plan touching `src/lib/sync.ts` or `src/lib/storage.ts` (002, 003) requires the full e2e pass before merge, not just the smoke-sync subset.
- Any plan adding a migration (008) is validated locally with `supabase db reset`; the **human** runs `supabase db push` — Claude does not push.

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| [001](001-dep-hygiene-vitest-critical.md) | Clear critical/high npm audit findings (vitest CVE + @capacitor/assets chain) | P1 | S | — | DONE (merged as PR #172) |
| [002](002-sync-storage-failure-observability.md) | Report sync/storage failures to Sentry instead of swallowing them | P1 | M | — | DONE (merged as PR #173; 2 extra warn sites converted beyond the plan table) |
| [003](003-serialize-realtime-pulls.md) | Serialize realtime pulls so two pullFromCloud calls can never overlap | P1 | S | 002 (soft) | DONE (merged as PR #174, stacked on #173) |
| [004](004-e2e-recipe-to-concentrate.md) | Add e2e coverage for the Recipe → Concentrate handoff | P2 | M | — | DONE (merged as PR #175; CodeRabbit round fixed a tautological assertion) |
| [005](005-minor-cleanups.md) | Minor cleanups: .env.example, shared stock-formula formatter, dead script tag | P3 | S | — | DONE (merged as PR #176) |
| [006](006-npm-audit-nonbreaking-fix.md) | Clear non-breaking npm audit findings (ws + 4 moderates); leave vite major deferred | P2 | S | — | DONE (merged as #187) |
| [007](007-deno-edge-function-ci-and-tests.md) | Put the Deno edge functions under CI (lint + check) and unit-test submit-support | P1 | M | — | DONE (merged as #188; CI-fix: `deno test --no-check`) |
| [008](008-rate-limit-submit-support.md) | Rate-limit the public submit-support endpoint with a per-IP daily quota | P1 | M | 007 | DONE (merged as #189; migration pushed + `submit-support` deployed) |
| [009](009-e2e-support-form.md) | Add an e2e spec for the support contact form (client-side flow) | P2 | M | — | DONE (merged as #190) |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED (with one-line rationale) | APPROVED (executed + reviewed in a worktree; awaiting the user's merge)

## Execute run — 2026-06-17 (reviewed), merged 2026-06-18 (#187-#190)

Plans 006-009 were each executed by a `sonnet` executor in an isolated git worktree and reviewed by the advisor (done criteria re-run, scope checked, diffs + tests read). All four passed, then landed via `pr-babysit-merge`: **006 → #187, 007 → #188, 008 → #189, 009 → #190**, all squash-merged to `main`. 008's migration was applied to prod (`supabase db push`) and the `submit-support` function redeployed by the user. Two CI-fixes were needed during the merge run (see below).

| Plan | Branch | Worktree | Review notes |
|------|--------|----------|--------------|
| 006 | `advisor/006-npm-audit-nonbreaking` | `.claude/worktrees/agent-a6f00c441a2e2ac65` | Only `package-lock.json`; `ws`→8.21.0, vite/esbuild untouched; full sweep green. |
| 007 | `advisor/007-deno-edge-functions` | `.claude/worktrees/agent-a64457717aa644514` | Pure handler-extraction refactor + 17 Deno tests + CI gate. One revise round fixed a `require-await` deno-lint failure in the test stubs (commit `c566f22`). |
| 008 | `advisor/008-rate-limit-submit-support` | `.claude/worktrees/agent-ae7e43b6994661ffb` | **Stacked on 007** (contains 007's commits). Adds migration `20260618051513_add_support_submission_quota.sql` (`supabase db reset` validated locally) + per-IP quota gate (fail-open) + 4 tests (21 total). |
| 009 | `advisor/009-e2e-support-form` | `.claude/worktrees/agent-ab424693d5888a193` | One new spec, 5 cases pass, full e2e suite 82 pass. |

**Merge order if landing these:** 006, 007, then 008 (which already includes 007 — merge 007 first or merge 008 alone since it supersets 007), then 009. After 008 merges, the **user** runs `supabase db push` (creates `support_submission_quota`) and redeploys the `submit-support` function. 007 adds an `edge-functions` CI job that gates `deploy`; it is green on these branches.

## Dependency notes

Run 1:
- **002 before 003**: 003 adds a gate to the realtime pull path; 002 makes failures on that path visible in Sentry. (Both DONE.)
- 001, 004, 005 were independent.

Run 2:
- **Recommended order: 006 → 007 → 008 → 009.** 006 and 009 are independent of everything and can run anytime; 006 is the cheapest quick win.
- **007 before 008 (soft)**: 007 extracts the submit-support handler into a testable export, removes its `@ts-nocheck`, and stands up the `deno test` harness. 008 (rate-limiting) then ships with unit tests instead of by inspection. 008 can land alone, but document that its tests are deferred if 007 hasn't landed.
- **008 carries a migration** (`support_submission_quota` table + `increment_support_quota` RPC) → the human `supabase db push` gate. The function fails OPEN if the RPC is absent, so deploy ordering is forgiving, but push the migration promptly.

## Deferred (audited, deliberately not planned yet — see "why" before re-planning)

From Run 1 — three findings vetted as real but NOT planned, because they overlap each other and the in-flight classic-JS → TypeScript migration, and they live in the repo's highest-churn files. Execute as **one sequenced effort**, each planned (`improve plan <description>`) only when it's actually next:

1. **Characterization tests for `src/components/script.ts` / `src/components/recipe-browser.ts`** (highest churn, no dedicated unit coverage) — both files have since been migrated to TypeScript (#200, #201) and are now tsc-checked, so this is no longer a migration prerequisite; backfilling unit coverage remains valuable but optional.
2. **recipe.html stops full-page-reloading on mineral changes** (recipe.html ~316/320, ~1243/1250). The natural fix is restructuring recipe.html's giant inline script as part of migrating it to a TS module.
3. **Remove `'unsafe-inline'` from the CSP script-src** (partials/head-top.html:3). Blocked on externalizing the per-page inline scripts — which is what (2)'s migration does. Tighten the CSP **last**. (Note: support.html added its own inline submit script in #183, so it's now part of what must be externalized before the CSP can tighten.)

Suggested migration order for the remaining classic files: `metrics.js` (constants.js has since migrated to `src/lib/constants.ts`; `theme-init.js` is a permanent classic — render-blocking `<head>` primer, guarded by smoke-index.spec.ts). (All other UI/data files have since been migrated to TypeScript under `src/components/` and `src/lib/` via PRs #193-#202: stock-editor #193, diy-editor #194, estimate-water-ui #195, source-water-ui #196, library-picker #197, my-recipes-ui #198, mineral-selector #199, recipe-browser #200, script #201, library-data #202; `analytics-init.js` via #207.)

Also deferred:
- **vite 5 → current major.** Clears the remaining esbuild audit highs (plan 006 leaves those, since they only fix via `npm audit fix --force` → vite 8). Schedule as its own migration with the full e2e suite as the gate (`*.spec.ts` runs against the built dist, exactly what a Vite major can break).
- **Bring `estimate-water/index.ts` under `deno check`** (plan 007 only `deno lint`s it, because its `https://esm.sh` import makes type-checking heavy/flaky). Needs the remote import vendored or import-mapped first.

## Direction findings (surfaced Run 2, options for the maintainer — not planned)

- **Account data export.** Account *deletion* is fully built + e2e-tested; there's no symmetric "export my data." The data model already supports it (a `download_user_data()` RPC + a Settings button). Grounded next step if data-portability is wanted. Coarse effort: M.
- **In-app support status / ticketing.** The support form is fire-and-forget (emails out with `reply_to`, no in-app thread). Fine at current scale; flagged so it's a conscious choice. Coarse effort: L.

## Findings considered and rejected

Recorded so the next audit doesn't re-litigate them.

From Run 1:
- **"Listener leak" on `cw:cloud-data-changed` in recipe-browser.js:1558** — not a leak; full-reload MPA, listeners never accumulate.
- **"Stale lastPushed snapshot when cloud row missing" (sync.ts)** — by design; the guard's own comment explains it prevents the seed-upsert from being skipped.
- **`realtimeSubscribedPromise` resolves only once** — documented first-SUBSCRIBED test signal; intentional.
- **Dead script weight on minerals/taste pages** — false; only start.html's metrics.js tag was dead (handled in plan 005).
- **Paginate the public-library fetch (library-data.js:169)** — not worth it at current catalog size (tens of rows, sessionStorage-cached).
- **`.env.test` exposure** — verified never committed, correctly gitignored.
- **Creator-name fallback in recipe-browser.js (476/652/1017)** — safe (`el()` uses textContent); cosmetic only.
- **Implicit-grant OAuth tokens in deep-link hash (capacitor-bootstrap.ts:152)** — PKCE is the primary flow; native WebView mitigates; no action.
- **Hoist repeated `getEffective*Sources()` calls in script.js `calculate()`** — module-cached; negligible win, delicate function.

From Run 2:
- **`THEME_KEY` "undefined" in sync.ts:634** — false. It was a declared ambient global at the time (now a real import from src/lib/constants.ts), used the same way in storage.ts; `tsc` passes. Not a bug.
- **`delete_account` UPDATE→DELETE "race" / dangling `creator_user_id`** — false. A PL/pgSQL function body is atomic (one transaction), and the `creator_user_id` FK is `NO ACTION`, so a stray reference would *reject* the delete, not dangle. By-design.
- **`delete_account` public-row metadata leak** — speculative; recipes intentionally survive as "Anonymous User" (documented in the migration); requires account-recreation social engineering. Not actionable.
- **Email header injection via `name` → subject/text in submit-support** — not injectable. Resend is called via its JSON API (it encodes headers server-side), and `reply_to` is regex-validated to reject CRLF. Not raw SMTP.
- **Focus-trap empty-array crash in ui-shared `showConfirm`** — false. The focusable array is a static, always-non-empty list of just-created buttons (`[input, yesBtn, noBtn]`); the recipe-browser detail modal already guards. No crash possible.
- **submit-support returns Resend's raw error body (`detail.slice(0,500)`)** — LOW; consistent with estimate-water's pattern, contains no secrets. Optional fold-in to plan 008's same-file touch; not separately planned.
- **`pullFromCloud` drafts/volume guards accept arrays (`typeof === "object"` only)** — LOW defense-in-depth nit; those rows are written only by sync.ts from validated localStorage, not arbitrary input. Not worth the churn.
- **Modal re-entrance fragility / realtime channel-reset edge case** — LOW/speculative; existing guards (synchronous `confirmCleanup`; the userId-changed check) cover the realistic paths.
- **App Store badge callout (committed in `59bd719`)** — the maintainer's own in-progress feature with a pre-merge "replace placeholder badges" TODO; not an audit finding.
- **SUPABASE_PLAN.md omits submit-support + delete_account (docs)** — real but LOW; surfaced and offered, not selected for planning this run. Re-offer if a docs pass is wanted.
