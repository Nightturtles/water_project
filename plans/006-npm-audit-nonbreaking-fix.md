# Plan 006: Clear the non-breaking npm audit findings (ws + 4 moderates), leave the vite major deferred

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 59bd719..HEAD -- package.json package-lock.json`
> If either file changed since this plan was written, re-run `npm audit`
> (Step 1) and compare against the "Current state" numbers before proceeding;
> on a large mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security (dependencies)
- **Planned at**: commit `59bd719`, 2026-06-17

## Why this matters

`npm audit` currently reports 8 vulnerabilities (1 low, 4 moderate, 3 high). Two
of the three highs are `ws` (uninitialized memory disclosure + a memory-exhaustion
DoS), pulled in transitively through `@supabase/supabase-js`. Those two — plus
four moderates (`@babel/core`, `js-yaml`, `qs`, `tar`, `brace-expansion`) — are
fixable with a **non-breaking** `npm audit fix` (no major bumps). The third high
is `esbuild`, which only clears via `npm audit fix --force` → vite 8 (a major
migration that is **deliberately deferred** — see plans/README.md). After this
plan, the only remaining audit findings are the esbuild/vite chain, so a future
*real* advisory is not buried under noise that a one-line command could have
cleared.

None of these packages ship in the production browser bundle (Cafelytic deploys a
static `dist/` to GitHub Pages; `ws` runs only in Node, where `@supabase/realtime-js`
falls back from the browser's native WebSocket). So the exposure is dev-machine +
CI, the same framing as the earlier plan 001.

## Current state

`npm audit` at commit `59bd719` reports (abbreviated):

```
esbuild  <=0.28.0   (HIGH)  fix via `npm audit fix --force` → vite@8 (BREAKING) — DEFERRED, do not do
  vite  <=6.4.2     depends on vulnerable esbuild
