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
// A lock is an exclusive-create file in the OS temp dir, shared across worker
// processes on the same runner. The timestamp written inside lets a much-later
// acquirer reclaim a lock orphaned by a hard process crash — afterAll (which
// releases) still runs on ordinary test failures, so only a kill leaks it, and
// each CI run gets a fresh runner/tmpdir so a leak never crosses runs.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const LOCK_FILE = path.join(os.tmpdir(), "cafelytic-e2e-shared-account.lock");
// Far longer than the whole signed-in suite, so a live holder is never mistaken
// for a crashed one; a genuinely orphaned lock is reclaimed after this.
const STALE_MS = 600_000;
const POLL_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Acquire the shared-account lock, returning a release function. Polls until the
// lock is free or `timeoutMs` elapses (then throws — a loud failure is safer
// than running two signed-in specs against one account). Under local workers:1
// there is no contention, so the first attempt always wins.
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
          // Already gone (reclaimed as stale, or never written) — nothing to do.
        }
      };
    } catch {
      // Lock is held. Reclaim it only if the holder looks crashed.
      try {
        const heldSince = Number(fs.readFileSync(LOCK_FILE, "utf8")) || 0;
        if (Date.now() - heldSince > STALE_MS) fs.unlinkSync(LOCK_FILE);
      } catch {
        // Holder released/reclaimed between our write and read — just retry.
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `acquireSharedAccount: timed out after ${timeoutMs}ms waiting for ${LOCK_FILE}`,
        );
      }
      await sleep(POLL_MS);
    }
  }
}
