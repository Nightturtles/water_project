# Plan 003: Serialize realtime pulls so two pullFromCloud calls can never overlap

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 150b9ff..HEAD -- src/lib/sync.ts sync.test.js`
> If sync.ts changed since this plan was written, compare the "Current state"
> excerpt against the live `scheduleRealtimePull` before proceeding; on a
> mismatch, treat it as a STOP condition. (Exception: if plans/002 landed,
> line numbers shift slightly and `console.warn("[sync] realtime pull failed"...)`
> may now be `reportError("sync.realtime-pull", err)` — that is expected
> drift; preserve whichever form is present.)

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED (touches the realtime path of a file with data-loss history)
- **Depends on**: plans/002 (soft — land 002 first so failures in this path are observable in Sentry)
- **Category**: bug
- **Planned at**: commit `150b9ff`, 2026-06-11

## Why this matters

`scheduleRealtimePull` debounces realtime events into a single `pullFromCloud`, but the debounce only gates *scheduling*, not *execution*: if a new realtime event arrives while a pull is already in flight, the timer re-arms and a second pull can start before the first finishes. Two concurrent pulls read cloud state and write localStorage without coordination; interleaved application order is unspecified. The existing `skipIfLocalWriteDuringPull` guard protects against a *local* write racing a pull, not against two *pulls* racing each other. Given this repo's history (CLAUDE.md "Supabase safety": three sync bugs cost users recipes), a structural "pulls are serialized" guarantee is cheap insurance. After this plan, realtime-triggered pulls run strictly one-at-a-time, in arrival order.

## Current state

- [src/lib/sync.ts:1096-1121](../src/lib/sync.ts) (at commit 150b9ff):

```ts
// Realtime → pull bridge. Debounce so a burst of events (one per affected
// table) folds into a single pull. Push any pending local write first so
// the pull reads cloud state that already includes our own write —
// otherwise we'd briefly overwrite local with stale cloud (same rationale
// as initSync's push-then-pull ordering).
function scheduleRealtimePull(): void {
  clearTimeout(pullDebounceTimer);
  pullDebounceTimer = setTimeout(function () {
    pullDebounceTimer = undefined;
    const pendingPush = syncTimer ? syncNow() : Promise.resolve();
    Promise.resolve(pendingPush)
      .then(function () {
        return pullFromCloud({ skipIfLocalWriteDuringPull: true });
      })
      .then(function (applied) {
        if (applied === false) {
          // pullFromCloud bailed because a local write landed mid-pull. Re-arm
          // so the remote change still lands once that write has been pushed
          // (the debounce throttles this, and the push-first step above sends
          // the local write up before the retry reads cloud again).
          scheduleRealtimePull();
          return;
        }
        if (typeof window.dispatchEvent === "function") {
          window.dispatchEvent(new CustomEvent("cw:cloud-data-changed"));
        }
      })
      .catch(function (err) {
        console.warn("[sync] realtime pull failed:", err);
      });
  }, PULL_DEBOUNCE_MS);
}
```

- `PULL_DEBOUNCE_MS` is defined near sync.ts:69 (`250`).
- Repo testing convention (header of [sync.test.js](../sync.test.js)): unit tests cover the *deterministic, pure* parts of sync; full-flow realtime stays in `e2e/smoke-sync.spec.ts` because the module captures Supabase state in closures that resist Node stubbing. Therefore this plan extracts the serialization mechanism into an exported, dependency-free helper that CAN be unit tested, and uses it in `scheduleRealtimePull`.
- sync.ts exports plain named functions (see lines 119–1252) and re-publishes the public ones on `window` at the bottom of the module. The new helper is test-facing only — export it from the module but do NOT add it to the `window.*` publishing block.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Tests | `npm test` | all pass (existing + new) |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Full e2e (required: touches sync.ts) | `npm run test:e2e` | pass / creds-gated skips |
| Sync smoke subset | `npm run test:e2e -- smoke-sync` | pass or skip without creds |

Known environmental flake (documented by the maintainer): signed-in e2e against prod Supabase occasionally fails with "Failed to fetch" in `_getUser` — re-run the spec once before treating a failure as a regression.

## Scope

**In scope** (the only files you should modify):
- `src/lib/sync.ts` (the serialization helper + `scheduleRealtimePull` body)
- `sync.test.js` (new tests for the helper)

**Out of scope** (do NOT touch):
- `pullFromCloud` itself — its `skipIfLocalWriteDuringPull` logic and the lastPushed-snapshot guards near sync.ts:750-768 are load-bearing data-loss protections (the comments explain why); do not "improve" them.
- `subscribeToCloudChanges` / reconnect logic.
- `PULL_DEBOUNCE_MS` value.
- The `window.*` publishing block (the helper is not public API).
- `src/lib/storage.ts`, `supabase/`.

## Git workflow

- Branch: `advisor/003-serialize-realtime-pulls`
- Commit message suggestion: `Serialize realtime pulls so concurrent pullFromCloud calls can't interleave`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the serialization helper

In `src/lib/sync.ts`, near the other module-level realtime state (around the `realtimeSubscribedPromise` block, sync.ts:80-91), add:

