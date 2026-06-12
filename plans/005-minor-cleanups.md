# Plan 005: Minor cleanups — .env.example, shared stock-formula formatter, dead script tag

> **Executor instructions**: Follow this plan step by step. The three tasks are
> independent — execute in any order, verify each on its own. Run every
> verification command and confirm the expected result before moving on. If
> anything in the "STOP conditions" section occurs, stop and report — do not
> improvise. When done, update the status row for this plan in
> `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 150b9ff..HEAD -- recipe-browser.js script.js start.html .gitignore src/lib/legacy-globals.ts globals.d.ts`
> If recipe-browser.js or script.js changed since this plan was written,
> compare the "Current state" excerpts against the live code before
> proceeding; on a mismatch for a given task, treat it as a STOP condition
> for that task only (the other tasks may proceed).

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx / tech-debt
- **Planned at**: commit `150b9ff`, 2026-06-11

## Why this matters

Three small, independent debts: (A) new contributors can't discover the e2e credential setup (`.env.test` is gitignored and undocumented outside CLAUDE.md prose — the e2e suite silently self-skips without it); (B) the stock-formula display string is implemented twice with drifted behavior (`recipe-browser.js` vs `script.js`), so a spec-schema change must be fixed in two places; (C) `start.html` ships 50KB of `metrics.js` it never calls.

## Current state

### Task A — .env.example

- `.env.test` at repo root (gitignored, never committed — verified) holds `CAFELYTIC_TEST_EMAIL` and `CAFELYTIC_TEST_PASSWORD`, parsed by `e2e/smoke-sync.spec.ts` (see its comment around lines 31-32). CLAUDE.md ("Supabase safety") documents this in prose.
- **Trap**: [.gitignore](../.gitignore) line 11 is the pattern `.env.*` — a new `.env.example` would be silently ignored. The plan must add a negation.

### Task B — duplicated stock-formula formatter

- [recipe-browser.js:296-317](../recipe-browser.js) — `formatStockFormula(formula)`: labels from a local `STOCK_MINERAL_SHORT` map (defined at recipe-browser.js:184), keeps zero-gram entries (filters only non-finite), output like `5 g epsom · 3 g bicarb in 500 mL - 2 g/L` (note: spaces around "g", appends bottle and dose suffixes when > 0).
- [script.js:1582-1595](../script.js) — `formatStockResultDetail(spec)`: labels from `MINERAL_DB[id].formula` (constants.js global, ambient-declared at globals.d.ts:70), **filters out** grams <= 0, output like `5g CaCl2·2H2O · 2g MgSO4·7H2O` (no space before "g", no bottle/dose suffix).
- Both consume the same spec shape `{ minerals: [{ mineralId, grams }], bottleMl?, doseGramsPerL? }`.
- Repo convention for new shared code: TS module under `src/lib/`, published to classic scripts via [src/lib/legacy-globals.ts](../src/lib/legacy-globals.ts) (`Object.assign(window, storage, sync)` plus side-effect imports) with the window type declared in [globals.d.ts](../globals.d.ts). Pure helpers get root-level unit tests (pattern: `storage-keys.test.ts`).
- Load order guarantee: in every page's `<head>`, `constants.js` (defer) precedes the `legacy-globals.ts` module entry, and both execute before the classic UI scripts — so a TS module may reference the ambient `MINERAL_DB` global at call time (NOT at module-eval time).

### Task C — dead script tag

- [start.html:148-150](../start.html):

```html
<script defer src="constants.js"></script>
<script type="module" src="/src/lib/legacy-globals.ts"></script>
<script defer src="metrics.js"></script>
```

- Verified at planning time: no function defined by metrics.js (`calculateIonPPMs`, `calculateMetrics`, `recipeMetricsSummary`, `deriveStockFormulaFromTarget`, etc. — see `grep "^function " metrics.js`) appears anywhere in start.html's inline script. Contrast: minerals.html calls `deriveStockFormulaFromTarget` 6 times — do NOT touch other pages.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Tests | `npm test` | all pass (existing + new) |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |
| Classic-JS syntax check | `node --check recipe-browser.js && node --check script.js` | exit 0 |
| Ignore check | `git check-ignore .env.example` | exit code 1 (NOT ignored) |

