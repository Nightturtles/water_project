# Plan 001: Clear the critical/high npm audit findings (vitest CVE + @capacitor/assets chain)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 150b9ff..HEAD -- package.json package-lock.json scripts/generate-asset-pngs.cjs`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `150b9ff`, 2026-06-11

## Why this matters

`npm audit` currently reports 1 critical and 7 high vulnerabilities. The critical is vitest 3.2.4 (< 3.2.6): when the Vitest UI server is listening, arbitrary files can be read and executed (CVSS 9.8, dev-machine exposure — `npm run test:watch` is part of this repo's normal workflow). All 7 highs come from one devDependency, `@capacitor/assets@^3.0.5`, whose transitive tree pins old `tar`, `minimatch`, `replace`, `tmp`, and an old `@capacitor/cli` copy, with no fix available upstream (`fixAvailable: false`). Beyond the direct risk, this noise floor means a future *real* runtime advisory would be invisible. After this plan, `npm audit --audit-level=high` exits clean.

## Current state

- [package.json](../package.json) — `"vitest": "^3.2.4"` in devDependencies (the installed lockfile version is 3.2.4, below the 3.2.6 fix); `"@capacitor/assets": "^3.0.5"` in devDependencies.
- `@capacitor/assets` is used by exactly one workflow: regenerating native app icons/splashes. It is invoked **manually**, never by CI (verified: no reference in `.github/workflows/`). The pointer to it lives in a comment in `scripts/generate-asset-pngs.cjs`:

```js
// scripts/generate-asset-pngs.cjs:2-13 (excerpt)
// @capacitor/assets expects (1024x1024 for icons, 2732x2732 for splashes).
// ...
//   npx capacitor-assets generate --ios --android
// ...
// Sharp is pulled in transitively via @capacitor/assets (devDep). The
```

- `sharp` is ALSO a direct devDependency (`"sharp": "^0.32.6"`) and is `require()`d directly by `scripts/generate-asset-pngs.cjs:18` — it does NOT rely on @capacitor/assets being installed. The comment on line 13 is stale and should be corrected as part of this plan.
- The direct `@capacitor/cli@^8.3.4` devDependency is NOT in the vulnerable range (vulnerable: `<= 7.4.5 || 8.0.0-alpha.1 - 8.0.2-nightly`); the flagged copy is the transitive one under `@capacitor/assets`. Do not touch the direct `@capacitor/cli`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm install` | exit 0 |
| Tests | `npm test` | 299+ tests pass |
| Typecheck | `npm run typecheck` | exit 0, no output |
| Lint | `npm run lint` | exit 0 |
| Audit | `npm audit --audit-level=high` | exit 0, "found 0 vulnerabilities" at high+ |
| Build | `npm run build` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `package.json`
- `package-lock.json` (via npm, never by hand)
- `scripts/generate-asset-pngs.cjs` (comment correction only)

**Out of scope** (do NOT touch):
- The direct `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android` versions — the native shells are pinned to Capacitor 8.3.x and bumping them risks the iOS/Android builds.
- `vite` — bumping vite to clear the *moderate* esbuild advisory is a major-version migration (5 → 7), explicitly deferred (see plans/README.md).
- Any file under `ios/`, `android/`, `resources/`.

## Git workflow

- Branch: `advisor/001-dep-hygiene`
- One commit, message style matches repo (sentence-case imperative, e.g. "Single source of truth for storage keys"): suggest `Bump vitest past UI-server CVE; drop @capacitor/assets from devDeps`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Bump vitest to the patched version

Run: `npm install -D vitest@^3.2.6`

**Verify**: `npm ls vitest` → shows `vitest@3.2.6` or later, no error. Then `npm test` → all tests pass (299 as of planning; more is fine).

### Step 2: Remove @capacitor/assets from devDependencies

Run: `npm uninstall @capacitor/assets`

Then edit `scripts/generate-asset-pngs.cjs`: in the header comment block (lines 2–13), replace the stale line `// Sharp is pulled in transitively via @capacitor/assets (devDep). The` with a comment noting that sharp is a direct devDependency, and update the usage line to make the on-demand install explicit, e.g.:

```js
//   npx --yes @capacitor/assets generate --ios --android
//   (@capacitor/assets is intentionally NOT a devDependency — its transitive
//   tree pins vulnerable tar/minimatch; npx fetches it on demand.)
// sharp is a direct devDependency, required below.
```

**Verify**: `grep -c "@capacitor/assets" package.json` → `0`. `node -e "require('sharp')"` → exit 0 (sharp still installed directly).

### Step 3: Confirm the audit is clean at high+

Run: `npm audit --audit-level=high`

**Verify**: exit code 0. (Moderate advisories — esbuild via vite 5, etc. — may remain; that is expected and out of scope.)

### Step 4: Full verification sweep

**Verify**: `npm test` → pass; `npm run typecheck` → exit 0; `npm run lint` → exit 0; `npm run build` → exit 0.

## Test plan

No new tests — this plan changes no source code. The existing suite running green on the new vitest version IS the test.

## Done criteria

- [ ] `npm ls vitest` shows >= 3.2.6
- [ ] `grep -c "@capacitor/assets" package.json` returns 0
- [ ] `npm audit --audit-level=high` exits 0
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all exit 0
- [ ] Only package.json, package-lock.json, scripts/generate-asset-pngs.cjs modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `npm install -D vitest@^3.2.6` resolves to a version that breaks any existing test (more than a snapshot/timing flake — re-run once before concluding).
- `npm audit --audit-level=high` still reports findings after Step 2 — that means a high advisory exists outside the @capacitor/assets tree, which this plan did not anticipate. Report the advisory JSON; do not chase it with `npm audit fix --force`.
- Removing @capacitor/assets changes anything under `ios/` or `android/` in `git status` (it should not — it's a pure devDep removal).

## Maintenance notes

- Next time native icons/splashes are regenerated, the command is `npx --yes @capacitor/assets generate --ios --android` (network-dependent; npx fetches it).
- When the team eventually migrates vite 5 → current major (deferred), re-run `npm audit` — the remaining moderates should clear with it.
- Reviewer: check the package-lock diff only removes the @capacitor/assets subtree and bumps vitest; nothing else should move.