```ts
// Serialization gate for realtime-triggered pulls. Each enqueued task runs
// only after every previously-enqueued task has settled, so two
// pullFromCloud calls can never overlap (a burst of realtime events while a
// pull is in flight previously re-armed the debounce timer and could start
// a second, concurrent pull). The chain never rejects: each task's errors
// are the task's own responsibility (scheduleRealtimePull's catch), and the
// `function () {}` recovery arm below is belt-and-suspenders so one rejected
// task can't wedge every later pull. Exported for unit tests only — NOT
// published on window.
let realtimePullChain: Promise<unknown> = Promise.resolve();
export function enqueueSerialized(task: () => Promise<unknown>): Promise<unknown> {
  const next = realtimePullChain.then(task, task);
  realtimePullChain = next.then(
    function () {},
    function () {},
  );
  return next;
}
```

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Route the debounced pull through the gate

In `scheduleRealtimePull`, wrap the existing async body (everything currently inside the `setTimeout` callback **after** `pullDebounceTimer = undefined;`) in a function passed to `enqueueSerialized`. The `pendingPush` computation moves INSIDE the task so the `syncTimer` check happens at execution time, when it's actually about to run:

```ts
function scheduleRealtimePull(): void {
  clearTimeout(pullDebounceTimer);
  pullDebounceTimer = setTimeout(function () {
    pullDebounceTimer = undefined;
    enqueueSerialized(function () {
      const pendingPush = syncTimer ? syncNow() : Promise.resolve();
      return Promise.resolve(pendingPush)
        .then(function () {
          return pullFromCloud({ skipIfLocalWriteDuringPull: true });
        })
        .then(function (applied) {
          // ... existing applied === false re-arm + cw:cloud-data-changed dispatch, unchanged ...
        })
        .catch(function (err) {
          // ... existing failure handler, unchanged (console.warn at 150b9ff,
          //     or reportError("sync.realtime-pull", err) if plans/002 landed) ...
        });
    });
  }, PULL_DEBOUNCE_MS);
}
```

Preserve the existing comments (the "Realtime → pull bridge" block comment and the `applied === false` rationale) — move, don't delete. Add one line to the bridge comment noting pulls are now serialized via `enqueueSerialized`.

Note the `applied === false` branch calls `scheduleRealtimePull()` recursively — under the gate this is still correct (it schedules a fresh debounce + a fresh enqueued task; no deadlock, because the re-arm fires from inside the task's `.then`, which doesn't block the chain — the chain advances when this task's promise settles, and the re-armed task is a *new* enqueue).

**Verify**: `npm run typecheck` → exit 0; `npm run lint` → exit 0; `npm test` → existing 299 still pass.

### Step 3: Unit-test the gate

Append a describe block to `sync.test.js` (import `enqueueSerialized` alongside the existing named imports at the top). Cases:

1. **No overlap**: enqueue task A (resolves on a manually-controlled promise) then task B (records a timestamp/flag when started). Assert B has NOT started while A is unresolved; resolve A; await B's enqueue return; assert B ran.
2. **Order preserved**: enqueue 3 tasks pushing their index to an array; await the last; assert `[0, 1, 2]`.
3. **Rejection doesn't wedge the chain**: task A rejects; task B (enqueued after) still runs. (Catch A's returned promise in the test so vitest doesn't flag an unhandled rejection.)
4. **Return value passthrough**: `enqueueSerialized` resolves with the task's resolved value.

Use plain promises with externally-held resolvers (`let resolveA; const a = new Promise((r) => (resolveA = r));`) — no fake timers needed. Model the describe/test style on the existing blocks in sync.test.js.

**Verify**: `npm test` → all pass, including the 4 new tests.

### Step 4: e2e gate

**Verify**: `npm run test:e2e` → pass (creds-gated specs may skip; note it). The cross-device realtime scenario lives in `smoke-sync.spec.ts` — if `.env.test` creds are available, confirm it passes; this is the spec most sensitive to this change.

## Test plan

Covered in Step 3 (the gate, in isolation) + Step 4 (the realtime round-trip, end to end). The serialization mechanism is deliberately extracted so it's testable without stubbing Supabase — matching the repo's stated convention (sync.test.js header).

## Done criteria

- [ ] `enqueueSerialized` exists in sync.ts, exported, NOT in the window publishing block (`grep -n "window.enqueueSerialized" src/lib/sync.ts` → no matches)
- [ ] `scheduleRealtimePull`'s pull body runs through `enqueueSerialized`
- [ ] The `applied === false` re-arm and the failure handler are byte-for-byte preserved (modulo indentation / plans-002 reporter)
- [ ] `npm test` exits 0 with 4 new gate tests
- [ ] `npm run typecheck` and `npm run lint` exit 0
- [ ] `npm run test:e2e` passes (skips allowed without creds; note it)
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The live `scheduleRealtimePull` differs from the excerpt beyond the anticipated plans/002 reporter substitution.
- Any existing sync.test.js test fails after Step 2 — the change must be invisible to the pure-function suite.
- The smoke-sync e2e spec fails twice in a row with the same non-"Failed to fetch" error — that suggests the gate changed observable pull timing in a way the spec depends on; report the failure output rather than loosening the spec.
- You find yourself modifying `pullFromCloud`, the snapshot guards, or reconnect logic — out of scope by definition.

## Maintenance notes

- The gate covers *realtime-triggered* pulls. `initSync`'s push-then-pull and `handleFirstLoginMerge` run outside it — they execute before the channel is subscribed, so overlap with realtime pulls is structurally unlikely, but if a future change makes them concurrent with realtime traffic, route them through `enqueueSerialized` too.
- Reviewer: confirm the `pendingPush` computation moved inside the task (computing it at timer-fire time would capture a stale `syncTimer` check).
- If pull latency ever matters, note the chain adds zero latency in the common (idle) case — the chain head is an already-resolved promise.