## Scope

**In scope** (the only files you should create/modify):
- `.env.example` (create), `.gitignore` (one negation line)
- `src/lib/stock-format.ts` (create), `stock-format.test.ts` at repo root (create), `src/lib/legacy-globals.ts`, `globals.d.ts`, `recipe-browser.js`, `script.js`
- `start.html` (remove one script tag)

**Out of scope** (do NOT touch):
- `.env.test` itself — never read or echo its values.
- `metrics.js`, `constants.js`, any other HTML page's script tags.
- Behavioral changes to either formatter's output — this is a consolidation, not a redesign; outputs must be byte-identical (the unit tests pin them).
- The 0-gram filtering difference between the two modes — preserve it, do not "fix" it.

## Git workflow

- Branch: `advisor/005-minor-cleanups`
- One commit per task or one combined commit; suggestion: `Minor cleanups: .env.example, shared stock-formula formatter, drop dead metrics.js tag`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Task A

#### Step A1: Create .env.example and un-ignore it

Create `.env.example`:

```
# E2E test-account credentials. Copy to .env.test (gitignored) and fill in.
# See CLAUDE.md "Supabase safety" for what these gate: without them the
# signed-in e2e specs (e2e/smoke-sync.spec.ts and friends) self-skip.
CAFELYTIC_TEST_EMAIL=
CAFELYTIC_TEST_PASSWORD=
```

In `.gitignore`, directly under the `.env.*` line, add:

```
!.env.example
```

**Verify**: `git check-ignore .env.example` → exit 1 (not ignored); `git check-ignore .env.test` → exit 0, still ignored.

### Task B

#### Step B1: Create the shared formatter

Create `src/lib/stock-format.ts` exporting:

```ts
export const STOCK_MINERAL_SHORT: Record<string, string> = { /* moved verbatim from recipe-browser.js:184 */ };

export function formatStockSpec(
  spec: { minerals?: Array<{ mineralId?: string; grams?: number }>; bottleMl?: number; doseGramsPerL?: number } | null | undefined,
  opts: { labelMode: "short" | "formula"; includeBottleDose: boolean },
): string;
```

Semantics, mode by mode — these reproduce the two current implementations exactly:
- `labelMode: "short"` (replaces `formatStockFormula`): label = `STOCK_MINERAL_SHORT[m.mineralId] || m.mineralId || "?"`; skip non-finite grams but KEEP zero; part = `grams + " g " + label` (spaces); join `" · "`; when `includeBottleDose` and `bottleMl > 0` append `" in " + bottleMl + " mL"`; when `doseGramsPerL > 0` append `" - " + doseGramsPerL + " g/L"`. Empty/absent minerals array → `""`.
- `labelMode: "formula"` (replaces `formatStockResultDetail`): label = `MINERAL_DB[m.mineralId]?.formula || m.mineralId`; skip grams <= 0 or non-finite, skip entries without `mineralId`; part = `grams + "g " + label` (no space before g); join `" · "`; never append bottle/dose. All parts filtered → `""`.

`MINERAL_DB` is the ambient global from constants.js (globals.d.ts:70) — reference it **inside the function body** with a guard (`typeof MINERAL_DB !== "undefined"`) so module evaluation never touches it; in unit tests, `require("./constants.js")` first (the pattern at the top of `sync.test.js`).

#### Step B2: Bridge it to the classic scripts

- In `src/lib/legacy-globals.ts`: `import * as stockFormat from "./stock-format";` and include it in the existing `Object.assign(window, storage, sync)` call → `Object.assign(window, storage, sync, stockFormat);`. Add one line to the file's header comment listing the new module.
- In `globals.d.ts`: add `formatStockSpec` (and `STOCK_MINERAL_SHORT`) to the Window augmentation, matching the style of neighboring declarations.