ws  8.0.0 - 8.20.1  (HIGH)  fix via `npm audit fix`
@babel/core <=7.29.0 (MOD)  fix via `npm audit fix`
brace-expansion 5.0.2-5.0.5 (MOD) fix via `npm audit fix`
js-yaml <=4.1.1     (MOD)  fix via `npm audit fix`
qs  6.11.1-6.15.1   (MOD)  fix via `npm audit fix`
tar <=7.5.15        (MOD)  fix via `npm audit fix`
8 vulnerabilities (1 low, 4 moderate, 3 high)
```

Dependency parents (from `npm ls`):

- `ws@8.20.0` ← `@supabase/supabase-js@2.103.3` → `@supabase/realtime-js@2.103.3`. `@supabase/supabase-js` is a direct dependency pinned `^2.103.3`; `realtime-js` allows a patch-level `ws` bump within range, which is why the fix is non-breaking.
- `esbuild@0.21.5` ← `vite@5.4.21`. This is the deferred chain. **Do not touch `vite`.**

The repo verification commands (from `package.json`):

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm install` | exit 0 |
| Audit | `npm audit` | (see Steps — exit code is nonzero while esbuild remains; that's expected) |
| Tests | `npm test` | all pass (300+) |
| Typecheck | `npm run typecheck` | exit 0, no output |
| Lint | `npm run lint` | exit 0 |
| Format check | `npm run format:check` | exit 0 |
| Build | `npm run build` | exit 0 |

## Scope

**In scope** (the only files you should modify):

- `package-lock.json` (via npm, never by hand)
- `package.json` (ONLY if `npm audit fix` itself edits it — expected to stay unchanged, since all fixes are transitive)

**Out of scope** (do NOT touch):

- `vite`, `esbuild`, and anything that requires `npm audit fix --force` — the vite 5 → 8 major is a separate, deferred migration with the e2e suite as its gate.
- The direct `@supabase/supabase-js` version — let npm resolve the transitive `ws` bump; do not bump supabase-js to chase it.
- Any source file. This plan changes dependencies only.

## Git workflow

- Branch: `advisor/006-npm-audit-nonbreaking`
- One commit. Message style matches the repo (sentence-case imperative, e.g. the
  earlier `Bump vitest past UI-server CVE; drop @capacitor/assets from devDeps`):
  suggest `Clear non-breaking npm audit findings (ws + moderates)`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Snapshot the current audit

Run: `npm audit` (capture the output). Confirm it matches "Current state": 3 high
(esbuild, ws×2-CVE), 4 moderate, 1 low. If the counts are wildly different, the
tree drifted since planning — STOP and report.

### Step 2: Apply the non-breaking fix

Run: `npm audit fix` (NOT `--force`).

This should bump `ws`, `@babel/core`, `js-yaml`, `qs`, `tar`, and `brace-expansion`
within their allowed ranges and rewrite only `package-lock.json`.

**Verify immediately**:

- `git diff --stat package.json` → **no changes** (expected; all fixes are transitive). If `package.json` changed, inspect the diff — a transitive-only fix should not edit it. If npm bumped a direct dependency's major, STOP.
- `npm ls vite` → still `vite@5.x` (unchanged). `npm ls esbuild` → still `esbuild@0.21.x` (unchanged). If either moved, `npm audit fix` pulled a breaking change it shouldn't have — STOP and report.
- `npm ls ws` → now shows a patched version (≥ 8.20.2 / outside the `8.0.0 - 8.20.1` range).

### Step 3: Confirm the remaining audit floor is esbuild-only

Run: `npm audit`

**Verify**:

- The output no longer lists `ws`, `@babel/core`, `js-yaml`, `qs`, `tar`, or `brace-expansion`.
  Quick check: `npm audit 2>&1 | grep -E "node_modules/ws|@babel/core|js-yaml|node_modules/qs|node_modules/tar|brace-expansion"` → **no output**.
- The ONLY vulnerabilities that remain are the esbuild/vite chain.
  Quick check: `npm audit 2>&1 | grep -E "esbuild|vite"` → still present (expected, deferred).
- The summary line should now read roughly `2 moderate, 1 high` or similar — i.e. only the esbuild-via-vite entries. (esbuild reports 1 high + vite a moderate depending on npm's rollup; the exact count isn't load-bearing — the load-bearing fact is that ws and the four named moderates are gone and vite/esbuild are untouched.)

### Step 4: Full verification sweep

Run each and confirm:

- `npm run format:check` → exit 0
- `npm run lint` → exit 0
- `npm run typecheck` → exit 0
- `npm test` → all pass
- `npm run build` → exit 0

(The dependency bumps are transitive dev/build tooling; the suite passing on them
IS the regression test.)

## Test plan

No new tests — this plan changes no source code. The existing unit suite, lint,
typecheck, and build all passing on the updated lockfile is the verification.

## Done criteria

ALL must hold:

- [ ] `npm ls ws` shows a version outside `8.0.0 - 8.20.1` (patched)
- [ ] `npm ls vite` is unchanged (`5.x`) and `npm ls esbuild` is unchanged (`0.21.x`)
- [ ] `npm audit` no longer lists `ws`, `@babel/core`, `js-yaml`, `qs`, `tar`, `brace-expansion`
- [ ] `npm audit` still lists only the esbuild/vite chain (deferred), nothing else
- [ ] `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all exit 0
- [ ] Only `package-lock.json` (and possibly `package.json` if npm touched it) changed (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `npm audit fix` (without `--force`) wants to or does change `vite`/`esbuild`, or bumps any direct dependency to a new major.
- `npm audit fix` cannot clear `ws` within range and suggests `--force` for it — report the audit JSON; do NOT run `--force`.
- Any of `npm test` / `npm run typecheck` / `npm run lint` / `npm run build` fails after the fix (re-run once to rule out a flake first).
- `package.json` gains or loses a dependency you didn't expect.

## Maintenance notes

- The remaining esbuild/vite highs clear only with the deferred vite 5 → 8 major migration. When that happens, re-run `npm audit` — it should then be clean. Gate that migration on the full e2e suite (`npm run test:e2e`), since a Vite major can break the built `dist/` the `*.spec.ts` suite runs against.
- Reviewer: confirm the `package-lock.json` diff only moves the named transitive packages (ws, babel, js-yaml, qs, tar, brace-expansion) and does NOT move vite/esbuild or any direct dependency.
- If `npm audit fix` recurs in future runs with the same packages, it means a parent re-pinned them; check `npm ls <pkg>` for the new parent before re-fixing.
