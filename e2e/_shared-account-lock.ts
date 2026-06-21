// Cross-worker mutex for the e2e specs that authenticate as the SHARED test
// account (smoke-recipe + smoke-sync). Under CI's `workers: 2` those two files
// can be scheduled on different workers and run at the same time; because they
// sign in as ONE account, smoke-sync's profile/Realtime writes broadcast into
// smoke-recipe's live session and revert its active target back to the built-in
// cafelytic-filter mid-test — so smoke-recipe's "+1 calcium" Save Changes lands
// on cafelytic-filter and plants a durable shadow row that poisons later runs
// (project memory: smoke-recipe-shadow-row-incident). Serializing the two
// signed-in describes across workers removes the race; anonymous specs keep
// running in parallel. (redirect-intercept signs in only with stubbed auth and
// never touches cloud state, so it does NOT take the lock.)
//
// The lock is an exclusive-create file in the OS temp dir, shared across worker
// processes on the same runner. Normal runs release it in afterAll (which runs
// even on test failure); only a hard process crash leaks it, and
// _global-setup.ts clears any leftover before the next run's workers start, so a
// crash self-heals rather than wedging later runs.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const LOCK_FILE = path.join(os.tmpdir(), "cafelytic-e2e-shared-account.lock");
const POLL_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Acquire the shared-account lock, returning a release function. Polls while the
// lock is held by another worker until it frees or `timeoutMs` elapses (then
// throws — a loud failure is safer than running two signed-in specs against one
// account). Under local workers:1 there is no contention, so the first attempt
// always wins.
export async function acquireSharedAccount(timeoutMs = 180_000): Promise<() => void> {
  const start = Date.now();
  for (;;) {
    try {
      fs.writeFileSync(LOCK_FILE, String(Date.now()), { flag: "wx" });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          fs.unlinkSync(LOCK_FILE);
        } catch {
          // Best-effort: a missing file (already cleared) is fine, and any other
          // unlink failure is cleared by _global-setup.ts on the next run.
        }
      };
    } catch (err) {
      // Only EEXIST ("the lock file already exists") means contention — keep
      // polling. Any other error (bad permissions, missing tmpdir) is a real
      // failure and must surface immediately rather than spin for `timeoutMs`.
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `acquireSharedAccount: timed out after ${timeoutMs}ms waiting for ${LOCK_FILE} ` +
            `(a prior run may have crashed holding it; it is cleared at the start of each run)`,
        );
      }
      await sleep(POLL_MS);
    }
  }
}