**Verify**: `npm run typecheck` → exit 0.

#### Step B3: Pin current behavior with tests, then switch the call sites

1. Create `stock-format.test.ts` (root). Fixtures BEFORE switching callers — derive expected strings from the current implementations:
   - short mode: multi-mineral with bottle+dose → `"5 g epsom · 3 g bicarb in 500 mL - 2 g/L"`-shaped (use real ids from `STOCK_MINERAL_SHORT`); zero-gram entry KEPT in short mode; unknown mineralId falls back to the id; empty list → `""`; bottle/dose omitted when 0 or with `includeBottleDose: false`.
   - formula mode: zero-gram entry DROPPED; label falls back to mineralId when not in MINERAL_DB; no bottle/dose suffix ever; all-dropped → `""`.
2. In `recipe-browser.js`: delete the `STOCK_MINERAL_SHORT` map (line 184) and the body of `formatStockFormula` (296-317); keep the local function as a one-line delegate so the file's internal call sites are untouched:
   ```js
   function formatStockFormula(formula) {
     return window.formatStockSpec(formula, { labelMode: "short", includeBottleDose: true });
   }
   ```
3. In `script.js`: same treatment for `formatStockResultDetail` (1582-1595) → delegate with `{ labelMode: "formula", includeBottleDose: false }`. Keep its explanatory comment, updated to point at src/lib/stock-format.ts.

**Verify**: `npm test` → all pass incl. new fixtures; `node --check recipe-browser.js && node --check script.js` → exit 0; `npm run build` → exit 0; `grep -c "STOCK_MINERAL_SHORT" recipe-browser.js` → 0.

### Task C

#### Step C1: Remove the dead tag

Delete line 150 (`<script defer src="metrics.js"></script>`) from `start.html`. First re-verify it's still dead: `for fn in $(grep -o "^function [A-Za-z_]*" metrics.js | awk '{print $2}'); do grep -q "$fn" start.html && echo "USED: $fn"; done` → no output (if any function prints, STOP for this task).

**Verify**: `npm run build` → exit 0; then `npx vite preview --port 4173` and load `http://localhost:4173/start.html` (e.g. via `curl -s` for a 200 plus a Playwright/preview console check) → page renders, no console errors referencing undefined functions.

## Test plan

Task B carries the test weight: `stock-format.test.ts` pins both output formats byte-for-byte before the call sites switch (write fixtures from the OLD implementations' behavior, confirm the new function matches). Tasks A and C are verified by the commands above; no new tests.

## Done criteria

- [ ] `.env.example` committed and not gitignored; `.env.test` still ignored
- [ ] `src/lib/stock-format.ts` + passing `stock-format.test.ts`; both classic functions are one-line delegates; `STOCK_MINERAL_SHORT` exists only in the TS module
- [ ] start.html no longer loads metrics.js; page loads clean
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all exit 0
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- (Task B) Either current implementation differs from the excerpts — re-pinning behavior from drifted code risks freezing a regression.
- (Task B) Any e2e or unit test fails after the call-site switch — the consolidation must be output-identical; a failure means a semantic was missed (likely the 0-gram or spacing difference).
- (Task C) The dead-code re-verification grep prints any function name.
- (Task A) `.gitignore` no longer contains the `.env.*` pattern (the negation would then be wrong).

## Maintenance notes

- When `recipe-browser.js` / `script.js` migrate to TS (in-flight migration), the delegates collapse into direct imports of `formatStockSpec` — the bridge entry then disappears.
- Reviewer: diff-check that the two deleted implementations and the new module agree on the subtle differences (0-gram filtering, `"5 g "` vs `"5g "` spacing) — the unit fixtures should make this visible at a glance.
- Deliberately NOT done (rejected during the audit): hoisting repeated `getEffective*Sources()` calls in script.js's `calculate()` — the storage load helpers are module-cached, so the win is negligible and the function is the most delicate in the file.
