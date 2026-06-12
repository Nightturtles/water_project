# Plan 002: Report sync/storage failures to Sentry instead of swallowing them

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 150b9ff..HEAD -- src/lib/storage.ts src/lib/sync.ts src/lib/legacy-globals.ts globals.d.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW-MED
- **Depends on**: none (but land BEFORE plans/003 so the new pull gate's failures are observable)
- **Category**: bug / observability
- **Planned at**: commit `150b9ff`, 2026-06-11

## Why this matters

This repo has lost real user data to sync bugs three times (commits 6d8cd63, 6464fdb, 9f89a2e — see CLAUDE.md "Supabase safety"). Today, every failure mode in the storage/sync pipeline is invisible in production: localStorage quota/availability errors are silently swallowed by the `safe*` wrappers, and every sync failure (push, pull, realtime, first-login merge) only `console.warn`s — which no one sees on a user's device. Sentry is already wired into every page (`src/lib/sentry-init.ts`) but these paths never report to it. After this plan, the maintainer finds out from the Sentry feed that users are failing to persist or sync data, instead of from a support email about lost recipes.

## Current state

- [src/lib/sentry-init.ts](../src/lib/sentry-init.ts) — initializes Sentry and assigns `window.Sentry = Sentry` (line 17). Its comment documents the contract this plan relies on: *"This stays assigned even when the user has opted out below — calling captureException on an un-init'd client is a safe no-op, so classic-script callers don't need their own guard."* So `window.Sentry` may be undefined only in unit tests / non-browser contexts; when present it is always safe to call.
- [globals.d.ts](../globals.d.ts) line 199 declares it: `Sentry?: typeof import("@sentry/browser");`
- The existing convention for reporting from outside sentry-init is `estimate-water-ui.js:79-80`:

```js
if (window.Sentry && typeof window.Sentry.captureException === "function") {
  window.Sentry.captureException(error, { extra: extra || {} });
}
```

- The silent storage wrappers, [src/lib/storage.ts:63-82](../src/lib/storage.ts):

```ts
// --- Safe localStorage wrappers (Bug 4) ---
export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}
export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    return false;
  }
}
export function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (e) {}
}
```

- The warn-only sync failure sites in [src/lib/sync.ts](../src/lib/sync.ts) (line numbers at commit 150b9ff):
  - `172` — `console.warn("[sync] push failed:", err);` (debounced push)
  - `188` — `console.warn("[sync] immediate push failed:", err);` (syncNow)
  - `350` — `console.warn("[sync] " + u.table + " upsert failed:", r.error);`
  - `469` / `480` — `console.warn("[sync] tombstone delete failed:", ...)`
  - `514` / `541` — source/target_profiles upsert failed
  - `581` — `console.warn("[sync] pull failed:", errored.error);`
  - `859` — `console.warn("[sync] hasCloudData probe failed:", errored.error);`
  - `1119` — `console.warn("[sync] realtime pull failed:", err);`
  - `1147` — `console.warn("[sync] initSync failed:", err);`
  - `~1320` — `console.warn("[sync] post-signin merge failed:", err);` (inside the SIGNED_IN handler's `.catch`)
- Module relationships: `sync.ts` imports from `storage.ts`. Both are imported by `src/lib/legacy-globals.ts`, which `Object.assign`s their exports onto `window`. Unit tests (`sync.test.js`, `storage-stock.test.js`, etc.) import the modules directly under Node with globals stubbed by `vitest.setup.js` — in that environment `window.Sentry` is undefined, so the reporter must be a no-op there unless a test installs a stub.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Tests | `npm test` | all pass (299 existing + new) |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Full e2e (required: this plan touches sync.ts/storage.ts) | `npm run test:e2e` | all pass / creds-gated specs skip |

Note on e2e: per CLAUDE.md "Supabase safety", any change to these files requires the e2e pass. The signed-in specs need `.env.test` (CAFELYTIC_TEST_EMAIL / CAFELYTIC_TEST_PASSWORD); without it they self-skip — that still counts as green for this plan, but say so in your report. Known environmental flake: a "Failed to fetch" inside `_getUser` against prod Supabase — re-run the failing spec once before treating it as a regression.

## Scope

**In scope** (the only files you should modify):
- `src/lib/report.ts` (create — the reporter)
- `src/lib/storage.ts` (wire reporter into the three `safe*` catches)
- `src/lib/sync.ts` (wire reporter into the sites listed above)
- `report.test.ts` at repo root (create — unit tests; root placement matches `auth-session.test.ts` / `metrics-storage.test.ts`)

**Out of scope** (do NOT touch):
- `src/lib/sentry-init.ts` — the init/opt-out logic is correct; you only consume `window.Sentry`.
- `estimate-water-ui.js` — its inline Sentry call is fine; do not refactor classic scripts.
- Any user-facing UI signal (toast/banner) for storage failure — deliberately deferred; see Maintenance notes.
- Return types / contracts of `safeGetItem`/`safeSetItem`/`safeRemoveItem` — callers depend on `string | null` / `boolean` / `void`. Reporting is a side effect only.
- `supabase/` — no schema involvement.

## Steps

### Step 1: Create the reporter module

Create `src/lib/report.ts`:

```ts
// Error reporting helper for the storage/sync pipeline. Wraps window.Sentry
// (assigned by sentry-init.ts even when the user opted out — captureException
// on an un-init'd client is a safe no-op) with a per-area, per-page-load cap
// so a hot failure path (e.g. QuotaExceededError on every keystroke save)
// can't flood Sentry. console.warn always fires so local debugging keeps
// working; Sentry only gets the first MAX_REPORTS_PER_AREA per area.

const MAX_REPORTS_PER_AREA = 3;
const reportCounts: Record<string, number> = {};

export function reportError(area: string, err: unknown, extra?: Record<string, unknown>): void {
  console.warn("[" + area + "]", err, extra || "");
  const count = reportCounts[area] || 0;
  if (count >= MAX_REPORTS_PER_AREA) return;
  reportCounts[area] = count + 1;
  const sentry = typeof window !== "undefined" ? window.Sentry : undefined;
  if (!sentry) return;
  if (err instanceof Error && typeof sentry.captureException === "function") {
    sentry.captureException(err, { tags: { area }, extra });
  } else if (typeof sentry.captureMessage === "function") {
    sentry.captureMessage(area + ": " + String(err && (err as { message?: string }).message || err), {
      level: "warning",
      tags: { area },
      extra,
    });
  }
}

// Test seam: reset the per-page-load cap between unit tests.
export function _resetReportCounts(): void {
  for (const k of Object.keys(reportCounts)) delete reportCounts[k];
}
```

Adjust to satisfy `tsc --noEmit` under this repo's strict settings (`strict: true`, `noUncheckedIndexedAccess: true`) — e.g. `reportCounts[area] || 0` already handles the indexed-access undefined. Match the repo's function style (named `function` declarations, no classes).

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Wire the reporter into storage.ts

In `src/lib/storage.ts`, import it (`import { reportError } from "./report";` — check the file's existing import style at the top and match it) and change the three `safe*` catches to report before returning their existing fallback values. Keep return contracts identical:

```ts
export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    reportError("storage.get", e, { key });
    return null;
  }
}
```

Same shape for `safeSetItem` (area `"storage.set"`, still `return false`) and `safeRemoveItem` (area `"storage.remove"`). The distinct areas mean the cap is per-operation; a write-quota storm still lets one read failure through.

IMPORTANT circular-import check: `report.ts` must not import from `storage.ts` or `sync.ts` (it doesn't, per Step 1 — keep it that way).

**Verify**: `npm run typecheck` → exit 0; `npm test` → existing tests still pass (the fake localStorage in vitest.setup.js never throws, so no behavior change in existing suites).

### Step 3: Wire the reporter into sync.ts

In `src/lib/sync.ts`, import `reportError` and convert each site listed in "Current state". Pattern: **replace** the bare `console.warn` with a `reportError` call (reportError itself warns, so keeping both would double-log). Choose stable area names and pass the useful context as `extra`:

| Site (line @ 150b9ff) | area | extra |
|---|---|---|
| 172 | `sync.push` | — |
| 188 | `sync.push-immediate` | — |
| 350 | `sync.upsert` | `{ table: u.table, error: r.error }` — pass the Supabase error object as extra, err arg = `r.error` |
| 469, 480 | `sync.tombstone-delete` | `{ error: ... }` |
| 514, 541 | `sync.profile-upsert` | `{ table: "source_profiles" / "target_profiles", error: ... }` |
| 581 | `sync.pull` | `{ error: errored.error }` |
| 859 | `sync.has-cloud-data` | `{ error: errored.error }` |
| 1119 | `sync.realtime-pull` | — |
| 1147 | `sync.init` | — |
| ~1320 | `sync.first-login-merge` | — |

Supabase `.error` values are plain objects, not `Error` instances — they will route through the `captureMessage` branch; that is intended. Do NOT change any control flow: every catch still swallows/returns exactly what it did before. Do NOT touch line 591 (`pull skipped: local write landed mid-pull`) or line 1025 (channel status) — those are expected-path notices, not failures.

There is one comment in sync.ts (~line 836) that quotes the old warn text `console.warn("[sync] post-signin merge failed:", err)` — update that comment to match the new call so it doesn't go stale.

**Verify**: `npm run typecheck` → exit 0; `npm run lint` → exit 0; `grep -n "console.warn" src/lib/sync.ts` → only lines 591-equivalent and 1025-equivalent remain (the two expected-path notices), plus none of the converted sites.

### Step 4: Unit tests

Create `report.test.ts` at the repo root (Vitest; browser globals pre-stubbed by `vitest.setup.js` — see `auth-session.test.ts` for the structural pattern of a root-level TS test). Cases:

1. **No Sentry, no throw**: with `window.Sentry` undefined, `reportError("x", new Error("boom"))` does not throw.
2. **Error routes to captureException**: install `window.Sentry = { captureException: vi.fn(), captureMessage: vi.fn() }`; an `Error` arg calls `captureException` once with `tags: { area: "x" }`.
3. **Non-Error routes to captureMessage**: a Supabase-style plain object `{ message: "row level security" }` calls `captureMessage`, not `captureException`.
4. **Per-area cap**: call `reportError("storage.set", new Error("quota"))` 5 times → `captureException` called exactly 3 times; a different area still reports.
5. **Storage wiring**: temporarily replace `global.localStorage` with an object whose `setItem` throws (model: build a fake mirroring `vitest.setup.js`'s `makeFakeStorage` but throwing), call `storage.safeSetItem("k", "v")` → returns `false` AND `captureException` was called. Restore the original storage and call `_resetReportCounts()` in `afterEach`.

Remember `beforeEach`: `_resetReportCounts()` and `delete window.Sentry` (or reassign), so the module-level cap doesn't leak across tests.

**Verify**: `npm test` → all pass including the 5+ new tests.

### Step 5: Full e2e gate

**Verify**: `npm run test:e2e` → pass (creds-gated specs may skip; environmental "Failed to fetch" flake → re-run once).

## Test plan

Covered in Step 4. Structural pattern: `auth-session.test.ts` (root-level .ts test, plain describe/test blocks). The key regression case is #4 (the cap) — it's what makes this safe to ship on a hot failure path.

## Done criteria

- [ ] `src/lib/report.ts` exists; `npm run typecheck` exits 0
- [ ] All three `safe*` catches in storage.ts call `reportError`; return contracts unchanged
- [ ] The 11 sync.ts failure sites call `reportError`; the 2 expected-path warns remain plain `console.warn`
- [ ] `npm test` exits 0 with the new report.test.ts cases passing
- [ ] `npm run lint` exits 0
- [ ] `npm run test:e2e` passes (skips allowed when creds absent; note it in the report)
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `safe*` wrappers or the listed sync.ts warn sites don't match the excerpts/line table (drift).
- Adding the import to storage.ts or sync.ts creates a circular-import error at `npm test` (modules evaluate at import time; report rather than restructuring).
- Any existing test fails after Step 2/3 — the wiring must be behavior-preserving; a failure means a contract changed.
- You find yourself wanting to change what a catch returns or rethrow — that is out of scope by definition.

## Maintenance notes

- **Deferred follow-up**: a user-visible signal for persistent storage failure (e.g. quota exceeded → "your changes aren't being saved" banner). Deliberately excluded to keep this plan mechanical; the Sentry data this plan produces will show whether it's needed.
- plans/003 (realtime pull serialization) assumes this plan's `sync.realtime-pull` area exists — land this first.
- Reviewer: scrutinize that no catch block's control flow changed (diff should show only added/replaced reporting lines), and that report.ts has no imports from storage/sync.
- If Sentry volume from `storage.*` areas spikes after release, the cap is per page load — high-traffic pages can still aggregate; tune `MAX_REPORTS_PER_AREA` or add sampling in report.ts only.
